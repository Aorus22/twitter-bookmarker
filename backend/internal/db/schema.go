package db

// trashSchema is the one table version 2 added, kept in its own constant because
// two callers need exactly this text: a fresh database (through schema below) and
// the in-place upgrade of a version-1 file (upgradeV1toV2). Duplicating it would
// let the two paths drift into different shapes.
//
//   - There is deliberately **no** foreign key to `collections`. The trash must
//     outlive the folder it came from: with `ON DELETE CASCADE` a deleted
//     collection would quietly empty the trash, which is the opposite of what a
//     recoverable delete is for.
//   - `id` is the primary key, not `tweet_id`: saving and deleting the same tweet
//     twice must record two events rather than overwrite the first. A live
//     bookmark is free to reuse a `tweet_id` that the trash still mentions,
//     because the trash is a log, not a claim on the id.
//   - `collection_id` is copied rather than resolved, so restoring a row needs no
//     lookup and the original folder is still recorded even after a move.
const trashSchema = `
CREATE TABLE deleted_bookmarks (
  id            INTEGER PRIMARY KEY,
  tweet_id      TEXT NOT NULL,
  collection_id INTEGER NOT NULL,
  url           TEXT NOT NULL,
  author        TEXT NOT NULL,
  username      TEXT NOT NULL,
  tweet_date    TEXT NOT NULL,
  saved_at      TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  media         TEXT NOT NULL DEFAULT '[]',
  deleted_at    TEXT NOT NULL
);

CREATE INDEX deleted_bookmarks_by_tweet
  ON deleted_bookmarks(tweet_id, deleted_at DESC);
`

// collectionsSchema is the `collections` table definition as of version 3. It is
// kept in its own constant because two callers need exactly this text: the fresh
// schema below and the in-place upgrade from version 2 (upgradeV2toV3), where the
// columns are added with ALTER TABLE. Keeping one copy is what stops the two
// paths from drifting into different shapes.
//
// `color` and `sort_order` are part of the collection resource itself rather than
// client state: the backend owns categories now, and both the browser extension
// and the phone read the same colour and the same order (see README, "Categories
// live in the backend"). An empty `color` means "no colour chosen yet" and every
// client falls back to its own default constant, so a row written before this
// column existed renders exactly as it did before.
//
// `sort_order` is dense and client-assigned (PUT /v1/collections/order renumbers
// it to 0..n-1), and the slug is the deterministic tie-break.
//
// `collections.slug` is the public key: it is what the extension sends, what the
// gallery URL carries, and what a reader sees. It is unique because two
// categories whose names collapse to the same slug are the same collection.
// Renaming recomputes it; a bookmark follows its collection because the foreign
// key is `collection_id`, never the slug.
const collectionsSchema = `
CREATE TABLE collections (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX collections_by_order
  ON collections(sort_order, slug);
`

// schema is the whole database, version 3. It is one CREATE batch executed in a
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
//   - `collections.color` and `collections.sort_order` are part of the resource,
//     not of any one client — see collectionsSchema above.
//   - `bookmarks.tweet_id` is the primary key, which is what makes the global
//     "one tweet may only be saved once" invariant a database constraint instead
//     of application bookkeeping.
//   - `bookmarks.media` stays a JSON array in a TEXT column, byte-for-byte the
//     value the extension sent. Normalising it on the way in would lose the
//     malformed-but-harmless cells the read path is built to tolerate.
//   - Timestamps are RFC3339 UTC strings, so they sort and compare lexicographically
//     and stay readable in a plain `sqlite3` shell.
//
// `bookmarks` holds exactly the live set: a deleted bookmark is *moved* to
// `deleted_bookmarks` rather than flagged in place, so every read path —
// the reader, the index, the counts, the covers, the cursors — stays correct
// without a `deleted_at IS NULL` filter that a future query could forget.
const schema = collectionsSchema + `
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
` + trashSchema

// v1Tables is the exact table set version 1 defined. upgradeV1toV2 requires it
// before altering a file, because a version stamp is not evidence of shape.
//
// Ordered by name, which is what `userTables` returns: the comparison is
// element-wise, and "bookmarks" sorts before "collections".
var v1Tables = []string{"bookmarks", "collections"}

// expectedTables is what verifySchema insists on finding. The indexes are not
// listed: they are a performance detail, and a database missing one still returns
// correct answers.
//
// Ordered by name, like v1Tables: ensureSchema compares it element-wise against
// the result of `ORDER BY name` to recognise a version-2 file.
var expectedTables = []string{"bookmarks", "collections", "deleted_bookmarks"}

// expectedCollectionColumns are the columns version 3 added. A version-2 file
// that kept its stamp but lost an ALTER would otherwise read as current and fail
// at the first collection query instead of at startup.
var expectedCollectionColumns = []string{"color", "sort_order"}
