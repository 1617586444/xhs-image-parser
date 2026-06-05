chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "DOWNLOAD_X_MEDIA") return false;

  downloadMedia(message.items || [])
    .then((count) => sendResponse({ ok: true, count }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function downloadMedia(items) {
  let count = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item?.url || !item?.filename) continue;
    await chrome.downloads.download({
      url: item.url,
      filename: item.filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    count += 1;
  }
  return count;
}
