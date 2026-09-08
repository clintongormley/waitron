#!/usr/bin/env bash
#
# One-time preparation of a Waitron box. Run ONCE by whoever prepares the box — a person at a
# terminal, or the bootable installer running it unattended — and NEVER by the restaurant.
#
# Non-interactive and idempotent: every step is a no-op when it is already done, so a re-run after a
# half-finished attempt finishes the job instead of starting a second one. Nothing here prompts, so
# escalation uses `sudo -n`: an installer with no terminal can never answer a password prompt.
#
# Exit 2 means "this distro is not one I can install Docker on" — the installer spec picks the
# distro, so that is a wiring mistake, not a runtime failure.
set -euo pipefail

WAITRON_DIR="${WAITRON_DIR:-/opt/waitron}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOX_URL="https://waitron.local"

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

# apt, never interactive. DEBIAN_FRONTEND is passed on the command rather than exported, because
# sudo's default env_reset DISCARDS an exported one (measured in a debian:trixie container, with a
# control) — and the path that goes through sudo is exactly the unattended one: a non-root user with
# passwordless sudo, where needrestart is a known prompter.
apt_get() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get "$@"
}

# The banner is written twice: to this script's stdout for whoever ran it, and to the console when a
# monitor happens to be attached. A headless box needs neither — the phone is the screen.
say_ready() {
  printf '\n  Waitron is ready — open %s on your phone\n\n' "$BOX_URL"
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ANSIUTF8 "$BOX_URL"
    printf '\n'
  fi
}

printf 'Installing…\n'

# 1. Docker Engine + the compose plugin. `docker compose version` is the test rather than
#    `command -v docker`, because the v1 `docker-compose` binary cannot run this compose file.
if ! docker compose version >/dev/null 2>&1; then
  if [ ! -r /etc/os-release ]; then
    echo "prepare.sh: no /etc/os-release — install Docker Engine and the compose plugin first" >&2
    exit 2
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case " ${ID:-} ${ID_LIKE:-} " in
    *" ubuntu "*) docker_distro=ubuntu ;;
    *" debian "*) docker_distro=debian ;;
    *)
      echo "prepare.sh: Docker is missing and ${ID:-this distro} is not Debian or Ubuntu — install it first" >&2
      exit 2
      ;;
  esac
  codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
  if [ -z "$codename" ]; then
    echo "prepare.sh: /etc/os-release names no VERSION_CODENAME — install Docker Engine first" >&2
    exit 2
  fi
  apt_get update
  apt_get install -y --no-install-recommends ca-certificates curl
  as_root install -m 0755 -d /etc/apt/keyrings
  as_root curl -fsSL "https://download.docker.com/linux/${docker_distro}/gpg" \
    -o /etc/apt/keyrings/docker.asc
  as_root chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$docker_distro" "$codename" |
    as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt_get update
  apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# The QR is the whole of the console instruction, so it is installed wherever apt exists — including
# on a box that already had Docker and so skipped the block above.
if ! command -v qrencode >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  apt_get install -y --no-install-recommends qrencode
fi

# 2. The daemon must come back on every boot of the box: Docker's restart policy is what restores
#    the containers, and it only runs if the daemon does.
if command -v systemctl >/dev/null 2>&1; then
  as_root systemctl enable --now docker
fi

# 3. The box's own copy of the compose file and its environment. Existing files are left alone: a
#    re-run must not overwrite an operator's edits, and must never mint a second POSTGRES_PASSWORD —
#    the cluster keeps the first one, so a regenerated .env locks the app out of its own database.
if ! mkdir -p "$WAITRON_DIR" 2>/dev/null; then
  echo "prepare.sh: cannot create $WAITRON_DIR — run as root, or set WAITRON_DIR to a writable path" >&2
  exit 1
fi
[ -f "$WAITRON_DIR/compose.yml" ] || cp "$SOURCE_DIR/compose.yml" "$WAITRON_DIR/compose.yml"
[ -f "$WAITRON_DIR/.env.example" ] || cp "$SOURCE_DIR/.env.example" "$WAITRON_DIR/.env.example"
if [ ! -f "$WAITRON_DIR/.env" ]; then
  # Generated, never printed and never echoed back: it is the only secret a box holds before its
  # first boot. Checked BEFORE the write, because a failed generator that still created the file
  # would leave an empty password behind — and the guard above then skips regeneration for ever,
  # which is the permanently-stuck box this whole block exists to avoid. Written under umask 077 in
  # a subshell so the mask does not leak to the rest.
  secret="$(openssl rand -hex 32 2>/dev/null || true)"
  if [ -z "$secret" ]; then
    echo "prepare.sh: could not generate POSTGRES_PASSWORD — is openssl installed?" >&2
    exit 1
  fi
  (
    umask 077
    printf 'POSTGRES_PASSWORD=%s\n' "$secret" >"$WAITRON_DIR/.env"
  )
  unset secret
fi

# 4. Pull and start. `--ignore-pull-failures` so a locally built image (WAITRON_IMAGE=waitron:dev)
#    with no registry behind it is not a fatal step; a genuinely missing image still fails loudly at
#    `up` below.
cd "$WAITRON_DIR"
docker compose pull --ignore-pull-failures
docker compose up -d

# 5. `waitron.local` resolves only once the app is serving, so the honest instruction is "open it on
#    your phone; if it doesn't load, wait a minute".
say_ready
if [ -w /dev/tty1 ]; then
  say_ready >/dev/tty1
fi
