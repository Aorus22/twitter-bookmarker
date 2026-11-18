// The collection-list policy: wire-to-row mapping, ordering, staleness.
//
// These are the rules every surface shares — the popup rows, the timeline buttons
// and the cache the worker writes — so they are tested away from `chrome.*` and
// away from `fetch`.

import test from "node:test";
import assert from "node:assert/strict";

import {
  byOrder,
  collectionsErrorMessage,
  displayColor,
  emptyCollectionsCache,
  isCollectionsCacheStale,
  moveSlug,
  normalizeCollectionColor,
  normalizeCollectionsCache,
  reorderCategories,
  toCategories,
  toCategory,
} from "../src/shared/collections.ts";
import { COLLECTIONS_TTL_MS, DEFAULT_CATEGORY_COLOR } from "../src/shared/constants.ts";

/** A wire collection with the fields the mapper reads. */
function wire(slug, name, order, extra = {}) {
  return { slug, name, color: "#4f46e5", order, post_count: 0, media_count: 0, last_saved_at: null, cover_media: [], ...extra };
}

/** A renderable row. */
function row(slug, order, extra = {}) {
  return { id: slug, slug, name: slug, color: "#4f46e5", order, ...extra };
}

test("toCategory maps a wire collection onto a row and uses the slug as its id", () => {
  const category = toCategory(wire("ai-llm", "AI & LLM", 3, { color: "#BF3F2E" }));
  assert.deepEqual(category, { id: "ai-llm", slug: "ai-llm", name: "AI & LLM", color: "#bf3f2e", order: 3 });
});

test("toCategory refuses a slug the backend would not accept", () => {
  // A slug lands in a request path, so an unusable one is dropped rather than
  // repaired into a save aimed at a collection that does not exist.
  for (const slug of ["Linux", "../linux", "linux.csv", "", "linux slug", "-linux"]) {
    assert.equal(toCategory(wire(slug, "Whatever", 0)), null, `slug ${JSON.stringify(slug)}`);
  }
  for (const value of [null, undefined, 42, "linux", [], {}]) {
    assert.equal(toCategory(value), null, `value ${JSON.stringify(value)}`);
  }
});

test("toCategory falls back to the slug for a missing name and keeps position 0", () => {
  assert.equal(toCategory(wire("linux", "", 0)).name, "linux");
  assert.equal(toCategory(wire("linux", "   ", 0)).name, "linux");
  assert.equal(toCategory(wire("linux", "Linux", "nope")).order, 0);
  assert.equal(toCategory(wire("linux", "Linux", 2.5)).order, 2.5);
});

test("normalizeCollectionColor accepts only #rrggbb and treats the rest as unset", () => {
  assert.equal(normalizeCollectionColor("#A1B2C3"), "#a1b2c3");
  assert.equal(normalizeCollectionColor("#fff"), "");
  assert.equal(normalizeCollectionColor("red"), "");
  assert.equal(normalizeCollectionColor(""), "");
  assert.equal(normalizeCollectionColor(undefined), "");
  assert.equal(normalizeCollectionColor(42), "");
});

test("displayColor falls back to the shared default only when painting", () => {
  assert.equal(displayColor(""), DEFAULT_CATEGORY_COLOR);
  assert.equal(displayColor("#4f46e5"), "#4f46e5");
  // The stored value keeps the distinction, which is why the two helpers are
  // separate: an empty colour is a real answer, not a missing one.
  assert.equal(normalizeCollectionColor(""), "");
});

test("toCategories sorts by the backend's order and drops unusable rows", () => {
  const categories = toCategories([
    wire("gamma", "Gamma", 5),
    wire("broken slug", "Broken", 1),
    wire("alpha", "Alpha", 0),
    "nonsense",
    wire("beta", "Beta", 5),
  ]);

  assert.deepEqual(
    categories.map((category) => category.slug),
    ["alpha", "beta", "gamma"],
    "equal orders tie-break by slug",
  );
  assert.deepEqual(categories, [...categories].sort(byOrder));
});

