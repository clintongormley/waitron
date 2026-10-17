import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { dateAroundDay, format, formatDate, formatLongDate, formatWeekday } from "./hours-view.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

it("fills each placeholder from its value", () => {
  expect(format("prep.station_reordered", { name: "Bar", index: "2", total: "3" })).toBe(
    "Bar is now 2 of 3.",
  );
});

it("inserts a value containing $& as written", () => {
  expect(format("prep.station_reordered", { name: "Bar $&", index: "2 $'", total: "3" })).toBe(
    "Bar $& is now 2 $' of 3.",
  );
});

it("does not fill a placeholder that arrived inside another value", () => {
  expect(format("prep.station_reordered", { name: "Bar {index}", index: "2", total: "3" })).toBe(
    "Bar {index} is now 2 of 3.",
  );
});

it("leaves a placeholder with no value as it is", () => {
  expect(format("prep.station_reordered", { name: "Bar" })).toBe("Bar is now {index} of {total}.");
});

it.each([
  "cellText",
  "unbrokenRanges",
  "keyOf",
  "isDefaultStation",
  "weekCellOf",
  "standardText",
  "storedCells",
  "dateValue",
])(
  "the shared date formatter no longer offers the retired station-hours renderer %s",
  async (method) => {
    const api = await import("./hours-view.js");
    expect(api).not.toHaveProperty(method);
  },
);

it("names a weekday narrow or in full, and follows a change of language", () => {
  expect(formatWeekday("2024-01-01", "narrow")).toBe("M");
  expect(formatWeekday("2024-01-01", "long")).toBe("Monday");
  expect(formatDate("2026-10-12")).toBe("Mon, 12 Oct 2026");
  expect(formatLongDate("2026-10-12")).toBe("Monday, 12 October 2026");
  setLocale("es");
  expect(formatWeekday("2024-01-01", "narrow")).toBe("L");
  expect(formatWeekday("2024-01-01", "long")).toBe("lunes");
  expect(formatDate("2026-10-12")).toBe("lun, 12 oct 2026");
  expect(formatLongDate("2026-10-12")).toBe("lunes, 12 de octubre de 2026");
  setLocale("en");
  expect(formatLongDate("2026-10-12")).toBe("Monday, 12 October 2026");
});

it("splits a date at its day number in each language's own order", () => {
  const long = { weekday: "long", day: "numeric", month: "long", year: "numeric" } as const;
  expect(dateAroundDay("2026-12-08", long)).toEqual({
    before: "Tuesday, ",
    after: " December 2026",
  });
  setLocale("es");
  expect(dateAroundDay("2026-12-08", long)).toEqual({
    before: "martes, ",
    after: " de diciembre de 2026",
  });
  expect(dateAroundDay("2026-12-08", { day: "numeric", month: "long" })).toEqual({
    before: "",
    after: " de diciembre",
  });
});
