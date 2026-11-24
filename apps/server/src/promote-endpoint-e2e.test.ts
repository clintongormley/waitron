import { randomUUID } from "node:crypto";
import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import {
  seedBusinessDay,
  seedDeviceProfiles,
  seedVenueSettings,
} from "@waitron/db/testing/seed.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  openVenueDatabase,
  stampDeployment,
  taxpayer,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { loadKeyRing } from "@waitron/credentials";
import { hashDeviceToken, persons } from "@waitron/identity";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import { generateNodeKeyPair, type Endorsement } from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { establishDormantContract } from "./testing/dormant-contract.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";
import { freePort } from "./testing/free-ports.js";
import { POLL_INTERVAL_MS, pollOrThrow } from "./testing/boot-harness.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { useTestProducer } from "./testing/test-producer.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import { signedInPromotion } from "./testing/signed-in-promotion.js";
import { ALL_MODULES } from "./modules.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});
const { startServer, httpPort } = ephemeralServerFixture();

useTestProducer();

// No background dial reaches a real host; Node's global `fetch`, a distinct module, still serves the
// probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in promote-endpoint-e2e.test.ts")),
    ),
  };
});

const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-e2e-state-"));

const CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY_ENV = {
  // The landing listener defaults to privileged port 80; keep it out of boot tests.
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
};

// Short ticks, so the passes the cases wait on land inside the poll budget.
const TIMINGS = { minTickMs: 250, maxTickMs: 1_000, skipRetryMs: 250 };

// The same key boot loads, so the identity sealed here is the one a promote unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// Also signs in to the dashboard for the box-status read.
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "admin@promote-e2e.test";
const ADMIN_PW = "correct-horse-battery-staple";

const STAFF_ID = "88888888-8888-4888-8888-888888888888";
const STAFF_PIN = "5555";

// The device the sale is made on.
const DEVICE_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_TOKEN = "promote-e2e-device-token";
const DEVICE_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

// One directory per promoting case, so one case's deployment flip never leaks into another.
const VENUES = ["main"] as const;
type VenueName = (typeof VENUES)[number];
const venueDir = {} as Record<VenueName, string>;
const stores = {} as Record<VenueName, VenueDatabase>;
const db = {} as Record<VenueName, Database>;

let migrationsRoot: string;

async function seedMirror(
  admin: Database,
  node: NodeDatabase,
): Promise<{
  nodeId: string;
  fixture: Awaited<ReturnType<typeof establishDormantContract>>;
}> {
  await seedModuleSettings(admin, { "fiscal-none": false });
  await admin
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "90222222F", legalName: "Promote E2E Cloud SL" })
    .onConflictDoNothing();
  await seedVenueSettings(admin, {
    name: "Barra",
    invoiceLocales: ["en"],
  });
  await seedBusinessDay(admin, {});
  const t = await admin.execute<{ tax_id: string }>(sql`select tax_id from taxpayer where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  const fixture = await establishDormantContract({
    db: admin,
    node,
    ring: RING,
    sourceId: MIRROR_ORIGIN_NODE_ID,
    taxpayerNif: nif,
    standby,
    endorsement,
    operatorId: ADMIN_ID,
    recoveryKey: false,
  });

  // Signed by the outgoing primary's key, which this box pins as adopt would.
  const origin = generateNodeKeyPair();
  const held = signedMembershipDoc(3, {
    signerNodeId: MIRROR_ORIGIN_NODE_ID,
    keyPair: origin,
    nodes: [
      { nodeId: MIRROR_ORIGIN_NODE_ID, contactUrl: "https://old", standing: "serving-primary" },
      { nodeId: standby.nodeId, contactUrl: "", standing: "serving-secondary" },
    ],
  });
  await writeNodeMembership(admin, held);
  await pinMainBoxKey(node, standby.nodeId, {
    nodeId: MIRROR_ORIGIN_NODE_ID,
    publicKey: origin.publicKey,
  });

  await writeMirrorLink(node, standby.nodeId, {
    originUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  if (!(await admin.select({ id: persons.id }).from(persons).where(eq(persons.id, ADMIN_ID)))[0]) {
    await seedPersons(admin, {
      id: ADMIN_ID,
      displayName: "Promote Admin",
      email: ADMIN_EMAIL,
      pinHash: fixturePinHash("1234"),
      passwordHash: fixturePasswordHash(ADMIN_PW),
      role: "admin",
    });
  }

  await stampDeployment(admin, "production");
  await setNodeMode({ venue: admin, node }, standby.nodeId, "mirror", "adopt");
  return { nodeId: standby.nodeId, fixture };
}

/** What the promoted primary needs to ring a real cash sale; returns the offer to sell. */
async function seedSaleVenue(admin: Database): Promise<string> {
  await seedModuleSettings(admin, { "fiscal-none": false });
  await seedLegacySellingUnits(admin);
  if (!(await admin.select({ id: persons.id }).from(persons).where(eq(persons.id, STAFF_ID)))[0]) {
    await seedPersons(admin, {
      id: STAFF_ID,
      displayName: "Cashier",
      pinHash: fixturePinHash(STAFF_PIN),
      role: "staff",
    });
  }
  if (
    !(
      await admin
        .select({ id: deviceProfiles.id })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, DEVICE_PROFILE_ID))
    )[0]
  ) {
    await seedDeviceProfiles(admin, {
      id: DEVICE_PROFILE_ID,
      name: "Counter",
      formFactor: "till",
      capabilities: [...BASIC_ACTIONS, "take-cash"],
    });
  }
  await admin
    .insert(devices)
    .values({
      id: DEVICE_ID,
      deviceProfileId: DEVICE_PROFILE_ID,
      label: "Counter till",
      tokenHash: hashDeviceToken(DEVICE_TOKEN),
    })
    .onConflictDoNothing();
  await admin
    .insert(kitchenStations)
    .values({
      name: "Kitchen",
      isDefault: true,
      active: true,
    })
    .onConflictDoNothing();

  const waterOffer = await withTransaction(admin, async (tx) => {
    const cat = await createMenu(tx, { name: "Delicatessen" });
    const drinks = await createCategory(tx, { name: "Bebidas" });
    const water = await createProduct(tx, {
      categoryId: drinks.id,
      name: "Mineral water",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignMenuToVenue(tx, cat.id);
    const offers = await offerProducts(tx);
    return offers.offerFor(water.id);
  });

  return waterOffer;
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  for (const name of VENUES) {
    venueDir[name] = await mkdtemp(join(tmpdir(), `waitron-promote-e2e-venue-${name}-`));
    await applyMigrations(venueDir[name], fromSource);
    stores[name] = await openVenueDatabase(venueDir[name]);
    db[name] = stores[name].venue;
  }
}, 180_000);

afterAll(async () => {
  for (const name of VENUES) if (stores[name] !== undefined) await stores[name].close();
  for (const name of VENUES)
    if (venueDir[name] !== undefined) await rm(venueDir[name], { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

const POLL_TRIES_15S = 15_000 / POLL_INTERVAL_MS;

function mirrorEnv(
  dir: string,
  port: number,
  nodeId: string,
  stateDir: string,
): Record<string, string> {
  return {
    ...KEY_ENV,
    WAITRON_NODE_ID: nodeId,
    WAITRON_VENUE_DIR: dir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
  };
}

async function readSubmissions(
  admin: Database,
): Promise<{ estado: string; intentos: number; incidencia: boolean }[]> {
  // A raw read, so `incidencia` arrives as the stored 0/1.
  const rows = await admin.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from verifactu_submissions order by registro_id`,
  );
  return rows.rows.map((row) => ({ ...row, incidencia: row.incidencia === 1 }));
}

