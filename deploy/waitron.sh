#!/usr/bin/env bash
#
# One command to run a Waitron box: install/upgrade it, or reset it to a clean state.
#
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
#   sudo bash waitron.sh install            # published main image
#   sudo bash waitron.sh install <ref>      # build and run a branch or commit on the box
#   sudo bash waitron.sh reset [--all]      # wipe back to a clean box (keeps the certificate)
#   sudo bash waitron.sh --reset install [ref]   # build or pull the ref's images, wipe the box, start it on them
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

die() { echo "waitron.sh: $1" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'USAGE'
waitron.sh: usage:
  waitron.sh install [ref]     install or upgrade the box (ref defaults to main)
  waitron.sh reset [--all]     wipe the box to a clean state (keeps the certificate; --all drops it too)
  waitron.sh --reset [--all] [--yes] [--force-production] install [ref]
                               build or pull ref's images, then wipe the box as reset does and start it
                               on them
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
# Each attempt is cut off and tried three times, because apt's own timeouts do not end every stall:
# docs/developers/ci-and-gates.md, "Every apt wait is bounded". An install gets longer than an update
# because Docker's packages are large enough that a slow box link can take more than 300 s to fetch.
apt_get() {
  local limit seconds=1800 attempt
  limit="$(command -v gtimeout || command -v timeout)" || die "need timeout (GNU coreutils) to bound apt-get — install coreutils and re-run"
  [ "${1:-}" = update ] && seconds=300
  for attempt in 1 2 3; do
    as_root "$limit" "$seconds" env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 \
      -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 "$@" && return 0
    echo "waitron.sh: attempt $attempt of 3 failed or stalled: apt-get $*" >&2
  done
  die "apt-get $* failed or stalled on all three attempts"
}

RESET_BEFORE_INSTALL=0 RESET_ALL=0 RESET_YES=0 RESET_FORCE=0
# The arguments as given, so the copy refresh_self hands over to gets every option too.
WAITRON_ARGV=()
# refresh_self looks for this exact line in a ref's waitron.sh before handing it --reset: a copy
# without it predates --reset install and cannot run it. Keep it.
RESET_INSTALL_SUPPORTED=1

# 0. This script, from the INSTALLED ref like compose.yml, so a fix to install's own steps runs on the
#    install that fetches it. The new copy is moved into place and run, never written over this one:
#    bash reads a script as it runs it. WAITRON_SH_REFRESHED stops the new copy fetching again.
refresh_self() {
  local ref="$1" self="${BASH_SOURCE[0]:-}" target dir up tmp status=0
  [ -z "${WAITRON_SH_REFRESHED:-}" ] || return 0
  if [ ! -f "$self" ]; then
    echo "waitron.sh: not running from a file, so no copy of waitron.sh to update from ${ref}" >&2
    return 0
  fi
  if [ -L "$self" ]; then
    if ! target="$(readlink -f "$self")"; then
      echo "waitron.sh: could not follow the link $self — carrying on with this copy, not ${ref}'s" >&2
      return 0
    fi
    self="$target"
  fi
  if ! dir="$(cd "$(dirname "$self")" && pwd -P)"; then
    echo "waitron.sh: could not find the folder $self is in — carrying on with this copy, not ${ref}'s" >&2
    return 0
  fi
  while :; do
    if [ -e "$dir/.git" ]; then
      echo "waitron.sh: running from a git checkout, so not replacing $self with ${ref}'s waitron.sh" >&2
      return 0
    fi
    up="$(dirname "$dir")"
    [ "$up" != "$dir" ] || break
    dir="$up"
  done
  if ! tmp="$(mktemp "$(dirname "$self")/.waitron.sh.XXXXXX")"; then
    echo "waitron.sh: could not create a temp file beside $self — carrying on with this copy, not ${ref}'s" >&2
    return 0
  fi
  # cp -p gives the temp file this script's mode and, run as root, its owner and group; the fetch
  # then writes into that temp file rather than replacing it, so they survive the rename.
  if ! cp -p "$self" "$tmp"; then
    rm -f "$tmp"
    echo "waitron.sh: could not copy $self to a temp file beside it — carrying on with this copy, not ${ref}'s" >&2
    return 0
  fi
  # A subshell, because the fetch that finds neither curl nor wget exits rather than returning.
  if ! (fetch "${RAW_BASE}/${ref}/deploy/waitron.sh" "$tmp"); then
    rm -f "$tmp"
    echo "waitron.sh: could not fetch waitron.sh from ${ref} — carrying on with this copy" >&2
    return 0
  fi
  # cmp exits 0 when the same, 1 when different, and above 1 when it could not compare.
  cmp -s "$tmp" "$self" || status=$?
  if [ "$status" -ne 1 ]; then
    rm -f "$tmp"
    if [ "$status" -ne 0 ]; then
      echo "waitron.sh: could not compare $self with ${ref}'s waitron.sh — carrying on with this copy" >&2
    fi
    return 0
  fi
  if [ "$RESET_BEFORE_INSTALL" -eq 1 ] && ! grep -q '^RESET_INSTALL_SUPPORTED=1$' "$tmp"; then
    rm -f "$tmp"
    die "${ref}'s waitron.sh predates --reset install, so nothing was changed: run 'waitron.sh reset', then 'waitron.sh install ${ref}'"
  fi
  if ! mv -f "$tmp" "$self"; then
    rm -f "$tmp"
    echo "waitron.sh: could not replace $self with ${ref}'s waitron.sh — carrying on with this copy" >&2
    return 0
  fi
  echo "waitron.sh: updated $self to ${ref}'s waitron.sh; running install again from it"
  WAITRON_SH_REFRESHED=1 exec "$BASH" "$self" "${WAITRON_ARGV[@]}"
}

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

# .env line editing: set/replace or remove a KEY, preserving 0600 and never touching other lines. It
# CREATES .env when there is none, which is now the normal first install — the box has no pre-boot
# secret, so a plain `install` writes only WAITRON_PRINT_AGENT_APPARMOR, and only on a box where it
# loaded that profile (load_print_agent_apparmor); a branch install adds the image pins.
# The rewrite is ATOMIC — the new content is built in a temp file BESIDE .env and renamed onto it only
# after the write fully succeeds. It never truncates .env in place: a write that failed mid-way there
# would empty the file and lose whichever image the box is pinned to, after which a bare
# `docker compose up -d` moves it onto the published :main with nothing reported anywhere.
# `grep -v` exits 1 when it drops every line, which `set -e` would abort on — hence `|| true`.
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

# 2. compose.yml + .env.example always from the INSTALLED ref, so compose and the image share a
#    commit. Overwrites an operator's compose edits (rare); the choice is stated aloud.
fetch_box_files() {
  local ref="$1"
  fetch "${RAW_BASE}/${ref}/deploy/compose.yml" "$WAITRON_DIR/compose.yml"
  fetch "${RAW_BASE}/${ref}/deploy/.env.example" "$WAITRON_DIR/.env.example"
  echo "waitron.sh: wrote compose.yml from ${ref} (any local compose.yml edits were overwritten)"
}

# 2b. The print agent's AppArmor profile, from the INSTALLED ref like compose.yml. Docker's default
#     profile keeps the agent off the system bus, so bluetoothctl cannot reach BlueZ; this one allows
#     the bus messages bluetoothctl's listing, scan, pairing and remove send. .env names the profile
#     only once apparmor_parser has loaded it, because Docker refuses to start a container that names
#     a profile the host has not loaded — compose then falls back to docker-default rather than
#     leaving the agent down. Written into /etc/apparmor.d so the boot-time apparmor.service loads it
#     again: on the owner's box, 2026-09-29, after a restart `.env` still named it and
#     `bluetoothctl list` in the agent still reached BlueZ.
PRINT_AGENT_PROFILE=/etc/apparmor.d/waitron-print-agent
load_print_agent_apparmor() {
  local ref="$1" tmp
  if ! aa-enabled --quiet 2>/dev/null; then
    env_unset WAITRON_PRINT_AGENT_APPARMOR
    return 0
  fi
  tmp="$(mktemp "$WAITRON_DIR/waitron-print-agent.XXXXXX")" || die "could not create a temp file in $WAITRON_DIR"
  if fetch "${RAW_BASE}/${ref}/deploy/apparmor/waitron-print-agent" "$tmp" \
    && as_root install -m 0644 "$tmp" "$PRINT_AGENT_PROFILE" \
    && as_root apparmor_parser -r "$PRINT_AGENT_PROFILE"; then
    env_set WAITRON_PRINT_AGENT_APPARMOR waitron-print-agent
    echo "waitron.sh: loaded the print agent's AppArmor profile"
  else
    env_unset WAITRON_PRINT_AGENT_APPARMOR
    echo "waitron.sh: could not load the print agent's AppArmor profile — it runs under Docker's default profile, which keeps it from Bluetooth printers" >&2
  fi
  rm -f "$tmp"
}

# 2c. On the owner's box (BlueZ 5.82, 2026-09-29) bluetoothd's autopair plugin answered a PIN-1234
#     printer's PIN request with 0000 before any agent was asked; bluetoothd's retry then went over
#     Low Energy, which that printer refuses, so it never paired. With the plugin off the agent was
#     asked and the printer bonded. The plugin does this for a device whose class marks it as a
#     printer (read in plugins/autopair.c, BlueZ 5.82). This drop-in re-runs the unit's own
#     ExecStart with the plugin off. Bluetooth is restarted only when the drop-in changed, and a
#     failure never stops the install. It reads ExecStart from the unit file alone, so writing ours
#     beside another drop-in that sets ExecStart could discard that drop-in's command; then nothing
#     is changed, not even a drop-in of ours already there.
# WAITRON_SH_BLUETOOTH_DROPIN is a test override: scripts/waitron-sh.test.mjs points it inside each
# case's own directory, so no test can see the shipped path — it is pinned as text by
# scripts/deploy-image-env.test.ts instead.
BLUETOOTH_DROPIN="${WAITRON_SH_BLUETOOTH_DROPIN:-/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf}"
disable_bluetooth_autopair() {
  local unit exec_start tmp dropins dropin other="" unreadable=""
  unit="$(systemctl show -p FragmentPath --value bluetooth.service 2>/dev/null || true)"
  if [ -z "$unit" ] || [ ! -r "$unit" ]; then
    echo "waitron.sh: no bluetooth.service on this host — Bluetooth pairing left as it is"
    return 0
  fi
  read -ra dropins <<< "$(systemctl show -p DropInPaths --value bluetooth.service 2>/dev/null || true)"
  for dropin in ${dropins[@]+"${dropins[@]}"}; do
    [ "$dropin" = "$BLUETOOTH_DROPIN" ] && continue
    if [ ! -r "$dropin" ]; then
      other="$dropin" unreadable=1
      break
    fi
    if grep -Eq '^[[:space:]]*ExecStart[[:space:]]*=' "$dropin" 2>/dev/null; then
      other="$dropin"
      break
    fi
  done
  if [ -n "$other" ]; then
    if [ -f "$BLUETOOTH_DROPIN" ] && [ -n "$unreadable" ]; then
      echo "waitron.sh: left Bluetooth as it is — $other could not be read and may set bluetooth.service's ExecStart, and $BLUETOOTH_DROPIN from an earlier install is still there, so which command bluetoothd runs may depend on both files ('systemctl cat bluetooth' shows them); to keep only $other's command, delete $BLUETOOTH_DROPIN, then run 'systemctl daemon-reload' and 'systemctl restart bluetooth'" >&2
    elif [ -f "$BLUETOOTH_DROPIN" ]; then
      echo "waitron.sh: left Bluetooth as it is — $other also sets bluetooth.service's ExecStart, and $BLUETOOTH_DROPIN from an earlier install is still there, so which command bluetoothd runs depends on both files ('systemctl cat bluetooth' shows them); to keep only $other's command, delete $BLUETOOTH_DROPIN, then run 'systemctl daemon-reload' and 'systemctl restart bluetooth'" >&2
    elif [ -n "$unreadable" ]; then
      echo "waitron.sh: could not switch off bluetoothd's autopair plugin — could not read $other, which may set bluetooth.service's ExecStart; left as it is" >&2
    else
      echo "waitron.sh: could not switch off bluetoothd's autopair plugin — $other also sets bluetooth.service's ExecStart; left as it is" >&2
    fi
    return 0
  fi
  exec_start="$(sed -nE 's/^[[:space:]]*ExecStart[[:space:]]*=[[:space:]]*//p' "$unit" | tail -n 1)"
  if [ -z "$exec_start" ]; then
    echo "waitron.sh: could not switch off bluetoothd's autopair plugin — $unit names no ExecStart" >&2
    return 0
  fi
  case " $exec_start" in
    *" --noplugin"* | *" -P"*)
      echo "waitron.sh: could not switch off bluetoothd's autopair plugin — bluetooth.service already chooses its plugins ($exec_start); left as it is" >&2
      return 0 ;;
  esac
  if ! tmp="$(mktemp "$WAITRON_DIR/waitron-noautopair.XXXXXX")"; then
    echo "waitron.sh: could not switch off bluetoothd's autopair plugin — could not create a temp file in $WAITRON_DIR" >&2
    return 0
  fi
  printf '%s\n' \
    "# Written by waitron.sh install: bluetoothd's autopair plugin answers 0000 to the first PIN" \
    "# request of a device whose class marks it as a printer, before the print agent is asked." \
    "[Service]" \
    "ExecStart=" \
    "ExecStart=$exec_start --noplugin=autopair" > "$tmp"
  if [ -f "$BLUETOOTH_DROPIN" ] && cmp -s "$tmp" "$BLUETOOTH_DROPIN"; then
    rm -f "$tmp"
    return 0
  fi
  if as_root install -d -m 0755 "$(dirname "$BLUETOOTH_DROPIN")" \
    && as_root install -m 0644 "$tmp" "$BLUETOOTH_DROPIN" \
    && as_root systemctl daemon-reload \
    && as_root systemctl restart bluetooth; then
    echo "waitron.sh: switched off bluetoothd's autopair plugin, so a Bluetooth printer's PIN comes from the operator"
  else
    # Runs whether the failure came before or after the drop-in was written. Removes whatever
    # drop-in is at that path, an older, different one included, then reloads and restarts
    # Bluetooth without it, so the next install finds none and tries again.
    as_root rm -f "$BLUETOOTH_DROPIN" || true
    if ! { as_root systemctl daemon-reload && as_root systemctl restart bluetooth; }; then
      echo "waitron.sh: Bluetooth did not restart after the autopair drop-in was removed, so Bluetooth may be stopped — run 'systemctl restart bluetooth' or restart the box" >&2
    fi
    echo "waitron.sh: could not switch off bluetoothd's autopair plugin — a Bluetooth printer whose PIN is not 0000 may not pair; the next install tries again" >&2
  fi
  rm -f "$tmp"
}

