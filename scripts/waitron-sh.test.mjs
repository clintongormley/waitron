import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "deploy", "waitron.sh");

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The stub bin is built ONCE for the whole file. Executing a FRESHLY WRITTEN file costs about 120ms
// on macOS against about 12ms to execute the same file again (docs/developers/testing-guide.md).
// Nothing in the bin is per-case state — the knobs travel as WT_* environment variables the stubs
// read at run time.
//
// The docker stub reads a compose call only after dropping `compose` and one leading `-f <file>`,
// because that file's path carries the sandbox's temporary folder, whose name the suite does not
// choose. It takes the subcommand by position and matches flags and names anywhere in the rest, so
// their order does not matter. A call whose first remaining word has no arm (an option ahead of the
// subcommand, or a subcommand nothing here answers) lands in the refusing arm and exits 97.
// Set WT_TRADING_ENV to "__ABSENT__" to model an unprovisioned box whose
// state volume has no trading.env. WT_HANG is the one knob that changes the shared stub's behaviour
// unconditionally: the `docker` stub sleeps that many seconds on EVERY invocation.
// `docker image inspect` reports an image absent when its name contains WT_IMAGE_MISSING, and
// `docker pull` fails when its arguments contain WT_IMAGE_PULL_FAIL; every other image is present.
// `systemctl` and `sudo` are stubbed so ensure_docker's `sudo -n systemctl enable --now docker` is a
// no-op and the suite is hermetic on Linux with or without passwordless sudo (not just on macOS,
// which has no systemctl). `aa-enabled`, `apparmor_parser` and `install` are stubbed for the same
// reason: `aa-enabled` answers "off" unless a case sets WT_AA_ENABLED, so an AppArmor host runs the
// suite as a Mac does, and `install` and `apparmor_parser` never write /etc/apparmor.d or load a
// profile into the running kernel. WT_AA_PARSE_FAIL makes `apparmor_parser` refuse the profile.
// `install` copies a file only when the destination is inside the case's own directory (WT_SANDBOX),
// which is where each case points the Bluetooth drop-in. `systemctl show … FragmentPath` answers
// WT_BT_UNIT, the path of a stand-in bluetooth.service, or nothing, as a host without Bluetooth
// does, and `systemctl show … DropInPaths` lists the `.conf` files in the drop-in's folder, sorted by
// name, so the drop-in counts only once it exists; WT_BT_RESTART_FAIL=1 makes every
// `systemctl restart bluetooth` fail, and =first only the first one in a case. `rm` is logged and
// then run for real. `mktemp` fails when its arguments contain WT_MKTEMP_FAIL, and otherwise runs
// the real one; `cp` does the same with WT_CP_FAIL. `cmp` exits 2, its status for trouble, when
// WT_CMP_FAIL=1, and is the one stub not logged (see `quietStub`). `curl` asked for the script itself
// copies WT_SELF_SCRIPT's file into the existing output file, keeping that file's mode as the real
// curl does, and fails when WT_SELF_FETCH_FAIL=1. Each case runs its OWN copy of the script
// (`sb.script`), because install may replace the copy it runs from.
const STUB_BIN = mkdtempSync(join(tmpdir(), "waitron-sh-bin-"));
afterAll(() => rmSync(STUB_BIN, { recursive: true, force: true }));

