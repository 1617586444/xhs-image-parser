# Cloudflare Containers 部署

这个项目依赖 Playwright 浏览器，不能作为普通 Cloudflare Pages 静态站部署。推荐用 Cloudflare Containers。

## 前提

- Cloudflare Workers Paid plan。Containers 文档说明该能力可用于 Paid plan。
- 本机安装 Node.js。
- 登录 Cloudflare：

```powershell
npm install
npx wrangler login
```

## 部署

```powershell
npx wrangler deploy
```

部署后会得到类似：

```text
https://xhs-image-parser.<your-subdomain>.workers.dev
```

接口：

```text
GET /api/parse?text=小红书分享文本或链接
GET /api/download-all?text=小红书分享文本或链接
```

## 注意

- 容器里默认使用临时浏览器资料目录 `/tmp/xhs_browser_profile`。如果小红书对无状态浏览器返回泛首页，云端可能不如本地稳定。
- 更稳定的生产方案是保存带 `xsec_token` 的完整分享链接，避免只用 `explore/{id}`。
- 如需更高并发，可以调大 `wrangler.jsonc` 里的 `max_instances`，但会增加成本。
