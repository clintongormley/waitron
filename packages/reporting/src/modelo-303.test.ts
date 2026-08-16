import { describe, expect, it } from "vitest";
import { decimal, subtractDecimal } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { mapModelo303 } from "./modelo-303.js";
import { DR303_LAYOUT } from "./dr303-layout.js";
import { formatNumericField } from "./dr303.js";
import type { VatReturn } from "./types.js";

// A pure mapping over a VatReturn — no DB, so a plain unit test with constructed inputs (the DB-backed
// aggregate that produces a VatReturn is covered by vat-return.test.ts / input-vat.test.ts).
const d = (s: string): Decimal => decimal(s);
const TENANT = "11111111-1111-1111-1111-111111111111" as unknown as TenantId;

function vatReturn(over: Partial<VatReturn> = {}): VatReturn {
  return {
    tenantId: TENANT,
    year: 2026,
    month: 8,
    byRate: [],
    baseTotal: d("0.00"),
    taxTotal: d("0.00"),
    deductible: { byRate: [], baseTotal: d("0.00"), taxTotal: d("0.00") },
    result: d("0.00"),
    ...over,
  };
}

describe("mapModelo303", () => {
  it("maps a worked example onto the verified casillas (the demo's month)", () => {
    const ret = vatReturn({
      byRate: [
        { rate: d("10.00"), base: d("160.00"), tax: d("16.00") },
        { rate: d("21.00"), base: d("335.00"), tax: d("70.35") },
      ],
      taxTotal: d("86.35"),
      deductible: {
        byRate: [
          { rate: d("10.00"), base: d("100.00"), tax: d("10.00"), kind: "ordinary" },
          { rate: d("21.00"), base: d("200.00"), tax: d("41.99"), kind: "ordinary" },
          { rate: d("21.00"), base: d("1000.00"), tax: d("210.00"), kind: "capital" },
        ],
        baseTotal: d("1300.00"),
        taxTotal: d("261.99"),
      },
      result: d("-175.64"),
    });

    const m = mapModelo303(ret);
    expect(m).toMatchObject({ tenantId: TENANT, year: 2026, month: 8 });
    expect(m.boxes).toEqual({
      // IVA devengado — 10% → 04/05/06, 21% → 07/08/09 (rate box holds the tipo)
      "04": "160.00",
      "05": "10.00",
      "06": "16.00",
      "07": "335.00",
      "08": "21.00",
      "09": "70.35",
      // IVA deducible — corrientes 28/29 (100+200 base, 10.00+41.99 cuota), inversión 30/31
      "28": "300.00",
      "29": "51.99",
      "30": "1000.00",
      "31": "210.00",
      // totals + result
      "27": "86.35",
      "45": "261.99",
      "46": "-175.64",
      "64": "-175.64",
      "65": "100.00",
      "66": "-175.64",
      "69": "-175.64",
      "71": "-175.64",
    });
  });

  it("keeps casilla 46 = 27 − 45 (verified arithmetic)", () => {
    const m = mapModelo303(
      vatReturn({
        byRate: [{ rate: d("21.00"), base: d("500.00"), tax: d("105.00") }],
        taxTotal: d("105.00"),
        deductible: {
          byRate: [{ rate: d("21.00"), base: d("100.00"), tax: d("21.00"), kind: "ordinary" }],
          baseTotal: d("100.00"),
          taxTotal: d("21.00"),
        },
        result: d("84.00"),
      }),
    );
    expect(m.boxes["46"]).toBe(subtractDecimal(m.boxes["27"]!, m.boxes["45"]!));
    expect(m.boxes["46"]).toBe("84.00");
  });

  it("splits deducible by kind: ordinary → 28/29, capital → 30/31 (0.00 when a kind is absent)", () => {
    const m = mapModelo303(
      vatReturn({
        deductible: {
          byRate: [{ rate: d("21.00"), base: d("100.00"), tax: d("21.00"), kind: "ordinary" }],
          baseTotal: d("100.00"),
          taxTotal: d("21.00"),
        },
        result: d("-21.00"),
      }),
    );
    expect(m.boxes["28"]).toBe("100.00");
    expect(m.boxes["29"]).toBe("21.00");
    expect(m.boxes["30"]).toBe("0.00"); // no capital lines
    expect(m.boxes["31"]).toBe("0.00");
  });

  it("maps the 0% and 4% devengado rates to 150–152 and 01–03", () => {
    const m = mapModelo303(
      vatReturn({
        byRate: [
          { rate: d("0.00"), base: d("50.00"), tax: d("0.00") },
          { rate: d("4.00"), base: d("25.00"), tax: d("1.00") },
        ],
        taxTotal: d("1.00"),
        result: d("1.00"),
      }),
    );
    expect(m.boxes["150"]).toBe("50.00");
    expect(m.boxes["151"]).toBe("0.00");
    expect(m.boxes["152"]).toBe("0.00");
    expect(m.boxes["01"]).toBe("25.00");
    expect(m.boxes["02"]).toBe("4.00");
    expect(m.boxes["03"]).toBe("1.00");
  });

  it("refuses a rate with no verified box (the retired 5%) rather than inventing one", () => {
    expect(() =>
      mapModelo303(
        vatReturn({
          byRate: [{ rate: d("5.00"), base: d("100.00"), tax: d("5.00") }],
          taxTotal: d("5.00"),
          result: d("5.00"),
        }),
      ),
    ).toThrow(/no devengado box for rate 5.00/);
  });

  it("emits no box for an absent rate, and never emits the unverified casilla 67", () => {
    const m = mapModelo303(
      vatReturn({
        byRate: [{ rate: d("21.00"), base: d("100.00"), tax: d("21.00") }],
        taxTotal: d("21.00"),
        result: d("21.00"),
      }),
    );
    // Only 21% sold → no 4%/10%/0% devengado boxes.
    expect(m.boxes["01"]).toBeUndefined();
    expect(m.boxes["04"]).toBeUndefined();
    expect(m.boxes["150"]).toBeUndefined();
    // The retired 5% boxes never exist.
    expect(m.boxes["153"]).toBeUndefined();
    // Casilla 67 is deliberately NOT emitted — confirmed ABSENT from DR303e26 (see modelo-303.ts).
    expect(m.boxes["67"]).toBeUndefined();
  });
});

