import { beforeEach, describe, expect, it } from "vitest";
import { seedNode } from "@waitron/db/testing/seed.js";
import type { Transaction } from "@waitron/db";
import { jobOrigin } from "@waitron/shared";
import { attendanceFixture } from "../test/attendance-fixture.js";
import type { AttendanceFact } from "./attendance-types.js";
import type { CorrectionTarget } from "./corrections.js";
import {
  readWorkforceReturn,
  receiveWorkforceBatch,
  type WorkforceReturnBatch,
} from "./handover-return.js";
import { readLatestLiveEntry } from "./record-reads.js";
import { attendanceQuestions } from "./schema/attendance.js";

// One database. The old box's entries from before the spare's copy sit on it as the copy holds
// them; its entries from after the copy are appended, read and rolled back before the main box
// acts, so the main box first learns of them through `receive`.
const f = attendanceFixture();
const ROLLBACK = new Error("rollback");
let oldBox: string;

beforeEach(async () => {
  oldBox = await seedNode(f.suite.db);
});

const onOld = (at: string) => ({ ...f.event(at), nodeId: oldBox });
const onMain = (at: string) => f.event(at);

async function onOldBoxAfterCopy(steps: (tx: Transaction) => Promise<void>) {
  let batches: WorkforceReturnBatch[] = [];
  await f.suite.db
    .transaction(async (tx) => {
      await steps(tx);
      batches = await readWorkforceReturn(tx, oldBox);
      throw ROLLBACK;
    })
    .catch((error: unknown) => {
      if (error !== ROLLBACK) throw error;
    });
  return batches;
}

async function receive(batches: WorkforceReturnBatch[]) {
  expect(batches).not.toEqual([]);
  for (const batch of batches)
    expect(
      await f.suite.db.transaction((tx) =>
        receiveWorkforceBatch(tx, oldBox, batch, new Date("2026-01-06T05:00:00Z")),
      ),
    ).toBe(true);
}

/** End-of-day looking again at the day the return re-queued. */
const recheck = (facts: AttendanceFact[] = []) =>
  f.process({ facts, now: new Date("2026-01-06T06:00:00.000Z") });

const sessions = async () =>
  (
    await f.run((tx) =>
      f.backend.timeRecord(tx, {
        personId: f.personId,
        period: { start: "2026-01-05", end: "2026-01-07" },
      }),
    )
  ).sessions.map((s) => [s.startedAt.slice(11, 16), s.endedAt.slice(11, 16), s.workedMinutes]);

const questions = async () =>
  (await f.suite.db.select().from(attendanceQuestions)).map((q) => ({
    kind: q.kind,
    openEntryId: q.openEntryId,
    missingKinds: q.missingKinds,
    resolvedByEntryId: q.resolvedByEntryId,
  }));

const entryAt = async (nodeId: string, at: string) =>
  (await f.entries()).find((e) => e.nodeId === nodeId && e.eventAt === at)!.id;

const latestLive = async () => {
  const latest = await f.run((tx) => readLatestLiveEntry(tx, f.personId));
  return latest && [latest.entryKind, latest.eventAt.slice(11, 16)];
};

const outcome = (action: Promise<unknown>) =>
  action.then(
    () => "accepted",
    (error: { code?: string }) => error.code,
  );

/**
 * The worker asks and the manager approves, through the existing corrections. The fixes below land a
 * minute clear of the other box's entry: at the same instant, which entry sorts first depends on the
 * two boxes' ids, so the same request was accepted in one run and refused in another.
 */
async function fixDay(target: CorrectionTarget, at: string) {
  const request = await f.run((tx) =>
    f.backend.requestCorrection(tx, {
      ...target,
      nodeId: f.nodeId,
      at,
      offsetMinutes: 0,
      reason: "Clocked on both boxes",
      actorPersonId: f.personId,
      origin: jobOrigin("dashboard"),
    }),
  );
  return f.run((tx) =>
    f.backend.approveCorrection(tx, {
      nodeId: f.nodeId,
      correctionId: request,
      approverPersonId: f.manager,
    }),
  );
}

