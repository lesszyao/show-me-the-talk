import type { SearchResult, StatusUpdate, ExecutionStatus } from '../types';

const statusDot = document.getElementById('statusDot') as HTMLElement;
const progressCircle = document.getElementById('progressCircle') as unknown as SVGCircleElement;
const progressNumber = document.getElementById('progressNumber') as HTMLElement;
const currentAction = document.getElementById('currentAction') as HTMLElement;
const btnStart = document.getElementById('btnStart') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;
const btnLogs = document.getElementById('btnLogs') as HTMLButtonElement;
const errorMessage = document.getElementById('errorMessage') as HTMLElement;

const CIRCUMFERENCE = 327; // 2 * Math.PI * 52
const TOTAL = 20;

let cachedResults: SearchResult[] = [];
let logsAvailable = false;

function updateProgressRing(progress: number): void {
  const offset = CIRCUMFERENCE - (progress / TOTAL) * CIRCUMFERENCE;
  progressCircle.style.strokeDashoffset = String(offset);
  progressNumber.textContent = String(progress);
}

function updateStatusDot(status: ExecutionStatus): void {
  statusDot.className = `status-dot ${status}`;
}

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

function hideError(): void {
  errorMessage.style.display = 'none';
}

function updateUI(update: StatusUpdate): void {
  updateStatusDot(update.status);
  updateProgressRing(update.progress);

  if (update.action) {
    currentAction.textContent = update.action;
  }

  switch (update.status) {
    case 'running':
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnDownload.disabled = true;
      btnLogs.disabled = true;
      hideError();
      break;

    case 'completed':
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = false;
      btnLogs.disabled = false;
      logsAvailable = true;
      currentAction.textContent = 'Completed';
      break;

    case 'error':
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = cachedResults.length === 0;
      btnLogs.disabled = !logsAvailable;
      if (update.error) {
        showError(update.error);
      }
      break;

    case 'idle':
    default:
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = cachedResults.length === 0;
      btnLogs.disabled = !logsAvailable;
      break;
  }
}

async function startTask(): Promise<void> {
  try {
    hideError();

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.id) {
      throw new Error('No active tab');
    }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      throw new Error('Cannot run on this page');
    }

    chrome.runtime.sendMessage({ type: 'START_TASK', tabId: tab.id });

    updateUI({
      status: 'running',
      progress: 0,
      total: TOTAL,
      action: 'Starting...',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(msg);
  }
}

function stopTask(): void {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' });
  updateUI({
    status: 'idle',
    progress: cachedResults.length,
    total: TOTAL,
    action: 'Stopped',
  });
}

function downloadResults(): void {
  if (cachedResults.length === 0) return;

  const json = JSON.stringify(cachedResults, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .substring(0, 19);

  chrome.downloads.download({
    url,
    filename: `fomo-results-${timestamp}.json`,
    saveAs: true,
  });
}

function downloadLogs(): void {
  chrome.runtime.sendMessage(
    { type: 'DOWNLOAD_LOGS' },
    (response: { log: unknown }) => {
      if (!response || !response.log) return;

      const json = JSON.stringify(response.log, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .substring(0, 19);

      chrome.downloads.download({
        url,
        filename: `fomo-logs-${timestamp}.json`,
        saveAs: true,
      });
    }
  );
}

// Listen for messages from background
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>) => {
    const type = message.type as string;

    switch (type) {
      case 'STATUS_UPDATE':
        updateUI(message as unknown as StatusUpdate);
        break;

      case 'TASK_COMPLETE':
        cachedResults = message.results as SearchResult[];
        logsAvailable = true;
        updateUI({
          status: 'completed',
          progress: cachedResults.length,
          total: TOTAL,
        });
        break;

      case 'ERROR':
        updateUI({
          status: 'error',
          progress: cachedResults.length,
          total: TOTAL,
          error: message.error as string,
        });
        break;
    }
  }
);

// Initialize: get current status from background
chrome.runtime.sendMessage(
  { type: 'GET_STATUS' },
  (response: StatusUpdate | undefined) => {
    if (response) {
      updateUI(response);
    }
  }
);

// Bind button events
btnStart.addEventListener('click', startTask);
btnStop.addEventListener('click', stopTask);
btnDownload.addEventListener('click', downloadResults);
btnLogs.addEventListener('click', downloadLogs);
