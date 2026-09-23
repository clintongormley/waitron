import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
// on macOS against about 12ms to execute the same file again, and this suite builds six stubs, so
// building a new set per test was most of its runtime (measured before and after: see
// docs/developers/testing-guide.md). Nothing in the bin is per-case state — the knobs travel as
// WT_* environment variables the stubs read at run time. What a stub writes stays inside the case's
// own directories: $WT_LOG and its `.probes` counter, which `sandbox` gives a fresh path per case,
// plus the fixture files
// `curl` drops at its `-o` target and whatever `mv` moves under WAITRON_DIR.
//
// The docker stub inspects the WHOLE arg string ($*) rather than shifting, so a change to flag order
// cannot silently break it:
//   - `compose version` exits 0, so Docker looks installed and ensure_docker skips the apt block.
//   - `compose ps`   -> prints $WT_DOCKER_PS ("healthy" by default, so wait_healthy returns first
//     try), after $WT_DOCKER_PS_PENDING probes that answer empty — a container with no health
//     verdict yet, which is what the script's retry loop exists for.
//   - `compose logs` -> prints the database_ahead line when $WT_AHEAD_LOGS is 1.
//   - `compose run` -> the app image, and the stub MODELS ITS ENTRYPOINT: an invocation carrying no
//     `--entrypoint` prints the boot_failed line and exits 1, the way the real image does (measured;
//     see the entrypoint case in the reset block). Given the override it answers by what the command
//     NAMES — $WT_DB_STAMP for a `venue.db`, $WT_TRADING_ENV for a `trading.env` (set that to
//     "__ABSENT__" to model an unprovisioned box whose state volume has no trading.env) — so a read
//     pointed at the wrong file reads empty and its test fails. The reset's `find` names neither and
//     prints nothing.
//   - `compose exec … psql …` -> exits non-zero. No cluster on a box carries a database named
//     waitron any more. Nothing in the script reaches this arm — it is kept as a trap for the ONE
//     route back it can see: a stamp read rewritten as `docker compose exec … psql`, which fails a
//     test here instead of reading an empty stamp as "nothing there". A Postgres client
//     reintroduced any other way is invisible to it — `docker run postgres…` matches neither outer
//     arm, and `compose run --entrypoint psql` is taken by the `run` arm above — and both fall
//     through to the stub's closing exit 0.
//   - `volume inspect` -> exit 0 (the volume exists); `volume rm` -> exit 0 unless $WT_RM_FAIL names a
//     volume ("logs" makes `docker volume rm waitron_logs` fail, to test the abort-on-failure path).
// Failure knobs model the read/write faults the install and production-safety fixes must survive:
//   - WT_READ_ERROR: BOTH is_production reads (trading.env cat and the venue stamp) exit non-zero,
//     so the environment cannot be established — reset must then fail CLOSED.
//   - WT_RM_FAIL: the named volume's `docker volume rm` exits non-zero.
//   - WT_MV_FAIL: `mv` exits non-zero, so the atomic .env rewrite's final rename fails.
//   - WT_PULL_FAIL: `compose … pull` exits non-zero, as when the registry is unreachable or has no
//     image for this machine's architecture.
//   - WT_HANG: seconds the `docker` stub sleeps before doing anything, on EVERY invocation — the one
//     knob that changes the shared stub's behaviour unconditionally. Only the last case sets it, to
//     drive `run()`'s timeout path.
// `curl`/`wget` write a marker to their -o target so fetched files exist. `qrencode` is a no-op.
// `systemctl` and `sudo` are stubbed so ensure_docker's `sudo -n systemctl enable --now docker` is a
// no-op and the suite is hermetic on Linux with or without passwordless sudo (not just on macOS,
// which has no systemctl).
const STUB_BIN = mkdtempSync(join(tmpdir(), "waitron-sh-bin-"));
afterAll(() => rmSync(STUB_BIN, { recursive: true, force: true }));

