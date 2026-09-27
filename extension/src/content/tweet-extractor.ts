/**
 * Container-scoped tweet metadata extraction (PRD §28–§30, §40).
 *
 * Invariants:
 *  - every lookup is rooted at the passed tweet container — never `document`
 *    (mixing tweet A's metadata into tweet B is the failure mode this prevents);
 *  - quoted-tweet text is excluded; only the top-level tweet text is returned;
 *  - a media-only tweet yields `text === ""` and is still valid;
 *  - a missing `url`/`author`/`username`/`tweet_date` yields a typed failure and
 *    no partial record (XI-12).
 */

import type { ExtractedTweet } from "../shared/types.ts";
import { matchesAny, queryAll, queryFirst } from "./selectors.ts";
import type { SelectorKey } from "./selectors.ts";

/** User-facing message for any extraction failure (PRD §40, XI-12). */
export const EXTRACTION_ERROR = "Could not read tweet data";

/** Machine-readable reason for a failed extraction. */
export type ExtractionFailureReason =
  | "missing_url"
  | "missing_tweet_id"
  | "missing_author"
  | "missing_username"
  | "missing_tweet_date";

/** Result of {@link extractTweet}: either a complete tweet or a typed failure. */
export type ExtractionResult =
  | { ok: true; tweet: ExtractedTweet }
  | { ok: false; reason: ExtractionFailureReason };

/* -------------------------------------------------------------------------- */
/* Scoped primitives                                                          */
/* -------------------------------------------------------------------------- */

/** Text of one element, preferring rendered `innerText` (preserves newlines). */
function textOf(element: Element): string {
  const rendered = (element as HTMLElement).innerText;
  const value = typeof rendered === "string" && rendered.length > 0 ? rendered : (element.textContent ?? "");
  return value;
}

/**
 * True when `element` sits inside a quoted-tweet/card wrapper below `article`
 * (PRD §29).
 *
 * The `div[role="link"]` fallback only counts when that wrapper also owns its
 * own tweet metadata (author or timestamp) or is a nested article — otherwise a
 * generic link wrapper around the main tweet could hide legitimate text.
 */
function isWithinQuotedWrapper(element: Element, article: Element): boolean {
  let current = element.parentElement;
  while (current && current !== article) {
    if (matchesAny(current, "quotedCard")) return true;
    if (matchesAny(current, "quotedLink")) {
      const hasOwnAuthor = queryFirst(current, "userName") !== null;
      const hasOwnTime = queryFirst(current, "time") !== null;
      if (hasOwnAuthor || hasOwnTime) return true;
    }
    // Nested quoted tweet rendered as its own article container.
    if (matchesAny(current, "tweetArticle")) return true;
    current = current.parentElement;
  }
  return false;
}

/** First element matching `key` under `root` that is not inside a quoted wrapper. */
function queryFirstTopLevel(root: Element, key: SelectorKey, article: Element): Element | null {
  for (const element of queryAll(root, key)) {
    if (!isWithinQuotedWrapper(element, article)) return element;
  }
  return null;
}

/** First path segment of an X href (`/user/status/1` -> `user`), `""` when absent. */
function firstPathSegment(href: string): string {
  const withoutOrigin = href.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const withoutQuery = withoutOrigin.split(/[?#]/, 1)[0] ?? "";
  const segments = withoutQuery.split("/").filter((segment) => segment.length > 0);
  return segments[0] ?? "";
}

/* -------------------------------------------------------------------------- */
/* Public extractors (XI-05)                                                  */
/* -------------------------------------------------------------------------- */

/** The status permalink that belongs to the main tweet (never a quoted one). */
function getStatusLink(article: Element): Element | null {
  const topLevel = queryFirstTopLevel(article, "statusLink", article);
  if (topLevel) return topLevel;
  return queryFirst(article, "statusLink");
}

/** Numeric X status id, or `""` when no status permalink exists. */
export function getTweetId(article: Element): string {
  const link = getStatusLink(article);
  if (!link) return "";
  const href = link.getAttribute("href") ?? "";
  const match = /\/status\/(\d+)/.exec(href);
  return match?.[1] ?? "";
}

/** Canonical `https://x.com/<user>/status/<id>` URL, or `""` when unreadable. */
export function getCanonicalUrl(article: Element): string {
  const link = getStatusLink(article);
  if (!link) return "";
  const href = link.getAttribute("href") ?? "";
  const id = getTweetId(article);
  if (id.length === 0) return "";
  const segment = firstPathSegment(href);
  const user = segment.length > 0 && segment !== "i" ? segment : getUsername(article).replace(/^@/, "");
  const owner = user.length > 0 ? user : "i";
  return `https://x.com/${owner}/status/${id}`;
}

/** Display name from the tweet's author header, or `""`. */
export function getAuthor(article: Element): string {
  const userName = queryFirstTopLevel(article, "userName", article);
  if (!userName) return "";
  const full = textOf(userName).replace(/\s+/g, " ").trim();
  if (full.length === 0) return "";
  const cut = full.search(/[@·]/);
  const name = (cut > 0 ? full.slice(0, cut) : full).trim();
  return name.startsWith("@") ? "" : name;
}

/** `@handle` from the author header (or the permalink), or `""`. */
export function getUsername(article: Element): string {
  const userName = queryFirstTopLevel(article, "userName", article);
  if (userName) {
    const match = /@([A-Za-z0-9_]{1,15})/.exec(textOf(userName));
    if (match) return `@${match[1]}`;

    for (const link of queryAll(userName, "profileLink")) {
      const segment = firstPathSegment(link.getAttribute("href") ?? "");
      if (segment.length > 0 && segment !== "i") return `@${segment}`;
    }
  }

  const statusLink = getStatusLink(article);
  if (statusLink) {
    const segment = firstPathSegment(statusLink.getAttribute("href") ?? "");
    if (segment.length > 0 && segment !== "i") return `@${segment}`;
  }
  return "";
}

/** Tweet instant as ISO 8601 UTC, or `""` when absent/invalid. */
export function getTweetDate(article: Element): string {
  const time = queryFirstTopLevel(article, "time", article) ?? queryFirst(article, "time");
  if (!time) return "";
  const raw = time.getAttribute("datetime");
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

/**
 * Main tweet text with internal newlines preserved and trailing whitespace
 * trimmed. Returns `""` for media-only tweets (PRD §30) and for tweets whose only
 * text belongs to a quoted tweet.
 */
export function getMainText(article: Element): string {
  const text = queryFirstTopLevel(article, "tweetText", article);
  if (!text) return "";
  return textOf(text).replace(/\s+$/, "");
}

/**
 * Extract a complete tweet from `article`, or a typed failure when a required
 * field is missing. `text` is the only optional field.
 */
export function extractTweet(article: Element): ExtractionResult {
  const tweetId = getTweetId(article);
  if (tweetId.length === 0) return { ok: false, reason: "missing_tweet_id" };

  const url = getCanonicalUrl(article);
  if (url.length === 0) return { ok: false, reason: "missing_url" };

  const author = getAuthor(article);
  if (author.length === 0) return { ok: false, reason: "missing_author" };

  const username = getUsername(article);
  if (username.length === 0) return { ok: false, reason: "missing_username" };

  const tweetDate = getTweetDate(article);
  if (tweetDate.length === 0) return { ok: false, reason: "missing_tweet_date" };

  return {
    ok: true,
    tweet: { url, author, username, tweetDate, text: getMainText(article), tweetId },
  };
}
