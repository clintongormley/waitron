import { expect, it } from "vitest";
import { publicHourSelectionHistory } from "./hour-selection.js";
import { projectHourHistory } from "./hour-history.js";

const scope = { taxpayerNif: "89890001K", environment: "preproduction" } as const;
function intent(identity = "06RB", issuedAt = "2026-10-16T11:40:00.000Z") {
  return {
    kind: "intent",
    softwareId: "other-software",
    operatorId: "owner",
    binding: {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: identity,
      sourceId: "first-setup/selected",
      targetNodeId: "old-node",
    },
    scope,
    bases: [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
    contextKey: "context",
    answer: "no",
    identity,
    issuedAt,
    references: ["venue"],
  };
}
function state(...entries: unknown[]) {
  return { version: 1, entries };
}
it("exports abandoned and older-software intents without raw keys, PDFs or owner context", () => {
  const original = intent();
  const high = intent("06RC", "2026-10-16T12:01:00.000Z");
  const source = publicHourSelectionHistory([
    state({ ...original, secret: "NEVER-BACK-UP", pdf: "%PDF-secret", contextKey: "private" }),
    state(original, high),
  ]);
  expect(source).toEqual({
    reference: "prepared-hours",
    complete: true,
    records: [
      {
        ...scope,
        reference: "intent/fiscal-verifactu/06RB",
        kind: "intent",
        softwareId: "other-software",
        nodeId: "old-node",
        identity: "06RB",
        recordedAtMs: 1792150800000,
      },
      {
        ...scope,
        reference: "intent/fiscal-verifactu/06RB",
        kind: "intent",
        softwareId: "other-software",
        nodeId: "old-node",
        identity: "06RB",
        recordedAtMs: 1792150800000,
      },
      {
        ...scope,
        reference: "intent/fiscal-verifactu/06RC",
        kind: "intent",
        softwareId: "other-software",
        nodeId: "old-node",
        identity: "06RC",
        recordedAtMs: 1792152060000,
      },
    ],
  });
  expect(JSON.stringify(source)).not.toMatch(/NEVER-BACK-UP|PDF-secret|private|owner|context/);
  expect(projectHourHistory({ scope, sources: [source] })).toMatchObject({
    greatestSpentHour: 6924,
    recordedTimeFloorMs: 1792152060000,
    contradictions: [],
  });
});
it("keeps conflicting revisions visible rather than allowing an older revision to lower the floor", () => {
  const high = intent("06RC", "2026-10-16T12:01:00.000Z");
  const low = { ...intent(), binding: high.binding };
  const source = publicHourSelectionHistory([state(high), state(low)]);
  expect(projectHourHistory({ scope, sources: [source] })).toMatchObject({
    greatestSpentHour: 6924,
    contradictions: ["intent/fiscal-verifactu/06RC:conflict"],
  });
});
it("does not mark a waiting hour as spent", () => {
  const { identity: _, issuedAt: __, references: ___, ...entry } = intent();
  void _;
  void __;
  void ___;
  expect(
    publicHourSelectionHistory([
      null,
      state({ ...entry, kind: "wait", answer: "yes", targetMs: 1792152000000 }),
    ]),
  ).toEqual({ reference: "prepared-hours", complete: true, records: [] });
});
it.each([
  {},
  { version: 2, entries: [] },
  state({ ...intent(), identity: "S000001" }),
  state({ ...intent(), issuedAt: "2026-10-16T12:00:00.000Z" }),
  state({ ...intent(), operatorId: null }),
])("refuses invalid retained preparation rather than exporting an empty floor %#", (value) => {
  expect(() => publicHourSelectionHistory([value])).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});

import { FISCAL_HOUR_BACKUP_STATE } from "./hour-backup-state.js";
const publicRow = {
  reference: "intent/fiscal-verifactu/retained",
  kind: "intent",
  ...scope,
  softwareId: "old-software",
  nodeId: "retired-node",
  identity: "06RC",
  recordedAtMs: 1792152060000,
};
function project(retained: readonly unknown[]) {
  if (FISCAL_HOUR_BACKUP_STATE.kind !== "preparation-history")
    throw new Error("missing public projector");
  return FISCAL_HOUR_BACKUP_STATE.project({ preparations: [], retained });
}
it("combines each retained source without changing its taxpayer or environment", () => {
  expect(
    project([
      { reference: "prepared-hours", complete: true, records: [publicRow] },
      {
        reference: "prepared-hours",
        complete: true,
        records: [{ ...publicRow, taxpayerNif: "OTHER", environment: "production" }],
      },
    ]),
  ).toEqual({
    reference: "prepared-hours",
    complete: true,
    records: [publicRow, { ...publicRow, taxpayerNif: "OTHER", environment: "production" }],
  });
});
it.each([
  null,
  [],
  {},
  { reference: "wrong", complete: true, records: [] },
  { reference: "prepared-hours", complete: false, records: [] },
  { reference: "prepared-hours", complete: true, records: null },
  { reference: "prepared-hours", complete: true, records: [], secret: "never" },
  ...[
    null,
    { ...publicRow, secret: "never" },
    { ...publicRow, kind: "invalid" },
    { ...publicRow, recordedAtMs: -1 },
    { ...publicRow, identity: "S000001" },
    { ...publicRow, nodeId: "" },
    {
      reference: "one",
      kind: "intent",
      taxpayerNif: "NIF",
      environment: "production",
      softwareId: "W1",
      nodeId: "node",
      identity: "06RC",
      wrong: null,
    },
  ].map((row) => ({ reference: "prepared-hours", complete: true, records: [row] })),
])("refuses damaged or private restored projection %#", (value) => {
  expect(() => project([value])).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});

it("whitelists nested scope fields instead of copying a private property", () => {
  const source = publicHourSelectionHistory([
    state({ ...intent(), scope: { ...scope, secret: "NESTED-RAW-KEY" } }),
  ]);
  expect(source.records).toEqual([
    {
      ...scope,
      reference: "intent/fiscal-verifactu/06RB",
      kind: "intent",
      softwareId: "other-software",
      nodeId: "old-node",
      identity: "06RB",
      recordedAtMs: 1792150800000,
    },
  ]);
  expect(JSON.stringify(source)).not.toContain("NESTED-RAW-KEY");
});
