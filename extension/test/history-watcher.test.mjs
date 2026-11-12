// History watcher tests (`settings.autoUnbookmarkSaved`).
//
// The watcher is driven with a fake IntersectionObserver and manual timers, so
// every rule is asserted deterministically:
//   - only rows reported visible (and still visible when the wait ends) qualify;
//   - only rows the saved index holds qualify;
//   - one attempt per tweet per entry — a failed row is left alone;
//   - removals run one at a time with a cooldown between them;
//   - disable/stop cancel pending waits and disconnect the observer.

import test from "node:test";
import assert from "node:assert/strict";

import { createHistoryWatcher } from "../src/content/history-watcher.ts";
import { createDocument } from "./helpers/fake-dom.mjs";

/** One `IntersectionObserverEntry`-shaped object. */
const entry = (article, isIntersecting, intersectionRatio = 1) => ({
  target: article,
  isIntersecting,
  intersectionRatio,
});

function createFakeIntersectionFactory() {
  const observers = [];
  const create = (callback) => {
    const observer = {
      callback,
      targets: [],
      disconnected: false,
      observe(target) {
        this.targets.push(target);
      },
      disconnect() {
        this.disconnected = true;
      },
      emit(entries) {
        if (!this.disconnected) this.callback(entries);
      },
    };
    observers.push(observer);
    return observer;
  };
  return { create, observers };
}

function createTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(handler) {
      const id = nextId;
      nextId += 1;
      pending.set(id, handler);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    pendingCount() {
      return pending.size;
    },
    runNext() {
      const [id, handler] = [...pending.entries()][0];
      pending.delete(id);
      handler();
    },
    async runAll() {
      // A handler can await a removal and then schedule the cooldown from the
      // continuation's microtask, so each step is followed by a real tick.
      for (let guard = 0; pending.size > 0 && guard < 100; guard += 1) {
        this.runNext();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

/** One watched article attached to a fresh document. */
function articleIn(doc) {
  const article = doc.createElement("article");
  doc.body.appendChild(article);
  return article;
}

function makeWatcher(overrides = {}) {
  const io = createFakeIntersectionFactory();
  const timers = createTimers();
  const clicked = [];
  const events = [];
  // Every unbookmark — the default or the caller's stub — is wrapped so `clicked`
  // records what the watcher actually attempted, regardless of the stub.
  const unbookmark = overrides.unbookmark ?? (async () => "removed");
  const watcher = createHistoryWatcher({
    isSaved: () => true,
    createObserver: io.create,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    onRemoval: (tweetId, outcome) => events.push([tweetId, outcome]),
    ...overrides,
    unbookmark: async (article) => {
      clicked.push(article);
      return unbookmark(article);
    },
  });
  return { watcher, io, timers, clicked, events };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a disabled watcher never clicks, even for visible saved rows", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher();

  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  await timers.runAll();

  assert.deepEqual(clicked, []);
  assert.equal(timers.pendingCount(), 0);
});

test("removes a visible saved row exactly once, after the grace wait", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked, events } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  assert.equal(timers.pendingCount(), 1, "the grace wait is armed before any click");

  await timers.runAll();

  assert.deepEqual(clicked, [article]);
  assert.deepEqual(events, [["100", "removed"]]);
  assert.equal(timers.pendingCount(), 0, "nothing is retried once removed");
});

test("rows below the visibility threshold never qualify", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 0.2)]);
  await timers.runAll();

  assert.deepEqual(clicked, []);
});

test("a row that left the view during the grace wait is skipped", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  io.observers[0].emit([entry(article, false, 0)]);
  await timers.runAll();

  assert.deepEqual(clicked, []);
});

test("unsaved rows are never clicked", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher({ isSaved: () => false });

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  await timers.runAll();

  assert.deepEqual(clicked, []);
});

test("the saved set is re-read at execution time, not at track time", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  let saved = false;
  const { watcher, io, timers, clicked } = makeWatcher({ isSaved: () => saved });

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  await timers.runAll();
  assert.deepEqual(clicked, [], "not yet in the index: no click");

  saved = true;
  watcher.setEnabled(true);
  await timers.runAll();
  assert.deepEqual(clicked, [article], "the late index arrival is picked up");
});

test("one attempt per tweet: a failed row is never retried", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked, events } = makeWatcher({
    unbookmark: async () => "failed",
  });

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  await timers.runAll();
  await timers.runAll();

  assert.equal(clicked.length, 1);
  assert.deepEqual(events, [["100", "failed"]]);
});

