import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { BoxHostClient } from "./box-host-client.js";
import { createClockWatch } from "./clock-watch.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { clockServiceAnswer } from "./testing/synchronised-box-host.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
vi.mock("./module-operation-host.js", { spy: true });
vi.mock("./node-operation-preparation.js", { spy: true });
vi.mock("./clock-watch.js", { spy: true });

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

async function startWith(
  boxHost: BoxHostClient,
  whileStarted: () => Promise<void>,
  options: { filesRecords?: boolean } = {},
): Promise<void> {
  const venue = await setupVenue(suite.db);
  const [port] = await freePorts(1);
  let scratch: string | undefined;
  let server: StartedServer | undefined;
  try {
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-time-service-"));
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await seedModuleSettings(suite.db, { "fiscal-none": false });
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const env = {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      ...(options.filesRecords === true ? { WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" } : {}),
    };
    server = await startServer(env, env, { boxHost });
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${httpPort()}/health`)).status).toBe(200);
    });
    await whileStarted();
  } finally {
    if (server !== undefined) await server.close();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

it("a trading start's first-setup and live-operation hosts ask its own box host, afresh at each reading", async () => {
  let synchronised = true;
  const boxHost: BoxHostClient = {
    clockStatus: vi.fn(async () => clockServiceAnswer(synchronised)),
    setClock: async () => ({ available: false, reason: "missing" }),
  };
  await startWith(boxHost, async () => {
    const readers = [
      vi.mocked(createFirstSetupModuleHost).mock.lastCall![0].timeServiceSynchronised!,
      vi.mocked(createNodeOperationPreparation).mock.lastCall![0].timeServiceSynchronised!,
    ];
    for (const read of readers) {
      const asked = vi.mocked(boxHost.clockStatus).mock.calls.length;
      synchronised = true;
      expect(await read()).toBe(true);
      synchronised = false;
      expect(await read()).toBe(false);
      expect(vi.mocked(boxHost.clockStatus).mock.calls.length).toBe(asked + 2);
    }
  });
});

it("a start waiting for its time on a box that files records hands the clock watch a restart of its own box host's time service", async () => {
  const boxHost: BoxHostClient = {
    clockStatus: async () => clockServiceAnswer(false),
    setClock: async () => ({ available: false, reason: "missing" }),
    retryTimeService: vi.fn(async () => ({ available: true as const })),
  };
  await startWith(
    boxHost,
    async () => {
      const start = vi.mocked(createClockWatch).mock.lastCall![0].start!;
      expect(start.filesRecords()).toBe(true);
      await start.retryTimeService!();
      expect(boxHost.retryTimeService).toHaveBeenCalledTimes(1);
    },
    { filesRecords: true },
  );
});

it("tells the clock watch that a preproduction box without test filing files no records", async () => {
  const boxHost: BoxHostClient = {
    clockStatus: async () => clockServiceAnswer(false),
    setClock: async () => ({ available: false, reason: "missing" }),
  };
  await startWith(boxHost, async () => {
    expect(vi.mocked(createClockWatch).mock.lastCall![0].start!.filesRecords()).toBe(false);
  });
});
