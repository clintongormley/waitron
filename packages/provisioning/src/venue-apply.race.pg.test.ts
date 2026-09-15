// Real PostgreSQL, two live connections. PGlite is a false pass here: every query on it serialises
// onto one backend, so two "concurrent" transactions never actually overlap (CLAUDE.md §4).
//
// What this file pins is one step: how `applyVenue` writes the single taxpayer row when two plans
// reach a virgin database at the same moment. That step used to read the row `for update` and insert
// it when the read came back empty — which serialises nothing at all, because a row that does not
// exist cannot be locked. Both plans read zero rows, both inserted, and the loser died with a raw
// `23505` on one of the taxpayer row's keys: a driver error naming a constraint, which is precisely
// what an operator cannot act on. Writing FIRST, with an unarbitered `on conflict do nothing`, is
// what makes the loser wait for the winner's commit and then read what the winner wrote. Unarbitered
// because naming `id` would absorb only the key it names: two plans carrying the same country and
// tax id clash on `tenants_country_tax_id_key` first, which is the failure the first case below
// reports when the fix is reverted.
//
// Measured, both ways: with the `for update` shape restored, the first case below reports a rejection
// carrying `23505 / tenants_country_tax_id_key` and the second `23505 / tenants_pkey`.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withDatabase } from "./instance-apply.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { startBarePostgres, type RealPostgres } from "./testing/postgres.js";

/** One database per case: each case needs a VIRGIN one, and nothing resets a bare container. */
const SAME_IDENTITY_DB = "waitron_venue_race_same";
const OTHER_IDENTITY_DB = "waitron_venue_race_other";

function venueRequest(taxId: string): VenueRequest {
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
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
}

/** Walk an error's `cause` chain for a driver SQLSTATE and the constraint it names. A domain
 * `AppError` has no five-digit `code`, so it comes back empty — which is the answer we want. */
function driverFailure(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current !== null && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^\d{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint === "string" ? { constraint: candidate.constraint } : {}),
      };
    }
    current = candidate.cause;
  }
  return {};
}

/** Every driver failure among the settled results that names one of the taxpayer row's keys. */
function taxpayerKeyFailures(settled: PromiseSettledResult<unknown>[]): unknown[] {
  return settled
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => driverFailure(r.reason))
    .filter((f) => f.constraint?.startsWith("tenants_") === true);
}

describe("applyVenue: two concurrent first provisions", () => {
  let pg: RealPostgres;
  let admin: Database;

  beforeAll(async () => {
    pg = await startBarePostgres();
    admin = await createPostgresDb(pg.uri);
    for (const name of [SAME_IDENTITY_DB, OTHER_IDENTITY_DB]) {
      await admin.execute(sql.raw(`create database "${name}"`));
      await applyMigrations(withDatabase(pg.uri, name), migrationOptionsFor(manifestSets(), null));
    }
  }, 300_000);

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  it("the same taxpayer twice at once: neither plan dies on a taxpayer key", async () => {
    // Two separate pools, so the two transactions really are on two backends at the same time.
    const uri = withDatabase(pg.uri, SAME_IDENTITY_DB);
    const first = await createPostgresDb(uri);
    const second = await createPostgresDb(uri);
    try {
      const plan = planVenue(venueRequest("B12345678"), ALL_MODULES);
      const settled = await Promise.allSettled([
        applyVenue(plan, { db: first, modules: ALL_MODULES }),
        applyVenue(plan, { db: second, modules: ALL_MODULES }),
      ]);

      // Whichever plan loses may still fail further down the venue — both read an empty `locations`
      // before either commits, which is a separate race this file does not claim to fix. What it
      // must never do is fail on a `tenants_*` key, because that is the unactionable driver error.
      expect(taxpayerKeyFailures(settled)).toEqual([]);
      expect(settled.some((r) => r.status === "fulfilled")).toBe(true);

      const taxpayers = await first.execute<{ n: number; tax_id: string }>(
        sql`select count(*)::int as n, min(tax_id) as tax_id from tenants`,
      );
      expect(taxpayers.rows).toEqual([{ n: 1, tax_id: "B12345678" }]);
    } finally {
      await first.close();
      await second.close();
    }
  }, 120_000);

  it("two different taxpayers at once: the loser is refused BY NAME, not by the primary key", async () => {
    const uri = withDatabase(pg.uri, OTHER_IDENTITY_DB);
    const first = await createPostgresDb(uri);
    const second = await createPostgresDb(uri);
    try {
      const settled = await Promise.allSettled([
        applyVenue(planVenue(venueRequest("B11111111"), ALL_MODULES), {
          db: first,
          modules: ALL_MODULES,
        }),
        applyVenue(planVenue(venueRequest("B22222222"), ALL_MODULES), {
          db: second,
          modules: ALL_MODULES,
        }),
      ]);

      expect(taxpayerKeyFailures(settled)).toEqual([]);
      expect(settled.some((r) => r.status === "fulfilled")).toBe(true);
      // The loser read the winner's row and refused by name — the domain code, never a driver error.
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        code: "provisioning.tenant_identity_mismatch",
      });

      const taxpayers = await first.execute<{ n: number }>(
        sql`select count(*)::int as n from tenants`,
      );
      expect(taxpayers.rows).toEqual([{ n: 1 }]);
    } finally {
      await first.close();
      await second.close();
    }
  }, 120_000);
});
