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
# The backend port is a hardcoded constant (config.Port), so a dev server started
# with `make run` legitimately owns 43121. Re-exec inside a private network
# namespace to get an isolated loopback on the same port instead of stopping it.
if curl -fsS --max-time 2 "$BASE/health" >/dev/null 2>&1; then
  if [ -z "${TWBM_ACCEPTANCE_NS:-}" ] && command -v unshare >/dev/null 2>&1; then
    echo "  port $PORT is busy — re-running in a private network namespace (unshare -rn)"
    export TWBM_ACCEPTANCE_NS=1
    exec unshare -rn bash -c 'ip link set lo up 2>/dev/null || true; exec "$0" "$@"' "$0" "$@"
  fi
  echo "port $PORT is already in use and network-namespace isolation is unavailable" >&2
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
# v1.0 contract is {"items":{...}} (model.IndexResponse.Items). `tweets` is the
# on-disk index.json key, not the HTTP response key.
idx_shape="$(j "$BASE/v1/index" | jq -r 'has("items") and (.items|type=="object")' 2>/dev/null || echo false)"
check "$([ "$idx_code" = "200" ] && echo true || echo false)" "§80.2 /v1/index returns 200" "got $idx_code"
check "$idx_shape" "§80.2 /v1/index returns {\"items\":{...}}" 

save_code="$(code -X POST "$BASE/v1/bookmarks" -H 'Content-Type: application/json' \
  -d '{"filename":"smoke.csv","tweet":{"url":"https://x.com/smoke/status/9990000000000000001","media":[],"author":"Smoke","username":"@smoke","tweet_date":"2026-09-01T00:00:00Z","text":"acceptance smoke"}}')"
check "$([ "$save_code" = "201" ] || [ "$save_code" = "409" ] && echo true || echo false)" \
  "§80.3 POST /v1/bookmarks still accepts a save (201)" "got $save_code"
# The save creates a real CSV, which is by design a new collection. Remove it so
# the collection assertions below still describe the seeded fixture only.
rm -f "$FIXTURE/smoke.csv"

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

# The fixture generates timestamps RELATIVE to seed time (tweet_date = now-1d…
# now-8d, saved_at = now…now-7d), so absolute dates cannot be used here. Use a
# cutoff half a day off any fixture boundary so the expected counts are exact
# and immune to the few seconds between seeding and querying.
CUT="$(date -u -d '-5 days -12 hours' +%Y-%m-%dT%H:%M:%SZ)"

tf="$(j "$BASE/api/gallery/collections/linux.csv/posts?tweet_from=$CUT" 2>/dev/null || echo '{}')"
tfn="$(jq -r '.items | length' <<<"$tf" 2>/dev/null || echo x)"
check "$([ "$tfn" = "5" ] && echo true || echo false)" \
  "§80.15 tweet_from lower bound inclusive (>= $CUT → 5 of 8)" "got $tfn of 8"

tto="$(j "$BASE/api/gallery/collections/linux.csv/posts?tweet_to=$CUT" 2>/dev/null || echo '{}')"
tton="$(jq -r '.items | length' <<<"$tto" 2>/dev/null || echo x)"
check "$([ "$tton" = "3" ] && echo true || echo false)" \
  "§80.15 tweet_to upper bound inclusive (<= $CUT → 3 of 8)" "got $tton of 8"

sf="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=$CUT" 2>/dev/null || echo '{}')"
sfn="$(jq -r '.items | length' <<<"$sf" 2>/dev/null || echo x)"
check "$([ "$sfn" = "6" ] && echo true || echo false)" \
  "§80.15 saved_from lower bound inclusive (>= $CUT → 6 of 8)" "got $sfn of 8"

sto="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_to=$CUT" 2>/dev/null || echo '{}')"
ston="$(jq -r '.items | length' <<<"$sto" 2>/dev/null || echo x)"
check "$([ "$ston" = "2" ] && echo true || echo false)" \
  "§80.15 saved_to upper bound inclusive (<= $CUT → 2 of 8)" "got $ston of 8"

both="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=$CUT&tweet_from=$CUT" 2>/dev/null || echo '{}')"
bn="$(jq -r '.items | length' <<<"$both" 2>/dev/null || echo x)"
check "$([ "$bn" = "5" ] && [ "$bn" -le "$tfn" ] 2>/dev/null && [ "$bn" -le "$sfn" ] 2>/dev/null && echo true || echo false)" \
  "§80.16 both date filters combine (AND → 5, <= each alone)" "combined=$bn tweet=$tfn saved=$sfn"

