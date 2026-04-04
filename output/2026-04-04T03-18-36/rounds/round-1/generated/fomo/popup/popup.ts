import type { Message, SearchResult } from '@/types';

const statusDot = document.getElementById('statusDot') as HTMLElement;
const progressRing = document.getElementById('progressRing') as SVGCircleElement;
const progressText = document.getElementById('progressText') as SVGTextElement;
const currentAction = document.getElementById('currentAction') as HTMLElement;
const btnPlay = document.getElementById('btnPlay') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnDownloadResults = document.getElementById('btnDownloadResults') as HTMLButtonElement;
const btnDownloadLogs = document.getElementById('btnDownloadLogs') as HTMLButtonElement;
const errorMessage = document.getElementById('errorMessage') as HTMLElement;

const CIRCUMFERENCE = 327;
const TARGET_COUNT = 20;

let cachedResults: SearchResult[] = [];
let hasLogs = false;

function updateProgressRing(count: number): void {
  const progress = count / TARGET_COUNT;
  const offset = CIRCUMFERENCE - progress * CIRCUMFERENCE;
  progressRing.style.strokeDashoffset = String(offset);
  progressText.textContent = `${count}/${TARGET_COUNT}`;
}

function updateUI(data: {
  status: string;
  currentStep?: number;
  resultCount?: number;
  currentAction?: string;
  error?: string;
}): void {
  const { status, resultCount = 0, currentAction: action, error } = data;

  statusDot.className = 'status-dot';
  errorMessage.classList.add('hidden');

  switch (status) {
    case 'running':
      statusDot.classList.add('running');
      btnPlay.disabled = true;
      btnStop.disabled = false;
      btnDownloadResults.disabled = true;
      btnDownloadLogs.disabled = true;
      updateProgressRing(resultCount);
      if (action) {
        currentAction.textContent = action;
      }
      break;

    case 'completed':
      statusDot.classList.add('completed');
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      updateProgressRing(resultCount);
      currentAction.textContent = '搜索完成';
      break;

    case 'error':
      statusDot.classList.add('error');
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      if (error) {
        errorMessage.textContent = error;
        errorMessage.classList.remove('hidden');
      }
      currentAction.textContent = '发生错误';
      break;

    case 'idle':
    default:
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      currentAction.textContent = '点击开始搜索 AI 热点';
      break;
  }
}

function downloadResults(): void {
  if (cachedResults.length === 0) return;

  const json = JSON.stringify(cachedResults, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  chrome.downloads.download({
    url,
    filename: `fomo-results-${timestamp}.json`,
    saveAs: true,
  });
}

function downloadLogs(): void {
  chrome.runtime.sendMessage({ type: 'DOWNLOAD_LOGS' } as Message, (response) => {
    if (response && response.logs) {
      const json = JSON.stringify(response.logs, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      chrome.downloads.download({
        url,
        filename: `fomo-logs-${timestamp}.json`,
        saveAs: true,
      });
    }
  });
}

function startTask(): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      updateUI({ status: 'error', error: '无法获取当前标签页' });
      return;
    }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      updateUI({ status: 'error', error: 'Cannot run on this page' });
      return;
    }

    cachedResults = [];
    hasLogs = false;
    updateProgressRing(0);

    chrome.runtime.sendMessage({ type: 'START_TASK', tabId: tab.id } as Message);

    updateUI({ status: 'running', resultCount: 0, currentAction: '正在启动搜索...' });
  });
}

function stopTask(): void {
  chrome.runtime.sendMessage({ type: 'STOP_TASK' } as Message);
  updateUI({ status: 'idle' });
}

chrome.runtime.onMessage.addListener((message: Message) => {
  switch (message.type) {
    case 'STATUS_UPDATE':
      updateUI({
        status: message.status,
        currentStep: message.currentStep,
        resultCount: message.resultCount,
        currentAction: message.currentAction,
      });
      break;

    case 'TASK_COMPLETED':
      cachedResults = message.results;
      hasLogs = true;
      updateUI({
        status: 'completed',
        resultCount: message.results.length,
      });
      break;

    case 'ERROR':
      hasLogs = true;
      updateUI({
        status: 'error',
        error: message.error,
      });
      break;
  }
});

// Initialize: query current status from background
chrome.runtime.sendMessage({ type: 'GET_STATUS' } as Message, (response) => {
  if (response) {
    updateUI({
      status: response.status || 'idle',
      currentStep: response.currentStep,
      resultCount: response.resultCount,
    });
    if (response.results) {
      cachedResults = response.results;
    }
    if (response.hasLogs) {
      hasLogs = true;
    }
  }
});

// Bind button events
btnPlay.addEventListener('click', startTask);
btnStop.addEventListener('click', stopTask);
btnDownloadResults.addEventListener('click', downloadResults);
btnDownloadLogs.addEventListener('click', downloadLogs);
