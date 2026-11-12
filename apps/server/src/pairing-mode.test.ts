import { describe, expect, it, vi } from "vitest";
import { PAIRING_HOLD_MS, createPairingMode } from "./pairing-mode.js";
import { LiveEvents } from "./live-api.js";

function atClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const ids = () => {
  let n = 0;
  return () => `hold-${++n}`;
};

describe("createPairingMode", () => {
  it("publishes opening, renewal, claims and release to the live bus", () => {
    const bus = new LiveEvents();
    const seen: string[] = [];
    bus.subscribe((event) => {
      if (event.kind === "change") seen.push(...event.change.resources.map((r) => r.type));
    });
    const mode = createPairingMode({
      changed: () => bus.publish({ resources: [{ type: "pairing" }] }),
    });
    const { holdId } = mode.open();
    expect(seen).toEqual(["pairing"]);
    mode.renew(holdId);
    mode.claim("request-1", { holdId, sessionKey: "key", personName: "Alex" });
    expect(seen).toEqual(["pairing", "pairing", "pairing"]);
    mode.release(holdId);
    mode.dropClaim("request-1");
    expect(seen).toEqual(["pairing", "pairing", "pairing", "pairing", "pairing"]);
  });

  it("publishes a hold's lapse without waiting for a reader", async () => {
    vi.useFakeTimers();
    const bus = new LiveEvents();
    const seen: string[] = [];
    bus.subscribe((event) => {
      if (event.kind === "change") seen.push(...event.change.resources.map((r) => r.type));
    });
    const mode = createPairingMode({
      holdMs: 1000,
      changed: () => bus.publish({ resources: [{ type: "pairing" }] }),
    });
    try {
      mode.open();
      await vi.advanceTimersByTimeAsync(999);
      expect(seen).toEqual(["pairing"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(seen).toEqual(["pairing", "pairing"]);
      expect(mode.isOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

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
    const claim = { holdId, sessionKey: "k", personName: "Anna" };
    mode.claim("r1", claim);
    expect(mode.claimOf("r1")).toEqual(claim);
    expect(mode.orphanedClaims()).toEqual([]);
    mode.release(holdId);
    expect(mode.claimOf("r1")).toBeUndefined();
    expect(mode.orphanedClaims()).toEqual(["r1"]);
    mode.dropClaim("r1");
    expect(mode.orphanedClaims()).toEqual([]);
  });

  it("a claim is orphaned once its hold lapses on the clock, with no other read first", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    mode.claim("r1", { holdId, sessionKey: "k", personName: "Anna" });
    clock.advance(PAIRING_HOLD_MS);
    expect(mode.orphanedClaims()).toEqual(["r1"]);
  });

  it("openUntil is null when it is the first read after the last hold lapses", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    mode.open();
    clock.advance(PAIRING_HOLD_MS);
    expect(mode.openUntil()).toBeNull();
  });

  it("shuts when the clock steps back, leaving its hold further ahead than its length", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    mode.claim("r1", { holdId, sessionKey: "k", personName: "Anna" });
    clock.advance(-400 * 24 * 60 * 60 * 1000);
    expect(mode.isOpen()).toBe(false);
    expect(mode.hasHold(holdId)).toBe(false);
    expect(mode.openSince()).toBeNull();
    expect(mode.orphanedClaims()).toEqual(["r1"]);
    expect(mode.renew(holdId)).toBeNull();
  });

  it("stays open after a step back that leaves its hold no further ahead than its length", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now, newId: ids() });
    const { holdId } = mode.open();
    clock.advance(30_000);
    clock.advance(-30_000);
    expect(mode.isOpen()).toBe(true);
    expect(mode.hasHold(holdId)).toBe(true);
  });
});
