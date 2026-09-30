// Service-worker message router tests (SAVE-01/SAVE-02, PRD §25/§21/§39/§50).
//
// Stubs the `chrome.runtime` + `chrome.storage.local` surface the worker uses,
// stubs `fetch`, and asserts the worker answers every message with a documented
// shape — including transport failures — and never throws out of the listener.
// The worker resolves its backend address from storage on every message, so the
// stored settings are part of the fixture.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;

let listener = null;
/** Everything in `chrome.storage.local`, keyed the way the extension keys it. */
let records = {};

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: {
      addListener(handler) {
        listener = handler;
      },
    },
  },
  storage: {
    local: {
      async get(key) {
        // Mirror the real API: a string key, a list of keys, or everything. The
        // worker reads settings and the collection cache in one call.
        const keys = typeof key === "string" ? [key] : Array.isArray(key) ? key : Object.keys(records);
        const out = {};
        for (const name of keys) if (name in records) out[name] = structuredClone(records[name]);
        return out;
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) records[key] = structuredClone(value);
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};

/** Persist settings the way the popup would, under the settings key. */
async function storeSettings(settings) {
  await globalThis.chrome.storage.local.set({
    twitterBookmarker: { version: 3, settings },
  });
}

/** The cached collection list the worker writes, read straight from the fake. */
function storedCollections() {
  return records.twitterBookmarkerCollections ?? null;
}

// The worker registers its listener at import time, so `chrome` must be stubbed
// first.
await import("../src/background/service-worker.ts");

afterEach(() => {
  globalThis.fetch = realFetch;
  records = {};
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function captureFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return calls;
}

/** Invoke the registered listener and collect both the sync return and the async response. */
function dispatch(message) {
  let returned;
  const response = new Promise((resolve) => {
    returned = listener(message, {}, (value) => resolve(value));
  });
  return { returned, response };
}

test("HEALTH_CHECK resolves { ok, connected } from GET /health", async () => {
  const calls = captureFetch(() => jsonResponse(200, { status: "ok" }));

  const { returned, response } = dispatch({ type: "HEALTH_CHECK" });
  assert.equal(returned, true, "the channel stays open for the async answer");
  assert.deepEqual(await response, { ok: true, connected: true });
  assert.match(calls[0].url, /\/health$/);
});

test("every request follows the stored backend target (PRD §50)", async () => {
  // Default: no stored settings at all -> the loopback default.
  const localCalls = captureFetch(() => jsonResponse(200, { status: "ok" }));
  await dispatch({ type: "HEALTH_CHECK" }).response;
  assert.equal(localCalls[0].url, "http://127.0.0.1:43121/health");

  // Custom mode -> the user-saved address, base path included.
  await storeSettings({ backendMode: "custom", backendUrl: "https://server.example/tw-bookmarker" });

  const customCalls = captureFetch(() => jsonResponse(200, { status: "ok" }));
  await dispatch({ type: "HEALTH_CHECK" }).response;
  assert.equal(customCalls[0].url, "https://server.example/tw-bookmarker/health");

  const indexCalls = captureFetch(() => jsonResponse(200, { items: {} }));
  await dispatch({ type: "GET_SAVED_INDEX" }).response;
  assert.equal(indexCalls[0].url, "https://server.example/tw-bookmarker/v1/index");

  const saveCalls = captureFetch(() => jsonResponse(201, { status: "saved", tweet_id: "1", url: "u", slug: "s", saved_at: "t" }));
  await dispatch({
    type: "SAVE_TWEET",
    payload: { slug: "s", name: "S", tweet: { url: "u", media: [], author: "a", username: "@a", tweet_date: "t", text: "" } },
  }).response;
  assert.equal(saveCalls[0].url, "https://server.example/tw-bookmarker/v1/bookmarks");

  // A malformed stored URL falls back to loopback rather than failing the request.
  await storeSettings({ backendMode: "custom", backendUrl: "not a url" });
  const fallbackCalls = captureFetch(() => jsonResponse(200, { status: "ok" }));
  await dispatch({ type: "HEALTH_CHECK" }).response;
  assert.equal(fallbackCalls[0].url, "http://127.0.0.1:43121/health");
});

test("a stored token rides along on every message (PRD §50)", async () => {
  // Custom target plus a token: the worker is the only place that talks to the
  // backend, so this is where the credential has to appear.
  await storeSettings({
    backendMode: "custom",
    backendUrl: "https://tw-bookmark.example",
    backendToken: "  Bearer s3cret-token  ",
  });

  const healthCalls = captureFetch(() => jsonResponse(200, { status: "ok" }));
  await dispatch({ type: "HEALTH_CHECK" }).response;
  assert.equal(healthCalls[0].init.headers.Authorization, "Bearer s3cret-token");

  const indexCalls = captureFetch(() => jsonResponse(200, { items: {} }));
  await dispatch({ type: "GET_SAVED_INDEX" }).response;
  assert.equal(indexCalls[0].init.headers.Authorization, "Bearer s3cret-token");

  const saveCalls = captureFetch(
    () => jsonResponse(201, { status: "saved", tweet_id: "1", url: "u", slug: "s", saved_at: "t" }),
  );
  await dispatch({
    type: "SAVE_TWEET",
    payload: {
      slug: "s",
      name: "S",
      tweet: { url: "u", media: [], author: "a", username: "@a", tweet_date: "t", text: "" },
    },
  }).response;
  assert.equal(saveCalls[0].init.headers.Authorization, "Bearer s3cret-token");

  // Switching back to Localhost drops it: that target is never challenged, so
  // sending a secret to it would be pointless traffic.
  await storeSettings({ backendMode: "localhost" });
  const backToLocal = captureFetch(() => jsonResponse(200, { status: "ok" }));
  await dispatch({ type: "HEALTH_CHECK" }).response;
  assert.equal("Authorization" in backToLocal[0].init.headers, false);
});

test("GET_SAVED_INDEX resolves the parsed index", async () => {
  const body = { items: { 123456: { url: "u", slug: "linux", saved_at: "t" } } };
  captureFetch(() => jsonResponse(200, body));

  const { response } = dispatch({ type: "GET_SAVED_INDEX" });
  assert.deepEqual(await response, { ok: true, index: body });
});

test("GET_SAVED_INDEX resolves a typed backend_unavailable failure instead of throwing", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  const { response } = dispatch({ type: "GET_SAVED_INDEX" });
  assert.deepEqual(await response, { ok: false, index: null, error: "backend_unavailable" });
});

test("SAVE_TWEET forwards the payload and resolves 201/409/5xx to typed shapes", async () => {
  const payload = {
    slug: "linux",
    name: "Linux",
    tweet: {
      url: "https://x.com/foo/status/123456",
      media: ["https://pbs.twimg.com/media/AAA.jpg"],
      author: "Foo, Bar",
      username: "@foo",
      tweet_date: "2026-09-27T01:00:00.000Z",
      text: "hi",
    },
  };
  const savedBody = {
    status: "saved",
    tweet_id: "123456",
    url: payload.tweet.url,
    slug: "linux",
    saved_at: "2026-09-27T01:05:00Z",
  };

  let calls = captureFetch(() => jsonResponse(201, savedBody));
  assert.deepEqual(await dispatch({ type: "SAVE_TWEET", payload }).response, {
    ok: true,
    result: savedBody,
  });
  assert.equal(calls[0].url.endsWith("/v1/bookmarks"), true);
  assert.deepEqual(JSON.parse(calls[0].init.body), payload, "the worker forwards the exact payload");

  calls = captureFetch(() => jsonResponse(409, { status: "duplicate", tweet_id: "123456" }));
  assert.deepEqual(await dispatch({ type: "SAVE_TWEET", payload }).response, {
    ok: true,
    duplicate: { status: "duplicate", tweet_id: "123456" },
  });

  captureFetch(() => jsonResponse(500, { error: "boom" }));
  assert.deepEqual(await dispatch({ type: "SAVE_TWEET", payload }).response, {
    ok: false,
    error: "internal",
  });

  captureFetch(() => jsonResponse(400, { error: "bad slug" }));
  assert.deepEqual(await dispatch({ type: "SAVE_TWEET", payload }).response, {
    ok: false,
    error: "invalid_request",
  });
});

test("an unknown message is ignored (returns false, sends nothing)", () => {
  const { returned } = dispatch({ type: "NOT_A_MESSAGE" });
  assert.equal(returned, false);
});

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

/** A wire collection, with the fields the mapper reads spelled out. */
function collection(slug, name, order) {
  return { slug, name, color: "#bf3f2e", order, post_count: 0, media_count: 0, last_saved_at: null, cover_media: [] };
}

test("LIST_COLLECTIONS fetches, caches, and answers with typed rows", async () => {
  const calls = captureFetch(() =>
    jsonResponse(200, {
      // Deliberately out of order: the answer is ordered by the backend's
      // positions, not by the array the response happened to use.
      collections: [collection("read-later", "Read Later", 1), collection("linux", "Linux", 0)],
    }),
  );

  const { response } = dispatch({ type: "LIST_COLLECTIONS" });
  const answer = await response;

  assert.equal(answer.ok, true);
  assert.deepEqual(
    answer.collections.map((category) => [category.slug, category.order]),
    [
      ["linux", 0],
      ["read-later", 1],
    ],
  );
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/collections");

  // The worker is the only writer of the cache, and a reader's request refreshes
  // it — which is how an open timeline learns about a category added elsewhere.
  const cache = storedCollections();
  assert.ok(cache, "the list was cached");
  assert.equal(typeof cache.fetchedAt, "number");
  assert.deepEqual(cache.collections.map((category) => category.slug), ["linux", "read-later"]);
});

test("LIST_COLLECTIONS degrades to a typed failure and leaves the cache alone", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  assert.deepEqual(await dispatch({ type: "LIST_COLLECTIONS" }).response, {
    ok: false,
    collections: null,
    error: "backend_unavailable",
  });
  assert.equal(storedCollections(), null, "a failed read never writes a cache");
});

