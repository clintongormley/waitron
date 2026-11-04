import { describe, expect, it } from "vitest";
import * as handover from "./index.js";

describe("the package barrel", () => {
  it("exports the envelope, the binding and the order of steps", () => {
    expect(Object.keys(handover).sort()).toEqual([
      "HANDOVER_CLASSIFICATION",
      "HANDOVER_KINDS",
      "HANDOVER_MIGRATIONS",
      "HANDOVER_STATES",
      "NODE_LOCAL_MANIFEST",
      "assembleIndicator",
      "bindingFingerprint",
      "envelopeDigest",
      "handoverActivations",
      "handoverScenario",
      "initialState",
      "insertHandoverActivationTx",
      "isOpen",
      "nextState",
      "parseBinding",
      "readActivationRows",
      "readHandoverActivation",
      "sha256Hex",
      "signEnvelope",
      "signIndicator",
      "verifyEnvelope",
    ]);
  });
});
