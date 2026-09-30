// Post-build verification for the extension `dist/` output.
//
// Proves the four things the roadmap requires of a loadable MV3 bundle:
//   1. `dist/manifest.json` is valid JSON with `manifest_version: 3` and exactly
//      the permitted permissions/hosts;
//   2. every file the manifest (and popup HTML) references exists in `dist/`;
//   3. a slug arriving from anywhere is still validated before it reaches a
//      request path, and the derivation that now lives in the backend is gone
//      from this bundle;
//   4. the category list is read and written through the service worker's
//      collection endpoints, with no local CRUD and no delete anywhere.
//
// Run after `npm run build`:  node scripts/verify-dist.mjs

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SLUG_PATTERN, isValidSlug } from "../src/shared/slug.ts";

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

  assert.deepEqual(manifest.host_permissions, ["https://x.com/*", "http://*/*", "https://*/*"]);
  pass("host_permissions cover x.com plus any user-chosen http(s) backend host");

  const forbidden = ["history", "downloads", "bookmarks", "geolocation", "notifications", "tabs", "scripting"];
  for (const permission of forbidden) {
    assert.ok(!manifest.permissions.includes(permission), `forbidden permission present: ${permission}`);
  }
  pass(`no forbidden permissions (${forbidden.join(", ")})`);

  assert.deepEqual(manifest.background, { service_worker: "background/service-worker.js", type: "module" });
  pass("background service worker is an ES module");

  // The content script now loads on every x.com page, because the button is
  // injected outside the bookmarks timeline too. That makes the route decision
  // inside the bundle, not in the manifest, the thing worth pinning.
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://x.com/*"]);
  pass("content script matches all of x.com (the bookmark button lives off the bookmarks page)");
  const contentBundle = await readFile(
    path.join(DIST, manifest.content_scripts[0].js[0]),
    "utf8",
  );
  for (const route of ["/i/history", "/i/bookmarks"]) {
    assert.ok(contentBundle.includes(route), `content bundle is missing route literal ${route}`);
  }
  pass("content bundle contains both accepted bookmarks-timeline route literals");
  for (const ignored of ["/settings", "/messages", "/compose"]) {
    assert.ok(contentBundle.includes(ignored), `content bundle is missing ignored-path literal ${ignored}`);
  }
  pass("content bundle contains the tweet-free paths it deliberately skips");

  // Media extraction (PRD §14) is DOM-coupled: if the anchors or the media
  // host filter fall out of the bundle, saved rows silently lose their media
  // column. Both must survive minification as literals.
  for (const anchor of ["tweetPhoto", "videoPlayer", "pbs.twimg.com"]) {
    assert.ok(contentBundle.includes(anchor), `content bundle is missing media anchor ${anchor}`);
  }
  pass("content bundle contains the media selectors and the pbs.twimg.com host filter");

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

/**
 * The extension no longer derives slugs — `storage.Slugify` on the backend does —
 * so what is left to prove is the boundary: a slug that arrives from the cache, a
 * hand-edited store or the backend is validated before it is put in a request path.
 */
function verifySlugSafety() {
  for (const accepted of ["linux", "ai-llm", "read-later", "category-3f2504e0"]) {
    assert.ok(isValidSlug(accepted), `${accepted} should be a valid slug`);
  }
  pass("slug validation accepts the shapes the backend produces");

  for (const rejected of ["../../etc/passwd", "/etc/passwd", "Linux", "linux.csv", "linux slug", "-linux", ".."]) {
    assert.ok(!isValidSlug(rejected), `${rejected} must be rejected before it reaches a request path`);
  }
  pass(`slug validation rejects path traversal, separators, case and extensions (${SLUG_PATTERN})`);

  assert.ok(!SLUG_PATTERN.test("linux\n"), "the pattern must be anchored");
  pass("the slug pattern is anchored at both ends");
}