# 3. main pulls every image in compose.yml and records no override; a branch/commit builds both
#    Waitron images on the box from the git context and records the tags in .env so the box stays
#    on them.
select_image() {
  local ref="$1"
  if [ "$ref" = "main" ]; then
    env_unset WAITRON_IMAGE
    env_unset WAITRON_PRINT_AGENT_IMAGE
    docker compose -f "$WAITRON_DIR/compose.yml" pull \
      || die "could not pull the box's images: check the network and that the image registries (GHCR, Docker Hub) are reachable, or whether an image is published for this machine's architecture ($(uname -m))"
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

# Under --reset the box is wiped before `up`, so any image `up` would pull is fetched first: a branch
# install builds only Waitron's own two, and a pull that failed after the wipe would leave a wiped box
# that does not start.
ensure_images_present() {
  local ref="$1" images img
  local state="nothing was taken down or wiped, but the box's compose.yml and .env are already set for ${ref}"
  images="$(docker compose -f "$WAITRON_DIR/compose.yml" config --images)" \
    || die "could not list the images compose.yml names — ${state}; re-run this command"
  while IFS= read -r img; do
    [ -n "$img" ] || continue
    docker image inspect "$img" >/dev/null 2>&1 </dev/null && continue
    docker pull "$img" </dev/null \
      || die "could not pull $img, which the box needs — ${state}; check the network and re-run this command"
  done <<<"$images"
}

# The whole console instruction after a box comes up: where to go, plus the QR of the setup URL.
print_links() {
  cat <<EOF

  Waitron is ready.

  Start here:    http://waitron.local/setup/trust
  Secure help:   ${BOX_URL}/setup/trust
  If HTTP is unavailable or you use an operator-supplied certificate, use Secure help.
  Install this box's certificate before entering setup details.
  On a box serving its own certificate, the guide's first step removes any old one.
  Once set up:
    Till         ${BOX_URL}
    Dashboard    ${BOX_URL}/manage
    Email inbox  ${BOX_URL}/manage/email

EOF
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 "http://waitron.local/setup/trust"; echo; fi
}

# Show the ready banner on stdout, and — on a headless box wired to a monitor — also on the physical
# console (/dev/tty1), so whoever is standing at the box sees the setup QR without a keyboard or SSH.
# Guarded on writability so a box with no tty1 (a container, a serial console) stays silent there.
announce_ready() {
  print_links
  if [ -w /dev/tty1 ]; then print_links >/dev/tty1 2>/dev/null || true; fi
}

# Reads the deployment stamp out of the venue database. It runs inside the app image, which carries
# both the node that has node:sqlite and, as that compose service, the state volume; it resolves the
# venue directory from the same two variables `apps/server/src/config.ts` resolves `venueDir` from,
# so a box whose server was pointed elsewhere is read where that server writes.
#
# Three answers, because is_production needs three. The environment on stdout; nothing at all, exit
# 0, when there is no venue file, no deployment TABLE, or no stamp row — a read that SUCCEEDED and
# found nothing, and a box with no records to protect; and a non-zero exit for everything else, which
# is_production treats as "cannot establish" and fails closed on. Where config.ts falls back to a
# state root boot computed, this has none to fall back to, so an unset directory is REFUSED: joining
# onto an empty string would read a relative path under the container's working directory, find
# nothing, and report a clean box.
#
# The table is probed through sqlite_master BEFORE the stamp row is selected, for the reason
# `packages/db/src/deployment.ts` gives at `deploymentTableExists`: the file exists long before the
# table does. `openVenueStore` creates `venue.db` on any open and the server opens the venue
# directory for its own stamp probe before it runs migrations, so a box that booted and then failed
# sits with the file present and the table absent — and that is exactly the box being reset. Without
# the probe the select raises `no such table: deployment` and reset is refused as production on a box
# that was never provisioned.
#
# scripts/waitron-sh.test.mjs extracts this text and RUNS it against real databases — the docker stub
# answers for it everywhere else, so nothing else in that suite can see whether it reads a file right.
VENUE_STAMP_JS='
const { DatabaseSync } = require("node:sqlite");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const state = process.env.WAITRON_STATE_DIR;
const dir = process.env.WAITRON_VENUE_DIR || (state ? join(state, "venue") : "");
if (!dir) throw new Error("neither WAITRON_VENUE_DIR nor WAITRON_STATE_DIR is set");
const file = join(dir, "venue.db");
if (!existsSync(file)) process.exit(0);
const db = new DatabaseSync(file, { readOnly: true });
const present = db.prepare("select name from sqlite_master where type = ? and name = ?").get("table", "deployment");
if (!present) process.exit(0);
const row = db.prepare("select environment from deployment where id = 1").get();
if (row && row.environment) process.stdout.write(String(row.environment));
'

# Is this box stamped production? Two signals, production from EITHER. trading.env is read from the
# state volume with a throwaway container; the deployment stamp is read from the venue database on
# that same volume, by a container built from the app image. Neither needs the box to be running,
# which matters because the box being reset is often one that will not come up.
#
# Fiscal safety (CLAUDE.md §5): a reset is irreversible, so an environment we CANNOT establish is
# treated as production and refused. Each signal ends in one of three states — a VALUE, "nothing
# there" (a read that succeeded and found the box unprovisioned — safe to wipe), or ERRORED (the
# read itself failed). We fail CLOSED only when a read ERRORED and no signal returned a value; a
# genuinely unprovisioned box (trading.env absent, stamp empty or its table not created yet) reads
# cleanly and stays resettable, which keeps the demo workflow working. The operator overrides a false
# refusal with --force-production.
is_production() {
  local env_out env_rc stamp_out stamp_rc env_value="" stamp_value="" errored=0
  # trading.env from the state volume, read by a throwaway container built from the APP image — the
  # same shape as the stamp read below: `docker compose run`, so the image is whichever one .env
  # selects and the volume arrives where compose mounts it. `--entrypoint sh` is not decoration. This
  # image's ENTRYPOINT is `node /app/node-entry.js`, and `run` APPENDS its arguments to an entrypoint
  # it was not told to replace, so without the override the container exits non-zero (the
  # entrypoint refuses arguments, server.entry_arguments_refused), which lands here as "cannot
  # establish" and refuses every reset as production. Receipt: the entrypoint case in
  # scripts/waitron-sh.test.mjs. The state directory
  # comes from the image's own WAITRON_STATE_DIR, and `:?` REFUSES an unset one rather than reading
  # `/trading.env`, finding nothing and calling a live box unprovisioned. The __ABSENT__ sentinel
  # separates an absent file (an unprovisioned box — the read SUCCEEDED and found nothing) from a
  # read that failed, which exits non-zero and counts as "cannot establish". Two tests stand between
  # them, because a `cat` and a `[ -e ]` both answer "absent" when they are merely BLIND: the
  # `if`/`else` keeps a file that exists but cannot be read from falling into an `||` and reporting
  # absence with exit 0, and the `-d`/`-r`/`-x` test ahead of it does the same one level up, where
  # `[ -e "$d/trading.env" ]` cannot tell a missing file from a directory it cannot look inside. Both
  # otherwise wipe a production box without --force-production, and this image runs as a non-root
  # USER (deploy/Dockerfile), so neither is theoretical. A fresh box still resets: the image
  # pre-creates and chowns the mount path, so its state volume comes up owned by that user (measured
  # 2026-09-23, a fresh named volume over the chowned path: mode 0700, uid 10001, all three tests
  # pass). Receipts, run in both directions: the unreadable-trading.env and unreadable-state-directory
  # cases in scripts/waitron-sh.test.mjs.
  if env_out="$(docker compose -f "$WAITRON_DIR/compose.yml" run --rm --no-deps -T \
    --entrypoint sh app \
    -c 'd="${WAITRON_STATE_DIR:?}"; [ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ] || exit 1; if [ -e "$d/trading.env" ]; then cat "$d/trading.env"; else echo __ABSENT__; fi' 2>/dev/null)"; then
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

  # The deployment stamp, read from the venue database by VENUE_STAMP_JS above. `run` rather than
  # `exec`: it builds its own container from the app image, so the stamp is still readable on a box
  # whose app is down — which is the box an operator is most likely to be resetting. --no-deps keeps
  # it from starting the rest of the compose file to read a file. pipefail makes the pipeline's exit
  # the node exit, so a failed read is a non-zero rc here, not a silent empty one.
  if stamp_out="$(docker compose -f "$WAITRON_DIR/compose.yml" run --rm --no-deps -T \
    --entrypoint node app -e "$VENUE_STAMP_JS" 2>/dev/null | tr -d '[:space:]')"; then
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
# Two test overrides, because a suite cannot afford either term of that product:
# WAITRON_SH_MAX_HEALTH_TRIES cuts the try count, and WAITRON_SH_HEALTH_DELAY cuts the wait between
# tries, so a test can keep the RETRYING and still finish in seconds. The DELAY is overridden in every
# case of scripts/waitron-sh.test.mjs, so no test can see the shipped 5 — it is pinned as text by
# scripts/deploy-image-env.test.ts instead. The try count is left alone by most cases and two of them
# assert the probe count, so a typo in it fails behaviourally as well as textually.
wait_healthy() {
  local tries="${WAITRON_SH_MAX_HEALTH_TRIES:-36}"
  local delay="${WAITRON_SH_HEALTH_DELAY:-5}"
  while [ "$tries" -gt 0 ]; do
    # -qx matches the WHOLE line: `.Health` prints one status word, and a bare `grep healthy` would
    # also match "unhealthy" (it contains the substring) and report a failed container as ready.
    if docker compose -f "$WAITRON_DIR/compose.yml" ps --format '{{.Health}}' app 2>/dev/null | grep -qx healthy; then
      return 0
    fi
    tries=$((tries - 1)); [ "$tries" -gt 0 ] && sleep "$delay"
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
    die "the database is newer than this image (provisioning.database_ahead). Wipe the box and install again in one step: 'waitron.sh --reset install [ref]'"
  fi
  die "the box did not come up healthy — see the log lines above"
}

# With --reset, the production check and the confirmation run before the box's files are fetched or
# any image is built or pulled: the check reads the box with its CURRENT compose.yml and image, which
# the fetch replaces and the build or pull supersedes. refresh_self, which runs first, may already
# have replaced this script itself. The wipe waits until the new images are in place.
cmd_install() {
  local ref="${1:-main}" wipe="$RESET_BEFORE_INSTALL"
  refresh_self "$ref"
  ensure_docker
  if [ "$wipe" -eq 1 ]; then
    if [ -f "$WAITRON_DIR/compose.yml" ]; then
      confirm_reset
    else
      echo "waitron.sh: no box at $WAITRON_DIR, so nothing to reset — installing" >&2
      wipe=0
    fi
  fi
  mkdir -p "$WAITRON_DIR" || die "cannot create $WAITRON_DIR — run as root, or set WAITRON_DIR to a writable path"
  fetch_box_files "$ref"
  load_print_agent_apparmor "$ref"
  disable_bluetooth_autopair
  select_image "$ref"
  cd "$WAITRON_DIR"
  if [ "$wipe" -eq 1 ]; then
    ensure_images_present "$ref"
    wipe_box
  fi
  docker compose up -d --remove-orphans
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

reset_option() {
  case "$1" in
    --all) RESET_ALL=1 ;;
    --yes) RESET_YES=1 ;;
    --force-production) RESET_FORCE=1 ;;
    *) return 1 ;;
  esac
}

