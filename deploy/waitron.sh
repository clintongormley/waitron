#!/usr/bin/env bash
#
# One command to run a Waitron box: install/upgrade it, or reset it to a clean state.
#
#   curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
#   sudo bash waitron.sh install            # published main image
#   sudo bash waitron.sh install <ref>      # build and run a branch or commit on the box
#   sudo bash /opt/waitron-host/waitron.sh install v1.2.3  # check and run a signed release
#   sudo bash waitron.sh reset [--all]      # wipe back to a clean box (keeps the certificate unless the box joined another, the start-again records and the files a Move set aside)
#   sudo bash waitron.sh --reset install [ref]   # build or pull the ref's images, wipe the box, start it on them
#
# Operating this file is deploy/README.md. It replaces the old install.sh / prepare.sh /
# try-branch.sh trio; scripts/deploy-image-env.test.ts and scripts/waitron-sh.test.mjs pin it.
set -euo pipefail

WAITRON_DIR="${WAITRON_DIR:-/opt/waitron}"
WAITRON_HOST_DIR="${WAITRON_HOST_DIR:-/opt/waitron-host}"
# As Compose names it: the project (compose.yml's `name: waitron`, or COMPOSE_PROJECT_NAME from the
# environment), then compose.yml's `state` volume key.
STATE_VOLUME="${COMPOSE_PROJECT_NAME:-waitron}_state"
# The public repo, written out in full (not via a variable) so scripts/deploy-image-env.test.ts can
# pin the literal URL as text — a typo in the org/repo then fails the guard loudly.
RAW_BASE="https://raw.githubusercontent.com/clintongormley/waitron"
APP_IMAGE_REPO="ghcr.io/clintongormley/waitron"
PRINT_AGENT_IMAGE_REPO="ghcr.io/clintongormley/waitron-print-agent"
TUNNEL_IMAGE_REPO="ghcr.io/clintongormley/waitron-tunnel"
RELEASE_TRUST="$WAITRON_HOST_DIR/release-trust"
HOST_NODE="$WAITRON_HOST_DIR/node-v26.7.0/bin/node"
# One copy of box-name.ts's BOX_HOSTNAME, pinned by scripts/deploy-image-env.test.ts to the image env,
# compose's defaults and the QR the restaurant scans.
BOX_URL="https://waitron.local"

die() { echo "waitron.sh: $1" >&2; exit "${2:-1}"; }

