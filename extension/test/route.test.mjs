// Route matcher + SPA route-watcher tests (XI-01, XI-02).
//
// The matcher is a pure function, so it gets an exhaustive table. The watcher is
// driven through an injected RouteEnv so `pushState`/`replaceState`/`popstate`
// and the interval fallback are all exercised without a browser.
//
// `tweetPageMode` is the second half of the contract: the bookmarks timeline is
// organized, every other page that shows tweets gets our own bookmark button, and
// a handful of tweet-free screens get nothing at all.

import test from "node:test";
import assert from "node:assert/strict";

import {
  IGNORED_PATH_PREFIXES,
  ROUTE_POLL_INTERVAL_MS,
  isBookmarksRoute,
  isIgnoredRoute,
  tweetPageMode,
  watchRoute,
  watchRouteKey,
} from "../src/content/route.ts";

test("isBookmarksRoute accepts /i/history (canonical) with trailing slash/query/origin", () => {
  const accepted = [
    "/i/history",
    "/i/history/",
    "/i/history?foo=1",
    "/i/history/?x=1&y=2",
    "/i/history#section",
    "https://x.com/i/history",
    "https://x.com/i/history/",
    "https://x.com/i/history/?a=b#c",
  ];
  for (const pathname of accepted) {
    assert.equal(isBookmarksRoute(pathname), true, `expected ${pathname} to be accepted`);
  }
});

test("isBookmarksRoute still accepts the legacy /i/bookmarks alias", () => {
  const accepted = [
    "/i/bookmarks",
    "/i/bookmarks/",
    "/i/bookmarks?foo=1",
    "/i/bookmarks/?x=1&y=2",
    "/i/bookmarks#section",
    "https://x.com/i/bookmarks",
    "https://x.com/i/bookmarks/",
    "https://x.com/i/bookmarks/?a=b#c",
  ];
  for (const pathname of accepted) {
    assert.equal(isBookmarksRoute(pathname), true, `expected ${pathname} to be accepted`);
  }
});

test("isBookmarksRoute rejects every excluded route", () => {
  const rejected = [
    "/",
    "/home",
    "/explore",
    "/notifications",
    "/messages",
    "/ada",
    "/ada/status/1234567890",
    "/i/lists",
    "/i/lists/123",
    "/search?q=typescript",
    "/i/history-extra",
    "/i/history/extra",
    "/i/histor",
    "/i/bookmarks-extra",
    "/i/bookmarks/extra",
    "/i/bookmark",
    "/bookmarks",
    "https://x.com/home",
    "",
  ];
  for (const pathname of rejected) {
    assert.equal(isBookmarksRoute(pathname), false, `expected ${pathname} to be rejected`);
  }
});

test("ROUTE_POLL_INTERVAL_MS is a low-frequency fallback", () => {
  assert.ok(ROUTE_POLL_INTERVAL_MS >= 250 && ROUTE_POLL_INTERVAL_MS <= 2000);
});

