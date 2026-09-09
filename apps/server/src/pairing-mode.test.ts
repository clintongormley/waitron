import { describe, expect, it } from "vitest";
import { PAIRING_WINDOW_MS, REFUSED_WINDOW_MS, createPairingMode } from "./pairing-mode.js";

/** A controllable clock — no sleeping, the shape `enrol-rate-limit.test.ts` uses. */
function atClock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createPairingMode", () => {
  it("is CLOSED on a fresh holder — a restart or a promotion never inherits an open door", () => {
    expect(createPairingMode().isOpen()).toBe(false);
    expect(createPairingMode().openUntil()).toBeNull();
  });

  it("opens for the window and closes when it lapses", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.open();
    expect(mode.isOpen()).toBe(true);
    clock.advance(PAIRING_WINDOW_MS - 1);
    expect(mode.isOpen()).toBe(true);
    clock.advance(2);
    expect(mode.isOpen()).toBe(false);
  });

  it("open() on an open window EXTENDS it rather than starting a second one", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.open();
    clock.advance(PAIRING_WINDOW_MS - 1_000);
    const { openUntil } = mode.open();
    clock.advance(PAIRING_WINDOW_MS - 1_000);
    expect(mode.isOpen()).toBe(true);
    expect(Date.parse(openUntil)).toBe(clock.now() + 1_000);
  });

  it("close() shuts it immediately", () => {
    const mode = createPairingMode();
    mode.open();
    mode.close();
    expect(mode.isOpen()).toBe(false);
    expect(mode.openUntil()).toBeNull();
  });

  it("counts refused knocks and forgets them after the refused window", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    mode.noteRefused();
    mode.noteRefused();
    expect(mode.refusedRecently()).toBe(2);
    clock.advance(REFUSED_WINDOW_MS + 1);
    expect(mode.refusedRecently()).toBe(0);
  });

  it("reports openUntil only while open", () => {
    const clock = atClock();
    const mode = createPairingMode({ now: clock.now });
    const { openUntil } = mode.open();
    expect(mode.openUntil()).toBe(openUntil);
    clock.advance(PAIRING_WINDOW_MS + 1);
    expect(mode.openUntil()).toBeNull();
  });
});
