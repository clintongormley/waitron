import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import {
  attendanceQuestions,
  attendanceMail,
  listPendingAttendanceQuestions,
  upsertAttendanceQuestion,
  mergeAttendanceQuestions,
  WorkforceBackend,
  timeEntries,
} from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(f: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, f);
let locationId: string, personId: string, other: string, nodeId: string;
const now = new Date("2026-01-08T04:01:00.000Z");
const day = (businessDay = "2026-01-05") => ({
  locationId,
  businessDay,
  startAt: `${businessDay}T04:00:00.000Z`,
  endAt: `${businessDay.slice(0, 8)}${String(Number(businessDay.slice(8)) + 1).padStart(2, "0")}T04:00:00.000Z`,
});
const question = () => ({
  personId,
  day: day(),
  shiftKey: "rota:morning",
  kind: "missing-times" as const,
  missingKinds: ["in", "out"] as ("in" | "out")[],
  openEntryId: null,
  automaticEntryId: null,
  evidenceKeys: ["order:1"],
});
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [personId, other] = rows.map((r) => r.id) as [string, string];
});
const own = () => run((tx) => listPendingAttendanceQuestions(tx, personId));
async function openShift() {
  await run((tx) =>
    new WorkforceBackend().clockIn(tx, {
      nodeId,
      locationId,
      personId,
      at: "2026-01-05T09:00:00Z",
      offsetMinutes: 0,
      origin: jobOrigin("dashboard"),
    }),
  );
  return (await suite.db.select({ id: timeEntries.id }).from(timeEntries))[0]!.id;
}

