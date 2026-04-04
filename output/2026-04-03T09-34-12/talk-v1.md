# FOMO — AI Hot Topics Search Chrome Extension

## 1. Project Purpose and High-Level Architecture

FOMO is a Chrome browser extension that autonomously searches the internet for trending AI, LLM, Agent, and code-assistant-related open-source projects and academic papers. The name "FOMO" (Fear Of Missing Out) reflects its purpose: ensuring the user never misses important developments in the AI ecosystem.

The extension operates as an AI-powered web browsing agent. When the user clicks "Start," the extension takes control of the active browser tab and uses a large language model to decide which websites to visit, what links to click, and what content to extract. It navigates real web pages — Twitter/X profiles of AI thought leaders, GitHub Trending, ArXiv, Reddit, and Google Search — collecting up to twenty high-quality AI-related news items. The results are presented as downloadable JSON files.

The architecture follows a three-layer design. At the top is a popup UI that the user interacts with. In the middle is a background service worker that orchestrates everything. At the bottom is a browser automation layer that executes actions on real web pages. The LLM sits alongside the background layer, receiving page content and deciding the next action in a ReAct (Reasoning + Acting) loop.

## 2. Technology Stack and Build Setup

The project is written entirely in TypeScript, targeting ES2022. It uses Vite version 5 as the build tool, configured for a Chrome Extension Manifest V3 output rather than a traditional web application.

The only runtime dependency is the OpenAI npm package (version 4.28 or higher), which is repurposed to communicate with Alibaba Cloud's DashScope API (a Qwen model endpoint) by pointing the OpenAI client at a custom base URL. This is a common pattern: the DashScope API implements an OpenAI-compatible interface, so the standard OpenAI SDK works without modification.

Development dependencies include TypeScript version 5.3, Chrome extension type definitions, Node type definitions, and Vite itself.

The TypeScript configuration enables strict mode, uses bundler-style module resolution, and targets ES2022 with DOM library support. It includes Chrome, Vite client, and Node type declarations. The compiler is set to not emit files directly — Vite handles the actual compilation and bundling.

The build system has two entry points configured in Vite's Rollup options: the popup HTML page and the background service worker TypeScript file. The output structure is carefully organized so the background script lands at "background/index.js" (matching what the manifest declares), popup assets go into a "popup" subdirectory, and shared chunks go into a "chunks" directory.

A custom Vite plugin called "copy-manifest" runs after bundling. It copies the manifest.json file into the dist directory, copies the popup CSS file separately (since it exists as a standalone file rather than being imported by JavaScript), and copies all PNG and SVG icon files from the icons source directory into the dist icons directory. This ensures the final dist folder is a complete, loadable Chrome extension.

Environment variables are injected at build time through Vite's define mechanism. Three variables control the LLM connection: the API key, the base URL, and the model name. These are read from a dot-env-local file during development and baked into the compiled JavaScript as string literals. Source maps are enabled and minification is disabled to facilitate debugging.

The build can be run in watch mode for development (continuously rebuilding on file changes) or as a one-shot production build.

## 3. Directory Structure and File Naming Conventions

The project root is a directory called "fomo." All source code lives directly in this directory without a separate "src" folder.

At the top level sit the configuration files: package.json, tsconfig.json, vite.config.ts, and manifest.json. There is also a shared types file called types.ts that defines all interfaces used across the extension.

The "background" directory contains the service worker code, organized into three subdirectories. The "agent" subdirectory holds the AI agent logic: the executor that runs the ReAct loop, the prompt definitions, and the tool definitions. The "browser" subdirectory holds the browser automation code: a context manager and a page controller. The "llm" subdirectory holds the LLM client wrapper. The background directory also has its own index.ts that serves as the service worker entry point.

The "popup" directory contains the user interface: an HTML file, a CSS file, and a TypeScript file. All three share the same base name "popup" (or "index" for the HTML entry point).

An "icons" directory (referenced but not included in the source listing) holds extension icons at 16, 48, and 128 pixel sizes.

File naming follows a consistent convention: all files use lowercase with no separators. Each file represents a single module or concern. Index files serve as entry points for their respective directories.

## 4. Each Module's Responsibility and Interfaces

### Types Module (types.ts)

This is the shared contract layer. It defines seven key interfaces and types that all other modules reference.

