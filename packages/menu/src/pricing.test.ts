import { describe, expect, it } from "vitest";
import {
  addDecimal,
  compareDecimal,
  decimal,
  subtractDecimal,
  sumDecimals,
  VAT_RATE_TABLE,
} from "@waitron/shared";
import type { DatedRate, Decimal } from "@waitron/shared";
import {
  baseFromGross,
  grossBasketWithOptions,
  grossLockedLines,
  priceBasket,
  rateLines,
  shareFreeItems,
  splitGross,
  vatSignRefused,
} from "./pricing.js";
import type {
  BasketItemWithOptions,
  GrossLine,
  GrossLines,
  LockedLine,
  PriceableProduct,
  SelectedOption,
} from "./pricing.js";

const each = (
  unitPrice: string,
  vatClass: PriceableProduct["vatClass"],
  category: string | null = null,
): PriceableProduct => ({
  name: "item",
  descriptions: { en: "item" },
  unit: {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    name: { en: "each" },
    precision: 0,
    abbreviation: { en: "ea" },
  },
  unitPrice,
  vatClass,
  category,
});
const weight = (unitPrice: string, vatClass: PriceableProduct["vatClass"]): PriceableProduct => ({
  name: "sliced ham",
  descriptions: { en: "sliced ham" },
  unit: {
    staffName: "Staff unit",
    staffAbbreviation: "su",
    name: { en: "kg" },
    precision: 3,
    abbreviation: { en: "kg" },
  },
  unitPrice,
  vatClass,
  category: "Food",
});

// Any date: the shipped table carries one rate per class. `pricing.dated.test.ts` covers a change.
const ON = "2026-09-27";

