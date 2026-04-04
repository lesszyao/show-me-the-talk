import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AgentState, SearchResult, StatusUpdate, ExecutionLog, LogEntry } from '../../types';
import { getDashScopeClient } from '../llm/dashscope';
import { SYSTEM_PROMPT, INITIAL_USER_MESSAGE } from './prompts';
import { TOOL_DEFINITIONS, ToolExecutor } from './tools';

export class AgentExecutor {
  private state: AgentState;
  private messages: ChatCompletionMessageParam[];
  private toolExecutor: ToolExecutor;
  private executionLog: ExecutionLog;
  private cancelled: boolean = false;
  private onStatusUpdate: ((update: StatusUpdate) => void) | null = null;

  constructor(targetCount: number = 20, maxSteps: number = 100) {
    this.state = {
      results: [],
      visitedUrls: new Set(),
      currentStep: 0,
      maxSteps,
      targetCount,
      isComplete: false,
    };

    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: INITIAL_USER_MESSAGE },
    ];

    this.toolExecutor = new ToolExecutor(this.state);

    this.executionLog = {
      startTime: new Date().toISOString(),
      totalSteps: 0,
      resultCount: 0,
      entries: [],
    };

    this.addLog('system', 'Agent initialized');
    this.addLog('user', INITIAL_USER_MESSAGE);
  }

  setStatusCallback(callback: (update: StatusUpdate) => void): void {
    this.onStatusUpdate = callback;
  }

  async run(): Promise<SearchResult[]> {
    const client = getDashScopeClient();

    while (
      !this.state.isComplete &&
      !this.cancelled &&
      this.state.currentStep < this.state.maxSteps
    ) {
      this.state.currentStep++;

      try {
        // Step 1: Send messages to LLM
        const response = await client.chat(this.messages, TOOL_DEFINITIONS);

        // Step 2: Check response
        const choice = response.choices[0];
        if (!choice) {
          this.addLog('error', 'Empty response from LLM');
          continue;
        }

        const message = choice.message;

        // Step 3: Handle text content (thinking)
        if (message.content) {
          const preview = message.content.substring(0, 200);
          this.addLog('assistant', preview);

          const statusAction = message.content.substring(0, 100);
          this.emitStatus('running', statusAction);
        }

        // Step 4: Append assistant message to history
        this.messages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.tool_calls,
        } as ChatCompletionMessageParam);

        // Step 5: Execute tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, unknown> = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              toolArgs = {};
            }

            this.addLog('tool_call', {
              name: toolName,
              arguments: toolArgs,
            });

            const result = await this.toolExecutor.execute(toolName, toolArgs);

            const logResult =
              result.length > 5000 ? result.substring(0, 5000) + '...' : result;
            this.addLog('tool_response', {
              name: toolName,
              result: logResult,
            });

            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as ChatCompletionMessageParam);

            // Update progress after save_result
            if (toolName === 'save_result') {
              this.emitStatus('running');
            }
          }
        }

        // Step 6: Check if model stopped without tool calls
        if (
          choice.finish_reason === 'stop' &&
          (!message.tool_calls || message.tool_calls.length === 0)
        ) {
          if (this.state.results.length < this.state.targetCount) {
            this.messages.push({
              role: 'user',
              content: `You have only collected ${this.state.results.length}/${this.state.targetCount} results. Please continue searching using different sources or strategies. If you cannot find more results, call the finish tool and explain why.`,
            });
            this.addLog(
              'user',
              `Prompted to continue: ${this.state.results.length}/${this.state.targetCount}`
            );
          } else {
            this.state.isComplete = true;
          }
        }

        // Step 7: Compress message history if too long
        if (this.messages.length > 50) {
          const systemMessage = this.messages[0];
          const recentMessages = this.messages.slice(-40);
          this.messages = [systemMessage, ...recentMessages];
          this.addLog('system', 'Message history compressed');
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        this.addLog('error', errorMsg);

        this.messages.push({
          role: 'user',
          content: `An error occurred: ${errorMsg}. Please try a different approach and continue searching.`,
        });
      }
    }

    // Finalize
    this.executionLog.endTime = new Date().toISOString();
    this.executionLog.totalSteps = this.state.currentStep;
    this.executionLog.resultCount = this.state.results.length;

    return this.state.results;
  }

  cancel(): void {
    this.cancelled = true;
    this.state.isComplete = true;
  }

  getResults(): SearchResult[] {
    return this.state.results;
  }

  getExecutionLog(): ExecutionLog {
    return this.executionLog;
  }

  private emitStatus(status: 'running' | 'completed' | 'error', action?: string): void {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        status,
        progress: this.state.results.length,
        total: this.state.targetCount,
        action,
      });
    }
  }

  private addLog(
    type: LogEntry['type'],
    content: unknown
  ): void {
    this.executionLog.entries.push({
      timestamp: new Date().toISOString(),
      type,
      step: this.state.currentStep,
      content,
    });
  }
}
