import { describe, expect, it } from "vitest";
import { reminderDueAt } from "./release-reminder.js";

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
