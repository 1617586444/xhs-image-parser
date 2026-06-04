# 小红书详情图片解析服务

独立项目，只做一件事：输入小红书分享文本/短链/详情页链接，返回笔记标题和详情图片链接。

## 安装

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
playwright install chromium
```

## 启动

```powershell
python app.py
```

打开：

```text
http://127.0.0.1:8876/
```

## 测试

```powershell
.\scripts\test.ps1
```

或直接运行：

```powershell
python -m unittest discover -s tests -v
```

## API

```text
GET /api/parse?text=小红书分享文本或链接
```

返回：

```json
{
  "source_url": "保留 xsec_token 的详情页地址",
  "note_id": "笔记 ID",
  "title": "标题",
  "description": "描述",
  "images": ["详情图链接"]
}
```

## 原理

1. 从分享文本中提取 `xhslink.com` 或 `xiaohongshu.com` 链接。
2. 展开短链，保留 `xsec_token`、`xsec_source`、`share_id` 等参数。
3. 用 Playwright 打开详情页。
4. 从页面注入的 `window.__INITIAL_STATE__` 等状态对象里提取 `imageList/imagesList`。
5. 合并 `prv/dft` 重复变体，优先保留 `dft` 详情大图。

小程序/uniapp 建议调用本服务 API，不建议把解析逻辑放到小程序前端。
