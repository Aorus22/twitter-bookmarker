// Cache-freshness policy for the collection list.
//
// `refreshCollectionsIfStale` sits on two render paths — the popup opening and the
// content script entering a route — so its contract is as much about what it does
// *not* do (block, throw, or refresh a fresh cache) as about the request it sends.

import test from "node:test";
import assert from "node:assert/strict";

const storageData = Object.create(null);
const sent = [];
/** What the stubbed worker answers the `LIST_COLLECTIONS` message with. */
let reply = { ok: true, collections: [] };
/** Set to make `sendMessage` reject, as it does when nothing is listening. */
let sendMessageThrows = false;

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        const keys = typeof key === "string" ? [key] : Array.isArray(key) ? key : Object.keys(storageData);
        const out = {};
        for (const name of keys) if (name in storageData) out[name] = structuredClone(storageData[name]);
        return out;
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) storageData[key] = structuredClone(value);
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: {
    lastError: undefined,
    async sendMessage(message) {
      sent.push(message);
      if (sendMessageThrows) throw new Error("no receiver");
      return structuredClone(reply);
    },
  },
};

const { COLLECTIONS_CACHE_KEY, COLLECTIONS_TTL_MS } = await import("../src/shared/constants.ts");
const { refreshCollectionsIfStale } = await import("../src/shared/collections-sync.ts");

const NOW = 1_700_000_000_000;

function reset() {
  for (const key of Object.keys(storageData)) delete storageData[key];
  sent.length = 0;
  reply = { ok: true, collections: [] };
  sendMessageThrows = false;
}

function seedCache(fetchedAt, collections = [{ slug: "linux", name: "Linux", color: "#bf3f2e", order: 0 }]) {
  storageData[COLLECTIONS_CACHE_KEY] = { collections, fetchedAt };
}

test("an empty cache is refreshed once and reported as refreshed", async () => {
  reset();

  assert.equal(await refreshCollectionsIfStale(NOW), true);
  assert.deepEqual(sent, [{ type: "LIST_COLLECTIONS" }]);
});

test("a fresh cache is left alone", async () => {
  reset();
  seedCache(NOW - 1000);

  assert.equal(await refreshCollectionsIfStale(NOW), false);
  assert.deepEqual(sent, [], "no request at all: a page navigation is not a reason to call the backend");
});

test("a stale cache is refreshed", async () => {
  reset();
  seedCache(NOW - COLLECTIONS_TTL_MS);

  assert.equal(await refreshCollectionsIfStale(NOW), true);
  assert.equal(sent.length, 1);
});

test("an unreachable worker is swallowed, not thrown", async () => {
  reset();
  sendMessageThrows = true;

  // The caller is a render path: if this threw, a backend outage would take the
  // organizer down with it instead of showing the cached list.
  assert.equal(await refreshCollectionsIfStale(NOW), true);
});

test("a typed worker failure is swallowed too", async () => {
  reset();
  reply = { ok: false, collections: null, error: "backend_unavailable" };

  assert.equal(await refreshCollectionsIfStale(NOW), true);
});

test("the module itself never writes the cache", async () => {
  reset();
  seedCache(NOW - COLLECTIONS_TTL_MS);

  await refreshCollectionsIfStale(NOW);

  // The worker is the only writer. If this module wrote, a refresh that failed
  // would erase a usable list and every open surface would go blank.
  assert.deepEqual(storageData[COLLECTIONS_CACHE_KEY].collections.map((row) => row.slug), ["linux"]);
  assert.equal(storageData[COLLECTIONS_CACHE_KEY].fetchedAt, NOW - COLLECTIONS_TTL_MS);
});
