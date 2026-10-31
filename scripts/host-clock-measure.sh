#!/usr/bin/env bash
# A798-B slice 9b's measurement: can a root service on a systemd host set the wall clock and the
# battery clock, keep its time service in charge, and answer an unprivileged container through a
# socket? Rows M1–M9 are the plan's table
# (docs/superpowers/plans/2026-10-24-a798-9b-box-sets-its-clock.md, "Measurement").
# It SETS THIS MACHINE'S CLOCK: run it only on a throwaway runner, never on a box or a laptop.
# Every line it prints starts "M<n>:"; a row's verdict line ends "expected", "FAILING CASE" or
# "not measured". It exits 1 when any of M2–M6, M8 or M9 printed its failing case.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 2
fi

T="timeout 30"
FAILED=()
UNIT_STATE_FILE="${RUNNER_TEMP:-/tmp}/time-unit"
MEASURE_DIR=/run/waitron-box-measure
HANDLER_DIR=/run/waitron-box-measure-bin
UNIT_DIR=/run/systemd/system
IMAGE=node:26-slim

say() { echo "$1: $2"; }
verdict() { # row ok-flag text
  if [ "$2" = yes ]; then
    say "$1" "expected — $3"
  else
    say "$1" "FAILING CASE — $3"
    case "$1" in M1 | M7) ;; *) FAILED+=("$1") ;; esac
  fi
}
wall_ns() { date +%s%N; }
uptime_s() { cut -d' ' -f1 /proc/uptime; }
boot_id() { cat /proc/sys/kernel/random/boot_id; }
# |a - b| <= tol, all in seconds with fractions
within() { awk -v a="$1" -v b="$2" -v t="$3" 'BEGIN { d = a - b; if (d < 0) d = -d; exit !(d <= t) }'; }
# the true time now, from the reading taken at M3's start and the uptime since
REF_WALL_NS=""
REF_UP=""
true_offset_s() { # how far the wall clock is from the reference reading carried by uptime
  local w u
  w=$(wall_ns)
  u=$(uptime_s)
  awk -v w="$w" -v u="$u" -v rw="$REF_WALL_NS" -v ru="$REF_UP" \
    'BEGIN { printf "%.3f", (w - rw) / 1e9 - (u - ru) }'
}

cleanup() {
  $T systemctl stop waitron-box-measure.socket 2>/dev/null || true
  rm -f "$UNIT_DIR/waitron-box-measure.socket" "$UNIT_DIR/waitron-box-measure@.service"
  rm -rf "$MEASURE_DIR" "$HANDLER_DIR"
  $T systemctl daemon-reload 2>/dev/null || true
}
trap cleanup EXIT

