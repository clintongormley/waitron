import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { DR303_LAYOUT, type Dr303Segment } from "./dr303-layout.js";
import { formatAlfa, formatNumericField, normalizeAlfa, toDr303Record } from "./dr303.js";
import type { Modelo303 } from "./modelo-303.js";

const d = (s: string): Decimal => decimal(s);
const TENANT = "11111111-1111-1111-1111-111111111111" as unknown as TenantId;

// ── Field-formatting units (proven by deletion; each rule from the AEAT manual, manual_uso.txt) ──

describe("formatNumericField — money amount field (17 chars, 15 int + 2 dec, packed, no point)", () => {
  it("right-aligns and zero-fills a positive amount into 17 chars", () => {
    // 175.64 € → 17564 cents → 12 leading zeros + "17564".
    expect(formatNumericField(d("175.64"), 17, "Num", 2)).toBe("00000000000017564");
    expect(formatNumericField(d("175.64"), 17, "Num", 2)).toHaveLength(17);
  });

  it("packs whole euros and sub-euro cents exactly (no float)", () => {
    expect(formatNumericField(d("1000.00"), 17, "Num", 2)).toBe("00000000000100000");
    expect(formatNumericField(d("0.05"), 17, "Num", 2)).toBe("00000000000000005");
    expect(formatNumericField(d("0.00"), 17, "Num", 2)).toBe("00000000000000000");
  });

  it("prefixes a NEGATIVE value in an N (signed) field with 'N' then zero-fills the magnitude", () => {
    // manual_uso.txt: "Los datos numéricos negativos llevarán una N en la primera posición del campo."
    // Field width stays 17: 'N' + 16-char zero-filled magnitude.
    expect(formatNumericField(d("-175.64"), 17, "N", 2)).toBe("N0000000000017564");
    expect(formatNumericField(d("-175.64"), 17, "N", 2)).toHaveLength(17);
  });

  it("keeps a zero unsigned even in an N field (no '-0' / 'N0…' for zero)", () => {
    expect(formatNumericField(d("0.00"), 17, "N", 2)).toBe("00000000000000000");
  });

  it("refuses a negative value in a Num (unsigned) field — that box cannot carry a sign", () => {
    expect(() => formatNumericField(d("-1.00"), 17, "Num", 2)).toThrow(/negative/);
  });

  it("throws on overflow rather than silently truncating a field", () => {
    // 15 int digits is the field max; 16 overflows.
    expect(() => formatNumericField(d("10000000000000000.00"), 17, "Num", 2)).toThrow(/overflow/);
  });

  it("throws when a negative magnitude overflows the signed field (N takes a position)", () => {
    // An N field of width 17 holds N + 16 digits; a 17-digit magnitude overflows.
    expect(() => formatNumericField(d("-100000000000000.00"), 17, "N", 2)).toThrow(/overflow/);
  });

  it("packs an integer (decimals 0) field with no fractional digits", () => {
    expect(formatNumericField(d("5"), 4, "Num", 0)).toBe("0005");
    expect(formatNumericField(d("-5"), 4, "N", 0)).toBe("N005");
  });
});

describe("formatNumericField — rate / percentage field (5 chars, 3 int + 2 dec)", () => {
  it("packs a rate/percentage into 5 chars (02100 = 21,00%; 10000 = 100,00%)", () => {
    expect(formatNumericField(d("21.00"), 5, "Num", 2)).toBe("02100");
    expect(formatNumericField(d("4.00"), 5, "Num", 2)).toBe("00400");
    expect(formatNumericField(d("100.00"), 5, "Num", 2)).toBe("10000");
  });
});

