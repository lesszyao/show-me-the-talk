import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AgentState, SearchResult } from '../../types';
import { getBrowserContext } from '../browser/context';

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a specific URL in the browser',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an element on the page using a CSS selector',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input field' },
          text: { type: 'string', description: 'Text to type into the field' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key (e.g., Enter, Tab, Escape)',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key to press' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up or down',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'Direction to scroll',
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
      description: 'Get the text content of the current page',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_links',
      description: 'Get all links on the current page',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a specified number of seconds (1-10)',
      parameters: {
        type: 'object',
        properties: {
          seconds: {
            type: 'number',
            description: 'Number of seconds to wait (1-10)',
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
      description: 'Save a discovered AI project or paper as a search result',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name/title of the project or paper' },
          sourceUrl: { type: 'string', description: 'URL where this was found' },
          productUrl: { type: 'string', description: 'Product/demo URL (optional)' },
          githubUrl: { type: 'string', description: 'GitHub repository URL (optional)' },
          arxivUrl: { type: 'string', description: 'ArXiv paper URL (optional)' },
          innovation: { type: 'string', description: 'Description of what makes this notable/innovative' },
          company: { type: 'string', description: 'Company or community behind this' },
          trend: { type: 'string', description: 'Trend assessment (e.g., High, Medium, Rising)' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags/categories (e.g., LLM, Agent, Vision, Code)',
          },
          source: { type: 'string', description: 'Source platform name (e.g., Twitter, GitHub, ArXiv)' },
        },
        required: ['name', 'sourceUrl', 'innovation', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Get current search progress and saved results count',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Mark the search task as complete',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Reason for finishing' },
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
      case 'navigate': {
        const ctx = getBrowserContext();
        return ctx.navigate(args.url as string);
      }

      case 'click': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        return page.click(args.selector as string);
      }

      case 'type_text': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        return page.typeText(
          args.selector as string,
          args.text as string
        );
      }

      case 'press_key': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        return page.pressKey(args.key as string);
      }

      case 'scroll': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        return page.scroll(args.direction as 'up' | 'down');
      }

      case 'get_page_content': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        const info = await page.getInfo();
        const content = await page.getPageContent();
        const truncated = content.substring(0, 8000);
        return `Page title: ${info.title}\nURL: ${info.url}\n\nContent:\n${truncated}`;
      }

      case 'get_links': {
        const ctx = getBrowserContext();
        const page = await ctx.getOrConnectCurrentPage();
        if (!page) return 'Error: No active page connected';
        const links = await page.getLinks();
        const limited = links.slice(0, 50);
        return limited
          .map((l, i) => `${i + 1}. [${l.text}](${l.href})`)
          .join('\n');
      }

      case 'wait': {
        const seconds = Math.min(10, Math.max(1, Number(args.seconds) || 1));
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return `Waited ${seconds} seconds`;
      }

      case 'save_result': {
        const result: SearchResult = {
          name: args.name as string,
          sourceUrl: args.sourceUrl as string,
          productUrl: (args.productUrl as string) || undefined,
          githubUrl: (args.githubUrl as string) || undefined,
          arxivUrl: (args.arxivUrl as string) || undefined,
          innovation: args.innovation as string,
          company: (args.company as string) || 'Community',
          trend: (args.trend as string) || 'Medium',
          tags: (args.tags as string[]) || ['AI'],
          source: args.source as string,
          discoveredAt: new Date().toISOString(),
        };

        // Deduplication check
        const isDuplicate = this.state.results.some(
          (r) =>
            r.name.toLowerCase() === result.name.toLowerCase() ||
            r.sourceUrl === result.sourceUrl ||
            (result.githubUrl && r.githubUrl === result.githubUrl)
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

      case 'get_status': {
        const saved = this.state.results;
        const lines = [
          `Progress: ${saved.length}/${this.state.targetCount} results collected`,
          `Current step: ${this.state.currentStep}/${this.state.maxSteps}`,
          '',
          'Saved items:',
          ...saved.map((r, i) => `  ${i + 1}. ${r.name} (${r.source})`),
        ];
        return lines.join('\n');
      }

      case 'finish': {
        this.state.isComplete = true;
        return `Task finished. Reason: ${args.reason}. Total results: ${this.state.results.length}`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  }
}
