#!/usr/bin/env bash
# check-web-acceptance.sh — real-browser acceptance run for the gallery SPA.
#
# Complements scripts/check-gallery-acceptance.sh (HTTP-only, PRD §80). This one
# boots the production Go server against a seeded storage directory and drives
# the real SPA in headless Chrome through agent-browser, so the claims jsdom
# cannot make are verified for real: the applied theme and its persistence, live
# masonry column counts, real key events, focus restoration, filter popover vs
# sheet, decoded images, and screenshots for visual review (PRD §81, §82;
# HARD-03/04).
#
# Fixture = the shared gallery fixture + `bulk.csv` (70 posts) so infinite scroll
# has more than one page, and design.csv stays empty for the empty-state check.
#
# Usage: scripts/check-web-acceptance.sh [--out DIR] [--keep]
#
# If port 43121 is already taken (e.g. a developer's own `make run`) this
# re-execs itself in a private network namespace, exactly like
# check-gallery-acceptance.sh, so the two never fight over the port.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=43121
MEDIA_PORT=8899
BASE="http://127.0.0.1:$PORT"
SERVER="$ROOT/backend/bin/twitter-bookmarker-server"

OUT="$ROOT/artifacts/browser"
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
# Screenshots are numbered per run, so clear the previous run's files: a stale
# image from an older check list is worse than no image at all.
rm -f "$OUT"/*.png

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && exec 3>&- && return 0
  return 1
}
if port_busy && [ -z "${TWBM_BROWSER_NS:-}" ] && command -v unshare >/dev/null 2>&1; then
  echo "port $PORT is busy — re-running in a private network namespace (unshare -rn)"
  echo
  TWBM_BROWSER_NS=1 exec unshare -rn bash -c 'ip link set lo up 2>/dev/null || true; exec "$0" "$@"' "$0" "$@"
fi

for bin in agent-browser jq curl node python3; do
  command -v "$bin" >/dev/null || { echo "missing required tool: $bin" >&2; exit 2; }
done
[ -x "$SERVER" ] || { echo "server binary missing — run 'make build' first" >&2; exit 2; }
[ -f "$ROOT/web/dist/index.html" ] || {
  echo "web/dist is not built — run 'make build' (or 'cd web && pnpm build') first" >&2; exit 2
}

STORAGE="$(mktemp -d)"
SLOG="$(mktemp)"
MEDIA_LOG="$(mktemp)"
SERVER_PID=""
MEDIA_PID=""
SESSION="twbm-acceptance-$$"
SHOT=0
PASS=0
FAIL=0

cleanup() {
  agent-browser --session "$SESSION" close >/dev/null 2>&1
  for pid in "$SERVER_PID" "$MEDIA_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; fi
  done
  if [ "$KEEP" -eq 1 ]; then
    echo "kept storage: $STORAGE"; echo "kept server log: $SLOG"; echo "kept media log: $MEDIA_LOG"
  else
    rm -rf "$STORAGE" "$SLOG" "$MEDIA_LOG"
  fi
}
trap cleanup EXIT

# --- fixture ----------------------------------------------------------------
"$ROOT/scripts/seed-gallery-fixture.sh" "$STORAGE" --fresh >/dev/null || {
  echo "failed to seed the gallery fixture" >&2; exit 1
}

# bulk.csv — 70 posts so the collection paginates (limit 30), and every 5th row
# matches "needle" so a search can be proven to actually narrow the result set.
python3 - "$STORAGE/bulk.csv" <<'PY'
import csv, json, sys
path = sys.argv[1]
header = ["url", "media", "author", "username", "tweet_date", "saved_at", "text"]
with open(path, "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(header)
    for i in range(1, 71):
        n = (i % 3) + 1                      # 1..3 media, never text-only
        needle = "needle" if i % 5 == 0 else "straw"
        day = 30 - (i % 28)
        media = json.dumps([f"https://pbs.twimg.com/media/bulk{i:03d}_{k}.jpg" for k in range(1, n + 1)])
        w.writerow([
            f"https://x.com/bulkuser/status/3000000000000000{i:03d}",
            media,
            f"Bulk Author {i % 7}",
            f"@bulk{i:03d}",
            f"2026-03-{day:02d}T10:{i % 60:02d}:00Z",
            f"2026-04-{day:02d}T11:{i % 60:02d}:00Z",
            f"Bulk post {i}: a {needle} in the haystack.",
        ])
PY

# Point media at the local stub over plain HTTP (see media-stub-server.mjs).
sed -i 's|https://pbs\.twimg\.com/media|http://pbs.twimg.com/media|g' "$STORAGE"/*.csv

# --- servers ----------------------------------------------------------------
node "$ROOT/scripts/media-stub-server.mjs" "$MEDIA_PORT" >"$MEDIA_LOG" 2>&1 &
MEDIA_PID=$!
TWITTER_BOOKMARKER_DIR="$STORAGE" "$SERVER" >"$SLOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 80); do
  curl -fsS -m 1 "$BASE/health" >/dev/null 2>&1 && break
  sleep 0.25
done
if ! curl -fsS -m 2 "$BASE/health" >/dev/null 2>&1; then
  echo "server did not become healthy on $BASE" >&2; tail -20 "$SLOG" >&2; exit 1
fi

export AGENT_BROWSER_SESSION="$SESSION"
export AGENT_BROWSER_ARGS="--host-resolver-rules=MAP pbs.twimg.com 127.0.0.1:$MEDIA_PORT"
export AGENT_BROWSER_MAX_OUTPUT=2000

# --- helpers ----------------------------------------------------------------
js() { agent-browser eval "$1" --json 2>/dev/null | jq -r 'if .data.result == null then "null" else .data.result end' 2>/dev/null; }
count() { js "document.querySelectorAll($(printf '%s' "$1" | jq -R .)).length"; }
shot() { SHOT=$((SHOT+1)); agent-browser screenshot "$OUT/$(printf '%02d' "$SHOT")-$1.png" >/dev/null 2>&1; }
pass() { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s — %s\n' "$1" "$2"; }
chk()  { if [ "$2" = "$3" ]; then pass "$1  ($3)"; else fail "$1" "expected [$2], got [$3]"; fi; }
ne()   { if [ "$2" != "$3" ]; then pass "$1  ($3)"; else fail "$1" "expected anything but [$2]"; fi; }
open_url() { agent-browser open "$1" >/dev/null 2>&1; }

# Poll a JS expression until it equals `want`. The masonry column count follows a
# ResizeObserver, so a single sample right after a viewport change can still report
# the previous width's count.
poll_js() {
  local expr="$1" want="$2" tries="${3:-15}" got=""
  for _ in $(seq 1 "$tries"); do
    got=$(js "$expr")
    [ "$got" = "$want" ] && { printf '%s' "$got"; return 0; }
    sleep 0.3
  done
  printf '%s' "$got"
}
cols_expr() { printf '%s' "document.querySelector('[data-testid=\"gallery-masonry\"]').getAttribute('data-columns')"; }
goto_collection() { open_url "$BASE/collections/$1"; agent-browser wait 900 >/dev/null 2>&1; }

echo "=== production server (pid $SERVER_PID) + media stub on $MEDIA_PORT ==="
echo

# --- homepage and theme -----------------------------------------------------
echo "Homepage"
open_url "$BASE/"
agent-browser wait 1200 >/dev/null 2>&1
chk "hero renders" "true" "$(js "!!document.querySelector('[data-testid=\"gallery-hero\"]')")"
chk "My Collections section header" "true" "$(js "document.body.innerText.includes('My Collections')")"
cards=$(count '[data-testid="collection-card"]')
if [ "$cards" -ge 3 ]; then pass "collection cards rendered ($cards)"; else fail "collection cards rendered" "expected >=3, got $cards"; fi
chk "card meta shows posts/media/last-saved" "true" \
  "$(js "(() => { const t = document.querySelector('[data-testid=\"collection-card\"]').textContent; return t.includes('posts') && t.includes('media') && t.includes('Last saved'); })()")"
chk "footer line present" "true" "$(js "document.body.innerText.includes('No cloud, no algorithmic feed')")"
chk "collection covers have real geometry and a decoded image" "true" \
  "$(js "(() => { const c = document.querySelector('[data-testid=\"collection-cover\"]'); if (!c) return false; const r = c.getBoundingClientRect(); const i = c.querySelector('img'); return r.width > 100 && r.height > 60 && !!i && i.naturalWidth > 0; })()")"
shot "homepage-light"

echo
echo "Theme (WEB-06, PRD §64)"
pref0=$(js "document.querySelector('[data-theme-preference]').getAttribute('data-theme-preference')")
chk "defaults to system" "system" "$pref0"
chk "applied class matches resolved theme" "true" \
  "$(js "document.querySelector('[data-theme-preference]').getAttribute('data-theme-resolved') === (document.documentElement.classList.contains('dark') ? 'dark' : 'light')")"
agent-browser click '[data-theme-preference]' >/dev/null 2>&1
chk "system -> light" "light" "$(js "document.querySelector('[data-theme-preference]').getAttribute('data-theme-preference')")"
agent-browser click '[data-theme-preference]' >/dev/null 2>&1
chk "light -> dark applies dark" "dark" "$(js "document.documentElement.classList.contains('dark') ? 'dark' : 'light'")"
shot "homepage-dark"
agent-browser reload >/dev/null 2>&1
agent-browser wait 900 >/dev/null 2>&1
chk "dark preference persists across reload" "dark" "$(js "document.documentElement.classList.contains('dark') ? 'dark' : 'light'")"
agent-browser click '[data-theme-preference]' >/dev/null 2>&1
chk "dark -> system" "system" "$(js "document.querySelector('[data-theme-preference]').getAttribute('data-theme-preference')")"

# --- collection route -------------------------------------------------------
echo
echo "Collection route (PROD-03, PRD §82)"
goto_collection bulk.csv
chk "direct deep-link renders posts" "true" "$(js "document.querySelectorAll('[data-testid=\"post-card\"]').length == 30")"
chk "toolbar present" "true" "$(js "!!document.querySelector('[data-testid=\"collection-toolbar\"]')")"
shot "collection-route"

agent-browser set viewport 1440 1100 >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1
chk "masonry reports 4 columns at 1440px" "4" "$(poll_js "$(cols_expr)" 4)"

# --- media rendering --------------------------------------------------------
echo
echo "Media rendering (a broken CDN must not collapse the layout)"
chk "images use the stored CDN URL" "true" \
  "$(js "[...document.querySelectorAll('img')].some(i => (i.getAttribute('src')||'').includes('pbs.twimg.com'))")"
chk "images decoded" "true" "$(js "[...document.querySelectorAll('img')].some(i => i.naturalWidth > 0)")"
chk "no image fell back to the error placeholder" "0" "$(count '[data-testid="media-placeholder"]')"
shot "collection-media-rendered"

# --- the stored handle keeps one sigil --------------------------------------
echo
echo "Stored handle (real CSV shape)"
chk "no doubled sigil anywhere on the page" "false" "$(js "document.body.innerText.includes('@@')")"
handle=$(js "[...document.querySelectorAll('[data-testid=\"post-card\"] p')].map(p=>p.textContent).find(t=>t.startsWith('@'))")
if printf '%s' "$handle" | grep -Eq '^@bulk[0-9]+$'; then pass "card shows one sigil for the stored handle ($handle)"; else fail "card shows one sigil for the stored handle" "got [$handle]"; fi

# --- search, sort, filter ---------------------------------------------------
echo
echo "Discovery (DISC-01/02/03/06)"
agent-browser fill '[data-testid="collection-search"]' "needle" >/dev/null 2>&1
agent-browser wait 900 >/dev/null 2>&1
chk "search narrows server-side" "14" "$(count '[data-testid="post-card"]')"
chk "search writes q= to the URL" "true" "$(js "location.search.includes('q=needle')")"
shot "collection-search"

agent-browser fill '[data-testid="collection-search"]' "" >/dev/null 2>&1
agent-browser wait 900 >/dev/null 2>&1
first_before=$(js "document.querySelector('[data-testid=\"post-card\"] [data-testid=\"open-on-x\"]').getAttribute('href')")
agent-browser select '[data-testid="collection-sort"]' "tweet_asc" >/dev/null 2>&1
agent-browser wait 900 >/dev/null 2>&1
chk "sort writes sort= to the URL" "true" "$(js "location.search.includes('sort=tweet_asc')")"
ne "sort reorders the first card" "$first_before" \
  "$(js "document.querySelector('[data-testid=\"post-card\"] [data-testid=\"open-on-x\"]').getAttribute('href')")"

agent-browser click '[data-testid="collection-filter"]' >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1
chk "filter opens a popover on desktop" "true" "$(js "!!document.querySelector('[data-testid=\"filter-popover\"]')")"
shot "filter-popover"
agent-browser find text "Last 7 Days" click >/dev/null 2>&1 || agent-browser find text "7 days" click >/dev/null 2>&1
agent-browser wait 400 >/dev/null 2>&1
agent-browser click '[data-testid="filter-apply"]' >/dev/null 2>&1
agent-browser wait 900 >/dev/null 2>&1
chk "applied filter writes a date range to the URL" "true" \
  "$(js "location.search.includes('saved_from') && location.search.includes('saved_to')")"
agent-browser click '[data-testid="filter-reset"]' >/dev/null 2>&1
agent-browser wait 700 >/dev/null 2>&1 || true

# --- infinite scroll --------------------------------------------------------
echo
echo "Infinite scroll (SCROLL-01..05)"
goto_collection bulk.csv
chk "first page is capped at the page limit" "30" "$(count '[data-testid="post-card"]')"
agent-browser scroll down 4000 >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
chk "scrolling the sentinel appends the next page" "60" "$(count '[data-testid="post-card"]')"
shot "infinite-scroll"

# --- lightbox ---------------------------------------------------------------
echo
echo "Lightbox (LIGHT-01..06)"
agent-browser scrollintoview '[data-testid="post-media-trigger"]' >/dev/null 2>&1
agent-browser click '[data-testid="post-media-trigger"]' >/dev/null 2>&1
agent-browser wait 700 >/dev/null 2>&1
chk "dialog opens" "true" "$(js "!!document.querySelector('[data-testid=\"media-lightbox\"]')")"
counter=$(js "document.querySelector('[data-testid=\"lightbox-counter\"]').textContent")
if printf '%s' "$counter" | grep -Eq '^[0-9]+ / [0-9]+$'; then pass "counter shows n / total ($counter)"; else fail "counter shows n / total" "got [$counter]"; fi
chk "lightbox shows the stored image, decoded" "true" \
  "$(js "(() => { const i = document.querySelector('[data-testid=\"lightbox-media-area\"] img'); return !!i && i.getAttribute('src').includes('pbs.twimg.com') && i.naturalWidth > 0; })()")"
chk "three meta lines present" "true" \
  "$(js "!!document.querySelector('[data-testid=\"lightbox-posted\"]') && !!document.querySelector('[data-testid=\"lightbox-saved\"]') && !!document.querySelector('[data-testid=\"lightbox-collection\"]')")"
chk "dialog has an accessible name from the author and handle" "true" \
  "$(js "(document.querySelector('[data-testid=\"media-lightbox\"]').getAttribute('aria-labelledby') ? document.getElementById(document.querySelector('[data-testid=\"media-lightbox\"]').getAttribute('aria-labelledby')).textContent : '').includes('@')")"
chk "Open on X is a safe new-tab link" "true" \
  "$(js "(() => { const a = document.querySelector('[data-testid=\"lightbox-open-on-x\"]'); return a && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel')) && /noreferrer/.test(a.getAttribute('rel')); })()")"
shot "lightbox-open"

agent-browser press ArrowRight >/dev/null 2>&1
agent-browser wait 400 >/dev/null 2>&1
ne "ArrowRight advances the counter" "$counter" "$(js "document.querySelector('[data-testid=\"lightbox-counter\"]').textContent")"
agent-browser press ArrowLeft >/dev/null 2>&1
agent-browser wait 400 >/dev/null 2>&1
chk "ArrowLeft returns to the first item" "$counter" "$(js "document.querySelector('[data-testid=\"lightbox-counter\"]').textContent")"

agent-browser press Escape >/dev/null 2>&1
agent-browser wait 500 >/dev/null 2>&1
chk "Escape closes the dialog" "true" "$(js "!document.querySelector('[data-testid=\"media-lightbox\"]')")"
chk "focus is restored to the originating tile" "post-media-trigger" \
  "$(js "document.activeElement.getAttribute('data-testid')")"

# --- states -----------------------------------------------------------------
echo
echo "States (PRD §31/§33)"
goto_collection design.csv
chk "empty collection shows its own state" "true" "$(js "!!document.querySelector('[data-testid=\"collection-empty-state\"]')")"
shot "collection-empty"
open_url "$BASE/definitely/not/a/route"
agent-browser wait 900 >/dev/null 2>&1
chk "unknown client route renders the app (SPA fallback)" "true" \
  "$(js "!!document.querySelector('[data-testid=\"gallery-hero\"]') || document.body.innerText.length > 0")"

# --- responsive -------------------------------------------------------------
echo
echo "Responsive (HARD-03)"
goto_collection bulk.csv
cols() { agent-browser set viewport "$1" "$2" >/dev/null 2>&1; agent-browser wait 400 >/dev/null 2>&1; poll_js "$(cols_expr)" "$3"; }
d=$(cols 1440 1100 4); shot "responsive-desktop"
t=$(cols 900 1100 2); shot "responsive-tablet"
m=$(cols 390 900 1); shot "responsive-mobile"
chk "desktop 1440px" "4" "$d"
chk "tablet 900px" "2" "$t"
chk "mobile 390px" "1" "$m"

agent-browser click '[data-testid="collection-filter"]' >/dev/null 2>&1
agent-browser wait 600 >/dev/null 2>&1
chk "filter becomes a Sheet at mobile width" "true" "$(js "!!document.querySelector('[data-testid=\"filter-sheet\"]')")"
chk "desktop popover is not used at mobile width" "false" "$(js "!!document.querySelector('[data-testid=\"filter-popover\"]')")"
shot "filter-sheet"
agent-browser press Escape >/dev/null 2>&1

# --- console ----------------------------------------------------------------
echo
echo "Runtime health"
console_out="$(agent-browser console 2>/dev/null)"
errs=$(printf '%s' "$console_out" | grep -ciE '\b(error|uncaught|exception)\b' || true)
if [ "${errs:-0}" -eq 0 ]; then pass "no console errors"; else
  printf '%s\n' "$console_out" | grep -iE '\b(error|uncaught|exception)\b' | head -5
  fail "no console errors" "$errs console line(s) mention an error"
fi

# --- summary ----------------------------------------------------------------
echo
echo "=== browser acceptance: $PASS passed, $FAIL failed ==="
echo "screenshots: $OUT"
[ "$FAIL" -eq 0 ] || exit 1
