import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  locations,
  nodes,
  openVenueDatabase,
  readStandardSeriesId,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  tenants,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import type {
  Endorsement,
  MembershipDocumentBody,
  SignedMembershipDocument,
} from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";

// `POST /management-api/promote` is mounted on both deployment modes and its path is exempt from
// the read-only gate, so a mirror and a fenced node both reach the handler: a mirror's
// credential-less POST gets the handler's 401, and a fenced node gets `promotion.node_fenced` (409),
// not a gate 403.
//
// Every seeding write happens while no server is running.

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
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-endpoint-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

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
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The same credentials key boot loads, so the identity sealed here is the one a promote unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// The admin the endpoint authenticates by password in the primary and fenced cases.
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_PW = "correct-horse-battery-staple";

const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

let migrationsRoot: string;
// Separate venue directories, so neither deployment's stamps leak into the other.
let appVenueDir: string;
let mirrorVenueDir: string;
let appDb: Database;
let mirrorDb: Database;
const openStores: VenueDatabase[] = [];

/** `readNodeMembership` does not verify the signature, so a placeholder is fine. */
function selfDoc(standing: "sell-only" | "serving-primary"): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term: 5,
    nodes: [{ nodeId: TILL_ENV.WAITRON_TILL_NODE_ID, contactUrl: "", standing }],
  };
  return {
    body,
    signerNodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

/** Includes a node identity, so a promote has a key to sign with. */
async function seedTillIdentity(db: Database): Promise<void> {
  // `onConflictDoNothing` is untargeted: nothing here reads the result.
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90111111H", legalName: "Promote Endpoint Till SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  await db
    .insert(nodes)
    .values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Promote Endpoint node",
    })
    .onConflictDoNothing();
  await db
    .insert(persons)
    .values({
      id: ADMIN_ID,
      displayName: "Promote Admin",
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(ADMIN_PW),
      role: "admin",
    })
    .onConflictDoNothing();
  await establishNodeIdentity({ ownerDb: db, ring: RING }, TILL_ENV.WAITRON_TILL_NODE_ID);
}

/** A mirror holding its own dormant identity. */
async function seedMirrorIdentity(db: Database): Promise<{ nodeId: string }> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote Endpoint Cloud SL" })
    .onConflictDoNothing();
  await db
    .insert(locations)
    .values({
      id: MIRROR_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  const t = await db.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: db, ring: RING },
    {
      locationId: MIRROR_LOCATION_ID,
      standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "vat",
      modules: ALL_MODULES,
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

  await writeMirrorConfig(db, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  await stampDeployment(db, "production");
  await setDeploymentMode(db, standby.nodeId, "mirror");
  // Throws if the seed left no reserved standard series.
  await readStandardSeriesId(db, standby.nodeId);
  return { nodeId: standby.nodeId };
}

/** Migrated here, not by boot, because the identity rows have to exist before boot reads them. */
async function migratedVenue(): Promise<[string, Database]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  return [directory, store.venue];
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  [appVenueDir, appDb] = await migratedVenue();
  [mirrorVenueDir, mirrorDb] = await migratedVenue();
  await seedTillIdentity(appDb);
  // No `node_roles` row: `readDeploymentAxes` reads it as ('primary', 'primary').
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

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Throws on timeout: every call is a barrier, so a request never goes to a server still booting. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~10s");
}

async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("boot promote endpoint: mounted on both modes, exempt from the read-only gate", () => {
  it("a MIRROR serves the endpoint: a credential-less POST reaches the handler (401), not a gated 403 or 404", async () => {
    const seed = await seedMirrorIdentity(mirrorDb);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-endpoint-mirror-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      WAITRON_VENUE_DIR: mirrorVenueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, { oldNodeNeutralised: true });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("password.invalid");

      // Control on the same boot: the gate still refuses an ordinary write.
      const write = await fetch(`${base}/management-api/catalogues`, {
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

  it("an unfenced PRIMARY serves the endpoint and returns alreadyPrimary with a valid admin login", async () => {
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "primary");
    await writeNodeMembership(appDb, selfDoc("serving-primary"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: true, restarting: false });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a FENCED node returns promotion.node_fenced (409), not a lying alreadyPrimary or a 403/404", async () => {
    // A held document marking this node sell-only: boot demotes it and mounts the read-only gate.
    await setSingletonRole(appDb, TILL_ENV.WAITRON_TILL_NODE_ID, "primary");
    await writeNodeMembership(appDb, selfDoc("sell-only"));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Control: the read-only gate IS mounted on this fenced node.
      const write = await fetch(`${base}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      const res = await postPromote(base, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("promotion.node_fenced");
    } finally {
      await server.close();
    }
  }, 60_000);
});

/** Boot a non-mirror trading server against the shared venue directory. */
async function bootTrading(port: number) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    ...TILL_ENV,
    WAITRON_VENUE_DIR: appVenueDir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  });
}
