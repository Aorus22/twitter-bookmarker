// Service-worker message router tests (SAVE-01/SAVE-02, PRD §25/§21/§39).
//
// Stubs the `chrome.runtime` surface the worker registers on, stubs `fetch`, and
// asserts the worker answers every message with a documented shape — including
// transport failures — and never throws out of the listener.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;

let listener = null;
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: {
      addListener(handler) {
        listener = handler;
      },
    },
  },
};

// The worker registers its listener at import time, so `chrome` must be stubbed
// first.
await import("../src/background/service-worker.ts");

afterEach(() => {
  globalThis.fetch = realFetch;
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

test("GET_SAVED_INDEX resolves the parsed index", async () => {
  const body = { items: { 123456: { url: "u", filename: "linux.csv", saved_at: "t" } } };
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
    filename: "linux.csv",
    tweet: {
      url: "https://x.com/foo/status/123456",
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
    filename: "linux.csv",
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

  captureFetch(() => jsonResponse(400, { error: "bad filename" }));
  assert.deepEqual(await dispatch({ type: "SAVE_TWEET", payload }).response, {
    ok: false,
    error: "invalid_request",
  });
});

test("an unknown message is ignored (returns false, sends nothing)", () => {
  const { returned } = dispatch({ type: "NOT_A_MESSAGE" });
  assert.equal(returned, false);
});