usage() {
  cat >&2 <<'USAGE'
waitron.sh: usage:
  waitron.sh install [ref]     install or upgrade the box (ref defaults to main)
  waitron.sh update [ref]      same as install
  waitron.sh status            show each running Waitron image and its build time
  waitron.sh check-upgrade-offer  check which signed release is offered to this box
  waitron.sh install-offered-upgrade  apply the signed offer during the quiet window
  waitron.sh restore           restore the intact copy from a held manual upgrade
  waitron.sh keep              start the candidate despite its failed checks
  waitron.sh reset [--all]     wipe the box to a clean state (keeps the certificate unless the box
                               joined another, the start-again records and the files a Move set
                               aside; --all drops them too)
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
# apt's output goes to standard error, so a caller that captures a function's value never captures it.
apt_get() {
  local limit seconds=1800 attempt
  limit="$(command -v gtimeout || command -v timeout)" || die "need timeout (GNU coreutils) to bound apt-get — install coreutils and re-run"
  [ "${1:-}" = update ] && seconds=300
  for attempt in 1 2 3; do
    as_root "$limit" "$seconds" env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 \
      -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 "$@" >&2 && return 0
    echo "waitron.sh: attempt $attempt of 3 failed or stalled: apt-get $*" >&2
  done
  die "apt-get $* failed or stalled on all three attempts — check the network and re-run this command"
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
  # The new copy takes the host lock again inside its cmd_install subshell; an fd 9 handed on would
  # stay locked in that subshell's parent. Closed on its own line: macOS's bash 3.2 keeps a copy of
  # fd 9, under another number, open across `exec … 9>&-`, and that copy still holds the lock.
  exec 9>&-
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
# CREATES .env when there is none.
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

# 2. Compose follows the installed ref and replaces the old file only after the download succeeds.
fetch_box_files() {
  local ref="$1"
  if ! fetch "${RAW_BASE}/${ref}/deploy/compose.yml" "$WAITRON_DIR/compose.yml.tmp"; then
    rm -f "$WAITRON_DIR/compose.yml.tmp"
    die "could not download compose.yml — the installed file is unchanged; re-run install"
  fi
  mv -f "$WAITRON_DIR/compose.yml.tmp" "$WAITRON_DIR/compose.yml"
  rm -f "$WAITRON_DIR/.env.example"
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

# A minimal Debian install has no BlueZ, so the print agent finds no Bluetooth printer. Bluetooth is
# optional: apt_get's die is kept inside a subshell, and a failure warns and the install carries on.
ensure_bluez() {
  command -v apt-get >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 || return 0
  [ "$(dpkg-query -W -f '${db:Status-Status}' bluez 2>/dev/null)" != installed ] || return 0
  if ! (apt_get update && apt_get install -y --no-install-recommends bluez); then
    echo "waitron.sh: carrying on without Bluetooth: could not install BlueZ, the Linux Bluetooth service, so Bluetooth printers will not be found until it is installed; install the bluez package and re-run this command" >&2
    return 0
  fi
  as_root systemctl enable --now bluetooth || true
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
# The prefix is a test folder and is empty on a box.
BLUETOOTH_DROPIN="${WAITRON_TEST_HOST_ROOT:-}/etc/systemd/system/bluetooth.service.d/waitron-noautopair.conf"
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

# 2d. Every start of a box that files invoices takes no payment until its clock is confirmed, so install
# asks the host to keep its clock right where it can.
enable_time_sync() {
  local limit was_local
  limit="$(command -v gtimeout || command -v timeout)" || limit=""
  was_local="$(as_root ${limit:+"$limit" 60} timedatectl show -p LocalRTC --value 2>/dev/null)" || was_local=""
  # Before set-ntp, which may start systemd-timesyncd: it reads this setting only when it starts,
  # and while it reads local time it stops the kernel copying the system time into the hardware
  # clock, so one already running under local time is restarted.
  if as_root ${limit:+"$limit" 60} timedatectl set-local-rtc 0 >/dev/null 2>&1; then
    echo "waitron.sh: configured the system to keep the hardware clock in UTC, so the kernel copies the time into it while the system clock is synchronised (timedatectl set-local-rtc 0)"
    if [ "$was_local" = yes ] \
      && as_root ${limit:+"$limit" 60} systemctl is-active --quiet systemd-timesyncd \
      && ! as_root ${limit:+"$limit" 60} systemctl try-restart systemd-timesyncd >/dev/null 2>&1; then
      echo "waitron.sh: could not restart systemd-timesyncd after switching the hardware clock from local time to UTC; if it is running, it leaves the hardware clock alone until it restarts — run 'systemctl restart systemd-timesyncd' as root" >&2
    fi
  else
    echo "waitron.sh: could not set the hardware clock to keep UTC ('timedatectl set-local-rtc 0' failed, or this system has no timedatectl). If it keeps local time, systemd-timesyncd leaves it alone, and a box that starts without a correction after a summer/winter change can be an hour out — run 'timedatectl set-local-rtc 0' as root" >&2
  fi
  if as_root ${limit:+"$limit" 60} timedatectl set-ntp true >/dev/null 2>&1; then
    echo "waitron.sh: asked the system to keep its clock in step with internet time (timedatectl set-ntp true)"
  else
    echo "waitron.sh: could not switch on the system's time synchronisation ('timedatectl set-ntp true' failed, or this system has no timedatectl). Unless another time service runs on this machine, nothing keeps its clock right, and every start of a box that files invoices takes no payment until the system reports its clock in step with internet time, two tills or handhelds that are switched on and connected agree with its clock, or someone confirms it — check the clock, and install and enable a time service such as systemd-timesyncd if there is none" >&2
  fi
}

# 2e. The box's clock service: a root handler the app asks, through /run/waitron-box/box.sock, to read
#     the time service and to set the clock from a confirmed time (the app's container cannot). Its
#     socket's group is a host group waitron-box with the app's gid, 10001: systemd would not start a
#     socket whose numeric group named no host group (A798-B slice 9b plan, "Measured for 9b", M5).
#     A group of another name holding that number, or that name with another number, is never
#     used, since its members could then set the clock. .env names the socket's folder only once the socket has started, so compose
#     mounts it only then; otherwise the app finds no socket and cannot set the clock.
# The prefix is a test folder and is empty on a box.
SYSTEMD_RUN_DIR="${WAITRON_TEST_HOST_ROOT:-}/run/systemd/system"
BOX_LIB_DIR="${WAITRON_TEST_HOST_ROOT:-}/usr/local/lib/waitron"
BOX_UNIT_DIR="${WAITRON_TEST_HOST_ROOT:-}/etc/systemd/system"
BOX_GROUP=waitron-box
BOX_GID=10001
box_group_refusal() {
  local by_name by_gid
  by_name="$(getent group "$BOX_GROUP" || true)"
  by_gid="$(getent group "$BOX_GID" || true)"
  if [ -n "$by_name" ]; then
    [ "$(printf '%s' "$by_name" | cut -d: -f3)" = "$BOX_GID" ] && return 0
    echo "the group $BOX_GROUP already exists with number $(printf '%s' "$by_name" | cut -d: -f3), and the clock service needs $BOX_GID"
  elif [ -n "$by_gid" ]; then
    echo "group number $BOX_GID already belongs to ${by_gid%%:*}, whose members would be able to set the clock"
  fi
}
install_box_service() {
  local ref="$1" refusal tmp socket_changed=no
  local cannot="so Waitron cannot set this machine's clock itself when a confirmed time shows it is wrong, or see whether it keeps internet time, so at every start a box that files invoices takes no payment until two tills or handhelds that are switched on and connected agree with its clock or someone confirms it"
  if [ ! -d "$SYSTEMD_RUN_DIR" ]; then
    env_unset WAITRON_BOX_SOCKET_DIR
    echo "waitron.sh: no systemd on this host, so the box's clock service is not installed — $cannot"
    return 0
  fi
  refusal="$(box_group_refusal)"
  if [ -n "$refusal" ]; then
    env_unset WAITRON_BOX_SOCKET_DIR
    echo "waitron.sh: did not install the box's clock service — $refusal; $cannot" >&2
    return 0
  fi
  if ! tmp="$(mktemp -d "$WAITRON_DIR/waitron-box.XXXXXX")"; then
    env_unset WAITRON_BOX_SOCKET_DIR
    echo "waitron.sh: could not set up the box's clock service — could not create a temp folder in $WAITRON_DIR; $cannot" >&2
    return 0
  fi
  if fetch "${RAW_BASE}/${ref}/deploy/box/waitron-box.sh" "$tmp/waitron-box.sh" \
    && fetch "${RAW_BASE}/${ref}/deploy/box/waitron-box.socket" "$tmp/waitron-box.socket" \
    && fetch "${RAW_BASE}/${ref}/deploy/box/waitron-box@.service" "$tmp/waitron-box@.service" \
    && { getent group "$BOX_GROUP" >/dev/null || as_root groupadd --system --gid "$BOX_GID" "$BOX_GROUP"; } \
    && { [ ! -f "$BOX_UNIT_DIR/waitron-box.socket" ] || cmp -s "$tmp/waitron-box.socket" "$BOX_UNIT_DIR/waitron-box.socket" || socket_changed=yes; } \
    && as_root install -d -m 0755 -o root -g root "$BOX_LIB_DIR" \
    && as_root install -m 0755 -o root -g root "$tmp/waitron-box.sh" "$BOX_LIB_DIR/waitron-box.sh" \
    && as_root install -m 0644 -o root -g root "$tmp/waitron-box.socket" "$BOX_UNIT_DIR/waitron-box.socket" \
    && as_root install -m 0644 -o root -g root "$tmp/waitron-box@.service" "$BOX_UNIT_DIR/waitron-box@.service" \
    && as_root systemctl daemon-reload \
    && as_root systemctl enable --now waitron-box.socket \
    && { [ "$socket_changed" = no ] || as_root systemctl restart waitron-box.socket; }; then
    env_set WAITRON_BOX_SOCKET_DIR /run/waitron-box
    echo "waitron.sh: installed the box's clock service, so Waitron can set this machine's clock from a confirmed time"
  else
    env_unset WAITRON_BOX_SOCKET_DIR
    echo "waitron.sh: could not set up the box's clock service — $cannot" >&2
  fi
  rm -rf "$tmp"
}

# A release tag is v and isReleaseVersion's form (packages/shared/src/built-release.ts).
is_release_tag() {
  local version="${1#v}"
  [ "$1" != "$version" ] && [ "${#version}" -le 50 ] \
    && [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$ ]]
}

refuse_legacy_release_trust() {
  if [ -d "$RELEASE_TRUST" ] && [ ! -L "$RELEASE_TRUST" ]; then
    die 'this release trust directory is from an early test image — reinstall the test box with the current recipe'
  fi
}

require_numbered_release_verifier() {
  [ "${BASH_SOURCE[0]}" -ef "$WAITRON_HOST_DIR/waitron.sh" ] \
    || die "run numbered installs from $WAITRON_HOST_DIR/waitron.sh"
  refuse_legacy_release_trust
  [ -x "$HOST_NODE" ] && [ -L "$RELEASE_TRUST" ] && [ -r "$RELEASE_TRUST/verify-release.mjs" ] \
    || die 'release verification is unavailable — use a published main image with the verifier and both release keys, then follow the checked upgrade instructions'
  command -v curl >/dev/null 2>&1 || die 'install curl to download the signed release file'
}

verify_numbered_release() {
  local ref="$1" file="$2"
  curl -q -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 15 \
    --max-time 60 --max-filesize 16384 \
    "https://github.com/clintongormley/waitron/releases/download/$ref/waitron-release.json" > "$file" \
    && "$HOST_NODE" "$RELEASE_TRUST/verify-release.mjs" "$ref" < "$file" \
    || die "could not verify signed release $ref. Check that it was published and that the box has the current release verifier and keys."
}

installed_app_ref() (
  local container image config
  cd "$WAITRON_DIR" || return 1
  container="$(docker compose -f "$WAITRON_DIR/compose.yml" ps -a -q app)" || return 1
  if [ -n "$container" ]; then
    image="$(docker inspect -f '{{.Image}}' "$container")" || return 1
  else
    config="$(docker compose -f "$WAITRON_DIR/compose.yml" config --format json)" || return 1
    image="$(printf '%s' "$config" | jq -er '.services.app.image')" || return 1
  fi
  [ -n "$image" ] || return 1
  docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.ref.name"}}' "$image"
)

require_current_or_newer_release() {
  local current
  current="$(installed_app_ref)" && [[ "$current" =~ ^[^[:space:]]+$ && "$current" != "<nil>" ]] \
    || die 'could not read the installed app version — keep the existing installation and check its app image'
  if is_release_tag "$current"; then
    "$HOST_NODE" "$RELEASE_TRUST/verify-release.mjs" --check-version "$1" "$current"
  fi
}

resolve_source_metadata() {
  local ref="$1" url metadata source_metadata
  if ! command -v jq >/dev/null 2>&1; then
    command -v apt-get >/dev/null 2>&1 || die "need jq to read source commit metadata — install it and re-run"
    apt_get update
    apt_get install -y --no-install-recommends jq
  fi
  url="https://api.github.com/repos/clintongormley/waitron/commits/${ref//%/%25}"
  url="${url//#/%23}"
  if command -v curl >/dev/null 2>&1; then
    metadata="$(curl -fsSL --connect-timeout 15 --max-time 60 -H 'Accept: application/vnd.github+json' "$url")" \
      || die "could not resolve $ref to a commit — check the network and the ref"
  else
    metadata="$(wget -qO- --timeout=60 --tries=1 --header='Accept: application/vnd.github+json' "$url")" \
      || die "could not resolve $ref to a commit — check the network and the ref"
  fi
  source_metadata="$(printf '%s' "$metadata" | jq -er '[.sha, (.commit.committer.date | fromdateiso8601 | tostring)] | join(":")')" \
    || die "could not resolve $ref to source commit metadata"
  [[ "$source_metadata" =~ ^[0-9a-f]{40}:[0-9]+$ ]] || die "could not resolve $ref to a commit — GitHub returned no full SHA and commit time"
  printf '%s\n' "$source_metadata"
}

uses_default_tunnel() {
  local config enabled
  config="$(docker compose -f "$WAITRON_DIR/compose.yml" config --format json)" \
    || die 'could not read the selected box Compose file'
  enabled="$(jq -r '.services.tunnel != null and ((.services.tunnel.profiles // []) | length == 0)' <<< "$config")" \
    || die 'could not read the selected tunnel service'
  [ "$enabled" = true ]
}

# 3. main pulls every image in compose.yml and records no override; development refs other than
#    main build the Waitron images and record their tags or ids.
select_image() {
  local ref="$1"
  if [ "$ref" = "main" ]; then
    local why="check the network and that the image registries (GHCR, Docker Hub) are reachable, or whether an image is published for this machine's architecture ($(uname -m))"
    env_unset WAITRON_IMAGE
    env_unset WAITRON_PRINT_AGENT_IMAGE
    env_unset WAITRON_TUNNEL_IMAGE
    docker compose -f "$WAITRON_DIR/compose.yml" pull \
      || die "could not pull the box's images for $ref: $why"
  else
    local safe tag agent_tag tunnel_tag sha created source_metadata="${2:-}"
    safe="$(printf '%s' "$ref" | tr -c 'A-Za-z0-9._-' '-')"; safe="${safe:0:100}"
    tag="waitron:${safe}"; agent_tag="waitron-print-agent:${safe}"; tunnel_tag="waitron-tunnel:${safe}"
    [ -n "$source_metadata" ] || source_metadata="$(resolve_source_metadata "$ref")"
    sha="${source_metadata%%:*}"
    created="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    local -a app_output=(-t "$tag") agent_output=(-t "$agent_tag") tunnel_output=(-t "$tunnel_tag")
    if [ -n "${3:-}" ]; then
      app_output=(--iidfile "$3/app.id")
      agent_output=(--iidfile "$3/agent.id")
      tunnel_output=(--iidfile "$3/tunnel.id")
    fi
    docker build "${app_output[@]}" -f deploy/Dockerfile --build-arg "WAITRON_BUILD_ID=$sha" \
      --build-arg "WAITRON_SOURCE_METADATA=$source_metadata" \
      --build-arg "WAITRON_IMAGE_CREATED=$created" --build-arg "WAITRON_IMAGE_REF=$ref" \
      "https://github.com/clintongormley/waitron.git#${sha}"
    docker build "${agent_output[@]}" -f deploy/Dockerfile --target print-agent --build-arg "WAITRON_BUILD_ID=$sha" \
      --build-arg "WAITRON_SOURCE_METADATA=$source_metadata" \
      --build-arg "WAITRON_IMAGE_CREATED=$created" --build-arg "WAITRON_IMAGE_REF=$ref" \
      "https://github.com/clintongormley/waitron.git#${sha}"
    if uses_default_tunnel; then
      docker build "${tunnel_output[@]}" -f deploy/tunnel/Dockerfile \
        --build-arg "WAITRON_BUILD_ID=$sha" \
        --label "org.opencontainers.image.created=$created" \
        --label "org.opencontainers.image.ref.name=$ref" \
        "https://github.com/clintongormley/waitron.git#${sha}"
      if [ -n "${3:-}" ]; then tunnel_tag="$(cat "$3/tunnel.id")"; fi
      env_set WAITRON_TUNNEL_IMAGE "$tunnel_tag"
    else
      env_unset WAITRON_TUNNEL_IMAGE
    fi
    if [ -n "${3:-}" ]; then
      tag="$(cat "$3/app.id")"; agent_tag="$(cat "$3/agent.id")"
    fi
    env_set WAITRON_IMAGE "$tag"
    env_set WAITRON_PRINT_AGENT_IMAGE "$agent_tag"
  fi
}

# Under --reset the box is wiped before `up`, so any image `up` would pull is fetched first: a branch
# install builds Waitron's images, and a pull that failed after the wipe would leave a wiped box
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

# The box's IPv4 addresses, one per line, by the same interface choice as the server's listBoxIpv4
# (apps/server/src/box-reach.ts). It applies neither WAITRON_BOX_ADDRESSES nor the server's
# private-range filter. Prints nothing, and still succeeds, when `ip` is missing or fails.
box_own_ipv4() {
  local route_file="${WAITRON_TEST_HOST_ROOT:-}/proc/net/route" uplink="" best=""
  local iface dest metric mask family cidr addr listing
  if [ -r "$route_file" ]; then
    while read -r iface dest _ _ _ _ metric mask _; do
      [ "$dest" = 00000000 ] && [ "$mask" = 00000000 ] || continue
      [[ "$metric" =~ ^[0-9]+$ ]] || metric=99999999999
      if [ -z "$uplink" ] || [ "$metric" -lt "$best" ]; then uplink="$iface" best="$metric"; fi
    done <"$route_file"
  fi
  listing="$(ip -4 -o addr show 2>/dev/null)" || listing=""
  local -a on_uplink=() others=()
  while read -r _ iface family cidr _; do
    [ "$family" = inet ] || continue
    addr="${cidr%%/*}"
    [ "$iface" = lo ] && continue
    case "$addr" in 127.*) continue ;; esac
    [ -n "$uplink" ] && [ "$iface" = "$uplink" ] && on_uplink+=("$addr")
    case "$iface" in docker* | br-* | veth* | virbr* | cni* | flannel* | cali*) continue ;; esac
    others+=("$addr")
  done <<<"$listing"
  if [ "${#on_uplink[@]}" -gt 0 ]; then
    printf '%s\n' "${on_uplink[@]}"
  elif [ "${#others[@]}" -gt 0 ]; then
    printf '%s\n' "${others[@]}"
  fi
  return 0
}

# The whole console instruction after a box comes up: where to go, plus the QR of the setup URL.
print_links() {
  local own addr
  own="$(box_own_ipv4)" || own=""
  cat <<EOF

  Waitron is ready.

  Start here:    http://waitron.local/setup/trust
EOF
  if [ -n "$own" ]; then
    echo "  If this venue already has a Waitron box, waitron.local reaches that box instead. Use"
    echo "  this box's own address:"
    while read -r addr; do echo "                 http://${addr}/setup/trust"; done <<<"$own"
  fi
  cat <<EOF
  Secure help:   ${BOX_URL}/setup/trust
  If HTTP is unavailable or you use an operator-supplied certificate, use Secure help.
  Install this box's certificate before entering setup details.
  On a box serving its own certificate, the guide's first step removes any old one.
  Once set up:
    Till         ${BOX_URL}/till/
    Dashboard    ${BOX_URL}/
    Email inbox  ${BOX_URL}/email

EOF
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 "http://waitron.local/setup/trust"; echo; fi
}

print_image_versions() {
  local service container image labels sha created ref local_time epoch
  for service in app print-agent tunnel; do
    if ! container="$(docker compose -f "$WAITRON_DIR/compose.yml" ps -q "$service")"; then
      echo "$service: version unavailable"
      continue
    fi
    if [ -z "$container" ]; then
      echo "$service: not running"
      continue
    fi
    # Inspect the container's immutable image id: its tag may have moved since it started.
    if ! image="$(docker inspect -f '{{.Image}}' "$container")"; then
      echo "$service: version unavailable"
      continue
    fi
    if ! labels="$(docker image inspect --format '{{printf "%s|%s|%s" (index .Config.Labels "org.opencontainers.image.revision") (index .Config.Labels "org.opencontainers.image.created") (index .Config.Labels "org.opencontainers.image.ref.name")}}' "$image")"; then
      echo "$service: version unavailable"
      continue
    fi
    IFS='|' read -r sha created ref <<<"$labels"
    if [ "$sha" = development ]; then
      echo "$service: development — source unknown"
      continue
    fi
    if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || [ -z "$created" ] || [ -z "$ref" ]; then
      echo "$service: unknown — built before A490"
      continue
    fi
    if ! local_time="$(date -d "$created" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null)"; then
      if epoch="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$created" '+%s' 2>/dev/null)"; then
        local_time="$(date -r "$epoch" '+%Y-%m-%d %H:%M:%S %Z')" || local_time="unknown"
      else
        local_time="unknown"
      fi
    fi
    echo "$service: running ${sha:0:12} ($ref), built $local_time https://github.com/clintongormley/waitron/commit/$sha"
  done
}

