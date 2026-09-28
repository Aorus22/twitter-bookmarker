# Manual Test Checklist — Twitter Bookmarker

Executable checklist for the PRD §68 test scenarios (plus the §64 edge cases and
the popup/toast scenarios automation cannot prove). Every row has exact steps,
an observable expected result, and what to inspect on disk.

> This file is the manual half of Phase 6. The automated half is
> `go test ./... -race` (backend, PRD §65 items 1–20) and `npm test`
> (extension, 157 tests). Anything automated there is **not** repeated here.
>
> A literal `~/.twitter-bookmarker/...` below is the **default** storage path. If
> you started the backend with `TWITTER_BOOKMARKER_DIR`, substitute that
> directory — see [Disk locations](#disk-locations-and-inspection-commands).

---

## 1. Prerequisites

| Requirement | Check |
|---|---|
| Go ≥ 1.22 | `go version` |
| Node ≥ 20 + npm | `node --version && npm --version` |
| Chrome / Chromium | any recent stable |
| `python3` (CSV/JSON inspection) | `python3 --version` |
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
| Category CSV | `$STORAGE/linux.csv` |
| Derived index | `$STORAGE/index.json` |
| Storage dir | `ls -la "$STORAGE"` |
| Health | `curl -s http://127.0.0.1:43121/health` |
| Index over HTTP | `curl -s http://127.0.0.1:43121/v1/index \| python3 -m json.tool` |
| Raw CSV | `cat "$STORAGE/linux.csv"` |
| Strict CSV parse | `python3 -c "import csv,sys; rows=list(csv.reader(open(sys.argv[1], newline=''), strict=True)); print(len(rows), rows[0])" "$STORAGE/linux.csv"` |
| Index parse | `python3 -m json.tool "$STORAGE/index.json"` |

```bash
export STORAGE="${TWITTER_BOOKMARKER_DIR:-$HOME/.twitter-bookmarker}"
```

> **Isolated smoke run (never touches real data):**
> `TWITTER_BOOKMARKER_DIR=$(mktemp -d) ./backend/bin/twitter-bookmarker-server`
> An explicit env var wins over `$HOME`, so CSV/index land in the temp dir. Use
> this for the pure-backend scenarios (A1–A8) if you do not want to touch real
> data.

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
| B4 | Backend restart without `index.json` | Backend + browser |
| B5 | Corrupt `index.json` | Backend + browser |
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
   as structured `slog` text).
2. Open `https://x.com/i/history`; wait for organizers to appear.
3. Click **Linux** on any tweet.

**Expected**
- Success toast `Saved to Linux`.
- The tweet's controls are replaced by `✓ Saved`.
- Server log shows one save; no error.

**Inspect on disk**
```bash
cat "$STORAGE/linux.csv"
curl -s http://127.0.0.1:43121/v1/index | python3 -m json.tool
```
- CSV has exactly one header row `url,media,author,username,tweet_date,saved_at,text`
  and exactly one data row for the tweet.
- The row's `saved_at` ends in `Z` (UTC) and the URL is canonical
  (`https://x.com/<handle>/status/<id>`, no `?s=` tracking suffix).
- `media` parses as a JSON array. On a tweet with a photo it holds
  `https://pbs.twimg.com/media/<id>.<ext>` (sizing query stripped); on a tweet
  with video/GIF it holds the `amplify_video_thumb`/`tweet_video_thumb` poster;
  on a text-only tweet it is exactly `[]`:

  ```bash
  python3 -c "import csv,json; r=list(csv.DictReader(open('$STORAGE/linux.csv',newline=''))); print([json.loads(x['media']) for x in r])"
  ```
- `index.json` has one `tweets["<id>"]` entry pointing at `linux.csv`.

