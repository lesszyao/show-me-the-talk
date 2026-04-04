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
const progressCircle = document.getElementById("progressCircle");
const progressNumber = document.getElementById("progressNumber");
const currentAction = document.getElementById("currentAction");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnDownload = document.getElementById("btnDownload");
const btnLogs = document.getElementById("btnLogs");
const errorMessage = document.getElementById("errorMessage");
const CIRCUMFERENCE = 327;
const TOTAL = 20;
let cachedResults = [];
let logsAvailable = false;
function updateProgressRing(progress) {
  const offset = CIRCUMFERENCE - progress / TOTAL * CIRCUMFERENCE;
  progressCircle.style.strokeDashoffset = String(offset);
  progressNumber.textContent = String(progress);
}
function updateStatusDot(status) {
  statusDot.className = `status-dot ${status}`;
}
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
}
function hideError() {
  errorMessage.style.display = "none";
}
function updateUI(update) {
  updateStatusDot(update.status);
  updateProgressRing(update.progress);
  if (update.action) {
    currentAction.textContent = update.action;
  }
  switch (update.status) {
    case "running":
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnDownload.disabled = true;
      btnLogs.disabled = true;
      hideError();
      break;
    case "completed":
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = false;
      btnLogs.disabled = false;
      logsAvailable = true;
      currentAction.textContent = "Completed";
      break;
    case "error":
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = cachedResults.length === 0;
      btnLogs.disabled = !logsAvailable;
      if (update.error) {
        showError(update.error);
      }
      break;
    case "idle":
    default:
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnDownload.disabled = cachedResults.length === 0;
      btnLogs.disabled = !logsAvailable;
      break;
  }
}
async function startTask() {
  try {
    hideError();
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (!tab || !tab.id) {
      throw new Error("No active tab");
    }
    const url = tab.url || "";
    if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
      throw new Error("Cannot run on this page");
    }
    chrome.runtime.sendMessage({ type: "START_TASK", tabId: tab.id });
    updateUI({
      status: "running",
      progress: 0,
      total: TOTAL,
      action: "Starting..."
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(msg);
  }
}
function stopTask() {
  chrome.runtime.sendMessage({ type: "STOP_TASK" });
  updateUI({
    status: "idle",
    progress: cachedResults.length,
    action: "Stopped"
  });
}
function downloadResults() {
  if (cachedResults.length === 0) return;
  const json = JSON.stringify(cachedResults, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").substring(0, 19);
  chrome.downloads.download({
    url,
    filename: `fomo-results-${timestamp}.json`,
    saveAs: true
  });
}
function downloadLogs() {
  chrome.runtime.sendMessage(
    { type: "DOWNLOAD_LOGS" },
    (response) => {
      if (!response || !response.log) return;
      const json = JSON.stringify(response.log, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").substring(0, 19);
      chrome.downloads.download({
        url,
        filename: `fomo-logs-${timestamp}.json`,
        saveAs: true
      });
    }
  );
}
chrome.runtime.onMessage.addListener(
  (message) => {
    const type = message.type;
    switch (type) {
      case "STATUS_UPDATE":
        updateUI(message);
        break;
      case "TASK_COMPLETE":
        cachedResults = message.results;
        logsAvailable = true;
        updateUI({
          status: "completed",
          progress: cachedResults.length});
        break;
      case "ERROR":
        updateUI({
          status: "error",
          progress: cachedResults.length,
          error: message.error
        });
        break;
    }
  }
);
chrome.runtime.sendMessage(
  { type: "GET_STATUS" },
  (response) => {
    if (response) {
      updateUI(response);
    }
  }
);
btnStart.addEventListener("click", startTask);
btnStop.addEventListener("click", stopTask);
btnDownload.addEventListener("click", downloadResults);
btnLogs.addEventListener("click", downloadLogs);
//# sourceMappingURL=popup.js.map
