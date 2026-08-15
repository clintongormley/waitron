import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend } from "./clocking.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  insertDraftShift,
  insertRosterVersion,
  makeRuleset,
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
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
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

  it("supersedes the prior published version when a newer version for the same period is published", async () => {
    // The mutable + supersede model: at most one published version per (location, EXACT period).
    // Publishing v2 for the SAME period as an already-published v1 demotes v1 to `superseded` and
    // leaves v2 the sole published version. Prove by deletion: remove the supersede step (the
    // `supersedePriorPublished` call) in publishRoster and v1 is never demoted — the partial unique
    // index roster_versions_published_period_uq then rejects v2's publish (roster.period_already_published)
    // instead, so this test fails whichever way the supersede is broken.
    const period = { periodStart: "2026-02-02", periodEnd: "2026-02-08" };
    const v1 = await insertRosterVersion(suite.db, { tenantId, locationId, ...period });
    const v2 = await insertRosterVersion(suite.db, { tenantId, locationId, ...period });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId: v1 }));
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId: v2 }));

    const rows = await suite.db.execute<{ id: string; status: string }>(sql`
      select id, status from roster_versions
      where tenant_id = ${tenantId} and location_id = ${locationId}
        and period_start = ${period.periodStart} and period_end = ${period.periodEnd}`);
    const byId = new Map(rows.rows.map((r) => [r.id, r.status]));
    expect(byId.get(v1)).toBe("superseded");
    expect(byId.get(v2)).toBe("published");
    expect(rows.rows.filter((r) => r.status === "published")).toHaveLength(1);
  });

  it("supersedes only the SAME exact period — a version for a different period stays published", async () => {
    // The supersede is scoped to the exact (location, period_start, period_end), not to the location.
    // Publishing v2 for period P2 must leave v1 (period P1, same location) published. Distinct periods
    // that no other test in this shared-DB suite touches, so the two published rows never collide.
    const p1 = { periodStart: "2026-04-13", periodEnd: "2026-04-19" };
    const p2 = { periodStart: "2026-04-20", periodEnd: "2026-04-26" };
    const v1 = await insertRosterVersion(suite.db, { tenantId, locationId, ...p1 });
    const v2 = await insertRosterVersion(suite.db, { tenantId, locationId, ...p2 });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId: v1 }));
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId: v2 }));

    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from roster_versions where id = ${v1}`,
    );
    expect(rows.rows[0]!.status).toBe("published");
  });

  it("returns the guardrail breaches when a ruleset is supplied, and PUBLISHES anyway (advisory)", async () => {
    // OWNER DECISION: guardrail breaches are advisory. A roster that breaches a limit still publishes;
    // the breaches are surfaced in the return value, never thrown. Two shifts 8h apart breach the
    // 12h (720-min) inter-shift rest — publishRoster must report that and flip the version regardless.
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
    });
    await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
    });
    await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-01-06T01:00:00Z", // 8h after the first shift's 17:00 end — under the 12h floor
      endsAt: "2026-01-06T09:00:00Z",
    });

    const breaches = await run((tx) =>
      backend.publishRoster(tx, {
        tenantId,
        versionId,
        ruleset: makeRuleset({ minInterShiftRestMinutes: 720 }),
      }),
    );

    expect(breaches.some((b) => b.kind === "rest_too_short")).toBe(true);
    const version = await suite.db.execute<{ status: string }>(
      sql`select status from roster_versions where id = ${versionId}`,
    );
    expect(version.rows[0]!.status).toBe("published"); // published despite the breach
  });

  it("returns no breaches when no ruleset is supplied (guardrails are opt-in on publish)", async () => {
    const versionId = await insertRosterVersion(suite.db, { tenantId, locationId });
    await insertDraftShift(suite.db, { tenantId, personId, locationId });
    const breaches = await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    expect(breaches).toEqual([]);
  });

  it("detaches — never deletes — a shift when its roster version is deleted (ON DELETE set null)", async () => {
    // Planning data is discardable: deleting a version SET NULLs the attached shifts' roster_version_id
    // rather than blocking (restrict) or cascading the shifts away. Attach via publish, delete the
    // version, then assert the shift row SURVIVES with roster_version_id back to null. Changing the FK
    // to `restrict` fails the delete here; changing it to `cascade` fails the survives-assertion.
    const versionId = await insertRosterVersion(suite.db, { tenantId, locationId });
    const shiftId = await insertDraftShift(suite.db, { tenantId, personId, locationId });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    expect(await attachedVersion(shiftId)).toBe(versionId);

    await suite.db.execute(sql`delete from roster_versions where id = ${versionId}`);

    const rows = await suite.db.execute<{ id: string; roster_version_id: string | null }>(
      sql`select id, roster_version_id from shifts where id = ${shiftId}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.roster_version_id).toBeNull();
  });
});

