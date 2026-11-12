/**
 * The history watcher (`settings.autoUnbookmarkSaved`).
 *
 * On the bookmarks timeline X is already holding every tweet shown, and the
 * archive already holds the ones this extension saved — those rows sit in X's
 * list only because nobody removed them. When the watcher is enabled it removes
 * exactly that overlap, through X's own verified unbookmark (`unbookmark.ts`).
 *
 * Two modes, chosen by `settings.autoUnbookmarkSavedMode`:
 *
 *  - **`visible`** (the default) is gentle: only rows the IntersectionObserver
 *    reports as (mostly) on screen are candidates, a row must still be visible
 *    when its grace wait ends, removals run one at a time with a cooldown, and
 *    nothing off-screen is ever clicked.
 *  - **`aggressive`** drains everything *loaded*: every tracked row the archive
 *    holds is processed the moment it becomes known, whether or not it is on
 *    screen, with no grace wait and no cooldown to speak of. Still strictly one
 *    click in flight at a time, still through the verified unbookmark.
 *
 * In both modes each tweet gets at most one attempt per page entry — a failed
 * row is left alone rather than retried.
 *
 * The module is pure plumbing: it never touches storage or the network, never
 * throws into the page, and every browser primitive is injected so `node --test`
 * can drive it. Whether it runs at all is the caller's decision (`setEnabled`);
 * creating it changes nothing until then.
 */

import type { WatcherMode } from "../shared/types.ts";

/** Outcome of one watcher-driven removal, echoing {@link unbookmarkTweet}. */
export type WatcherOutcome = "removed" | "failed";

/** An entry counts as visible at this fraction of the row on screen. */
export const WATCH_VISIBILITY_THRESHOLD = 0.5;

/** How long a row must stay visible before the watcher acts on it. */
export const WATCH_GRACE_MS = 1200;

/** Quiet time between two removals in `visible` mode. */
export const WATCH_COOLDOWN_MS = 1500;

/**
 * Quiet time between two removals in `aggressive` mode: zero — the verified
 * unbookmark's own await is the only pacing, and rows go back-to-back.
 */
export const WATCH_AGGRESSIVE_COOLDOWN_MS = 0;

/** The slice of `IntersectionObserverEntry` the watcher reads. */
export interface WatcherEntry {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
}

/** Minimal structural `IntersectionObserver` surface, so a fake can stand in. */
export interface IntersectionObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

/** Factory for {@link IntersectionObserverLike}; `null` when the platform lacks one. */
export type IntersectionObserverFactory = (
  callback: (entries: readonly WatcherEntry[]) => void,
) => IntersectionObserverLike | null;

/** Injectable dependencies (tests substitute every one of them). */
export interface HistoryWatcherDeps {
  /** Live saved-index lookup; re-read at execution time, never cached. */
  isSaved(tweetId: string): boolean;
  /** The verified native unbookmark. */
  unbookmark(article: HTMLElement): Promise<WatcherOutcome>;
  /** Observer factory; defaults to the platform `IntersectionObserver`. */
  createObserver?: IntersectionObserverFactory;
  /** Timer primitive; defaults to the global `setTimeout`. */
  setTimeout?: (handler: () => void, timeout: number) => number;
  /** Timer primitive matching {@link HistoryWatcherDeps.setTimeout}. */
  clearTimeout?: (id: number) => void;
  /** Diagnostic sink for each finished attempt. */
  onRemoval?(tweetId: string, outcome: WatcherOutcome): void;
}

/** What one watcher instance exposes to the page lifecycle. */
export interface HistoryWatcher {
  /** Register a tweet row. Safe to call repeatedly and for any tweet. */
  track(article: HTMLElement, tweetId: string): void;
  /** Turn the watcher on or off. Safe to call repeatedly; `stop` wins. */
  setEnabled(enabled: boolean): void;
  /** Switch between `"visible"` and `"aggressive"`. Safe to call repeatedly. */
  setMode(mode: WatcherMode): void;
  /** Final teardown: disconnects, cancels timers, forgets every row. */
  stop(): void;
}

function defaultObserverFactory(
  callback: (entries: readonly WatcherEntry[]) => void,
): IntersectionObserverLike | null {
  const ctor = (
    globalThis as {
      IntersectionObserver?: new (
        cb: (entries: WatcherEntry[]) => void,
        options?: { threshold?: number },
      ) => IntersectionObserverLike;
    }
  ).IntersectionObserver;
  if (typeof ctor !== "function") return null;
  return new ctor(callback, { threshold: WATCH_VISIBILITY_THRESHOLD });
}

/** Duck-typed connectivity check that works on the fake DOM too. */
function isConnected(node: Node): boolean {
  const flag = (node as { isConnected?: unknown }).isConnected;
  if (typeof flag === "boolean") return flag;
  const doc = node.ownerDocument;
  return doc !== null && typeof doc.contains === "function" && doc.contains(node);
}

