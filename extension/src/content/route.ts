/**
 * SPA route detection for the content script (PRD §26, XI-01/XI-02).
 *
 * `isBookmarksRoute` and `tweetPageMode` are pure and exhaustively table-testable.
 * `watchRoute` reports enter/leave transitions exactly once each, even across X's
 * own `history.pushState` / `history.replaceState` navigation, `popstate`, and a
 * low-frequency `location.href` fallback for any navigation path that bypasses
 * both (XI-02).
 *
 * There are two surfaces, not one. The bookmarks timeline is organized; everywhere
 * else that shows tweets gets our own bookmark button. `tweetPageMode` names that
 * choice, and a single watcher drives whichever lifecycle the current route needs.
 */

/**
 * Paths the organizer may activate on (PRD §26, XI-01).
 *
 * X moved the Bookmarks timeline from `/i/bookmarks` to `/i/history`. The new
 * canonical path is listed first; the legacy one is kept as a tolerated alias so
 * that a client-side redirect from an old link, or an account still served the
 * old route, does not leave the page without an active organizer. Remove the
 * legacy entry once `/i/bookmarks` is fully retired.
 */
export const BOOKMARKS_PATHS = ["/i/history", "/i/bookmarks"] as const;

/**
 * Paths that never show a tweet action bar, so the content script does not observe
 * them at all.
 *
 * The injected-per-tweet sweep is harmless where there are no tweets, but it is not
 * free: it attaches a document-wide `MutationObserver` and re-scans on every
 * mutation. Settings, DMs, the login flow and the composer are heavy, tweet-free
 * screens, so they are skipped by name rather than by hoping the selector finds
 * nothing. Everything else — home, a profile, a search result, a notification, a
 * single tweet and its replies — is a "timeline" here, whether or not X calls it
 * one, because a tweet action bar is what the code actually looks for.
 */
export const IGNORED_PATH_PREFIXES = [
  "/settings",
  "/i/flow",
  "/login",
  "/logout",
  "/messages",
  "/i/chat",
  "/compose",
] as const;

/** How often the fallback watcher re-checks `location.href`. */
export const ROUTE_POLL_INTERVAL_MS = 500;

/**
 * Which surface the route needs.
 *
 * `"bookmarks"` is the organizer on the bookmarks timeline, `"timeline"` is our own
 * bookmark button on any other page that shows tweets, and `null` means "neither:
 * leave the page alone".
 */
export type TweetPageMode = "bookmarks" | "timeline";

