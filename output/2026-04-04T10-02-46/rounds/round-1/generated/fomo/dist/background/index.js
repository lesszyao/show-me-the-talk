class Page {
  tabId;
  _attached = true;
  constructor(tabId) {
    this.tabId = tabId;
  }
  get attached() {
    return this._attached;
  }
  async attach() {
  }
  async detach() {
  }
  async navigate(url) {
    try {
      await chrome.tabs.update(this.tabId, { url });
      await this.waitForLoad();
      return `Navigated to ${url}`;
    } catch (error) {
      return `Navigation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async getInfo() {
    const tab = await chrome.tabs.get(this.tabId);
    return {
      url: tab.url || "",
      title: tab.title || ""
    };
  }
  async click(selector) {
    try {
      const results = await this.executeScript((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, selector);
      const found = results?.[0]?.result;
      if (!found) {
        return `Click failed: element not found for selector "${selector}"`;
      }
      await this.delay(500);
      return `Clicked element: ${selector}`;
    } catch (error) {
      return `Click failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async typeText(selector, text) {
    try {
      const results = await this.executeScript(
        (sel, txt) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.focus();
          el.value = txt;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        selector,
        text
      );
      const found = results?.[0]?.result;
      if (!found) {
        return `Type failed: element not found for selector "${selector}"`;
      }
      return `Typed "${text}" into ${selector}`;
    } catch (error) {
      return `Type failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async pressKey(key) {
    try {
      await this.executeScript((k) => {
        const event = new KeyboardEvent("keydown", {
          key: k,
          code: k,
          bubbles: true
        });
        const target = document.activeElement || document.body;
        target.dispatchEvent(event);
        if (k === "Enter") {
          const form = target.closest?.("form");
          if (form) {
            form.dispatchEvent(new Event("submit", { bubbles: true }));
          }
        }
        target.dispatchEvent(
          new KeyboardEvent("keyup", { key: k, code: k, bubbles: true })
        );
      }, key);
      await this.delay(500);
      return `Pressed key: ${key}`;
    } catch (error) {
      return `Key press failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async scroll(direction) {
    try {
      await this.executeScript((dir) => {
        const amount = dir === "up" ? -500 : 500;
        window.scrollBy(0, amount);
      }, direction);
      await this.delay(300);
      return `Scrolled ${direction}`;
    } catch (error) {
      return `Scroll failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async getPageContent() {
    try {
      const results = await this.executeScript(() => {
        const clone = document.body.cloneNode(true);
        const removeTags = ["script", "style", "noscript"];
        for (const tag of removeTags) {
          const elements = clone.querySelectorAll(tag);
          elements.forEach((el) => el.remove());
        }
        const walker = document.createTreeWalker(
          clone,
          NodeFilter.SHOW_TEXT,
          null
        );
        const texts = [];
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent?.trim();
          if (text) {
            texts.push(text);
          }
        }
        return texts.join(" ").substring(0, 15e3);
      });
      return results?.[0]?.result || "";
    } catch (error) {
      return `Get content failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  async getLinks() {
    try {
      const results = await this.executeScript(() => {
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        return anchors.map((a) => ({
          text: (a.textContent?.trim() || "").substring(0, 100),
          href: a.href
        })).filter((link) => link.href && link.text);
      });
      return results?.[0]?.result || [];
    } catch (error) {
      return [];
    }
  }
  async waitForSelector(selector, timeout = 1e4) {
    const interval = 500;
    const maxAttempts = Math.ceil(timeout / interval);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const results = await this.executeScript((sel) => {
          return !!document.querySelector(sel);
        }, selector);
        if (results?.[0]?.result) {
          return true;
        }
      } catch {
      }
      await this.delay(interval);
    }
    return false;
  }
  async executeScript(func, ...args) {
    return chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
      args
    });
  }
  async waitForLoad() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 3e4);
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === this.tabId && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class BrowserContext {
  currentTabId = null;
  pages = /* @__PURE__ */ new Map();
  setCurrentTab(tabId) {
    this.currentTabId = tabId;
  }
  getOrCreatePage(tabId) {
    let page = this.pages.get(tabId);
    if (!page) {
      page = new Page(tabId);
      this.pages.set(tabId, page);
    }
    return page;
  }
  async connectPage(tabId) {
    const existing = this.pages.get(tabId);
    if (existing) {
      return existing;
    }
    const page = new Page(tabId);
    await page.attach();
    this.pages.set(tabId, page);
    return page;
  }
  getCurrentPage() {
    if (this.currentTabId === null) {
      return null;
    }
    return this.pages.get(this.currentTabId) || null;
  }
  async getOrConnectCurrentPage() {
    if (this.currentTabId === null) {
      return null;
    }
    let page = this.pages.get(this.currentTabId);
    if (!page) {
      page = await this.connectPage(this.currentTabId);
    }
    return page;
  }
  async switchTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
    const page = this.getOrCreatePage(tabId);
    this.currentTabId = tabId;
    if (!this.pages.has(tabId)) {
      await page.attach();
      this.pages.set(tabId, page);
    }
    return page;
  }
  async navigate(url) {
    const page = this.getCurrentPage();
    if (page && page.attached) {
      return page.navigate(url);
    }
    if (this.currentTabId === null) {
      return "No active tab to navigate";
    }
    await chrome.tabs.update(this.currentTabId, { url });
    await this.waitForTabLoad(this.currentTabId);
    const newPage = new Page(this.currentTabId);
    await newPage.attach();
    this.pages.set(this.currentTabId, newPage);
    return `Navigated to ${url}`;
  }
  waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 3e4);
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  async cleanup() {
    for (const [, page] of this.pages) {
      await page.detach();
    }
    this.pages.clear();
    this.currentTabId = null;
  }
  removeConnectedPage(tabId) {
    const page = this.pages.get(tabId);
    if (page) {
      page.detach();
      this.pages.delete(tabId);
    }
    if (this.currentTabId === tabId) {
      this.currentTabId = null;
    }
  }
}
let instance$1 = null;
function getBrowserContext() {
  if (!instance$1) {
    instance$1 = new BrowserContext();
  }
  return instance$1;
}

