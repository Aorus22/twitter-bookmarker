import test from "node:test";
import assert from "node:assert/strict";

import {
  FILENAME_PATTERN,
  isValidFilename,
  shortId,
  slugifyFilename,
} from "../src/shared/filename.ts";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("PRD §8 examples produce the exact expected filenames", () => {
  assert.equal(slugifyFilename("Linux", UUID), "linux.csv");
  assert.equal(slugifyFilename("AI & LLM", UUID), "ai-llm.csv");
  assert.equal(slugifyFilename("Read Later", UUID), "read-later.csv");
});

test("empty slug falls back to category-<short-id>.csv", () => {
  const filename = slugifyFilename("!!!", UUID);
  assert.equal(filename, "category-3f2504e0.csv");
  assert.match(filename, FILENAME_PATTERN);
});

test("unicode-only and whitespace-only names fall back too", () => {
  for (const name of ["\u{1F427}", "   ", "***", "&", "---"]) {
    const filename = slugifyFilename(name, UUID);
    assert.match(filename, FILENAME_PATTERN, `name=${JSON.stringify(name)} -> ${filename}`);
    assert.equal(filename, "category-3f2504e0.csv");
  }
});

test("fallback stays valid even when the id sanitizes to nothing", () => {
  for (const id of ["", "!!!", "%%%", "\u{1F427}"]) {
    const filename = slugifyFilename("!!!", id);
    assert.match(filename, FILENAME_PATTERN, `id=${JSON.stringify(id)} -> ${filename}`);
  }
});

test("generated filenames always match the backend regex", () => {
  const names = [
    "Linux",
    "AI & LLM",
    "Read Later",
    "  Mixed CASE  ",
    "Café ☕ Notes",
    "a/b\\c",
    "..",
    "../../etc/passwd",
    "~/.ssh",
    "100% Design",
    "f#!@$%^&*()",
    "ééé",
    "hello___world",
    "Leading-trailing-",
    "-leading",
    "-",
    "0",
    "9lives",
  ];

  for (const name of names) {
    const filename = slugifyFilename(name, UUID);
    assert.match(filename, FILENAME_PATTERN, `name=${JSON.stringify(name)} -> ${filename}`);
    assert.ok(isValidFilename(filename));
  }
});

test("slug rules: lowercase, spaces to '-', unsafe chars stripped, runs collapsed", () => {
  assert.equal(slugifyFilename("LINUX", UUID), "linux.csv");
  assert.equal(slugifyFilename("  Read   Later  ", UUID), "read-later.csv");
  assert.equal(slugifyFilename("a---b", UUID), "a-b.csv");
  assert.equal(slugifyFilename("Café", UUID), "cafe.csv");
  assert.equal(slugifyFilename("100% Design", UUID), "100-design.csv");
  assert.equal(slugifyFilename("-leading-trailing-", UUID), "leading-trailing.csv");
});

test("path-traversal characters can never survive slugging", () => {
  for (const name of ["../../something", "/etc/passwd", "~/.ssh/id_rsa", "..\\..\\win"]) {
    const filename = slugifyFilename(name, UUID);
    assert.doesNotMatch(filename, /[/\\~]/);
    assert.doesNotMatch(filename, /\.\./);
    assert.match(filename, FILENAME_PATTERN);
  }
});

test("isValidFilename mirrors the backend regex", () => {
  assert.ok(isValidFilename("linux.csv"));
  assert.ok(isValidFilename("ai-llm.csv"));
  assert.ok(isValidFilename("category-3f2504e0.csv"));
  assert.ok(!isValidFilename("Linux.csv"));
  assert.ok(!isValidFilename("../linux.csv"));
  assert.ok(!isValidFilename("linux.txt"));
  assert.ok(!isValidFilename(".csv"));
  assert.ok(!isValidFilename("-linux.csv"));
  assert.ok(!isValidFilename("linux csv"));
  assert.ok(!isValidFilename(""));
  // The backend regex allows a trailing/doubled "-" (the first char may not be "-");
  // slugifyFilename is stricter and never emits one.
  assert.ok(isValidFilename("linux-.csv"));
  assert.equal(slugifyFilename("linux-", "11111111-1111"), "linux.csv");
});

test("shortId is deterministic, lowercase, and alphanumeric", () => {
  assert.equal(shortId(UUID), "3f2504e0");
  assert.equal(shortId("ABCDEFGH-IJKL"), "abcdefgh");
  assert.equal(shortId(""), "00000000");
});
