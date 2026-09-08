import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  asAppUser,
  readDeploymentMode,
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
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { startServer, type StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { sealMirrorToken } from "./mirror-token.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { parseEnvFile } from "./env-file.js";
import {
  readCertStatus,
  sealLiveCertTx,
  storeDormantCert,
  type AeatCertMaterial,
} from "./fiscal-cert.js";
import {
  mintMtlsMaterial,
  startMtlsServer,
  type MtlsMaterial,
  type MtlsServer,
} from "./testing/tls.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { roleUrl } from "./testing/postgres.js";

// Cert-distribution Task 15 — the CAPSTONE run-it proof (spec §7 test 1): a promoted cloud node
// actually FILES with AEAT over a REAL mutual-TLS handshake, using the dormant certificate it
// unlocked at promotion. Everything else in the slice is built and unit-proven; this is the one thing
// that can only be shown by RUNNING it (CLAUDE.md §1/§4 — reading cannot prove a handshake).
//
// The reconciliation the brief calls for: `undici`'s `fetch` is mocked PER HOST, not globally.
//  - Any AEAT SOAP host (`aeatEndpointFor` resolves `www1`/`www10.agenciatributaria.gob.es` in
//    production, `prewww*.aeat.es` in preproduction) is REWRITTEN to a local `node:https` server that
//    REQUIRES + VERIFIES a client certificate (`startMtlsServer`, `rejectUnauthorized:true`) and
//    answers with `FakeAeat`'s SOAP — so the drain's `mtlsFetch` dispatcher (carrying this venue's real
//    PKCS#12) does a GENUINE client-cert handshake and gets a real `estado` back. The rewrite forwards
//    the ORIGINAL `init` verbatim, so the real `undici` Agent (the client cert) is preserved; only the
//    URL host changes.
//  - Every OTHER host REJECTS, preserving the existing suites' intent of blocking the mirror's
//    background pull/tunnel dials (which also go through `undici.fetch`). Node's own global `fetch` — a
//    distinct module identity — still serves the HTTP endpoint requests and the boot health probes.
//
// Real Postgres is mandatory (CLAUDE.md §4): the promote's owner write, the break-glass unlock's owner
// seal, the read-only gate served through the non-superuser `app_login` pool, and the promoted
// primary's drain running as the deployment role are all false passes on a superuser-only PGlite.

// The local mTLS AEAT origin the per-host mock rewrites AEAT hosts to. `vi.hoisted` so the mock factory
// (hoisted above the imports) can close over it; the `.origin` is filled in once the server is up. A
// mutable holder, not a value, because the server is created per test run, after the factory is defined.
const aeatRoute = vi.hoisted(() => ({ origin: undefined as string | undefined }));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  const isAeatHost = (host: string): boolean =>
    host.endsWith("agenciatributaria.gob.es") || host.endsWith("aeat.es");
  return {
    ...actual,
    // Per-host: an AEAT host is rewritten to the local mTLS server (the REAL handshake happens against
    // it because `init` still carries the drain's mTLS dispatcher); everything else is refused, the way
    // the global-reject suites refuse background dials.
    fetch: vi.fn((input: unknown, init?: unknown) => {
      const url = new URL(String(input));
      if (isAeatHost(url.hostname)) {
        if (aeatRoute.origin === undefined) {
          return Promise.reject(new Error("aeat route not set: local mTLS origin is undefined"));
        }
        return actual.fetch(aeatRoute.origin, init as Parameters<typeof actual.fetch>[1]);
      }
      return Promise.reject(new Error(`undici fetch blocked for non-AEAT host: ${url.hostname}`));
    }),
  };
});

const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-certdist-e2e-media-"));
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-certdist-e2e-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

const CREDENTIALS_KEY = Buffer.alloc(32, 9).toString("base64");
// Production so the drain resolves the production AEAT host family (`www1`/`www10`) — the mock rewrites
// either family, but a real deployment env pins the whole flow to one, and `entorno` stamps `production`.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
};

const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// One venue, two conceptual nodes: the primary A whose real `fiscal.aeat` cert is adopted, and the
// mirror B that seals it dormant and later promotes. Fixed ids, re-seeded per clone (each
// `useTemplateDb` clones the manifest afresh, so they never collide across clones).
const MIRROR_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // inert, overwritten at promote
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // primary A this mirror pulls
const MIRROR_NUMERO_INSTALACION = 7;

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_EMAIL = "admin@certdist-e2e.test";
const ADMIN_PW = "correct-horse-battery-staple";

