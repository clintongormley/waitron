import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  asAppUser,
  readDeploymentMode,
  readSingletonRole,
  readStandardSeriesId,
  setDeploymentMode,
  stampDeployment,
  withTenant,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, hashSecret } from "@waitron/identity";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import type { Endorsement, SignedMembershipDocument } from "@waitron/membership";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer, type StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { mountPromoteApi } from "./promote-api.js";
import { readOnlyGate } from "./read-only-gate.js";
import { parseEnvFile } from "./env-file.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { roleUrl } from "./testing/postgres.js";

// Task 10 — the END-TO-END RECEIPT for the promote endpoint (spec §8/§9.1). No new production code: this
// suite drives the whole arc over the real HTTP endpoint against REAL Postgres (mandatory, CLAUDE.md §4 —
// the read-only gate is served through the non-superuser `app_login` pool, the promote's owner write runs
// through the table-owner admin connection, and the promoted primary's fiscal drain runs as the
// deployment role; every one of those is a false pass on a superuser-only, single-backend PGlite):
//
//   1. HAPPY PATH (admin login): POST /management-api/promote with a valid admin credential +
//      `oldNodeNeutralised:true` on a booted adopted mirror → 200 `{alreadyPrimary:false,
//      restarting:true}`; the box restarts into `mode=primary`; the promoted primary SELLS a real
//      cash sale over `POST /api/sales` and CHAINS it locally on its OWN reserved SIF; and it does NOT
//      file — `awaitingFiscalCertificate:true` on box-status and the seeded envío is never submitted.
//   2. BREAK-GLASS PATH: the same promotion authorized with the adopt-minted break-glass secret instead
//      of a login → 200 promoted.
//   3. REFUSALS: a wrong break-glass → 401 and the node stays a read-only mirror; a valid credential
//      with `oldNodeNeutralised:false` → 400 `promotion.fence_not_attested`, node unchanged.
//   4. THE READ-ONLY-GATE HOLE, proven by DELETION: on the real booted mirror the exempt promote POST
//      reaches the handler while an ordinary write POST still gets 403 `node.read_only`; and, at the
//      exemption-clause level, removing the `/management-api/promote` clause turns the same authorized
//      promote into a 403 (the negative control), restoring it turns it green again (CLAUDE.md §4).
//   5. ADMIN-CONNECTION FAIL-CLOSED: a node whose `WAITRON_ADMIN_DATABASE_URL` is a non-owner
//      (`app_user`) role → the promote owner write fails closed `42501`, surfaced as 500
//      `promotion.failed`, never a silent no-op; with the admin URL unset it falls back to the
//      migrations URL and succeeds.

// `undici`'s `fetch` is mocked to REJECT so no background pull/tunnel dial reaches a real host; Node's
// own global `fetch` (a distinct module identity — see boot.promote.test.ts) still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in promote-endpoint-e2e.test.ts")),
    ),
  };
});

const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-e2e-media-"));
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-e2e-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

const CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
};

// Short ticks so the boot loop's first (empty) pass — and, after the sale, the skip that flips the
// awaiting-cert cell — land inside the poll budget without a long idle sleep.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The box key ring, built from the SAME credentials key boot loads — so the identity this suite seals is
// the one a promote unseals to sign its minted membership document.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The mirror's OWN venue ids — one venue, seeded identically on each clone (each `useTemplateDb` clones
// the manifest afresh, so the fixed ids never collide across clones).
const MIRROR_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // inert, must be overwritten
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the primary this mirror pulls
const MIRROR_NUMERO_INSTALACION = 7;

// The admin the promote endpoint authenticates (role `admin` is the only role holding `node.promote`).
// The SAME person carries a dashboard email + password so it also logs a management session in for the
// box-status read (`till.configure`, which admin holds). `password_hash` backs BOTH login paths; a
// `pin_hash` is supplied because the column is NOT NULL.
const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "admin@promote-e2e.test";
const ADMIN_PW = "correct-horse-battery-staple";

