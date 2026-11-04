import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stampDeployment } from "@waitron/db";
import { setSingletonRole } from "@waitron/node-db";
import { startFiscalReconciliation } from "./fiscal-reconciliation.js";
import { runPendingCardLoop } from "./pending-card-recovery.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu/src/slot.js";
import { freePort } from "./testing/free-ports.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  KEY_ENV,
  TRADING_STATE_DIR,
  copyMigrationsRoot,
  freshVenue,
  seedSharedVenue,
} from "./testing/boot-harness.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
vi.mock("./pending-card-recovery.js", async (original) => ({
  ...(await original<typeof import("./pending-card-recovery.js")>()),
  runPendingCardLoop: vi.fn(
    (await original<typeof import("./pending-card-recovery.js")>()).runPendingCardLoop,
  ),
}));
vi.mock("./fiscal-reconciliation.js", async (original) => {
  const actual = await original<typeof import("./fiscal-reconciliation.js")>();
  return {
    ...actual,
    startFiscalReconciliation: vi.fn((deps) => {
      const duty = actual.startFiscalReconciliation(deps);
      return { stop: vi.fn(() => duty.stop()) };
    }),
  };
});
beforeEach(() => {
  vi.mocked(startFiscalReconciliation).mockClear();
});
const { startServer, httpPort } = ephemeralServerFixture();
afterAll(async () => {
  await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("boot's fiscal reconciliation duty", () => {
  it("serves HTTP and runs submission while its startup lookup is pending, then joins it on close", async () => {
    const venue = await freshVenue();
    const migrations = await mkdtemp(join(tmpdir(), "waitron-fiscal-reconciliation-migrations-"));
    const held = gate();
    const called: Date[] = [];
    const create = vi
      .spyOn(FISCAL_SLOT, "createReconciliation")
      .mockImplementation(() => async (at) => {
        called.push(at);
        await held.promise;
        return { nextDueAt: new Date(at.getTime() + 86_400_000) };
      });
    const drain = vi.spyOn(FISCAL_SLOT, "drain").mockResolvedValue(emptyDrainResult());
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let cleanupDuty: ReturnType<typeof startFiscalReconciliation> | undefined;
    try {
      await seedSharedVenue(venue.store.venue);
      await copyMigrationsRoot(migrations);
      server = await startServer({
        ...KEY_ENV,
        WAITRON_ENV: "preproduction",
        WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
        WAITRON_VENUE_DIR: venue.directory,
        WAITRON_MIGRATIONS_DIR: migrations,
        WAITRON_HTTP_PORT: String(await freePort()),
      });
      await vi.waitFor(() => expect(called).toHaveLength(1));
      cleanupDuty = vi.mocked(startFiscalReconciliation).mock.results.at(-1)!.value;
      await vi.waitFor(() => expect(server!.health.lastPassAt).not.toBeNull());
      const response = await fetch(`http://127.0.0.1:${httpPort()}/api/node`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ acceptingSales: true });
      expect(drain).toHaveBeenCalled();
      expect(create.mock.calls[0]![0]).toMatchObject({
        nodeId: KEY_ENV.WAITRON_NODE_ID,
        environment: "preproduction",
      });
      let stopped = false;
      const close = server.close().then(() => {
        stopped = true;
      });
      await vi.waitFor(() => expect(cleanupDuty!.stop).toHaveBeenCalled());
      expect(stopped).toBe(false);
      held.resolve();
      await close;
      expect(stopped).toBe(true);
      expect(called).toHaveLength(1);
    } finally {
      held.resolve();
      await cleanupDuty?.stop();
      await server?.close();
      create.mockRestore();
      drain.mockRestore();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(migrations, { recursive: true, force: true });
    }
  }, 60_000);

  it.each([
    { intent: undefined, optedIn: false, secondary: false },
    { intent: "demo", optedIn: true, secondary: false },
    { intent: "prepare", optedIn: true, secondary: false },
    { intent: undefined, optedIn: true, secondary: true },
  ])(
    "keeps lookups off for intent $intent, opted-in $optedIn, secondary $secondary",
    async ({ intent, optedIn, secondary }) => {
      const venue = await freshVenue();
      const migrations = await mkdtemp(join(tmpdir(), "waitron-fiscal-reconciliation-policy-"));
      const calls: Date[] = [];
      const create = vi
        .spyOn(FISCAL_SLOT, "createReconciliation")
        .mockImplementation(() => async (at) => {
          calls.push(at);
          return { nextDueAt: new Date(at.getTime() + 86_400_000) };
        });
      let server: Awaited<ReturnType<typeof startServer>> | undefined;
      try {
        await seedSharedVenue(venue.store.venue);
        if (secondary) {
          await stampDeployment(venue.store.venue, "preproduction");
          await setSingletonRole(venue.store, KEY_ENV.WAITRON_NODE_ID, "secondary");
        }
        await copyMigrationsRoot(migrations);
        server = await startServer({
          ...KEY_ENV,
          WAITRON_ENV: "preproduction",
          WAITRON_ONBOARDING_INTENT: intent,
          WAITRON_FISCAL_TEST_SUBMISSIONS: optedIn ? "enabled" : undefined,
          WAITRON_VENUE_DIR: venue.directory,
          WAITRON_MIGRATIONS_DIR: migrations,
          WAITRON_HTTP_PORT: String(await freePort()),
        });
        await vi.waitFor(() => expect(server!.health.lastPassAt).not.toBeNull());
        await server.close();
        expect(calls).toEqual([]);
      } finally {
        await server?.close();
        create.mockRestore();
        await venue.store.close();
        await rm(venue.directory, { recursive: true, force: true });
        await rm(migrations, { recursive: true, force: true });
      }
    },
    60_000,
  );
  it("waits for a started lookup when a later boot step throws", async () => {
    const venue = await freshVenue();
    const migrations = await mkdtemp(join(tmpdir(), "waitron-fiscal-reconciliation-failed-start-"));
    const held = gate();
    const started = gate();
    const called: Date[] = [];
    const failure = new Error("later boot step failed");
    const create = vi
      .spyOn(FISCAL_SLOT, "createReconciliation")
      .mockImplementation(() => async (at) => {
        called.push(at);
        started.resolve();
        await held.promise;
        return { nextDueAt: new Date(at.getTime() + 86_400_000) };
      });
    vi.mocked(runPendingCardLoop).mockImplementationOnce(() => {
      throw failure;
    });
    let pending: Promise<unknown> | undefined;
    let cleanupDuty: ReturnType<typeof startFiscalReconciliation> | undefined;
    try {
      await seedSharedVenue(venue.store.venue);
      await copyMigrationsRoot(migrations);
      let settled = false;
      pending = new Promise<void>((resolve) => setTimeout(resolve, 1200))
        .then(async () =>
          startServer({
            ...KEY_ENV,
            WAITRON_ENV: "preproduction",
            WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
            WAITRON_VENUE_DIR: venue.directory,
            WAITRON_MIGRATIONS_DIR: migrations,
            WAITRON_HTTP_PORT: String(await freePort()),
          }),
        )
        .then(
          async (server) => {
            await server.close();
            return "unexpected server";
          },
          (error: unknown) => error,
        )
        .then((result) => {
          settled = true;
          return result;
        });
      await Promise.race([started.promise, pending]);
      expect(called).toHaveLength(1);
      cleanupDuty = vi.mocked(startFiscalReconciliation).mock.results.at(-1)!.value;
      await vi.waitFor(() => expect(cleanupDuty!.stop).toHaveBeenCalled());
      expect(settled).toBe(false);
      held.resolve();
      expect(await pending).toBe(failure);
      expect(settled).toBe(true);
      expect(called).toHaveLength(1);
    } finally {
      held.resolve();
      await cleanupDuty?.stop();
      await pending;
      create.mockRestore();
      await venue.store.close();
      await rm(venue.directory, { recursive: true, force: true });
      await rm(migrations, { recursive: true, force: true });
    }
  }, 60_000);
});
