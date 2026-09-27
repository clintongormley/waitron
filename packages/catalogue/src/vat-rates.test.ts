import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import {
  VAT_RATE_TABLE,
  localCalendarDate,
  vatRateOn,
  vatRatesOn,
  type VatRateTable,
} from "./vat-rates.js";

// A release that ships a new general rate from 2027-01-01.
const WITH_CHANGE: VatRateTable = {
  ...VAT_RATE_TABLE,
  general: [
    { from: null, rate: "21.00" },
    { from: "2027-01-01", rate: "23.00" },
  ],
};

describe("vatRateOn", () => {
  it("gives today's four rates from the shipped table", () => {
    expect(vatRateOn("general", "2026-09-27")).toBe(decimal("21.00"));
    expect(vatRateOn("reduced", "2026-09-27")).toBe(decimal("10.00"));
    expect(vatRateOn("super_reduced", "2026-09-27")).toBe(decimal("4.00"));
    expect(vatRateOn("zero", "2026-09-27")).toBe(decimal("0.00"));
  });

  it("a future-dated entry changes nothing before its date and applies from the date itself", () => {
    expect(vatRateOn("general", "2026-12-31", WITH_CHANGE)).toBe(decimal("21.00"));
    expect(vatRateOn("general", "2027-01-01", WITH_CHANGE)).toBe(decimal("23.00"));
    expect(vatRateOn("general", "2031-06-15", WITH_CHANGE)).toBe(decimal("23.00"));
    expect(vatRateOn("reduced", "2027-01-01", WITH_CHANGE)).toBe(decimal("10.00"));
  });

  it("applies the first entry to every date before the second, however early", () => {
    expect(vatRateOn("general", "1990-01-01", WITH_CHANGE)).toBe(decimal("21.00"));
  });

  it("refuses a date that is not a real YYYY-MM-DD calendar day", () => {
    for (const bad of ["2027-1-01", "2027-02-30", "20270101", "", "2027-01-01T00:00"]) {
      expect(() => vatRateOn("general", bad)).toThrow(/not a calendar date/);
    }
  });

  it("refuses a table whose first entry is dated", () => {
    const table = { ...VAT_RATE_TABLE, general: [{ from: "2020-01-01", rate: "21.00" }] };
    expect(() => vatRateOn("general", "2026-09-27", table)).toThrow(/first entry/);
  });

  it("refuses a table with a second undated entry", () => {
    const table = {
      ...VAT_RATE_TABLE,
      general: [
        { from: null, rate: "21.00" },
        { from: null, rate: "23.00" },
      ],
    };
    expect(() => vatRateOn("general", "2026-09-27", table)).toThrow(/oldest first/);
  });

  it("refuses a table whose entries are out of order or repeat a date", () => {
    const outOfOrder = {
      ...VAT_RATE_TABLE,
      general: [
        { from: null, rate: "21.00" },
        { from: "2028-01-01", rate: "24.00" },
        { from: "2027-01-01", rate: "23.00" },
      ],
    };
    const repeated = {
      ...VAT_RATE_TABLE,
      general: [
        { from: null, rate: "21.00" },
        { from: "2027-01-01", rate: "23.00" },
        { from: "2027-01-01", rate: "24.00" },
      ],
    };
    expect(() => vatRateOn("general", "2026-09-27", outOfOrder)).toThrow(/oldest first/);
    expect(() => vatRateOn("general", "2026-09-27", repeated)).toThrow(/oldest first/);
  });

  it("refuses a table entry dated with something other than a calendar date", () => {
    const table = {
      ...VAT_RATE_TABLE,
      general: [
        { from: null, rate: "21.00" },
        { from: "2027-13-01", rate: "23.00" },
      ],
    };
    expect(() => vatRateOn("general", "2026-09-27", table)).toThrow(/not a calendar date/);
  });

  it("refuses a class with no entries", () => {
    const table = { ...VAT_RATE_TABLE, general: [] };
    expect(() => vatRateOn("general", "2026-09-27", table)).toThrow(/first entry/);
  });
});

describe("vatRatesOn", () => {
  it("gives every class's rate on one date", () => {
    expect(vatRatesOn("2026-12-31", WITH_CHANGE)).toEqual({
      general: decimal("21.00"),
      reduced: decimal("10.00"),
      super_reduced: decimal("4.00"),
      zero: decimal("0.00"),
    });
    expect(vatRatesOn("2027-01-01", WITH_CHANGE)).toEqual({
      general: decimal("23.00"),
      reduced: decimal("10.00"),
      super_reduced: decimal("4.00"),
      zero: decimal("0.00"),
    });
  });

  it("reads the shipped table when none is given", () => {
    expect(vatRatesOn("2026-09-27")).toEqual({
      general: decimal("21.00"),
      reduced: decimal("10.00"),
      super_reduced: decimal("4.00"),
      zero: decimal("0.00"),
    });
  });

  it("refuses a date that is not a real YYYY-MM-DD calendar day", () => {
    expect(() => vatRatesOn("2027-02-30")).toThrow(/not a calendar date/);
  });

  it("refuses a malformed class even when another class is asked for, and on every call", () => {
    const table = {
      ...VAT_RATE_TABLE,
      zero: [
        { from: null, rate: "0.00" },
        { from: null, rate: "1.00" },
      ],
    };
    expect(() => vatRatesOn("2026-09-27", table)).toThrow(/oldest first/);
    expect(() => vatRatesOn("2026-09-27", table)).toThrow(/oldest first/);
    expect(() => vatRateOn("general", "2026-09-27", table)).toThrow(/oldest first/);
  });
});

describe("localCalendarDate", () => {
  it("is the calendar date at the given offset, not in UTC", () => {
    // 23:30 UTC on 31 December is 01:30 on 1 January at UTC+2.
    expect(localCalendarDate(new Date("2026-12-31T23:30:00.000Z"), 120)).toBe("2027-01-01");
    expect(localCalendarDate(new Date("2026-12-31T23:30:00.000Z"), 0)).toBe("2026-12-31");
    // 00:30 UTC on 1 January is still 31 December at UTC−3.
    expect(localCalendarDate(new Date("2027-01-01T00:30:00.000Z"), -180)).toBe("2026-12-31");
  });

  it("puts local midnight on the new day", () => {
    expect(localCalendarDate(new Date("2026-12-31T23:00:00.000Z"), 60)).toBe("2027-01-01");
    expect(localCalendarDate(new Date("2026-12-31T22:59:59.999Z"), 60)).toBe("2026-12-31");
  });
});
