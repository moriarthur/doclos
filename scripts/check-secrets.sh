#!/usr/bin/env bash
# PD-S1 / CI-1: secret scanning over the TRACKED tree. Values are never
# printed — matches are classified as placeholder or suspicious, and only
# file:line plus the classification are reported. Exits 1 on suspicion.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail=0
while IFS=: read -r f n rest; do
  val=$(sed -n "${n}p" "$f" | grep -oE "[\"'][A-Za-z0-9+/_-]{16,}[\"']" | head -1 | tr -d "'\"")
  case "$val" in
    # placeholder- or fixture-shaped values are fine in docs/tests;
    # a REAL secret would not contain these words
    *your*|*change*|*example*|*placeholder*|*xxxx*|*password*|*dummy*|*fixture*)
      : # placeholder-shaped — fine in docs/.env.example
      ;;
    *)
      echo "SUSPICIOUS (len ${#val}): $f:$n"
      fail=1
      ;;
  esac
done < <(git grep -nIiE "(secret|password|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/_-]{16,}" -- ':!pnpm-lock.yaml' ':!*.lock' || true)

# .env must never be tracked
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "SUSPICIOUS: .env is tracked"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "✗ secret scan found suspicious values (see above; values are intentionally not printed)"
  exit 1
fi
echo "✓ secret scan clean (tracked tree; no values printed)"
