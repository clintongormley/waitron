import { describe, expect, it } from "vitest";
import {
  decodeHourIdentity,
  encodeHourIdentity,
  isHourAllocatedSeries,
  isHourIdentity,
} from "./hour-identity.js";

describe("UTC hour identities", () => {
  it.each([
    ["2026-01-01T00:00:00.000Z", "0000", 0],
    ["2026-01-01T00:59:59.999Z", "0000", 0],
    ["2026-01-01T01:00:00.000Z", "0001", 1],
    ["2026-10-16T11:40:00.000Z", "06RB", 6923],
    ["2026-10-16T12:00:00.000Z", "06RC", 6924],
    ["2145-08-15T15:59:59.999Z", "ZZZZ", 1048575],
  ] as const)("encodes %s as %s", (instant, identity, index) => {
    expect(encodeHourIdentity(Date.parse(instant))).toBe(identity);
    expect(decodeHourIdentity(identity)).toBe(index);
    expect(isHourIdentity(identity)).toBe(true);
  });

  it.each([
    Date.parse("2025-12-31T23:59:59.999Z"),
    Date.parse("2145-08-15T16:00:00.000Z"),
    Date.parse("2026-01-01T00:00:00.000Z") + 0.5,
    NaN,
    Infinity,
    -Infinity,
  ])("refuses out-of-range or nonintegral milliseconds %s", (instant) => {
    expect(() => encodeHourIdentity(instant)).toThrow(RangeError);
  });

  it.each([
    "",
    "000",
    "00000",
    "06rb",
    "06RB\n",
    " 06RB",
    "06RB ",
    "06RI",
    "06RL",
    "06RO",
    "06RU",
    "06RＢ",
    "S000001",
    "P000001",
    "C000001",
    "E00000000000000000000000000",
    null,
    6923,
    {},
    [],
    undefined,
  ])("refuses noncanonical internal identity %j", (identity) => {
    expect(isHourIdentity(identity)).toBe(false);
    expect(() => decodeHourIdentity(identity as string)).toThrow(RangeError);
  });
});

const bases = [
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "B", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const series = [
  { code: "a/B_1.2-3-06RB", purpose: "standard" },
  { code: "B-06RB", purpose: "standard" },
  { code: "FF-06RB", purpose: "full" },
  { code: "R-06RB", purpose: "rectificative" },
];

describe("complete configured hour series", () => {
  it("preserves exact spelling, multiple standard bases and FF/full in any order", () => {
    expect(isHourAllocatedSeries([...series].reverse(), "06RB", bases)).toBe(true);
    expect(isHourAllocatedSeries(series, "06RB", [...bases].reverse())).toBe(true);
  });

  it.each(
    [
      series.slice(0, 3),
      [...series, { code: "extra-06RB", purpose: "standard" }],
      [series[0], series[0], series[2], series[3]],
      [series[0], series[1], { code: "FF-06RB", purpose: "standard" }, series[3]],
      [{ code: "A/B_1.2-3-06RB", purpose: "standard" }, ...series.slice(1)],
      [{ code: "a/B_1.2-3-06RC", purpose: "standard" }, ...series.slice(1)],
      null,
    ].map((value) => [value]),
  )("refuses a changed complete set %#", (value) => {
    expect(isHourAllocatedSeries(value, "06RB", bases)).toBe(false);
  });

  it.each(["", "A".repeat(22), "A B", "A?", "Á", "A\n"])("refuses invalid base %j", (code) => {
    expect(
      isHourAllocatedSeries([{ code: `${code}-06RB`, purpose: "standard" }], "06RB", [
        { code, purpose: "standard" },
      ]),
    ).toBe(false);
  });

  it("retains the 21-character base and ten-digit counter limits", () => {
    expect(
      isHourAllocatedSeries([{ code: "ABCDEFGHIJKLMNOPQRSTU-ZZZZ", purpose: "standard" }], "ZZZZ", [
        { code: "ABCDEFGHIJKLMNOPQRSTU", purpose: "standard" },
      ]),
    ).toBe(true);
    expect("ABCDEFGHIJKLMNOPQRSTU-ZZZZ/9999999999").toHaveLength(37);
  });

  it("does not admit an old protocol identity through the hour series boundary", () => {
    expect(
      isHourAllocatedSeries([{ code: "A-P000042", purpose: "standard" }], "P000042", [
        { code: "A", purpose: "standard" },
      ]),
    ).toBe(false);
  });
});