// The staff operator the till session logs in (device-gated PIN login), so the sale is attributed and
// files under the promoted node's SIF.
const STAFF_ID = "88888888-8888-4888-8888-888888888888";
const STAFF_PIN = "5555";

// A seeded till device bound to the venue's own till — the sale resolves its `till_id` from THIS device
// (SP-A.2 cutover), and the `waitron_device=<id>.<token>` cookie authenticates against the seeded row.
const DEVICE_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_TOKEN = "promote-e2e-device-token";
const DEVICE_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

// Three clones: the main happy-path arc (which promotes destructively), the break-glass promote, and the
// admin-connection fail-closed pair (which reboots the same clone twice). Each `useTemplateDb` call
// clones the manifest afresh, so one test's deployment flip never leaks into another's.
const mainSuite = useTemplateDb({ template: "manifest" });
const breakGlassSuite = useTemplateDb({ template: "manifest" });
const adminConnSuite = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;

/** Seed a fresh clone as a read-only adopted mirror holding its OWN dormant identity (R2/R3a), plus the
 * admin the promote endpoint + box-status authenticate — the shape boot.promote-endpoint.test.ts uses.
 * Returns the cloud's own nodeId + the reserved standard series id the promote must correct trading.env
 * to. Deployment is stamped production then mode='mirror'. */
