import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { afterAll, describe, expect, it, vi } from "vitest";

// PATH stubs keep network installs and deliberately slow Node reads out of the real environment.

const root = join(import.meta.dirname, "..");
const script = join(import.meta.dirname, "ci-setup-pnpm.sh");
const VERSION = /^pnpm@(\d+\.\d+\.\d+)/.exec(
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager,
)[1];

// Vitest's own timer cannot interrupt a `spawnSync` (it blocks the event loop), so this kill is the
// only bound on a script that will not exit. It sits below the hang stub's 300 s sleep.
const SPAWN_TIMEOUT_MS = 30_000;
// Each case makes at most one `run()` call, so a per-test bound above the spawn timeout covers it.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS + 10_000 });

const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const hasTimeout = ["gnutimeout", "gtimeout", "timeout"].some(
  (name) => spawnSync("sh", ["-c", `command -v ${name}`]).status === 0,
);

// Written once per file: executing a freshly written file is much slower on macOS than running it
// again.
const STUB_BIN = temporaryDirectory("ci-setup-pnpm-bin-");
writeFileSync(
  join(STUB_BIN, "npm"),
  `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_STATE/npm.args"
attempt=$(( $(cat "$STUB_STATE/count" 2>/dev/null || echo 0) + 1 ))
echo "$attempt" > "$STUB_STATE/count"
prefix=""; spec=""; next=""
for arg in "$@"; do
  if [ "$next" = prefix ]; then prefix="$arg"; next=""; continue; fi
  case "$arg" in
    --prefix) next=prefix ;;
    pnpm@*) spec="\${arg#pnpm@}" ;;
  esac
done
printed="$spec"
before=""
after=""
case "$STUB_NPM_MODE" in
  live-hang)
    if [ "$attempt" -ne 1 ]; then exit 1; fi
    echo installer-entered
    if read -r release && [ "$release" = release ]; then touch "$STUB_STATE/released"; fi
    exit 1 ;;
  hang) exec sleep 300 ;;
  ignore-term) trap '' TERM; sleep 300; exit 0 ;;
  fail-then-ok) if [ "$attempt" -eq 1 ]; then exit 1; fi ;;
  wrong-version) printed="0.0.1" ;;
  slow-first-version) if [ "$attempt" -eq 1 ]; then before="sleep 2"; fi ;;
  version-then-fails) after="exit 1" ;;
  version-then-hangs) after="exec sleep 300" ;;
esac
mkdir -p "$prefix/bin"
printf '#!/usr/bin/env sh\\n%s\\necho %s\\n%s\\n' "$before" "$printed" "$after" > "$prefix/bin/pnpm"
chmod +x "$prefix/bin/pnpm"
`,
);
chmodSync(join(STUB_BIN, "npm"), 0o755);

writeFileSync(
  join(STUB_BIN, "node"),
  `#!/bin/sh
case "$STUB_NODE_MODE" in
  slow) sleep 2 ;;
  ignore-term) trap '' TERM; sleep 6 ;;
esac
exec "${process.execPath}" "$@"
`,
);
chmodSync(join(STUB_BIN, "node"), 0o755);

const BASH = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();

/** Runs the script with a fresh state directory; `env` overrides the defaults. */
function run(mode, env = {}, scriptPath = script) {
  const state = temporaryDirectory("ci-setup-pnpm-state-");
  const githubPath = join(state, "github-path");
  writeFileSync(githubPath, "");
  const runnerTemp = join(state, "runner-temp");
  mkdirSync(runnerTemp);
  const started = Date.now();
  const result = spawnSync(BASH, [scriptPath], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
    env: {
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      HOME: process.env.HOME,
      STUB_STATE: state,
      STUB_NPM_MODE: mode,
      RUNNER_TEMP: runnerTemp,
      GITHUB_PATH: githubPath,
      PNPM_SETUP_ATTEMPT_SECONDS: "20",
      PNPM_SETUP_KILL_SECONDS: "1",
      ...env,
    },
  });
  const read = (name) =>
    existsSync(join(state, name)) ? readFileSync(join(state, name), "utf8") : "";
  return {
    ...result,
    elapsedMs: Date.now() - started,
    runnerTemp,
    githubPath: read("github-path"),
    npmArgs: read("npm.args"),
    gnutimeoutCalls: read("gnutimeout.calls"),
  };
}

const failureLines = (stderr) =>
  stderr.split("\n").filter((line) => /^attempt \d of 3 failed/.test(line));