> **Prerequisite for existing installs:** a directory whose CSVs still carry the
> six-column header must be migrated first (backend answers 500 by design).
> Run `Scripts/migrate_schema.py --apply`, `Scripts/backfill_media.py --apply`,
> then `Scripts/rebuild_index.sh` from the private data repository. Save a fresh
> tweet afterwards to prove the 7-column path end to end.

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
ls -la ~/.twitter-bookmarker/          # ai.csv must NOT exist (or gain a row)
python3 -c "import csv; print(len(list(csv.reader(open('$STORAGE/linux.csv')))))"
```
- Row count in `linux.csv` is unchanged.
- No `ai.csv` row for that tweet id (the duplicate key is global, across files).

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
- No new `design.csv`; `index.json` unchanged (or absent).

---

### A4 — Auto-unbookmark enabled  ·  PRD §68 *Auto-unbookmark enabled*

**Steps**
1. In the popup, enable **Unbookmark after save**.
2. Save a **new** tweet to any category.

**Expected**
- Success toast `Saved to <Category>` first.
- CSV row exists, then the tweet disappears from X Bookmarks (or its native
  bookmark icon turns back to the un-bookmarked state).
- No warning toast.

**Inspect on disk**
- The new row is present and complete **before** the tweet leaves X.
- `index.json` contains the id.

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
- The CSV row **remains**; `✓ Saved` remains; nothing is rolled back.
- The tweet may still be bookmarked on X — that is the accepted outcome.

**Inspect on disk**
- The CSV row written by this save is still present after the warning.

---

### B1 — Rename category  ·  PRD §68 *Rename category*

**Steps**
1. Save one tweet to **Linux** so `linux.csv` exists.
2. In the popup, rename **Linux** → **Linux Stuff** and confirm.
3. Save a different tweet to the renamed category.

**Expected**
- Old CSV untouched; new saves use the new filename.
- No toast error; the popup shows the new name and the new filename slug.

**Inspect on disk**
```bash
ls -la ~/.twitter-bookmarker/          # linux.csv AND linux-stuff.csv both exist
cat ~/.twitter-bookmarker/linux-stuff.csv
```
- `linux.csv` still has exactly its original rows (byte-for-byte).
- `linux-stuff.csv` has the header plus the new row.
- `index.json` maps each tweet id to the filename used at save time.

---

### B2 — Delete category  ·  PRD §68 *Delete category*

**Steps**
1. With `linux.csv` populated, delete the **Linux Stuff** category in the popup.
2. Confirm the native dialog: `Delete category "Linux Stuff"? Existing CSV data will not be deleted.`
3. Save a different tweet to another category (e.g. **AI**).

**Expected**
- The category disappears from the popup.
- No backend request is made for the delete (no server log line).
- The CSV is untouched; index entries for deleted categories are untouched.

**Inspect on disk**
```bash
ls ~/.twitter-bookmarker/              # linux.csv / linux-stuff.csv still there
cat ~/.twitter-bookmarker/linux-stuff.csv   # unchanged
```
- Previously saved tweets still show `✓ Saved` on reload (edge case §64
  *"tweet saved in category that no longer exists"*).

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
- `index.json` unchanged by the reload.

---

### B4 — Backend restart without `index.json`  ·  PRD §68 *Backend restart without index.json*

**Steps**
1. Stop the server. Delete only the derived index:
   `rm ~/.twitter-bookmarker/index.json`
2. `make run` again.
3. Reload `https://x.com/i/history`.

**Expected**
- Startup log reports an index rebuild; the server starts normally.
- Previously saved tweets show `✓ Saved` again.

**Inspect on disk**
```bash
python3 -m json.tool ~/.twitter-bookmarker/index.json   # recreated
ls -la ~/.twitter-bookmarker/*.csv                      # byte-identical
```
- Every CSV is untouched; `index.json` is a fresh valid file listing every id.

---

### B5 — Corrupt `index.json`  ·  PRD §68 *Corrupt index.json*

**Steps**
1. Stop the server.
2. Corrupt the index, e.g. `printf 'not json' > ~/.twitter-bookmarker/index.json`
   (or `head -c 20 /dev/urandom > ~/.twitter-bookmarker/index.json`).
3. `make run`; reload X Bookmarks.

**Expected**
- The server **does not** fail; it logs the malformed index and rebuilds from
  the CSVs.
- Saved tweets still show `✓ Saved`; duplicates are still rejected.

**Inspect on disk**
```bash
python3 -m json.tool ~/.twitter-bookmarker/index.json   # valid again
```
- CSV files are byte-identical to before the corruption.

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
- One success toast; one row in the CSV.
- The controls disable immediately, so the second click is ignored.

**Inspect on disk**
```bash
python3 -c "import csv; rows=list(csv.reader(open('$STORAGE/linux.csv'))); print(len(rows))"
```
- Exactly header + 1 row for that tweet.

---

### C1 — Multiline tweet  ·  PRD §68 *Multiline tweet*

**Steps**
1. Find or post a bookmark whose text contains a blank line between paragraphs.
2. Save it.