test("CREATE_COLLECTION posts the name and answers with the refetched list", async () => {
  const calls = captureFetch((url, init) => {
    if (init.method === "POST") {
      return jsonResponse(201, { status: "created", collection: collection("read-later", "Read Later", 0) });
    }
    return jsonResponse(200, { collections: [collection("read-later", "Read Later", 0)] });
  });

  const answer = await dispatch({ type: "CREATE_COLLECTION", name: "Read Later", color: "#BF3F2E" }).response;

  assert.equal(answer.ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/collections");
  assert.equal(calls[0].init.method, "POST");
  // Only the name and colour travel: the backend derives the slug, so the browser
  // cannot disagree with the phone about what the key should be.
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "Read Later", color: "#BF3F2E" });
  assert.deepEqual(calls[1].url, "http://127.0.0.1:43121/v1/collections");
  assert.equal(calls[1].init.method, "GET");
  assert.deepEqual(answer.collections.map((category) => category.slug), ["read-later"]);
  assert.deepEqual(storedCollections().collections.map((category) => category.slug), ["read-later"]);
});

test("CREATE_COLLECTION maps a taken name to conflict", async () => {
  captureFetch(() => jsonResponse(409, { status: "error", reason: "collection already exists" }));

  assert.deepEqual(await dispatch({ type: "CREATE_COLLECTION", name: "Linux" }).response, {
    ok: false,
    collections: null,
    error: "conflict",
  });
});

