import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { attendanceFixture } from "../test/attendance-fixture.js";
import {
  appendToChain,
  attendanceMail,
  attendanceQuestions,
  enqueueAttendanceDay,
  upsertAttendanceQuestion,
  claimAttendanceMail,
  reportAttendanceMail,
} from "./index.js";

const f = attendanceFixture();
const morning = () => f.plan("morning", "2026-01-05T09:00:00Z", "2026-01-05T12:00:00Z");
const missing = (shiftKey: string) => ({
  personId: f.personId,
  day: f.day(),
  shiftKey,
  kind: "missing-times" as const,
  missingKinds: ["in", "out"] as ("in" | "out")[],
  openEntryId: null,
  automaticEntryId: null,
  evidenceKeys: ["order:morning"],
});

describe("attendance obligations follow current clock and planning evidence", () => {
  it("revives a cancelled definitive rejection without shortening its saved retry delay", async () => {
    const at = f.input().now;
    const {
      questionIds: [id],
    } = await f.process({ facts: [], planned: [morning()] });
    const [mail] = await f.suite.db.select().from(attendanceMail);
    const claim = (await f.run((tx) =>
      claimAttendanceMail(tx, {
        id: mail!.id,
        holder: "node",
        recipient: "worker@example.test",
        now: at,
      }),
    ))!;
    await f.run((tx) => reportAttendanceMail(tx, claim, "rejected", at));
    await f.suite.db
      .update(attendanceQuestions)
      .set({ active: false, inactiveReason: "rota_superseded" })
      .where(eq(attendanceQuestions.id, id!));
    await f.suite.db
      .update(attendanceMail)
      .set({ status: "cancelled" })
      .where(eq(attendanceMail.id, mail!.id));
    const before = (await f.suite.db.select().from(attendanceMail))[0]!;
    await f.process({ facts: [], planned: [morning()], now: new Date(at.getTime() + 60_000) });
    expect(await f.questions()).toMatchObject([{ id }]);
    expect(await f.suite.db.select().from(attendanceMail)).toEqual([
      { ...before, status: "rejected" },
    ]);
    expect(
      await f.run((tx) =>
        claimAttendanceMail(tx, {
          id: mail!.id,
          holder: "node",
          recipient: "worker@example.test",
          now: new Date(at.getTime() + 14 * 60_000),
        }),
      ),
    ).toBeNull();
    expect(
      await f.run((tx) =>
        claimAttendanceMail(tx, {
          id: mail!.id,
          holder: "node",
          recipient: "worker@example.test",
          now: new Date(at.getTime() + 15 * 60_000),
        }),
      ),
    ).not.toBeNull();
  });
  it.each(["pending", "sending", "sent", "unknown"] as const)(
    "late clock-in upgrades a %s rota question using its original identity",
    async (status) => {
      const first = await f.process({ facts: [], planned: [morning()] });
      const id = first.questionIds[0]!;
      await f.suite.db
        .update(attendanceMail)
        .set({
          status,
          claimToken: status === "pending" ? null : "claim",
          claimedAt: status === "pending" ? null : "2026-01-06T04:00:00.000Z",
          recipient: status === "pending" ? null : "worker@example.test",
          outcome: status === "sent" || status === "unknown" ? status : null,
        })
        .where(eq(attendanceMail.questionId, id));
      const before = await f.suite.db.select().from(attendanceMail);
      const open = await f.open();
      await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
      const next = await f.process({
        planned: [morning()],
        facts: [f.fact("2026-01-05T11:00:00Z", "morning")],
      });
      expect(next.questionIds).toEqual([id]);
      expect(await f.questions()).toMatchObject([
        {
          id,
          kind: "automatic-out",
          openEntryId: open,
          automaticEntryId: next.automaticEntryIds[0],
        },
      ]);
      const after = await f.suite.db.select().from(attendanceMail);
      expect(after).toEqual(
        status === "pending" ? [{ ...before[0]!, status: "cancelled" }] : before,
      );
    },
  );
  it("a late real clock interval resolves the original missing shift and its unclaimed reminder", async () => {
    const first = await f.process({ facts: [], planned: [morning()] });
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    const end = (await f.entries()).at(-1)!.id;
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    expect(await f.process({ facts: [], planned: [morning()] })).toEqual({
      automaticEntryIds: [],
      questionIds: [],
    });
    expect(await f.questions()).toEqual([]);
    expect(await f.suite.db.select().from(attendanceQuestions)).toMatchObject([
      { id: first.questionIds[0], resolvedByEntryId: end },
    ]);
    expect(await f.suite.db.select().from(attendanceMail)).toMatchObject([{ status: "cancelled" }]);
  });
  it.each(["pending", "sent", "unknown"] as const)(
    "late publication merges an existing %s activity question without a second reminder",
    async (status) => {
      const fact = f.fact("2026-01-05T10:00:00Z", "morning");
      const first = await f.process({ facts: [fact] });
      const id = first.questionIds[0]!;
      await f.suite.db
        .update(attendanceMail)
        .set({
          status,
          claimToken: status === "pending" ? null : "claim",
          claimedAt: status === "pending" ? null : "2026-01-06T04:00:00.000Z",
          recipient: status === "pending" ? null : "worker@example.test",
          outcome: status === "pending" ? null : status,
        })
        .where(eq(attendanceMail.questionId, id));
      await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
      const next = await f.process({ facts: [fact], planned: [morning()] });
      expect(next.questionIds).toEqual([id]);
      expect(await f.questions()).toHaveLength(1);
      expect((await f.questions())[0]!.evidenceKeys).toEqual(["order:morning"]);
      const mail = await f.suite.db.select().from(attendanceMail);
      expect(mail.find((m) => m.questionId === id)!.status).toBe(status);
      expect(mail.filter((m) => m.status === "pending")).toHaveLength(status === "pending" ? 1 : 0);
    },
  );
  it("restores an inactive current rota identity, preserving an attempted reminder", async () => {
    const id = await f.run((tx) =>
      upsertAttendanceQuestion(tx, missing("rota:morning"), f.input().now),
    );
    await f.suite.db
      .update(attendanceQuestions)
      .set({ active: false, inactiveReason: "rota_superseded" })
      .where(eq(attendanceQuestions.id, id));
    await f.suite.db
      .update(attendanceMail)
      .set({
        status: "unknown",
        claimToken: "claim",
        claimedAt: "2026-01-06T04:00:00.000Z",
        recipient: "worker@example.test",
        outcome: "unknown",
      })
      .where(eq(attendanceMail.questionId, id));
    const mail = await f.suite.db.select().from(attendanceMail);
    expect((await f.process({ facts: [], planned: [morning()] })).questionIds).toEqual([id]);
    expect(await f.questions()).toMatchObject([{ id, shiftKey: "rota:morning" }]);
    expect(await f.suite.db.select().from(attendanceMail)).toEqual(mail);
  });
  it("retains a replaced old start as missing and leaves the newer open interval unchanged", async () => {
    const old = await f.open();
    await f.run((tx) =>
      appendToChain(
        tx,
        { nodeId: f.nodeId, locationId: f.locationId },
        {
          personId: f.personId,
          entryKind: "in",
          eventAt: "2026-01-06T09:00:00.000Z",
          eventOffsetMinutes: 0,
          recordedByPersonId: f.personId,
          origin: f.event("").origin,
          extension: {
            authorKind: "worker",
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: null,
            payPeriodClosureId: null,
          },
        },
      ),
    );
    const before = await f.state();
    await f.process();
    expect((await f.state()).entries).toEqual(before.entries);
    expect((await f.state()).chains).toEqual(before.chains);
    expect(await f.questions()).toMatchObject([
      { openEntryId: old, kind: "missing-times", missingKinds: ["out"] },
    ]);
  });
  it("does not use an earlier interval's work to close a later shift", async () => {
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    const later = await f.open("2026-01-05T16:00:00Z");
    await f.process({ facts: [f.fact("2026-01-05T10:00:00Z", "morning")] });
    expect(await f.entries()).toHaveLength(3);
    expect(await f.questions()).toMatchObject([
      { openEntryId: later, kind: "missing-times", evidenceKeys: [] },
    ]);
  });
  it("resolves an old activity question when a late real interval covers its evidence", async () => {
    const fact = f.fact("2026-01-05T10:00:00Z", "morning");
    const first = await f.process({ facts: [fact] });
    await f.open();
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    const end = (await f.entries()).at(-1)!.id;
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    expect(await f.process({ facts: [fact] })).toEqual({ automaticEntryIds: [], questionIds: [] });
    expect(await f.questions()).toEqual([]);
    expect(await f.suite.db.select().from(attendanceQuestions)).toMatchObject([
      { id: first.questionIds[0], resolvedByEntryId: end },
    ]);
  });
  it("one late start does not merge two split rota obligations through shared work evidence", async () => {
    const planned = [morning(), f.plan("overlap", "2026-01-05T16:00:00Z", "2026-01-05T20:00:00Z")];
    const fact = f.fact("2026-01-05T11:00:00Z", "morning");
    const facts = [fact, f.fact("2026-01-05T17:00:00Z", "evening")];
    const first = await f.process({ planned, facts });
    expect(first.questionIds).toHaveLength(2);
    await f.open();
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    await f.process({ planned, facts });
    expect(
      (await f.questions())
        .map((q) => ({ key: q.shiftKey, kind: q.kind }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    ).toEqual([
      { key: "rota:morning", kind: "automatic-out" },
      { key: "rota:overlap", kind: "missing-times" },
    ]);
  });
  it("resolves a merged rota identity when the still-open shift gets a real finish", async () => {
    const first = await f.process({ facts: [], planned: [morning()] });
    await f.open();
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    expect((await f.process({ facts: [], planned: [morning()] })).questionIds).toEqual(
      first.questionIds,
    );
    await f.run((tx) => f.backend.clockOut(tx, f.event("2026-01-05T12:00:00Z")));
    await f.run((tx) => enqueueAttendanceDay(tx, f.day()));
    expect(await f.process({ facts: [], planned: [morning()] })).toEqual({
      automaticEntryIds: [],
      questionIds: [],
    });
    expect(await f.questions()).toEqual([]);
    expect((await f.suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
  });
  it.each(["sending", "sent", "unknown"] as const)(
    "retired rota work remains a current activity question without repeating a %s reminder",
    async (status) => {
      const id = await f.run((tx) =>
        upsertAttendanceQuestion(tx, missing("rota:removed"), f.input().now),
      );
      await f.suite.db
        .update(attendanceQuestions)
        .set({ active: false, inactiveReason: "rota_superseded" })
        .where(eq(attendanceQuestions.id, id));
      await f.suite.db
        .update(attendanceMail)
        .set({
          status,
          claimToken: "claim",
          claimedAt: "2026-01-06T04:00:00.000Z",
          recipient: "worker@example.test",
          outcome: status === "sending" ? null : status,
        })
        .where(eq(attendanceMail.questionId, id));
      const [oldMail] = await f.suite.db.select().from(attendanceMail);
      await f.process({ facts: [f.fact("2026-01-05T10:00:00Z", "morning")] });
      expect(await f.questions()).toHaveLength(1);
      expect((await f.questions())[0]!.evidenceKeys).toEqual(["order:morning"]);
      const mail = await f.suite.db.select().from(attendanceMail);
      expect(mail.find((m) => m.questionId === id)).toEqual(oldMail);
      expect(mail.filter((m) => m.status === "pending" || m.status === "rejected")).toEqual([]);
      expect(
        (await f.suite.db.select().from(attendanceQuestions)).find((q) => q.id === id),
      ).toMatchObject({ active: false, inactiveReason: "rota_superseded" });
    },
  );
});
