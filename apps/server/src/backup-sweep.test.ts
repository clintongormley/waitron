import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decryptArtifact } from "./artifact-cipher.js";
import { type BackupSweepDeps, runBackupSweep, runOnce } from "./backup-sweep.js";
import type { StorageBackend, StoredObject } from "./storage-backend.js";

const execFileAsync = promisify(execFile);

// A fake StorageBackend for unit tests: `list` honours the real interface's "newest-first" contract
// by returning keys in REVERSE insertion order (the most recently `put` — or directly seeded — key
// first), which is what lets the "prunes to retain" test below assert the actual survivor rather than
// only a count.
class FakeBackend implements StorageBackend {
  objects = new Map<string, Buffer>();
  constructor(
    readonly id: string,
    private failPut = false,
  ) {}
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw new Error("boom");
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    return this.objects.get(key)!;
  }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.keys()]
      .reverse()
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k, size: 0, mtimeMs: 0 }));
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe("runOnce (fan-out)", () => {
  let staging: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-staging-"));
  });
  afterEach(async () => {
    await rm(staging, { recursive: true, force: true });
  });

  const deps = (backends: StorageBackend[], log = vi.fn()) => ({
    backends,
    databaseUrl: "postgres://x",
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    retain: 7,
    signal: new AbortController().signal,
    sleep: vi.fn(),
    log,
    now: () => new Date("2026-09-05T00:00:00Z"),
    runDump: async ({ outFile }: { outFile: string }) => {
      await writeFile(outFile, "DUMP-BYTES");
    },
  });

  it("encrypts the dump once and fans the SAME ciphertext to every backend", async () => {
    const a = new FakeBackend("a");
    const b = new FakeBackend("b");
    await runOnce(deps([a, b]));
    const key = "waitron-20260905T000000Z.dump.enc";
    expect(a.objects.has(key)).toBe(true);
    expect(b.objects.get(key)!.equals(a.objects.get(key)!)).toBe(true);
    expect(decryptArtifact(a.objects.get(key)!, "recovery-key-1").toString()).toBe("DUMP-BYTES");
  });

  it("a failing backend does not stop the others", async () => {
    const good = new FakeBackend("good");
    const bad = new FakeBackend("bad", true);
    const log = vi.fn();
    await runOnce(deps([bad, good], log));
    expect(good.objects.size).toBe(1);
    expect(log).toHaveBeenCalledWith(
      "warn",
      "backup.destination_failed",
      expect.objectContaining({ destination: "bad" }),
    );
  });

  it("surfaces the errno of a NodeJS.ErrnoException in backup.destination_failed", async () => {
    // A LocalFsBackend fault (ENOSPC/EACCES/EROFS) is a NodeJS.ErrnoException, whose `.code` is a
    // fixed symbol carrying no secrets. codeOf() maps it to "unknown" (only AppErrors resolve), so
    // the raw errno is logged alongside to keep it diagnosable.
    const enospc = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const failing: StorageBackend = {
      id: "full-disk",
      async put() {
        throw enospc;
      },
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    const log = vi.fn();
    await runOnce(deps([failing], log));
    expect(log).toHaveBeenCalledWith(
      "warn",
      "backup.destination_failed",
      expect.objectContaining({ destination: "full-disk", errorCode: "unknown", errno: "ENOSPC" }),
    );
  });

  it("prunes each backend to retain", async () => {
    const a = new FakeBackend("a");
    for (const t of ["waitron-1.dump.enc", "waitron-2.dump.enc"])
      a.objects.set(t, Buffer.from("old"));
    await runOnce({ ...deps([a]), retain: 1 });
    expect(a.objects.size).toBe(1); // only the newest survives
    // The newest is the dump this very run just wrote, not either pre-seeded fixture.
    expect(a.objects.has("waitron-20260905T000000Z.dump.enc")).toBe(true);
  });

  it("chmods the staging plaintext dump to 0600 before it is read/encrypted", async () => {
    // pg_dump writes with the process umask, which can leave the whole-DB plaintext
    // group/other-readable. runOnce chmods it to 0600 (owner-only) right after the dump and before
    // the encrypt/fan-out. The rm is in a `finally`, so we observe the mode from inside a backend's
    // `put` — the staged file still exists there, after the chmod. The runDump writes 0o644 so an
    // absent chmod would leave it 0o644 and fail this.
    const staged = join(staging, "waitron-20260905T000000Z.dump");
    let observedMode = -1;
    const probe: StorageBackend = {
      id: "probe",
      async put() {
        observedMode = (await stat(staged)).mode & 0o777;
      },
      async get() {
        return Buffer.alloc(0);
      },
      async list() {
        return [];
      },
      async delete() {},
    };
    await runOnce({
      ...deps([probe]),
      runDump: async ({ outFile }: { outFile: string }) => {
        await writeFile(outFile, "DUMP-BYTES", { mode: 0o644 });
      },
    });
    expect(observedMode).toBe(0o600);
  });

  it("leaves no staging file behind", async () => {
    const a = new FakeBackend("a");
    await runOnce(deps([a]));
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(staging)).toEqual([]);
  });
});