const STAFF_ID = "88888888-8888-4888-8888-888888888888";
const STAFF_PIN = "5555";

const DEVICE_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_TOKEN = "certdist-e2e-device-token";
const DEVICE_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const DEVICE_COOKIE_HEADER = `${DEVICE_COOKIE}=${DEVICE_ID}.${DEVICE_TOKEN}`;

// One mTLS fixture shared by both roles: `material.clientPfx` is A's venue certificate (sealed live on
// A, dormant on B); `material.serverCertPem`/`caPem` is the local AEAT server B's drain handshakes to.
// Both are signed by the same test CA, so the client (whose PFX bundles that CA — see
// `aeat-transport.test.ts`'s "ca omitted" case) trusts the server without an explicit `ca`, and the
// server verifies the client. `certKind:"representante"` selects the `www1` host family (production).
const MTLS: MtlsMaterial = mintMtlsMaterial();
const AEAT_CERT: AeatCertMaterial = {
  pfxBase64: MTLS.clientPfx.toString("base64"),
  passphrase: MTLS.clientPassphrase,
  certKind: "representante",
};

const clone1 = useTemplateDb({ template: "manifest" });
const clone2 = useTemplateDb({ template: "manifest" });

// Well after any present-day sale date, so FakeAeat never treats a record as future-dated (which would
// downgrade a clean accept to `AceptadaConErrores`).
const FAKE_AEAT_SERVER_NOW = new Date("2030-01-01T00:00:00Z");

let migrationsRoot: string;
let aeatServer: MtlsServer;
// `let`, reassigned per test — the mTLS server handler reads this module binding at request time, so a
// fresh instance gives each test an empty `stored()` baseline despite the one shared server.
let fakeAeat: ReturnType<typeof createFakeAeat>;

/** Reset the shared FakeAeat so a test's `stored()` starts empty (the mTLS handler reads the current
 * binding). Called at the top of each test. */
function resetFakeAeat(): void {
  fakeAeat = createFakeAeat({ serverNow: FAKE_AEAT_SERVER_NOW });
}

/** Seed a clone as a read-only adopted mirror B holding its OWN dormant identity, plus the admin the
 * promote endpoint + box-status authenticate — the promote-endpoint-e2e shape. Returns B's own nodeId
 * and the reserved standard series id the promote corrects trading.env to. */
