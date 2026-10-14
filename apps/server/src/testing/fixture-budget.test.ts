import { describe, expect, it } from "vitest";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import { fixtureBudget } from "./fixture-budget.js";

function budget() {
  const events: object[] = [];
  const built = fixtureBudget(
    (event) => events.push(event),
    (detail) => new Error(`refused: ${detail}`),
  );
  return { built, events };
}

describe("fixtureBudget", () => {
  it.each([
    ["a fraction", 1.5],
    ["a negative", -5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s as a count or a byte size, records nothing and spends nothing", (_, value) => {
    const { built, events } = budget();
    expect(() => built.reserveObjects(value)).toThrow(
      "refused: count must be a non-negative integer",
    );
    expect(() => built.reserveUpload(value, "archive")).toThrow(
      "refused: bytes must be a non-negative integer",
    );
    expect(events).toEqual([]);
    built.reserveObjects(AWS_REHEARSAL_LIMITS.deleteObjects);
    built.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes, "archive");
    built.reserveUpload(
      AWS_REHEARSAL_LIMITS.uploadedBytes - AWS_REHEARSAL_LIMITS.archiveBytes,
      "delete-object",
    );
    expect(events).toEqual([]);
  });

  it("refuses an archive over its own limit and records it, spending nothing", () => {
    const { built, events } = budget();
    expect(() => built.reserveUpload(AWS_REHEARSAL_LIMITS.archiveBytes + 1, "archive")).toThrow(
      "refused: an archive fixture is over its byte limit",
    );
    expect(events).toEqual([
      {
        scenario: "lifecycle",
        phase: "fixture-limit",
        objectRole: "archive",
        bytes: AWS_REHEARSAL_LIMITS.archiveBytes + 1,
        outcome: "refused",
      },
    ]);
    built.reserveUpload(AWS_REHEARSAL_LIMITS.uploadedBytes, "delete-object");
  });

  it("refuses an upload past the total byte budget and records it", () => {
    const { built, events } = budget();
    built.reserveUpload(AWS_REHEARSAL_LIMITS.uploadedBytes - 1, "delete-object");
    expect(() => built.reserveUpload(2, "delete-object")).toThrow(
      "refused: the upload budget is spent",
    );
    expect(events).toEqual([
      {
        scenario: "lifecycle",
        phase: "fixture-limit",
        objectRole: "delete-object",
        bytes: 2,
        outcome: "refused",
      },
    ]);
    built.reserveUpload(1, "delete-object");
  });

  it("refuses objects past 1,005 in total and records it", () => {
    const { built, events } = budget();
    built.reserveObjects(1000);
    built.reserveObjects(5);
    expect(() => built.reserveObjects(1)).toThrow("refused: the object budget is spent");
    expect(events).toEqual([
      { scenario: "lifecycle", phase: "fixture-limit", count: 1, outcome: "refused" },
    ]);
  });
});