cmd_status() {
  local result=0
  if [ -x "$WAITRON_HOST_DIR/node-v26.7.0/bin/node" ]; then
    upgrade_cli status || { echo "waitron.sh: retain ${WAITRON_DIR}.upgrades for inspection" >&2; result=1; }
  elif upgrade_pending; then
    echo "waitron.sh: upgrade pending; the retained host runtime is unavailable" >&2
    result=1
  fi
  [ -f "$WAITRON_DIR/compose.yml" ] || die "no box at $WAITRON_DIR — run 'waitron.sh install' first"
  cd "$WAITRON_DIR"
  print_image_versions
  return "$result"
}

# Show the ready banner on stdout, and — on a headless box wired to a monitor — also on the physical
# console (/dev/tty1), so whoever is standing at the box sees the setup QR without a keyboard or SSH.
# Guarded on writability so a box with no tty1 (a container, a serial console) stays silent there.
announce_ready() {
  print_image_versions
  print_links
  if [ -w /dev/tty1 ]; then print_links >/dev/tty1 2>/dev/null || true; fi
}

# Reads the deployment stamp out of the venue database. It runs inside the app image, which carries
# both node:sqlite and the state volume. The venue folder on a box is always `venue` under
# its state folder.
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
if (!state) throw new Error("WAITRON_STATE_DIR is not set");
// The start script must work against images that do not carry the TypeScript layout.
const dir = join(state, "venue");
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

