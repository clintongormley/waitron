import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  locations,
  openVenueDatabase,
  readDeploymentMode,
  readSingletonRole,
  readStandardSeriesId,
  setDeploymentMode,
  stampDeployment,
  tenants,
  tills,
  withTransaction,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, hashSecret, persons } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import type { Endorsement, SignedMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId } from "@waitron/shared";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { mountPromoteApi } from "./promote-api.js";
import { readOnlyGate } from "./read-only-gate.js";
import { parseEnvFile } from "./env-file.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import { offerProducts } from "./testing/zone-offers.js";

// The promote endpoint end to end over HTTP, each boot on its own venue directory: an admin-login
// promote restarts the mirror as a primary that sells and chains on its own reserved SIF without
// filing; the break-glass path; the refusals; and the read-only gate's exemption for the promote POST.
//
// Not covered: no case shows that a promote whose point-of-no-return write is refused fails closed,
// and no test under `apps/server/src` asserts `promotion.failed`.

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

const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-e2e-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

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
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The same key boot loads, so the identity sealed here is the one a promote unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // the promote must replace it
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

// Also signs in to the dashboard for the box-status read.
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "admin@promote-e2e.test";
const ADMIN_PW = "correct-horse-battery-staple";

const STAFF_ID = "88888888-8888-4888-8888-888888888888";
const STAFF_PIN = "5555";

// The sale resolves its `till_id` from this device.
const DEVICE_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_TOKEN = "promote-e2e-device-token";
const DEVICE_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

// One directory per promoting case, so one case's deployment flip never leaks into another.
const VENUES = ["main", "breakGlass"] as const;
type VenueName = (typeof VENUES)[number];
const venueDir = {} as Record<VenueName, string>;
const stores = {} as Record<VenueName, VenueDatabase>;
const db = {} as Record<VenueName, Database>;

let migrationsRoot: string;

// A promote schedules a REAL `process.kill(process.pid, "SIGTERM")` on the next macrotask
// (`promoteMirrorRun` in boot.ts). The spy is file-scoped and restored only after every case: a
// per-case restore can run before that timer fires, and the signal then kills the vitest worker.
let killSpy: MockInstance<typeof process.kill>;

async function seedMirror(admin: Database): Promise<{ nodeId: string; standardSeriesId: string }> {
  await admin
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "90222222H", legalName: "Promote E2E Cloud SL" })
    .onConflictDoNothing();
  await admin
    .insert(locations)
    .values({
      id: MIRROR_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    })
    .onConflictDoNothing();
  const t = await admin.execute<{ tax_id: string }>(sql`select tax_id from tenants where id = 1`);
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: admin, ring: RING },
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
  await writeNodeMembership(admin, held);

  await writeMirrorConfig(admin, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  await admin
    .insert(persons)
    .values({
      id: ADMIN_ID,
      displayName: "Promote Admin",
      email: ADMIN_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(ADMIN_PW),
      role: "admin",
    })
    .onConflictDoNothing();

  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, standby.nodeId, "mirror");
  const standardSeriesId = await readStandardSeriesId(admin, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

/** What the promoted primary needs to ring a real cash sale; returns the offer to sell. */
async function seedSaleVenue(admin: Database, nodeId: string): Promise<string> {
  await seedLegacySellingUnits(admin);
  await admin
    .insert(tills)
    .values({ id: MIRROR_TILL_ID, locationId: MIRROR_LOCATION_ID, name: "Barra" })
    .onConflictDoNothing();
  await admin
    .insert(persons)
    .values({
      id: STAFF_ID,
      displayName: "Cajera",
      pinHash: hashPin(STAFF_PIN),
      role: "staff",
    })
    .onConflictDoNothing();
  await admin
    .insert(deviceProfiles)
    .values({
      id: DEVICE_PROFILE_ID,
      name: "Counter",
      formFactor: "till",
      capabilities: [],
    })
    .onConflictDoNothing();
  await admin
    .insert(devices)
    .values({
      id: DEVICE_ID,
      locationId: MIRROR_LOCATION_ID,
      deviceProfileId: DEVICE_PROFILE_ID,
      tillId: MIRROR_TILL_ID,
      label: "Counter till",
      tokenHash: hashSecret(DEVICE_TOKEN),
    })
    .onConflictDoNothing();
  await admin
    .insert(kitchenStations)
    .values({
      locationId: MIRROR_LOCATION_ID,
      name: "Kitchen",
      displayOrder: 0,
      isDefault: true,
      active: true,
    })
    .onConflictDoNothing();

  const waterOffer = await withTransaction(admin, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const drinks = await createCategory(tx, { name: { en: "Bebidas" } });
    const water = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      name: "Mineral water",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, brandLocationId(MIRROR_LOCATION_ID), cat.id);
    const offers = await offerProducts(tx, {
      locationId: brandLocationId(MIRROR_LOCATION_ID),
      orderFlow: "prepay",
    });
    return offers.offerFor(water.id);
  });
  // Unused: the venue rows key on location and till, not the node.
  void nodeId;
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
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  for (const name of VENUES) {
    venueDir[name] = await mkdtemp(join(tmpdir(), `waitron-promote-e2e-venue-${name}-`));
    await applyMigrations(venueDir[name], fromSource);
    stores[name] = await openVenueDatabase(venueDir[name]);
    db[name] = stores[name].venue;
  }
}, 180_000);