test("removals run one at a time with a cooldown between them", async () => {
  const doc = createDocument();
  const first = articleIn(doc);
  const second = articleIn(doc);
  const clicked = [];
  const resolvers = [];
  const io = createFakeIntersectionFactory();
  const timers = createTimers();
  const watcher = createHistoryWatcher({
    isSaved: () => true,
    unbookmark: (article) =>
      new Promise((resolve) => {
        clicked.push(article);
        resolvers.push(() => resolve("removed"));
      }),
    createObserver: io.create,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });

  watcher.setEnabled(true);
  watcher.track(first, "1");
  watcher.track(second, "2");
  io.observers[0].emit([entry(first, true, 1), entry(second, true, 1)]);

  await timers.runAll();
  assert.deepEqual(clicked, [first], "only the first row is clicked before it resolves");

  resolvers[0]();
  await flush();
  assert.equal(clicked.length, 1, "the second waits for the cooldown");

  await timers.runAll();
  assert.deepEqual(clicked, [first, second]);

  resolvers[1]();
  await flush();
});

test("setEnabled(false) cancels the pending wait; re-enabling re-arms it", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);
  assert.equal(timers.pendingCount(), 1);

  watcher.setEnabled(false);
  assert.equal(timers.pendingCount(), 0, "the grace wait is cancelled");
  await timers.runAll();
  assert.deepEqual(clicked, []);

  watcher.setEnabled(true);
  assert.equal(timers.pendingCount(), 1, "re-enabling re-arms the wait");
  await timers.runAll();
  assert.deepEqual(clicked, [article]);
});

test("stop() disconnects the observer and forgets everything", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, io, timers, clicked } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(article, "100");
  io.observers[0].emit([entry(article, true, 1)]);

  watcher.stop();
  assert.equal(io.observers[0].disconnected, true);
  assert.equal(timers.pendingCount(), 0);

  await timers.runAll();
  assert.deepEqual(clicked, [], "pending waits are dead after stop");

  watcher.track(article, "100");
  assert.equal(io.observers[0].targets.length, 1, "tracking after stop is a no-op");
});

/* -------------------------------------------------------------------------- */
/* Aggressive mode                                                            */
/* -------------------------------------------------------------------------- */

test("aggressive mode drains loaded saved rows without waiting for visibility", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, timers, clicked } = makeWatcher();

  // The observer never fires a single event: the row is simply loaded.
  watcher.setMode("aggressive");
  watcher.setEnabled(true);
  watcher.track(article, "100");

  assert.deepEqual(clicked, [article], "no grace wait, no visibility requirement");
  // The zero cooldown is armed from the removal's continuation, so flush before
  // draining and before asserting the queue is empty.
  await flush();
  await timers.runAll();
  await flush();
  assert.equal(timers.pendingCount(), 0, "nothing is retried once removed");
});

test("switching to aggressive drains the loaded backlog immediately", async () => {
  const doc = createDocument();
  const first = articleIn(doc);
  const second = articleIn(doc);
  const { watcher, timers, clicked } = makeWatcher();

  watcher.setEnabled(true);
  watcher.track(first, "1");
  watcher.track(second, "2");
  await flush();
  assert.deepEqual(clicked, [], "visible mode waits for visibility events");

  watcher.setMode("aggressive");
  assert.deepEqual(clicked, [first], "the backlog starts draining at once");

  await timers.runAll();
  assert.deepEqual(clicked, [first, second], "the rest follows through the zero cooldown");
});

test("aggressive mode also spends each tweet's single attempt", async () => {
  const doc = createDocument();
  const article = articleIn(doc);
  const { watcher, timers, clicked, events } = makeWatcher({
    unbookmark: async () => "failed",
  });

  watcher.setMode("aggressive");
  watcher.setEnabled(true);
  watcher.track(article, "100");
  // The outcome lands from the removal's continuation, then the zero cooldown
  // is armed; flush, drain, flush — and assert on settled state only.
  await flush();
  await timers.runAll();
  await flush();

  assert.equal(clicked.length, 1, "a failed row is never retried, even aggressively");
  assert.deepEqual(events, [["100", "failed"]]);
  assert.equal(timers.pendingCount(), 0);
});

test("aggressive mode only touches rows the archive holds", async () => {
  const doc = createDocument();
  const savedRow = articleIn(doc);
  const unsavedRow = articleIn(doc);
  const { watcher, timers, clicked } = makeWatcher({
    isSaved: (tweetId) => tweetId === "1",
  });

  watcher.setMode("aggressive");
  watcher.setEnabled(true);
  watcher.track(unsavedRow, "2");
  assert.deepEqual(clicked, [], "an unsaved loaded row is skipped");

  watcher.track(savedRow, "1");
  assert.deepEqual(clicked, [savedRow]);
  await flush();
  await timers.runAll();
  await flush();
  assert.deepEqual(clicked, [savedRow]);
});
