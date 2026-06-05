(function initContentScript() {
  const { normalizeXImageUrl, uniqueMedia } = globalThis.XMediaUtils;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_X_MEDIA") return false;
    sendResponse({ media: scanPageMedia() });
    return false;
  });

  function scanPageMedia() {
    const candidates = [];
    for (const image of document.images) {
      const source = image.currentSrc || image.src;
      const url = normalizeXImageUrl(source);
      if (!url) continue;
      candidates.push({
        url,
        previewUrl: source,
        alt: image.alt || "",
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0,
      });
    }

    for (const link of document.querySelectorAll('a[href*="pbs.twimg.com/media/"]')) {
      const url = normalizeXImageUrl(link.href);
      if (!url) continue;
      candidates.push({
        url,
        previewUrl: url,
        alt: link.textContent?.trim() || "",
        width: 0,
        height: 0,
      });
    }

    return uniqueMedia(candidates);
  }
})();