// `mv` is now stubbed for EVERY case, so that the bin can stay constant, and falls through to the
// real one unless the case asks it to fail. Resolved to an absolute path because STUB_BIN is first
// on PATH — a bare `exec mv` would re-enter this stub.
const REAL_MV = spawnSync("bash", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();

function stub(name, body) {
  const p = join(STUB_BIN, name);
  writeFileSync(
    p,
    `#!/usr/bin/env bash\nprintf '%s ' "${name}" >> "$WT_LOG"; printf '%s\\n' "$*" >> "$WT_LOG"\n${body}\n`,
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
    case "$args" in
      *" pull "*|*" pull")
        # Mimics real compose, which exits 0 on a failed pull when given --ignore-pull-failures
        # (probed on Compose v5.1.0). install must not pass the flag; if it does, this stub exits 0
        # and the pull-failure test fails.
        case "$args" in *--ignore-pull-failures*) exit 0 ;; esac
        [ "\${WT_PULL_FAIL}" = "1" ] && exit 1 ;;
      *" ps "*|*" ps")
        # WT_DOCKER_PS_PENDING probes answer empty before the box reports WT_DOCKER_PS: a container
        # that has no health verdict yet. The counter is a file in the case's own directory, so cases
        # cannot see each other's, and it is what the probe-count assertions read.
        n=$(cat "\${WT_LOG}.probes" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "\${WT_LOG}.probes"
        if [ "$n" -le "\${WT_DOCKER_PS_PENDING:-0}" ]; then echo ""; else echo "\${WT_DOCKER_PS}"; fi ;;
      *" logs "*)
        [ "\${WT_AHEAD_LOGS}" = "1" ] && echo "provisioning.database_ahead: the database is newer" ;;
      *" run "*)
        # Every throwaway container the script runs against the state volume is built from the APP
        # image, whose ENTRYPOINT is node /app/node-entry.js. An invocation that does not override it
        # has its arguments APPENDED to that entrypoint, so the container boots a server instead of
        # reading the volume: measured 2026-09-23, the server.boot_failed line below on stdout and
        # exit 1. Modelling that here is what makes a missing --entrypoint fail a test — this arm
        # used to answer a trading.env read whatever the entrypoint was, so every case stayed green
        # either way.
        case "$args" in
          *--entrypoint*) ;;
          *) echo '{"errorCode":"server.config_missing","event":"server.boot_failed"}'; exit 1 ;;
        esac
        [ "\${WT_READ_ERROR}" = "1" ] && exit 1
        # Answered by what the command NAMES, so a read pointed at the wrong file reads empty.
        case "$args" in
          *venue.db*) echo "\${WT_DB_STAMP}" ;;
          *trading.env*) echo "\${WT_TRADING_ENV}" ;;
        esac ;;
      *" exec "*)
        # Nothing on a box answers psql any more — the storage is a file, and no cluster on it
        # carries a database named waitron. No shipped command reaches this arm; it is kept as a trap
        # for the one route back it can see: a stamp read rewritten as docker compose exec ... psql,
        # which ERRORS here rather than reading an empty stamp as "nothing there". That is ALL it
        # catches — a client reintroduced as docker run postgres, or as compose run --entrypoint
        # psql, is taken by another arm or by none, and reads as a clean empty stamp.
        case "$args" in *psql*) exit 1 ;; esac ;;
    esac ;;
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
out=""; while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; *) shift;; esac; done
[ -n "$out" ] && printf 'stub\\n' > "$out"
exit 0
`,
);
stub("qrencode", "exit 0");
stub("systemctl", "exit 0");
// as_root calls `sudo -n <cmd>`; drop the -n and exec the rest so it lands on the stubbed systemctl.
stub("sudo", `[ "$1" = "-n" ] && shift; exec "$@"`);

// A case's own state: a fresh WAITRON_DIR and a fresh log, plus the knob values the shared stubs
// read. Creating these costs a mkdir, not an exec.
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
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "waitron-sh-"));
  dirs.push(root);
  const boxDir = join(root, "box");
  const log = join(root, "calls.log");
  mkdirSync(boxDir, { recursive: true });
  return {
    boxDir,
    log,
    root,
    env: {
      WT_LOG: log,
      WT_TRADING_ENV: tradingEnv,
      WT_DB_STAMP: dbStamp,
      WT_AHEAD_LOGS: aheadLogs ? "1" : "0",
      WT_DOCKER_PS: dockerPs,
      WT_DOCKER_PS_PENDING: String(dockerPsPending),
      WT_READ_ERROR: readError ? "1" : "0",
      WT_RM_FAIL: rmFail,
      WT_MV_FAIL: envWriteFail ? "1" : "0",
      WT_PULL_FAIL: pullFail ? "1" : "0",
      WT_HANG: hang,
    },
  };
}

// Two budgets, protecting against different failures. Vitest's per-test timeout bounds how long the
// whole TEST may take, and a test it fails for its duration alone is a healthy run reported as
// broken — the default, 5s, did exactly that here. Every case below makes exactly ONE `run()` call
// and does no other slow work, so bounding the test above the spawn timeout covers that side. That
// reasoning is about THIS suite, not a general rule: a test that waits twice can outlast such a
// bound. Guard: `scripts/spawn-timeout-budget.test.ts`.
//
// spawnSync's timeout is the OTHER side, and it kills a child that is still working. It therefore
// has to clear the child's own worst case: `wait_healthy` in `deploy/waitron.sh` retries for about
// three minutes by default, which no per-test bound can rescue. `WAITRON_SH_HEALTH_DELAY` below
// shrinks that budget for every case while leaving the retrying in place. Receipt in
// `docs/developers/testing-guide.md`.
const RUN_TIMEOUT_MS = 20_000;
vi.setConfig({ testTimeout: RUN_TIMEOUT_MS + 10_000 });

function run(sb, args, extraEnv = {}, { timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${STUB_BIN}${delimiter}${process.env.PATH}`,
      WAITRON_DIR: sb.boxDir,
      // The child's whole health-retry budget, shrunk from ~175s to ~2s. A case may still override it.
      WAITRON_SH_HEALTH_DELAY: "0.05",
      ...sb.env,
      ...extraEnv,
    },
    timeout: timeoutMs,
  });
  // A child killed by that timeout comes back with `status: null`, and every case below asserts on
  // `status` — so the whole report would read `expected null to be +0`, naming neither the run nor
  // the command that hung. The signal, the error code and the stub call log are all sitting in hand
  // at this point; a hang is a fault in its own right, so raise it here rather than leaving it to a
  // status assertion that cannot describe it.
  if (result.error) {
    const recorded = existsSync(sb.log)
      ? readFileSync(sb.log, "utf8").trimEnd().split("\n").slice(-5)
      : [];
    // `error` covers more than the timeout kill — a missing interpreter arrives here as ENOENT with
    // no signal at all, and calling that "did not finish within 20000ms" sends the reader looking
    // for a hang that never happened. Separate the two.
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

describe("waitron.sh install (published main)", () => {
  it("pulls, starts, records no image override, and prints the links", () => {
    const sb = sandbox();
    const r = run(sb, ["install"]);
    expect(r.status).toBe(0);
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker compose .*pull/);
    expect(calls).toMatch(/docker compose .*up -d --remove-orphans/);
    // No .env AT ALL. The box has no pre-boot secret left to mint, and this path records no image
    // override either, so nothing asks install to write the file. Nothing needs it to exist:
    // measured 2026-09-23 with `docker compose -f deploy/compose.yml config`, no .env present and
    // POSTGRES_PASSWORD unset — exit 0 on this file, against exit 1 on the previous one with
    // `required variable POSTGRES_PASSWORD is missing a value`.
    expect(existsSync(join(sb.boxDir, ".env"))).toBe(false);
    expect(r.stdout).toContain("https://waitron.local/manage/email");
    expect(r.stdout).toContain("http://waitron.local:9110");
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
    const calls = readFileSync(sb.log, "utf8");
    expect(calls).toMatch(/docker compose .*pull/);
    expect(calls).not.toMatch(/docker compose .*up/);
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
  // Both cases below leave WAITRON_SH_MAX_HEALTH_TRIES alone, so they run the try count the script
  // ships, and both assert the probe COUNT — the status and the message alone are satisfied by a
  // child that never retries at all, which is how the first version of the second case was caught
  // passing with the tries pinned to 1.
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
  // the child retries for ~175s, so `spawnSync` kills it (measured at 20.17s, ETIMEDOUT). The case
  // above does NOT prove that — with the shipped 5s delay it merely slows to about six seconds.
  it("gives up with the unhealthy message after the shipped number of tries", () => {
    const sb = sandbox({ dockerPs: "starting" });
    const r = run(sb, ["install"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not come up healthy/);
    expect(probes(sb)).toBe(SHIPPED_TRIES);
  });
});

describe("waitron.sh install preserves .env on a failed write", () => {
  // The .env rewrite truncated the file in place, so a failed write left it empty. The MECHANISM
  // under test is unchanged — write beside .env, rename only on success — but what an emptied .env
  // costs has moved: there is no password in it any more, and what is lost instead is the image the
  // box is pinned to, after which a bare `docker compose up -d` moves the box onto the published
  // `:main` with no error anywhere.
  it("leaves .env unchanged (the pinned image kept) when the atomic rename fails", () => {
    const sb = sandbox({ envWriteFail: true });
    // A box pinned to a branch image by an earlier install.
    writeFileSync(join(sb.boxDir, ".env"), "WAITRON_IMAGE=waitron:previous\n");
    // A branch install rewrites .env (env_set WAITRON_IMAGE); the rename fails.
    const r = run(sb, ["install", "my-branch"]);
    expect(r.status).not.toBe(0);
    const env = readFileSync(join(sb.boxDir, ".env"), "utf8");
    // The old pin survives rather than the file being emptied.
    expect(env).toContain("WAITRON_IMAGE=waitron:previous");
    expect(env.length).toBeGreaterThan(0);
  });
});

describe("waitron.sh database_ahead advice", () => {
  // A box that never goes healthy (dockerPs "starting") whose logs carry database_ahead. The
  // sandbox already models aheadLogs and tradingEnv. `run()`'s delay default is what bounds the wall
  // clock; the try pin keeps these cases to one probe, so a failure here reads as the advice being
  // wrong rather than 36 probes of noise.
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
    writeFileSync(join(sb.boxDir, ".env"), "WAITRON_IMAGE=waitron:pinned\n");
  };

  it("refuses when the box was never installed", () => {
    const sb = sandbox();
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no box at/);
  });

  // `fetch_box_files` overwrites the installed compose.yml from the ref on EVERY install, so a box
  // upgrading past a change that retires a service meets a running container the new file no longer
  // declares. Measured 2026-09-23 on a throwaway two-service compose project, with the control in
  // the other direction: after deleting one service, a bare `docker compose up -d` printed
  // `warning msg="Found orphan containers ([wtorphan-retiree-1]) for this project…"`, exited 0 and
  // left that container RUNNING; a bare `docker compose down` removed the kept service and left the
  // orphan up, and could not even remove the network ("Resource is still in use"); the same
  // `up -d --remove-orphans` stopped and removed it. Without the flag a box that upgrades past the
  // retirement of the `db` service runs a Postgres container for ever on one warning line nobody
  // reads. It is asked for on every lifecycle call rather than once, so the NEXT retired service
  // needs no new code.
  it("asks compose to remove orphans on every up and down it runs", () => {
    const sb = sandbox();
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const lifecycle = readFileSync(sb.log, "utf8")
      .split("\n")
      .filter((line) => /^docker compose .*\b(up -d|down)\b/.test(line));
    // A reset runs both verbs, or the filter has gone blind and the loop below checks nothing.
    expect(lifecycle).toHaveLength(2);
    for (const call of lifecycle) expect(call).toContain("--remove-orphans");
  });

  // Every throwaway container this script runs against the state volume runs the APP image, whose
  // ENTRYPOINT is `node /app/node-entry.js` (deploy/Dockerfile) — so an invocation that does not
  // override it has its arguments APPENDED to that entrypoint and boots a server instead of reading
  // the volume. Measured 2026-09-23 against `waitron:dev` (same ENTRYPOINT, same `USER waitron`) on
  // a throwaway compose project mirroring the app service, both directions: with `--entrypoint sh`
  // the trading.env read printed `WAITRON_ENV=production` and exited 0 and the state-emptying find
  // left `tls/` standing and exited 0; WITHOUT it both printed
  // `{"errorCode":"server.config_missing",...,"event":"server.boot_failed"}` on stdout and exited 1.
  // What that costs is silence: a failed trading.env read makes `is_production` fail CLOSED, so a
  // demo box would refuse every reset as production.
  it("overrides the image entrypoint on every container it runs against the state volume", () => {
    const sb = sandbox({ tradingEnv: "__ABSENT__" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    const reads = readFileSync(sb.log, "utf8")
      .split("\n")
      .filter((line) => /trading\.env|-name tls/.test(line));
    // Both reads, or the filter has gone blind and the loop below would check nothing.
    expect(reads).toHaveLength(2);
    // `docker compose run`, not a bare `docker run`: compose resolves the image from the box's own
    // .env, so the helper is whichever image the box is actually running. A bare `docker run` would
    // need an image name hardcoded here again, which is what pinned the retired `postgres:18-alpine`.
    for (const read of reads) expect(read).toMatch(/^docker compose .* run .*--entrypoint /);
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
    // disk and nothing else. An upgraded box's `waitron_db` therefore survives a reset.
    expect(calls).not.toMatch(/docker volume rm .*waitron_db\b/);
    // state emptied except tls, by a throwaway container built from the app image.
    expect(calls).toMatch(
      /docker compose .* run .*--entrypoint sh app -c find "\$\{WAITRON_STATE_DIR:\?\}" .*! -name tls/,
    );
    expect(readFileSync(join(sb.boxDir, ".env"), "utf8")).toContain("WAITRON_IMAGE=waitron:pinned");
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

  // Spec §8: refusal must also fire on the stamp signal alone (trading.env empty). The refusal
  // alone does not prove the stamp was READ — an unreadable stamp also refuses, by failing closed —
  // so the case pins the read itself: the stub answers only a command naming a venue.db, and the
  // log has to show that command.
  it("refuses on a production box (stamp signal) and removes no volume", () => {
    const sb = sandbox({ tradingEnv: "", dbStamp: "production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PRODUCTION/);
    const calls = readFileSync(sb.log, "utf8");
    // The reader is several lines long, so the two halves of this are on different lines of the log.
    expect(calls).toMatch(/docker compose [\s\S]*? run [\s\S]*?venue\.db/);
    expect(calls).not.toMatch(/docker volume rm/);
  });

  it("--force-production --yes proceeds on a production box", () => {
    const sb = sandbox({ tradingEnv: "WAITRON_ENV=production" });
    installedBox(sb);
    const r = run(sb, ["reset", "--force-production", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_logs\b/);
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

  // The other side of C1: a genuinely unprovisioned box (trading.env ABSENT, stamp empty) is a
  // successful read of "nothing there", NOT an error — the demo/reset workflow must still proceed.
  // This is the case a stamp read through `psql -d waitron` fails: no box carries that database now,
  // so the read errors and an unprovisioned box is refused as if it were production.
  it("proceeds on an unprovisioned box (trading.env absent, empty stamp)", () => {
    const sb = sandbox({ tradingEnv: "__ABSENT__", dbStamp: "" });
    installedBox(sb);
    const r = run(sb, ["reset", "--yes"]);
    expect(r.status).toBe(0);
    expect(readFileSync(sb.log, "utf8")).toMatch(/docker volume rm .*waitron_logs\b/);
  });

  // I3: a failed removal must abort the reset BEFORE it reaches the volumes further down the loop or
  // empties state — otherwise a box whose wipe half-failed is restarted against surviving data with
  // its settings already gone. The volume made to fail is the one the loop reaches FIRST (`logs`,
  // since the retired `db` left the front of it), and both negatives below name something strictly
  // LATER than it: `backups` is the second entry and the state-emptying find runs after the whole
  // loop. Fail a later entry instead and the case would prove nothing about aborting.
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
  // a mode-000 case would pass while proving nothing (CLAUDE.md §1); `cat` fails on a directory for
  // every user.
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
  // is green whether the code is fixed or broken (CLAUDE.md §1). A genuinely fresh box is a
  // different state and stays resettable: deploy/Dockerfile:85 pre-creates the mount path and chowns
  // it to the container's user, so its state volume comes up readable and traversable.
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
  // really does exit non-zero here rather than printing an empty line. This case used to be driven
  // by an unmigrated file, which is a readable database and now reads as "nothing there" — the case
  // directly above.
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

// Deliberately the LAST case in the file. Run first, it was the one paying the cold-stub
// first-execution cost — measured at 667ms, 787ms and 1836ms for a HEALTHY run — so it crossed a
// 700ms budget whether the stub slept or not, and passed with its own `hang` knob neutralised. A
// test whose failing case and passing case look alike measures nothing (CLAUDE.md §1). By here the
// stubs are warm and a healthy `install` takes about 60ms, so the budget has room to mean something.
describe("waitron.sh when a run does not finish", () => {
  it("names the command, the signal and the recorded calls", () => {
    // 2s, not longer: `spawnSync` signals only `bash`, so the stub's `sleep` is reparented and
    // outlives the run. Short enough that it cannot become one of the orphans `pnpm reap` sweeps.
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
