import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { FRESH, levelFor } from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { recoveryTlsFiles, runEntry, serveRecovery, waitForPostgres } from "./node-entry.js";

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close: () => Promise<void> }>;

function deps(over: Partial<Parameters<typeof runEntry>[0]> = {}) {
  return {
    baseEnv: { WAITRON_BOOTSTRAP_DATABASE_URL: "postgres://postgres:pg@127.0.0.1/postgres" },
    stateDir: "/state",
    waitForPostgres: vi.fn(() => Promise.resolve()),
    ensureInstance: vi.fn(() =>
      Promise.resolve({
        databaseUrl: "postgres://app",
        migrationsDatabaseUrl: "postgres://migrator",
        replicationPassword: "r",
      }),
    ),
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

describe("runEntry", () => {
  it("never passes the superuser URL to the server", async () => {
    // The mock is held here, not read back off `deps()`: the spread with the `Partial` override
    // widens every field to a union, and a union has no `.mock`.
    const startServer = vi.fn<StartServer>(() =>
      Promise.resolve({ close: () => Promise.resolve() }),
    );
    await runEntry(deps({ startServer }));
    const env = startServer.mock.calls[0]![0];
    expect(env.WAITRON_BOOTSTRAP_DATABASE_URL).toBeUndefined();
    expect(env.WAITRON_ADMIN_DATABASE_URL).toBe("postgres://migrator");
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

  it("decides BEFORE touching Postgres — the page is served even when the database is unreachable", async () => {
    const d = deps({
      readRecoveryState: vi.fn(() =>
        Promise.resolve({ ...FRESH, failures: 3, level: levelFor(3) }),
      ),
      waitForPostgres: vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
      ensureInstance: vi.fn(() => Promise.reject(new Error("must not be called"))),
    });
    await runEntry(d);
    expect(d.serveRecovery).toHaveBeenCalled();
    expect(d.waitForPostgres).not.toHaveBeenCalled();
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
      { waitForPostgres: vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))) },
      {
        ensureInstance: vi.fn(() =>
          Promise.reject(
            new AppError("provisioning.role_unusable", {
              role: "waitron_repl",
              missing: ["LOGIN"],
            }),
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
      waitForPostgres: vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
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

  it("counts a boot that HANGS in the instance bootstrap, which no failure handler can see", async () => {
    // The pre-boot write's own unique job. The wide `try`/`catch` already records every boot step
    // that THROWS, so a control that only moves this write down still passes on the throwing cases;
    // a hang is what separates them. `ensureInstance` is the reachable hang — `waitForPostgres` is
    // bounded and throws, and `loadBoxEnv` is filesystem work — and it is the real shape of a
    // Postgres that accepts TCP and then never answers.
    const d = deps({ ensureInstance: vi.fn(() => new Promise<never>(() => {})) });
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
    let passed: { migrationsRoot: string | null } | undefined;
    const d = deps({
      ensureInstance: (opts) => {
        passed = opts;
        return Promise.resolve({
          databaseUrl: "postgres://app",
          migrationsDatabaseUrl: "postgres://migrator",
          replicationPassword: "r",
        });
      },
    });
    await runEntry(d);
    // `null` is what fails a real container's first boot with `migrations.set_missing`. The two
    // properties `boot.test.ts` pins on DEFAULT_MIGRATIONS_ROOT itself are asserted here too, so the
    // entrypoint and the server it starts cannot migrate from two different folders.
    expect(passed!.migrationsRoot).not.toBeNull();
    expect(isAbsolute(passed!.migrationsRoot!)).toBe(true);
    expect(basename(passed!.migrationsRoot!)).toBe("drizzle");
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

  it("refuses an unset OR empty bootstrap URL before it can resolve to localhost", async () => {
    for (const raw of [undefined, ""]) {
      const d = deps({ baseEnv: { WAITRON_BOOTSTRAP_DATABASE_URL: raw } });
      await expect(runEntry(d)).rejects.toMatchObject({ code: "server.config_missing" });
      expect(d.waitForPostgres).not.toHaveBeenCalled();
    }
  });

  it("refuses a bootstrap URL that is not a URL, rather than handing it to the driver", async () => {
    const d = deps({ baseEnv: { WAITRON_BOOTSTRAP_DATABASE_URL: "/var/run/postgresql" } });
    await expect(runEntry(d)).rejects.toMatchObject({
      code: "provisioning.admin_uri_not_a_url",
      params: { variable: "WAITRON_BOOTSTRAP_DATABASE_URL" },
    });
    expect(d.waitForPostgres).not.toHaveBeenCalled();
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
});

describe("waitForPostgres", () => {
  it("returns as soon as a connection succeeds, after transient failures", async () => {
    let calls = 0;
    const delay = vi.fn(() => Promise.resolve());
    await waitForPostgres("postgres://x", {
      connect: () => {
        calls += 1;
        return calls < 3 ? Promise.reject(new Error("ECONNREFUSED")) : Promise.resolve();
      },
      delay,
      log: vi.fn(),
      attempts: 10,
    });
    expect(calls).toBe(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });

  it("gives up with a classified code that carries no connection string", async () => {
    const attempt = await waitForPostgres("postgres://u:secret@h/d", {
      connect: () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
      delay: () => Promise.resolve(),
      log: vi.fn(),
      attempts: 3,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(attempt).toBeInstanceOf(AppError);
    expect((attempt as AppError).code).toBe("provisioning.database_unreachable");
    expect(JSON.stringify((attempt as AppError).params)).not.toContain("secret");
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
