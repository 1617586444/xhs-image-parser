(function initPopup() {
  const { imageFileName } = globalThis.XMediaUtils;
  const status = document.getElementById("status");
  const list = document.getElementById("list");
  const refresh = document.getElementById("refresh");
  const downloadAll = document.getElementById("downloadAll");
  let currentMedia = [];

  refresh.addEventListener("click", loadMedia);
  downloadAll.addEventListener("click", () => downloadItems(currentMedia));
  list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const item = currentMedia[Number(button.dataset.index)];
    if (item) downloadItems([item]);
  });

  loadMedia();

  async function loadMedia() {
    setStatus("正在识别当前页面图片...");
    currentMedia = [];
    list.innerHTML = "";
    downloadAll.disabled = true;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isXPage(tab.url || "")) {
      setStatus("请先打开 X/Twitter 帖子页面。");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_X_MEDIA" });
      currentMedia = Array.isArray(response?.media) ? response.media : [];
    } catch {
      setStatus("当前页面还没准备好，请刷新 X 页面后重试。");
      return;
    }

    renderMedia();
  }

  function renderMedia() {
    if (!currentMedia.length) {
      setStatus("当前页面没有识别到 X 高清大图。");
      return;
    }

    setStatus(`识别到 ${currentMedia.length} 张图片。`);
    downloadAll.disabled = false;
    list.innerHTML = currentMedia.map((item, index) => `
      <article class="item">
        <img src="${escapeHtml(item.previewUrl || item.url)}" alt="">
        <div class="meta">
          <p class="url">${escapeHtml(item.url)}</p>
          <button type="button" data-index="${index}">下载高清图</button>
        </div>
      </article>
    `).join("");
  }

  async function downloadItems(items) {
    const payload = items.map((item, index) => ({
      url: item.url,
      filename: imageFileName(item.url, index + 1),
    }));
    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_X_MEDIA", items: payload });
    if (!response?.ok) {
      setStatus(response?.error || "下载失败。");
      return;
    }
    setStatus(`已创建 ${response.count} 个下载任务。`);
  }

  function isXPage(url) {
    try {
      const parsed = new URL(url);
      return ["x.com", "twitter.com"].includes(parsed.hostname.replace(/^www\./, ""));
    } catch {
      return false;
    }
  }

  function setStatus(value) {
    status.textContent = value;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