# ---- M1: which time service runs, and is it in the list set-time and set-ntp know?
say M1 "$($T timedatectl show -p NTP -p NTPSynchronized | tr '\n' ' ')"
say M1 "systemd: $($T systemd --version | head -1)"
LISTED=""
for d in /usr/lib/systemd/ntp-units.d /etc/systemd/ntp-units.d; do
  if [ -d "$d" ]; then
    for f in "$d"/*; do
      [ -f "$f" ] || continue
      say M1 "list $f: $(tr '\n' ' ' <"$f")"
      LISTED="$LISTED $(cat "$f")"
    done
  else
    say M1 "list $d: absent"
  fi
done
UNIT=""
for u in systemd-timesyncd chronyd chrony ntp ntpsec; do
  state=$($T systemctl is-active "$u" 2>/dev/null || true)
  say M1 "is-active $u: $state"
  if [ "$state" = active ] && [ -z "$UNIT" ]; then UNIT=$u; fi
done
if [ -z "$UNIT" ]; then
  say M1 "FAILING CASE — no time service is active; M2–M4 and M8 cannot be measured"
  FAILED+=(M2 M3 M4 M8)
  UNIT=systemd-timesyncd
else
  echo "$UNIT" >"$UNIT_STATE_FILE"
  UNIT_ID=$($T systemctl show -p Id --value "$UNIT" || echo "$UNIT")
  say M1 "$UNIT is unit $UNIT_ID"
  if echo " $LISTED " | grep -Eq "(^|[[:space:]])${UNIT_ID%.service}(\.service)?([[:space:]]|$)"; then
    verdict M1 yes "active unit $UNIT is listed"
  else
    verdict M1 no "active unit $UNIT is NOT listed: set-time cannot see it; the handler must stop it by name"
  fi
fi

# ---- M2: set-time while the unit runs (the control for M3)
before=$(date +%s)
rc=0
out=$($T timedatectl set-time "@$((before + 120))" 2>&1) || rc=$?
after=$(date +%s)
say M2 "rc=$rc output: $out; wall moved $((after - before)) s"
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "Automatic time synchronization is enabled" &&
  [ $((after - before)) -lt 60 ]; then
  verdict M2 yes "refused while $UNIT is active"
else
  verdict M2 no "the clock moved or the refusal differs: stopping the unit may not be needed"
fi

# ---- M3: stop the unit at runtime only, set with a fraction, read every clock
enabled_before=$($T systemctl is-enabled "$UNIT" 2>&1 || true)
REF_WALL_NS=$(wall_ns)
REF_UP=$(uptime_s)
boot_before=$(boot_id)
rtc_before=$($T timedatectl show -p RTCTimeUSec --value 2>/dev/null || true)
say M3 "before: wall_ns=$REF_WALL_NS uptime=$REF_UP boot=$boot_before is-enabled=$enabled_before $($T timedatectl show -p NTP -p RTCTimeUSec -p NTPSynchronized | tr '\n' ' ')"
$T systemctl stop "$UNIT" || say M3 "stopping $UNIT failed"
now_s=$(date +%s)
target="$((now_s + 120)).250"
u0=$(uptime_s)
rc=0
out=$($T timedatectl set-time "@$target" 2>&1) || rc=$?
w1=$(wall_ns)
u1=$(uptime_s)
enabled_after=$($T systemctl is-enabled "$UNIT" 2>&1 || true)
boot_after=$(boot_id)
rtc_after=$($T timedatectl show -p RTCTimeUSec --value 2>/dev/null || true)
say M3 "set-time @$target rc=$rc output: $out"
say M3 "after: wall_ns=$w1 uptime=$u1 boot=$boot_after is-enabled=$enabled_after $($T timedatectl show -p NTP -p RTCTimeUSec -p NTPSynchronized | tr '\n' ' ')"
# where the wall clock is against the target carried forward by the uptime since just before
landed=$(awk -v w="$w1" -v t="$target" -v a="$u0" -v b="$u1" 'BEGIN { printf "%.3f", w / 1e9 - t - (b - a) }')
spread=$(awk -v a="$u0" -v b="$u1" 'BEGIN { printf "%.3f", b - a }')
uptime_moved=$(awk -v a="$REF_UP" -v b="$u1" 'BEGIN { printf "%.3f", b - a }')
say M3 "wall minus target: $landed s (uptime spread across the set $spread s); uptime moved $uptime_moved s"
synced_after=$($T timedatectl show -p NTPSynchronized --value || true)
m3_ok=yes
m3_why=""
[ "$rc" -eq 0 ] || { m3_ok=no; m3_why="$m3_why set-time refused after the stop;"; }
within "$landed" 0 "$(awk -v s="$spread" 'BEGIN { print 0.15 + s }')" ||
  { m3_ok=no; m3_why="$m3_why the wall clock is not at the target with its fraction;"; }
awk -v m="$uptime_moved" 'BEGIN { exit !(m < 30) }' ||
  { m3_ok=no; m3_why="$m3_why uptime jumped with the wall clock;"; }
[ "$boot_before" = "$boot_after" ] || { m3_ok=no; m3_why="$m3_why the boot id changed;"; }
[ "$enabled_before" = "$enabled_after" ] || { m3_ok=no; m3_why="$m3_why is-enabled changed;"; }
[ "$synced_after" = no ] || { m3_ok=no; m3_why="$m3_why NTPSynchronized is not no;"; }
verdict M3 "$m3_ok" "set applied with its fraction, uptime and boot id untouched, unit enablement unchanged${m3_why:+ — but:$m3_why}"
if [ -z "$rtc_before" ] || [ -z "$rtc_after" ] || [ "$rtc_before" = n/a ]; then
  say M3 "battery clock: not measured (no RTC reading: before='$rtc_before' after='$rtc_after')"
else
  rtc_step=$(($(date -d "$rtc_after" +%s) - $(date -d "$rtc_before" +%s)))
  say M3 "battery clock before '$rtc_before', after '$rtc_after' (whole seconds)"
  if awk -v s="$rtc_step" 'BEGIN { exit !(s >= 110 && s <= 130) }'; then
    verdict M3 yes "battery clock moved $rtc_step s"
  else
    verdict M3 no "battery clock moved $rtc_step s, not about 120: a power cut would undo the set"
  fi
fi

# ---- M4: start the unit again; does network time win within 120 s?
$T systemctl start "$UNIT" || say M4 "starting $UNIT failed"
off=$(true_offset_s)
say M4 "offset from the reference just after start: $off s"
m4_ok=no
for _ in $(seq 1 24); do
  sleep 5
  off=$(true_offset_s)
  if within "$off" 0 1; then m4_ok=yes; break; fi
done
say M4 "offset after polling: $off s"
verdict M4 "$m4_ok" "the time service brings the clock back to network time within 120 s"

# ---- M5, M6, M9: a socket a container user may reach, and a request with a time limit
mkdir -p "$MEASURE_DIR" "$HANDLER_DIR"
chmod 0755 "$MEASURE_DIR" "$HANDLER_DIR"
cat >"$HANDLER_DIR/handler.sh" <<HANDLER
#!/usr/bin/env bash
read -r -t 5 req args || exit 0
case "\$req" in
clock.status) echo "{\"synchronised\":\"\$(timedatectl show -p NTPSynchronized --value)\"}" ;;
clock.set) b=\$(date +%s%3N); ms=\${args%% *}; systemctl stop $UNIT; rc=0; timedatectl set-time "@\$((ms / 1000)).\$(printf %03d \$((ms % 1000)))" || rc=\$?; a=\$(date +%s%3N); systemctl start $UNIT; echo "{\"rc\":\$rc,\"before\":\$b,\"after\":\$a}" ;;
*) echo '{"refused":"unknown"}' ;;
esac
HANDLER
chmod 0755 "$HANDLER_DIR/handler.sh"
cat >"$UNIT_DIR/waitron-box-measure.socket" <<'UNIT'
[Socket]
ListenStream=/run/waitron-box-measure/box.sock
Accept=yes
SocketMode=0660
SocketGroup=10001
UNIT
cat >"$UNIT_DIR/waitron-box-measure@.service" <<'UNIT'
[Service]
ExecStart=/run/waitron-box-measure-bin/handler.sh
StandardInput=socket
StandardOutput=socket
StandardError=journal
RuntimeMaxSec=15
UNIT
$T systemctl daemon-reload || say M5 "daemon-reload failed"

rc=0
out=$($T systemd-analyze verify "$UNIT_DIR/waitron-box-measure.socket" "$UNIT_DIR/waitron-box-measure@.service" 2>&1) || rc=$?
say M9 "systemd-analyze verify rc=$rc output: ${out:-<none>}"
if [ "$rc" -eq 0 ]; then verdict M9 yes "a numeric SocketGroup is accepted"; else verdict M9 no "verify refused the units"; fi
start=$(date +%s)
$T systemd-run --unit=waitron-box-measure-sleep -p RuntimeMaxSec=15 /bin/sleep 60 >/dev/null 2>&1 || true
state=active
for _ in $(seq 1 40); do
  sleep 1
  state=$($T systemctl is-active waitron-box-measure-sleep 2>/dev/null || true)
  [ "$state" = active ] || break
done
took=$(($(date +%s) - start))
say M9 "a 60-second instance under RuntimeMaxSec=15 ended after ${took} s (state $state)"
if [ "$state" != active ] && [ "$took" -le 20 ]; then
  verdict M9 yes "the instance is killed at its limit"
else
  verdict M9 no "the instance outlived its limit"
fi
$T systemctl stop waitron-box-measure-sleep 2>/dev/null || true

rc=0
$T systemctl start waitron-box-measure.socket || rc=$?
say M5 "socket start rc=$rc; $(stat -c '%A %U:%G' "$MEASURE_DIR/box.sock" 2>&1)"
say M5 "group 10001 in /etc/group: $(getent group 10001 || echo none)"
$T journalctl -u waitron-box-measure.socket --no-pager -n 20 -o cat 2>&1 | sed 's/^/M5: journal: /' || true
$T docker pull -q "$IMAGE" >/dev/null 2>&1 || true
CLIENT='
const net = require("node:net");
const fs = require("node:fs");
const started = performance.now();
const [line] = process.argv.slice(1);
const done = (text) => {
  console.log(text);
  console.log("boot " + fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
  console.log("took " + Math.round(performance.now() - started) + " ms");
  process.exit(0);
};
const timer = setTimeout(() => done("unavailable timeout"), 2000);
let reply = "";
const socket = net.createConnection("/run/waitron-box/box.sock");
socket.on("error", (error) => { clearTimeout(timer); done("unavailable " + error.code); });
socket.on("data", (chunk) => { reply += chunk; });
socket.on("end", () => { clearTimeout(timer); done("reply " + reply.trim()); });
socket.on("connect", () => socket.write(line + "\n"));
'
host_boot=$(boot_id)
status_out=$(timeout 180 docker run --rm --user 10001:10001 -v "$MEASURE_DIR:/run/waitron-box" \
  "$IMAGE" node -e "$CLIENT" "clock.status" 2>&1 || true)
say M5 "clock.status from the container: $(echo "$status_out" | tr '\n' ' ')"
set_target=$(($(date +%s%3N) + 30000))
set_out=$(timeout 180 docker run --rm --user 10001:10001 -v "$MEASURE_DIR:/run/waitron-box" \
  "$IMAGE" node -e "$CLIENT" "clock.set $set_target {\"source\":\"measure\"}" 2>&1 || true)
say M5 "clock.set $set_target from the container: $(echo "$set_out" | tr '\n' ' ')"
after_ms=$(echo "$set_out" | sed -n 's/.*"after":\([0-9]*\).*/\1/p' | head -1)
m5_ok=yes
m5_why=""
echo "$status_out" | grep -q '^reply {"synchronised"' || { m5_ok=no; m5_why="$m5_why no status reply;"; }
echo "$status_out" | grep -q "^boot $host_boot$" || { m5_ok=no; m5_why="$m5_why the container's boot id differs from the host's;"; }
if [ -z "$after_ms" ] || ! within "$after_ms" "$set_target" 2000; then
  m5_ok=no
  m5_why="$m5_why the set did not land within 2 s of its target;"