win="$(j "$BASE/api/gallery/collections/linux.csv/posts?tweet_from=$CUT&tweet_to=$CUT" 2>/dev/null || echo '{}')"
winn="$(jq -r '.items | length' <<<"$win" 2>/dev/null || echo x)"
check "$([ "$winn" = "0" ] && echo true || echo false)" \
  "§80.16 an empty date window returns [] not a fallback to all" "got $winn"

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

# ------------------------------------------- PRD §82 integration scenario (HARD-05)
# The HTTP-assertable half of the §82 scenario (steps 1-15 and 22-24) against the
# seeded storage dir. Steps 16-21 are browser interactions and live in
# scripts/check-web-acceptance.sh; the whole scenario is also a checklist in
# docs/MANUAL-TEST-CHECKLIST.md.
hdr "§82  Integration acceptance scenario (HARD-05)"

# Steps 1-2: backend running; the seeded dir holds the three named CSVs.
check "$([ "$(code "$BASE/health")" = "200" ] && echo true || echo false)" \
  "§82.1 backend is running (/health 200)"
for f in ai.csv linux.csv design.csv; do
  check "$([ -f "$FIXTURE/$f" ] && echo true || echo false)" "§82.2 storage contains $f"
done

# Steps 3-4: the homepage lists AI, Linux and Design.
scenario_names="$(jq -r '[.collections[].name] | sort | join(",")' <<<"$(j "$BASE/api/gallery/collections")" 2>/dev/null || echo '')"
check "$([ "$scenario_names" = "AI,Design,Linux" ] && echo true || echo false)" \
  "§82.3-4 homepage shows AI, Linux, Design" "got [$scenario_names]"

# Steps 5-8: open Linux; posts render; the 4-image tweet shows 4 media; the
# text-only tweet still appears as a text card.
linux82="$(j "$BASE/api/gallery/collections/linux.csv/posts?limit=30" 2>/dev/null || echo '{}')"
check "$([ "$(jq -r '.items|length' <<<"$linux82")" = "8" ] && echo true || echo false)" \
  "§82.5-6 opening Linux returns its 8 posts"
check "$([ "$(jq -r '[.items[]|select(.tweet_id=="1000000000000000001")][0].media|length' <<<"$linux82")" = "4" ] && echo true || echo false)" \
  "§82.7 the 4-image tweet carries 4 media URLs"
check "$(jq -r '[.items[]|select(.tweet_id=="1000000000000000005")][0] | ((.media|length)==0) and ((.text|length)>0)' <<<"$linux82" 2>/dev/null || echo false)" \
  "§82.8 the text-only tweet is present with empty media and text"

# Steps 9-11: search "wayland"; then Bookmark Date → Last 7 Days changes results.
wl82="$(j "$BASE/api/gallery/collections/linux.csv/posts?q=wayland" 2>/dev/null || echo '{}')"
check "$([ "$(jq -r '.items|length' <<<"$wl82")" = "2" ] && echo true || echo false)" \
  "§82.9 search 'wayland' narrows the result set to 2"
# Half a day off the 7-day boundary so the check is immune to the seconds
# between seeding and querying (rows are saved 0..7 days ago).
SCEN_CUT="$(date -u -d '-6 days -12 hours' +%Y-%m-%dT%H:%M:%SZ)"
last7="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=$SCEN_CUT" 2>/dev/null || echo '{}')"
l7="$(jq -r '.items|length' <<<"$last7" 2>/dev/null || echo x)"
check "$([ "$l7" = "7" ] && echo true || echo false)" \
  "§82.10-11 Bookmark Date → Last 7 Days changes the results (7 of 8)" "got $l7 of 8"

# Steps 12-13: add a Tweet Date filter too; every result must satisfy both ranges.
both82="$(j "$BASE/api/gallery/collections/linux.csv/posts?saved_from=$SCEN_CUT&tweet_from=$CUT" 2>/dev/null || echo '{}')"
b82="$(jq -r '.items|length' <<<"$both82" 2>/dev/null || echo x)"
both_ok="$(jq -r --arg s "$SCEN_CUT" --arg t "$CUT" '[.items[] | ((.saved_at >= $s) and (.tweet_date >= $t))] | all' <<<"$both82" 2>/dev/null || echo false)"
check "$([ "$b82" -le "$l7" ] 2>/dev/null && [ "$both_ok" = "true" ] && echo true || echo false)" \
  "§82.12-13 both ranges applied (AND → $b82 of 8, every row satisfies both)" "combined=$b82 saved=$l7 all_match=$both_ok"