describe("createRosterVersion", () => {
  it("inserts a draft for the week (period_start = the Monday, period_end = +6 days) and returns its id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-02" }),
    );
    const row = await suite.db.execute<{
      status: string;
      period_start: string;
      period_end: string;
      published_at: string | null;
    }>(sql`select status, period_start, period_end, published_at
           from roster_versions where id = ${versionId}`);
    expect(row.rows[0]!.status).toBe("draft");
    expect(row.rows[0]!.period_start).toBe("2026-03-02");
    expect(row.rows[0]!.period_end).toBe("2026-03-08");
    expect(row.rows[0]!.published_at).toBeNull();
  });

  it("refuses a second draft for the same (tenant, location, week) — roster.draft_exists", async () => {
    await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-09" }),
    );
    const code = await codeOfRejection(() =>
      run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-09" })),
    );
    expect(code).toBe("roster.draft_exists");
  });

  it("allows a draft for a DIFFERENT week at the same location", async () => {
    await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-16" }),
    );
    const other = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-03-23" }),
    );
    expect(other).toEqual(expect.any(String));
  });

  it("normalizes a non-Monday period to that week's Monday (no mid-week rosters)", async () => {
    // A date picker (or a direct API caller) can hand any day of the week. The engine snaps it to the
    // canonical Monday so the roster is a whole Mon–Sun week, never a mid-week Wed–Tue one.
    const versionId = await run(
      (tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-11-04" }), // a Wednesday
    );
    const row = await suite.db.execute<{ period_start: string; period_end: string }>(
      sql`select period_start, period_end from roster_versions where id = ${versionId}`,
    );
    expect(row.rows[0]!.period_start).toBe("2026-11-02"); // that week's Monday
    expect(row.rows[0]!.period_end).toBe("2026-11-08"); // the inclusive Sunday
  });

  it("refuses a second draft for two DIFFERENT non-Monday days in the SAME week — roster.draft_exists", async () => {
    // The duplicate-draft hole: without normalization the draft_exists guard keys on the exact
    // period_start, so two different mid-week days would each fork a draft for one calendar week.
    // Normalized, both map to the same Monday and the second collides.
    await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-11-11" }),
    ); // Wednesday
    const code = await codeOfRejection(() =>
      run((tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-11-12" })),
    ); // Thursday, same week
    expect(code).toBe("roster.draft_exists");
  });
});

describe("getRoster / getRosterVersion", () => {
  it("returns the draft version and its attached shifts for the week", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-04-06" }),
    );
    const shiftId = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-04-06T09:00:00Z",
      endsAt: "2026-04-06T17:00:00Z",
      rosterVersionId: versionId,
    });
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-04-06" }),
    );
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("draft");
    expect(snapshot.shifts.map((s) => s.id)).toEqual([shiftId]);
    expect(snapshot.shifts[0]!.startsAt).toBe("2026-04-06T09:00:00Z");
  });

  it("getRoster with a non-Monday day returns the same week's roster (normalized)", async () => {
    // getRoster must snap to the same canonical Monday createRosterVersion does, or a non-Monday query
    // (from a date picker) would miss the week's draft and report an empty grid.
    const versionId = await run(
      (tx) => backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-11-16" }), // Monday
    );
    const snapshot = await run(
      (tx) => backend.getRoster(tx, { tenantId, locationId, period: "2026-11-18" }), // Wednesday, same week
    );
    expect(snapshot.version?.id).toBe(versionId);
  });

  it("returns { version: null, shifts: [] } for a week with no roster", async () => {
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-05-04" }),
    );
    expect(snapshot).toEqual({ version: null, shifts: [] });
  });

  it("falls back to the PUBLISHED version when there is no draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-07",
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    const snapshot = await run((tx) =>
      backend.getRoster(tx, { tenantId, locationId, period: "2026-06-01" }),
    );
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("published");
  });

  it("getRosterVersion returns the row, or throws roster.not_found for an unknown id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-07-06" }),
    );
    const row = await run((tx) => backend.getRosterVersion(tx, { tenantId, versionId }));
    expect(row.locationId).toBe(locationId);
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.getRosterVersion(tx, {
          tenantId,
          versionId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    );
    expect(code).toBe("roster.not_found");
  });
});