async function seedMirror(admin: Database): Promise<{ nodeId: string; standardSeriesId: string }> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${MIRROR_TENANT_ID}, 'ES', '90222222H', 'Cert Dist E2E Cloud SL')
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
  await sealMirrorToken(admin, RING, MIRROR_TENANT_ID, "mirror-sync-token");

  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, email, pin_hash, password_hash, role)
    values (${ADMIN_ID}, ${MIRROR_TENANT_ID}, 'Cert Dist Admin', ${ADMIN_EMAIL}, ${hashPin("1234")},
            ${hashPassword(ADMIN_PW)}, 'admin')
    on conflict do nothing`);

  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, "mirror");
  const standardSeriesId = await readStandardSeriesId(admin, MIRROR_TENANT_ID, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

/** Seed the venue-sale prerequisites so the PROMOTED primary can ring a real cash sale over HTTP that
 * chains on its own reserved SIF and enqueues a `pendiente` envío for the drain to file. */
async function seedSaleVenue(admin: Database): Promise<void> {
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
}

async function certStatus(admin: Database): Promise<"live" | "dormant" | "none"> {
  return withTenant(admin, MIRROR_TENANT_ID, (tx) => readCertStatus(tx, RING, MIRROR_TENANT_ID));
}

/** Does the tenant hold a live `fiscal.aeat` row at all (independent of `readCertStatus`, so an
 * assertion "no live row" cannot pass merely because a dormant row shadows it in the status read). */
async function hasLiveCertRow(admin: Database): Promise<boolean> {
  const rows = await admin.execute<{ n: string }>(sql`
    select count(*)::text as n from tenant_credentials
    where tenant_id = ${MIRROR_TENANT_ID} and purpose = 'fiscal.aeat'`);
  return rows.rows[0]!.n !== "0";
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-certdist-e2e-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  // The local AEAT: a real client-cert-verifying HTTPS server whose handler routes the received SOAP
  // envelope through the CURRENT `fakeAeat` (reset per test, below, so `stored()` starts empty each
  // time). `serverNow` is set FAR AHEAD of the sale's expedition date (the real clock): FakeAeat treats
  // a record dated after its `serverNow` as future-dated (`AceptadaConErrores`/code 2004), so a
  // present-day sale would otherwise never resolve to a clean `Correcta`/`aceptado`.
  fakeAeat = createFakeAeat({ serverNow: FAKE_AEAT_SERVER_NOW });
  aeatServer = await startMtlsServer(MTLS, async (body) => {
    const response = await fakeAeat.fetch("https://aeat.local/soap", { method: "POST", body });
    return response.text();
  });
  aeatRoute.origin = aeatServer.origin;
}, 180_000);

afterAll(async () => {
  if (aeatServer !== undefined) await aeatServer.close();
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

/** Polls `predicate` up to ~30s for its first defined value, THROWING on timeout so a call site never
 * silently proceeds on an unmet condition. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 600; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~30s");
}

async function postPromote(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/promote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postUnlock(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/management-api/fiscal-certificate/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mirrorEnv(
  clone: { pg: { uri: string } },
  port: number,
  nodeId: string,
  stateDir: string,
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
    WAITRON_SYNC_DATABASE_URL: roleUrl(clone.pg.uri, "sync_applier", "ap"),
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
  };
}

/** Boot a fresh primary from the trading.env the promote persisted, exactly as the box supervisor
 * would source it (no sync peers — a fresh promoted primary has none). */
function primaryEnv(persisted: Record<string, string | undefined>, port: number, stateDir: string) {
  return {
    ...KEY_ENV,
    ...TICK_ENV,
    WAITRON_TILL_TENANT_ID: persisted.WAITRON_TILL_TENANT_ID!,
    WAITRON_TILL_TILL_ID: persisted.WAITRON_TILL_TILL_ID!,
    WAITRON_TILL_NODE_ID: persisted.WAITRON_TILL_NODE_ID!,
    WAITRON_TILL_SERIES_ID: persisted.WAITRON_TILL_SERIES_ID!,
    WAITRON_TILL_LOCATION_ID: persisted.WAITRON_TILL_LOCATION_ID!,
    DATABASE_URL: persisted.DATABASE_URL!,
    WAITRON_MIGRATIONS_DATABASE_URL: persisted.WAITRON_MIGRATIONS_DATABASE_URL!,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_STATE_DIR: stateDir,
  };
}

async function readEnvios(
  admin: Database,
): Promise<{ estado: string; intentos: number; incidencia: boolean }[]> {
  const rows = await admin.execute<{ estado: string; intentos: number; incidencia: boolean }>(
    sql`select estado, intentos, incidencia from envios where tenant_id = ${MIRROR_TENANT_ID} order by registro_id`,
  );
  return rows.rows;
}

/** Ring one real cash sale over the HTTP surface (device cookie + staff PIN), returning the mgmt
 * session cookie for the box-status reads. Mirrors promote-endpoint-e2e's sale flow. */
async function ringSale(base: string): Promise<{ mgmtCookie: string }> {
  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: DEVICE_COOKIE_HEADER },
    body: JSON.stringify({ personId: STAFF_ID, pin: STAFF_PIN }),
  });
  expect(login.status).toBe(200);
  const sessionCookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const bothCookies = `${sessionCookie}; ${DEVICE_COOKIE_HEADER}`;

  const products = (await (
    await fetch(`${base}/api/products`, { headers: { cookie: sessionCookie } })
  ).json()) as { products: { id: string; pricingUnit: string }[] };
  const water = products.products.find((p) => p.pricingUnit === "each")!;

  const saleRes = await fetch(`${base}/api/sales`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bothCookies },
    body: JSON.stringify({
      lines: [{ productId: water.id, quantity: "2" }],
      tender: { method: "cash", amount: "5.00" },
    }),
  });
  expect(saleRes.status).toBe(200);
  expect((await saleRes.json()).total).toBe("3.00");

  const mgmtLogin = await fetch(`${base}/management-api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PW }),
  });
  expect(mgmtLogin.status).toBe(200);
  return { mgmtCookie: mgmtLogin.headers.get("set-cookie")!.split(";")[0]! };
}

async function readBoxStatus(base: string, mgmtCookie: string): Promise<Record<string, unknown>> {
  return (await fetch(`${base}/api/box/status`, { headers: { cookie: mgmtCookie } })).json();
}

