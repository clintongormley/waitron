import { cp, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { FRESH, levelFor, type RecoveryState } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { assertNotAhead, recoveryTlsFiles, runEntry, serveRecovery } from "./node-entry.js";

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close: () => Promise<void> }>;

function deps(over: Partial<Parameters<typeof runEntry>[0]> = {}) {
  return {
    args: [] as readonly string[],
    baseEnv: {},
    stateDir: "/state",
    venueDir: "/venue",
    // Stubbed here, unlike `runStagedRestore` below it: the real default OPENS the venue directory,
    // and these suites name one that does not exist. One test (`defaults the ahead check to the
    // real one`) overrides this back to `undefined` on purpose; the `assertNotAhead` describe at
    // the bottom of this file calls the real wrapper directly instead.
    assertNotAhead: vi.fn(() => Promise.resolve()),
    loadBoxEnv: vi.fn((base: NodeJS.ProcessEnv) => Promise.resolve({ ...base })),
    readRecoveryState: vi.fn(() => Promise.resolve(FRESH)),
    writeRecoveryState: vi.fn(() => Promise.resolve()),
    startServer: vi.fn<StartServer>(() => Promise.resolve({ close: () => Promise.resolve() })),
    serveRecovery: vi.fn(() => Promise.resolve()),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    ...over,
  };
}

/** A state volume holding one `recovery.json`, so consecutive starts see each other's writes. */
function recoveryVolume(initial: RecoveryState) {
  let stored = initial;
  return {
    current: () => stored,
    deps: {
      readRecoveryState: vi.fn(() => Promise.resolve(stored)),
      writeRecoveryState: vi.fn((_stateDir: string, next: RecoveryState) => {
        stored = next;
        return Promise.resolve();
      }),
    },
  };
}