/** A controllable RouteEnv: mutate location, then call the watcher hooks. */
function createEnv(pathname) {
  const listeners = new Map();
  let intervalHandler = null;
  let intervalCleared = false;

  const location = { pathname, href: `https://x.com${pathname}` };

  function applyUrl(url) {
    if (typeof url !== "string" || url.length === 0) return;
    const pathnamePart = url.startsWith("http") ? new URL(url).pathname : url.split(/[?#]/)[0];
    location.pathname = pathnamePart || "/";
    location.href = url.startsWith("http") ? url : `https://x.com${url}`;
  }

  const env = {
    location,
    history: {
      pushState(_data, _unused, url) {
        applyUrl(url);
      },
      replaceState(_data, _unused, url) {
        applyUrl(url);
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setInterval(handler) {
      intervalHandler = handler;
      return 7;
    },
    clearInterval() {
      intervalCleared = true;
      intervalHandler = null;
    },
  };

  return {
    env,
    navigate(url) {
      applyUrl(url);
    },
    pop() {
      listeners.get("popstate")?.();
    },
    tick() {
      intervalHandler?.();
    },
    listenerCount() {
      return listeners.size;
    },
    intervalCleared() {
      return intervalCleared;
    },
  };
}

test("watchRoute reports enter/leave exactly once per transition", () => {
  const harness = createEnv("/i/bookmarks");
  const events = [];
  const stop = watchRoute(
    () => events.push("enter"),
    () => events.push("leave"),
    { env: harness.env },
  );

  assert.deepEqual(events, ["enter"], "the current route is reported immediately");

  harness.env.history.pushState({}, "", "https://x.com/home");
  assert.deepEqual(events, ["enter", "leave"]);

  harness.env.history.pushState({}, "", "https://x.com/i/bookmarks");
  assert.deepEqual(events, ["enter", "leave", "enter"]);

  // Repeated same-route ticks and popstate never duplicate a callback.
  harness.pop();
  harness.tick();
  harness.env.history.replaceState({}, "", "https://x.com/i/bookmarks");
  assert.deepEqual(events, ["enter", "leave", "enter"]);

  // A raw location change bypassing history is caught by the interval fallback.
  harness.navigate("https://x.com/explore");
  harness.tick();
  assert.deepEqual(events, ["enter", "leave", "enter", "leave"]);

  stop();
  assert.equal(harness.listenerCount(), 0, "stop removes the popstate listener");
  assert.equal(harness.intervalCleared(), true, "stop clears the interval");

  // After stop the watcher is inert even though history is patched back.
  harness.env.history.pushState({}, "", "https://x.com/i/bookmarks");
  assert.deepEqual(events, ["enter", "leave", "enter", "leave"]);
});

test("watchRoute starting off-route reports leave first and resumes on arrival", () => {
  const harness = createEnv("/home");
  const events = [];
  watchRoute(
    () => events.push("enter"),
    () => events.push("leave"),
    { env: harness.env },
  );

  assert.deepEqual(events, ["leave"]);
  harness.env.history.pushState({}, "", "https://x.com/i/bookmarks/");
  assert.deepEqual(events, ["leave", "enter"]);
  harness.navigate("https://x.com/explore");
  harness.pop();
  assert.deepEqual(events, ["leave", "enter", "leave"]);
});

/* -------------------------------------------------------------------------- */
/* Which surface a route needs                                                */
/* -------------------------------------------------------------------------- */

test("tweetPageMode selects the organizer on the bookmarks timeline", () => {
  for (const pathname of ["/i/history", "/i/history/", "/i/bookmarks", "https://x.com/i/bookmarks/?a=b"]) {
    assert.equal(tweetPageMode(pathname), "bookmarks", pathname);
  }
});

test("tweetPageMode selects our own button everywhere else that shows tweets", () => {
  const timeline = [
    "/home",
    "/",
    "/explore",
    "/notifications",
    "/search?q=linux",
    "/Aorus22",
    "/Aorus22/status/1234567890",
    "/Aorus22/with_replies",
    "/i/lists/123",
    "/i/communities/456",
  ];
  for (const pathname of timeline) {
    assert.equal(tweetPageMode(pathname), "timeline", pathname);
  }
});

test("a quote-composer is skipped with the rest of /compose", () => {
  // X shows the quoted tweet as a card there, without the action bar our button
  // attaches to, so the whole /compose tree is skipped by prefix.
  assert.equal(tweetPageMode("/compose/post/quote/789"), null);
});

test("tweetPageMode returns null for the tweet-free screens we skip", () => {
  for (const pathname of IGNORED_PATH_PREFIXES) {
    assert.equal(tweetPageMode(pathname), null, pathname);
    assert.equal(tweetPageMode(`${pathname}/anything`), null, `${pathname}/anything`);
    assert.equal(isIgnoredRoute(pathname), true, pathname);
  }
});

test("the ignore list matches whole path segments, not prefixes of words", () => {
  // "/messages" is ignored; "/messages-archive" is a different route and must not
  // be caught by a naive `startsWith` on the bare string.
  assert.equal(isIgnoredRoute("/messages-archive"), false);
  assert.equal(tweetPageMode("/messages-archive"), "timeline");
  assert.equal(isIgnoredRoute("/settingsx"), false);
});

test("isIgnoredRoute tolerates junk input instead of throwing", () => {
  for (const value of [undefined, null, 0, ""]) {
    assert.equal(isIgnoredRoute(value), false, String(value));
  }
});

test("watchRouteKey reports the mode and tears down before switching surfaces", () => {
  const harness = createEnv("/home");
  const events = [];
  const stop = watchRouteKey(
    (pathname) => tweetPageMode(pathname),
    (mode) => events.push(`enter:${mode}`),
    () => events.push("leave"),
    { env: harness.env },
  );

  assert.deepEqual(events, ["enter:timeline"]);

  // Timeline -> timeline (a profile -> a tweet) is not a transition: the same
  // surface keeps running, so the controls are never torn down for nothing.
  harness.env.history.pushState({}, "", "https://x.com/Aorus22/status/1");
  assert.deepEqual(events, ["enter:timeline"]);

  // Timeline -> bookmarks must leave first: the injected buttons are replaced by
  // the organizer, and both cannot be in the DOM at once.
  harness.env.history.pushState({}, "", "https://x.com/i/history");
  assert.deepEqual(events, ["enter:timeline", "leave", "enter:bookmarks"]);

  // Bookmarks -> an ignored screen has nothing to enter.
  harness.navigate("https://x.com/settings");
  harness.tick();
  assert.deepEqual(events, ["enter:timeline", "leave", "enter:bookmarks", "leave"]);

  // And back again.
  harness.env.history.pushState({}, "", "https://x.com/home");
  assert.deepEqual(events, [
    "enter:timeline",
    "leave",
    "enter:bookmarks",
    "leave",
    "enter:timeline",
  ]);

  stop();
  harness.env.history.pushState({}, "", "https://x.com/i/history");
  assert.deepEqual(events.at(-1), "enter:timeline", "a stopped watcher is inert");
});

test("watchRoute still reports only the bookmarks timeline", () => {
  // The boolean wrapper is what the original watcher promised, and callers that
  // only care about that one surface keep working unchanged.
  const harness = createEnv("/home");
  const events = [];
  watchRoute(() => events.push("enter"), () => events.push("leave"), { env: harness.env });
  assert.deepEqual(events, ["leave"]);

  harness.env.history.pushState({}, "", "https://x.com/i/history");
  assert.deepEqual(events, ["leave", "enter"]);
});