export function createHistoryWatcher(deps: HistoryWatcherDeps): HistoryWatcher {
  const setTimer = deps.setTimeout ?? ((handler, timeout) => globalThis.setTimeout(handler, timeout));
  const clearTimer = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id));

  /** Every tracked row → its tweet id (a re-track with a new id wins). */
  const articles = new Map<HTMLElement, string>();
  /** Rows the observer currently reports as visible. */
  const visible = new Set<HTMLElement>();
  /** Tweet ids with a spent attempt: one try per tweet per page entry. */
  const attempted = new Set<string>();

  let observer: IntersectionObserverLike | null = null;
  let timer: number | null = null;
  let busy = false;
  let enabled = false;
  let mode: WatcherMode = "visible";
  let stopped = false;

  function ensureObserver(): void {
    if (observer !== null || stopped) return;
    try {
      observer = (deps.createObserver ?? defaultObserverFactory)(onEntries);
    } catch {
      // Without an observer nothing is ever visible, so the watcher stays idle.
      observer = null;
    }
  }

  function onEntries(entries: readonly WatcherEntry[]): void {
    if (stopped) return;
    for (const entry of entries) {
      const article = entry.target as HTMLElement;
      if (!articles.has(article)) continue;
      const ratioKnown = typeof entry.intersectionRatio === "number";
      const shown = entry.isIntersecting === true && (!ratioKnown || entry.intersectionRatio >= WATCH_VISIBILITY_THRESHOLD);
      if (shown) visible.add(article);
      else visible.delete(article);
    }
    wake();
  }

  /**
   * Arm the next processing step for the current mode: `aggressive` acts
   * immediately, `visible` waits out the grace period (unless one is already
   * pending or a removal is running).
   */
  function wake(): void {
    if (stopped || !enabled || busy) return;
    if (mode === "aggressive") {
      processNext();
      return;
    }
    if (timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      processNext();
    }, WATCH_GRACE_MS);
  }

  /**
   * Oldest candidate row that is still connected, saved, and unattempted —
   * drawn from the on-screen rows in `visible` mode, from everything loaded in
   * `aggressive` mode.
   */
  function pickCandidate(): [HTMLElement, string] | null {
    const pool: Iterable<HTMLElement> = mode === "aggressive" ? articles.keys() : visible;
    for (const article of pool) {
      const tweetId = articles.get(article);
      if (tweetId === undefined || attempted.has(tweetId)) continue;
      if (!isConnected(article)) continue;
      if (!deps.isSaved(tweetId)) continue;
      return [article, tweetId];
    }
    return null;
  }

  function processNext(): void {
    if (stopped || !enabled || busy) return;
    const candidate = pickCandidate();
    if (candidate === null) return;
    const [article, tweetId] = candidate;
    // Spent before the click: a re-entrant event cannot double-process a row.
    attempted.add(tweetId);
    busy = true;
    void runRemoval(article, tweetId);
  }

  async function runRemoval(article: HTMLElement, tweetId: string): Promise<void> {
    let outcome: WatcherOutcome = "failed";
    try {
      outcome = await deps.unbookmark(article);
    } catch {
      // The unbookmark never throws, but the loop must survive one that does.
      outcome = "failed";
    }
    busy = false;
    if (stopped) return;
    try {
      deps.onRemoval?.(tweetId, outcome);
    } catch {
      // A listener must never break the loop.
    }
    if (!enabled) return;
    timer = setTimer(() => {
      timer = null;
      processNext();
    }, mode === "aggressive" ? WATCH_AGGRESSIVE_COOLDOWN_MS : WATCH_COOLDOWN_MS);
  }

  return {
    track(article, tweetId) {
      if (stopped) return;
      const known = articles.has(article);
      articles.set(article, tweetId);
      ensureObserver();
      if (observer !== null && !known) {
        try {
          observer.observe(article);
        } catch {
          // Observing is best-effort; an unobserved row is simply never a candidate.
        }
      }
      // A row loaded while aggressive goes into the queue the moment it is
      // known; in visible mode only the observer's events can nominate it.
      if (mode === "aggressive") wake();
    },

    setEnabled(on) {
      if (stopped) return;
      enabled = on;
      if (!on) {
        // A removal already in flight finishes on its own; its cooldown checks
        // `enabled` and stops there. Only the pending wait is cancelled.
        if (timer !== null) {
          const id = timer;
          timer = null;
          try {
            clearTimer(id);
          } catch {
            /* Defensive. */
          }
        }
        return;
      }
      // Always re-arms: the saved index can have arrived after the rows did.
      wake();
    },

    setMode(next) {
      if (stopped) return;
      mode = next;
      // A switch into aggressive drains everything already known at once; a
      // switch back to visible simply waits for the next event from here on.
      if (enabled) wake();
    },

    stop() {
      stopped = true;
      enabled = false;
      if (timer !== null) {
        const id = timer;
        timer = null;
        try {
          clearTimer(id);
        } catch {
          /* Defensive. */
        }
      }
      if (observer !== null) {
        try {
          observer.disconnect();
        } catch {
          /* Defensive. */
        }
        observer = null;
      }
      articles.clear();
      visible.clear();
      attempted.clear();
    },
  };
}
