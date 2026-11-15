import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import {
  calendarDate,
  dateAroundDay,
  dateFormat,
  dateLabel,
  monthDay,
  weekTitleParts,
} from "./format.js";

afterEach(() => setLocale("en"));
it.each([
  ["en", "Sep"],
  ["es", "sep"],
])("uses three-letter short months in the %s Calendar", (language, month) => {
  setLocale(language!);
  expect(
    calendarDate("2026-09-12", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  ).toMatch(new RegExp(`12 ${month} 2026$`));
  expect(monthDay("09-12")).toBe(`12 ${month}`);
  expect(dateLabel("2026-09-12")).toContain(month);
  const parts = weekTitleParts("2026-09-28");
  expect(parts.find((part) => part.month === "2026-09")).toEqual({ text: month, month: "2026-09" });
  expect(dateAroundDay("2026-09-12", dateFormat({ day: "numeric", month: "short" })).after).toBe(
    ` ${month}`,
  );
});
