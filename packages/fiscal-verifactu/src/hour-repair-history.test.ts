import { expect, it } from "vitest";
import { FISCAL_HOUR_BACKUP_STATE } from "./hour-backup-state.js";
import { hourSetupInput } from "./hour-preparation.js";
import { projectHourHistory } from "./hour-history.js";
import type { InitialSetupContext } from "@waitron/module";

const scope = { taxpayerNif: "89890001K", environment: "preproduction" } as const;
const row = {
  ...scope,
  reference: "retained-db/activation",
  kind: "activation",
  softwareId: "older-software",
  nodeId: "another-node",
  identity: "0CNPH",
  recordedAtMs: 1792152060000,
};
function project(recovery: unknown, retained: readonly unknown[] = []) {
  if (FISCAL_HOUR_BACKUP_STATE.kind !== "preparation-history") throw new Error("missing seat");
  return FISCAL_HOUR_BACKUP_STATE.project({ preparations: [], retained, recovery } as Parameters<
    typeof FISCAL_HOUR_BACKUP_STATE.project
  >[0]);
}
const source = { reference: "surviving-venue/hash", complete: true, records: [row] };
it("carries surviving database names and their time floor into a second recovery without private fields", () => {
  const first = project({
    history: [{ ...source, timeFloorMs: 1792152105000, privatePath: "/private/old" }],
    setups: [],
    publicEvidence: [],
  });
  expect(first).toEqual({
    reference: "prepared-hours",
    complete: true,
    records: [row],
    timeFloorMs: 1792152105000,
  });
  const second = project({ history: [], setups: [], publicEvidence: [] }, [first]);
  expect(projectHourHistory({ scope, sources: [second] })).toMatchObject({
    greatestSpentMinute: 415441,
    recordedTimeFloorMs: 1792152105000,
    contradictions: [],
  });
  expect(JSON.stringify(second)).not.toContain("/private/old");
});
it.each([
  { ...source, complete: false },
  { ...source, records: [{ ...row, identity: "unknown-name" }] },
  { ...source, records: [{ ...row, recordedAtMs: NaN }] },
])(
  "refuses incomplete or ambiguous surviving history instead of exporting an empty floor %#",
  (history) => {
    expect(() => project({ history: [history], setups: [], publicEvidence: [] })).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "history_invalid" },
      }),
    );
  },
);
function setup() {
  const binding = {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "retained-setup",
    sourceId: "first-setup:old-attempt",
    targetNodeId: "old-node",
  };
  const selected = {
    binding,
    scope,
    bases: [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
    identity: "0CNPH",
    issuedAt: "2026-10-16T12:01:00.000Z",
  };
  const input = hourSetupInput(selected, "private-owner");
  const context: InitialSetupContext = {
    attemptId: "old-attempt",
    binding,
    administratorId: "private-owner",
    country: "ES",
    taxId: scope.taxpayerNif,
    environment: scope.environment,
    recipientVenueId: binding.sourceId,
    bases: selected.bases,
    request: { kind: "waitron-hour-setup", status: "selected", identity: "0CNPH", input },
  };
  return { context, input };
}
it("preserves a setup selection even when its preparation journal is missing", () => {
  const value = project({ history: [], setups: [setup()], publicEvidence: [] });
  expect(projectHourHistory({ scope, sources: [value] })).toMatchObject({
    greatestSpentMinute: 415441,
    contradictions: [],
  });
  expect(value).toMatchObject({
    records: [
      expect.objectContaining({ identity: "0CNPH", kind: "workspace", nodeId: "old-node" }),
    ],
  });
  expect(JSON.stringify(value)).not.toMatch(
    /private-owner|first-setup:old-attempt|approval|operatorId/,
  );
});
it("does not spend an unselected setup, but refuses a selected request with a mismatching input", () => {
  const held = setup();
  expect(
    project({
      history: [],
      setups: [{ context: { ...held.context, request: undefined }, input: undefined }],
      publicEvidence: [],
    }),
  ).toEqual({ reference: "prepared-hours", complete: true, records: [] });
  expect(() =>
    project({ history: [], setups: [{ ...held, input: {} }], publicEvidence: [] }),
  ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
});
it("retains declared public hour evidence without copying its container or private context", () => {
  const value = project({
    history: [],
    setups: [],
    publicEvidence: [
      { format: "waitron-hour-history", scope, sources: [source], private: "private-owner" },
    ],
  });
  expect(projectHourHistory({ scope, sources: [value] })).toMatchObject({
    greatestSpentMinute: 415441,
    contradictions: [],
  });
  expect(JSON.stringify(value)).not.toMatch(/private-owner|waitron-hour-history/);
});
it("refuses unprojectable public evidence instead of assuming it contains no spent names", () => {
  expect(() =>
    project({ history: [], setups: [], publicEvidence: [{ history: "unknown legacy evidence" }] }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});
it("validates a public recovery-key document and retains only its creation floor", () => {
  const document = {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { ...scope, softwareId: "W1" },
    taxpayerName: "Private business",
    venueName: "Private venue",
    createdAt: "2026-10-16T12:01:45.000Z",
    nodeKey: { nodeId: "node", name: "named-key" },
  };
  expect(project({ history: [], setups: [], publicEvidence: [document] })).toEqual({
    reference: "prepared-hours",
    complete: true,
    records: [],
    timeFloorMs: 1792152105000,
  });
  expect(() =>
    project({
      history: [],
      setups: [],
      publicEvidence: [{ ...document, nodeKey: { ...document.nodeKey, secret: "not public" } }],
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});

it("does not replace an explicit null retained input with the selected request's input", () => {
  expect(() =>
    project({ history: [], setups: [{ ...setup(), input: null }], publicEvidence: [] }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});
it("can recover a selected request without its separate input row, while an unselected wait spends no name", () => {
  const selected = setup();
  expect(
    projectHourHistory({
      scope,
      sources: [
        project({ history: [], setups: [{ ...selected, input: undefined }], publicEvidence: [] }),
      ],
    }),
  ).toMatchObject({ greatestSpentMinute: 415441, contradictions: [] });
  expect(
    project({
      history: [],
      setups: [
        {
          context: { ...selected.context, request: { status: "waiting", targetMs: 1792152060000 } },
          input: undefined,
        },
      ],
      publicEvidence: [],
    }),
  ).toEqual({ reference: "prepared-hours", complete: true, records: [] });
});
it.each([
  null,
  { format: "waitron-hour-history", scope, sources: [{ ...source, complete: false }] },
  { format: "waitron-hour-history", scope, sources: null },
])("refuses malformed or incomplete declared public history %#", (value) => {
  expect(() => project({ history: [], setups: [], publicEvidence: [value] })).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});
