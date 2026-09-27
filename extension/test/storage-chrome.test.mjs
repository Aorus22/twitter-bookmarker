// Storage contract tests: drive `src/shared/storage.ts` against an in-memory
// stand-in for `chrome.storage.local` and a `fetch` spy.
//
// These prove the extension-side invariants the popup depends on:
//   - first run yields the documented defaults (false / "popover");
//   - every CRUD operation persists under ONE chrome.storage.local key;
//   - rename recomputes `filename` without touching storage keys or the backend;
//   - delete removes the category only and renumbers order;
//   - reorder rewrites `order` to 0..n-1;
//   - NO category operation performs a network request (PRD §9, §10, §45–§49).

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

const { STORAGE_KEY } = await import("../src/shared/constants.ts");
const storage = await import("../src/shared/storage.ts");

function resetStorage() {
  for (const key of Object.keys(storageData)) delete storageData[key];
}

function stored() {
  return storageData[STORAGE_KEY];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("first run yields PRD defaults under the single storage key", async () => {
  resetStorage();

  const store = await storage.getStore();
  assert.equal(store.version, 1);
  assert.deepEqual(store.settings, { unbookmarkAfterSave: false, displayMode: "popover" });
  assert.deepEqual(store.categories, []);
  assert.deepEqual(await storage.getSettings(), { unbookmarkAfterSave: false, displayMode: "popover" });
  assert.deepEqual(await storage.getCategories(), []);
  assert.equal(stored(), undefined, "reads never write");
});

test("addCategory generates an id, slug filename, and appended order", async () => {
  resetStorage();

  const linux = await storage.addCategory({ name: "Linux", color: "#4f46e5" });
  assert.match(linux.id, /^[0-9a-f-]{36}$/);
  assert.equal(linux.name, "Linux");
  assert.equal(linux.filename, "linux.csv");
  assert.equal(linux.color, "#4f46e5");
  assert.equal(linux.order, 0);

  const ai = await storage.addCategory({ name: "AI & LLM", color: "#0ea5e9" });
  const readLater = await storage.addCategory({ name: "Read Later", color: "not-a-color" });
  assert.equal(ai.filename, "ai-llm.csv");
  assert.equal(ai.order, 1);
  assert.equal(readLater.filename, "read-later.csv");
  assert.equal(readLater.order, 2);
  assert.equal(readLater.color, "#4f46e5", "invalid colors fall back to the default");

  const store = await storage.getStore();
  assert.deepEqual(
    store.categories.map((c) => c.id),
    [linux.id, ai.id, readLater.id],
  );
  assert.equal(Object.keys(storageData).length, 1, "everything lives under one key");
  assert.equal(Object.keys(storageData)[0], STORAGE_KEY);
});

test("addCategory rejects empty and duplicate names without writing", async () => {
  resetStorage();
  await storage.addCategory({ name: "Linux", color: "#4f46e5" });
  const before = JSON.stringify(stored());

  await assert.rejects(() => storage.addCategory({ name: "   ", color: "#000000" }), /required/);
  await assert.rejects(() => storage.addCategory({ name: "  linux ", color: "#000000" }), /already exists/);

  assert.equal(JSON.stringify(stored()), before, "rejected adds leave storage untouched");
});

test("rename recomputes filename, keeps the id, and never touches the backend", async () => {
  resetStorage();
  fetchCalls.length = 0;

  const linux = await storage.addCategory({ name: "Linux", color: "#4f46e5" });
  const renamed = await storage.updateCategoryName(linux.id, "Linux Stuff");

  assert.equal(renamed.id, linux.id, "id is stable across renames");
  assert.equal(renamed.name, "Linux Stuff");
  assert.equal(renamed.filename, "linux-stuff.csv");

  const [persisted] = (await storage.getCategories()).filter((c) => c.id === linux.id);
  assert.equal(persisted.filename, "linux-stuff.csv");
  assert.equal(fetchCalls.length, 0, "no backend request during rename");

  // Still a single key, and the old filename only survives as a derived value that
  // was replaced — nothing creates or renames a CSV.
  assert.equal(Object.keys(storageData).length, 1);
});

test("rename rejects duplicates and unknown ids", async () => {
  resetStorage();
  await storage.addCategory({ name: "Linux", color: "#4f46e5" });
  const ai = await storage.addCategory({ name: "AI", color: "#4f46e5" });

  await assert.rejects(() => storage.updateCategoryName(ai.id, "linux"), /already exists/);
  await assert.rejects(() => storage.updateCategoryName("does-not-exist", "Whatever"), /not found/);
});

test("updateCategoryColor only changes the UI colour", async () => {
  resetStorage();
  const linux = await storage.addCategory({ name: "Linux", color: "#4f46e5" });

  const updated = await storage.updateCategoryColor(linux.id, "#ABCDEF");
  assert.equal(updated.color, "#abcdef");
  assert.equal(updated.filename, "linux.csv", "colour never affects filename");

  const missing = await storage.updateCategoryColor("nope", "#000000");
  assert.equal(missing, null);
});

test("reorderCategories rewrites order to 0..n-1 and persists it", async () => {
  resetStorage();
  const a = await storage.addCategory({ name: "Apple", color: "#4f46e5" });
  const b = await storage.addCategory({ name: "Banana", color: "#4f46e5" });
  const c = await storage.addCategory({ name: "Cherry", color: "#4f46e5" });

  const reordered = await storage.reorderCategories([c.id, a.id, b.id]);
  assert.deepEqual(
    reordered.map((category) => [category.name, category.order]),
    [
      ["Cherry", 0],
      ["Apple", 1],
      ["Banana", 2],
    ],
  );

  const persisted = await storage.getCategories();
  assert.deepEqual(
    persisted.map((category) => [category.name, category.order]),
    [
      ["Cherry", 0],
      ["Apple", 1],
      ["Banana", 2],
    ],
  );
});

test("deleteCategory removes only that category and renumbers the rest", async () => {
  resetStorage();
  fetchCalls.length = 0;

  const a = await storage.addCategory({ name: "Apple", color: "#4f46e5" });
  const b = await storage.addCategory({ name: "Banana", color: "#4f46e5" });
  const c = await storage.addCategory({ name: "Cherry", color: "#4f46e5" });

  await storage.deleteCategory(b.id);

  const remaining = await storage.getCategories();
  assert.deepEqual(
    remaining.map((category) => [category.name, category.order]),
    [
      ["Apple", 0],
      ["Cherry", 1],
    ],
  );
  assert.ok(!remaining.some((category) => category.id === b.id));
  assert.equal(fetchCalls.length, 0, "delete performs no backend call");
  assert.equal(Object.keys(storageData).length, 1, "no second storage key is introduced");
  assert.ok(a.id && c.id);
});

test("setSettings merges partial updates over the defaults", async () => {
  resetStorage();

  assert.deepEqual(await storage.setSettings({ unbookmarkAfterSave: true }), {
    unbookmarkAfterSave: true,
    displayMode: "popover",
  });

  assert.deepEqual(await storage.setSettings({ displayMode: "inline" }), {
    unbookmarkAfterSave: true,
    displayMode: "inline",
  });

  assert.deepEqual(await storage.getSettings(), { unbookmarkAfterSave: true, displayMode: "inline" });

  // An unknown mode cannot corrupt storage.
  assert.equal((await storage.setSettings({ displayMode: "bogus" })).displayMode, "popover");
});

test("getStore tolerates malformed storage instead of throwing", async () => {
  resetStorage();
  storageData[STORAGE_KEY] = { version: "one", settings: "nope", categories: [{ name: "orphan" }] };

  const store = await storage.getStore();
  assert.equal(store.version, 1);
  assert.deepEqual(store.settings, { unbookmarkAfterSave: false, displayMode: "popover" });
  assert.deepEqual(store.categories, [], "entries without an id are dropped, not crashed on");
});

test("onStoreChanged fires only for the local area and only for the store key", async () => {
  resetStorage();
  const seen = [];
  const unsubscribe = storage.onStoreChanged((store) => seen.push(store));
  assert.equal(changeListeners.length, 1);

  // Wrong area.
  for (const listener of changeListeners) listener({ [STORAGE_KEY]: { newValue: {} } }, "sync");
  await tick();
  assert.equal(seen.length, 0, "sync-area changes are ignored");

  // Wrong key in the local area.
  for (const listener of changeListeners) listener({ somethingElse: { newValue: 1 } }, "local");
  await tick();
  assert.equal(seen.length, 0, "unrelated keys are ignored");

  // Real change.
  await storage.setSettings({ unbookmarkAfterSave: true });
  for (const listener of changeListeners) listener({ [STORAGE_KEY]: { newValue: stored() } }, "local");
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].settings.unbookmarkAfterSave, true);

  unsubscribe();
  assert.equal(changeListeners.length, 0, "unsubscribe removes the listener");
});
