import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { hashPassword, loginManager, loginManagerById } from "@waitron/identity";
import type { TrustedClock } from "@waitron/fiscal";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { applyVenue } from "./venue-apply.js";

/**
 * The concrete definition of "sellable" (spec §7 / this sub-project's success criterion): a venue
 * provisioned by the REAL `applyVenue` can immediately chain a sale through the real Veri*Factu
 * backend, with nothing seeded by hand between the two.
 *
 * Lives in `@waitron/provisioning`, NOT in `packages/fiscal-verifactu` (the brief's fallback), on a
 * hard constraint: provisioning already depends on `@waitron/fiscal-verifactu` (for `registerSif`),
 * so a fiscal-verifactu test importing `applyVenue` would be a dependency CYCLE. Nothing depends on
 * `@waitron/provisioning`, and neither `@waitron/core` nor `@waitron/verifactu` does, so hosting the
 * e2e here — with those two as devDependencies — keeps the graph acyclic and the dependency
 * direction correct (provisioning sits above the fiscal/core stack).
 *
 * PGlite's default connection is a SUPERUSER, so it bypasses RLS; that is fine here for the same
 * reason as `venue-apply.test.ts` — the FORCE-RLS privilege path is proven by the container suite.
 *
 * The full manifest is migrated (identity before fiscal; sync before fiscal, which fiscal's SP-3a
 * 0014 capture migration needs): the real
 * `applyVenue` now seeds an admin `persons` row, which carries a foreign key onto `tenants`.
 */
const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

const steadyClock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-03-01T13:05:00+01:00"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function request(taxId = "B12345678", adminEmail?: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli SL",
    location: {
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    },
    tillName: "Caja 1",
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: hashPassword("dashPass123"),
      ...(adminEmail !== undefined ? { email: adminEmail } : {}),
    },
  };
}

/** A well-formed sale — the reconciled figures from `write-path-fixtures.ts`'s `saleInput`. */
function saleInput(ids: {
  tenantId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
}): RecordSaleInput {
  return {
    tenantId: brandTenantId(ids.tenantId),
    tillId: brandTillId(ids.tillId),
    nodeId: brandNodeId(ids.nodeId),
    seriesId: brandSeriesId(ids.seriesId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [
        {
          method: "card",
          amount: "16.31",
          tipAmount: "1.90",
          settledAt: steadyClock.now().instant,
        },
      ],
    },
    fiscalBackend: "verifactu",
    clock: steadyClock,
  };
}

describe("a venue provisioned by applyVenue is immediately sellable", () => {
  it("chains a real sale through the Veri*Factu backend against the provisioned node", async () => {
    const venue = await applyVenue(planVenue(request()), { db: suite.db });

    const backend = new VerifactuBackend({
      deploymentEnvironment: "preproduction",
      clock: steadyClock,
      db: suite.db,
      // recordSale never submits (the write path stops at `envios.pendiente`), so `resolveClient`
      // is required by the constructor but not invoked here; a fake AEAT transport satisfies it.
      resolveClient: () => Promise.resolve(createFakeAeat().client()),
    });

    // seriesIds[0] is the STANDARD series — planVenue emits standard before rectificative, and
    // applyVenue pushes in that order.
    const standardSeriesId = venue.seriesIds[0]!;

    const { saleId, fiscal } = await withTenant(suite.db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return recordSale(
        tx,
        backend,
        saleInput({
          tenantId: venue.tenantId,
          tillId: venue.tillId,
          nodeId: venue.nodeId,
          seriesId: standardSeriesId,
        }),
      );
    });

    // recordSale succeeded: it handed back a sale id and a verification URL derived from the record.
    expect(saleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fiscal.verificationUrl).toContain("nif=");

    // The sale is really chained: exactly one registro for this node, sequence 1, and the chain
    // head advanced to it — the concrete proof the freshly-minted SIF and series actually work.
    const chained = await suite.db.execute<{
      registros: number;
      secuencia: number;
      head_secuencia: number;
    }>(sql`
      select
        (select count(*) from registros_facturacion where node_id = ${venue.nodeId})::int as registros,
        (select secuencia from registros_facturacion where sale_id = ${saleId})::int as secuencia,
        (select secuencia from cadenas where node_id = ${venue.nodeId})::int as head_secuencia`);
    expect(chained.rows[0]).toEqual({ registros: 1, secuencia: 1, head_secuencia: 1 });
  });
});

