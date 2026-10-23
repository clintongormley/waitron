import { expect, it } from "vitest";
import {
  assertImportedStationTimings,
  assertStationTiming,
  parseStationTimingPatch,
} from "./kitchen-timing.js";

const defaults = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;

it("retains omitted fields and refuses null", () => {
  expect(parseStationTimingPatch({})).toEqual({});
  expect(parseStationTimingPatch({ overdueAfterMinutes: 9, ignored: true })).toEqual({
    overdueAfterMinutes: 9,
  });
  expect(parseStationTimingPatch({ forgottenAfterMinutes: 2_147_483_647 })).toEqual({
    forgottenAfterMinutes: 2_147_483_647,
  });
  for (const field of fields) {
    expect(() => parseStationTimingPatch({ [field]: null })).toThrow(
      expect.objectContaining({ code: "management.request_invalid", params: { field } }),
    );
  }
});

it.each(
  fields.flatMap((field) =>
    [0, -1, 1.5, "3", [], true, NaN, Infinity, 2_147_483_648].map((value) => ({ field, value })),
  ),
)("refuses an invalid $field override: $value", ({ field, value }) => {
  expect(() => parseStationTimingPatch({ [field]: value })).toThrow(
    expect.objectContaining({ code: "management.request_invalid", params: { field } }),
  );
});

it("names the station and the field an edit puts out of order over its stored minutes", () => {
  expect(() =>
    assertStationTiming({ warmAfterMinutes: 7 }, defaults, { id: "station", name: "Grill" }),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "overdueAfterMinutes", stationId: "station", name: "Grill" },
    }),
  );
  expect(() =>
    assertStationTiming({ overdueAfterMinutes: 12 }, defaults, { name: "Grill" }),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "forgottenAfterMinutes", name: "Grill" },
    }),
  );
  expect(() => assertStationTiming({ warmAfterMinutes: 0 }, defaults, { name: "Grill" })).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "warmAfterMinutes", name: "Grill" },
    }),
  );
  expect(() =>
    assertStationTiming({ warmAfterMinutes: undefined }, defaults, { name: "Grill" }),
  ).not.toThrow();
  expect(() =>
    assertStationTiming({ warmAfterMinutes: 2, overdueAfterMinutes: 4 }, defaults, {
      name: "Grill",
    }),
  ).not.toThrow();
});

it("assertImportedStationTimings reads a missing minute as its default and names the first station out of order by name", () => {
  expect(() =>
    assertImportedStationTimings([
      { id: "a", name: "Grill", overdue_after_minutes: 11 },
      { id: "b", name: "Bar", warm_after_minutes: 2, forgotten_after_minutes: 20 },
    ]),
  ).not.toThrow();
  expect(() =>
    assertImportedStationTimings([{ id: "a", name: "Grill", warm_after_minutes: 10 }]),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "overdueAfterMinutes", name: "Grill" },
    }),
  );
  expect(() =>
    assertImportedStationTimings([
      { id: "z", name: "Grill", warm_after_minutes: 0 },
      { id: "y", name: "bar", forgotten_after_minutes: 10 },
      { id: "x", name: "bar", warm_after_minutes: 1.5 },
    ]),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "warmAfterMinutes", name: "bar" },
    }),
  );
  for (const value of [null, "6", 2_147_483_648])
    expect(() =>
      assertImportedStationTimings([{ id: "a", name: "Grill", forgotten_after_minutes: value }]),
    ).toThrow(
      expect.objectContaining({
        code: "station.thresholds_invalid",
        params: { field: "forgottenAfterMinutes", name: "Grill" },
      }),
    );
});

it("assertImportedStationTimings names a station with no text name by an empty name", () => {
  for (const name of [undefined, null, 7])
    expect(() => assertImportedStationTimings([{ id: "a", name, warm_after_minutes: 10 }])).toThrow(
      expect.objectContaining({
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes", name: "" },
      }),
    );
});
