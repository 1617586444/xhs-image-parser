(function initMediaUtils(globalScope) {
  function normalizeXImageUrl(rawUrl) {
    if (!rawUrl) return "";
    const cleaned = String(rawUrl).replaceAll("&amp;", "&").replaceAll("\\/", "/");
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.toLowerCase() !== "pbs.twimg.com") return "";
      if (!parsed.pathname.startsWith("/media/")) return "";

      const format = parsed.searchParams.get("format") || inferFormat(parsed.pathname);
      parsed.search = "";
      parsed.searchParams.set("format", format);
      parsed.searchParams.set("name", "orig");
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function inferFormat(pathname) {
    const extension = String(pathname).split(".").pop().toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) {
      return extension === "jpeg" ? "jpg" : extension;
    }
    return "jpg";
  }

  function imageFileName(url, index) {
    const parsed = new URL(url);
    const id = parsed.pathname.split("/").pop().replace(/\.[a-z0-9]+$/i, "") || `image_${index}`;
    const format = parsed.searchParams.get("format") || inferFormat(parsed.pathname);
    return `x-media/${String(index).padStart(2, "0")}_${safeName(id)}.${format}`;
  }

  function safeName(value) {
    return String(value).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  }

  function uniqueMedia(items) {
    return [...new Map(items.filter(Boolean).map((item) => [item.url, item])).values()];
  }

  globalScope.XMediaUtils = {
    imageFileName,
    normalizeXImageUrl,
    uniqueMedia,
  };
})(globalThis);