describe("priceBasket — difference method", () => {
  it("prices a frozen extra by portions while retaining its physical amount", () => {
    const gross = grossLockedLines(
      [
        {
          grossUnitPrice: "0.01",
          quantity: "0.150",
          priceQuantity: "0.050",
          name: "Ham slices",
          descriptions: { en: "Ham" },
          category: "Food",
          unitName: { en: "kg" },
          unitPrecision: 3,
          parentLineNo: 1,
        },
      ],
      [VAT_RATE_TABLE.reduced],
    );

    expect(gross.lines[0]).toMatchObject({
      quantity: "0.150",
      priceQuantity: "0.050",
      grossUnitPrice: "0.01",
      lineGross: "0.03",
    });
    expect(rateLines(gross, ON).lines[0]).toMatchObject({
      quantity: "0.150",
      priceQuantity: "0.050",
      lineGross: "0.03",
    });
  });
  it("carries selected variant presentation facts through live and locked pricing", () => {
    const product: PriceableProduct = {
      ...each("4.10", "general"),
      name: "Coffee",
      descriptions: { en: "Our coffee" },
      variantName: "Double",
      variantDescriptions: { en: "Double shot" },
      variantKitchenName: "DBL",
      kitchenName: "COFFEE BAR",
    };
    const expected = {
      name: "Coffee",
      descriptions: { en: "Our coffee" },
      variantName: "Double",
      variantDescriptions: { en: "Double shot" },
      variantKitchenName: "DBL",
      kitchenName: "COFFEE BAR",
    };
    const live = priceBasket([{ product, quantity: "1" }], ON);
    expect(live.lines[0]).toMatchObject(expected);
    expect(live.lines[0]).not.toHaveProperty("variantId");
    const locked = rateLines(
      grossLockedLines(
        [
          {
            grossUnitPrice: "4.10",
            quantity: "1",
            name: product.name,
            descriptions: product.descriptions,
            category: "Drinks",
            variantName: product.variantName,
            variantDescriptions: product.variantDescriptions,
            variantKitchenName: product.variantKitchenName,
            kitchenName: product.kitchenName,
          },
        ],
        [VAT_RATE_TABLE.general],
      ),
      ON,
    );
    expect(locked.lines[0]).toMatchObject(expected);
    expect(locked.lines[0]).not.toHaveProperty("variantId");
  });
  it("prices a fractional quantity for a custom two-decimal unit", () => {
    const r = priceBasket(
      [
        {
          product: {
            name: "tea service",
            descriptions: { en: "tea service" },
            unit: {
              staffName: "Staff unit",
              staffAbbreviation: "su",
              name: { en: "tray" },
              precision: 2,
              abbreviation: { en: "tr" },
            },
            unitPrice: "8.00",
            vatClass: "general",
            category: null,
          },
          quantity: "0.25",
        },
      ],
      ON,
    );
    expect(r.total).toBe(decimal("2.00"));
    expect(r.lines[0]).toMatchObject({
      quantity: "0.25",
      unitName: { en: "tr" }, // the frozen printed label is the unit's abbreviation, not "tray"
      unitPrecision: 2,
    });
  });

  it("freezes the unit's abbreviation as the printed label, not its full name", () => {
    const priced = priceBasket(
      [
        {
          product: {
            name: "Olives",
            descriptions: { en: "Olives" },
            unit: {
              staffName: "Staff unit",
              staffAbbreviation: "su",
              name: { en: "Kilogram" },
              precision: 3,
              abbreviation: { en: "kg" },
            },
            unitPrice: "10.00",
            vatClass: "general",
            category: null,
          },
          quantity: "1.500",
        },
      ],
      ON,
    );
    expect(priced.lines[0]!.unitName).toEqual({ en: "kg" });
  });

  it("reverses a weighed gross line to base + tax that re-sum to the gross exactly", () => {
    const r = priceBasket([{ product: weight("24.90", "reduced"), quantity: "0.320" }], ON);
    expect(r.total).toBe(decimal("7.97"));
    expect(r.lines[0]!.lineTotal).toBe(decimal("7.25"));
    expect(r.lines[0]!.vatRate).toBe(decimal("10.00"));
    expect(r.lines[0]!.category).toBe("Food");
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("7.25"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.72")); // gross - base, NOT base*rate
  });

  it("charges a round each-price exactly", () => {
    const r = priceBasket([{ product: each("8.50", "general"), quantity: "1" }], ON);
    expect(r.total).toBe(decimal("8.50"));
    expect(addDecimal(r.vatBreakdown[0]!.base, r.vatBreakdown[0]!.tax)).toBe(decimal("8.50"));
  });

  it("groups two lines at the same rate into one breakdown entry", () => {
    const r = priceBasket(
      [
        { product: each("8.50", "general"), quantity: "1" },
        { product: each("2.00", "general"), quantity: "3" },
      ],
      ON,
    );
    expect(r.vatBreakdown).toHaveLength(1);
    expect(r.total).toBe(decimal("14.50"));
  });

  it("splits distinct rates into distinct breakdown entries", () => {
    const r = priceBasket(
      [
        { product: each("8.50", "general"), quantity: "1" },
        { product: weight("24.90", "reduced"), quantity: "0.320" },
      ],
      ON,
    );
    expect(r.vatBreakdown).toHaveLength(2);
  });

  it("treats a zero-rate line as all base, no tax", () => {
    const r = priceBasket([{ product: each("5.00", "zero"), quantity: "1" }], ON);
    expect(r.vatBreakdown[0]!.base).toBe(decimal("5.00"));
    expect(r.vatBreakdown[0]!.tax).toBe(decimal("0.00"));
  });

  it("keeps total == Σ(base + tax) exactly (reconciliation invariant)", () => {
    const r = priceBasket(
      [
        { product: weight("24.90", "reduced"), quantity: "0.320" },
        { product: each("8.50", "general"), quantity: "2" },
        { product: each("1.30", "super_reduced"), quantity: "5" },
      ],
      ON,
    );
    const reconstructed = sumDecimals(r.vatBreakdown.flatMap((g) => [g.base, g.tax]));
    expect(compareDecimal(reconstructed, r.total)).toBe(0);
  });
});

describe("grossBasketWithOptions — the gross figures, which take no date", () => {
  const plain = (items: { product: PriceableProduct; quantity: string }[]) =>
    items.map((item) => ({ ...item, options: [] }));

  it("prices three 0.050 kg portions per dish at the rounded price of each pick", () => {
    const gross = grossBasketWithOptions([
      {
        product: each("2.00", "reduced"),
        quantity: "2",
        options: [
          {
            name: "Ham slices",
            descriptions: { en: "Ham" },
            priceDelta: "0.01",
            vatRates: VAT_RATE_TABLE.general,
            quantity: 3,
            physicalQuantity: "0.150",
            priceQuantity: "0.050",
            unitName: { en: "kg" },
            unitPrecision: 3,
          },
        ],
      },
    ]);

    expect(gross.lines[1]).toMatchObject({
      quantity: "0.300",
      priceQuantity: "0.050",
      unitName: { en: "kg" },
      unitPrecision: 3,
      grossUnitPrice: "0.01",
      lineGross: "0.06",
      vatRates: VAT_RATE_TABLE.general,
    });
    expect(gross.total).toBe("4.06");
  });

  it("gives each line's GROSS unitPrice×quantity, its gross unit and its class, and rating keeps the net base apart", () => {
    const items = plain([
      { product: each("1.50", "general"), quantity: "2" }, // 3.00 gross, 2.48 net base
      { product: weight("24.90", "reduced"), quantity: "0.320" }, // 7.97 gross, 7.25 net base
    ]);
    const gross = grossBasketWithOptions(items);
    expect(gross.lines.map((line) => line.lineGross)).toEqual([decimal("3.00"), decimal("7.97")]);
    // The per-UNIT gross is NOT multiplied by quantity: coffee 1.50 (not 3.00) and ham 24.90/kg
    // (not 7.97).
    expect(gross.lines.map((line) => line.grossUnitPrice)).toEqual([
      decimal("1.50"),
      decimal("24.90"),
    ]);
    expect(gross.lines.map((line) => line.vatRates)).toEqual([
      VAT_RATE_TABLE.general,
      VAT_RATE_TABLE.reduced,
    ]);
    expect(gross.lines[0]).not.toHaveProperty("vatRate");
    expect(gross.lines[0]).not.toHaveProperty("lineTotal");
    // The gross line total is what the operator/customer sees (and what the working-order draft
    // stores in `working_order_lines.line_total`); the FILED fiscal line keeps the NET base.
    const r = rateLines(gross, ON);
    expect(r.lines[0]!.lineTotal).toBe(decimal("2.48"));
    expect(r.lines[1]!.lineTotal).toBe(decimal("7.25"));
  });

  it("sums to `total` EXACTLY — the invariant the held-orders list's sum(line_total) relies on", () => {
    const gross = grossBasketWithOptions(
      plain([
        { product: weight("24.90", "reduced"), quantity: "0.320" },
        { product: each("8.50", "general"), quantity: "2" },
        { product: each("1.30", "super_reduced"), quantity: "5" },
      ]),
    );
    expect(sumDecimals(gross.lines.map((line) => line.lineGross))).toBe(gross.total);
    expect(rateLines(gross, ON).total).toBe(gross.total);
  });

  it("carries each line's gross onto the rated line itself, for the sale line's `line_gross`", () => {
    const gross = grossBasketWithOptions([
      {
        product: each("1.50", "general"),
        quantity: "2",
        options: [
          { name: "Lemon", descriptions: { en: "Lemon" }, priceDelta: "0.40", vatRates: null },
        ],
      },
      { product: weight("24.90", "reduced"), quantity: "0.320", options: [] },
    ]);
    const r = rateLines(gross, ON);
    // The dish 3.00, its extra 0.80 (0.40 × 2) and the weighed line 7.97, each beside a different
    // net base, so a line carrying its net total or another line's gross fails.
    expect(r.lines.map((line) => line.lineGross)).toEqual(["3.00", "0.80", "7.97"]);
    expect(r.lines.map((line) => line.lineGross)).toEqual(gross.lines.map((l) => l.lineGross));
  });
});

describe("rateLines", () => {
  it("keeps every field a gross line carries, a caller's own included, and drops the rates and gross unit", () => {
    const gross = grossBasketWithOptions([
      { product: each("12.10", "general"), quantity: "1", options: [] },
    ]);
    const tagged = { ...gross, lines: gross.lines.map((line) => ({ ...line, productId: "p-1" })) };
    const rated = rateLines(tagged, ON);
    expect(rated.lines[0]).toEqual({
      lineNo: 1,
      name: "item",
      descriptions: { en: "item" },
      optionSnapshots: [],
      quantity: "1",
      unitPrice: "10.00",
      vatRate: "21.00",
      lineTotal: "10.00",
      category: null,
      unitName: { en: "ea" },
      unitPrecision: 0,
      parentLineNo: null,
      variantName: null,
      variantDescriptions: null,
      variantKitchenName: null,
      kitchenName: null,
      lineGross: "12.10",
      productId: "p-1",
    });
  });
});

describe("rateLines — each line's own list of dated rates", () => {
  const line = (lineNo: number, gross: string, vatRates: readonly DatedRate[]) => ({
    lineNo,
    name: `line ${lineNo}`,
    descriptions: {},
    quantity: "1",
    vatRates,
    grossUnitPrice: decimal(gross),
    lineGross: decimal(gross),
  });

  it("rates each line from its own list on the date: a 4% group and a 21% group", () => {
    const lines = [
      line(1, "10.40", [
        { from: null, rate: "10.00" },
        { from: "2027-01-01", rate: "4.00" },
      ]),
      line(2, "12.10", [{ from: null, rate: "21.00" }]),
    ];
    const priced = rateLines({ lines, total: decimal("22.50") }, "2027-01-01");
    expect(priced.lines.map((l) => l.vatRate)).toEqual(["4.00", "21.00"]);
    expect(priced.vatBreakdown).toEqual([
      { rate: "4.00", base: "10.00", tax: "0.40" },
      { rate: "21.00", base: "10.00", tax: "2.10" },
    ]);
  });

  it("refuses a line whose list is empty, naming the line", () => {
    const lines = [line(1, "12.10", [{ from: null, rate: "21.00" }]), line(2, "1.00", [])];
    expect(() => rateLines({ lines, total: decimal("13.10") }, ON)).toThrow(
      expect.objectContaining({ code: "vat_rate.unavailable", params: { lineNo: 2 } }),
    );
  });

  it("grossLockedLines without rates gives every line an empty list", () => {
    const stored = {
      grossUnitPrice: "1.00",
      quantity: "1",
      name: "item",
      descriptions: { en: "item" },
      category: null,
    };
    const gross = grossLockedLines([stored, stored]);
    expect(gross.lines.map((l) => l.vatRates)).toEqual([[], []]);
  });

  it("grossLockedLines carries a line's set-menu role, and none on a line without one", () => {
    const stored = {
      grossUnitPrice: "14.00",
      quantity: "1",
      name: "Daily menu",
      descriptions: { en: "Daily menu" },
      category: null,
    };
    const gross = grossLockedLines([
      { ...stored, setMenuRole: "set_menu" },
      { ...stored, name: "Soup", grossUnitPrice: "0.00", setMenuRole: "dish" },
      { ...stored, name: "Bread", setMenuRole: null },
    ]);
    expect(gross.lines.map((l) => l.setMenuRole)).toEqual(["set_menu", "dish", undefined]);
    expect(gross.lines[2]).not.toHaveProperty("setMenuRole");
  });

  it("grossLockedLines with rates gives each line its own list", () => {
    const stored = {
      grossUnitPrice: "1.00",
      quantity: "1",
      name: "item",
      descriptions: { en: "item" },
      category: null,
    };
    const general = [{ from: null, rate: "21.00" }];
    const reduced = [{ from: null, rate: "10.00" }];
    const gross = grossLockedLines([stored, stored], [general, reduced]);
    expect(gross.lines.map((l) => l.vatRates)).toEqual([general, reduced]);
  });

  it("grossLockedLines refuses a list of rates that is not one per line", () => {
    const stored = {
      grossUnitPrice: "1.00",
      quantity: "1",
      name: "item",
      descriptions: { en: "item" },
      category: null,
    };
    const general = [{ from: null, rate: "21.00" }];
    expect(() => grossLockedLines([stored, stored], [general])).toThrow(
      "grossLockedLines: 1 rate lists for 2 lines",
    );
    expect(() => grossLockedLines([stored], [general, general])).toThrow(
      "grossLockedLines: 2 rate lists for 1 lines",
    );
  });
});

describe("a VAT class", () => {
  it("prices a product at its class's rate", () => {
    const priced = priceBasket([{ product: each("11.00", "reduced"), quantity: "1" }], ON);
    expect(priced.lines[0]!.vatRate).toBe(decimal("10.00"));
    expect(priced.vatBreakdown).toEqual([
      { rate: decimal("10.00"), base: decimal("10.00"), tax: decimal("1.00") },
    ]);
  });

  it("prices a dish, an inheriting option and an option with its own class at their classes' rates", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("11.00", "reduced"),
          quantity: "1",
          options: [
            { name: "Ice", descriptions: { es: "Ice" }, priceDelta: "1.10", vatRates: null },
            {
              name: "Small plate",
              descriptions: { es: "Small plate" },
              priceDelta: "1.04",
              vatRates: VAT_RATE_TABLE.super_reduced,
            },
          ],
        },
      ]),
      ON,
    );
    expect(priced.lines.map((line) => line.vatRate)).toEqual([
      decimal("10.00"),
      decimal("10.00"),
      decimal("4.00"),
    ]);
  });
});