describe("runEntry", () => {
  it("marks a completed managed restore and reports that snapshot after boot", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-entry-cloud-"));
    const origin = "https://cloud.example.test";
    const requestId = "1ea4560a-77ac-4c4b-8abc-06d09fe8c60e";
    const pointId = "252998c0-69eb-4bbc-a0f9-a8ba6451db42";
    const key = generateKeyPairSync("ed25519");
    const path = join(stateDir, "cloud-recovery.json");
    const actions: string[] = [];
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        origin,
        environment: "preproduction",
        requestId,
        pointId,
        phase: "staged",
        code: "12345678",
        privateKey: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
        publicKey: key.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
      }),
      { mode: 0o600 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const action = new URL(url).pathname.split("/").at(-1)!;
        actions.push(action);
        if (action === "info")
          return Response.json({
            point: {
              id: pointId,
              venueId: "374cac38-cc58-46d5-8d3b-8443fc4343a4",
              capturedAt: "2026-09-24T10:00:00.000Z",
              kind: "snapshot",
              verification: "verified",
              deleting: false,
              deletedAt: null,
              objectKey: `snapshots/${pointId}`,
              digest: "a".repeat(64),
              size: 7,
              modules: { core: 1 },
            },
          });
        if (action === "restored") return Response.json({ status: "restored" });
        throw new Error(`unexpected Cloud action: ${action}`);
      }),
    );
    try {
      await runEntry(
        deps({
          stateDir,
          baseEnv: { WAITRON_CLOUD_ORIGIN: origin },
          runStagedRestore: vi.fn(async ({ onManagedCloudRestored }) => {
            await onManagedCloudRestored?.({ requestId, pointId });
            return true;
          }),
        }),
      );
      await vi.waitFor(async () => {
        expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ phase: "reported" });
      });
      expect(actions).toEqual(["info", "restored"]);
    } finally {
      vi.unstubAllGlobals();
      await rm(stateDir, { recursive: true, force: true });
    }
  });
  it("refuses ANY argument before it reads or writes the counter or opens the venue folder", async () => {
    const reportFailure = vi.fn();
    const d = deps({
      args: ["/app/bin-restore.js", "--passphrase", "SENTINEL_SECRET"],
      reportFailure,
      runStagedRestore: vi.fn(() => Promise.resolve(false)),
    });
    await expect(runEntry(d)).rejects.toMatchObject({ code: "server.entry_arguments_refused" });
    expect(d.readRecoveryState).not.toHaveBeenCalled();
    expect(d.writeRecoveryState).not.toHaveBeenCalled();
    expect(d.runStagedRestore).not.toHaveBeenCalled();
    expect(d.assertNotAhead).not.toHaveBeenCalled();
    expect(d.loadBoxEnv).not.toHaveBeenCalled();
    expect(d.startServer).not.toHaveBeenCalled();
    expect(d.serveRecovery).not.toHaveBeenCalled();
    const printed = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("server.entry_arguments_refused");
    expect(printed).toContain("/app/bin-restore.js");
    expect(printed).toContain("and 2 more arguments, not shown");
    expect(printed).not.toContain("--passphrase");
    expect(printed).not.toContain("SENTINEL_SECRET");
    expect(printed).toContain("docker compose run --rm --entrypoint node app /app/");
  });

  it("names the count of arguments after the first in the singular, and omits it when there are none", async () => {
    for (const [args, expected] of [
      [["sh"], "was given: sh\n"],
      [["sh", "-c"], "was given: sh and 1 more argument, not shown\n"],
    ] as const) {
      const reportFailure = vi.fn();
      await expect(runEntry(deps({ args: [...args], reportFailure }))).rejects.toMatchObject({
        code: "server.entry_arguments_refused",
      });
      expect(String(reportFailure.mock.calls[0]?.[0])).toContain(expected);
    }
  });

  it("refuses an argument at the recovery level too, rather than serving the page", async () => {
    const d = deps({
      args: ["sh"],
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
    });
    await expect(runEntry(d)).rejects.toMatchObject({ code: "server.entry_arguments_refused" });
    expect(d.serveRecovery).not.toHaveBeenCalled();
  });

  it("leaves the counter as it was when another process holds the venue folder, however often", async () => {
    // Already one real failure on the books, so a refusal that counted would reach the recovery
    // level on the second attempt, and one that reset to FRESH would lose the real failure.
    const before: RecoveryState = {
      failures: 1,
      level: "normal",
      lastErrorCode: "migrations.set_missing",
      lastFailureAt: "2026-09-20T10:00:00.000Z",
    };
    const volume = recoveryVolume(before);
    const inUse = () =>
      Promise.reject(new AppError("provisioning.database_in_use", { database: "/venue" }));
    for (const refusing of [
      { runStagedRestore: vi.fn(inUse) },
      { assertNotAhead: vi.fn(inUse) },
      { startServer: vi.fn(inUse) },
    ]) {
      const d = deps({ ...volume.deps, ...refusing });
      await expect(runEntry(d)).rejects.toMatchObject({ code: "provisioning.database_in_use" });
      expect(volume.current()).toEqual(before);
    }

    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    const d = deps({ ...volume.deps, startServer });
    await runEntry(d);
    expect(startServer).toHaveBeenCalled();
    expect(d.serveRecovery).not.toHaveBeenCalled();
  });

  it("still counts a boot that fails for any other reason, with its code", async () => {
    const volume = recoveryVolume({ ...FRESH, failures: 1, lastErrorCode: "unknown" });
    await expect(
      runEntry(
        deps({
          ...volume.deps,
          startServer: vi.fn(() =>
            Promise.reject(
              new AppError("migrations.set_missing", { name: "core", folder: "/app/drizzle" }),
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: "migrations.set_missing" });
    expect(volume.current()).toMatchObject({
      failures: 2,
      lastErrorCode: "migrations.set_missing",
    });
  });

  it("runs a staged restore over the VENUE DIRECTORY, before loading box identity", async () => {
    const order: string[] = [];
    await runEntry(
      deps({
        runStagedRestore: vi.fn(async (request) => {
          order.push("restore");
          expect(request.venueDir).toBe("/venue");
          return true;
        }),
        loadBoxEnv: vi.fn(async (base) => {
          order.push("identity");
          return { ...base };
        }),
      }),
    );
    expect(order).toEqual(["restore", "identity"]);
  });

  it("starts the server with no database URL of its own in the environment", async () => {
    // The mock is held here, not read back off `deps()`: the spread with the `Partial` override
    // widens every field to a union, and a union has no `.mock`.
    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    await runEntry(deps({ baseEnv: {}, startServer }));
    expect(startServer).toHaveBeenCalled();
  });

  it("hands the server the environment loadBoxEnv returned, with nothing added or removed", async () => {
    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    await runEntry(
      deps({
        loadBoxEnv: vi.fn(() => Promise.resolve({ WAITRON_HTTP_PORT: "8080" })),
        startServer,
      }),
    );
    expect(startServer.mock.calls[0]![0]).toEqual({ WAITRON_HTTP_PORT: "8080" });
  });

  it("increments the counter and rethrows when the boot throws", async () => {
    const d = deps({ startServer: vi.fn(() => Promise.reject(new Error("boom"))) });
    await expect(runEntry(d)).rejects.toThrow();
    expect(d.writeRecoveryState).toHaveBeenCalledWith(
      "/state",
      expect.objectContaining({ failures: 1 }),
    );
  });

  it("serves the recovery page and never starts the server at the recovery level", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.startServer).not.toHaveBeenCalled();
  });

  it("passes a landing config to serveRecovery so recovery serves the trust page too", async () => {
    const serveRecovery = vi.fn<
      (app: Hono, opts: { landing?: Record<string, unknown> }) => Promise<void>
    >(() => Promise.resolve());
    const d = deps({
      baseEnv: { WAITRON_HTTP_LANDING_PORT: "80", WAITRON_HTTP_HOST: "0.0.0.0" },
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      serveRecovery,
    });
    await runEntry(d);
    const opts = serveRecovery.mock.calls[0]![1];
    expect(opts.landing).toMatchObject({
      landingPort: 80,
      httpHost: "0.0.0.0",
      stateDir: "/state",
      httpPort: 8080,
      tls: undefined,
    });
  });

  it("builds the landing config without throwing on a malformed WAITRON_BOX_ADDRESSES", async () => {
    // Recovery never runs `loadConfig`, so a broken box-addresses knob (which `loadConfig` rejects)
    // must not crash the one path that serves the page — it falls back to enumerating interfaces.
    const serveRecovery = vi.fn<
      (app: Hono, opts: { landing?: { boxAddresses?: unknown } }) => Promise<void>
    >(() => Promise.resolve());
    const d = deps({
      baseEnv: { WAITRON_BOX_ADDRESSES: "not-an-ip" },
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      serveRecovery,
    });
    await expect(runEntry(d)).resolves.toBeUndefined();
    expect(serveRecovery.mock.calls[0]![1].landing?.boxAddresses).toBeUndefined();
  });

  it("decides BEFORE touching the venue database — the page is served even when it cannot be read", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      assertNotAhead: vi.fn(() => Promise.reject(new Error("ENOENT"))),
      runStagedRestore: vi.fn(() => Promise.reject(new Error("must not be called"))),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.assertNotAhead).not.toHaveBeenCalled();
    expect(d.runStagedRestore).not.toHaveBeenCalled();
  });

  it("increments the counter BEFORE the server starts, so a HANGING boot still escalates", async () => {
    const order: string[] = [];
    const d = deps({
      writeRecoveryState: vi.fn(() => {
        order.push("counter");
        return Promise.resolve();
      }),
      // Never resolves and never rejects — the boot that hangs. A catch-only counter loses this case.
      startServer: vi.fn(() => {
        order.push("start");
        return new Promise<{ close: () => Promise<void> }>(() => {});
      }),
    });
    void runEntry(d);
    await vi.waitFor(() => expect(order).toEqual(["counter", "start"]));
  });

  it("counts a boot that fails BEFORE the server — the escalation the recovery page depends on", async () => {
    // Measured on the built bundle before this ordering existed: five failing boots (no bootstrap
    // URL, then a dead database) each exited 1 and left the state volume EMPTY, so a box with an
    // unreachable Postgres restart-looped for ever and never reached the page.
    for (const failing of [
      { runStagedRestore: vi.fn(() => Promise.reject(new Error("EACCES"))) },
      {
        assertNotAhead: vi.fn(() =>
          Promise.reject(
            new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["ff"] }),
          ),
        ),
      },
      { loadBoxEnv: vi.fn(() => Promise.reject(new Error("EACCES"))) },
    ]) {
      const d = deps(failing);
      await expect(runEntry(d)).rejects.toThrow();
      expect(d.writeRecoveryState).toHaveBeenCalledWith(
        "/state",
        expect.objectContaining({ failures: 1 }),
      );
    }
  });

  it("escalates to the recovery level on the third failed boot, whatever failed", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 2 })),
      assertNotAhead: vi.fn(() => Promise.reject(new Error("ENOENT"))),
    });
    await expect(runEntry(d)).rejects.toThrow();
    expect(d.writeRecoveryState).toHaveBeenCalledWith(
      "/state",
      expect.objectContaining({ failures: 3, level: "recovery" }),
    );
  });

  it("reports a state-volume write failure without replacing the boot's own error", async () => {
    const log = vi.fn();
    const d = deps({
      startServer: vi.fn(() =>
        Promise.reject(
          new AppError("migrations.set_missing", { name: "core", folder: "/app/drizzle" }),
        ),
      ),
      // The pre-boot write succeeds; the one recording the classification does not.
      writeRecoveryState: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("EROFS")),
      log,
    });
    await expect(runEntry(d)).rejects.toMatchObject({ code: "migrations.set_missing" });
    expect(log).toHaveBeenCalledWith(
      "warn",
      "recovery.state_write_failed",
      expect.objectContaining({ errorCode: "unknown" }),
    );
  });

  it("counts a boot that HANGS in the staged restore, which no failure handler can see", async () => {
    // The pre-boot write's own unique job. The wide `try`/`catch` already records every boot step
    // that THROWS, so a control that only moves this write down still passes on the throwing cases;
    // a hang is what separates them. `runStagedRestore` is the boot step with an unbounded wait in
    // it — it decrypts an archive and writes a whole database file before returning.
    const d = deps({ runStagedRestore: vi.fn(() => new Promise<never>(() => {})) });
    void runEntry(d);
    await vi.waitFor(() =>
      expect(d.writeRecoveryState).toHaveBeenCalledWith(
        "/state",
        expect.objectContaining({ failures: 1 }),
      ),
    );
  });

  it("does NOT clear the counter merely because the server started", async () => {
    const d = deps({ readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 2 })) });
    await runEntry(d);
    // Only the stayed-up callback may clear it.
    expect(d.writeRecoveryState).not.toHaveBeenCalledWith(
      "/state",
      expect.objectContaining({ failures: 0 }),
    );
    expect(d.scheduleStayedUp).toHaveBeenCalled();
  });

  it("clears the counter only from the stayed-up callback", async () => {
    const scheduleStayedUp = vi.fn<(ms: number, onStayedUp: () => void) => void>(() => {});
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 2 })),
      scheduleStayedUp,
    });
    await runEntry(d);
    const [ms, onStayedUp] = scheduleStayedUp.mock.calls[0]!;
    expect(ms).toBe(120_000);
    onStayedUp();
    await vi.waitFor(() =>
      expect(d.writeRecoveryState).toHaveBeenCalledWith(
        "/state",
        expect.objectContaining({ failures: 0 }),
      ),
    );
  });

  it("passes the server's OWN migrations root, never the bundle-relative null", async () => {
    let restoreRoot: string | null | undefined;
    let aheadRoot: string | undefined;
    const d = deps({
      runStagedRestore: vi.fn((request) => {
        restoreRoot = request.migrationsRoot;
        return Promise.resolve(true);
      }),
      assertNotAhead: vi.fn((_venueDir: string, migrationsRoot: string) => {
        aheadRoot = migrationsRoot;
        return Promise.resolve();
      }),
    });
    await runEntry(d);
    // `null` is what fails a real container's first boot with `migrations.set_missing`. The two
    // properties `boot.test.ts` pins on DEFAULT_MIGRATIONS_ROOT itself are asserted here too, so the
    // entrypoint's two migration-set readers and the server it starts cannot read three different
    // folders.
    expect(restoreRoot).toBe(aheadRoot);
    expect(aheadRoot).not.toBeUndefined();
    expect(isAbsolute(aheadRoot!)).toBe(true);
    expect(basename(aheadRoot!)).toBe("drizzle");
  });

  it("serves the page on WAITRON_HTTP_PORT, falling back when it is unset", async () => {
    const ports: number[] = [];
    const recovering = (env: NodeJS.ProcessEnv) =>
      deps({
        baseEnv: env,
        readRecoveryState: vi.fn(() =>
          Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
        ),
        serveRecovery: (_app: Hono, opts: { port: number }) => {
          ports.push(opts.port);
          return Promise.resolve(undefined);
        },
      });
    await runEntry(recovering({ WAITRON_HTTP_PORT: "443" }));
    await runEntry(recovering({}));
    expect(ports).toEqual([443, 8080]);
  });

  it("refuses an out-of-range WAITRON_HTTP_PORT instead of handing listen a raw RangeError", async () => {
    const ports: number[] = [];
    const d = deps({
      baseEnv: { WAITRON_HTTP_PORT: "999999" },
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      serveRecovery: (_app: Hono, opts: { port: number }) => {
        ports.push(opts.port);
        return Promise.resolve(undefined);
      },
    });
    await runEntry(d);
    expect(ports).toEqual([8080]);
  });

  it("a failing state-volume write neither throws nor kills a healthy server", async () => {
    const log = vi.fn();
    const scheduleStayedUp = vi.fn<(ms: number, onStayedUp: () => void) => void>(() => {});
    const d = deps({
      readRecoveryState: vi.fn(() => Promise.resolve({ ...FRESH, failures: 2 })),
      // The pre-boot write succeeds; the stayed-up clear, two minutes later, does not.
      writeRecoveryState: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error("EROFS")),
      scheduleStayedUp,
      log,
    });
    await runEntry(d);
    const [, onStayedUp] = scheduleStayedUp.mock.calls[0]!;
    // Left floating, this rejection is an unhandled rejection — which by Node's default takes down a
    // server that has been up and trading for two minutes.
    expect(() => onStayedUp()).not.toThrow();
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        "warn",
        "recovery.state_write_failed",
        expect.objectContaining({ errorCode: "unknown" }),
      ),
    );
  });

  it("the retry survives a failing state-volume write and still exits", async () => {
    let served: Hono | undefined;
    const exit = vi.fn();
    const d = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      writeRecoveryState: vi.fn(() => Promise.reject(new Error("EROFS"))),
      serveRecovery: (app: Hono) => {
        served = app;
        return Promise.resolve(undefined);
      },
      exit,
    });
    await runEntry(d);
    await served!.request("/recovery-api/retry", { method: "POST" });
    // A reset that failed leaves the box in recovery after the restart — the page comes back and the
    // operator can press the button again, which is a better outcome than a crash mid-response.
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("the recovery page's retry clears the counter and exits, leaving the restart to Docker", async () => {
    let served: Hono | undefined;
    const exit = vi.fn();
    const d = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 4, level: levelFor(4) }),
      ),
      serveRecovery: (app: Hono) => {
        served = app;
        return Promise.resolve(undefined);
      },
      exit,
    });
    await runEntry(d);
    const res = await served!.request("/recovery-api/retry", { method: "POST" });
    expect(res.status).toBe(200);
    // `await`ed through `waitFor`: with no Node response to hang the exit on (`app.request()` has
    // none), the route fires `onRetry` without awaiting it.
    await vi.waitFor(() => {
      expect(d.writeRecoveryState).toHaveBeenCalledWith("/state", FRESH);
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  it("persists the classified code, not `unknown`, for a raw driver failure", async () => {
    // Typed, not a bare `vi.fn(() => …)`: an untyped mock's `mock.calls` entries are a zero-length
    // tuple, so `[1]` is a typecheck error rather than the state we want to read.
    const writeRecoveryState = vi.fn<(stateDir: string, next: RecoveryState) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await expect(
      runEntry(
        deps({
          writeRecoveryState,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(
              // The shape the engine the box runs produces, wrapped the way drizzle wraps it: the
              // result code and the message sit on the cause. A missing column used to arrive as
              // SQLSTATE `42703`, which nothing can raise here any more.
              new Error("Failed query", {
                cause: Object.assign(new Error("no such column: legal_name"), {
                  errcode: 1,
                  code: "ERR_SQLITE_ERROR",
                }),
              }),
            ),
          ),
        }),
      ),
    ).rejects.toThrow();
    // The second write is the failure path's; the first is the pre-boot counter.
    const persisted = writeRecoveryState.mock.calls.at(-1)![1];
    expect(persisted.lastErrorCode).toBe("provisioning.schema_mismatch");
  });

  it("writes the scrubbed error to the installer's channel, with URL credentials masked", async () => {
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(new Error("connect failed: postgres://waitron:hunter2@db:5432/waitron")),
          ),
        }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    // The control and the probe in one assertion pair: the message must arrive, minus the secret.
    expect(reported).toContain("postgres://waitron:***@db:5432/waitron");
    expect(reported).not.toContain("hunter2");
  });

  // Drizzle does not re-expose the driver's error: it wraps it, so the outer message is
  // "Failed query: …" and the reason is only in `cause`. Measured against real PostgreSQL 18 with
  // drizzle's own `db.execute(sql`select absent_column`)`:
  //   outer message: Failed query: select absent_column\nparams:
  //   cause message: column "absent_column" does not exist   (cause.code 42703)
  // Reporting the outer error alone is what left the captured installer output with drizzle's query
  // wrapper and no reason at all (spec §4.4 exists so the installer can read the real reason).
  it("walks the cause chain so a wrapped driver error's real reason reaches the installer", async () => {
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(
              new Error("Failed query: select absent_column\nparams: ", {
                cause: Object.assign(new Error('column "absent_column" does not exist'), {
                  code: "42703",
                }),
              }),
            ),
          ),
        }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain('column "absent_column" does not exist');
    // The outer wrapper still travels — the query text is diagnostic too, and dropping it would be
    // the same defect in the other direction.
    expect(reported).toContain("Failed query: select absent_column");
  });

  // An `AppError`'s params ARE the diagnosis for the two codes this branch added:
  // `migrations.incomplete`'s counts say how far a partly-applied set got, and `database_ahead`'s
  // hashes name the migrations the image has no file for. Dropping them left the installer with a
  // code they already had from the structured line.
  it("carries an AppError's params to the installer, scrubbed like everything else", async () => {
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(
              new AppError("migrations.incomplete", { set: "core", applied: 10, expected: 15 }),
            ),
          ),
        }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("core");
    expect(reported).toContain("10");
    expect(reported).toContain("15");
  });

  // Proven by construction rather than reasoned about: a boot error whose params will not serialise
  // must still report the error. Without the fallback the JSON throw becomes the boot's outcome and
  // replaces the very reason this channel exists to carry. `as never` because the registry's typed
  // params cannot express a cycle — the guard is for a value that reaches here regardless.
  it("still reports a failure whose params will not serialise", async () => {
    const cyclic: Record<string, unknown> = { set: "core" };
    cyclic.self = cyclic;
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(new AppError("migrations.incomplete", cyclic as never)),
          ),
        }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("migrations.incomplete");
    expect(reported).toContain("params: (not serialisable)");
  });

  // A boot can throw a non-Error — a bare string from a dependency, a rejected promise with no
  // reason. There is no chain to walk and no stack to print; the installer still gets the value.
  it("reports a non-Error throw rather than printing nothing", async () => {
    const reportFailure = vi.fn();
    await expect(
      runEntry(
        deps({
          reportFailure,
          startServer: vi.fn<StartServer>(() => Promise.reject("boot gave up")),
        }),
      ),
    ).rejects.toBeTruthy();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("non-error thrown: boot gave up");
  });

  it("reports an Error that carries no stack with a placeholder in its place", async () => {
    const reportFailure = vi.fn();
    const stackless = new Error("boot failed without a stack");
    stackless.stack = undefined;
    await expect(
      runEntry(
        deps({ reportFailure, startServer: vi.fn<StartServer>(() => Promise.reject(stackless)) }),
      ),
    ).rejects.toBe(stackless);
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("Error: boot failed without a stack\n(no stack)");
  });

  it.each(["70000", "-1", "not-a-port"])(
    "falls back to the default landing port when WAITRON_HTTP_LANDING_PORT is %s",
    async (raw) => {
      const serveRecovery = vi.fn<
        (app: Hono, opts: { landing?: { landingPort?: number } }) => Promise<void>
      >(() => Promise.resolve());
      await runEntry(
        deps({
          baseEnv: { WAITRON_HTTP_LANDING_PORT: raw },
          readRecoveryState: vi.fn(() =>
            Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
          ),
          serveRecovery,
        }),
      );
      expect(serveRecovery.mock.calls[0]![1].landing?.landingPort).toBe(80);
    },
  );

  it("stops walking a self-referential cause rather than spinning", async () => {
    const reportFailure = vi.fn();
    const looped: Error & { cause?: unknown } = new Error("loops on itself");
    looped.cause = looped;
    await expect(
      runEntry(
        deps({ reportFailure, startServer: vi.fn<StartServer>(() => Promise.reject(looped)) }),
      ),
    ).rejects.toThrow();
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("loops on itself");
  });

  // The page must stay exactly as it was: the cause chain and the params are the INSTALLER's
  // channel, and spec §5 says neither may reach the unauthenticated page. Probe and control in one
  // test, because a page that rendered nothing would pass the first half alone.
  it("keeps the walked cause chain and the params off the page", async () => {
    const reportFailure = vi.fn();
    const writeRecoveryState = vi.fn<(stateDir: string, next: RecoveryState) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await expect(
      runEntry(
        deps({
          reportFailure,
          writeRecoveryState,
          startServer: vi.fn<StartServer>(() =>
            Promise.reject(
              new AppError("provisioning.database_ahead", {
                set: "core",
                unknownMigrations: ["deadbeefhash"],
              }),
            ),
          ),
        }),
      ),
    ).rejects.toThrow();

    const persisted = writeRecoveryState.mock.calls.at(-1)![1];
    const body = await (
      await recoveryApp({ state: persisted, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(body).not.toContain("deadbeefhash");
    // The page says its curated line and the code, and nothing from the params.
    expect(body).toContain("provisioning.database_ahead");

    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("deadbeefhash");
  });

  // The spec §5 probe, and the only place it can honestly live: the poisoned message has to be
  // INJECTED as a real boot failure and then followed to BOTH channels. A test that renders a page
  // the message never reached would pass against an implementation that leaks everywhere.
  it("keeps a leaked connection string off the page while the installer's channel carries it", async () => {
    const message = "connect failed: postgres://waitron:hunter2@db:5432/waitron";
    const reportFailure = vi.fn();
    const writeRecoveryState = vi.fn<(stateDir: string, next: RecoveryState) => Promise<void>>(() =>
      Promise.resolve(),
    );
    await expect(
      runEntry(
        deps({
          reportFailure,
          writeRecoveryState,
          startServer: vi.fn<StartServer>(() => Promise.reject(new Error(message))),
        }),
      ),
    ).rejects.toThrow();

    // The PROBE: the state the page will render, rendered.
    const persisted = writeRecoveryState.mock.calls.at(-1)![1];
    const body = await (
      await recoveryApp({ state: persisted, logDir: "/nonexistent", onRetry: vi.fn() }).request("/")
    ).text();
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("postgres://");

    // The CONTROL, in the other direction: the same failure DOES reach the installer, scrubbed.
    // Without it, a page that rendered nothing at all would pass the assertions above.
    const reported = reportFailure.mock.calls.map((call) => String(call[0])).join("\n");
    expect(reported).toContain("postgres://waitron:***@db:5432/waitron");
    expect(reported).not.toContain("hunter2");
  });

  it("refuses to start the server when the database is ahead of this image", async () => {
    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    const assertAhead = vi.fn(() =>
      Promise.reject(
        new AppError("provisioning.database_ahead", { set: "core", unknownMigrations: ["ff"] }),
      ),
    );
    await expect(
      runEntry(deps({ assertNotAhead: assertAhead, startServer })),
    ).rejects.toMatchObject({ code: "provisioning.database_ahead" });
    expect(startServer).not.toHaveBeenCalled();
  });

  it("checks the VENUE DIRECTORY for an ahead database before the server starts", async () => {
    const order: string[] = [];
    await runEntry(
      deps({
        runStagedRestore: vi.fn(() => {
          order.push("runStagedRestore");
          return Promise.resolve(false);
        }),
        assertNotAhead: vi.fn((venueDir: string) => {
          order.push(`assertNotAhead:${venueDir}`);
          return Promise.resolve();
        }),
        startServer: vi.fn<StartServer>(() => {
          order.push("startServer");
          return Promise.resolve({ close: () => Promise.resolve() });
        }),
      }),
    );
    // A restore replaces the venue files, so the check has to see what the restore left; and it has
    // to be BEFORE `startServer`, which migrates and then queries the schema.
    expect(order).toEqual(["runStagedRestore", "assertNotAhead:/venue", "startServer"]);
  });

  // `assertNotAhead` used to default to `() => Promise.resolve()`. Not alone in defaulting to a
  // no-op — `reportFailure` still does, deliberately — but it is the only one of this interface's
  // optional dependencies that is a GUARD, and the guard-shaped one next to it defaults to the real
  // implementation (`deps.runStagedRestore ?? runStagedRestore`). A no-op default loses the guard for
  // any caller that forgets the dependency, and silently: nothing throws, nothing logs, the server
  // just starts against a database the image cannot read.
  //
  // The probe: omit the dependency and name a venue directory that can never be created — a path
  // UNDER a regular file, which `mkdir` refuses with ENOTDIR. The real default opens the directory,
  // so the boot fails and the server is never started. What the FAILING case would print — a no-op
  // default — is a resolved `runEntry` with `startServer` called, which is what this asserted
  // before the default was changed.
  it("defaults the ahead check to the real one, not to a no-op", async () => {
    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    const blocker = join(await mkdtemp(join(tmpdir(), "wt-ahead-")), "a-file-not-a-directory");
    await writeFile(blocker, "x");
    await expect(
      runEntry(deps({ assertNotAhead: undefined, venueDir: join(blocker, "venue"), startServer })),
    ).rejects.toThrow();
    expect(startServer).not.toHaveBeenCalled();
  });
});

/**
 * A venue directory with EVERY migration set applied, beside a migrations root that resolves to the
 * same files the image ships.
 *
 * `useVenueDb` cannot serve here: it owns the directory privately and exposes only the handle,
 * where the wrapper under test takes the DIRECTORY. The root is built by symlinking each set's
 * resolved folder under one parent, which is the layout `<root>/<set name>` that
 * `resolveExistingMigrationsFolder` expects and `apps/server`'s build produces by copying.
 *
 * Every set is migrated deliberately: a set whose journal table does not exist is a different path
 * through `journalHashes`, not the behind/ahead comparison these two cases are about.
 */
async function migratedVenue(): Promise<{ venueDir: string; migrationsRoot: string }> {
  const sets = manifestSets();
  const options = migrationOptionsFor(sets, null);
  const migrationsRoot = await mkdtemp(join(tmpdir(), "wt-migrations-"));
  for (const [index, set] of sets.entries()) {
    await symlink(options[index]!.migrationsFolder, join(migrationsRoot, set.name), "dir");
  }
  const venueDir = await mkdtemp(join(tmpdir(), "wt-venue-"));
  await applyMigrations(venueDir, options);
  return { venueDir, migrationsRoot };
}

/**
 * The same root with one set carrying a migration the venue database has never applied: an ordinary
 * upgrade, which is what the entrypoint's check meets on every release that ships one. The set's
 * symlink is replaced by a real copy, so the extra file lands in the copy and never in the source
 * tree.
 */
async function shipOneMigrationMoreThanTheDatabaseHas(
  migrationsRoot: string,
  set: { name: string },
): Promise<void> {
  const folder = join(migrationsRoot, set.name);
  const source = await readlink(folder);
  await rm(folder);
  await cp(source, folder, { recursive: true });
  await writeFile(join(folder, "9999_future.sql"), "create table future_table (id integer);\n");
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Date.now(),
    tag: "9999_future",
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal));
}

