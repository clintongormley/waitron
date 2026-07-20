import { describe, expect, it } from "vitest";
import { formatAmount, formatDate, formatDateTime, trimValue } from "./format.js";

describe("trimValue", () => {
  it("strips leading and trailing ASCII whitespace", () => {
    expect(trimValue("  12345678 / G33  ")).toBe("12345678 / G33");
  });

  it("preserves interior whitespace verbatim", () => {
    // AEAT's own example keeps the spaces around the slash.
    expect(trimValue(" 12345678 / G33 ")).toBe("12345678 / G33");
  });

  it("strips tab, newline and carriage return", () => {
    expect(trimValue("\t\r\nABC\n\r\t")).toBe("ABC");
  });

  it("does NOT strip a non-breaking space", () => {
    // Policy: match AEAT's reference trim (code points <= U+0020) rather than
    // JS .trim(), which also strips U+00A0 and U+FEFF. Using .trim() here would
    // produce a different huella from AEAT's recomputation.
    expect(trimValue(" ABC ")).toBe(" ABC ");
  });

  it("does NOT strip a zero-width no-break space", () => {
    expect(trimValue("﻿ABC﻿")).toBe("﻿ABC﻿");
  });

  it("maps null and undefined to the empty string", () => {
    expect(trimValue(null)).toBe("");
    expect(trimValue(undefined)).toBe("");
  });

  it("treats U+0020 as the last code point stripped, and preserves an adjacent !", () => {
    // U+0021 ("!") sits immediately above the <= U+0020 trim boundary. A
    // mutant widening the comparison to <= 0x21 would strip it too, silently
    // changing the huella for any value ending (or starting) with "!".
    expect(trimValue("ABC! ")).toBe("ABC!");
    expect(trimValue(" !ABC")).toBe("!ABC");
  });
});

describe("formatAmount", () => {
  it("always emits exactly two decimal places", () => {
    expect(formatAmount(123)).toBe("123.00");
    expect(formatAmount(123.1)).toBe("123.10");
    expect(formatAmount(123.45)).toBe("123.45");
  });

  it("never emits a leading plus", () => {
    expect(formatAmount(123.45)).not.toContain("+");
  });

  it("emits a minus for negative amounts", () => {
    expect(formatAmount(-123.45)).toBe("-123.45");
  });

  it("emits zero without a sign", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-0)).toBe("0.00");
  });

  it("emits no sign for a negative amount that rounds to zero", () => {
    // The sign guard must key off the rounded cents (`scaled`), not the raw
    // sign of `value` — otherwise a tiny negative amount that rounds to zero
    // would print "-0.00", which AEAT's schema forbids.
    expect(formatAmount(-0.001)).toBe("0.00");
  });

  it("rounds half away from zero", () => {
    // Currency rounding, not JS Math.round's half-up-toward-positive-infinity,
    // which would round -0.125 to -0.12 and break symmetry with +0.125.
    expect(formatAmount(0.125)).toBe("0.13");
    expect(formatAmount(-0.125)).toBe("-0.13");
  });

  it("corrects floating-point representation error at the rounding boundary", () => {
    // 1.005 is stored as 1.00499999999999989341..., and 1.005 * 100 evaluates
    // to 100.49999999999999 in IEEE 754 — a naive Math.round(value * 100)
    // rounds this DOWN to "1.00". The correct result, treating the literal as
    // a human typed it, is "1.01".
    expect(formatAmount(1.005)).toBe("1.01");
  });

  it("corrects representation error for another value on the same boundary", () => {
    // A second, independent case on the x.xx5 boundary, so a fix that
    // special-cases 1.005 specifically cannot pass.
    expect(formatAmount(1.015)).toBe("1.02");
  });

  it("corrects representation error two decimal places further out", () => {
    // 10.075 * 100 evaluates to 1007.4999999999999 in IEEE 754.
    expect(formatAmount(10.075)).toBe("10.08");
  });

  it("carries a cents rollover into the integer part", () => {
    // Rounding 99 cents up must carry into the integer part rather than
    // print an impossible "0.100" or truncate back to "0.00".
    expect(formatAmount(0.995)).toBe("1.00");
    expect(formatAmount(-0.995)).toBe("-1.00");
  });

  it("rejects a non-finite amount", () => {
    expect(() => formatAmount(Number.NaN)).toThrow(/finite/i);
    expect(() => formatAmount(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });

  it("allows exactly 12 integer digits", () => {
    expect(formatAmount(999_999_999_999)).toBe("999999999999.00");
  });

  it("rejects an amount beyond the 12-integer-digit schema limit", () => {
    expect(() => formatAmount(1_000_000_000_000)).toThrow(/12/);
  });

  it("rejects a value under the 12-digit pre-check that rounds up past it", () => {
    // 999999999999.999 is below 10**12, so the pre-check alone would let it
    // through, but rounding its cents up carries the integer part to
    // 1000000000000 (13 digits) — the post-rounding check below the pre-check
    // still needs to exist to catch this case.
    expect(() => formatAmount(999999999999.999)).toThrow(/12/);
  });

  it("rejects a magnitude so large toFixed would switch to exponential notation", () => {
    // (1e21).toFixed(10) returns "1e+21" (no "."), which would otherwise make
    // the code below throw a TypeError from calling .slice on undefined,
    // instead of this function's own range error.
    expect(() => formatAmount(1e21)).toThrow(/12/);
    expect(() => formatAmount(-1e21)).toThrow(/12/);
  });
});

