import { describe, expect, it } from "vitest";
import { FISCAL_NONE_SLOT } from "./slot.js";

describe("FISCAL_NONE_SLOT", () => {
  it("id is none and makeBackend builds a NoneBackend", () => {
    expect(FISCAL_NONE_SLOT.id).toBe("none");
    expect(FISCAL_NONE_SLOT.activationReadiness).toBe("not-applicable");
    const backend = FISCAL_NONE_SLOT.makeBackend({
      db: {} as never,
      clock: {} as never,
      environment: "preproduction",
    });
    expect(backend.id).toBe("none");
  });

  it("drain returns the empty result and contacts no authority", async () => {
    const result = await FISCAL_NONE_SLOT.drain(
      { db: {} as never, ring: {} as never, environment: "preproduction", skipRetryMs: 1 },
      new Date(),
    );
    // toEqual, not toMatchObject: a key toMatchObject never lists is never checked (CLAUDE.md §4),
    // and the whole point is that the none regime submits NOTHING on every counter.
    expect(result).toEqual({
      nextDueAt: null,
      tenantsWithWork: 0,
      batchesSent: 0,
      recordsSubmitted: 0,
      recordsAccepted: 0,
      recordsHalted: 0,
      incidentsRaised: 0,
      skipped: [],
    });
  });

  it("declares no provisioning secret", () => {
    expect(FISCAL_NONE_SLOT.provisioningSecret).toBeUndefined();
  });

  it("offers no venue-field seat: there is no filing format to violate", () => {
    expect(FISCAL_NONE_SLOT.venueFields).toBeUndefined();
  });
});
