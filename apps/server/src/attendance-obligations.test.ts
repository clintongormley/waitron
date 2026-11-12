import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { attendanceMailRows } from "@waitron/workforce/test/fixtures.js";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";

import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  attendanceDayWork,
  attendanceQuestions,
  listPendingAttendanceQuestions,
  upsertAttendanceQuestion,
  shifts,
} from "@waitron/workforce";
import {
  beginAttendanceDiscovery,
  discoverAttendanceDays,
  nextAttendanceDay,
} from "./attendance-discovery.js";
import { markAttendanceSourceChanged } from "./attendance-source-changes.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
const now = new Date("2026-01-08T12:00:00.000Z");
let personId: string, shiftId: string, questionId: string;
const day = () => ({
  businessDay: "2026-01-05",
  startAt: "2026-01-05T04:00:00.000Z",
  endAt: "2026-01-06T04:00:00.000Z",
});
const own = () => run((tx) => listPendingAttendanceQuestions(tx, personId));
const next = (at = now) => run((tx) => nextAttendanceDay(tx, { now: at }));
async function drain() {
  for (let i = 0; i < 100; i++) {
    if (!(await run((tx) => discoverAttendanceDays(tx, { now, batchSize: 1 }))).more) return;
  }
  throw new Error("source discovery did not finish");
}
beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Deli",
    timeZone: "UTC",
    dayCutover: "04:00",
    invoiceLocales: ["en"],
    operationDescription: "Restaurant",
  });
  const [person] = await seedPersons(suite.db, {
    displayName: "Anna",
    pinHash: "scrypt$00$00",
    role: "staff",
  });
  personId = person!.id;
  const versionId = await run((tx) => backend.createRosterVersion(tx, { period: "2026-01-05" }));
  shiftId = await run((tx) =>
    backend.addShift(tx, {
      versionId,
      personId,
      startsAt: "2026-01-05T09:00:00Z",
      endsAt: "2026-01-05T17:00:00Z",
      startsOffsetMinutes: 0,
      endsOffsetMinutes: 0,
    }),
  );
  await run((tx) => backend.publishRoster(tx, { versionId }));
  questionId = await run((tx) =>
    upsertAttendanceQuestion(
      tx,
      {
        personId,
        day: day(),
        shiftKey: `rota:${shiftId}`,
        kind: "missing-times",
        missingKinds: ["in", "out"],
        openEntryId: null,
        automaticEntryId: null,
        evidenceKeys: ["rota:original"],
      },
      now,
    ),
  );
  await run((tx) => beginAttendanceDiscovery(tx, { generation: "opening" }));
});
async function replace() {
  await run(async (tx) => {
    const id = await backend.createRosterVersion(tx, { period: "2026-01-05" });
    await backend.publishRoster(tx, { versionId: id });
    await markAttendanceSourceChanged(tx, "shift", shiftId);
  });
}

describe("selected-day rota reconciliation", () => {
  it("retires the prior publication's question before returning a newly dirty day", async () => {
    await drain();
    const [work] = await suite.db.select().from(attendanceDayWork);
    await suite.db
      .update(attendanceDayWork)
      .set({ evaluatedRevision: work!.dirtyRevision })
      .where(eq(attendanceDayWork.id, work!.id));
    await replace();
    await drain();
    expect(await next()).toEqual(day());
    expect(await own()).toEqual([]);
    expect((await suite.db.select().from(attendanceQuestions))[0]).toMatchObject({
      id: questionId,
      active: false,
      inactiveReason: "rota_superseded",
      evidenceKeys: ["rota:original"],
    });
    expect((await attendanceMailRows(suite.db))[0]!.status).toBe("cancelled");
  });
  it("finishes every bootstrap source before retiring an obsolete question", async () => {
    await replace();
    expect(await next()).toBeNull();
    expect((await own()).map((q) => q.id)).toEqual([questionId]);
    await drain();
    expect(await next()).toEqual(day());
    expect(await own()).toEqual([]);
  });
  it("does not retire questions when no completed day is due", async () => {
    await replace();
    await drain();
    expect(await next(new Date("2026-01-06T03:59:59.999Z"))).toBeNull();
    expect((await own()).map((q) => q.id)).toEqual([questionId]);
    expect((await attendanceMailRows(suite.db))[0]!.status).toBe("pending");
  });
  it("rereads current assignment after source discovery rather than accepting a cached assignee", async () => {
    await drain();
    const [other] = await seedPersons(suite.db, {
      displayName: "Bea",
      pinHash: "scrypt$00$00",
      role: "staff",
    });
    await suite.db.update(shifts).set({ personId: other!.id }).where(eq(shifts.id, shiftId));
    expect(await next()).toEqual(day());
    expect(await own()).toEqual([]);
  });
  it("rolls selection retirement back if later work in the same transaction fails", async () => {
    await replace();
    await drain();
    const questions = await suite.db.select().from(attendanceQuestions);
    const mail = await attendanceMailRows(suite.db);
    await expect(
      run(async (tx) => {
        await nextAttendanceDay(tx, { now });
        throw new Error("processor failed");
      }),
    ).rejects.toThrow("processor failed");
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(questions);
    expect(await attendanceMailRows(suite.db)).toEqual(mail);
  });
});
