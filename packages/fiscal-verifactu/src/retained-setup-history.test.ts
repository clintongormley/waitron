import { expect, it } from "vitest";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
const scope = { taxpayerNif: "89890001K", softwareId: "W1", environment: "production" };
const history = {
  format: "waitron-paper-register",
  version: 2,
  integrity: "owner-declared",
  registerId: "retired-public-register",
  scope,
  mode: "checkpoint",
  originals: [],
  revisions: [],
  checkpoint: {
    version: 2,
    kind: "declared-burn-checkpoint",
    checkpointId: "typed-42",
    scope,
    sHighWater: 42,
    pHighWater: 7,
    current: {
      currentRegisterConfirmed: true,
      noParallelPaperAllocation: true,
      confirmedAt: "2026-10-16T03:00:00.000Z",
    },
    completeHistoryUnavailable: true,
    burnAllPrior: true,
    createdAt: "2026-10-16T03:00:00.000Z",
  },
};
const known = {
  scope,
  sHighWater: 42,
  pHighWater: 7,
  sBurnFloor: 42,
  pBurnFloor: 7,
  currentHead: null,
  retainedHeads: [],
  originals: [],
  retiredBindings: [],
};
it.each(["sBurnFloor", "pBurnFloor", "sHighWater", "pHighWater"])(
  "a retained current history cannot erase the independently held %s",
  (field) => {
    expect(() =>
      FISCAL_INITIAL_SETUP.retainedAssignments!({
        kind: "paper-declared-standby-confirmation",
        history,
        known: { ...known, [field]: 50 },
      }),
    ).toThrowError(expect.objectContaining({ code: "sif.allocation_invalid" }));
  },
);
it("matching retained current facts preserve both independent paper namespaces", () => {
  expect(
    FISCAL_INITIAL_SETUP.retainedAssignments!({
      kind: "paper-declared-standby-confirmation",
      history,
      known,
    }),
  ).toEqual({
    keys: [],
    positions: [
      { namespace: '["89890001K","W1","production","S"]', position: 42 },
      { namespace: '["89890001K","W1","production","P"]', position: 7 },
    ],
  });
});
