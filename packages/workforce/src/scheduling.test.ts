import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend } from "./clocking.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  insertDraftShift,
  insertRosterVersion,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

// PGlite, not real Postgres: publishRoster is LOGIC over mutable planning rows (flip status, stamp,
// attach shifts) — there is no privilege set and no RLS decision to prove here. The app role's exact
// grants on shifts/roster_versions (that they CAN be UPDATEd/DELETEd, the inverse of time_entries'
// append-only floor) are proven against real Postgres in scheduling.rls.test.ts, not re-proven here.
const backend = new WorkforceBackend();

let tenantId: string;
let locationId: string;
let personId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
    personId = await seedPerson(db, tenantId);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

async function attachedVersion(shiftId: string): Promise<string | null> {
  const rows = await suite.db.execute<{ roster_version_id: string | null }>(
    sql`select roster_version_id from shifts where id = ${shiftId}`,
  );
  return rows.rows[0]!.roster_version_id;
}

describe("publishRoster", () => {
  it("flips a draft version to published, stamps published_at and published_by, and attaches its in-period shift", async () => {
    const versionId = await insertRosterVersion(suite.db, { tenantId, locationId });
    const shiftId = await insertDraftShift(suite.db, { tenantId, personId, locationId });

    await run((tx) =>
      backend.publishRoster(tx, { tenantId, versionId, publishedByPersonId: personId }),
    );

    const version = await suite.db.execute<{
      status: string;
      published_at: string | null;
      published_by_person_id: string | null;
    }>(sql`
      select status, published_at, published_by_person_id
      from roster_versions where id = ${versionId}`);
    expect(version.rows[0]!.status).toBe("published");
    expect(version.rows[0]!.published_at).not.toBeNull();
    expect(version.rows[0]!.published_by_person_id).toBe(personId);

    // The draft shift is attached — its roster_version_id, null while a draft, now names the version.
    expect(await attachedVersion(shiftId)).toBe(versionId);
  });

  it("attaches only same-location, in-period draft shifts (the predicates are not vacuous)", async () => {
    // Period 2–8 March; three draft shifts differing in exactly one attribute each. Also the
    // published_by-omitted path — publishedByPersonId is left off here, covering the null branch.
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
    });
    const otherLocation = await seedLocation(suite.db, tenantId);

    const inPeriod = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });
    const outOfPeriod = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-04-01T09:00:00Z",
      endsAt: "2026-04-01T17:00:00Z",
    });
    const wrongLocation = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId: otherLocation,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });

    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));

    expect(await attachedVersion(inPeriod)).toBe(versionId);
    expect(await attachedVersion(outOfPeriod)).toBeNull();
    expect(await attachedVersion(wrongLocation)).toBeNull();
  });

  it("matches a shift by its LOCAL wall date, not its UTC instant", async () => {
    // starts_at 2026-03-01T23:30Z with a +120 wall offset is local 2026-03-02T01:30 — inside a period
    // that begins 2026-03-02, even though the UTC date (03-01) is before it. Proves publishRoster
    // resolves the local date via the offset, not the raw instant.
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
    });
    const shiftId = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-03-01T23:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-03-02T05:30:00Z",
      endsOffsetMinutes: 120,
    });

    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));

    expect(await attachedVersion(shiftId)).toBe(versionId);
  });

  it("throws roster.not_found for a version that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) => backend.publishRoster(tx, { tenantId, versionId: crypto.randomUUID() })),
    );
    expect(code).toBe("roster.not_found");
  });

  it("throws roster.already_published when republishing a published version", async () => {
    // The guard: publishing twice is refused. Prove by deletion — remove the status check in
    // publishRoster and this stops throwing (the second publish silently re-stamps instead).
    const versionId = await insertRosterVersion(suite.db, { tenantId, locationId });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));

    const code = await codeOfRejection(() =>
      run((tx) => backend.publishRoster(tx, { tenantId, versionId })),
    );
    expect(code).toBe("roster.already_published");
  });
});
