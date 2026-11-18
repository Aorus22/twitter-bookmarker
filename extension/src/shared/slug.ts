/**
 * Collection slug validation.
 *
 * The extension no longer *derives* slugs. The backend owns categories now, so
 * `POST /v1/collections` takes a name and `storage.Slugify` turns it into the
 * key; a client that computed its own would be a second implementation of the
 * same rules and the two would eventually disagree, which is exactly the bug
 * this change removes.
 *
 * What remains here is the validator, and it stays for the direction that still
 * matters: a slug arriving *from* elsewhere — a cache written by an older build,
 * a hand-edited `chrome.storage.local`, a compromised backend — is checked before
 * it is used in a request path. {@link SLUG_PATTERN} mirrors the backend's own
 * `storage.SlugPattern`.
 */

/** Slugs the backend accepts; the extension must only ever send these. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True when `slug` is safe to use as a collection key in a request path. */
export function isValidSlug(slug: string): boolean {
  return typeof slug === "string" && SLUG_PATTERN.test(slug);
}
