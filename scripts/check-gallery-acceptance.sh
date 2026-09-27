#!/usr/bin/env bash
# check-gallery-acceptance.sh — independent orchestrator check of PRD-2 §80
# (backend acceptance criteria) and the §81/§82 integration surface.
#
# Builds the server, seeds a fixture, runs the server against it, and asserts the
# documented API behaviour over real HTTP. This is deliberately NOT the project's
# own test suite: it re-derives the acceptance criteria from the PRD so a passing
# `go test` cannot mask a contract mismatch.
#
# Usage: scripts/check-gallery-acceptance.sh
# Exit:  0 = all checks passed, 1 = at least one failed, 2 = setup failure.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=43121
BASE="http://127.0.0.1:${PORT}"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/twbm-acc.XXXXXX")"
BIN="$(mktemp -d "${TMPDIR:-/tmp}/twbm-bin.XXXXXX")/server"
LOG="$(mktemp "${TMPDIR:-/tmp}/twbm-acc-log.XXXXXX")"
SERVER_PID=""

pass=0; fail=0; skip=0
declare -a FAILED

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -INT "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$FIXTURE" "$(dirname "$BIN")"
}
trap cleanup EXIT

ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { fail=$((fail+1)); FAILED+=("$1"); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }
miss() { skip=$((skip+1)); printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
check(){ if [ "$1" = "true" ]; then ok "$2"; else bad "$2" "${3:-}"; fi; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- setup
hdr "Setup"
if curl -fsS --max-time 2 "$BASE/health" >/dev/null 2>&1; then
  echo "port $PORT is already in use — stop the running server first" >&2
  exit 2
fi

"$ROOT/scripts/seed-gallery-fixture.sh" "$FIXTURE" >/dev/null || { echo "fixture seed failed" >&2; exit 2; }

if ! (cd "$ROOT/backend" && go build -o "$BIN" ./cmd/server); then
  echo "backend build failed" >&2; exit 2
fi
echo "  built server"

TWITTER_BOOKMARKER_DIR="$FIXTURE" "$BIN" >"$LOG" 2>&1 &
SERVER_PID=$!

up=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "$BASE/health" >/dev/null 2>&1; then up=1; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.25
done
if [ -z "$up" ]; then
  echo "server did not become healthy; log:" >&2; tail -20 "$LOG" >&2; exit 2
fi
echo "  server healthy on $BASE (pid $SERVER_PID)"

j() { curl -fsS --max-time 10 "$@"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

# ------------------------------------------------- §80.1-3 existing contract
hdr "§80.1-3  Existing v1.0 contracts unchanged"

h="$(j "$BASE/health" || echo '{}')"
check "$(jq -r '.status == "ok"' <<<"$h" 2>/dev/null || echo false)" \
  "§80.1 /health returns {\"status\":\"ok\"}" "$h"

idx_code="$(code "$BASE/v1/index")"
idx_shape="$(j "$BASE/v1/index" | jq -r 'has("tweets") or has("entries") or (type=="array")' 2>/dev/null || echo false)"
check "$([ "$idx_code" = "200" ] && echo true || echo false)" "§80.2 /v1/index returns 200" "got $idx_code"
check "$idx_shape" "§80.2 /v1/index returns the v1 index shape"

save_code="$(code -X POST "$BASE/v1/bookmarks" -H 'Content-Type: application/json' \
  -d '{"filename":"smoke.csv","url":"https://x.com/smoke/status/9990000000000000001","author":"Smoke","username":"@smoke","tweet_date":"2026-09-01T00:00:00Z","text":"acceptance smoke"}')"
check "$([ "$save_code" = "201" ] || [ "$save_code" = "409" ] && echo true || echo false)" \
  "§80.3 POST /v1/bookmarks still accepts a save (201) " "got $save_code"

# ------------------------------------------------------ §80.4-10 collections
hdr "§80.4-10  GET /api/gallery/collections"

cols_code="$(code "$BASE/api/gallery/collections")"
check "$([ "$cols_code" = "200" ] && echo true || echo false)" "§80.4 collections endpoint available" "got $cols_code"

cols="$(j "$BASE/api/gallery/collections" 2>/dev/null || echo '{}')"
names="$(jq -r '[.collections[].name] | sort | join(",")' <<<"$cols" 2>/dev/null || echo '')"
check "$([ "$names" = "AI,Design,Linux" ] && echo true || echo false)" \
  "§80.5 only *.csv collections appear (AI, Design, Linux — no index.json/.bak/.hidden)" "got [$names]"

design_media="$(jq -r '[.collections[] | select(.name=="Design")][0].media_count' <<<"$cols" 2>/dev/null || echo x)"
check "$([ "$design_media" = "0" ] && echo true || echo false)" \
  "§80.6 media-less collection still present" "Design.media_count=$design_media"

linux_posts="$(jq -r '[.collections[] | select(.name=="Linux")][0].post_count' <<<"$cols" 2>/dev/null || echo x)"
ai_posts="$(jq -r '[.collections[] | select(.name=="AI")][0].post_count' <<<"$cols" 2>/dev/null || echo x)"
check "$([ "$linux_posts" = "8" ] && echo true || echo false)" "§80.7 post_count correct (Linux=8)" "got $linux_posts"
check "$([ "$ai_posts" = "4" ] && echo true || echo false)" \
  "§80.7 malformed row skipped, other AI rows counted (AI=4)" "got $ai_posts"

linux_media="$(jq -r '[.collections[] | select(.name=="Linux")][0].media_count' <<<"$cols" 2>/dev/null || echo x)"
# 4 + 3 + 2 + 1 + 0 + 0 + 2 + 1 = 13
check "$([ "$linux_media" = "13" ] && echo true || echo false)" "§80.8 media_count correct (Linux=13)" "got $linux_media"

linux_last="$(jq -r '[.collections[] | select(.name=="Linux")][0].last_saved_at' <<<"$cols" 2>/dev/null || echo x)"
check "$([ "$linux_last" != "null" ] && [ -n "$linux_last" ] && echo true || echo false)" \
  "§80.9 last_saved_at present for Linux" "got $linux_last"

design_last="$(jq -r '[.collections[] | select(.name=="Design")][0].last_saved_at' <<<"$cols" 2>/dev/null || echo x)"
check "$([ "$design_last" = "null" ] && echo true || echo false)" "§80.9 empty collection last_saved_at is null" "got $design_last"

first_files="$(jq -r '[.collections[].filename] | .[0]' <<<"$cols" 2>/dev/null || echo '')"
check "$([ "$first_files" = "linux.csv" ] && echo true || echo false)" \
  "§80.9 collections ordered by last_saved_at DESC (linux.csv first)" "got $first_files"

cover_n="$(jq -r '[.collections[] | select(.name=="Linux")][0].cover_media | length' <<<"$cols" 2>/dev/null || echo x)"
check "$([ "$cover_n" = "4" ] && echo true || echo false)" "§80.10 cover_media capped at 4" "got $cover_n"
cover_first="$(jq -r '[.collections[] | select(.name=="Linux")][0].cover_media[0]' <<<"$cols" 2>/dev/null || echo x)"
case "$cover_first" in
  *a1.jpg) ok "§80.10 cover_media newest-first starts with the newest tweet's first media" ;;
  *) bad "§80.10 cover_media newest-first starts with the newest tweet's first media" "got $cover_first" ;;
esac

# ---------------------------------------------------------- §80.11-18 posts
hdr "§80.11-18  GET /api/gallery/collections/{filename}/posts"

posts_code="$(code "$BASE/api/gallery/collections/linux.csv/posts")"
check "$([ "$posts_code" = "200" ] && echo true || echo false)" "§80.11 posts endpoint available" "got $posts_code"

page1="$(j "$BASE/api/gallery/collections/linux.csv/posts?limit=30" 2>/dev/null || echo '{}')"
n1="$(jq -r '.items | length' <<<"$page1" 2>/dev/null || echo 0)"
shape="$(jq -r 'has("items") and has("next_cursor") and has("has_more") and (.items|type=="array")' <<<"$page1" 2>/dev/null || echo false)"
check "$shape" "§80.11 response shape {items,next_cursor,has_more}"
check "$([ "$n1" = "8" ] && echo true || echo false)" "§80.11 posts endpoint returns the collection's posts" "got $n1"

media4="$(jq -r '[.items[] | select(.tweet_id=="1000000000000000001")][0].media | length' <<<"$page1" 2>/dev/null || echo x)"
check "$([ "$media4" = "4" ] && echo true || echo false)" "§80.12 media JSON parsed (4-item array)" "got $media4"

textonly="$(jq -r '[.items[] | select(.tweet_id=="1000000000000000005")][0] | (.media|length==0)' <<<"$page1" 2>/dev/null || echo false)"
check "$textonly" "§80.13 text-only tweet returned with media == []"

q1="$(j "$BASE/api/gallery/collections/linux.csv/posts?q=wayland" 2>/dev/null || echo '{}')"
qn="$(jq -r '.items | length' <<<"$q1" 2>/dev/null || echo x)"
qall="$(jq -r '[.items[].text] | map(test("wayland";"i")) | all' <<<"$q1" 2>/dev/null || echo false)"
check "$([ "$qn" = "2" ] && [ "$qall" = "true" ] && echo true || echo false)" "§80.14 search matches text case-insensitively (2 hits)" "got $qn all_match=$qall"

qa="$(j "$BASE/api/gallery/collections/linux.csv/posts?q=LINUXGUY" 2>/dev/null || echo '{}')"
qan="$(jq -r '.items | length' <<<"$qa" 2>/dev/null || echo x)"
check "$([ "$qan" = "4" ] && echo true || echo false)" "§80.14 search covers username (LINUXGUY → 4)" "got $qan"

tf="$(j "$BASE/api/gallery/collections/linux.csv/posts?tweet_from=2026-09-15T00:00:00Z" 2>/dev/null || echo '{}')"
tfn="$(jq -r '.items | length' <<<"$tf" 2>/dev/null || echo x)"
check "$([ "$tfn" != "8" ] && [ "$tfn" != "0" ] && echo true || echo false)" "§80.15 tweet_from filter applied" "got $tfn of 8"

sf="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=2026-09-24T00:00:00Z" 2>/dev/null || echo '{}')"
sfn="$(jq -r '.items | length' <<<"$sf" 2>/dev/null || echo x)"
check "$([ "$sfn" != "8" ] && [ "$sfn" != "0" ] && echo true || echo false)" "§80.15 saved_from filter applied" "got $sfn of 8"

