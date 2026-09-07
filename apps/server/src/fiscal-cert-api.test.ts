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
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  withTenant,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { getCredential, loadKeyRing } from "@waitron/credentials";
import { tenantId as brandTenantId } from "@waitron/shared";
import type {
  Endorsement,
  MembershipDocumentBody,
  SignedMembershipDocument,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { sealMirrorToken } from "./mirror-token.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import {
  readCertStatus,
  sealLiveCertTx,
  storeDormantCert,
  type AeatCertMaterial,
} from "./fiscal-cert.js";
import { roleUrl } from "./testing/postgres.js";

// Cert-distribution Task 10: the two management-API endpoints for the AEAT certificate —
// `POST /management-api/fiscal-certificate/unlock` (break-glass unlock of the dormant copy) and
// `POST /management-api/fiscal-certificate` (admin-authorized install/replace). Both are PRIMARY-ONLY:
// a mirror's read-only gate refuses the write BEFORE the handler with `node.read_only`.
//
// Real Postgres is mandatory (CLAUDE.md §4): the endpoints run through the non-superuser `app_login`
// pool (verifyBreakGlass, the admin-login authorize, the dormant unwrap SELECT) and the owner pool
// (the live-cert seal / corrupt-dormant delete), and the mirror boot performs owner-role deployment
// writes — all false passes on PGlite (every PGlite connection is a superuser).
//
// DELIBERATELY UNTESTED here: boot's `certSeat === undefined` (fiscal-none) branch, which refuses an
// install with `setup.request_invalid`. Every boot in this suite disables `fiscal-none` (the fiscal
// slot resolves to Veri*Factu, which DOES carry a `provisioningSecret`), so exercising the empty-seat
// branch would need a whole second regime configuration for one guard clause. The guard is a thin
// defensive refuse; the regime-selection wiring it depends on is covered by the module suites.

// `undici`'s fetch is mocked to REJECT so no background pull/tunnel dial reaches a real host; Node's
// own global `fetch` still serves the endpoint requests below (boot.promote-endpoint.test.ts idiom).
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in fiscal-cert-api.test.ts")),
    ),
  };
});

const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-cert-api-media-"));
const FISCAL_NONE_OFF = JSON.stringify({ modules: { "fiscal-none": false } });
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-cert-api-state-"));
writeFileSync(join(STATE_ROOT, "modules.json"), FISCAL_NONE_OFF);

const CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
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

const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
const ADMIN_PW = "correct-horse-battery-staple";
// A `manager`-role person authenticates but does NOT hold `fiscal.configure` (admin-only,
// permissions.test.ts), so the install endpoint authorizes it away with 403.
const MANAGER_ID = "88888888-8888-4888-8888-888888888888";
const MANAGER_PW = "manager-password-here";

// A valid AEAT cert: `certKind ∈ {sello, representante}`, a non-empty base64 `pfxBase64` ("QQ==" = "A"),
// a non-empty passphrase (packages/fiscal-verifactu/src/provisioning-secret.ts validateAeatCert).
const VALID_CERT: AeatCertMaterial = { pfxBase64: "QQ==", passphrase: "pfx-pw", certKind: "sello" };
// A DISTINCT valid cert (different bytes AND certKind) seeded as the pre-existing live cert, so a later
// install with `VALID_CERT` can be proven to have REPLACED it rather than merely left it in place.
const OLD_LIVE_CERT: AeatCertMaterial = {
  pfxBase64: "Qk9C",
  passphrase: "old-pfx-pw",
  certKind: "representante",
};
// A malformed cert — `certKind` outside the set — that `validate` refuses with `setup.request_invalid`.
const MALFORMED_CERT = { pfxBase64: "QQ==", passphrase: "pfx-pw", certKind: "bogus" };

const MIRROR_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MIRROR_NUMERO_INSTALACION = 7;

const suite = useTemplateDb({ template: "manifest" });
const mirrorSuite = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;
let appDatabaseUrl: string;

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