The SearchResult interface describes a single discovered AI project or paper, carrying a name, source URL, optional product/GitHub/ArXiv URLs, an innovation point description, company name, trend indicator (High/Medium/Low), tags array, source platform name, and discovery timestamp.

The AgentState interface tracks the running state of the search agent: accumulated results, a set of visited URLs (for deduplication), current step counter, maximum allowed steps, target result count, and a completion flag.

The ExecutionLog and LogEntry interfaces define the structure for recording every action the agent takes — timestamped entries categorized as assistant messages, tool calls, tool responses, user messages, system events, or errors.

The StatusUpdate interface carries progress information from background to popup: current execution status (idle, running, paused, completed, or error), progress count, total target, optional current action description, and optional error message.

The MessageType union type enumerates all possible messages that can flow between the popup and background: start task (with tab ID), stop task, get status, download results, download logs, status update, task complete (with results), and error.

### Background Entry Point (background/index.ts)

This is the service worker's main file and acts as the message router and lifecycle manager. It maintains module-level state: the current executor instance, accumulated results, execution status, and execution log.

It exposes no public API in the traditional sense. Instead, it communicates exclusively through Chrome's runtime message passing. It listens for five message types from the popup and responds synchronously to each. For the start-task message, it kicks off an asynchronous task. For stop-task, it cancels the current executor. For get-status, it returns the current progress. For download-results and download-logs, it returns the cached data.

It also sends three types of unsolicited messages to the popup: status updates (during execution), task complete (with results), and error notifications. These sends are wrapped in catch blocks that silently swallow errors, because the popup may not be open when the background sends a message.

The module registers two additional Chrome event listeners: one for tab removal (to clean up browser automation state when a tab closes) and one for extension installation/update (for logging purposes only).

### Agent Executor (background/agent/executor.ts)

This is the brain of the extension — the ReAct loop implementation. It takes a target result count (defaulting to 20) and a maximum step count (defaulting to 100) as constructor parameters.

The executor maintains the conversation history as an array of chat completion messages, starting with a system prompt and an initial user message. It holds a reference to the tool executor for carrying out browser actions, and it tracks an execution log for debugging.

The main run method implements the agent loop. On each iteration, it sends the full conversation history (plus tool definitions) to the LLM and processes the response. If the LLM returns tool calls, it executes each one sequentially through the tool executor, appending both the assistant's message and each tool's result to the conversation history. If the LLM returns a plain text response without tool calls (indicated by a "stop" finish reason), the executor checks whether enough results have been collected. If not, it injects a user message urging the agent to continue searching. If the target is met, it marks the task as complete.

The executor implements conversation history compression: when the message array exceeds fifty entries, it preserves only the system message and the forty most recent messages, discarding older context.

Error handling within the loop is resilient. If any step throws an exception, the error is logged and injected as a user message telling the agent to try a different approach, and the loop continues.

The executor supports cancellation through a boolean flag checked at the top of each loop iteration and before each tool execution.

A callback mechanism allows the background entry point to receive status updates, which it forwards to the popup.

### Agent Prompts (background/agent/prompts.ts)

This module generates the system prompt and initial user message dynamically. Both are functions rather than static strings because they inject the current date into the text.

The system prompt instructs the LLM that it is an AI news search agent. It describes the goal (collect ten to twenty high-quality AI-related items), lists five search strategies (Twitter/X profiles of specific AI researchers like Karpathy, Andrew Ng, and Yann LeCun; GitHub Trending filtered by Python and TypeScript; Google Search with year-and-month-specific keywords; ArXiv recent papers in AI, computational linguistics, and machine learning categories; and Reddit communities like MachineLearning and LocalLLaMA). It describes each available tool in natural language and provides behavioral guidelines: save results immediately upon discovery, provide detailed information, avoid duplicates, handle page loading issues gracefully, switch strategies when sites are inaccessible, and call the finish tool after reaching twenty results.

The initial user message is more directive, telling the agent to begin immediately by navigating to Karpathy's X profile, stating the target of twenty non-duplicate items, and reminding it of today's date.

A legacy constant SYSTEM_PROMPT is exported for backward compatibility, assigned the return value of the dynamic generator function.

### Agent Tools (background/agent/tools.ts)

This module serves two purposes: it defines the tool schemas for the LLM and implements the tool execution logic.

The tool schema array follows the OpenAI function-calling format. Eleven tools are defined:

