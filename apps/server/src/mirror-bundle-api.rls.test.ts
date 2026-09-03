import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  readMembershipTrustSet,
  stampDeployment,
  withTenant,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import { canonicalize, generateNodeKeyPair, verifyBytes } from "@waitron/membership";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";

// Real Postgres, not PGlite: the endpoint authenticates + authorizes as `app_user` under FORCE RLS
// (the dashboard login shape) and mints the token as a `sync_retention` member — neither is observable
// under a PGlite superuser, which bypasses RLS and holds every grant (CLAUDE.md §4). The RLS reads and
// the non-superuser INSERT on sync_peers are the whole point, exactly as mirror-bundle.rls.test.ts.
const LOCALE = "es-ES";
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

// The box vault key for `establishNodeIdentity` / `readNodeIdentityKey` — a fixed test ring, exactly
// as node-identity.test.ts uses. The primary seals its identity key under this ring, and the endpoint
// unseals it (as app_user) to endorse the standby's key.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The standby's identity key the primary vouches for — a real Ed25519 SPKI public key so the
// endorsement's signature verifies against the primary's key over canonicalize({nodeId, publicKey}).
const STANDBY_PUB = generateNodeKeyPair().publicKey;

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling rls tests use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(81_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let appDb: Database; // app_login → app_user: auth + the RLS venue reads
let retentionDb: Database; // sync_pruner → sync_retention: mints the peer token

/** Provision a fresh venue (as the owner) with standard FA + rectificative RF series and an ESTABLISHED
 * node identity, returning the five designated ids in AdoptResult shape, the seeded admin's person id,
 * and the primary node's public key (the trust anchor its endorsement must verify against).
 * `applyVenue` seeds ONE `role='admin'` person carrying ADMIN_PASSWORD. */
async function setupVenue(): Promise<{
  designated: AdoptResult;
  adminPersonId: string;
  primaryPublicKey: string;
}> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Mirror Bundle API SL",
      location: {
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        operationDescription: "Venta en establecimiento",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
      },
      tillName: "Caja 1",
      seriesCode: "FA",
      rectificativeSeriesCode: "RF",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(ADMIN_PASSWORD),
      },
    }),
    { db: suite.admin },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  // Establish the primary's membership identity (owner-side seal + nodes.public_key stamp), so the
  // endpoint can unseal the private key and endorse the standby. Mirrors node-identity.test.ts.
  await establishNodeIdentity(
    { ownerDb: suite.admin, ring: RING },
    designated.tenantId,
    designated.nodeId,
  );
  const primaryPublicKey = (await readMembershipTrustSet(suite.admin, designated.tenantId))[
    designated.nodeId
  ]!;
  // The admin person id — read back under RLS as app_user, the only role the endpoint ever uses.
  const adminPersonId = await withTenant(appDb, designated.tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId, primaryPublicKey };
}

/** Insert a second, NON-admin (staff) person carrying a dashboard password, returning its id. Staff
 * lacks `mirror.create` (admin-only), so it authenticates but fails authorization → 403. */
