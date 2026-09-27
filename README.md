# Twitter Bookmarker

A single-user Chrome (Manifest V3) extension plus a small local Go server that
turns X bookmarks into per-category CSV files.

Open `https://x.com/i/history`, click a category on a tweet, and the extension
extracts the tweet metadata and appends it to
`~/.twitter-bookmarker/<category>.csv`. Optionally, the tweet is removed from X
Bookmarks **after** the CSV write is confirmed.

---

## What this is — and what it is not

**It is** a categorizer: X Bookmarks → one category click → durable CSV row →
optional unbookmark. CSV is the durable source of truth; the JSON index and the
backend's in-memory state are derived and rebuildable.

**It is not** a bookmark manager, dashboard, viewer, sync service, or database.
There is no search, filtering, move/undo, import/export, cloud sync,
authentication, or X API usage. The extension works off the rendered DOM only.
See `.planning/PROJECT.md` for the full out-of-scope list.

---

## Architecture

```text
┌────────────────────────── Chrome ──────────────────────────┐
│  Content script (x.com/i/history)                        │
│    route watcher → single MutationObserver → organizer UI  │
│    save controller ──message──▶ MV3 service worker ──HTTP──┼──▶ 127.0.0.1:43121
│  Popup: categories, colors, order, settings                 │      (Go server)
│  chrome.storage.local = categories + settings (only)        │         │
└─────────────────────────────────────────────────────────────┘         │
                                                                        ▼
                                          ~/.twitter-bookmarker/<slug>.csv   ← source of truth
                                          ~/.twitter-bookmarker/index.json   ← derived, rebuildable
```

- The backend binds **loopback only** (`127.0.0.1:43121`) and never stores
  categories or settings — those live in `chrome.storage.local`.
- The content script never calls the backend directly; every HTTP request goes
  through the service worker (PRD §53).
- One `MutationObserver` per page entry, one index fetch per page entry, O(1)
  saved-tweet lookups via an in-memory `Set<TweetID>`.

---

## Requirements

| Tool | Version |
|---|---|
| Go | ≥ 1.22 |
| Node.js + npm | ≥ 20 |
| Browser | Chrome / Chromium (MV3, Dev mode for unpacked loading) |
| `python3` (optional) | for CSV/JSON inspection and the manual checklist |

---

## Setup and first run

### 1. Build

```bash
# From the repository root:
make build
```

This builds `backend/bin/twitter-bookmarker-server` and installs the extension
dependencies (`npm ci`) before producing `extension/dist/`.

<details>
<summary>Equivalent commands without <code>make</code></summary>

```bash
mkdir -p backend/bin
cd backend && go build -o bin/twitter-bookmarker-server ./cmd/server
cd ../extension && npm ci && npm run build
```
</details>

### 2. Run the server

```bash
make run
# or directly:
./backend/bin/twitter-bookmarker-server
```

Expected startup output (structured `slog` text on stderr):

```text
time=2026-09-27T09:04:54.777+07:00 level=INFO msg="index rebuilt from csv files" dir=/home/<you>/.twitter-bookmarker reason="missing index.json" indexed_tweets=0
time=2026-09-27T09:04:54.777+07:00 level=INFO msg="Twitter Bookmarker server started" server=twitter-bookmarker-server listening=127.0.0.1:43121 storage=/home/<you>/.twitter-bookmarker indexed_tweets=0
```

The storage directory is created automatically (mode `0700`). Stop it with
`Ctrl+C`; shutdown is clean because CSV writes are synchronous per request.

> The server honours `$HOME`, so `HOME=$(mktemp -d) ./backend/bin/twitter-bookmarker-server`
> gives you a throwaway storage directory.

### 3. Load the unpacked extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/dist/`

### 4. Create categories

Open the extension popup and add e.g. `AI`, `Linux`, `Design`. Pick colours,
drag to reorder, and choose **Popover** or **Inline**. Everything is saved to
`chrome.storage.local` immediately and propagates to open X tabs without a
reload.

### 5. Use it

