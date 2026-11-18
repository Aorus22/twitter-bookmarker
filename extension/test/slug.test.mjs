// The collection-slug validator.
//
// The extension no longer derives slugs — the backend does, from the name, in
// `storage.Slugify`. What is left here is the check applied to a slug arriving
// *from* elsewhere (a cache, a hand-edited `chrome.storage.local`, a backend), and
// it is a security boundary: the value ends up in a request path.

import test from "node:test";
import assert from "node:assert/strict";

import { SLUG_PATTERN, isValidSlug } from "../src/shared/slug.ts";

test("isValidSlug accepts the slugs the backend produces", () => {
  for (const slug of ["linux", "ai-llm", "read-later", "category-3f2504e0", "100-design", "linux-"]) {
    assert.ok(isValidSlug(slug), `${slug} should be valid`);
    assert.match(slug, SLUG_PATTERN);
  }
});

test("isValidSlug rejects anything that could not be a collection key", () => {
  const rejected = [
    "Linux",
    "AI & LLM",
    "linux slug",
    "linux.csv",
    "linux.txt",
    "../linux",
    "..",
    "../../etc/passwd",
    "/etc/passwd",
    "-linux",
    "_linux",
    "linux/extra",
    "linux?x=1",
    "linux#frag",
    "linux%2F",
    "café",
    "",
    " ",
  ];
  for (const slug of rejected) {
    assert.ok(!isValidSlug(slug), `${JSON.stringify(slug)} must be rejected`);
  }
});

test("isValidSlug only accepts strings", () => {
  for (const value of [undefined, null, 42, {}, [], true]) {
    assert.ok(!isValidSlug(value), `${JSON.stringify(value)} must be rejected`);
  }
});

test("SLUG_PATTERN is anchored at both ends", () => {
  assert.ok(!SLUG_PATTERN.test("linux\n"), "a trailing newline must not slip through");
  assert.ok(!SLUG_PATTERN.test(" linux"), "leading whitespace must not slip through");
});
