var ExecutionStatus = /* @__PURE__ */ ((ExecutionStatus2) => {
  ExecutionStatus2["IDLE"] = "idle";
  ExecutionStatus2["RUNNING"] = "running";
  ExecutionStatus2["PAUSED"] = "paused";
  ExecutionStatus2["COMPLETED"] = "completed";
  ExecutionStatus2["ERROR"] = "error";
  return ExecutionStatus2;
})(ExecutionStatus || {});

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
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: tools && tools.length > 0 ? tools : void 0,
      tool_choice: tools && tools.length > 0 ? "auto" : void 0
    });
    return response;
  }
  async complete(prompt) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }]
    });
    return response.choices[0]?.message?.content || "";
  }
}
let instance$1 = null;
function getDashScopeClient() {
  if (!instance$1) {
    instance$1 = new DashScopeClient();
  }
  return instance$1;
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
  const zhDate = `${year}年${month}月${day}日`;
  const enMonth = monthNames[now.getMonth()];
  return { year, month, day, zhDate, enMonth };
}
function generateSystemPrompt() {
  const { year, month, zhDate, enMonth } = getDateInfo();
  return `你是一个专业的 AI 资讯搜索 Agent。

当前日期：${zhDate}（${enMonth} ${year}）

你的目标是收集 10 到 20 条高质量的 AI 相关资讯，包括：
1. 热门开源项目（AI/LLM/Agent/代码助手等）
2. 重要学术论文
3. AI 领域意见领袖的推荐

## 搜索策略（按优先级排列）

### 策略1：Twitter/X（优先）
访问以下 AI 领域大咖的主页：
- Andrej Karpathy: https://x.com/kaborthy
- Andrew Ng: https://x.com/AndrewYNg
- Yann LeCun: https://x.com/ylecun

建议搜索话题标签：#AI #LLM #OpenSource #MachineLearning #DeepLearning #GPT #Agent

### 策略2：GitHub Trending
- https://github.com/trending?since=daily
- https://github.com/trending/python?since=daily
- https://github.com/trending/typescript?since=daily
重点关注 LLM、Agent、ML 相关项目

### 策略3：Google 搜索
建议搜索关键词：
- "best AI open source projects ${enMonth} ${year}"
- "trending LLM projects ${year}"
- "AI agent framework ${enMonth} ${year}"
- "latest AI research papers ${year}"
- "top machine learning projects ${month}/${year}"

### 策略4：ArXiv
- https://arxiv.org/list/cs.AI/recent
- https://arxiv.org/list/cs.CL/recent
- https://arxiv.org/list/cs.LG/recent

### 策略5：Reddit
- https://www.reddit.com/r/MachineLearning/hot/
- https://www.reddit.com/r/LocalLLaMA/hot/

## 可用工具
1. navigate(url) - 导航到指定网页
2. click(selector) - 点击页面元素
3. type_text(selector, text) - 在输入框中输入文字
4. press_key(key) - 模拟键盘按键
5. scroll(direction) - 滚动页面（up/down）
6. get_page_content() - 获取页面文本内容
7. get_links() - 获取页面所有链接
8. wait(seconds) - 等待页面加载
9. save_result(...) - 保存发现的资讯
10. get_status() - 查询当前搜索进度
11. finish(reason) - 标记任务完成

## 注意事项
1. 发现有价值的资讯后立即使用 save_result 保存
2. 尽可能提供详细的信息（GitHub链接、创新点描述等）
3. 避免保存重复的结果
4. 如果页面加载有问题，使用 wait 等待或重新导航
5. 如果某个网站无法访问，切换到其他搜索策略
6. 当收集到 20 条结果后，调用 finish 工具完成任务`;
}
generateSystemPrompt();
function generateInitialUserMessage() {
  const { zhDate } = getDateInfo();
  return `请立即开始搜索最新的 AI 热点资讯。从访问 Andrej Karpathy 的 Twitter 主页开始：https://x.com/karpathy

目标：收集 20 条不重复的高质量 AI 资讯（开源项目、论文、工具等）。
当前日期：${zhDate}

开始搜索吧！`;
}