Navigate accepts a URL string and directs the browser to that page. Click accepts a CSS selector and clicks the matching element. Type-text accepts a selector and text string, fills in a form field. Press-key accepts a key name (like Enter or Tab) and simulates a keypress. Scroll accepts a direction (up or down) and scrolls the page. Get-page-content takes no arguments and returns the visible text of the current page. Get-links takes no arguments and returns all hyperlinks on the page. Wait accepts a number of seconds (clamped between one and ten) and pauses execution. Save-result accepts a rich set of fields describing a discovered project or paper. Get-status takes no arguments and returns the current collection progress. Finish accepts a reason string and terminates the search.

The ToolExecutor class receives a reference to the shared AgentState and dispatches tool calls to the appropriate handler. For browser-related tools, it delegates to the Page object obtained from the browser context. For the save-result tool, it constructs a SearchResult object, checks for duplicates (by name case-insensitive match, by source URL match, or by GitHub URL match), appends it to the state's results array, and checks whether the target count has been reached. For the finish tool, it sets the completion flag on the state.

Each tool execution returns a descriptive string message in Chinese that gets fed back to the LLM as the tool response.

### Browser Context (background/browser/context.ts)

This module manages the relationship between the extension and open browser tabs. It acts as a registry of attached pages and tracks which tab is currently active.

The context maintains a map from tab IDs to Page objects. When asked for the current page, it either returns an already-attached page or creates and attaches a new one. The switch-tab method activates the specified tab via the Chrome tabs API, creates a Page if needed, and updates the current tab ID.

The navigate-to method has a fallback path: if the current page isn't attached, it uses the Chrome tabs API to update the tab's URL directly, waits for the tab to finish loading (using a Chrome tabs onUpdated listener with a thirty-second timeout), and then creates a new Page for the loaded tab.

Cleanup detaches all pages and clears the registry. Individual pages can be removed when their tab closes.

The module exports a singleton accessor function that lazily creates a single BrowserContext instance.

### Browser Page (background/browser/page.ts)

This is the low-level browser automation layer. Each Page instance wraps a single Chrome tab ID and provides methods to interact with that tab's content.

Navigation is implemented by calling chrome.tabs.update with the new URL and then waiting for the tab's status to become "complete" via a Chrome tabs onUpdated listener. An additional half-second delay is added after the load event to allow dynamic content to render. A thirty-second timeout prevents indefinite waiting.

Page interaction methods (click, type, press-key, scroll) all work through chrome.scripting.executeScript, which injects JavaScript functions into the target tab's content context. The click method queries for an element by CSS selector and calls its click method. The type method focuses the element, sets its value directly, and dispatches both input and change events to trigger any framework-level reactivity. The press-key method creates and dispatches a KeyboardEvent on the active element, with special handling for Enter that also submits the containing form if one exists. The scroll method calls window.scrollBy with a fixed distance of 500 pixels.

Content extraction includes two methods. Get-page-text clones the document body, strips script, style, and noscript elements, walks the text nodes via a TreeWalker, concatenates all non-empty text content, and truncates to fifteen thousand characters. Get-links queries all anchor elements with href attributes and returns an array of text-href pairs, filtering out empty entries and truncating link text to one hundred characters.

A wait-for-selector utility polls the page every half second, checking for the existence of a CSS selector, with a configurable timeout defaulting to ten seconds.

All methods return descriptive strings (in Chinese) indicating success or failure, which are passed back to the LLM as tool results.

### LLM Client (background/llm/dashscope.ts)

This module wraps the OpenAI SDK to communicate with Alibaba Cloud's DashScope API. It reads three configuration values from Vite environment variables injected at build time: the API key, the base URL (defaulting to DashScope's OpenAI-compatible endpoint), and the model name (defaulting to "qwen-max").

The constructor validates that an API key is present, throwing an error with setup instructions if not. It creates an OpenAI client instance with the custom base URL and the "dangerously allow browser" flag set to true, which is necessary because the code runs in a Chrome extension's service worker (a browser context) rather than a Node.js server.

The chat method accepts a message array and optional tools array, sends them to the completions endpoint with tool_choice set to "auto" when tools are present, and returns the full completion response. A simpler complete method wraps single-prompt text generation.

The module exports a singleton accessor function for shared use across the extension.

### Popup UI (popup/index.html, popup.css, popup.ts)

