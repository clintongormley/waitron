import { seedModuleSettings } from "../test/module-settings.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  nodes,
  openVenueDatabase,
  readStandardSeriesId,
  stampDeployment,
  taxpayer,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { setNodeMode, setSingletonRole, writeMirrorLink } from "@waitron/node-db";
import { loadKeyRing } from "@waitron/credentials";
import type {
  Endorsement,
  MembershipDocumentBody,
  SignedMembershipDocument,
} from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { establishNodeIdentity } from "./node-identity.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { freePort } from "./testing/free-ports.js";
import { pollOrThrow } from "./testing/boot-harness.js";
import { useTestProducer } from "./testing/test-producer.js";

useTestProducer();

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { startServer, httpPort } = ephemeralServerFixture();

// `undici`'s `fetch` rejects, so no background dial reaches a real host; Node's global `fetch`, a
// separate module identity, still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in boot.promote-endpoint.test.ts")),
    ),
  };
});

// Disables `fiscal-none` so a trading or mirror boot does not refuse `module.fiscal_slot_ambiguous`.

const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-endpoint-state-"));

const CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY_ENV = {
  // Keeps the plain-HTTP landing listener off privileged port 80.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
};

// Short ticks so the boot loop's first pass lands inside the poll budget.
const TIMINGS = { minTickMs: 250, maxTickMs: 1_000, skipRetryMs: 250 };

// The same credentials key boot loads, so the identity sealed here is the one a promote unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const TILL_ENV = {
  WAITRON_NODE_ID: "33333333-3333-4333-8333-333333333333",
};

const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

let migrationsRoot: string;
// Separate venue directories, so neither deployment's stamps leak into the other.
let appVenueDir: string;
let mirrorVenueDir: string;
let appDb: Database;
let mirrorDb: Database;
let appNode: NodeDatabase;
let mirrorNode: NodeDatabase;
const openStores: VenueDatabase[] = [];

/** `readNodeMembership` does not verify the signature, so a placeholder is fine. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 5,
    nodes: [{ nodeId: TILL_ENV.WAITRON_NODE_ID, contactUrl: "", standing }],
  };
  return {
    body,
    signerNodeId: TILL_ENV.WAITRON_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

/** Includes a node identity, so a promote has a key to sign with. */
async function seedIdentity(db: Database, node: NodeDatabase): Promise<void> {
  await seedModuleSettings(db, { "fiscal-none": false });
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Endpoint Venue SL" })
    .onConflictDoNothing();
  await seedVenueSettings(db, {
    name: "Barra",
    invoiceLocales: ["en"],
  });
  await seedBusinessDay(db, {});
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_NODE_ID,
      name: "Promote Endpoint node",
    })
    .onConflictDoNothing();
  await establishNodeIdentity({ ownerDb: db, node, ring: RING }, TILL_ENV.WAITRON_NODE_ID);
}