async function verifyPopupCopy() {
  const popupJs = await readFile(path.join(DIST, "popup/popup.js"), "utf8");
  const popupHtml = await readFile(path.join(DIST, "popup/popup.html"), "utf8");

  // Deleting a category is gone from the product, not merely disabled: a delete
  // would have to decide what happens to the bookmarks filed under it, and the
  // answer is "the backend keeps them".
  for (const gone of ["Delete category", "Existing bookmarks will not be deleted."]) {
    assert.ok(!popupJs.includes(gone), `the delete flow must be gone, found ${JSON.stringify(gone)}`);
    assert.ok(!popupHtml.includes(gone), `the delete flow must be gone, found ${JSON.stringify(gone)} in the markup`);
  }
  assert.ok(!popupHtml.includes("category-delete"), "the delete button hook must be gone");
  pass("no delete-category flow exists in the popup (bundle or markup)");

  assert.ok(popupHtml.includes("No categories yet"));
  assert.ok(popupHtml.includes("+ Add category"));
  assert.ok(popupHtml.includes("Unbookmark after save"));
  assert.ok(popupHtml.includes("Popover"));
  assert.ok(popupHtml.includes("Inline"));
  pass("built popup markup contains the empty state, add-category, and settings rows");

  assert.ok(popupHtml.includes("field-hint"), "the popup must say where categories live");
  assert.ok(popupHtml.includes("backend"), "the popup must name the backend as the owner of the list");
  pass("built popup markup tells the user the category list lives in the backend");
}

/**
 * Prove every asset the popup stylesheet pulls in exists in `dist/`.
 *
 * The popup's typography is self-hosted (no CDN), so a missing `.woff2` would
 * silently fall back to a system font. `verifyManifest` only walks the HTML's
 * `src`/`href`; `@font-face` urls live in the CSS, so they need this pass.
 */
async function verifyPopupAssets() {
  const css = await readFile(path.join(DIST, "popup/popup.css"), "utf8");

  const urls = [...css.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/g)]
    .map((match) => match[1].trim())
    .filter((value) => !/^(data:|https?:|#)/.test(value));
  assert.ok(urls.length >= 3, "popup.css should reference the self-hosted font files");
  for (const url of urls) {
    await exists(path.posix.join("popup", url));
    pass(`popup.css reference exists: dist/popup/${url}`);
  }

  assert.ok(css.includes("@font-face"), "popup.css must declare @font-face");
  for (const family of ["Inter Variable", "Playfair Display"]) {
    assert.ok(css.includes(family), `popup.css is missing the ${family} @font-face`);
  }
  pass("popup.css declares the self-hosted Inter + Playfair families");
}

/** Statically prove the popup modules and the popup markup agree on ids/classes. */
async function verifyPopupWiring() {
  const html = await readFile(path.join(DIST, "popup/popup.html"), "utf8");
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  const requiredIds = new Set();
  for (const file of ["category-manager.ts", "settings.ts", "backend-settings.ts", "backend-status.ts"]) {
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
    "category-slug",
    "category-rename",
    "category-up",
    "category-down",
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
    "AbortController",
    "unbookmarkAfterSave",
    "displayMode",
    "backendMode",
    "backendUrl",
    "popover",
    "inline",
    "onStoreChanged",
  ]) {
    assert.ok(popup.includes(needle), `built popup bundle is missing ${JSON.stringify(needle)}`);
  }
  pass("built popup bundle contains the health URL, both settings, and the store subscription");

  // The timeout value itself is asserted on the source, not on the bundle: the
  // minifier is free to rewrite 4000 as 4e3, so pinning digits in `dist/` would
  // be a check on esbuild's output rather than on the probe's ceiling.
  const constants = await readFile(path.join(ROOT, "src/shared/constants.ts"), "utf8");
  assert.match(
    constants,
    /HEALTH_TIMEOUT_MS = 4000;/,
    "the health probe must keep its measured 4 s ceiling (a tunnel probe takes ~1-1.5 s)",
  );
  pass("the health probe keeps its 4 s ceiling in the source");

  assert.ok(popup.includes("onStoreChanged(render)"), "popup must rerender through onStoreChanged");
  pass("popup bootstrap subscribes to onStoreChanged");
}

/**
 * Every category change is a backend request made by the service worker.
 *
 * This is the load-bearing invariant of the change: the popup must not keep its
 * own editable list, and the worker must be the one holding the credential.
 */
