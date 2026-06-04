import io
import mimetypes
import re
import zipfile
from urllib.parse import urlparse

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response

from xhs_parser.parser import USER_AGENT, parse_note_from_text

app = FastAPI(title="XHS Image Parser")


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小红书图片解析</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; background: #07111f; color: #ebf3ff; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px 16px 56px; }
    h1 { margin: 0 0 18px; font-size: 34px; }
    form { display: grid; gap: 12px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    textarea { min-height: 110px; padding: 14px; color: #ebf3ff; background: #040b16; border: 1px solid #345678; border-radius: 10px; resize: vertical; }
    button, .button { width: fit-content; min-height: 42px; padding: 0 16px; border: 0; border-radius: 10px; background: #39d0ff; color: #04111f; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
    .actions { display: flex; gap: 8px; padding: 10px; flex-wrap: wrap; }
    .actions a { padding: 0 12px; min-height: 36px; border-radius: 8px; word-break: normal; }
    .actions .open { background: transparent; color: #7de8ff; border: 1px solid #24415f; }
    .meta { margin-top: 18px; padding: 16px; background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 18px; }
    .card { background: #0d1a2e; border: 1px solid #24415f; border-radius: 12px; overflow: hidden; }
    .card img { width: 100%; height: 280px; object-fit: cover; display: block; }
    .card video { width: 100%; height: 280px; object-fit: cover; display: block; background: #040b16; }
    .card a { display: block; padding: 10px; color: #7de8ff; word-break: break-all; }
    .badge { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; margin-left: 8px; border-radius: 999px; color: #04111f; background: #8fffd2; font-size: 12px; font-weight: 700; vertical-align: middle; }
    .error { margin-top: 16px; padding: 12px; color: #ffb1ba; background: rgba(255, 107, 125, .12); border: 1px solid rgba(255, 107, 125, .3); border-radius: 10px; }
  </style>
</head>
<body>
  <main>
    <h1>小红书详情图片解析</h1>
    <form id="form">
      <textarea id="text" placeholder="粘贴小红书分享文本或链接"></textarea>
      <button id="submit" type="submit">解析图片</button>
    </form>
    <section id="result"></section>
  </main>
  <script>
    const form = document.getElementById('form');
    const text = document.getElementById('text');
    const result = document.getElementById('result');
    const submit = document.getElementById('submit');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = '解析中...';
      result.innerHTML = '';
      try {
        const response = await fetch('/api/parse?text=' + encodeURIComponent(text.value));
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.error || '解析失败');
        result.innerHTML = render(payload);
      } catch (error) {
        result.innerHTML = '<div class="error">' + escapeHtml(error.message || String(error)) + '</div>';
      } finally {
        submit.disabled = false;
        submit.textContent = '解析图片';
      }
    });
    function render(data) {
      const images = data.images || [];
      const livePhotos = data.live_photos || [];
      const videos = data.videos || [];
      return `
        <div class="meta">
          <h2>${escapeHtml(data.title || '未命名')}</h2>
          <p>共 ${images.length} 张${livePhotos.length ? `，${livePhotos.length} 个实况` : ''}${videos.length ? `，${videos.length} 个视频` : ''}</p>
          <a class="button" href="/api/download-all?text=${encodeURIComponent(text.value)}">下载全部</a>
        </div>
        <div class="grid">
          ${images.map((image, index) => `
            <article class="card">
              ${renderMedia(image, livePhotos[index], data.source_url, index)}
              <div class="actions">
                <a class="button" href="/api/download-image?url=${encodeURIComponent(image)}&ref=${encodeURIComponent(data.source_url)}&index=${index + 1}">下载</a>
                ${livePhotos[index] ? `<a class="button" href="/api/download-video?url=${encodeURIComponent(livePhotos[index].video)}&ref=${encodeURIComponent(data.source_url)}&index=${index + 1}">下载实况</a>` : ''}
                <a class="button open" href="${escapeHtml(image)}" target="_blank">打开图片</a>
              </div>
            </article>
          `).join('')}
          ${videos.map((video, index) => `
            <article class="card">
              <video controls muted playsinline>
                <source src="/api/video?url=${encodeURIComponent(video)}&ref=${encodeURIComponent(data.source_url)}" type="video/mp4">
              </video>
              <div class="actions">
                <a class="button" href="/api/download-video?url=${encodeURIComponent(video)}&ref=${encodeURIComponent(data.source_url)}&index=${index + 1}">下载视频</a>
                <a class="button open" href="${escapeHtml(video)}" target="_blank">打开视频</a>
              </div>
            </article>
          `).join('')}
        </div>
      `;
    }
    function renderMedia(image, livePhoto, sourceUrl, index) {
      if (!livePhoto || !livePhoto.video) {
        return `<img src="/api/image?url=${encodeURIComponent(image)}&ref=${encodeURIComponent(sourceUrl)}" alt="图片 ${index + 1}">`;
      }
      return `
        <video controls muted playsinline poster="/api/image?url=${encodeURIComponent(image)}&ref=${encodeURIComponent(sourceUrl)}">
          <source src="/api/video?url=${encodeURIComponent(livePhoto.video)}&ref=${encodeURIComponent(sourceUrl)}" type="video/mp4">
        </video>
      `;
    }
    function escapeHtml(value) {
      return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
  </script>
</body>
</html>
"""


@app.get("/api/parse")
async def parse(text: str = Query(..., min_length=1)) -> dict:
    try:
        return await parse_note_from_text(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/image")
async def image(url: str, ref: str = "https://www.xiaohongshu.com") -> Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, headers={"Referer": ref, "User-Agent": USER_AGENT})
        response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    return Response(response.content, media_type=content_type)


@app.get("/api/video")
async def video(url: str, ref: str = "https://www.xiaohongshu.com") -> Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, headers={"Referer": ref, "User-Agent": USER_AGENT})
        response.raise_for_status()
    content_type = response.headers.get("content-type", "video/mp4").split(";", 1)[0]
    return Response(response.content, media_type=content_type)


@app.get("/api/download-image")
async def download_image(url: str, ref: str = "https://www.xiaohongshu.com", index: int = 1) -> Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, headers={"Referer": ref, "User-Agent": USER_AGENT})
        response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    suffix = (
        mimetypes.guess_extension(content_type)
        or mimetypes.guess_extension(mimetypes.guess_type(urlparse(url).path)[0] or "")
        or ".jpg"
    )
    if suffix == ".jpe":
        suffix = ".jpg"
    safe_index = max(index, 1)
    return Response(
        response.content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="xhs_image_{safe_index:02d}{suffix}"'},
    )


@app.get("/api/download-video")
async def download_video(url: str, ref: str = "https://www.xiaohongshu.com", index: int = 1) -> Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url, headers={"Referer": ref, "User-Agent": USER_AGENT})
        response.raise_for_status()
    content_type = response.headers.get("content-type", "video/mp4").split(";", 1)[0]
    suffix = mimetypes.guess_extension(content_type) or ".mp4"
    if suffix == ".mp4v":
        suffix = ".mp4"
    safe_index = max(index, 1)
    return Response(
        response.content,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="xhs_live_{safe_index:02d}{suffix}"'},
    )


@app.get("/api/download-all")
async def download_all(text: str = Query(..., min_length=1)) -> Response:
    detail = await parse_note_from_text(text)
    archive = io.BytesIO()
    safe_note_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", detail.get("note_id") or "xhs_images")
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for index, image_url in enumerate(detail.get("images") or [], start=1):
                response = await client.get(
                    image_url,
                    headers={"Referer": detail.get("source_url") or "https://www.xiaohongshu.com", "User-Agent": USER_AGENT},
                )
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";", 1)[0]
                suffix = mimetypes.guess_extension(content_type) or mimetypes.guess_extension(mimetypes.guess_type(urlparse(image_url).path)[0] or "") or ".jpg"
                if suffix == ".jpe":
                    suffix = ".jpg"
                zip_file.writestr(f"{index:02d}{suffix}", response.content)
            for index, live_photo in enumerate(detail.get("live_photos") or [], start=1):
                video_url = live_photo.get("video")
                if not video_url:
                    continue
                response = await client.get(
                    video_url,
                    headers={"Referer": detail.get("source_url") or "https://www.xiaohongshu.com", "User-Agent": USER_AGENT},
                )
                response.raise_for_status()
                content_type = response.headers.get("content-type", "video/mp4").split(";", 1)[0]
                suffix = mimetypes.guess_extension(content_type) or ".mp4"
                if suffix == ".mp4v":
                    suffix = ".mp4"
                zip_file.writestr(f"live_{index:02d}{suffix}", response.content)
            for index, video_url in enumerate(detail.get("videos") or [], start=1):
                response = await client.get(
                    video_url,
                    headers={"Referer": detail.get("source_url") or "https://www.xiaohongshu.com", "User-Agent": USER_AGENT},
                )
                response.raise_for_status()
                content_type = response.headers.get("content-type", "video/mp4").split(";", 1)[0]
                suffix = mimetypes.guess_extension(content_type) or ".mp4"
                if suffix == ".mp4v":
                    suffix = ".mp4"
                zip_file.writestr(f"video_{index:02d}{suffix}", response.content)
    body = archive.getvalue()
    return Response(
        body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe_note_id}.zip"'},
    )


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8876, reload=False)
