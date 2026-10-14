import { sql, eq } from "drizzle-orm";
import { StatementSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { WorkforceBackend } from "./clocking.js";
import { appendToChain, readChain } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { recordEntryById } from "./corrections.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
const backend = new WorkforceBackend(),
  origin = jobOrigin("dashboard");
let personId: string, other: string, locationId: string, nodeId: string, target: string;
const event = (subject: string, at: string) => ({
  personId: subject,
  locationId,
  nodeId,
  at,
  offsetMinutes: 0,
  origin,
});
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    nodeId = await seedNode(db, brandLocationId(locationId));
    personId = await seedPerson(db, "Worker");
    other = await seedPerson(db, "Other");
    await withTransaction(db, async (tx) => {
      for (const person of [personId, other])
        for (let day = 1; day <= 4; day++) {
          const date = `2026-01-0${day}`;
          await backend.clockIn(tx, event(person, `${date}T09:00:00Z`));
          await backend.clockOut(tx, event(person, `${date}T17:00:00Z`));
        }
    });
    target = db.execute<{ id: string }>(sql`select id from time_entries where sequence_no = 8`)
      .rows[0]!.id;
  },
});
async function timeRows<T>(body: () => Promise<T>) {
  const all = StatementSync.prototype.all,
    counts: number[] = [];
  const spy = vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (
    this: StatementSync,
    ...args
  ) {
    const rows = Reflect.apply(all, this, args) as ReturnType<typeof all>;
    if (/^\s*select\b/i.test(this.sourceSQL) && /\btime_entries\b/i.test(this.sourceSQL))
      counts.push(rows.length);
    return rows;
  });
  try {
    return { result: await body(), rows: counts.reduce((a, b) => a + b, 0) };
  } finally {
    spy.mockRestore();
  }
}
it("reads only the latest live instant when checking an ordinary clock action", async () => {
  const result = await timeRows(() =>
    withTransaction(suite.db, (tx) => backend.clockIn(tx, event(personId, "2026-01-05T09:00:00Z"))),
  );
  try {
    expect(result.rows).toBe(1);
    await expect(
      withTransaction(suite.db, (tx) =>
        backend.clockIn(tx, event(personId, "2026-01-05T10:00:00Z")),
      ),
    ).rejects.toMatchObject({ code: "attendance.already_open" });
  } finally {
    await withTransaction(suite.db, (tx) =>
      backend.clockOut(tx, event(personId, "2026-01-05T17:00:00Z")),
    );
  }
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
});
it("reads a correction target directly without decoding its person's other entries", async () => {
  const result = await timeRows(() =>
    withTransaction(suite.db, (tx) => recordEntryById(tx, target)),
  );
  expect(result.result).toMatchObject({
    entryId: target,
    personId,
    entryKind: "out",
    eventAt: "2026-01-04T17:00:00.000Z",
  });
  expect(result.rows).toBe(1);
});
it("returns only the requested person's history from the database for their record", async () => {
  const result = await timeRows(() =>
    withTransaction(suite.db, (tx) =>
      backend.timeRecord(tx, {
        personId: other,
        period: { start: "2026-01-01", end: "2026-01-05" },
      }),
    ),
  );
  expect(result.result.sessions.map((s) => s.workedMinutes)).toEqual([480, 480, 480, 480]);
  expect(result.result.entries.every((e) => e.entry.personId === other)).toBe(true);
  expect(result.rows).toBe(8);
});
it("refuses an unknown automatic entry without decoding the venue's history", async () => {
  const result = await timeRows(async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        backend.confirmAutomaticEntry(tx, {
          nodeId,
          entryId: "00000000-0000-4000-8000-000000000099",
          workerPersonId: other,
          origin,
        }),
      ),
    ).rejects.toMatchObject({ code: "attendance.not_pending" });
  });
  expect(result.rows).toBe(0);
});
it("does not decode another person's incomplete attribution during an own-record read", async () => {
  await withTransaction(suite.db, (tx) =>
    appendToChain(
      tx,
      { nodeId, locationId },
      {
        personId,
        entryKind: "in",
        eventAt: "2026-01-06T09:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: personId,
        origin,
      },
    ),
  );
  const query = (subject: string) =>
    withTransaction(suite.db, (tx) =>
      backend.timeRecord(tx, {
        personId: subject,
        period: { start: "2026-01-01", end: "2026-01-05" },
      }),
    );
  await expect(query(personId)).rejects.toMatchObject({
    code: "attendance.invalid",
    params: { reason: "incomplete_attribution" },
  });
  expect((await query(other)).sessions.map((s) => s.workedMinutes)).toEqual([480, 480, 480, 480]);
});

it("keeps simultaneous live events and ignores the later acknowledgment when deciding clock state", async () => {
  const worker = await seedPerson(suite.db, "Simultaneous");
  await withTransaction(suite.db, (tx) =>
    backend.clockIn(tx, event(worker, "2026-01-05T09:00:00Z")),
  );
  const openEntryId = suite.db.execute<{ id: string }>(
    sql`select id from time_entries where person_id = ${worker} and entry_kind = 'in'`,
  ).rows[0]!.id;
  const end = await withTransaction(suite.db, (tx) =>
    backend.recordAutomaticClose(tx, { ...event(worker, "2026-01-05T10:00:00Z"), openEntryId }),
  );
  await withTransaction(suite.db, (tx) =>
    backend.clockIn(tx, event(worker, "2026-01-05T10:00:00Z")),
  );
  await withTransaction(suite.db, (tx) =>
    backend.confirmAutomaticEntry(tx, { nodeId, entryId: end, workerPersonId: worker, origin }),
  );
  const result = await timeRows(async () => {
    await expect(
      withTransaction(suite.db, (tx) => backend.clockIn(tx, event(worker, "2026-01-05T11:00:00Z"))),
    ).rejects.toMatchObject({ code: "attendance.already_open" });
  });
  expect(result.rows).toBe(2);
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
});

it("uses an approved missing start as live state while ignoring its pending request", async () => {
  const worker = await seedPerson(suite.db, "Missing start");
  const manager = await seedPerson(suite.db, "Approver");
  await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, manager));
  const request = await withTransaction(suite.db, (tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId: worker,
      locationId,
      missingEntryKind: "in",
      at: "2026-01-06T09:00:00Z",
      offsetMinutes: 0,
      actorPersonId: worker,
      reason: "Forgot",
      origin,
    }),
  );
  await expect(
    withTransaction(suite.db, (tx) =>
      backend.breakStart(tx, event(worker, "2026-01-06T10:00:00Z")),
    ),
  ).rejects.toMatchObject({ code: "attendance.no_open_entry" });
  await withTransaction(suite.db, (tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  const result = await timeRows(async () => {
    await expect(
      withTransaction(suite.db, (tx) => backend.clockIn(tx, event(worker, "2026-01-06T10:00:00Z"))),
    ).rejects.toMatchObject({ code: "attendance.already_open" });
  });
  expect(result.rows).toBe(1);
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
});