describe("normalizeAlfa / formatAlfa — alfanumeric (upper, accents stripped, Ñ/Ç kept)", () => {
  it("uppercases and strips accents from vowels", () => {
    expect(normalizeAlfa("José María")).toBe("JOSE MARIA");
    expect(normalizeAlfa("Peñíscola")).toBe("PEÑISCOLA"); // Í → I, Ñ kept
  });

  it("PRESERVES Ñ and Ç (ISO-8859-1 language letters, not accents)", () => {
    // manual_uso.txt keeps Ñ (ASCII 209) / Ç (ASCII 199); only accented vowels are stripped.
    expect(normalizeAlfa("Cañón")).toBe("CAÑON");
    expect(normalizeAlfa("Barça")).toBe("BARÇA");
    expect(normalizeAlfa("Ñoño Çedilla")).toBe("ÑOÑO ÇEDILLA");
  });

  it("neutralizes a non-ISO-8859-1 codepoint to a space (never a corrupted latin1 byte)", () => {
    // "€" (U+20AC) is outside ISO-8859-1; latin1 encoding would mangle it, so it becomes a space.
    expect(normalizeAlfa("MENÚ 5€")).toBe("MENU 5 ");
  });

  it("left-aligns, space-fills to width, and truncates when longer", () => {
    expect(formatAlfa("B12345678", 9)).toBe("B12345678");
    expect(formatAlfa("ABC", 6)).toBe("ABC   ");
    expect(formatAlfa("ABCDEFGH", 3)).toBe("ABC");
    expect(formatAlfa("Peñíscola", 6)).toBe("PEÑISC");
  });
});

// ── Round-trip fixture: a deli month (10 %/21 % devengado, 28/29 corrientes, 30/31 inversión, a
//    NEGATIVE resultado −175,64) → the fixed-layout record, byte-checked at the documented offsets. ──

/** The worked deli month of modelo-303.test.ts, as a Modelo303 (built directly to isolate the
 * serializer from mapModelo303). */
function deliMonth(): Modelo303 {
  return {
    tenantId: TENANT,
    year: 2026,
    period: { kind: "month", month: 8 },
    boxes: {
      "04": d("160.00"),
      "05": d("10.00"),
      "06": d("16.00"),
      "07": d("335.00"),
      "08": d("21.00"),
      "09": d("70.35"),
      "28": d("300.00"),
      "29": d("51.99"),
      "30": d("1000.00"),
      "31": d("210.00"),
      "27": d("86.35"),
      "45": d("261.99"),
      "46": d("-175.64"),
      "64": d("-175.64"),
      "65": d("100.00"),
      "66": d("-175.64"),
      "69": d("-175.64"),
      "71": d("-175.64"),
    },
  };
}

const OPTIONS = {
  taxId: "B12345678",
  name: "Café Peñíscola S.L.",
  year: 2026, // ejercicio
  period: "08", // período
  declarationType: "I", // tipo de declaración
};

// Absolute 0-based byte offsets, hand-computed once from the verified DR303e26 layout (común 328 +
// página1 1581 precede página3). The serializer derives the SAME offsets from dr303-layout.ts; asserting
// the two agree makes the offsets load-bearing — shift any field in the layout and the derivation
// diverges from these constants → red.
const OFFSET = {
  c04: 614,
  c06: 636,
  c05: 631,
  c07: 653,
  c09: 675,
  c08: 670,
  c27: 1023,
  c28: 1040,
  c29: 1057,
  c30: 1074,
  c31: 1091,
  c45: 1329,
  c46: 1346,
  c65: 2124,
  c71: 2316,
} as const;

function absoluteOffset(segment: Dr303Segment, casilla: string): number {
  const order = [DR303_LAYOUT.comun, DR303_LAYOUT.pagina1, DR303_LAYOUT.pagina3];
  let base = 0;
  for (const s of order) {
    if (s === segment) break;
    base += s.length;
  }
  const field = segment.fields.find((f) => f.casilla === casilla);
  if (!field) throw new Error(`no casilla ${casilla} in ${segment.name}`);
  return base + (field.pos - 1);
}

function at(record: Buffer, offset: number, len: number): string {
  return record.toString("latin1", offset, offset + len);
}

