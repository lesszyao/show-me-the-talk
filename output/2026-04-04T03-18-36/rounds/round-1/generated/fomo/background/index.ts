import type { Message, SearchResult, ExecutionLog } from '@/types';
import { ExecutionStatus } from '@/types';
import { AgentExecutor } from './agent/executor';
import { getBrowserContext } from './browser/context';

let currentExecutor: AgentExecutor | null = null;
let currentResults: SearchResult[] = [];
let currentStatus: ExecutionStatus = ExecutionStatus.IDLE;
let currentLog: ExecutionLog | null = null;

function sendStatusUpdate(data: {
  currentStep: number;
  resultCount: number;
  currentAction?: string;
}): void {
  chrome.runtime
    .sendMessage({
      type: 'STATUS_UPDATE',
      status: ExecutionStatus.RUNNING,
      currentStep: data.currentStep,
      resultCount: data.resultCount,
      currentAction: data.currentAction,
    } as Message)
    .catch(() => {
      // Popup may be closed
    });
}

function sendTaskCompleted(results: SearchResult[]): void {
  chrome.runtime
    .sendMessage({
      type: 'TASK_COMPLETED',
      results,
    } as Message)
    .catch(() => {
      // Popup may be closed
    });
}

function sendError(error: string): void {
  chrome.runtime
    .sendMessage({
      type: 'ERROR',
      error,
    } as Message)
    .catch(() => {
      // Popup may be closed
    });
}

async function startTask(tabId: number): Promise<void> {
  if (currentExecutor) {
    return; // Already running
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
    const errorMsg = (err as Error).message || String(err);
    console.error('[Background] Task error:', errorMsg);
    currentStatus = ExecutionStatus.ERROR;
    currentLog = currentExecutor?.getLog() || null;
    sendError(errorMsg);
  } finally {
    await context.cleanup();
    currentExecutor = null;
  }
}

function stopTask(): void {
  if (currentExecutor) {
    currentExecutor.cancel();
    currentLog = currentExecutor.getLog();
    currentExecutor = null;
  }
  currentStatus = ExecutionStatus.IDLE;
  getBrowserContext().cleanup();
}

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    switch (message.type) {
      case 'START_TASK':
        startTask(message.tabId);
        sendResponse({ success: true });
        break;

      case 'STOP_TASK':
        stopTask();
        sendResponse({ success: true });
        break;

      case 'GET_STATUS':
        sendResponse({
          status: currentStatus,
          currentStep: currentExecutor
            ? currentExecutor.getResults().length
            : currentResults.length,
          resultCount: currentResults.length,
          results: currentResults,
          hasLogs: currentLog !== null,
        });
        break;

      case 'DOWNLOAD_RESULTS':
        sendResponse({ results: currentResults });
        break;

      case 'DOWNLOAD_LOGS':
        sendResponse({ logs: currentLog });
        break;

      default:
        sendResponse({ error: '未知消息类型' });
        break;
    }

    return true; // Keep message channel open for async responses
  }
);

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId: number) => {
  getBrowserContext().removePage(tabId);
});

// Log on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FOMO] Extension installed/updated:', details.reason);
});