afterAll(async () => {
  if (killSpy !== undefined) killSpy.mockRestore();
  for (const name of VENUES) if (stores[name] !== undefined) await stores[name].close();
  for (const name of VENUES)
    if (venueDir[name] !== undefined) await rm(venueDir[name], { recursive: true, force: true });
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (WAITRON_HTTP_PORT rejects "0"). */
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

/** Throws on timeout, so a caller never proceeds on an unmet condition. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 300; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~15s");
}

async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mirrorEnv(
  dir: string,
  port: number,
  nodeId: string,
  stateDir: string,
): Record<string, string> {
  return {
    ...KEY_ENV,
    ...TICK_ENV,
    WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
    WAITRON_TILL_NODE_ID: nodeId,
    WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
    WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
    WAITRON_VENUE_DIR: dir,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
  };
}

async function readEnvios(
  admin: Database,
): Promise<{ estado: string; intentos: number; incidencia: boolean }[]> {
  // A raw read, so `incidencia` arrives as the stored 0/1.
  const rows = await admin.execute<{ estado: string; intentos: number; incidencia: number }>(
    sql`select estado, intentos, incidencia from envios order by registro_id`,
  );
  return rows.rows.map((row) => ({ ...row, incidencia: row.incidencia === 1 }));
}

describe("promote endpoint e2e — the whole arc over HTTP", () => {
  it("admin login → 200 restarting; restart into primary; sells + chains on its own reserved SIF; does NOT file", async () => {
    const seed = await seedMirror(db.main);
    const waterOffer = await seedSaleVenue(db.main, seed.nodeId);
    await mintBreakGlassSecret(db.main, seed.nodeId); // an adopted mirror always has a verifier

    const mirrorPort = await freePort();
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-main-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    killSpy.mockClear();

    const mirror = await startServer(
      mirrorEnv(venueDir.main, mirrorPort, seed.nodeId, stateDir),
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    let primary: StartedServer | undefined;
    try {
      await poll(async () => mirror.health.lastPassAt ?? undefined);

      // The refusals run first, on the still-unpromoted mirror.
      const wrongBg = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        breakGlass: "not-the-secret",
      });
      expect(wrongBg.status).toBe(401);
      expect((await wrongBg.json()).error.code).toBe("promotion.break_glass_invalid");
      expect(await readDeploymentMode(db.main, seed.nodeId)).toBe("mirror");

      const unattested = await postPromote(mirrorBase, {
        oldNodeNeutralised: false,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(unattested.status).toBe(400);
      expect((await unattested.json()).error.code).toBe("promotion.fence_not_attested");
      expect(await readDeploymentMode(db.main, seed.nodeId)).toBe("mirror");

      // The gate is live, so the promote POST reaching its handler is the exemption's doing.
      const write = await fetch(`${mirrorBase}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      const res = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });

      expect(await readDeploymentMode(db.main, seed.nodeId)).toBe("primary");
      expect(await readSingletonRole(db.main, seed.nodeId)).toBe("primary");
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      expect(persisted.WAITRON_TILL_SERIES_ID).not.toBe(MIRROR_DESIGNATED_SERIES_ID);

      // `trading.env` names no venue directory, so it is supplied here.
      await mirror.close();
      const primaryPort = await freePort();
      const primaryBase = `http://127.0.0.1:${primaryPort}`;
      primary = await startServer({
        ...KEY_ENV,
        ...TICK_ENV,
        WAITRON_TILL_TILL_ID: persisted.WAITRON_TILL_TILL_ID!,
        WAITRON_TILL_NODE_ID: persisted.WAITRON_TILL_NODE_ID!,
        WAITRON_TILL_SERIES_ID: persisted.WAITRON_TILL_SERIES_ID!,
        WAITRON_TILL_LOCATION_ID: persisted.WAITRON_TILL_LOCATION_ID!,
        WAITRON_VENUE_DIR: venueDir.main,
        WAITRON_HTTP_PORT: String(primaryPort),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      });
      await poll(async () => primary!.health.lastPassAt ?? undefined);

      const node = await (await fetch(`${primaryBase}/api/node`)).json();
      expect(node.acceptingSales).toBe(true);

      expect(
        (await fetch(`${primaryBase}/api/device/me`, { headers: { cookie: DEVICE_COOKIE_HEADER } }))
          .status,
      ).toBe(200);
      const login = await fetch(`${primaryBase}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: DEVICE_COOKIE_HEADER },
        body: JSON.stringify({ personId: STAFF_ID, pin: STAFF_PIN }),
      });
      expect(login.status).toBe(200);
      const sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const bothCookies = `${sessionCookie}; ${DEVICE_COOKIE_HEADER}`;

      const products = (await (
        await fetch(`${primaryBase}/api/products`, { headers: { cookie: sessionCookie } })
      ).json()) as { products: { id: string; pricingUnit: string }[] };
      expect(products.products.find((p) => p.pricingUnit === "each")).toBeDefined();

      const saleRes = await fetch(`${primaryBase}/api/sales`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: bothCookies },
        body: JSON.stringify({
          lines: [{ menuItemId: waterOffer, quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
        }),
      });
      expect(saleRes.status).toBe(200);
      const ticket = await saleRes.json();
      expect(ticket.total).toBe("3.00");
      expect(typeof ticket.qr).toBe("string");
      expect(ticket.qr.length).toBeGreaterThan(0);

      // Chained on the node's own reserved SIF.
      const reservedSif = await db.main.execute<{ id: string }>(
        sql`select id from registro_sif where node_id = ${seed.nodeId} and revocado_en is null`,
      );
      const registros = await db.main.execute<{
        huella: string;
        node_id: string;
        sif_id: string;
      }>(
        sql`select huella, node_id, sif_id from registros_facturacion where node_id = ${seed.nodeId}`,
      );
      expect(registros.rows).toHaveLength(1);
      expect(registros.rows[0]!.huella).toMatch(/^[0-9A-F]{64}$/);
      expect(registros.rows[0]!.sif_id).toBe(reservedSif.rows[0]!.id);

      // With no `fiscal.aeat` certificate the pass skips the due envío and box-status reports it.
      const mgmtLogin = await fetch(`${primaryBase}/management-api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
      });
      expect(mgmtLogin.status).toBe(200);
      const mgmtCookie = mgmtLogin.headers.get("set-cookie")!.split(";")[0]!;
      const awaiting = await poll(async () => {
        const status = await (
          await fetch(`${primaryBase}/api/box/status`, { headers: { cookie: mgmtCookie } })
        ).json();
        return status.awaitingFiscalCertificate === true ? status : undefined;
      });
      expect(awaiting.awaitingFiscalCertificate).toBe(true);

      expect(await readEnvios(db.main)).toEqual([
        { estado: "pendiente", intentos: 0, incidencia: false },
      ]);
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("break-glass secret → 200 promoted (no login)", async () => {
    const seed = await seedMirror(db.breakGlass);
    const breakGlass = await mintBreakGlassSecret(db.breakGlass, seed.nodeId);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-bg-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer(
      mirrorEnv(venueDir.breakGlass, port, seed.nodeId, stateDir),
    ).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, { oldNodeNeutralised: true, breakGlass });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(db.breakGlass, seed.nodeId)).toBe("primary");
      expect(await readSingletonRole(db.breakGlass, seed.nodeId)).toBe("primary");
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 90_000);
});

// The negative control for the gate exemption: without the clause, the same promote POST is a 403.
describe("read-only-gate exemption for the promote POST — proven by deletion", () => {
  // Would always promote if reached, so a 403 can only be the gate.
  const alwaysRun = () => Promise.resolve({ alreadyPrimary: false, restarting: true });
  // The promote half of the exemption boot.ts passes to `readOnlyGate`.
  const promoteExempt = (c: { req: { method: string; path: string } }) =>
    c.req.method === "POST" && c.req.path === "/management-api/promote";

  function appWith(
    exempt: ((c: { req: { method: string; path: string } }) => boolean) | undefined,
  ): Hono {
    const app = new Hono();
    app.use(
      "*",
      readOnlyGate(() => true, exempt),
    );
    // No case here reaches the break-glass check, so the node id is a placeholder.
    mountPromoteApi(app, { appDb: db.main, nodeId: "gate-only", run: alwaysRun });
    return app;
  }

  it("WITH the exemption clause: an ordinary write POST is 403 but the promote POST reaches the handler", async () => {
    const app = appWith(promoteExempt);

    const write = await app.request("/management-api/catalogues", { method: "POST", body: "{}" });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

    // The handler's own credential screen answers 401, not the gate's 403.
    const promote = await app.request("/management-api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldNodeNeutralised: true }),
    });
    expect(promote.status).toBe(401);
    expect((await promote.json()).error.code).toBe("password.invalid");
  });

  it("WITHOUT the exemption clause (deletion): the SAME promote POST is blocked 403 node.read_only", async () => {
    const app = appWith(undefined);

    const promote = await app.request("/management-api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oldNodeNeutralised: true }),
    });
    expect(promote.status).toBe(403);
    expect(await promote.json()).toEqual({ error: { code: "node.read_only", params: {} } });
  });
});
