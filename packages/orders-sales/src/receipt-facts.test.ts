import { addDecimal, decimal, type Decimal } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { receiptLabelsFor } from "@waitron/country-packs";
import {
  adjustmentLabel,
  rateLetters,
  receiptFacts,
  receiptFigures,
  type ReceiptDocumentInput,
  type ReceiptFigures,
} from "./receipt-facts.js";
import type { TillSaleLine } from "./receipt-lines.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE } from "../test/full-invoice-fixture.js";
import {
  advanceTakenOff,
  billDiscountOverTwoRates,
  billDiscountOverTwoRatesWithAnUnfiledLine,
  billDiscountWithAnUnfiledLineAndASharedFreeItem,
  burgerAndBread,
  burgerAndBreadWithBillDiscount,
  dishDiscountOverExtraAtAnotherRate,
  fullComp,
  ownAdjustmentAboveWhatTheDishLost,
  ownPartCompUnderBillComp,
  recordsNotPlaced,
  simplifiedAdvanceTakenOff,
  simplifiedDishDiscountOverExtraAtAnotherRate,
  threeCentRows,
  unfiledDish,
} from "../test/receipt-cases.js";

const charged = (figures: ReceiptFigures): Decimal[] =>
  figures.sections.flatMap((section) => {
    switch (section.kind) {
      case "filed":
        return section.rows.flatMap((row) =>
          row.chargedWithVat === undefined ? [] : [row.chargedWithVat],
        );
      case "withVat": {
        const { amount, options, adjustments } = section.group;
        return [
          ...(amount === undefined ? [] : [amount]),
          ...options.map((option) => option.amount),
          ...adjustments.map((adjustment) => adjustment.amount),
        ];
      }
      case "takenOff":
        return section.rows.map((row) => row.amount);
    }
  });

const fixtureName = (index: number): string =>
  FULL_INVOICE_DOCUMENT_FIXTURE.result.lines[index]!.descriptions["es-ES"]!;

const sum = (amounts: readonly Decimal[]): Decimal =>
  amounts.reduce((total, amount) => addDecimal(total, amount), decimal("0.00"));