The popup is the user-facing interface, designed as a compact 240-pixel-wide panel. The HTML structure contains a header with the "FOMO" logo and a colored status dot, a circular SVG progress ring showing collection progress as a fraction out of twenty, a text line displaying the current action, a row of four circular control buttons (start, stop, download results, download logs), and a conditionally-visible error message area.

The CSS uses custom properties for theming (white background, green accent, gray secondary, red danger, amber warning). The progress ring uses SVG stroke-dasharray animation to fill proportionally. The status dot has four visual states: gray for idle, pulsing green for running, solid green for completed, and red for error. Buttons are circular with icon-only design — play triangle for start, square for stop, download arrow for results, document icon for logs. Disabled buttons drop to thirty percent opacity.

The TypeScript module binds to all DOM elements on load. It communicates with the background through Chrome runtime messaging. Starting a task queries the active tab, validates it's not a chrome-internal page, sends a START_TASK message with the tab ID, and optimistically updates the UI to running state. Stopping sends STOP_TASK and resets to idle. The download-results handler creates a Blob from the cached results array, generates a timestamped filename, and triggers a Chrome downloads API save-as dialog. The download-logs handler requests the log from background and saves it similarly.

The popup listens for three incoming message types from the background: STATUS_UPDATE (updates progress ring and action text), TASK_COMPLETE (caches results, enables download buttons), and ERROR (shows the error message area). On initialization, it sends a GET_STATUS message to synchronize with any already-running task.

### Chrome Extension Manifest (manifest.json)

The manifest declares a Manifest V3 extension named "FOMO - AI热点搜索" (AI Hot Topics Search). It requests five permissions: tabs (to query and control tabs), scripting (to inject content scripts), storage (reserved for future use), downloads (to save result files), and activeTab (for current tab access). It declares host permissions for all URLs, allowing the content scripts to run on any website the agent needs to visit.

The background service worker is declared as a module-type JavaScript file at "background/index.js." The browser action (toolbar icon click) opens the popup at "popup/index.html."

## 5. Data Flow Between Modules

The flow begins when the user clicks the Start button in the popup. The popup queries the current active tab, validates it, and sends a START_TASK message with the tab ID to the background service worker.

The background entry point receives this message and initiates the task. It creates a BrowserContext, sets the current tab, attaches to the tab via the Page class, and constructs an AgentExecutor with the default target of twenty results and maximum of one hundred steps.

The AgentExecutor enters its main loop. It sends the conversation history to the DashScope LLM via the DashScopeClient. The LLM returns either a text response (thinking out loud) or one or more tool calls.

For tool calls, the AgentExecutor passes each to the ToolExecutor. Browser-related tools (navigate, click, type, scroll, get content, get links) are forwarded to the Page object, which executes them via Chrome's scripting API against the actual tab. The Page returns a text description of what happened. The ToolExecutor returns this to the AgentExecutor, which appends it to the conversation history for the LLM's next turn.

The save-result tool flows differently: the ToolExecutor constructs a SearchResult from the LLM's arguments, deduplicates it against existing results, and appends it to the shared AgentState. The result count is checked against the target.

Throughout execution, the AgentExecutor fires status callbacks. The background entry point receives these and forwards them as STATUS_UPDATE messages to the popup, which updates the progress ring and action text.

When the loop ends (target reached, max steps hit, agent calls finish, or user cancels), results flow back from AgentExecutor to the background entry point, which caches them and sends a TASK_COMPLETE message to the popup.

The user can then click the download button, which triggers the popup to create a JSON blob from the cached results and invoke the Chrome downloads API. The logs download follows the same pattern but requests the execution log from the background first.

## 6. Key Business Logic

### The ReAct Agent Loop

The core algorithm is a ReAct (Reason + Act) loop. The LLM receives the full conversation context including all previous observations and is free to choose any tool at each step. The system prompt guides it toward a multi-source search strategy but does not enforce a rigid order. The agent can reason about what it has found so far, decide which source to try next, navigate there, extract content, and save interesting findings.

The loop has three termination conditions: the target number of results is reached, the maximum number of steps is exhausted, or the user explicitly cancels. There is a fourth implicit condition: if the LLM stops generating tool calls (returns a plain text response), the executor checks the result count. If under target, it injects a nudge message asking the agent to continue. If at or above target, it ends.

### Duplicate Detection