// A dish + its selected options price as a PARENT line followed by its CHILD lines, through the
// same arithmetic core as a plain basket.
describe("rateLines over grossBasketWithOptions — parent + child lines", () => {
  const opt = (
    priceDelta: string,
    vatClass: PriceableProduct["vatClass"] | null,
    name = "Option",
    descriptions: Record<string, string> = { es: "Option" },
  ): SelectedOption => ({
    name,
    descriptions,
    priceDelta,
    vatRates: vatClass === null ? null : VAT_RATE_TABLE[vatClass],
  });

  it("prices a dish with options as parent + child lines", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: {
            name: "Coffee",
            descriptions: { es: "Coffee" },
            unit: {
              staffName: "Staff unit",
              staffAbbreviation: "su",
              name: { en: "each" },
              precision: 0,
              abbreviation: { en: "ea" },
            },
            unitPrice: "2.50",
            vatClass: "reduced",
            category: "Drinks",
          },
          quantity: "1",
          options: [
            { name: "Large", descriptions: { es: "Large" }, priceDelta: "0.50", vatRates: null },
            {
              name: "Oat milk",
              descriptions: { es: "Oat milk" },
              priceDelta: "0.40",
              vatRates: null,
            },
          ],
        },
      ]),
      ON,
    );
    expect(priced.lines).toHaveLength(3);
    expect(priced.lines[1]!.parentLineNo).toBe(1);
    expect(priced.total.toString()).toBe("3.40");
  });

  it("carries the option's own kitchen name onto its child line", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("2.50", "reduced", "Drinks"),
          quantity: "1",
          options: [
            {
              ...opt("4.50", "general", "Wine staff", { es: "Wine customer" }),
              kitchenName: "Wine kitchen",
            },
          ],
        },
      ]),
      ON,
    );
    // The dish's own kitchen name is absent here, so a child reading the parent's would read null.
    expect(priced.lines[1]!.kitchenName).toBe("Wine kitchen");
  });

  it("emits THREE lines; both children carry the dish's lineNo as parentLineNo, and a free option bases to 0", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("2.50", "reduced", "Drinks"),
          quantity: "1",
          options: [
            opt("0.00", null, "No sugar", { es: "No sugar" }),
            opt("0.50", null, "Large", { es: "Large" }),
          ],
        },
      ]),
      ON,
    );
    expect(priced.lines).toHaveLength(3);
    // The parent dish is line 1; both children point back to it.
    expect(priced.lines[0]!.lineNo).toBe(1);
    expect(priced.lines[0]!.parentLineNo).toBe(null);
    expect(priced.lines[1]!.parentLineNo).toBe(priced.lines[0]!.lineNo);
    expect(priced.lines[2]!.parentLineNo).toBe(priced.lines[0]!.lineNo);
    // The free option contributes nothing: its net base (and its gross line total) are 0.
    expect(priced.lines[1]!.lineTotal).toBe(decimal("0.00"));
    expect(priced.lines[1]!.lineGross).toBe(decimal("0.00"));
    // A child inherits the parent's snapshotted analytics category.
    expect(priced.lines[1]!.category).toBe("Drinks");
    expect(priced.total).toBe(decimal("3.00"));
  });

  it("propagates the dish quantity onto every child (2× dish, one +1.00 option → child qty 2, gross 2.00)", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("5.00", "general"),
          quantity: "2",
          options: [opt("1.00", null)],
        },
      ]),
      ON,
    );
    expect(priced.lines[1]!.quantity).toBe("2");
    expect(priced.lines[1]!.lineGross).toBe(decimal("2.00")); // 1.00 × 2
    expect(priced.total).toBe(decimal("12.00")); // 5.00×2 + 1.00×2
  });

  it("mixes VAT rates: a general-rated option on a reduced-rated dish yields a two-rate breakdown", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("10.00", "reduced"),
          quantity: "1",
          options: [opt("2.00", "general")],
        },
      ]),
      ON,
    );
    // Parent (10%) is inserted before child (21%), so the breakdown lists 10.00 then 21.00.
    expect(priced.vatBreakdown).toEqual([
      { rate: decimal("10.00"), base: decimal("9.09"), tax: decimal("0.91") },
      { rate: decimal("21.00"), base: decimal("1.65"), tax: decimal("0.35") },
    ]);
    expect(priced.total).toBe(decimal("12.00"));
  });

  it("inherits the dish's rate when the option's vatRates is null", () => {
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("5.00", "general"),
          quantity: "1",
          options: [opt("1.00", null)],
        },
      ]),
      ON,
    );
    expect(priced.lines[1]!.vatRate).toBe(decimal("21.00"));
    expect(priced.vatBreakdown).toHaveLength(1); // dish + option share the 21% group
  });

  it("prices an option taken ×N per dish (dish ×3, option ×2 → child qty 6, gross = priceDelta × 6)", () => {
    // Per-option quantity: the child line is priced at dishQuantity × the option's own count. A
    // non-trivial priceDelta (1.50) makes the total unambiguous — 1.50 × 6 = 9.00, which no other
    // multiplication of the operands reaches.
    const priced = rateLines(
      grossBasketWithOptions([
        {
          product: each("4.00", "general"),
          quantity: "3",
          options: [
            {
              name: "Extra shot",
              descriptions: { es: "Extra shot" },
              priceDelta: "1.50",
              vatRates: null,
              quantity: 2,
            },
          ],
        },
      ]),
      ON,
    );
    // The child carries dish×option = 3 × 2 = 6, priced at 1.50 each → 9.00 gross.
    expect(priced.lines[1]!.quantity).toBe("6");
    expect(priced.lines[1]!.lineGross).toBe(decimal("9.00"));
    // The PARENT dish is untouched by the option count: still qty 3 at 4.00 → 12.00 gross.
    expect(priced.lines[0]!.quantity).toBe("3");
    expect(priced.lines[0]!.lineGross).toBe(decimal("12.00"));
    expect(priced.total).toBe(decimal("21.00")); // 4.00×3 + 1.50×6
  });

  it("treats an OMITTED option quantity exactly as quantity 1 (byte-identical path)", () => {
    const build = (quantity?: number): BasketItemWithOptions[] => [
      {
        product: each("5.00", "general"),
        quantity: "2",
        options: [
          {
            name: "Large",
            descriptions: { es: "Large" },
            priceDelta: "1.30",
            vatRates: null,
            ...(quantity !== undefined ? { quantity } : {}),
          },
        ],
      },
    ];
    // An option with no `quantity` field must price exactly as one with `quantity: 1`.
    expect(rateLines(grossBasketWithOptions(build()), ON)).toEqual(
      rateLines(grossBasketWithOptions(build(1)), ON),
    );
  });

  it("with EMPTY options is line-for-line identical to priceBasket", () => {
    const items: BasketItemWithOptions[] = [
      { product: each("8.50", "general"), quantity: "2", options: [] },
      { product: weight("24.90", "reduced"), quantity: "0.320", options: [] },
      { product: each("1.30", "super_reduced"), quantity: "5", options: [] },
    ];
    expect(rateLines(grossBasketWithOptions(items), ON)).toEqual(
      priceBasket(
        items.map(({ product, quantity }) => ({ product, quantity })),
        ON,
      ),
    );
  });
});