describe("receiptFigures", () => {
  it("charges the fixture's rows 12,10, −1,21 and 8,80, which come to TOTAL", () => {
    const figures = receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE);
    expect(charged(figures)).toEqual(["12.10", "-1.21", "8.80"]);
    expect(sum(charged(figures))).toBe("19.69");
    expect(figures.total).toBe("19.69");
    expect(figures.simplified).toBe(false);
  });

  it("keeps the fixture's raw VAT-exclusive figures and rates on its filed rows", () => {
    const [section] = receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE).sections;
    expect(section).toEqual({
      kind: "filed",
      rows: [
        {
          kind: "line",
          units: "1",
          item: fixtureName(0),
          indent: 0,
          unitPrice: "10.00",
          amountExVat: "10.00",
          rate: "21",
          chargedWithVat: "12.10",
        },
        {
          kind: "discount",
          units: "",
          item: expect.any(String),
          indent: 2,
          amountExVat: "-1.00",
          rate: "21",
          chargedWithVat: "-1.21",
        },
        {
          kind: "line",
          units: "2",
          item: fixtureName(1),
          indent: 0,
          unitPrice: "4.00",
          amountExVat: "8.00",
          rate: "10",
          chargedWithVat: "8.80",
        },
      ],
    });
  });

  it("gives the VAT summary as the record's raw rates, bases and VAT", () => {
    expect(receiptFigures(FULL_INVOICE_DOCUMENT_FIXTURE).vat).toEqual([
      { rate: "21", base: "9.00", tax: "1.89" },
      { rate: "10", base: "8.00", tax: "0.80" },
    ]);
  });

  it("charges each 0,03 € row 0,03 €, so three come to TOTAL rather than a cent over", () => {
    const figures = receiptFigures(threeCentRows());
    expect(charged(figures)).toEqual(["0.03", "0.03", "0.03"]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it("puts a bill discount's share at each rate on the end rows, VAT included", () => {
    const figures = receiptFigures(billDiscountOverTwoRates());
    expect(charged(figures)).toEqual(["30.00", "2.50", "-3.00", "-0.25"]);
  });

  it("takes an unfiled line's share of a bill discount off under that line, VAT included", () => {
    const figures = receiptFigures(billDiscountOverTwoRatesWithAnUnfiledLine());
    expect(charged(figures)).toEqual(["30.00", "-3.00", "2.50", "-0.25"]);
    const [unfiled] = figures.sections.flatMap((section) =>
      section.kind === "withVat" ? [section.group] : [],
    );
    expect(unfiled!.adjustments).toEqual([
      {
        item: adjustmentLabel(
          { kind: "discount", percentBp: 1000 },
          "es-ES",
          receiptLabelsFor("es-ES"),
        ),
        amount: "-0.25",
        rateLetter: "",
      },
    ]);
  });

  // The unfiled line's row follows the end rows: a free item holding a share of the price paid
  // means the bill discount's "10%" no longer describes what either takes off.
  it("names an unfiled line's share of a bill discount as the end rows do when a free item holds a share", () => {
    const figures = receiptFigures(billDiscountWithAnUnfiledLineAndASharedFreeItem());
    const [unfiled] = figures.sections.flatMap((section) =>
      section.kind === "withVat" ? [section.group] : [],
    );
    const discount = receiptLabelsFor("es-ES").discount;
    expect(unfiled!.adjustments).toEqual([{ item: discount, amount: "-0.38", rateLetter: "" }]);
    const filedDiscounts = figures.sections.flatMap((section) =>
      section.kind === "filed"
        ? section.rows.flatMap(({ kind, item, rate }) =>
            kind === "discount" ? [[item, rate]] : [],
          )
        : [],
    );
    // The water's own row, then the 21% end row.
    expect(filedDiscounts).toEqual([
      [discount, "21.00"],
      [discount, "21.00"],
    ]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it("splits a dish's own discount over its extra at another rate, VAT included", () => {
    const figures = receiptFigures(dishDiscountOverExtraAtAnotherRate());
    expect(charged(figures)).toEqual(["10.00", "2.00", "-1.00", "-0.20"]);
  });

  it("charges an own part comp what its adjustment took and the bill comp the rest", () => {
    expect(charged(receiptFigures(ownPartCompUnderBillComp()))).toEqual([
      "10.00",
      "-6.00",
      "-4.00",
    ]);
  });

  it("prints one plain discount caption for two steps that take a dish to zero", () => {
    const input = ownPartCompUnderBillComp();
    input.invoiceLocale = "es-ES";
    delete input.result.billAdjustments;
    input.result.lines[0]!.adjustments = [
      { kind: "discount", percentBp: 5000, amount: "5.00" },
      { kind: "comp", amount: "5.00" },
    ];
    const [section] = receiptFigures(input).sections;
    expect(
      section?.kind === "filed" &&
        section.rows.filter((row) => row.kind === "discount").map((row) => row.item),
    ).toEqual(["Descuento"]);
  });

  it("caps a dish's own row at what the dish lost when its adjustment says more", () => {
    expect(charged(receiptFigures(ownAdjustmentAboveWhatTheDishLost()))).toEqual([
      "10.00",
      "-1.00",
      "0.00",
    ]);
  });

  it("charges the advance taken off after the bill's discount at its rate", () => {
    expect(charged(receiptFigures(advanceTakenOff()))).toEqual(["120.00", "-12.00", "-30.00"]);
  });

  it("charges a dish's own discount what it took and the bill's share at each rate the rest", () => {
    expect(charged(receiptFigures(burgerAndBreadWithBillDiscount()))).toEqual([
      "12.00",
      "-1.20",
      "2.50",
      "-1.08",
      "-0.25",
    ]);
  });

  it("charges a row whose list price could not be priced before VAT what it was charged", () => {
    const input = burgerAndBreadWithBillDiscount();
    delete input.result.lines[1]!.listUnitPriceGross;
    const figures = receiptFigures(input);
    expect(charged(figures)).toEqual(["12.00", "-1.20", "2.25", "-1.08"]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it.each<[string, () => ReceiptDocumentInput]>([
    ["the fixture", () => FULL_INVOICE_DOCUMENT_FIXTURE],
    ["a dish discount over extras at another rate", dishDiscountOverExtraAtAnotherRate],
    ["the same on a simplified ticket", simplifiedDishDiscountOverExtraAtAnotherRate],
    ["a full comp", fullComp],
    ["an own part comp under a bill comp", ownPartCompUnderBillComp],
    ["an advance taken off", advanceTakenOff],
    ["an advance taken off a simplified ticket", simplifiedAdvanceTakenOff],
    ["records that could not be placed", recordsNotPlaced],
    ["an unfiled dish", unfiledDish],
    ["burgerAndBread", burgerAndBread],
    ["burgerAndBread with a bill discount", burgerAndBreadWithBillDiscount],
    ["a bill discount split over two rates", billDiscountOverTwoRates],
    ["the same with one line unfiled", billDiscountOverTwoRatesWithAnUnfiledLine],
    ["three 0,03 € rows", threeCentRows],
    ["an own adjustment above what the dish lost", ownAdjustmentAboveWhatTheDishLost],
  ])("adds up to TOTAL exactly: %s", (_name, input) => {
    const figures = receiptFigures(input());
    expect(sum(charged(figures))).toBe(sum([figures.total]));
  });
});

describe("rateLetters", () => {
  it("letters each rate once, however its digits are written", () => {
    expect([...rateLetters([{ rate: "21" }, { rate: "21.00" }, { rate: "10" }])!]).toEqual([
      ["21", "A"],
      ["10", "B"],
    ]);
  });

  it("letters nothing on a bill with one rate", () => {
    expect(rateLetters([{ rate: "10" }, { rate: "10.00" }])).toBeNull();
  });
});

describe("receiptFacts", () => {
  const fixture = (): ReceiptDocumentInput => structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);

  it("carries the fixture's filed issuer, customer, band and cash tender as raw values", () => {
    const facts = receiptFacts(FULL_INVOICE_DOCUMENT_FIXTURE);
    const { result } = FULL_INVOICE_DOCUMENT_FIXTURE;
    expect(facts.labels).toEqual(receiptLabelsFor("es-ES"));
    expect(facts.locale).toBe("es-ES");
    expect(facts.letterhead).toEqual({
      tradingName: "La Buena",
      headerSubtitle: FULL_INVOICE_DOCUMENT_FIXTURE.receipt.headerSubtitle,
      legalName: result.issuer!.venueName,
      nif: result.issuer!.nif,
      domicile: result.issuer!.domicile,
      venueAddress: FULL_INVOICE_DOCUMENT_FIXTURE.venueAddress,
      phone: FULL_INVOICE_DOCUMENT_FIXTURE.receipt.phone,
      email: FULL_INVOICE_DOCUMENT_FIXTURE.receipt.email,
    });
    expect(facts.band).toEqual({
      invoiceNumber: "FF/1",
      issuedAt: result.issuedAt,
      issuedOffsetMinutes: 120,
      orderLabel: result.orderLabel,
      orderNumber: 41,
      takeAway: false,
      duplicate: false,
    });
    expect(facts.customer).toEqual({
      legalName: result.recipient!.legalName,
      taxId: "B11223344",
      address: result.recipient!.address,
      countryCode: "ES",
    });
    expect(facts.payment).toEqual({ tender: { method: "cash", change: "0.31" } });
    expect(facts.qr).toEqual({ text: result.qr, ...result.qrText });
    expect(facts.footerMessage).toBe(FULL_INVOICE_DOCUMENT_FIXTURE.receipt.footerMessage);
    expect(facts.total).toBe("19.69");
    expect(facts.corrects).toBeUndefined();
    expect(facts.practice).toBeUndefined();
    expect(facts.testPage).toBeUndefined();
    expect(facts.guests).toBeUndefined();
  });

  it("carries the recipient's identifier type", () => {
    const input = fixture();
    input.result.recipient!.identifierType = "passport";
    expect(receiptFacts(input).customer).toHaveProperty("identifierType", "passport");
  });

  it("leaves out trim text that is empty", () => {
    const input = fixture();
    input.receipt = { headerSubtitle: "", phone: "", email: "", footerMessage: "" };
    const facts = receiptFacts(input);
    expect(Object.keys(facts.letterhead)).not.toContain("headerSubtitle");
    expect(Object.keys(facts.letterhead)).not.toContain("phone");
    expect(Object.keys(facts.letterhead)).not.toContain("email");
    expect(Object.keys(facts)).not.toContain("footerMessage");
  });

  it("names no customer on a simplified invoice, even one the record gives a recipient", () => {
    const input = fixture();
    input.result.invoiceType = "F2";
    expect(receiptFacts(input).customer).toBeUndefined();
  });

  it("leaves out a trading name the venue does not print, or one that repeats its legal name", () => {
    const off = fixture();
    off.receiptHeader = { tradingName: "La Buena", printTradingName: false };
    expect(receiptFacts(off).letterhead.tradingName).toBeUndefined();
    const same = fixture();
    same.receiptHeader = {
      tradingName: ` ${same.result.issuer!.venueName} `,
      printTradingName: true,
    };
    expect(receiptFacts(same).letterhead.tradingName).toBeUndefined();
  });

  it("falls back to the current issuer when the record names none", () => {
    const input = fixture();
    delete input.result.issuer;
    expect(receiptFacts(input).letterhead).toMatchObject({
      legalName: "Current mutable issuer",
      nif: "B87654321",
      domicile: "Current mutable domicile",
    });
  });

  it("carries a duplicate, a take-away, a sale day and the invoice a corrective corrects", () => {
    const input = fixture();
    input.duplicate = true;
    input.result.takeAway = true;
    input.result.saleDay = "2026-08-16";
    input.result.invoiceType = "R5";
    input.result.corrects = {
      invoiceNumber: "A/7",
      issuedAt: "2026-08-16T20:00:00.000Z",
      issuedOffsetMinutes: 120,
      inFull: true,
    };
    const facts = receiptFacts(input);
    expect(facts.band).toMatchObject({ duplicate: true, takeAway: true, saleDay: "2026-08-16" });
    expect(facts.corrects).toEqual({
      invoiceNumber: "A/7",
      issuedAt: "2026-08-16T20:00:00.000Z",
      issuedOffsetMinutes: 120,
      inFull: true,
    });
    delete input.result.corrects!.inFull;
    expect(receiptFacts(input).corrects!.inFull).toBe(false);
  });

  it("carries practice, a test page, guests, what is owed and every bill payment", () => {
    const input = fixture();
    input.simulated = true;
    input.simulatedCardPayment = true;
    input.testPage = { printer: "Bar" };
    input.guests = 3;
    input.result.owed = "4.00";
    input.result.qr = "";
    delete input.result.qrText;
    input.result.payments = [
      {
        method: "cash",
        amount: "19.69",
        tendered: "20.00",
        change: "0.31",
        tip: "0.00",
        refunds: [],
      },
    ];
    const facts = receiptFacts(input);
    expect(facts.practice).toEqual({ noRealCharge: true });
    expect(facts.testPage).toEqual({ printer: "Bar" });
    expect(facts.guests).toBe(3);
    expect(facts.qr).toBeUndefined();
    expect(facts.payment).toEqual({
      payments: input.result.payments,
      tender: { method: "cash", change: "0.31" },
      owed: "4.00",
    });
    input.simulatedCardPayment = false;
    expect(receiptFacts(input).practice).toEqual({ noRealCharge: false });
  });
});

describe("receipt figure details", () => {
  it("takes the remaining bill share off the unfiled dish and its priced extra", () => {
    const input = billDiscountOverTwoRatesWithAnUnfiledLine();
    const bread = input.result.lines[1]!;
    bread.gross = "2.07";
    bread.adjustments = [{ kind: "discount", amount: "0.20" }];
    input.result.lines.push({
      descriptions: { en: "Butter" },
      quantity: "1",
      gross: "0.90",
      listGross: "1.00",
      parentLineNo: 2,
    });
    input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "3.33" }];
    input.result.vatBreakdown[1] = { rate: "10.00", base: "2.70", tax: "0.27" };
    input.result.total = "29.97";

    const figures = receiptFigures(input);
    expect(charged(figures)).toEqual(["30.00", "-3.00", "2.50", "1.00", "-0.20", "-0.33"]);
    expect(sum(charged(figures))).toBe(figures.total);
  });

  it("shows the priced extra and answer of a covered dish and keeps the next dish's figures", () => {
    const line = (name: string, gross: string, base: string, tax: string) => ({
      descriptions: { en: name },
      quantity: "1",
      gross,
      net: { unitPrice: base, priceQuantity: "1", base, tax, rate: "10" },
    });
    const input: ReceiptDocumentInput = {
      ...FULL_INVOICE_DOCUMENT_FIXTURE,
      invoiceLocale: "en-GB",
      result: {
        ...FULL_INVOICE_DOCUMENT_FIXTURE.result,
        total: "5.50",
        vatBreakdown: [{ rate: "10", base: "5.00", tax: "0.50" }],
        lines: [
          { ...line("Salad", "0.00", "0.00", "0.00"), setMenuRole: "dish" },
          {
            ...line("Soup", "0.00", "0.00", "0.00"),
            setMenuRole: "dish",
            optionSnapshots: [
              {
                listName: { en: "Temperature staff" },
                listCustomerName: { en: "Temperature" },
                listKitchenName: "Temperature kitchen",
                labelName: { en: "Hot staff" },
                labelCustomerName: { en: "Hot" },
                labelKitchenName: "Hot kitchen",
              },
            ],
          },
          { ...line("Croutons", "1.10", "1.00", "0.10"), parentLineNo: 2 },
          line("Pie", "4.40", "4.00", "0.40"),
        ],
      },
    };
    expect(receiptFigures(input).sections).toEqual([
      {
        kind: "filed",
        rows: [
          { kind: "line", units: "1", item: "Soup", indent: 0, rate: "10" },
          { kind: "answer", units: "", item: "Temperature: Hot", indent: 2 },
          {
            kind: "option",
            units: "1",
            item: "Croutons",
            indent: 2,
            rate: "10",
            unitPrice: "1.00",
            amountExVat: "1.00",
            chargedWithVat: "1.10",
          },
          {
            kind: "line",
            units: "1",
            item: "Pie",
            indent: 0,
            rate: "10",
            unitPrice: "4.00",
            amountExVat: "4.00",
            chargedWithVat: "4.40",
          },
        ],
      },
    ]);
  });

  it.each([
    ["counted", "2", "10.00", undefined, { price: "5.00" }],
    ["weighed", "0.4", "2.00", { en: "kg" }, { price: "5.00", unitName: "kg" }],
    ["weighed and rounded", "0.333", "1.67", { en: "kg" }, undefined],
  ])(
    "shows a %s surcharge's unit price only when it gives back the amount",
    (_kind, quantity, gross, unitName, perUnit) => {
      const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
      input.invoiceLocale = "en-GB";
      input.result.invoiceType = "F2";
      input.result.lines = [
        {
          descriptions: { en: "Sirloin" },
          quantity,
          gross,
          unitName,
          unitPriceGross: "5.00",
          setMenuRole: "dish",
        },
      ];
      const [section] = receiptFigures(input).sections;
      expect(section).toMatchObject({
        kind: "withVat",
        group: { item: "Sirloin", surcharge: true, amount: gross },
      });
      expect(section?.kind === "withVat" && section.group.perUnit).toEqual(perUnit);
    },
  );

  it.each([
    ["one charged portion", "1", "5.00", "5.00", false],
    ["two free portions", "2", "0.00", "0.00", false],
    ["a credited portion", "-1", "-5.00", "5.00", true],
  ])("omits the unit price for %s", (_kind, quantity, gross, unitPriceGross, credit) => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.invoiceLocale = "en-GB";
    input.result.invoiceType = credit ? "R5" : "F2";
    input.result.total = gross;
    if (credit)
      input.result.corrects = { invoiceNumber: "T/37", issuedAt: "2026-08-16T20:00:00.000Z" };
    input.result.lines = [{ descriptions: { en: "Pie" }, quantity, gross, unitPriceGross }];

    const [section] = receiptFigures(input).sections;
    expect(section).toMatchObject({
      kind: "withVat",
      group: { item: "Pie", quantity, amount: gross },
    });
    expect(section?.kind === "withVat" && section.group).not.toHaveProperty("perUnit");
  });

  it("carries combined counts for counted extras and the measured extra's total quantity", () => {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.invoiceLocale = "en-GB";
    input.result.invoiceType = "F2";
    input.result.lines = [
      {
        descriptions: { en: "Sundae" },
        quantity: "2",
        gross: "8.00",
        unitName: { en: "ea" },
        soldInEach: true,
      },
      { descriptions: { en: "Wafer" }, quantity: "4", gross: "2.00", parentLineNo: 1 },
      { descriptions: { en: "Cherry" }, quantity: "2", gross: "1.00", parentLineNo: 1 },
      {
        descriptions: { en: "Berries" },
        quantity: "0.250",
        gross: "3.00",
        parentLineNo: 1,
        unitName: { en: "kg" },
      },
    ];
    const [section] = receiptFigures(input).sections;
    expect(section?.kind === "withVat" && section.group).not.toHaveProperty("surcharge");
    expect(section?.kind === "withVat" && section.group.options).toEqual([
      { item: "Wafer", quantity: "x2", combinedCount: "4", amount: "2.00", rateLetter: "" },
      { item: "Cherry", quantity: "", combinedCount: "2", amount: "1.00", rateLetter: "" },
      { item: "Berries", quantity: "0.250 kg", amount: "3.00", rateLetter: "" },
    ]);
  });

  it.each([
    ["two named portions", "2", "4", "2.00", "4"],
    ["one dish", "1", "2", "2.00", "2"],
    ["two refunded portions", "-2", "-4", "-2.00", undefined],
  ] as const)(
    "carries the expected extra count for %s",
    (_kind, dishCount, quantity, amount, combinedCount) => {
      const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
      input.invoiceLocale = "en-GB";
      input.result.invoiceType = dishCount === "-2" ? "R5" : "F2";
      if (input.result.invoiceType === "R5") {
        input.result.corrects = { invoiceNumber: "T/37", issuedAt: "2026-08-16T20:00:00.000Z" };
      }
      input.result.lines = [
        {
          descriptions: { en: "Pie" },
          quantity: dishCount,
          gross: dishCount === "-2" ? "-8.00" : "8.00",
          unitName: { en: "slice" },
          unitPrecision: 0,
        },
        { descriptions: { en: "Gravy" }, quantity, gross: amount, parentLineNo: 1 },
      ];

      const [section] = receiptFigures(input).sections;
      expect(section?.kind === "withVat" && section.group.options).toEqual([
        {
          item: "Gravy",
          quantity: "x2",
          amount,
          rateLetter: "",
          ...(combinedCount === undefined ? {} : { combinedCount }),
        },
      ]);
    },
  );
});

it("carries the original issue and deferred account alongside the current issuer's available details", () => {
  const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
  delete input.result.issuer;
  delete input.result.issuedOffsetMinutes;
  delete input.result.qrText;
  delete input.venueAddress;
  delete input.issuer.domicile;
  input.result.tender = { method: "deferred" };
  const account = { iban: "ES9121000418450200051332", bankName: "Example Bank" };
  input.deferredPayment = { account };

  const facts = receiptFacts(input);
  expect(facts.letterhead).toMatchObject({
    legalName: input.issuer.venueName,
    nif: input.issuer.nif,
    venueAddress: [],
  });
  expect(facts.letterhead).not.toHaveProperty("domicile");
  expect(facts.band.issuedAt).toBe(input.result.issuedAt);
  expect(facts.band).not.toHaveProperty("issuedOffsetMinutes");
  expect(facts.qr).toEqual({ text: input.result.qr });
  expect(facts.payment).toEqual({ tender: { method: "deferred" }, deferred: { account } });
});

// VAT rates piece B, S9: a takeaway set menu whose price was divided between dishes at two rates.
describe("a simplified ticket of a divided set menu", () => {
  const dish = (
    name: string,
    gross: string,
    setMenuPart: string,
    vatRate: string,
    extra: Partial<TillSaleLine> = {},
  ): TillSaleLine => ({
    descriptions: { en: name },
    quantity: "1",
    gross,
    setMenuPart,
    vatRate,
    setMenuRole: "dish",
    parentLineNo: null,
    ...extra,
  });
  const menu = (extra: Partial<TillSaleLine> = {}): TillSaleLine => ({
    descriptions: { en: "Daily menu" },
    quantity: "1",
    gross: "0.00",
    setMenuPart: "-14.00",
    vatRate: "10.00",
    setMenuRole: "set_menu",
    parentLineNo: null,
    ...extra,
  });
  // The plan's worked example: 3.58, 8.14 and 2.28 of 14.00.
  const workedExample = (): TillSaleLine[] => [
    menu(),
    dish("Soup", "3.58", "3.58", "10.00"),
    dish("Hake", "8.14", "8.14", "10.00"),
    dish("Lemonade", "2.28", "2.28", "21.00"),
  ];
  function ticket(
    lines: TillSaleLine[],
    total: string,
    vatBreakdown: { rate: string; base: string; tax: string }[],
  ): ReceiptDocumentInput {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.invoiceLocale = "en-GB";
    input.result.invoiceType = "F2";
    input.result.total = total;
    input.result.vatBreakdown = vatBreakdown;
    input.result.lines = lines;
    delete input.result.billAdjustments;
    return input;
  }
  const printed = (input: ReceiptDocumentInput) =>
    receiptFigures(input).sections.map((section) => {
      if (section.kind !== "withVat") return section;
      const { item, amount, surcharge, rateLetter, adjustments } = section.group;
      return { item, amount, surcharge, rateLetter, adjustments };
    });
  const named = (item: string, rateLetter: string) => ({
    item,
    amount: undefined,
    surcharge: undefined,
    rateLetter,
    adjustments: [],
  });
  const VAT = [
    { rate: "10.00", base: "10.65", tax: "1.07" },
    { rate: "21.00", base: "1.88", tax: "0.40" },
  ];

  it("prints the set menu at 14.00 with no letter, then each dish by name with its letter and no amount", () => {
    const input = ticket(workedExample(), "14.00", VAT);
    const figures = receiptFigures(input);
    expect(printed(input)).toEqual([
      { ...named("Daily menu", ""), amount: "14.00" },
      named("Soup", "A"),
      named("Hake", "A"),
      named("Lemonade", "B"),
    ]);
    expect(figures.vat).toEqual([
      { rate: "10.00", base: "10.65", tax: "1.07", letter: "A" },
      { rate: "21.00", base: "1.88", tax: "0.40", letter: "B" },
    ]);
    expect(figures.total).toBe("14.00");
  });

  it("prints a 2.00 supplement on hake with a plus and hake's letter", () => {
    const lines = workedExample();
    lines[2] = dish("Hake", "10.14", "8.14", "10.00");
    const vat = [
      { rate: "10.00", base: "12.47", tax: "1.25" },
      { rate: "21.00", base: "1.88", tax: "0.40" },
    ];
    expect(printed(ticket(lines, "16.00", vat))).toEqual([
      { ...named("Daily menu", ""), amount: "14.00" },
      named("Soup", "A"),
      { ...named("Hake", "A"), amount: "2.00", surcharge: true },
      named("Lemonade", "B"),
    ]);
  });

  it("prints a 10% discount on the set menu as 14.00 and −1.40, with no letter", () => {
    const lines = [
      menu({
        setMenuPart: "-12.60",
        listGross: "14.00",
        listUnitPriceGross: "14.00",
        adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.40" }],
      }),
      dish("Soup", "3.22", "3.22", "10.00"),
      dish("Hake", "7.33", "7.33", "10.00"),
      dish("Lemonade", "2.05", "2.05", "21.00"),
    ];
    const vat = [
      { rate: "10.00", base: "9.59", tax: "0.96" },
      { rate: "21.00", base: "1.69", tax: "0.36" },
    ];
    expect(printed(ticket(lines, "12.60", vat))).toEqual([
      {
        ...named("Daily menu", ""),
        amount: "14.00",
        adjustments: [{ item: "Discount 10%", amount: "-1.40", rateLetter: "" }],
      },
      named("Soup", "A"),
      named("Hake", "A"),
      named("Lemonade", "B"),
    ]);
  });

  it("prints its credit note the same, negated", () => {
    const negate = (amount: string) => (amount.startsWith("-") ? amount.slice(1) : `-${amount}`);
    const lines = workedExample().map((line) => ({
      ...line,
      quantity: "-1",
      gross: negate(line.gross),
      setMenuPart: negate(line.setMenuPart!),
    }));
    const input = ticket(
      lines,
      "-14.00",
      VAT.map(({ rate, base, tax }) => ({ rate, base: negate(base), tax: negate(tax) })),
    );
    input.result.invoiceType = "R5";
    input.result.corrects = { invoiceNumber: "T/37", issuedAt: "2026-08-16T20:00:00.000Z" };
    expect(printed(input)).toEqual([
      { ...named("Daily menu", ""), amount: "-14.00" },
      named("Soup", "A"),
      named("Hake", "A"),
      named("Lemonade", "B"),
    ]);
  });

  it("adds up two divided set menus merged on a ticket with one VAT row", () => {
    // Lemonade's part of each 14.00 rounded to 0.00, so its row files at the lead rate (S4).
    const lines = [
      menu(),
      menu(),
      dish("Soup", "14.00", "14.00", "10.00"),
      dish("Soup", "14.00", "14.00", "10.00"),
      dish("Lemonade", "0.00", "0.00", "10.00"),
      dish("Lemonade", "0.00", "0.00", "10.00"),
    ];
    const input = ticket(lines, "28.00", [{ rate: "10.00", base: "25.45", tax: "2.55" }]);
    expect(printed(input)).toEqual([
      { ...named("Daily menu", ""), amount: "28.00" },
      named("Soup", ""),
      named("Lemonade", ""),
    ]);
    expect(
      receiptFigures(input).sections.map((section) =>
        section.kind === "withVat" ? section.group.quantity : section.kind,
      ),
    ).toEqual(["2", "2", "2"]);
  });

  it("prints a set menu whose dishes share one rate as today (control)", () => {
    const lines: TillSaleLine[] = [
      { ...menu(), gross: "14.00" },
      dish("Soup", "0.00", "0", "10.00"),
      dish("Hake", "0.00", "0", "10.00"),
    ];
    for (const line of lines) delete line.setMenuPart;
    expect(
      printed(ticket(lines, "14.00", [{ rate: "10.00", base: "12.73", tax: "1.27" }])),
    ).toEqual([{ ...named("Daily menu", ""), amount: "14.00" }]);
  });
});

// VAT rates piece B, S9: the full invoice of the same set menu states the filed figures.
describe("a full invoice of a divided set menu", () => {
  const row = (
    name: string,
    role: "set_menu" | "dish",
    filed: { gross: string; base: string; rate: string; setMenuPart?: string },
    extra: Partial<TillSaleLine> = {},
  ): TillSaleLine => ({
    descriptions: { en: name },
    quantity: "1",
    gross: filed.gross,
    vatRate: filed.rate,
    setMenuRole: role,
    parentLineNo: null,
    ...(filed.setMenuPart === undefined ? {} : { setMenuPart: filed.setMenuPart }),
    net: {
      unitPrice: filed.base,
      priceQuantity: "1.000",
      base: filed.base,
      rate: filed.rate,
      tax: (Number(filed.gross) - Number(filed.base)).toFixed(2),
    },
    ...extra,
  });
  function invoice(
    lines: TillSaleLine[],
    total: string,
    vatBreakdown: { rate: string; base: string; tax: string }[],
  ): ReceiptDocumentInput {
    const input = structuredClone(FULL_INVOICE_DOCUMENT_FIXTURE);
    input.invoiceLocale = "en-GB";
    input.result.total = total;
    input.result.vatBreakdown = vatBreakdown;
    input.result.lines = lines;
    delete input.result.billAdjustments;
    return input;
  }
  const table = (input: ReceiptDocumentInput): object[] =>
    receiptFigures(input).sections.flatMap((section): object[] =>
      section.kind === "filed"
        ? section.rows.map(({ kind, item, unitPrice, amountExVat, rate, chargedWithVat }) => ({
            kind,
            item,
            unitPrice,
            amountExVat,
            rate,
            chargedWithVat,
          }))
        : [{ kind: section.kind }],
    );
  const heading = (item: string) => ({
    kind: "line",
    item,
    unitPrice: undefined,
    amountExVat: undefined,
    rate: undefined,
    chargedWithVat: undefined,
  });
  const part = (item: string, base: string, rate: string, gross: string) => ({
    kind: "line",
    item,
    unitPrice: base,
    amountExVat: base,
    rate,
    chargedWithVat: gross,
  });
  const VAT = [
    { rate: "10.00", base: "10.65", tax: "1.07" },
    { rate: "21.00", base: "1.88", tax: "0.40" },
  ];

  it("prints the set menu as a heading and each dish's part, base and rate", () => {
    const input = invoice(
      [
        row("Daily menu", "set_menu", {
          gross: "0.00",
          base: "0.00",
          rate: "10.00",
          setMenuPart: "-14.00",
        }),
        row("Soup", "dish", { gross: "3.58", base: "3.25", rate: "10.00", setMenuPart: "3.58" }),
        row("Hake", "dish", { gross: "8.14", base: "7.40", rate: "10.00", setMenuPart: "8.14" }),
        row("Lemonade", "dish", {
          gross: "2.28",
          base: "1.88",
          rate: "21.00",
          setMenuPart: "2.28",
        }),
      ],
      "14.00",
      VAT,
    );
    expect(table(input)).toEqual([
      heading("Daily menu"),
      part("Soup", "3.25", "10.00", "3.58"),
      part("Hake", "7.40", "10.00", "8.14"),
      part("Lemonade", "1.88", "21.00", "2.28"),
    ]);
    expect(receiptFigures(input).vat).toEqual(VAT);
    expect(receiptFigures(input).total).toBe("14.00");
  });

  it("prints no discount row for 10% off the set menu, and the parts of what was charged", () => {
    const input = invoice(
      [
        row(
          "Daily menu",
          "set_menu",
          { gross: "0.00", base: "0.00", rate: "10.00", setMenuPart: "-12.60" },
          {
            listGross: "14.00",
            listUnitPriceGross: "14.00",
            adjustments: [{ kind: "discount", percentBp: 1000, amount: "1.40" }],
          },
        ),
        row("Soup", "dish", { gross: "3.22", base: "2.93", rate: "10.00", setMenuPart: "3.22" }),
        row("Hake", "dish", { gross: "7.33", base: "6.66", rate: "10.00", setMenuPart: "7.33" }),
        row("Lemonade", "dish", {
          gross: "2.05",
          base: "1.69",
          rate: "21.00",
          setMenuPart: "2.05",
        }),
      ],
      "12.60",
      [
        { rate: "10.00", base: "9.59", tax: "0.96" },
        { rate: "21.00", base: "1.69", tax: "0.36" },
      ],
    );
    expect(table(input)).toEqual([
      heading("Daily menu"),
      part("Soup", "2.93", "10.00", "3.22"),
      part("Hake", "6.66", "10.00", "7.33"),
      part("Lemonade", "1.69", "21.00", "2.05"),
    ]);
  });

  it("adds up to the filed bases with 10% off the whole bill beside the set menu", () => {
    const input = invoice(
      [
        row(
          "Daily menu",
          "set_menu",
          { gross: "0.00", base: "0.00", rate: "10.00", setMenuPart: "-12.60" },
          { listGross: "14.00", listUnitPriceGross: "14.00" },
        ),
        row("Soup", "dish", { gross: "3.22", base: "2.93", rate: "10.00", setMenuPart: "3.22" }),
        row("Hake", "dish", { gross: "7.33", base: "6.66", rate: "10.00", setMenuPart: "7.33" }),
        row("Lemonade", "dish", {
          gross: "2.05",
          base: "1.69",
          rate: "21.00",
          setMenuPart: "2.05",
        }),
        {
          ...row("Water", "dish", { gross: "1.80", base: "1.64", rate: "10.00" }),
          listGross: "2.00",
          listUnitPriceGross: "2.00",
        },
      ],
      "14.40",
      [
        { rate: "10.00", base: "11.23", tax: "1.12" },
        { rate: "21.00", base: "1.69", tax: "0.36" },
      ],
    );
    delete input.result.lines[4]!.setMenuRole;
    input.result.billAdjustments = [{ kind: "discount", percentBp: 1000, amount: "1.60" }];
    expect(table(input)).toEqual([
      heading("Daily menu"),
      part("Soup", "2.93", "10.00", "3.22"),
      part("Hake", "6.66", "10.00", "7.33"),
      part("Lemonade", "1.69", "21.00", "2.05"),
      part("Water", "1.82", "10.00", "2.00"),
      {
        kind: "discount",
        item: "Discount 10%",
        unitPrice: undefined,
        amountExVat: "-0.18",
        rate: "10.00",
        chargedWithVat: "-0.20",
      },
    ]);
    const rows = receiptFigures(input).sections.flatMap((section) =>
      section.kind === "filed" ? section.rows : [],
    );
    const at = (rate: string, figure: "amountExVat" | "chargedWithVat") =>
      rows
        .filter((one) => one.rate === rate)
        .reduce((sum, one) => sum + Number(one[figure] ?? 0), 0)
        .toFixed(2);
    expect([at("10.00", "amountExVat"), at("21.00", "amountExVat")]).toEqual(["11.23", "1.69"]);
    expect([at("10.00", "chargedWithVat"), at("21.00", "chargedWithVat")]).toEqual([
      "12.35",
      "2.05",
    ]);
  });

  it("leaves out a dish whose part filed nothing", () => {
    const input = invoice(
      [
        row("Daily menu", "set_menu", {
          gross: "0.00",
          base: "0.00",
          rate: "10.00",
          setMenuPart: "-14.00",
        }),
        row("Soup", "dish", { gross: "14.00", base: "12.73", rate: "10.00", setMenuPart: "14.00" }),
        row("Lemonade", "dish", {
          gross: "0.00",
          base: "0.00",
          rate: "10.00",
          setMenuPart: "0.00",
        }),
      ],
      "14.00",
      [{ rate: "10.00", base: "12.73", tax: "1.27" }],
    );
    expect(table(input)).toEqual([heading("Daily menu"), part("Soup", "12.73", "10.00", "14.00")]);
  });

  it("prints a set menu whose dishes share one rate as today (control)", () => {
    const input = invoice(
      [
        row("Daily menu", "set_menu", { gross: "14.00", base: "12.73", rate: "10.00" }),
        row("Soup", "dish", { gross: "0.00", base: "0.00", rate: "10.00" }),
        row("Hake", "dish", { gross: "0.00", base: "0.00", rate: "10.00" }),
      ],
      "14.00",
      [{ rate: "10.00", base: "12.73", tax: "1.27" }],
    );
    expect(table(input)).toEqual([part("Daily menu", "12.73", "10.00", "14.00")]);
  });
});
