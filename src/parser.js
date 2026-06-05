export const USER_AGENT =
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

export async function parseRequest(url) {
  const text = url.searchParams.get("text") || "";
  if (!text.trim()) throw new Error("没有从输入中识别到小红书文章链接。");
  const noteUrl = await resolveNoteUrl(text);
  if (!noteUrl) throw new Error("没有从输入中识别到小红书文章链接。");
  return parseStaticNoteUrl(noteUrl);
}

export async function resolveNoteUrl(text) {
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

export async function parseStaticNoteUrl(noteUrl) {
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

export function buildXhsHeaders(ref = "https://www.xiaohongshu.com") {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: ref,
    "Cache-Control": "no-cache",
  };
}

export function extractXhsUrl(text) {
  const match = text.match(XHS_URL_RE) || text.match(XHS_SHORT_URL_RE);
  return match ? sanitizeExtractedUrl(match[0]) : "";
}

export function sanitizeExtractedUrl(url) {
  return url.trim().replace(/^[<>"'[\](){}]+/, "").replace(/[.,;!?，。；！？]+$/, "");
}

export function extractNoteId(rawUrl) {
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

export function canonicalizeNoteUrl(rawUrl) {
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

export function decodePageText(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/");
}

export function extractUrls(text) {
  return [...new Set(text.match(/https?:\/\/[^"'<>\s)]+/g) || [])];
}

export function filterDetailImages(items) {
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

export function normalizeImageUrl(url) {
  let value = String(url || "").trim();
  if (value.includes(");")) value = value.split(");", 1)[0];
  for (const suffix of ["?imageView2", "?x-oss-process", "?imageMogr2"]) {
    if (value.includes(suffix)) return value.split(suffix, 1)[0];
  }
  return value;
}

export function isDetailImageUrl(url) {
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

export function imageIdentityKey(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.includes("!") ? parsed.pathname.split("!", 1)[0] : parsed.pathname;
  const filename = path.split("/").pop() || path;
  if (filename.startsWith("1040")) return filename;
  for (const marker of ["/notes_pre_post/", "/notes_uhdr/", "/note_pre_post_uhdr/", "/spectrum/"]) {
    if (path.includes(marker)) return marker + path.split(marker, 2)[1];
  }
  return path;
}

export function imageVariantScore(url) {
  const lowered = url.toLowerCase();
  if (lowered.includes("!nd_dft") || lowered.includes("!nc_n")) return 30;
  if (lowered.includes("!nd_prv")) return 10;
  return 20;
}

export function extractVideoUrls(text) {
  const masterUrls = [...text.matchAll(/"masterUrl":"(https?:\/\/[^"]+?\.mp4(?:\?[^"]+)?)"/g)].map((match) => match[1]);
  const fallbackUrls = text.match(/https?:\/\/[^"'<>\s)]+\.mp4(?:\?[^"'<>\s)]+)?/g) || [];
  const byKey = new Map();
  for (const url of [...masterUrls, ...fallbackUrls]) {
    const key = videoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }
  return [...byKey.values()];
}

export function pairLivePhotos(images, videos) {
  return videos.slice(0, images.length).map((video, index) => ({ image: images[index], video }));
}

export function videoIdentityKey(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return rawUrl.split("?")[0];
  }
}

export function isAllowedXhsMediaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    return ["http:", "https:"].includes(parsed.protocol) && (hostname === "xhscdn.com" || hostname.endsWith(".xhscdn.com"));
  } catch {
    return false;
  }
}

export function extractJsonFieldNearNote(text, noteId, field) {
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

export function extractMetaContent(text, name) {
  const match = text.match(new RegExp(`<meta\\s+(?:name|property)="${escapeRegExp(name)}"\\s+content="([^"]*)"`, "i"));
  if (!match) return "";
  let value = match[1].trim();
  if (name === "og:title" && value.endsWith(" - 小红书")) value = value.slice(0, -" - 小红书".length).trim();
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