When saving a result, three deduplication checks run: case-insensitive name match, exact source URL match, and exact GitHub URL match. Any match causes the save to be skipped with a notification back to the LLM.

### Conversation History Management

To prevent context window overflow, the executor compresses the conversation when it exceeds fifty messages. It preserves the system prompt (first message) and the most recent forty messages, discarding everything in between. This is a simple sliding window approach that may lose early context but keeps the agent responsive.

### Dynamic Date Injection

Both the system prompt and initial user message embed the current date dynamically. This ensures the LLM's search queries include the correct year and month, which is critical for finding genuinely recent content rather than outdated results. The system prompt includes both Chinese-formatted dates and English month names to support queries in both languages.

### Page Content Extraction

When the agent requests page content, the Page module performs aggressive cleanup: cloning the body to avoid side effects, stripping all script/style/noscript elements, walking only text nodes, and truncating to fifteen thousand characters. Link extraction is capped at fifty results to avoid overwhelming the LLM's context.

## 7. CLI Interface, Arguments, and Options

This is a Chrome extension, not a command-line tool, so there is no CLI interface in the traditional sense. However, the build system exposes npm scripts:

The "dev" script runs Vite in watch mode, continuously rebuilding the extension when source files change. The "build" script performs a single production build. The "preview" script starts a Vite preview server (though this is less useful for extensions than for web apps).

The extension itself is configured through environment variables in a dot-env-local file, not through command-line arguments. Three variables control the LLM connection: the API key (required, no default), the base URL (defaults to DashScope's endpoint), and the model name (defaults to "qwen-max").

The AgentExecutor accepts two parameters at construction time: target count (how many results to collect, default twenty) and max steps (the upper bound on LLM interaction rounds, default one hundred). These are currently hardcoded in the background entry point rather than being user-configurable.

## 8. Error Handling Strategy

Error handling follows a "keep going" philosophy appropriate for an autonomous agent.

At the agent loop level, any exception during a step is caught, logged to the execution log, and injected into the conversation as a user message telling the agent an error occurred and asking it to try a different approach. The loop continues to the next iteration. This allows the agent to recover from transient failures like network timeouts or inaccessible pages.

At the browser automation level, every Page method wraps its Chrome scripting calls in try-catch blocks and returns descriptive error strings rather than throwing. This means the tool executor always gets a string result it can pass back to the LLM, which can then reason about the failure and adapt.

At the communication level, all messages sent from the background to the popup are wrapped in catch blocks that silently ignore errors. This is because the popup may not be open (the user may have closed it), and there is no way to know in advance. The message simply fails silently with no side effects.

The LLM client throws immediately if no API key is configured, as this is an unrecoverable configuration error. All other LLM call failures propagate up to the agent loop's catch handler.

Tab navigation has a thirty-second timeout implemented via setTimeout in the page load waiter. If a page doesn't finish loading within thirty seconds, execution continues with whatever state the page is in.

The popup validates the active tab before starting a task, rejecting chrome-internal pages (those starting with "chrome://" or "chrome-extension://") since content scripts cannot be injected into these pages.

## 9. Configuration and Defaults

The extension's configuration is minimal and build-time only.

The LLM API key must be provided via the VITE_DASHSCOPE_API_KEY environment variable. There is no default — omitting it causes a runtime error with a descriptive message.

The LLM base URL defaults to "https://dashscope.aliyuncs.com/compatible-mode/v1" (Alibaba Cloud DashScope's OpenAI-compatible endpoint). It can be overridden via VITE_DASHSCOPE_BASE_URL to point at any OpenAI-compatible API.

The model name defaults to "qwen-max" (Alibaba's most capable Qwen model). It can be overridden via VITE_DASHSCOPE_MODEL.

The target result count is hardcoded to twenty. The maximum step count is hardcoded to one hundred. The progress ring total in the popup is also hardcoded to twenty.

The page content extraction truncation limit is fifteen thousand characters. Link extraction returns at most fifty links. The conversation history compression threshold is fifty messages, preserving the forty most recent.

The page load timeout is thirty seconds. The post-navigation settle delay is five hundred milliseconds. Scroll distance is five hundred pixels per scroll action. The wait tool clamps its input between one and ten seconds.

The popup width is fixed at 240 CSS pixels. The progress ring SVG has a radius of 52 units, yielding a circumference of approximately 327 units used for the dash-offset animation calculation.
[?25h