select_practice_inbox() {
  local mode="$1" profiles="" profile selected=""
  if [ "$mode" = decide ]; then
    if is_production; then mode=off; else mode=on; fi
  fi
  if [ -f "$WAITRON_DIR/.env" ]; then
    profiles="$(docker compose -f "$WAITRON_DIR/compose.yml" config --environment | sed -n 's/^COMPOSE_PROFILES=//p')"
  fi
  while [ -n "$profiles" ]; do
    profile="${profiles%%,*}"
    if [ "$profile" = "$profiles" ]; then profiles=""; else profiles="${profiles#*,}"; fi
    profile="${profile#"${profile%%[![:space:]]*}"}"
    profile="${profile%"${profile##*[![:space:]]}"}"
    [ -n "$profile" ] && [ "$profile" != practice-inbox ] || continue
    selected="${selected:+${selected},}${profile}"
  done
  if [ "$mode" = on ]; then selected="${selected:+${selected},}practice-inbox"; fi
  if [ -n "$selected" ]; then env_set COMPOSE_PROFILES "$selected"; else env_unset COMPOSE_PROFILES; fi
  if [ "$mode" = off ]; then
    docker compose -f "$WAITRON_DIR/compose.yml" rm -sf mailpit
  fi
}

# ~3 minutes for the app container to report healthy (setup mode is healthy on /setup-api/status).
# Two test overrides, because a suite cannot afford either term of that product:
# WAITRON_TEST_HEALTH_TRIES cuts the try count, and WAITRON_TEST_HEALTH_DELAY cuts the wait between
# tries, so a test can keep the RETRYING and still finish in seconds. The DELAY is overridden in every
# case of scripts/waitron-sh.test.mjs, so no test can see the shipped 5 — it is pinned as text by
# scripts/deploy-image-env.test.ts instead. The try count is left alone by most cases and two of them
# assert the probe count, so a typo in it fails behaviourally as well as textually.
wait_healthy() {
  local tries="${WAITRON_TEST_HEALTH_TRIES:-36}"
  local delay="${WAITRON_TEST_HEALTH_DELAY:-5}"
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
      die "the database was made by a different version of Waitron from this image (provisioning.database_ahead). On a box with real records install the version that wrote the database — do NOT reset, it would destroy the fiscal ledger."
    fi
    die "the database was made by a different version of Waitron from this image (provisioning.database_ahead). Wipe the box and install again in one step: 'waitron.sh --reset install [ref]'"
  fi
  die "the box did not come up healthy — see the log lines above"
}

# The image each Waitron container runs now, one id per line; nothing for a service not running.
running_images() {
  local service container image
  for service in app print-agent tunnel; do
    container="$(docker compose -f "$WAITRON_DIR/compose.yml" ps -q "$service" 2>/dev/null)" || continue
    [ -n "$container" ] || continue
    image="$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" || continue
    printf '%s\n' "$image"
  done
}

# Deletes each image in $1 that no Waitron container runs any more. On Docker's containerd image
# store an image whose tag has moved is already gone, so `inspect` skips it; without -f, Docker
# refuses an image any container still uses.
delete_previous_images() {
  local before="$1" now id
  now="$(running_images)"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    printf '%s\n' "$now" | grep -qxF -- "$id" && continue
    docker image inspect "$id" >/dev/null 2>&1 </dev/null || continue
    if docker image rm "$id" >/dev/null 2>&1 </dev/null; then
      echo "waitron.sh: deleted the image this box ran before the upgrade (${id#sha256:})"
    else
      echo "waitron.sh: could not delete the image this box ran before the upgrade, $id; it still takes disk space — 'docker image rm $id' deletes it once nothing uses it" >&2
    fi
  done <<<"$before"
}

# With --reset, the production check and the confirmation run before the box's files are fetched or
# any image is built or pulled: the check reads the box with its CURRENT compose.yml and image, which
# the fetch replaces and the build or pull supersedes. refresh_self, which runs first, may already
# have replaced this script itself. The wipe waits until the new images are in place.
upgrade_pending() {
  [ -d "${WAITRON_DIR}.upgrades" ] || return 1
  [ -n "$(find "${WAITRON_DIR}.upgrades" -mindepth 1 -maxdepth 1 -print -quit)" ]
}

refuse_pending_upgrade() {
  if upgrade_pending; then
    die "upgrade pending — run 'waitron.sh status', then choose restore or keep; nothing was refreshed or reset"
  fi
}

lock_managed_box() {
  [ -f "$BOX_UNIT_DIR/waitron-app.service" ] || return 0
  exec 9>"${WAITRON_DIR}.upgrade.lock"
  # Docker requires this service, which takes the same lock: started under our lock, it would fail.
  if ! as_root systemctl start waitron-upgrade-recovery.service; then
    flock -n 9 || die "another host operation is running"
    die "the upgrade recovery service did not start, so nothing was refreshed or reset — run 'systemctl status waitron-upgrade-recovery.service' to see why"
  fi
  flock -n 9 || die "another host operation is running"
  refuse_pending_upgrade
}

upgrade_cli() {
  [ -x "$HOST_NODE" ] || die "the retained host runtime is unavailable — retain the upgrade copy and runtime; do not reset"
  local verb="$1"; shift
  "$HOST_NODE" "$WAITRON_HOST_DIR/box/upgrades/cli.mjs" "$verb" "$WAITRON_DIR" "$@"
}

cmd_check_upgrade_window() (
  # Even a read-only WAL connection can create side files while copying or restoring the venue.
  exec 9>"${WAITRON_DIR}.upgrade.lock"
  flock -n 9 || die 'another host operation is running'
  upgrade_cli check-upgrade-window
)

defer_upgrade_offer() {
  printf '{"status":"deferred","reason":"%s"}\n' "$1"
  exit 1
}

cmd_check_upgrade_offer() (
  local current result offer status=0 verb="${1:-check-upgrade-offer}"
  [ -x "$HOST_NODE" ] || defer_upgrade_offer offer-check-unavailable
  offer="$(mktemp "${TMPDIR:-/tmp}/waitron-offer.XXXXXX")" || defer_upgrade_offer offer-check-unavailable
  trap 'rm -f -- "$offer"' EXIT
  trap 'exit 1' HUP INT TERM
  upgrade_cli download-upgrade-offer > "$offer" || defer_upgrade_offer offer-download-failed
  exec 9>"${WAITRON_DIR}.upgrade.lock" && command -v flock >/dev/null \
    || defer_upgrade_offer upgrade-lock-unavailable
  flock -n 9 || defer_upgrade_offer upgrade-busy
  if upgrade_pending; then defer_upgrade_offer upgrade-pending; fi
  current="$(installed_app_ref)" && is_release_tag "$current" \
    || defer_upgrade_offer installed-version-unavailable
  result="$(upgrade_cli "$verb" "${current#v}" "$RELEASE_TRUST" "$offer")" || status=$?
  [ -n "$result" ] || defer_upgrade_offer offer-check-unavailable
  printf '%s\n' "$result"
  exit "$status"
)

cmd_install_offered_upgrade() (
  local result status=0 version
  require_numbered_release_verifier
  result="$(cmd_check_upgrade_offer check-offered-upgrade)" || status=$?
  if [ "$status" -ne 0 ] || ! version="$(jq -er 'select(.status == "offered") | .version' <<<"$result")"; then
    printf '%s\n' "$result"
    exit "$status"
  fi
  is_release_tag "v$version" && [[ "$version" != *-* ]] || die 'an offered upgrade needs a stable numbered release'
  cmd_install automatic "v$version"
)

cmd_upgrade_choice() (
  exec 9>"${WAITRON_DIR}.upgrade.lock"
  flock -n 9 || die "another host operation is running"
  local result
  result="$(upgrade_cli "$1")"
  printf '%s\n' "$result"
  if [ "$result" != null ] && ! upgrade_pending && [ -f "$BOX_UNIT_DIR/waitron-app.service" ]; then
    flock -u 9
    exec 9>&-
    as_root systemctl --no-block restart waitron-app.service
  fi
)

fetch_upgrade_driver() {
  local sha="$1" stage="$2" file
  fetch "$RAW_BASE/$sha/deploy/waitron.sh" "$stage/waitron.sh" || return 1
  for file in bootstrap.sh cli.mjs host.mjs transaction.mjs copy.mjs candidate.mjs; do
    fetch "$RAW_BASE/$sha/scripts/box/upgrades/$file" "$stage/$file" || return 1
  done
  for file in upgrade-restart.sh waitron-app.service waitron-upgrade-recovery.service; do
    fetch "$RAW_BASE/$sha/deploy/box/$file" "$stage/$file" || return 1
  done
  # A checked install can target a release whose driver cannot run the timer.
  if grep -Eq '^[[:blank:]]+check-upgrade-window[[:blank:]]*\)' "$stage/waitron.sh"; then
    for file in waitron-upgrade.service waitron-upgrade.timer; do
      fetch "$RAW_BASE/$sha/deploy/box/$file" "$stage/$file" || return 1
    done
  fi
}

fetch_release_trust() {
  local sha="$1" stage="$2" key
  mkdir -p "$stage/upgrades" || return 1
  for key in current.pem spare.pem; do
    fetch "$RAW_BASE/$sha/deploy/box/release-keys/$key" "$stage/$key" && [ -s "$stage/$key" ] || return 1
  done
  fetch "$RAW_BASE/$sha/scripts/box/verify-release.mjs" "$stage/verify-release.mjs" \
    && fetch "$RAW_BASE/$sha/scripts/box/release-list.mjs" "$stage/release-list.mjs" \
    && fetch "$RAW_BASE/$sha/scripts/box/upgrades/contracts.mjs" "$stage/upgrades/contracts.mjs"
}

install_release_trust() {
  local stage="$1" active old
  active="$(mktemp -d "$WAITRON_HOST_DIR/.release-trust.XXXXXX")"
  # Rename the link itself so the verifier and keys switch together.
  if ! { mv -- "$stage/release-trust" "$active/trust" \
      && ln -s -- "${active##*/}/trust" "$stage/release-trust.link" \
      && "$HOST_NODE" -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' \
        "$stage/release-trust.link" "$RELEASE_TRUST"; }; then
    rm -rf -- "$active"
    die 'could not activate the new release trust'
  fi
  for old in "$WAITRON_HOST_DIR"/.release-trust.*; do
    [ "$old" = "$active" ] || rm -rf -- "$old"
  done
  echo 'waitron.sh: loaded the release verifier and both public keys' >&2
}

install_upgrade_driver() {
  local stage="$1" file
  mkdir -p "$WAITRON_HOST_DIR/box/upgrades"
  for file in "$stage/"*.mjs; do
    install -m 0644 "$file" "$WAITRON_HOST_DIR/box/upgrades/${file##*/}"
  done
  install -m 0755 "$stage/bootstrap.sh" "$WAITRON_HOST_DIR/box/upgrades/bootstrap.sh"
  install -m 0755 "$stage/waitron.sh" "$WAITRON_HOST_DIR/waitron.sh"
  as_root install -d -m 0755 "$BOX_LIB_DIR" "$BOX_UNIT_DIR"
  as_root install -m 0755 "$stage/upgrade-restart.sh" "$BOX_LIB_DIR/upgrade-restart.sh"
  for file in waitron-app.service waitron-upgrade-recovery.service; do
    as_root install -m 0644 "$stage/$file" "$BOX_UNIT_DIR/$file"
  done
  if [ -f "$stage/waitron-upgrade.timer" ]; then
    for file in waitron-upgrade.service waitron-upgrade.timer; do
      as_root install -m 0644 "$stage/$file" "$BOX_UNIT_DIR/$file"
    done
  fi
  printf 'WAITRON_DIR="%s"\nWAITRON_HOST_DIR="%s"\n' "$WAITRON_DIR" "$WAITRON_HOST_DIR" > "$WAITRON_HOST_DIR/service.env"
  chmod 600 "$WAITRON_HOST_DIR/service.env"
  as_root install -d -m 0755 "$BOX_UNIT_DIR/docker.service.d" "$BOX_UNIT_DIR/docker.socket.d"
  for file in docker.service docker.socket; do
    printf '[Unit]\nRequires=waitron-upgrade-recovery.service\nAfter=waitron-upgrade-recovery.service\n' \
      > "$stage/$file.conf"
    as_root install -m 0644 "$stage/$file.conf" "$BOX_UNIT_DIR/$file.d/waitron-upgrade.conf"
  done
  as_root systemctl daemon-reload
  as_root systemctl enable waitron-upgrade-recovery.service waitron-app.service
}

# Node's own Linux build loads libatomic.so.1, which a minimal Debian install does not have.
ensure_host_node_libraries() {
  command -v apt-get >/dev/null 2>&1 || return 0
  [ "$(dpkg-query -W -f '${db:Status-Status}' libatomic1 2>/dev/null)" != installed ] || return 0
  apt_get update
  apt_get install -y --no-install-recommends libatomic1
}

cmd_checked_install() (
  local mode="$1" ref="$2" release_file="${3:-}" signed_sha="${4:-}" metadata sha preferred="" source="resolved Git SHA" stage result
  shift 2
  if [ -n "$signed_sha" ]; then shift 2; fi
  local trust_ready=0 progress_fd=1
  [ "$mode" = manual ] || progress_fd=2
  [ -d "$SYSTEMD_RUN_DIR" ] || die "safe $mode upgrades require a Linux host running systemd"
  metadata="$(resolve_source_metadata "${signed_sha:-$ref}")"
  sha="${metadata%%:*}"
  [ -z "$signed_sha" ] || [ "$sha" = "$signed_sha" ] || die "source metadata did not match signed release $ref"
  mkdir -p "$WAITRON_HOST_DIR"
  stage="$(mktemp -d "$WAITRON_HOST_DIR/.driver.XXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT
  if [ "$ref" = main ]; then
    preferred="$(docker buildx imagetools inspect ghcr.io/clintongormley/waitron:main \
      --format '{{index .Image.Config.Labels "org.opencontainers.image.revision"}}')" || preferred=""
    if [[ "$preferred" =~ ^[0-9a-f]{40}$ ]] && fetch_upgrade_driver "$preferred" "$stage"; then
      sha="$preferred"; source="registry revision"
    else
      rm -f -- "$stage/"*
      source="resolved Git fallback"
      fetch_upgrade_driver "$sha" "$stage" || die 'could not download one complete upgrade driver'
    fi
    if fetch_release_trust "$sha" "$stage/release-trust" 2>/dev/null; then trust_ready=1; fi
  else
    fetch_upgrade_driver "$sha" "$stage" || die 'could not download one complete upgrade driver'
    if [ -n "$signed_sha" ]; then
      local staged
      fetch_release_trust "$sha" "$stage/release-trust" || die "could not download release trust for $ref"
      staged="$("$HOST_NODE" "$stage/release-trust/verify-release.mjs" "$ref" < "$release_file")" \
        && [ "$staged" = "$signed_sha $*" ] \
        || die "the new release trust could not verify $ref with the same image inventory"
      trust_ready=1
    fi
  fi
  if [ "$mode" = automatic ]; then
    grep -Eq '^[[:blank:]]+install-offered-upgrade[[:blank:]]*\)' "$stage/waitron.sh" \
      || die "release $ref cannot apply an offered upgrade"
    "$HOST_NODE" "$stage/cli.mjs" read-upgrade-settings "$WAITRON_DIR" > /dev/null \
      || die "release $ref cannot read the saved upgrade settings"
  fi
  ensure_host_node_libraries >&"$progress_fd"
  bash "$stage/bootstrap.sh" "$WAITRON_HOST_DIR" "$WAITRON_DIR" >&"$progress_fd"
  exec 9>"${WAITRON_DIR}.upgrade.lock"
  flock -n 9 || die 'another host operation is running'
  refuse_pending_upgrade
  if [ -n "$signed_sha" ]; then
    local checked
    [ -L "$RELEASE_TRUST" ] \
      && checked="$("$HOST_NODE" "$RELEASE_TRUST/verify-release.mjs" "$ref" < "$release_file")" \
      && [ "$checked" = "$signed_sha $*" ] || die "release trust changed while preparing $ref — try again"
    if [ "$mode" = automatic ]; then
      local current
      current="$(installed_app_ref)" && is_release_tag "$current" \
        || defer_upgrade_offer installed-version-unavailable
      [ "$current" != "$ref" ] || defer_upgrade_offer offer-changed
      "$HOST_NODE" "$RELEASE_TRUST/verify-release.mjs" --check-version "$ref" "$current"
    else
      require_current_or_newer_release "$ref"
    fi
  fi
  if [ "$trust_ready" -eq 1 ]; then refuse_legacy_release_trust; fi
  install_upgrade_driver "$stage"
  if [ "$trust_ready" -eq 1 ]; then
    install_release_trust "$stage"
  elif [ "$ref" = main ]; then
    echo 'waitron.sh: could not load release trust files — use a published main image with both release keys and check that the files can be downloaded' >&2
  fi
  {
    load_print_agent_apparmor "$sha"
    ensure_bluez
    disable_bluetooth_autopair
    enable_time_sync
    install_box_service "$sha"
  } >&"$progress_fd"
  echo "waitron.sh: retained upgrade driver $sha ($source)" >&2
  local status=0
  local apply=(apply)
  if [ "$mode" = automatic ]; then
    apply=(apply-offered-upgrade "${current#v}" "${ref#v}" "$RELEASE_TRUST")
  fi
  result="$(upgrade_cli "${apply[@]}" bash "$WAITRON_HOST_DIR/waitron.sh" __candidate "$ref" "$metadata" "$WAITRON_DIR" "$@")" || status=$?
  [ -z "$result" ] || printf '%s\n' "$result"
  [ "$status" -eq 0 ] || exit "$status"
  if upgrade_pending; then
    die "upgrade held — run 'waitron.sh status', then choose restore or keep"
  fi
  [ "$mode" = manual ] || exit 0
  flock -u 9
  exec 9>&-
  as_root systemctl --no-block restart waitron-app.service
  announce_ready
)

immutable_main_image() {
  local digest
  digest="$(docker buildx imagetools inspect "$1:main" --format '{{.Manifest.Digest}}')"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die 'registry returned no immutable image digest'
  printf '%s@%s\n' "$1" "$digest"
}

prepare_upgrade_candidate() (
  local ref="$1" metadata="$2" installed="$3" work app agent tunnel="" revision reference
  work="$(mktemp -d "$WAITRON_HOST_DIR/.candidate.XXXXXX")"
  trap 'rm -rf -- "$work"' EXIT
  WAITRON_DIR="$work"
  [ ! -f "$installed/.env" ] || cp "$installed/.env" "$WAITRON_DIR/.env"
  if [ "$ref" = main ]; then
    reference="$(immutable_main_image ghcr.io/clintongormley/waitron)"
    docker pull "$reference" >&2
    app="$(docker image inspect "$reference" --format '{{.Id}}')"
    revision="$(docker image inspect "$app" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || die 'candidate app has no source revision'
    fetch_box_files "$revision" >&2
    reference="$(immutable_main_image ghcr.io/clintongormley/waitron-print-agent)"
    docker pull "$reference" >&2
    agent="$(docker image inspect "$reference" --format '{{.Id}}')"
    [ "$(docker image inspect "$agent" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision" ] \
      || die 'candidate app and print agent name different source revisions'
    if uses_default_tunnel; then
      reference="$(immutable_main_image "$TUNNEL_IMAGE_REPO")"
      docker pull "$reference" >&2
      tunnel="$(docker image inspect "$reference" --format '{{.Id}}')"
      [ "$(docker image inspect "$tunnel" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$revision" ] \
        || die 'candidate app and tunnel name different source revisions'
    fi
  elif is_release_tag "$ref"; then
    [[ "${4:-}" =~ ^sha256:[a-f0-9]{64}$ && "${5:-}" =~ ^sha256:[a-f0-9]{64}$ && "${6:-}" =~ ^sha256:[a-f0-9]{64}$ ]] \
      || die "signed image digests are required for $ref"
    fetch_box_files "${metadata%%:*}" >&2
    local app_image="$APP_IMAGE_REPO@$4" agent_image="$PRINT_AGENT_IMAGE_REPO@$5" tunnel_image="$TUNNEL_IMAGE_REPO@$6"
    docker pull "$app_image" >&2
    docker pull "$agent_image" >&2
    docker pull "$tunnel_image" >&2
    app="$(docker image inspect "$app_image" --format '{{.Id}}')"
    agent="$(docker image inspect "$agent_image" --format '{{.Id}}')"
    tunnel="$(docker image inspect "$tunnel_image" --format '{{.Id}}')"
  else
    fetch_box_files "${metadata%%:*}" >&2
    select_image "$ref" "$metadata" "$work" >&2
    app="$(docker image inspect "$(sed -n 's/^WAITRON_IMAGE=//p' "$WAITRON_DIR/.env")" --format '{{.Id}}')"
    agent="$(docker image inspect "$(sed -n 's/^WAITRON_PRINT_AGENT_IMAGE=//p' "$WAITRON_DIR/.env")" --format '{{.Id}}')"
    if [ -f "$work/tunnel.id" ]; then tunnel="$(cat "$work/tunnel.id")"; fi
  fi
  jq -Rsc --arg app "$app" --arg agent "$agent" --arg tunnel "$tunnel" \
    '{compose:.,images:{app:$app,"print-agent":$agent}} | if $tunnel != "" then .images.tunnel=$tunnel else . end' "$WAITRON_DIR/compose.yml"
)

# `docker compose up` creates the state volume, and a first install writes compose.yml well before
# that. A listing that fails counts as started.
box_started() {
  local state_volumes
  state_volumes="$(docker volume ls --filter "name=^${STATE_VOLUME}\$" --format '{{.Name}}')" || return 0
  [ -n "$state_volumes" ]
}

cmd_install() (
  local mode="$1"
  shift
  local ref="${1:-main}" wipe="$RESET_BEFORE_INSTALL" fresh=0 docker_ready=0
  local verified signed_sha="" app_digest="" agent_digest="" tunnel_digest="" source_ref="$ref"
  refuse_pending_upgrade
  if is_release_tag "$ref"; then
    local release_file digest='sha256:[a-f0-9]{64}'
    require_numbered_release_verifier
    release_file="$(mktemp)"
    trap 'rm -f -- "$release_file"' EXIT
    verified="$(verify_numbered_release "$ref" "$release_file")"
    [[ "$verified" =~ ^[a-f0-9]{40}\ $digest\ $digest\ $digest$ ]] || die "unexpected signed image inventory for $ref"
    read -r signed_sha app_digest agent_digest tunnel_digest <<<"$verified"
    source_ref="$signed_sha"
    unset WAITRON_IMAGE WAITRON_PRINT_AGENT_IMAGE WAITRON_TUNNEL_IMAGE
  fi
  if [ "$mode" = automatic ]; then
    cmd_checked_install automatic "$ref" "$release_file" "$signed_sha" "$app_digest" "$agent_digest" "$tunnel_digest"
    return
  fi
  if [ "$wipe" -eq 0 ] && [ -f "$WAITRON_DIR/compose.yml" ]; then
    ensure_docker
    docker_ready=1
    if box_started; then
      if [ -n "$signed_sha" ]; then
        cmd_checked_install manual "$ref" "$release_file" "$signed_sha" "$app_digest" "$agent_digest" "$tunnel_digest"
      else
        cmd_checked_install manual "$ref"
      fi
      return
    fi
  fi
  lock_managed_box
  if [ -z "$signed_sha" ]; then refresh_self "$ref"; fi
  [ "$docker_ready" -eq 1 ] || ensure_docker
  box_started || fresh=1
  if [ -n "$signed_sha" ] && [ "$fresh" -eq 0 ] && [ ! -f "$WAITRON_DIR/compose.yml" ]; then
    die "cannot install $ref: the state volume exists but compose.yml is missing — recover the box's configuration first"
  fi
  if [ "$wipe" -eq 1 ]; then
    if [ ! -f "$WAITRON_DIR/compose.yml" ]; then
      echo "waitron.sh: no box at $WAITRON_DIR, so nothing to reset — installing" >&2
      wipe=0
    elif [ "$fresh" -eq 1 ]; then
      echo "waitron.sh: Docker has no $STATE_VOLUME volume for the box at $WAITRON_DIR, so nothing is wiped — installing" >&2
      wipe=0
    else
      confirm_reset
    fi
  elif [ "$fresh" -eq 1 ] && [ -f "$WAITRON_DIR/compose.yml" ]; then
    echo "waitron.sh: $WAITRON_DIR has a compose.yml but Docker has no $STATE_VOLUME volume, so this is treated as a first install" >&2
  fi
  mkdir -p "$WAITRON_DIR" || die "cannot create $WAITRON_DIR — run as root, or set WAITRON_DIR to a writable path"
  fetch_box_files "$source_ref"
  load_print_agent_apparmor "$source_ref"
  ensure_bluez
  disable_bluetooth_autopair
  enable_time_sync
  install_box_service "$source_ref"
  if [ "$wipe" -eq 1 ] || [ "$fresh" -eq 1 ]; then select_practice_inbox on; fi
  if [ -n "$signed_sha" ]; then
    export WAITRON_IMAGE="$APP_IMAGE_REPO@$app_digest"
    export WAITRON_PRINT_AGENT_IMAGE="$PRINT_AGENT_IMAGE_REPO@$agent_digest"
    export WAITRON_TUNNEL_IMAGE="$TUNNEL_IMAGE_REPO@$tunnel_digest"
    env_set WAITRON_IMAGE "$WAITRON_IMAGE"
    env_set WAITRON_PRINT_AGENT_IMAGE "$WAITRON_PRINT_AGENT_IMAGE"
    env_set WAITRON_TUNNEL_IMAGE "$WAITRON_TUNNEL_IMAGE"
    docker compose -f "$WAITRON_DIR/compose.yml" pull \
      || die "could not pull the signed images for $ref — check that the release was published and the registry is reachable"
  else
    select_image "$ref"
  fi
  if [ "$wipe" -eq 0 ] && [ "$fresh" -eq 0 ]; then select_practice_inbox decide; fi
  cd "$WAITRON_DIR"
  local before
  before="$(running_images)"
  if [ "$wipe" -eq 1 ]; then
    ensure_images_present "$ref"
    wipe_box
  fi
  docker compose up -d --remove-orphans
  if wait_healthy; then delete_previous_images "$before"; announce_ready; else report_unhealthy; fi
)

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
  COMPOSE_PROFILES=staff-tunnel,practice-inbox docker compose down --remove-orphans
  # A failed removal ABORTS the reset before the volumes further down this loop or state are touched,
  # so a box whose wipe half-failed is never restarted against surviving data with its settings
  # already gone. logs is simply first; nothing depends on the order beyond that. A volume that is
  # already absent is not a failure. `waitron_db` is deliberately absent from the list: the box runs
  # no database server, and the volume one used to fill is left on disk rather than removed here (no
  # backwards-compatibility code before production, CLAUDE.md §3).
  local v
  for v in logs backups mailpit print_agent tunnel_control tunnel_keys; do
    rm_volume "waitron_${v}"
  done
  if [ "$RESET_ALL" -eq 1 ]; then
    rm_volume waitron_state
  else
    # A plain reset keeps tls/ and records/, except that a box that joined another (tls/joined.json)
    # holds that venue's authority in tls/, so it is emptied there too, the marker last; secrets.env
    # goes either way. An empty tls/ folder, not a link, is then removed: the server takes an
    # existing tls/ for a lost certificate and serves its repair page instead of minting a new one.
    docker compose -f "$WAITRON_DIR/compose.yml" run --rm --no-deps -T \
      --entrypoint sh app \
      -c 'find "${WAITRON_STATE_DIR:?}" -mindepth 1 -maxdepth 1 ! -name tls ! -name records -exec rm -rf {} + && if [ -e "${WAITRON_STATE_DIR:?}/tls/joined.json" ]; then find "${WAITRON_STATE_DIR:?}/tls/" -mindepth 1 -maxdepth 1 -name joined.json -prune -o -exec rm -rf {} + && rm -f "${WAITRON_STATE_DIR:?}/tls/joined.json"; fi && if [ -d "${WAITRON_STATE_DIR:?}/tls" ] && [ ! -L "${WAITRON_STATE_DIR:?}/tls" ] && [ -z "$(ls -A "${WAITRON_STATE_DIR:?}/tls")" ]; then rmdir "${WAITRON_STATE_DIR:?}/tls"; fi'
  fi
}

cmd_reset() {
  local a
  for a in "$@"; do
    reset_option "$a" || die "reset: unknown option '$a'" 2
  done
  refuse_pending_upgrade
  [ -f "$WAITRON_DIR/compose.yml" ] || die "no box at $WAITRON_DIR — run 'waitron.sh install' first"
  box_started || die "$WAITRON_DIR has a compose.yml but Docker has no $STATE_VOLUME volume, so nothing was reset — run 'waitron.sh install'"
  lock_managed_box
  confirm_reset
  cd "$WAITRON_DIR"
  select_practice_inbox on
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
  if [ "$verb" = update ]; then
    WAITRON_ARGV[${#WAITRON_ARGV[@]} - $#]=install
    verb=install
  fi
  case "$verb" in
    install | update | status | check-upgrade-offer | check-upgrade-window | install-offered-upgrade | restore | keep | reset | __candidate | "" | -h | --help) ;;
    *) die "unknown command '$verb'" 2 ;;
  esac
  if [ -n "$first" ]; then
    [ "$RESET_BEFORE_INSTALL" -eq 1 ] \
      || die "$first goes with --reset: 'waitron.sh --reset $first install [ref]', or 'waitron.sh reset $first'" 2
    [ "$verb" = "install" ] || die "--reset goes only with install: 'waitron.sh --reset install [ref]'" 2
  fi
  case "$verb" in
    install | update) shift; cmd_install manual "$@" ;;
    __candidate) shift; prepare_upgrade_candidate "$@" ;;
    status) shift; cmd_status "$@" ;;
    check-upgrade-offer) cmd_check_upgrade_offer ;;
    check-upgrade-window) cmd_check_upgrade_window ;;
    install-offered-upgrade) cmd_install_offered_upgrade ;;
    restore | keep) cmd_upgrade_choice "$verb" ;;
    reset)   shift; cmd_reset "$@" ;;
    *) usage ;;
  esac
}

# A copy from before refresh_self closed the host lock hands it on as fd 9 when it runs this one.
[ -z "${WAITRON_SH_REFRESHED:-}" ] || exec 9>&-
main "$@"
