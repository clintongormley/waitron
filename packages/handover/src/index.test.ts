import { describe, expect, it } from "vitest";
import * as handover from "./index.js";

describe("the package barrel", () => {
  it("exports the envelope, the binding and the order of steps", () => {
    expect(Object.keys(handover).sort()).toEqual([
      "ACTIVATED_OR_LATER",
      "BEFORE_ACTIVATION",
      "HANDOVER_BACKUP_VERIFICATION",
      "HANDOVER_KINDS",
      "HANDOVER_STATES",
      "HANDOVER_TABLES",
      "MODULE_PREPARED_ITEM",
      "NODE_LOCAL_MANIFEST",
      "READY_TO_PROMOTE",
      "assembleIndicator",
      "bindingFingerprint",
      "envelopeDigest",
      "handoverActivations",
      "handoverScenario",
      "initialState",
      "insertHandoverActivationTx",
      "isOpen",
      "isOperationId",
      "isSha256Hex",
      "nextState",
      "parseBinding",
      "parseIndicator",
      "readHandoverActivation",
      "refuseRequest",
      "sha256Hex",
      "signEnvelope",
      "signIndicator",
      "verifyEnvelope",
    ]);
  });
});