/** Edits a migrated venue database and closes it again, so the wrapper opens it for itself. */
async function onVenue(venueDir: string, statement: SQL): Promise<void> {
  const store = await openVenueDatabase(venueDir);
  try {
    await store.venue.execute(statement);
  } finally {
    await store.close();
  }
}

describe("assertNotAhead", () => {
  const core = manifestSets().find((set) => set.name === "core")!;

  // The entrypoint runs this check BEFORE anything migrates, so the database it judges is routinely
  // one release BEHIND the image. `unknownHashes` compares in one direction only
  // (`packages/provisioning/src/schema-ahead.ts`), and this is the case that breaks the moment it
  // stops: measured by making that function two-directional, this rejects with
  // `provisioning.database_ahead` naming the migration the image ships and the database lacks.
  it("does not refuse a venue database BEHIND this image", async () => {
    const { venueDir, migrationsRoot } = await migratedVenue();
    await shipOneMigrationMoreThanTheDatabaseHas(migrationsRoot, core);
    await expect(assertNotAhead(venueDir, migrationsRoot)).resolves.toBeUndefined();
  });

  // A first boot: the entrypoint checks before anything has migrated, so no set has a journal table
  // yet. This is the case that made every first container start fail until 2026-09-22 —
  // `journalHashes` keyed its absent-table case on PostgreSQL's `42P01` and rethrew SQLite's
  // `no such table`. Failing here means a box restart-loops into recovery on its very first boot.
  it("a VIRGIN venue directory passes the ahead check", async () => {
    const { migrationsRoot } = await migratedVenue();
    const venueDir = await mkdtemp(join(tmpdir(), "wt-venue-virgin-"));
    await expect(assertNotAhead(venueDir, migrationsRoot)).resolves.toBeUndefined();
  });

  it("refuses a venue database AHEAD of this image", async () => {
    const { venueDir, migrationsRoot } = await migratedVenue();
    await onVenue(
      venueDir,
      sql.raw(
        `insert into "${core.table}" ("hash", "created_at") values ('deadbeefhash', 9999999999999)`,
      ),
    );
    await expect(assertNotAhead(venueDir, migrationsRoot)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core", unknownMigrations: ["deadbeefhash"] },
    });
  });
});

