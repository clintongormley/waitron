import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_SLOT, rejectResolveClient } from "./slot.js";

// `makeBackend` only CONSTRUCTS the backend (no connection is opened until a method runs).
const STUB_DB = {} as Database;
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("slot.test: anchor() is unused");
  },
  currentAnchor: () => null,
};

describe("FISCAL_SLOT", () => {
  it("builds a VerifactuBackend whose id is the slot's id", () => {
    const backend = FISCAL_SLOT.makeBackend({ db: STUB_DB, clock, environment: "preproduction" });
    expect(backend).toBeInstanceOf(VerifactuBackend);
    expect(backend.id).toBe(FISCAL_SLOT.id);
    expect(FISCAL_SLOT.id).toBe("verifactu");
  });

  it("never resolves an AEAT client on the sale path", async () => {
    await expect(rejectResolveClient()).rejects.toThrow(/never be called/);
  });
});
