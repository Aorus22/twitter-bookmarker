# Manual Test Checklist — Twitter Bookmarker

Executable checklist for the PRD §68 test scenarios (plus the §64 edge cases and
the popup/toast scenarios automation cannot prove). Every row has exact steps,
an observable expected result, and what to inspect on disk.

> This file is the manual half of Phase 6. The automated half is
> `go test ./... -race` (backend, PRD §65 items 1–20) and `npm test`
> (extension, 158 tests). Anything automated there is **not** repeated here.
>
> A literal `~/.twitter-bookmarker/...` below is the **default** storage path. If
> you started the backend with `TWITTER_BOOKMARKER_DIR`, substitute that
> directory — see [Disk locations](#disk-locations-and-inspection-commands).
>
> Storage is one SQLite database (`tw-bookmarker.db`). The schema, the pragmas
> and the read path are specified in
> [`design/sqlite-migration.md`](design/sqlite-migration.md); inspect it with the
> `sqlite3` CLI (see the table below).

---

## 1. Prerequisites

| Requirement | Check |
|---|---|
| Go ≥ 1.22 | `go version` |
| Node ≥ 20 + npm | `node --version && npm --version` |
| Chrome / Chromium | any recent stable |
| `sqlite3` (database inspection) | `sqlite3 --version` |
| `python3` (JSON inspection) | `python3 --version` |
| A signed-in X account with at least 6 bookmarks | `https://x.com/i/history` |

### Build and run

```bash
# From the repo root:
make build                     # backend binary + extension/dist
make run                       # starts the loopback server (Ctrl+C to stop)

# Extension only (already covered by `make build`, shown for reference):
cd extension && npm run build
```

### Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select `extension/dist/`
4. Pin the extension so the popup is one click away

### Create the categories used below

Open the popup and add, in order: **AI**, **Linux**, **Design**.
Set display mode to **Popover** first; switch to **Inline** only for scenario B9.

### Disk locations and inspection commands

Everything below uses `<storage>`: `$TWITTER_BOOKMARKER_DIR` when that is set,
`~/.twitter-bookmarker` otherwise (PRD §15). With `make run` the value comes from
`.env.local` or the command line, so mirror it here:

| What | Path / command |
|---|---|
| Storage dir | `ls -la "$STORAGE"` |
| Database | `$STORAGE/tw-bookmarker.db` |
| Schema version | `sqlite3 "$DB" 'PRAGMA user_version;'` |
| Collections + post counts | `sqlite3 -header -column "$DB" "SELECT c.slug, c.name, count(b.tweet_id) AS posts FROM collections c LEFT JOIN bookmarks b ON b.collection_id = c.id GROUP BY c.id ORDER BY c.slug;"` |
| One collection's newest rows | `sqlite3 -header -column "$DB" "SELECT b.tweet_id, b.author, b.saved_at, b.text FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 5;"` |
| Health | `curl -s http://127.0.0.1:43121/health` |
| Index over HTTP | `curl -s http://127.0.0.1:43121/v1/index \| python3 -m json.tool` |
| Gallery collections | `curl -s http://127.0.0.1:43121/api/gallery/collections \| python3 -m json.tool` |

```bash
export STORAGE="${TWITTER_BOOKMARKER_DIR:-$HOME/.twitter-bookmarker}"
export DB="$STORAGE/tw-bookmarker.db"
```

> The `sqlite3` CLI defaults `PRAGMA foreign_keys` to **off**. Reads are
> unaffected; before any manual `DELETE FROM collections`, run
> `PRAGMA foreign_keys=ON` in the same session (or pass
> `-cmd 'PRAGMA foreign_keys=ON'`) so `ON DELETE CASCADE` fires. The server's own
> connections always have it on because it is set in the DSN
> ([`design/sqlite-migration.md`](design/sqlite-migration.md) §4).

> **Isolated smoke run (never touches real data):**
> `TWITTER_BOOKMARKER_DIR=$(mktemp -d) ./backend/bin/twitter-bookmarker-server`
> An explicit env var wins over `$HOME`, so the database lands in the temp dir.
> Use this for the pure-backend scenarios (A1–A5) if you do not want to touch
> real data. To seed a disposable database with known contents instead, run
> `bash scripts/seed-gallery-fixture.sh /tmp/twbm-manual --fresh`.

### Reading the UI

| Where | What |
|---|---|
| Row directly **above** the tweet action bar | organizer root: `[Organize]` (popover) or category chips (inline) — its own full-width row, never sharing the native tools' row |
| Popover panel | AI / Linux / Design rows, each with its colour dot |
| Saved tweet | `✓ Saved` replacing the category controls |
| Toasts | bottom-right stack, auto-dismiss ~3.5 s, click to dismiss |

---

## 2. Scenario index

| ID | Scenario | Layer |
|---|---|---|
| A1 | Normal save | Backend + browser |
| A2 | Second save same tweet (duplicate) | Backend + browser |
| A3 | Backend offline | Browser |
| A4 | Auto-unbookmark enabled | Browser |
| A5 | Auto-unbookmark fails | Browser |
| B1 | Rename category | Browser (popup) |
| B2 | Delete category | Browser (popup) |
| B3 | Browser reload shows `✓ Saved` | Browser |
| B4 | Backend restart (no derived index) | Backend + browser |
| B5 | Stray CSV/index sidecars ignored | Backend + browser |
| B6 | Popup live reorder without reload | Browser (popup) |
| B7 | Popup Connected / Disconnected | Browser (popup) |
| B8 | Double-click category → one request | Browser + backend log |
| C1 | Multiline tweet | Browser |
| C2 | Emoji author | Browser |
| C3 | Quoted tweet (parent text only) | Browser |
| C4 | Image-only tweet (empty text) | Browser |
| D1 | SPA navigation away/back | Browser |
| D2 | Infinite scroll | Browser |
| D3 | DOM re-render (no duplicate controls) | Browser |
| E1 | Toast visuals / stacking / click-through | Browser |
| F1 | PRD §82 end-to-end gallery scenario (24 steps) | Backend + browser |

---

## 3. Scenarios

### A1 — Normal save  ·  PRD §68 *Normal save*

**Steps**
1. `make run` (the server logs `listening=127.0.0.1:43121` and the storage dir
   as structured `slog` text, plus `collections=N bookmarks=M`).
2. Open `https://x.com/i/history`; wait for organizers to appear.
3. Click **Linux** on any tweet.

**Expected**
- Success toast `Saved to Linux`.
- The tweet's controls are replaced by `✓ Saved`.
- Server log shows one save; no error.

**Inspect on disk**
```bash
sqlite3 -header -column "$DB" "SELECT b.tweet_id, b.url, b.author, b.username, b.tweet_date, b.saved_at, b.text, b.media FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;"
curl -s http://127.0.0.1:43121/v1/index | python3 -m json.tool
```
- The `linux` collection holds exactly one bookmark row for the tweet (and the
  `collections` table has one `slug='linux'`, `name='Linux'` row).
- The row's `saved_at` ends in `Z` (UTC) and the URL is canonical
  (`https://x.com/<handle>/status/<id>`, no `?s=` tracking suffix).
- `media` parses as a JSON array. On a tweet with a photo it holds
  `https://pbs.twimg.com/media/<id>.<ext>` (sizing query stripped); on a tweet
  with video/GIF it holds the `amplify_video_thumb`/`tweet_video_thumb` poster;
  on a text-only tweet it is exactly `[]`:

  ```bash
  sqlite3 "$DB" "SELECT b.media FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;" | python3 -c "import json,sys; print(json.load(sys.stdin))"
  ```
- `/v1/index` has one `items["<id>"]` entry with `"slug":"linux"`.

> **Prerequisite for existing installs:** a directory from the CSV era must be
> migrated before the server can see its data, because the backend no longer
> reads CSVs at all. Run the data repository's
> `Scripts/migrate_to_sqlite.py` (see
> [`design/sqlite-migration.md`](design/sqlite-migration.md) §9); it moves the
> CSVs and `index.json` into `backup/` and leaves `tw-bookmarker.db` in place.
> Save a fresh tweet afterwards to prove the database path end to end.

---

### A2 — Second save same tweet  ·  PRD §68 *Second save same tweet*

**Steps**
1. On a tweet already saved to **Linux**, click **AI**.

**Expected**
- Info toast `Already saved` (not a success or error toast).
- The tweet shows `✓ Saved`; **no** new row anywhere.
- Server log records a duplicate `409`.

**Inspect on disk**
```bash
sqlite3 -header -column "$DB" "SELECT c.slug, c.name, count(b.tweet_id) AS posts FROM collections c LEFT JOIN bookmarks b ON b.collection_id = c.id GROUP BY c.id ORDER BY c.slug;"
sqlite3 "$DB" "SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux';"
```
- The `linux` post count is unchanged.
- There is no `ai` bookmark row for that tweet id, and no `ai` collection was
  created (the duplicate check runs before the collection upsert; the duplicate
  key is global, across collections, enforced by `bookmarks.tweet_id` being the
  primary key).

---

### A3 — Backend offline  ·  PRD §68 *Backend offline*

**Steps**
1. Stop the server (Ctrl+C in the `make run` terminal).
2. On a bookmarked tweet, click **Design**.

**Expected**
- Error toast `Backend unavailable`.
- Controls are **restored** (the tweet is not marked `✓ Saved`).
- The tweet remains bookmarked on X — no unbookmark is attempted even if
  auto-unbookmark is enabled (PRD §4.2).

**Inspect on disk**
- No new `design` collection or bookmark row; the database is byte-identical
  (compare `ls -l "$DB"` before and after).

---

### A4 — Auto-unbookmark enabled  ·  PRD §68 *Auto-unbookmark enabled*

**Steps**
1. In the popup, enable **Unbookmark after save**.
2. Save a **new** tweet to any category.

**Expected**
- Success toast `Saved to <Category>` first.
- The database row is committed, then the tweet disappears from X Bookmarks (or
  its native bookmark icon turns back to the un-bookmarked state).
- No warning toast.

**Inspect on disk**
- The new row is present and complete **before** the tweet leaves X:
  ```bash
  sqlite3 -header -column "$DB" "SELECT c.slug, b.tweet_id, b.saved_at FROM bookmarks b JOIN collections c ON c.id = b.collection_id ORDER BY b.saved_at DESC LIMIT 1;"
  ```
- `/v1/index` contains the id (the endpoint reads the same tables).

---

### A5 — Auto-unbookmark fails  ·  PRD §68 *Auto-unbookmark fails*

**Steps**
1. Keep **Unbookmark after save** enabled.
2. Force a verification failure — e.g. save a tweet whose native bookmark
   control X has already detached, or block the click by pausing the tab at the
   moment of the save.
3. Observe for ~2 s (the verification timeout).

**Expected**
- Warning toast `Saved to <Category>, but failed to remove from X bookmarks`.
- The database row **remains**; `✓ Saved` remains; nothing is rolled back.
- The tweet may still be bookmarked on X — that is the accepted outcome.

**Inspect on disk**
- The bookmark row written by this save is still present after the warning:
  ```bash
  sqlite3 -header -column "$DB" "SELECT c.slug, b.tweet_id, b.url FROM bookmarks b JOIN collections c ON c.id = b.collection_id ORDER BY b.saved_at DESC LIMIT 1;"
  ```

---

### B1 — Rename category  ·  PRD §68 *Rename category*

**Steps**
1. Save one tweet to **Linux** so the `linux` collection exists.
2. In the popup, rename **Linux** → **Linux Stuff** and confirm.
3. Save a different tweet to the renamed category.

**Expected**
- The old `linux` collection and its rows are untouched; new saves use the new
  slug `linux-stuff`.
- No toast error; the popup shows the new name and the new slug.

**Inspect on disk**
```bash
sqlite3 -header -column "$DB" "SELECT id, slug, name FROM collections ORDER BY slug;"
sqlite3 "$DB" "SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux';"
sqlite3 "$DB" "SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux-stuff';"
```
- `linux` still has exactly its original row.
- `linux-stuff` is a **new** collection row with the new bookmark. Renaming
  changes the slug (which is derived from the name), so it never rewrites the old
  bookmark rows.
- `/v1/index` maps each tweet id to the slug used at save time.

---

### B2 — Delete category  ·  PRD §68 *Delete category*

**Steps**
1. With the `linux` collection populated, delete the **Linux Stuff** category in
   the popup.
2. Confirm the native dialog: `Delete category "Linux Stuff"? Existing CSV data
   will not be deleted.`
3. Save a different tweet to another category (e.g. **AI**).

**Expected**
- The category disappears from the popup.
- No backend request is made for the delete (no server log line).
- The database is untouched; `/v1/index` entries for deleted categories are
  untouched.

**Inspect on disk**
```bash
sqlite3 -header -column "$DB" "SELECT slug, name FROM collections ORDER BY slug;"
sqlite3 "$DB" "SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug IN ('linux','linux-stuff');"
```
- The `linux` / `linux-stuff` collections and their bookmark rows are still
  there — deleting a category only edits `chrome.storage.local`.
- Previously saved tweets still show `✓ Saved` on reload (edge case §64
  *"tweet saved in category that no longer exists"*).

> The popup's confirm text still says "Existing CSV data will not be deleted."
> That string lives in `extension/src/popup/category-manager.ts` and was not part
> of the storage migration; quote it as-is when matching the dialog, and read it
> as "existing bookmark data".

---

### B3 — Browser reload shows `✓ Saved`  ·  PRD §68 *Browser reload*

**Steps**
1. Save a tweet, then hard-reload `https://x.com/i/history` (F5).
2. Wait for the timeline and organizers to render.

**Expected**
- The previously saved tweet displays `✓ Saved` **before** the user clicks
  anything (the index is fetched once on page entry).
- `chrome://extensions` → the content script makes **one** `/v1/index` request
  per page entry (check the service worker console / network tab).

**Inspect on disk**
- `/v1/index` unchanged by the reload (it is computed from the database, never
  written back).

---

### B4 — Backend restart (no derived index)  ·  PRD §68 *Backend restart without index.json*

**Steps**
1. Stop the server.
2. `make run` again (there is no derived index file to delete first — that is the
   point of the scenario).
3. Reload `https://x.com/i/history`.

**Expected**
- Startup log reports `collections=N bookmarks=M` for the existing database; the
  server starts normally.
- Previously saved tweets show `✓ Saved` again.

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT count(*) FROM collections;"   # unchanged
sqlite3 "$DB" "SELECT count(*) FROM bookmarks;"     # unchanged
sqlite3 "$DB" "PRAGMA integrity_check;"             # 'ok'
```
- The database is byte-identical across the restart (the server only reads it at
  startup to count, and never rewrites it on open).
- `/v1/index` lists every id.

---

### B5 — Stray CSV/index sidecars ignored  ·  PRD §68 *Corrupt index.json*

**Steps**
1. Stop the server.
2. Drop CSV-era leftovers into the storage directory (this is exactly what the
   migration leaves behind, and what the fixture seeds as decoys):
   ```bash
   printf 'not json' > "$STORAGE/index.json"
   printf 'url,media,author,username,tweet_date,saved_at,text\nhttps://x.com/leftover/status/1,"[]",Leftover,@leftover,2026-01-01T00:00:00Z,2026-01-01T00:00:00Z,decoy\n' > "$STORAGE/linux.csv"
   ```
3. `make run`; reload X Bookmarks.

**Expected**
- The server starts normally and logs the **same** collection and bookmark
  counts — the backend owns only `tw-bookmarker.db` and never scans the directory
  (no `backup/` handling, no CSV reader).
- Saved tweets still show `✓ Saved`; duplicates are still rejected.

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT count(*) FROM bookmarks;"   # unchanged — the decoy row is not read
sqlite3 "$DB" "SELECT count(*) FROM collections WHERE slug = 'leftover';"   # -> 0
curl -s http://127.0.0.1:43121/api/gallery/collections | python3 -m json.tool  # no 'leftover'
```
- The database is byte-identical to before the decoys were added.
- A corrupt `index.json` cannot break the server, because nothing reads it.

> Clean up the decoys afterwards if you plan to run the migration script:
> `rm -f "$STORAGE/index.json" "$STORAGE/linux.csv"`.

---

### B6 — Popup live reorder without reload  ·  PRD §51 / §64

**Steps**
1. Keep `https://x.com/i/history` open with organizers visible.
2. In the popup, drag **Design** above **AI**.
3. Without reloading X, look at an organizer (popover or inline).

**Expected**
- The visible category controls reorder live (storage-change propagation) —
  no reload, no duplicate controls.
- Open popovers close cleanly if their tweet is removed.

---

### B7 — Popup Connected / Disconnected  ·  PRD §44

**Steps**
1. With the server running, open the popup → status shows **Connected**.
2. Stop the server, reopen the popup → **Disconnected**.
3. Start the server again, reopen the popup → **Connected**.

**Expected**
- The probe uses `GET /health` with a ~1.5 s timeout; a stopped backend shows
  **Disconnected** without hanging the popup.

---

### B8 — Double-click category → one request  ·  PRD §64 *Double-click category*

**Steps**
1. With the server log visible, double-click **Linux** on an unsaved tweet.
2. Watch the controls: they show a disabled/saving state.

**Expected**
- Exactly **one** `POST /v1/bookmarks` in the server log.
- One success toast; one bookmark row in the database.
- The controls disable immediately, so the second click is ignored.

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT count(*) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux';"
```
- Exactly 1 row for that tweet (the primary key makes a second insert impossible).

---

### C1 — Multiline tweet  ·  PRD §68 *Multiline tweet*

**Steps**
1. Find or post a bookmark whose text contains a blank line between paragraphs.
2. Save it.

**Expected**
- Success toast; the stored text stays intact (the internal newline is preserved
  verbatim — there is no CSV quoting layer any more).

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT quote(b.text) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;"
```
- The `text` value keeps the internal newline and trims only leading/trailing
  whitespace (PRD §14).

---

### C2 — Emoji author  ·  PRD §68 *Emoji author*

**Steps**
1. Save a tweet whose display name contains an emoji (e.g. `Foo, Bar 🐧`).

**Expected**
- The text is stored as raw UTF-8; no mojibake.

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT b.author FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;"
sqlite3 "$DB" "PRAGMA encoding;"     # reports UTF-8
```

---

### C3 — Quoted tweet (parent text only)  ·  PRD §68 *Quoted tweet*

**Steps**
1. Save a quote tweet: outer comment + embedded quoted tweet.

**Expected**
- Only the **parent** text is saved. The quoted text never appears in the
  database.

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT count(*) FROM bookmarks WHERE text LIKE '%<distinctive quoted phrase>%';"   # -> 0
```
- The row's `text` equals the outer comment; the `url`/`author`/`username` are
  the parent tweet's, not the quoted one's.

---

### C4 — Image-only tweet  ·  PRD §68 *Image-only tweet*

**Steps**
1. Save a bookmark that has media but no text.

**Expected**
- The row is created with an empty `text` value (the tweet is still saveable).

**Inspect on disk**
```bash
sqlite3 "$DB" "SELECT quote(b.text) FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;"   # -> ''
sqlite3 "$DB" "SELECT b.media FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'linux' ORDER BY b.saved_at DESC LIMIT 1;"        # -> non-empty JSON array
```

---

### D1 — SPA navigation away/back  ·  PRD §64 *navigates away / returns*

**Steps**
1. On `https://x.com/i/history`, confirm organizers are present.
2. Click a tweet or a nav item to leave Bookmarks (same tab, no reload).
3. Return to `https://x.com/i/history` via X's own navigation.

**Expected**
- Leaving removes all injected controls; unrelated timelines never get
  organizers (PRD §26).
- Returning re-fetches the index once and re-injects controls; no broken state,
  no duplicated roots.
- No toast survives the route change (route-leave cleanup dismisses them).

---

### D2 — Infinite scroll  ·  PRD §64 *Infinite scrolling*

**Steps**
1. Scroll `https://x.com/i/history` to load several pages of older tweets.

**Expected**
- Every newly loaded row receives controls exactly once.
- No full-document rescans or per-tweet index requests (the sweep is debounced).

---

### D3 — DOM re-render (no duplicate controls)  ·  PRD §64 *DOM re-render*

**Steps**
1. On a tweet showing controls, trigger an X re-render — e.g. open and close a
   quoted tweet, or resize/scroll so X recycles the row.
2. Inspect the row directly above the action bar of that tweet.

**Expected**
- Exactly **one** organizer root per tweet, with one set of category controls.
- If X wipes our root but keeps the container, the debounced sweep re-injects it
  once; if X replaces the whole article node, the fresh node gets controls once.

**Optional DOM assertion (DevTools console on the page)**
```js
document.querySelectorAll('[data-twitter-bookmarker-root]').length
// equals the number of visible bookmarked tweets — never two per tweet
```

---

### E1 — Toast visuals / stacking / click-through  ·  PRD §42

**Steps**
1. Trigger several toasts quickly (a success, an error, and a warning).
2. Click a toast; then click on the page just outside the toast stack.

**Expected**
- Fixed bottom-right stack, newest below/above the others without overlap.
- Toast container has `pointer-events: none`; each toast re-enables pointer
  events. Clicking a toast dismisses **only** that toast; clicking outside the
  stack hits X normally (no dead click zone).
- Toasts auto-dismiss after ~3.5 s; the container is removed with the last one.
- `aria-live="polite"` is present on the container (screen-reader announce).

**Optional DOM assertion**
```js
const root = document.querySelector('[data-twitter-bookmarker-toast-root]');
getComputedStyle(root).pointerEvents;   // 'none'
root.querySelector('[data-twitter-bookmarker-toast]').style.pointerEvents; // 'auto'
```

---

## 4. PRD §82 — end-to-end acceptance scenario (F1)

The full integration walkthrough, in PRD order. Steps **1–15 and 22–24** are
locked automatically by `bash scripts/check-gallery-acceptance.sh` (HTTP) and
steps **16–21** by `bash scripts/check-web-acceptance.sh` (browser, axe and
keyboard); both run under `make verify`. Do this by hand only when you need to
see the pixels, or when the scripts are unavailable.

Seed a disposable storage dir first (never the real one):

```bash
FIXTURE="$(mktemp -d)"
bash scripts/seed-gallery-fixture.sh "$FIXTURE"
TWITTER_BOOKMARKER_DIR="$FIXTURE" TWITTER_BOOKMARKER_WEB_DIR="$PWD/web/dist" \
  ./backend/bin/twitter-bookmarker-server &
```

### Steps 1–4 — start and open the gallery

| # | Step | Expected |
|---|---|---|
| 1 | `curl -s http://127.0.0.1:43121/health` | `{"status":"ok"}` |
| 2 | `ls "$FIXTURE"` | `tw-bookmarker.db` present. The seeded CSV-era decoys (`linux.csv`, `index.json`, `linux.csv.bak`, `.hidden.csv`, `notes.txt`, `subdir/`) are all ignored by the server |
| 3 | Open `http://127.0.0.1:43121/` | Homepage hero + **My Collections** |
| 4 | Look at the collection cards | **AI**, **Linux**, **Design**, each with post/media counts and a cover |

### Steps 5–8 — open a collection

| # | Step | Expected |
|---|---|---|
| 5 | Click **Linux** | URL becomes `/collections/linux` |
| 6 | Look at the masonry | 8 post cards, 1–4 columns by viewport width |
| 7 | Find the 4-image tweet | Four tiles in a 2×2 grid, all decoded |
| 8 | Find the text-only tweet | A text card with no media region — it is not dropped |

### Steps 9–15 — search, filter, sort, paginate

| # | Step | Expected |
|---|---|---|
| 9 | Type `wayland` in search | Results narrow to 2 cards |
| 10 | Clear search, click **Filter** | Desktop: Popover; ≤767 px: bottom Sheet |
| 11 | Bookmark Date → **Last 7 Days** | The saved-date window is set (7 of the 8 rows) |
| 12 | Add a **Tweet Date** from-bound | Both ranges are now active |
| 13 | Click **Apply** | Results shrink to the rows satisfying **both** ranges (5); every visible card matches |
| 14 | Sort → **Newest Posted** | The newest tweet is first |
| 15 | Scroll to the bottom | The next page loads via cursor; no duplicates, no full reload; **the cards already on screen keep their column and do not move** |

### Steps 16–21 — lightbox, keyboard, original tweet

| # | Step | Expected |
|---|---|---|
| 16 | Click an image tile | Lightbox dialog opens for that tweet |
| 17 | Look at the media area | The clicked tweet's image, plus author/handle meta; the indicator is **dots**, one per image *in that tweet* (a 4-image tweet shows 4 dots even when the collection has hundreds), with the active one filled |
| 18 | Press `→` (or click the arrow inside the media area) | The next dot fills — the next image of **the same tweet**; at the tweet's last image the control is disabled and `→` does nothing |
| 19 | Press `←` (or click the arrow inside the media area) | The previous image of the same tweet; disabled at the tweet's first image |
| 20 | Inspect **Open on X** | `href` is the canonical `https://x.com/<user>/status/<id>`; `target="_blank"` + `rel="noopener noreferrer"` |
| 20a | Press `↓` (or click the **double-chevron** button outside the panel) | The lightbox moves to the next tweet that has media, skipping text-only tweets, and shows that tweet's **first** image with the dots reset to its count; `↑` (or the left double-chevron) goes back. Below 1400 px wide these two buttons sit at the media area's top corners rather than in the page gutter |
| 21 | Click **Open on X** | The original tweet opens in a new tab (requires network); `Esc` closes the lightbox and returns focus to the tile |

### Steps 22–24 — live data, no restart

| # | Step | Expected |
|---|---|---|
| 22 | Save a new tweet through the extension (or `POST /v1/bookmarks` with `{"slug":"scenario","name":"Scenario","tweet":{…}}`) | `201 Created`; the row is inserted into the live database |
| 23 | Return to the gallery (or refocus the window) | The collection list and the open collection re-read the database on `focus` |
| 24 | Look at the gallery | The new collection/post appears **without restarting the backend**; `/health` still answers from the same process |

Inspect step 22 directly in the database:

```bash
sqlite3 -header -column "$FIXTURE/tw-bookmarker.db" "SELECT c.slug, b.tweet_id, b.saved_at FROM bookmarks b JOIN collections c ON c.id = b.collection_id WHERE c.slug = 'scenario';"
```

**Accessibility sub-check (HARD-04).** Repeat steps 3–21 with a keyboard only
(`Tab` / `Shift+Tab` / `Enter` / `Space` / arrows / `Esc`): every control is
reachable, paints a visible focus ring, the lightbox traps `Tab` and names all
four navigation controls distinctly (`Previous media` / `Next media` /
`Previous post` / `Next post` — the two pairs look alike), `Esc` restores focus
to the originating tile, and images carry an author-derived `alt`. With a screen
reader, the nav, toolbar and lightbox announce meaningful names, and the dots
indicator announces the exact position (`Media 2 of 4`).

**Responsive sub-check (HARD-03).** At 390 / 768 / 1440 px the masonry shows
1 / 2 / 4 columns; **Filter** is a Sheet at 390 and a Popover at 1440; the
wordmark is hidden at 390 px (the logo and the accessible name stay).

**Scroll-stability sub-check.** On a collection with more than one page (the
browser gate seeds a `bulk` collection of 70 posts into the same fixture
database), scroll slowly from top to bottom while watching one card. It must
never change column or jump: the packing is append-only, so a new page can only
add cards at the bottom of a column. Resizing the window *does* re-pack (a real
layout change), and that is expected.

---

## 5. Sign-off

- [ ] A1–A5 pass
- [ ] B1–B8 pass
- [ ] C1–C4 pass
- [ ] D1–D3 pass
- [ ] E1 passes
- [ ] F1 (PRD §82, steps 1–24) passes
- [ ] No server process left running (`pgrep -f twitter-bookmarker-server` is empty)

**Residual automated coverage (do not re-test manually):** PRD §65 items 1–20
are locked by `cd backend && go test ./... -race`; extraction, quoted/media
handling, slug generation, the double-click in-flight guard, DOM re-injection,
observer resilience, bounded cleanup and the saved-index retry are locked by
`cd extension && npm test` (158 tests).
