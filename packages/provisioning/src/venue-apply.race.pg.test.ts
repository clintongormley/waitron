// Real PostgreSQL, two live connections. PGlite is a false pass here: every query on it serialises
// onto one backend, so two "concurrent" transactions never actually overlap (CLAUDE.md §4).
//
// What this file pins is one step: how `applyVenue` reaches the single taxpayer row when two plans
// overlap. That row is what holds the loser back, and it does the job two different ways depending on
// whether the row is there yet — the first two cases below start from a virgin database, the third
// from a database whose taxpayer is already committed.
//
// On a virgin database the step used to read the row `for update` and insert
// it when the read came back empty — which serialises nothing at all, because a row that does not
// exist cannot be locked. Both plans read zero rows, both inserted, and the loser died with a raw
// `23505` on one of the taxpayer row's keys: a driver error naming a constraint, which is precisely
// what an operator cannot act on. Writing FIRST, with an unarbitered `on conflict do nothing`, is
// what makes the loser wait for the winner's commit and then read what the winner wrote. Unarbitered
// because naming `id` would absorb only the key it names: two plans carrying the same country and
// tax id clash on `tenants_country_tax_id_key` first, which is the failure the first case below
// reports when the fix is reverted.
//
// Measured, both ways: with the `for update`-then-insert shape restored, the first case below reports
// a rejection carrying `23505 / tenants_country_tax_id_key` and the second `23505 / tenants_pkey`.
//
// The read-back that follows the insert is itself `for update`, and that is what the third case
// pins. The insert serialises nothing once the taxpayer row is committed — it conflicts with no
// uncommitted tuple and returns at once — so without that lock two plans run the whole venue side by
// side and one dies on `23505 / persons_tenant_email_uq` at `seed-admin`.
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
const EXISTING_TAXPAYER_DB = "waitron_venue_race_existing";

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

/** Every driver failure among the settled results, whatever constraint it names. */
function driverFailures(settled: PromiseSettledResult<unknown>[]): unknown[] {
  return settled
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => driverFailure(r.reason))
    .filter((f) => f.code !== undefined);
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
    for (const name of [SAME_IDENTITY_DB, OTHER_IDENTITY_DB, EXISTING_TAXPAYER_DB]) {
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

  it("the taxpayer already committed: the second plan waits for the first, it does not race it", async () => {
    // The two cases above both start from a virgin database, where the taxpayer INSERT is itself the
    // thing that blocks: the loser's insert waits on the winner's uncommitted row, and therefore on
    // the winner's whole transaction. When the taxpayer row is already committed that insert conflicts
    // with nothing, returns at once, and the two plans run the rest of the venue side by side. Seeding
    // the row up front is what puts this case on the other side of that difference — it is the shape a
    // re-provision of a database that already has a taxpayer takes.
    //
    // Measured on postgres:18-alpine with the lock taken out: one call fulfilled and the other
    // rejected with `23505 / persons_tenant_email_uq`, because both plans read no admin at
    // `seed-admin`'s `where not exists` and both inserted one.
    const uri = withDatabase(pg.uri, EXISTING_TAXPAYER_DB);
    const first = await createPostgresDb(uri);
    const second = await createPostgresDb(uri);
    try {
      await first.execute(sql`
        insert into tenants (id, country, tax_id, legal_name)
        values (1, 'ES', 'B12345678', 'Deli SL')`);
      const plan = planVenue(venueRequest("B12345678"), ALL_MODULES);
      const settled = await Promise.allSettled([
        applyVenue(plan, { db: first, modules: ALL_MODULES }),
        applyVenue(plan, { db: second, modules: ALL_MODULES }),
      ]);

      // No driver error at all, not just no `tenants_*` one: the failure this case was written for
      // names a `persons` key, and a check narrowed to the taxpayer's own keys cannot see it.
      expect(driverFailures(settled)).toEqual([]);
      expect(settled.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      // Serialised means the loser REUSED what the winner wrote: one venue, one admin, and both
      // calls answering with the same ids.
      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof applyVenue>>> =>
          r.status === "fulfilled",
      );
      expect(fulfilled[1]!.value.locationId).toBe(fulfilled[0]!.value.locationId);
      expect(fulfilled[1]!.value.tillId).toBe(fulfilled[0]!.value.tillId);
      expect(fulfilled[1]!.value.nodeId).toBe(fulfilled[0]!.value.nodeId);

      const counts = await first.execute<{ admins: number; locations: number; nodes: number }>(sql`
        select (select count(*)::int from persons where role = 'admin') as admins,
               (select count(*)::int from locations) as locations,
               (select count(*)::int from nodes) as nodes`);
      expect(counts.rows).toEqual([{ admins: 1, locations: 1, nodes: 1 }]);
    } finally {
      await first.close();
      await second.close();
    }
  }, 120_000);
});
