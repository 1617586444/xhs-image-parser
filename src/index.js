const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const XHS_URL_RE = /https?:\/\/(?:www\.)?xiaohongshu\.com\/[^\s<>"'，。；！？】）)]+/i;
const XHS_SHORT_URL_RE = /https?:\/\/(?:www\.)?xhslink\.com\/[^\s<>"'，。；！？】）)]+/i;
const SHARE_QUERY_KEYS = new Set([
  "app_platform",
  "app_version",
  "ignoreEngage",
  "share_from_user_hidden",
  "type",
  "author_share",
  "xhsshare",
  "shareRedId",
  "apptime",
  "share_id",
  "share_channel",
]);
const BLOCKED_IMAGE_TOKENS = [
  "avatar",
  "icon",
  "logo",
  "emoji",
  "emoticon",
  "emotion",
  "sticker",
  "redmoji",
  "fe-platform",
  "fe-static",
  "default",
  "badge",
  "appicon",
  "app_icon",
  "sprite",
  "banner",
  "qr",
  ".svg",
  ".js",
  ".css",
  ".html",
  ".json",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return htmlResponse(indexHtml());
      if (url.pathname === "/api/parse") return jsonResponse(await parseRequest(url));
      if (url.pathname === "/api/image") return proxyMedia(url, "image/jpeg", false, "xhs_image");
      if (url.pathname === "/api/video") return proxyMedia(url, "video/mp4", false, "xhs_video");
      if (url.pathname === "/api/download-image") return proxyMedia(url, "image/jpeg", true, "xhs_image");
      if (url.pathname === "/api/download-video") return proxyMedia(url, "video/mp4", true, "xhs_video");
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return jsonResponse({ detail: error.message || String(error) }, 500);
    }
  },
};

async function parseRequest(url) {
  const text = url.searchParams.get("text") || "";
  if (!text.trim()) throw new Error("没有从输入中识别到小红书文章链接。");
  const noteUrl = await resolveNoteUrl(text);
  if (!noteUrl) throw new Error("没有从输入中识别到小红书文章链接。");
  return parseStaticNoteUrl(noteUrl);
}

async function resolveNoteUrl(text) {
  const directUrl = extractXhsUrl(text);
  if (!directUrl) return "";
  if (directUrl.includes("xiaohongshu.com") && extractNoteId(directUrl)) {
    return canonicalizeNoteUrl(directUrl);
  }
  if (!directUrl.includes("xhslink.com")) return "";

  const response = await fetch(directUrl, {
    redirect: "manual",
    headers: buildXhsHeaders(),
  });
  const location = response.headers.get("location") || "";
  for (const candidate of [location, response.url]) {
    if (candidate.includes("xiaohongshu.com") && extractNoteId(candidate)) {
      return canonicalizeNoteUrl(candidate);
    }
  }
  return "";
}

async function parseStaticNoteUrl(noteUrl) {
  const response = await fetch(noteUrl, {
    redirect: "follow",
    headers: buildXhsHeaders(),
  });
  if (!response.ok) throw new Error(`详情页请求失败：${response.status}`);

  const finalUrl = canonicalizeNoteUrl(response.url) || response.url;
  const noteId = extractNoteId(finalUrl) || extractNoteId(noteUrl);
  const pageText = decodePageText(await response.text());
  const urls = extractUrls(pageText);
  const images = filterDetailImages(urls);
  const videoUrls = extractVideoUrls(pageText);
  const livePhotos = pairLivePhotos(images, videoUrls);
  const liveVideoSet = new Set(livePhotos.map((item) => videoIdentityKey(item.video)));
  const videos = videoUrls.filter((video) => !liveVideoSet.has(videoIdentityKey(video)));

  if (!images.length && !livePhotos.length && !videos.length) {
    throw new Error("当前页面静态源码中没有可解析的图片或视频。");
  }

  return {
    source_url: finalUrl,
    note_id: noteId,
    title:
      extractJsonFieldNearNote(pageText, noteId, "title") ||
      extractJsonFieldNearNote(pageText, noteId, "displayTitle") ||
      extractMetaContent(pageText, "og:title") ||
      "",
    description:
      extractJsonFieldNearNote(pageText, noteId, "desc") ||
      extractJsonFieldNearNote(pageText, noteId, "description") ||
      extractMetaContent(pageText, "description") ||
      "",
    images,
    live_photos: livePhotos,
    videos,
  };
}