// Resolved to an absolute path because STUB_BIN is first on PATH — a bare `exec mv` would re-enter
// the `mv` stub.
const REAL_MV = spawnSync("bash", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();

// A newline inside an argument is logged as `\n`, so every call is exactly one line of the log.
function stub(name, body) {
  const p = join(STUB_BIN, name);
  writeFileSync(
    p,
    `#!/usr/bin/env bash\nnl=$'\\n'; esc='\\n'\nprintf '%s ' "${name}" >> "$WT_LOG"; printf '%s\\n' "\${*//$nl/$esc}" >> "$WT_LOG"\n${body}\n`,
  );
  chmodSync(p, 0o755);
}

stub(
  "docker",
  `
args="$*"
[ -n "\${WT_HANG}" ] && sleep "\${WT_HANG}"
case "$args" in
  "compose version"*) exit 0 ;;
esac
case "$1" in
  compose)
    shift
    [ "$1" = "-f" ] && shift 2
    args="$*"
    case "$1" in
      pull)
        # Mimics real compose, which exits 0 on a failed pull when given --ignore-pull-failures
        # (probed on Compose v5.1.0). install must not pass the flag; if it does, this stub exits 0
        # and the pull-failure test fails.
        case "$args" in *--ignore-pull-failures*) exit 0 ;; esac
        [ "\${WT_PULL_FAIL}" = "1" ] && exit 1 ;;
      ps)
        # WT_DOCKER_PS_PENDING probes answer empty before the box reports WT_DOCKER_PS: a container
        # that has no health verdict yet. The counter is a file in the case's own directory, so cases
        # cannot see each other's, and it is what the probe-count assertions read.
        n=$(cat "\${WT_LOG}.probes" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "\${WT_LOG}.probes"
        if [ "$n" -le "\${WT_DOCKER_PS_PENDING:-0}" ]; then echo ""; else echo "\${WT_DOCKER_PS}"; fi ;;
      logs)
        [ "\${WT_AHEAD_LOGS}" = "1" ] && echo "provisioning.database_ahead: the database is newer" ;;
      run)
        # Every throwaway container the script runs against the state volume is built from the APP
        # image, whose ENTRYPOINT is node /app/node-entry.js. An invocation that does not override it
        # has its arguments APPENDED to that entrypoint, which refuses them instead of reading the
        # volume: the server.boot_failed line below on stdout and exit 1.
        case "$args" in
          *--entrypoint*) ;;
          *) echo '{"errorCode":"server.entry_arguments_refused","event":"server.boot_failed"}'; exit 1 ;;
        esac
        [ "\${WT_READ_ERROR}" = "1" ] && exit 1
        # Answered by what the command NAMES, so a read pointed at the wrong file reads empty.
        case "$args" in
          *venue.db*) echo "\${WT_DB_STAMP}" ;;
          *trading.env*) echo "\${WT_TRADING_ENV}" ;;
        esac ;;
      exec)
        # Nothing on a box answers psql any more — the storage is a file, and no cluster on it
        # carries a database named waitron. No shipped command reaches this arm; it is kept as a trap
        # for the one route back it can see: a stamp read rewritten as docker compose exec ... psql,
        # which ERRORS here rather than reading an empty stamp as "nothing there". That is ALL it
        # catches — a client reintroduced as docker run postgres, or as compose run --entrypoint
        # psql, is taken by another arm or by none, and reads as a clean empty stamp.
        case "$args" in *psql*) exit 1 ;; esac ;;
      config)
        # A fixed set of image names, one per line, the shape real compose prints.
        case "$args" in
          *--images*) printf '%s\\n' waitron:stub axllent/mailpit:v1.31.2 waitron-print-agent:stub ;;
          *) echo "docker stub: no arm for compose $args" >&2; exit 97 ;;
        esac ;;
      up|down) ;;
      *) echo "docker stub: no arm for compose $args" >&2; exit 97 ;;
    esac ;;
  image)
    if [ "$2" = inspect ] && [ -n "\${WT_IMAGE_MISSING}" ]; then
      case "$args" in *"\${WT_IMAGE_MISSING}"*) exit 1 ;; esac
    fi ;;
  pull)
    if [ -n "\${WT_IMAGE_PULL_FAIL}" ]; then
      case "$args" in *"\${WT_IMAGE_PULL_FAIL}"*) exit 1 ;; esac
    fi ;;
  volume)
    case "$2" in
      inspect) exit 0 ;;
      rm)
        if [ -n "\${WT_RM_FAIL}" ]; then
          case "$args" in *"waitron_\${WT_RM_FAIL}"*) exit 1 ;; esac
        fi
        exit 0 ;;
    esac ;;
esac
exit 0
`,
);
stub("mv", `[ "\${WT_MV_FAIL}" = "1" ] && exit 1\nexec "${REAL_MV}" "$@"`);
stub(
  "curl",
  `
out=""; url=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; -*) shift;; *) url="$1"; shift;; esac; done
case "$url" in
  */deploy/waitron.sh)
    [ "\${WT_SELF_FETCH_FAIL}" = "1" ] && exit 22
    cp "\${WT_SELF_SCRIPT}" "$out"; exit 0 ;;
esac
[ -n "$out" ] && printf 'stub\\n' > "$out"
exit 0
`,
);
const REAL_RM = spawnSync("bash", ["-c", "command -v rm"], { encoding: "utf8" }).stdout.trim();
stub("rm", `exec "${REAL_RM}" "$@"`);
const REAL_MKTEMP = spawnSync("bash", ["-c", "command -v mktemp"], {
  encoding: "utf8",
}).stdout.trim();
stub(
  "mktemp",
  `case "$*" in *"\${WT_MKTEMP_FAIL:-__never__}"*) exit 1 ;; esac\nexec "${REAL_MKTEMP}" "$@"`,
);
const REAL_CP = spawnSync("bash", ["-c", "command -v cp"], { encoding: "utf8" }).stdout.trim();
stub("cp", `case "$*" in *"\${WT_CP_FAIL:-__never__}"*) exit 1 ;; esac\nexec "${REAL_CP}" "$@"`);
// Not logged: the Bluetooth case whose drop-in is already there expects no logged call ending with
// the drop-in's path, which a logged `cmp` against it would be.
function quietStub(name, body) {
  const p = join(STUB_BIN, name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(p, 0o755);
}
const REAL_CMP = spawnSync("bash", ["-c", "command -v cmp"], { encoding: "utf8" }).stdout.trim();
quietStub("cmp", `[ "\${WT_CMP_FAIL}" = "1" ] && exit 2\nexec "${REAL_CMP}" "$@"`);
stub("qrencode", "exit 0");
// `apt-get` fails, exiting 100 as apt does, for the first WT_APT_FAIL calls in a case, counted in a
// file beside the case's log. `timeout` and `gtimeout` drop the limit and run the rest.
stub(
  "apt-get",
  `n=$(cat "\${WT_LOG}.apt" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "\${WT_LOG}.apt"
[ "$n" -le "\${WT_APT_FAIL:-0}" ] && exit 100
exit 0`,
);
stub("timeout", `shift; exec "$@"`);
stub("gtimeout", `shift; exec "$@"`);
stub("aa-enabled", `[ "\${WT_AA_ENABLED}" = "1" ]`);
stub("apparmor_parser", `[ "\${WT_AA_PARSE_FAIL}" = "1" ] && exit 1; exit 0`);
stub(
  "install",
  `
dest="\${@: -1}"
case "$dest" in
  "\${WT_SANDBOX}"/*) if [ "$1" = "-d" ]; then mkdir -p "$dest"; else cp "\${@: -2:1}" "$dest"; fi ;;
esac
exit 0
`,
);
stub(
  "systemctl",
  `
case "$*" in
  "show -p FragmentPath --value bluetooth.service") [ -n "\${WT_BT_UNIT}" ] && echo "\${WT_BT_UNIT}" ;;
  "show -p DropInPaths --value bluetooth.service")
    find "$(dirname "\${WAITRON_SH_BLUETOOTH_DROPIN}")" -maxdepth 1 -name '*.conf' 2>/dev/null | LC_ALL=C sort | tr '\n' ' ' ;;
  "restart bluetooth")
    n=$(cat "\${WT_LOG}.restarts" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "\${WT_LOG}.restarts"
    [ "\${WT_BT_RESTART_FAIL}" = "1" ] && exit 1
    [ "\${WT_BT_RESTART_FAIL}" = "first" ] && [ "$n" = "1" ] && exit 1 ;;
esac
exit 0
`,
);
// as_root calls `sudo -n <cmd>`; drop the -n and exec the rest so it lands on the stubbed systemctl.
stub("sudo", `[ "$1" = "-n" ] && shift; exec "$@"`);

// Git exports GIT_DIR to every hook, and `.husky/pre-push` runs this suite: a fixture repository made
// with it inherited would be made somewhere else.
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

function isolatedGitEnv() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  return env;
}

function sandbox({
  tradingEnv = "",
  dbStamp = "",
  aheadLogs = false,
  dockerPs = "healthy",
  dockerPsPending = 0,
  readError = false,
  rmFail = "",
  envWriteFail = false,
  pullFail = false,
  hang = "",
  apparmor = false,
  apparmorParseFail = false,
  bluetoothExecStart = null,
  bluetoothRestartFail = false,
  bluetoothDropIns = {},
  mktempFail = "",
  cpFail = "",
  cmpFail = false,
  runningScript = "repo",
  refScript = "repo",
  scriptInCheckout = false,
  viaSymlink = false,
  selfFetchFail = false,
  selfReplaceFail = false,
  imageMissing = "",
  imagePullFail = "",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "waitron-sh-"));
  dirs.push(root);
  const boxDir = join(root, "box");
  const log = join(root, "calls.log");
  mkdirSync(boxDir, { recursive: true });
  // runningScript is the copy the case runs and refScript the one the ref serves. "repo" is this
  // repository's script; "marked" is that plus a line logging `waitron.sh-start` and each argument
  // in <>, so a case can count the runs and see where each argument begins and ends. "pre-reset"
  // stands in for a ref whose waitron.sh predates `--reset`: it logs its start as "marked" does, exits
  // 0 when its first argument is `install`, and otherwise refuses that argument as an unknown
  // command, which is what such a copy does with `--reset`.
  const startLine = `printf 'waitron.sh-start %s\\n' "$(printf '<%s>' "$@")" >> "$WT_LOG"\n`;
  const marked = join(root, "marked-waitron.sh");
  writeFileSync(
    marked,
    readFileSync(SCRIPT, "utf8").replace("set -euo pipefail\n", `set -euo pipefail\n${startLine}`),
  );
  const preReset = join(root, "pre-reset-waitron.sh");
  writeFileSync(
    preReset,
    `#!/usr/bin/env bash\n${startLine}[ "$1" = install ] && exit 0\necho "waitron.sh: unknown command '$1'" >&2\nexit 2\n`,
  );
  const pick = (which) => ({ marked, "pre-reset": preReset })[which] ?? SCRIPT;
  // scriptInCheckout: "repository" makes the checkout with `git init`; "worktree" writes the `.git`
  // FILE a linked worktree has, pointing nowhere, with no git involved.
  const scriptDir = scriptInCheckout ? join(root, "checkout", "deploy") : root;
  mkdirSync(scriptDir, { recursive: true });
  if (scriptInCheckout === "repository") {
    const init = spawnSync("git", ["init", "-q", join(root, "checkout")], {
      encoding: "utf8",
      env: isolatedGitEnv(),
    });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  } else if (scriptInCheckout === "worktree") {
    writeFileSync(join(root, "checkout", ".git"), `gitdir: ${join(root, "elsewhere")}\n`);
  }
  const script = join(scriptDir, "waitron.sh");
  copyFileSync(pick(runningScript), script);
  let entry = script;
  if (viaSymlink) {
    mkdirSync(join(root, "bin"));
    entry = join(root, "bin", "waitron.sh");
    symlinkSync(script, entry);
  }
  let unit = "";
  if (bluetoothExecStart !== null) {
    unit = join(root, "bluetooth.service");
    writeFileSync(
      unit,
      `[Unit]\nDescription=Bluetooth service\n\n[Service]\nType=dbus\nBusName=org.bluez\nExecStart=${bluetoothExecStart}\n`,
    );
  }
  const dropIn = join(root, "bluetooth.service.d", "waitron-noautopair.conf");
  // Other drop-ins of bluetooth.service, by file name: written beside ours before the case runs.
  for (const [name, body] of Object.entries(bluetoothDropIns)) {
    mkdirSync(dirname(dropIn), { recursive: true });
    writeFileSync(join(dirname(dropIn), name), body);
  }
  return {
    boxDir,
    log,
    root,
    dropIn,
    script,
    scriptDir,
    entry,
    env: {
      WT_SELF_SCRIPT: pick(refScript),
      WT_SELF_FETCH_FAIL: selfFetchFail ? "1" : "0",
      WT_CMP_FAIL: cmpFail ? "1" : "0",
      WT_CP_FAIL: cpFail,
      WT_SANDBOX: root,
      WT_BT_UNIT: unit,
      WT_BT_RESTART_FAIL: bluetoothRestartFail === true ? "1" : bluetoothRestartFail || "0",
      WT_MKTEMP_FAIL: mktempFail,
      WAITRON_SH_BLUETOOTH_DROPIN: dropIn,
      WT_LOG: log,
      WT_TRADING_ENV: tradingEnv,
      WT_DB_STAMP: dbStamp,
      WT_AHEAD_LOGS: aheadLogs ? "1" : "0",
      WT_DOCKER_PS: dockerPs,
      WT_DOCKER_PS_PENDING: String(dockerPsPending),
      WT_READ_ERROR: readError ? "1" : "0",
      WT_RM_FAIL: rmFail,
      WT_MV_FAIL: envWriteFail || selfReplaceFail ? "1" : "0",
      WT_PULL_FAIL: pullFail ? "1" : "0",
      WT_HANG: hang,
      WT_AA_ENABLED: apparmor ? "1" : "0",
      WT_AA_PARSE_FAIL: apparmorParseFail ? "1" : "0",
      WT_IMAGE_MISSING: imageMissing,
      WT_IMAGE_PULL_FAIL: imagePullFail,
    },
  };
}

