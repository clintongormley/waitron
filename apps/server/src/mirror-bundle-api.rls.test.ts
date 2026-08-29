import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, stampDeployment, withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";

// Real Postgres, not PGlite: the endpoint authenticates + authorizes as `app_user` under FORCE RLS
// (the dashboard login shape) and mints the token as a `sync_retention` member — neither is observable
// under a PGlite superuser, which bypasses RLS and holds every grant (CLAUDE.md §4). The RLS reads and
// the non-superuser INSERT on sync_peers are the whole point, exactly as mirror-bundle.rls.test.ts.
const LOCALE = "es-ES";
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

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

/** Provision a fresh venue (as the owner), returning the five designated ids in AdoptResult shape plus
 * the seeded admin's person id. `applyVenue` seeds ONE `role='admin'` person carrying ADMIN_PASSWORD. */
async function setupVenue(): Promise<{ designated: AdoptResult; adminPersonId: string }> {
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
      seriesCode: "A",
      rectificativeSeriesCode: "R",
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
  // The admin person id — read back under RLS as app_user, the only role the endpoint ever uses.
  const adminPersonId = await withTenant(appDb, designated.tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId };
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
    { appDb, retentionDb, stateDir, relayUrl, boxHostname: "waitron.local", designated },
    log,
  );
  return app;
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

    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
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

    const res = await post(app, { personId: staffPersonId, password: STAFF_PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
  });

  it("refuses a wrong password with 401 before it can authorize", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, { personId: adminPersonId, password: "wrong" });
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

    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.no_relay");
  });
});
