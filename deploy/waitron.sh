#!/usr/bin/env bash
#
# One command to run a Waitron box: install/upgrade it, or reset it to a clean state.
#
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
#   sudo bash waitron.sh install            # published main image
#   sudo bash waitron.sh install <ref>      # build and run a branch or commit on the box
#   sudo bash waitron.sh reset [--all]      # wipe back to a clean box (keeps the certificate)
#
# Operating this file is deploy/README.md. It replaces the old install.sh / prepare.sh /
# try-branch.sh trio; scripts/deploy-image-env.test.ts and scripts/waitron-sh.test.mjs pin it.
set -euo pipefail

WAITRON_DIR="${WAITRON_DIR:-/opt/waitron}"
# The public repo, written out in full (not via a variable) so scripts/deploy-image-env.test.ts can
# pin the literal URL as text — a typo in the org/repo then fails the guard loudly.
RAW_BASE="https://raw.githubusercontent.com/clintongormley/waitron"
# One copy of boot.ts's BOX_HOSTNAME, pinned by scripts/deploy-image-env.test.ts to the image env,
# compose's defaults and the QR the restaurant scans.
BOX_URL="https://waitron.local"
# The image for the throwaway containers that read and edit the state volume (cat trading.env, find,
# rm) — none of which cares about the Postgres version. It reuses the db image only so it is ALREADY
# PRESENT on an installed box and needs no network pull; any pre-pulled image would do. The literal
# postgres major is coupled across three files (see deploy/Dockerfile's PG_MAJOR note).
HELPER_IMAGE="postgres:18-alpine"

die() { echo "waitron.sh: $1" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'USAGE'
waitron.sh: usage:
  waitron.sh install [ref]     install or upgrade the box (ref defaults to main)
  waitron.sh reset [--all]     wipe the box to a clean state (keeps the certificate; --all drops it too)
USAGE
  exit 2
}

# curl preferred, wget the minimal-Debian fallback; neither present is a clear failure.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  fetch() { die "need curl or wget to download the box files — install one and re-run"; }
fi

as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi; }
# apt, never interactive: sudo's env_reset discards an exported DEBIAN_FRONTEND, so pass it inline.
apt_get() { as_root env DEBIAN_FRONTEND=noninteractive apt-get "$@"; }

# 1. Docker Engine + the compose plugin, and the daemon enabled on boot. `docker compose version`
#    is the test, because the v1 docker-compose binary cannot run this compose file.
ensure_docker() {
  if ! docker compose version >/dev/null 2>&1; then
    [ -r /etc/os-release ] || die "no /etc/os-release — install Docker Engine and the compose plugin first" 2
    # shellcheck disable=SC1091
    . /etc/os-release
    local distro codename
    case " ${ID:-} ${ID_LIKE:-} " in
      *" ubuntu "*) distro=ubuntu ;;
      *" debian "*) distro=debian ;;
      *) die "Docker is missing and ${ID:-this distro} is not Debian or Ubuntu — install it first" 2 ;;
    esac
    codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
    [ -n "$codename" ] || die "/etc/os-release names no VERSION_CODENAME — install Docker Engine first" 2
    apt_get update
    apt_get install -y --no-install-recommends ca-certificates curl
    as_root install -m 0755 -d /etc/apt/keyrings
    as_root curl -fsSL "https://download.docker.com/linux/${distro}/gpg" -o /etc/apt/keyrings/docker.asc
    as_root chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$distro" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
    apt_get update
    apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if ! command -v qrencode >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    apt_get install -y --no-install-recommends qrencode
  fi
  if command -v systemctl >/dev/null 2>&1; then as_root systemctl enable --now docker; fi
}

# 2. The box's one pre-boot secret, generated once and never overwritten or printed. Checked BEFORE
#    the write so a failed generator cannot leave an empty password the guard then skips for ever.
ensure_env_password() {
  [ -f "$WAITRON_DIR/.env" ] && grep -q '^POSTGRES_PASSWORD=' "$WAITRON_DIR/.env" && return 0
  local secret; secret="$(openssl rand -hex 32 2>/dev/null || true)"
  [ -n "$secret" ] || die "could not generate POSTGRES_PASSWORD — is openssl installed?"
  ( umask 077; printf 'POSTGRES_PASSWORD=%s\n' "$secret" >> "$WAITRON_DIR/.env" )
  unset secret
}