class PageController {
  tabId;
  attached = true;
  constructor(tabId) {
    this.tabId = tabId;
  }
  async attach() {
    return;
  }
  async detach() {
  }
  async navigate(url) {
    await chrome.tabs.update(this.tabId, { url });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Page load timeout (30s)"));
      }, 3e4);
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === this.tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  async executeScript(func, args) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        func,
        args: args || []
      });
      return results[0]?.result;
    } catch (err) {
      console.log("[PageController] executeScript error:", err);
      return null;
    }
  }
  async click(selector) {
    const result = await this.executeScript(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return `未找到元素: ${sel}`;
        el.click();
        return "ok";
      },
      [selector]
    );
    await new Promise((r) => setTimeout(r, 500));
    return result || "脚本执行失败";
  }
  async typeText(selector, text) {
    const result = await this.executeScript(
      (sel, txt) => {
        const el = document.querySelector(sel);
        if (!el) return `未找到元素: ${sel}`;
        el.focus();
        el.value = txt;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return "ok";
      },
      [selector, text]
    );
    return result || "脚本执行失败";
  }
  async pressKey(key) {
    const result = await this.executeScript(
      (k) => {
        const el = document.activeElement || document.body;
        el.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, bubbles: true })
        );
        if (k === "Enter") {
          const form = el.closest("form");
          if (form) {
            form.dispatchEvent(new Event("submit", { bubbles: true }));
          }
        }
        return "ok";
      },
      [key]
    );
    await new Promise((r) => setTimeout(r, 500));
    return result || "脚本执行失败";
  }
  async scroll(direction) {
    const result = await this.executeScript(
      (dir) => {
        const distance = dir === "down" ? 500 : -500;
        window.scrollBy({ top: distance, behavior: "smooth" });
        return "ok";
      },
      [direction]
    );
    await new Promise((r) => setTimeout(r, 300));
    return result || "脚本执行失败";
  }
  async getPageContent() {
    const result = await this.executeScript(() => {
      const clone = document.body.cloneNode(true);
      const removeTags = ["script", "style", "noscript"];
      for (const tag of removeTags) {
        const elements = clone.getElementsByTagName(tag);
        while (elements.length > 0) {
          elements[0].remove();
        }
      }
      const walker = document.createTreeWalker(
        clone,
        NodeFilter.SHOW_TEXT,
        null
      );
      const texts = [];
      let node;
      while (node = walker.nextNode()) {
        const text = (node.textContent || "").trim();
        if (text) {
          texts.push(text);
        }
      }
      return texts.join(" ").substring(0, 15e3);
    });
    return result || "";
  }
  async getLinks() {
    try {
      const result = await this.executeScript(() => {
        const links = document.querySelectorAll("a[href]");
        const items = [];
        links.forEach((link) => {
          const text = (link.textContent || "").trim().substring(0, 100);
          const href = link.href;
          if (text && href) {
            items.push({ text, href });
          }
        });
        return items;
      });
      return result || [];
    } catch {
      return [];
    }
  }
  async waitForSelector(selector, timeout = 1e4) {
    const interval = 500;
    let elapsed = 0;
    while (elapsed < timeout) {
      const found = await this.executeScript(
        (sel) => !!document.querySelector(sel),
        [selector]
      );
      if (found) return true;
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }
    return false;
  }
  async getCurrentUrl() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.url || "";
    } catch {
      return "";
    }
  }
  async getTitle() {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.title || "";
    } catch {
      return "";
    }
  }
}

