import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "box",
        "deleteBoxRowsOtherThanTx",
        "writeBoxSigningKeyTx",
        "NODE_CLASSIFICATION",
        "NODE_MIGRATIONS",
        "HANDOVER_CLOSED_STATES",
        "advanceHandoverOperationTx",
        "appendHandoverEventTx",
        "beginHandoverOperationTx",
        "readHandoverEvent",
        "readHandoverEvents",
        "readHandoverOperation",
        "readHandoverRestriction",
        "readOpenHandoverOperation",
        "recordHandoverRestrictionTx",
        "nodeHandoverEvents",
        "nodeHandoverOperations",
        "nodeHandoverRestriction",
        "nodePairLink",
        "nodeTakeFailures",
        "readMirrorLink",
        "writeMirrorLink",
        "writeMirrorLinkTx",
        "readNodeMode",
        "readNodeModeRow",
        "setNodeMode",
        "setNodeModeTx",
        "setPrimaryRoleTx",
        "setSingletonRole",
        "setSingletonRoleTx",
        "readRecoveryKey",
        "readRecoveryKeyName",
        "readRecoveryKeyVerifier",
        "setRecoveryKeyTx",
        "pinPrimaryKeyTx",
        "readPinnedPrimaryKey",
        "readPairLink",
        "clearTakeFailuresTx",
        "deleteNodeTakeFailuresOtherThanTx",
        "readTakeFailures",
        "recordTakeFailureTx",
      ].sort(),
    );
  });
});