describe("addShift", () => {
  function shiftInput(
    versionId: string,
    overrides: Partial<import("./clocking.js").AddShiftInput> = {},
  ) {
    return {
      tenantId,
      versionId,
      personId,
      locationId,
      startsAt: "2026-08-03T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-08-03T17:00:00Z",
      endsOffsetMinutes: 0,
      role: null,
      ...overrides,
    };
  }

  it("inserts a shift attached to the draft version and returns its id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-08-03" }),
    );
    const shiftId = await run((tx) => backend.addShift(tx, shiftInput(versionId, { role: "bar" })));
    const row = await suite.db.execute<{ roster_version_id: string; role: string | null }>(
      sql`select roster_version_id, role from shifts where id = ${shiftId}`,
    );
    expect(row.rows[0]!.roster_version_id).toBe(versionId);
    expect(row.rows[0]!.role).toBe("bar");
  });

  it("rejects a version that does not exist — roster.not_found", async () => {
    const code = await codeOfRejection(() =>
      run((tx) => backend.addShift(tx, shiftInput("00000000-0000-0000-0000-000000000000"))),
    );
    expect(code).toBe("roster.not_found");
  });

  it("rejects a PUBLISHED version — roster.not_draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    const code = await codeOfRejection(() =>
      run((tx) => backend.addShift(tx, shiftInput(versionId))),
    );
    expect(code).toBe("roster.not_draft");
  });

  it("rejects a non-positive interval (starts >= ends) — shift.invalid", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-08-17" }),
    );
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.addShift(
          tx,
          shiftInput(versionId, {
            startsAt: "2026-08-17T17:00:00Z",
            endsAt: "2026-08-17T09:00:00Z",
          }),
        ),
      ),
    );
    expect(code).toBe("shift.invalid");
  });

  it("rejects an UNPARSEABLE startsAt/endsAt — shift.invalid, not a driver 22007", async () => {
    // Defense in depth: the engine verb is a public @waitron/workforce API and must honour its own
    // contract even though the route also screens this. `Date.parse` of a non-timestamp is NaN and the
    // `NaN >= NaN` interval guard is false, so without the explicit NaN check the bad value reaches the
    // `timestamptz` column as a driver error instead of `shift.invalid`.
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period: "2026-10-05" }),
    );
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.addShift(tx, shiftInput(versionId, { startsAt: "not-a-timestamp" }))),
      ),
    ).toBe("shift.invalid");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.addShift(tx, shiftInput(versionId, { endsAt: "not-a-timestamp" }))),
      ),
    ).toBe("shift.invalid");
  });
});

describe("updateShift / removeShift", () => {
  async function draftShift(period: string): Promise<{ versionId: string; shiftId: string }> {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { tenantId, locationId, period }),
    );
    const shiftId = await run((tx) =>
      backend.addShift(tx, {
        tenantId,
        versionId,
        personId,
        locationId,
        startsAt: `${period}T09:00:00Z`,
        startsOffsetMinutes: 0,
        endsAt: `${period}T17:00:00Z`,
        endsOffsetMinutes: 0,
        role: null,
      }),
    );
    return { versionId, shiftId };
  }

  it("edits a shift's times and role", async () => {
    const { shiftId } = await draftShift("2026-09-07");
    await run((tx) =>
      backend.updateShift(tx, {
        tenantId,
        shiftId,
        endsAt: "2026-09-07T15:00:00Z",
        role: "kitchen",
      }),
    );
    const row = await suite.db.execute<{ ends_at: string; role: string | null }>(sql`
      select to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at, role
      from shifts where id = ${shiftId}`);
    expect(row.rows[0]!.ends_at).toBe("2026-09-07T15:00:00Z");
    expect(row.rows[0]!.role).toBe("kitchen");
  });

  it("rejects an UNPARSEABLE startsAt/endsAt patch — shift.invalid (whichever field is present)", async () => {
    // Same engine-contract hole as addShift: a partial edit carrying an unparseable instant must be
    // `shift.invalid`, not a driver 22007 from the `timestamptz` column. Only the patched field is
    // NaN — the effective interval mixes it with the shift's (always-parseable) stored value.
    const { shiftId } = await draftShift("2026-10-12");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { tenantId, shiftId, startsAt: "not-a-timestamp" })),
      ),
    ).toBe("shift.invalid");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { tenantId, shiftId, endsAt: "bogus" })),
      ),
    ).toBe("shift.invalid");
  });

  it("removes a shift", async () => {
    const { shiftId } = await draftShift("2026-09-14");
    await run((tx) => backend.removeShift(tx, { tenantId, shiftId }));
    const row = await suite.db.execute(sql`select id from shifts where id = ${shiftId}`);
    expect(row.rows).toEqual([]);
  });

  it("rejects an unknown shift — shift.not_found (both verbs)", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { tenantId, shiftId: missing, role: "x" })),
      ),
    ).toBe("shift.not_found");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.removeShift(tx, { tenantId, shiftId: missing })),
      ),
    ).toBe("shift.not_found");
  });

  it("rejects editing/removing a shift whose version is PUBLISHED — roster.not_draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      tenantId,
      locationId,
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
    });
    const shiftId = await insertDraftShift(suite.db, {
      tenantId,
      personId,
      locationId,
      startsAt: "2026-09-21T09:00:00Z",
      endsAt: "2026-09-21T17:00:00Z",
      rosterVersionId: versionId,
    });
    await run((tx) => backend.publishRoster(tx, { tenantId, versionId }));
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { tenantId, shiftId, role: "x" })),
      ),
    ).toBe("roster.not_draft");
    expect(
      await codeOfRejection(() => run((tx) => backend.removeShift(tx, { tenantId, shiftId }))),
    ).toBe("roster.not_draft");
  });
});