class BrowserContext {
  currentTabId = null;
  pages = /* @__PURE__ */ new Map();
  setCurrentTabId(tabId) {
    this.currentTabId = tabId;
  }
  getCurrentTabId() {
    return this.currentTabId;
  }
  getOrCreatePage(tabId) {
    let page = this.pages.get(tabId);
    if (!page) {
      page = new PageController(tabId);
      this.pages.set(tabId, page);
    }
    return page;
  }
  async attachPage(tabId) {
    const page = this.getOrCreatePage(tabId);
    await page.attach();
    this.pages.set(tabId, page);
  }
  getCurrentPage() {
    if (!this.currentTabId) return null;
    let page = this.pages.get(this.currentTabId);
    if (!page) {
      page = new PageController(this.currentTabId);
      this.pages.set(this.currentTabId, page);
    }
    return page;
  }
  async switchTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
    this.currentTabId = tabId;
    return this.getOrCreatePage(tabId);
  }
  async navigate(url) {
    const page = this.getCurrentPage();
    if (page) {
      await page.navigate(url);
      return;
    }
    if (this.currentTabId) {
      await chrome.tabs.update(this.currentTabId, { url });
      await this.waitForTabLoad(this.currentTabId);
      const newPage = new PageController(this.currentTabId);
      await newPage.attach();
      this.pages.set(this.currentTabId, newPage);
    }
  }
  waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab load timeout (30s)"));
      }, 3e4);
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  async cleanup() {
    for (const [, page] of this.pages) {
      try {
        await page.detach();
      } catch {
      }
    }
    this.pages.clear();
    this.currentTabId = null;
  }
  removePage(tabId) {
    const page = this.pages.get(tabId);
    if (page) {
      try {
        page.detach();
      } catch {
      }
      this.pages.delete(tabId);
    }
    if (this.currentTabId === tabId) {
      this.currentTabId = null;
    }
  }
}
let instance = null;
function getBrowserContext() {
  if (!instance) {
    instance = new BrowserContext();
  }
  return instance;
}

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "导航到指定的网页URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要访问的网页URL" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "点击页面上指定CSS选择器的元素",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS选择器" }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "在指定输入框中输入文字",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "输入框的CSS选择器" },
          text: { type: "string", description: "要输入的文字" }
        },
        required: ["selector", "text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "模拟键盘按键",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "按键名称，如 Enter, Tab, Escape 等" }
        },
        required: ["key"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll",
      description: "滚动页面",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "滚动方向：up（向上）或 down（向下）"
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
      description: "获取当前页面的文本内容",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_links",
      description: "获取当前页面上的所有链接",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait",
      description: "等待指定秒数（1-10秒）",
      parameters: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            description: "等待秒数，1到10之间",
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
      description: "保存发现的AI资讯",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "项目/论文名称" },
          infoUrl: { type: "string", description: "信息来源URL" },
          productUrl: { type: "string", description: "产品URL（可选）" },
          githubUrl: { type: "string", description: "GitHub链接（可选）" },
          arxivUrl: { type: "string", description: "ArXiv链接（可选）" },
          innovation: { type: "string", description: "创新点描述" },
          company: { type: "string", description: "所属公司或社区名称" },
          trend: {
            type: "string",
            enum: ["High", "Medium", "Low"],
            description: "热度趋势"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表"
          },
          source: { type: "string", description: "来源平台名称" }
        },
        required: ["name", "infoUrl", "innovation", "source"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_status",
      description: "查询当前搜索进度",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "标记搜索任务完成",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "完成原因" }
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
      case "navigate":
        return this.navigate(args.url);
      case "click":
        return this.click(args.selector);
      case "type_text":
        return this.typeText(args.selector, args.text);
      case "press_key":
        return this.pressKey(args.key);
      case "scroll":
        return this.scroll(args.direction);
      case "get_page_content":
        return this.getPageContent();
      case "get_links":
        return this.getLinks();
      case "wait":
        return this.wait(args.seconds);
      case "save_result":
        return this.saveResult(args);
      case "get_status":
        return this.getStatus();
      case "finish":
        return this.finish(args.reason);
      default:
        return `未知工具: ${toolName}。可用工具: navigate, click, type_text, press_key, scroll, get_page_content, get_links, wait, save_result, get_status, finish`;
    }
  }
  async navigate(url) {
    try {
      const context = getBrowserContext();
      const page = context.getCurrentPage();
      if (page) {
        await page.navigate(url);
      } else {
        await context.navigate(url);
      }
      this.state.visitedUrls.add(url);
      return `已导航到: ${url}`;
    } catch (err) {
      return `导航失败: ${err.message}`;
    }
  }
  async click(selector) {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      return await page.click(selector);
    } catch (err) {
      return `点击失败: ${err.message}`;
    }
  }
  async typeText(selector, text) {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      return await page.typeText(selector, text);
    } catch (err) {
      return `输入失败: ${err.message}`;
    }
  }
  async pressKey(key) {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      return await page.pressKey(key);
    } catch (err) {
      return `按键失败: ${err.message}`;
    }
  }
  async scroll(direction) {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      return await page.scroll(direction);
    } catch (err) {
      return `滚动失败: ${err.message}`;
    }
  }
  async getPageContent() {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      const content = await page.getPageContent();
      const url = await page.getCurrentUrl();
      const title = await page.getTitle();
      const truncated = content.substring(0, 8e3);
      return `当前页面: ${title}
URL: ${url}

${truncated}`;
    } catch (err) {
      return `获取内容失败: ${err.message}`;
    }
  }
  async getLinks() {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return "错误: 页面未连接";
    try {
      const links = await page.getLinks();
      const limited = links.slice(0, 50);
      const formatted = limited.map((link) => `${link.text}: ${link.href}`).join("\n");
      return `页面链接（共${links.length}个，显示前${limited.length}个）:
${formatted}`;
    } catch (err) {
      return `获取链接失败: ${err.message}`;
    }
  }
  async wait(seconds) {
    const clamped = Math.min(10, Math.max(1, seconds || 1));
    await new Promise((resolve) => setTimeout(resolve, clamped * 1e3));
    return `已等待 ${clamped} 秒`;
  }
  saveResult(args) {
    const result = {
      name: args.name,
      infoUrl: args.infoUrl,
      productUrl: args.productUrl || void 0,
      githubUrl: args.githubUrl || void 0,
      arxivUrl: args.arxivUrl || void 0,
      innovation: args.innovation,
      company: args.company || "Community",
      trend: args.trend || "Medium",
      tags: args.tags || ["AI"],
      source: args.source || "Unknown",
      discoveredAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const isDuplicate = this.state.results.some((existing) => {
      if (existing.name.toLowerCase() === result.name.toLowerCase()) return true;
      if (result.infoUrl && existing.infoUrl === result.infoUrl) return true;
      if (result.githubUrl && existing.githubUrl === result.githubUrl) return true;
      return false;
    });
    if (isDuplicate) {
      return `跳过重复结果: ${result.name}`;
    }
    this.state.results.push(result);
    if (this.state.results.length >= this.state.targetCount) {
      this.state.isComplete = true;
      return `已保存: ${result.name}（共 ${this.state.results.length}/${this.state.targetCount}）。已达到目标数量，任务完成！`;
    }
    return `已保存: ${result.name}（共 ${this.state.results.length}/${this.state.targetCount}）`;
  }
  getStatus() {
    const resultList = this.state.results.map((r, i) => `  ${i + 1}. ${r.name} (${r.source})`).join("\n");
    return `搜索进度:
- 已保存: ${this.state.results.length}/${this.state.targetCount}
- 当前步骤: ${this.state.currentStep}/${this.state.maxSteps}
- 是否完成: ${this.state.isComplete ? "是" : "否"}

已保存的项目:
${resultList || "（暂无）"}`;
  }
  finish(reason) {
    this.state.isComplete = true;
    return `任务已完成。原因: ${reason}。共保存 ${this.state.results.length} 条结果。`;
  }
}