// `grossLockedLines` prices from the STORED gross unit exactly as `priceBasket` prices from the
// live menu.
describe("rateLines over grossLockedLines — a locked line rates as a walk-up does", () => {
  it("prices locked lines to the difference-method VAT breakdown (base 4.55 / tax 0.95), like a walk-up", () => {
    // coffee×1 (gross 1.50) + water×2 (gross unit 2.00, qty 2). Group base 4.55, gross 5.50, tax 0.95
    // (NOT round(4.55×21%)=0.96).
    const priced = rateLines(
      grossLockedLines(
        [
          {
            grossUnitPrice: "1.50",
            quantity: "1",
            name: "Coffee",
            descriptions: { es: "Coffee" },
            category: null,
          },
          {
            grossUnitPrice: "2.00",
            quantity: "2",
            name: "Water",
            descriptions: { es: "Water" },
            category: null,
          },
        ],
        [VAT_RATE_TABLE.general, VAT_RATE_TABLE.general],
      ),
      ON,
    );
    expect(priced.total).toBe("5.50");
    expect(priced.vatBreakdown).toEqual([{ rate: "21.00", base: "4.55", tax: "0.95" }]);
    expect(priced.lines.map((line) => line.lineGross)).toEqual(["1.50", "4.00"]);
    // The per-line net base + net unit match what priceBasket produces for the same gross figures.
    expect(priced.lines[0]).toMatchObject({
      lineNo: 1,
      unitPrice: "1.24",
      vatRate: "21.00",
      lineTotal: "1.24",
    });
    expect(priced.lines[1]).toMatchObject({
      lineNo: 2,
      unitPrice: "1.65",
      vatRate: "21.00",
      lineTotal: "3.31",
    });
  });

  it("prices a weighed locked line from its stored gross unit, not line_total ÷ quantity", () => {
    // A weighed line where recovery by division would drift: gross unit 9.99/kg, qty 0.333 → gross
    // 3.33. grossLockedLines takes the STORED gross unit, so base/tax match the add-time VAT breakdown.
    const priced = rateLines(
      grossLockedLines(
        [
          {
            grossUnitPrice: "9.99",
            quantity: "0.333",
            name: "Ham slices",
            descriptions: { es: "Ham" },
            category: null,
          },
        ],
        [VAT_RATE_TABLE.reduced],
      ),
      ON,
    );
    expect(priced.total).toBe("3.33");
    expect(priced.vatBreakdown).toEqual([{ rate: "10.00", base: "3.03", tax: "0.30" }]);
  });

  it("is byte-identical to re-pricing the same products — mixed rates and a weighed line", () => {
    // Filing a retrieved order from the stored lock produces the SAME result as re-pricing the same
    // product at the same gross, to the cent.
    const basket = [
      { product: each("8.50", "general"), quantity: "2" }, // 21% each
      { product: weight("24.90", "reduced"), quantity: "0.320" }, // 10% weighed
      { product: each("1.30", "super_reduced"), quantity: "5" }, // 4% each
    ];
    const locked: LockedLine[] = [
      {
        grossUnitPrice: "8.50",
        quantity: "2",
        name: "item",
        descriptions: { en: "item" },
        category: null,
        unitName: { en: "ea" },
        unitPrecision: 0,
      },
      {
        grossUnitPrice: "24.90",
        quantity: "0.320",
        name: "sliced ham",
        descriptions: { en: "sliced ham" },
        category: "Food",
        unitName: { en: "kg" },
        unitPrecision: 3,
      },
      {
        grossUnitPrice: "1.30",
        quantity: "5",
        name: "item",
        descriptions: { en: "item" },
        category: null,
        unitName: { en: "ea" },
        unitPrecision: 0,
      },
    ];
    expect(
      rateLines(
        grossLockedLines(locked, [
          VAT_RATE_TABLE.general,
          VAT_RATE_TABLE.reduced,
          VAT_RATE_TABLE.super_reduced,
        ]),
        ON,
      ),
    ).toEqual(priceBasket(basket, ON));
  });
});

