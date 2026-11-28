"use strict";

(async () => {
  if (!window.isSecureContext || !["https:", "http:"].includes(location.protocol)
      || !("serviceWorker" in navigator)) return;
  const status = document.getElementById("offline-status");
  status.hidden = false;
  status.textContent = "正在准备离线题库…";
  try {
    const worker = await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
    const showReady = () => { status.textContent = "离线题库可用"; };
    const showFailed = () => { status.textContent = "离线题库下载失败，请联网后重新打开。"; };
    const watch = (next) => {
      if (!next) return;
      next.addEventListener("statechange", () => {
        if (next.state === "activated") showReady();
        if (next.state === "redundant" && !worker.active) showFailed();
      });
    };
    watch(worker.installing);
    worker.addEventListener("updatefound", () => watch(worker.installing));
    if (worker.active) showReady();
  } catch {
    status.textContent = "离线题库下载失败，请联网后重新打开。";
  }
})();
