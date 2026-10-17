import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import {
  dateAroundDay,
  format,
  formatDate,
  dayTitleFromParts,
  formatDayHeading,
  formatDayTitleParts,
  formatLongDate,
  formatWeekTitleParts,
  formatWeekday,
} from "./hours-view.js";

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

describe("formatWeekTitleParts and formatDayHeading", () => {
  const joined = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

  it("names a week within one month", () => {
    const parts = formatWeekTitleParts("2026-10-12", "2026-10-18", "en");
    expect(joined(parts)).toBe("12 – 18 Oct 2026");
    expect(parts.filter((p) => p.month)).toEqual([{ text: "Oct", month: "2026-10" }]);
    expect(parts.filter((p) => p.year)).toEqual([{ text: "2026", year: 2026 }]);
    expect(joined(formatWeekTitleParts("2026-10-12", "2026-10-18", "es"))).toBe("12–18 oct 2026");
  });

  it("names a week across two months and two years", () => {
    const parts = formatWeekTitleParts("2026-09-28", "2026-10-04", "en");
    expect(joined(parts)).toBe("28 Sept – 4 Oct 2026");
    expect(parts.flatMap((p) => p.month ?? [])).toEqual(["2026-09", "2026-10"]);
    const years = formatWeekTitleParts("2026-12-28", "2027-01-03", "es");
    expect(joined(years)).toBe("28 dic 2026 – 3 ene 2027");
    expect(years.flatMap((p) => p.year ?? [])).toEqual([2026, 2027]);
    expect(years.flatMap((p) => p.month ?? [])).toEqual(["2026-12", "2027-01"]);
  });

  it("uses the dashboard's language when none is given", () => {
    setLocale("es");
    try {
      expect(joined(formatWeekTitleParts("2026-10-12", "2026-10-18"))).toBe("12–18 oct 2026");
    } finally {
      setLocale("en");
    }
  });

  it("heads a day with its weekday, day and short month", () => {
    expect(formatDayHeading("2026-10-12")).toBe("Mon 12 Oct");
  });
});

it("splits a phone's day title into the day's link and the month's", () => {
  expect(formatDayTitleParts("2026-12-01", "en")).toEqual([
    { text: "Tue 1", day: true },
    { text: " " },
    { text: "Dec", month: "2026-12" },
  ]);
  expect(formatDayTitleParts("2026-12-01", "es")).toEqual([
    { text: "Mar, 1", day: true },
    { text: " " },
    { text: "dic", month: "2026-12" },
  ]);
});

it("keeps the month out of the day's link where it falls between the weekday and the day", () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(new Date("2026-12-01T00:00:00Z"));
  expect(parts.map((part) => part.value).join("")).toBe("Tue, Dec 1");
  expect(dayTitleFromParts(parts, "2026-12-01")).toEqual([
    { text: "Tue" },
    { text: ", " },
    { text: "Dec", month: "2026-12" },
    { text: " " },
    { text: "1", day: true },
  ]);
});
