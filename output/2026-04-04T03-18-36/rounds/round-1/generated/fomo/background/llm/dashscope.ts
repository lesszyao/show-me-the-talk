import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

const API_KEY = import.meta.env.VITE_DASHSCOPE_API_KEY as string;
const BASE_URL = (import.meta.env.VITE_DASHSCOPE_BASE_URL as string) || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = (import.meta.env.VITE_DASHSCOPE_MODEL as string) || 'qwen-max';

class DashScopeClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (!API_KEY) {
      throw new Error(
        'DashScope API key is not set. Please set VITE_DASHSCOPE_API_KEY in your .env.local file.'
      );
    }

    this.client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      dangerouslyAllowBrowser: true,
    });

    this.model = MODEL;
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    tools?: ChatCompletionTool[]
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    });

    return response;
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0]?.message?.content || '';
  }
}

let instance: DashScopeClient | null = null;

export function getDashScopeClient(): DashScopeClient {
  if (!instance) {
    instance = new DashScopeClient();
  }
  return instance;
}
