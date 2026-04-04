export class PageController {
  private tabId: number;
  public attached: boolean = true;

  constructor(tabId: number) {
    this.tabId = tabId;
  }

  async attach(): Promise<void> {
    // Chrome scripting API does not require explicit attach
    return;
  }

  async detach(): Promise<void> {
    // No-op for scripting API
  }

  async navigate(url: string): Promise<void> {
    await chrome.tabs.update(this.tabId, { url });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Page load timeout (30s)'));
      }, 30000);

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === this.tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });

    // Extra wait for rendering stability
    await new Promise((r) => setTimeout(r, 500));
  }

  private async executeScript<T>(func: () => T): Promise<T | null>;
  private async executeScript<T, A extends unknown[]>(
    func: (...args: A) => T,
    args: A
  ): Promise<T | null>;
  private async executeScript<T>(
    func: (...args: unknown[]) => T,
    args?: unknown[]
  ): Promise<T | null> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        func,
        args: args || [],
      });
      return results[0]?.result as T;
    } catch (err) {
      console.log('[PageController] executeScript error:', err);
      return null;
    }
  }

  async click(selector: string): Promise<string> {
    const result = await this.executeScript(
      (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return `未找到元素: ${sel}`;
        (el as HTMLElement).click();
        return 'ok';
      },
      [selector]
    );

    await new Promise((r) => setTimeout(r, 500));
    return result || '脚本执行失败';
  }

  async typeText(selector: string, text: string): Promise<string> {
    const result = await this.executeScript(
      (sel: string, txt: string) => {
        const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
        if (!el) return `未找到元素: ${sel}`;
        el.focus();
        el.value = txt;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      },
      [selector, text]
    );

    return result || '脚本执行失败';
  }

  async pressKey(key: string): Promise<string> {
    const result = await this.executeScript(
      (k: string) => {
        const el = document.activeElement || document.body;
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: k, bubbles: true })
        );

        if (k === 'Enter') {
          const form = (el as HTMLElement).closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
          }
        }

        return 'ok';
      },
      [key]
    );

    await new Promise((r) => setTimeout(r, 500));
    return result || '脚本执行失败';
  }

  async scroll(direction: 'up' | 'down'): Promise<string> {
    const result = await this.executeScript(
      (dir: string) => {
        const distance = dir === 'down' ? 500 : -500;
        window.scrollBy({ top: distance, behavior: 'smooth' });
        return 'ok';
      },
      [direction]
    );

    await new Promise((r) => setTimeout(r, 300));
    return result || '脚本执行失败';
  }

  async getPageContent(): Promise<string> {
    const result = await this.executeScript(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;

      const removeTags = ['script', 'style', 'noscript'];
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

      const texts: string[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || '').trim();
        if (text) {
          texts.push(text);
        }
      }

      return texts.join(' ').substring(0, 15000);
    });

    return result || '';
  }

  async getLinks(): Promise<Array<{ text: string; href: string }>> {
    try {
      const result = await this.executeScript(() => {
        const links = document.querySelectorAll('a[href]');
        const items: Array<{ text: string; href: string }> = [];

        links.forEach((link) => {
          const text = (link.textContent || '').trim().substring(0, 100);
          const href = (link as HTMLAnchorElement).href;
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

  async waitForSelector(selector: string, timeout: number = 10000): Promise<boolean> {
    const interval = 500;
    let elapsed = 0;

    while (elapsed < timeout) {
      const found = await this.executeScript(
        (sel: string) => !!document.querySelector(sel),
        [selector]
      );

      if (found) return true;

      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }

    return false;
  }

  async getCurrentUrl(): Promise<string> {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.url || '';
    } catch {
      return '';
    }
  }

  async getTitle(): Promise<string> {
    try {
      const tab = await chrome.tabs.get(this.tabId);
      return tab.title || '';
    } catch {
      return '';
    }
  }
}