describe("frozen options answers", () => {
  it("carries the answers through live and locked pricing without changing totals", () => {
    // Each of the six names is different text, so an assertion cannot pass while a different one
    // is carried through.
    const optionSnapshots = [
      {
        listName: { en: "Milk" },
        listCustomerName: { en: "Which milk?" },
        listKitchenName: "MILK",
        labelName: { en: "Oat" },
        labelCustomerName: { en: "Oat milk" },
        labelKitchenName: "OAT",
      },
    ];
    const live = rateLines(
      grossBasketWithOptions([
        { product: each("2.20", "reduced"), quantity: "2", options: [], optionSnapshots },
      ]),
      ON,
    );
    expect(live.lines[0]).toHaveProperty("optionSnapshots", optionSnapshots);
    expect(live.total).toBe("4.40");
    const locked = rateLines(
      grossLockedLines(
        [
          {
            grossUnitPrice: "2.20",
            quantity: "2",
            name: "item",
            descriptions: { en: "item" },
            category: null,
            optionSnapshots,
            unitName: { en: "ea" },
            unitPrecision: 0,
          },
        ],
        [VAT_RATE_TABLE.reduced],
      ),
      ON,
    );
    expect(locked).toEqual(live);
    expect(live.vatBreakdown).toEqual(
      priceBasket([{ product: each("2.20", "reduced"), quantity: "2" }], ON).vatBreakdown,
    );
  });
});

