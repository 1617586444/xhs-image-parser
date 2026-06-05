# 小红书 / X 静态图片视频解析服务

默认生产版本是 Cloudflare Worker 普通静态解析版：输入小红书分享文本、短链、详情页链接，或 X/Twitter 帖子链接，返回静态公开数据中可见的标题、图片、实况视频和普通视频。

线上地址：

```text
https://xhs-image-parser.aboutyouname.workers.dev
```

## 能力边界

- 可以解析小红书页面静态源码里直接暴露的图片、实况视频和视频地址。
- 可以解析公开 X/Twitter 帖子的图片和视频，优先使用 X 公开 syndication 数据，失败时回退到静态 HTML 媒体 URL。
- 不需要 Cloudflare Workers Paid plan，不使用 Cloudflare Containers。
- 不新增数据库；页面的历史解析记录保存在当前浏览器 `localStorage`。
- 如果小红书返回空详情页、404 中转页，或媒体必须等待浏览器执行 JS 才出现，普通 Worker 版无法解析。
- 如果 X 帖子删除、私密、受限、要求登录，或公开接口不返回媒体，普通 Worker 版无法解析；你登录后复制出来的公开帖子地址可以尝试解析，但登录态不会传给 Worker。
- Python/FastAPI/Playwright 版本保留为备用浏览器增强方案，适合之后部署到 Render 或 Docker 环境处理更复杂页面。

## Worker 开发

```powershell
npm ci
npm run dev
```

部署：

```powershell
npm run deploy
```

主要接口：

```text
GET /api/parse?text=小红书分享文本或链接，或 X/Twitter 帖子链接
GET /api/image?url=小红书或X CDN图片地址&ref=详情页地址
GET /api/video?url=小红书或X CDN视频地址&ref=详情页地址
GET /api/download-image?url=小红书或X CDN图片地址&ref=详情页地址
GET /api/download-video?url=小红书或X CDN视频地址&ref=详情页地址
```

媒体代理接口只允许代理 `xhscdn.com`、`twimg.com` 及其子域名，避免变成开放代理。

示例返回：

```json
{
  "source_url": "https://www.xiaohongshu.com/discovery/item/note123",
  "note_id": "note123",
  "title": "标题",
  "description": "描述",
  "images": ["https://sns-webpic-qc.xhscdn.com/..."],
  "live_photos": [
    {
      "image": "https://sns-webpic-qc.xhscdn.com/...",
      "video": "https://sns-video-alos.xhscdn.com/..."
    }
  ],
  "videos": ["https://sns-video-alos.xhscdn.com/..."]
}
```

X/Twitter 帖子返回同一结构，`source_type` 为 `x`，图片一般来自 `pbs.twimg.com`，视频一般来自 `video.twimg.com`。

## 测试

Worker 测试：

```powershell
npm test
```

备用 Python 服务测试：

```powershell
.\scripts\test.ps1
```

或：

```powershell
python -m unittest discover -s tests -v
```

## 备用浏览器增强方案

仓库仍保留旧的 FastAPI/Playwright 服务：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
python app.py
```

本地打开：

```text
http://127.0.0.1:8876/
```

Docker/Render 相关文件：

- `Dockerfile`
- `render.yaml`
- `app.py`
- `xhs_parser/`

这条路线不是当前默认生产部署，只作为后续需要浏览器执行 JS 时的增强备用方案。
