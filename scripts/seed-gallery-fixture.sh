#!/usr/bin/env bash
# seed-gallery-fixture.sh — write a reproducible Phase 2 gallery fixture.
#
# Creates <dir>/ai.csv, <dir>/linux.csv, <dir>/design.csv (+ decoys that must be
# ignored: index.json, linux.csv.bak, .hidden.csv) with rows that exercise the
# gallery read path:
#
#   * a 4-media tweet, a 3-media tweet, a 2-media tweet, a 1-media tweet
#   * text-only tweets (media = [])
#   * an empty collection (design.csv: header only)
#   * a malformed media cell and a malformed row inside ai.csv
#   * a searchable author/username/text mix ("wayland", "Linux", "@linuxguy")
#   * saved_at spread over recent days so quick date presets are meaningful
#
# Usage:
#   scripts/seed-gallery-fixture.sh [DIR] [--fresh]
#     DIR      storage dir to write (default: $(mktemp -d))
#     --fresh  delete DIR first
#
# Prints the storage dir on stdout (last line), so callers can:
#   DIR=$(scripts/seed-gallery-fixture.sh /tmp/twbm-fixture --fresh | tail -1)

set -euo pipefail

DIR="${1:-}"
FRESH=""
if [ "${2:-}" = "--fresh" ]; then FRESH=1; fi
if [ -z "$DIR" ]; then DIR="$(mktemp -d "${TMPDIR:-/tmp}/twbm-fixture.XXXXXX")"; fi

if [ -n "$FRESH" ]; then rm -rf "$DIR"; fi
mkdir -p "$DIR"

# Timestamps: today, and N days back, in UTC RFC3339.
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
d() { date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ; }
t() { date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ; }

MEDIA_A='["https://pbs.twimg.com/media/a1.jpg","https://pbs.twimg.com/media/a2.jpg","https://pbs.twimg.com/media/a3.jpg","https://pbs.twimg.com/media/a4.jpg"]'
MEDIA_B='["https://pbs.twimg.com/media/b1.jpg","https://pbs.twimg.com/media/b2.jpg","https://pbs.twimg.com/media/b3.jpg"]'
MEDIA_C='["https://pbs.twimg.com/media/c1.jpg","https://pbs.twimg.com/media/c2.jpg"]'
MEDIA_D='["https://pbs.twimg.com/media/d1.jpg"]'

# ---------------------------------------------------------------- linux.csv
# 8 valid rows + the general mix the §82 scenario walks through.
cat > "$DIR/linux.csv" <<CSV
url,media,author,username,tweet_date,saved_at,text
https://x.com/linuxguy/status/1000000000000000001,"$MEDIA_A",Linux Guy,@linuxguy,$(t 20),$now,"Wayland on Linux: a four-image thread about compositors, tearing, and HiDPI."
https://x.com/linuxguy/status/1000000000000000002,"$MEDIA_B",Linux Guy,@linuxguy,$(t 19),$(d 1),"Terminal workflows that survive a reinstall — three screenshots."
https://x.com/tilingfan/status/1000000000000000003,"$MEDIA_C",Tiling Fan,@tilingfan,$(t 18),$(d 2),"My tiling setup after two years, two images."
https://x.com/kernelnotes/status/1000000000000000004,"$MEDIA_D",Kernel Notes,@kernelnotes,$(t 17),$(d 3),"One screenshot of the new scheduler trace view."
https://x.com/linuxguy/status/1000000000000000005,[],Linux Guy,@linuxguy,$(t 16),$(d 4),"Text-only: why I finally stopped distro hopping. No media here."
https://x.com/shellpilled/status/1000000000000000006,[],Shell Pilled,@shellpilled,$(t 15),$(d 5),"Text-only: a short note on POSIX shell quoting."
https://x.com/linuxguy/status/1000000000000000007,"$MEDIA_C",Linux Guy,@linuxguy,$(t 14),$(d 6),"Wayland vs X11, again — but with benchmarks this time."
https://x.com/tilingfan/status/1000000000000000008,"$MEDIA_D",Tiling Fan,@tilingfan,$(t 13),$(d 7),"A single screenshot of the new status bar."
CSV

# ------------------------------------------------------------------- ai.csv
# Valid rows plus a malformed media cell and a malformed (short) row, which the
# reader must tolerate without losing the rest of the collection.
cat > "$DIR/ai.csv" <<CSV
url,media,author,username,tweet_date,saved_at,text
https://x.com/aiperson/status/2000000000000000001,"$MEDIA_D",AI Person,@aiperson,$(t 10),$(d 1),"Local models are finally good enough for a personal archive."
https://x.com/aiperson/status/2000000000000000002,not-json,AI Person,@aiperson,$(t 9),$(d 2),"This row has a broken media cell and must still render as a text card."
https://x.com/aiperson/status/2000000000000000003,[],AI Person,@aiperson,$(t 8),$(d 3),"Text-only thinking about retrieval without a vector database."
https://x.com/aiperson/status/2000000000000000004
https://x.com/promptsmith/status/2000000000000000005,"$MEDIA_C",Prompt Smith,@promptsmith,$(t 6),$(d 4),"Two images of an eval dashboard."
CSV

# --------------------------------------------------------------- design.csv
# Valid CSV, header only => a collection with 0 posts and 0 media.
printf 'url,media,author,username,tweet_date,saved_at,text\n' > "$DIR/design.csv"

# ------------------------------------------------------- decoys (must be ignored)
printf '{"version":1,"tweets":[]}\n' > "$DIR/index.json"
cp "$DIR/linux.csv" "$DIR/linux.csv.bak"
cp "$DIR/linux.csv" "$DIR/.hidden.csv"
printf 'not a csv\n' > "$DIR/notes.txt"

echo "seeded fixture:" >&2
echo "  $DIR" >&2
ls -1 "$DIR" >&2
echo "$DIR"