// Only the first installer can acknowledge a release; a start printed after its timeout cannot.
async function observeInstallStart() {
  const state = temporaryDirectory("ci-setup-pnpm-live-");
  const githubPath = join(state, "github-path");
  writeFileSync(githubPath, "");
  const child = spawn(BASH, [script], {
    detached: true,
    env: {
      ...process.env,
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      STUB_STATE: state,
      STUB_NPM_MODE: "live-hang",
      RUNNER_TEMP: state,
      GITHUB_PATH: githubPath,
      PNPM_SETUP_ATTEMPT_SECONDS: "5",
      PNPM_SETUP_KILL_SECONDS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let atStart;
  const observe = (chunk) => {
    output += chunk;
    if (
      atStart === undefined &&
      /attempt 1\/3 install: start[^\n]*command=[^\n]*npm install[^\n]*\n/.test(output) &&
      output.includes("installer-entered")
    ) {
      atStart = { output };
      child.stdin.end("release\n");
    }
  };
  child.stdin.on("error", (error) => (output += `stdin error: ${error.message}`));
  child.stdout.on("data", observe);
  child.stderr.on("data", observe);
  const deadline = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 12_000);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    return {
      atStart: atStart && { ...atStart, running: existsSync(join(state, "released")) },
      output,
    };
  } finally {
    clearTimeout(deadline);
  }
}

describe("ci-setup-pnpm.sh", () => {
  it("bounds a silent packageManager read before an install attempt can start", () => {
    const result = run("ok", { STUB_NODE_MODE: "slow", PNPM_SETUP_READ_SECONDS: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("packageManager read: start");
    expect(result.stderr).toMatch(/packageManager read: end status=124 elapsed=[0-9]+s/);
    expect(result.npmArgs).toBe("");
    expect(result.githubPath).toBe("");
    expect(result.elapsedMs).toBeLessThan(10_000);
  });

  it("forces a silent read to stop when it ignores the polite timeout signal", () => {
    const result = run("ok", { STUB_NODE_MODE: "ignore-term", PNPM_SETUP_READ_SECONDS: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/packageManager read: end status=137 elapsed=[0-9]+s/);
    expect(result.npmArgs).toBe("");
    expect(result.githubPath).toBe("");
    expect(result.elapsedMs).toBeLessThan(10_000);
  });

  it("allows a slow packageManager read to finish inside its own allowance", () => {
    const result = run("ok", { STUB_NODE_MODE: "slow", PNPM_SETUP_READ_SECONDS: "10" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("packageManager read: end status=0");
    expect(result.githubPath).toBe(`${join(result.runnerTemp, "pnpm-setup", "bin")}\n`);
  });

  it.each(["0", "1.5", "invalid"])(
    "refuses invalid read timeout %s before calling npm",
    (value) => {
      const result = run("ok", { PNPM_SETUP_READ_SECONDS: value });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("PNPM_SETUP_READ_SECONDS");
      expect(result.npmArgs).toBe("");
    },
  );

  it("uses the default read timeout when its override is empty", () => {
    const result = run("ok", { PNPM_SETUP_READ_SECONDS: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("packageManager read: start limit=10s");
  });

  it("reports the install command while a silent installer is still running", async () => {
    const result = await observeInstallStart();
    expect(result.atStart, result.output).toBeDefined();
    expect(result.atStart.running).toBe(true);
    expect(result.atStart.output).toContain("npm install");
    expect(result.atStart.output).not.toContain("install: end");
  });

  it.each([
    ["hang", "install", "124"],
    ["version-then-hangs", "version", "124"],
    ["version-then-fails", "version", "1"],
  ])(
    "identifies each %s failure with its phase, status and elapsed time",
    (mode, phase, status) => {
      const result = run(mode, {
        PNPM_SETUP_ATTEMPT_SECONDS: "1",
        PNPM_SETUP_VERSION_SECONDS: "1",
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      for (const attempt of [1, 2, 3]) {
        expect(result.stderr).toMatch(
          new RegExp(`attempt ${attempt}/3 ${phase}: end status=${status} elapsed=[0-9]+s`),
        );
      }
      if (phase === "install") expect(result.stderr).not.toContain("version: start");
      else expect(result.stderr).toContain("install: end status=0");
      expect(result.githubPath).toBe("");
    },
  );

  it("reports both successful commands with the checked version and elapsed time", () => {
    const result = run("slow-first-version");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(`pnpm@${VERSION}`);
    expect(result.stderr).toContain("attempt 1/3 install: end status=0");
    expect(result.stderr).toContain("attempt 1/3 version: start");
    expect(result.stderr).toContain("--version");
    const versionEnd = /attempt 1\/3 version: end status=0 elapsed=([0-9]+)s/.exec(result.stderr);
    expect(versionEnd, result.stderr).not.toBeNull();
    expect(Number(versionEnd[1])).toBeGreaterThanOrEqual(2);
    expect(result.stderr).not.toContain("attempt 2/3");
    expect(result.githubPath).toBe(`${join(result.runnerTemp, "pnpm-setup", "bin")}\n`);
  });

  it("reports a version mismatch separately from the version command exit status", () => {
    const result = run("wrong-version");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("version: end status=0");
    expect(result.stderr).toContain(`version mismatch: expected ${VERSION}, got 0.0.1`);
    expect(result.githubPath).toBe("");
  });

  it("finds a timeout command, which the script needs", () => {
    // Fails rather than skips: without one every bound below is untested.
    expect(hasTimeout, "none of gnutimeout, gtimeout or timeout is on PATH").toBe(true);
  });

  it("installs the package.json version and puts its bin directory on GITHUB_PATH", () => {
    // Failing case: a non-zero status, an empty GITHUB_PATH, or another version asked of npm.
    const result = run("ok");
    expect(result.status, result.stderr).toBe(0);
    expect(result.githubPath).toBe(`${join(result.runnerTemp, "pnpm-setup", "bin")}\n`);
    expect(result.npmArgs).toContain(`pnpm@${VERSION}`);
    expect(result.stdout, result.stderr).toContain(`pnpm ${VERSION} installed on attempt 1 of 3`);
  });

  it("keeps a slow successful first version check on its first install attempt", () => {
    const result = run("slow-first-version");
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, result.stderr).toContain(`pnpm ${VERSION} installed on attempt 1 of 3`);
    expect(failureLines(result.stderr)).toEqual([]);
    expect(result.npmArgs.trim().split("\n")).toHaveLength(1);
    expect(result.githubPath).toBe(`${join(result.runnerTemp, "pnpm-setup", "bin")}\n`);
  });

  it("gives up after three stalled attempts, each cut off by its time limit", () => {
    // Failing case: an unbounded attempt sleeps 300 s, so the spawn timeout kills the run at 30 s.
    const result = run("hang", { PNPM_SETUP_ATTEMPT_SECONDS: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(failureLines(result.stderr)).toEqual([
      `attempt 1 of 3 failed or stalled: npm install pnpm@${VERSION}`,
      `attempt 2 of 3 failed or stalled: npm install pnpm@${VERSION}`,
      `attempt 3 of 3 failed or stalled: npm install pnpm@${VERSION}`,
    ]);
    expect(result.stderr).toContain("pnpm setup failed or stalled on all 3 attempts");
    expect(result.githubPath).toBe("");
    expect(result.elapsedMs).toBeLessThan(15_000);
  });

  it("kills an attempt that ignores the polite stop", () => {
    // Failing case: without the kill grace, TERM is ignored and the run outlasts the spawn timeout.
    const result = run("ignore-term", { PNPM_SETUP_ATTEMPT_SECONDS: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(failureLines(result.stderr)).toHaveLength(3);
    expect(result.githubPath).toBe("");
    expect(result.elapsedMs).toBeLessThan(15_000);
  });

  it("prefers gnutimeout, Ubuntu 26.04's name for GNU's timeout, when it is on PATH", () => {
    // Failing case: the script runs gtimeout or timeout first, so gnutimeout.calls stays empty.
    const realTimeout = ["gnutimeout", "gtimeout", "timeout"]
      .map((name) => spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }))
      .find((probe) => probe.status === 0)
      ?.stdout.trim();
    expect(realTimeout, "no timeout command to wrap").toBeTruthy();
    const gnuBin = temporaryDirectory("ci-setup-pnpm-gnutimeout-");
    writeFileSync(
      join(gnuBin, "gnutimeout"),
      `#!/usr/bin/env bash\necho called >> "$STUB_STATE/gnutimeout.calls"\nexec "${realTimeout}" "$@"\n`,
    );
    chmodSync(join(gnuBin, "gnutimeout"), 0o755);
    const result = run("ok", { PATH: `${gnuBin}:${STUB_BIN}:${process.env.PATH}` });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, result.stderr).toContain(`pnpm ${VERSION} installed on attempt 1 of 3`);
    expect(result.gnutimeoutCalls).toBe("called\ncalled\ncalled\n");
  });

  it("succeeds on a later attempt after a failed one", () => {
    const result = run("fail-then-ok");
    expect(result.status, result.stderr).toBe(0);
    expect(failureLines(result.stderr)).toHaveLength(1);
    expect(result.stdout).toContain("installed on attempt 2 of 3");
    expect(result.githubPath).toBe(`${join(result.runnerTemp, "pnpm-setup", "bin")}\n`);
  });

  it("treats an installed pnpm that reports another version as a failure", () => {
    // Failing case: exit 0 with the bin directory on GITHUB_PATH.
    const result = run("wrong-version");
    expect(result.status).toBe(1);
    expect(failureLines(result.stderr)).toHaveLength(3);
    expect(result.githubPath).toBe("");
  });

  it("treats an installed pnpm that prints the version and then exits non-zero as a failure", () => {
    // Failing case: exit 0 on attempt 1 with the bin directory on GITHUB_PATH.
    const result = run("version-then-fails");
    expect(result.status).toBe(1);
    expect(failureLines(result.stderr)).toHaveLength(3);
    expect(result.githubPath).toBe("");
  });

  it("treats an installed pnpm that prints the version and then stalls as a failure", () => {
    // Failing case: exit 0 on attempt 1 with the bin directory on GITHUB_PATH.
    const result = run("version-then-hangs", { PNPM_SETUP_VERSION_SECONDS: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(failureLines(result.stderr)).toHaveLength(3);
    expect(result.githubPath).toBe("");
    expect(result.elapsedMs).toBeLessThan(15_000);
  });

  it.each(["GITHUB_PATH", "RUNNER_TEMP"])("refuses an empty %s before calling npm", (name) => {
    const result = run("ok", { [name]: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    expect(result.npmArgs).toBe("");
  });

  it.each(["PNPM_SETUP_ATTEMPT_SECONDS", "PNPM_SETUP_KILL_SECONDS", "PNPM_SETUP_VERSION_SECONDS"])(
    "takes an empty %s as its default",
    (name) => {
      const result = run("ok", { [name]: "" });
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.each([
    ["PNPM_SETUP_ATTEMPT_SECONDS", "0"],
    ["PNPM_SETUP_ATTEMPT_SECONDS", "1.5"],
    ["PNPM_SETUP_KILL_SECONDS", "abc"],
    ["PNPM_SETUP_VERSION_SECONDS", "0"],
  ])("refuses %s=%s before calling npm", (name, value) => {
    const result = run("ok", { [name]: value });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    expect(result.npmArgs).toBe("");
  });

  it("stops before calling npm when no timeout command is on PATH", () => {
    // Only what the script runs before its timeout lookup, so no timeout command is reachable.
    const tools = temporaryDirectory("ci-setup-pnpm-tools-");
    symlinkSync(process.execPath, join(tools, "node"));
    const dirname = spawnSync("sh", ["-c", "command -v dirname"], { encoding: "utf8" });
    symlinkSync(dirname.stdout.trim(), join(tools, "dirname"));
    const path = `${STUB_BIN}:${tools}`;
    const probe = spawnSync(
      BASH,
      ["-c", "command -v gnutimeout || command -v gtimeout || command -v timeout"],
      {
        env: { PATH: path },
      },
    );
    expect(probe.status, "the PATH must really hide every timeout command").not.toBe(0);
    const node = spawnSync(BASH, ["-c", "node -p 1"], { encoding: "utf8", env: { PATH: path } });
    expect(node.stdout, "node must still run, or the script stops before the lookup").toBe("1\n");
    const result = run("ok", { PATH: path });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("none of gnutimeout, gtimeout or timeout is on PATH");
    expect(result.npmArgs).toBe("");
    expect(result.githubPath).toBe("");
  });

  it("refuses a packageManager that is not an exact pnpm version", () => {
    const copy = temporaryDirectory("ci-setup-pnpm-repo-");
    mkdirSync(join(copy, "scripts"));
    copyFileSync(script, join(copy, "scripts", "ci-setup-pnpm.sh"));
    writeFileSync(join(copy, "package.json"), JSON.stringify({ packageManager: "pnpm@latest" }));
    const result = run("ok", {}, join(copy, "scripts", "ci-setup-pnpm.sh"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packageManager");
    expect(result.npmArgs).toBe("");
  });
});
