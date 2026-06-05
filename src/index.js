import { buildXhsHeaders, isAllowedXhsMediaUrl, parseRequest } from "./parser.js";
import { indexHtml } from "./page.js";

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

async function proxyMedia(url, defaultType, attachment, prefix) {
  const mediaUrl = url.searchParams.get("url");
  if (!mediaUrl) return jsonResponse({ detail: "missing url" }, 400);
  if (!isAllowedXhsMediaUrl(mediaUrl)) return jsonResponse({ detail: "media url is not allowed" }, 400);

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
