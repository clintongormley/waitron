import { CORE_MIGRATIONS, captureError, newId, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";

const backend = new WorkforceBackend();

let locationId: string;
let nodeId: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    nodeId = await seedNode(db, brandLocationId(locationId));
  },
});

function event(personId: string, at: string): ClockEventInput {
  return { nodeId, personId, locationId, at, offsetMinutes: 0 };
}

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

/** Clocks a 09:00→17:00 day for a fresh person and returns their id plus the `out` entry's id. */
async function nineToFive(name: string): Promise<{ personId: string; outEntryId: string }> {
  const personId = await seedPerson(suite.db, name);
  await run((tx) => backend.clockIn(tx, event(personId, "2026-01-05T09:00:00Z")));
  await run((tx) => backend.clockOut(tx, event(personId, "2026-01-05T17:00:00Z")));
  const rows = await suite.db.execute<{ id: string }>(sql`
    select id from time_entries where person_id = ${personId} and entry_kind = 'out'`);
  return { personId, outEntryId: rows.rows[0]!.id };
}

/** Through the table definition for the same reason as `seedPerson`. */
async function supervisor(name: string): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: name, pinHash: "scrypt$00$00", role: "supervisor" })
    .returning({ id: persons.id });
  return row!.id;
}

/**
 * Inserts an APPROVED correction directly: two chains each holding an approved correction of ONE
 * target is a state `approveCorrection` refuses to reach, since it allows one approval per target.
 * The hashes are placeholders; the projection never reads them.
 */
async function insertApprovedCorrection(row: {
  node: string;
  correctsEntryId: string;
  personId: string;
  actorId: string;
  eventAt: string;
  recordedAt: string;
  sequenceNo: number;
}): Promise<void> {
  // Raw, with `id` supplied, because this is a row the chain append path would never write.
  await suite.db.execute(sql`
    insert into time_entries (
      id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
      recorded_by_person_id, recorded_at, corrects_entry_id, correction_reason, correction_status,
      correction_actor_id, entry_hash, prev_entry_hash, sequence_no, is_first_entry)
    values (${newId()}, ${row.personId}, ${locationId}, ${row.node}, 'correction', ${row.eventAt}, 0,
      ${row.actorId}, ${row.recordedAt}, ${row.correctsEntryId}, 'cross-node merge', 'approved',
      ${row.actorId}, ${"A".repeat(64)}, ${"B".repeat(64)}, ${row.sequenceNo}, false)`);
}

async function workedMinutes(personId: string): Promise<number> {
  await seedEmployment(suite.db, { personId });
  const summary = await run((tx) =>
    backend.workSummary(
      tx,
      {
        personId,
        period: { start: "2026-01-05", end: "2026-01-12" },
      },
      { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
    ),
  );
  return summary.workedMinutes;
}

describe("requestCorrection", () => {
  it("appends a requested correction that does not yet change the projection", async () => {
    const { personId, outEntryId } = await nineToFive("req-1");
    const actor = await supervisor("req-1-sup");
    await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: actor,
      }),
    );
    const rows = await suite.db.execute<{
      entry_kind: string;
      correction_status: string | null;
    }>(sql`
      select entry_kind, correction_status from time_entries
      where person_id = ${personId} order by recorded_at, sequence_no`);
    expect(rows.rows.map((r) => [r.entry_kind, r.correction_status])).toEqual([
      ["in", null],
      ["out", null],
      ["correction", "requested"],
    ]);
    expect(await workedMinutes(personId)).toBe(480);
  });

  it("throws correction.target_not_found for an entry that does not exist", async () => {
    const actor = await supervisor("req-2-sup");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.requestCorrection(tx, {
          nodeId,
          correctsEntryId: crypto.randomUUID(),
          at: "2026-01-05T18:00:00Z",
          offsetMinutes: 0,
          reason: "no such entry",
          actorPersonId: actor,
        }),
      ),
    );
    expect(code).toBe("correction.target_not_found");
  });
});

describe("approveCorrection", () => {
  it("reprojects the work session while the original entry stays visible (teeth-test)", async () => {
    const { personId, outEntryId } = await nineToFive("appr-1");
    const sup = await supervisor("appr-1-sup");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup }),
    );

    expect(await workedMinutes(personId)).toBe(540);
    // The original out is still there, unmodified: the correction is a separate append.
    const original = await suite.db.execute<{ at: string }>(sql`
      select event_at as at from time_entries where id = ${outEntryId}`);
    expect(original.rows[0]!.at).toBe("2026-01-05T17:00:00.000Z");
  });

  it("refuses approval by a non-supervisor with correction.not_permitted", async () => {
    const { personId, outEntryId } = await nineToFive("appr-2");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    // `personId` is a plain staff member.
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.approveCorrection(tx, {
          nodeId,
          correctionId,
          approverPersonId: personId,
        }),
      ),
    );
    expect(code).toBe("correction.not_permitted");
    expect(await workedMinutes(personId)).toBe(480);
  });

  it("throws correction.target_not_found approving a correction id that does not exist", async () => {
    const sup = await supervisor("appr-3-sup");
    const code = await codeOfRejection(() =>
      run((tx) =>
        backend.approveCorrection(tx, {
          nodeId,
          correctionId: crypto.randomUUID(),
          approverPersonId: sup,
        }),
      ),
    );
    expect(code).toBe("correction.target_not_found");
  });

  it("refuses a SECOND approval of the same request and appends no duplicate approved row", async () => {
    const { personId, outEntryId } = await nineToFive("appr-4");
    const sup = await supervisor("appr-4-sup");
    const correctionId = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: outEntryId,
        at: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        reason: "forgot to clock out",
        actorPersonId: personId,
      }),
    );
    // Approval is a second append, so the request row stays `requested` after it.
    await run((tx) =>
      backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup }),
    );
    // Refused on the target's existing approval: the request itself is still `requested`.
    const code = await codeOfRejection(() =>
      run((tx) => backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: sup })),
    );
    expect(code).toBe("correction.not_pending");
    const approved = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from time_entries
      where person_id = ${personId} and entry_kind = 'correction'
        and correction_status = 'approved'`);
    expect(approved.rows[0]!.n).toBe(1);
    expect(await workedMinutes(personId)).toBe(540);
  });
});

describe("cross-node correction precedence (§4.2, reprojection)", () => {
  it("reprojects the later recorded_at approved correction when two chains correct one target", async () => {
    // The cloud row was recorded later but carries the lower sequence_no, so a sequence_no-only rule
    // would give 540, not 570.
    const { personId, outEntryId } = await nineToFive("xnode-1");
    // Two chains, neither the setup node's: a correction chains under its own recording node.
    const boxNode = await seedNode(suite.db, brandLocationId(locationId));
    const cloudNode = await seedNode(suite.db, brandLocationId(locationId));
    const actor = await supervisor("xnode-1-sup");
    await insertApprovedCorrection({
      node: boxNode, // "the box"
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      // Inserted raw, so nothing truncates to the whole-second spelling for it.
      eventAt: "2026-01-05T18:00:00.000Z",
      recordedAt: "2026-01-05T10:05:00.000Z",
      sequenceNo: 5,
    });
    await insertApprovedCorrection({
      node: cloudNode, // the promoted cloud
      correctsEntryId: outEntryId,
      personId,
      actorId: actor,
      eventAt: "2026-01-05T18:30:00.000Z",
      recordedAt: "2026-01-05T10:06:00.000Z",
      sequenceNo: 2,
    });
    expect(await workedMinutes(personId)).toBe(570);
  });
});
