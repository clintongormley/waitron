import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedBusinessDay, seedVenue } from "@waitron/db/testing/seed.js";

import { beforeEach, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  dayCutoverChanges,
  newId,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  WORKFORCE_MIGRATIONS,
  attendanceDays,
  rosterVersions,
  shifts,
  recordStaffActivity,
} from "@waitron/workforce";
import { nextAttendanceDay } from "./attendance-discovery.js";
import { markAttendanceSourceChanged } from "./attendance-source-changes.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
let personId: string;
const now = new Date("2026-01-09T12:00:00Z");
const next = (at = now) => run((tx) => nextAttendanceDay(tx, { now: at }));
const rows = () =>
  suite.db.select().from(attendanceDays).orderBy(asc(attendanceDays.businessDay));
const activity = (at: string) => run((tx) => recordStaffActivity(tx, personId, new Date(at)));
async function evaluate() {
  for (const work of await rows())
    await suite.db
      .update(attendanceDays)
      .set({ evaluatedRevision: work.dirtyRevision })
      .where(eq(attendanceDays.id, work.id));
}

beforeEach(async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "04:00",
    invoiceLocales: ["es"],
  });
  personId = (
    await seedPersons(suite.db, { displayName: "Anna", pinHash: "scrypt$00$00", role: "admin" })
  )[0]!.id;
});

it("allows deferred evaluated work only at its saved due instant", async () => {
  await activity("2026-01-05T12:00:00Z");
  const [work] = await rows();
  await suite.db
    .update(attendanceDays)
    .set({
      evaluatedRevision: work!.dirtyRevision,
      deferredShiftIds: ["overnight"],
      nextDueAt: "2026-01-06T05:00:00.000Z",
    })
    .where(eq(attendanceDays.id, work!.id));
  expect(await next(new Date("2026-01-06T04:59:59Z"))).toBeNull();
  expect((await next(new Date("2026-01-06T05:00:00Z")))?.businessDay).toBe("2026-01-05");
});

it("refreshes unprocessed future bounds after a scheduled cutover change", async () => {
  await activity("2026-01-10T12:00:00Z");
  await suite.db
    .insert(dayCutoverChanges)
    .values({ effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
  expect(await next(new Date("2026-01-10T20:00:00Z"))).toBeNull();
  const [work] = await rows();
  expect(work).toMatchObject({
    businessDay: "2026-01-10",
    endAt: "2026-01-11T05:00:00.000Z",
    nextDueAt: "2026-01-11T05:00:00.000Z",
  });
  expect(await next(new Date("2026-01-11T03:00:00Z"))).toBeNull();
  expect((await next(new Date("2026-01-11T05:00:00Z")))?.businessDay).toBe("2026-01-10");
});

it.each([
  {
    cutover: "06:00:00",
    now: "2026-01-11T03:00:00Z",
    endAt: "2026-01-11T05:00:00.000Z",
    due: false,
  },
  {
    cutover: "06:00:00",
    now: "2026-01-11T06:00:00Z",
    endAt: "2026-01-11T05:00:00.000Z",
    due: true,
  },
  {
    cutover: "02:00:00",
    now: "2026-01-11T01:00:00Z",
    endAt: "2026-01-11T01:00:00.000Z",
    due: true,
  },
])(
  "refreshes an unevaluated day when resuming at $now after moving cutover to $cutover",
  async ({ cutover, now: instant, endAt, due }) => {
    await activity("2026-01-10T12:00:00Z");
    const [before] = await rows();
    await suite.db
      .insert(dayCutoverChanges)
      .values({ effectiveBusinessDay: "2026-01-11", dayCutover: cutover });
    const answer = next(new Date(instant));
    await expect(answer).resolves.toEqual(
      due ? { businessDay: "2026-01-10", startAt: "2026-01-10T03:00:00.000Z", endAt } : null,
    );
    expect(await rows()).toEqual([{ ...before, endAt, nextDueAt: endAt }]);
  },
);

it("refuses a changed historical bound rather than relabeling an evaluated day", async () => {
  await activity("2026-01-05T12:00:00Z");
  await evaluate();
  const [work] = await rows();
  await suite.db
    .update(attendanceDays)
    .set({ dirtyRevision: work!.dirtyRevision + 1 })
    .where(eq(attendanceDays.id, work!.id));
  const before = await rows();
  await seedBusinessDay(suite.db, { dayCutover: "06:00" });
  await expect(next()).rejects.toMatchObject({ code: "attendance.invalid" });
  expect(await rows()).toEqual(before);
});

it("reassigns a future published shift to its new start-day after a scheduled cutover changes", async () => {
  const version = newId();
  await suite.db.insert(rosterVersions).values({
    id: version,
    periodStart: "2026-01-05",
    periodEnd: "2026-01-11",
    status: "published",
    publishedAt: "2026-01-04T12:00:00Z",
  });
  await suite.db.insert(shifts).values({
    personId,
    rosterVersionId: version,
    startsAt: "2026-01-11T04:00:00.000Z",
    endsAt: "2026-01-11T10:00:00.000Z",
    startsOffsetMinutes: 60,
    endsOffsetMinutes: 60,
  });
  await run((tx) => markAttendanceSourceChanged(tx, "rota", version));
  expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-11"]);
  await suite.db
    .insert(dayCutoverChanges)
    .values({ effectiveBusinessDay: "2026-01-11", dayCutover: "06:00:00" });
  await next(new Date("2026-01-09T12:00:00Z"));
  expect((await rows()).map((r) => r.businessDay)).toEqual(["2026-01-10", "2026-01-11"]);
  expect((await next(new Date("2026-01-11T05:00:00Z")))?.businessDay).toBe("2026-01-10");
});