# .env line editing: set/replace or remove a KEY, preserving 0600 and never touching other lines.
# The rewrite is ATOMIC — the new content is built in a temp file BESIDE .env and renamed onto it only
# after the write fully succeeds. It never truncates .env in place: a write that failed mid-way there
# would empty the file and lose POSTGRES_PASSWORD, and the next install would mint a different one,
# locking the app out of its own cluster. `grep -v` exits 1 when it drops every line, which `set -e`
# would abort on — hence `|| true`.
#
# Shared by env_set and env_unset: drop every `KEY=` line from .env, then (env_set only, when a value
# is passed) append `KEY=value`. env_unset passes no value, so nothing is appended.
_env_rewrite() {
  local key="$1" file="$WAITRON_DIR/.env" tmp
  tmp="$(mktemp "${file}.XXXXXX")" || die "could not create a temp file next to .env"
  chmod 600 "$tmp"
  [ -f "$file" ] && { grep -v "^${key}=" "$file" > "$tmp" || true; }
  [ "$#" -ge 2 ] && printf '%s=%s\n' "$key" "$2" >> "$tmp"
  mv "$tmp" "$file" || { rm -f "$tmp"; die "could not update .env — left unchanged so the password is not lost"; }
}
env_set() { _env_rewrite "$1" "$2"; }
env_unset() {
  [ -f "$WAITRON_DIR/.env" ] || return 0
  _env_rewrite "$1"
}

# 3. compose.yml + .env.example always from the INSTALLED ref, so compose and the image share a
#    commit. Overwrites an operator's compose edits (rare); the choice is stated aloud.
fetch_box_files() {
  local ref="$1"
  fetch "${RAW_BASE}/${ref}/deploy/compose.yml" "$WAITRON_DIR/compose.yml"
  fetch "${RAW_BASE}/${ref}/deploy/.env.example" "$WAITRON_DIR/.env.example"
  echo "waitron.sh: wrote compose.yml from ${ref} (any local compose.yml edits were overwritten)"
}

# 4. main pulls the published image and records no override; a branch/commit builds both images on
#    the box from the git context and records the tags in .env so the box stays on them.
select_image() {
  local ref="$1"
  if [ "$ref" = "main" ]; then
    env_unset WAITRON_IMAGE
    env_unset WAITRON_PRINT_AGENT_IMAGE
    docker compose -f "$WAITRON_DIR/compose.yml" pull --ignore-pull-failures
  else
    local safe tag agent_tag
    safe="$(printf '%s' "$ref" | tr -c 'A-Za-z0-9._-' '-')"; safe="${safe:0:100}"
    tag="waitron:${safe}"; agent_tag="waitron-print-agent:${safe}"
    # Full git URL inline (not via a variable) so the guard can pin `waitron.git#<ref>` as text.
    # Docker fetches the ref itself; -f is relative to the fetched repo root, not the local checkout.
    docker build -t "$tag" -f deploy/Dockerfile "https://github.com/clintongormley/waitron.git#${ref}"
    docker build -t "$agent_tag" -f deploy/Dockerfile --target print-agent "https://github.com/clintongormley/waitron.git#${ref}"
    env_set WAITRON_IMAGE "$tag"
    env_set WAITRON_PRINT_AGENT_IMAGE "$agent_tag"
  fi
}

# The whole console instruction after a box comes up: where to go, plus the QR of the setup URL.
print_links() {
  cat <<EOF

  Waitron is ready.

  Set up:        ${BOX_URL}
  Once set up:
    Till         ${BOX_URL}
    Dashboard    ${BOX_URL}/manage
    Email inbox  ${BOX_URL}/manage/email
    Print agent  http://waitron.local:9110

EOF
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 "$BOX_URL"; echo; fi
}

