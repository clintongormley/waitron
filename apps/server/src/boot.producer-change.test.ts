import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { loadKeyRing } from "@waitron/credentials";
import { cadenas } from "@waitron/fiscal-verifactu";
import { isAppError } from "@waitron/shared";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { establishNodeIdentity } from "./node-identity.js";
import { insertFiscalRegistro, seedFiscalParents } from "./testing/fiscal-fixtures.js";
import { freePort } from "./testing/free-ports.js";
import { useTestProducer } from "./testing/test-producer.js";

useTestProducer();

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// `undici`'s `fetch` rejects, so no background dial reaches a real host.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in boot.producer-change.test.ts")),
    ),
  };
});

const { startServer } = ephemeralServerFixture();

// One production venue whose node's chain head is a record filed under HEAD_PRODUCER_NIF, started
// in turn with another producer (refused), with the head's own producer (trades), and, as a mirror,
// with the other producer again (trades). Every seeding write happens while no server is running.

const CREDENTIALS_KEY = Buffer.alloc(32, 6).toString("base64");
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const NODE_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "55555555-5555-4555-8555-555555555555";
const SERIES_ID = "44444444-4444-4444-8444-444444444444";
const ORIGIN_NODE_ID = "77777777-7777-4777-8777-777777777777";
// Differs from `useTestProducer`'s 00000000T; both pass the tax-number check.
const HEAD_PRODUCER_NIF = "12345678Z";

let migrationsRoot: string;
let venueDir: string;
let store: VenueDatabase;
let db: Database;
let node: NodeDatabase;

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-producer-change-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  venueDir = await mkdtemp(join(tmpdir(), "waitron-producer-change-venue-"));
  await applyMigrations(venueDir, fromSource);
  store = await openVenueDatabase(venueDir);
  db = store.venue;
  node = store.node;

  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Producer Change SL" });
  await db.insert(locations).values({
    id: LOCATION_ID,

    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await seedVenueSettings(db, { name: "Barra" });
  await db.insert(nodes).values({ id: NODE_ID, locationId: LOCATION_ID, name: "Node" });
  await db.insert(invoiceSeries).values({ id: SERIES_ID, nodeId: NODE_ID, code: "A" });
  await establishNodeIdentity({ ownerDb: db, node, ring: RING }, NODE_ID);
  const ids = await seedFiscalParents(db, {
    ids: { locationId: LOCATION_ID, nodeId: NODE_ID, seriesId: SERIES_ID },
    reuseExistingParents: true,
  });
  const head = await insertFiscalRegistro(db, ids, {
    sistemaInformatico: {
      NombreRazon: "HEAD PRODUCER",
      NIF: HEAD_PRODUCER_NIF,
      NombreSistemaInformatico: "Waitron",
    },
  });
  await db.insert(cadenas).values({
    nodeId: NODE_ID,
    secuencia: head.secuencia,
    ultimoRegistroId: head.registroId,
    ultimaHuella: head.huella,
  });
  await stampDeployment(db, "production");
}, 180_000);

afterAll(async () => {
  await store?.close();
  for (const directory of [venueDir, migrationsRoot]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

async function poll<T>(predicate: () => T | undefined): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~10s");
}

/** Starts a production server on the venue, with `taxId` as the running producer's tax number. */
async function startWith(taxId: string | undefined) {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-producer-change-state-"));
  writeFileSync(
    join(stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const before = process.env.WAITRON_PRODUCER_TAX_ID;
  if (taxId !== undefined) process.env.WAITRON_PRODUCER_TAX_ID = taxId;
  const port = await freePort();
  try {
    const server = await startServer({
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "production",
      WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
      WAITRON_MIN_TICK_MS: "250",
      WAITRON_MAX_TICK_MS: "1000",
      WAITRON_SKIP_RETRY_MS: "250",
      WAITRON_NODE_ID: NODE_ID,
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    return {
      server,
      cleanUp: () => rm(stateDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(stateDir, { recursive: true, force: true });
    throw error;
  } finally {
    if (before === undefined) delete process.env.WAITRON_PRODUCER_TAX_ID;
    else process.env.WAITRON_PRODUCER_TAX_ID = before;
  }
}

describe("a start whose node's chain was recorded under another producer", () => {
  it("refuses sif.producer_changed in production and does not trade", async () => {
    const caught = await startWith(undefined).then(
      async ({ server, cleanUp }) => {
        await server.close();
        await cleanUp();
        return undefined;
      },
      (error: unknown) => error,
    );
    expect(isAppError(caught) && caught.code).toBe("sif.producer_changed");
  }, 60_000);

  it("trades when the running producer is the one the chain was recorded under", async () => {
    const { server, cleanUp } = await startWith(HEAD_PRODUCER_NIF);
    try {
      await poll(() => server.health.lastPassAt ?? undefined);
    } finally {
      await server.close();
      await cleanUp();
    }
  }, 60_000);

  // The same node and chain head, started as a mirror: a mirror adds no record, so it is not asked.
  // Stays last: it leaves the shared venue a mirror.
  it("trades as a mirror with the other producer", async () => {
    await writeMirrorLink(node, NODE_ID, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.test",
      boxCaPem: "unused-ca-pem",
      originNodeId: ORIGIN_NODE_ID,
    });
    await setNodeMode({ venue: db, node }, NODE_ID, "mirror");
    const { server, cleanUp } = await startWith(undefined);
    try {
      await poll(() => server.health.lastPassAt ?? undefined);
    } finally {
      await server.close();
      await cleanUp();
    }
  }, 60_000);
});