// Two budgets, protecting against different failures. Vitest's per-test timeout bounds how long the
// whole TEST may take, and a test it fails for its duration alone is a healthy run reported as
// broken. Every `run()` case below makes exactly ONE `run()` call and does no other slow work, so bounding
// the test above the spawn timeout covers that side. That reasoning is about THIS suite, not a
// general rule: a test that waits twice can outlast such a bound. Guard:
// `scripts/spawn-timeout-budget.test.ts`.
//
// spawnSync's timeout is the OTHER side, and it kills a child that is still working. It therefore
// has to clear the child's own worst case: `wait_healthy` in `deploy/waitron.sh` retries for about
// three minutes by default, which no per-test bound can rescue. `WAITRON_SH_HEALTH_DELAY` below
// shrinks that budget for every case while leaving the retrying in place. Receipt in
// `docs/developers/testing-guide.md`.
const RUN_TIMEOUT_MS = 20_000;
vi.setConfig({ testTimeout: RUN_TIMEOUT_MS + 10_000 });

function run(sb, args, extraEnv = {}, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const result = spawnSync("bash", [sb.entry, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${STUB_BIN}${delimiter}${process.env.PATH}`,
      WAITRON_DIR: sb.boxDir,
      // The child's whole health-retry budget, shrunk from ~175s to ~2s.
      WAITRON_SH_HEALTH_DELAY: "0.05",
      ...sb.env,
      ...extraEnv,
    },
    timeout: timeoutMs,
  });
  // A child killed by that timeout comes back with `status: null`, and every case below asserts on
  // `status` — so the whole report would read `expected null to be +0`, naming neither the run nor
  // the command that hung.
  if (result.error) {
    const recorded = existsSync(sb.log)
      ? readFileSync(sb.log, "utf8").trimEnd().split("\n").slice(-5)
      : [];
    // `error` covers more than the timeout kill — a missing interpreter arrives here as ENOENT with
    // no signal at all.
    const timedOut = result.error.code === "ETIMEDOUT";
    throw new Error(
      (timedOut
        ? `waitron.sh ${args.join(" ")} did not finish within ${timeoutMs}ms ` +
          `(ETIMEDOUT, killed with ${result.signal}). `
        : `waitron.sh ${args.join(" ")} could not be run (${result.error.code}). `) +
        `Last stub calls:\n  ${recorded.join("\n  ") || "(none recorded)"}`,
    );
  }
  return result;
}

// Every recorded call, in order. A `docker compose` call is shortened to `compose` and the rest, less
// the box's own `-f <compose file>`, which is removed by its exact path because the path carries the
// sandbox's temporary folder.
function loggedCalls(sb) {
  const boxFile = `-f ${join(sb.boxDir, "compose.yml")} `;
  return readFileSync(sb.log, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) =>
      line.startsWith("docker compose ")
        ? `compose ${line.slice("docker compose ".length).replace(boxFile, "")}`
        : line,
    );
}

// The `compose` calls loggedCalls reads, without that word. A match anchored at the start reads the
// subcommand only while nothing else precedes it, so a check that a subcommand never ran looks for its
// word anywhere in the call.
function composeCalls(sb) {
  return loggedCalls(sb)
    .filter((call) => call.startsWith("compose "))
    .map((call) => call.slice("compose ".length));
}

describe("waitron.sh install (published main)", () => {
  it("pulls, starts, records no image override, and prints the links", () => {
    const sb = sandbox();
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const compose = composeCalls(sb);
    expect(compose).toContainEqual(expect.stringMatching(/^pull\b/));
    expect(compose).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
    // No .env AT ALL: this path records no image override, so nothing asks install to write the file.
    expect(existsSync(join(sb.boxDir, ".env"))).toBe(false);
    expect(r.stdout).toContain("https://waitron.local/manage/email");
    expect(r.stdout).not.toContain("http://waitron.local:9110");
    expect(r.stdout).toContain("http://waitron.local/setup/trust");
    expect(r.stdout).toContain("https://waitron.local/setup/trust");
  });
});

describe("waitron.sh install (published main) when the pull fails", () => {
  it("stops with a message naming the likely causes and never starts the containers", () => {
    const sb = sandbox({ pullFail: true });
    const r = run(sb, ["install"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("could not pull the box's images");
    expect(r.stderr).toContain("registries");
    expect(r.stderr).toContain("architecture");
    const compose = composeCalls(sb);
    expect(compose).toContainEqual(expect.stringMatching(/^pull\b/));
    expect(compose.filter((call) => call.split(/\s+/).includes("up"))).toEqual([]);
  });
});

describe("waitron.sh install <ref>", () => {
  it("builds both images from the git context and records them in .env", () => {
    const sb = sandbox();
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(
      /docker build .*-f deploy\/Dockerfile .*github\.com\/clintongormley\/waitron\.git#my-branch/,
    );
    expect(calls).toMatch(/docker build .*--target print-agent .*waitron\.git#my-branch/);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toMatch(/^WAITRON_IMAGE=waitron:my-branch$/m);
    expect(env).toMatch(/^WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:my-branch$/m);
  });
});

describe("waitron.sh install keeps the box's own copy of waitron.sh current", () => {
  const calls = (sb) => readFileSync(sb.log, "utf8").trimEnd().split("\n");
  const selfUrl = (ref) =>
    `https://raw.githubusercontent.com/clintongormley/waitron/${ref}/deploy/waitron.sh`;
  const selfFetches = (sb, ref) =>
    calls(sb).filter((c) => c.startsWith("curl ") && c.split(" ").includes(selfUrl(ref)));
  const starts = (sb) => calls(sb).filter((c) => c.startsWith("waitron.sh-start "));
  const ups = (sb) => composeCalls(sb).filter((c) => /^up -d /.test(c));
  const tempFiles = (sb) => readdirSync(sb.scriptDir).filter((n) => n.startsWith(".waitron.sh."));

  it("replaces its copy with the ref's newer script, by a rename, and runs install again from it once, with the same arguments", () => {
    const sb = sandbox({ refScript: "marked" });
    const inodeBefore = statSync(sb.script).ino;
    const r = run(sb, ["install", "my-branch", "a second argument"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.script, "utf8")).toBe(readFileSync(sb.env.WT_SELF_SCRIPT, "utf8"));
    // A new file moved into place, not the running file written over: bash is still reading it.
    expect(statSync(sb.script).ino).not.toBe(inodeBefore);
    const rerun = "waitron.sh-start <install><my-branch><a second argument>";
    const log = calls(sb);
    const fetched = log.findIndex((c) => c.startsWith("curl ") && c.includes(selfUrl("my-branch")));
    const reran = log.indexOf(rerun);
    const firstDocker = log.findIndex((c) => c.startsWith("docker "));
    expect(fetched).toBeGreaterThanOrEqual(0);
    expect(reran).toBeGreaterThan(fetched);
    // The old copy made no docker call before handing over.
    expect(firstDocker).toBeGreaterThan(reran);
    expect(starts(sb)).toEqual([rerun]);
    // The new copy does not fetch itself again.
    expect(selfFetches(sb, "my-branch")).toHaveLength(1);
    expect(ups(sb)).toHaveLength(1);
    expect(r.stdout).toContain("updated");
    expect(tempFiles(sb)).toEqual([]);
  });

  it("carries on with the running copy, and does not run install again, when the ref's script is the same", () => {
    const sb = sandbox({ runningScript: "marked", refScript: "marked" });
    const before = readFileSync(sb.script, "utf8");
    const inodeBefore = statSync(sb.script).ino;
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(selfFetches(sb, "main")).toHaveLength(1);
    expect(starts(sb)).toEqual(["waitron.sh-start <install>"]);
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(statSync(sb.script).ino).toBe(inodeBefore);
    expect(r.stdout).not.toContain("updated");
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });

  it("carries on with the running copy, and says so, when the ref's script cannot be fetched", () => {
    const sb = sandbox({ selfFetchFail: true });
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).toBe(0);
    expect(selfFetches(sb, "my-branch")).toHaveLength(1);
    expect(r.stderr).toContain("could not fetch waitron.sh from my-branch");
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });

  it("does not fetch itself when it is already the re-run", () => {
    const sb = sandbox({ refScript: "marked" });
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["install"], { WAITRON_SH_REFRESHED: "1" });
    expect(r.status).toBe(0);
    expect(selfFetches(sb, "main")).toEqual([]);
    expect(readFileSync(sb.script, "utf8")).toBe(before);
  });

  it.each([
    ["a repository made by git init", "repository"],
    ["a worktree, whose .git is a file", "worktree"],
  ])(
    "leaves its copy alone, and says so, when it runs from a folder below %s",
    (_, scriptInCheckout) => {
      const sb = sandbox({ scriptInCheckout, refScript: "marked" });
      const before = readFileSync(sb.script, "utf8");
      const r = run(sb, ["install"]);
      expect(r.status).toBe(0);
      expect(selfFetches(sb, "main")).toEqual([]);
      expect(r.stderr).toContain(
        `waitron.sh: running from a git checkout, so not replacing ${sb.script} with main's waitron.sh`,
      );
      expect(readFileSync(sb.script, "utf8")).toBe(before);
      expect(starts(sb)).toEqual([]);
      expect(ups(sb)).toHaveLength(1);
      expect(tempFiles(sb)).toEqual([]);
    },
  );

  // Its owner and group are kept too when run as root; a suite not running as root cannot show that.
  it("gives the new copy the old copy's mode", () => {
    const sb = sandbox({ refScript: "marked" });
    chmodSync(sb.script, 0o640);
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.script, "utf8")).toBe(readFileSync(sb.env.WT_SELF_SCRIPT, "utf8"));
    expect(statSync(sb.script).mode & 0o7777).toBe(0o640);
    expect(starts(sb)).toEqual(["waitron.sh-start <install>"]);
  });

  it("updates the file a symlink points at, and leaves the symlink a symlink", () => {
    const sb = sandbox({ viaSymlink: true, refScript: "marked" });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(lstatSync(sb.entry).isSymbolicLink()).toBe(true);
    expect(readlinkSync(sb.entry)).toBe(sb.script);
    expect(readFileSync(sb.script, "utf8")).toBe(readFileSync(sb.env.WT_SELF_SCRIPT, "utf8"));
    expect(starts(sb)).toEqual(["waitron.sh-start <install>"]);
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });

  it("carries on with the running copy, and says so, when it cannot create a temp file beside it", () => {
    const sb = sandbox({ refScript: "marked", mktempFail: ".waitron.sh." });
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`could not create a temp file beside ${sb.script}`);
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(starts(sb)).toEqual([]);
    expect(ups(sb)).toHaveLength(1);
  });

  // The published-main install with no .env reaches no other `mv`, so WT_MV_FAIL fails this one alone.
  it("carries on with the running copy, and says so, when the rename over it fails", () => {
    const sb = sandbox({ refScript: "marked", selfReplaceFail: true });
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`could not replace ${sb.script} with main's waitron.sh`);
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(starts(sb)).toEqual([]);
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });

  it("carries on with the running copy, and says so, when the comparison itself fails", () => {
    const sb = sandbox({ runningScript: "marked", refScript: "marked", cmpFail: true });
    const inodeBefore = statSync(sb.script).ino;
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`could not compare ${sb.script} with main's waitron.sh`);
    expect(statSync(sb.script).ino).toBe(inodeBefore);
    expect(starts(sb)).toEqual(["waitron.sh-start <install>"]);
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });

  it("carries on with the running copy, and says so, when it cannot copy itself to a temp file", () => {
    const sb = sandbox({ refScript: "marked", cpFail: ".waitron.sh." });
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`could not copy ${sb.script} to a temp file beside it`);
    expect(selfFetches(sb, "main")).toEqual([]);
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(starts(sb)).toEqual([]);
    expect(ups(sb)).toHaveLength(1);
    expect(tempFiles(sb)).toEqual([]);
  });
});