# Step 14: sort → Newest Posted.
newest82="$(j "$BASE/api/gallery/collections/linux.csv/posts?sort=tweet_desc" 2>/dev/null || echo '{}')"
check "$([ "$(jq -r '.items[0].tweet_id' <<<"$newest82")" = "1000000000000000001" ] && echo true || echo false)" \
  "§82.14 sort Newest Posted puts the newest tweet first"

# Step 15: infinite scroll fetches the next page.
p82="$(j "$BASE/api/gallery/collections/linux.csv/posts?limit=3&sort=saved_desc" 2>/dev/null || echo '{}')"
curl82="$(jq -r '.next_cursor // empty' <<<"$p82" 2>/dev/null || echo '')"
check "$([ -n "$curl82" ] && [ "$(jq -r '.has_more' <<<"$p82")" = "true" ] && echo true || echo false)" \
  "§82.15 the first page reports has_more plus a cursor for the next page"

# Steps 22-24: the extension saves a new tweet; returning to the gallery shows it
# with no backend restart.
before82="$(code "$BASE/api/gallery/collections/scenario.csv/posts")"
saved82="$(code -X POST "$BASE/v1/bookmarks" -H 'Content-Type: application/json' \
  -d '{"filename":"scenario.csv","tweet":{"url":"https://x.com/scenario/status/5000000000000000001","media":[],"author":"Scenario","username":"@scenario","tweet_date":"2026-09-26T00:00:00Z","text":"integration scenario row"}}')"
check "$([ "$before82" = "404" ] && { [ "$saved82" = "201" ] || [ "$saved82" = "409" ]; } && echo true || echo false)" \
  "§82.22 the extension-style save lands a new row (before=$before82, save=$saved82)"
scenario_view="$(j "$BASE/api/gallery/collections/scenario.csv/posts" 2>/dev/null || echo '{}')"
check "$([ "$(jq -r '.items|length' <<<"$scenario_view")" = "1" ] && echo true || echo false)" \
  "§82.23-24 returning to the gallery shows the new data without a restart"
check "$([ "$(code "$BASE/health")" = "200" ] && echo true || echo false)" \
  "§82.24 the backend is the original process and is still healthy"

# ------------------------------------------------------------- §80.24-25 SPA
hdr "§80.24-25  Production serving"

# Gate on the server actually *serving* the SPA, not on web/dist merely existing:
# Phase 3 builds web/dist but Phase 9 wires up static serving, so between those
# phases the directory exists while the checks below would be meaningless.
root_probe="$(curl -s -w '\n%{content_type}' --max-time 10 "$BASE/" 2>/dev/null || true)"
root_ct="$(tail -1 <<<"$root_probe")"
serves_spa=false
if grep -qi 'text/html' <<<"$root_ct" && grep -qi '<div id="\?root' <<<"$root_probe"; then serves_spa=true; fi

if [ "$serves_spa" = "true" ]; then
  check "$([ -f "$ROOT/web/dist/index.html" ] && echo true || echo false)" \
    "§80.24 / serves web/dist HTML" "$root_ct"
  deep="$(curl -s --max-time 10 "$BASE/collections/linux.csv")"
  check "$(grep -qi '<div id="root"\|<div id=root' <<<"$deep" && echo true || echo false)" \
    "§80.25 deep SPA route serves index.html"
  apinope="$(curl -s -w '\n%{http_code}' --max-time 10 "$BASE/api/nope")"
  acode="$(tail -1 <<<"$apinope")"
  check "$([ "$acode" = "404" ] && echo true || echo false)" "§80.25 unknown /api path → 404" "got $acode"
  check "$(grep -q '"status":"error"' <<<"$apinope" && echo true || echo false)" \
    "§80.25 unknown /api path returns the error JSON, not HTML"
else
  miss "§80.24 / serves web/dist HTML (static serving arrives in Phase 9)"
  miss "§80.25 SPA deep route + unknown-/api 404 (static serving arrives in Phase 9)"
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
