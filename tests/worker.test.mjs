import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import worker from "../src/index.js";
import { indexHtml } from "../src/page.js";
import {
  canonicalizeNoteUrl,
  canonicalizeXPostUrl,
  extractXPostId,
  extractXUrl,
  extractXhsUrl,
  extractVideoUrls,
  filterXVideos,
  filterDetailImages,
  isAllowedMediaUrl,
  normalizeXVideoUrl,
  pickBestXVideoVariant,
  xDetailFromVxTwitter,
  xDetailFromSyndication,
} from "../src/parser.js";

test("extractXhsUrl trims Chinese punctuation", () => {
  assert.equal(extractXhsUrl("去看 http://xhslink.com/o/abc123，进入【小红书】"), "http://xhslink.com/o/abc123");
});

test("extractXUrl reads X and Twitter post links", () => {
  const text = "看看 https://x.com/example/status/1234567890?s=20";
  const url = extractXUrl(text);

  assert.equal(url, "https://x.com/example/status/1234567890?s=20");
  assert.equal(extractXPostId(url), "1234567890");
  assert.equal(canonicalizeXPostUrl("https://twitter.com/example/status/1234567890?s=20"), "https://x.com/example/status/1234567890");
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

test("xDetailFromSyndication extracts images and best videos", () => {
  const image = "https://pbs.twimg.com/media/GAbc123.jpg";
  const lowVideo = "https://video.twimg.com/ext_tw_video/1/vid/480x270/low.mp4?tag=10";
  const highVideo = "https://video.twimg.com/ext_tw_video/1/vid/1280x720/high.mp4?tag=10";
  const payload = {
    text: "hello",
    user: { name: "Alice" },
    mediaDetails: [
      { type: "photo", media_url_https: image },
      {
        type: "video",
        media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg",
        video_info: {
          variants: [
            { content_type: "video/mp4", bitrate: 832000, url: lowVideo },
            { content_type: "video/mp4", bitrate: 2176000, url: highVideo },
          ],
        },
      },
    ],
  };

  const detail = xDetailFromSyndication(payload, "https://x.com/alice/status/1", "1");

  assert.deepEqual(detail.images, [`${image}?format=jpg&name=orig`]);
  assert.deepEqual(detail.videos, [highVideo]);
  assert.equal(detail.source_type, "x");
});

test("pickBestXVideoVariant ignores non-mp4 variants", () => {
  assert.equal(
    pickBestXVideoVariant([
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a.m3u8" },
      { content_type: "video/mp4", bitrate: 1, url: "https://video.twimg.com/a.mp4" },
    ]),
    "https://video.twimg.com/a.mp4",
  );
});

test("filterXVideos rejects non-post static asset videos", () => {
  assert.deepEqual(
    filterXVideos([
      "https://abs.twimg.com/videos/grok-4-key-visual.mp4",
      "https://video.twimg.com/ext_tw_video/1/vid/1280x720/post.mp4?tag=10",
    ]),
    ["https://video.twimg.com/ext_tw_video/1/vid/1280x720/post.mp4?tag=10"],
  );
});

test("xDetailFromVxTwitter extracts media URLs", () => {
  const detail = xDetailFromVxTwitter(
    {
      tweetID: "2062557742439502161",
      tweetURL: "https://x.com/HoranicC/status/2062557742439502161",
      text: "放松",
      mediaURLs: ["https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg"],
      media_extended: [
        {
          type: "image",
          url: "https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg",
          thumbnail_url: "https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg",
        },
      ],
    },
    "https://x.com/i/status/2062557742439502161",
    "2062557742439502161",
  );

  assert.deepEqual(detail.images, ["https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg?format=jpg&name=orig"]);
  assert.deepEqual(detail.videos, []);
  assert.equal(detail.parser_source, "vxtwitter");
});

test("normalizeXVideoUrl accepts only video.twimg.com mp4", () => {
  assert.equal(normalizeXVideoUrl("https://video.twimg.com/ext_tw_video/1/vid/720x720/a.mp4?tag=10"), "https://video.twimg.com/ext_tw_video/1/vid/720x720/a.mp4?tag=10");
  assert.equal(normalizeXVideoUrl("https://abs.twimg.com/videos/grok-4-key-visual.mp4"), "");
});

test("index page includes history and media controls", () => {
  const html = indexHtml();

  assert.match(html, /历史解析/);
  assert.match(html, /小红书 \/ X 图片视频解析/);
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

test("media allowlist accepts Xiaohongshu and X CDN URLs only", () => {
  assert.equal(isAllowedMediaUrl("https://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040a!nd_dft_wlteh_jpg_3"), true);
  assert.equal(isAllowedMediaUrl("http://sns-video-alos.xhscdn.com/stream/a.mp4"), true);
  assert.equal(isAllowedMediaUrl("https://pbs.twimg.com/media/GAbc123.jpg?format=jpg&name=orig"), true);
  assert.equal(isAllowedMediaUrl("https://video.twimg.com/ext_tw_video/1/vid/1280x720/a.mp4"), true);
  assert.equal(isAllowedMediaUrl("https://example.com/a.jpg"), false);
  assert.equal(isAllowedMediaUrl("javascript:alert(1)"), false);
});

test("parse endpoint returns clear error for missing input", async () => {
  const response = await worker.fetch(new Request("https://worker.test/api/parse?text="));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { detail: "没有从输入中识别到可解析链接。" });
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
