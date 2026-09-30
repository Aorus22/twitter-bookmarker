// Storage contract tests: drive `src/shared/storage.ts` against an in-memory
// stand-in for `chrome.storage.local` and a `fetch` spy.
//
// These prove the extension-side invariants the popup and the worker depend on:
//   - first run yields the documented defaults (false / "popover");
//   - settings persist under {@link STORAGE_KEY} and the collection cache under a
//     second key, so a category refresh cannot overwrite a setting;
//   - the category list is read from the cache and never written by a reader;
//   - NO function in this module performs a network request (PRD §7, §9, §50).

import test from "node:test";
import assert from "node:assert/strict";

const storageData = Object.create(null);
const changeListeners = [];
const fetchCalls = [];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") {
          return key in storageData ? { [key]: clone(storageData[key]) } : {};
        }
        if (Array.isArray(key)) {
          const out = {};
          for (const k of key) if (k in storageData) out[k] = clone(storageData[k]);
          return out;
        }
        return clone({ ...storageData });
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) storageData[key] = clone(value);
      },
    },
    onChanged: {
      addListener(listener) {
        changeListeners.push(listener);
      },
      removeListener(listener) {
        const index = changeListeners.indexOf(listener);
        if (index >= 0) changeListeners.splice(index, 1);
      },
    },
  },
};

globalThis.fetch = (...args) => {
  fetchCalls.push(args);
  return Promise.reject(new Error("fetch must never be called by the storage module"));
};

const { STORAGE_KEY, COLLECTIONS_CACHE_KEY } = await import("../src/shared/constants.ts");
const storage = await import("../src/shared/storage.ts");

function resetStorage() {
  for (const key of Object.keys(storageData)) delete storageData[key];
}