fi
verdict M5 "$m5_ok" "an unprivileged container reads status, sets the host clock, and shares the host's boot id${m5_why:+ — but:$m5_why}"

# ---- M5b: the plan's fallback for a refused numeric group: a named host group with gid 10001
if getent group 10001 >/dev/null; then
  say M5b "not measured (gid 10001 already names $(getent group 10001 | cut -d: -f1))"
else
  $T groupadd -g 10001 waitron-box || say M5b "groupadd failed"
  $T systemctl stop waitron-box-measure.socket 2>/dev/null || true
  $T systemctl reset-failed waitron-box-measure.socket 2>/dev/null || true
  rm -f "$MEASURE_DIR/box.sock"
  rc=0
  $T systemctl start waitron-box-measure.socket || rc=$?
  say M5b "with group waitron-box (gid 10001) added: socket start rc=$rc; $(stat -c '%A %U:%G' "$MEASURE_DIR/box.sock" 2>&1)"
  status_out=$(timeout 180 docker run --rm --user 10001:10001 -v "$MEASURE_DIR:/run/waitron-box" \
    "$IMAGE" node -e "$CLIENT" "clock.status" 2>&1 || true)
  say M5b "clock.status from the container: $(echo "$status_out" | tr '\n' ' ')"
  set_target=$(($(date +%s%3N) + 30000))
  set_out=$(timeout 180 docker run --rm --user 10001:10001 -v "$MEASURE_DIR:/run/waitron-box" \
    "$IMAGE" node -e "$CLIENT" "clock.set $set_target {\"source\":\"measure\"}" 2>&1 || true)
  say M5b "clock.set $set_target from the container: $(echo "$set_out" | tr '\n' ' ')"
  after_ms=$(echo "$set_out" | sed -n 's/.*"after":\([0-9]*\).*/\1/p' | head -1)
  m5b_ok=yes
  echo "$status_out" | grep -q '^reply {"synchronised"' || m5b_ok=no
  echo "$status_out" | grep -q "^boot $host_boot$" || m5b_ok=no
  if [ -z "$after_ms" ] || ! within "$after_ms" "$set_target" 2000; then m5b_ok=no; fi
  verdict M5b "$m5b_ok" "with a named group the container reads status and sets the host clock"
