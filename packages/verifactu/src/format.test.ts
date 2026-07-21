import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatAmountExact, formatDate, formatDateTime, trimValue } from "./format.js";

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

describe("formatAmountExact", () => {
  it("emits exactly two decimals", () => {
    expect(formatAmountExact("123")).toBe("123.00");
    expect(formatAmountExact("123.1")).toBe("123.10");
    expect(formatAmountExact("123.45")).toBe("123.45");
  });

  it("never emits a leading +, and - only for genuine negatives", () => {
    expect(formatAmountExact("123.45")).not.toContain("+");
    expect(formatAmountExact("-123.45")).toBe("-123.45");
    expect(formatAmountExact("0")).toBe("0.00");
    // AMOUNT_PATTERN accepts a leading "-" on a zero magnitude (it does not
    // special-case zero the way it special-cases leading zeros on other
    // integers), so both "-0" and "-0.00" reach the sign logic below, which
    // then strips the sign because the rounded magnitude is zero — mirroring
    // the "0"/"0.00" case above.
    expect(formatAmountExact("-0")).toBe("0.00");
    expect(formatAmountExact("-0.00")).toBe("0.00");
  });

  it("rounds half away from zero on the third decimal", () => {
    expect(formatAmountExact("0.125")).toBe("0.13");
    expect(formatAmountExact("-0.125")).toBe("-0.13");
    expect(formatAmountExact("0.124")).toBe("0.12");
    expect(formatAmountExact("0.995")).toBe("1.00"); // carry
    expect(formatAmountExact("-0.995")).toBe("-1.00");
    expect(formatAmountExact("-0.001")).toBe("0.00"); // rounds to zero → unsigned
  });

  it("accepts the full 12 integer digits and rejects 13", () => {
    expect(formatAmountExact("999999999999")).toBe("999999999999.00");
    expect(() => formatAmountExact("1000000000000")).toThrow(/12/);
    expect(() => formatAmountExact("999999999999.999")).toThrow(/12/); // carry pushes to 13
  });

  it("rejects non-decimal strings", () => {
    expect(() => formatAmountExact("abc")).toThrow(/decimal string/);
    expect(() => formatAmountExact("+1.00")).toThrow(/decimal string/);
    expect(() => formatAmountExact("1.2.3")).toThrow(/decimal string/);
    expect(() => formatAmountExact("")).toThrow(/decimal string/);
  });

  it("rejects trailing garbage after a valid decimal", () => {
    // AMOUNT_PATTERN is anchored at both ends. Without the trailing `$`, `.test()` only needs to
    // match a PREFIX of the string, so "123 " would match on "123" and silently ignore the
    // trailing space instead of being rejected — and BigInt("123 ") itself tolerates trailing
    // whitespace, so nothing downstream would catch it either.
    expect(() => formatAmountExact("123 ")).toThrow(/decimal string/);
  });

  it("rejects a non-string runtime value even when it stringifies to a valid decimal", () => {
    // TypeScript prevents this at the call site, but the typeof guard is the only thing standing
    // between a boxed String (typeof "object", inherits every String.prototype method used below)
    // and it sailing through undetected to a silently-produced result.
    expect(() => formatAmountExact(new String("123") as unknown as string)).toThrow(/string/i);
  });

  it("property: round-trips a canonical 2dp decimal to itself", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -999_999, max: 999_999 }),
        fc.integer({ min: 0, max: 99 }),
        (i, c) => {
          const s = `${i}.${String(c).padStart(2, "0")}`;
          // decimal(...) form the value already carries; formatAmountExact must not alter a 2dp literal
          expect(formatAmountExact(s.replace("-0.", "0."))).toBe(
            `${i}.${String(c).padStart(2, "0")}`.replace(/^-0\./, "0."),
          );
        },
      ),
    );
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