test("UPDATE_COLLECTION sends only the fields it was given", async () => {
  const calls = captureFetch((url, init) => {
    if (init.method === "PUT") {
      return jsonResponse(200, { status: "updated", collection: collection("linux-bsd", "Linux & BSD", 0) });
    }
    return jsonResponse(200, { collections: [collection("linux-bsd", "Linux & BSD", 0)] });
  });

  const answer = await dispatch({ type: "UPDATE_COLLECTION", slug: "linux", name: "Linux & BSD" }).response;

  assert.equal(answer.ok, true);
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/collections/linux");
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: "Linux & BSD" }, "absent fields stay absent");
  assert.deepEqual(answer.collections.map((category) => category.slug), ["linux-bsd"]);
});

test("UPDATE_COLLECTION escapes the slug and maps 404 to not_found", async () => {
  const calls = captureFetch(() => jsonResponse(404, { status: "error", reason: "collection does not exist" }));

  const answer = await dispatch({ type: "UPDATE_COLLECTION", slug: "a b/c", color: "" }).response;

  assert.equal(answer.error, "not_found");
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/collections/a%20b%2Fc");
  assert.deepEqual(JSON.parse(calls[0].init.body), { color: "" }, "an empty colour is a real instruction");
});

test("REORDER_COLLECTIONS sends the whole order and answers with the backend's list", async () => {
  const calls = captureFetch((url, init) => {
    if (init.method === "PUT") {
      return jsonResponse(200, {
        status: "ordered",
        collections: [collection("design", "Design", 0), collection("linux", "Linux", 1)],
      });
    }
    return jsonResponse(200, { collections: [collection("design", "Design", 0), collection("linux", "Linux", 1)] });
  });

  const answer = await dispatch({ type: "REORDER_COLLECTIONS", slugs: ["design", "linux"] }).response;

  assert.equal(answer.ok, true);
  // One request: the reorder response is already the whole renumbered list.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:43121/v1/collections/order");
  assert.deepEqual(JSON.parse(calls[0].init.body), { slugs: ["design", "linux"] });
  assert.deepEqual(answer.collections.map((category) => category.slug), ["design", "linux"]);
  assert.deepEqual(storedCollections().collections.map((category) => category.slug), ["design", "linux"]);
});

test("a mutation that succeeded but could not be re-read still reports success", async () => {
  // The change is real; only the follow-up read failed. Reporting a failure would
  // invite the user to repeat a change that already happened.
  let call = 0;
  captureFetch(() => {
    call += 1;
    return call === 1
      ? jsonResponse(200, { status: "updated", collection: collection("linux", "Linux", 0) })
      : jsonResponse(503, { error: "unavailable" });
  });

  assert.deepEqual(await dispatch({ type: "UPDATE_COLLECTION", slug: "linux", color: "#000000" }).response, {
    ok: true,
    collections: null,
  });
  assert.equal(storedCollections(), null, "nothing was cached from a failed read");
});

test("every collection message carries the stored token", async () => {
  await storeSettings({
    backendMode: "custom",
    backendUrl: "https://tw-bookmark.example",
    backendToken: "s3cret",
  });

  const calls = captureFetch((url, init) =>
    init.method === "GET"
      ? jsonResponse(200, { collections: [] })
      : jsonResponse(200, { status: "ordered", collections: [] }),
  );

  await dispatch({ type: "LIST_COLLECTIONS" }).response;
  await dispatch({ type: "REORDER_COLLECTIONS", slugs: ["linux"] }).response;

  assert.equal(calls.length, 2, "one list, one reorder");
  for (const call of calls) assert.equal(call.init.headers.Authorization, "Bearer s3cret");
});