describe("serveRecovery's bind failure", () => {
  it("rejects with the classified listen failure rather than leaving a page-less container up", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-bind-"));
    const app = recoveryApp({ state: FRESH, logDir: stateDir, onRetry: () => Promise.resolve() });
    const first = await serveRecovery(app, { stateDir, port: 0, log: vi.fn() });
    const address = first.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await expect(serveRecovery(app, { stateDir, port, log: vi.fn() })).rejects.toMatchObject({
        code: "server.listen_failed",
        params: { port, code: "EADDRINUSE" },
      });
    } finally {
      await new Promise<void>((resolve) => first.close(() => resolve()));
    }
  });
});

describe("serveRecovery's landing listener", () => {
  it("starts the landing listener beside the recovery server and closes it on teardown", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-landing-"));
    const app = recoveryApp({ state: FRESH, logDir: stateDir, onRetry: () => Promise.resolve() });
    // The wiring is asserted with an injected stand-in rather than a real port-80 bind: the wire under
    // test is "recovery starts it and closes it", not the plain-HTTP socket startLandingListener owns
    // (covered by boot's own suite).
    const close = vi.fn(() => Promise.resolve());
    const startLanding = vi.fn(() => ({ close }));
    const landing = {
      landingPort: 80,
      httpHost: "0.0.0.0",
      stateDir,
      httpPort: 8080,
      boxAddresses: undefined,
      tls: undefined,
    };
    const server = await serveRecovery(app, {
      stateDir,
      port: 0,
      log: vi.fn(),
      landing,
      startLanding,
    });
    try {
      expect(startLanding).toHaveBeenCalledWith(landing, expect.any(Function));
      expect(close).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Closing the recovery server cascades to the landing listener.
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("swallows a landing listener that fails to close when the recovery server is torn down", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-landing3-"));
    const app = recoveryApp({ state: FRESH, logDir: stateDir, onRetry: () => Promise.resolve() });
    // A plain function, not `vi.fn`: a spy attaches its own handlers to a returned promise, which
    // would mark the rejection handled whether or not the code under test does.
    let closes = 0;
    const close = (): Promise<void> => {
      closes += 1;
      return Promise.reject(new Error("landing close failed"));
    };
    const server = await serveRecovery(app, {
      stateDir,
      port: 0,
      log: vi.fn(),
      landing: {
        landingPort: 80,
        httpHost: "0.0.0.0",
        stateDir,
        httpPort: 8080,
        boxAddresses: undefined,
        tls: undefined,
      },
      startLanding: vi.fn(() => ({ close })),
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await vi.waitFor(() => expect(closes).toBe(1));
      // One macrotask so an unhandled rejection, if any, is reported before the listener goes.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("starts no landing listener when none is configured", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-landing2-"));
    const app = recoveryApp({ state: FRESH, logDir: stateDir, onRetry: () => Promise.resolve() });
    const startLanding = vi.fn(() => ({ close: vi.fn(() => Promise.resolve()) }));
    const server = await serveRecovery(app, { stateDir, port: 0, log: vi.fn(), startLanding });
    try {
      expect(startLanding).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("recoveryTlsFiles", () => {
  it("is undefined when the box has never minted a leaf, so the page falls back to plain HTTP", async () => {
    expect(recoveryTlsFiles(await mkdtemp(join(tmpdir(), "wt-tls-")))).toBeUndefined();
  });

  it("is the box's own leaf when the state volume holds one", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-tls-"));
    await mkdir(join(stateDir, "tls"));
    await writeFile(join(stateDir, "tls", "server.crt"), "x");
    await writeFile(join(stateDir, "tls", "server.key"), "x");
    expect(recoveryTlsFiles(stateDir)).toEqual({
      certFile: join(stateDir, "tls", "server.crt"),
      keyFile: join(stateDir, "tls", "server.key"),
    });
  });
});

describe("serveRecovery", () => {
  it("serves the page over plain HTTP when there is no leaf to serve it with", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-serve-"));
    const onRetry = vi.fn(() => Promise.resolve());
    const app = recoveryApp({
      state: { ...FRESH, failures: 3, level: "recovery", lastErrorCode: "module.config_invalid" },
      logDir: stateDir,
      onRetry,
    });
    const server = await serveRecovery(app, { stateDir, port: 0, log: vi.fn() });
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("module.config_invalid");
      const trust = await fetch(`http://127.0.0.1:${port}/setup/trust`);
      expect(trust.status).toBe(200);
      expect(await trust.text()).toContain("to this Waitron server");

      // The retry, over a REAL socket: the body must arrive in full BEFORE `onRetry` (which exits
      // the process in production) runs. A test through `app.request()` cannot see this ordering at
      // all — there is no Node response to finish.
      const retried = await fetch(`http://127.0.0.1:${port}/recovery-api/retry`, {
        method: "POST",
      });
      expect(await retried.json()).toEqual({ ok: true });
      await vi.waitFor(() => expect(onRetry).toHaveBeenCalledWith("normal"));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
