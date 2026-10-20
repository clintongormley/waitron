import { describe, expect, it } from "vitest";
import { minutesToFire, nextCountdownChange, reminderDueAt } from "./release-reminder.js";

describe("reminderDueAt", () => {
  it("reads a reminder whose time cannot be read as never due", () => {
    expect(reminderDueAt({ groupId: "g-1", dueAt: "not a time" })).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads a readable time as the moment it names", () => {
    expect(reminderDueAt({ groupId: "g-1", dueAt: "2026-10-03T12:00:00.000Z" })).toBe(
      Date.UTC(2026, 9, 3, 12),
    );
  });
});

const D = Date.UTC(2026, 9, 20, 20);

describe("minutesToFire", () => {
  it("rounds the time left up to whole minutes", () => {
    expect(minutesToFire(D, D - 240_000)).toBe(4);
    expect(minutesToFire(D, D - 240_001)).toBe(5);
    expect(minutesToFire(D, D - 241_000)).toBe(5);
    expect(minutesToFire(D, D - 239_999)).toBe(4);
  });

  it("reads the last minute as one minute", () => {
    expect(minutesToFire(D, D - 60_000)).toBe(1);
    expect(minutesToFire(D, D - 1)).toBe(1);
  });
});

describe("nextCountdownChange", () => {
  it("is the moment the shown minutes next drop", () => {
    expect(nextCountdownChange(D, D - 240_001)).toBe(D - 240_000);
    expect(nextCountdownChange(D, D - 240_000)).toBe(D - 180_000);
  });

  it("is the due time itself in the last minute", () => {
    expect(nextCountdownChange(D, D - 30_000)).toBe(D);
  });
});