function buildXhsHeaders(ref = "https://www.xiaohongshu.com") {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: ref,
    "Cache-Control": "no-cache",
  };
}

function extractXhsUrl(text) {
  const match = text.match(XHS_URL_RE) || text.match(XHS_SHORT_URL_RE);
  return match ? sanitizeExtractedUrl(match[0]) : "";
}

function sanitizeExtractedUrl(url) {
  return url.trim().replace(/^[<>"'[\](){}]+/, "").replace(/[.,;!?，。；！？]+$/, "");
}

function extractNoteId(rawUrl) {
  try {
    const parsed = new URL(rawUrl, "https://www.xiaohongshu.com");
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index] === "explore" && segments[index + 1]) return segments[index + 1];
      if (segments[index] === "item" && segments[index - 1] === "discovery" && segments[index + 1]) {
        return segments[index + 1];
      }
    }
  } catch {
    return "";
  }
  return "";
}

function canonicalizeNoteUrl(rawUrl) {
  const noteId = extractNoteId(rawUrl);
  if (!noteId) return "";
  const parsed = new URL(rawUrl, "https://www.xiaohongshu.com");
  const query = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key.startsWith("xsec_") || SHARE_QUERY_KEYS.has(key)) query.append(key, value);
  }
  const base = `https://www.xiaohongshu.com/discovery/item/${noteId}`;
  const queryText = query.toString();
  return queryText ? `${base}?${queryText}` : base;
}

function decodePageText(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/");
}

