import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { dateLabel } from "./format.js";

afterEach(() => setLocale("en"));
it.each([
  ["en", "Sep"],
  ["es", "sep"],
])("uses three-letter short months in the %s Calendar", (language, month) => {
  setLocale(language!);
  expect(dateLabel("2026-09-12")).toContain(month);
});