describe("formatDate", () => {
  it("emits DD-MM-YYYY, zero padded", () => {
    expect(formatDate(new Date("2024-01-01T19:20:30+01:00"), 60)).toBe("01-01-2024");
  });

  it("uses the supplied offset, not the host timezone", () => {
    // 00:30 on the 2nd at +02:00 is still 22:30 on the 1st in UTC. The date
    // must follow the offset we were given, or an invoice issued just after
    // midnight gets yesterday's date.
    expect(formatDate(new Date("2024-03-01T22:30:00Z"), 120)).toBe("02-03-2024");
  });

  it("rejects an offsetMinutes beyond xs:dateTime's +/-14:00 range", () => {
    // 9999 minutes would otherwise serialise into a malformed offset like
    // "+166:39", which both hashes and passes local validation only to be
    // rejected by AEAT.
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), 9999)).toThrow(/offsetMinutes/i);
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), -841)).toThrow(/offsetMinutes/i);
  });

  it("names the permitted range and echoes the offending value in the error", () => {
    // The existing /offsetMinutes/i and /integer/i checks above only pin the
    // FIRST half of the thrown message; this pins the second half — the
    // "-14:00..+14:00" range description and the actual received value —
    // which a caller debugging a bad offset depends on just as much.
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), 9999)).toThrow(
      /-14:00\.\.\+14:00.*received 9999/,
    );
  });

  it("rejects a non-integer offsetMinutes", () => {
    // A fractional minute has no representation in +hh:mm — e.g. 90.5 would
    // otherwise serialise as "+01:30.5", not a well-formed xs:dateTime offset.
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), 90.5)).toThrow(/integer/i);
  });

  it("accepts exactly +14:00 and -14:00 — the boundary itself, not just inside it", () => {
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), 840)).not.toThrow();
    expect(() => formatDate(new Date("2024-01-01T00:00:00Z"), -840)).not.toThrow();
  });
});

describe("formatDateTime", () => {
  it("emits YYYY-MM-DDThh:mm:ss with a numeric offset", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30+01:00"), 60)).toBe(
      "2024-01-01T19:20:30+01:00",
    );
  });

  it("emits +00:00 rather than Z", () => {
    // Policy: xs:dateTime permits Z, but no AEAT example uses it and the hash
    // is over the literal, so the form must be fixed once.
    expect(formatDateTime(new Date("2024-01-01T19:20:30Z"), 0)).toBe("2024-01-01T19:20:30+00:00");
  });

  it("emits a negative offset correctly", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30Z"), -210)).toBe(
      "2024-01-01T15:50:30-03:30",
    );
  });

  it("truncates fractional seconds", () => {
    expect(formatDateTime(new Date("2024-01-01T19:20:30.789Z"), 0)).toBe(
      "2024-01-01T19:20:30+00:00",
    );
  });

  it("rejects an invalid date", () => {
    expect(() => formatDateTime(new Date("nonsense"), 0)).toThrow(/invalid/i);
  });

  it("rejects the motivating out-of-range offset that used to silently produce +166:39", () => {
    expect(() => formatDateTime(new Date("2024-01-08T15:20:30Z"), 9999)).toThrow(/offsetMinutes/i);
  });

  it("rejects the motivating fractional offset that used to silently produce +01:30.5", () => {
    expect(() => formatDateTime(new Date("2024-01-01T00:00:00Z"), 90.5)).toThrow(/integer/i);
  });

  it("accepts exactly +14:00 and -14:00 — the boundary itself, not just inside it", () => {
    expect(formatDateTime(new Date("2024-01-01T00:00:00Z"), 840)).toBe("2024-01-01T14:00:00+14:00");
    expect(formatDateTime(new Date("2024-01-01T00:00:00Z"), -840)).toBe(
      "2023-12-31T10:00:00-14:00",
    );
  });
});
