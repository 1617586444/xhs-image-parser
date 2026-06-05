import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = process.cwd();
const extensionDir = path.join(root, "chrome-extension");

function loadMediaUtils() {
  const code = fs.readFileSync(path.join(extensionDir, "media-utils.js"), "utf8");
  const context = { URL, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(code, context);
  return context.XMediaUtils;
}

test("chrome extension manifest is MV3 and scoped to X pages", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["activeTab", "downloads"]);
  assert.ok(manifest.content_scripts[0].matches.includes("https://x.com/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://twitter.com/*"));
  assert.ok(manifest.host_permissions.includes("https://pbs.twimg.com/*"));
});

test("media utils normalize X image URLs to orig", () => {
  const { normalizeXImageUrl } = loadMediaUtils();

  assert.equal(
    normalizeXImageUrl("https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg?format=jpg&name=small"),
    "https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg?format=jpg&name=orig",
  );
  assert.equal(
    normalizeXImageUrl("https://pbs.twimg.com/profile_images/avatar.jpg"),
    "",
  );
  assert.equal(
    normalizeXImageUrl("https://example.com/media/HJ-rnV3akAA23Vi.jpg"),
    "",
  );
});

test("media utils produce stable download filenames", () => {
  const { imageFileName } = loadMediaUtils();

  assert.equal(
    imageFileName("https://pbs.twimg.com/media/HJ-rnV3akAA23Vi.jpg?format=jpg&name=orig", 3),
    "x-media/03_HJ-rnV3akAA23Vi.jpg",
  );
});
