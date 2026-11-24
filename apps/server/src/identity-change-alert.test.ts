import { describe, expect, it } from "vitest";
import {
  identityChangeBlocked,
  identityChangeBlockedAlertSource,
} from "./identity-change-alert.js";
import type { IdentityChangeRefusal } from "./identity-change-opening.js";
import { startClockState } from "./start-clock-check.js";
import { standingHold } from "./testing/standing-hold.js";

const NOW = new Date("2026-11-24T10:00:00.000Z");

function blocked(refusal: IdentityChangeRefusal | null, held = true): boolean {
  const state = startClockState();
  state.holdForIdentityChange(standingHold());
  if (held) state.confirm("by_internet", {});
  return identityChangeBlocked({ state, latestRefusal: () => refusal });
}

describe("sif.identity_change_blocked", () => {
  it("is raised, to a system manager, while a confirmation is held and the latest refusal is blocked", async () => {
    const source = identityChangeBlockedAlertSource(() =>
      blocked({ kind: "blocked", reason: "not_sole_primary" }),
    );
    expect([source.area, source.permission]).toEqual(["box", "system.manage"]);
    expect(await source.read({ tx: {} as never, now: NOW })).toEqual([
      {
        key: "sif.identity_change_blocked",
        code: "sif.identity_change_blocked",
        severity: "error",
        since: null,
        screen: "box-status",
        params: {},
      },
    ]);
  });

  it.each([
    ["for the clock", { kind: "clock", reason: "second_clock_missing" }, true],
    ["by a minute already used", { kind: "retry", reason: "minute_in_use" }, true],
    ["by nothing yet", null, true],
    ["with no confirmation held", { kind: "blocked", reason: "not_sole_primary" }, false],
  ] as const)("is not raised when refused %s", async (_label, refusal, held) => {
    const source = identityChangeBlockedAlertSource(() => blocked(refusal, held));
    expect(await source.read({ tx: {} as never, now: NOW })).toEqual([]);
  });
});
