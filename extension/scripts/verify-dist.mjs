// Post-build verification for the extension `dist/` output.
//
// Proves the three things the roadmap requires of a loadable MV3 bundle:
//   1. `dist/manifest.json` is valid JSON with `manifest_version: 3` and exactly
//      the permitted permissions/hosts;
//   2. every file the manifest (and popup HTML) references exists in `dist/`;
//   3. the PRD §8 slug examples and the fallback regex hold.
//
// Run after `npm run build`:  node scripts/verify-dist.mjs

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FILENAME_PATTERN, isValidFilename, slugifyFilename } from "../src/shared/filename.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const checks = [];
function pass(message) {
  checks.push(message);
  console.log(`  PASS  ${message}`);
}

async function exists(relative) {
  await access(path.join(DIST, relative));
}

async function verifyManifest() {
  const raw = await readFile(path.join(DIST, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw); // throws on invalid JSON — that is the test

  assert.equal(manifest.manifest_version, 3);
  pass("dist/manifest.json parses as JSON and declares manifest_version 3");

  assert.deepEqual(manifest.permissions, ["storage"]);
  pass('permissions are exactly ["storage"]');

  assert.deepEqual(manifest.host_permissions, ["https://x.com/*", "http://127.0.0.1:43121/*"]);
  pass("host_permissions are exactly x.com + 127.0.0.1:43121");

  const forbidden = ["history", "downloads", "bookmarks", "geolocation", "notifications", "tabs", "scripting"];
  for (const permission of forbidden) {
    assert.ok(!manifest.permissions.includes(permission), `forbidden permission present: ${permission}`);
  }
  pass(`no forbidden permissions (${forbidden.join(", ")})`);

  assert.deepEqual(manifest.background, { service_worker: "background/service-worker.js", type: "module" });
  pass("background service worker is an ES module");

  // The Bookmarks timeline moved from /i/bookmarks to /i/history; the manifest
  // match list and the route matcher must agree, or the content script either
  // never loads or never activates. This catches drift between the two.
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://x.com/i/history*",
    "https://x.com/i/bookmarks*",
  ]);
  pass("content script matches the canonical /i/history plus the legacy /i/bookmarks alias");
  const contentBundle = await readFile(
    path.join(DIST, manifest.content_scripts[0].js[0]),
    "utf8",
  );
  for (const route of ["/i/history", "/i/bookmarks"]) {
    assert.ok(contentBundle.includes(route), `content bundle is missing route literal ${route}`);
  }
  pass("content bundle contains both accepted route literals");

  const referenced = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];
  for (const file of referenced) {
    await exists(file);
    pass(`manifest reference exists: dist/${file}`);
  }

  // Popup HTML references its own JS/CSS with relative paths.
  const popupHtml = await readFile(path.join(DIST, manifest.action.default_popup), "utf8");
  const popupDir = path.posix.dirname(manifest.action.default_popup);
  const assets = [...popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => !value.includes("://"));
  assert.ok(assets.length >= 2, "popup.html should reference its css and js");
  for (const asset of assets) {
    await exists(path.posix.join(popupDir, asset));
    pass(`popup.html reference exists: dist/${path.posix.join(popupDir, asset)}`);
  }
}

function verifySlug() {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  assert.equal(slugifyFilename("Linux", id), "linux.csv");
  pass("slug: Linux -> linux.csv");

  assert.equal(slugifyFilename("AI & LLM", id), "ai-llm.csv");
  pass("slug: AI & LLM -> ai-llm.csv");

  assert.equal(slugifyFilename("Read Later", id), "read-later.csv");
  pass("slug: Read Later -> read-later.csv");

  const fallback = slugifyFilename("!!!", id);
  assert.equal(fallback, "category-3f2504e0.csv");
  assert.match(fallback, FILENAME_PATTERN);
  assert.ok(isValidFilename(fallback));
  pass(`slug fallback: "!!!" -> ${fallback} (matches ${FILENAME_PATTERN})`);

  const pathTraversal = slugifyFilename("../../etc/passwd", id);
  assert.match(pathTraversal, FILENAME_PATTERN);
  pass(`slug safety: "../../etc/passwd" -> ${pathTraversal}`);
}

