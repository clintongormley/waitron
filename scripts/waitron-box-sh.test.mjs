import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOX = join(HERE, "..", "deploy", "box");
const HANDLER = join(BOX, "waitron-box.sh");

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Built once for the file; each case's knobs travel as WB_* environment variables the stubs read.
// Every call is one line of WB_LOG: the command's name, then each argument after a tab, so a test
// can tell one argument holding a space from two arguments.
// timedatectl: `show` answers NTP=$WB_NTP and NTPSynchronized=$WB_SYNC; `set-time @<s>.<ms>` fails
// when WB_SETTIME_FAIL=1, otherwise records the new time for `date`, and when WB_SETTIME_REACHED
// names a file it creates it and sleeps WB_SETTIME_SLEEP seconds first, so a case can kill the
// handler mid-set; with WB_MARKER_SEEN set it copies the state folder's markers beside the log.
// systemctl: `is-active` succeeds for the units listed in WB_ACTIVE; `stop`
// rewrites the uptime file to WB_UPTIME_AFTER_STOP when set. date: `+%s%3N` answers the time
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
  show) printf 'NTP=%s\\nNTPSynchronized=%s\\n' "\${WB_NTP:-yes}" "\${WB_SYNC:-no}" ;;
  set-time)
    if [ -n "\${WB_SETTIME_REACHED}" ]; then : > "\${WB_SETTIME_REACHED}"; sleep "\${WB_SETTIME_SLEEP:-1}"; fi
    [ "\${WB_SETTIME_FAIL}" = 1 ] && { echo "Failed to set time" >&2; exit 1; }
    [ -n "\${WB_MARKER_SEEN}" ] && cat "\${WAITRON_BOX_STATE_DIR}"/stopped.* > "\${WB_LOG}.marker"
    t="\${2#@}"; printf '%s' "\${t/./}" > "\${WB_LOG}.now" ;;
esac
exit 0
`,
);
stub(
  "systemctl",
  `
case "$1" in
  is-active)
    u="\${!#}"
    for a in \${WB_ACTIVE}; do [ "$a" = "$u" ] && exit 0; done
    exit 3 ;;
  stop) [ -n "\${WB_UPTIME_AFTER_STOP}" ] && printf '%s 1.00\\n' "\${WB_UPTIME_AFTER_STOP}" > "\${WAITRON_BOX_UPTIME}" ;;
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
stub("touch", `case " $* " in *" -d "*) exit 0 ;; esac; exec "${REAL_TOUCH}" "$@"`);

function sandbox(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "waitron-box-case-"));
  dirs.push(dir);
  const units = join(dir, "ntp-units.d");
  mkdirSync(units);
  writeFileSync(join(units, "50-chrony.list"), "# the time service\nchrony.service\n");
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(join(dir, "uptime"), "100.00 200.00\n");
  writeFileSync(join(dir, "clock"), "");
  const synchronized = join(dir, "synchronized");
  writeFileSync(synchronized, "");
  const env = {
    PATH: `${STUB_BIN}${delimiter}${process.env.PATH}`,
    HOME: dir,
    WB_LOG: log,
    WB_ACTIVE: "chrony.service",
    WB_MTIME_MS: "1793425000123",
    WAITRON_BOX_NTP_UNITS_DIRS: units,
    WAITRON_BOX_UPTIME: join(dir, "uptime"),
    WAITRON_BOX_TIMESYNC_CLOCK: join(dir, "clock"),
    WAITRON_BOX_TIMESYNC_SYNCHRONIZED: synchronized,
    WAITRON_BOX_STATE_DIR: join(dir, "state"),
    ...extra,
  };
  return {
    dir,
    env,
    state: join(dir, "state"),
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

  it("answers a null last synchronisation when the time service never wrote its file", () => {
    const sb = sandbox();
    rmSync(sb.env.WAITRON_BOX_TIMESYNC_SYNCHRONIZED);
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

  it("answers request_invalid when no line arrives within the limit", async () => {
    const sb = sandbox({ WAITRON_BOX_READ_SECONDS: "1" });
    const child = spawn("bash", [HANDLER, "7-100-0"], { env: sb.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const code = await new Promise((resolve) => child.on("exit", resolve));
    child.stdin.end();
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({ ok: false, reason: "request_invalid" });
  }, 10_000);

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
      ["touch", "-d", "@1793425531.620", sb.env.WAITRON_BOX_TIMESYNC_CLOCK],
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

describe("waitron-box.sh --restore", () => {
  it("starts the unit a marker names when it is listed, then removes the marker", () => {
    const sb = sandbox();
    mkdirSync(sb.state);
    writeFileSync(join(sb.state, "stopped.7-100-0"), "chrony.service\n");
    const r = ask(sb, "", ["--restore", "7-100-0"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(sb.calls()).toEqual([["systemctl", "start", "chrony.service"]]);
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
  });

  it("starts nothing a marker names that is not a listed time service", () => {
    const sb = sandbox();
    mkdirSync(sb.state);
    writeFileSync(join(sb.state, "stopped.7-100-0"), "ssh.service\n");
    expect(ask(sb, "", ["--restore", "7-100-0"]).status).toBe(0);
    expect(sb.calls()).toEqual([]);
    expect(existsSync(join(sb.state, "stopped.7-100-0"))).toBe(false);
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
  const lines = (text) => text.split("\n").map((l) => l.trim());

  it("listen on the app's socket for one request per connection, readable only by the box's group", () => {
    expect(lines(socket())).toEqual(
      expect.arrayContaining([
        "ListenStream=/run/waitron-box/box.sock",
        "Accept=yes",
        "SocketMode=0660",
        "SocketUser=root",
        "SocketGroup=waitron-box",
        "MaxConnections=4",
      ]),
    );
  });

  it("run the handler with the request on the socket, its errors in the journal, for at most 15 seconds", () => {
    expect(lines(service())).toEqual(
      expect.arrayContaining([
        "StandardInput=socket",
        "StandardOutput=socket",
        "StandardError=journal",
        "RuntimeMaxSec=15",
        "ExecStart=/usr/local/lib/waitron/waitron-box.sh %i",
        "ExecStopPost=/usr/local/lib/waitron/waitron-box.sh --restore %i",
      ]),
    );
  });
});
