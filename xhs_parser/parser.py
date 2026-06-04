import html
import re
import os
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

XHS_URL_RE = re.compile(r"https?://(?:www\.)?xiaohongshu\.com/[^\s<>\"'，。；！？】）)]+", re.IGNORECASE)
XHS_SHORT_URL_RE = re.compile(r"https?://(?:www\.)?xhslink\.com/[^\s<>\"'，。；！？】）)]+", re.IGNORECASE)

SHARE_QUERY_KEYS = {
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
}

BLOCKED_IMAGE_TOKENS = (
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
)


@dataclass
class ParserSettings:
    browser_profile_dir: Path = Path(
        os.getenv("XHS_BROWSER_PROFILE_DIR")
        or (
            "../xhs_image_crawler/data/browser_profile"
            if Path("../xhs_image_crawler/data/browser_profile").exists()
            else "data/browser_profile"
        )
    )
    browser_executable_path: Path | None = None
    timeout_seconds: float = 30
    headless: bool = True


async def parse_note_from_text(text: str, settings: ParserSettings | None = None) -> dict:
    note_url = await resolve_note_url(text)
    if not note_url:
        raise ValueError("没有从输入中识别到小红书文章链接。")
    return await parse_note_url(note_url, settings=settings)


async def resolve_note_url(text: str) -> str:
    direct_url = extract_xhs_url(text)
    if not direct_url:
        return ""
    direct_note_id = extract_note_id(direct_url)
    if "xiaohongshu.com" in direct_url and direct_note_id:
        return canonicalize_note_url(direct_url)
    if "xhslink.com" not in direct_url:
        return ""

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=15,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        response = await client.get(direct_url)
        redirect_url = response.headers.get("location") or ""
        final_url = str(response.url)

    for candidate in (redirect_url, final_url):
        if "xiaohongshu.com" in candidate and extract_note_id(candidate):
            return canonicalize_note_url(candidate)
    return ""


async def parse_note_url(note_url: str, settings: ParserSettings | None = None) -> dict:
    static_detail = await extract_static_note_detail(note_url)
    if static_detail.get("images") or static_detail.get("live_photos") or static_detail.get("videos"):
        return static_detail

    settings = settings or ParserSettings()
    profile_dir = settings.browser_profile_dir.expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        context_kwargs = {
            "headless": settings.headless,
            "viewport": {"width": 1366, "height": 900},
            "locale": "zh-CN",
            "timezone_id": "Asia/Shanghai",
            "user_agent": USER_AGENT,
        }
        executable_path = settings.browser_executable_path or find_browser_executable()
        if executable_path:
            context_kwargs["executable_path"] = str(executable_path)

        context = await launch_persistent_context_with_fallback(
            playwright,
            profile_dir,
            context_kwargs,
        )
        try:
            page = await context.new_page()
            page.set_default_timeout(settings.timeout_seconds * 1000)
            resolved_url = await open_note_page(page, note_url)
            note_id = extract_note_id(resolved_url) or extract_note_id(note_url)
            detail = await extract_state_note_detail(page, note_id)
            images = detail.get("images") or await extract_visible_note_images(page)
            await raise_if_bad_detail_page(page, has_images=bool(images))
            return {
                "source_url": resolved_url,
                "note_id": note_id,
                "title": detail.get("title") or await page.title(),
                "description": detail.get("description") or "",
                "images": images,
                "live_photos": detail.get("live_photos") or [],
                "videos": detail.get("videos") or [],
            }
        finally:
            await context.close()