fi

m6_out=$(timeout 180 docker run --rm --user 10001:10001 "$IMAGE" node -e "$CLIENT" "clock.status" 2>&1 || true)
say M6 "without the bind: $(echo "$m6_out" | tr '\n' ' ')"
m6_took=$(echo "$m6_out" | sed -n 's/^took \([0-9]*\) ms$/\1/p')
if echo "$m6_out" | grep -q '^unavailable' && [ -n "$m6_took" ] && [ "$m6_took" -le 2100 ]; then
  verdict M6 yes "the client answers unavailable in ${m6_took} ms"
else
  verdict M6 no "no prompt unavailable answer"
fi

say M7 "not measured — Docker Desktop on the plan's Mac was not answering on 2026-10-31; the bind is optional for development"

# ---- M8: after a backward set, does touching the saved-clock file keep the next boot behind?
CLOCK_FILE=/var/lib/systemd/timesync/clock
if [ ! -e "$CLOCK_FILE" ]; then
  say M8 "not measured (no file $CLOCK_FILE on this runner)"
else
  $T systemctl stop "$UNIT" || say M8 "stopping $UNIT failed"
  back_target=$(($(date +%s) - 120))
  $T timedatectl set-time "@$back_target" || say M8 "the backward set-time failed"
  now_after_set=$(date +%s)
  mtime_untouched=$(stat -c %Y "$CLOCK_FILE")
  say M8 "after a backward set to $back_target: the file's mtime $mtime_untouched, now $now_after_set (the control: later than now means the next boot would jump ahead)"
  touch "$CLOCK_FILE"
  mtime_touched=$(stat -c %Y "$CLOCK_FILE")
  now_after_touch=$(date +%s)
  say M8 "after touching it: mtime $mtime_touched, now $now_after_touch"
  if [ "$mtime_touched" -le "$now_after_touch" ]; then
    verdict M8 yes "the touched file is not later than the new time"
  else
    verdict M8 no "the file stays later than the new time"
  fi
  $T systemctl start "$UNIT" || say M8 "starting $UNIT failed"
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "SUMMARY: failing cases in ${FAILED[*]}"
  exit 1
fi
echo "SUMMARY: no failing case"
