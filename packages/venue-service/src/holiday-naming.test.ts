import { describe, expect, it } from "vitest";
import { holidayDateName } from "./holiday-naming.js";
import type { HolidayFact, LocalDate } from "./hours-types.js";

// Invented facts: nothing here claims a real public holiday.
const fact = (
  id: string,
  date: LocalDate,
  name: string,
  scope: HolidayFact["scope"],
): HolidayFact => ({ id, date, name, scope, sourceId: `source-${id}` });

const TARGET = "2026-06-24";
const NATIONAL = fact("n", TARGET, "National label", "national");
const REGIONAL = fact("r", TARGET, "Regional label", "regional");
const TOWN = fact("t", TARGET, "Town label", "local");

describe("a date's holiday name", () => {
  it("joins every label national, regional, then local, whatever order the facts arrive in", () => {
    const expected = "National label · Regional label · Town label";
    for (const facts of [
      [NATIONAL, REGIONAL, TOWN],
      [TOWN, REGIONAL, NATIONAL],
      [REGIONAL, TOWN, NATIONAL],
    ])
      expect(holidayDateName(facts, TARGET, "Summer opening")).toBe(expected);
  });

  it("orders two labels of one scope by fact id", () => {
    const facts = [fact("b", TARGET, "Second", "regional"), fact("a", TARGET, "First", "regional")];
    expect(holidayDateName(facts, TARGET, "Summer opening")).toBe("First · Second");
  });

  it("keeps the original name when the date has no holiday", () => {
    expect(holidayDateName([], TARGET, "Summer opening")).toBe("Summer opening");
  });

  it("ignores another date's labels, the source date's included", () => {
    const source = fact("s", "2026-06-23", "Source-date label", "national");
    expect(holidayDateName([source], TARGET, "Summer opening")).toBe("Summer opening");
    expect(holidayDateName([source, TOWN], TARGET, "Summer opening")).toBe("Town label");
  });

  it("shows identical text once, and the same fact repeated once", () => {
    const sameText = fact("t2", TARGET, "National label", "local");
    expect(holidayDateName([NATIONAL, sameText, NATIONAL, REGIONAL], TARGET, "x")).toBe(
      "National label · Regional label",
    );
  });

  it("falls back to the canonical date a caller passes as the original", () => {
    expect(holidayDateName([], TARGET, TARGET)).toBe("2026-06-24");
  });

  it("keeps every label in full, however long the joined name", () => {
    const long = (letter: string) => letter.repeat(200);
    const facts = [
      fact("a", TARGET, long("a"), "national"),
      fact("b", TARGET, long("b"), "regional"),
      fact("c", TARGET, long("c"), "local"),
    ];
    expect(holidayDateName(facts, TARGET, "x")).toBe(`${long("a")} · ${long("b")} · ${long("c")}`);
  });
});
