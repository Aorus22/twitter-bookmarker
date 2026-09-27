#!/usr/bin/env bash
# check-requirement-traceability.sh — milestone-level consistency gate.
#
# Verifies that the requirement set is internally coherent across all three
# planning artifacts, which is what the milestone audit checks:
#
#   * every requirement in REQUIREMENTS.md's body has a Traceability row
#   * no requirement appears in the table but not the body
#   * no duplicate requirement IDs
#   * every requirement is claimed by exactly one ROADMAP phase
#   * ROADMAP cites no requirement that REQUIREMENTS.md never defines
#
# Usage: scripts/check-requirement-traceability.sh
# Exit:  0 = consistent, 1 = inconsistent.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import re, sys, pathlib
from collections import Counter

root = pathlib.Path(sys.argv[1])
reqp, roadp = root / ".planning/REQUIREMENTS.md", root / ".planning/ROADMAP.md"

for p in (reqp, roadp):
    if not p.exists():
        print(f"FAIL  missing {p}")
        sys.exit(1)

req, road = reqp.read_text(), roadp.read_text()
body = re.findall(r'^-\s*\[[ xX]\]\s*\*\*([A-Z][A-Z0-9]*-\d+)\*\*', req, re.M)
table = [m[0] for m in re.findall(
    r'^\|\s*([A-Z][A-Z0-9]*-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|', req, re.M)]

claims, cur = {}, None
for line in road.splitlines():
    m = re.match(r'####\s+Phase\s+(\d+):', line)
    if m:
        cur = m.group(1)
    m = re.match(r'\*\*Requirements\*\*:\s*(.+)$', line)
    if m and cur:
        for rid in re.findall(r'[A-Z][A-Z0-9]*-\d+', m.group(1)):
            claims.setdefault(rid, []).append(cur)

checks = [
    ("requirements defined in body", len(body) > 0, f"{len(body)} found"),
    ("no duplicate requirement IDs",
     len(body) == len(set(body)),
     ", ".join(sorted({i for i in body if body.count(i) > 1})) or "none"),
    ("every body requirement has a Traceability row",
     not (set(body) - set(table)),
     ", ".join(sorted(set(body) - set(table))) or "none"),
    ("no Traceability row without a body requirement",
     not (set(table) - set(body)),
     ", ".join(sorted(set(table) - set(body))) or "none"),
    ("every requirement claimed by exactly one roadmap phase",
     all(len(v) == 1 for v in claims.values()) and not (set(body) - set(claims)),
     ", ".join(sorted(set(body) - set(claims))) or
     "; ".join(f"{k}->{v}" for k, v in claims.items() if len(v) > 1) or "none"),
    ("roadmap cites no undefined requirement",
     not (set(claims) - set(body)),
     ", ".join(sorted(set(claims) - set(body))) or "none"),
]

failed = 0
for name, ok, detail in checks:
    print(f"{'PASS ' if ok else 'FAIL '} {name}" + (f"  [{detail}]" if detail else ""))
    failed += 0 if ok else 1

counts = Counter(v[0] for v in claims.values())
print("\nper-phase requirement counts: " +
      ", ".join(f"{k}:{counts[k]}" for k in sorted(counts, key=int)))
print(f"total: {len(body)} requirements, {len(table)} traceability rows")

# Status column must be a value phase.complete can advance.
bad = [r for r in re.findall(
    r'^\|\s*([A-Z][A-Z0-9]*-\d+)\s*\|[^|]+\|\s*([^|]+?)\s*\|', req, re.M)
    if r[1].strip().lower() not in ("pending", "in progress", "gaps found", "complete")]
if bad:
    print("FAIL  unrecognised Status values (phase.complete cannot advance them): "
          + ", ".join(f"{i}={s!r}" for i, s in bad))
    failed += 1
else:
    print("PASS  all Traceability Status values are phase.complete-compatible")

sys.exit(1 if failed else 0)
PY