async function seedTillIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90111111H', 'Cert Api Till SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Cert Api node')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, pin_hash, password_hash, role)
    values (${ADMIN_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Cert Admin', ${hashPin("1234")},
            ${hashPassword(ADMIN_PW)}, 'admin')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into persons (id, tenant_id, display_name, pin_hash, password_hash, role)
    values (${MANAGER_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Cert Manager', ${hashPin("5678")},
            ${hashPassword(MANAGER_PW)}, 'manager')
    on conflict do nothing`);
  await establishNodeIdentity(
    { ownerDb: admin, ring: RING },
    TILL_ENV.WAITRON_TILL_TENANT_ID,
    TILL_ENV.WAITRON_TILL_NODE_ID,
  );
}

async function seedMirrorIdentity(admin: Database): Promise<{ nodeId: string }> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${MIRROR_TENANT_ID}, 'ES', '90222222H', 'Cert Api Cloud SL')
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

  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, "mirror");
  return { nodeId: standby.nodeId };
}

/** Wipe the tenant's fiscal cert vault rows so each cert scenario starts from a known state. */
async function clearCerts(admin: Database, tenantId: string): Promise<void> {
  await admin.execute(sql`
    delete from tenant_credentials
    where tenant_id = ${tenantId} and purpose in ('fiscal.aeat', 'fiscal.aeat.dormant')`);
}

async function certStatus(admin: Database, tenantId: string): Promise<"live" | "dormant" | "none"> {
  return withTenant(admin, tenantId, (tx) => readCertStatus(tx, RING, tenantId));
}

/** Decrypt and return the live `fiscal.aeat` cert content, so a test can assert WHICH cert is sealed
 * (status "live" alone cannot distinguish a replaced cert from an untouched one). */
async function readLiveCert(admin: Database, tenantId: string): Promise<Record<string, string>> {
  return withTenant(admin, tenantId, (tx) =>
    getCredential(tx, RING, { tenantId: brandTenantId(tenantId), purpose: "fiscal.aeat" }),
  );
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-cert-api-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  await seedTillIdentity(suite.admin);
  await stampDeployment(suite.admin, "production");
  await setSingletonRole(suite.admin, "primary");
  await writeNodeMembership(suite.admin, selfDoc("serving-primary"));
  appDatabaseUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

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

async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  throw new Error("poll: predicate did not become defined within ~10s");
}

function bootTrading(port: number) {
  return startServer({
    ...KEY_ENV,
    ...TICK_ENV,
    ...TILL_ENV,
    DATABASE_URL: appDatabaseUrl,
    WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
  });
}

async function postJson(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const UNLOCK = "/management-api/fiscal-certificate/unlock";
const INSTALL = "/management-api/fiscal-certificate";

describe("fiscal-certificate endpoints (real Postgres): unlock + install/replace on a primary", () => {
  it("unlock: right secret seals the live cert; wrong secret 401; absent 409; corrupt 409 → none", async () => {
    const tenant = TILL_ENV.WAITRON_TILL_TENANT_ID;
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);
      const secret = await mintBreakGlassSecret(suite.admin);

      // Wrong secret → 401 promotion.break_glass_invalid (never reaches the dormant unwrap).
      await clearCerts(suite.admin, tenant);
      const wrong = await postJson(base, UNLOCK, { breakGlass: `${secret}-nope` });
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error.code).toBe("promotion.break_glass_invalid");

      // A body carrying no break-glass secret hits the non-string screen — 401, never a 500 or a fall
      // through to the dormant unwrap.
      const empty = await postJson(base, UNLOCK, {});
      expect(empty.status).toBe(401);
      expect((await empty.json()).error.code).toBe("promotion.break_glass_invalid");

      // Right secret but NO dormant row → 409 fiscal.certificate_dormant_missing.
      const missing = await postJson(base, UNLOCK, { breakGlass: secret });
      expect(missing.status).toBe(409);
      expect((await missing.json()).error.code).toBe("fiscal.certificate_dormant_missing");

      // Dormant wrapped under the SAME secret → 200, live cert sealed (status flips to "live").
      await clearCerts(suite.admin, tenant);
      await withTenant(suite.admin, tenant, (tx) =>
        storeDormantCert(tx, RING, tenant, VALID_CERT, secret),
      );
      expect(await certStatus(suite.admin, tenant)).toBe("dormant");
      const ok = await postJson(base, UNLOCK, { breakGlass: secret });
      expect(ok.status).toBe(200);
      expect(await certStatus(suite.admin, tenant)).toBe("live");

      // Dormant wrapped under a DIFFERENT secret → the verified break-glass will not open it → corrupt:
      // the dormant row is deleted and 409 fiscal.certificate_unlock_failed; status returns to "none".
      await clearCerts(suite.admin, tenant);
      await withTenant(suite.admin, tenant, (tx) =>
        storeDormantCert(tx, RING, tenant, VALID_CERT, `${secret}-other`),
      );
      const corrupt = await postJson(base, UNLOCK, { breakGlass: secret });
      expect(corrupt.status).toBe(409);
      expect((await corrupt.json()).error.code).toBe("fiscal.certificate_unlock_failed");
      expect(await certStatus(suite.admin, tenant)).toBe("none");
    } finally {
      await server.close();
    }
  }, 60_000);

  it("install: admin + valid cert seals live (overwrite); malformed 400 unchanged; non-admin 403", async () => {
    const tenant = TILL_ENV.WAITRON_TILL_TENANT_ID;
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = await bootTrading(port);
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // Admin login + a valid cert → 200. Seed a REAL live `fiscal.aeat` cert first (a DISTINCT one),
      // then install a DIFFERENT cert, to prove this REPLACES the existing live cert (the renewal path
      // this endpoint doubles as) rather than merely leaving an already-configured venue's cert in place.
      // Status "live" alone cannot show replacement, so assert the sealed CONTENT is the newly-installed
      // cert, not the seeded one.
      await clearCerts(suite.admin, tenant);
      await withTenant(suite.admin, tenant, (tx) =>
        sealLiveCertTx(tx, RING, tenant, OLD_LIVE_CERT),
      );
      expect(await readLiveCert(suite.admin, tenant)).toMatchObject({
        certKind: OLD_LIVE_CERT.certKind,
        pfxBase64: OLD_LIVE_CERT.pfxBase64,
      });
      const install = await postJson(base, INSTALL, {
        personId: ADMIN_ID,
        password: ADMIN_PW,
        aeatCert: VALID_CERT,
      });
      expect(install.status).toBe(200);
      expect(await certStatus(suite.admin, tenant)).toBe("live");
      // The live cert is now the INSTALLED one, byte-for-byte — the seeded cert was replaced.
      expect(await readLiveCert(suite.admin, tenant)).toEqual({
        pfxBase64: VALID_CERT.pfxBase64,
        passphrase: VALID_CERT.passphrase,
        certKind: VALID_CERT.certKind,
      });

      // A malformed cert (bad certKind) → 400 setup.request_invalid and NOTHING re-sealed: the live cert
      // installed above is unchanged, proving the malformed body sealed nothing new — asserted on the
      // CONTENT, not just the "live" status, so a silent overwrite with garbage could not pass.
      const bad = await postJson(base, INSTALL, {
        personId: ADMIN_ID,
        password: ADMIN_PW,
        aeatCert: MALFORMED_CERT,
      });
      expect(bad.status).toBe(400);
      expect((await bad.json()).error.code).toBe("setup.request_invalid");
      expect(await readLiveCert(suite.admin, tenant)).toEqual({
        pfxBase64: VALID_CERT.pfxBase64,
        passphrase: VALID_CERT.passphrase,
        certKind: VALID_CERT.certKind,
      });

      // A non-admin (manager) authenticates but lacks fiscal.configure → 403 authorization.not_permitted,
      // and no cert is sealed on that path.
      await clearCerts(suite.admin, tenant);
      const forbidden = await postJson(base, INSTALL, {
        personId: MANAGER_ID,
        password: MANAGER_PW,
        aeatCert: VALID_CERT,
      });
      expect(forbidden.status).toBe(403);
      expect((await forbidden.json()).error.code).toBe("authorization.not_permitted");
      expect(await certStatus(suite.admin, tenant)).toBe("none");

      // A missing credential → 401 password.invalid, revealing no field, and sealing nothing.
      const noCred = await postJson(base, INSTALL, { aeatCert: VALID_CERT });
      expect(noCred.status).toBe(401);
      expect((await noCred.json()).error.code).toBe("password.invalid");
      expect(await certStatus(suite.admin, tenant)).toBe("none");
    } finally {
      await server.close();
    }
  }, 60_000);

  it("a MIRROR refuses the install POST at the read-only gate (403 node.read_only)", async () => {
    const seed = await seedMirrorIdentity(mirrorSuite.admin);
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-cert-api-mirror-state-"));
    writeFileSync(join(stateDir, "modules.json"), FISCAL_NONE_OFF);

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      WAITRON_TILL_TENANT_ID: MIRROR_TENANT_ID,
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      DATABASE_URL: roleUrl(mirrorSuite.pg.uri, "app_login", "app_pw"),
      WAITRON_MIGRATIONS_DATABASE_URL: mirrorSuite.pg.uri,
      WAITRON_SYNC_DATABASE_URL: roleUrl(mirrorSuite.pg.uri, "sync_applier", "ap"),
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });
    try {
      await poll(async () => server.health.lastPassAt ?? undefined);

      // The read-only gate refuses the write verb BEFORE the handler: no new gate exemption was added,
      // so a mirror answers node.read_only (403) rather than reaching the install logic.
      const res = await postJson(base, INSTALL, {
        personId: ADMIN_ID,
        password: ADMIN_PW,
        aeatCert: VALID_CERT,
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { code: "node.read_only", params: {} } });
    } finally {
      await server.close();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