async function seedMirror(admin: Database): Promise<{ nodeId: string; standardSeriesId: string }> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${MIRROR_TENANT_ID}, 'ES', '90222222H', 'Promote E2E Cloud SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${MIRROR_LOCATION_ID}, ${MIRROR_TENANT_ID}, 'Barra', array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  const t = await admin.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = ${MIRROR_TENANT_ID}`,
  );
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
      tenantId: MIRROR_TENANT_ID,
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

  await writeMirrorConfig(admin, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });

  // The admin/manager the endpoint + box-status authenticate.
  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, email, pin_hash, password_hash, role)
    values (${ADMIN_ID}, ${MIRROR_TENANT_ID}, 'Promote Admin', ${ADMIN_EMAIL}, ${hashPin("1234")},
            ${hashPassword(ADMIN_PW)}, 'admin')
    on conflict do nothing`);

  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, "mirror");
  const standardSeriesId = await readStandardSeriesId(admin, MIRROR_TENANT_ID, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

/** Seed the venue-sale prerequisites onto the mirror clone (owner writes), so the PROMOTED primary can
 * ring a real cash sale over HTTP that chains on its own reserved SIF: a till bound to the venue, a
 * catalogue with one sellable product, a staff operator on a known PIN, and an enrolled till device
 * (`token_hash` = scrypt of `DEVICE_TOKEN`, the same shape `enrolDevice` stores, so the device cookie
 * verifies). */
async function seedSaleVenue(admin: Database, nodeId: string): Promise<void> {
  await admin.execute(sql`
    insert into tills (id, tenant_id, location_id, name)
    values (${MIRROR_TILL_ID}, ${MIRROR_TENANT_ID}, ${MIRROR_LOCATION_ID}, 'Barra')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, pin_hash, role)
    values (${STAFF_ID}, ${MIRROR_TENANT_ID}, 'Cajera', ${hashPin(STAFF_PIN)}, 'staff')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into device_profiles (id, tenant_id, name, form_factor, capabilities)
    values (${DEVICE_PROFILE_ID}, ${MIRROR_TENANT_ID}, 'Counter', 'till', '[]'::jsonb)
    on conflict do nothing`);
  await admin.execute(sql`
    insert into devices (id, tenant_id, location_id, device_profile_id, till_id, label, token_hash)
    values (${DEVICE_ID}, ${MIRROR_TENANT_ID}, ${MIRROR_LOCATION_ID}, ${DEVICE_PROFILE_ID},
            ${MIRROR_TILL_ID}, 'Counter till', ${hashSecret(DEVICE_TOKEN)})
    on conflict do nothing`);

  const tenant = brandTenantId(MIRROR_TENANT_ID);
  await withTenant(admin, MIRROR_TENANT_ID, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, tenant, { name: "Delicatessen" });
    const drinks = await createCategory(tx, tenant, { name: "Bebidas" });
    await createProduct(tx, tenant, {
      catalogueId: cat.id,
      categoryId: drinks.id,
      descriptions: { en: "Mineral water" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, brandLocationId(MIRROR_LOCATION_ID), cat.id);
  });
  // Silence an unused-parameter lint without changing the seed shape: nodeId scopes nothing here (the
  // venue rows key on tenant/location/till), but it documents which node this venue promotes onto.
  void nodeId;
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
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

/** Polls `predicate` up to ~15s for its first defined value, THROWING on timeout so a call site can
 * never silently proceed on an unmet condition. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 300; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~15s");
}

/** POST the promote endpoint with a JSON body. */
async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The mirror boot env for `clone` at `port`, seeded venue overriding KEY_ENV's absence of till ids. */
function mirrorEnv(
  clone: { pg: { uri: string } },
  port: number,
  nodeId: string,
  stateDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...KEY_ENV,
    ...TICK_ENV,
    WAITRON_TILL_TENANT_ID: MIRROR_TENANT_ID,
    WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
    WAITRON_TILL_NODE_ID: nodeId,
    WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
    WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
    DATABASE_URL: roleUrl(clone.pg.uri, "app_login", "app_pw"),
    WAITRON_MIGRATIONS_DATABASE_URL: clone.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
    ...extra,
  };
}

/** Read the observable columns of every envío for a tenant — the "was it submitted?" evidence. */
async function readEnvios(
  admin: Database,
  tenantId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }[]> {
  const rows = await admin.execute<{ estado: string; intentos: number; incidencia: boolean }>(
    sql`select estado, intentos, incidencia from envios where tenant_id = ${tenantId} order by registro_id`,
  );
  return rows.rows;
}

describe("promote endpoint e2e — the whole arc over HTTP (real Postgres)", () => {
  // STEP 1 (+ its refusals and the real-boot gate control) — the headline receipt.
  it("admin login → 200 restarting; restart into primary; sells + chains on its own reserved SIF; does NOT file", async () => {
    const seed = await seedMirror(mainSuite.admin);
    await seedSaleVenue(mainSuite.admin, seed.nodeId);
    await mintBreakGlassSecret(mainSuite.admin); // a verifier exists (an adopted mirror always has one)

    const mirrorPort = await freePort();
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-main-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    // SAFETY (CLAUDE.md §4): the promote schedules a real `process.kill(pid, "SIGTERM")` for the restart.
    // Spy so it never fires at the vitest process; the manual `startServer` below IS the restart.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const mirror = await startServer(mirrorEnv(mainSuite, mirrorPort, seed.nodeId, stateDir)).catch(
      async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        killSpy.mockRestore();
        throw err;
      },
    );

    let primary: StartedServer | undefined;
    try {
      await poll(async () => mirror.health.lastPassAt ?? undefined);

      // STEP 3 (refusals), run first on the still-unpromoted mirror so they leave it untouched:
      // a wrong break-glass → 401, node stays a mirror.
      const wrongBg = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        breakGlass: "not-the-secret",
      });
      expect(wrongBg.status).toBe(401);
      expect((await wrongBg.json()).error.code).toBe("promotion.break_glass_invalid");
      expect(await readDeploymentMode(mainSuite.admin)).toBe("mirror");

      // A valid admin credential but `oldNodeNeutralised:false` → 400 fence_not_attested, node unchanged.
      const unattested = await postPromote(mirrorBase, {
        oldNodeNeutralised: false,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(unattested.status).toBe(400);
      expect((await unattested.json()).error.code).toBe("promotion.fence_not_attested");
      expect(await readDeploymentMode(mainSuite.admin)).toBe("mirror");

      // STEP 4 (gate control, real boot): an ordinary write POST is refused by the read-only gate (403
      // node.read_only), so the promote POST reaching the handler above is the EXEMPTION's doing — not a
      // disabled gate. (The negative-control deletion is the separate exemption-clause test below.)
      const write = await fetch(`${mirrorBase}/management-api/catalogues`, {
        method: "POST",
        body: "{}",
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

      // STEP 1 (happy path): a valid admin login + the attestation → 200, promoted, restarting.
      const res = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });

      // The point-of-no-return committed: deployment flipped to (primary, primary), and the restart
      // SIGTERM was scheduled (into the spy, never fired for real).
      expect(await readDeploymentMode(mainSuite.admin)).toBe("primary");
      expect(await readSingletonRole(mainSuite.admin)).toBe("primary");
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      // trading.env was rewritten to the cloud's OWN reserved standard series (spec §4.3), NOT the inert
      // designated series it booted with — this is what the restart below numbers under.
      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      expect(persisted.WAITRON_TILL_SERIES_ID).not.toBe(MIRROR_DESIGNATED_SERIES_ID);

      // Restart into mode=primary: close the mirror and boot from the persisted trading.env (the box the
      // supervisor would source).
      await mirror.close();
      const primaryPort = await freePort();
      const primaryBase = `http://127.0.0.1:${primaryPort}`;
      primary = await startServer({
        ...KEY_ENV,
        ...TICK_ENV,
        WAITRON_TILL_TENANT_ID: persisted.WAITRON_TILL_TENANT_ID!,
        WAITRON_TILL_TILL_ID: persisted.WAITRON_TILL_TILL_ID!,
        WAITRON_TILL_NODE_ID: persisted.WAITRON_TILL_NODE_ID!,
        WAITRON_TILL_SERIES_ID: persisted.WAITRON_TILL_SERIES_ID!, // the reserved series the promote wrote
        WAITRON_TILL_LOCATION_ID: persisted.WAITRON_TILL_LOCATION_ID!,
        DATABASE_URL: persisted.DATABASE_URL!,
        WAITRON_MIGRATIONS_DATABASE_URL: persisted.WAITRON_MIGRATIONS_DATABASE_URL!,
        WAITRON_HTTP_PORT: String(primaryPort),
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_STATE_DIR: stateDir,
      });
      await poll(async () => primary!.health.lastPassAt ?? undefined);

      // The restarted box is a selling primary now: /api/node answers acceptingSales:true (boot-captured
      // — a mirror answers false; only the fresh mode=primary boot flips it true).
      const node = await (await fetch(`${primaryBase}/api/node`)).json();
      expect(node.acceptingSales).toBe(true);

      // SELLS + CHAINS LOCALLY: ring a real cash sale over the HTTP surface. The seeded device cookie
      // authenticates, the staff operator logs in, and POST /api/sales files a chained fiscal record.
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
      const water = products.products.find((p) => p.pricingUnit === "each")!;

      const saleRes = await fetch(`${primaryBase}/api/sales`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: bothCookies },
        body: JSON.stringify({
          lines: [{ productId: water.id, quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
        }),
      });
      expect(saleRes.status).toBe(200);
      const ticket = await saleRes.json();
      expect(ticket.total).toBe("3.00");
      // A genuine first filing carries the AEAT verification QR — chained locally, no AEAT round trip.
      expect(typeof ticket.qr).toBe("string");
      expect(ticket.qr.length).toBeGreaterThan(0);

      // A GENUINE chained fiscal record exists for the promoted node, on its OWN reserved SIF: exactly
      // one registro, a 64-hex huella, keyed to the node's non-revoked reserved SIF.
      const reservedSif = await mainSuite.admin.execute<{ id: string }>(
        sql`select id from registro_sif where node_id = ${seed.nodeId} and revocado_en is null`,
      );
      const registros = await mainSuite.admin.execute<{
        huella: string;
        node_id: string;
        sif_id: string;
      }>(
        sql`select huella, node_id, sif_id from registros_facturacion where node_id = ${seed.nodeId}`,
      );
      expect(registros.rows).toHaveLength(1);
      expect(registros.rows[0]!.huella).toMatch(/^[0-9A-F]{64}$/);
      expect(registros.rows[0]!.sif_id).toBe(reservedSif.rows[0]!.id);

      // DOES NOT FILE: the primary's real fiscal pass finds the due envío, has no `fiscal.aeat` cert, and
      // SKIPS it — so box-status flips awaitingFiscalCertificate:true and the envío is never submitted.
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

      // The envío was never submitted — still pendiente, never attempted (a missing cert is a per-tenant
      // skip BEFORE the claim, so intentos stays 0).
      expect(await readEnvios(mainSuite.admin, MIRROR_TENANT_ID)).toEqual([
        { estado: "pendiente", intentos: 0, incidencia: false },
      ]);
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 120_000);

  // STEP 2 — the break-glass path: the offline fallback authorizes a promote with no login at all.
  it("break-glass secret → 200 promoted (no login)", async () => {
    const seed = await seedMirror(breakGlassSuite.admin);
    const breakGlass = await mintBreakGlassSecret(breakGlassSuite.admin);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-bg-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const server = await startServer(mirrorEnv(breakGlassSuite, port, seed.nodeId, stateDir)).catch(
      async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        killSpy.mockRestore();
        throw err;
      },
    );
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      const res = await postPromote(base, { oldNodeNeutralised: true, breakGlass });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(breakGlassSuite.admin)).toBe("primary");
      expect(await readSingletonRole(breakGlassSuite.admin)).toBe("primary");
    } finally {
      await server.close();
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 90_000);

  // STEP 5 — the admin-connection fail-closed: a non-owner WAITRON_ADMIN_DATABASE_URL makes the promote
  // owner write raise 42501, surfaced as 500 promotion.failed with the node UNCHANGED (never a silent
  // no-op); unset, it falls back to the migrations URL and succeeds.
  it("non-owner WAITRON_ADMIN_DATABASE_URL → 500 promotion.failed, node unchanged; unset → falls back and succeeds", async () => {
    const seed = await seedMirror(adminConnSuite.admin);
    const breakGlass = await mintBreakGlassSecret(adminConnSuite.admin);
    const appUrl = roleUrl(adminConnSuite.pg.uri, "app_login", "app_pw");

    // --- Fail-closed boot: WAITRON_ADMIN_DATABASE_URL is the non-owner app_login role. ---
    const failPort = await freePort();
    const failBase = `http://127.0.0.1:${failPort}`;
    const failStateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-adminfail-state-"));
    writeFileSync(join(failStateDir, "modules.json"), FISCAL_NONE_OFF);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const failServer = await startServer(
      mirrorEnv(adminConnSuite, failPort, seed.nodeId, failStateDir, {
        WAITRON_ADMIN_DATABASE_URL: appUrl,
      }),
    ).catch(async (err: unknown) => {
      await rm(failStateDir, { recursive: true, force: true });
      killSpy.mockRestore();
      throw err;
    });
    try {
      await poll(async () => failServer.health.lastPassAt ?? undefined);
      const failed = await postPromote(failBase, { oldNodeNeutralised: true, breakGlass });
      // The owner write hit a role with no UPDATE on `deployment` → 42501, a non-AppError. The error
      // boundary answers a 500 with the OPAQUE `server.internal` code (the connection string must never
      // leak into a response, error-boundary.ts) and logs the `promotion.failed` tag with the classified
      // errorCode — the fail-closed surface: a loud 500, never a silent no-op.
      expect(failed.status).toBe(500);
      expect((await failed.json()).error.code).toBe("server.internal");
      // FAILED CLOSED: the deployment is untouched — still a mirror.
      expect(await readDeploymentMode(adminConnSuite.admin)).toBe("mirror");
      expect(await readSingletonRole(adminConnSuite.admin)).toBe("secondary");
      // The restart was never scheduled (the promote threw before returning a non-alreadyPrimary result).
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      await failServer.close();
      await rm(failStateDir, { recursive: true, force: true });
    }

    // --- Fallback boot: WAITRON_ADMIN_DATABASE_URL unset → the owner write runs over the migrations URL
    // (the superuser here) and the promote succeeds. ---
    const okPort = await freePort();
    const okBase = `http://127.0.0.1:${okPort}`;
    const okStateDir = await mkdtemp(join(tmpdir(), "waitron-promote-e2e-adminok-state-"));
    writeFileSync(join(okStateDir, "modules.json"), FISCAL_NONE_OFF);
    const okServer = await startServer(
      mirrorEnv(adminConnSuite, okPort, seed.nodeId, okStateDir),
    ).catch(async (err: unknown) => {
      await rm(okStateDir, { recursive: true, force: true });
      killSpy.mockRestore();
      throw err;
    });
    try {
      await poll(async () => okServer.health.lastPassAt ?? undefined);
      const ok = await postPromote(okBase, { oldNodeNeutralised: true, breakGlass });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(adminConnSuite.admin)).toBe("primary");
      expect(await readSingletonRole(adminConnSuite.admin)).toBe("primary");
    } finally {
      await okServer.close();
      killSpy.mockRestore();
      await rm(okStateDir, { recursive: true, force: true });
    }
  }, 120_000);
});