**Expected**
- Success toast; the CSV stays valid (quoted field spanning lines).

**Inspect on disk**
```bash
python3 -c "import csv; rows=list(csv.reader(open('$STORAGE/linux.csv', newline=''), strict=True)); print(len(rows)); print(repr(rows[-1][5]))"
```
- `strict=True` parses without error; the `text` field keeps the internal
  newline and trims only leading/trailing whitespace (PRD §14).

---

### C2 — Emoji author  ·  PRD §68 *Emoji author*

**Steps**
1. Save a tweet whose display name contains an emoji (e.g. `Foo, Bar 🐧`).

**Expected**
- CSV writes raw UTF-8; no mojibake.

**Inspect on disk**
```bash
python3 -c "import csv; print(repr(list(csv.reader(open('$STORAGE/linux.csv', newline='')))[-1][1]))"
file ~/.twitter-bookmarker/linux.csv     # reports UTF-8 text
```

---

### C3 — Quoted tweet (parent text only)  ·  PRD §68 *Quoted tweet*

**Steps**
1. Save a quote tweet: outer comment + embedded quoted tweet.

**Expected**
- Only the **parent** text is saved. The quoted text never appears in the CSV.

**Inspect on disk**
```bash
grep -c "<distinctive quoted phrase>" ~/.twitter-bookmarker/linux.csv   # -> 0
```
- The row's `text` equals the outer comment; the `url`/`author`/`username` are
  the parent tweet's, not the quoted one's.

---

### C4 — Image-only tweet  ·  PRD §68 *Image-only tweet*

**Steps**
1. Save a bookmark that has media but no text.

**Expected**
- The row is created with an empty `text` field (the tweet is still saveable).

**Inspect on disk**
```bash
python3 -c "import csv; print(repr(list(csv.reader(open('$STORAGE/linux.csv', newline='')))[-1][5]))"   # -> ''
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
| 2 | `ls "$FIXTURE"` | `ai.csv`, `linux.csv`, `design.csv` present |
| 3 | Open `http://127.0.0.1:43121/` | Homepage hero + **My Collections** |
| 4 | Look at the collection cards | **AI**, **Linux**, **Design**, each with post/media counts and a cover |

### Steps 5–8 — open a collection

| # | Step | Expected |
|---|---|---|
| 5 | Click **Linux** | URL becomes `/collections/linux.csv` |
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
| 17 | Look at the media area | The clicked tweet's image, plus author/handle meta and a `n / total` counter |
| 18 | Press `→` | The counter advances to the next media |
| 19 | Press `←` | The counter returns to the previous media |
| 20 | Inspect **Open on X** | `href` is the canonical `https://x.com/<user>/status/<id>`; `target="_blank"` + `rel="noopener noreferrer"` |
| 21 | Click **Open on X** | The original tweet opens in a new tab (requires network); `Esc` closes the lightbox and returns focus to the tile |

### Steps 22–24 — live data, no restart

| # | Step | Expected |
|---|---|---|
| 22 | Save a new tweet through the extension (or `POST /v1/bookmarks` with `{"filename":"scenario.csv", ...}`) | `201 Created`; the row is appended to the live CSV |
| 23 | Return to the gallery (or refocus the window) | The collection list and the open collection re-read the CSVs on `focus` |
| 24 | Look at the gallery | The new collection/post appears **without restarting the backend**; `/health` still answers from the same process |

**Accessibility sub-check (HARD-04).** Repeat steps 3–21 with a keyboard only
(`Tab` / `Shift+Tab` / `Enter` / `Space` / arrows / `Esc`): every control is
reachable, paints a visible focus ring, the lightbox traps `Tab`, `Esc` restores
focus to the originating tile, and images carry an author-derived `alt`. With a
screen reader, the nav, toolbar and lightbox announce meaningful names.

**Responsive sub-check (HARD-03).** At 390 / 768 / 1440 px the masonry shows
1 / 2 / 4 columns; **Filter** is a Sheet at 390 and a Popover at 1440; the
wordmark is hidden at 390 px (the logo and the accessible name stay).

**Scroll-stability sub-check.** On a collection with more than one page (the
`bulk.csv` fixture: 70 posts), scroll slowly from top to bottom while watching
one card. It must never change column or jump: the packing is append-only, so a
new page can only add cards at the bottom of a column. Resizing the window *does*
re-pack (a real layout change), and that is expected.

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
`cd extension && npm test` (147 tests).