describe("the provisioned admin authenticates by id with its password", () => {
  it("loginManagerById succeeds with the provisioned password and rejects a wrong one", async () => {
    // `venue` seeds the admin's password but NO email, so the email-based dashboard login
    // (`loginManager`) has no address to resolve. The emailless admin authenticates by id via
    // `loginManagerById` — the same path the C2b mirror-bundle route uses to adopt from the primary.
    // A distinct obligado (B33333333) so this test's admin is its own (the PGlite suite shares one
    // database).
    const venue = await applyVenue(planVenue(request("B33333333")), { db: suite.db });

    // The admin's id is generated at seed time, so fetch it by tenant + role rather than assume one.
    const admin = await suite.db.execute<{ id: string }>(sql`
      select id from persons where tenant_id = ${venue.tenantId} and role = 'admin'`);
    const personId = admin.rows[0]?.id;
    expect(personId).toBeDefined();

    // The provisioned password logs in and mints a management session — run as the app role under the
    // tenant (asAppUser), the same role constraints production's login runs under, so this also proves
    // app_user can SELECT the seeded password_hash and INSERT the management session.
    const session = await withTenant(suite.db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return loginManagerById(tx, {
        tenantId: venue.tenantId,
        personId: personId!,
        password: "dashPass123",
      });
    });
    expect(session.personId).toBe(personId);

    // Negative control: a wrong password is refused, so the positive case above is not a rubber stamp.
    await expect(
      withTenant(suite.db, venue.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManagerById(tx, {
          tenantId: venue.tenantId,
          personId: personId!,
          password: "wrongpass1",
        });
      }),
    ).rejects.toMatchObject({ code: "password.invalid" });
  });
});

describe("the onboarding-provisioned admin authenticates by email", () => {
  it("loginManager (the email path) succeeds with the provisioned email + password and rejects a wrong one", async () => {
    // The whole-chain proof for admin-email onboarding: an admin provisioned WITH an email
    // (captured by the onboarding UI, validated + normalized at the setup-api boundary, written by
    // `applyVenue`'s seed-admin insert) can sign in to the dashboard by EMAIL via `loginManager` —
    // not only by id via `loginManagerById`. A valid, already-normalized lowercase address, as the
    // setup-api boundary produces. A distinct obligado (B44444444) so this admin is its own in the
    // shared PGlite database.
    const adminEmail = "owner@venue.example";
    const venue = await applyVenue(planVenue(request("B44444444", adminEmail)), { db: suite.db });

    // The admin's id is generated at seed time; fetch it so we can prove the email login resolves the
    // SAME provisioned admin, not just some person.
    const admin = await suite.db.execute<{ id: string }>(sql`
      select id from persons where tenant_id = ${venue.tenantId} and role = 'admin'`);
    const personId = admin.rows[0]?.id;
    expect(personId).toBeDefined();

    // The email path mints a management session for the provisioned admin — run as the app role under
    // the tenant (asAppUser), the same role constraints production's login runs under.
    const session = await withTenant(suite.db, venue.tenantId, async (tx) => {
      await asAppUser(tx);
      return loginManager(tx, {
        tenantId: venue.tenantId,
        email: adminEmail,
        password: "dashPass123",
      });
    });
    expect(session.personId).toBe(personId);

    // Negative control: a wrong password is refused, so the positive case above is not a rubber stamp.
    await expect(
      withTenant(suite.db, venue.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManager(tx, {
          tenantId: venue.tenantId,
          email: adminEmail,
          password: "wrongpass1",
        });
      }),
    ).rejects.toMatchObject({ code: "password.invalid" });
  });
});