describe("the same person clocking on both boxes, returned after an emergency switch", () => {
  describe("A: in before the copy, out on the old box after it; end-of-day ran first", () => {
    beforeEach(async () => {
      await f.run((tx) => f.backend.clockIn(tx, onOld("2026-01-05T09:00:00Z")));
    });

    it("with no activity on the main box, the returned clock-out answers the open question", async () => {
      const batches = await onOldBoxAfterCopy((tx) =>
        f.backend.clockOut(tx, onOld("2026-01-05T17:00:00Z")),
      );
      await f.process({ facts: [] });
      const question = {
        kind: "missing-times",
        openEntryId: await entryAt(oldBox, "2026-01-05T09:00:00.000Z"),
        missingKinds: ["out"],
        resolvedByEntryId: null,
      };
      expect(await sessions()).toEqual([]);
      expect(await questions()).toEqual([question]);

      await receive(batches);
      await recheck();

      expect(await sessions()).toEqual([["09:00", "17:00", 480]]);
      expect(await questions()).toEqual([
        {
          ...question,
          resolvedByEntryId: await entryAt(oldBox, "2026-01-05T17:00:00.000Z"),
        },
      ]);
    });

    it("with activity on the main box, its automatic clock-out stands and is moved by a correction", async () => {
      const activity = [f.fact("2026-01-05T12:00:00.000Z")];
      const batches = await onOldBoxAfterCopy((tx) =>
        f.backend.clockOut(tx, onOld("2026-01-05T17:00:00Z")),
      );
      await f.process({ facts: activity });
      const automatic = { correctsEntryId: await entryAt(f.nodeId, "2026-01-05T12:00:00.000Z") };
      const question = {
        kind: "automatic-out",
        openEntryId: await entryAt(oldBox, "2026-01-05T09:00:00.000Z"),
        missingKinds: [],
        resolvedByEntryId: null,
      };
      expect(await sessions()).toEqual([["09:00", "12:00", 180]]);
      expect(await questions()).toEqual([question]);

      await receive(batches);
      await recheck(activity);

      expect(await sessions()).toEqual([["09:00", "12:00", 180]]);
      expect(await questions()).toEqual([question]);
      await fixDay(automatic, "2026-01-05T16:59:00Z");
      expect(await sessions()).toEqual([["09:00", "16:59", 479]]);
    });
  });

  it("B: in on the old box after the copy, then in and out on the main box; the old clock-in asks for its clock-out", async () => {
    const batches = await onOldBoxAfterCopy((tx) =>
      f.backend.clockIn(tx, onOld("2026-01-05T09:00:00Z")),
    );
    await f.run((tx) => f.backend.clockIn(tx, onMain("2026-01-05T10:00:00Z")));
    await f.run((tx) => f.backend.clockOut(tx, onMain("2026-01-05T16:00:00Z")));

    await receive(batches);
    await f.process({ facts: [] });

    expect(await sessions()).toEqual([["10:00", "16:00", 360]]);
    expect(await questions()).toEqual([
      {
        kind: "missing-times",
        openEntryId: await entryAt(oldBox, "2026-01-05T09:00:00.000Z"),
        missingKinds: ["out"],
        resolvedByEntryId: null,
      },
    ]);
    const missingOut = { personId: f.personId, missingEntryKind: "out" } as const;
    await fixDay(missingOut, "2026-01-05T09:59:00Z");
    expect(await sessions()).toEqual([
      ["09:00", "09:59", 59],
      ["10:00", "16:00", 360],
    ]);
  });

  it("C: out on the old box after the copy, still in on the main box; the return clocks them out there", async () => {
    await f.run((tx) => f.backend.clockIn(tx, onOld("2026-01-05T09:00:00Z")));
    const batches = await onOldBoxAfterCopy((tx) =>
      f.backend.clockOut(tx, onOld("2026-01-05T17:00:00Z")),
    );
    expect(await latestLive()).toEqual(["in", "09:00"]);

    await receive(batches);

    expect(await latestLive()).toEqual(["out", "17:00"]);
    expect(
      await outcome(f.run((tx) => f.backend.clockOut(tx, onMain("2026-01-05T18:00:00Z")))),
    ).toBe("attendance.no_open_entry");
    expect(
      await outcome(f.run((tx) => f.backend.clockIn(tx, onMain("2026-01-05T18:00:00Z")))),
    ).toBe("accepted");
    expect(await sessions()).toEqual([["09:00", "17:00", 480]]);
  });
});
