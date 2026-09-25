import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  readNodeMembership,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { mountManagementApi } from "./management-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

/**
 * GET /management-api/membership returns this node's held signed membership chart to a peer
 * presenting an admin credential (`loginManagerById`, then `mirror.create`) in the
 * `x-waitron-peer-credential` header.
 */
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(83_000_000 + nifCounter).padStart(8, "0")}K`;
}

let db: Database;

/** `applyVenue` seeds one admin carrying ADMIN_PASSWORD; admin holds `mirror.create`. */
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  const adminPersonId = await withTransaction(db, (tx) => {
    const rows = tx.all<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return Promise.resolve(rows[0]!.id);
  });
  return { designated, adminPersonId };
}

/** Staff lacks `mirror.create`, so it authenticates and then fails authorization. Seeded through
 * the table definition: `persons.id` and `persons.created_at` are `$defaultFn` generators, which a
 * raw SQL insert never reaches. */
async function seedStaff(): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        displayName: "Cajera",
        pinHash: hashPin("4321"),
        passwordHash: hashPassword(STAFF_PASSWORD),
        role: "staff",
      })
      .returning({ id: persons.id });
    return person!.id;
  });
}

function mountApp(designated: AdoptResult): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db,
      cfg: { nodeId: designated.nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost:5191",
    },
    () => {},
  );
  return app;
}

/** `credential === undefined` sends no header at all. */
async function getMembership(app: Hono, credential: unknown): Promise<Response> {
  const headers: Record<string, string> =
    credential === undefined ? {} : { "x-waitron-peer-credential": JSON.stringify(credential) };
  return app.request("/management-api/membership", { method: "GET", headers });
}

beforeAll(async () => {
  db = suite.db;
  await stampDeployment(db, "preproduction");
});

describe("GET /management-api/membership", () => {
  it("returns this node's held signed membership document for an authorised admin credential", async () => {
    const { designated, adminPersonId } = await setupVenue();
    // `node_membership` is a singleton, so seed one past whatever term is held rather than at 0.
    const seedTerm = ((await readNodeMembership(suite.db))?.body.term ?? -1) + 1;
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
    await writeNodeMembership(suite.db, doc);
    const app = mountApp(designated);

    const res = await getMembership(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document: doc });
  });

  it("refuses a non-admin (staff) credential with 403", async () => {
    const { designated } = await setupVenue();
    const staffPersonId = await seedStaff();
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

    // Well-formed JSON but a non-UUID personId.
    const badShape = await getMembership(app, { personId: "not-a-uuid", password: "x" });
    expect(badShape.status).toBe(401);
    expect((await badShape.json()).error.code).toBe("password.invalid");
  });

  it("refuses a credential header whose JSON is not an object with 401", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    for (const raw of ["null", "[]", "42", '"text"']) {
      const res = await app.request("/management-api/membership", {
        method: "GET",
        headers: { "x-waitron-peer-credential": raw },
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("password.invalid");
    }
  });

  it("refuses an otherwise correct credential whose totp is not a string with 401", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated);
    const res = await getMembership(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      totp: 123456,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });
});
