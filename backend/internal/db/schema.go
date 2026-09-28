package db

// schema is the whole database, version 1. It is one CREATE batch executed in a
// single transaction by applySchema.
//
// Design notes:
//
//   - `collections.slug` is the public key: it is what the extension sends, what
//     the gallery URL carries, and what a reader sees. It is unique because two
//     categories whose names collapse to the same slug are the same collection.
//   - `collections.id` is a surrogate key so the bookmark foreign key stays an
//     integer and a future slug change is a one-row update instead of a rewrite.
//   - `collections.name` is stored rather than derived: the extension knows what
//     the user actually typed ("Chibi Art", not "Chibi-Art"), and keeping it means
//     the database is readable without the application.
//   - `bookmarks.tweet_id` is the primary key, which is what makes the global
//     "one tweet may only be saved once" invariant a database constraint instead
//     of application bookkeeping.
//   - `bookmarks.media` stays a JSON array in a TEXT column, byte-for-byte the
//     value the extension sent. Normalising it on the way in would lose the
//     malformed-but-harmless cells the read path is built to tolerate.
//   - Timestamps are RFC3339 UTC strings, so they sort and compare lexicographically
//     and stay readable in a plain `sqlite3` shell.
const schema = `
CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE bookmarks (
  tweet_id      TEXT PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  author        TEXT NOT NULL,
  username      TEXT NOT NULL,
  tweet_date    TEXT NOT NULL,
  saved_at      TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  media         TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX bookmarks_by_collection_saved
  ON bookmarks(collection_id, saved_at, tweet_id);

CREATE INDEX bookmarks_by_collection_tweet
  ON bookmarks(collection_id, tweet_date, tweet_id);
`

// expectedTables is what verifySchema insists on finding. The indexes are not
// listed: they are a performance detail, and a database missing one still returns
// correct answers.
var expectedTables = []string{"collections", "bookmarks"}
