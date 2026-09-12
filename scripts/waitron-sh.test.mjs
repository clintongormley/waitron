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
//   - `run … <trading.env read>` -> prints tradingEnv (pass "__ABSENT__" to model an unprovisioned
//     box whose state volume has no trading.env); `run … find …` (reset) prints nothing.
//   - `volume inspect` -> exit 0 (the volume exists); `volume rm` -> exit 0 unless rmFail names a
//     volume ("db" makes `docker volume rm waitron_db` fail, to test the abort-on-failure path).
// Three failure knobs model the read/write faults the production-safety fixes must survive:
//   - readError: BOTH is_production reads (trading.env cat and the db-stamp psql) exit non-zero, so
//     the environment cannot be established — reset must then fail CLOSED.
//   - rmFail: the named volume's `docker volume rm` exits non-zero.
//   - envWriteFail: `mv` exits non-zero, so the atomic .env rewrite's final rename fails.
// `curl`/`wget` write a marker to their -o target so fetched files exist. `qrencode` is a no-op.
// `systemctl` and `sudo` are stubbed so ensure_docker's `sudo -n systemctl enable --now docker` is a
// no-op and the suite is hermetic on Linux with or without passwordless sudo (not just on macOS,
// which has no systemctl).
function sandbox({
  tradingEnv = "",
  dbStamp = "",
  aheadLogs = false,
  dockerPs = "healthy",
  readError = false,
  rmFail = "",
  envWriteFail = false,
} = {}) {
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
  const readErr = readError ? "1" : "0";
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
          *psql*)
            [ "${readErr}" = "1" ] && exit 1
            case "$args" in *"-d waitron"*) echo "${dbStamp}" ;; esac ;;
        esac ;;
    esac ;;
  volume)
    case "$2" in
      inspect) exit 0 ;;
      rm)
        if [ -n "${rmFail}" ]; then
          case "$args" in *"waitron_${rmFail}"*) exit 1 ;; esac
        fi
        exit 0 ;;
    esac ;;
  run)
    case "$args" in
      *trading.env*)
        [ "${readErr}" = "1" ] && exit 1
        echo "${tradingEnv}" ;;
    esac ;;
esac
exit 0
`,
  );
  if (envWriteFail) stub("mv", "exit 1");
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
    expect(r.stdout).toContain("http://waitron.local/setup/trust");
    expect(r.stdout).toContain("https://waitron.local/setup/trust");
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

describe("waitron.sh health check", () => {
  // `grep -q healthy` also matched "unhealthy" (the word contains it), so a container reporting
  // unhealthy was treated as ready. The whole health value must match, not a substring.
  it("does not report an unhealthy container as ready", () => {
    const sb = sandbox({ dockerPs: "unhealthy" });
    const r = run(sb, ["install"], { WAITRON_SH_MAX_HEALTH_TRIES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not come up healthy/);
  });
});

describe("waitron.sh install preserves .env on a failed write", () => {
  // The .env rewrite truncated the file in place, so a failed write left it empty and lost
  // POSTGRES_PASSWORD — the next install would mint a different one and lock the app out of its
  // cluster. The rewrite must be atomic: write beside .env, rename only on success.
  it("leaves .env unchanged (password kept) when the atomic rename fails", () => {
    const sb = sandbox({ envWriteFail: true });
    // A box whose password was minted by an earlier install.
    writeFileSync(join(sb.boxDir, ".env"), "POSTGRES_PASSWORD=original-secret\n");
    // A branch install rewrites .env (env_set WAITRON_IMAGE); the rename fails.
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).not.toBe(0);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    // The password survives, so a retry (ensure_env_password returns early) reuses the same one.
    expect(env).toContain("POSTGRES_PASSWORD=original-secret");
    expect(env.length).toBeGreaterThan(0);
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
    for (const v of ["db", "logs", "backups", "mailpit", "print_agent"]) {
      expect(calls).toMatch(new RegExp(`docker volume rm .*waitron_${v}\\b`));
    }
    expect(calls).not.toMatch(/docker volume rm .*waitron_state\b/);
    expect(calls).not.toMatch(/docker volume rm .*waitron_media\b/);
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

  // C1 (fiscal §5): when neither signal can be read (both error), the environment cannot be
  // established. An irreversible wipe must fail CLOSED — treat it as production and refuse — rather
  // than assume "unreadable means empty".
  it("refuses when production status cannot be established (both reads error), removing no volume", () => {
    const sb = sandbox({ readError: true });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    expect(readFileSync(sb.log, "utf8")).not.toMatch(/docker volume rm/);
  });

  // The other side of C1: a genuinely unprovisioned box (trading.env ABSENT, db stamp empty) is a
  // successful read of "nothing there", NOT an error — the demo/reset workflow must still proceed.
  it("proceeds on an unprovisioned box (trading.env absent, empty stamp)", () => {
    const sb = sandbox({ tradingEnv: "__ABSENT__", dbStamp: "" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_db\b/);
  });

  // I3: a failed removal of the db volume must abort the reset BEFORE it removes backups or empties
  // state — otherwise the box restarts against the surviving database with its secrets already gone.
  it("aborts when a volume removal fails, before touching backups or state", () => {
    const sb = sandbox({ rmFail: "db" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    // It tried the db volume (first) but never reached backups or the state-emptying find.
    expect(calls).toMatch(/docker volume rm .*waitron_db\b/);
    expect(calls).not.toMatch(/docker volume rm .*waitron_backups\b/);
    expect(calls).not.toMatch(/find \/s .*! -name tls/);
  });
});
