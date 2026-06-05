import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import worker from "../src/index.js";
import { indexHtml } from "../src/page.js";
import {
  canonicalizeNoteUrl,
  extractXhsUrl,
  extractVideoUrls,
  filterDetailImages,
  isAllowedXhsMediaUrl,
} from "../src/parser.js";

test("extractXhsUrl trims Chinese punctuation", () => {
  assert.equal(extractXhsUrl("去看 http://xhslink.com/o/abc123，进入【小红书】"), "http://xhslink.com/o/abc123");
});

test("canonicalizeNoteUrl preserves share query only", () => {
  const url = "https://www.xiaohongshu.com/explore/note123?xsec_token=tok&share_id=share&unused=drop";

  assert.equal(
    canonicalizeNoteUrl(url),
    "https://www.xiaohongshu.com/discovery/item/note123?xsec_token=tok&share_id=share",
  );
});

test("filterDetailImages dedupes variants and blocks assets", () => {
  const prv = "http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040abc!nd_prv_wlteh_jpg_3";
  const dft = "http://sns-webpic-qc.xhscdn.com/b/notes_uhdr/1040abc!nd_dft_wlteh_jpg_3";
  const staticAsset = "https://fe-static.xhscdn.com/app.js";

  assert.deepEqual(filterDetailImages([prv, staticAsset, dft]), [dft]);
});

test("extractVideoUrls dedupes equivalent CDN host variants", () => {
  const preferred = "http://sns-video-alos.xhscdn.com/stream/1/10/19/video_19.mp4?sign=1";
  const backup = "http://sns-bak-v8.xhscdn.com/stream/1/10/19/video_19.mp4";
  const text = `"masterUrl":"${preferred}","backupUrl":"${backup}"`;

  assert.deepEqual(extractVideoUrls(text), [preferred]);
});

test("index page includes history and media controls", () => {
  const html = indexHtml();

  assert.match(html, /历史解析/);
  assert.match(html, /localStorage/);
  assert.match(html, /识别剪切板/);
  assert.match(html, /清空输入/);
  assert.match(html, /navigator\.clipboard\.readText/);
  assert.match(html, /\/api\/download-image/);
  assert.match(html, /\/api\/download-video/);
});

test("index page inline script is valid JavaScript", () => {
  const html = indexHtml();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);

  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
});

test("media allowlist accepts only Xiaohongshu CDN URLs", () => {
  assert.equal(isAllowedXhsMediaUrl("https://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040a!nd_dft_wlteh_jpg_3"), true);
  assert.equal(isAllowedXhsMediaUrl("http://sns-video-alos.xhscdn.com/stream/a.mp4"), true);
  assert.equal(isAllowedXhsMediaUrl("https://example.com/a.jpg"), false);
  assert.equal(isAllowedXhsMediaUrl("javascript:alert(1)"), false);
});

test("parse endpoint returns clear error for missing input", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/parse?text="));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { detail: "没有从输入中识别到小红书文章链接。" });
});

test("media proxy rejects non-XHS CDN URL before fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };

  try {
    const response = await worker.fetch(new Request("https://worker.test/api/image?url=https%3A%2F%2Fexample.com%2Fa.jpg"));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { detail: "media url is not allowed" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
