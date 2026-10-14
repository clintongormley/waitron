import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { seedLocation } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { attendanceMail, attendanceQuestions } from "./schema/attendance.js";
import { upsertAttendanceQuestion } from "./attendance-questions.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const now = new Date("2026-01-07T06:00:00.000Z");
let id: string, questionId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const locationId = await seedLocation(suite.db);
  const [person] = await suite.db.insert(persons).values({ displayName: "Worker" }).returning();
  questionId = await withTransaction(suite.db, (tx) =>
    upsertAttendanceQuestion(
      tx,
      {
        personId: person!.id,
        day: {
          locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T04:00:00.000Z",
          endAt: "2026-01-06T04:00:00.000Z",
        },
        shiftKey: "activity:2026-01-05:after:start",
        kind: "missing-times",
        missingKinds: ["in", "out"],
        openEntryId: null,
        automaticEntryId: null,
        evidenceKeys: ["order:one"],
      },
      now,
    ),
  );
  id = (await suite.db.select().from(attendanceMail))[0]!.id;
});
const row = async () =>
  (await suite.db.select().from(attendanceMail).where(eq(attendanceMail.id, id)))[0]!;
const claim = async (at = now, holder = "node:first") => {
  const { claimAttendanceMail } = await import("./attendance-mail.js");
  return withTransaction(suite.db, (tx) =>
    claimAttendanceMail(tx, { id, holder, recipient: "worker@example.test", now: at }),
  );
};

describe("attendance mail claims", () => {
  it("commits one recipient/token snapshot and serializes competing claimants", async () => {
    const [first, second] = await Promise.all([claim(), claim(now, "node:second")]);
    expect(first).toEqual({ id, token: expect.any(String) });
    expect(second).toBeNull();
    expect(await row()).toMatchObject({
      status: "sending",
      recipient: "worker@example.test",
      claimToken: first!.token,
      claimedAt: now.toISOString(),
      outcome: null,
    });
    expect(await suite.db.select().from(attendanceQuestions)).toHaveLength(1);
  });
  it("waits for the saved retry instant then creates a new claim token", async () => {
    const { reportAttendanceMail } = await import("./attendance-mail.js");
    const first = (await claim())!;
    expect(
      await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, first, "rejected", now)),
    ).toBe(true);
    expect(await row()).toMatchObject({
      status: "rejected",
      outcome: "rejected",
      nextAttemptAt: "2026-01-07T06:15:00.000Z",
    });
    expect(await claim(new Date("2026-01-07T06:14:59.999Z"))).toBeNull();
    const second = await claim(new Date("2026-01-07T06:15:00.000Z"));
    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first.token);
    expect(await row()).toMatchObject({ status: "sending", outcome: null });
  });
  it.each(["sending", "sent", "unknown", "cancelled"] as const)(
    "never reclaims %s",
    async (status) => {
      await claim();
      await suite.db.update(attendanceMail).set({ status }).where(eq(attendanceMail.id, id));
      const before = await row();
      expect(await claim(new Date("2026-01-10T06:00:00Z"))).toBeNull();
      expect(await row()).toEqual(before);
    },
  );
  it.each(["sent", "unknown"] as const)(
    "preserves a %s outcome and rejects repeat reports",
    async (outcome) => {
      const { reportAttendanceMail } = await import("./attendance-mail.js");
      const current = (await claim())!;
      expect(
        await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, current, outcome, now)),
      ).toBe(true);
      const before = await row();
      expect(before).toMatchObject({ status: outcome, outcome });
      expect(
        await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, current, "rejected", now)),
      ).toBe(false);
      expect(await claim(new Date("2026-01-10T06:00:00Z"))).toBeNull();
      expect(await row()).toEqual(before);
    },
  );
  it("an old token cannot settle a newer attempt", async () => {
    const { reportAttendanceMail } = await import("./attendance-mail.js");
    const first = (await claim())!;
    await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, first, "rejected", now));
    const second = (await claim(new Date("2026-01-07T06:15:00Z")))!;
    const before = await row();
    expect(
      await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, first, "sent", now)),
    ).toBe(false);
    expect(await row()).toEqual(before);
    expect(
      await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, second, "sent", now)),
    ).toBe(true);
  });
  it("expires abandoned claims at 60 seconds without queueing another send", async () => {
    const { expireAttendanceMailClaims, reportAttendanceMail } =
      await import("./attendance-mail.js");
    const current = (await claim())!;
    expect(
      await withTransaction(suite.db, (tx) =>
        expireAttendanceMailClaims(tx, new Date(now.getTime() + 59_999)),
      ),
    ).toBe(0);
    expect((await row()).status).toBe("sending");
    expect(
      await withTransaction(suite.db, (tx) =>
        expireAttendanceMailClaims(tx, new Date(now.getTime() + 60_000)),
      ),
    ).toBe(1);
    expect(await row()).toMatchObject({
      status: "unknown",
      outcome: "unknown",
      claimToken: current.token,
    });
    expect(await claim(new Date("2026-02-01T00:00:00Z"))).toBeNull();
    expect(
      await withTransaction(suite.db, (tx) => reportAttendanceMail(tx, current, "rejected", now)),
    ).toBe(false);
    expect((await row()).status).toBe("unknown");
    expect(await suite.db.select().from(attendanceQuestions)).toMatchObject([
      { id: questionId, resolvedByEntryId: null },
    ]);
  });
  it("refuses a missing delivery without changing the real row", async () => {
    const { claimAttendanceMail, reportAttendanceMail } = await import("./attendance-mail.js");
    const before = await row();
    expect(
      await withTransaction(suite.db, (tx) =>
        claimAttendanceMail(tx, {
          id: "absent",
          holder: "node",
          recipient: "worker@example.test",
          now,
        }),
      ),
    ).toBeNull();
    expect(
      await withTransaction(suite.db, (tx) =>
        reportAttendanceMail(tx, { id: "absent", token: "absent" }, "sent", now),
      ),
    ).toBe(false);
    expect(await row()).toEqual(before);
  });
});