async function seedStaff(tenantId: string): Promise<string> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (current_tenant_id(), 'Cajera', ${hashPin("4321")}, ${hashPassword(STAFF_PASSWORD)}, 'staff')
      returning id`);
    return r.rows[0]!.id;
  });
}

/** Mount the endpoint on a fresh Hono app with the given relay wiring and (optional) logger. */
function mountApp(designated: AdoptResult, relayUrl: string | undefined, log?: Logger): Hono {
  const app = new Hono();
  mountMirrorBundleApi(
    app,
    {
      appDb,
      retentionDb,
      ring: RING,
      stateDir,
      relayUrl,
      boxHostname: "waitron.local",
      designated,
    },
    log,
  );
  return app;
}

/** A well-formed standby identity — a fresh nodeId + the real STANDBY_PUB — required in every request
 * now (the primary reserves this standby's identity and endorses this key). */
function validStandby(): { standbyNodeId: string; standbyPublicKey: string } {
  return { standbyNodeId: crypto.randomUUID(), standbyPublicKey: STANDBY_PUB };
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request("/management-api/mirror-bundle", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  // The bundle's stateDir must carry tls/ca.crt (the box CA path caCertPath resolves to). Mint a real
  // self-signed CA and write it there so boxCaPem reads back a genuine PEM.
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-api-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await writeFile(
    join(stateDir, "tls", "ca.crt"),
    mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now: new Date() })
      .caCertPem,
  );

  // One stamp on the shared template serves every venue (a whole-DB fact). app_login → app_user for the
  // auth + RLS reads; sync_pruner → sync_retention for enrolPeer, exactly as mirror-bundle.rls.test.ts.
  await stampDeployment(suite.admin, "preproduction");
  appDb = await suite.pg.connectAs("app_login", "app_pw");
  retentionDb = await suite.pg.connectAs("sync_pruner", "pp");
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
  if (retentionDb !== undefined) await retentionDb.close();
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("POST /management-api/mirror-bundle (primary endpoint, real Postgres)", () => {
  it("returns a bundle for an authorised admin credential", async () => {
    const { designated, adminPersonId } = await setupVenue();
    // A log spy: the minted token must NEVER reach the log (the sync.* no-row-content discipline).
    const lines: string[] = [];
    const log: Logger = (level, event, fields) =>
      lines.push(JSON.stringify({ level, event, fields }));
    const app = mountApp(designated, "https://relay.example:9000/", log);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      rows: { tenant: { id: string } };
      syncToken: string;
      relayUrl: string;
      boxHostname: string;
    };
    expect(bundle.rows.tenant.id).toBe(designated.tenantId);
    // The relay coordinates round-trip verbatim as a FULL https URL — the form the mirror consumes as
    // its `peer.url` (`packages/sync/src/pull.ts` fetches `${trimSlash(peer.url)}/sync-api/hello`, which
    // requires a scheme). Boot builds exactly `https://${relayHost}:${relayPort}/`.
    expect(bundle.relayUrl).toBe("https://relay.example:9000/");
    expect(bundle.relayUrl.startsWith("https://")).toBe(true);
    expect(bundle.relayUrl.endsWith("/")).toBe(true);
    expect(bundle.boxHostname).toBe("waitron.local");
    // The token is `${selector}.${secret}` — a uuid selector, a dot, then the base64url secret.
    expect(bundle.syncToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    // The token never appears in any log line (nor does the password).
    for (const line of lines) {
      expect(line).not.toContain(bundle.syncToken);
      expect(line).not.toContain(ADMIN_PASSWORD);
    }
  });

  it("refuses a non-admin (staff) credential with 403", async () => {
    const { designated } = await setupVenue();
    const staffPersonId = await seedStaff(designated.tenantId);
    // No logger passed here — exercises the no-op default (mountMirrorBundleApi's `log?`).
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, {
      personId: staffPersonId,
      password: STAFF_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
  });

  it("refuses a wrong password with 401 before it can authorize", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, { personId: adminPersonId, password: "wrong", ...validStandby() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses an invalid credential shape with 401 (the dashboard-login screen)", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, { personId: "not-a-uuid" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses a present non-string totp with 401 (screened before loginManager)", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    // A well-formed personId + password but a NON-string totp: refused as password.invalid by the body
    // screen (line 81) before it can reach loginManager, the dashboard-login convention.
    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD, totp: 123 });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses mirror.no_relay (400) when no relay is configured, AFTER authorizing", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, undefined);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.no_relay");
  });

  it("returns a reserved identity: a fresh number, disjoint series, and a valid endorsement", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: standby.nodeId,
      standbyPublicKey: standby.publicKey,
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      reservedIdentity: {
        nif: string;
        idSistemaInformatico: string;
        numeroInstalacion: number;
        series: { code: string; purpose: string }[];
        endorsement: { nodeId: string; publicKey: string; endorsedBy: string; signature: string };
      };
    };
    const r = bundle.reservedIdentity;
    // A fresh installation number the primary reserved (past its own — applyVenue's registerSif took 1).
    expect(r.numeroInstalacion).toBeGreaterThan(0);
    expect(typeof r.nif).toBe("string");
    // The primary's own IdSistemaInformatico — applyVenue registers the SIF under WAITRON_ID_SISTEMA ("W1").
    expect(r.idSistemaInformatico).toBe("W1");
    // Disjoint series: one per primary series (FA + RF), each suffixed with the reserved number.
    expect(r.series.map((s) => s.code).sort()).toEqual(
      [`FA-${r.numeroInstalacion}`, `RF-${r.numeroInstalacion}`].sort(),
    );
    // Purpose is preserved alongside the derived code.
    const byCode = new Map(r.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get(`FA-${r.numeroInstalacion}`)).toBe("standard");
    expect(byCode.get(`RF-${r.numeroInstalacion}`)).toBe("rectificative");
    // The endorsement vouches for THIS standby, by the primary node.
    expect(r.endorsement.nodeId).toBe(standby.nodeId);
    expect(r.endorsement.publicKey).toBe(standby.publicKey);
    expect(r.endorsement.endorsedBy).toBe(designated.nodeId);
    // The signature verifies against the primary's public key over canonicalize({nodeId, publicKey}) —
    // i.e. a trust set {primaryNodeId: primaryPublicKey} would admit this standby key.
    expect(
      verifyBytes(
        canonicalize({ nodeId: standby.nodeId, publicKey: standby.publicKey }),
        r.endorsement.signature,
        primaryPublicKey,
      ),
    ).toBe(true);
  });

  it("rejects a missing/malformed standby identity with 400 mirror.standby_invalid", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");

    // No standby fields at all — a valid admin credential, but the standby identity is required.
    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.standby_invalid");

    // A non-UUID standby nodeId is refused the same way.
    const res2 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: "not-a-uuid",
      standbyPublicKey: STANDBY_PUB,
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("mirror.standby_invalid");

    // An empty standby publicKey is refused the same way.
    const res3 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: "",
    });
    expect(res3.status).toBe(400);
    expect((await res3.json()).error.code).toBe("mirror.standby_invalid");
  });
});