// ── Tipo-% box cross-check: the map's rate value ⇔ the DR303 layout's hardcoded constant ──
//
// The devengado tipo-% boxes (02 → 4 %, 05 → 10 %, 08 → 21 %, 151 → 0 %) are written TWICE by two
// independent encodings that must always agree: `mapModelo303` writes the rate itself (e.g. "21.00")
// into the box key, while the DR303 serializer NEVER reads that key — it emits `dr303-layout.ts`'s
// hardcoded `constant` for the field. They currently agree because `DEVENGADO_BOXES` was transcribed
// to match the layout, but nothing pins it, so a future edit to either side could silently diverge in
// a live tax file. This asserts the seam: format the map's rate through the serializer's OWN numeric
// formatter and it must be byte-identical to the layout constant.
describe("mapModelo303 rate-% boxes agree with the DR303 layout constants", () => {
  const RATE_BOXES: ReadonlyArray<{ casilla: string; rate: string }> = [
    { casilla: "02", rate: "4.00" },
    { casilla: "05", rate: "10.00" },
    { casilla: "08", rate: "21.00" },
    { casilla: "151", rate: "0.00" },
  ];

  // Every devengado rate present, so mapModelo303 emits all four tipo boxes at once.
  const allRates = vatReturn({
    byRate: [
      { rate: d("0.00"), base: d("50.00"), tax: d("0.00") },
      { rate: d("4.00"), base: d("25.00"), tax: d("1.00") },
      { rate: d("10.00"), base: d("160.00"), tax: d("16.00") },
      { rate: d("21.00"), base: d("335.00"), tax: d("70.35") },
    ],
    taxTotal: d("87.35"),
    result: d("87.35"),
  });

  const layoutFields = [DR303_LAYOUT.comun, DR303_LAYOUT.pagina1, DR303_LAYOUT.pagina3].flatMap(
    (s) => s.fields,
  );

  it.each(RATE_BOXES)(
    "casilla $casilla: the map's rate encodes to the layout's hardcoded rate constant",
    ({ casilla, rate }) => {
      const boxes = mapModelo303(allRates).boxes;
      // The map placed the rate itself (the tipo box holds the rate, not a money amount).
      expect(boxes[casilla]).toBe(rate);

      const field = layoutFields.find((f) => f.casilla === casilla);
      if (!field) throw new Error(`no casilla ${casilla} in the DR303 layout`);
      // The serializer emits this field as a CONSTANT (it never reads the map's rate box). Its declared
      // `decimals` is 0 (an artifact of being a constant), but a "Tipo %" packs 3 int + 2 dec per the
      // AEAT manual, which is what the constant already carries — so format the map's rate at the field
      // width with 2 decimals and the two independent encodings must be byte-identical.
      expect(field.role).toBe("constant");
      expect(
        formatNumericField(boxes[casilla]!, field.len, "Num", 2),
        `rate drift for casilla ${casilla}`,
      ).toBe(field.value);
    },
  );
});