describe("toDr303Record — deli-month fixture", () => {
  const record = toDr303Record(deliMonth(), OPTIONS);

  it("produces the full régimen-general record length (común 328 + p1 1581 + p3 1017 + close 18)", () => {
    expect(record).toBeInstanceOf(Buffer);
    expect(record).toHaveLength(2944);
  });

  it("opens with the envelope, then each página tag, and closes the envelope", () => {
    expect(at(record, 0, 17)).toBe("<T30302026080000>"); // común: <T 303 0 EEEE PP 0000>
    expect(at(record, 328, 11)).toBe("<T30301000>"); // página 1 tag
    expect(at(record, 328 + 1581, 11)).toBe("<T30303000>"); // página 3 tag
    expect(at(record, 2944 - 18, 18)).toBe("</T30302026080000>"); // envelope close
  });

  it("places the identity header (declaration type, NIF, name, year, period)", () => {
    expect(at(record, 328 + 12, 1)).toBe("I"); // tipo declaración (página1 field 6, pos 13)
    expect(at(record, 328 + 13, 9)).toBe("B12345678"); // NIF (página1 field 7, pos 14)
    expect(at(record, 328 + 22, 19)).toBe("CAFE PEÑISCOLA S.L."); // name (página1 field 8, pos 23)
    expect(at(record, 328 + 102, 4)).toBe("2026"); // ejercicio (página1 field 9, pos 103)
    expect(at(record, 328 + 106, 2)).toBe("08"); // período (página1 field 10, pos 107)
  });

  it("byte-checks each amount box at its documented offset (value lands at position − 1)", () => {
    // Every offset is cross-checked against the layout-derived value first (shift → red), then the bytes.
    const check = (
      segment: Dr303Segment,
      casilla: keyof typeof OFFSET,
      len: number,
      expected: string,
    ): void => {
      const off = OFFSET[casilla];
      expect(absoluteOffset(segment, casilla.slice(1)), `offset drift for casilla ${casilla}`).toBe(
        off,
      );
      expect(at(record, off, len), `bytes for casilla ${casilla}`).toBe(expected);
    };
    // Devengado 10 % (base/cuota) and 21 % (base/cuota); the Tipo % boxes are AEAT constants.
    check(DR303_LAYOUT.pagina1, "c04", 17, "00000000000016000"); // base 160.00
    check(DR303_LAYOUT.pagina1, "c06", 17, "00000000000001600"); // cuota 16.00
    check(DR303_LAYOUT.pagina1, "c07", 17, "00000000000033500"); // base 335.00
    check(DR303_LAYOUT.pagina1, "c09", 17, "00000000000007035"); // cuota 70.35
    check(DR303_LAYOUT.pagina1, "c05", 5, "01000"); // tipo 10 % constant
    check(DR303_LAYOUT.pagina1, "c08", 5, "02100"); // tipo 21 % constant
    // Deducible corrientes 28/29 and inversión 30/31.
    check(DR303_LAYOUT.pagina1, "c28", 17, "00000000000030000"); // base 300.00
    check(DR303_LAYOUT.pagina1, "c29", 17, "00000000000005199"); // cuota 51.99
    check(DR303_LAYOUT.pagina1, "c30", 17, "00000000000100000"); // base 1000.00
    check(DR303_LAYOUT.pagina1, "c31", 17, "00000000000021000"); // cuota 210.00
    // Totals + result: 27 (Σ devengado), 45 (Σ deducible), 46 = 27 − 45 (NEGATIVE → N prefix).
    check(DR303_LAYOUT.pagina1, "c27", 17, "00000000000008635"); // 86.35
    check(DR303_LAYOUT.pagina1, "c45", 17, "00000000000026199"); // 261.99
    check(DR303_LAYOUT.pagina1, "c46", 17, "N0000000000017564"); // −175.64
    // Página 3: % atribuible al Estado [65] = 100,00 % → "10000"; resultado autoliquidación [71] < 0.
    check(DR303_LAYOUT.pagina3, "c65", 5, "10000");
    check(DR303_LAYOUT.pagina3, "c71", 17, "N0000000000017564");
  });

  it("rejects a malformed year or period — the envelope tag would be wrong", () => {
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, year: 26 })).toThrow(/year/);
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, period: "13" })).toThrow(/period/);
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, period: "8" })).toThrow(/period/);
  });

  it("accepts a quarterly period token ('4T') and uppercases it in the envelope", () => {
    const q = toDr303Record(deliMonth(), { ...OPTIONS, period: "4t" });
    expect(at(q, 0, 17)).toBe("<T303020264T0000>"); // <T 3030 2026 4T 0000>
    expect(at(q, 2944 - 18, 18)).toBe("</T303020264T0000>");
  });

  it("refuses a Modelo303 carrying a box this writer does not place (would be silently dropped)", () => {
    const bogus = deliMonth();
    const withStray: Modelo303 = { ...bogus, boxes: { ...bogus.boxes, "999": d("1.00") } };
    expect(() => toDr303Record(withStray, OPTIONS)).toThrow(/not in the emitted layout/);
  });

  it("encodes ISO-8859-1: Ñ is byte 209 (0xD1), accented vowels are stripped", () => {
    // Name normalizes to "CAFE PEÑISCOLA S.L." — the Ñ sits at index 7 of the name field (pos 23).
    const nameStart = 328 + 22;
    expect(record[nameStart + 7]).toBe(0xd1); // Ñ → 209
    expect(record[nameStart + 2]).toBe("F".charCodeAt(0)); // plain ASCII around it
    // No accented-vowel byte survived anywhere in the name field.
    for (let i = nameStart; i < nameStart + 80; i++) {
      expect([0xc9, 0xcd, 0xe9, 0xed]).not.toContain(record[i]); // É Í é í
    }
  });
});

