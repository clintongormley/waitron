import { describe, expect, it } from "vitest";
import * as handover from "./index.js";

describe("the package barrel", () => {
  it("exports the envelope's functions and kinds", () => {
    expect(Object.keys(handover).sort()).toEqual([
      "HANDOVER_KINDS",
      "envelopeDigest",
      "sha256Hex",
      "signEnvelope",
      "verifyEnvelope",
    ]);
  });
});
