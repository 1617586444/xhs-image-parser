export function indexHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小红书 / X 静态解析</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #07111f; color: #ebf3ff; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 16px 56px; }
    h1 { margin: 0 0 18px; font-size: 34px; }
    form { display: grid; gap: 12px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    textarea { min-height: 110px; padding: 14px; color: #ebf3ff; background: #040b16; border: 1px solid #345678; border-radius: 10px; resize: vertical; }
    button, .button { width: fit-content; min-height: 42px; padding: 0 16px; border: 0; border-radius: 10px; background: #39d0ff; color: #04111f; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
    .form-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .secondary { background: transparent; color: #7de8ff; border: 1px solid #24415f; }
    .meta { margin-top: 18px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 18px; }
    .card { background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; overflow: hidden; }
    .card img, .card video { width: 100%; height: 280px; object-fit: cover; display: block; background: #040b16; }
    .actions { display: flex; gap: 8px; padding: 10px; flex-wrap: wrap; }
    .actions a { padding: 0 12px; min-height: 36px; border-radius: 8px; word-break: normal; }
    .actions .open { background: transparent; color: #7de8ff; border: 1px solid #24415f; }
    .history { margin-top: 18px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    .history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .history h2 { margin: 0; font-size: 18px; }
    .history-list { display: grid; gap: 8px; }
    .history-empty { margin: 0; color: #95a9bf; }
    .history-item { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 10px; background: #07111f; border: 1px solid #1f3854; border-radius: 10px; }
    .history-title { margin: 0 0 4px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-meta { margin: 0; color: #95a9bf; font-size: 13px; }
    .history-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .ghost { background: transparent; color: #7de8ff; border: 1px solid #24415f; }
    .danger { background: transparent; color: #ffb1ba; border: 1px solid rgba(255, 107, 125, .4); }
    .error { margin-top: 16px; padding: 12px; color: #ffb1ba; background: rgba(255, 107, 125, .12); border: 1px solid rgba(255, 107, 125, .3); border-radius: 10px; }
    @media (max-width: 640px) {
      .history-item { grid-template-columns: 1fr; }
      .history-actions { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main>
    <h1>小红书 / X 图片视频解析</h1>
    <form id="form">
      <textarea id="text" placeholder="粘贴小红书分享文本，或 X/Twitter 帖子链接"></textarea>
      <div class="form-actions">
        <button id="submit" type="submit">解析图片</button>
        <button id="detectClipboard" class="secondary" type="button">识别剪切板</button>
        <button id="clearInput" class="secondary" type="button">清空输入</button>
      </div>
    </form>
    <section class="history">
      <div class="history-head">
        <h2>历史解析</h2>
        <button id="clearHistory" class="danger" type="button">清空历史</button>
      </div>
      <div id="historyList" class="history-list"></div>
    </section>
    <section id="result"></section>
  </main>
  <script>
    const HISTORY_KEY = 'xhs_static_parse_history_v1';
    const HISTORY_LIMIT = 30;
    const form = document.getElementById('form');
    const text = document.getElementById('text');
    const result = document.getElementById('result');
    const submit = document.getElementById('submit');
    const detectClipboard = document.getElementById('detectClipboard');
    const clearInput = document.getElementById('clearInput');
    const historyList = document.getElementById('historyList');
    const clearHistory = document.getElementById('clearHistory');
    let lastClipboardCheck = 0;
    renderHistory();
    detectClipboardText(true);
    window.addEventListener('focus', () => {
      if (Date.now() - lastClipboardCheck > 3000) detectClipboardText(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - lastClipboardCheck > 3000) detectClipboardText(true);
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = '解析中...';
      result.innerHTML = '';
      try {
        const response = await fetch('/api/parse?text=' + encodeURIComponent(text.value));
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || '解析失败');
        saveHistory(payload, text.value);
        renderHistory();
        result.innerHTML = render(payload);
      } catch (error) {
        result.innerHTML = '<div class="error">' + escapeHtml(error.message || String(error)) + '</div>';
      } finally {
        submit.disabled = false;
        submit.textContent = '解析图片';
      }
    });
    detectClipboard.addEventListener('click', () => detectClipboardText(false));
    clearInput.addEventListener('click', () => {
      text.value = '';
      text.focus();
    });
    historyList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const items = loadHistory();
      const item = items.find((entry) => entry.id === id);
      if (button.dataset.action === 'view' && item) {
        text.value = item.input || item.data?.source_url || '';
        result.innerHTML = render(item.data);
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (button.dataset.action === 'delete') {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(items.filter((entry) => entry.id !== id)));
        renderHistory();
      }
    });
    clearHistory.addEventListener('click', () => {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
      result.innerHTML = '';
    });
    function render(data) {
      const images = data.images || [];
      const livePhotos = data.live_photos || [];
      const videos = data.videos || [];
      return \`
        <div class="meta">
          <h2>\${escapeHtml(data.title || '未命名')}</h2>
          <p>共 \${images.length} 张\${livePhotos.length ? \`，\${livePhotos.length} 个实况\` : ''}\${videos.length ? \`，\${videos.length} 个视频\` : ''}</p>
        </div>
        <div class="grid">
          \${images.map((image, index) => \`
            <article class="card">
              \${renderMedia(image, livePhotos[index], data.source_url, index)}
              <div class="actions">
                <a class="button" href="/api/download-image?url=\${encodeURIComponent(image)}&ref=\${encodeURIComponent(data.source_url)}&index=\${index + 1}">下载</a>
                \${livePhotos[index] ? \`<a class="button" href="/api/download-video?url=\${encodeURIComponent(livePhotos[index].video)}&ref=\${encodeURIComponent(data.source_url)}&index=\${index + 1}">下载实况</a>\` : ''}
                <a class="button open" href="\${escapeHtml(image)}" target="_blank">打开图片</a>
              </div>
            </article>
          \`).join('')}
          \${videos.map((video, index) => \`
            <article class="card">
              <video controls muted playsinline><source src="/api/video?url=\${encodeURIComponent(video)}&ref=\${encodeURIComponent(data.source_url)}" type="video/mp4"></video>
              <div class="actions">
                <a class="button" href="/api/download-video?url=\${encodeURIComponent(video)}&ref=\${encodeURIComponent(data.source_url)}&index=\${index + 1}">下载视频</a>
                <a class="button open" href="\${escapeHtml(video)}" target="_blank">打开视频</a>
              </div>
            </article>
          \`).join('')}
        </div>\`;
    }
    function renderMedia(image, livePhoto, sourceUrl, index) {
      if (!livePhoto || !livePhoto.video) return \`<img src="/api/image?url=\${encodeURIComponent(image)}&ref=\${encodeURIComponent(sourceUrl)}" alt="图片 \${index + 1}">\`;
      return \`<video controls muted playsinline poster="/api/image?url=\${encodeURIComponent(image)}&ref=\${encodeURIComponent(sourceUrl)}"><source src="/api/video?url=\${encodeURIComponent(livePhoto.video)}&ref=\${encodeURIComponent(sourceUrl)}" type="video/mp4"></video>\`;
    }
    async function detectClipboardText(silent) {
      lastClipboardCheck = Date.now();
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        if (!silent) showError('当前浏览器不支持读取剪切板。');
        return;
      }
      if (silent && text.value.trim()) return;
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (!looksLikeSupportedText(clipboardText)) {
          if (!silent) showError('剪切板里没有识别到小红书或 X 链接。');
          return;
        }
        text.value = clipboardText.trim();
      } catch {
        if (!silent) showError('浏览器阻止了剪切板读取，请允许权限后重试。');
      }
    }
    function looksLikeSupportedText(value) {
      return /xhslink\\.com|xiaohongshu\\.com|x\\.com|twitter\\.com/i.test(String(value || ''));
    }
    function showError(message) {
      result.innerHTML = '<div class="error">' + escapeHtml(message) + '</div>';
    }
    function loadHistory() {
      try {
        const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(value) ? value.filter((item) => item && item.data) : [];
      } catch {
        return [];
      }
    }
    function saveHistory(data, input) {
      const images = data.images || [];
      const livePhotos = data.live_photos || [];
      const videos = data.videos || [];
      const key = data.note_id || data.source_url || String(Date.now());
      const item = {
        id: key,
        input,
        title: data.title || '未命名',
        source_url: data.source_url || '',
        saved_at: Date.now(),
        counts: { images: images.length, live: livePhotos.length, videos: videos.length },
        data,
      };
      const items = loadHistory().filter((entry) => entry.id !== item.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...items].slice(0, HISTORY_LIMIT)));
    }
    function renderHistory() {
      const items = loadHistory();
      clearHistory.disabled = !items.length;
      if (!items.length) {
        historyList.innerHTML = '<p class="history-empty">暂无历史记录</p>';
        return;
      }
      historyList.innerHTML = items.map((item) => {
        const counts = item.counts || {};
        const time = new Date(item.saved_at || Date.now()).toLocaleString();
        const summary = \`\${counts.images || 0} 张图\${counts.live ? \`，\${counts.live} 个实况\` : ''}\${counts.videos ? \`，\${counts.videos} 个视频\` : ''}\`;
        return \`
          <article class="history-item">
            <div>
              <p class="history-title">\${escapeHtml(item.title || '未命名')}</p>
              <p class="history-meta">\${escapeHtml(summary)} · \${escapeHtml(time)}</p>
            </div>
            <div class="history-actions">
              <button class="ghost" type="button" data-action="view" data-id="\${escapeHtml(item.id)}">查看</button>
              <button class="danger" type="button" data-action="delete" data-id="\${escapeHtml(item.id)}">删除</button>
            </div>
          </article>\`;
      }).join('');
    }
    function escapeHtml(value) {
      return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
  </script>
</body>
</html>`;
}
