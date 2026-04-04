import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AgentState, ExecutionLog, LogEntry, SearchResult } from '@/types';
import { getDashScopeClient } from '../llm/dashscope';
import { generateSystemPrompt, generateInitialUserMessage } from './prompts';
import { toolDefinitions, ToolExecutor } from './tools';

export class AgentExecutor {
  private state: AgentState;
  private messages: ChatCompletionMessageParam[];
  private toolExecutor: ToolExecutor;
  private cancelled: boolean = false;
  private log: ExecutionLog;
  private onStatusUpdate?: (data: {
    currentStep: number;
    resultCount: number;
    currentAction?: string;
  }) => void;

  constructor(targetCount: number = 20, maxSteps: number = 100) {
    this.state = {
      results: [],
      visitedUrls: new Set(),
      currentStep: 0,
      maxSteps: maxSteps,
      targetCount: targetCount,
      isComplete: false,
    };

    this.messages = [
      { role: 'system', content: generateSystemPrompt() },
      { role: 'user', content: generateInitialUserMessage() },
    ];

    this.toolExecutor = new ToolExecutor(this.state);

    this.log = {
      startTime: new Date().toISOString(),
      endTime: '',
      totalSteps: 0,
      resultCount: 0,
      entries: [],
    };
  }

  setStatusCallback(
    callback: (data: {
      currentStep: number;
      resultCount: number;
      currentAction?: string;
    }) => void
  ): void {
    this.onStatusUpdate = callback;
  }

  cancel(): void {
    this.cancelled = true;
  }

  getResults(): SearchResult[] {
    return this.state.results;
  }

  getLog(): ExecutionLog {
    return this.log;
  }

  private addLogEntry(type: LogEntry['type'], content: unknown): void {
    this.log.entries.push({
      timestamp: new Date().toISOString(),
      type,
      step: this.state.currentStep,
      content,
    });
  }

  private notifyStatus(currentAction?: string): void {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        currentStep: this.state.currentStep,
        resultCount: this.state.results.length,
        currentAction,
      });
    }
  }

  async run(): Promise<SearchResult[]> {
    const client = getDashScopeClient();

    this.addLogEntry('system', 'Agent execution started');
    this.notifyStatus('正在启动 AI 搜索引擎...');

    while (
      !this.state.isComplete &&
      !this.cancelled &&
      this.state.currentStep < this.state.maxSteps
    ) {
      this.state.currentStep++;

      try {
        // Call LLM
        const response = await client.chat(this.messages, toolDefinitions);

        const choice = response.choices[0];
        if (!choice) {
          console.log('[Executor] Empty response from LLM');
          this.addLogEntry('system', 'LLM returned empty response');
          continue;
        }

        const assistantMessage = choice.message;

        // Log assistant text content
        if (assistantMessage.content) {
          const preview = assistantMessage.content.substring(0, 100);
          this.addLogEntry('assistant', assistantMessage.content);
          this.notifyStatus(preview);
        }

        // Add assistant message to history
        this.messages.push({
          role: 'assistant',
          content: assistantMessage.content || null,
          tool_calls: assistantMessage.tool_calls,
        } as ChatCompletionMessageParam);

        // Process tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              toolArgs = {};
            }

            this.addLogEntry('tool_call', {
              name: toolName,
              arguments: toolArgs,
            });

            this.notifyStatus(`正在执行: ${toolName}`);

            // Execute tool
            const toolResult = await this.toolExecutor.execute(toolName, toolArgs);

            // Log tool response (truncate if too long)
            const logContent =
              toolResult.length > 5000
                ? toolResult.substring(0, 5000) + '...(truncated)'
                : toolResult;
            this.addLogEntry('tool_response', {
              name: toolName,
              result: logContent,
            });

            // Add tool result to message history
            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult,
            } as ChatCompletionMessageParam);
          }
        } else if (choice.finish_reason === 'stop') {
          // LLM stopped without tool calls
          if (this.state.results.length < this.state.targetCount) {
            // Not enough results, prompt to continue
            const continueMsg = `当前只收集了 ${this.state.results.length}/${this.state.targetCount} 条结果，还不够。请继续搜索其他来源，或者如果确实无法继续，请调用 finish 工具并说明原因。`;
            this.messages.push({
              role: 'user',
              content: continueMsg,
            });
            this.addLogEntry('user', continueMsg);
          } else {
            // Enough results, mark complete
            this.state.isComplete = true;
            this.addLogEntry('system', 'Target count reached, task complete');
          }
        }

        // Message history compression
        if (this.messages.length > 50) {
          const systemMessage = this.messages[0];
          const recentMessages = this.messages.slice(-40);
          this.messages = [systemMessage, ...recentMessages];
          this.addLogEntry('system', 'Message history compressed');
        }
      } catch (err) {
        const errorMsg = (err as Error).message || String(err);
        console.error('[Executor] Error in step:', errorMsg);
        this.addLogEntry('error', errorMsg);

        // Inject error as user message to let LLM try alternative approaches
        this.messages.push({
          role: 'user',
          content: `出现了错误: ${errorMsg}。请尝试其他方法继续搜索。`,
        });
      }

      this.notifyStatus();
    }

    // Finalize log
    this.log.endTime = new Date().toISOString();
    this.log.totalSteps = this.state.currentStep;
    this.log.resultCount = this.state.results.length;

    this.addLogEntry('system', `Execution finished. Steps: ${this.state.currentStep}, Results: ${this.state.results.length}`);

    return this.state.results;
  }
}