// STEP 4 — the read-only-gate hole, proven by DELETION at the exemption-clause level (CLAUDE.md §4). The
// real booted mirror above already proves the exemption is IN PLACE (the promote POST reaches the handler
// while an ordinary write POST is 403). Here the negative control: a read-only gate WITHOUT the
// `/management-api/promote` clause turns the same authorized-shaped promote POST into a 403 node.read_only,
// and restoring the clause lets it reach the handler again. This exercises the exact `readOnlyGate`
// predicate boot.ts builds; it needs no boot (the gate is a pure middleware). Prove-by-deletion in
// boot.ts's own source is documented in the task report (removed the clause, saw the authorized promote
// become 403, restored it — boot.ts unchanged at commit).
describe("read-only-gate exemption for the promote POST — proven by deletion", () => {
  // A `run` that would ALWAYS promote if reached — so a 403 is unambiguously the gate, not the handler.
  const alwaysRun = () => Promise.resolve({ alreadyPrimary: false, restarting: true });
  // The exact exemption clause boot.ts installs (boot.ts ~line 1011).
  const promoteExempt = (c: { req: { method: string; path: string } }) =>
    c.req.method === "POST" && c.req.path === "/management-api/promote";

  function appWith(
    exempt: ((c: { req: { method: string; path: string } }) => boolean) | undefined,
  ): Hono {
    const app = new Hono();
    app.use(
      "*",
      readOnlyGate(() => true, exempt),
    ); // a read-only mirror (isReadOnly always true)
    mountPromoteApi(app, { appDb: mainSuite.admin, tenantId: MIRROR_TENANT_ID, run: alwaysRun });
    return app;
  }

  it("WITH the exemption clause: an ordinary write POST is 403 but the promote POST reaches the handler", async () => {
    const app = appWith(promoteExempt);

    const write = await app.request("/management-api/catalogues", { method: "POST", body: "{}" });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: { code: "node.read_only", params: {} } });

    // No credential in the body → the handler's own credential screen answers 401 password.invalid. A
    // 401 (not the gate's 403) is proof the exempt POST reached the real handler.
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
