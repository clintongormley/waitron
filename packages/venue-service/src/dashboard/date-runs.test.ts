import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { formatDateRuns } from "./date-runs.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

describe("formatDateRuns", () => {
  it("writes one date, a run in one month and a run across months", () => {
    expect(formatDateRuns(["2027-12-24"])).toBe("24 Dec");
    expect(formatDateRuns(["2027-02-12", "2027-02-13", "2027-02-14", "2027-02-15"])).toBe(
      "12–⁠15 Feb",
    );
    expect(formatDateRuns(["2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02"])).toBe(
      "30 Jan – 2 Feb",
    );
  });

  it("joins runs with commas in date order, each date once, whatever order they come in", () => {
    expect(formatDateRuns(["2026-12-25", "2026-12-14", "2026-12-15", "2026-12-14"])).toBe(
      "14–⁠15 Dec, 25 Dec",
    );
  });

  it("a run over a leap day is one run", () => {
    expect(formatDateRuns(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe("28 Feb – 1 Mar");
  });

  it("writes each date's year when the dates span two years", () => {
    expect(formatDateRuns(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"])).toBe(
      "30 Dec 2026 – 2 Jan 2027",
    );
    expect(formatDateRuns(["2026-12-30", "2026-12-31", "2027-01-06"])).toBe(
      "30–⁠31 Dec 2026, 6 Jan 2027",
    );
  });

  it("no dates is the empty string", () => {
    expect(formatDateRuns([])).toBe("");
  });

  it("in Spanish", () => {
    setLocale("es");
    expect(formatDateRuns(["2027-02-12", "2027-02-13", "2027-02-14", "2027-02-15"])).toBe(
      "12–⁠15 feb",
    );
    expect(formatDateRuns(["2027-01-30", "2027-01-31", "2027-02-01", "2027-02-02"])).toBe(
      "30 ene – 2 feb",
    );
    expect(formatDateRuns(["2026-12-25", "2026-12-14", "2026-12-15"])).toBe("14–⁠15 dic, 25 dic");
    setLocale("en");
  });
});
