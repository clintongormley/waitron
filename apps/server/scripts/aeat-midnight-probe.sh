#!/bin/bash
# aeat-midnight-probe.sh <certificate name>
# A1270: at 00:10 Madrid, sends four throwaway records to AEAT's TEST service and writes what it
# answered. Reads <name>.p12 (or .pfx), <name>.pass, <name>-nif.txt and <name>-legal-name.txt
# (else nif.txt and legal-name.txt) from ~/.waitron-cert-session, as check.sh there does.
# Dry run: WAITRON_AEAT_PROBE_DRY_RUN=1 WAITRON_AEAT_PROBE_CERT_DIR=<throwaway folder>
# [WAITRON_AEAT_PROBE_NOW=<time>]; it never connects, never waits, and writes inside that folder.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd -P)
server=$(cd "$here/.." && pwd -P)
name=${1:?certificate name}

if [ "${WAITRON_AEAT_PROBE_DRY_RUN:-}" = 1 ]; then
  dry=1
  d=$(cd "${WAITRON_AEAT_PROBE_CERT_DIR:?a dry run names its throwaway certificate folder}" && pwd -P)
  r1="$d/a1270-result.txt"
  r2="$d/result.txt"
else
  dry=0
  if [ -n "${WAITRON_AEAT_PROBE_CERT_DIR:-}" ] || [ -n "${WAITRON_AEAT_PROBE_NOW:-}" ]; then
    echo "WAITRON_AEAT_PROBE_CERT_DIR and WAITRON_AEAT_PROBE_NOW are honoured only in a dry run"
    exit 2
  fi
  d="$HOME/.waitron-cert-session"
  mkdir -p "$HOME/waitron-campaign-l/receipts/a1270"
  r1="$d/a1270-result.txt"
  r2="$HOME/waitron-campaign-l/receipts/a1270/result.txt"
fi

note() {
  line="$1 at $(date -u +%Y-%m-%dT%H:%M:%SZ) UTC, $(TZ=Europe/Madrid date +%H:%M) Madrid: $2"
  echo "$line"
  echo "$line" >>"$r1"
  echo "$line" >>"$r2"
}

madrid_hm() {
  hm=$(TZ=Europe/Madrid date +%H%M)
  hm=$((10#$hm))
}

if [ "$dry" = 0 ]; then
  madrid_hm
  if [ "$hm" -ge 55 ] && [ "$hm" -lt 1200 ]; then
    note "not sent" "started between 00:55 and 12:00 Madrid, too late for tonight's window"
    exit 1
  fi
fi

file="$d/$name.p12"
[ -s "$file" ] || file="$d/$name.pfx"
[ -s "$file" ] || { note "not sent" "missing $d/$name.p12 (or .pfx)"; exit 2; }
nif="$name-nif.txt"
[ -s "$d/$nif" ] || nif=nif.txt
legal="$name-legal-name.txt"
[ -s "$d/$legal" ] || legal=legal-name.txt
for f in "$name.pass" "$nif" "$legal"; do
  [ -s "$d/$f" ] || { note "not sent" "missing $d/$f"; exit 2; }
done
export WAITRON_CERT_CHECK_PFX_BASE64 WAITRON_CERT_CHECK_PASSPHRASE WAITRON_CERT_CHECK_NIF WAITRON_CERT_CHECK_LEGAL_NAME
WAITRON_CERT_CHECK_PFX_BASE64=$(base64 -i "$file")
WAITRON_CERT_CHECK_PASSPHRASE=$(cat "$d/$name.pass")
WAITRON_CERT_CHECK_NIF=$(cat "$d/$nif")
WAITRON_CERT_CHECK_LEGAL_NAME=$(cat "$d/$legal")
export WAITRON_CERT_CHECK_ENVIRONMENT=preproduction
export WAITRON_AEAT_PROBE_RESULT_FILES="$r1:$r2"

scratch=$(mktemp -d)
trap 'rm -f "$scratch/run.log"; rmdir "$scratch"' EXIT

step() {
  set +e
  (cd "$server" && WAITRON_AEAT_PROBE_MODE=$1 pnpm --filter @waitron/server test:preprod \
    --reporter=default src/aeat-midnight-date.preprod.test.ts) 2>&1 | tee "$scratch/run.log"
  code=${PIPESTATUS[0]}
  set -e
}

step preflight
if [ "$code" != 0 ] || ! /usr/bin/grep -q "pre-flight ok" "$scratch/run.log"; then
  note "not sent" "pre-flight failed (exit $code)"
  exit 1
fi

if [ "$dry" = 0 ]; then
  while :; do
    madrid_hm
    if [ "$hm" -ge 10 ] && [ "$hm" -lt 55 ]; then break; fi
    if [ "$hm" -ge 55 ] && [ "$hm" -lt 1200 ]; then
      note "not sent" "missed the 00:10-00:55 Madrid window"
      exit 1
    fi
    sleep 30
  done
fi

step send
if [ "$code" != 0 ]; then
  note "send step failed" "exit $code; any record lines above it were sent"
  exit 1
fi
echo "done: results in $r1 and $r2"
