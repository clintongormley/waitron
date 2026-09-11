import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "deploy", "waitron.sh");

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A sandbox: a fresh WAITRON_DIR, a bin/ of stub executables placed first on PATH, and a log file
// every stub appends its argv to. The docker stub inspects the WHOLE arg string ($*) rather than
// shifting, so a change to flag order cannot silently break it:
//   - `compose version` exits 0, so Docker looks installed and ensure_docker skips the apt block.
//   - `compose ps`   -> prints dockerPs ("healthy" by default, so wait_healthy returns first try).
//   - `compose logs` -> prints the database_ahead line when aheadLogs is set.
//   - `compose exec … psql … -d waitron …` -> prints dbStamp, but ONLY when `-d waitron` is present,
//     so a stamp query that forgot the app-db name (the wrong-db bug) reads empty and its test fails.
//   - `run … cat …/trading.env` -> prints tradingEnv; `run … find …` (reset) prints nothing.
// `curl`/`wget` write a marker to their -o target so fetched files exist. `qrencode` is a no-op.
// `systemctl` and `sudo` are stubbed so ensure_docker's `sudo -n systemctl enable --now docker` is a
// no-op and the suite is hermetic on Linux with or without passwordless sudo (not just on macOS,
// which has no systemctl).
function sandbox({ tradingEnv = "", dbStamp = "", aheadLogs = false, dockerPs = "healthy" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "waitron-sh-"));
  dirs.push(root);
  const boxDir = join(root, "box");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(boxDir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const stub = (name, body) => {
    const p = join(bin, name);
    writeFileSync(
      p,
      `#!/usr/bin/env bash\nprintf '%s ' "${name}" >> "${log}"; printf '%s\\n' "$*" >> "${log}"\n${body}\n`,
    );
    chmodSync(p, 0o755);
  };
  const aheadEcho = aheadLogs ? 'echo "provisioning.database_ahead: the database is newer"' : ":";
  stub(
    "docker",
    `
args="$*"
case "$args" in
  "compose version"*) exit 0 ;;
esac
case "$1" in
  compose)
    case "$args" in
      *" ps "*|*" ps") echo "${dockerPs}" ;;
      *" logs "*) ${aheadEcho} ;;
      *" exec "*)
        case "$args" in
          *psql*) case "$args" in *"-d waitron"*) echo "${dbStamp}" ;; esac ;;
        esac ;;
    esac ;;
  run)
    case "$args" in *trading.env*) echo "${tradingEnv}" ;; esac ;;
esac
exit 0
`,
  );
  stub(
    "curl",
    `
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done
[ -n "$out" ] && printf 'stub\\n' > "$out"
exit 0
`,
  );
  stub("qrencode", "exit 0");
  stub("systemctl", "exit 0");
  // as_root calls `sudo -n <cmd>`; drop the -n and exec the rest so it lands on the stubbed systemctl.
  stub("sudo", `[ "$1" = "-n" ] && shift; exec "$@"`);
  return { boxDir, bin, log, root };
}

function run(sb, args, extraEnv = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${sb.bin}${delimiter}${process.env.PATH}`,
      WAITRON_DIR: sb.boxDir,
      ...extraEnv,
    },
    timeout: 20000,
  });
}

describe("waitron.sh install (published main)", () => {
  it("pulls, starts, records no image override, and prints the links", () => {
    const sb = sandbox();
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker compose .*pull/);
    expect(calls).toMatch(/docker compose .*up -d/);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    expect(env).toMatch(/^POSTGRES_PASSWORD=.+/m);
    expect(env).not.toMatch(/WAITRON_IMAGE=/);
    expect(r.stdout).toContain("https://waitron.local/manage/email");
    expect(r.stdout).toContain("http://waitron.local:9110");
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

describe("waitron.sh database_ahead advice", () => {
  // A box that never goes healthy (dockerPs "starting") whose logs carry database_ahead. The
  // sandbox already models aheadLogs and tradingEnv; only the health loop needs bounding, via the
  // WAITRON_SH_MAX_HEALTH_TRIES override so the test does not wait three minutes.
  it("tells a non-production box to reset", () => {
    const sb = sandbox({ dockerPs: "starting", aheadLogs: true });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/reset.*then install/i);
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
    expect(r.stderr).not.toMatch(/run 'waitron\.sh reset'/);
  });
});

describe("waitron.sh reset", () => {
  const installedBox = (sb) => {
    // A box that looks installed: compose.yml + .env present.
    writeFileSync(join(sb.boxDir, "compose.yml"), "name: waitron\n");
    writeFileSync(join(sb.boxDir, ".env"), "POSTGRES_PASSWORD=keepme\n");
  };

  it("refuses when the box was never installed", () => {
    const sb = sandbox();
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no box at/);
  });

  it("removes the transient volumes, empties state except tls, keeps .env", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    for (const v of ["db", "logs", "media", "backups", "mailpit", "print_agent"]) {
      expect(calls).toMatch(new RegExp(`docker volume rm .*waitron_${v}\\b`));
    }
    expect(calls).not.toMatch(/docker volume rm .*waitron_state\b/);
    // state emptied except tls, via a throwaway container.
    expect(calls).toMatch(/docker run .*waitron_state.* find \/s .*! -name tls/);
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toContain("POSTGRES_PASSWORD=keepme");
    expect(calls).toMatch(/docker compose .*up -d/);
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
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  // Spec §8: refusal must also fire on the DB-stamp signal alone (trading.env empty). Because the
  // stub only returns the stamp when `-d waitron` is present, this test also fails if the query
  // targets the wrong database — the wrong-db bug cannot pass unnoticed.
  it("refuses on a production box (db-stamp signal) and removes no volume", () => {
    const sb = sandbox({ tradingEnv: "", dbStamp: "production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  it("--force-production --yes proceeds on a production box", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--force-production", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_db\b/);
  });
});