1. Open `https://x.com/i/history`
2. Each tweet gets an organizer (`[Organize]` in popover mode, category chips in
   inline mode) on **its own full-width row directly above the native action
   bar** — it never shares the row with X's reply/repost/like/bookmark buttons
   (PRD §31, XI-08).
3. Click **Linux** on a tweet → success toast `Saved to Linux`, controls become
   `✓ Saved`
4. Inspect the result:

```bash
cat ~/.twitter-bookmarker/linux.csv
curl -s http://127.0.0.1:43121/v1/index | python3 -m json.tool
```

---

## CSV schema

One file per category filename, six columns, header written exactly once:

```csv
url,author,username,tweet_date,saved_at,text
```

| Column | Meaning |
|---|---|
| `url` | Canonical `https://x.com/<handle>/status/<id>` (tracking query removed) |
| `author` | Display name as rendered |
| `username` | `@handle` |
| `tweet_date` | Tweet timestamp, UTC (`...Z`) |
| `saved_at` | Backend-generated UTC save time (`...Z`) |
| `text` | Parent tweet text only; empty for media-only tweets; quoted text excluded |

Example (`~/.twitter-bookmarker/linux.csv`, PRD §63):

```csv
url,author,username,tweet_date,saved_at,text
https://x.com/foo/status/123,Foo Bar,@foo,2026-09-27T01:00:00Z,2026-09-27T03:00:00Z,"Testing Linux today"
https://x.com/bar/status/456,"Foo, Bar 🐧",@bar,2026-09-26T14:21:00Z,2026-09-27T03:02:00Z,"Line one

Line two"
```

Commas, quotes, emoji, arbitrary unicode, and multiline text are handled
automatically by Go's `encoding/csv` writer. Verify a file with a strict
external parser:

```bash
python3 -c "import csv; rows=list(csv.reader(open('$HOME/.twitter-bookmarker/linux.csv', newline=''), strict=True)); print(len(rows))"
```

---

## Backend API

Base URL: `http://127.0.0.1:43121`. CORS is granted only to extension origins
(`chrome-extension://…`); arbitrary web origins are never allowed.

### `GET /health`

```http
200 OK
{"status":"ok"}
```

### `GET /v1/index`

The derived saved-tweet index (one `GET` per Bookmarks page entry).

```http
200 OK
{
  "items": {
    "123456789": {
      "url": "https://x.com/foo/status/123456789",
      "filename": "linux.csv",
      "saved_at": "2026-09-27T01:15:32Z"
    }
  }
}
```

### `POST /v1/bookmarks`

```json
{
  "filename": "linux.csv",
  "tweet": {
    "url": "https://x.com/foobar/status/123456789?s=20",
    "author": "Foo Bar",
    "username": "@foobar",
    "tweet_date": "2026-09-27T01:10:42Z",
    "text": "Example tweet"
  }
}
```

The backend derives `saved_at`, the tweet id, and the canonical URL.

| Status | When | Body |
|---|---|---|
| `201 Created` | New tweet appended to the CSV | `{"status":"saved","tweet_id":"…","url":"…","filename":"…","saved_at":"…"}` |
| `409 Conflict` | Tweet id already exists in **any** CSV (global duplicate) | `{"status":"duplicate","tweet_id":"…"}` — no second row, no unbookmark |
| `400 Bad Request` | Invalid filename, invalid URL, missing author/username, invalid date, malformed payload | `{"status":"error","reason":"…"}` |
| `500 Internal Server Error` | Filesystem/internal failure | `{"status":"error","reason":"internal error"}` — the extension never unbookmarks on this |

A duplicate is keyed by **Tweet Status ID**, not URL, so it is detected across
all CSV files.

---

## Invariants (PRD §71)

```text
CSV is the durable source of truth.

One Tweet Status ID may only exist once globally.

Backend never owns extension category configuration.

Rename never renames old CSV files.

Delete never deletes CSV files.

Never unbookmark before CSV persistence succeeds.

A failed X unbookmark never rolls back saved CSV data.

Previously saved tweets must be identifiable before user clicks them.
```