async def extract_static_note_detail(note_url: str) -> dict:
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=20,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        response = await client.get(note_url)
        response.raise_for_status()

    resolved_url = canonicalize_note_url(str(response.url)) or str(response.url)
    note_id = extract_note_id(resolved_url) or extract_note_id(note_url)
    page_text = html.unescape(response.text).replace("\\u002F", "/").replace("\\/", "/")
    note = extract_initial_state_note(page_text, note_id)
    if note:
        images, live_photos = extract_note_media(note)
        live_video_urls = {item.get("video") for item in live_photos}
        videos = [
            video
            for video in extract_video_urls_from_value(note)
            if video and video not in live_video_urls
        ]
        if images or live_photos or videos:
            return {
                "source_url": resolved_url,
                "note_id": note_id,
                "title": note.get("title") or note.get("displayTitle") or "",
                "description": note.get("desc") or note.get("description") or "",
                "images": images,
                "live_photos": live_photos,
                "videos": videos,
            }

    urls = re.findall(r"https?://[^\"'<>\s)]+", page_text)
    images = filter_detail_images(urls, require_size=False)
    video_urls = extract_live_photo_video_urls(page_text)
    live_photos = pair_live_photos(images, video_urls)
    live_video_urls = {item.get("video") for item in live_photos}
    videos = [video for video in video_urls if video not in live_video_urls]
    return {
        "source_url": resolved_url,
        "note_id": note_id,
        "title": extract_json_field_near_note(page_text, note_id, "title")
        or extract_json_field_near_note(page_text, note_id, "displayTitle")
        or extract_meta_content(page_text, "og:title"),
        "description": extract_json_field_near_note(page_text, note_id, "desc")
        or extract_meta_content(page_text, "description"),
        "images": images,
        "live_photos": live_photos,
        "videos": videos,
    }


def extract_initial_state_note(text: str, note_id: str) -> dict:
    marker = "window.__INITIAL_STATE__="
    start = text.find(marker)
    if start < 0:
        return {}
    start += len(marker)
    decoder = json.JSONDecoder()
    try:
        state, _ = decoder.raw_decode(text[start:])
    except json.JSONDecodeError:
        return {}
    note_store = state.get("note") if isinstance(state, dict) else {}
    detail_map = note_store.get("noteDetailMap") if isinstance(note_store, dict) else {}
    detail = detail_map.get(note_id) if isinstance(detail_map, dict) else {}
    note = detail.get("note") if isinstance(detail, dict) else {}
    return note if isinstance(note, dict) else {}


def extract_note_media(note: dict) -> tuple[list[str], list[dict]]:
    images: list[str] = []
    live_photos: list[dict] = []
    for item in note.get("imageList") or []:
        if not isinstance(item, dict):
            continue
        image_url = select_image_url(item)
        if image_url:
            images.extend(filter_detail_images([image_url], require_size=False))
        video_url = select_live_photo_video_url(item)
        if video_url:
            live_photos.append({"image": image_url, "video": video_url})
    return filter_detail_images(images, require_size=False), dedupe_live_photos(live_photos)


def select_image_url(item: dict) -> str:
    for key in ("urlDefault", "url", "urlPre"):
        value = str(item.get(key) or "").strip()
        if value and filter_detail_images([value], require_size=False):
            return value
    for info in item.get("infoList") or []:
        if not isinstance(info, dict):
            continue
        if info.get("imageScene") == "WB_DFT":
            value = str(info.get("url") or "").strip()
            if value and filter_detail_images([value], require_size=False):
                return value
    return ""


def select_live_photo_video_url(item: dict) -> str:
    if not item.get("livePhoto"):
        return ""
    stream = item.get("stream") or {}
    if not isinstance(stream, dict):
        return ""
    for codec in ("h264", "h265", "h266", "av1"):
        variants = stream.get(codec) or []
        if not variants:
            continue
        first = variants[0] if isinstance(variants[0], dict) else {}
        master_url = str(first.get("masterUrl") or "").strip()
        if master_url:
            return master_url
        backup_urls = first.get("backupUrls") or []
        if backup_urls:
            return str(backup_urls[0] or "").strip()
    return ""


def dedupe_live_photos(items: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for item in items:
        video = item.get("video") or ""
        if not video or video in seen:
            continue
        seen.add(video)
        deduped.append(item)
    return deduped


def extract_live_photo_video_urls(text: str) -> list[str]:
    urls = re.findall(r'"masterUrl":"(https?://[^"]+?\.mp4(?:\?[^"]+)?)"', text)
    if not urls:
        urls = re.findall(r"https?://[^\"'<>\s)]+\.mp4(?:\?[^\"'<>\s)]+)?", text)
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def pair_live_photos(images: list[str], videos: list[str]) -> list[dict]:
    live_photos: list[dict] = []
    for index, video in enumerate(videos[: len(images)]):
        image = images[index]
        live_photos.append({"image": image, "video": video})
    return live_photos


def extract_video_urls_from_value(value) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str):
        if ".mp4" in value and value.startswith(("http://", "https://")):
            urls.append(value)
        return urls
    if isinstance(value, list):
        for item in value:
            urls.extend(extract_video_urls_from_value(item))
        return dedupe_urls(urls)
    if not isinstance(value, dict):
        return urls
    for key in ("masterUrl", "backupUrl", "url"):
        child = value.get(key)
        if isinstance(child, str) and ".mp4" in child and child.startswith(("http://", "https://")):
            urls.append(child)
    for key in ("backupUrls", "stream", "video", "media", "h264", "h265", "h266", "av1"):
        if key in value:
            urls.extend(extract_video_urls_from_value(value[key]))
    return dedupe_urls(urls)


