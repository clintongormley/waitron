import { describe, expect, it } from "vitest";
import { VENUE_SERVICE_CLASSIFICATION } from "./classification.js";

describe("VENUE_SERVICE_CLASSIFICATION", () => {
  it("classifies the service settings and kitchen notices as replicated state", () => {
    expect(
      VENUE_SERVICE_CLASSIFICATION.filter((entry) =>
        ["service_settings", "kitchen_notices"].includes(entry.table),
      ).map((entry) => [entry.table, entry.class]),
    ).toEqual([
      ["service_settings", "state"],
      ["kitchen_notices", "state"],
    ]);
  });

  it("classifies each owned table once as replicated state", () => {
    const tables = VENUE_SERVICE_CLASSIFICATION.map((entry) => entry.table);
    expect(new Set(tables).size).toBe(tables.length);
    expect(VENUE_SERVICE_CLASSIFICATION.every((entry) => entry.class === "state")).toBe(true);
    expect(VENUE_SERVICE_CLASSIFICATION.every((entry) => entry.reason.trim().length > 0)).toBe(
      true,
    );
  });
});
