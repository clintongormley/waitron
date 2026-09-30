import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { signalChips } from "./signal-chips.js";

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

  it("says a forgotten wait unless the caller already shows its own Forgotten badge", () => {
    const forgotten = [{ kind: "long_wait" as const, band: "forgotten" as const }];
    expect(signalChips(forgotten)).toEqual([
      { key: "long-wait", text: "Forgotten", tone: "danger" },
    ]);
    expect(signalChips(forgotten, { forgottenShown: true })).toEqual([]);
  });
});
