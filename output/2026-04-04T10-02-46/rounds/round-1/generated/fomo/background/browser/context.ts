import { Page } from './page';

export class BrowserContext {
  private currentTabId: number | null = null;
  private pages: Map<number, Page> = new Map();

  setCurrentTab(tabId: number): void {
    this.currentTabId = tabId;
  }

  getOrCreatePage(tabId: number): Page {
    let page = this.pages.get(tabId);
    if (!page) {
      page = new Page(tabId);
      this.pages.set(tabId, page);
    }
    return page;
  }

  async connectPage(tabId: number): Promise<Page> {
    const existing = this.pages.get(tabId);
    if (existing) {
      return existing;
    }

    const page = new Page(tabId);
    await page.attach();
    this.pages.set(tabId, page);
    return page;
  }

  getCurrentPage(): Page | null {
    if (this.currentTabId === null) {
      return null;
    }
    return this.pages.get(this.currentTabId) || null;
  }

  async getOrConnectCurrentPage(): Promise<Page | null> {
    if (this.currentTabId === null) {
      return null;
    }

    let page = this.pages.get(this.currentTabId);
    if (!page) {
      page = await this.connectPage(this.currentTabId);
    }
    return page;
  }

  async switchTab(tabId: number): Promise<Page> {
    await chrome.tabs.update(tabId, { active: true });
    const page = this.getOrCreatePage(tabId);
    this.currentTabId = tabId;
    if (!this.pages.has(tabId)) {
      await page.attach();
      this.pages.set(tabId, page);
    }
    return page;
  }

  async navigate(url: string): Promise<string> {
    const page = this.getCurrentPage();
    if (page && page.attached) {
      return page.navigate(url);
    }

    if (this.currentTabId === null) {
      return 'No active tab to navigate';
    }

    await chrome.tabs.update(this.currentTabId, { url });
    await this.waitForTabLoad(this.currentTabId);

    const newPage = new Page(this.currentTabId);
    await newPage.attach();
    this.pages.set(this.currentTabId, newPage);
    return `Navigated to ${url}`;
  }

  private waitForTabLoad(tabId: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async cleanup(): Promise<void> {
    for (const [, page] of this.pages) {
      await page.detach();
    }
    this.pages.clear();
    this.currentTabId = null;
  }

  removeConnectedPage(tabId: number): void {
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

let instance: BrowserContext | null = null;

export function getBrowserContext(): BrowserContext {
  if (!instance) {
    instance = new BrowserContext();
  }
  return instance;
}