Supporting guarantees:

- The backend binds `127.0.0.1` only — never `0.0.0.0`.
- Filenames must match `^[a-z0-9][a-z0-9-]*\.csv$`; the server joins them with
  `~/.twitter-bookmarker/` itself and rejects `/`, `\`, `..`, `~`.
- `index.json` is derived: deleting or corrupting it rebuilds it from the CSVs.
- Index-persistence failure never fails a save (CSV already succeeded).
- `saved_at` is generated by the backend, in UTC.

---

## Development

```bash
make build          # backend binary + extension dist/
make test           # go test ./... -race, then npm test
make lint           # gofmt check + go vet + tsc --noEmit
make fmt            # gofmt -w backend
make clean          # remove backend/bin + extension/dist (never user data)
make clean-storage  # DESTRUCTIVE: delete ~/.twitter-bookmarker (all CSVs)
```

Extension-only scripts (`cd extension`):

```bash
npm run build       # one-shot esbuild bundle into dist/
npm run watch       # rebuild on change
npm run typecheck   # tsc --noEmit
npm test            # node --test test/*.test.mjs (147 tests)
npm run verify      # post-build dist/ verification
```

The full manual test procedure — every PRD §68 scenario with exact steps,
expected observations, and disk checks — lives in
**[`docs/MANUAL-TEST-CHECKLIST.md`](docs/MANUAL-TEST-CHECKLIST.md)**.

---

## Troubleshooting

### Popup says Disconnected / toast says `Backend unavailable`

- Is the server running? `curl -s http://127.0.0.1:43121/health`
- The extension probes `/health` with a ~1.5 s timeout, so a stopped backend
  shows Disconnected without hanging.
- Nothing is lost: the tweet stays bookmarked and no CSV row is written.

### Port already in use

The server exits non-zero with `port 43121 is already in use`. Find the holder
with `lsof -i :43121` (or `ss -ltnp | grep 43121`) and stop it — only one
backend may run, because the port is fixed in `backend/internal/config/config.go`.

### `index.json` missing, corrupt, or out of date

The backend rebuilds the index from the CSVs at startup. To force a rebuild,
stop the server and either delete `~/.twitter-bookmarker/index.json` or corrupt
it, then `make run`. CSVs are never modified by a rebuild.

```bash
rm ~/.twitter-bookmarker/index.json && make run
```

### Saved tweets no longer show `✓ Saved`

The saved state comes from `GET /v1/index` at page entry. Confirm the backend is
running and `index.json` is valid, then reload the Bookmarks page. If the entry
fetch failed while the backend was down, the extension re-fetches once when a
save next confirms the backend is reachable.

### Organizer controls stop appearing (X changed its route)

X moved the Bookmarks timeline from `/i/bookmarks` to **`/i/history`**. The
accepted paths live in two places that must stay in sync:

| File | What it controls |
|---|---|
| `extension/src/content/route.ts` → `BOOKMARKS_PATHS` | when the organizer activates |
| `extension/manifest.json` → `content_scripts[0].matches` | when the script is injected at all |

`/i/bookmarks` is still accepted as a legacy alias so an old link or a
client-side redirect does not leave the page without the organizer. If X moves
the timeline again, add the new path to both files, then
`cd extension && npm run build` and reload the unpacked extension.
`npm run verify` asserts the two lists agree.

### Organizer controls stop appearing (X changed its DOM)

All X selectors and every attribute the extension writes are in one file:
**`extension/src/content/selectors.ts`**. Each anchor has an ordered fallback
list, so a single X change is usually a one-line edit there (add/replace a
fallback), then `cd extension && npm run build` and reload the unpacked
extension. Do not hardcode X selectors in other modules.

### Permissions

The extension requests only `storage` plus host access to `https://x.com/*` and
`http://127.0.0.1:43121/*`. It never requests `history`, `downloads`,
`bookmarks`, `tabs`, `notifications`, or `scripting`.