/** Strip origin, query and fragment, leaving a comparable absolute path. */
export function normalizePath(input: string): string {
  let path = input;
  const schemeIndex = path.indexOf("://");
  if (schemeIndex >= 0) {
    const afterOrigin = path.slice(schemeIndex + 3);
    const slash = afterOrigin.indexOf("/");
    path = slash >= 0 ? afterOrigin.slice(slash) : "/";
  } else if (path.startsWith("//")) {
    const afterOrigin = path.slice(2);
    const slash = afterOrigin.indexOf("/");
    path = slash >= 0 ? afterOrigin.slice(slash) : "/";
  }

  const queryIndex = path.search(/[?#]/);
  if (queryIndex >= 0) path = path.slice(0, queryIndex);
  return path;
}

function currentPathname(): string {
  const locationLike = (globalThis as { location?: { pathname?: unknown } }).location;
  const pathname = locationLike?.pathname;
  return typeof pathname === "string" ? pathname : "/";
}

/**
 * True only for the Bookmarks timeline — `/i/history` (canonical) or
 * `/i/bookmarks` (legacy alias) — with or without a trailing slash, query
 * string, hash, or origin (XI-01).
 */
export function isBookmarksRoute(pathname?: string): boolean {
  const input = pathname ?? currentPathname();
  if (typeof input !== "string" || input.length === 0) return false;

  const path = normalizePath(input);
  return BOOKMARKS_PATHS.some(
    (candidate) => path === candidate || path === `${candidate}/`,
  );
}

/** True for a path the content script deliberately does not observe. */
export function isIgnoredRoute(pathname?: string): boolean {
  const input = pathname ?? currentPathname();
  if (typeof input !== "string" || input.length === 0) return false;

  const path = normalizePath(input);
  return IGNORED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * The surface for a path, or `null` when the page needs no injected controls.
 *
 * Bookmarks wins over the ignore list, so a future `/settings`-like path under the
 * timeline still organizes.
 */
export function tweetPageMode(pathname?: string): TweetPageMode | null {
  const input = pathname ?? currentPathname();
  if (isBookmarksRoute(input)) return "bookmarks";
  if (isIgnoredRoute(input)) return null;
  return "timeline";
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/** Minimal, injectable view of the browser APIs the route watcher needs. */
export interface RouteEnv {
  location: { pathname: string; href: string };
  history: {
    pushState: (...args: unknown[]) => unknown;
    replaceState: (...args: unknown[]) => unknown;
  };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (id: number) => void;
}

/** Options for {@link watchRouteKey}; `env` exists for tests. */
export interface WatchRouteOptions {
  /** Browser surface to use; defaults to the real `window`/`history`. */
  env?: RouteEnv;
  /** Fallback poll period, default {@link ROUTE_POLL_INTERVAL_MS}. */
  intervalMs?: number;
}

/** Build a {@link RouteEnv} from the real browser globals. */
export function browserRouteEnv(): RouteEnv {
  return {
    location: window.location,
    history: window.history as unknown as RouteEnv["history"],
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    setInterval: (handler, timeout) => window.setInterval(handler, timeout),
    clearInterval: (id) => window.clearInterval(id),
  };
}

/**
 * Watch a route key and fire `onEnter(key)`/`onLeave` exactly once per transition.
 * The current key is reported immediately on subscription.
 *
 * `onLeave` runs whenever the key changes, including from one non-null key to
 * another, so a lifecycle always tears down before the next one starts. That
 * ordering matters: the injected controls are the same DOM for both surfaces, and
 * only the trigger differs, so the old ones must go before the new ones arrive.
 *
 * Returns a `stop()` function that removes every listener it installed and
 * restores the original `history` methods.
 */
export function watchRouteKey(
  keyOf: (pathname: string) => string | null,
  onEnter: (key: string) => void,
  onLeave: () => void,
  options: WatchRouteOptions = {},
): () => void {
  const env = options.env ?? browserRouteEnv();
  const intervalMs = options.intervalMs ?? ROUTE_POLL_INTERVAL_MS;

  let active = keyOf(env.location.pathname);
  let stopped = false;
  let lastHref = env.location.href;

  const sync = (): void => {
    if (stopped) return;
    const next = keyOf(env.location.pathname);
    if (next === active) return;
    const previous = active;
    active = next;
    if (previous !== null) onLeave();
    if (next !== null) onEnter(next);
  };

  const onPopState = (): void => {
    sync();
  };

  const originalPushState = env.history.pushState;
  const originalReplaceState = env.history.replaceState;

  env.history.pushState = function patchedPushState(this: unknown, ...args: unknown[]): unknown {
    const result = originalPushState.apply(this, args);
    sync();
    return result;
  };
  env.history.replaceState = function patchedReplaceState(this: unknown, ...args: unknown[]): unknown {
    const result = originalReplaceState.apply(this, args);
    sync();
    return result;
  };

  env.addEventListener("popstate", onPopState);

  const timer = env.setInterval(() => {
    if (stopped) return;
    if (env.location.href === lastHref) return;
    lastHref = env.location.href;
    sync();
  }, intervalMs);

  if (active !== null) onEnter(active);
  else onLeave();

  return () => {
    if (stopped) return;
    stopped = true;
    env.removeEventListener("popstate", onPopState);
    env.clearInterval(timer);
    env.history.pushState = originalPushState;
    env.history.replaceState = originalReplaceState;
  };
}

/**
 * Watch the Bookmarks timeline specifically (PRD §26). A thin wrapper over
 * {@link watchRouteKey} that keeps the original boolean contract — including the
 * immediate `onLeave` on a non-bookmarks route — for callers that only care about
 * that one surface.
 */
export function watchRoute(
  onEnter: () => void,
  onLeave: () => void,
  options: WatchRouteOptions = {},
): () => void {
  return watchRouteKey(
    (pathname) => (isBookmarksRoute(pathname) ? "bookmarks" : null),
    () => onEnter(),
    onLeave,
    options,
  );
}