describe("waitron.sh install and the print agent's AppArmor profile", () => {
  const calls = (sb) => readFileSync(sb.log, "utf8").trimEnd().split("\n");
  const PROFILE = "/etc/apparmor.d/waitron-print-agent";

  it("fetches the installed ref's profile, loads it, and names it in .env before starting", () => {
    const sb = sandbox({ apparmor: true });
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).toBe(0);
    const log = calls(sb);
    const profileUrl =
      "https://raw.githubusercontent.com/clintongormley/waitron/my-branch/deploy/apparmor/waitron-print-agent";
    const fetched = log.findIndex(
      (c) => c.startsWith("curl ") && c.split(" ").some((arg) => arg === profileUrl),
    );
    const installed = log.findIndex(
      (c) => c.startsWith("install -m 0644 ") && c.endsWith(` ${PROFILE}`),
    );
    const loaded = log.indexOf(`apparmor_parser -r ${PROFILE}`);
    const up = log.findIndex((c) => c.startsWith("docker compose") && / up -d /.test(`${c} `));
    expect(fetched).toBeGreaterThanOrEqual(0);
    expect(installed).toBeGreaterThan(fetched);
    expect(loaded).toBeGreaterThan(installed);
    expect(up).toBeGreaterThan(loaded);
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toMatch(
      /^WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent$/m,
    );
  });

  it("falls back to Docker's default profile, and says so, when the profile will not load", () => {
    const sb = sandbox({ apparmor: true, apparmorParseFail: true });
    writeFileSync(join(sb.boxDir, ".env"), "WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent\n");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("could not load the print agent's AppArmor profile");
    expect(r.stderr).toContain("Docker's default profile");
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).not.toContain(
      "WAITRON_PRINT_AGENT_APPARMOR",
    );
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
  });

  it("names no profile, and loads none, on a host without AppArmor", () => {
    const sb = sandbox();
    writeFileSync(join(sb.boxDir, ".env"), "WAITRON_PRINT_AGENT_APPARMOR=waitron-print-agent\n");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const log = calls(sb);
    expect(
      log.filter((c) => c.startsWith("apparmor_parser") || c.includes("deploy/apparmor/")),
    ).toEqual([]);
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).not.toContain(
      "WAITRON_PRINT_AGENT_APPARMOR",
    );
  });
});

