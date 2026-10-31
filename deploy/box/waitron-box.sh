#!/usr/bin/env bash
# The box's host side of the app's clock requests: one request line in on stdin, one JSON line out
# on stdout, run as root by waitron-box@.service for each connection to /run/waitron-box/box.sock.
#
#   waitron-box.sh <instance>            answer one request: clock.status, or clock.set <ms> <requester>
#   waitron-box.sh --restore <instance>  the unit's ExecStopPost: start again a time service the
#                                        instance stopped, after any end of it (a kill included)
#
# The plan's decisions 1-3: docs/superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md.
set -u
export LC_ALL=C

STATE_DIR="${WAITRON_BOX_STATE_DIR:-/run/waitron-box-state}"
NTP_UNITS_DIRS="${WAITRON_BOX_NTP_UNITS_DIRS:-/etc/systemd/ntp-units.d /run/systemd/ntp-units.d /usr/local/lib/systemd/ntp-units.d /usr/lib/systemd/ntp-units.d}"
UPTIME_FILE="${WAITRON_BOX_UPTIME:-/proc/uptime}"
TIMESYNC_CLOCK="${WAITRON_BOX_TIMESYNC_CLOCK:-/var/lib/systemd/timesync/clock}"
TIMESYNC_SYNCHRONIZED="${WAITRON_BOX_TIMESYNC_SYNCHRONIZED:-/run/systemd/timesync/synchronized}"
READ_SECONDS="${WAITRON_BOX_READ_SECONDS:-5}"

# 2024-10-28T00:00:00Z and 2100-01-01T00:00:00Z, in milliseconds.
FIRST_TARGET_MS=1730073600000
END_TARGET_MS=4102444800000
UNIT_NAME='^[A-Za-z0-9@._:-]+$'
TARGET='^[1-9][0-9]{12}$'
REQUESTER='^\{[ -~]*\}$'

answer() { printf '%s\n' "$1"; }
refuse() { answer "{\"ok\":false,\"reason\":\"$1\"}"; }

# The time services systemd-timedated knows, from every ntp-units.d list.
listed_units() {
  local dir file unit
  for dir in $NTP_UNITS_DIRS; do
    for file in "$dir"/*.list; do
      [ -f "$file" ] || continue
      while IFS= read -r unit || [ -n "$unit" ]; do
        case "$unit" in "" | "#"*) continue ;; esac
        [[ $unit =~ $UNIT_NAME ]] && printf '%s\n' "$unit"
      done < "$file"
    done
  done
}

is_listed() {
  local unit
  while IFS= read -r unit; do [ "$unit" = "$1" ] && return 0; done < <(listed_units)
  return 1
}

active_units() {
  local unit
  while IFS= read -r unit; do
    systemctl is-active --quiet "$unit" && printf '%s\n' "$unit"
  done < <(listed_units)
  return 0
}

ntp_property() {
  timedatectl show -p NTP -p NTPSynchronized 2> /dev/null | while IFS='=' read -r key value; do
    [ "$key" = "$1" ] && printf '%s' "$value"
  done
}

uptime_ms() {
  local up seconds fraction
  read -r up _ < "$UPTIME_FILE"
  seconds="${up%.*}"
  fraction="${up#*.}000"
  printf '%s' $((10#$seconds * 1000 + 10#${fraction:0:3}))
}

# Starts every unit the instance's marker names that is a listed time service, then removes the
# marker. A marker the handler did not write names nothing root should start, hence the list check.
restore() {
  local marker="$STATE_DIR/stopped.$1" unit
  [ -f "$marker" ] || return 0
  while IFS= read -r unit; do
    is_listed "$unit" && systemctl start "$unit" > /dev/null 2>&1
  done < "$marker"
  rm -f "$marker"
}

clock_status() {
  local ntp synced unit unit_json=null service last=null
  ntp="$(ntp_property NTP)"
  synced="$(ntp_property NTPSynchronized)"
  unit="$(active_units | head -n 1)"
  if [ "$ntp" != yes ]; then
    service=off
  elif [ -z "$unit" ]; then
    service=stopped
  else
    service=on
  fi
  [ -n "$unit" ] && unit_json="\"$unit\""
  [ -e "$TIMESYNC_SYNCHRONIZED" ] && last="$(date -r "$TIMESYNC_SYNCHRONIZED" +%s%3N)"
  answer "{\"ok\":true,\"service\":\"$service\",\"unit\":$unit_json,\"synchronised\":$([ "$synced" = yes ] && echo true || echo false),\"lastSyncAt\":$last,\"nowMs\":$(date +%s%3N)}"
}

clock_set() {
  local instance="$1" target="$2" requester="$3" arrived="$4" units unit target_ms seconds millis before after
  if ! [[ $target =~ $TARGET ]] || [ $((10#$target)) -lt $FIRST_TARGET_MS ] || [ $((10#$target)) -ge $END_TARGET_MS ]; then
    refuse target_invalid
    return
  fi
  if [ ${#requester} -gt 512 ] || ! [[ $requester =~ $REQUESTER ]]; then
    refuse requester_invalid
    return
  fi
  if [ "$(ntp_property NTPSynchronized)" = yes ]; then
    refuse synchronised
    return
  fi
  mkdir -p -m 0700 "$STATE_DIR"
  exec 9> "$STATE_DIR/set.lock"
  if ! flock -n 9; then
    refuse busy
    return
  fi
  logger -t waitron-box "clock.set target=$target requester=$requester"
  units="$(active_units)"
  printf '%s\n' "$units" > "$STATE_DIR/stopped.$instance"
  trap 'restore "$instance"' EXIT
  trap 'exit 143' TERM INT HUP
  while IFS= read -r unit; do
    [ -n "$unit" ] && systemctl stop "$unit" > /dev/null 2>&1
  done <<< "$units"
  target_ms=$((10#$target + $(uptime_ms) - arrived))
  seconds=$((target_ms / 1000))
  millis="$(printf '%03d' $((target_ms % 1000)))"
  before="$(date +%s%3N)"
  if ! timedatectl set-time "@$seconds.$millis" >&2; then
    restore "$instance"
    refuse set_failed
    return
  fi
  [ -e "$TIMESYNC_CLOCK" ] && touch -d "@$seconds.$millis" "$TIMESYNC_CLOCK" >&2
  after="$(date +%s%3N)"
  restore "$instance"
  answer "{\"ok\":true,\"beforeMs\":$before,\"afterMs\":$after}"
}

main() {
  local instance line rc arrived rest target requester
  if [ "${1:-}" = --restore ]; then
    instance="${2:-}"
    [[ $instance =~ $UNIT_NAME ]] || exit 2
    restore "$instance"
    exit 0
  fi
  instance="${1:-}"
  [[ $instance =~ $UNIT_NAME ]] || exit 2
  IFS= read -r -t "$READ_SECONDS" -n 701 line
  rc=$?
  arrived="$(uptime_ms)"
  if [ "$rc" -gt 128 ] || { [ "$rc" -ne 0 ] && [ -z "$line" ]; } || [ ${#line} -gt 700 ]; then
    refuse request_invalid
    exit 0
  fi
  case "$line" in
    clock.status) clock_status ;;
    "clock.set "*)
      rest="${line#clock.set }"
      target="${rest%% *}"
      requester=""
      [ "$target" != "$rest" ] && requester="${rest#* }"
      clock_set "$instance" "$target" "$requester" "$arrived"
      ;;
    *) refuse unknown_request ;;
  esac
  exit 0
}

main "$@"
