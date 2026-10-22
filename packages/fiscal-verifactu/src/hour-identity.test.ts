import { describe, expect, it } from "vitest";
import {
  decodeMinuteIdentity,
  encodeMinuteIdentity,
  isMinuteAllocatedSeries,
  isMinuteIdentity,
  isMinuteSeriesBases,
} from "./hour-identity.js";

const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

describe("UTC minute identities", () => {
  it.each([
    ["2026-01-01T00:00:00.000Z", "00000"],
    ["2026-10-16T11:40:00.000Z", "0CNNW"],
    ["2026-10-23T19:40:50.000Z", "0CZZW"],
    ["2026-10-23T19:55:50.000Z", "0D00B"],
    ["2026-10-23T19:56:00.000Z", "0D00C"],
    ["2026-10-24T09:02:00.000Z", "0D0RY"],
    ["2089-10-18T16:31:00.000Z", "ZZZZZ"],
  ] as const)("encodes %s as %s", (instant, identity) => {
    expect(encodeMinuteIdentity(Date.parse(instant))).toBe(identity);
    expect(decodeMinuteIdentity(identity)).toBe(
      Math.floor((Date.parse(instant) - EPOCH_MS) / 60_000),
    );
    expect(isMinuteIdentity(identity)).toBe(true);
  });

  it("decodes to minutes since the epoch", () => {
    expect(decodeMinuteIdentity("0CZZW")).toBe(
      Math.floor(
        (Date.parse("2026-10-23T19:40:50Z") - Date.parse("2026-01-01T00:00:00Z")) / 60_000,
      ),
    );
    expect(decodeMinuteIdentity("00000")).toBe(0);
    expect(decodeMinuteIdentity("ZZZZZ")).toBe(32 ** 5 - 1);
  });

  it("round-trips 1 000 random instants in range", () => {
    for (let i = 0; i < 1000; i++) {
      const instant = EPOCH_MS + Math.floor(Math.random() * 32 ** 5 * 60_000);
      const identity = encodeMinuteIdentity(instant);
      expect(decodeMinuteIdentity(identity)).toBe(Math.floor((instant - EPOCH_MS) / 60_000));
      expect(encodeMinuteIdentity(EPOCH_MS + decodeMinuteIdentity(identity) * 60_000)).toBe(
        identity,
      );
    }
  });

  it.each([
    EPOCH_MS - 1,
    Date.parse("2089-10-18T16:32:00.000Z"),
    EPOCH_MS + 0.5,
    NaN,
    Infinity,
    -Infinity,
  ])("refuses out-of-range or nonintegral milliseconds %s", (instant) => {
    expect(() => encodeMinuteIdentity(instant)).toThrow(new RangeError("Invalid minute instant"));
  });

  it.each([
    "",
    "06XV",
    "0CZZWX",
    "0czzw",
    "0CZZW\n",
    " 0CZZW",
    "0CZZW ",
    "0CZZI",
    "0CZZL",
    "0CZZO",
    "0CZZU",
    "0CZZＷ",
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
    expect(isMinuteIdentity(identity)).toBe(false);
    expect(() => decodeMinuteIdentity(identity as string)).toThrow(RangeError);
  });
});

const bases = [
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "B", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const series = [
  { code: "a/B_1.2-3-0CZZW", purpose: "standard" },
  { code: "B-0CZZW", purpose: "standard" },
  { code: "FF-0CZZW", purpose: "full" },
  { code: "R-0CZZW", purpose: "rectificative" },
];

describe("complete configured minute series", () => {
  it("accepts a single base suffixed with the minute code", () => {
    expect(
      isMinuteAllocatedSeries([{ code: "A-0CZZW", purpose: "standard" }], "0CZZW", [
        { code: "A", purpose: "standard" },
      ]),
    ).toBe(true);
  });

  it("accepts a hyphenated and slashed base", () => {
    expect(
      isMinuteAllocatedSeries([{ code: "F/2.x-y-0CZZW", purpose: "standard" }], "0CZZW", [
        { code: "F/2.x-y", purpose: "standard" },
      ]),
    ).toBe(true);
  });

  it("preserves exact spelling, multiple standard bases and FF/full in any order", () => {
    expect(isMinuteAllocatedSeries([...series].reverse(), "0CZZW", bases)).toBe(true);
    expect(isMinuteAllocatedSeries(series, "0CZZW", [...bases].reverse())).toBe(true);
  });

  it.each(
    [
      series.slice(0, 3),
      [...series, { code: "extra-0CZZW", purpose: "standard" }],
      [series[0], series[0], series[2], series[3]],
      [series[0], series[1], { code: "FF-0CZZW", purpose: "standard" }, series[3]],
      [{ code: "A/B_1.2-3-0CZZW", purpose: "standard" }, ...series.slice(1)],
      [{ code: "a/B_1.2-3-0CZZX", purpose: "standard" }, ...series.slice(1)],
      null,
    ].map((value) => [value]),
  )("refuses a changed complete set %#", (value) => {
    expect(isMinuteAllocatedSeries(value, "0CZZW", bases)).toBe(false);
  });

  it.each(["", "A".repeat(22), "A B", "A?", "Á", "A\n"])("refuses invalid base %j", (code) => {
    expect(
      isMinuteAllocatedSeries([{ code: `${code}-0CZZW`, purpose: "standard" }], "0CZZW", [
        { code, purpose: "standard" },
      ]),
    ).toBe(false);
  });

  it("retains the 21-character base and ten-digit counter limits", () => {
    expect(
      isMinuteAllocatedSeries(
        [{ code: "ABCDEFGHIJKLMNOPQRSTU-ZZZZZ", purpose: "standard" }],
        "ZZZZZ",
        [{ code: "ABCDEFGHIJKLMNOPQRSTU", purpose: "standard" }],
      ),
    ).toBe(true);
    expect("ABCDEFGHIJKLMNOPQRSTU-ZZZZZ/9999999999").toHaveLength(38);
  });

  it.each(["S000001", "E00000000000000000000000000", "P000042", "06XV"])(
    "does not admit a retired or four-symbol identity %s through the minute series boundary",
    (identity) => {
      expect(
        isMinuteAllocatedSeries([{ code: `A-${identity}`, purpose: "standard" }], identity, [
          { code: "A", purpose: "standard" },
        ]),
      ).toBe(false);
    },
  );
});

describe("series bases a minute name can complete", () => {
  it("accepts the bases of a complete set", () => {
    expect(isMinuteSeriesBases(bases)).toBe(true);
    expect(isMinuteSeriesBases([{ code: "ABCDEFGHIJKLMNOPQRSTU", purpose: "standard" }])).toBe(
      true,
    );
  });

  it.each([
    [[]],
    [[{ code: "FF", purpose: "full" }]],
    [[{ code: "A".repeat(22), purpose: "standard" }]],
    [[{ code: "A B", purpose: "standard" }]],
    [[{ code: "A", purpose: "other" }]],
    [
      [
        { code: "A", purpose: "standard" },
        { code: "A", purpose: "full" },
      ],
    ],
  ])("refuses %j", (value) => {
    expect(isMinuteSeriesBases(value)).toBe(false);
  });
});