class AgentExecutor {
  state;
  messages;
  toolExecutor;
  cancelled = false;
  log;
  onStatusUpdate;
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
      { role: "system", content: generateSystemPrompt() },
      { role: "user", content: generateInitialUserMessage() }
    ];
    this.toolExecutor = new ToolExecutor(this.state);
    this.log = {
      startTime: (/* @__PURE__ */ new Date()).toISOString(),
      endTime: "",
      totalSteps: 0,
      resultCount: 0,
      entries: []
    };
  }
  setStatusCallback(callback) {
    this.onStatusUpdate = callback;
  }
  cancel() {
    this.cancelled = true;
  }
  getResults() {
    return this.state.results;
  }
  getLog() {
    return this.log;
  }
  addLogEntry(type, content) {
    this.log.entries.push({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      type,
      step: this.state.currentStep,
      content
    });
  }
  notifyStatus(currentAction) {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        currentStep: this.state.currentStep,
        resultCount: this.state.results.length,
        currentAction
      });
    }
  }
  async run() {
    const client = getDashScopeClient();
    this.addLogEntry("system", "Agent execution started");
    this.notifyStatus("正在启动 AI 搜索引擎...");
    while (!this.state.isComplete && !this.cancelled && this.state.currentStep < this.state.maxSteps) {
      this.state.currentStep++;
      try {
        const response = await client.chat(this.messages, toolDefinitions);
        const choice = response.choices[0];
        if (!choice) {
          console.log("[Executor] Empty response from LLM");
          this.addLogEntry("system", "LLM returned empty response");
          continue;
        }
        const assistantMessage = choice.message;
        if (assistantMessage.content) {
          const preview = assistantMessage.content.substring(0, 100);
          this.addLogEntry("assistant", assistantMessage.content);
          this.notifyStatus(preview);
        }
        this.messages.push({
          role: "assistant",
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls
        });
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs = {};
            try {
              toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
              toolArgs = {};
            }
            this.addLogEntry("tool_call", {
              name: toolName,
              arguments: toolArgs
            });
            this.notifyStatus(`正在执行: ${toolName}`);
            const toolResult = await this.toolExecutor.execute(toolName, toolArgs);
            const logContent = toolResult.length > 5e3 ? toolResult.substring(0, 5e3) + "...(truncated)" : toolResult;
            this.addLogEntry("tool_response", {
              name: toolName,
              result: logContent
            });
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: toolResult
            });
          }
        } else if (choice.finish_reason === "stop") {
          if (this.state.results.length < this.state.targetCount) {
            const continueMsg = `当前只收集了 ${this.state.results.length}/${this.state.targetCount} 条结果，还不够。请继续搜索其他来源，或者如果确实无法继续，请调用 finish 工具并说明原因。`;
            this.messages.push({
              role: "user",
              content: continueMsg
            });
            this.addLogEntry("user", continueMsg);
          } else {
            this.state.isComplete = true;
            this.addLogEntry("system", "Target count reached, task complete");
          }
        }
        if (this.messages.length > 50) {
          const systemMessage = this.messages[0];
          const recentMessages = this.messages.slice(-40);
          this.messages = [systemMessage, ...recentMessages];
          this.addLogEntry("system", "Message history compressed");
        }
      } catch (err) {
        const errorMsg = err.message || String(err);
        console.error("[Executor] Error in step:", errorMsg);
        this.addLogEntry("error", errorMsg);
        this.messages.push({
          role: "user",
          content: `出现了错误: ${errorMsg}。请尝试其他方法继续搜索。`
        });
      }
      this.notifyStatus();
    }
    this.log.endTime = (/* @__PURE__ */ new Date()).toISOString();
    this.log.totalSteps = this.state.currentStep;
    this.log.resultCount = this.state.results.length;
    this.addLogEntry("system", `Execution finished. Steps: ${this.state.currentStep}, Results: ${this.state.results.length}`);
    return this.state.results;
  }
}

