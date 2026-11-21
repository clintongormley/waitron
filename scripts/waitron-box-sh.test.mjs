import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { clearInterval, setInterval } from "node:timers";
import { setTimeout as sleep } from "node:timers/promises";
import { delimiter, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOX = join(HERE, "..", "deploy", "box");
const HANDLER = join(BOX, "waitron-box.sh");

const dirs = [];
const logs = [];
afterEach(() => {
  // No case, whatever it sends, may switch automatic time off.
  for (const log of logs.splice(0)) {
    expect(readFileSync(log, "utf8")).not.toMatch(/^timedatectl\tset-ntp(?!\ttrue$)/m);
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Built once for the file; each case's knobs travel as WB_* environment variables the stubs read.
// Every call is one line of WB_LOG: the command's name, then each argument after a tab, so a test
// can tell one argument holding a space from two arguments.
// timedatectl: `show` answers NTP=$WB_NTP and NTPSynchronized=$WB_SYNC (`yes` once
// WB_SYNC_ON_LIST has seen an `is-active`); `set-time @<s>.<ms>` fails
// when WB_SETTIME_FAIL=1, otherwise records the new time for `date`, and when WB_SETTIME_REACHED
// names a file it creates it and sleeps WB_SETTIME_SLEEP seconds first, so a case can kill the
// handler mid-set; with WB_MARKER_SEEN set it copies the state folder's markers beside the log.
// systemctl: `is-active` succeeds for the units listed in WB_ACTIVE, and with WB_SYNC_ON_LIST=1
// makes `show` answer synchronised from then on; `stop`
// rewrites the uptime file to WB_UPTIME_AFTER_STOP when set; `start` fails when WB_START_FAIL=1;
// `restart <unit>` fails when WB_RESTART_FAIL names the unit. date: `+%s%3N` answers the time
// `set-time` recorded, or WB_NOW_MS before any set; `-r <file>` answers WB_MTIME_MS. flock exits
// WB_FLOCK_RC. touch with `-d` is only logged; without, it runs the real touch.
const STUB_BIN = mkdtempSync(join(tmpdir(), "waitron-box-bin-"));
afterAll(() => rmSync(STUB_BIN, { recursive: true, force: true }));
const REAL_TOUCH = spawnSync("bash", ["-c", "command -v touch"], {
  encoding: "utf8",
}).stdout.trim();

function stub(name, body) {
  const p = join(STUB_BIN, name);
  writeFileSync(
    p,
    `#!/usr/bin/env bash\n{ printf '%s' "${name}"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$WB_LOG"\n${body}\n`,
  );
  chmodSync(p, 0o755);
}

stub(
  "timedatectl",
  `
case "$1" in
  show)
    sync="\${WB_SYNC-no}"; [ -e "\${WB_LOG}.synced" ] && sync=yes
    printf 'NTP=%s\\nNTPSynchronized=%s\\n' "\${WB_NTP:-yes}" "$sync" ;;
  set-time)
    if [ -n "\${WB_SETTIME_REACHED}" ]; then : > "\${WB_SETTIME_REACHED}"; sleep "\${WB_SETTIME_SLEEP:-1}"; fi
    [ "\${WB_SETTIME_FAIL}" = 1 ] && { echo "Failed to set time" >&2; exit 1; }
    [ -n "\${WB_MARKER_SEEN}" ] && cat "\${WAITRON_TEST_HOST_ROOT}/run/waitron-box-state"/stopped.* > "\${WB_LOG}.marker"
    t="\${2#@}"; printf '%s' "\${t/./}" > "\${WB_LOG}.now" ;;
  set-ntp) [ "\${WB_SETNTP_FAIL}" = 1 ] && { echo "Failed to set ntp" >&2; exit 1; } ;;
esac
exit 0
`,
);
stub(
  "systemctl",
  `
case "$1" in
  show) cat "$WB_MONITOR_DIR/state"; exit 0 ;;
  is-active)
    [ "\${WB_SYNC_ON_LIST}" = 1 ] && : > "\${WB_LOG}.synced"
    u="\${!#}"
    for a in \${WB_ACTIVE}; do [ "$a" = "$u" ] && exit 0; done
    exit 3 ;;
  start)
    if [ -n "\${WB_MONITOR_DIR}" ]; then
      count=0; [ ! -e "$WB_MONITOR_DIR/count" ] || read -r count < "$WB_MONITOR_DIR/count"
      count=$((count + 1))
      printf '%s' "$$" > "$WB_MONITOR_DIR/start.$count"
      printf '%s' "$count" > "$WB_MONITOR_DIR/count"
      while [ ! -e "$WB_MONITOR_DIR/finish.$count" ]; do sleep 0.01; done
      exit "$(cat "$WB_MONITOR_DIR/finish.$count")"
    fi
    [ "\${WB_START_FAIL}" = 1 ] && exit 1 ;;
  restart) [ "\${WB_RESTART_FAIL}" = "\${2}" ] && exit 1 ;;
  stop) [ -n "\${WB_UPTIME_AFTER_STOP}" ] && printf '%s 1.00\\n' "\${WB_UPTIME_AFTER_STOP}" > "\${WAITRON_TEST_HOST_ROOT}/proc/uptime" ;;
esac
exit 0
`,
);
stub(
  "date",
  `
if [ "$1" = "-r" ]; then echo "\${WB_MTIME_MS}"; exit 0; fi
if [ -e "\${WB_LOG}.now" ]; then cat "\${WB_LOG}.now"; echo; else echo "\${WB_NOW_MS:-1793425411088}"; fi
`,
);
stub("flock", `exit "\${WB_FLOCK_RC:-0}"`);
stub("logger", "exit 0");
stub("stdbuf", 'shift; exec "$@"');
stub(
  "nmcli",
  'printf "%s" "$$" > "$WB_MONITOR_DIR/observer.pid"; exec cat "$WB_MONITOR_DIR/events"',
);
stub("touch", `case " $* " in *" -d "*) exit 0 ;; esac; exec "${REAL_TOUCH}" "$@"`);

function sandbox(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "waitron-box-case-"));
  dirs.push(dir);
  const paths = {
    ntpUnits: join(dir, "etc/systemd/ntp-units.d"),
    uptime: join(dir, "proc/uptime"),
    clock: join(dir, "var/lib/systemd/timesync/clock"),
    synchronized: join(dir, "run/systemd/timesync/synchronized"),
    state: join(dir, "run/waitron-box-state"),
    tagHost: join(dir, "opt/waitron-host/box/name-tag-host.mjs"),
    networkHost: join(dir, "opt/waitron-host/box/network-host.mjs"),
  };
  for (const path of Object.values(paths)) mkdirSync(dirname(path), { recursive: true });
  mkdirSync(paths.ntpUnits);
  mkdirSync(paths.state);
  writeFileSync(join(paths.ntpUnits, "50-chrony.list"), "# the time service\nchrony.service\n");
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  logs.push(log);
  writeFileSync(paths.uptime, "100.00 200.00\n");
  writeFileSync(paths.clock, "");
  writeFileSync(paths.synchronized, "");
  const env = {
    PATH: `${STUB_BIN}${delimiter}${process.env.PATH}`,
    HOME: dir,
    WB_LOG: log,
    WB_ACTIVE: "chrony.service",
    WB_MTIME_MS: "1793425000123",
    WAITRON_TEST_HOST_ROOT: dir,
    ...extra,
  };
  return {
    dir,
    env,
    paths,
    state: paths.state,
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t")),
  };
}

function ask(sb, input, args = ["7-100-0"]) {
  const r = spawnSync("bash", [HANDLER, ...args], { input, env: sb.env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function answer(sb, line) {
  const r = ask(sb, `${line}\n`);
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  return JSON.parse(r.stdout);
}

const touchesClock = (calls) =>
  calls.filter(
    ([cmd, sub]) =>
      (cmd === "systemctl" && sub === "stop") || (cmd === "timedatectl" && sub.startsWith("set-")),
  );

const OK_TARGET = "1793425531250";
const REQUESTER = '{"source":"aeat","incident":12}';

it("answers only the bounded last offered upgrade from the configured box directory", () => {
  const sb = sandbox();
  sb.env.WAITRON_DIR = join(sb.dir, "custom box");
  const file = sb.env.WAITRON_DIR + ".upgrade-result.json";
  expect(answer(sb, "upgrade.status")).toEqual({ ok: true, result: null });
  const result = {
    attemptId: "attempt-1",
    finishedAt: "2026-11-21T03:45:00.000Z",
    fromVersion: "1.2.2",
    toVersion: "1.2.3",
    status: "rolled-back",
  };
  writeFileSync(file, JSON.stringify(result) + "\n");
  expect(answer(sb, "upgrade.status")).toEqual({ ok: true, result });
  expect(answer(sb, "upgrade.status other-file")).toEqual({ ok: false, reason: "unknown_request" });
  writeFileSync(file, "x".repeat(4096));
  expect(answer(sb, "upgrade.status")).toEqual({ ok: false, reason: "host_failed" });
});

it("uses the configured retained driver and takes a separate lock only for saves", () => {
  const sb = sandbox({ WB_FLOCK_RC: "1" });
  const host = join(sb.dir, "custom host");
  sb.env.WAITRON_HOST_DIR = host;
  sb.env.WAITRON_DIR = join(sb.dir, "custom box");
  const bin = join(host, "node-v26.7.0/bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, "node"));
  const driver = join(host, "box/upgrades");
  mkdirSync(driver, { recursive: true });
  for (const file of ["cli.mjs", "host.mjs", "transaction.mjs", "copy.mjs", "candidate.mjs"]) {
    copyFileSync(join(HERE, "box/upgrades", file), join(driver, file));
  }
  expect(answer(sb, "upgrade.settings")).toEqual({
    ok: true,
    result: { version: 1, revision: 0, automatic: true, start: "03:00", end: "05:00" },
  });
  expect(sb.calls()).toEqual([]);
  expect(answer(sb, "upgrade.settings other-file")).toEqual({
    ok: false,
    reason: "unknown_request",
  });
  const save = 'upgrade.settings.set {"revision":0,"automatic":false,"start":null,"end":null}';
  expect(answer(sb, save)).toEqual({ ok: false, reason: "busy" });
  expect(sb.calls()).toContainEqual(["flock", "-n", "9"]);
  expect(existsSync(sb.env.WAITRON_DIR + ".upgrade-settings.lock")).toBe(true);
  expect(existsSync(sb.env.WAITRON_DIR + ".upgrade.lock")).toBe(false);
  expect(existsSync(sb.env.WAITRON_DIR + ".upgrade-settings.json")).toBe(false);
  sb.env.WB_FLOCK_RC = "0";
  expect(answer(sb, save)).toEqual({
    ok: true,
    result: { version: 1, revision: 1, automatic: false, start: null, end: null },
  });
  expect(answer(sb, "upgrade.settings")).toMatchObject({ result: { revision: 1 } });
});

describe("waitron-box.sh clock.status", () => {
  it("answers the time service's state, its unit, whether it is synchronised and when it last was", () => {
    const sb = sandbox({ WB_SYNC: "yes" });
    expect(answer(sb, "clock.status")).toEqual({
      ok: true,
      service: "on",
      unit: "chrony.service",
      synchronised: true,
      lastSyncAt: 1793425000123,
      nowMs: 1793425411088,
    });
  });

  it("answers off when automatic time is switched off", () => {
    const sb = sandbox({ WB_NTP: "no" });
    expect(answer(sb, "clock.status")).toMatchObject({ service: "off", synchronised: false });
  });

  it("answers stopped when automatic time is on and no listed unit runs", () => {
    const sb = sandbox({ WB_ACTIVE: "ssh.service" });
    expect(answer(sb, "clock.status")).toMatchObject({ service: "stopped", unit: null });
  });

  it("answers a null last synchronisation when the file's time cannot be read", () => {
    const sb = sandbox({ WB_MTIME_MS: "" });
    expect(answer(sb, "clock.status").lastSyncAt).toBeNull();
  });

  it.each([
    "etc/systemd/ntp-units.d",
    "run/systemd/ntp-units.d",
    "usr/local/lib/systemd/ntp-units.d",
    "usr/lib/systemd/ntp-units.d",
  ])("reads %s inside the host root", (folder) => {
    const sb = sandbox({ WB_ACTIVE: "fixture-only.service" });
    rmSync(join(sb.paths.ntpUnits, "50-chrony.list"));
    const units = join(sb.dir, folder);
    mkdirSync(units, { recursive: true });
    writeFileSync(join(units, "fixture.list"), "fixture-only.service\n");
    expect(answer(sb, "clock.status")).toMatchObject({
      service: "on",
      unit: "fixture-only.service",
    });
  });

  it("reads a list line with whitespace around the unit's name", () => {
    const sb = sandbox();
    writeFileSync(join(sb.paths.ntpUnits, "50-chrony.list"), "  chrony.service \t\n");
    expect(answer(sb, "clock.status")).toMatchObject({ service: "on", unit: "chrony.service" });
  });

  it("answers a null last synchronisation when the time service never wrote its file", () => {
    const sb = sandbox();
    rmSync(sb.paths.synchronized);
    expect(answer(sb, "clock.status").lastSyncAt).toBeNull();
  });
});

describe("waitron-box.sh clock.set refusals", () => {
  const refusals = [
    ["a target with letters", `clock.set 17934255312x0 ${REQUESTER}`, {}, "target_invalid"],
    [
      "a target with leading zeros read as octal",
      `clock.set 037000000000000 ${REQUESTER}`,
      {},
      "target_invalid",
    ],
    [
      "a leading zero bash cannot read as octal",
      `clock.set 0370000000009 ${REQUESTER}`,
      {},
      "target_invalid",
    ],
    [
      "a leading zero on a target in range once read as decimal",
      `clock.set 01793425531250 ${REQUESTER}`,
      {},
      "target_invalid",
    ],
    [
      "one millisecond before 28 October 2024",
      `clock.set 1730073599999 ${REQUESTER}`,
      {},
      "target_invalid",
    ],
    ["the first moment of 2100", `clock.set 4102444800000 ${REQUESTER}`, {}, "target_invalid"],
    [
      "a clock the time service already keeps",
      `clock.set ${OK_TARGET} ${REQUESTER}`,
      { WB_SYNC: "yes" },
      "synchronised",
    ],
    [
      "a requester holding a control character",
      `clock.set ${OK_TARGET} {"a":"\tb"}`,
      {},
      "requester_invalid",
    ],
    [
      "a requester of 513 bytes",
      `clock.set ${OK_TARGET} {"a":"${"x".repeat(505)}"}`,
      {},
      "requester_invalid",
    ],
    [
      "a requester not wrapped in braces",
      `clock.set ${OK_TARGET} "source"`,
      {},
      "requester_invalid",
    ],
    ["no requester at all", `clock.set ${OK_TARGET}`, {}, "requester_invalid"],
  ];
  for (const [name, line, env, reason] of refusals) {
    it(`refuses ${name} as ${reason}, touching neither the time service nor the clock`, () => {
      const sb = sandbox(env);
      expect(answer(sb, line)).toEqual({ ok: false, reason });
      expect(touchesClock(sb.calls())).toEqual([]);
    });
  }

  for (const [name, target, requester] of [
    ["the first moment of 28 October 2024", "1730073600000", REQUESTER],
    ["the last millisecond before 2100", "4102444799999", REQUESTER],
    ["a requester of exactly 512 bytes", OK_TARGET, `{"a":"${"x".repeat(504)}"}`],
  ]) {
    it(`goes through for ${name}`, () => {
      const sb = sandbox();
      expect(requester.length).toBeLessThanOrEqual(512);
      expect(answer(sb, `clock.set ${target} ${requester}`)).toMatchObject({ ok: true });
    });
  }

  it("answers busy, stopping nothing, while another set holds the lock", () => {
    const sb = sandbox({ WB_FLOCK_RC: "1" });
    expect(answer(sb, `clock.set ${OK_TARGET} ${REQUESTER}`)).toEqual({
      ok: false,
      reason: "busy",
    });
    expect(touchesClock(sb.calls())).toEqual([]);
  });
});

describe("waitron-box.sh reads one bounded line", () => {
  it("refuses a line of 701 characters as request_invalid", () => {
    const sb = sandbox();
    const line = `clock.set ${OK_TARGET} {"a":"${"x".repeat(701 - 32)}"}`;
    expect(line).toHaveLength(701);
    expect(answer(sb, line)).toEqual({ ok: false, reason: "request_invalid" });
  });

  it("reads a line of exactly 700 characters whole, refusing its requester rather than the line", () => {
    const sb = sandbox();
    const line = `clock.set ${OK_TARGET} {"a":"${"x".repeat(700 - 32)}"}`;
    expect(line).toHaveLength(700);
    expect(answer(sb, line)).toEqual({ ok: false, reason: "requester_invalid" });
  });

  for (const [name, partial] of [
    ["no line", ""],
    ["a request with no end of line", "clock.status"],
  ]) {
    it(`answers request_invalid when ${name} arrives within the limit`, async () => {
      const sb = sandbox({ WAITRON_TEST_READ_SECONDS: "1" });
      const started = performance.now();
      const child = spawn("bash", [HANDLER, "7-100-0"], { env: sb.env });
      if (partial) child.stdin.write(partial);
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      const code = await new Promise((resolve) => child.on("exit", resolve));
      child.stdin.end();
      expect(code).toBe(0);
      expect(performance.now() - started).toBeLessThan(3000);
      expect(JSON.parse(out)).toEqual({ ok: false, reason: "request_invalid" });
    }, 10_000);
  }

  it("counts the line's bytes, not its characters, whatever the locale", () => {
    const sb = sandbox({ LANG: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8" });
    const line = `${"a".repeat(699)}é`;
    expect(Buffer.byteLength(line)).toBe(701);
    expect(answer(sb, line)).toEqual({ ok: false, reason: "request_invalid" });
  });

  it("answers unknown_request for an unknown first word and for an empty line", () => {
    const sb = sandbox();
    expect(answer(sb, "clock.reset now")).toEqual({ ok: false, reason: "unknown_request" });
    expect(answer(sb, "")).toEqual({ ok: false, reason: "unknown_request" });
  });

  it("refuses an instance name that could leave the state folder, writing nothing", () => {
    const sb = sandbox();
    const r = ask(sb, `clock.set ${OK_TARGET} ${REQUESTER}\n`, ["../x"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(touchesClock(sb.calls())).toEqual([]);
  });
});

describe("waitron-box.sh clock.set", () => {
  it("stops the time service, sets the clock with the time since the request, moves the clock file, and starts it again", () => {
    const sb = sandbox({ WB_UPTIME_AFTER_STOP: "100.37" });
    expect(answer(sb, `clock.set ${OK_TARGET} ${REQUESTER}`)).toEqual({
      ok: true,
      beforeMs: 1793425411088,
      afterMs: 1793425531620,
    });
    const calls = sb.calls().filter(([cmd, sub]) => cmd !== "date" && sub !== "is-active");
    expect(calls).toEqual([
      ["timedatectl", "show", "-p", "NTP", "-p", "NTPSynchronized"],
      ["flock", "-n", "9"],
      ["logger", "-t", "waitron-box", `clock.set target=${OK_TARGET} requester=${REQUESTER}`],
      ["systemctl", "stop", "chrony.service"],
      ["timedatectl", "set-time", "@1793425531.620"],
      ["touch", "-d", "@1793425531.620", sb.paths.clock],
      ["systemctl", "start", "chrony.service"],
    ]);
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("keeps a marker naming the stopped unit while the clock is set, and removes it after", () => {
    const sb = sandbox({ WB_MARKER_SEEN: "1" });
    expect(answer(sb, `clock.set ${OK_TARGET} ${REQUESTER}`)).toMatchObject({ ok: true });
    expect(readFileSync(`${sb.env.WB_LOG}.marker`, "utf8")).toBe("chrony.service\n");
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("logs a requester holding shell syntax as written, running none of it", () => {
    const sb = sandbox();
    const ran = join(sb.dir, "ran");
    const requester = `{"x":"$(touch ${ran})\`touch ${ran}\`;"}`;
    expect(answer(sb, `clock.set ${OK_TARGET} ${requester}`)).toMatchObject({ ok: true });
    expect(sb.calls()).toContainEqual([
      "logger",
      "-t",
      "waitron-box",
      `clock.set target=${OK_TARGET} requester=${requester}`,
    ]);
    expect(existsSync(ran)).toBe(false);
  });

  it("never switches automatic time off", () => {
    const sb = sandbox();
    answer(sb, `clock.set ${OK_TARGET} ${REQUESTER}`);
    answer(sb, "clock.status");
    expect(sb.calls().filter(([cmd, sub]) => cmd === "timedatectl" && sub === "set-ntp")).toEqual(
      [],
    );
  });

  it("starts the time service again and answers set_failed when setting the clock fails", () => {
    const sb = sandbox({ WB_SETTIME_FAIL: "1" });
    expect(answer(sb, `clock.set ${OK_TARGET} ${REQUESTER}`)).toEqual({
      ok: false,
      reason: "set_failed",
    });
    const calls = sb.calls().map((c) => c.slice(0, 2).join(" "));
    expect(calls.indexOf("systemctl start")).toBeGreaterThan(calls.indexOf("timedatectl set-time"));
    expect(calls).not.toContain("touch -d");
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("starts the time service again when killed while setting the clock", async () => {
    const reached = join(tmpdir(), `waitron-box-reached-${process.pid}-${Date.now()}`);
    const sb = sandbox({ WB_SETTIME_REACHED: reached, WB_SETTIME_SLEEP: "1" });
    const child = spawn("bash", [HANDLER, "7-100-0"], { env: sb.env });
    child.stdin.end(`clock.set ${OK_TARGET} ${REQUESTER}\n`);
    const exited = new Promise((resolve) => child.on("exit", resolve));
    while (!existsSync(reached)) await sleep(20);
    rmSync(reached);
    child.kill("SIGTERM");
    await exited;
    const calls = sb.calls().map((c) => c.slice(0, 3).join(" "));
    expect(calls).toContain("systemctl start chrony.service");
    expect(calls.indexOf("systemctl start chrony.service")).toBeGreaterThan(
      calls.indexOf("timedatectl set-time @1793425531.250"),
    );
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  }, 10_000);
});

describe("waitron-box.sh clock.sync-on", () => {
  it("switches automatic time on and logs that it did", () => {
    const sb = sandbox({ WB_NTP: "no" });
    expect(answer(sb, "clock.sync-on")).toEqual({ ok: true });
    expect(sb.calls()).toEqual([
      ["flock", "-n", "9"],
      ["logger", "-t", "waitron-box", "clock.sync-on"],
      ["timedatectl", "set-ntp", "true"],
    ]);
  });

  it("answers busy, running nothing, while a set holds the lock", () => {
    const sb = sandbox({ WB_NTP: "no", WB_FLOCK_RC: "1" });
    expect(answer(sb, "clock.sync-on")).toEqual({ ok: false, reason: "busy" });
    expect(sb.calls()).toEqual([["flock", "-n", "9"]]);
  });

  it("answers sync_on_failed when timedatectl cannot switch automatic time on", () => {
    const sb = sandbox({ WB_NTP: "no", WB_SETNTP_FAIL: "1" });
    expect(answer(sb, "clock.sync-on")).toEqual({ ok: false, reason: "sync_on_failed" });
  });
});

describe("waitron-box.sh clock.retry", () => {
  const restarts = (sb) =>
    sb.calls().filter(([cmd, sub]) => cmd === "systemctl" && sub === "restart");

  it("restarts every running listed time service, answering ok and writing no journal line of its own", () => {
    const sb = sandbox({ WB_ACTIVE: "chrony.service systemd-timesyncd.service" });
    writeFileSync(
      join(sb.paths.ntpUnits, "80-timesyncd.list"),
      "systemd-timesyncd.service\nntpd.service\n",
    );
    expect(answer(sb, "clock.retry")).toEqual({ ok: true });
    expect(restarts(sb)).toEqual([
      ["systemctl", "restart", "chrony.service"],
      ["systemctl", "restart", "systemd-timesyncd.service"],
    ]);
    expect(sb.calls().filter(([cmd]) => cmd === "logger")).toEqual([]);
  });

  it.each([
    ["synchronised", { WB_SYNC: "yes" }],
    ["not_running", { WB_NTP: "no" }],
    ["not_running", { WB_ACTIVE: "" }],
    ["not_running", { WB_SYNC: "" }],
    ["synchronised", { WB_SYNC_ON_LIST: "1" }],
    ["saved_time_ahead", { WB_MTIME_MS: "1793425411089" }],
    ["saved_time_ahead", { WB_MTIME_MS: "" }],
    ["busy", { WB_FLOCK_RC: "1" }],
  ])("answers %s, restarting nothing, for %o", (reason, env) => {
    const sb = sandbox(env);
    expect(answer(sb, "clock.retry")).toEqual({ ok: false, reason });
    expect(restarts(sb)).toEqual([]);
    expect(touchesClock(sb.calls())).toEqual([]);
  });

  it("restarts when timesyncd's saved clock file is absent, whatever a file's time would read", () => {
    const sb = sandbox({ WB_MTIME_MS: "1893425411088" });
    rmSync(sb.paths.clock);
    expect(answer(sb, "clock.retry")).toEqual({ ok: true });
    expect(restarts(sb)).toEqual([["systemctl", "restart", "chrony.service"]]);
  });

  it("reads automatic time and synchronisation in one read after listing the running services, just before restarting", () => {
    const sb = sandbox();
    expect(answer(sb, "clock.retry")).toEqual({ ok: true });
    const calls = sb.calls().map(([cmd, sub]) => `${cmd} ${sub}`);
    expect(calls.filter((call) => call.startsWith("timedatectl"))).toEqual(["timedatectl show"]);
    expect(calls.indexOf("timedatectl show")).toBeGreaterThan(calls.indexOf("systemctl is-active"));
    expect(calls.indexOf("timedatectl show")).toBeLessThan(calls.indexOf("systemctl restart"));
  });

  it("restarts a service named in two lists once", () => {
    const sb = sandbox();
    const usrLib = join(sb.dir, "usr/lib/systemd/ntp-units.d");
    mkdirSync(usrLib, { recursive: true });
    writeFileSync(join(usrLib, "50-chrony.list"), "chrony.service\n");
    expect(answer(sb, "clock.retry")).toEqual({ ok: true });
    expect(restarts(sb)).toEqual([["systemctl", "restart", "chrony.service"]]);
  });

  it("answers restart_failed when a restart fails", () => {
    const sb = sandbox({ WB_RESTART_FAIL: "chrony.service" });
    expect(answer(sb, "clock.retry")).toEqual({ ok: false, reason: "restart_failed" });
  });
});

describe("waitron-box.sh --restore", () => {
  it("starts the unit a marker names when it is listed, then removes the marker", () => {
    const sb = sandbox();
    mkdirSync(sb.state, { recursive: true });
    writeFileSync(join(sb.state, "stopped.7-100-0"), "chrony.service\n");
    const r = ask(sb, "", ["--restore", "7-100-0"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(sb.calls()).toEqual([["systemctl", "start", "chrony.service"]]);
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("starts nothing a marker names that is not a listed time service", () => {
    const sb = sandbox();
    mkdirSync(sb.state, { recursive: true });
    writeFileSync(join(sb.state, "stopped.7-100-0"), "ssh.service\n");
    expect(ask(sb, "", ["--restore", "7-100-0"]).status).toBe(0);
    expect(sb.calls()).toEqual([]);
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("keeps the marker naming a unit that would not start, so the stop step tries again", () => {
    const sb = sandbox({ WB_START_FAIL: "1" });
    mkdirSync(sb.state, { recursive: true });
    writeFileSync(join(sb.state, "stopped.7-100-0"), "chrony.service\n");
    expect(ask(sb, "", ["--restore", "7-100-0"]).status).toBe(0);
    expect(sb.calls()).toEqual([["systemctl", "start", "chrony.service"]]);
    expect(readFileSync(join(sb.state, "stopped.7-100-0"), "utf8")).toBe("chrony.service\n");
  });

  it("does nothing when no marker is left", () => {
    const sb = sandbox();
    expect(ask(sb, "", ["--restore", "7-100-0"]).status).toBe(0);
    expect(sb.calls()).toEqual([]);
  });
});

describe("the box's systemd units", () => {
  const socket = () => readFileSync(join(BOX, "waitron-box.socket"), "utf8");
  const service = () => readFileSync(join(BOX, "waitron-box@.service"), "utf8");
  // Each setting as "<section>/<key>=<value>": systemd ignores a key in the wrong section, with only
  // a warning (run 3 of the measurement: CollectMode under [Service]).
  const settings = (text) => {
    let section = "";
    return text.split("\n").flatMap((raw) => {
      const line = raw.trim();
      const header = /^\[(\w+)\]$/.exec(line);
      if (header) section = header[1];
      return header || line === "" || line.startsWith("#") ? [] : [`${section}/${line}`];
    });
  };

  it("listen on the app's socket for one request per connection, readable only by the box's group", () => {
    expect(settings(socket())).toEqual(
      expect.arrayContaining([
        "Socket/ListenStream=/run/waitron-box/box.sock",
        "Socket/Accept=yes",
        "Socket/SocketMode=0660",
        "Socket/SocketUser=root",
        "Socket/SocketGroup=waitron-box",
        "Socket/MaxConnections=4",
        "Install/WantedBy=sockets.target",
      ]),
    );
  });

  it("keeps an intentional observer stop clean and enables observation when NetworkManager starts", () => {
    expect(settings(readFileSync(join(BOX, "waitron-network-monitor.service"), "utf8"))).toEqual(
      expect.arrayContaining([
        "Service/SuccessExitStatus=143",
        "Install/WantedBy=multi-user.target NetworkManager.service",
      ]),
    );
  });

  it("run the handler with the request on the socket, its errors in the journal, for at most 15 seconds, and leave no failed instance behind", () => {
    expect(settings(service())).toEqual(
      expect.arrayContaining([
        "Service/StandardInput=socket",
        "Service/StandardOutput=socket",
        "Service/StandardError=journal",
        "Service/RuntimeMaxSec=15",
        "Service/ExecStart=/usr/local/lib/waitron/waitron-box.sh %i",
        "Service/ExecStopPost=/usr/local/lib/waitron/waitron-box.sh --restore %i",
        "Unit/CollectMode=inactive-or-failed",
      ]),
    );
  });
});

it("forwards a complete tag over 700 characters while keeping its host lock", () => {
  const sb = sandbox();
  const host = sb.paths.tagHost;
  const received = join(sb.dir, "received");
  writeFileSync(
    host,
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(received)}, fs.readFileSync(0)); console.log('{"ok":true,"tag":"written"}');`,
  );
  const line =
    'tag.write {"tag":{"name":"' +
    "\\ud83d\\ude00".repeat(256) +
    '","live":false},"actor":{"source":"server"}}';
  expect(line.length).toBeGreaterThan(700);
  expect(answer(sb, line)).toEqual({ ok: true, tag: "written" });
  expect(readFileSync(received, "utf8")).toBe(line);
  expect(sb.calls()).toContainEqual(["flock", "-n", "9"]);
  expect(touchesClock(sb.calls())).toEqual([]);
});

it("refuses a competing tag writer before starting the adapter", () => {
  const sb = sandbox({ WB_FLOCK_RC: "1" });
  const host = sb.paths.tagHost;
  writeFileSync(host, `throw new Error('must not run');`);
  expect(answer(sb, 'tag.write {"tag":null,"actor":{"source":"server"}}')).toEqual({
    ok: false,
    reason: "busy",
  });
});

it("answers one host_failed line when the tag adapter crashes before a reply", () => {
  const sb = sandbox();
  const host = sb.paths.tagHost;
  writeFileSync(host, `process.exit(3);`);
  expect(answer(sb, 'tag.write {"tag":null,"actor":{"source":"server"}}')).toEqual({
    ok: false,
    reason: "host_failed",
  });
});

it("forwards a network read without a write lock, retaining unknown_request when absent", () => {
  const sb = sandbox();
  const host = sb.paths.networkHost;
  const received = join(sb.dir, "received");
  writeFileSync(
    host,
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(received)}, fs.readFileSync(0)); console.log('{"ok":true}');`,
  );
  const line = 'network.read {"actor":{"source":"server"}}';
  expect(answer(sb, line)).toEqual({ ok: true });
  expect(readFileSync(received, "utf8")).toBe(line);
  expect(sb.calls().some((call) => call[0] === "flock")).toBe(false);
  expect(touchesClock(sb.calls())).toEqual([]);
  rmSync(host);
  expect(answer(sb, line)).toEqual({ ok: false, reason: "unknown_request" });
});

it.each(["scan", "join", "forget"])(
  "forwards network.%s under the shared network lock without needing tag support",
  (verb) => {
    const sb = sandbox();
    const received = join(sb.dir, "received");
    writeFileSync(
      sb.paths.networkHost,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(received)}, fs.readFileSync(0)); console.log('{"ok":true}');`,
    );
    const request =
      verb === "scan"
        ? 'network.scan {"actor":{"source":"person","person":"owner"}}'
        : `network.${verb} ${" ".repeat(900)}`;
    expect(answer(sb, request)).toEqual({ ok: true });
    expect(readFileSync(received, "utf8")).toBe(request);
    expect(sb.calls()).toContainEqual(["flock", "-n", "9"]);
    expect(touchesClock(sb.calls())).toEqual([]);
  },
);

it("refuses a competing network scan without invoking its adapter", () => {
  const sb = sandbox({ WB_FLOCK_RC: "1" });
  writeFileSync(sb.paths.networkHost, "throw Error('must not run');");
  expect(answer(sb, 'network.scan {"actor":{"source":"person","person":"owner"}}')).toEqual({
    ok: false,
    reason: "busy",
  });
});

it.each([0, 1])("takes the worker lock before its adapter (lock refusal %s)", (rc) => {
  const sb = sandbox({ WB_FLOCK_RC: String(rc) });
  writeFileSync(
    join(dirname(sb.paths.networkHost), "network-change.mjs"),
    "console.log('worker ran');",
  );
  const result = ask(sb, "", ["--network-change"]);
  expect(existsSync(join(sb.paths.state, "network.lock"))).toBe(true);
  expect(result.status).toBe(rc);
  expect(result.stdout).toBe(rc ? "" : "worker ran\n");
  expect(sb.calls()).toContainEqual(["flock", "-w", "15", "9"]);
});

async function observing(sb, { manualClock = false, trace = false } = {}) {
  const dir = join(sb.dir, "observer");
  mkdirSync(dir);
  writeFileSync(join(dir, "state"), "inactive");
  const fifo = join(dir, "events");
  expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
  const fd = openSync(fifo, "r+");
  let steadyMs = 100000;
  const clockBegan = performance.now();
  const tick = () => {
    const value = steadyMs + (manualClock ? 0 : performance.now() - clockBegan);
    writeFileSync(sb.paths.uptime + ".next", `${(value / 1000).toFixed(3)} 0.00\n`);
    renameSync(sb.paths.uptime + ".next", sb.paths.uptime);
  };
  tick();
  const clock = manualClock ? null : setInterval(tick, 100);
  const clockEnv = join(dir, "steady-clock-only.sh");
  if (manualClock || trace) {
    writeFileSync(
      clockEnv,
      `${manualClock ? "unset SECONDS\nSECONDS=0\n" : ""}${trace ? "PS4='+observer:${line-}: '\n" : ""}unset BASH_ENV\n`,
    );
  }
  const child = spawn("bash", [...(trace ? ["-x"] : []), HANDLER, "--network-monitor"], {
    env: {
      ...sb.env,
      WB_MONITOR_DIR: dir,
      ...(manualClock || trace ? { BASH_ENV: clockEnv } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (bytes) => (stderr += bytes));
  const ended = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  let inputOpen = true;
  const endEvents = () => {
    if (inputOpen) {
      closeSync(fd);
      inputOpen = false;
    }
  };
  const count = () =>
    existsSync(join(dir, "count")) ? Number(readFileSync(join(dir, "count"))) : 0;
  return {
    child,
    dir,
    count,
    ended,
    endEvents,
    advanceUptime: (ms) => {
      steadyMs += ms;
      tick();
    },
    send: (text) => writeSync(fd, text + "\n"),
    finish: (n, code = 0) => writeFileSync(join(dir, `finish.${n}`), String(code)),
    stderr: () => stderr,
    async stop() {
      clearInterval(clock);
      endEvents();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await ended;
    },
  };
}

describe("outside network changes", () => {
  it("starts from elapsed host uptime while the wall-clock counter is frozen", async () => {
    const observer = await observing(sandbox(), { manualClock: true });
    try {
      await expect
        .poll(() => existsSync(join(observer.dir, "observer.pid")), { timeout: 1000 })
        .toBe(true);
      observer.advanceUptime(1001);
      observer.send("profile changed");
      await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
    } finally {
      await observer.stop();
    }
  }, 20000);

  it("starts after the grace and retains a burst while the worker is running", async () => {
    const sb = sandbox();
    const began = performance.now();
    const observer = await observing(sb, { trace: true });
    try {
      observer.send("NetworkManager is running");
      await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
      expect(performance.now() - began).toBeGreaterThanOrEqual(800);
      observer.send("profile changed\nprofile changed\nprofile removed");
      // A FIFO write can finish before consumption; this follows network_monitor's dirty=1 after its read.
      await expect
        .poll(observer.stderr, { timeout: 3000 })
        .toMatch(/^\+observer:profile removed: dirty=1$/m);
      observer.finish(1);
      await expect.poll(observer.count, { timeout: 6000 }).toBe(2);
      expect(sb.calls().filter(([cmd, sub]) => cmd === "systemctl" && sub === "start")).toEqual([
        ["systemctl", "start", "waitron-network-change.service"],
        ["systemctl", "start", "waitron-network-change.service"],
      ]);
      const worker = Number(readFileSync(join(observer.dir, "start.2")));
      observer.finish(2);
      await expect
        .poll(
          () => {
            try {
              process.kill(worker, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 3000 },
        )
        .toBe(false);
      await sleep(2200);
      expect(observer.count()).toBe(2);
    } finally {
      await observer.stop();
    }
  }, 24000);
  it("keeps a refused pass pending without another notification", async () => {
    const observer = await observing(sandbox());
    try {
      await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
      observer.finish(1, 1);
      await expect.poll(observer.count, { timeout: 6000 }).toBe(2);
    } finally {
      await observer.stop();
    }
  }, 18000);

  it("grows retries despite incoming events and resets the wait after success", async () => {
    const observer = await observing(sandbox());
    const events = setInterval(() => observer.send("profile changed"), 30);
    try {
      await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
      let failedAt = performance.now();
      observer.finish(1, 1);
      await expect.poll(observer.count, { timeout: 4000 }).toBe(2);
      expect(performance.now() - failedAt).toBeGreaterThanOrEqual(800);
      failedAt = performance.now();
      observer.finish(2, 1);
      await expect.poll(observer.count, { timeout: 5000 }).toBe(3);
      expect(performance.now() - failedAt).toBeGreaterThanOrEqual(1800);
      observer.finish(3);
      await expect.poll(observer.count, { timeout: 3000 }).toBe(4);
      observer.finish(4, 1);
      await expect.poll(observer.count, { timeout: 3000 }).toBe(5);
    } finally {
      clearInterval(events);
      await observer.stop();
    }
  }, 30000);

  it("requests a fresh pass when start only waited for an already-running service", async () => {
    const observer = await observing(sandbox());
    try {
      writeFileSync(join(observer.dir, "state"), "activating");
      await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
      writeFileSync(join(observer.dir, "state"), "inactive");
      observer.finish(1);
      await expect.poll(observer.count, { timeout: 6000 }).toBe(2);
    } finally {
      await observer.stop();
    }
  }, 20000);

  it.each(["eof", "signal"])(
    "ends on %s and reaps only its observer and service client",
    async (end) => {
      const sb = sandbox();
      const observer = await observing(sb);
      try {
        await expect.poll(observer.count, { timeout: 6000 }).toBe(1);
        const pids = ["observer.pid", "start.1"].map((name) =>
          Number(readFileSync(join(observer.dir, name))),
        );
        if (end === "eof") observer.endEvents();
        else observer.child.kill("SIGTERM");
        await expect.poll(() => observer.child.exitCode, { timeout: 6000 }).not.toBeNull();
        expect((await observer.ended).code).toBe(end === "eof" ? 1 : 143);
        for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
        expect(sb.calls().filter(([cmd, sub]) => cmd === "systemctl" && sub === "stop")).toEqual(
          [],
        );
        if (end === "eof") expect(observer.stderr()).toContain("Wi-Fi change observer stopped.");
      } finally {
        await observer.stop();
      }
    },
    20000,
  );
});
