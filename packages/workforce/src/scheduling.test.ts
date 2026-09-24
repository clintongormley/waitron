import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend } from "./clocking.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  insertDraftShift,
  insertRosterVersion,
  insertTimeEntry,
  makeRuleset,
  seedLocation,
  seedPerson,
} from "../test/fixtures.js";

const backend = new WorkforceBackend();

let locationId: string;
let personId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    personId = await seedPerson(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
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
    const versionId = await insertRosterVersion(suite.db, { locationId });
    const shiftId = await insertDraftShift(suite.db, { personId, locationId });

    await run((tx) => backend.publishRoster(tx, { versionId, publishedByPersonId: personId }));

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

    expect(await attachedVersion(shiftId)).toBe(versionId);
  });

  it("attaches only same-location, in-period draft shifts (the predicates are not vacuous)", async () => {
    // Three draft shifts differing in exactly one attribute each. publishedByPersonId is omitted here.
    const versionId = await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
    });
    const otherLocation = await seedLocation(suite.db);

    const inPeriod = await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });
    const outOfPeriod = await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-04-01T09:00:00Z",
      endsAt: "2026-04-01T17:00:00Z",
    });
    const wrongLocation = await insertDraftShift(suite.db, {
      personId,
      locationId: otherLocation,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });

    await run((tx) => backend.publishRoster(tx, { versionId }));

    expect(await attachedVersion(inPeriod)).toBe(versionId);
    expect(await attachedVersion(outOfPeriod)).toBeNull();
    expect(await attachedVersion(wrongLocation)).toBeNull();
  });

  it("matches a shift by its LOCAL wall date, not its UTC instant", async () => {
    // 23:30Z at +120 is local 03-02, inside the period, though the UTC date is 03-01.
    const versionId = await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-03-02",
      periodEnd: "2026-03-08",
    });
    const shiftId = await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-03-01T23:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-03-02T05:30:00Z",
      endsOffsetMinutes: 120,
    });

    await run((tx) => backend.publishRoster(tx, { versionId }));

    expect(await attachedVersion(shiftId)).toBe(versionId);
  });

  it("throws roster.not_found for a version that does not exist", async () => {
    const code = await codeOfRejection(() =>
      run((tx) => backend.publishRoster(tx, { versionId: crypto.randomUUID() })),
    );
    expect(code).toBe("roster.not_found");
  });

  it("throws roster.already_published when republishing a published version", async () => {
    const versionId = await insertRosterVersion(suite.db, { locationId });
    await run((tx) => backend.publishRoster(tx, { versionId }));

    const code = await codeOfRejection(() => run((tx) => backend.publishRoster(tx, { versionId })));
    expect(code).toBe("roster.already_published");
  });

  it("supersedes the prior published version when a newer version for the same period is published", async () => {
    const period = { periodStart: "2026-02-02", periodEnd: "2026-02-08" };
    const v1 = await insertRosterVersion(suite.db, { locationId, ...period });
    const v2 = await insertRosterVersion(suite.db, { locationId, ...period });
    await run((tx) => backend.publishRoster(tx, { versionId: v1 }));
    await run((tx) => backend.publishRoster(tx, { versionId: v2 }));

    const rows = await suite.db.execute<{ id: string; status: string }>(sql`
      select id, status from roster_versions
      where location_id = ${locationId}
        and period_start = ${period.periodStart} and period_end = ${period.periodEnd}`);
    const byId = new Map(rows.rows.map((r) => [r.id, r.status]));
    expect(byId.get(v1)).toBe("superseded");
    expect(byId.get(v2)).toBe("published");
    expect(rows.rows.filter((r) => r.status === "published")).toHaveLength(1);
  });

  it("supersedes only the SAME exact period — a version for a different period stays published", async () => {
    // Periods no other test in this shared-DB suite touches.
    const p1 = { periodStart: "2026-04-13", periodEnd: "2026-04-19" };
    const p2 = { periodStart: "2026-04-20", periodEnd: "2026-04-26" };
    const v1 = await insertRosterVersion(suite.db, { locationId, ...p1 });
    const v2 = await insertRosterVersion(suite.db, { locationId, ...p2 });
    await run((tx) => backend.publishRoster(tx, { versionId: v1 }));
    await run((tx) => backend.publishRoster(tx, { versionId: v2 }));

    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from roster_versions where id = ${v1}`,
    );
    expect(rows.rows[0]!.status).toBe("published");
  });

  it("returns the guardrail breaches when a ruleset is supplied, and PUBLISHES anyway (advisory)", async () => {
    // Guardrail breaches are advisory (owner decision): reported, never thrown. Two shifts 8h apart
    // breach the 12h inter-shift rest.
    const versionId = await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
    });
    await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
    });
    await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-01-06T01:00:00Z", // 8h after the first shift's 17:00 end — under the 12h floor
      endsAt: "2026-01-06T09:00:00Z",
    });

    const breaches = await run((tx) =>
      backend.publishRoster(tx, {
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
    const versionId = await insertRosterVersion(suite.db, { locationId });
    await insertDraftShift(suite.db, { personId, locationId });
    const breaches = await run((tx) => backend.publishRoster(tx, { versionId }));
    expect(breaches).toEqual([]);
  });

  it("detaches — never deletes — a shift when its roster version is deleted (ON DELETE set null)", async () => {
    // Planning data is discardable: the shift survives with roster_version_id back to null.
    const versionId = await insertRosterVersion(suite.db, { locationId });
    const shiftId = await insertDraftShift(suite.db, { personId, locationId });
    await run((tx) => backend.publishRoster(tx, { versionId }));
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
      backend.createRosterVersion(tx, { locationId, period: "2026-03-02" }),
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

  it("refuses a second draft for the same (location, week) — roster.draft_exists", async () => {
    await run((tx) => backend.createRosterVersion(tx, { locationId, period: "2026-03-09" }));
    const code = await codeOfRejection(() =>
      run((tx) => backend.createRosterVersion(tx, { locationId, period: "2026-03-09" })),
    );
    expect(code).toBe("roster.draft_exists");
  });

  it("allows a draft for a DIFFERENT week at the same location", async () => {
    await run((tx) => backend.createRosterVersion(tx, { locationId, period: "2026-03-16" }));
    const other = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-03-23" }),
    );
    expect(other).toEqual(expect.any(String));
  });

  it("normalizes a non-Monday period to that week's Monday (no mid-week rosters)", async () => {
    const versionId = await run(
      (tx) => backend.createRosterVersion(tx, { locationId, period: "2026-11-04" }), // a Wednesday
    );
    const row = await suite.db.execute<{ period_start: string; period_end: string }>(
      sql`select period_start, period_end from roster_versions where id = ${versionId}`,
    );
    expect(row.rows[0]!.period_start).toBe("2026-11-02"); // that week's Monday
    expect(row.rows[0]!.period_end).toBe("2026-11-08"); // the inclusive Sunday
  });

  it("refuses a second draft for two DIFFERENT non-Monday days in the SAME week — roster.draft_exists", async () => {
    // Without normalization the draft_exists guard keys on the exact period_start, so two mid-week
    // days would each fork a draft for one calendar week.
    await run((tx) => backend.createRosterVersion(tx, { locationId, period: "2026-11-11" })); // Wednesday
    const code = await codeOfRejection(() =>
      run((tx) => backend.createRosterVersion(tx, { locationId, period: "2026-11-12" })),
    ); // Thursday, same week
    expect(code).toBe("roster.draft_exists");
  });
});

describe("getRoster / getRosterVersion", () => {
  it("returns the draft version and its attached shifts for the week", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-04-06" }),
    );
    const shiftId = await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-04-06T09:00:00Z",
      endsAt: "2026-04-06T17:00:00Z",
      rosterVersionId: versionId,
    });
    const snapshot = await run((tx) => backend.getRoster(tx, { locationId, period: "2026-04-06" }));
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("draft");
    expect(snapshot.shifts.map((s) => s.id)).toEqual([shiftId]);
    expect(snapshot.shifts[0]!.startsAt).toBe("2026-04-06T09:00:00Z");
  });

  it("getRoster with a non-Monday day returns the same week's roster (normalized)", async () => {
    const versionId = await run(
      (tx) => backend.createRosterVersion(tx, { locationId, period: "2026-11-16" }), // Monday
    );
    const snapshot = await run(
      (tx) => backend.getRoster(tx, { locationId, period: "2026-11-18" }), // Wednesday, same week
    );
    expect(snapshot.version?.id).toBe(versionId);
  });

  it("returns { version: null, shifts: [] } for a week with no roster", async () => {
    const snapshot = await run((tx) => backend.getRoster(tx, { locationId, period: "2026-05-04" }));
    expect(snapshot).toEqual({ version: null, shifts: [] });
  });

  it("falls back to the PUBLISHED version when there is no draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-07",
    });
    await run((tx) => backend.publishRoster(tx, { versionId }));
    const snapshot = await run((tx) => backend.getRoster(tx, { locationId, period: "2026-06-01" }));
    expect(snapshot.version?.id).toBe(versionId);
    expect(snapshot.version?.status).toBe("published");
  });

  it("getRosterVersion returns the row, or throws roster.not_found for an unknown id", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-07-06" }),
    );
    const row = await run((tx) => backend.getRosterVersion(tx, { versionId }));
    expect(row.locationId).toBe(locationId);
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.getRosterVersion(tx, {
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
      backend.createRosterVersion(tx, { locationId, period: "2026-08-03" }),
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
      locationId,
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
    });
    await run((tx) => backend.publishRoster(tx, { versionId }));
    const code = await codeOfRejection(() =>
      run((tx) => backend.addShift(tx, shiftInput(versionId))),
    );
    expect(code).toBe("roster.not_draft");
  });

  it("rejects a non-positive interval (starts >= ends) — shift.invalid", async () => {
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-08-17" }),
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
    // `Date.parse` gives NaN and `NaN >= NaN` is false, so only an explicit NaN check refuses this.
    const versionId = await run((tx) =>
      backend.createRosterVersion(tx, { locationId, period: "2026-10-05" }),
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
    const versionId = await run((tx) => backend.createRosterVersion(tx, { locationId, period }));
    const shiftId = await run((tx) =>
      backend.addShift(tx, {
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
        shiftId,
        endsAt: "2026-09-07T15:00:00Z",
        role: "kitchen",
      }),
    );
    const row = await suite.db.execute<{ ends_at: string; role: string | null }>(sql`
      select ends_at, role
      from shifts where id = ${shiftId}`);
    expect(row.rows[0]!.ends_at).toBe("2026-09-07T15:00:00Z");
    expect(row.rows[0]!.role).toBe("kitchen");
  });

  it("rejects an UNPARSEABLE startsAt/endsAt patch — shift.invalid (whichever field is present)", async () => {
    // Only the patched field is NaN; the effective interval mixes it with the stored value.
    const { shiftId } = await draftShift("2026-10-12");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { shiftId, startsAt: "not-a-timestamp" })),
      ),
    ).toBe("shift.invalid");
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { shiftId, endsAt: "bogus" })),
      ),
    ).toBe("shift.invalid");
  });

  it("removes a shift", async () => {
    const { shiftId } = await draftShift("2026-09-14");
    await run((tx) => backend.removeShift(tx, { shiftId }));
    const row = await suite.db.execute(sql`select id from shifts where id = ${shiftId}`);
    expect(row.rows).toEqual([]);
  });

  it("rejects an unknown shift — shift.not_found (both verbs)", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect(
      await codeOfRejection(() =>
        run((tx) => backend.updateShift(tx, { shiftId: missing, role: "x" })),
      ),
    ).toBe("shift.not_found");
    expect(
      await codeOfRejection(() => run((tx) => backend.removeShift(tx, { shiftId: missing }))),
    ).toBe("shift.not_found");
  });

  it("rejects editing/removing a shift whose version is PUBLISHED — roster.not_draft", async () => {
    const versionId = await insertRosterVersion(suite.db, {
      locationId,
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
    });
    const shiftId = await insertDraftShift(suite.db, {
      personId,
      locationId,
      startsAt: "2026-09-21T09:00:00Z",
      endsAt: "2026-09-21T17:00:00Z",
      rosterVersionId: versionId,
    });
    await run((tx) => backend.publishRoster(tx, { versionId }));
    expect(
      await codeOfRejection(() => run((tx) => backend.updateShift(tx, { shiftId, role: "x" }))),
    ).toBe("roster.not_draft");
    expect(await codeOfRejection(() => run((tx) => backend.removeShift(tx, { shiftId })))).toBe(
      "roster.not_draft",
    );
  });
});

describe("getPlannedVsActual", () => {
  const week = { start: "2026-03-02", end: "2026-03-09" }; // Mon..Sun, half-open
  async function seedSession(
    person: string,
    loc: string,
    inAt: string,
    outAt: string,
  ): Promise<void> {
    const node = await seedNode(suite.db, brandLocationId(loc));
    await insertTimeEntry(suite.db, {
      nodeId: node,
      personId: person,
      locationId: loc,
      entryKind: "in",
      eventAt: inAt,
    });
    await insertTimeEntry(suite.db, {
      nodeId: node,
      personId: person,
      locationId: loc,
      entryKind: "out",
      eventAt: outAt,
    });
  }
  // `publishRoster` attaches every in-period null-version draft shift at `loc`.
  async function publishWeek(loc: string): Promise<void> {
    const versionId = await insertRosterVersion(suite.db, {
      locationId: loc,
      periodStart: week.start,
      periodEnd: "2026-03-08",
    });
    await run((tx) => backend.publishRoster(tx, { versionId }));
  }

  it("matches a PUBLISHED planned shift to its worked session, and reports late minutes", async () => {
    const loc = await seedLocation(suite.db);
    const p = await seedPerson(suite.db, `pva-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      personId: p,
      locationId: loc,
      startsAt: "2026-03-02T09:00:00Z",
      endsAt: "2026-03-02T13:00:00Z",
    });
    await publishWeek(loc); // the shift is now on a published version
    await seedSession(p, loc, "2026-03-02T09:15:00Z", "2026-03-02T13:00:00Z");
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { locationId: loc, period: week }),
    );
    const row = rows.find((r) => r.personId === p && r.workDate === "2026-03-02")!;
    expect(row.plannedMinutes).toBe(240);
    expect(row.workedMinutes).toBe(225);
    expect(row.lateMinutes).toBe(15);
    expect(row.noShow).toBe(false);
    expect(row.unplanned).toBe(false);
  });

  it("flags a no-show (published shift, not worked) and an unplanned day (worked, not planned)", async () => {
    const loc = await seedLocation(suite.db);
    const noShowPerson = await seedPerson(suite.db, `ns-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      personId: noShowPerson,
      locationId: loc,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });
    await publishWeek(loc);
    const unplannedPerson = await seedPerson(suite.db, `up-${crypto.randomUUID()}`);
    await seedSession(unplannedPerson, loc, "2026-03-04T09:00:00Z", "2026-03-04T12:00:00Z");
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { locationId: loc, period: week }),
    );
    const noShow = rows.find((r) => r.personId === noShowPerson)!;
    expect(noShow.noShow).toBe(true);
    expect(noShow.workedMinutes).toBe(0);
    const unplanned = rows.find((r) => r.personId === unplannedPerson)!;
    expect(unplanned.unplanned).toBe(true);
    expect(unplanned.plannedMinutes).toBe(0);
  });

  it("counts only the PUBLISHED version's shifts — excludes drafts and superseded versions", async () => {
    // "Planned" is the currently-published roster (owner decision), so a draft and a superseded
    // version must not manufacture phantom no-shows.
    const loc = await seedLocation(suite.db);
    const p = await seedPerson(suite.db, `pub-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      personId: p,
      locationId: loc,
      startsAt: "2026-03-02T09:00:00Z",
      endsAt: "2026-03-02T13:00:00Z",
    });
    await publishWeek(loc);
    // B supersedes A; publishWeek attaches only null-version shifts, so 03-02 stays on A.
    await insertDraftShift(suite.db, {
      personId: p,
      locationId: loc,
      startsAt: "2026-03-03T09:00:00Z",
      endsAt: "2026-03-03T17:00:00Z",
    });
    await publishWeek(loc);
    // Inserted after the last publish, so it stays a draft.
    await insertDraftShift(suite.db, {
      personId: p,
      locationId: loc,
      startsAt: "2026-03-04T09:00:00Z",
      endsAt: "2026-03-04T17:00:00Z",
    });
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { locationId: loc, period: week }),
    );
    const plannedDays = rows
      .filter((r) => r.personId === p && r.plannedMinutes > 0)
      .map((r) => r.workDate);
    expect(plannedDays).toEqual(["2026-03-03"]);
  });

  it("excludes a session whose local day is OUTSIDE the window, includes one inside", async () => {
    const loc = await seedLocation(suite.db);
    const p = await seedPerson(suite.db, `bound-${crypto.randomUUID()}`);
    // The widened fetch grabs the days either side of the window; the filter must drop them.
    await seedSession(p, loc, "2026-03-01T09:00:00Z", "2026-03-01T12:00:00Z");
    await seedSession(p, loc, "2026-03-08T09:00:00Z", "2026-03-08T12:00:00Z");
    await seedSession(p, loc, "2026-03-09T09:00:00Z", "2026-03-09T12:00:00Z");
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { locationId: loc, period: week }),
    );
    const days = rows.filter((r) => r.personId === p).map((r) => r.workDate);
    expect(days).toEqual(["2026-03-08"]);
  });

  it("scopes to the queried location — another location's published shifts and entries do not leak in", async () => {
    const loc = await seedLocation(suite.db);
    const other = await seedLocation(suite.db);
    const p = await seedPerson(suite.db, `scope-${crypto.randomUUID()}`);
    await insertDraftShift(suite.db, {
      personId: p,
      locationId: other,
      startsAt: "2026-03-05T09:00:00Z",
      endsAt: "2026-03-05T13:00:00Z",
    });
    await publishWeek(other);
    await seedSession(p, other, "2026-03-05T09:00:00Z", "2026-03-05T13:00:00Z");
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, { locationId: loc, period: week }),
    );
    expect(rows.filter((r) => r.personId === p)).toEqual([]);
  });

  it("returns [] for a window with no shifts and no sessions", async () => {
    const loc = await seedLocation(suite.db);
    const rows = await run((tx) =>
      backend.getPlannedVsActual(tx, {
        locationId: loc,
        period: { start: "2026-12-07", end: "2026-12-14" },
      }),
    );
    expect(rows).toEqual([]);
  });
});