const cents = (n: number): Decimal => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return decimal(`${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`);
};

const grossOf = (amounts: readonly string[], vatClass: PriceableProduct["vatClass"]) => {
  const lines = amounts.map((amount, i) => ({
    lineNo: i + 1,
    name: `line ${i + 1}`,
    descriptions: {},
    quantity: "1",
    vatRates: VAT_RATE_TABLE[vatClass],
    grossUnitPrice: decimal(amount),
    lineGross: decimal(amount),
  }));
  return { lines, total: sumDecimals(lines.map((line) => line.lineGross)) };
};

describe("the one-cent rule (D11)", () => {
  it("a lone €0.05 item at 10% rates 0.04 + 0.01", () => {
    const r = rateLines(grossOf(["0.05"], "reduced"), ON);
    expect(r.vatBreakdown).toEqual([{ rate: "10.00", base: "0.04", tax: "0.01" }]);
    expect(r.lines[0]!.lineTotal).toBe("0.04");
    expect(r.total).toBe("0.05");
    expect(splitGross(decimal("0.05"), decimal("10.00"))).toEqual({ base: "0.04", tax: "0.01" });
    expect(splitGross(decimal("-0.05"), decimal("10.00"))).toEqual({
      base: "-0.04",
      tax: "-0.01",
    });
  });

  it("€0.13 at 4% rates 0.12 + 0.01", () => {
    const r = rateLines(grossOf(["0.13"], "super_reduced"), ON);
    expect(r.vatBreakdown).toEqual([{ rate: "4.00", base: "0.12", tax: "0.01" }]);
    expect(r.lines[0]!.lineTotal).toBe("0.12");
    expect(splitGross(decimal("0.13"), decimal("4.00"))).toEqual({ base: "0.12", tax: "0.01" });
  });

  it("the cent comes off the largest line, never a €0.00 line", () => {
    const r = rateLines(grossOf(["0.05", "0.00"], "reduced"), ON);
    expect(r.lines.map((line) => line.lineTotal)).toEqual(["0.04", "0.00"]);
    expect(r.vatBreakdown).toEqual([{ rate: "10.00", base: "0.04", tax: "0.01" }]);
    const last = rateLines(grossOf(["0.00", "0.05"], "reduced"), ON);
    expect(last.lines.map((line) => line.lineTotal)).toEqual(["0.00", "0.04"]);
  });

  it("on a tie the cent comes off the last of the largest lines", () => {
    const r = rateLines(grossOf(["0.03", "0.03", "-0.01"], "reduced"), ON);
    expect(r.lines.map((line) => line.lineTotal)).toEqual(["0.03", "0.02", "-0.01"]);
    expect(r.vatBreakdown).toEqual([{ rate: "10.00", base: "0.04", tax: "0.01" }]);
  });

  it("with a negative rate total the cent comes off the most negative line, the last on a tie, and no €0.00 line moves", () => {
    const one = rateLines(grossOf(["0.00", "-0.04", "-0.01"], "reduced"), ON);
    expect(one.lines.map((line) => line.lineTotal)).toEqual(["0.00", "-0.03", "-0.01"]);
    expect(one.vatBreakdown).toEqual([{ rate: "10.00", base: "-0.04", tax: "-0.01" }]);
    const tie = rateLines(grossOf(["-0.03", "0.00", "-0.03", "0.01"], "reduced"), ON);
    expect(tie.lines.map((line) => line.lineTotal)).toEqual(["-0.03", "0.00", "-0.02", "0.01"]);
    expect(tie.vatBreakdown).toEqual([{ rate: "10.00", base: "-0.04", tax: "-0.01" }]);
  });

  it("every other amount rates as before", () => {
    const changed: string[] = [];
    for (const vatClass of ["general", "reduced", "super_reduced", "zero"] as const) {
      for (let n = -20000; n <= 20000; n += 1) {
        const gross = cents(n);
        const r = rateLines(grossOf([gross], vatClass), ON);
        const rate = r.vatBreakdown[0]!.rate;
        const base = baseFromGross(gross, rate);
        const before = { rate, base, tax: subtractDecimal(gross, base) };
        if (JSON.stringify(r.vatBreakdown[0]) !== JSON.stringify(before)) {
          changed.push(`${gross}@${rate}`);
        }
      }
    }
    expect(changed.sort()).toEqual(["-0.05@10.00", "-0.13@4.00", "0.05@10.00", "0.13@4.00"].sort());
  });

  it("in baskets of two to four lines at one rate, only a group whose VAT was 0.00 on a base vatSignRefused refuses changes", () => {
    const amounts = ["0.00", "0.05", "-0.05", "0.13", "0.03", "-0.01", "0.01", "1.00"];
    const baskets: string[][] = [[]];
    const all: string[][] = [];
    for (let size = 1; size <= 4; size += 1) {
      const longer = baskets.splice(0).flatMap((b) => amounts.map((a) => [...b, a]));
      baskets.push(...longer);
      if (size >= 2) all.push(...longer);
    }
    const unexpected: string[] = [];
    let moved = 0;
    for (const vatClass of ["general", "reduced", "super_reduced", "zero"] as const) {
      for (const basket of all) {
        const r = rateLines(grossOf(basket, vatClass), ON);
        const rate = r.vatBreakdown[0]!.rate;
        const bases = basket.map((amount) => baseFromGross(decimal(amount), rate));
        const base = sumDecimals(bases);
        const gross = sumDecimals(basket.map((amount) => decimal(amount)));
        const tax = subtractDecimal(gross, base);
        const refused =
          compareDecimal(tax, decimal("0.00")) === 0 && vatSignRefused(base, tax, rate);
        const lineTotals = r.lines.map((line) => line.lineTotal);
        const linesMoved = lineTotals.filter((total, i) => total !== bases[i]).length;
        const expected = refused
          ? (() => {
              const cent = decimal(compareDecimal(gross, decimal("0")) < 0 ? "-0.01" : "0.01");
              return { rate, base: subtractDecimal(base, cent), tax: addDecimal(tax, cent) };
            })()
          : { rate, base, tax };
        if (refused) moved += 1;
        const label = `${basket.join("+")}@${rate}`;
        if (JSON.stringify(r.vatBreakdown) !== JSON.stringify([expected])) unexpected.push(label);
        if (linesMoved !== (refused ? 1 : 0))
          unexpected.push(`${label} lines ${lineTotals.join(",")}`);
        basket.forEach((amount, i) => {
          if (amount === "0.00" && lineTotals[i] !== bases[i])
            unexpected.push(`${label} zero line`);
        });
      }
    }
    expect(unexpected.slice(0, 20)).toEqual([]);
    // Control: some baskets do move a cent.
    expect(moved).toBeGreaterThan(0);
  });
});