describe("cert-distribution e2e — a promoted mirror FILES with real mTLS after unlocking its cert (real Postgres)", () => {
  // ASSERTION 1 (dormant transfer) + ASSERTION 2 (break-glass promote → live → real filing).
  it("break-glass promote unlocks the dormant cert; the promoted primary files a registro over a real mTLS handshake", async () => {
    resetFakeAeat();
    const admin = clone1.admin;
    const seed = await seedMirror(admin);
    await seedSaleVenue(admin);
    const breakGlass = await mintBreakGlassSecret(admin);

    // ASSERTION 1: A's real venue cert (the test PKCS#12) is sealed DORMANT on B the way adopt seals it
    // (the same production `storeDormantCert`; the two-server bundle+identity ceremony is owned by
    // adopt-e2e.test.ts). readCertStatus reports "dormant" and there is NO live `fiscal.aeat` row. That
    // the material is a genuine, usable cert is proved later by the drain's handshake against FakeAeat —
    // a corrupt or fake PFX could never complete it. A quick round-trip first shows the SAME material,
    // sealed live, is a valid "live" — so the dormant assertion below is a real state, not a missing row.
    await withTenant(admin, MIRROR_TENANT_ID, (tx) =>
      sealLiveCertTx(tx, RING, MIRROR_TENANT_ID, AEAT_CERT),
    );
    expect(await certStatus(admin)).toBe("live");
    await admin.execute(sql`
      delete from tenant_credentials
      where tenant_id = ${MIRROR_TENANT_ID} and purpose = 'fiscal.aeat'`);
    await withTenant(admin, MIRROR_TENANT_ID, (tx) =>
      storeDormantCert(tx, RING, MIRROR_TENANT_ID, AEAT_CERT, breakGlass),
    );
    expect(await certStatus(admin)).toBe("dormant");
    expect(await hasLiveCertRow(admin)).toBe(false);

    const mirrorPort = await freePort();
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-certdist-e2e-a-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    // The promote schedules a real SIGTERM for the box restart; spy so it never fires at vitest — the
    // manual primary boot below IS the restart (promote-endpoint-e2e's safety).
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const mirror = await startServer(mirrorEnv(clone1, mirrorPort, seed.nodeId, stateDir)).catch(
      async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        killSpy.mockRestore();
        throw err;
      },
    );

    let primary: StartedServer | undefined;
    try {
      await poll(async () => mirror.health.lastPassAt ?? undefined);

      // ASSERTION 2a: promote B WITH the break-glass secret. The PONR unwraps the dormant cert and seals
      // it live in the SAME transaction (cert-distribution §3.1) → readCertStatus flips to "live".
      const res = await postPromote(mirrorBase, { oldNodeNeutralised: true, breakGlass });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(admin)).toBe("primary");
      expect(await certStatus(admin)).toBe("live");

      // Restart into mode=primary from the persisted trading.env (the box the supervisor would source).
      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      await mirror.close();
      const primaryPort = await freePort();
      const primaryBase = `http://127.0.0.1:${primaryPort}`;
      primary = await startServer(primaryEnv(persisted, primaryPort, stateDir));
      await poll(async () => primary!.health.lastPassAt ?? undefined);

      // Sell a real cash sale → one chained registro + a `pendiente` envío for the drain to file.
      const { mgmtCookie } = await ringSale(primaryBase);

      // ASSERTION 2b — THE CAPSTONE: the drain resolves the venue's live cert, does a REAL client-cert
      // handshake to the local AEAT server, and FILES. Poll the envío to `aceptado` (FakeAeat answers
      // `Correcta` → `resolveEstadoEfectivo` "accepted" → estado "aceptado", intentos 1).
      const filed = await poll(async () => {
        const rows = await readEnvios(admin);
        return rows.length === 1 && rows[0]!.estado === "aceptado" ? rows[0] : undefined;
      });
      expect(filed).toEqual({ estado: "aceptado", intentos: 1, incidencia: false });

      // The handshake was genuinely mutual: the AEAT server saw THIS venue's client certificate CN, and
      // FakeAeat holds exactly the one submitted record. A bypass or a fake PFX could produce neither.
      expect(aeatServer.sawClientCn()).toBe(MTLS.clientCn);
      expect(fakeAeat.stored()).toHaveLength(1);
      expect(fakeAeat.stored()[0]!.estado).toBe("Correcta");

      // awaitingFiscalCertificate never went true — the cert was live, so the drain never skipped.
      const status = await readBoxStatus(primaryBase, mgmtCookie);
      expect(status.awaitingFiscalCertificate).toBe(false);
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 180_000);

  // ASSERTION 3 (admin-login promote leaves the cert dormant → awaiting; /unlock installs it → next
  // drain files) + ASSERTION 4 (a wrong break-glass on /unlock is refused, sealing nothing).
  it("admin-login promote leaves the cert dormant (awaiting); a wrong /unlock is refused; the right /unlock files", async () => {
    resetFakeAeat();
    const admin = clone2.admin;
    const seed = await seedMirror(admin);
    await seedSaleVenue(admin);
    const breakGlass = await mintBreakGlassSecret(admin);
    await withTenant(admin, MIRROR_TENANT_ID, (tx) =>
      storeDormantCert(tx, RING, MIRROR_TENANT_ID, AEAT_CERT, breakGlass),
    );
    expect(await certStatus(admin)).toBe("dormant");

    const mirrorPort = await freePort();
    const mirrorBase = `http://127.0.0.1:${mirrorPort}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-certdist-e2e-b-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const mirror = await startServer(mirrorEnv(clone2, mirrorPort, seed.nodeId, stateDir)).catch(
      async (err: unknown) => {
        await rm(stateDir, { recursive: true, force: true });
        killSpy.mockRestore();
        throw err;
      },
    );

    let primary: StartedServer | undefined;
    try {
      await poll(async () => mirror.health.lastPassAt ?? undefined);

      // ASSERTION 3a: promote with an ADMIN LOGIN (no break-glass) → the PONR folds in NO cert seal, so
      // the cert stays dormant and NO live row is written.
      const res = await postPromote(mirrorBase, {
        oldNodeNeutralised: true,
        personId: ADMIN_ID,
        password: ADMIN_PW,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
      expect(await readDeploymentMode(admin)).toBe("primary");
      expect(await certStatus(admin)).toBe("dormant");
      expect(await hasLiveCertRow(admin)).toBe(false);

      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      await mirror.close();
      const primaryPort = await freePort();
      const primaryBase = `http://127.0.0.1:${primaryPort}`;
      primary = await startServer(primaryEnv(persisted, primaryPort, stateDir));
      await poll(async () => primary!.health.lastPassAt ?? undefined);

      // Sell → a `pendiente` envío. With no live cert the drain SKIPS filing and box-status flips
      // awaitingFiscalCertificate:true; the envío is never submitted (intentos stays 0).
      const { mgmtCookie } = await ringSale(primaryBase);
      const awaiting = await poll(async () => {
        const status = await readBoxStatus(primaryBase, mgmtCookie);
        return status.awaitingFiscalCertificate === true ? status : undefined;
      });
      expect(awaiting.awaitingFiscalCertificate).toBe(true);
      expect(await readEnvios(admin)).toEqual([
        { estado: "pendiente", intentos: 0, incidencia: false },
      ]);
      expect(fakeAeat.stored()).toHaveLength(0); // nothing filed while the cert is locked

      // ASSERTION 4: a WRONG break-glass on /unlock → 401 promotion.break_glass_invalid, and NO live row
      // is sealed (the wrong secret is refused before the dormant unwrap is even attempted).
      const wrong = await postUnlock(primaryBase, { breakGlass: `${breakGlass}-nope` });
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error.code).toBe("promotion.break_glass_invalid");
      expect(await certStatus(admin)).toBe("dormant");
      expect(await hasLiveCertRow(admin)).toBe(false);

      // ASSERTION 3b: the RIGHT break-glass on /unlock unwraps the dormant cert and seals it live →
      // readCertStatus "live"; the next drain pass then FILES over a real mTLS handshake.
      const unlock = await postUnlock(primaryBase, { breakGlass });
      expect(unlock.status).toBe(200);
      expect(await certStatus(admin)).toBe("live");

      const filed = await poll(async () => {
        const rows = await readEnvios(admin);
        return rows.length === 1 && rows[0]!.estado === "aceptado" ? rows[0] : undefined;
      });
      expect(filed!.estado).toBe("aceptado");
      expect(aeatServer.sawClientCn()).toBe(MTLS.clientCn);
      expect(fakeAeat.stored()).toHaveLength(1);
      expect(fakeAeat.stored()[0]!.estado).toBe("Correcta");
    } finally {
      if (primary !== undefined) await primary.close().catch(() => undefined);
      await mirror.close().catch(() => undefined);
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 180_000);
});
