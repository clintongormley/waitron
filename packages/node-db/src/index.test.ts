import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "NODE_CLASSIFICATION",
        "NODE_MIGRATIONS",
        "nodeMirrorLink",
        "nodeMode",
        "nodePrimaryKey",
        "nodeRecoveryKey",
        "nodeSigningKey",
        "readMirrorLink",
        "writeMirrorLink",
        "writeMirrorLinkTx",
        "readNodeMode",
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
      ].sort(),
    );
  });
});