# Show the ready banner on stdout, and — on a headless box wired to a monitor — also on the physical
# console (/dev/tty1), so whoever is standing at the box sees the setup QR without a keyboard or SSH.
# Guarded on writability so a box with no tty1 (a container, a serial console) stays silent there.
announce_ready() {
  print_links
  if [ -w /dev/tty1 ]; then print_links >/dev/tty1 2>/dev/null || true; fi
}

# Is this box stamped production? Two signals, production from EITHER. trading.env is read from the
# state volume with a throwaway container so no database need be up; the db stamp is the box's own
# authority when the cluster is reachable.
#
# Fiscal safety (CLAUDE.md §5): a reset is irreversible, so an environment we CANNOT establish is
# treated as production and refused. Each signal ends in one of three states — a VALUE, "nothing
# there" (a read that succeeded and found the box unprovisioned — safe to wipe), or ERRORED (the
# read itself failed). We fail CLOSED only when a read ERRORED and no signal returned a value; a
# genuinely unprovisioned box (trading.env absent, stamp empty) reads cleanly and stays resettable,
# which keeps the demo workflow working. The operator overrides a false refusal with --force-production.
is_production() {
  local env_out env_rc stamp_out stamp_rc env_value="" stamp_value="" errored=0
  # trading.env from the state volume via a throwaway container. The __ABSENT__ sentinel separates an
  # absent file (an unprovisioned box — the read SUCCEEDED and found nothing) from a read that failed
  # (container/volume error — a non-zero exit): only the latter counts as "cannot establish".
  if env_out="$(docker run --rm -v waitron_state:/s "$HELPER_IMAGE" \
    sh -c '[ -e /s/trading.env ] && cat /s/trading.env || echo __ABSENT__' 2>/dev/null)"; then
    env_rc=0
  else
    env_rc=$?
  fi
  if [ "$env_rc" -ne 0 ]; then
    errored=1
  elif [ "$env_out" != "__ABSENT__" ]; then
    # A line WAITRON_ENV=<value>, parsed without a pipeline so pipefail/set -e cannot trip on it.
    local line
    while IFS= read -r line; do
      case "$line" in WAITRON_ENV=*) env_value="${line#WAITRON_ENV=}"; break ;; esac
    done <<<"$env_out"
  fi
  [ "$env_value" = "production" ] && return 0

  # The deployment stamp lives in the app database, named `waitron` (node-entry.ts DATABASE), NOT the
  # default `postgres` db — so `-d waitron` is required or the query errors. pipefail makes the
  # pipeline's exit the psql exit, so a db that is down is a non-zero rc here, not a silent empty read.
  if stamp_out="$(docker compose -f "$WAITRON_DIR/compose.yml" exec -T db psql -U postgres -d waitron -tAc \
    'select environment from deployment where id = 1' 2>/dev/null | tr -d '[:space:]')"; then
    stamp_rc=0
  else
    stamp_rc=$?
  fi
  if [ "$stamp_rc" -ne 0 ]; then
    errored=1
  else
    stamp_value="$stamp_out"
  fi
  [ "$stamp_value" = "production" ] && return 0

  # Cannot establish the environment: a read errored AND nothing positively returned a value. Fail
  # closed — refuse as if production.
  if [ "$errored" -eq 1 ] && [ -z "$env_value" ] && [ -z "$stamp_value" ]; then
    return 0
  fi
  return 1
}

# ~3 minutes for the app container to report healthy (setup mode is healthy on /setup-api/status).
# WAITRON_SH_MAX_HEALTH_TRIES overrides the try count for tests, which otherwise wait 3 minutes.
wait_healthy() {
  local tries="${WAITRON_SH_MAX_HEALTH_TRIES:-36}"
  while [ "$tries" -gt 0 ]; do
    # -qx matches the WHOLE line: `.Health` prints one status word, and a bare `grep healthy` would
    # also match "unhealthy" (it contains the substring) and report a failed container as ready.
    if docker compose -f "$WAITRON_DIR/compose.yml" ps --format '{{.Health}}' app 2>/dev/null | grep -qx healthy; then
      return 0
    fi
    tries=$((tries - 1)); [ "$tries" -gt 0 ] && sleep 5
  done
  return 1
}

