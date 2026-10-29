import { randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { TillApiDeps } from "./till-api.js";
import { insertFiscalRegistro, insertFiscalSale } from "./testing/fiscal-fixtures.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer } = ephemeralServerFixture();

type Stopped = (tx: Transaction, now: Date) => Promise<boolean>;

const seen = vi.hoisted(() => ({
  stopped: [] as (Stopped | undefined)[],
  tillDeps: [] as unknown[],
}));

vi.mock("./time-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./time-health.js")>();
  return {
    ...actual,
    authorityClockAlertSource: (...args: Parameters<typeof actual.authorityClockAlertSource>) => {
      seen.stopped.push(args[1]);
      return actual.authorityClockAlertSource(...args);
    },
  };
});
vi.mock("./till-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./till-api.js")>();
  return {
    ...actual,
    mountTillApi: (...args: Parameters<typeof actual.mountTillApi>) => {
      seen.tillDeps.push(args[1]);
      return actual.mountTillApi(...args);
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });

async function startEnv(scratch: string) {
  const venue = await setupVenue(suite.db);
  const [port] = await freePorts(1);
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
  };
  return { env, venue };
}

beforeEach(() => {
  seen.stopped.length = 0;
  seen.tillDeps.length = 0;
});

/** Starts the server on the suite's venue, then asks the drift alert's `stopped` at `now`, in a
 * transaction on the server's own database. */
async function askStopped(seed: (venue: Venue) => Promise<void>, now: Date): Promise<boolean> {
  beforeServerStarts();
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-clock-behind-wiring-"));
  let server: StartedServer | undefined;
  try {
    const { env, venue } = await startEnv(scratch);
    await seed(venue);
    server = await startServer(env, env);
    expect(seen.stopped).toHaveLength(1);
    const stopped = seen.stopped[0];
    expect(stopped).toBeTypeOf("function");
    const db = (seen.tillDeps[0] as TillApiDeps).db;
    return await withTransaction(db, (tx) => stopped!(tx, now));
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/** One record of the venue's own node, generated at 2026-07-20T18:20:30Z. */
async function recordOn(venue: Venue): Promise<void> {
  const [sif] = suite.db.all<{ id: string }>(
    sql`select id from registro_sif where node_id = ${venue.cfg.nodeId}`,
  );
  const ids = {
    locationId: venue.cfg.locationId,
    nodeId: venue.cfg.nodeId,
    seriesId: venue.seriesId,
    saleId: randomUUID(),
    sifId: sif!.id,
  };
  await insertFiscalSale(suite.db, ids);
  await insertFiscalRegistro(suite.db, ids, { entorno: "preproduction" });
}

describe("boot's clock-behind wiring for the drift alert", () => {
  it("answers stopped for a time a day before the latest record", async () => {
    expect(await askStopped(recordOn, new Date("2026-07-19T18:20:30.000Z"))).toBe(true);
  });

  it("answers not stopped for a time a day after the latest record", async () => {
    expect(await askStopped(recordOn, new Date("2026-07-21T18:20:30.000Z"))).toBe(false);
  });

  it("answers not stopped on a venue with no records", async () => {
    expect(await askStopped(async () => {}, new Date("2026-07-19T18:20:30.000Z"))).toBe(false);
  });
});
