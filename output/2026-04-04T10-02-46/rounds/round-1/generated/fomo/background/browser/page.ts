export class Page {
  private tabId: number;
  private _attached: boolean = true;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  get attached(): boolean {
    return this._attached;
  }

  async attach(): Promise<void> {
    // No-op: using Chrome scripting API, not CDP
  }

  async detach(): Promise<void> {
    // No-op: using Chrome scripting API, not CDP
  }

  async navigate(url: string): Promise<string> {
    try {
      await chrome.tabs.update(this.tabId, { url });
      await this.waitForLoad();
      return `Navigated to ${url}`;
    } catch (error) {
      return `Navigation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async getInfo(): Promise<{ url: string; title: string }> {
    const tab = await chrome.tabs.get(this.tabId);
    return {
      url: tab.url || '',
      title: tab.title || '',
    };
  }

  async click(selector: string): Promise<string> {
    try {
      const results = await this.executeScript((sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        (el as HTMLElement).click();
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

  async typeText(selector: string, text: string): Promise<string> {
    try {
      const results = await this.executeScript(
        (sel: string, txt: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!el) return false;
          el.focus();
          el.value = txt;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
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

  async pressKey(key: string): Promise<string> {
    try {
      await this.executeScript((k: string) => {
        const event = new KeyboardEvent('keydown', {
          key: k,
          code: k,
          bubbles: true,
        });
        const target = document.activeElement || document.body;
        target.dispatchEvent(event);

        if (k === 'Enter') {
          const form = (target as HTMLElement).closest?.('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
          }
        }

        target.dispatchEvent(
          new KeyboardEvent('keyup', { key: k, code: k, bubbles: true })
        );
      }, key);

      await this.delay(500);
      return `Pressed key: ${key}`;
    } catch (error) {
      return `Key press failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async scroll(direction: 'up' | 'down'): Promise<string> {
    try {
      await this.executeScript((dir: string) => {
        const amount = dir === 'up' ? -500 : 500;
        window.scrollBy(0, amount);
      }, direction);

      await this.delay(300);
      return `Scrolled ${direction}`;
    } catch (error) {
      return `Scroll failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async getPageContent(): Promise<string> {
    try {
      const results = await this.executeScript(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        const removeTags = ['script', 'style', 'noscript'];
        for (const tag of removeTags) {
          const elements = clone.querySelectorAll(tag);
          elements.forEach((el) => el.remove());
        }

        const walker = document.createTreeWalker(
          clone,
          NodeFilter.SHOW_TEXT,
          null
        );

        const texts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent?.trim();
          if (text) {
            texts.push(text);
          }
        }

        return texts.join(' ').substring(0, 15000);
      });

      return results?.[0]?.result || '';
    } catch (error) {
      return `Get content failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async getLinks(): Promise<Array<{ text: string; href: string }>> {
    try {
      const results = await this.executeScript(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        return anchors
          .map((a) => ({
            text: (a.textContent?.trim() || '').substring(0, 100),
            href: (a as HTMLAnchorElement).href,
          }))
          .filter((link) => link.href && link.text);
      });

      return results?.[0]?.result || [];
    } catch (error) {
      return [];
    }
  }

  async waitForSelector(
    selector: string,
    timeout: number = 10000
  ): Promise<boolean> {
    const interval = 500;
    const maxAttempts = Math.ceil(timeout / interval);

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const results = await this.executeScript((sel: string) => {
          return !!document.querySelector(sel);
        }, selector);

        if (results?.[0]?.result) {
          return true;
        }
      } catch {
        // Continue polling
      }

      await this.delay(interval);
    }

    return false;
  }

  private async executeScript(func: (...args: any[]) => any, ...args: any[]) {
    return chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func,
      args,
    });
  }

  private async waitForLoad(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === this.tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 500);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