test("toCategories returns an empty list for anything that is not an array", () => {
  for (const value of [undefined, null, {}, "collections", 7]) {
    assert.deepEqual(toCategories(value), []);
  }
});

test("reorderCategories places named slugs first and keeps the rest behind", () => {
  const categories = [row("alpha", 0), row("beta", 1), row("gamma", 2), row("delta", 3)];

  // A partial order is still a defined instruction.
  assert.deepEqual(
    reorderCategories(categories, ["delta"]).map((category) => [category.slug, category.order]),
    [
      ["delta", 0],
      ["alpha", 1],
      ["beta", 2],
      ["gamma", 3],
    ],
  );

  // Unknown slugs are ignored rather than inserted as holes.
  assert.deepEqual(
    reorderCategories(categories, ["gamma", "ghost", "alpha"]).map((category) => category.slug),
    ["gamma", "alpha", "beta", "delta"],
  );

  // The input is never mutated: the popup renders from the same array.
  assert.deepEqual(categories.map((category) => category.order), [0, 1, 2, 3]);
});

test("moveSlug nudges one position and refuses to wrap", () => {
  const categories = [row("alpha", 0), row("beta", 1), row("gamma", 2)];

  assert.deepEqual(moveSlug(categories, "beta", -1), ["beta", "alpha", "gamma"]);
  assert.deepEqual(moveSlug(categories, "beta", 1), ["alpha", "gamma", "beta"]);
  assert.deepEqual(moveSlug(categories, "alpha", -1), ["alpha", "beta", "gamma"], "the first row stays first");
  assert.deepEqual(moveSlug(categories, "gamma", 1), ["alpha", "beta", "gamma"], "the last row stays last");
  assert.deepEqual(moveSlug(categories, "ghost", 1), ["alpha", "beta", "gamma"]);
});

test("isCollectionsCacheStale treats a missing or empty cache as stale", () => {
  const now = 1_700_000_000_000;
  assert.equal(isCollectionsCacheStale(emptyCollectionsCache(), now), true);

  // An empty list is always stale, even when it was written a moment ago: "the
  // backend has no categories" and "nobody ever asked" render identically and only
  // a fetch can tell them apart.
  assert.equal(isCollectionsCacheStale({ categories: [], fetchedAt: now }, now), true);

  const fresh = { categories: [row("linux", 0)], fetchedAt: now - 1000 };
  assert.equal(isCollectionsCacheStale(fresh, now), false);
  assert.equal(isCollectionsCacheStale(fresh, now + COLLECTIONS_TTL_MS), true, "the TTL is inclusive");
  assert.equal(isCollectionsCacheStale(fresh, now, 500), true, "a shorter TTL can be passed in");
});

test("normalizeCollectionsCache tolerates every shape storage can hold", () => {
  assert.deepEqual(normalizeCollectionsCache(undefined), { categories: [], fetchedAt: 0 });
  assert.deepEqual(normalizeCollectionsCache("nope"), { categories: [], fetchedAt: 0 });
  assert.deepEqual(normalizeCollectionsCache({}), { categories: [], fetchedAt: 0 });
  assert.deepEqual(normalizeCollectionsCache({ collections: [], fetchedAt: -5 }), { categories: [], fetchedAt: 0 });
  assert.deepEqual(normalizeCollectionsCache({ collections: [], fetchedAt: "soon" }), { categories: [], fetchedAt: 0 });

  const cache = normalizeCollectionsCache({ collections: [wire("linux", "Linux", 0)], fetchedAt: 12 });
  assert.equal(cache.fetchedAt, 12);
  assert.deepEqual(cache.categories.map((category) => category.slug), ["linux"]);
});

test("collectionsErrorMessage names the failure the user can act on", () => {
  assert.match(collectionsErrorMessage("conflict"), /already exists/);
  assert.match(collectionsErrorMessage("not_found"), /no longer exists/);
  assert.match(collectionsErrorMessage("backend_unavailable"), /unavailable/);
  assert.equal(collectionsErrorMessage(undefined), "Could not change categories");
  assert.equal(collectionsErrorMessage("internal"), "Could not change categories");
});