describe("durable own attendance questions", () => {
  it("retains old own questions on a later day, sorted independently of insertion order", async () => {
    const tuesday = await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        { ...question(), day: day("2026-01-06"), shiftKey: "rota:tuesday" },
        now,
      ),
    );
    const monday = await run((tx) => upsertAttendanceQuestion(tx, question(), now));
    await run((tx) => upsertAttendanceQuestion(tx, { ...question(), personId: other }, now));
    expect((await own()).map((q) => q.id)).toEqual([monday, tuesday]);
    expect((await own()).map((q) => q.id)).toEqual([monday, tuesday]);
  });
  it("one reminder identity combines missing ends and preserves old evidence on replay", async () => {
    const first = await run((tx) =>
      upsertAttendanceQuestion(tx, { ...question(), missingKinds: ["in"] }, now),
    );
    const replay = await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        { ...question(), missingKinds: ["out"], evidenceKeys: ["order:2", "order:1"] },
        new Date("2026-01-09T00:00:00Z"),
      ),
    );
    expect(replay).toBe(first);
    expect(await own()).toEqual([
      {
        ...question(),
        id: first,
        createdAt: now.toISOString(),
        evidenceKeys: ["order:1", "order:2"],
      },
    ]);
    expect(await suite.db.select().from(attendanceMail)).toMatchObject([
      { questionId: first, status: "pending", claimToken: null, recipient: null },
    ]);
  });
  it("same source key at two locations or two people makes separate obligations", async () => {
    const elsewhere = await seedLocation(suite.db);
    await run(async (tx) => {
      await upsertAttendanceQuestion(tx, question(), now);
      await upsertAttendanceQuestion(
        tx,
        { ...question(), day: { ...day(), locationId: elsewhere } },
        now,
      );
      await upsertAttendanceQuestion(tx, { ...question(), personId: other }, now);
    });
    expect(await suite.db.select().from(attendanceQuestions)).toHaveLength(3);
    expect(await own()).toHaveLength(2);
  });
  it("newly earlier evidence keeps the existing uncovered interval's question and reminder", async () => {
    const input = {
      ...question(),
      shiftKey: "activity:2026-01-05:order:2",
      evidenceKeys: ["order:2"],
    };
    const first = await run((tx) => upsertAttendanceQuestion(tx, input, now));
    const mail = await suite.db.select().from(attendanceMail);
    expect(
      await run((tx) => upsertAttendanceQuestion(tx, { ...input, evidenceKeys: ["order:1"] }, now)),
    ).toBe(first);
    expect((await own())[0]!.evidenceKeys).toEqual(["order:1", "order:2"]);
    expect(await suite.db.select().from(attendanceMail)).toEqual(mail);
  });
  it("missing-out becomes automatic with the same id and cancels its unclaimed reminder", async () => {
    const backend = new WorkforceBackend();
    const origin = jobOrigin("dashboard");
    const open = await openShift();
    const input = {
      ...question(),
      shiftKey: `in:${open}`,
      openEntryId: open,
      missingKinds: ["out"] as ("in" | "out")[],
    };
    const first = await run((tx) => upsertAttendanceQuestion(tx, input, now));
    const end = await run((tx) =>
      backend.recordAutomaticClose(tx, {
        nodeId,
        locationId,
        personId,
        openEntryId: open,
        at: "2026-01-05T17:00:00Z",
        offsetMinutes: 0,
        origin,
      }),
    );
    expect(
      await run((tx) =>
        upsertAttendanceQuestion(
          tx,
          {
            ...input,
            kind: "automatic-out",
            automaticEntryId: end,
            missingKinds: [],
            evidenceKeys: ["order:last"],
          },
          now,
        ),
      ),
    ).toBe(first);
    expect((await own())[0]).toMatchObject({
      id: first,
      kind: "automatic-out",
      automaticEntryId: end,
      missingKinds: [],
      evidenceKeys: ["order:1", "order:last"],
    });
    expect((await suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
    await run((tx) => upsertAttendanceQuestion(tx, input, now));
    expect((await own())[0]).toMatchObject({
      kind: "automatic-out",
      automaticEntryId: end,
      missingKinds: [],
    });
  });
  it("an automatic acknowledgment alone does not create a reminder", async () => {
    const backend = new WorkforceBackend(),
      origin = jobOrigin("dashboard");
    const open = await openShift();
    const end = await run((tx) =>
      backend.recordAutomaticClose(tx, {
        nodeId,
        locationId,
        personId,
        openEntryId: open,
        at: "2026-01-05T17:00:00Z",
        offsetMinutes: 0,
        origin,
      }),
    );
    await run((tx) =>
      upsertAttendanceQuestion(
        tx,
        {
          ...question(),
          shiftKey: `in:${open}`,
          kind: "automatic-out",
          openEntryId: open,
          automaticEntryId: end,
          missingKinds: [],
        },
        now,
      ),
    );
    expect(await suite.db.select().from(attendanceMail)).toEqual([]);
  });
  it.each(["sent", "unknown", "sending"] as const)(
    "automatic upgrade retains a %s reminder and its exact claim history",
    async (status) => {
      const open = await openShift();
      const input = {
        ...question(),
        shiftKey: `in:${open}`,
        openEntryId: open,
        missingKinds: ["out"] as ("in" | "out")[],
      };
      const id = await run((tx) => upsertAttendanceQuestion(tx, input, now));
      await suite.db
        .update(attendanceMail)
        .set({
          status,
          claimToken: "claim",
          claimedAt: now.toISOString(),
          recipient: "worker@example.test",
          outcome: status === "sending" ? null : status,
        })
        .where(eq(attendanceMail.questionId, id));
      const before = await suite.db.select().from(attendanceMail);
      const end = await run((tx) =>
        new WorkforceBackend().recordAutomaticClose(tx, {
          nodeId,
          locationId,
          personId,
          openEntryId: open,
          at: "2026-01-05T17:00:00Z",
          offsetMinutes: 0,
          origin: jobOrigin("dashboard"),
        }),
      );
      await run((tx) =>
        upsertAttendanceQuestion(
          tx,
          { ...input, kind: "automatic-out", automaticEntryId: end, missingKinds: [] },
          now,
        ),
      );
      expect(await suite.db.select().from(attendanceMail)).toEqual(before);
    },
  );
  it("refuses replacing an existing automatic target and preserves both question and mail", async () => {
    const open = await openShift();
    const end = await run((tx) =>
      new WorkforceBackend().recordAutomaticClose(tx, {
        nodeId,
        locationId,
        personId,
        openEntryId: open,
        at: "2026-01-05T17:00:00Z",
        offsetMinutes: 0,
        origin: jobOrigin("dashboard"),
      }),
    );
    const input = {
      ...question(),
      shiftKey: `in:${open}`,
      kind: "automatic-out" as const,
      openEntryId: open,
      automaticEntryId: end,
      missingKinds: [],
    };
    await run((tx) => upsertAttendanceQuestion(tx, input, now));
    const before = await suite.db.select().from(attendanceQuestions);
    await expect(
      run((tx) => upsertAttendanceQuestion(tx, { ...input, automaticEntryId: open }, now)),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    await expect(
      run((tx) => upsertAttendanceQuestion(tx, { ...input, openEntryId: end }, now)),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
    expect(await suite.db.select().from(attendanceMail)).toEqual([]);
  });
  it.each([
    { personId: "" },
    { shiftKey: "" },
    { evidenceKeys: [""] },
    { missingKinds: [] },
    { kind: "automatic-out", automaticEntryId: null },
  ])("refuses malformed question %j before any state write", async (bad) => {
    await expect(
      run((tx) =>
        upsertAttendanceQuestion(
          tx,
          { ...question(), ...bad } as Parameters<typeof upsertAttendanceQuestion>[1],
          now,
        ),
      ),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
    expect(await suite.db.select().from(attendanceMail)).toEqual([]);
  });
  it("refuses a changed saved question day rather than silently moving its evidence", async () => {
    await run((tx) => upsertAttendanceQuestion(tx, question(), now));
    const before = await suite.db.select().from(attendanceQuestions);
    await expect(
      run((tx) => upsertAttendanceQuestion(tx, { ...question(), day: day("2026-01-06") }, now)),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
  });
  it.each(["pending", "rejected", "sent", "unknown"] as const)(
    "merges overlapping questions while retaining %s delivery history",
    async (status) => {
      const first = await run((tx) =>
        upsertAttendanceQuestion(tx, { ...question(), missingKinds: ["in"] }, now),
      );
      const second = await run((tx) =>
        upsertAttendanceQuestion(
          tx,
          {
            ...question(),
            shiftKey: "activity:2026-01-05:order:2",
            missingKinds: ["out"],
            evidenceKeys: ["order:2"],
          },
          now,
        ),
      );
      await suite.db
        .update(attendanceMail)
        .set({ status })
        .where(eq(attendanceMail.questionId, second));
      await run((tx) => mergeAttendanceQuestions(tx, first, second));
      await run((tx) => mergeAttendanceQuestions(tx, first, second));
      expect(await own()).toEqual([
        {
          ...question(),
          id: first,
          createdAt: now.toISOString(),
          evidenceKeys: ["order:1", "order:2"],
        },
      ]);
      expect(
        (
          await suite.db
            .select()
            .from(attendanceQuestions)
            .where(eq(attendanceQuestions.id, second))
        )[0],
      ).toMatchObject({ canonicalQuestionId: first, active: false, inactiveReason: "merged" });
      const mails = await suite.db.select().from(attendanceMail);
      expect(mails.find((m) => m.questionId === second)!.status).toBe(
        status === "pending" || status === "rejected" ? "cancelled" : status,
      );
      expect(mails.find((m) => m.questionId === first)!.status).toBe(
        status === "sent" || status === "unknown" ? "cancelled" : "pending",
      );
      expect(
        await run((tx) =>
          upsertAttendanceQuestion(
            tx,
            { ...question(), shiftKey: "activity:2026-01-05:order:2", evidenceKeys: ["order:3"] },
            now,
          ),
        ),
      ).toBe(first);
      expect((await own())[0]!.evidenceKeys).toEqual(["order:1", "order:2", "order:3"]);
    },
  );
  it("refuses cross-worker question merges without changing either obligation", async () => {
    const first = await run((tx) => upsertAttendanceQuestion(tx, question(), now));
    const second = await run((tx) =>
      upsertAttendanceQuestion(tx, { ...question(), personId: other }, now),
    );
    const before = await suite.db.select().from(attendanceQuestions);
    await expect(run((tx) => mergeAttendanceQuestions(tx, first, second))).rejects.toMatchObject({
      code: "attendance.invalid",
    });
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(before);
  });
  it("lists neither inactive nor legally resolved obligations", async () => {
    const id = await run((tx) => upsertAttendanceQuestion(tx, question(), now));
    await suite.db
      .update(attendanceQuestions)
      .set({ active: false, inactiveReason: "rota_superseded" })
      .where(eq(attendanceQuestions.id, id));
    expect(await own()).toEqual([]);
    const entry = await openShift();
    await suite.db
      .update(attendanceQuestions)
      .set({ active: true, inactiveReason: null, resolvedByEntryId: entry })
      .where(eq(attendanceQuestions.id, id));
    expect(await own()).toEqual([]);
  });
  it("rolls back a question and reminder when the caller fails", async () => {
    await expect(
      run(async (tx) => {
        await upsertAttendanceQuestion(tx, question(), now);
        throw new Error("after question");
      }),
    ).rejects.toThrow("after question");
    expect(await suite.db.select().from(attendanceQuestions)).toEqual([]);
    expect(await suite.db.select().from(attendanceMail)).toEqual([]);
  });
});