class DashScopeClient {
  client;
  model;
  constructor() {
    {
      throw new Error(
        "DashScope API key is not set. Please set VITE_DASHSCOPE_API_KEY in your .env.local file."
      );
    }
  }
  async chat(messages, tools) {
    const params = {
      model: this.model,
      messages
    };
    if (tools && tools.length > 0) {
      params.tools = tools;
      params.tool_choice = "auto";
    }
    const response = await this.client.chat.completions.create(params);
    return response;
  }
  async complete(prompt) {
    const response = await this.chat([{ role: "user", content: prompt }]);
    return response.choices[0]?.message?.content || "";
  }
}
let instance = null;
function getDashScopeClient() {
  if (!instance) {
    instance = new DashScopeClient();
  }
  return instance;
}

function getDateInfo() {
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const monthName = monthNames[now.getMonth()];
  return { year, month, day, monthName };
}
function generateSystemPrompt() {
  const { year, month, day, monthName } = getDateInfo();
  return `You are a professional AI news and trends search agent. Your task is to browse the internet and collect the hottest, most trending AI-related open source projects and research papers.

Current date: ${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} (${monthName} ${day}, ${year})

## Goal
Collect 10 to 20 high-quality AI-related news items, including trending open source projects, research papers, and notable developments in AI, LLM, Agent, and coding assistant domains.

## Search Strategies (in recommended priority order)

1. **Twitter/X - AI Key Opinion Leaders**
   Visit profiles of influential AI researchers and developers:
   - @karpathy (Andrej Karpathy) - https://x.com/karpathy
   - @AndrewYNg (Andrew Ng) - https://x.com/AndrewYNg
   - @ylecun (Yann LeCun) - https://x.com/ylecun
   Look for links they share, projects they mention, and discussions about new tools/models.

2. **GitHub Trending**
   Visit https://github.com/trending to find trending repositories, especially in AI/ML categories.

3. **Google Search**
   Search for recent AI developments using queries like:
   - "latest AI open source projects ${year} ${monthName}"
   - "LLM agent github ${year} ${monthName}"
   - "trending AI tools ${year}"
   - "new machine learning framework ${year}"

4. **ArXiv Papers**
   Visit https://arxiv.org/list/cs.AI/recent for latest AI papers.
   Also check https://arxiv.org/list/cs.CL/recent (Computation and Language) and https://arxiv.org/list/cs.LG/recent (Machine Learning).

5. **Reddit Communities**
   Visit https://www.reddit.com/r/MachineLearning/ and https://www.reddit.com/r/LocalLLaMA/ for community discussions about new projects and papers.

## Available Tools

- **navigate**: Go to a specific URL to browse a website
- **click**: Click on an element on the page using a CSS selector
- **type_text**: Type text into an input field (for search boxes)
- **press_key**: Press a keyboard key (e.g., Enter to submit a search)
- **scroll**: Scroll the page up or down to see more content
- **get_page_content**: Get the text content of the current page
- **get_links**: Get all links on the current page
- **wait**: Wait for a specified number of seconds
- **save_result**: Save a discovered AI project or paper as a result. Provide as much detail as possible including name, URLs, innovation description, company/community, trend assessment, and tags.
- **get_status**: Check current search progress (how many results saved so far)
- **finish**: Mark the task as complete when you have collected enough results

## Important Notes

1. Save each discovery immediately using save_result - don't wait to batch them.
2. Provide detailed information for each result, especially the innovation/description field.
3. Avoid saving duplicate results - check status before saving if unsure.
4. If a page fails to load or a tool fails, try a different approach or website.
5. When you have collected enough results (at least 10, ideally 20), call the finish tool.
6. Focus on RECENT and TRENDING content, not old or well-established projects.
7. Include a mix of different sources for diversity.`;
}
function generateInitialUserMessage() {
  const { year, day, monthName } = getDateInfo();
  return `Start searching for the latest AI trending projects and papers. Today is ${monthName} ${day}, ${year}. Your goal is to collect 20 high-quality results.

Begin by visiting Andrej Karpathy's Twitter/X profile at https://x.com/karpathy to see what AI developments he has been discussing or sharing recently. Then continue with other sources.

Remember to save each interesting finding immediately using the save_result tool.`;
}
const SYSTEM_PROMPT = generateSystemPrompt();
const INITIAL_USER_MESSAGE = generateInitialUserMessage();

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate to a specific URL in the browser",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to navigate to" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click on an element on the page using a CSS selector",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to click" }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type text into an input field",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the input field" },
          text: { type: "string", description: "Text to type into the field" }
        },
        required: ["selector", "text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "Press a keyboard key (e.g., Enter, Tab, Escape)",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to press" }
        },
        required: ["key"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll",
      description: "Scroll the page up or down",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Direction to scroll"
          }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_page_content",
      description: "Get the text content of the current page",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_links",
      description: "Get all links on the current page",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "Wait for a specified number of seconds (1-10)",
      parameters: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            description: "Number of seconds to wait (1-10)",
            minimum: 1,
            maximum: 10
          }
        },
        required: ["seconds"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_result",
      description: "Save a discovered AI project or paper as a search result",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name/title of the project or paper" },
          sourceUrl: { type: "string", description: "URL where this was found" },
          productUrl: { type: "string", description: "Product/demo URL (optional)" },
          githubUrl: { type: "string", description: "GitHub repository URL (optional)" },
          arxivUrl: { type: "string", description: "ArXiv paper URL (optional)" },
          innovation: { type: "string", description: "Description of what makes this notable/innovative" },
          company: { type: "string", description: "Company or community behind this" },
          trend: { type: "string", description: "Trend assessment (e.g., High, Medium, Rising)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags/categories (e.g., LLM, Agent, Vision, Code)"
          },
          source: { type: "string", description: "Source platform name (e.g., Twitter, GitHub, ArXiv)" }
        },
        required: ["name", "sourceUrl", "innovation", "source"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_status",
      description: "Get current search progress and saved results count",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Mark the search task as complete",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Reason for finishing" }
        },
        required: ["reason"]
      }
    }
  }
];
class ToolExecutor {
  state;
  constructor(state) {
    this.state = state;
  }
  async execute(toolName, args) {
    switch (toolName) {
      case "navigate": {
        const ctx = getBrowserContext();
        return ctx.navigate(args.url);
      }
      case "click": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        return page.click(args.selector);
      }
      case "type_text": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        return page.typeText(
          args.selector,
          args.text
        );
      }
      case "press_key": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        return page.pressKey(args.key);
      }
      case "scroll": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        return page.scroll(args.direction);
      }
      case "get_page_content": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        const info = await page.getInfo();
        const content = await page.getPageContent();
        const truncated = content.substring(0, 8e3);
        return `Page title: ${info.title}
URL: ${info.url}

Content:
${truncated}`;
      }
      case "get_links": {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return "Error: No active page connected";
        const links = await page.getLinks();
        const limited = links.slice(0, 50);
        return limited.map((l, i) => `${i + 1}. [${l.text}](${l.href})`).join("\n");
      }
      case "wait": {
        const seconds = Math.min(10, Math.max(1, Number(args.seconds) || 1));
        await new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
        return `Waited ${seconds} seconds`;
      }
      case "save_result": {
        const result = {
          name: args.name,
          sourceUrl: args.sourceUrl,
          productUrl: args.productUrl || void 0,
          githubUrl: args.githubUrl || void 0,
          arxivUrl: args.arxivUrl || void 0,
          innovation: args.innovation,
          company: args.company || "Community",
          trend: args.trend || "Medium",
          tags: args.tags || ["AI"],
          source: args.source,
          discoveredAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        const isDuplicate = this.state.results.some(
          (r) => r.name.toLowerCase() === result.name.toLowerCase() || r.sourceUrl === result.sourceUrl || result.githubUrl && r.githubUrl === result.githubUrl
        );
        if (isDuplicate) {
          return `Skipped duplicate: "${result.name}" already saved or has matching URL`;
        }
        this.state.results.push(result);
        if (this.state.results.length >= this.state.targetCount) {
          this.state.isComplete = true;
        }
        return `Saved result #${this.state.results.length}: "${result.name}" (${this.state.results.length}/${this.state.targetCount})`;
      }
      case "get_status": {
        const saved = this.state.results;
        const lines = [
          `Progress: ${saved.length}/${this.state.targetCount} results collected`,
          `Current step: ${this.state.currentStep}/${this.state.maxSteps}`,
          "",
          "Saved items:",
          ...saved.map((r, i) => `  ${i + 1}. ${r.name} (${r.source})`)
        ];
        return lines.join("\n");
      }
      case "finish": {
        this.state.isComplete = true;
        return `Task finished. Reason: ${args.reason}. Total results: ${this.state.results.length}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  }
}

class AgentExecutor {
  state;
  messages;
  toolExecutor;
  executionLog;
  cancelled = false;
  onStatusUpdate = null;
  constructor(targetCount = 20, maxSteps = 100) {
    this.state = {
      results: [],
      visitedUrls: /* @__PURE__ */ new Set(),
      currentStep: 0,
      maxSteps,
      targetCount,
      isComplete: false
    };
    this.messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: INITIAL_USER_MESSAGE }
    ];
    this.toolExecutor = new ToolExecutor(this.state);
    this.executionLog = {
      startTime: (/* @__PURE__ */ new Date()).toISOString(),
      totalSteps: 0,
      resultCount: 0,
      entries: []
    };
    this.addLog("system", "Agent initialized");
    this.addLog("user", INITIAL_USER_MESSAGE);
  }
  setStatusCallback(callback) {
    this.onStatusUpdate = callback;
  }
  async run() {
    const client = getDashScopeClient();
    while (!this.state.isComplete && !this.cancelled && this.state.currentStep < this.state.maxSteps) {
      this.state.currentStep++;
      try {
        const response = await client.chat(this.messages, TOOL_DEFINITIONS);
        const choice = response.choices[0];
        if (!choice) {
          this.addLog("error", "Empty response from LLM");
          continue;
        }
        const message = choice.message;
        if (message.content) {
          const preview = message.content.substring(0, 200);
          this.addLog("assistant", preview);
          const statusAction = message.content.substring(0, 100);
          this.emitStatus("running", statusAction);
        }
        this.messages.push({
          role: "assistant",
          content: message.content || null,
          tool_calls: message.tool_calls
        });
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
              toolArgs = {};
            }
            this.addLog("tool_call", {
              name: toolName,
              arguments: toolArgs
            });
            const result = await this.toolExecutor.execute(toolName, toolArgs);
            const logResult = result.length > 5e3 ? result.substring(0, 5e3) + "..." : result;
            this.addLog("tool_response", {
              name: toolName,
              result: logResult
            });
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: result
            });
            if (toolName === "save_result") {
              this.emitStatus("running");
            }
          }
        }
        if (choice.finish_reason === "stop" && (!message.tool_calls || message.tool_calls.length === 0)) {
          if (this.state.results.length < this.state.targetCount) {
            this.messages.push({
              role: "user",
              content: `You have only collected ${this.state.results.length}/${this.state.targetCount} results. Please continue searching using different sources or strategies. If you cannot find more results, call the finish tool and explain why.`
            });
            this.addLog(
              "user",
              `Prompted to continue: ${this.state.results.length}/${this.state.targetCount}`
            );
          } else {
            this.state.isComplete = true;
          }
        }
        if (this.messages.length > 50) {
          const systemMessage = this.messages[0];
          const recentMessages = this.messages.slice(-40);
          this.messages = [systemMessage, ...recentMessages];
          this.addLog("system", "Message history compressed");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addLog("error", errorMsg);
        this.messages.push({
          role: "user",
          content: `An error occurred: ${errorMsg}. Please try a different approach and continue searching.`
        });
      }
    }
    this.executionLog.endTime = (/* @__PURE__ */ new Date()).toISOString();
    this.executionLog.totalSteps = this.state.currentStep;
    this.executionLog.resultCount = this.state.results.length;
    return this.state.results;
  }
  cancel() {
    this.cancelled = true;
    this.state.isComplete = true;
  }
  getResults() {
    return this.state.results;
  }
  getExecutionLog() {
    return this.executionLog;
  }
  emitStatus(status, action) {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        status,
        progress: this.state.results.length,
        total: this.state.targetCount,
        action
      });
    }
  }
  addLog(type, content) {
    this.executionLog.entries.push({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      type,
      step: this.state.currentStep,
      content
    });
  }
}

let executor = null;
let currentResults = [];
let currentStatus = "idle";
let currentLog = null;
function sendToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
  });
}
function onStatusUpdate(update) {
  currentStatus = update.status;
  sendToPopup({ type: "STATUS_UPDATE", ...update });
}
async function startTask(tabId) {
  if (executor) {
    sendToPopup({
      type: "ERROR",
      error: "A task is already running"
    });
    return;
  }
  currentStatus = "running";
  currentResults = [];
  try {
    const ctx = getBrowserContext();
    ctx.setCurrentTab(tabId);
    await ctx.connectPage(tabId);
    executor = new AgentExecutor(20, 100);
    executor.setStatusCallback(onStatusUpdate);
    sendToPopup({
      type: "STATUS_UPDATE",
      status: "running",
      progress: 0,
      total: 20,
      action: "Starting search agent..."
    });
    const results = await executor.run();
    currentResults = results;
    currentLog = executor.getExecutionLog();
    currentStatus = "completed";
    sendToPopup({
      type: "TASK_COMPLETE",
      results
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    currentStatus = "error";
    sendToPopup({
      type: "ERROR",
      error: errorMsg
    });
  } finally {
    if (executor) {
      currentLog = executor.getExecutionLog();
    }
    await getBrowserContext().cleanup();
    executor = null;
  }
}
function stopTask() {
  if (executor) {
    executor.cancel();
    currentLog = executor.getExecutionLog();
  }
  currentStatus = "idle";
  getBrowserContext().cleanup();
  executor = null;
}
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    const type = message.type;
    switch (type) {
      case "START_TASK": {
        const tabId = message.tabId;
        startTask(tabId);
        sendResponse({ success: true });
        break;
      }
      case "STOP_TASK": {
        stopTask();
        sendResponse({ success: true });
        break;
      }
      case "GET_STATUS": {
        const statusUpdate = {
          status: currentStatus,
          progress: currentResults.length,
          total: 20
        };
        if (executor) {
          statusUpdate.progress = executor.getResults().length;
        }
        sendResponse(statusUpdate);
        break;
      }
      case "DOWNLOAD_RESULTS": {
        sendResponse({ results: currentResults });
        break;
      }
      case "DOWNLOAD_LOGS": {
        sendResponse({ log: currentLog });
        break;
      }
      default:
        sendResponse({ error: "Unknown message type" });
    }
    return true;
  }
);
chrome.tabs.onRemoved.addListener((tabId) => {
  getBrowserContext().removeConnectedPage(tabId);
});
chrome.runtime.onInstalled.addListener((details) => {
  console.log("FOMO extension installed/updated:", details.reason);
});
//# sourceMappingURL=index.js.map