def dedupe_urls(urls: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def extract_json_field_near_note(text: str, note_id: str, field: str) -> str:
    if not note_id:
        return ""
    note_index = text.find(f'"noteId":"{note_id}"')
    if note_index < 0:
        return ""
    window = text[note_index : note_index + 50000]
    match = re.search(rf'"{re.escape(field)}":"((?:\\.|[^"\\])*)"', window)
    if not match:
        return ""
    try:
        return json.loads(f'"{match.group(1)}"').strip()
    except json.JSONDecodeError:
        return match.group(1).strip()


def extract_meta_content(text: str, name: str) -> str:
    pattern = rf'<meta\s+(?:name|property)="{re.escape(name)}"\s+content="([^"]*)"'
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return ""
    value = html.unescape(match.group(1)).strip()
    if name == "og:title" and value.endswith(" - 小红书"):
        value = value[: -len(" - 小红书")].strip()
    return value


async def launch_persistent_context_with_fallback(playwright, profile_dir: Path, context_kwargs: dict):
    try:
        return await playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            **context_kwargs,
        )
    except Exception:
        temp_profile_dir = Path(tempfile.mkdtemp(prefix="xhs-browser-profile-"))
        return await playwright.chromium.launch_persistent_context(
            user_data_dir=str(temp_profile_dir),
            **context_kwargs,
        )


def extract_xhs_url(text: str) -> str:
    match = XHS_URL_RE.search(text) or XHS_SHORT_URL_RE.search(text)
    if not match:
        return ""
    return sanitize_extracted_url(match.group(0))


def extract_note_id(url: str) -> str:
    parsed = urlparse(url)
    segments = [segment for segment in parsed.path.split("/") if segment]
    for index, segment in enumerate(segments):
        if segment == "explore" and index + 1 < len(segments):
            return segments[index + 1]
        if segment == "item" and index > 0 and segments[index - 1] == "discovery" and index + 1 < len(segments):
            return segments[index + 1]
    return ""


def canonicalize_note_url(url: str) -> str:
    note_id = extract_note_id(url)
    if not note_id:
        return ""
    parsed = urlparse(url)
    query_items = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.startswith("xsec_") or key in SHARE_QUERY_KEYS
    ]
    query = urlencode(query_items)
    base = f"https://www.xiaohongshu.com/discovery/item/{note_id}"
    return f"{base}?{query}" if query else base


async def open_note_page(page, note_url: str) -> str:
    note_id = extract_note_id(note_url)
    candidates = build_note_url_candidates(note_url)
    last_error = None
    for candidate in candidates:
        try:
            await page.goto(candidate, wait_until="domcontentloaded")
            await wait_for_page_settle(page)
            if await page_is_note_available(page):
                return canonicalize_note_url(page.url) or canonicalize_note_url(candidate) or candidate
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue
    if last_error:
        raise last_error
    raise RuntimeError(f"详情页暂时无法读取：{note_id}")


def build_note_url_candidates(note_url: str) -> list[str]:
    note_id = extract_note_id(note_url)
    candidates: list[str] = []

    def push(url: str) -> None:
        if url and url not in candidates:
            candidates.append(url)

    push(note_url)
    if note_id:
        push(f"https://www.xiaohongshu.com/explore/{note_id}")
        push(f"https://www.xiaohongshu.com/discovery/item/{note_id}")
    return candidates