both="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=2026-09-24T00:00:00Z&tweet_from=2026-09-15T00:00:00Z" 2>/dev/null || echo '{}')"
bn="$(jq -r '.items | length' <<<"$both" 2>/dev/null || echo x)"
check "$([ "$bn" -le "$tfn" ] 2>/dev/null && [ "$bn" -le "$sfn" ] 2>/dev/null && [ "$bn" != "0" ] && echo true || echo false)" \
  "§80.16 both date filters combine (AND)" "combined=$bn tweet=$tfn saved=$sfn"

asc="$(j "$BASE/api/gallery/collections/linux.csv/posts?sort=saved_asc" 2>/dev/null || echo '{}')"
asc_first="$(jq -r '.items[0].tweet_id' <<<"$asc" 2>/dev/null || echo x)"
check "$([ "$asc_first" = "1000000000000000008" ] && echo true || echo false)" \
  "§80.17 sort=saved_asc orders oldest-saved first" "got $asc_first"

cus="$(j "$BASE/api/gallery/collections/linux.csv/posts?sort=tweet_desc" 2>/dev/null || echo '{}')"
cus_first="$(jq -r '.items[0].tweet_id' <<<"$cus" 2>/dev/null || echo x)"
check "$([ "$cus_first" = "1000000000000000001" ] && echo true || echo false)" \
  "§80.17 sort=tweet_desc orders newest-posted first" "got $cus_first"