// The loop shell (abort checks, sleep, error swallow) is unchanged from the pre-fan-out version of
// this file, but `runOnce` is a fresh function under the new `BackupSweepDeps` shape, so these are
// rewritten around backends rather than a bare `dir`. They pin the same three behaviours the old
// `runBackupSweep` suite pinned: one tick fans to every backend, a per-tick throw is logged as
// `backup.failed` and swallowed (the loop keeps going), and a non-`AppError` throw's code comes
// through as `"unknown"` rather than as a raw message that could carry the connection string.
describe("runBackupSweep (loop logic, injected runDump + sleep)", () => {
  let staging: string;
  beforeEach(async () => {
    staging = await mkdtemp(join(tmpdir(), "backup-loop-staging-"));
  });
  afterEach(async () => {
    await rm(staging, { recursive: true, force: true });
  });

  // Mirrors the `deps()` helper in the runOnce block: the five constant loop fields in one place, with
  // the per-test signal/sleep/log (and optional runDump/now) supplied as overrides. `signal`/`sleep`/
  // `log` are required here because every loop test drives its own AbortController through them.
  type LoopOverrides = Partial<BackupSweepDeps> & Pick<BackupSweepDeps, "signal" | "sleep" | "log">;
  const loopDeps = (backend: StorageBackend, overrides: LoopOverrides): BackupSweepDeps => ({
    backends: [backend],
    databaseUrl: "postgres://x",
    recoveryKey: "recovery-key-1",
    stagingDir: staging,
    intervalMs: 10,
    retain: 7,
    ...overrides,
  });

  it("dumps once, fans to the backend, logs backup.destination_completed, then exits on abort", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event) => logged.push([level, event]),
        runDump: async ({ outFile }) => {
          await writeFile(outFile, "DUMP-BYTES");
        },
        now: () => new Date("2026-09-05T00:00:00Z"),
        // Aborts on the first (and only) sleep, so the loop runs exactly one iteration then exits.
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    expect(backend.objects.size).toBe(1);
    expect(logged).toContainEqual(["info", "backup.destination_completed"]);
  });

  it("logs backup.failed and keeps looping when the dump throws, then exits cleanly", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string]> = [];
    let dumpCalls = 0;
    let ticks = 0;

    // The loop must NOT die on a dump failure: the throw is caught, logged as a warn, and a second
    // iteration runs before the abort — the same "logged and swallowed" contract runRetentionSweep has.
    await runBackupSweep(
      loopDeps(backend, {
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
      }),
    );

    expect(logged).toContainEqual(["warn", "backup.failed"]);
    // Swallowed, not fatal: a second dump was attempted after the first threw.
    expect(dumpCalls).toBeGreaterThanOrEqual(2);
  });

  it("passes the AppError code through backup.failed's errorCode field", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const logged: Array<[string, string, Record<string, unknown> | undefined]> = [];

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: (level, event, fields) => logged.push([level, event, fields]),
        runDump: async () => {
          throw new Error("plain error, not an AppError");
        },
        sleep: async () => {
          controller.abort();
        },
      }),
    );

    const failure = logged.find(([, event]) => event === "backup.failed");
    expect(failure).toBeDefined();
    // codeOf maps a non-AppError to "unknown" (error-code.ts) — never the raw message, which could
    // carry a connection string.
    expect(failure![2]).toMatchObject({ errorCode: "unknown" });
  });

  it("checks abort again after the tick and never sleeps when it aborted mid-tick", async () => {
    const controller = new AbortController();
    const backend = new FakeBackend("only");
    const sleep = vi.fn();

    await runBackupSweep(
      loopDeps(backend, {
        signal: controller.signal,
        log: vi.fn(),
        // Aborts DURING the dump itself, not in `sleep` — pins the loop's second abort check
        // (immediately after the tick, before the sleep it would otherwise take).
        runDump: async ({ outFile }) => {
          controller.abort();
          await writeFile(outFile, "DUMP-BYTES");
        },
        sleep,
      }),
    );

    expect(backend.objects.size).toBe(1); // the in-flight tick still completed
    expect(sleep).not.toHaveBeenCalled();
  });
});

// A real pg_dump against the shared test container — proves the custom-format invocation realPgDump
// issues actually produces a valid dump against postgres:18-alpine. The host here (macOS/CI) has no
// pg18 `pg_dump` on PATH, so we run the IDENTICAL argv realPgDump uses INSIDE the container via
// `docker exec`, then copy the file out and assert it is a non-empty custom-format dump (PGDMP magic).
// A skipped smoke proves nothing (CLAUDE.md §2), so this only degrades to a loud skip when the `docker`
// CLI or the container id genuinely cannot be resolved. Unchanged by BR-1 Task 5 — realPgDump itself
// did not change — carried over from the pre-fan-out version of this file (Task 4) rather than dropped
// in the rewrite, since it is the ONLY coverage of the real shell-out (pg-dump.ts says so explicitly).
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