# A box that never came up healthy: show the last app log lines. database_ahead advice is scoped to
# the box — never tell a production box to reset, since that would destroy the fiscal ledger.
report_unhealthy() {
  local logs
  logs="$(docker compose -f "$WAITRON_DIR/compose.yml" logs --tail 40 app 2>&1 || true)"
  printf '%s\n' "$logs" >&2
  if printf '%s' "$logs" | grep -q 'provisioning.database_ahead'; then
    if is_production; then
      die "the database is newer than this image. On a box with real records install a NEWER ref — do NOT reset, it would destroy the fiscal ledger."
    fi
    die "the database is newer than this image (provisioning.database_ahead). Run 'waitron.sh reset' then install again."
  fi
  die "the box did not come up healthy — see the log lines above"
}

cmd_install() {
  local ref="${1:-main}"
  ensure_docker
  mkdir -p "$WAITRON_DIR" || die "cannot create $WAITRON_DIR — run as root, or set WAITRON_DIR to a writable path"
  ensure_env_password
  fetch_box_files "$ref"
  select_image "$ref"
  cd "$WAITRON_DIR"
  docker compose up -d
  if wait_healthy; then announce_ready; else report_unhealthy; fi
}

# Remove a named volume only if it exists; a removal that FAILS aborts the whole reset (see the loop
# below) rather than silently continuing. A volume that is already absent is a no-op, not a failure.
rm_volume() {
  local name="$1"
  docker volume inspect "$name" >/dev/null 2>&1 || return 0
  docker volume rm -f "$name" >/dev/null 2>&1 \
    || die "could not remove volume $name — stopping the reset so the box is not left half-wiped"
}

cmd_reset() {
  local all=0 yes=0 force_prod=0 a ans
  for a in "$@"; do
    case "$a" in
      --all) all=1 ;;
      --yes) yes=1 ;;
      --force-production) force_prod=1 ;;
      *) die "reset: unknown option '$a'" 2 ;;
    esac
  done
  [ -f "$WAITRON_DIR/compose.yml" ] || die "no box at $WAITRON_DIR — run 'waitron.sh install' first"

  if is_production; then
    [ "$force_prod" -eq 1 ] || die "refusing to reset: this box is PRODUCTION, or its environment could not be read and is treated the same way for safety. It may hold real fiscal records that cannot be recreated, and a reset would cut the AEAT chain. Recover a broken production box from a backup. If you are sure this box is not production, re-run with --force-production."
    if [ -t 0 ]; then
      printf 'waitron.sh: type "production" to wipe this PRODUCTION box: ' >&2
      read -r ans; [ "$ans" = "production" ] || die "not confirmed — nothing wiped"
    fi
  elif [ "$yes" -ne 1 ]; then
    [ -t 0 ] || die "reset needs confirmation — re-run with --yes for a non-interactive box"
    printf 'waitron.sh: type "reset" to wipe this box: ' >&2
    read -r ans; [ "$ans" = "reset" ] || die "not confirmed — nothing wiped"
  fi

  cd "$WAITRON_DIR"
  docker compose down
  # db is removed FIRST and a failed removal ABORTS the reset before backups or state are touched, so
  # a box whose database cannot be wiped is never left half-wiped and restarted against surviving data
  # with its secrets already gone. A volume that is already absent is not a failure.
  local v
  for v in db logs media backups mailpit print_agent; do
    rm_volume "waitron_${v}"
  done
  if [ "$all" -eq 1 ]; then
    rm_volume waitron_state
  else
    # Empty state except tls/, keeping the CA + leaf so an already-trusting phone needs no new step.
    docker run --rm -v waitron_state:/s "$HELPER_IMAGE" \
      find /s -mindepth 1 -maxdepth 1 ! -name tls -exec rm -rf {} +
  fi
  docker compose up -d
  if wait_healthy; then announce_ready; else report_unhealthy; fi
}

main() {
  local verb="${1:-}"
  case "$verb" in
    install) shift; cmd_install "$@" ;;
    reset)   shift; cmd_reset "$@" ;;
    ""|-h|--help) usage ;;
    *) die "unknown command '$verb'" 2 ;;
  esac
}

main "$@"