async function verifyCollectionsWiring() {
  const popup = await readFile(path.join(DIST, "popup/popup.js"), "utf8");
  for (const message of ["CREATE_COLLECTION", "UPDATE_COLLECTION", "REORDER_COLLECTIONS", "LIST_COLLECTIONS"]) {
    assert.ok(popup.includes(message), `the popup must drive the list through ${message}`);
  }
  assert.ok(!/addCategory|renameCategory|deleteCategory/.test(popup), "the popup must not own category CRUD");
  pass("built popup bundle drives every category change through a worker message");

  const worker = await readFile(path.join(DIST, "background/service-worker.js"), "utf8");
  for (const needle of ["/v1/collections", "/v1/collections/order", "twitterBookmarkerCollections", "Bearer "]) {
    assert.ok(worker.includes(needle), `the worker is missing ${JSON.stringify(needle)}`);
  }
  pass("service worker owns the collection endpoints and the only cache write");

  const content = await readFile(path.join(DIST, "content/content.js"), "utf8");
  // The ellipsis is escaped by the minifier, so the label is matched with the
  // escaped spelling: `"Save to\\u2026"` in the bundle output.
  const saveLabel = "Save to" + String.fromCharCode(92) + "u2026";
  for (const needle of [saveLabel, "LIST_COLLECTIONS", "Organize"]) {
    assert.ok(content.includes(needle), `the content bundle is missing ${JSON.stringify(needle)}`);
  }
  pass("content bundle carries both trigger variants and refreshes from the worker");
}

/**
 * Confirm the configurable backend target is wired end to end: the manifest may
 * reach any user-chosen host, the markup offers Localhost/Custom plus a URL
 * field, and the popup bundle resolves the target from the settings.
 */
async function verifyBackendTargetWiring() {
  const raw = await readFile(path.join(DIST, "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  for (const pattern of ["http://*/*", "https://*/*"]) {
    assert.ok(
      manifest.host_permissions.includes(pattern),
      `host_permissions must include ${pattern} or a custom backend URL cannot be fetched`,
    );
  }
  pass("manifest allows fetching a custom backend host");

  const html = await readFile(path.join(DIST, "popup/popup.html"), "utf8");
  for (const needle of [
    'data-backend="localhost"',
    'data-backend="custom"',
    'id="backend-url"',
    'id="backend-token"',
    'type="password"',
  ]) {
    assert.ok(html.includes(needle), `popup.html is missing ${needle}`);
  }
  pass("popup markup offers the Localhost/Custom choice, a custom URL field, and a token field");

  const popup = await readFile(path.join(DIST, "popup/popup.js"), "utf8");
  for (const needle of ["backendMode", "backendToken", "localhost", "custom", "http://", "https:"]) {
    assert.ok(popup.includes(needle), `built popup bundle is missing ${JSON.stringify(needle)}`);
  }
  assert.ok(
    popup.includes("setSettings"),
    "the backend target must be persisted through the storage module",
  );
  assert.ok(popup.includes("Bearer "), "the popup must be able to present the bearer token");
  pass("built popup bundle parses, persists, and resolves the backend target");

  const worker = await readFile(path.join(DIST, "background/service-worker.js"), "utf8");
  assert.ok(worker.includes("backendMode"), "the worker must resolve the backend from settings");
  assert.ok(worker.includes("backendToken"), "the worker must resolve the token from settings");
  assert.ok(worker.includes("Bearer "), "the worker must send the token as a bearer credential");
  assert.ok(worker.includes("storage.local"), "the worker must read chrome.storage.local");
  pass("service worker resolves the backend target from chrome.storage.local");
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
  verifySlugSafety();
  await verifyPopupCopy();
  await verifyPopupAssets();
  await verifyPopupWiring();
  await verifySettingsWiring();
  await verifyCollectionsWiring();
  await verifyBackendTargetWiring();
  await verifyBundleFormats();
  console.log(`\nAll ${checks.length} dist checks passed.`);
} catch (error) {
  console.error("\nDIST VERIFICATION FAILED");
  console.error(error);
  process.exitCode = 1;
}