async def page_is_note_available(page) -> bool:
    lowered = page.url.lower()
    if "/404" in lowered:
        return False
    try:
        body_text = await page.locator("body").inner_text(timeout=3000)
    except Exception:  # noqa: BLE001
        body_text = ""
    bad_markers = ("当前笔记暂时无法浏览", "页面不存在", "not found")
    return not any(marker in body_text.lower() for marker in bad_markers)


async def raise_if_bad_detail_page(page, has_images: bool) -> None:
    try:
        body_text = await page.locator("body").inner_text(timeout=3000)
    except Exception:  # noqa: BLE001
        body_text = ""
    login_markers = ("登录后推荐更懂你的笔记", "小红书如何扫码", "手机号登录", "验证码登录", "扫码登录")
    if any(marker in body_text for marker in login_markers) and not has_images:
        raise RuntimeError("当前页面未进入可解析的笔记详情页。")
    if "当前笔记暂时无法浏览" in body_text or "页面不存在" in body_text:
        raise RuntimeError("当前笔记暂时无法浏览或不存在。")


async def extract_state_note_detail(page, note_id: str) -> dict:
    detail = await page.evaluate(
        """
        (noteId) => {
          const roots = [
            window.__INITIAL_STATE__,
            window.__INITIAL_DATA__,
            window.__NUXT__,
            window.__APOLLO_STATE__,
          ].filter(Boolean);
          const isObject = value => value && typeof value === 'object';
          const imageKeys = new Set(['imageList', 'imagesList', 'image_list', 'images', 'image', 'urlDefault', 'urlPre', 'url_default', 'url_pre', 'url', 'src']);
          const titleKeys = ['title', 'displayTitle', 'noteTitle'];
          const descKeys = ['desc', 'description', 'content'];

          function collectUrls(value, out = []) {
            if (!value) return out;
            if (typeof value === 'string') {
              if (/^https?:\\/\\//.test(value) && /(xhscdn|sns-webpic|sns-img|xhs)/i.test(value)) out.push(value);
              return out;
            }
            if (Array.isArray(value)) {
              for (const item of value) collectUrls(item, out);
              return out;
            }
            if (!isObject(value)) return out;
            for (const [key, child] of Object.entries(value)) {
              if (imageKeys.has(key) || /image|url|src/i.test(key)) collectUrls(child, out);
            }
            return out;
          }

          function findText(value, keys) {
            if (!isObject(value)) return '';
            for (const key of keys) {
              const text = value[key];
              if (typeof text === 'string' && text.trim()) return text.trim();
            }
            return '';
          }

          const candidates = [];
          const seen = new WeakSet();
          function visit(value, depth = 0) {
            if (!isObject(value) || seen.has(value) || depth > 12) return;
            seen.add(value);
            const urls = collectUrls(value, []);
            if (urls.length) {
              const ownNoteId = value.noteId || value.note_id || value.id || value.note_id_str;
              const serialized = noteId ? JSON.stringify(value).slice(0, 200000) : '';
              let score = 0;
              if (noteId && ownNoteId === noteId) score += 80;
              if (noteId && serialized.includes(noteId)) score += 40;
              if (value.imageList || value.imagesList || value.image_list) score += 30;
              if (findText(value, titleKeys)) score += 8;
              if (findText(value, descKeys)) score += 4;
              score += Math.min(urls.length, 20);
              candidates.push({ score, urls, title: findText(value, titleKeys), description: findText(value, descKeys) });
            }
            for (const child of Object.values(value)) visit(child, depth + 1);
          }

          for (const root of roots) visit(root);
          candidates.sort((a, b) => b.score - a.score);
          return candidates[0] || { urls: [], title: '', description: '' };
        }
        """,
        note_id,
    )
    return {
        "title": detail.get("title") or "",
        "description": detail.get("description") or "",
        "images": filter_detail_images(detail.get("urls") or [], require_size=False),
    }


