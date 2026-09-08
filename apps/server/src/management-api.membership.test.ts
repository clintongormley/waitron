import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAppUser,
  readNodeMembership,
  stampDeployment,
  withTenant,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountManagementApi } from "./management-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

// GET /management-api/membership — how a returning box fetches its cloud peer's CURRENT signed
// membership chart (Ruling C7, the boot-time replacement for the deleted gossip). It returns THIS node's
// held `node_membership` document, authenticated by the SAME credential shape + primitives the
// mirror-bundle endpoint uses: `loginManagerById` (personId + password + totp) then the admin-only
// `mirror.create` authorization. Because a GET carries no body in this runtime (undici refuses one), the
// credential rides in the `x-waitron-peer-credential` header as JSON — the same three fields, the same
// login/authorize primitives, not a new auth mechanism.
//
// Real Postgres, not PGlite: the endpoint authenticates + authorizes as `app_user` (the dashboard login
// shape) — neither the login nor the `mirror.create` gate is observable under a PGlite superuser, which
// holds every grant (CLAUDE.md §4), exactly as mirror-bundle-api.test.ts.
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique, so
// each provisioned venue needs its own NIF — the per-suite counter the sibling real-Postgres suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(83_000_000 + nifCounter).padStart(8, "0")}K`;
}

let appDb: Database; // app_login → app_user: authentication + the membership read

/** Provision a fresh venue (as the owner), returning the designated ids and the seeded admin's id.
 * `applyVenue` seeds ONE `role='admin'` person carrying ADMIN_PASSWORD (admin holds `mirror.create`). */
async function setupVenue(): Promise<{ designated: AdoptResult; adminPersonId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Membership Endpoint SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
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
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  const adminPersonId = await withTenant(appDb, designated.tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(
      sql`select id from persons where tenant_id = ${venue.tenantId} and role = 'admin'`,
    );
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId };
}

/** Insert a NON-admin (staff) person carrying a dashboard password — staff lacks `mirror.create`, so it
 * authenticates but fails authorization → 403. */
async function seedStaff(tenantId: string): Promise<string> {
  return withTenant(suite.admin, tenantId, async (tx) => {
    await asAppUser(tx);
    const r = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
      values (${tenantId}, 'Cajera', ${hashPin("4321")}, ${hashPassword(STAFF_PASSWORD)}, 'staff')
      returning id`);
    return r.rows[0]!.id;
  });
}

/** Mount the management API on a fresh Hono app for one tenant. The membership route reads only
 * `deps.db` + `deps.cfg.tenantId`; the other deps are inert here (no route under test touches them). */
function mountApp(designated: AdoptResult): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: appDb,
      cfg: { tenantId: designated.tenantId, nodeId: designated.nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost:5191",
    },
    () => {},
  );
  return app;
}

/** GET the membership endpoint with the credential in the `x-waitron-peer-credential` header (a GET has
 * no body in this runtime). `credential === undefined` sends no header at all. */
async function getMembership(app: Hono, credential: unknown): Promise<Response> {
  const headers: Record<string, string> =
    credential === undefined ? {} : { "x-waitron-peer-credential": JSON.stringify(credential) };
  return app.request("/management-api/membership", { method: "GET", headers });
}

beforeAll(async () => {
  await stampDeployment(suite.admin, "preproduction");
  appDb = await suite.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
});

describe("GET /management-api/membership (real Postgres)", () => {
  it("returns this node's held signed membership document for an authorised admin credential", async () => {
    const { designated, adminPersonId } = await setupVenue();
    // A held chart naming this node serving-primary — the current authoritative chart a peer fetches.
    // `node_membership` is a whole-database singleton whose term carries across the shared template, so
    // seed one past the held term rather than at 0.
    const seedTerm = ((await readNodeMembership(suite.admin))?.body.term ?? -1) + 1;
    const doc = signedMembershipDoc(seedTerm, {
      signerNodeId: designated.nodeId,
      nodes: [
        {
          nodeId: designated.nodeId,
          contactUrl: "https://box.deli.test",
          standing: "serving-primary",
        },
      ],
    });
    await writeNodeMembership(suite.admin, doc);
    const app = mountApp(designated);

    const res = await getMembership(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    // The endpoint returns the held document verbatim — the same blob the caller then runs its accept
    // fence over. Round-trips through JSON identically to what `readNodeMembership` reads back.
    expect(await res.json()).toEqual({ document: doc });
  });

  it("refuses a non-admin (staff) credential with 403", async () => {
    const { designated } = await setupVenue();
    const staffPersonId = await seedStaff(designated.tenantId);
    const app = mountApp(designated);

    const res = await getMembership(app, { personId: staffPersonId, password: STAFF_PASSWORD });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
  });

  it("refuses a wrong password with 401 before it can authorize", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated);

    const res = await getMembership(app, { personId: adminPersonId, password: "wrong" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses a missing credential header with 401", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);

    const res = await getMembership(app, undefined);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses a malformed credential header (unparseable / wrong shape) with 401", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);

    // Not JSON at all.
    const garbage = await app.request("/management-api/membership", {
      method: "GET",
      headers: { "x-waitron-peer-credential": "not json" },
    });
    expect(garbage.status).toBe(401);
    expect((await garbage.json()).error.code).toBe("password.invalid");

    // Well-formed JSON but a non-UUID personId — the same screen the mirror-bundle route applies.
    const badShape = await getMembership(app, { personId: "not-a-uuid", password: "x" });
    expect(badShape.status).toBe(401);
    expect((await badShape.json()).error.code).toBe("password.invalid");
  });
});