function storedSettings() {
  return storageData[STORAGE_KEY];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const PRD_DEFAULT_SETTINGS = {
  unbookmarkAfterSave: false,
  displayMode: "popover",
  backendMode: "localhost",
  backendUrl: "http://127.0.0.1:43121",
  backendToken: "",
};

test("first run yields defaults and writes nothing", async () => {
  resetStorage();

  const store = await storage.getStore();
  assert.equal(store.version, 3);
  assert.deepEqual(store.settings, PRD_DEFAULT_SETTINGS);
  assert.deepEqual(store.categories, []);
  assert.deepEqual(await storage.getSettings(), PRD_DEFAULT_SETTINGS);
  assert.deepEqual(await storage.getCategories(), []);
  assert.deepEqual(await storage.getCollectionsCache(), { categories: [], fetchedAt: 0 });
  assert.deepEqual(Object.keys(storageData), [], "reads never write");
});

test("setSettings writes only the settings key", async () => {
  resetStorage();

  await storage.writeCollectionsCache([{ id: "linux", slug: "linux", name: "Linux", color: "#bf3f2e", order: 0 }], 1234);
  const settings = await storage.setSettings({ unbookmarkAfterSave: true, displayMode: "inline" });

  assert.equal(settings.unbookmarkAfterSave, true);
  assert.equal(settings.displayMode, "inline");
  assert.deepEqual(await storage.getSettings(), settings, "the write is persisted, not just returned");

  // Two keys, two owners. Saving a setting must not disturb the cached list, or a
  // popup write would look like a category change to every open timeline.
  assert.deepEqual(Object.keys(storageData).sort(), [COLLECTIONS_CACHE_KEY, STORAGE_KEY].sort());
  assert.equal(storedSettings().version, 3);
  const cache = await storage.getCollectionsCache();
  assert.equal(cache.fetchedAt, 1234);
  assert.deepEqual(cache.categories.map((c) => c.slug), ["linux"]);
  assert.equal(fetchCalls.length, 0, "persistence never performs a network request");
});

test("setSettings merges partial updates over the defaults", async () => {
  resetStorage();

  assert.deepEqual(await storage.setSettings({ unbookmarkAfterSave: true }), {
    ...PRD_DEFAULT_SETTINGS,
    unbookmarkAfterSave: true,
  });
  assert.deepEqual(await storage.setSettings({ displayMode: "inline" }), {
    ...PRD_DEFAULT_SETTINGS,
    unbookmarkAfterSave: true,
    displayMode: "inline",
  });
  // An unknown mode cannot corrupt storage.
  assert.equal((await storage.setSettings({ displayMode: "bogus" })).displayMode, "popover");
});

test("setSettings stores a normalized custom backend URL and a trimmed token", async () => {
  resetStorage();

  const settings = await storage.setSettings({
    backendMode: "custom",
    backendUrl: "  192.168.1.10:8080/  ",
    backendToken: "  Bearer paste-from-a-header  ",
  });
  assert.equal(settings.backendUrl, "http://192.168.1.10:8080", "scheme is defaulted and the slash dropped");
  assert.equal(settings.backendToken, "paste-from-a-header", "trimmed, with the pasted prefix dropped");
  assert.deepEqual(await storage.getSettings(), settings);

  // Back to Localhost: the custom URL is remembered but no longer used.
  const loopback = await storage.setSettings({ backendMode: "localhost" });
  assert.equal(loopback.backendMode, "localhost");
  assert.equal(loopback.backendUrl, "http://192.168.1.10:8080");

  // An unusable URL keeps the previous value rather than clearing it, and a
  // partial update that says nothing about the token keeps the saved one.
  assert.equal((await storage.setSettings({ backendUrl: "ftp://nope" })).backendUrl, "http://192.168.1.10:8080");
  assert.equal((await storage.setSettings({ backendMode: "nonsense" })).backendMode, "localhost");
  assert.equal((await storage.setSettings({})).backendToken, "paste-from-a-header");

  // An empty string is a real value: it means "send no Authorization header".
  assert.equal((await storage.setSettings({ backendToken: "   " })).backendToken, "");
});

test("writeCollectionsCache stores the mapped list and its timestamp", async () => {
  resetStorage();

  await storage.writeCollectionsCache(
    [
      { id: "read-later", slug: "read-later", name: "Read Later", color: "", order: 1 },
      { id: "linux", slug: "linux", name: "Linux", color: "#bf3f2e", order: 0 },
    ],
    99,
  );

  const cache = await storage.getCollectionsCache();
  assert.equal(cache.fetchedAt, 99);
  assert.deepEqual(
    cache.categories.map((category) => [category.slug, category.order]),
    [
      ["linux", 0],
      ["read-later", 1],
    ],
  );

  const store = await storage.getStore();
  assert.deepEqual(store.categories.map((category) => category.slug), ["linux", "read-later"]);
  // The cache is not a place settings hide: reading it must not have created the
  // settings key.
  assert.equal(storedSettings(), undefined);
});

test("getStore tolerates malformed storage instead of throwing", async () => {
  resetStorage();
  storageData[STORAGE_KEY] = { version: "one", settings: "nope", categories: [{ name: "orphan" }] };
  storageData[COLLECTIONS_CACHE_KEY] = "not an object";

  const store = await storage.getStore();
  assert.equal(store.version, 3);
  assert.deepEqual(store.settings, PRD_DEFAULT_SETTINGS);
  assert.deepEqual(store.categories, []);
});

test("a cache missing its timestamp reads as stale rather than fresh", async () => {
  resetStorage();
  storageData[COLLECTIONS_CACHE_KEY] = {
    collections: [{ slug: "linux", name: "Linux", color: "#bf3f2e", order: 0 }],
  };

  const cache = await storage.getCollectionsCache();
  assert.equal(cache.categories.length, 1, "a usable list is still rendered");
  assert.equal(cache.fetchedAt, 0, "but it is treated as needing a refetch");
});

test("onStoreChanged fires for either key in the local area only", async () => {
  resetStorage();
  const seen = [];
  const unsubscribe = storage.onStoreChanged((store) => seen.push(store));
  assert.equal(changeListeners.length, 1);

  const fire = (changes, area) => {
    for (const listener of changeListeners) listener(changes, area);
  };

  fire({ [STORAGE_KEY]: { newValue: {} } }, "sync");
  await tick();
  assert.equal(seen.length, 0, "sync-area changes are ignored");

  fire({ somethingElse: { newValue: 1 } }, "local");
  await tick();
  assert.equal(seen.length, 0, "unrelated keys are ignored");

  await storage.setSettings({ unbookmarkAfterSave: true });
  fire({ [STORAGE_KEY]: { newValue: storedSettings() } }, "local");
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].settings.unbookmarkAfterSave, true);

  // A refreshed collection list is a render trigger too: the injected category
  // buttons have to pick up a category added on the phone without a reload.
  await storage.writeCollectionsCache(
    [{ id: "linux", slug: "linux", name: "Linux", color: "#bf3f2e", order: 0 }],
    7,
  );
  fire({ [COLLECTIONS_CACHE_KEY]: { newValue: storageData[COLLECTIONS_CACHE_KEY] } }, "local");
  await tick();
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1].categories.map((category) => category.slug), ["linux"]);

  unsubscribe();
  assert.equal(changeListeners.length, 0, "unsubscribe removes the listener");
});
