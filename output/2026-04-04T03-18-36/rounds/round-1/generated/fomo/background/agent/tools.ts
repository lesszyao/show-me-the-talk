import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AgentState, SearchResult } from '@/types';
import { getBrowserContext } from '../browser/context';

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: '导航到指定的网页URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要访问的网页URL' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: '点击页面上指定CSS选择器的元素',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: '在指定输入框中输入文字',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '输入框的CSS选择器' },
          text: { type: 'string', description: '要输入的文字' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: '模拟键盘按键',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '按键名称，如 Enter, Tab, Escape 等' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: '滚动页面',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: '滚动方向：up（向上）或 down（向下）',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_content',
      description: '获取当前页面的文本内容',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_links',
      description: '获取当前页面上的所有链接',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: '等待指定秒数（1-10秒）',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: '等待秒数，1到10之间',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_result',
      description: '保存发现的AI资讯',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目/论文名称' },
          infoUrl: { type: 'string', description: '信息来源URL' },
          productUrl: { type: 'string', description: '产品URL（可选）' },
          githubUrl: { type: 'string', description: 'GitHub链接（可选）' },
          arxivUrl: { type: 'string', description: 'ArXiv链接（可选）' },
          innovation: { type: 'string', description: '创新点描述' },
          company: { type: 'string', description: '所属公司或社区名称' },
          trend: {
            type: 'string',
            enum: ['High', 'Medium', 'Low'],
            description: '热度趋势',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表',
          },
          source: { type: 'string', description: '来源平台名称' },
        },
        required: ['name', 'infoUrl', 'innovation', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: '查询当前搜索进度',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '标记搜索任务完成',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '完成原因' },
        },
        required: ['reason'],
      },
    },
  },
];

export class ToolExecutor {
  private state: AgentState;

  constructor(state: AgentState) {
    this.state = state;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    switch (toolName) {
      case 'navigate':
        return this.navigate(args.url as string);
      case 'click':
        return this.click(args.selector as string);
      case 'type_text':
        return this.typeText(args.selector as string, args.text as string);
      case 'press_key':
        return this.pressKey(args.key as string);
      case 'scroll':
        return this.scroll(args.direction as 'up' | 'down');
      case 'get_page_content':
        return this.getPageContent();
      case 'get_links':
        return this.getLinks();
      case 'wait':
        return this.wait(args.seconds as number);
      case 'save_result':
        return this.saveResult(args);
      case 'get_status':
        return this.getStatus();
      case 'finish':
        return this.finish(args.reason as string);
      default:
        return `未知工具: ${toolName}。可用工具: navigate, click, type_text, press_key, scroll, get_page_content, get_links, wait, save_result, get_status, finish`;
    }
  }

  private async navigate(url: string): Promise<string> {
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
      return `导航失败: ${(err as Error).message}`;
    }
  }

  private async click(selector: string): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      return await page.click(selector);
    } catch (err) {
      return `点击失败: ${(err as Error).message}`;
    }
  }

  private async typeText(selector: string, text: string): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      return await page.typeText(selector, text);
    } catch (err) {
      return `输入失败: ${(err as Error).message}`;
    }
  }

  private async pressKey(key: string): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      return await page.pressKey(key);
    } catch (err) {
      return `按键失败: ${(err as Error).message}`;
    }
  }

  private async scroll(direction: 'up' | 'down'): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      return await page.scroll(direction);
    } catch (err) {
      return `滚动失败: ${(err as Error).message}`;
    }
  }

  private async getPageContent(): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      const content = await page.getPageContent();
      const url = await page.getCurrentUrl();
      const title = await page.getTitle();

      const truncated = content.substring(0, 8000);
      return `当前页面: ${title}\nURL: ${url}\n\n${truncated}`;
    } catch (err) {
      return `获取内容失败: ${(err as Error).message}`;
    }
  }

  private async getLinks(): Promise<string> {
    const context = getBrowserContext();
    const page = context.getCurrentPage();
    if (!page) return '错误: 页面未连接';

    try {
      const links = await page.getLinks();
      const limited = links.slice(0, 50);
      const formatted = limited
        .map((link) => `${link.text}: ${link.href}`)
        .join('\n');
      return `页面链接（共${links.length}个，显示前${limited.length}个）:\n${formatted}`;
    } catch (err) {
      return `获取链接失败: ${(err as Error).message}`;
    }
  }

  private async wait(seconds: number): Promise<string> {
    const clamped = Math.min(10, Math.max(1, seconds || 1));
    await new Promise((resolve) => setTimeout(resolve, clamped * 1000));
    return `已等待 ${clamped} 秒`;
  }

  private saveResult(args: Record<string, unknown>): string {
    const result: SearchResult = {
      name: args.name as string,
      infoUrl: args.infoUrl as string,
      productUrl: (args.productUrl as string) || undefined,
      githubUrl: (args.githubUrl as string) || undefined,
      arxivUrl: (args.arxivUrl as string) || undefined,
      innovation: args.innovation as string,
      company: (args.company as string) || 'Community',
      trend: (args.trend as SearchResult['trend']) || 'Medium',
      tags: (args.tags as string[]) || ['AI'],
      source: (args.source as string) || 'Unknown',
      discoveredAt: new Date().toISOString(),
    };

    // Deduplication check
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

  private getStatus(): string {
    const resultList = this.state.results
      .map((r, i) => `  ${i + 1}. ${r.name} (${r.source})`)
      .join('\n');

    return `搜索进度:
- 已保存: ${this.state.results.length}/${this.state.targetCount}
- 当前步骤: ${this.state.currentStep}/${this.state.maxSteps}
- 是否完成: ${this.state.isComplete ? '是' : '否'}

已保存的项目:
${resultList || '（暂无）'}`;
  }

  private finish(reason: string): string {
    this.state.isComplete = true;
    return `任务已完成。原因: ${reason}。共保存 ${this.state.results.length} 条结果。`;
  }
}