# For --reset install the options go before `install`; after it, --yes is taken as the ref or ignored.
confirm_reset() {
  local ans force="re-run with --force-production" yes="reset needs confirmation — re-run with --yes"
  if [ "$RESET_BEFORE_INSTALL" -eq 1 ]; then
    force="re-run with --force-production before install"
    yes="--reset install needs confirmation — re-run with --yes before install"
  fi
  if is_production; then
    [ "$RESET_FORCE" -eq 1 ] || die "refusing to reset: this box is PRODUCTION, or its environment could not be read and is treated the same way for safety. It may hold real fiscal records that cannot be recreated, and a reset would cut the AEAT chain. Recover a broken production box from a backup. If you are sure this box is not production, ${force}."
    if [ -t 0 ]; then
      printf 'waitron.sh: type "production" to wipe this PRODUCTION box: ' >&2
      read -r ans; [ "$ans" = "production" ] || die "not confirmed — nothing wiped"
    fi
  elif [ "$RESET_YES" -ne 1 ]; then
    [ -t 0 ] || die "${yes} for a non-interactive box"
    printf 'waitron.sh: type "reset" to wipe this box: ' >&2
    read -r ans; [ "$ans" = "reset" ] || die "not confirmed — nothing wiped"
  fi
}

# Run from $WAITRON_DIR. Leaves the box down; the caller starts it.
wipe_box() {
  docker compose down --remove-orphans
  # A failed removal ABORTS the reset before the volumes further down this loop or state are touched,
  # so a box whose wipe half-failed is never restarted against surviving data with its settings
  # already gone. logs is simply first; nothing depends on the order beyond that. A volume that is
  # already absent is not a failure. `waitron_db` is deliberately absent from the list: the box runs
  # no database server, and the volume one used to fill is left on disk rather than removed here (no
  # backwards-compatibility code before production, CLAUDE.md §3).
  local v
  for v in logs backups mailpit print_agent; do
    rm_volume "waitron_${v}"
  done
  if [ "$RESET_ALL" -eq 1 ]; then
    rm_volume waitron_state
  else
    # Empty state except tls/, keeping the CA + leaf so an already-trusting phone needs no new step.
    # Same container shape as the trading.env read above, and `--entrypoint` for the same reason.
    docker compose -f "$WAITRON_DIR/compose.yml" run --rm --no-deps -T \
      --entrypoint sh app \
      -c 'find "${WAITRON_STATE_DIR:?}" -mindepth 1 -maxdepth 1 ! -name tls -exec rm -rf {} +'
  fi
}

