import { describe, expect, it } from "vitest";
import { PAIRING_HOLD_MS, createPairingMode } from "./pairing-mode.js";

function atClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const ids = () => {
  let n = 0;
  return () => `hold-${++n}`;
};

describe("createPairingMode", () => {
  it("is shut on a fresh holder — a restart never inherits an open door", () => {
    const mode = createPairingMode();
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
    expect(mode.openSince()).toBeNull();
  });

  it("a hold opens the window until it lapses", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId, openUntil } = mode.open();
    expect(holdId).toBe("hold-1");
    expect(Date.parse(openUntil)).toBe(1_000 + PAIRING_HOLD_MS);
    clock.advance(PAIRING_HOLD_MS - 1);
    expect(mode.isOpen()).toBe(true);
    clock.advance(1);
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
    expect(mode.hasHold(holdId)).toBe(false);
  });

  it("renewing a live hold moves its lapse; an unknown or lapsed hold is refused", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    clock.advance(PAIRING_HOLD_MS - 10);
    expect(mode.renew(holdId)).toEqual({
      openUntil: new Date(clock.now() + PAIRING_HOLD_MS).toISOString(),
    });
    expect(mode.renew("nope")).toBeNull();
    clock.advance(PAIRING_HOLD_MS);
    expect(mode.renew(holdId)).toBeNull();
  });

  it("releasing one hold leaves the window open while another is live", () => {
    const mode = createPairingMode({ newId: ids() });
    const a = mode.open();
    mode.open();
    mode.release(a.holdId);
    expect(mode.isOpen()).toBe(true);
  });

  it("the window shuts when its last hold is released", () => {
    const mode = createPairingMode({ newId: ids() });
    const a = mode.open();
    mode.release(a.holdId);
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
    expect(mode.openSince()).toBeNull();
  });

  it("openSince stays at the start of an unbroken open period and restarts after a shut", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const a = mode.open();
    clock.advance(1_000);
    mode.open();
    mode.release(a.holdId);
    expect(mode.openSince()).toBe(new Date(1_000).toISOString());
    clock.advance(2 * PAIRING_HOLD_MS);
    expect(mode.openSince()).toBeNull();
    mode.open();
    expect(mode.openSince()).toBe(new Date(clock.now()).toISOString());
  });

  it("openUntil is the latest live hold's lapse", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    mode.open();
    clock.advance(5_000);
    const later = mode.open();
    expect(mode.openUntil()).toBe(later.openUntil);
  });

  it("a claim lives as long as its hold, then is orphaned until dropped", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    const claim = { holdId, sessionKey: "k", personName: "Ana" };
    mode.claim("r1", claim);
    expect(mode.claimOf("r1")).toEqual(claim);
    expect(mode.orphanedClaims()).toEqual([]);
    mode.release(holdId);
    expect(mode.claimOf("r1")).toBeUndefined();
    expect(mode.orphanedClaims()).toEqual(["r1"]);
    mode.dropClaim("r1");
    expect(mode.orphanedClaims()).toEqual([]);
  });
});