describe("waitron.sh install and bluetoothd's autopair plugin", () => {
  const calls = (sb) => readFileSync(sb.log, "utf8").trimEnd().split("\n");
  // The drop-in's last two lines: an empty ExecStart= clears the unit's own, then the replacement.
  const dropInFor = (execStart) => `ExecStart=\nExecStart=${execStart} --noplugin=autopair\n`;

  it("re-sets ExecStart to the host's own bluetoothd with autopair off, then reloads and restarts Bluetooth", () => {
    const sb = sandbox({ bluetoothExecStart: "/usr/lib/bluetooth/bluetoothd" });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const dropIn = readFileSync(sb.dropIn, "utf8");
    expect(dropIn).toMatch(/^\[Service\]$/m);
    expect(dropIn.endsWith(dropInFor("/usr/lib/bluetooth/bluetoothd"))).toBe(true);
    const log = calls(sb);
    const installed = log.findIndex(
      (c) => c.startsWith("install -m 0644 ") && c.endsWith(sb.dropIn),
    );
    const reloaded = log.indexOf("systemctl daemon-reload");
    const restarted = log.indexOf("systemctl restart bluetooth");
    const up = log.findIndex((c) => c.startsWith("docker compose") && / up -d /.test(`${c} `));
    expect(installed).toBeGreaterThanOrEqual(0);
    expect(reloaded).toBeGreaterThan(installed);
    expect(restarted).toBeGreaterThan(reloaded);
    expect(up).toBeGreaterThan(restarted);
    expect(r.stdout).toContain("autopair");
  });

  it("keeps the arguments the host's unit already passes", () => {
    const sb = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd -E" });
    expect(run(sb, ["install"]).status).toBe(0);
    expect(
      readFileSync(sb.dropIn, "utf8").endsWith(dropInFor("/usr/libexec/bluetooth/bluetoothd -E")),
    ).toBe(true);
  });

  it("does not restart Bluetooth when the drop-in it would write is already there", () => {
    const first = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd" });
    expect(run(first, ["install"]).status).toBe(0);
    const sb = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd" });
    mkdirSync(dirname(sb.dropIn), { recursive: true });
    writeFileSync(sb.dropIn, readFileSync(first.dropIn, "utf8"));
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const log = calls(sb);
    expect(log.filter((c) => c.endsWith(sb.dropIn))).toEqual([]);
    expect(log).not.toContain("systemctl daemon-reload");
    expect(log).not.toContain("systemctl restart bluetooth");
  });

  it("rewrites a drop-in whose content differs, and restarts Bluetooth", () => {
    const sb = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd" });
    mkdirSync(dirname(sb.dropIn), { recursive: true });
    writeFileSync(
      sb.dropIn,
      "[Service]\nExecStart=\nExecStart=/usr/sbin/bluetoothd --noplugin=autopair\n",
    );
    expect(run(sb, ["install"]).status).toBe(0);
    expect(
      readFileSync(sb.dropIn, "utf8").endsWith(dropInFor("/usr/libexec/bluetooth/bluetoothd")),
    ).toBe(true);
    expect(calls(sb)).toContain("systemctl restart bluetooth");
  });

  it("says so in one line, and changes nothing, on a host with no bluetooth.service", () => {
    const sb = sandbox();
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter((l) => l.includes("bluetooth.service"))).toHaveLength(1);
    expect(existsSync(sb.dropIn)).toBe(false);
    const log = calls(sb);
    expect(log).not.toContain("systemctl daemon-reload");
    expect(log).not.toContain("systemctl restart bluetooth");
  });

  it("leaves a unit that already chooses its plugins alone, and says so", () => {
    const sb = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd --noplugin=sap" });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("--noplugin=sap");
    expect(existsSync(sb.dropIn)).toBe(false);
    expect(calls(sb)).not.toContain("systemctl restart bluetooth");
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
  });

  // The stand-in systemctl lists drop-ins by name, so "override.conf" (what `systemctl edit` writes)
  // comes before ours and "zz-override.conf" after it.
  const beside = (sb, name) => join(dirname(sb.dropIn), name);
  const writeOurs = (sb) => {
    const ours = "[Service]\nExecStart=\nExecStart=/usr/sbin/bluetoothd --noplugin=autopair\n";
    mkdirSync(dirname(sb.dropIn), { recursive: true });
    writeFileSync(sb.dropIn, ours);
    return ours;
  };

  it("leaves Bluetooth alone, and names the file, when another drop-in sets ExecStart", () => {
    const sb = sandbox({
      bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
      bluetoothDropIns: {
        "override.conf":
          "[Service]\nExecStart=\nExecStart=/usr/libexec/bluetooth/bluetoothd --experimental\n",
      },
    });
    const other = beside(sb, "override.conf");
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(
      `could not switch off bluetoothd's autopair plugin — ${other} also sets bluetooth.service's ExecStart; left as it is`,
    );
    expect(existsSync(sb.dropIn)).toBe(false);
    const log = calls(sb);
    expect(log.filter((c) => c.endsWith(sb.dropIn))).toEqual([]);
    expect(log).not.toContain("systemctl daemon-reload");
    expect(log).not.toContain("systemctl restart bluetooth");
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
  });

  // The same message whichever of the two files comes first in the listing.
  const leftAsItIs = (sb, other, sets, depends) =>
    `waitron.sh: left Bluetooth as it is — ${other} ${sets}, and ${sb.dropIn} from an earlier install is still there, so which command bluetoothd runs ${depends} on both files ('systemctl cat bluetooth' shows them); to keep only ${other}'s command, delete ${sb.dropIn}, then run 'systemctl daemon-reload' and 'systemctl restart bluetooth'`;
  const override = "[Service]\nExecStart=\nExecStart=/usr/sbin/bluetoothd -E\n";

  for (const name of ["override.conf", "zz-override.conf"]) {
    it(`keeps a drop-in an earlier install wrote, and says both files decide the command, when ${name} also sets ExecStart`, () => {
      const sb = sandbox({
        bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
        bluetoothDropIns: { [name]: override },
      });
      const ours = writeOurs(sb);
      const other = beside(sb, name);
      const r = run(sb, ["install"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain(
        `${leftAsItIs(sb, other, "also sets bluetooth.service's ExecStart", "depends")}\n`,
      );
      expect(r.stderr).not.toContain("could not switch off");
      expect(readFileSync(sb.dropIn, "utf8")).toBe(ours);
      const log = calls(sb);
      expect(log.filter((c) => c.endsWith(sb.dropIn))).toEqual([]);
      expect(log).not.toContain("systemctl daemon-reload");
      expect(log).not.toContain("systemctl restart bluetooth");
    });
  }

  // Root reads a file whatever its mode, so the case cannot make an unreadable one there.
  it.skipIf(process.getuid?.() === 0)(
    "keeps a drop-in an earlier install wrote, and says both files may decide the command, when another drop-in cannot be read",
    () => {
      const sb = sandbox({
        bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
        bluetoothDropIns: { "override.conf": override },
      });
      const ours = writeOurs(sb);
      const other = beside(sb, "override.conf");
      chmodSync(other, 0o000);
      const r = run(sb, ["install"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain(
        `${leftAsItIs(sb, other, "could not be read and may set bluetooth.service's ExecStart", "may depend")}\n`,
      );
      expect(readFileSync(sb.dropIn, "utf8")).toBe(ours);
      const log = calls(sb);
      expect(log.filter((c) => c.endsWith(sb.dropIn))).toEqual([]);
      expect(log).not.toContain("systemctl daemon-reload");
      expect(log).not.toContain("systemctl restart bluetooth");
    },
  );

  // Root reads a file whatever its mode, so the case cannot make an unreadable one there.
  it.skipIf(process.getuid?.() === 0)(
    "leaves Bluetooth alone when it cannot read another drop-in, and says so",
    () => {
      const sb = sandbox({
        bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
        bluetoothDropIns: { "secret.conf": "[Service]\nExecStart=\nExecStart=/bin/true\n" },
      });
      const other = beside(sb, "secret.conf");
      chmodSync(other, 0o000);
      const r = run(sb, ["install"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toContain(`could not read ${other}`);
      expect(existsSync(sb.dropIn)).toBe(false);
      expect(calls(sb)).not.toContain("systemctl restart bluetooth");
    },
  );

  it("writes its drop-in when the other drop-ins set no ExecStart, and ignores its own", () => {
    const sb = sandbox({
      bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
      bluetoothDropIns: { "limits.conf": "[Service]\nLimitNOFILE=4096\n" },
    });
    writeOurs(sb);
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("autopair");
    expect(
      readFileSync(sb.dropIn, "utf8").endsWith(dropInFor("/usr/libexec/bluetooth/bluetoothd")),
    ).toBe(true);
    const log = calls(sb);
    expect(log).toContain("systemctl daemon-reload");
    expect(log).toContain("systemctl restart bluetooth");
  });

  it("carries on with the install when Bluetooth will not restart, and says so", () => {
    const sb = sandbox({
      bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
      bluetoothRestartFail: true,
    });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("could not switch off bluetoothd's autopair plugin");
    // The restart without the drop-in failed too, so Bluetooth may be down: say so, and how to recover.
    expect(r.stderr).toContain("Bluetooth may be stopped");
    expect(r.stderr).toContain("systemctl restart bluetooth");
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
  });

  it("removes a drop-in Bluetooth would not restart with, so the next install tries again", () => {
    const failed = sandbox({
      bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
      bluetoothRestartFail: "first",
    });
    const r = run(failed, ["install"]);
    expect(r.status).toBe(0);
    expect(existsSync(failed.dropIn)).toBe(false);
    // After the failed restart: remove the drop-in, reload, restart again — in that order.
    const log = calls(failed);
    const failedRestart = log.indexOf("systemctl restart bluetooth");
    const removed = log.indexOf(`rm -f ${failed.dropIn}`);
    const reloaded = log.lastIndexOf("systemctl daemon-reload");
    const restarted = log.lastIndexOf("systemctl restart bluetooth");
    expect(removed).toBeGreaterThan(failedRestart);
    expect(reloaded).toBeGreaterThan(removed);
    expect(restarted).toBeGreaterThan(reloaded);
    // That second restart worked, so there is no warning that Bluetooth may be down.
    expect(r.stderr).not.toContain("Bluetooth may be stopped");

    const retried = sandbox({ bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd" });
    writeFileSync(retried.log, "");
    // The same directory the failed run left: nothing there, so this install writes and restarts.
    retried.env.WAITRON_SH_BLUETOOTH_DROPIN = failed.dropIn;
    retried.env.WT_SANDBOX = failed.root;
    expect(run(retried, ["install"]).status).toBe(0);
    expect(existsSync(failed.dropIn)).toBe(true);
    expect(calls(retried)).toContain("systemctl restart bluetooth");
  });

  it("carries on with the install when it cannot make a temporary file, and says so", () => {
    const sb = sandbox({
      bluetoothExecStart: "/usr/libexec/bluetooth/bluetoothd",
      mktempFail: "waitron-noautopair",
    });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("could not switch off bluetoothd's autopair plugin");
    expect(existsSync(sb.dropIn)).toBe(false);
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^up -d --remove-orphans\b/));
  });
});

describe("waitron.sh health check", () => {
  // "unhealthy" contains "healthy": the whole health value must match, not a substring.
  it("does not report an unhealthy container as ready", () => {
    const sb = sandbox({ dockerPs: "unhealthy" });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not come up healthy/);
  });
  // Both cases below leave WAITRON_SH_MAX_HEALTH_TRIES alone, so they run the try count the script
  // ships, and both assert the probe COUNT — the status and the message alone are satisfied by a
  // child that never retries at all.
  const SHIPPED_TRIES = readFileSync(SCRIPT, "utf8").match(/WAITRON_SH_MAX_HEALTH_TRIES:-(\d+)/)[1];
  const probes = (sb) => readFileSync(`${sb.log}.probes`, "utf8").trim();

  it("retries while the container has no health verdict yet, then succeeds", () => {
    const sb = sandbox({ dockerPsPending: 1 });
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    expect(probes(sb)).toBe("2");
    expect(r.stdout).toContain("https://waitron.local/manage/email");
  });

  // This is the case that holds the spawn bound: delete `WAITRON_SH_HEALTH_DELAY` from `run()` and
  // the child retries for ~175s, so `spawnSync` kills it. The case above does NOT prove that.
  it("gives up with the unhealthy message after the shipped number of tries", () => {
    const sb = sandbox({ dockerPs: "starting" });
    const r = run(sb, ["install"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not come up healthy/);
    expect(probes(sb)).toBe(SHIPPED_TRIES);
  });
});

describe("waitron.sh install preserves .env on a failed write", () => {
  // An emptied .env loses the image the box is pinned to, after which a bare `docker compose up -d`
  // moves the box onto the published `:main` with no error anywhere.
  it("leaves .env unchanged (the pinned image kept) when the atomic rename fails", () => {
    const sb = sandbox({ envWriteFail: true });
    writeFileSync(join(sb.boxDir, ".env"), "WAITRON_IMAGE=waitron:previous\n");
    // A branch install rewrites .env (env_set WAITRON_IMAGE); the rename fails.
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).not.toBe(0);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toContain("WAITRON_IMAGE=waitron:previous");
    expect(env.length).toBeGreaterThan(0);
  });
});

describe("waitron.sh database_ahead advice", () => {
  // The try pin keeps these cases to one probe, so a failure here reads as the advice being wrong.
  it("tells a non-production box to reset", () => {
    const sb = sandbox({ dockerPs: "starting", aheadLogs: true });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("in one step: 'waitron.sh --reset install [ref]'");
  });

  it("never tells a production box to reset", () => {
    const sb = sandbox({
      dockerPs: "starting",
      aheadLogs: true,
      tradingEnv: "WAITRON_ENV=production",
    });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/newer ref/i);
    expect(r.stderr).not.toMatch(/waitron\.sh (--reset|reset)\b/);
  });
});

function installedBox(sb) {
  writeFileSync(join(sb.boxDir, "compose.yml"), "name: waitron\n");
  writeFileSync(join(sb.boxDir, ".env"), "WAITRON_IMAGE=waitron:pinned\n");
}

describe("waitron.sh reset", () => {
  it("refuses when the box was never installed", () => {
    const sb = sandbox();
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no box at/);
  });

  // `fetch_box_files` overwrites the installed compose.yml from the ref on EVERY install, so a box
  // upgrading past a change that retires a service meets a running container the new file no longer
  // declares, which a bare `up -d` or `down` leaves running. It is asked for on every lifecycle call
  // rather than once, so the NEXT retired service needs no new code.
  it("asks compose to remove orphans on every up and down it runs", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const lifecycle = composeCalls(sb).filter((call) => /^(up|down)\b/.test(call));
    // A reset takes the box down once and brings it up once; this also keeps the loop below from
    // checking nothing.
    expect(lifecycle.map((call) => call.split(" ")[0])).toEqual(["down", "up"]);
    for (const call of lifecycle) expect(call).toContain("--remove-orphans");
  });

  // Every throwaway container this script runs against the state volume runs the APP image, whose
  // ENTRYPOINT is `node /app/node-entry.js` (deploy/Dockerfile) — so an invocation that does not
  // override it has its arguments APPENDED to that entrypoint instead of reading the volume. A failed
  // trading.env read makes `is_production` fail CLOSED, so a demo box would refuse every reset as
  // production.
  it("overrides the image entrypoint on every container it runs against the state volume", () => {
    const sb = sandbox({ tradingEnv: "__ABSENT__" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    // `docker compose run`, not a bare `docker run`: compose resolves the image from the box's own
    // .env, so the helper is whichever image the box is actually running.
    const reads = composeCalls(sb).filter((call) => /trading\.env|-name tls/.test(call));
    // Both reads, or the filter has gone blind and the loop below would check nothing.
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read).toMatch(/^run\b.*--entrypoint /);
  });

  it("removes the transient volumes, empties state except tls, keeps .env", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    for (const v of ["logs", "backups", "mailpit", "print_agent"]) {
      expect(calls).toMatch(new RegExp(`docker volume rm .*waitron_${v}\\b`));
    }
    expect(calls).not.toMatch(/docker volume rm .*waitron_state\b/);
    expect(calls).not.toMatch(/docker volume rm .*waitron_media\b/);
    // The retired cluster's volume is deliberately left on disk, not removed: no
    // backwards-compatibility code before production (CLAUDE.md §3), and a stranded volume costs
    // disk and nothing else.
    expect(calls).not.toMatch(/docker volume rm .*waitron_db\b/);
    const compose = composeCalls(sb);
    expect(compose).toContainEqual(
      expect.stringMatching(
        /^run\b.*--entrypoint sh app -c find "\$\{WAITRON_STATE_DIR:\?\}" .*! -name tls/,
      ),
    );
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toContain("WAITRON_IMAGE=waitron:pinned");
    expect(compose).toContainEqual(expect.stringMatching(/^up -d\b/));
  });

  it("stops, naming --yes, when nobody can confirm and --yes was not given", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "reset needs confirmation — re-run with --yes for a non-interactive box",
    );
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  it("--all also removes the state volume", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--all", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_state\b/);
  });

  it("refuses on a production box (trading.env signal) and removes no volume", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(r.stderr).toContain("re-run with --force-production.");
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  // Refusal must also fire on the stamp signal alone (trading.env empty). The refusal alone does not
  // prove the stamp was READ — an unreadable stamp also refuses, by failing closed — so the case pins
  // the read itself: the stub answers only a command naming a venue.db, and the log has to show that
  // command.
  it("refuses on a production box (stamp signal) and removes no volume", () => {
    const sb = sandbox({ tradingEnv: "", dbStamp: "production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(composeCalls(sb)).toContainEqual(expect.stringMatching(/^run\b.*venue\.db/));
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  it("--force-production --yes proceeds on a production box", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--force-production", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_logs\b/);
  });

  // When neither signal can be read (both error), the environment cannot be established. An
  // irreversible wipe must fail CLOSED — treat it as production and refuse — rather than assume
  // "unreadable means empty".
  it("refuses when production status cannot be established (both reads error), removing no volume", () => {
    const sb = sandbox({ readError: true });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  // A genuinely unprovisioned box (trading.env ABSENT, stamp empty) is a successful read of "nothing
  // there", NOT an error — the demo/reset workflow must still proceed.
  it("proceeds on an unprovisioned box (trading.env absent, empty stamp)", () => {
    const sb = sandbox({ tradingEnv: "__ABSENT__", dbStamp: "" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_logs\b/);
  });

  // A failed removal must abort the reset BEFORE it reaches the volumes further down the loop or
  // empties state — otherwise a box whose wipe half-failed is restarted against surviving data with
  // its settings already gone. The volume made to fail is the one the loop reaches FIRST (`logs`),
  // and both negatives below name something strictly LATER than it: `backups` is the second entry
  // and the state-emptying find runs after the whole loop. Fail a later entry instead and the case
  // would prove nothing about aborting.
  it("aborts when a volume removal fails, before touching backups or state", () => {
    const sb = sandbox({ rmFail: "logs" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker volume rm .*waitron_logs\b/);
    expect(calls).not.toMatch(/docker volume rm .*waitron_backups\b/);
    expect(calls).not.toMatch(/! -name tls/);
  });
});

describe("waitron.sh --reset install", () => {
  const builds = (sb) => loggedCalls(sb).filter((c) => c.startsWith("docker build "));
  const removals = (sb) => loggedCalls(sb).filter((c) => c.startsWith("docker volume rm "));

  it("builds the new images, then wipes the box once, then starts it once on them", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["--reset", "--yes", "install", "my-branch"]);
    expect(r.status).toBe(0);
    const log = loggedCalls(sb);
    const lastBuild = log.findLastIndex((c) => c.startsWith("docker build "));
    const down = log.findIndex((c) => c.startsWith("compose down "));
    const firstRm = log.findIndex((c) => c.startsWith("docker volume rm "));
    const emptyState = log.findIndex((c) => c.includes("! -name tls"));
    const up = log.findIndex((c) => c.startsWith("compose up -d "));
    const mailpitCheck = log.indexOf("docker image inspect axllent/mailpit:v1.31.2");
    expect(lastBuild).toBeGreaterThanOrEqual(0);
    expect(mailpitCheck).toBeGreaterThan(lastBuild);
    expect(down).toBeGreaterThan(mailpitCheck);
    expect(firstRm).toBeGreaterThan(down);
    expect(emptyState).toBeGreaterThan(firstRm);
    expect(up).toBeGreaterThan(emptyState);
    const lifecycle = log.filter((c) => /^compose (up|down)\b/.test(c));
    expect(lifecycle.map((c) => c.split(" ")[1])).toEqual(["down", "up"]);
    const removed = removals(sb);
    for (const v of ["logs", "backups", "mailpit", "print_agent"]) {
      expect(removed).toContainEqual(expect.stringMatching(new RegExp(`waitron_${v}\\b`)));
    }
    expect(removed).not.toContainEqual(expect.stringMatching(/waitron_state\b/));
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toMatch(/^WAITRON_IMAGE=waitron:my-branch$/m);
    expect(r.stdout).toContain("https://waitron.local/setup/trust");
  });

  it("pulls a supporting image the box lacks before taking the box down", () => {
    const sb = sandbox({ imageMissing: "mailpit" });
    installedBox(sb);
    const r = run(sb, ["--reset", "--yes", "install", "my-branch"]);
    expect(r.status).toBe(0);
    const log = loggedCalls(sb);
    const pull = log.indexOf("docker pull axllent/mailpit:v1.31.2");
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(log.findIndex((c) => c.startsWith("compose down "))).toBeGreaterThan(pull);
  });

  it("stops before taking the box down when a supporting image it lacks cannot be pulled", () => {
    const sb = sandbox({ imageMissing: "mailpit", imagePullFail: "mailpit" });
    installedBox(sb);
    const r = run(sb, ["--reset", "--yes", "install", "my-branch"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "could not pull axllent/mailpit:v1.31.2, which the box needs — nothing was taken down or wiped, but the box's compose.yml and .env are already set for my-branch;",
    );
    expect(loggedCalls(sb)).not.toContainEqual(expect.stringMatching(/^compose (down|up)\b/));
    expect(removals(sb)).toEqual([]);
    expect(readFileSync(join(sb.boxDir, "compose.yml"), "utf8")).not.toBe("name: waitron\n");
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toMatch(
      /^WAITRON_IMAGE=waitron:my-branch$/m,
    );
  });

  it("leaves a plain branch install as it was: no supporting-image check", () => {
    const sb = sandbox({ imageMissing: "mailpit", imagePullFail: "mailpit" });
    installedBox(sb);
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).toBe(0);
    expect(loggedCalls(sb)).not.toContainEqual(
      expect.stringMatching(/^docker (image inspect|pull) /),
    );
  });

  it("--all also removes the state volume", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["--reset", "--all", "--yes", "install"]);
    expect(r.status).toBe(0);
    expect(removals(sb)).toContainEqual(expect.stringMatching(/waitron_state\b/));
  });

  // The production read runs the box's CURRENT image against its current compose.yml, so it has to
  // come before install fetches the box's files from the ref and builds or pulls its images — and a
  // refusal after a long build would waste it. The script's own update from the ref comes earlier.
  it("refuses on a production box before fetching the box's files or building, and wipes nothing", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["--reset", "--yes", "install", "my-branch"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(r.stderr).toContain(
      "If you are sure this box is not production, re-run with --force-production before install.",
    );
    expect(builds(sb)).toEqual([]);
    expect(removals(sb)).toEqual([]);
    expect(readFileSync(join(sb.boxDir, "compose.yml"), "utf8")).toBe("name: waitron\n");
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toBe("WAITRON_IMAGE=waitron:pinned\n");
  });

  it("--force-production --yes proceeds on a production box", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["--reset", "--force-production", "--yes", "install"]);
    expect(r.status).toBe(0);
    expect(removals(sb)).toContainEqual(expect.stringMatching(/waitron_logs\b/));
  });

  it("stops before building when nobody can confirm and --yes was not given", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["--reset", "install", "my-branch"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "--reset install needs confirmation — re-run with --yes before install for a non-interactive box",
    );
    expect(builds(sb)).toEqual([]);
    expect(removals(sb)).toEqual([]);
  });

  it("installs without wiping, and says so, when there is no box to reset", () => {
    const sb = sandbox();
    const r = run(sb, ["--reset", "--yes", "install"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("nothing to reset");
    expect(removals(sb)).toEqual([]);
    expect(loggedCalls(sb)).not.toContainEqual(expect.stringContaining("! -name tls"));
    expect(loggedCalls(sb).filter((c) => c.startsWith("compose up -d "))).toHaveLength(1);
  });

  it("keeps --reset and its options when it runs again from the ref's newer copy, and wipes once", () => {
    const sb = sandbox({ refScript: "marked" });
    installedBox(sb);
    const r = run(sb, ["--reset", "--yes", "install", "my-branch"]);
    expect(r.status).toBe(0);
    expect(loggedCalls(sb).filter((c) => c.startsWith("waitron.sh-start "))).toEqual([
      "waitron.sh-start <--reset><--yes><install><my-branch>",
    ]);
    expect(removals(sb).filter((c) => /waitron_logs\b/.test(c))).toHaveLength(1);
  });

  it("stops, keeping the box's own copy and wiping nothing, when the ref's script predates --reset", () => {
    const sb = sandbox({ refScript: "pre-reset" });
    installedBox(sb);
    const before = readFileSync(sb.script, "utf8");
    const r = run(sb, ["--reset", "--yes", "install", "old-branch"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(
      "old-branch's waitron.sh predates --reset install, so nothing was changed: run 'waitron.sh reset', then 'waitron.sh install old-branch'",
    );
    expect(readFileSync(sb.script, "utf8")).toBe(before);
    expect(loggedCalls(sb).filter((c) => c.startsWith("waitron.sh-start "))).toEqual([]);
    expect(loggedCalls(sb)).not.toContainEqual(
      expect.stringMatching(/^(docker (build|pull)|compose down) /),
    );
    expect(removals(sb)).toEqual([]);
    expect(readdirSync(sb.scriptDir).filter((n) => n.startsWith(".waitron.sh."))).toEqual([]);
  });

  it("without --reset, still replaces its copy with a ref's script that predates --reset and runs it", () => {
    const sb = sandbox({ refScript: "pre-reset" });
    installedBox(sb);
    const r = run(sb, ["install", "old-branch"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("predates");
    expect(readFileSync(sb.script, "utf8")).toBe(readFileSync(sb.env.WT_SELF_SCRIPT, "utf8"));
    expect(loggedCalls(sb).filter((c) => c.startsWith("waitron.sh-start "))).toEqual([
      "waitron.sh-start <install><old-branch>",
    ]);
  });

  it.each([
    [
      ["--yes", "install"],
      "--yes goes with --reset: 'waitron.sh --reset --yes install [ref]', or 'waitron.sh reset --yes'",
    ],
    [
      ["--all", "reset"],
      "--all goes with --reset: 'waitron.sh --reset --all install [ref]', or 'waitron.sh reset --all'",
    ],
    [["--reset", "reset"], "--reset goes only with install: 'waitron.sh --reset install [ref]'"],
    [["--reset"], "--reset goes only with install: 'waitron.sh --reset install [ref]'"],
    [["--reset", "--bogus", "install"], "unknown option '--bogus'"],
  ])("refuses %j before touching the box", (args, message) => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(message);
    expect(existsSync(sb.log) ? readFileSync(sb.log, "utf8") : "").not.toMatch(/^docker /m);
  });
});

// The trading.env read is a shell one-liner that SHIPS inside deploy/waitron.sh and runs in the app
// image, beside the state volume. No case above can see what it does — the docker stub answers any
// *trading.env* `compose run` with $WT_TRADING_ENV and never executes the one-liner's text — so
// these extract the shipped text and RUN it under a real `sh` against real directories. The three
// states are the three `is_production` distinguishes: a value, a clean "nothing there", and a read
// that failed.
describe("the trading.env reader inside waitron.sh", () => {
  const READER = (() => {
    const m = /-c '([^']*trading\.env[^']*)'/.exec(readFileSync(SCRIPT, "utf8"));
    if (!m)
      throw new Error("deploy/waitron.sh no longer reads trading.env from a single-quoted -c");
    return m[1];
  })();

  function stateDir() {
    const d = mkdtempSync(join(tmpdir(), "waitron-state-"));
    dirs.push(d);
    return d;
  }

  const readTradingEnv = (state) =>
    spawnSync("sh", ["-c", READER], {
      encoding: "utf8",
      env: { ...process.env, WAITRON_STATE_DIR: state },
    });

  it("prints the file a provisioned box carries", () => {
    const state = stateDir();
    writeFileSync(join(state, "trading.env"), "WAITRON_ENV=production\n");
    const r = readTradingEnv(state);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^WAITRON_ENV=production$/m);
  });

  it("prints the sentinel and succeeds when the box has no trading.env", () => {
    const r = readTradingEnv(stateDir());
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("__ABSENT__");
  });

  // A trading.env that EXISTS but cannot be read is a read that failed, and is_production fails
  // closed only if it sees a non-zero exit: answering __ABSENT__ here would report an unprovisioned
  // box and let a production box be wiped without --force-production. The unreadable file is a
  // DIRECTORY rather than a mode-000 file because mode bits do not stop root, so on a root CI runner
  // a mode-000 case would pass while proving nothing; `cat` fails on a directory for every user.
  it("fails, and does not claim absence, when trading.env exists but cannot be read", () => {
    const state = stateDir();
    mkdirSync(join(state, "trading.env"));
    const r = readTradingEnv(state);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/__ABSENT__/);
  });

  // The same distinction one level UP: `[ -e "$d/trading.env" ]` answers "no such file" for a
  // directory it cannot look inside, so a state volume the container cannot traverse read as an
  // unprovisioned box and the irreversible reset proceeded. The state directory here is MISSING
  // rather than mode 000 because mode bits do not stop root, so on a root CI runner a mode-000 case
  // is green whether the code is fixed or broken. A genuinely fresh box is a different state and
  // stays resettable: deploy/Dockerfile pre-creates the mount path and chowns it to the container's
  // user, so its state volume comes up readable and traversable.
  it("fails, and does not claim absence, when the state directory cannot be read", () => {
    const r = readTradingEnv(join(stateDir(), "never-created"));
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toMatch(/__ABSENT__/);
  });
});

// The stamp reader is JavaScript that SHIPS inside deploy/waitron.sh and runs in the app image,
// which is where node:sqlite and the state volume both are. No case above can see whether it reads a
// real file correctly — the docker stub answers in its place — so these extract the shipped text and
// RUN it against databases built here. The three states are the three `is_production` distinguishes:
// a value, a clean "nothing there", and a read that failed.
describe("the venue stamp reader inside waitron.sh", () => {
  const READER = (() => {
    const m = /VENUE_STAMP_JS='([\s\S]*?)'\n/.exec(readFileSync(SCRIPT, "utf8"));
    if (!m) throw new Error("deploy/waitron.sh no longer assigns VENUE_STAMP_JS in single quotes");
    return m[1];
  })();

  // A venue directory as the product leaves it: `venue.db` with a `deployment` table, carrying the
  // stamp row only when the box has been stamped. Built with node:sqlite rather than with the
  // product's own opener, because the reader must work against the FILE, not against our schema.
  function venueDir({ migrated = true, stamp = "" } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "waitron-venue-"));
    dirs.push(dir);
    const db = new DatabaseSync(join(dir, "venue.db"));
    if (migrated) {
      db.exec("create table deployment (id integer primary key, environment text not null)");
      if (stamp) db.prepare("insert into deployment values (1, ?)").run(stamp);
    }
    db.close();
    return dir;
  }

  const readStamp = (env) =>
    spawnSync(process.execPath, ["-e", READER], {
      encoding: "utf8",
      env: { ...process.env, WAITRON_VENUE_DIR: "", WAITRON_STATE_DIR: "", ...env },
    });

  it("prints the environment a stamped box carries", () => {
    const r = readStamp({ WAITRON_VENUE_DIR: venueDir({ stamp: "production" }) });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("production");
  });

  it("finds the venue directory under the state directory the image sets", () => {
    const state = mkdtempSync(join(tmpdir(), "waitron-state-"));
    dirs.push(state);
    mkdirSync(join(state, "venue"));
    const db = new DatabaseSync(join(state, "venue", "venue.db"));
    db.exec("create table deployment (id integer primary key, environment text not null)");
    db.prepare("insert into deployment values (1, ?)").run("production");
    db.close();
    const r = readStamp({ WAITRON_STATE_DIR: state });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("production");
  });

  // "Nothing there", both shapes of it: a box that has never booted has no venue file at all, and a
  // box that booted but was never provisioned has the table and no row. Both are reads that
  // SUCCEEDED and found nothing, so reset stays open on them.
  it("succeeds with no output when the box has no venue database yet", () => {
    const r = readStamp({ WAITRON_VENUE_DIR: mkdtempSync(join(tmpdir(), "waitron-venue-")) });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("succeeds with no output when the box is migrated but not stamped", () => {
    const r = readStamp({ WAITRON_VENUE_DIR: venueDir() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  // A third shape of "nothing there", and the one an operator actually meets: `openVenueStore`
  // CREATES `venue.db` on any open, and `apps/server/src/boot.ts` opens the venue directory for its
  // stamp probe before it applies migrations — so every box that got as far as booting and then
  // failed sits with the file present and the `deployment` table absent. That box has no records to
  // protect and must stay resettable with no extra flag.
  it("succeeds with no output when the venue file exists but was never migrated", () => {
    const r = readStamp({ WAITRON_VENUE_DIR: venueDir({ migrated: false }) });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  // The third state, and the only one that still fails closed: bytes at venue.db that are not a
  // SQLite database at all, so nothing about this box can be established. is_production treats a
  // non-zero exit as "cannot establish" and refuses the reset, which is only safe if the reader
  // really does exit non-zero here rather than printing an empty line.
  it("fails when the venue file is not a database", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-venue-"));
    dirs.push(dir);
    writeFileSync(join(dir, "venue.db"), "these bytes are not a SQLite database");
    const r = readStamp({ WAITRON_VENUE_DIR: dir });
    expect(r.status).not.toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("fails when neither the venue directory nor the state directory is set", () => {
    const r = readStamp({});
    expect(r.status).not.toBe(0);
  });
});

// No install case reaches apt: the stub bin carries `qrencode` and a working `docker compose`, which
// ensure_docker reads as a box with nothing to install. So these take `apt_get` and the two helpers it
// calls out of the shipped script and run them under the suite's stubs.
describe("the apt_get wrapper inside waitron.sh", () => {
  const SHIPPED = readFileSync(SCRIPT, "utf8");
  const fn = (name) => {
    const m =
      new RegExp(`^${name}\\(\\) \\{.*\\}$`, "m").exec(SHIPPED) ??
      new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, "m").exec(SHIPPED);
    if (!m) throw new Error(`deploy/waitron.sh no longer defines ${name}()`);
    return m[0];
  };
  const PROGRAM = `set -euo pipefail\n${fn("die")}\n${fn("as_root")}\n${fn("apt_get")}\napt_get "$@"\n`;
  const BASH = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
  const EMPTY_BIN = mkdtempSync(join(tmpdir(), "waitron-sh-empty-bin-"));
  afterAll(() => rmSync(EMPTY_BIN, { recursive: true, force: true }));

  function aptGet(args, { fail = 0, path = `${STUB_BIN}${delimiter}${process.env.PATH}` } = {}) {
    const root = mkdtempSync(join(tmpdir(), "waitron-sh-apt-"));
    dirs.push(root);
    const log = join(root, "calls.log");
    writeFileSync(log, "");
    const result = spawnSync(BASH, ["-c", PROGRAM, "apt_get", ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: path, WT_LOG: log, WT_APT_FAIL: String(fail) },
      timeout: RUN_TIMEOUT_MS,
    });
    if (result.error) throw result.error;
    const calls = readFileSync(log, "utf8").trimEnd().split("\n");
    return {
      ...result,
      limits: calls.filter((c) => /^g?timeout /.test(c)),
      apts: calls.filter((c) => c.startsWith("apt-get ")),
    };
  }

  const OPTIONS =
    "-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30";

  it("runs a healthy call once, under a 300 s limit, with apt's retry and read-timeout options", () => {
    const r = aptGet(["update"]);
    expect(r.status).toBe(0);
    expect(r.limits).toHaveLength(1);
    expect(r.limits[0]).toMatch(
      new RegExp(`^g?timeout 300 env DEBIAN_FRONTEND=noninteractive apt-get ${OPTIONS} update$`),
    );
    expect(r.apts).toEqual([`apt-get ${OPTIONS} update`]);
  });

  it("gives an install 1800 s per attempt, because a slow link can take longer than 300 s", () => {
    const r = aptGet(["install", "-y", "docker-ce"]);
    expect(r.status).toBe(0);
    expect(r.limits).toHaveLength(1);
    expect(r.limits[0]).toMatch(/^g?timeout 1800 env DEBIAN_FRONTEND=noninteractive apt-get /);
  });

  it("tries a call that fails twice a third time, says so twice, and succeeds", () => {
    const r = aptGet(["install", "-y", "qrencode"], { fail: 2 });
    expect(r.status).toBe(0);
    expect(r.apts).toHaveLength(3);
    expect(r.stderr).toContain(
      "waitron.sh: attempt 1 of 3 failed or stalled: apt-get install -y qrencode",
    );
    expect(r.stderr).toContain(
      "waitron.sh: attempt 2 of 3 failed or stalled: apt-get install -y qrencode",
    );
    expect(r.stderr).not.toContain("attempt 3 of 3");
  });

  it("stops after three failed attempts, naming the arguments, and makes no fourth", () => {
    const r = aptGet(["install", "-y", "qrencode"], { fail: 4 });
    expect(r.status).not.toBe(0);
    expect(r.apts).toHaveLength(3);
    expect(r.stderr).toContain(
      "waitron.sh: apt-get install -y qrencode failed or stalled on all three attempts",
    );
  });

  it("stops before running apt, and says what it needs, when no timeout command is on PATH", () => {
    const probe = spawnSync(BASH, ["-c", "command -v gtimeout || command -v timeout"], {
      encoding: "utf8",
      env: { ...process.env, PATH: EMPTY_BIN },
      timeout: RUN_TIMEOUT_MS,
    });
    expect(probe.status, "the empty PATH must really hide both timeout commands").not.toBe(0);
    const r = aptGet(["update"], { path: EMPTY_BIN });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("waitron.sh: need timeout (GNU coreutils) to bound apt-get");
    expect(r.apts).toEqual([]);
  });
});

// Deliberately the LAST case in the file. Run first, it pays the cold-stub first-execution cost, which
// can cross its 700ms budget whether the stub sleeps or not. By here the stubs are warm.
describe("waitron.sh when a run does not finish", () => {
  it("names the command, the signal and the recorded calls", () => {
    // 2s, not longer: `spawnSync` signals only `bash`, so the stub's `sleep` is reparented and
    // outlives the run.
    const sb = sandbox({ hang: "2" });
    let caught;
    try {
      run(sb, ["install"], {}, { timeoutMs: 700 });
    } catch (error) {
      caught = error;
    }
    expect(
      caught,
      "a run killed by its own timeout must not be left to a status assertion",
    ).toBeDefined();
    expect(caught.message).toMatch(/did not finish within 700ms/);
    expect(caught.message).toMatch(/ETIMEDOUT/);
    expect(caught.message).toMatch(/SIGTERM/);
    // The call log is the thing that says WHICH command hung.
    expect(caught.message).toMatch(/docker/);
  });
});