async function verifyPopupCopy() {
  const popupJs = await readFile(path.join(DIST, "popup/popup.js"), "utf8");
  assert.ok(popupJs.includes("Delete category \""));
  assert.ok(popupJs.includes("Existing CSV data will not be deleted."));
  pass("built popup bundle contains the exact delete-confirmation copy");

  const popupHtml = await readFile(path.join(DIST, "popup/popup.html"), "utf8");
  assert.ok(popupHtml.includes("No categories yet"));
  assert.ok(popupHtml.includes("+ Add category"));
  assert.ok(popupHtml.includes("Unbookmark after save"));
  assert.ok(popupHtml.includes("Popover"));
  assert.ok(popupHtml.includes("Inline"));
  pass("built popup markup contains the empty state, add-category, and settings rows");
}

/** Statically prove the popup modules and the popup markup agree on ids/classes. */
async function verifyPopupWiring() {
  const html = await readFile(path.join(DIST, "popup/popup.html"), "utf8");
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  const requiredIds = new Set();
  for (const file of ["category-manager.ts", "settings.ts", "backend-status.ts"]) {
    const source = await readFile(path.join(ROOT, "src/popup", file), "utf8");
    for (const match of source.matchAll(/requireEl<[^>]*>\("([^"]+)"\)/g)) requiredIds.add(match[1]);
  }
  assert.ok(requiredIds.size >= 10, "expected the popup to require several elements");
  for (const id of requiredIds) {
    assert.ok(htmlIds.has(id), `popup.html is missing #${id}`);
  }
  pass(`popup wiring: all ${requiredIds.size} required element ids exist in popup.html`);

  const requiredClasses = [
    "category-row",
    "category-color",
    "category-name",
    "category-name-input",
    "category-filename",
    "category-rename",
    "category-delete",
    "drag-handle",
    "status-text",
    "segmented-option",
  ];
  for (const className of requiredClasses) {
    assert.ok(
      new RegExp(`class="[^"]*\\b${className}\\b`).test(html),
      `popup.html is missing the .${className} element`,
    );
  }
  pass(`popup wiring: all ${requiredClasses.length} required class hooks exist in popup.html`);
}

/** Confirm the settings/status behaviour is actually present in the built bundle. */
async function verifySettingsWiring() {
  const popup = await readFile(path.join(DIST, "popup/popup.js"), "utf8");

  for (const needle of [
    "http://127.0.0.1:43121",
    "/health",
    "1500",
    "AbortController",
    "unbookmarkAfterSave",
    "popover",
    "inline",
    "onStoreChanged",
  ]) {
    assert.ok(popup.includes(needle), `built popup bundle is missing ${JSON.stringify(needle)}`);
  }
  pass("built popup bundle contains the health URL/timeout, both settings, and the store subscription");

  assert.ok(popup.includes("onStoreChanged(render)"), "popup must rerender through onStoreChanged");
  assert.ok(popup.includes("window.confirm"), "delete must use a native confirmation");
  pass("popup bootstrap subscribes to onStoreChanged and delete confirms natively");
}

/** Confirm each bundle was emitted in the format the manifest requires. */
async function verifyBundleFormats() {
  const popup = await readFile(path.join(DIST, "popup/popup.js"), "utf8");
  const content = await readFile(path.join(DIST, "content/content.js"), "utf8");
  const worker = await readFile(path.join(DIST, "background/service-worker.js"), "utf8");

  assert.match(content, /\(\(\)\s*=>\s*\{/, "content script must be an iife");
  assert.match(popup, /\(\(\)\s*=>\s*\{/, "popup bundle must be an iife");
  assert.doesNotMatch(popup, /^\s*(import|export)\s/m, "popup bundle must not use bare ESM syntax");
  assert.match(worker, /chrome\.runtime\.onMessage\.addListener/, "service worker must register the message listener");
  assert.doesNotMatch(worker, /^\s*var .* = require\(/m, "service worker must be ESM, not CommonJS");
  pass("bundle formats are correct (esm worker, iife content + popup)");

  assert.doesNotMatch(worker, /chrome\.storage\.sync/);
  assert.doesNotMatch(popup, /chrome\.storage\.sync/);
  pass("chrome.storage.sync is never referenced");
}

try {
  await verifyManifest();
  verifySlug();
  await verifyPopupCopy();
  await verifyPopupWiring();
  await verifySettingsWiring();
  await verifyBundleFormats();
  console.log(`\nAll ${checks.length} dist checks passed.`);
} catch (error) {
  console.error("\nDIST VERIFICATION FAILED");
  console.error(error);
  process.exitCode = 1;
}
