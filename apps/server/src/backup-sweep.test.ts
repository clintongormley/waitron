import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { runBackupSweep } from "./backup-sweep.js";

const execFileAsync = promisify(execFile);

describe("runBackupSweep (loop logic, injected runDump + sleep)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "backup-sweep-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("dumps once into dir, prunes, logs backup.completed, then exits on abort", async () => {
    const controller = new AbortController();
    // A pre-existing OLD dump: with retain=1 the sweep must unlink it and keep only the fresh one,
    // which is how we prove pruneOldDumps actually ran inside the loop (not just that a file exists).
    const stale = join(dir, "waitron-20200101T000000Z.dump");
    await writeFile(stale, "old");

    const calls: Array<{ databaseUrl: string; outFile: string }> = [];
    const runDump = vi.fn(
      async ({ databaseUrl, outFile }: { databaseUrl: string; outFile: string }) => {
        calls.push({ databaseUrl, outFile });
        await writeFile(outFile, "stub-dump");
      },
    );
    const logged: Array<[string, string]> = [];

    await runBackupSweep({
      dir,
      databaseUrl: "postgresql://example/db",
      intervalMs: 10,
      retain: 1,
      signal: controller.signal,
      log: (level, event) => logged.push([level, event]),
      runDump,
      // Aborts on the first (and only) sleep, so the loop runs exactly one iteration then exits.
      sleep: async () => {
        controller.abort();
      },
    });

    expect(runDump).toHaveBeenCalledTimes(1);
    expect(calls[0]!.databaseUrl).toBe("postgresql://example/db");
    expect(calls[0]!.outFile.startsWith(dir)).toBe(true);
    expect(/waitron-.*\.dump$/.test(calls[0]!.outFile)).toBe(true);
    // The fresh stub dump was written and survived the prune; the stale one was unlinked (retain=1).
    expect(existsSync(calls[0]!.outFile)).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(logged).toContainEqual(["info", "backup.completed"]);
  });

  it("logs backup.failed and keeps looping when runDump throws, then exits cleanly", async () => {
    const controller = new AbortController();
    const logged: Array<[string, string]> = [];
    let dumpCalls = 0;
    let ticks = 0;

    // The loop must NOT die on a dump failure: the throw is caught, logged as a warn, and a second
    // iteration runs before the abort — the same "logged and swallowed" contract runRetentionSweep has.
    await runBackupSweep({
      dir,
      databaseUrl: "postgresql://example/db",
      intervalMs: 10,
      retain: 1,
      signal: controller.signal,
      log: (level, event) => logged.push([level, event]),
      runDump: async () => {
        dumpCalls += 1;
        throw new Error("pg_dump exploded");
      },
      sleep: async () => {
        ticks += 1;
        if (ticks >= 2) controller.abort();
      },
    });

    expect(logged).toContainEqual(["warn", "backup.failed"]);
    // Swallowed, not fatal: a second dump was attempted after the first threw.
    expect(dumpCalls).toBeGreaterThanOrEqual(2);
  });

  it("passes the AppError code through backup.failed's errorCode field", async () => {
    const controller = new AbortController();
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];

    await runBackupSweep({
      dir,
      databaseUrl: "postgresql://example/db",
      intervalMs: 10,
      retain: 1,
      signal: controller.signal,
      log: (level, event, fields) => logged.push([level, event, fields]),
      runDump: async () => {
        throw new Error("plain error, not an AppError");
      },
      sleep: async () => {
        controller.abort();
      },
    });

    const failure = logged.find(([, event]) => event === "backup.failed");
    expect(failure).toBeDefined();
    // codeOf maps a non-AppError to "unknown" (error-code.ts) — never the raw message, which could
    // carry a connection string.
    expect(failure![2]).toMatchObject({ errorCode: "unknown" });
  });
});

// A real pg_dump against the shared test container — proves the custom-format invocation realPgDump
// issues actually produces a valid dump against postgres:18-alpine. The host here (macOS/CI) has no
// pg18 `pg_dump` on PATH, so we run the IDENTICAL argv realPgDump uses INSIDE the container via
// `docker exec`, then copy the file out and assert it is a non-empty custom-format dump (PGDMP magic).
// A skipped smoke proves nothing (CLAUDE.md §2), so this only degrades to a loud skip when the `docker`
// CLI or the container id genuinely cannot be resolved.
const suite = useTemplateDb({ template: "manifest" });

describe("realPgDump custom-format invocation (real container, docker exec)", () => {
  it("produces a non-empty PGDMP custom-format dump against postgres:18-alpine", async () => {
    const uri = new URL(suite.pg.uri);

    // Find the shared container by its published host port + the harness label.
    let containerId: string;
    try {
      const { stdout } = await execFileAsync("docker", [
        "ps",
        "--filter",
        `publish=${uri.port}`,
        "--filter",
        "label=com.waitron.reapable",
        "--format",
        "{{.ID}}",
      ]);
      containerId = stdout.trim().split("\n")[0]!.trim();
    } catch (err) {
      console.warn(
        `[backup-sweep smoke SKIPPED] could not run \`docker ps\` to locate the test container: ${String(err)}. ` +
          `realPgDump's real invocation is UNPROVEN in this run.`,
      );
      return;
    }
    if (containerId === "") {
      console.warn(
        `[backup-sweep smoke SKIPPED] no running container published on port ${uri.port} with label ` +
          `com.waitron.reapable. realPgDump's real invocation is UNPROVEN in this run.`,
      );
      return;
    }

    // Inside the container the server listens on localhost:5432; the clone db + superuser creds come
    // from the suite uri. This is the exact argv realPgDump builds (pg-dump.ts): custom format, --file,
    // connstring last.
    const dbName = uri.pathname.replace(/^\//, "");
    const internalConn = `postgresql://${uri.username}:${uri.password}@localhost:5432/${dbName}`;
    const inContainerFile = `/tmp/waitron-smoke-${process.pid}.dump`;

    await execFileAsync("docker", [
      "exec",
      containerId,
      "pg_dump",
      "--format=custom",
      "--file",
      inContainerFile,
      internalConn,
    ]);

    const outDir = await mkdtemp(join(tmpdir(), "backup-smoke-"));
    const hostFile = join(outDir, "smoke.dump");
    try {
      await execFileAsync("docker", ["cp", `${containerId}:${inContainerFile}`, hostFile]);
      const bytes = await readFile(hostFile);
      expect(bytes.length).toBeGreaterThan(0);
      // Custom-format archives begin with the 5-byte magic "PGDMP".
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("PGDMP");
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await execFileAsync("docker", ["exec", containerId, "rm", "-f", inContainerFile]).catch(
        () => {},
      );
    }
  }, 180_000);
});
