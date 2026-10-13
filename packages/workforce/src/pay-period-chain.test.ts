import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import type { PayPeriodClosure } from "./record-types.js";

function closure(over: Partial<PayPeriodClosure> = {}): PayPeriodClosure {
  const row: PayPeriodClosure = {
    id: "closure-one",
    nodeId: "node-one",
    locationId: "location-one",
    period: { start: "2026-01-01", end: "2026-02-01" },
    clock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    scheduledCloseAt: "2026-02-01T05:00:00.000Z",
    closedAt: "2026-02-01T05:00:01.000Z",
    snapshot: { sessions: [], entries: [], summaries: [], countedAutomaticEntryIds: [] },
    sequenceNo: 1,
    prevClosureHash: null,
    closureHash: "",
    ...over,
  };
  const bytes = JSON.stringify([
    row.id,
    row.nodeId,
    row.locationId,
    row.period.start,
    row.period.end,
    row.clock.timeZone,
    row.clock.dayCutover,
    row.clock.cutoverChanges,
    row.scheduledCloseAt,
    row.closedAt,
    {
      sessions: row.snapshot.sessions,
      entries: row.snapshot.entries,
      summaries: row.snapshot.summaries,
      countedAutomaticEntryIds: row.snapshot.countedAutomaticEntryIds,
    },
    row.sequenceNo,
    row.prevClosureHash,
  ]);
  return { ...row, closureHash: createHash("sha256").update(bytes).digest("hex").toUpperCase() };
}
describe("pay-period closure verification", () => {
  it("verifies a complete independently hashed closure segment regardless of row order", () => {
    const first = closure();
    const second = closure({
      id: "closure-two",
      sequenceNo: 2,
      prevClosureHash: first.closureHash,
      period: { start: "2026-02-01", end: "2026-03-01" },
    });
    expect(api.verifyPayPeriodClosures?.([second, first])).toEqual({ ok: true });
  });
  it.each([
    ["id", { id: "different" }],
    ["node", { nodeId: "different" }],
    ["location", { locationId: "different" }],
    ["period start", { period: { start: "2026-01-02", end: "2026-02-01" } }],
    ["period end", { period: { start: "2026-01-01", end: "2026-03-01" } }],
    ["zone", { clock: { timeZone: "UTC", dayCutover: "06:00", cutoverChanges: [] } }],
    ["cutover", { clock: { timeZone: "Europe/Madrid", dayCutover: "07:00", cutoverChanges: [] } }],
    [
      "dated cutover",
      {
        clock: {
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
          cutoverChanges: [{ effectiveBusinessDay: "2026-01-06", dayCutover: "07:00" }],
        },
      },
    ],
    ["scheduled time", { scheduledCloseAt: "2026-02-01T05:00:02.000Z" }],
    ["closed time", { closedAt: "2026-02-01T05:00:02.000Z" }],
    [
      "summaries",
      {
        snapshot: {
          sessions: [],
          entries: [],
          summaries: [{ personId: "p", summary: null }],
          countedAutomaticEntryIds: [],
        },
      },
    ],
    [
      "automatic ids",
      { snapshot: { sessions: [], entries: [], summaries: [], countedAutomaticEntryIds: ["e"] } },
    ],
  ] satisfies [string, Partial<PayPeriodClosure>][])("detects tampered %s", (_name, over) => {
    expect(api.verifyPayPeriodClosures?.([{ ...closure(), ...over }])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
  });
  it("detects a missing closure", () => {
    const first = closure();
    const second = closure({ sequenceNo: 2, prevClosureHash: first.closureHash });
    expect(api.verifyPayPeriodClosures?.([second])).toEqual({
      ok: false,
      reason: "sequence",
      sequenceNo: 1,
    });
  });
  it("detects a changed predecessor", () => {
    const first = closure();
    const second = closure({ sequenceNo: 2, prevClosureHash: "A".repeat(64) });
    expect(api.verifyPayPeriodClosures?.([first, second])).toEqual({
      ok: false,
      reason: "broken_link",
      sequenceNo: 2,
    });
  });
  it("rejects a genesis that names a predecessor", () => {
    expect(api.verifyPayPeriodClosures?.([closure({ prevClosureHash: "A".repeat(64) })])).toEqual({
      ok: false,
      reason: "genesis",
      sequenceNo: 1,
    });
  });
});

import { computeClosureHash } from "./pay-period-chain.js";
import type { ProjectedRecordEntry } from "./record-types.js";

const recorded: ProjectedRecordEntry = {
  entry: {
    entryId: "entry",
    personId: "p",
    locationId: "l",
    nodeId: "n",
    entryKind: "out",
    eventAt: "2026-01-05T17:00:00.000Z",
    recordedAt: "2026-01-06T09:00:00.000Z",
    offsetMinutes: 60,
    sequenceNo: 2,
    recordedByPersonId: null,
    origin: { source: "dashboard", deviceId: null },
    extension: {
      authorKind: "automatic",
      direction: null,
      missingEntryKind: null,
      respondsToEntryId: null,
      payPeriodClosureId: null,
    },
  },
  author: { kind: "automatic", personId: null },
  effective: true,
  confirmed: false,
  corrected: false,
  disputed: false,
  closedPeriodIds: ["closure"],
};
const session = {
  personId: "p",
  locationId: "l",
  workDate: "2026-01-05",
  startedAt: "2026-01-05T09:00:00.000Z",
  startOffsetMinutes: 60,
  endedAt: "2026-01-05T17:00:00.000Z",
  endOffsetMinutes: 60,
  breakMinutes: 0,
  workedMinutes: 480,
};
function rich(): PayPeriodClosure {
  return closure({
    snapshot: {
      sessions: [session],
      entries: [recorded],
      summaries: [
        {
          personId: "p",
          summary: {
            workedMinutes: 480,
            contractedMinutes: 480,
            dailyAccrualOvertimeMinutes: 0,
            periodNetOvertimeMinutes: 0,
            overtimeMinutes: 0,
            days: [
              {
                workDate: "2026-01-05",
                workedMinutes: 480,
                contractedTargetMinutes: 480,
                overtimeMinutes: 0,
              },
            ],
          },
        },
      ],
      countedAutomaticEntryIds: ["entry"],
    },
  });
}
it("canonicalizes object and collection order without omitting optional entry fields", () => {
  const row = rich();
  const first = computeClosureHash(row);
  const entry = row.snapshot.entries[0]!;
  const reversed = Object.fromEntries(
    Object.entries(entry.entry).reverse(),
  ) as ProjectedRecordEntry["entry"];
  expect(
    computeClosureHash({
      ...row,
      snapshot: { ...row.snapshot, entries: [{ ...entry, entry: reversed }] },
    }),
  ).toBe(first);
  const other = { ...entry, entry: { ...entry.entry, entryId: "other", sequenceNo: 1 } };
  const two = {
    ...row,
    snapshot: {
      ...row.snapshot,
      entries: [entry, other],
      countedAutomaticEntryIds: ["entry", "other"],
    },
  };
  expect(
    computeClosureHash({
      ...two,
      snapshot: {
        ...two.snapshot,
        entries: [other, entry],
        countedAutomaticEntryIds: ["other", "entry"],
      },
    }),
  ).toBe(computeClosureHash(two));
});
it.each([
  [
    "capture origin",
    {
      entry: { ...recorded.entry, origin: { source: "operator_script" as const, deviceId: null } },
    },
  ],
  ["recorder", { entry: { ...recorded.entry, recordedByPersonId: "manager" } }],
  ["reason", { entry: { ...recorded.entry, correctionReason: "Different" } }],
  ["actor", { entry: { ...recorded.entry, correctionActorId: "manager" } }],
  [
    "response",
    {
      entry: {
        ...recorded.entry,
        extension: { ...recorded.entry.extension!, respondsToEntryId: "request" },
      },
    },
  ],
  ["confirmation", { confirmed: true }],
  ["effective", { effective: false }],
  ["correction", { corrected: true }],
  ["dispute", { disputed: true }],
  ["author", { author: { kind: "worker" as const, personId: "p" } }],
  ["closed periods", { closedPeriodIds: [] }],
] satisfies [string, Partial<ProjectedRecordEntry>][])("commits rich history %s", (_name, over) => {
  const row = rich();
  row.closureHash = computeClosureHash(row);
  expect(api.verifyPayPeriodClosures([row])).toEqual({ ok: true });
  expect(
    api.verifyPayPeriodClosures([
      { ...row, snapshot: { ...row.snapshot, entries: [{ ...recorded, ...over }] } },
    ]),
  ).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 1 });
});
it("detects changed worked minutes in sessions and summary days", () => {
  const row = rich();
  row.closureHash = computeClosureHash(row);
  expect(
    api.verifyPayPeriodClosures([
      { ...row, snapshot: { ...row.snapshot, sessions: [{ ...session, workedMinutes: 540 }] } },
    ]),
  ).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 1 });
  const summary = row.snapshot.summaries[0]!.summary!;
  expect(
    api.verifyPayPeriodClosures([
      {
        ...row,
        snapshot: {
          ...row.snapshot,
          summaries: [
            {
              personId: "p",
              summary: { ...summary, days: [{ ...summary.days[0]!, workedMinutes: 540 }] },
            },
          ],
        },
      },
    ]),
  ).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 1 });
});
it("refuses duplicate history and counted ids rather than hashing them", () => {
  const row = rich();
  expect(() =>
    computeClosureHash({ ...row, snapshot: { ...row.snapshot, entries: [recorded, recorded] } }),
  ).toThrow("Duplicate pay-period snapshot entry ids");
  expect(() =>
    computeClosureHash({
      ...row,
      snapshot: { ...row.snapshot, countedAutomaticEntryIds: ["entry", "entry"] },
    }),
  ).toThrow("Duplicate pay-period snapshot entry ids");
  const duplicated = closure({
    snapshot: {
      sessions: [],
      entries: [],
      summaries: [],
      countedAutomaticEntryIds: ["entry", "entry"],
    },
  });
  expect(api.verifyPayPeriodClosures([duplicated])).toEqual({
    ok: false,
    reason: "hash_mismatch",
    sequenceNo: 1,
  });
});