let currentExecutor = null;
let currentResults = [];
let currentStatus = ExecutionStatus.IDLE;
let currentLog = null;
function sendStatusUpdate(data) {
  chrome.runtime.sendMessage({
    type: "STATUS_UPDATE",
    status: ExecutionStatus.RUNNING,
    currentStep: data.currentStep,
    resultCount: data.resultCount,
    currentAction: data.currentAction
  }).catch(() => {
  });
}
function sendTaskCompleted(results) {
  chrome.runtime.sendMessage({
    type: "TASK_COMPLETED",
    results
  }).catch(() => {
  });
}
function sendError(error) {
  chrome.runtime.sendMessage({
    type: "ERROR",
    error
  }).catch(() => {
  });
}
async function startTask(tabId) {
  if (currentExecutor) {
    return;
  }
  const context = getBrowserContext();
  try {
    currentStatus = ExecutionStatus.RUNNING;
    context.setCurrentTabId(tabId);
    await context.attachPage(tabId);
    currentExecutor = new AgentExecutor(20, 100);
    currentExecutor.setStatusCallback((data) => {
      currentResults = currentExecutor?.getResults() || [];
      sendStatusUpdate(data);
    });
    const results = await currentExecutor.run();
    currentResults = results;
    currentLog = currentExecutor.getLog();
    currentStatus = ExecutionStatus.COMPLETED;
    sendTaskCompleted(results);
  } catch (err) {
    const errorMsg = err.message || String(err);
    console.error("[Background] Task error:", errorMsg);
    currentStatus = ExecutionStatus.ERROR;
    currentLog = currentExecutor?.getLog() || null;
    sendError(errorMsg);
  } finally {
    await context.cleanup();
    currentExecutor = null;
  }
}
function stopTask() {
  if (currentExecutor) {
    currentExecutor.cancel();
    currentLog = currentExecutor.getLog();
    currentExecutor = null;
  }
  currentStatus = ExecutionStatus.IDLE;
  getBrowserContext().cleanup();
}
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    switch (message.type) {
      case "START_TASK":
        startTask(message.tabId);
        sendResponse({ success: true });
        break;
      case "STOP_TASK":
        stopTask();
        sendResponse({ success: true });
        break;
      case "GET_STATUS":
        sendResponse({
          status: currentStatus,
          currentStep: currentExecutor ? currentExecutor.getResults().length : currentResults.length,
          resultCount: currentResults.length,
          results: currentResults,
          hasLogs: currentLog !== null
        });
        break;
      case "DOWNLOAD_RESULTS":
        sendResponse({ results: currentResults });
        break;
      case "DOWNLOAD_LOGS":
        sendResponse({ logs: currentLog });
        break;
      default:
        sendResponse({ error: "未知消息类型" });
        break;
    }
    return true;
  }
);
chrome.tabs.onRemoved.addListener((tabId) => {
  getBrowserContext().removePage(tabId);
});
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[FOMO] Extension installed/updated:", details.reason);
});
//# sourceMappingURL=index.js.map