describe("a promotion through the signed-in runner", () => {
  it("leaves a new primary submission waiting for a certificate", async () => {
    const seed = await seedMirror(db.main, stores.main.node);
    const waterOffer = await seedSaleVenue(db.main);

    const mirrorPort = await freePort();
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-main-state-"));

    const mirror = await startServer(
      mirrorEnv(venueDir.main, mirrorPort, seed.nodeId, stateDir),
      {},
      { timings: TIMINGS },
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    let primary: StartedServer | undefined;
    try {
      await pollOrThrow(async () => mirror.health.lastPassAt ?? undefined, POLL_TRIES_15S);

      expect(
        await mirror.promoteMirrorToPrimary!(
          { oldNodeNeutralised: true },
          signedInPromotion({
            stateDir,
            venueDir: venueDir.main,
            modules: ALL_MODULES,
            operation: seed.fixture(),
            credentials: { personId: ADMIN_ID, password: ADMIN_PW },
          }),
        ),
      ).toMatchObject({ alreadyPrimary: false });

      await mirror.close();
      const primaryPort = await freePort();
      primary = await startServer(
        {
          ...KEY_ENV,
          WAITRON_NODE_ID: seed.nodeId,
          WAITRON_VENUE_DIR: venueDir.main,
          WAITRON_HTTP_PORT: String(primaryPort),
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_STATE_DIR: stateDir,
        },
        {},
        { timings: TIMINGS, boxHost: synchronisedBoxHost() },
      );
      const primaryBase = `http://127.0.0.1:${httpPort()}`;
      await pollOrThrow(async () => primary!.health.lastPassAt ?? undefined, POLL_TRIES_15S);

      const login = await fetch(`${primaryBase}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: DEVICE_COOKIE_HEADER },
        body: JSON.stringify({ personId: STAFF_ID, pin: STAFF_PIN }),
      });
      expect(login.status).toBe(200);
      const sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const bothCookies = `${sessionCookie}; ${DEVICE_COOKIE_HEADER}`;

      const billId = randomUUID();
      const saleRes = await fetch(`${primaryBase}/api/working-orders/${billId}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: bothCookies },
        body: JSON.stringify({
          dining: "eat_in",
          submissionId: billId,
          kind: "share",
          shareOf: 1,
          method: "cash",
          tendered: "5.00",
          basket: { lines: [{ menuItemId: waterOffer, quantity: "2" }] },
        }),
      });
      expect(saleRes.status).toBe(200);
      await saleRes.json();

      // With no `fiscal.aeat` certificate the pass skips the due submission and box-status reports it.
      const mgmtLogin = await fetch(`${primaryBase}/management-api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
      });
      expect(mgmtLogin.status).toBe(200);
      const mgmtCookie = mgmtLogin.headers.get("set-cookie")!.split(";")[0]!;
      const awaiting = await pollOrThrow(async () => {
        const status = await (
          await fetch(`${primaryBase}/api/box/status`, { headers: { cookie: mgmtCookie } })
        ).json();
        return status.awaitingFiscalCertificate === true ? status : undefined;
      }, POLL_TRIES_15S);
      expect(awaiting.awaitingFiscalCertificate).toBe(true);

      expect(await readSubmissions(db.main)).toEqual([
        { estado: "pendiente", intentos: 0, incidencia: false },
      ]);
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      vi.unstubAllEnvs();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 120_000);
});

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  const { hourPromotionOperations } = await import("./testing/dormant-contract.js");
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu"
        ? { ...module, operations: hourPromotionOperations }
        : module,
    ),
  };
});
