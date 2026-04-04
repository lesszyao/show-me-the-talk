import { PageController } from './page';

class BrowserContext {
  private currentTabId: number | null = null;
  private pages: Map<number, PageController> = new Map();

  setCurrentTabId(tabId: number): void {
    this.currentTabId = tabId;
  }

  getCurrentTabId(): number | null {
    return this.currentTabId;
  }

  private getOrCreatePage(tabId: number): PageController {
    let page = this.pages.get(tabId);
    if (!page) {
      page = new PageController(tabId);
      this.pages.set(tabId, page);
    }
    return page;
  }

  async attachPage(tabId: number): Promise<void> {
    const page = this.getOrCreatePage(tabId);
    await page.attach();
    this.pages.set(tabId, page);
  }

  getCurrentPage(): PageController | null {
    if (!this.currentTabId) return null;

    let page = this.pages.get(this.currentTabId);
    if (!page) {
      page = new PageController(this.currentTabId);
      this.pages.set(this.currentTabId, page);
    }
    return page;
  }

  async switchTab(tabId: number): Promise<PageController> {
    await chrome.tabs.update(tabId, { active: true });
    this.currentTabId = tabId;
    return this.getOrCreatePage(tabId);
  }

  async navigate(url: string): Promise<void> {
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

  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab load timeout (30s)'));
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async cleanup(): Promise<void> {
    for (const [, page] of this.pages) {
      try {
        await page.detach();
      } catch {
        // Ignore detach errors
      }
    }
    this.pages.clear();
    this.currentTabId = null;
  }

  removePage(tabId: number): void {
    const page = this.pages.get(tabId);
    if (page) {
      try {
        page.detach();
      } catch {
        // Ignore
      }
      this.pages.delete(tabId);
    }
    if (this.currentTabId === tabId) {
      this.currentTabId = null;
    }
  }
}

let instance: BrowserContext | null = null;

export function getBrowserContext(): BrowserContext {
  if (!instance) {
    instance = new BrowserContext();
  }
  return instance;
}