// ── Envelope-period consistency: the ejercicio/período stamped from `options` must match the
//    liquidation period the aggregate's amounts are FOR (`modelo303.year`/`modelo303.period`). Passing a
//    wrong year/period would emit an internally inconsistent tax file — envelope period ≠ casilla
//    amounts. deliMonth() is the aggregate for month 8 of 2026 (its `year`/`period` say so). ──
describe("toDr303Record — envelope period must match the aggregate's liquidation period", () => {
  it("throws when the option period's month disagrees with the aggregate's liquidation month", () => {
    // deliMonth() aggregates month 8; filing it under período "07" stamps a month the amounts are not
    // for. Refuse, consistent with the writer's other unplaceable-box/overflow throws (plain Error).
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, period: "07" })).toThrow(
      /liquidation month/,
    );
  });

  it("throws when the option year disagrees with the aggregate's liquidation year", () => {
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, year: 2025 })).toThrow(
      /liquidation year/,
    );
  });

  it("accepts a monthly period token that matches the aggregate's month (8 → '08')", () => {
    // OPTIONS already carries year 2026 / período "08" for the month-8 aggregate — no throw.
    expect(() => toDr303Record(deliMonth(), OPTIONS)).not.toThrow();
  });

  it("does not cross-check a quarterly period token against a MONTHLY aggregate", () => {
    // deliMonth() is a {kind:"month"} aggregate. The monthly cross-check only fires for a 2-digit
    // ("01".."12") token; a "1T".."4T" token skips it (the quarterly path is caller-consistent, not
    // cross-checked here — see toDr303Record's doc comment). So "4t" must not throw.
    expect(() => toDr303Record(deliMonth(), { ...OPTIONS, period: "4t" })).not.toThrow();
  });
});

// ── Period-aware envelope: the aggregate's LiquidationPeriod (`modelo303.period`) governs whether the
//    envelope período is cross-checked. Monthly → cross-checked against its month; quarterly → exempt
//    (the download route derives período from the SAME period, so they cannot disagree at the caller);
//    annual → REFUSED, because there is no modelo 303 annual período (the annual return is modelo 390). ──
describe("toDr303Record — period-aware envelope (annual refused, quarterly threaded)", () => {
  // PROOF BY DELETION (CLAUDE.md §4 "prove a guard by deletion"). Deleting the `p.kind === "year"`
  // throw block in dr303.ts and running this file makes ONLY the annual test below go RED (the
  // quarterly test still passes):
  //   × … > refuses an annual aggregate …
  //     → AssertionError: expected [Function] to throw an error
  // i.e. a {kind:"year"} aggregate + período "01" no longer refuses — it emits a misleading
  // January-stamped 2944-byte file. Restoring the throw makes the file GREEN again (27 passed).
  // Recorded 2026-08-18.
  it("refuses an annual aggregate — there is no modelo 303 annual period (annual is modelo 390)", () => {
    const annual = { ...deliMonth(), period: { kind: "year" as const } };
    expect(() => toDr303Record(annual, { ...OPTIONS, period: "01" })).toThrow(/annual|390/);
  });
  it("emits a quarterly file for a quarterly aggregate (envelope carries the trimestre)", () => {
    const q1 = { ...deliMonth(), period: { kind: "quarter" as const, quarter: 1 } };
    const file = toDr303Record(q1, { ...OPTIONS, period: "1T" });
    expect(file.length).toBe(2944);
    expect(at(file, 0, 17)).toBe("<T303020261T0000>"); // <T 3030 2026 1T 0000>
  });
});