/** A mirror holding its own dormant identity. */
async function seedMirrorIdentity(db: Database, node: NodeDatabase): Promise<{ nodeId: string }> {
  await seedModuleSettings(db, { "fiscal-none": false });
  await db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote Endpoint Cloud SL" })
    .onConflictDoNothing();
  await seedVenueSettings(db, { name: "Barra" });
  await seedBusinessDay(db, {});
  const t = await db.execute<{ tax_id: string }>(sql`select tax_id from taxpayer where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: db },
    {
      standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "vat",
      modules: [],
      reserved: {
        modules: {
          "fiscal-verifactu": {
            nif,
            idSistemaInformatico: "W1",
            numeroInstalacion: MIRROR_NUMERO_INSTALACION,
          },
        },
        series: [{ code: "FA-7", purpose: "standard" }],
        endorsement,
      },
    },
  );

  const held: SignedMembershipDocument = {
    body: {
      term: 3,
      nodes: [
        { nodeId: MIRROR_ORIGIN_NODE_ID, contactUrl: "https://old", standing: "serving-primary" },
        { nodeId: standby.nodeId, contactUrl: "", standing: "serving-secondary" },
      ],
    },
    signerNodeId: MIRROR_ORIGIN_NODE_ID,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
  await writeNodeMembership(db, held);

  await writeMirrorLink(node, standby.nodeId, {
    originUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  await stampDeployment(db, "production");
  await setNodeMode({ venue: db, node }, standby.nodeId, "mirror", "adopt");
  // Throws if the seed left no reserved standard series.
  await readStandardSeriesId(db, standby.nodeId);
  return { nodeId: standby.nodeId };
}

/** Migrated here, not by boot, because the identity rows have to exist before boot reads them. */
async function migratedVenue(): Promise<[string, Database, NodeDatabase]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue, store.node];
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  [appVenueDir, appDb, appNode] = await migratedVenue();
  [mirrorVenueDir, mirrorDb, mirrorNode] = await migratedVenue();
  await seedIdentity(appDb, appNode);
  // No recorded role group: `readNodeMode` reads it as ('primary', 'primary').
  await stampDeployment(appDb, "production");
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  for (const directory of [appVenueDir, mirrorVenueDir]) {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

async function retiredPosts(base: string) {
  const answers = [];
  for (const path of ["/management-api/promote", "/management-api/promote/preparation"]) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    answers.push({ path, status: response.status, body: await response.text() });
  }
  return answers;
}

const refused = JSON.stringify({ error: { code: "node.read_only", params: {} } });

describe("retired promotion routes", () => {
  it("the mirror read-only gate refuses both old routes", async () => {
    const seed = await seedMirrorIdentity(mirrorDb, mirrorNode);
    const port = await freePort();

    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-mirror-state-"));

    const server = await startServer(
      {
        ...KEY_ENV,
        WAITRON_NODE_ID: seed.nodeId,
        WAITRON_VENUE_DIR: mirrorVenueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      },
      {},
      { timings: TIMINGS },
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await pollOrThrow(async () => server.health.lastPassAt ?? undefined);

      expect(await retiredPosts(base)).toEqual([
        { path: "/management-api/promote", status: 403, body: refused },
        { path: "/management-api/promote/preparation", status: 403, body: refused },
      ]);

      // Control on the same boot: the gate still refuses an ordinary write.
      const write = await fetch(`${base}/management-api/menus`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("the primary has neither old route", async () => {
    await setSingletonRole(
      { venue: appDb, node: appNode },
      TILL_ENV.WAITRON_NODE_ID,
      "primary",
      "fenced",
    );
    await writeNodeMembership(appDb, selfDoc("serving-primary"));
    const port = await freePort();

    const server = await bootTrading(port);
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await pollOrThrow(async () => server.health.lastPassAt ?? undefined);

      expect(await retiredPosts(base)).toMatchObject([
        { path: "/management-api/promote", status: 404 },
        { path: "/management-api/promote/preparation", status: 404 },
      ]);
    } finally {
      await server.close();
    }
  }, 60_000);

  it("the fenced box read-only gate refuses both old routes", async () => {
    // A held document marking this node sell-only: boot demotes it and mounts the read-only gate.
    await setSingletonRole(
      { venue: appDb, node: appNode },
      TILL_ENV.WAITRON_NODE_ID,
      "primary",
      "fenced",
    );
    await writeNodeMembership(appDb, selfDoc("sell-only"));
    const port = await freePort();

    const server = await bootTrading(port);
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await pollOrThrow(async () => server.health.lastPassAt ?? undefined);

      // Control: the read-only gate IS mounted on this fenced node.
      const write = await fetch(`${base}/management-api/menus`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      const removal = await fetch(`${base}/management-api/servers/${crypto.randomUUID()}/remove`, {
        method: "POST",
      });
      expect(removal.status).toBe(403);
      expect(await removal.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      const pageClaim = await fetch(`${base}/print-api/agent/page-jobs/claim`, { method: "POST" });
      expect(pageClaim.status).toBe(403);
      expect(await pageClaim.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      expect(await retiredPosts(base)).toEqual([
        { path: "/management-api/promote", status: 403, body: refused },
        { path: "/management-api/promote/preparation", status: 403, body: refused },
      ]);
    } finally {
      await server.close();
    }
  }, 60_000);
});

/** Boot a non-mirror trading server against the shared venue directory. */
async function bootTrading(port: number) {
  return startServer(
    {
      ...KEY_ENV,
      ...TILL_ENV,
      WAITRON_VENUE_DIR: appVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    },
    {},
    { timings: TIMINGS },
  );
}
