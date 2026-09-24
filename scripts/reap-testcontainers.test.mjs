import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STALE_CONTAINER_MS, reap, sweepOrphanedVitestWorkers } from "./reap-testcontainers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const NOW = Date.parse("2026-08-28T12:00:00.000Z");
const now = () => NOW;
const createdAgo = (ms) => new Date(NOW - ms).toISOString();
const STALE = STALE_CONTAINER_MS + 60_000;
const FRESH = 60_000;

function fakeDocker({ ps = "", inspect = "", failOn = null } = {}) {
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    const sub = args[0];
    if (failOn !== null && sub === failOn) throw new Error("Cannot connect to the Docker daemon");
    if (sub === "ps") return ps;
    if (sub === "inspect") return inspect;
    return "";
  };
  return { exec, calls };
}

function fakeProcs({ ps = "", failPs = false, killThrowsFor = [] } = {}) {
  const psCalls = [];
  const kills = [];
  const psExec = (args) => {
    psCalls.push(args);
    if (failPs) throw new Error("ps: command not found");
    return ps;
  };
  const kill = (pid, signal) => {
    kills.push({ pid, signal });
    if (killThrowsFor.includes(pid)) throw new Error("No such process");
  };
  return { psExec, kill, psCalls, kills };
}

describe("reap-testcontainers", () => {
  it("scopes the query to waitron's own label, never the generic org.testcontainers", () => {
    const { exec, calls } = fakeDocker({ ps: "", inspect: "" });
    reap({ exec, now });
    expect(calls[0]).toEqual(["ps", "-aq", "--filter", "label=com.waitron.reapable"]);
  });

  it("force-removes only STALE waitron containers (older than the threshold), sparing recent ones", () => {
    const { exec, calls } = fakeDocker({
      ps: "old111\nnew222\n",
      inspect: `old111 ${createdAgo(STALE)}\nnew222 ${createdAgo(FRESH)}\n`,
    });
    const result = reap({ exec, now });
    expect(result).toEqual({ dockerAvailable: true, containersRemoved: 1 });
    expect(calls).toContainEqual(["rm", "-f", "-v", "old111"]);
    const removals = calls.filter((c) => c[0] === "rm");
    expect(removals.some((c) => c.includes("new222"))).toBe(false);
  });

  it("removes nothing when every candidate is younger than the threshold", () => {
    const { exec, calls } = fakeDocker({
      ps: "fresh1\nfresh2\n",
      inspect: `fresh1 ${createdAgo(FRESH)}\nfresh2 ${createdAgo(10 * 60_000)}\n`,
    });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("does no inspect or removal when there are no waitron containers at all (empty-arg safety)", () => {
    const { exec, calls } = fakeDocker({ ps: "\n  \n" });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "inspect")).toBe(false);
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("never removes images, named volumes, or blanket-prunes — removal is scoped to the stale ids", () => {
    const { exec, calls } = fakeDocker({
      ps: "old111\n",
      inspect: `old111 ${createdAgo(STALE)}\n`,
    });
    reap({ exec, now });
    expect(calls.some((c) => c[0] === "rmi")).toBe(false);
    expect(calls.some((c) => c[0] === "volume")).toBe(false);
  });

  it("no-ops gracefully when Docker is unavailable (returns dockerAvailable:false, does not throw)", () => {
    const { exec } = fakeDocker({ failOn: "ps" });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: false, containersRemoved: 0 });
  });

  it("removes nothing if `docker inspect` fails — never reaps a container it could not age-check", () => {
    const { exec, calls } = fakeDocker({ ps: "old111\n", failOn: "inspect" });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
    expect(calls.some((c) => c[0] === "rm")).toBe(false);
  });

  it("swallows a `docker rm` failure (a container that vanished, a permission error) — stays best-effort", () => {
    const { exec } = fakeDocker({
      ps: "old111\n",
      inspect: `old111 ${createdAgo(STALE)}\n`,
      failOn: "rm",
    });
    expect(reap({ exec, now })).toEqual({ dockerAvailable: true, containersRemoved: 0 });
  });

  it("defaults to the real clock when no `now` is injected", () => {
    const { exec, calls } = fakeDocker({
      ps: "ancient1\n",
      inspect: "ancient1 2000-01-01T00:00:00.000Z\n",
    });
    expect(reap({ exec })).toEqual({ dockerAvailable: true, containersRemoved: 1 });
    expect(calls).toContainEqual(["rm", "-f", "-v", "ancient1"]);
  });

  describe("sweepOrphanedVitestWorkers", () => {
    it("SIGKILLs a vitest worker reparented to launchd (ppid 1) — the orphan signature", () => {
      // The leading whitespace mimics `ps` right-padding the pid column.
      const { psExec, kill, kills } = fakeProcs({ ps: "  89860     1 node (vitest 3)\n" });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 1,
      });
      expect(kills).toEqual([{ pid: 89860, signal: "SIGKILL" }]);
    });

    it("spares a vitest worker that still has a real parent — matches ppid 1 only, never a live run", () => {
      const { psExec, kill, kills } = fakeProcs({
        ps: "51534 51520 node (vitest)\n54638 51534 node (vitest 3)\n",
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 0,
      });
      expect(kills).toEqual([]);
    });

    it("spares an orphan that only MENTIONS vitest in an argument — matches the worker title, not argv", () => {
      // A `\bvitest\b`-anywhere match would kill this row.
      const { psExec, kill, kills } = fakeProcs({
        ps: "77777 1 node /tmp/report.mjs --log=/tmp/vitest-results.log\n",
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 0,
      });
      expect(kills).toEqual([]);
    });

    it("SIGKILLs an orphaned Vitest 4 worker, which carries no process title at all", () => {
      // Real `ps -axo pid=,ppid=,command=` rows from a Vitest 4.1.11 run, with the parent rewritten to
      // 1 and the pnpm store hash shortened to `hash`.
      const { psExec, kill, kills } = fakeProcs({
        ps: [
          "89211     1 node /repo/packages/identity/node_modules/.bin/../vitest/vitest.mjs run",
          "89293     1 /opt/homebrew/Cellar/node/26.7.0/bin/node --experimental-import-meta-resolve --require /repo/node_modules/.pnpm/vitest@4.1.11_hash/node_modules/vitest/suppress-warnings.cjs /repo/node_modules/.pnpm/vitest@4.1.11_hash/node_modules/vitest/dist/workers/forks.js",
        ].join("\n"),
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 2,
      });
      expect(kills).toEqual([
        { pid: 89211, signal: "SIGKILL" },
        { pid: 89293, signal: "SIGKILL" },
      ]);
    });

    it("spares a process that merely reads a file inside vitest's dist — the Vitest 4 control", () => {
      // What this case does NOT establish, and the sweep does not promise: a row whose argv names a
      // real worker file is killed, because the patterns match anywhere in the row rather than at its end.
      const { psExec, kill, kills } = fakeProcs({
        ps: "77778 1 node /tmp/inspect.mjs --entry /repo/node_modules/vitest/dist/index.js\n",
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 0,
      });
      expect(kills).toEqual([]);
    });

    it("spares a non-vitest process even when it is itself orphaned to launchd", () => {
      const { psExec, kill, kills } = fakeProcs({
        ps: "9615 1 com.apple.Virtualization.VirtualMachine\n385 1 launchservicesd\n",
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 0,
      });
      expect(kills).toEqual([]);
    });

    it("no-ops gracefully when `ps` is unavailable (returns psAvailable:false, does not throw)", () => {
      const { psExec, kill } = fakeProcs({ failPs: true });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: false,
        workersKilled: 0,
      });
    });

    it("swallows a kill failure (a worker that vanished between ps and kill) and counts only successes", () => {
      const { psExec, kill } = fakeProcs({
        ps: "89860 1 node (vitest 3)\n89862 1 node (vitest 4)\n",
        killThrowsFor: [89860],
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 1,
      });
    });

    it("kills every orphan in a mixed table, ignoring interleaved live-run and daemon rows", () => {
      const { psExec, kill, kills } = fakeProcs({
        ps: [
          "89860     1 node (vitest 3)",
          "51534 51520 node (vitest)",
          "89862     1 node (vitest 4)",
          "385       1 launchservicesd",
          "89864     1 node (vitest 1)",
          "54638 51534 node (vitest 2)",
          "89865     1 node (vitest 2)",
        ].join("\n"),
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 4,
      });
      expect(kills.map((k) => k.pid)).toEqual([89860, 89862, 89864, 89865]);
    });

    it("SIGKILLs a parentless Litestream or versitygw started from a Waitron checkout's .bin", () => {
      const { psExec, kill, kills } = fakeProcs({
        ps: [
          "5101     1 /Users/dev/repos/waitron/.bin/litestream replicate -config /tmp/waitron-loop-a/stream/litestream.yml",
          "5102     1 /Users/dev/worktrees/waitron-feat-x/.bin/versitygw --port 127.0.0.1:7070 posix /tmp/waitron-s3-x",
          "5103     1 /Users/dev/repos/waitron/bench/sqlite-failover/.bin/litestream replicate -config /tmp/b/litestream.yml",
        ].join("\n"),
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 3,
      });
      expect(kills).toEqual([
        { pid: 5101, signal: "SIGKILL" },
        { pid: 5102, signal: "SIGKILL" },
        { pid: 5103, signal: "SIGKILL" },
      ]);
    });

    it("spares a Litestream with a live parent, one outside a Waitron checkout, and a mere mention of the name", () => {
      const { psExec, kill, kills } = fakeProcs({
        ps: [
          // A running loop test's child: its parent is alive.
          "5201  5200 /Users/dev/repos/waitron/.bin/litestream replicate -config /tmp/waitron-loop-b/stream/litestream.yml",
          // A box's own Litestream is on PATH, never under a checkout's .bin.
          "5202     1 /usr/local/bin/litestream replicate -config /var/lib/waitron/stream/litestream.yml",
          // A developer's own Litestream, started by launchd (ppid 1), in another .bin directory.
          "5205     1 /Users/someone/.bin/litestream replicate -config /Users/someone/litestream.yml",
          "5206     1 /opt/otherproj/node_modules/.bin/litestream replicate",
          // A .bin deeper inside a checkout is not one the setup scripts write.
          "5207     1 /Users/dev/repos/waitron/packages/x/node_modules/.bin/litestream replicate",
          // A tool that only names the binary in an argument.
          "5203     1 tail -f /Users/dev/repos/waitron/.bin/litestream.log",
          "5204     1 grep versitygw /tmp/notes.txt",
        ].join("\n"),
      });
      expect(sweepOrphanedVitestWorkers({ psExec, kill })).toEqual({
        psAvailable: true,
        workersKilled: 0,
      });
      expect(kills).toEqual([]);
    });
  });

  describe("the CLI entry", () => {
    let dir;
    afterEach(() => {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    });

    it("invokes docker and ps to reap stale containers and orphaned workers, and exits 0", () => {
      dir = mkdtempSync(join(tmpdir(), "reap-fakedocker-"));
      const argLog = join(dir, "docker-args.log");
      const psLog = join(dir, "ps-args.log");
      const fakeDockerBin = join(dir, "docker");
      writeFileSync(
        fakeDockerBin,
        `#!/bin/sh
echo "$@" >> "${argLog}"
if [ "$1" = "ps" ]; then echo orphan123; fi
if [ "$1" = "inspect" ]; then echo "orphan123 2000-01-01T00:00:00.000Z"; fi
exit 0
`,
      );
      chmodSync(fakeDockerBin, 0o755);
      // A single NON-orphan row (ppid 6789, not 1), so the script's real `process.kill` is never reached.
      const fakePs = join(dir, "ps");
      writeFileSync(
        fakePs,
        `#!/bin/sh
echo "$@" >> "${psLog}"
echo "12345 6789 node (vitest 3)"
exit 0
`,
      );
      chmodSync(fakePs, 0o755);

      const result = spawnSync(process.execPath, [join(HERE, "reap-testcontainers.mjs")], {
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      const calls = readFileSync(argLog, "utf8");
      expect(calls).toContain("ps -aq --filter label=com.waitron.reapable");
      expect(calls).toContain("rm -f -v orphan123");
      expect(readFileSync(psLog, "utf8").length).toBeGreaterThan(0);
      expect(result.stderr).toContain("killed 0 orphaned vitest worker(s)");
      expect(result.stderr).toContain("reaped 1 stale waitron testcontainers container(s)");
    });
  });
});