async def extract_visible_note_images(page) -> list[str]:
    candidates = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('img')).map(img => {
          const rect = img.getBoundingClientRect();
          return {
            src: img.currentSrc || img.src,
            naturalWidth: img.naturalWidth || 0,
            naturalHeight: img.naturalHeight || 0,
            width: Math.round(rect.width || img.clientWidth || 0),
            height: Math.round(rect.height || img.clientHeight || 0),
            alt: img.alt || '',
            className: typeof img.className === 'string' ? img.className : '',
            parentClass: img.parentElement && typeof img.parentElement.className === 'string' ? img.parentElement.className : ''
          };
        })
        """
    )
    return filter_detail_images(candidates or [], require_size=True)


def filter_detail_images(items: list, require_size: bool = True) -> list[str]:
    by_key: dict[str, str] = {}
    for item in items:
        if isinstance(item, str):
            raw_url = item
            natural_width = natural_height = width = height = 0
            alt = class_name = parent_class = ""
        else:
            raw_url = str(item.get("src") or "").strip()
            natural_width = int(item.get("naturalWidth") or 0)
            natural_height = int(item.get("naturalHeight") or 0)
            width = int(item.get("width") or 0)
            height = int(item.get("height") or 0)
            alt = str(item.get("alt") or "")
            class_name = str(item.get("className") or "")
            parent_class = str(item.get("parentClass") or "")

        normalized = normalize_image_url(raw_url)
        if not is_detail_image_url(normalized):
            continue
        if not looks_like_detail_image(natural_width, natural_height, width, height, alt, class_name, parent_class, require_size):
            continue
        image_key = image_identity_key(normalized)
        existing = by_key.get(image_key)
        if existing and image_variant_score(existing) >= image_variant_score(normalized):
            continue
        by_key[image_key] = normalized
    return list(by_key.values())


def normalize_image_url(url: str) -> str:
    url = url.strip()
    if ");" in url:
        url = url.split(");", 1)[0]
    for suffix in ("?imageView2", "?x-oss-process", "?imageMogr2"):
        if suffix in url:
            return url.split(suffix, 1)[0]
    return url


def is_detail_image_url(url: str) -> bool:
    lowered = url.lower()
    if not url.startswith(("http://", "https://")) or any(token in lowered for token in BLOCKED_IMAGE_TOKENS):
        return False
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if any(
        marker in path
        for marker in ("/notes_pre_post/", "/notes_uhdr/", "/note_pre_post_uhdr/", "/spectrum/")
    ):
        return True
    return host.startswith("sns-webpic") and "!nd_" in path and path.endswith(("_jpg_3", "_webp_3"))


def looks_like_detail_image(
    natural_width: int,
    natural_height: int,
    width: int,
    height: int,
    alt: str,
    class_name: str,
    parent_class: str,
    require_size: bool = True,
) -> bool:
    text = " ".join((alt, class_name, parent_class)).lower()
    if any(token in text for token in BLOCKED_IMAGE_TOKENS):
        return False
    long_edge = max(natural_width, natural_height, width, height)
    short_edge = max(
        min(natural_width, natural_height) if natural_width and natural_height else 0,
        min(width, height) if width and height else 0,
    )
    if require_size and (not long_edge or not short_edge):
        return False
    return not ((long_edge and long_edge < 320) or (short_edge and short_edge < 180))


def image_identity_key(url: str) -> str:
    path = urlparse(url).path
    if "!" in path:
        path = path.split("!", 1)[0]
    filename = path.rsplit("/", 1)[-1]
    if filename.startswith("1040"):
        return filename
    for marker in ("/notes_pre_post/", "/notes_uhdr/", "/note_pre_post_uhdr/", "/spectrum/"):
        if marker in path:
            return marker + path.split(marker, 1)[1]
    return path


def image_variant_score(url: str) -> int:
    lowered = url.lower()
    if "!nd_dft" in lowered or "!nc_n" in lowered:
        return 30
    if "!nd_prv" in lowered:
        return 10
    return 20


async def wait_for_page_settle(page, timeout_ms: int = 12000) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        await page.wait_for_timeout(1500)


def sanitize_extracted_url(url: str) -> str:
    cleaned = url.strip().strip("<>\"'[](){}").rstrip(".,;!?，。；！？")
    while cleaned:
        parsed = urlparse(cleaned)
        if not parsed.query:
            break
        if cleaned[-1] in ".!,;?，。；！？":
            cleaned = cleaned[:-1]
            continue
        break
    return cleaned


def find_browser_executable() -> Path | None:
    candidates = [
        Path.home() / "AppData" / "Local" / "ms-playwright" / "chromium-1181" / "chrome-win" / "chrome.exe",
        Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
        Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
        Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None