function extractUrls(text) {
  return [...new Set(text.match(/https?:\/\/[^"'<>\s)]+/g) || [])];
}

function filterDetailImages(items) {
  const byKey = new Map();
  for (const item of items) {
    const normalized = normalizeImageUrl(item);
    if (!isDetailImageUrl(normalized)) continue;
    const key = imageIdentityKey(normalized);
    const existing = byKey.get(key);
    if (existing && imageVariantScore(existing) >= imageVariantScore(normalized)) continue;
    byKey.set(key, normalized);
  }
  return [...byKey.values()];
}

function normalizeImageUrl(url) {
  let value = String(url || "").trim();
  if (value.includes(");")) value = value.split(");", 1)[0];
  for (const suffix of ["?imageView2", "?x-oss-process", "?imageMogr2"]) {
    if (value.includes(suffix)) return value.split(suffix, 1)[0];
  }
  return value;
}

function isDetailImageUrl(url) {
  const lowered = url.toLowerCase();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  if (BLOCKED_IMAGE_TOKENS.some((token) => lowered.includes(token))) return false;
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (["/notes_pre_post/", "/notes_uhdr/", "/note_pre_post_uhdr/", "/spectrum/"].some((marker) => path.includes(marker))) {
    return true;
  }
  return parsed.hostname.startsWith("sns-webpic") && path.includes("!nd_") && (path.endsWith("_jpg_3") || path.endsWith("_webp_3"));
}

function imageIdentityKey(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.includes("!") ? parsed.pathname.split("!", 1)[0] : parsed.pathname;
  const filename = path.split("/").pop() || path;
  if (filename.startsWith("1040")) return filename;
  for (const marker of ["/notes_pre_post/", "/notes_uhdr/", "/note_pre_post_uhdr/", "/spectrum/"]) {
    if (path.includes(marker)) return marker + path.split(marker, 2)[1];
  }
  return path;
}

function imageVariantScore(url) {
  const lowered = url.toLowerCase();
  if (lowered.includes("!nd_dft") || lowered.includes("!nc_n")) return 30;
  if (lowered.includes("!nd_prv")) return 10;
  return 20;
}

function extractVideoUrls(text) {
  const masterUrls = [...text.matchAll(/"masterUrl":"(https?:\/\/[^"]+?\.mp4(?:\?[^"]+)?)"/g)].map((match) => match[1]);
  const fallbackUrls = text.match(/https?:\/\/[^"'<>\s)]+\.mp4(?:\?[^"'<>\s)]+)?/g) || [];
  const byKey = new Map();
  for (const url of [...masterUrls, ...fallbackUrls]) {
    const key = videoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }
  return [...byKey.values()];
}

function pairLivePhotos(images, videos) {
  return videos.slice(0, images.length).map((video, index) => ({ image: images[index], video }));
}

function videoIdentityKey(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return rawUrl.split("?")[0];
  }
}

function extractJsonFieldNearNote(text, noteId, field) {
  if (!noteId) return "";
  const noteIndex = text.indexOf(`"noteId":"${noteId}"`);
  if (noteIndex < 0) return "";
  const windowText = text.slice(noteIndex, noteIndex + 50000);
  const match = windowText.match(new RegExp(`"${escapeRegExp(field)}":"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`).trim();
  } catch {
    return match[1].trim();
  }
}

function extractMetaContent(text, name) {
  const match = text.match(new RegExp(`<meta\\s+(?:name|property)="${escapeRegExp(name)}"\\s+content="([^"]*)"`, "i"));
  if (!match) return "";
  let value = match[1].trim();
  if (name === "og:title" && value.endsWith(" - 小红书")) value = value.slice(0, -" - 小红书".length).trim();
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function proxyMedia(url, defaultType, attachment, prefix) {
  const mediaUrl = url.searchParams.get("url");
  if (!mediaUrl) return jsonResponse({ detail: "missing url" }, 400);
  const ref = url.searchParams.get("ref") || "https://www.xiaohongshu.com";
  const response = await fetch(mediaUrl, {
    redirect: "follow",
    headers: buildXhsHeaders(ref),
  });
  if (!response.ok) return jsonResponse({ detail: `media request failed: ${response.status}` }, response.status);

  const headers = new Headers(response.headers);
  headers.set("content-type", response.headers.get("content-type") || defaultType);
  headers.set("cache-control", "public, max-age=3600");
  if (attachment) {
    const index = Math.max(parseInt(url.searchParams.get("index") || "1", 10) || 1, 1);
    headers.set("content-disposition", `attachment; filename="${prefix}_${String(index).padStart(2, "0")}${extensionFor(headers.get("content-type"), defaultType)}"`);
  }
  return new Response(response.body, { status: response.status, headers });
}

function extensionFor(contentType, defaultType) {
  const type = (contentType || defaultType || "").split(";", 1)[0].toLowerCase();
  if (type.includes("webp")) return ".webp";
  if (type.includes("png")) return ".png";
  if (type.includes("mp4")) return ".mp4";
  return ".jpg";
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(html) {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function indexHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小红书静态解析</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #07111f; color: #ebf3ff; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 16px 56px; }
    h1 { margin: 0 0 18px; font-size: 34px; }
    form { display: grid; gap: 12px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    textarea { min-height: 110px; padding: 14px; color: #ebf3ff; background: #040b16; border: 1px solid #345678; border-radius: 10px; resize: vertical; }
    button, .button { width: fit-content; min-height: 42px; padding: 0 16px; border: 0; border-radius: 10px; background: #39d0ff; color: #04111f; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
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
    <h1>小红书静态图片解析</h1>
    <form id="form">
      <textarea id="text" placeholder="粘贴小红书分享文本或链接"></textarea>
      <button id="submit" type="submit">解析图片</button>
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
    const historyList = document.getElementById('historyList');
    const clearHistory = document.getElementById('clearHistory');
    renderHistory();
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
