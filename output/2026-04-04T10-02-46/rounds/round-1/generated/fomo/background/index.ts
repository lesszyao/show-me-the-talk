import type { ExecutionStatus, SearchResult, StatusUpdate, ExecutionLog } from '../types';
import { getBrowserContext } from './browser/context';
import { AgentExecutor } from './agent/executor';

let executor: AgentExecutor | null = null;
let currentResults: SearchResult[] = [];
let currentStatus: ExecutionStatus = 'idle';
let currentLog: ExecutionLog | null = null;

function sendToPopup(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup may not be open — ignore
  });
}

function onStatusUpdate(update: StatusUpdate): void {
  currentStatus = update.status;
  sendToPopup({ type: 'STATUS_UPDATE', ...update });
}

async function startTask(tabId: number): Promise<void> {
  if (executor) {
    sendToPopup({
      type: 'ERROR',
      error: 'A task is already running',
    });
    return;
  }

  currentStatus = 'running';
  currentResults = [];

  try {
    const ctx = getBrowserContext();
    ctx.setCurrentTab(tabId);
    await ctx.connectPage(tabId);

    executor = new AgentExecutor(20, 100);
    executor.setStatusCallback(onStatusUpdate);

    sendToPopup({
      type: 'STATUS_UPDATE',
      status: 'running',
      progress: 0,
      total: 20,
      action: 'Starting search agent...',
    });

    const results = await executor.run();
    currentResults = results;
    currentLog = executor.getExecutionLog();
    currentStatus = 'completed';

    sendToPopup({
      type: 'TASK_COMPLETE',
      results,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    currentStatus = 'error';

    sendToPopup({
      type: 'ERROR',
      error: errorMsg,
    });
  } finally {
    if (executor) {
      currentLog = executor.getExecutionLog();
    }
    await getBrowserContext().cleanup();
    executor = null;
  }
}

function stopTask(): void {
  if (executor) {
    executor.cancel();
    currentLog = executor.getExecutionLog();
  }
  currentStatus = 'idle';
  getBrowserContext().cleanup();
  executor = null;
}

// Message listener
chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    const type = message.type as string;

    switch (type) {
      case 'START_TASK': {
        const tabId = message.tabId as number;
        startTask(tabId);
        sendResponse({ success: true });
        break;
      }

      case 'STOP_TASK': {
        stopTask();
        sendResponse({ success: true });
        break;
      }

      case 'GET_STATUS': {
        const statusUpdate: StatusUpdate = {
          status: currentStatus,
          progress: currentResults.length,
          total: 20,
        };
        if (executor) {
          statusUpdate.progress = executor.getResults().length;
        }
        sendResponse(statusUpdate);
        break;
      }

      case 'DOWNLOAD_RESULTS': {
        sendResponse({ results: currentResults });
        break;
      }

      case 'DOWNLOAD_LOGS': {
        sendResponse({ log: currentLog });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type' });
    }

    return true; // Keep message channel open for async response
  }
);

// Tab closed listener
chrome.tabs.onRemoved.addListener((tabId: number) => {
  getBrowserContext().removeConnectedPage(tabId);
});

// Extension installed/updated listener
chrome.runtime.onInstalled.addListener((details) => {
  console.log('FOMO extension installed/updated:', details.reason);
});
