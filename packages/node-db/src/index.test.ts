import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "NODE_CLASSIFICATION",
        "NODE_MIGRATIONS",
        "HANDOVER_CLOSED_STATES",
        "advanceHandoverOperationTx",
        "appendHandoverEventTx",
        "beginHandoverOperationTx",
        "readHandoverEvent",
        "readHandoverOperation",
        "readHandoverRestriction",
        "readOpenHandoverOperation",
        "recordHandoverRestrictionTx",
        "nodeHandoverEvents",
        "nodeHandoverOperations",
        "nodeHandoverRestriction",
        "nodeMirrorLink",
        "nodeMode",
        "nodePairLink",
        "nodePrimaryKey",
        "nodeRecoveryKey",
        "nodeSigningKey",
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
        "deleteNodeMirrorLinkOtherThanTx",
        "deleteNodeModeOtherThanTx",
        "deleteNodePrimaryKeyOtherThanTx",
        "deleteNodeRecoveryKeyOtherThanTx",
      ].sort(),
    );
  });
});
