true&&(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
}());

const statusDot = document.getElementById("statusDot");
const progressRing = document.getElementById("progressRing");
const progressText = document.getElementById("progressText");
const currentAction = document.getElementById("currentAction");
const btnPlay = document.getElementById("btnPlay");
const btnStop = document.getElementById("btnStop");
const btnDownloadResults = document.getElementById("btnDownloadResults");
const btnDownloadLogs = document.getElementById("btnDownloadLogs");
const errorMessage = document.getElementById("errorMessage");
const CIRCUMFERENCE = 327;
const TARGET_COUNT = 20;
let cachedResults = [];
let hasLogs = false;
function updateProgressRing(count) {
  const progress = count / TARGET_COUNT;
  const offset = CIRCUMFERENCE - progress * CIRCUMFERENCE;
  progressRing.style.strokeDashoffset = String(offset);
  progressText.textContent = `${count}/${TARGET_COUNT}`;
}
function updateUI(data) {
  const { status, resultCount = 0, currentAction: action, error } = data;
  statusDot.className = "status-dot";
  errorMessage.classList.add("hidden");
  switch (status) {
    case "running":
      statusDot.classList.add("running");
      btnPlay.disabled = true;
      btnStop.disabled = false;
      btnDownloadResults.disabled = true;
      btnDownloadLogs.disabled = true;
      updateProgressRing(resultCount);
      if (action) {
        currentAction.textContent = action;
      }
      break;
    case "completed":
      statusDot.classList.add("completed");
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      updateProgressRing(resultCount);
      currentAction.textContent = "搜索完成";
      break;
    case "error":
      statusDot.classList.add("error");
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      if (error) {
        errorMessage.textContent = error;
        errorMessage.classList.remove("hidden");
      }
      currentAction.textContent = "发生错误";
      break;
    case "idle":
    default:
      btnPlay.disabled = false;
      btnStop.disabled = true;
      btnDownloadResults.disabled = cachedResults.length === 0;
      btnDownloadLogs.disabled = !hasLogs;
      currentAction.textContent = "点击开始搜索 AI 热点";
      break;
  }
}
function downloadResults() {
  if (cachedResults.length === 0) return;
  const json = JSON.stringify(cachedResults, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  chrome.downloads.download({
    url,
    filename: `fomo-results-${timestamp}.json`,
    saveAs: true
  });
}
function downloadLogs() {
  chrome.runtime.sendMessage({ type: "DOWNLOAD_LOGS" }, (response) => {
    if (response && response.logs) {
      const json = JSON.stringify(response.logs, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      chrome.downloads.download({
        url,
        filename: `fomo-logs-${timestamp}.json`,
        saveAs: true
      });
    }
  });
}
function startTask() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      updateUI({ status: "error", error: "无法获取当前标签页" });
      return;
    }
    const url = tab.url || "";
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
      updateUI({ status: "error", error: "Cannot run on this page" });
      return;
    }
    cachedResults = [];
    hasLogs = false;
    updateProgressRing(0);
    chrome.runtime.sendMessage({ type: "START_TASK", tabId: tab.id });
    updateUI({ status: "running", resultCount: 0, currentAction: "正在启动搜索..." });
  });
}
function stopTask() {
  chrome.runtime.sendMessage({ type: "STOP_TASK" });
  updateUI({ status: "idle" });
}
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "STATUS_UPDATE":
      updateUI({
        status: message.status,
        currentStep: message.currentStep,
        resultCount: message.resultCount,
        currentAction: message.currentAction
      });
      break;
    case "TASK_COMPLETED":
      cachedResults = message.results;
      hasLogs = true;
      updateUI({
        status: "completed",
        resultCount: message.results.length
      });
      break;
    case "ERROR":
      hasLogs = true;
      updateUI({
        status: "error",
        error: message.error
      });
      break;
  }
});
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  if (response) {
    updateUI({
      status: response.status || "idle",
      currentStep: response.currentStep,
      resultCount: response.resultCount
    });
    if (response.results) {
      cachedResults = response.results;
    }
    if (response.hasLogs) {
      hasLogs = true;
    }
  }
});
btnPlay.addEventListener("click", startTask);
btnStop.addEventListener("click", stopTask);
btnDownloadResults.addEventListener("click", downloadResults);
btnDownloadLogs.addEventListener("click", downloadLogs);
//# sourceMappingURL=popup.js.map
