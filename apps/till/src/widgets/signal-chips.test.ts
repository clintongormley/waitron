import { beforeEach, describe, expect, it } from "vitest";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { heldChip, signalChips } from "./signal-chips.js";

beforeEach(() => setLocale("en"));

describe("signalChips", () => {
  it("gives no chip for the signals the floor marks in its own way", () => {
    expect(
      signalChips([
        { kind: "unsent_draft", ownerNames: ["Alex"] },
        { kind: "release_due", groupId: "g2", dueAt: "2026-09-30T20:00:00.000Z" },
        { kind: "needs_clearing", since: "2026-09-30T20:00:00.000Z" },
      ]),
    ).toEqual([]);
  });

  it("gives no chip for held dishes, which the floor draws with their countdown", () => {
    expect(signalChips([{ kind: "held", count: 2 }])).toEqual([]);
  });

  it("says a forgotten wait unless the caller already shows its own Forgotten badge", () => {
    const forgotten = [{ kind: "long_wait" as const, band: "forgotten" as const }];
    expect(signalChips(forgotten)).toEqual([
      { key: "long-wait", text: "Forgotten", tone: "danger" },
    ]);
    expect(signalChips(forgotten, { forgottenShown: true })).toEqual([]);
  });
});

describe("heldChip", () => {
  const now = Date.UTC(2026, 9, 20, 20);
  const held = (count: number) => [{ kind: "held" as const, count }];

  it("gives no chip without held dishes", () => {
    expect(heldChip([{ kind: "take_order" }], now + 240_000, now)).toBeNull();
    expect(heldChip([], Number.POSITIVE_INFINITY, now)).toBeNull();
  });

  it("gives no chip once the dishes are due, which the Time to fire mark shows instead", () => {
    expect(heldChip(held(2), now, now)).toBeNull();
    expect(heldChip(held(2), now - 60_000, now)).toBeNull();
  });

  it("says how many dishes are held when they have no time to fire", () => {
    expect(heldChip(held(2), Number.POSITIVE_INFINITY, now)).toEqual({
      key: "held",
      text: "Held 2",
      tone: "muted",
      icon: "held",
    });
  });

  it("counts down to the time to fire in whole minutes, rounded up", () => {
    expect(heldChip(held(2), now + 240_000, now)?.text).toBe("Held 2 · fire in 4 min");
    expect(heldChip(held(1), now + 1, now)?.text).toBe("Held 1 · fire in 1 min");
  });

  it("says it in Spanish", () => {
    setLocale("es");
    try {
      expect(heldChip(held(2), now + 240_000, now)?.text).toBe(
        es["floor.held_fire_in"].replace("{n}", "2").replace("{m}", "4"),
      );
      expect(heldChip(held(1), Number.POSITIVE_INFINITY, now)?.text).toBe(es["floor.held_one"]);
    } finally {
      setLocale("en");
    }
  });
});
