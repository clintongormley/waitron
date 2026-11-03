import { describe, expect, it } from "vitest";
import * as handover from "./index.js";

describe("the package barrel", () => {
  it("exports the envelope, the binding and the order of steps", () => {
    expect(Object.keys(handover).sort()).toEqual([
      "HANDOVER_KINDS",
      "HANDOVER_STATES",
      "NODE_LOCAL_MANIFEST",
      "bindingFingerprint",
      "envelopeDigest",
      "initialState",
      "isOpen",
      "nextState",
      "parseBinding",
      "sha256Hex",
      "signEnvelope",
      "verifyEnvelope",
    ]);
  });
});