cmd_reset() {
  local a
  for a in "$@"; do
    reset_option "$a" || die "reset: unknown option '$a'" 2
  done
  [ -f "$WAITRON_DIR/compose.yml" ] || die "no box at $WAITRON_DIR — run 'waitron.sh install' first"
  confirm_reset
  cd "$WAITRON_DIR"
  wipe_box
  docker compose up -d --remove-orphans
  if wait_healthy; then announce_ready; else report_unhealthy; fi
}

main() {
  local first=""
  WAITRON_ARGV=("$@")
  while [ $# -gt 0 ]; do
    case "$1" in
      --reset) RESET_BEFORE_INSTALL=1 ;;
      -h | --help) break ;;
      -*) reset_option "$1" || die "unknown option '$1'" 2 ;;
      *) break ;;
    esac
    first="${first:-$1}"
    shift
  done
  local verb="${1:-}"
  case "$verb" in
    install | reset | "" | -h | --help) ;;
    *) die "unknown command '$verb'" 2 ;;
  esac
  if [ -n "$first" ]; then
    [ "$RESET_BEFORE_INSTALL" -eq 1 ] \
      || die "$first goes with --reset: 'waitron.sh --reset $first install [ref]', or 'waitron.sh reset $first'" 2
    [ "$verb" = "install" ] || die "--reset goes only with install: 'waitron.sh --reset install [ref]'" 2
  fi
  case "$verb" in
    install) shift; cmd_install "$@" ;;
    reset)   shift; cmd_reset "$@" ;;
    *) usage ;;
  esac
}

main "$@"