# cursor walk: limit=3 across 8 posts
seen=""; cursor=""; pages=0
while :; do
  url="$BASE/api/gallery/collections/linux.csv/posts?limit=3&sort=saved_desc"
  [ -n "$cursor" ] && url="$url&cursor=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$cursor")"
  pg="$(j "$url" 2>/dev/null || echo '{}')"
  ids="$(jq -r '.items[].tweet_id' <<<"$pg" 2>/dev/null || echo '')"
  seen="$seen $ids"
  pages=$((pages+1))
  more="$(jq -r '.has_more' <<<"$pg" 2>/dev/null || echo false)"
  cursor="$(jq -r '.next_cursor // empty' <<<"$pg" 2>/dev/null || echo '')"
  if [ "$more" != "true" ] || [ -z "$cursor" ] || [ "$pages" -gt 20 ]; then break; fi
done
uniq_n="$(tr ' ' '\n' <<<"$seen" | grep -c . || true)"
total_n="$(tr ' ' '\n' <<<"$seen" | grep -c . || true)"
distinct="$(tr ' ' '\n' <<<"$seen" | grep . | sort -u | wc -l)"
check "$([ "$distinct" = "8" ] && [ "$uniq_n" = "8" ] && [ "$pages" -ge 3 ] && echo true || echo false)" \
  "§80.18 cursor pagination walks all 8 posts once across $pages pages, no dupes" "items=$total_n distinct=$distinct"

end_more="$(jq -r '.has_more' <<<"$pg" 2>/dev/null || echo x)"
end_cur="$(jq -r 'if .next_cursor == null then "null" else "set" end' <<<"$pg" 2>/dev/null || echo x)"
check "$([ "$end_more" = "false" ] && [ "$end_cur" = "null" ] && echo true || echo false)" \
  "§80.18 terminal page has has_more=false and next_cursor=null" "has_more=$end_more next_cursor=$end_cur"

# --------------------------------------------------------------- §80.19-23
hdr "§80.19-23  Validation, security, robustness, freshness, read-only"