describe("vatSignRefused — AEAT's sign rule for one rate's base and VAT", () => {
  const refused = (base: string, tax: string, rate: string) =>
    vatSignRefused(decimal(base), decimal(tax), decimal(rate));

  it("refuses VAT 0.00 on a base whose VAT does not round to 0.00", () => {
    expect(refused("0.05", "0.00", "10.00")).toBe(true);
    expect(refused("-0.05", "0.00", "10.00")).toBe(true);
    expect(refused("0.13", "0.00", "4.00")).toBe(true);
  });

  it("accepts VAT 0.00 on a base whose VAT rounds to 0.00, and 0.00 on 0.00", () => {
    expect(refused("0.04", "0.00", "10.00")).toBe(false);
    expect(refused("-0.04", "0.00", "10.00")).toBe(false);
    expect(refused("0.12", "0.00", "4.00")).toBe(false);
    expect(refused("5.00", "0.00", "0.00")).toBe(false);
    expect(refused("0.00", "0.00", "21.00")).toBe(false);
  });

  it("refuses VAT on a 0.00 base", () => {
    expect(refused("0.00", "0.01", "10.00")).toBe(true);
    expect(refused("0.00", "-0.01", "10.00")).toBe(true);
  });

  it("refuses a base and VAT of opposite signs, and accepts matching signs", () => {
    expect(refused("0.03", "-0.03", "10.00")).toBe(true);
    expect(refused("-0.03", "0.03", "10.00")).toBe(true);
    expect(refused("-27.27", "-2.73", "10.00")).toBe(false);
    expect(refused("27.27", "2.73", "10.00")).toBe(false);
  });
});

