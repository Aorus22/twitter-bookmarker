// Pure storage helpers: the settings half of `src/shared/storage.ts`.
//
// `normalizeSettings` reads a value out of `chrome.storage.local`, which the user
// can hand-edit and an older build can have written, so it has to survive every
// shape. `combineStore` is the seam: settings are ours, categories are the
// backend's cached list, and this is where the two records become one renderable
// store.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS } from "../src/shared/constants.ts";
import { combineStore, normalizeDisplayMode, normalizeSettings } from "../src/shared/storage.ts";

const PRD_DEFAULT_SETTINGS = {
  unbookmarkAfterSave: false,
  displayMode: "popover",
  backendMode: "localhost",
  backendUrl: "http://127.0.0.1:43121",
  backendToken: "",
};

test("normalizeSettings returns the documented defaults for empty or malformed input", () => {
  for (const raw of [undefined, null, 0, "nope", [], {}, { settings: "nope" }, { settings: [] }]) {
    assert.deepEqual(normalizeSettings(raw), PRD_DEFAULT_SETTINGS, `input ${JSON.stringify(raw)}`);
  }
  assert.deepEqual(DEFAULT_SETTINGS, PRD_DEFAULT_SETTINGS);
});

test("normalizeSettings keeps valid values and clamps invalid ones", () => {
  assert.deepEqual(
    normalizeSettings({
      settings: {
        unbookmarkAfterSave: true,
        displayMode: "inline",
        backendMode: "custom",
        backendUrl: "http://192.168.1.10:8080/",
        backendToken: "  Bearer pasted-from-a-header  ",
      },
    }),
    {
      unbookmarkAfterSave: true,
      displayMode: "inline",
      backendMode: "custom",
      backendUrl: "http://192.168.1.10:8080",
      // The trailing slash is dropped so endpoint paths never double up, and the
      // token is trimmed with its pasted `Bearer ` prefix removed.
      backendToken: "pasted-from-a-header",
    },
  );

  assert.equal(normalizeSettings({ settings: { displayMode: "bogus" } }).displayMode, "popover");
  assert.equal(normalizeSettings({ settings: { backendMode: "bogus" } }).backendMode, "localhost");
  assert.equal(
    normalizeSettings({ settings: { backendMode: "custom", backendUrl: "ftp://server/file" } }).backendUrl,
    "http://127.0.0.1:43121",
    "a non-http(s) URL falls back to the loopback default",
  );
  assert.equal(
    normalizeSettings({ settings: { backendUrl: "http://user:pass@host" } }).backendUrl,
    "http://127.0.0.1:43121",
    "embedded credentials are rejected",
  );
  assert.equal(normalizeSettings({ settings: { backendUrl: "localhost:8080" } }).backendUrl, "http://localhost:8080");
});

test("normalizeDisplayMode clamps to a valid mode", () => {
  assert.equal(normalizeDisplayMode("inline"), "inline");
  assert.equal(normalizeDisplayMode("popover"), "popover");
  assert.equal(normalizeDisplayMode("bogus"), "popover");
  assert.equal(normalizeDisplayMode(undefined), "popover");
});

test("combineStore ignores the categories a v2 record stored", () => {
  // This is the real upgrade: the previous version kept its own category list in
  // the same record. The backend owns that list now, and it already holds every
  // category a save ever created there, so the old array is dropped rather than
  // merged — merging would resurrect a category the user renamed on the phone.
  const store = combineStore(
    {
      version: 2,
      settings: { unbookmarkAfterSave: true, displayMode: "inline" },
      categories: [
        { id: "a", name: "Linux", slug: "linux", color: "#10b981", order: 0 },
        { id: "b", name: "AI & LLM", slug: "ai-llm", color: "#4f46e5", order: 1 },
      ],
    },
    undefined,
  );

  assert.equal(store.version, 3);
  assert.deepEqual(store.categories, [], "the user-owned list is not carried over");
  assert.equal(store.settings.unbookmarkAfterSave, true, "settings still survive the upgrade");
  assert.equal(store.settings.displayMode, "inline");
});

test("combineStore renders the cached backend list, in the backend's order", () => {
  const store = combineStore(
    { settings: { backendMode: "custom", backendUrl: "https://tw-bookmark.example" } },
    {
      fetchedAt: 1_700_000_000_000,
      collections: [
        // Deliberately out of order and with one unusable entry: the mapper sorts
        // by the backend's positions and drops what it cannot use.
        { slug: "read-later", name: "Read Later", color: "", order: 2 },
        { slug: "linux", name: "Linux", color: "#BF3F2E", order: 0 },
        { slug: "broken slug", name: "Never", color: "#000000", order: 1 },
      ],
    },
  );

  assert.deepEqual(
    store.categories.map((category) => [category.slug, category.order]),
    [
      ["linux", 0],
      ["read-later", 2],
    ],
  );
  assert.equal(store.categories[0].color, "#bf3f2e", "colours are lowercased");
  assert.equal(store.categories[0].id, "linux", "the slug doubles as the row identity");
  assert.equal(store.settings.backendUrl, "https://tw-bookmark.example");
});