for q in "limit=0" "limit=101" "limit=abc" "sort=bogus" "saved_from=not-a-date"; do
  c="$(code "$BASE/api/gallery/collections/linux.csv/posts?$q")"
  check "$([ "$c" = "400" ] && echo true || echo false)" "§80.19 invalid '$q' → 400" "got $c"
done

nf="$(code "$BASE/api/gallery/collections/nope.csv/posts")"
check "$([ "$nf" = "404" ] && echo true || echo false)" "§80.5 unknown collection → 404" "got $nf"

for p in "../secret.csv" "..%2Fsecret.csv" "%2e%2e%2fsecret.csv" "a%2Fb.csv"; do
  c="$(code "$BASE/api/gallery/collections/$p/posts")"
  check "$([ "$c" = "400" ] || [ "$c" = "404" ] && echo true || echo false)" \
    "§80.20 traversal '$p' rejected ($c)"
done
body="$(curl -s --max-time 10 "$BASE/api/gallery/collections/nope.csv/posts")"
check "$(python3 - "$FIXTURE" "$body" <<'PY'
import sys
fixture, body = sys.argv[1], sys.argv[2]
print("true" if fixture not in body and "/tmp/" not in body else "false")
PY
)" "§80.20 error body does not leak the storage path"

mal="$(j "$BASE/api/gallery/collections/ai.csv/posts" 2>/dev/null || echo '{}')"
malrow="$(jq -r '[.items[] | select(.tweet_id=="2000000000000000002")][0].media | length == 0' <<<"$mal" 2>/dev/null || echo x)"
check "$([ "$malrow" = "true" ] && echo true || echo false)" \
  "§80.21 malformed media JSON yields media=[] (server alive)" "got $malrow"
alive="$(code "$BASE/health")"
check "$([ "$alive" = "200" ] && echo true || echo false)" "§80.21 server still healthy after malformed input"

before="$(jq -r '.items | length' <<<"$(j "$BASE/api/gallery/collections/design.csv/posts" 2>/dev/null || echo '{}')" 2>/dev/null || echo x)"
printf '%s\n' 'https://x.com/fresh/status/3000000000000000001,"[]",Fresh,@fresh,2026-09-26T00:00:00Z,2026-09-27T12:00:00Z,"appended while running"' >> "$FIXTURE/design.csv"
after="$(jq -r '.items | length' <<<"$(j "$BASE/api/gallery/collections/design.csv/posts" 2>/dev/null || echo '{}')" 2>/dev/null || echo x)"
check "$([ "$before" = "0" ] && [ "$after" = "1" ] && echo true || echo false)" \
  "§80.22 new CSV data visible without restart" "before=$before after=$after"

ro_code="$(code -X POST "$BASE/api/gallery/collections/linux.csv/posts" -d '{}')"
check "$([ "$ro_code" = "405" ] && echo true || echo false)" "§80.23 gallery API rejects writes (405)" "got $ro_code"
sum_before="$(jq -r '[.collections[] | select(.name=="Linux")][0].post_count' <<<"$(j "$BASE/api/gallery/collections")" 2>/dev/null || echo x)"
check "$([ "$sum_before" = "8" ] && echo true || echo false)" "§80.23 gallery API did not mutate data" "got $sum_before"

# ------------------------------------------------------------- §80.24-25 SPA
hdr "§80.24-25  Production serving"

if [ -f "$ROOT/web/dist/index.html" ]; then
  root_ct="$(curl -s -o /dev/null -w '%{content_type}' --max-time 10 "$BASE/")"
  check "$(grep -qi 'text/html' <<<"$root_ct" && echo true || echo false)" "§80.24 / serves web/dist HTML" "$root_ct"
  deep="$(curl -s --max-time 10 "$BASE/collections/linux.csv")"
  check "$(grep -qi '<div id="root"\|<div id=root' <<<"$deep" && echo true || echo false)" \
    "§80.25 deep SPA route serves index.html"
  apinope="$(curl -s -w '\n%{http_code}' --max-time 10 "$BASE/api/nope")"
  acode="$(tail -1 <<<"$apinope")"
  check "$([ "$acode" = "404" ] && echo true || echo false)" "§80.25 unknown /api path → 404" "got $acode"
  check "$(grep -q '"status":"error"' <<<"$apinope" && echo true || echo false)" \
    "§80.25 unknown /api path returns the error JSON, not HTML"
else
  miss "§80.24 / serves web/dist (web/dist not built yet)"
  miss "§80.25 SPA deep route + unknown-API 404 (web/dist not built yet)"
fi

# ------------------------------------------------------------------ summary
hdr "Summary"
printf '  passed %d, failed %d, skipped %d\n' "$pass" "$fail" "$skip"
if [ "$fail" -gt 0 ]; then
  printf '\n  failures:\n'
  for f in "${FAILED[@]}"; do printf '    - %s\n' "$f"; done
  exit 1
fi
exit 0