describe("shareFreeItems — a free item takes its share of the price paid", () => {
  const AT_4: readonly DatedRate[] = [{ from: null, rate: "4.00" }];
  const AT_10: readonly DatedRate[] = [{ from: null, rate: "10.00" }];
  const AT_21: readonly DatedRate[] = [{ from: null, rate: "21.00" }];
  const line = (
    lineNo: number,
    name: string,
    gross: string,
    vatRates: readonly DatedRate[],
    list?: string,
  ): GrossLine => ({
    lineNo,
    name,
    descriptions: {},
    quantity: "1",
    vatRates,
    grossUnitPrice: decimal(gross),
    lineGross: decimal(gross),
    ...(list === undefined ? {} : { listGross: list, listUnitPriceGross: list }),
  });
  const lines = (...items: GrossLine[]): GrossLines => ({
    lines: items,
    total: sumDecimals(items.map((item) => item.lineGross)),
  });
  const waterComped = (saladRates = AT_4, waterRates = AT_21) =>
    lines(line(1, "Salad", "10.00", saladRates), line(2, "Water", "0.00", waterRates, "2.00"));

  it("shares a takeaway ticket's price by menu price when the water is given free", () => {
    const gross = waterComped();
    const shared = shareFreeItems(gross, ON);
    expect(shared.total).toBe("10.00");
    expect(shared.lines).toEqual([
      {
        ...gross.lines[0],
        lineGross: "8.33",
        listGross: "10.00",
        listUnitPriceGross: "10.00",
      },
      { ...gross.lines[1], lineGross: "1.67" },
    ]);
    const priced = rateLines(shared, ON);
    expect(priced.vatBreakdown).toEqual([
      { rate: "4.00", base: "8.01", tax: "0.32" },
      { rate: "21.00", base: "1.38", tax: "0.29" },
    ]);
    expect(priced.lines.map((l) => [l.name, l.lineGross, l.lineTotal, l.unitPrice])).toEqual([
      ["Salad", "8.33", "8.01", "9.62"],
      ["Water", "1.67", "1.38", "0.00"],
    ]);
  });

  it("shares by menu price after a bill discount, keeping the discounted dish's own list price", () => {
    const salad = line(1, "Salad", "9.00", AT_4, "10.00");
    const gross = lines(salad, line(2, "Water", "0.00", AT_21, "2.00"));
    const shared = shareFreeItems(gross, ON);
    expect(shared.total).toBe("9.00");
    expect(shared.lines.map((l) => [l.name, l.lineGross, l.listGross])).toEqual([
      ["Salad", "7.50", "10.00"],
      ["Water", "1.50", "2.00"],
    ]);
    expect(shared.lines[0]!.grossUnitPrice).toBe("9.00");
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "4.00", base: "7.21", tax: "0.29" },
      { rate: "21.00", base: "1.24", tax: "0.26" },
    ]);
  });

  it("gives a shared line sold in a quantity its old unit price as its list unit price", () => {
    const salads = {
      ...line(1, "Salad", "30.00", AT_4),
      quantity: "3",
      grossUnitPrice: decimal("10.00"),
    };
    const gross = lines(salads, line(2, "Water", "0.00", AT_21, "2.00"));
    const shared = shareFreeItems(gross, ON);
    expect(shared.lines[0]).toEqual({
      ...salads,
      lineGross: "28.13",
      listGross: "30.00",
      listUnitPriceGross: "10.00",
    });
    expect(shared.lines[1]!.lineGross).toBe("1.87");
  });

  it("shares the adviser's wine and free bread as the adviser does", () => {
    const gross = lines(line(1, "Wine", "12.00", AT_21), line(2, "Bread", "0.00", AT_4, "2.00"));
    const shared = shareFreeItems(gross, ON);
    expect(shared.lines.map((l) => [l.name, l.lineGross])).toEqual([
      ["Wine", "10.29"],
      ["Bread", "1.71"],
    ]);
    expect(rateLines(shared, ON).vatBreakdown).toEqual([
      { rate: "21.00", base: "8.50", tax: "1.79" },
      { rate: "4.00", base: "1.64", tax: "0.07" },
    ]);
  });

  it("counts no rate for a €0 line with no menu price", () => {
    const gross = lines(
      line(1, "Salad", "7.77", AT_4),
      line(2, "Soup", "3.33", AT_4),
      line(3, "Bread", "0.00", AT_4, "1.99"),
      line(4, "Sauce", "0.00", AT_21),
    );
    expect(shareFreeItems(gross, ON)).toBe(gross);
  });

  it("returns a ticket at one rate unchanged, so eaten here the free water keeps its €0", () => {
    const gross = waterComped(AT_10, AT_10);
    expect(shareFreeItems(gross, ON)).toBe(gross);
    expect(rateLines(gross, ON).vatBreakdown).toEqual([
      { rate: "10.00", base: "9.09", tax: "0.91" },
    ]);
  });

  it("counts the rates each line's list gives on the day", () => {
    const changing: readonly DatedRate[] = [
      { from: null, rate: "21.00" },
      { from: "2027-01-01", rate: "4.00" },
    ];
    const gross = waterComped(AT_4, changing);
    expect(shareFreeItems(gross, "2027-01-01")).toBe(gross);
    expect(shareFreeItems(gross, "2026-12-31")).not.toBe(gross);
  });

  it("returns a two-rate ticket with no free line unchanged", () => {
    const discounted = lines(
      line(1, "Salad", "5.00", AT_4, "10.00"),
      line(2, "Water", "2.00", AT_21),
    );
    expect(shareFreeItems(discounted, ON)).toBe(discounted);
    const freeWithoutListPrice = lines(
      line(1, "Salad", "10.00", AT_4),
      line(2, "Water", "0.00", AT_21),
    );
    expect(shareFreeItems(freeWithoutListPrice, ON)).toBe(freeWithoutListPrice);
    const zeroListPrice = lines(
      line(1, "Salad", "10.00", AT_4),
      line(2, "Water", "0.00", AT_21, "0.00"),
    );
    expect(shareFreeItems(zeroListPrice, ON)).toBe(zeroListPrice);
  });

  it("returns a ticket with a line whose rate list is empty unchanged, for rateLines to refuse", () => {
    const gross = lines(
      line(1, "Salad", "10.00", AT_4),
      line(2, "Water", "0.00", AT_21, "2.00"),
      line(3, "Bread", "1.00", []),
    );
    expect(shareFreeItems(gross, ON)).toBe(gross);
  });

  it("leaves a line whose share equals its gross as it was, and keeps the line order", () => {
    const gross = lines(
      line(1, "Water", "0.00", AT_21, "2.00"),
      line(2, "Salad", "8.00", AT_4, "10.00"),
      line(3, "Free salad", "0.00", AT_4, "0.00"),
    );
    const shared = shareFreeItems(gross, ON);
    expect(shared.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    expect(shared.lines.map((l) => l.lineGross)).toEqual(["1.33", "6.67", "0.00"]);
    expect(shared.lines[2]).toBe(gross.lines[2]);
  });

  it("changes nothing when the whole ticket is given free", () => {
    const gross = lines(
      line(1, "Salad", "0.00", AT_4, "10.00"),
      line(2, "Water", "0.00", AT_21, "2.00"),
    );
    const shared = shareFreeItems(gross, ON);
    expect(shared.lines).toEqual(gross.lines);
    expect(shared.total).toBe("0.00");
  });
});
