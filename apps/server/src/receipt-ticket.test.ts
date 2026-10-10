import { joinCustomerPresentationText } from "@waitron/catalogue";
import {
  FEED_BEFORE_CUT,
  LOGO_MAX_HEIGHT_DOTS,
  columnsFor,
  esc,
  safeWidthDots,
  textGrid,
  withQuietZone,
  type EscSetting,
  type MonoRaster,
} from "@waitron/printing";
import { compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { describe, expect, it } from "vitest";

import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptIssuer, ReceiptTrim } from "./receipt-ticket.js";
import { qrModules } from "./qr-matrix.js";
import {
  bytesInclude,
  decodeTicket,
  printedCommands,
  printedLines,
} from "./testing/decode-ticket.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
type TillSaleResult = ReceiptDocumentInput["result"];

// `formatReceipt` is pure, so these are unit tests. `printedLines` and `decodeTicket` read the text
// back from the images each line is drawn as; `printedCommands` lists the commands themselves.
//
// The printed paper is a factura simplificada, a legal document: the completeness test pins that it
// carries every mandated art. 7.1 / arts. 20-21 element, never fewer than the on-screen receipt.

/** GS V 0 (full cut) — the final three bytes of every ticket (`escpos.ts` / `escpos.test.ts`). */
const CUT_BYTES = [0x1d, 0x56, 0x00];
/** ESC d n — the shared feed before every cut (`FEED_BEFORE_CUT`), so the tear-off clears the head. */
const FEED_THEN_CUT = [0x1b, 0x64, FEED_BEFORE_CUT, ...CUT_BYTES];

/** The receipt's commands from the first image that is not a drawn line of text: its QR code. */
function fromQr(bytes: Uint8Array): ReturnType<typeof printedCommands> {
  const commands = printedCommands(bytes);
  return commands.slice(commands.findIndex((c) => c.name === "GS v 0" && c.text === undefined));
}

const PRINTER_80: EscSetting = {
  paperWidth: "80mm",
  resolution: "180dpi",
};
const PRINTER_58: EscSetting = {
  paperWidth: "58mm",
  resolution: "180dpi",
};

/**
 * A realistic filed sale: multi-line, two VAT rates, a non-empty cotejo `qr`. The figures are exact
 * and self-consistent — Σ(line.gross) === total, Σ(base + tax) === total, and total + change === the
 * cash tendered — so every printed amount can be asserted by its digit portion.
 */
const FILED_WITHOUT_TEXT: TillSaleResult = {
  locale: "es-ES",
  orderLabel: "Mesa 6",
  orderNumber: 41,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-17T12:34:00.000Z",
  total: "20.90",
  vatBreakdown: [
    { rate: "21", base: "10.00", tax: "2.10" },
    { rate: "10", base: "8.00", tax: "0.80" },
  ],
  lines: [
    {
      descriptions: { "es-ES": "Menú del día", "en-GB": "Set menu" },
      quantity: "1",
      gross: "12.10",
    },
    {
      descriptions: { "es-ES": "Agua mineral", "en-GB": "Mineral water" },
      quantity: "2",
      gross: "8.80",
    },
  ],
  tender: { method: "cash", change: "9.10" },
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=17-08-2026&importe=20.90",
};

const FILED_SALE: TillSaleResult = {
  ...FILED_WITHOUT_TEXT,
  qrText: { caption: "QR tributario:", legend: "VERI*FACTU" },
};

/** The same sale from a regime that minted no verification link and supplies no words for one. */
const NO_QR_SALE: TillSaleResult = { ...FILED_WITHOUT_TEXT, qr: "" };

const ISSUER: ReceiptIssuer = { venueName: "Charcutería La Buena", nif: "B12345678" };
const TRIM: ReceiptTrim = {
  headerSubtitle: "Calle Mayor 1, Madrid",
  footerMessage: "¡Gracias por su visita!",
};

describe("saved F1 issue offset", () => {
  it("retains F2 date rendering even when the payload carries an issue offset", () => {
    const input = {
      result: { ...FILED_SALE, invoiceType: "F2" as const },
      issuer: ISSUER,
      receipt: {},
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    };
    expect(
      formatReceipt({ ...input, result: { ...input.result, issuedOffsetMinutes: 60 } }),
    ).toEqual(formatReceipt(input));
  });

  it.each(
    [PRINTER_58, PRINTER_80].flatMap((printer) =>
      [false, true].flatMap((duplicate) =>
        [
          { offset: 60, want: "1 mar 2026, 0:05" },
          { offset: 0, want: "28 feb 2026, 23:05" },
          { offset: -480, want: "28 feb 2026, 15:05" },
        ].map((clock) => ({ printer, duplicate, ...clock })),
      ),
    ),
  )(
    "prints saved issue offset $offset on $printer.paperWidth, duplicate=$duplicate",
    ({ printer, duplicate, offset, want }) => {
      const lines = drawn(
        formatReceipt({
          result: {
            ...FILED_SALE,
            invoiceType: "F1",
            issuedAt: "2026-02-28T23:05:00.000Z",
            issuedOffsetMinutes: offset,
          },
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer,
          duplicate,
        }),
      );
      const at = lines.findIndex((line) => line.startsWith("Fecha "));
      expect(at).toBeGreaterThanOrEqual(0);
      expect(lines.slice(at, at + 2).join(" ")).toContain(want);
    },
  );
});

describe("saved F1 operation date", () => {
  it.each(
    [PRINTER_58, PRINTER_80].flatMap((printer) =>
      [false, true].flatMap((duplicate) =>
        [
          ["es-ES", "Fecha de operación", "28 feb 2026"],
          ["ca-ES", "Data de l'operació", "28 de febr. 2026"],
          ["gl-ES", "Data da operación", "28 de feb. de 2026"],
          ["eu-ES", "Eragiketaren data", "2026(e)ko ots. 28(a)"],
          ["en-GB", "Fecha de operación", "28 Feb 2026"],
        ].map(([locale, label, date]) => ({
          printer,
          duplicate,
          locale: locale!,
          label: label!,
          date: date!,
        })),
      ),
    ),
  )(
    "prints the saved operation day in $locale on $printer.paperWidth, duplicate=$duplicate",
    ({ printer, duplicate, locale, label, date }) => {
      const lines = drawn(
        formatReceipt({
          result: {
            ...FILED_SALE,
            invoiceType: "F1",
            issuedAt: "2026-03-01T00:05:00.000+01:00",
            operationDate: "2026-02-28",
          },
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: locale,
          printer,
          duplicate,
        }),
      );
      const operation = lines.filter((line) => line.startsWith(label));
      expect(operation).toHaveLength(1);
      expect(
        lines.slice(lines.indexOf(operation[0]!), lines.indexOf(operation[0]!) + 2).join(" "),
      ).toContain(date);
      expect(lines.join("\n")).toContain("A/1");
      expect(lines.every((line) => line.length <= columnsFor(printer.paperWidth))).toBe(true);
    },
  );

  it.each([undefined, "F1", "F2"] as const)(
    "omits a separate operation-date row for %s without a distinct saved day",
    (invoiceType) => {
      const lines = drawn(
        formatReceipt({
          result: { ...FILED_SALE, invoiceType },
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer: PRINTER_58,
        }),
      );
      expect(lines.join("\n")).not.toContain("Fecha de operación");
      expect(lines.some((line) => line.startsWith("Fecha "))).toBe(true);
    },
  );

  it("does not print an operation date on an F2 even if the payload carries one", () => {
    const lines = drawn(
      formatReceipt({
        result: { ...FILED_SALE, invoiceType: "F2", operationDate: "2026-02-28" },
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(lines.join("\n")).not.toContain("Fecha de operación");
    expect(lines.join("\n")).not.toContain("28 feb 2026");
  });
});

it.each(
  [PRINTER_58, PRINTER_80].flatMap((printer) =>
    [
      ["es-ES", "IVA incluido"],
      ["ca-ES", "IVA inclòs"],
      ["gl-ES", "IVE incluído"],
      ["eu-ES", "BEZa barne"],
      ["en-GB", "IVA incluido"],
    ].map(([locale, included]) => ({ printer, locale: locale!, included: included! })),
  ),
)(
  "identifies VAT-inclusive F1 reductions on $printer.paperWidth in $locale",
  ({ printer, locale, included }) => {
    const invoice = {
      ...FILED_SALE,
      total: "10.30",
      vatBreakdown: [{ rate: "21.00", base: "8.51", tax: "1.79" }],
      lines: [
        {
          descriptions: { "es-ES": "Plato", en: "Dish" },
          quantity: "1",
          gross: "10.30",
          listGross: "12.00",
          net: {
            unitPrice: "8.51",
            priceQuantity: "1.000",
            base: "8.51",
            rate: "21.00",
            tax: "1.79",
          },
          adjustments: [{ kind: "discount" as const, percentBp: 1000, amount: "1.20" }],
        },
        {
          descriptions: { "es-ES": "Extra", en: "Extra" },
          quantity: "1",
          gross: "0.00",
          listGross: "1.10",
          parentLineNo: 1,
          net: {
            unitPrice: "0.00",
            priceQuantity: "1.000",
            base: "0.00",
            rate: "10.00",
            tax: "0.00",
          },
          adjustments: [{ kind: "comp" as const, amount: "1.10" }],
        },
      ],
      billAdjustments: [{ kind: "discount" as const, amount: "0.50" }],
    };
    const render = (invoiceType: "F1" | "F2") =>
      drawn(
        formatReceipt({
          result: { ...invoice, invoiceType },
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: locale,
          printer,
        }),
      )
        .join(" ")
        .replace(/\s+/g, " ");
    const full = render("F1");
    expect(full.split(`(${included})`)).toHaveLength(4);
    expect(full).toMatch(/10[,.]?0?%/);
    const fallbackLocale = locale === "en-GB" ? "en-GB" : locale;
    const money = new Intl.NumberFormat(fallbackLocale, { style: "currency", currency: "EUR" });
    for (const amount of [1.2, 1.1, 0.5]) {
      expect(full).toContain(`-${money.format(amount).replace(/\s+/g, " ")}`);
    }
    expect(render("F2")).not.toContain(`(${included})`);
  },
);

it.each([PRINTER_58, PRINTER_80])(
  "prints VAT beside each F1 dish and extra on $paperWidth",
  (printer) => {
    const content = drawn(
      formatReceipt({
        result: {
          ...FILED_SALE,
          invoiceType: "F1",
          lines: [
            {
              descriptions: { "es-ES": "Plato" },
              quantity: "1",
              gross: "12.10",
              net: {
                unitPrice: "10.00",
                priceQuantity: "1.000",
                base: "10.00",
                rate: "21.00",
                tax: "2.10",
              },
            },
            {
              descriptions: { "es-ES": "Extra" },
              quantity: "2",
              gross: "8.80",
              parentLineNo: 1,
              net: {
                unitPrice: "4.00",
                priceQuantity: "1.000",
                base: "8.00",
                rate: "10.00",
                tax: "0.80",
              },
            },
          ],
        },
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer,
      }),
    )
      .join(" ")
      .replace(/\s+/g, " ");
    const dish = content.slice(content.indexOf("Plato"), content.indexOf("Extra"));
    const extra = content.slice(content.indexOf("Extra"), content.indexOf("Base 21%"));
    expect(dish).toContain("IVA 21.00% 2,10 €");
    expect(extra).toContain("IVA 10.00% 0,80 €");
  },
);

it("keeps the F2 gross layout even when net facts are present", () => {
  const lines = drawn(
    formatReceipt({
      result: {
        ...FILED_SALE,
        invoiceType: "F2",
        lines: [
          {
            ...FILED_SALE.lines[0]!,
            net: { unitPrice: "10.00", priceQuantity: "1.000", base: "10.00", rate: "21.00" },
          },
        ],
      },
      issuer: ISSUER,
      receipt: {},
      invoiceLocale: "es-ES",
      printer: PRINTER_58,
    }),
  ).join(" ");
  expect(lines).toContain("12,10");
  expect(lines).not.toContain("Factura completa");
  expect(lines).not.toContain("Precio sin IVA");
});

it.each([
  ["es-ES", "Factura completa", "Precio sin IVA"],
  ["ca-ES", "Factura completa", "Preu sense IVA"],
  ["gl-ES", "Factura completa", "Prezo sen IVE"],
  ["eu-ES", "Faktura osoa", "BEZik gabeko prezioa"],
])(
  "labels F1 net lines in %s without changing a sub-unit price quantity",
  (locale, title, priceLabel) => {
    const lines = drawn(
      formatReceipt({
        result: {
          ...FILED_SALE,
          invoiceType: "F1",
          lines: [
            {
              descriptions: { [locale]: "Jamón" },
              quantity: "0.32",
              gross: "8.80",
              unitName: { es: "kg" },
              net: { unitPrice: "2.50", priceQuantity: "0.100", base: "8.00", rate: "10.00" },
            },
          ],
        },
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: locale,
        printer: PRINTER_58,
      }),
    )
      .join(" ")
      .replace(/\s+/g, " ");
    expect(lines).toContain(title);
    expect(lines).toContain(priceLabel);
    expect(lines).toContain("2,50 € / 0.1 kg");
    expect(lines).toContain("8,00");
  },
);

it("prints the filed combined quantity for an F1 extra rather than its per-dish count", () => {
  const lines = drawn(
    formatReceipt({
      result: {
        ...FILED_SALE,
        invoiceType: "F1",
        lines: [
          {
            descriptions: { "es-ES": "Plato" },
            quantity: "2",
            gross: "12.10",
            net: { unitPrice: "5.00", priceQuantity: "1.000", base: "10.00", rate: "21.00" },
          },
          {
            descriptions: { "es-ES": "Extra" },
            quantity: "4",
            gross: "8.80",
            parentLineNo: 1,
            net: { unitPrice: "2.00", priceQuantity: "1.000", base: "8.00", rate: "10.00" },
          },
        ],
      },
      issuer: ISSUER,
      receipt: {},
      invoiceLocale: "es-ES",
      printer: PRINTER_58,
    }),
  )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  expect(lines).toContain("Extra 4");
  expect(lines).toContain("Precio sin IVA 2,00 € / 1");
  expect(lines).not.toContain("Extra x2");
});

it.each([PRINTER_58, PRINTER_80])(
  "prints distinct F1 net prices and weighted price quantities on $paperWidth",
  (printer) => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      invoiceType: "F1",
      lines: [
        {
          descriptions: { "es-ES": "Plato", "en-GB": "Dish" },
          quantity: "1",
          gross: "12.10",
          net: { unitPrice: "10.00", priceQuantity: "1.000", base: "10.00", rate: "21.00" },
        },
        {
          descriptions: { "es-ES": "Jamón", "en-GB": "Ham" },
          quantity: "0.32",
          unitName: { es: "kg" },
          gross: "8.80",
          net: { unitPrice: "25.00", priceQuantity: "1.000", base: "8.00", rate: "10.00" },
        },
      ],
    };
    for (const invoiceLocale of ["es-ES", "en-GB"]) {
      const lines = drawn(
        formatReceipt({ result, issuer: ISSUER, receipt: {}, invoiceLocale, printer }),
      );
      const content = lines.join(" ").replace(/\s+/g, " ").trim();
      expect(content).toContain("Factura completa");
      const price = invoiceLocale === "es-ES" ? "25,00 €" : "€25.00";
      expect(content).toContain(`Precio sin IVA ${price} / 1 kg`);
      expect(content).toContain(`Base 10.00% ${invoiceLocale === "es-ES" ? "8,00 €" : "€8.00"}`);
      expect(content).not.toContain(invoiceLocale === "es-ES" ? "8,80" : "8.80");
      expect(lines.every((line) => line.length <= columnsFor(printer.paperWidth))).toBe(true);
    }
  },
);

it.each([PRINTER_58, PRINTER_80])(
  "prints the current thermal address separately from filed F1 domicile on $paperWidth",
  (printer) => {
    for (const invoiceLocale of ["es-ES", "en-GB"]) {
      for (const duplicate of [false, true]) {
        for (const { invoiceType, domicile, showLocation } of [
          { invoiceType: "F1", domicile: "Calle Fiscal 27", showLocation: true },
          { invoiceType: "F1", domicile: undefined, showLocation: true },
          { invoiceType: "F2", domicile: "Calle Fiscal 27", showLocation: true },
          { invoiceType: "F2", domicile: undefined, showLocation: true },
        ] as const) {
          const printed = drawn(
            formatReceipt({
              result: {
                ...FILED_SALE,
                invoiceType,
                issuer: { ...ISSUER, ...(domicile === undefined ? {} : { domicile }) },
              },
              issuer: { ...ISSUER, domicile: "Current Fiscal 99" },
              venueAddress: ["Location Street 45", "28001 Madrid"],
              receipt: { phone: "910000000", email: "venue@example.com" },
              invoiceLocale,
              printer,
              duplicate,
            }),
          ).join(" ");
          expect(printed.includes("Location Street 45")).toBe(showLocation);
          expect(printed.includes("28001 Madrid")).toBe(showLocation);
          expect(printed.includes("Calle Fiscal 27")).toBe(
            invoiceType === "F1" && domicile !== undefined,
          );
          expect(printed).not.toContain("Current Fiscal 99");
          expect(printed).toContain("910000000");
          expect(printed).toContain("venue@example.com");
        }
      }
    }
  },
);

it.each([PRINTER_58, PRINTER_80])(
  "prints the filed F1 issuer domicile and recipient on $paperWidth with Spanish and English formats",
  (printer) => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      invoiceType: "F1",
      invoiceNumber: "FF/1",
      issuer: {
        venueName: "Filed Issuer SL",
        nif: "B87654321",
        domicile: "Calle del domicilio fiscal original 27, Madrid",
      },
      recipient: {
        legalName: "Original Customer SL",
        taxId: "B11223344",
        address: "Avenida del cliente original 123, Madrid",
        countryCode: "ES",
      },
    };
    for (const invoiceLocale of ["es-ES", "en-GB"]) {
      const bytes = formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale,
        printer,
        duplicate: true,
      });
      const lines = drawn(bytes);
      const printed = lines.join(" ").replace(/\s+/g, " ");
      expect(printed).toContain("Filed Issuer SL");
      expect(printed).toContain("NIF: B87654321");
      expect(printed).toContain("Calle del domicilio fiscal original 27, Madrid");
      expect(printed).toContain("Original Customer SL");
      expect(printed).toContain("NIF: B11223344");
      expect(printed).toContain("Avenida del cliente original 123, Madrid");
      expect(printed).toContain("FF/1");
      expect(printed.indexOf("FF/1")).toBeLessThan(printed.indexOf("Original Customer SL"));
      expect(printed).toContain("DUPLICADO");
      expect(printed).not.toContain(ISSUER.venueName);
      expect(lines.every((line) => line.length <= columnsFor(printer.paperWidth))).toBe(true);
      const commands = printedCommands(bytes);
      expect(commands.filter((c) => c.name === "GS v 0" && c.text === undefined)).toHaveLength(1);
      expect(commands.findIndex((c) => c.name === "GS v 0" && c.text === undefined)).toBeLessThan(
        commands.findIndex((c) => c.text?.includes("Filed Issuer SL")),
      );
    }
  },
);

it.each([PRINTER_58, PRINTER_80])(
  "prints a distinct enabled department trading name above the legal issuer on $paperWidth",
  (printer) => {
    const lines = drawn(
      formatReceipt({
        result: NO_QR_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        receiptHeader: { tradingName: "Bar La Buena", printTradingName: true },
        invoiceLocale: "es-ES",
        printer,
      }),
    );
    expect(lines.slice(0, 4)).toEqual([
      centred(printer, "Bar La Buena"),
      centred(printer, TRIM.headerSubtitle!),
      centred(printer, ISSUER.venueName),
      centred(printer, "NIF: B12345678"),
    ]);
  },
);

it.each([
  { tradingName: "", printTradingName: true },
  { tradingName: ISSUER.venueName, printTradingName: true },
  { tradingName: ` ${ISSUER.venueName} `, printTradingName: true },
  { tradingName: "Bar La Buena", printTradingName: false },
])(
  "prints the legal issuer once when the trading name is $tradingName and enabled=$printTradingName",
  (receiptHeader) => {
    const lines = drawn(
      formatReceipt({
        result: NO_QR_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        receiptHeader,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(lines.slice(0, 3)).toEqual([
      centred(PRINTER_80, TRIM.headerSubtitle!),
      centred(PRINTER_80, ISSUER.venueName),
      centred(PRINTER_80, "NIF: B12345678"),
    ]);
    expect(lines.filter((line) => line === centred(PRINTER_80, ISSUER.venueName))).toHaveLength(1);
  },
);

it("puts the QR legend immediately after the raster and a blank line after it", () => {
  const bytes = formatReceipt({
    result: FILED_SALE,
    issuer: ISSUER,
    receipt: TRIM,
    invoiceLocale: "es-ES",
    printer: PRINTER_80,
  });
  const [qr, legend, blank] = fromQr(bytes);
  expect(qr?.name).toBe("GS v 0");
  expect(legend?.text?.trimStart()).toBe("VERI*FACTU");
  expect(blank?.text).toBe("");
});

it.each([PRINTER_80, PRINTER_58])(
  "prints «QR tributario:» centred on its own line immediately above the QR on $paperWidth",
  (printer) => {
    for (const invoiceLocale of ["es-ES", "en-GB"]) {
      const commands = printedCommands(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: TRIM,
          invoiceLocale,
          printer,
        }),
      );
      const qrAt = commands.findIndex((c) => c.name === "GS v 0" && c.text === undefined);
      const { columns } = textGrid(printer.paperWidth, printer.resolution);
      const label = "QR tributario:";
      expect(commands[qrAt - 1]?.text).toBe(
        `${" ".repeat(Math.floor((columns - label.length) / 2))}${label}`,
      );
    }
  },
);

it("prints neither the caption nor the legend when no QR is printed, even if the words are given", () => {
  const s = decodeTicket(
    formatReceipt({
      result: { ...FILED_SALE, qr: "" },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    }),
  );
  expect(s).not.toContain("QR tributario");
  expect(s).not.toContain("VERI*FACTU");
});

it("prints the caption and the legend the sale carries, not words of its own", () => {
  const lines = drawn(
    formatReceipt({
      result: { ...FILED_SALE, qrText: { caption: "CAP-X", legend: "LEG-Y" } },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    }),
  );
  expect(lines.slice(0, 4)).toEqual([
    centred(PRINTER_80, "CAP-X"),
    "<QR>",
    centred(PRINTER_80, "LEG-Y"),
    "",
  ]);
  expect(lines.join("\n")).not.toContain("VERI*FACTU");
  expect(lines.join("\n")).not.toContain("QR tributario");
});

it.each([PRINTER_58, PRINTER_80])(
  "wraps a caption and a legend wider than the paper on $paperWidth, losing no word",
  (printer) => {
    const caption = "Alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const legend = "Kilo lima mike november oscar papa quebec romeo sierra tango";
    const lines = drawn(
      formatReceipt({
        result: { ...FILED_SALE, qrText: { caption, legend } },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      }),
    );
    const qrAt = lines.indexOf("<QR>");
    const columns = columnsFor(printer.paperWidth);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    const words = (from: string[]): string[] => from.join(" ").trim().split(/\s+/);
    expect(words(lines.slice(0, qrAt))).toEqual(caption.split(" "));
    const blankAfterLegend = lines.indexOf("", qrAt);
    expect(words(lines.slice(qrAt + 1, blankAfterLegend))).toEqual(legend.split(" "));
    for (const line of [...lines.slice(0, qrAt), ...lines.slice(qrAt + 1, blankAfterLegend)]) {
      expect(line).toBe(centred(printer, line.trim()));
    }
  },
);

it("prints a QR the regime gives no words for on its own, before the issuer", () => {
  const lines = drawn(
    formatReceipt({
      result: { ...FILED_WITHOUT_TEXT, qr: FILED_SALE.qr },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    }),
  );
  expect(lines.slice(0, 4)).toEqual([
    "<QR>",
    "",
    centred(PRINTER_80, TRIM.headerSubtitle!),
    centred(PRINTER_80, ISSUER.venueName),
  ]);
});

/** A centred line on `printer`'s paper, padded as the receipt pads it. */
function centred(printer: EscSetting, s: string): string {
  const { columns } = textGrid(printer.paperWidth, printer.resolution);
  return `${" ".repeat(Math.floor((columns - s.length) / 2))}${s}`;
}

/** The receipt's images in order: each drawn line of text, and the QR code as `"<QR>"`. */
function drawn(bytes: Uint8Array): string[] {
  return printedCommands(bytes)
    .filter((c) => c.name === "GS v 0")
    .map((c) => c.text ?? "<QR>");
}

// AEAT's QR specification v0.5.0 §3: the QR goes at the start of the invoice, before the invoice's
// own content, with «QR tributario:» above it and VERI*FACTU directly under it.
describe("the QR comes first on an invoice that carries one", () => {
  it.each([PRINTER_58, PRINTER_80])(
    "prints the caption, the QR and the legend before the issuer on $paperWidth",
    (printer) => {
      const bytes = formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      });
      expect(drawn(bytes).slice(0, 7)).toEqual([
        centred(printer, "QR tributario:"),
        "<QR>",
        centred(printer, "VERI*FACTU"),
        "",
        centred(printer, TRIM.headerSubtitle!),
        centred(printer, ISSUER.venueName),
        centred(printer, `NIF: ${ISSUER.nif}`),
      ]);
    },
  );

  it("prints nothing of the QR block after the tender: a blank line, then the footer", () => {
    const lines = printedLines(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    ).map((line) => line.trim().replace(/\s+/g, " "));
    const change = lines.indexOf("Cambio 9,10 €");
    expect(change).toBeGreaterThan(0);
    expect(lines.slice(change + 1)).toEqual(["", TRIM.footerMessage!, ""]);
  });

  it("keeps the practice warning above the QR block on a simulated ticket, and at the tear-off end", () => {
    const lines = drawn(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
        simulated: true,
      }),
    );
    expect(lines.slice(0, 7)).toEqual([
      "PRUEBA - SIN COBRO REAL",
      "",
      centred(PRINTER_80, "QR tributario:"),
      "<QR>",
      centred(PRINTER_80, "VERI*FACTU"),
      "",
      centred(PRINTER_80, ISSUER.venueName),
    ]);
    expect(lines.at(-1)).toBe("PRUEBA - SIN COBRO REAL");
  });

  it("prints a sale with no QR subtitle-first, and no legend anywhere: the footer follows the tender", () => {
    const lines = drawn(
      formatReceipt({
        result: NO_QR_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(lines[0]).toBe(centred(PRINTER_80, TRIM.headerSubtitle!));
    expect(lines[1]).toBe(centred(PRINTER_80, ISSUER.venueName));
    const change = lines.findIndex((line) => line.startsWith("Cambio"));
    expect(change).toBeGreaterThan(0);
    expect(lines.slice(change + 1)).toEqual(["", centred(PRINTER_80, TRIM.footerMessage!)]);
    expect(lines.join("\n")).not.toContain("VERI*FACTU");
  });
});

/** Resolve a line's goods name the way the receipt does — invoice locale, then any description. */
function lineName(line: TillSaleResult["lines"][number]): string {
  return line.descriptions["es-ES"] ?? Object.values(line.descriptions)[0] ?? "";
}

describe("formatReceipt — the faithful, legally-complete customer receipt", () => {
  it.each([
    [PRINTER_58, 0x68, 0x01],
    [PRINTER_80, 0x00, 0x02],
  ] as const)(
    "anchors a $paperWidth print area to the left, as wide as the image each line is drawn to",
    (printer, widthLowByte, widthHighByte) => {
      const bytes = formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      });
      expect([...bytes.slice(0, 10)]).toEqual([
        0x1b,
        0x40,
        0x1d,
        0x4c,
        0x00,
        0x00,
        0x1d,
        0x57,
        widthLowByte,
        widthHighByte,
      ]);
      const widthDots = widthLowByte + 256 * widthHighByte;
      const lines = printedCommands(bytes).filter((command) => command.text !== undefined);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line.widthDots).toBe(widthDots);
    },
  );
  it.each([
    PRINTER_80,
    PRINTER_58,
    { paperWidth: "80mm", resolution: "203dpi" } as const,
    { paperWidth: "58mm", resolution: "203dpi" } as const,
  ])(
    "selects no character table, sends no text and pulses no drawer ($paperWidth, $resolution)",
    (printer) => {
      const names = printedCommands(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: TRIM,
          invoiceLocale: "es-ES",
          printer,
        }),
      ).map((command) => command.name);
      for (const name of ["ESC t", "FS .", "ESC p", "DLE DC4", "text", "LF"])
        expect(names).not.toContain(name);
    },
  );
  it.each([PRINTER_80, PRINTER_58])(
    "centres the QR legend on $paperWidth and starts the body at the grid's first column",
    (printer) => {
      const bytes = formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      });
      const lines = printedLines(bytes).filter(Boolean);
      const { columns } = textGrid(printer.paperWidth, printer.resolution);
      const legend = `${" ".repeat(Math.floor((columns - 10) / 2))}VERI*FACTU`;
      expect(lines).toContain(legend);
      for (const line of lines.filter((line) => line !== legend))
        expect(line.length).toBeLessThanOrEqual(columns);
      expect(lines).toContain(centred(printer, ISSUER.venueName));
      expect(lines).toContain("Mesa 6 · Pedido 41");
      expect(lines.at(-1)).toBe(centred(printer, TRIM.footerMessage!));
    },
  );
  it.each([PRINTER_80, PRINTER_58])(
    "reproduces every mandated art. 7.1 / arts. 20-21 element of a filed receipt on $paperWidth paper",
    (printer) => {
      const bytes = formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      });
      const s = printedLines(bytes).join("\n");

      // Issuer identity — venue name + NIF (RD 1619/2012 art. 7.1.d).
      expect(s).toContain(ISSUER.venueName);
      expect(s).toContain(`NIF: ${ISSUER.nif}`);

      // Serie + número (7.1.a).
      expect(s).toContain(FILED_SALE.invoiceNumber);

      // Fecha de expedición (7.1.b): the label plus a year robust across ICU date formats / time zones.
      expect(s).toContain("Fecha");
      expect(s).toContain("2026");

      // Identification of the goods (7.1.e): one row per filed line, resolved in the invoice locale.
      for (const line of FILED_SALE.lines) expect(s).toContain(lineName(line));

      // Tipo(s) impositivo(s) + base imponible per rate, plus the cuota (allowed extra) (7.1.f).
      for (const v of FILED_SALE.vatBreakdown) {
        expect(s).toContain(`Base ${v.rate}%`);
        expect(s).toContain(`IVA ${v.rate}%`);
      }

      // Contraprestación total (7.1.g).
      expect(s).toContain("TOTAL");

      // Allowed operational extras: cash tendered (= total + change) and change.
      expect(s).toContain("Efectivo");
      expect(s).toContain("Cambio");

      // AEAT's caption above the QR (its QR specification v0.5.0, §3).
      expect(s).toContain("QR tributario:");

      // The Veri*Factu legend — a FIXED legal string (Orden HAC/1177/2024 art. 20.1.b).
      expect(s).toContain("VERI*FACTU");

      expect(s).toContain("12,10"); // line 1 gross
      expect(s).toContain("8,80"); // line 2 gross
      expect(s).toContain("10,00"); // base 21%
      // Label and amount on one line: a bare "2,10" would match inside line 1's "12,10".
      expect(s).toMatch(/IVA 21%[^\n]*2,10/u); // IVA 21% cuota
      expect(s).toContain("8,00"); // base 10%
      expect(s).toContain("0,80"); // IVA 10%
      expect(s).toContain("20,90"); // TOTAL
      expect(s).toContain("30,00"); // Efectivo = total + change
      expect(s).toContain("9,10"); // Cambio

      // The QR (arts. 20-21): the raster image of the sale's link, with its 4-square border, at 6 dots
      // per square (this 41-square link at 180 dpi) must appear verbatim in the receipt bytes.
      expect(
        bytesInclude(
          bytes,
          esc()
            .qrRaster(withQuietZone(qrModules(FILED_SALE.qr), 4), { moduleSize: 6 })
            .bytes(),
        ),
      ).toBe(true);
    },
  );

  it("emits the mandated elements in the art. 7.1 order", () => {
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    const order = [
      "VERI*FACTU",
      TRIM.headerSubtitle!,
      ISSUER.venueName,
      `NIF: ${ISSUER.nif}`,
      FILED_SALE.invoiceNumber,
      "Fecha",
      lineName(FILED_SALE.lines[0]!),
      "Base 21%",
      "TOTAL",
      "Efectivo",
      TRIM.footerMessage!,
    ];
    const positions = order.map((token) => s.indexOf(token));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("renders the non-fiscal header subtitle and footer message when present", () => {
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).toContain(TRIM.headerSubtitle!);
    expect(s).toContain(TRIM.footerMessage!);
  });

  it("marks a simulated receipt as a practice transaction outside the fiscal core", () => {
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
        simulated: true,
      }),
    );

    expect(s.match(/PRUEBA - SIN COBRO REAL/g)).toHaveLength(2);
    expect(s).toContain("VERI*FACTU");
  });

  it("omits the header subtitle and footer message when the trim is empty, keeping the core", () => {
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).not.toContain(TRIM.headerSubtitle!);
    expect(s).not.toContain(TRIM.footerMessage!);
    // The immutable art. 7.1 / legend core is never gated on the trim.
    expect(s).toContain("VERI*FACTU");
    expect(s).toContain("TOTAL");
    expect(s).toContain(`NIF: ${ISSUER.nif}`);
  });

  it("prints no QR command and no legend when the regime minted no QR", () => {
    const bytes = formatReceipt({
      result: NO_QR_SALE,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    // No QR image or native QR command is emitted (mirrors `qrSvg("") === ""` on the screen)...
    const commands = printedCommands(bytes);
    expect(commands.filter((c) => c.name === "GS v 0" && c.text === undefined)).toEqual([]);
    expect(commands.map((c) => c.name)).not.toContain("GS ( k");
    expect(decodeTicket(bytes)).not.toContain("VERI*FACTU");
  });

  it("resolves a line name to another description when the invoice locale is missing, and to empty for an empty map", () => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        { descriptions: { "en-GB": "Fallback only" }, quantity: "1", gross: "1.00" },
        { descriptions: {}, quantity: "1", gross: "1.00" },
      ],
    };
    const s = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    // The es-ES-less line degrades to its only description; the empty-map line prints nothing but
    // does not throw (a catalogue defect must never block the paper).
    expect(s).toContain("Fallback only");
    expect(s).toContain("VERI*FACTU");
  });

  it("prints the snapshotted localized unit beside an exact fractional quantity", () => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        {
          descriptions: { "es-ES": "Jamón" },
          quantity: "0.375",
          gross: "4.50",
          // Keyed by a bare content-language code, as the dashboard writes it;
          // `resolveSnapshotText` answers either shape. See the multi-language case below.
          unitName: { es: "kg" },
          unitPrecision: 3,
        },
      ],
      total: "4.50",
    };
    const text = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(text).toMatch(/0\.375 kg\s+Jamón[^\n]*4,50/u);
  });

  it("prints a weighted extra's filed physical amount and frozen unit beneath its dish", () => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        {
          descriptions: { "es-ES": "Tostada" },
          quantity: "1",
          gross: "2.00",
          parentLineNo: null,
        },
        {
          descriptions: { "es-ES": "Jamón" },
          quantity: "0.150",
          gross: "0.03",
          unitName: { es: "kg" },
          unitPrecision: 3,
          parentLineNo: 1,
        },
      ],
      total: "2.03",
    };

    const text = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(text).toMatch(/Tostada[\s\S]*Jamón 0\.150 kg[^\n]*0,03/u);
  });

  it("prints the unit abbreviation of the invoice language, not whichever one is stored first", () => {
    // Nothing re-keys a unit's abbreviation map onto the invoice locales (as
    // `toInvoiceLineDescriptions` does a line's `descriptions`), so the receipt must match the tag
    // "es-ES" against the bare key "es"; reading the first entry prints whichever language happens
    // to come first. The pairs are `EACH_UNIT`'s (`packages/catalogue/src/units.ts`).
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        {
          descriptions: { "es-ES": "Agua mineral" },
          quantity: "2",
          gross: "3.00",
          unitName: { ca: "u", en: "ea", es: "ud", eu: "u", gl: "u" },
          unitPrecision: 0,
        },
      ],
      total: "3.00",
    };
    const text = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(text).toMatch(/2 ud\s+Agua mineral/u);
  });

  it("prints a filed Each extra as a pick count in Spanish, regardless of its abbreviation", () => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        { descriptions: { "es-ES": "Tostada" }, quantity: "1", gross: "2.00", parentLineNo: null },
        {
          descriptions: { "es-ES": "Queso" },
          quantity: "3",
          gross: "1.50",
          parentLineNo: 1,
          unitName: { es: "pzas" },
          unitPrecision: 0,
          soldInEach: true,
        },
      ],
      total: "3.50",
    };
    const text = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(text).toContain("Queso x3");
    expect(text).not.toContain("3 pzas");
  });

  it("keeps an integral volume amount and its unit when the stored identity is not Each", () => {
    const result: TillSaleResult = {
      ...FILED_SALE,
      lines: [
        { descriptions: { "en-GB": "Tea" }, quantity: "1", gross: "2.00", parentLineNo: null },
        {
          descriptions: { "en-GB": "Milk" },
          quantity: "150",
          gross: "1.50",
          parentLineNo: 1,
          unitName: { en: "ml" },
          unitPrecision: 0,
        },
      ],
      total: "3.50",
    };
    const text = decodeTicket(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "en-GB",
        printer: PRINTER_80,
      }),
    );
    expect(text).toContain("Milk 150 ml");
    expect(text).not.toContain("Milk x150");
  });

  it("groups modifier lines under their dish — dish at its price, options indented at their delta, and the lines reconcile with the filed desglose", () => {
    // The dish is a PARENT line and each option a CHILD line pointing at it, each a filed sale
    // line. Σ(line.gross) === total and Σ(base + tax) === total: the receipt groups the filed lines
    // and never recomputes a fiscal figure.
    const withOptions: TillSaleResult = {
      locale: "es-ES",
      orderLabel: null,
      orderNumber: 1,
      invoiceNumber: "A/7",
      issuedAt: "2026-08-17T12:34:00.000Z",
      total: "10.50",
      vatBreakdown: [{ rate: "21", base: "8.67", tax: "1.83" }],
      lines: [
        {
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1",
          gross: "10.00",
          parentLineNo: null,
        },
        // A PAID option (+0.50) and a FREE option (0.00), both children of the dish above (lineNo 1).
        { descriptions: { "es-ES": "Extra queso" }, quantity: "1", gross: "0.50", parentLineNo: 1 },
        { descriptions: { "es-ES": "Sin cebolla" }, quantity: "1", gross: "0.00", parentLineNo: 1 },
      ],
      tender: { method: "cash", change: "0.00" },
      qr: FILED_SALE.qr,
      qrText: FILED_SALE.qrText,
    };
    const s = decodeTicket(
      formatReceipt({
        result: withOptions,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );

    // The dish renders as a normal goods row: quantity, name, its OWN gross (never the dish+options
    // running total) — all on one LF-separated line.
    expect(s).toMatch(/1\s+Hamburguesa[^\n]*10,00/u);

    // Each option renders INDENTED beneath the dish (leading spaces, no quantity prefix) at its
    // delta; the free option shows 0,00. The `\n {2,}<name>` anchor pins the indent: a flat
    // `1  <name>` render would put a digit right after the newline.
    expect(s).toMatch(/\n {2,}Extra queso[^\n]*0,50/u);
    expect(s).toMatch(/\n {2,}Sin cebolla[^\n]*0,00/u);

    // The printed total, and the reconciliation the receipt must preserve: the filed lines (dish + both
    // options) sum to the total, and the filed desglose (base + cuota) sums to the same total.
    expect(s).toContain("10,50");
    const lineSum = sumDecimals(withOptions.lines.map((l) => decimal(l.gross)));
    expect(compareDecimal(lineSum, decimal(withOptions.total))).toBe(0);
    const desgloseSum = sumDecimals(
      withOptions.vatBreakdown.flatMap((v) => [decimal(v.base), decimal(v.tax)]),
    );
    expect(compareDecimal(desgloseSum, decimal(withOptions.total))).toBe(0);
  });

  it("badges an option's PER-DISH count when it exceeds one, leaving a plain option unbadged", () => {
    // A child line's filed `quantity` is the COMBINED count (dish quantity × per-option quantity).
    // The "xN" badge appears only when the PER-DISH count is above 1.
    const withPerOptionQty: TillSaleResult = {
      locale: "es-ES",
      orderLabel: null,
      orderNumber: 1,
      invoiceNumber: "A/9",
      issuedAt: "2026-08-17T12:34:00.000Z",
      total: "34.50",
      vatBreakdown: [{ rate: "21", base: "28.51", tax: "5.99" }],
      lines: [
        // A dish filed at quantity 3.
        {
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "3",
          gross: "33.00",
          parentLineNo: null,
        },
        // An option taken x2 per dish → filed at the COMBINED quantity 6 (3 dishes × 2). Per-dish = 2 →
        // badged "x2". Its gross is the FILED delta, unchanged by the badge.
        { descriptions: { "es-ES": "Extra queso" }, quantity: "6", gross: "1.50", parentLineNo: 1 },
        // A plain option taken once per dish → filed at quantity 3 (== dish quantity). Per-dish = 1
        // → NO badge.
        { descriptions: { "es-ES": "Sin cebolla" }, quantity: "3", gross: "0.00", parentLineNo: 1 },
      ],
      tender: { method: "cash", change: "0.00" },
      qr: FILED_SALE.qr,
      qrText: FILED_SALE.qrText,
    };
    const s = decodeTicket(
      formatReceipt({
        result: withPerOptionQty,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );

    // The x2 option: an indented line carrying the "x2" badge after the name, its filed gross unchanged.
    expect(s).toMatch(/\n {2,}Extra queso x2[^\n]*1,50/u);
    // The plain option: NO badge — name, padding, then the gross.
    expect(s).toMatch(/\n {2,}Sin cebolla {2,}0,00/u);
    expect(s).not.toContain("Sin cebolla x");

    // Without the badge the x2 line would read like the control.
    expect(s).not.toMatch(/\n {2,}Extra queso {2,}1,50/u);
  });

  it("ends in the full-cut command", () => {
    const bytes = formatReceipt({
      result: FILED_SALE,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    expect([...bytes.slice(-FEED_THEN_CUT.length)]).toEqual(FEED_THEN_CUT);
  });

  it("prints a blank between the amount and the € sign", () => {
    // A no-break space is drawn exactly like a space, so the read-back cannot tell them apart and
    // this case passes with `formatMoney`'s rewrite deleted; `receipt-money.test.ts` is what fails.
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).not.toMatch(/[\u00a0\u202f]/u);
    const idx = s.indexOf("20,90");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(s[idx + "20,90".length]).toBe(" ");
  });

  it("keeps card identity off the fiscal ticket", () => {
    // Inject surplus identity fields to catch accidental rendering independently of the DTO type.
    const bytes = formatReceipt({
      result: {
        ...FILED_SALE,
        tender: {
          method: "card",
          charged: "20.90",
          tip: "0.00",
          ...{
            card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
          },
          reference: null,
        },
      },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    const s = decodeTicket(bytes);
    expect(s).toContain("Tarjeta");
    expect(s).not.toContain("VISA");
    expect(s).not.toContain("5838");
    expect(s).not.toContain("Sin contacto");
    expect(s).not.toContain("328600");
    expect(s).not.toContain("Efectivo");
  });

  it("omits chip identity and authorization from the invoice", () => {
    const bytes = formatReceipt({
      result: {
        ...FILED_SALE,
        tender: {
          method: "card",
          charged: "20.90",
          tip: "0.00",
          ...{
            card: { scheme: "MASTERCARD", last4: "4291", entryMode: "chip", authCode: "911234" },
          },
          reference: null,
        },
      },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    const s = decodeTicket(bytes);
    expect(s).not.toContain("MASTERCARD");
    expect(s).not.toContain("4291");
    expect(s).not.toContain("Chip");
    expect(s).not.toContain("911234");
  });

  it("ignores surplus card identity even when its entry mode is unknown", () => {
    const bytes = formatReceipt({
      result: {
        ...FILED_SALE,
        tender: {
          method: "card",
          charged: "20.90",
          tip: "0.00",
          ...{ card: { scheme: "VISA", last4: "5838", entryMode: "unknown", authCode: null } },
          reference: null,
        },
      },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    const s = decodeTicket(bytes);
    expect(s).toContain("Tarjeta");
    expect(s).not.toContain("VISA");
    expect(s).not.toContain("5838");
    expect(s).not.toContain("Aut ");
  });

  it("prints the tip and charged lines only when a tip rode on the card", () => {
    const s = decodeTicket(
      formatReceipt({
        result: {
          ...FILED_SALE,
          tender: {
            method: "card",
            charged: "21.40",
            tip: "0.50",
            ...{
              card: { scheme: "VISA", last4: "5838", entryMode: "contactless", authCode: "328600" },
            },
            reference: null,
          },
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).toContain("Propina");
    expect(s).toContain("Cobrado");
  });

  it("omits the tip/charged lines when there is no tip", () => {
    const s = decodeTicket(
      formatReceipt({
        result: {
          ...FILED_SALE,
          tender: {
            method: "card",
            charged: "20.90",
            tip: "0.00",
            ...{ card: { scheme: "VISA", last4: "5838", entryMode: "unknown", authCode: null } },
            reference: null,
          },
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).not.toContain("Cobrado");
    expect(s).not.toContain("Propina");
  });

  it("prints Tarjeta alone when no card facts are known", () => {
    const s = decodeTicket(
      formatReceipt({
        result: {
          ...FILED_SALE,
          tender: { method: "card", charged: "20.90", tip: "0.00", reference: null },
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).toContain("Tarjeta");
    expect(s).not.toContain("****");
  });

  it("prints a manual card reference when present", () => {
    const s = decodeTicket(
      formatReceipt({
        result: {
          ...FILED_SALE,
          tender: { method: "card", charged: "20.90", tip: "0.00", reference: "4471" },
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).toContain("Ref. 4471");
  });

  it("still prints the cash block for a cash sale", () => {
    const s = decodeTicket(
      formatReceipt({
        result: { ...FILED_SALE, tender: { method: "cash", change: "9.10" } },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    expect(s).toContain("Efectivo");
    expect(s).toContain("Cambio");
  });
});

it("adds only the duplicate marker and preserves the order grouping and QR bytes", () => {
  const input = {
    result: FILED_SALE,
    issuer: ISSUER,
    receipt: TRIM,
    invoiceLocale: "es-ES",
    printer: PRINTER_80,
  };
  const original = formatReceipt(input);
  const duplicate = formatReceipt({ ...input, duplicate: true });
  expect(decodeTicket(original)).toContain("Mesa 6 · Pedido 41");
  expect(decodeTicket(original)).not.toContain("DUPLICADO");
  const commands = printedCommands(duplicate);
  const marker = centred(PRINTER_80, "DUPLICADO");
  expect(commands.filter((c) => c.text === marker)).toHaveLength(1);
  expect(Buffer.concat(commands.filter((c) => c.text !== marker).map((c) => c.bytes))).toEqual(
    Buffer.from(original),
  );
  expect(decodeTicket(duplicate)).toContain("DUPLICADO");
});

it("prints an unpaid invoice without claiming a cash or card payment", () => {
  const text = decodeTicket(
    formatReceipt({
      result: { ...FILED_SALE, tender: { method: "unpaid" } },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    }),
  );
  expect(text).toContain("TOTAL");
  for (const label of ["Efectivo", "Cambio", "Tarjeta", "Propina", "Cobrado", "Ref."])
    expect(text).not.toContain(label);
});

// Two answers on one dish: the first stores customer text, the second none. Every name differs, and
// each kitchen name differs again, so no assertion passes while the receipt reads the staff name
// where a customer name exists, or the kitchen name at all. Keyed by bare content-language codes,
// as `buildLineExtras` (`apps/server/src/modifier-selection.ts`) writes them, so the invoice tags
// asked for below are not keys: the assertions tell a locale resolve from an exact-key lookup.
const ANSWERED_DISH: TillSaleResult = {
  ...FILED_SALE,
  lines: [
    {
      ...FILED_SALE.lines[0]!,
      optionSnapshots: [
        {
          listName: { es: "Tamano personal" },
          listCustomerName: { es: "Tamano cliente", en: "Size guest" },
          listKitchenName: "Tamano cocina",
          labelName: { es: "Grande personal" },
          labelCustomerName: { es: "Grande cliente", en: "Large guest" },
          labelKitchenName: "Grande cocina",
        },
        {
          listName: { es: "Coccion personal" },
          listCustomerName: null,
          listKitchenName: "Coccion cocina",
          labelName: { es: "Poco hecha personal" },
          labelCustomerName: null,
          labelKitchenName: "Poco hecha cocina",
        },
      ],
    },
  ],
};

it("prints each options answer under its dish in the invoice locale, indented by two", () => {
  const lines = printedLines(
    formatReceipt({
      result: ANSWERED_DISH,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    }),
  );
  // Directly beneath the dish, in order, each indented by two: the first answer takes the stored
  // customer text, the second has none stored and falls back to the STAFF name — never the kitchen
  // one, which is a cook's word and has no place on a diner's receipt.
  const dish = lines.findIndex((line) => line.includes("Menú del día"));
  expect(dish).toBeGreaterThanOrEqual(0);
  expect(lines.slice(dish + 1, dish + 3)).toEqual([
    "  Tamano cliente: Grande cliente",
    "  Coccion personal: Poco hecha personal",
  ]);
});

it("prints the answers in the requested locale, on a duplicate as on the original", () => {
  for (const duplicate of [false, true]) {
    const paper = decodeTicket(
      formatReceipt({
        result: ANSWERED_DISH,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "en-GB",
        printer: PRINTER_80,
        duplicate,
      }),
    );
    // The requested locale picks the English customer text; the answer that stored no customer text
    // at all still falls back to its Spanish staff name, which is the only text it has.
    expect(paper).toContain("Size guest: Large guest");
    expect(paper).not.toContain("Tamano cliente");
    expect(paper).toContain("Coccion personal: Poco hecha personal");
  }
});

describe("formatReceipt — printer layout", () => {
  const LONG_SALE: TillSaleResult = {
    ...FILED_SALE,
    orderLabel: "Terraza mesa del fondo junto a la fuente",
    total: "13.00",
    vatBreakdown: [{ rate: "10", base: "11.82", tax: "1.18" }],
    lines: [
      {
        descriptions: { "es-ES": "Tostada con tomate y jamón ibérico de bellota" },
        quantity: "1",
        gross: "12.50",
        parentLineNo: null,
        optionSnapshots: [],
      },
      {
        descriptions: { "es-ES": "Aceite de oliva virgen extra de la casa" },
        quantity: "1",
        gross: "0.50",
        parentLineNo: 1,
      },
    ],
    tender: { method: "cash", change: "7.00" },
  };
  const LONG_ISSUER: ReceiptIssuer = {
    venueName: "Charcutería y Bodega La Buena Mesa de Madrid",
    nif: "B12345678",
  };
  const LONG_TRIM: ReceiptTrim = {
    headerSubtitle: "Calle Mayor 1, 28013 Madrid \u{2014} abierto todos los días",
    footerMessage:
      "¡Gracias por su visita! Vuelva pronto\u{2026} \u{201c}La Buena\u{201d} le espera",
  };

  it.each([
    PRINTER_80,
    PRINTER_58,
    { paperWidth: "58mm", resolution: "203dpi" } as const,
    { paperWidth: "80mm", resolution: "203dpi" } as const,
  ])("keeps every printed line within the column count ($paperWidth, $resolution)", (printer) => {
    const lines = printedLines(
      formatReceipt({
        result: LONG_SALE,
        issuer: LONG_ISSUER,
        receipt: LONG_TRIM,
        invoiceLocale: "es-ES",
        printer,
        simulated: true,
        duplicate: true,
      }),
    );
    const columns = columnsFor(printer.paperWidth);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    expect(lines.join("\n")).toContain("VERI*FACTU");
  });

  it("wraps a long product name under the name and right-aligns its price on the last line", () => {
    const lines = printedLines(
      formatReceipt({
        result: LONG_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    const first = lines.indexOf("1  Tostada con tomate y jamón");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 4)).toEqual([
      "1  Tostada con tomate y jamón",
      "   ibérico de bellota  12,50 €",
      "  Aceite de oliva virgen extra",
      `  de la casa${" ".repeat(12)}0,50 €`,
    ]);
  });

  it("wraps a long options answer, keeping every continuation line indented by two", () => {
    // An answer line longer than 30 columns must wrap AND keep its 2-space indent on every
    // continuation line — the answers sit under the dish, not flush against the paper's left edge.
    const result: TillSaleResult = {
      ...FILED_SALE,
      total: "10.00",
      vatBreakdown: [{ rate: "10", base: "9.09", tax: "0.91" }],
      lines: [
        {
          descriptions: { "es-ES": "Cafe" },
          quantity: "1",
          gross: "10.00",
          parentLineNo: null,
          optionSnapshots: [
            {
              listName: { "es-ES": "Nota" },
              listCustomerName: null,
              listKitchenName: null,
              labelName: { "es-ES": "sin cebolla y con mucho tomate natural bien picado" },
              labelCustomerName: null,
              labelKitchenName: null,
            },
          ],
        },
      ],
      tender: { method: "cash", change: "0.00" },
    };
    const lines = printedLines(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    const first = lines.indexOf("  Nota: sin cebolla y con");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 3)).toEqual([
      "  Nota: sin cebolla y con",
      "  mucho tomate natural bien",
      "  picado",
    ]);
  });

  it("wraps a long manual card reference at 30 columns", () => {
    // `Ref. <reference>` longer than the 30-column paper must wrap onto continuation lines rather than
    // print a single over-width line.
    const result: TillSaleResult = {
      ...FILED_SALE,
      total: "10.00",
      vatBreakdown: [{ rate: "10", base: "9.09", tax: "0.91" }],
      lines: [
        { descriptions: { "es-ES": "Cafe" }, quantity: "1", gross: "10.00", parentLineNo: null },
      ],
      tender: {
        method: "card",
        charged: "10.00",
        tip: "0.00",
        reference: "AUTORIZACION 123456 TERMINAL 0042 LOTE 17",
      },
    };
    const lines = printedLines(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    const first = lines.indexOf("Ref. AUTORIZACION 123456");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 2)).toEqual([
      "Ref. AUTORIZACION 123456",
      "TERMINAL 0042 LOTE 17",
    ]);
  });

  it("wraps a long unit name at a small continuation indent, not one glyph per line", () => {
    // A quantity+unit prefix wider than half the paper must NOT drag the product name's continuation
    // indent out to the edge, or the name wraps a single glyph per line (an unreadable column).
    const result: TillSaleResult = {
      ...FILED_SALE,
      total: "9.99",
      vatBreakdown: [{ rate: "10", base: "9.08", tax: "0.91" }],
      lines: [
        {
          descriptions: { "es-ES": "Queso manchego curado en aceite" },
          quantity: "123456.789",
          gross: "9.99",
          unitName: { es: "kilogramos-de-queso-manchego-curado" },
          unitPrecision: 3,
          parentLineNo: null,
        },
      ],
      tender: { method: "cash", change: "0.00" },
    };
    const lines = printedLines(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    // No printed line exceeds the 30-column paper (global width invariant).
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    // The name must NOT wrap one glyph per line: no line is an indent followed by a single character.
    expect(lines.filter((l) => /^ +\S$/u.test(l))).toEqual([]);
    // The name's continuation lines exist, stay at the 2-space cap, and each carries a real word.
    const cont = lines.filter((l) => /^ {2}\S/u.test(l) && /[a-z]/u.test(l));
    expect(cont.length).toBeGreaterThan(0);
    for (const l of cont) expect(l.trimStart().length, l).toBeGreaterThan(2);
  });

  it("measures the euro sign as the one column it is drawn in", () => {
    const lines = printedLines(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    expect(lines).toContain(`TOTAL${" ".repeat(18)}20,90 €`);
    expect(lines).toContain(`Base 21%${" ".repeat(15)}10,00 €`);
  });

  it.each([
    ["180dpi", 6, 294, 37],
    ["203dpi", 7, 343, 43],
  ] as const)(
    "prints the QR as a %s raster image of the sale's link, 30-40 mm, with no native QR command",
    (resolution, dots, heightDots, widthBytes) => {
      for (const paperWidth of ["58mm", "80mm"] as const) {
        const bytes = formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer: { paperWidth, resolution },
        });
        expect(printedCommands(bytes).map((c) => c.name)).not.toContain("GS ( k");
        const qr = fromQr(bytes)[0]!;
        expect(qr.widthDots).toBe(widthBytes * 8);
        expect(qr.heightDots).toBe(heightDots);
        const squares = qrModules(FILED_SALE.qr).length;
        expect(squares).toBe(41);
        expect(heightDots).toBe((squares + 8) * dots);
        const mm = (squares * dots * 25.4) / (resolution === "203dpi" ? 203 : 180);
        expect(mm).toBeGreaterThanOrEqual(30);
        expect(mm).toBeLessThanOrEqual(40);
        const image = esc()
          .qrRaster(withQuietZone(qrModules(FILED_SALE.qr), 4), { moduleSize: dots })
          .bytes();
        expect(bytesInclude(bytes, image)).toBe(true);
      }
    },
  );
});

/** Cents from a printed amount such as `-1.234,50 €`. */
function printedCents(line: string): number {
  const amount = /(-?[\d.]+,\d{2}) €$/.exec(line)?.[1];
  if (amount === undefined) throw new Error(`no amount on "${line}"`);
  return Number(amount.replace(/[.,]/g, ""));
}

/**
 * A bill-payment ticket's payment rows must come to its TOTAL: money handed over or charged, less
 * change, tip and refunds (a refund row is already printed negative).
 */
function expectPaymentRowsToAddUpToTotal(printed: string[]): void {
  const start = printed.findIndex((line) => line.startsWith("TOTAL"));
  expect(start).toBeGreaterThanOrEqual(0);
  let paid = 0;
  for (const line of printed.slice(start + 1)) {
    if (/^(Efectivo|Tarjeta|Devolución) /.test(line)) paid += printedCents(line);
    else if (/^(Cambio|Propina) /.test(line)) paid -= printedCents(line);
  }
  expect(paid).toBe(printedCents(printed[start]!));
}

describe("a bill paid in parts before its invoice", () => {
  // €20.90 paid as €10.00 cash from a €50.00 note, then €10.90 by hand-keyed card with a €1.00
  // tip: each payment prints on its own, with the change it gave when it was taken.
  const PAID_IN_PARTS: TillSaleResult = {
    ...FILED_SALE,
    tender: { method: "cash", change: "40.00" },
    payments: [
      {
        method: "cash",
        amount: "10.00",
        tip: "0.00",
        tendered: "50.00",
        change: "40.00",
        refunds: [],
      },
      { method: "card", amount: "11.90", tip: "1.00", reference: "OP-9", refunds: [] },
    ],
  };

  function lines(): string[] {
    return printedLines(
      formatReceipt({
        result: PAID_IN_PARTS,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    ).map((line) => line.trim().replace(/\s+/g, " "));
  }

  it("prints each payment with what was handed over, the change it gave and its tip", () => {
    const printed = lines();
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));

    expect(printed.slice(start + 1).filter((line) => line !== "")).toEqual([
      "Efectivo 50,00 €",
      "Cambio 40,00 €",
      "Tarjeta 11,90 €",
      "Ref. OP-9",
      "Propina 1,00 €",
      TRIM.footerMessage!,
    ]);
    expectPaymentRowsToAddUpToTotal(printed);
  });

  it("never derives cash from the total and the change, as a single payment's ticket does", () => {
    expect(lines().some((line) => line === "Efectivo 60,90 €")).toBe(false);
  });
});

describe("a bill payment partly given back before its invoice", () => {
  // €50.00 cash handed over exactly against a €60.00 bill, €10.00 of it given back in two refunds
  // when items were voided, and the €40.00 invoice then issued (design §8 test 11).
  it("prints the cash as it was handed over and each refund as its own line", () => {
    const printed = printedLines(
      formatReceipt({
        result: {
          ...FILED_SALE,
          total: "40.00",
          tender: { method: "cash", change: "0.00" },
          payments: [
            {
              method: "cash",
              amount: "40.00",
              tip: "0.00",
              tendered: "50.00",
              change: "0.00",
              refunds: [
                { amount: "6.00", tip: "0.00" },
                { amount: "4.00", tip: "0.00" },
              ],
            },
          ],
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    ).map((line) => line.trim().replace(/\s+/g, " "));
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));

    expect(printed.slice(start + 1).filter((line) => line !== "")).toEqual([
      "Efectivo 50,00 €",
      "Devolución -6,00 €",
      "Devolución -4,00 €",
      TRIM.footerMessage!,
    ]);
    expectPaymentRowsToAddUpToTotal(printed);
  });

  // The card's tender amount is already net of its refunds, so the card row prints the original
  // charge: €20.00 charged, €5.00 given back, €15.00 invoiced.
  it("prints a card payment's original charge and its refund under it", () => {
    const printed = printedLines(
      formatReceipt({
        result: {
          ...FILED_SALE,
          total: "15.00",
          tender: { method: "card", charged: "15.00", tip: "0.00", reference: "OP-3" },
          payments: [
            {
              method: "card",
              amount: "15.00",
              tip: "0.00",
              reference: "OP-3",
              refunds: [{ amount: "5.00", tip: "0.00" }],
            },
          ],
        },
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    ).map((line) => line.trim().replace(/\s+/g, " "));
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));

    expect(printed.slice(start + 1).filter((line) => line !== "")).toEqual([
      "Tarjeta 20,00 €",
      "Ref. OP-3",
      "Devolución -5,00 €",
      TRIM.footerMessage!,
    ]);
    expectPaymentRowsToAddUpToTotal(printed);
  });
});

describe("a comped or discounted dish (owner decision 2026-09-30)", () => {
  /** An 80 mm row: the label, then the amount right-aligned in 42 columns. */
  const at80 = (label: string, amount: string): string =>
    label + " ".repeat(42 - label.length - amount.length) + amount;

  const ADJUSTED: TillSaleResult = {
    ...FILED_SALE,
    total: "22.60",
    vatBreakdown: [{ rate: "10", base: "20.55", tax: "2.05" }],
    lines: [
      {
        descriptions: { "es-ES": "Hamburguesa" },
        quantity: "1",
        gross: "0.00",
        listGross: "12.00",
        parentLineNo: null,
        adjustments: [{ kind: "comp", amount: "12.00" }],
      },
      {
        descriptions: { "es-ES": "Tabla de quesos" },
        quantity: "1",
        gross: "9.60",
        listGross: "12.00",
        parentLineNo: null,
        adjustments: [{ kind: "discount", percentBp: 2000, amount: "2.40" }],
      },
      {
        descriptions: { "es-ES": "Agua mineral" },
        quantity: "2",
        gross: "4.00",
        parentLineNo: null,
      },
      {
        descriptions: { "es-ES": "Pizza margarita" },
        quantity: "1",
        gross: "0.00",
        listGross: "9.00",
        parentLineNo: null,
        adjustments: [{ kind: "comp", amount: "10.50" }],
      },
      {
        descriptions: { "es-ES": "Aceitunas" },
        quantity: "1",
        gross: "0.00",
        listGross: "1.50",
        parentLineNo: 4,
      },
      {
        descriptions: { "es-ES": "Croquetas" },
        quantity: "3",
        gross: "9.00",
        listGross: "9.99",
        parentLineNo: null,
        adjustments: [{ kind: "discount", amount: "0.99" }],
      },
    ],
    tender: { method: "cash", change: "0.00" },
  };

  /** 12.5% off the whole bill, spread over its two lines. */
  const BILL_DISCOUNT: TillSaleResult = {
    ...FILED_SALE,
    total: "5.69",
    vatBreakdown: [{ rate: "10", base: "5.17", tax: "0.52" }],
    lines: [
      {
        descriptions: { "es-ES": "Agua mineral" },
        quantity: "2",
        gross: "3.50",
        listGross: "4.00",
        parentLineNo: null,
      },
      {
        descriptions: { "es-ES": "Pan de pueblo" },
        quantity: "1",
        gross: "2.19",
        listGross: "2.50",
        parentLineNo: null,
      },
    ],
    billAdjustments: [{ kind: "discount", percentBp: 1250, amount: "0.81" }],
    tender: { method: "cash", change: "0.00" },
  };

  function printed80(result: TillSaleResult): string[] {
    return printedLines(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
  }

  it("prints each dish at its list price, with its comp or discount on its own line beneath", () => {
    const lines = printed80(ADJUSTED);
    const first = lines.indexOf(at80("1  Hamburguesa", "12,00 €"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 11)).toEqual([
      at80("1  Hamburguesa", "12,00 €"),
      at80("  Invitación", "-12,00 €"),
      at80("1  Tabla de quesos", "12,00 €"),
      at80("  Descuento 20%", "-2,40 €"),
      at80("2  Agua mineral", "4,00 €"),
      at80("1  Pizza margarita", "9,00 €"),
      // The comp covers the dish and its extras, so it prints after them.
      at80("  Aceitunas", "1,50 €"),
      at80("  Invitación", "-10,50 €"),
      at80("3  Croquetas", "9,99 €"),
      at80("  Descuento", "-0,99 €"),
      "",
    ]);
    expect(lines).toContain(at80("TOTAL", "22,60 €"));
  });

  it("prints a whole-bill discount once, after the goods and before the VAT breakdown", () => {
    const lines = printed80(BILL_DISCOUNT);
    const first = lines.indexOf(at80("2  Agua mineral", "4,00 €"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 5)).toEqual([
      at80("2  Agua mineral", "4,00 €"),
      at80("1  Pan de pueblo", "2,50 €"),
      at80("Descuento 12,5%", "-0,81 €"),
      "",
      at80("Base 10%", "5,17 €"),
    ]);
    expect(lines.filter((line) => line.startsWith("Descuento"))).toHaveLength(1);
  });

  it.each([
    ["line", ADJUSTED],
    ["bill", BILL_DISCOUNT],
  ] as const)("writes no arrow, and its %s amounts add up to the TOTAL", (_, result) => {
    const lines = printed80(result);
    expect(lines.filter((line) => line.includes("->"))).toEqual([]);
    const start = lines.findIndex((line) => line.startsWith("Fecha")) + 2;
    const end = lines.indexOf("", start);
    const goods = lines.slice(start, end).map((line) => printedCents(line.trimEnd()));
    const total = lines.find((line) => line.startsWith("TOTAL"))!;
    expect(goods.reduce((sum, cents) => sum + cents, 0)).toBe(printedCents(total.trimEnd()));
  });

  it.each([PRINTER_80, { paperWidth: "80mm", resolution: "203dpi" } as const])(
    "prints the comp's label as Invitación ($resolution)",
    (printer) => {
      const lines = printedLines(
        formatReceipt({
          result: ADJUSTED,
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer,
        }),
      );
      expect(lines.filter((line) => line.startsWith("  Invitación "))).toHaveLength(2);
    },
  );

  it("prints a long name at its list price and the comp on its own line on the narrow roll", () => {
    const lines = printedLines(
      formatReceipt({
        result: {
          ...ADJUSTED,
          total: "0.00",
          lines: [
            {
              descriptions: { "es-ES": "Tostada con tomate y jamón ibérico de bellota" },
              quantity: "1",
              gross: "0.00",
              listGross: "12.50",
              parentLineNo: null,
              adjustments: [{ kind: "comp", amount: "12.50" }],
            },
          ],
        },
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    const first = lines.indexOf("1  Tostada con tomate y jamón");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 3)).toEqual([
      "1  Tostada con tomate y jamón",
      `   ibérico de bellota${" ".repeat(2)}12,50 €`,
      `  Invitación${" ".repeat(10)}-12,50 €`,
    ]);
  });

  it.each([
    PRINTER_80,
    PRINTER_58,
    { paperWidth: "58mm", resolution: "203dpi" } as const,
    { paperWidth: "80mm", resolution: "203dpi" } as const,
  ])("keeps every line of changed prices within $paperWidth ($resolution)", (printer) => {
    const lines = printedLines(
      formatReceipt({
        result: {
          ...ADJUSTED,
          lines: [
            ...ADJUSTED.lines,
            {
              descriptions: { "es-ES": "Chuletón de buey madurado a la brasa con guarnición" },
              quantity: "12",
              gross: "1111.11",
              listGross: "1234.56",
              parentLineNo: null,
              adjustments: [{ kind: "discount", percentBp: 1000, amount: "123.45" }],
            },
          ],
          billAdjustments: [{ kind: "discount", percentBp: 1250, amount: "1000.00" }],
        },
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer,
      }),
    );
    const columns = columnsFor(printer.paperWidth);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    expect(lines.filter((line) => line.endsWith("1234,56 €"))).toHaveLength(1);
    expect(lines.filter((line) => line.endsWith("-123,45 €"))).toHaveLength(1);
    expect(lines.filter((line) => line.endsWith("-1000,00 €"))).toHaveLength(1);
  });
});

describe("the receipt's fixed words follow its language", () => {
  // Every fixed word the receipt can print: a comp and a 12.5% discount, a bill paid in parts by
  // cash with change and by card with a tip, a reference and a refund, on a duplicate practice
  // ticket. A single card tender with a tip adds the charged line.
  const LABELLED_SALE: TillSaleResult = {
    ...FILED_SALE,
    lines: [
      {
        descriptions: { "es-ES": "Hamburguesa" },
        quantity: "1",
        gross: "0.00",
        listGross: "12.00",
        parentLineNo: null,
        adjustments: [{ kind: "comp", amount: "12.00" }],
      },
      {
        descriptions: { "es-ES": "Tabla de quesos" },
        quantity: "1",
        gross: "10.50",
        listGross: "12.00",
        parentLineNo: null,
        adjustments: [{ kind: "discount", percentBp: 1250, amount: "1.50" }],
      },
    ],
    payments: [
      {
        method: "cash",
        amount: "10.00",
        tip: "0.00",
        tendered: "50.00",
        change: "40.00",
        refunds: [],
      },
      {
        method: "card",
        amount: "10.90",
        tip: "1.00",
        reference: "OP-9",
        refunds: [{ amount: "2.00", tip: "0.00" }],
      },
    ],
  };
  const CARD_WITH_TIP: TillSaleResult = {
    ...FILED_SALE,
    tender: { method: "card", charged: "21.90", tip: "1.00", reference: "4471" },
  };

  function printed(result: TillSaleResult, invoiceLocale: string): string[] {
    return printedLines(
      formatReceipt({
        result,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale,
        printer: PRINTER_80,
        simulated: true,
        duplicate: true,
      }),
    ).map((line) => line.trim().replace(/\s+/g, " "));
  }

  it.each([
    {
      locale: "ca-ES",
      words: {
        practice: "PROVA - SENSE COBRAMENT REAL",
        duplicate: "DUPLICAT",
        nif: "NIF: B12345678",
        order: "Mesa 6 · Comanda 41",
        invoice: "Factura A/1",
        date: "Data ",
        comp: "Invitació -12,00 €",
        discount: "Descompte 12,5% -1,50 €",
        base: "Base 21% 10,00 €",
        vat: "IVA 21% 2,10 €",
        total: "TOTAL 20,90 €",
        cash: "Efectiu 50,00 €",
        change: "Canvi 40,00 €",
        card: "Targeta 12,90 €",
        reference: "Ref. OP-9",
        tip: "Propina 1,00 €",
        refund: "Devolució -2,00 €",
        charged: "Cobrat 21,90 €",
      },
      single: {
        cash: "Efectiu 30,00 €",
        change: "Canvi 9,10 €",
        card: "Targeta",
        reference: "Ref. 4471",
      },
    },
    {
      locale: "gl-ES",
      words: {
        practice: "PROBA - SEN COBRO REAL",
        duplicate: "DUPLICADO",
        nif: "NIF: B12345678",
        order: "Mesa 6 · Pedido 41",
        invoice: "Factura A/1",
        date: "Data ",
        comp: "Invitación -12,00 €",
        discount: "Desconto 12,5% -1,50 €",
        base: "Base 21% 10,00 €",
        vat: "IVE 21% 2,10 €",
        total: "TOTAL 20,90 €",
        cash: "Efectivo 50,00 €",
        change: "Cambio 40,00 €",
        card: "Tarxeta 12,90 €",
        reference: "Ref. OP-9",
        tip: "Propina 1,00 €",
        refund: "Devolución -2,00 €",
        charged: "Cobrado 21,90 €",
      },
      single: {
        cash: "Efectivo 30,00 €",
        change: "Cambio 9,10 €",
        card: "Tarxeta",
        reference: "Ref. 4471",
      },
    },
    {
      locale: "eu-ES",
      words: {
        practice: "PROBA - BENETAKO KOBRANTZARIK GABE",
        duplicate: "BIKOIZKARIA",
        nif: "IFZ: B12345678",
        order: "Mesa 6 · Eskaera 41",
        invoice: "Faktura A/1",
        date: "Data ",
        comp: "Gonbidapena -12,00 €",
        discount: "Deskontua 12,5% -1,50 €",
        base: "Oinarria 21% 10,00 €",
        vat: "BEZ 21% 2,10 €",
        total: "GUZTIRA 20,90 €",
        cash: "Eskudirua 50,00 €",
        change: "Itzulia 40,00 €",
        card: "Txartela 12,90 €",
        reference: "Erref. OP-9",
        tip: "Eskupekoa 1,00 €",
        refund: "Itzulketa -2,00 €",
        charged: "Kobratua 21,90 €",
      },
      single: {
        cash: "Eskudirua 30,00 €",
        change: "Itzulia 9,10 €",
        card: "Txartela",
        reference: "Erref. 4471",
      },
    },
  ])("prints every fixed word in $locale", ({ locale, words, single }) => {
    const sale = printed(LABELLED_SALE, locale);
    const card = printed(CARD_WITH_TIP, locale);
    const cash = printed(FILED_SALE, locale);
    const { charged, date, practice, ...rows } = words;
    for (const [key, row] of Object.entries(rows)) expect(sale, key).toContain(row);
    expect(sale.filter((line) => line === practice)).toHaveLength(2);
    expect(sale.some((line) => line.startsWith(date))).toBe(true);
    expect(card).toContain(charged);
    expect(card).toContain(single.card);
    expect(card).toContain(single.reference);
    expect(cash).toContain(single.cash);
    expect(cash).toContain(single.change);
    for (const [name, ticket] of Object.entries({ sale, card, cash })) {
      for (const spanish of ["Fecha", "Tarjeta", "PRUEBA"]) {
        expect(ticket.join("\n"), `${name}: ${spanish}`).not.toContain(spanish);
      }
    }
  });

  it("prints the Veri*Factu legend and the QR caption identically in every language", () => {
    const fromQrText = (invoiceLocale: string) =>
      fromQr(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: TRIM,
          invoiceLocale,
          printer: PRINTER_80,
        }),
      );
    const spanish = printedCommands(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    const caption =
      spanish[spanish.findIndex((c) => c.name === "GS v 0" && c.text === undefined) - 1];
    expect(caption?.text?.trim()).toBe("QR tributario:");
    for (const locale of ["ca-ES", "gl-ES", "eu-ES"]) {
      const commands = printedCommands(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: TRIM,
          invoiceLocale: locale,
          printer: PRINTER_80,
        }),
      );
      const qrAt = commands.findIndex((c) => c.name === "GS v 0" && c.text === undefined);
      expect(Buffer.from(commands[qrAt - 1]!.bytes), locale).toEqual(Buffer.from(caption!.bytes));
      const [qr, legend] = fromQrText(locale);
      const [spanishQr, spanishLegend] = fromQrText("es-ES");
      expect(Buffer.from(qr!.bytes), locale).toEqual(Buffer.from(spanishQr!.bytes));
      expect(Buffer.from(legend!.bytes), locale).toEqual(Buffer.from(spanishLegend!.bytes));
      expect(legend?.text?.trim()).toBe("VERI*FACTU");
    }
  });
});

describe("a receipt's goods names can be looked up in another language than its fixed words", () => {
  // A reprint in another language keeps the names the sale was filed with: every translated name below
  // differs between the two languages, and each option name between its staff, customer and kitchen
  // wording, so a lookup in the wrong language or the wrong wording prints a name the assertions
  // refuse.
  const BILINGUAL: TillSaleResult = {
    ...FILED_SALE,
    total: "4.00",
    vatBreakdown: [{ rate: "10", base: "3.64", tax: "0.36" }],
    lines: [
      {
        descriptions: { "ca-ES": "Pa amb tomàquet", "es-ES": "Pan con tomate" },
        quantity: "2",
        gross: "3.50",
        parentLineNo: null,
        unitName: { ca: "unit.", es: "ud" },
        unitPrecision: 0,
        optionSnapshots: [
          {
            listName: { "ca-ES": "Pa", "es-ES": "Pan" },
            listCustomerName: { "ca-ES": "Tipus de pa", "es-ES": "Tipo de pan" },
            listKitchenName: "Cocina pan",
            labelName: { "ca-ES": "Integral de sègol", "es-ES": "Integral de centeno" },
            labelCustomerName: { "ca-ES": "Sègol sencer", "es-ES": "Centeno entero" },
            labelKitchenName: "Cocina centeno",
          },
        ],
      },
      {
        descriptions: { "ca-ES": "Pernil extra", "es-ES": "Jamón extra" },
        quantity: "2",
        gross: "0.50",
        parentLineNo: 1,
      },
    ],
    tender: { method: "cash", change: "0.00" },
  };

  it("prints Catalan fixed words with the Spanish names when the names' language is Spanish", () => {
    const text = printedLines(
      formatReceipt({
        result: BILINGUAL,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "ca-ES",
        namesLocale: "es-ES",
        printer: PRINTER_80,
      }),
    )
      .map((line) => line.trim().replace(/\s+/g, " "))
      .join("\n");
    expect(text).toContain("Data ");
    expect(text).toContain("Efectiu 4,00 €");
    expect(text).toMatch(/2 ud Pan con tomate 3,50 €/u);
    expect(text).toContain("Tipo de pan: Centeno entero");
    expect(text).toContain("Jamón extra 0,50 €");
    for (const other of [
      "Pa amb tomàquet",
      "unit.",
      "Tipus de pa",
      "Sègol sencer",
      "Integral",
      "Cocina",
      "Pernil extra",
    ]) {
      expect(text).not.toContain(other);
    }
    expect(text).not.toContain("Fecha");
  });

  it("looks the names up in the fixed words' language when no names' language is given", () => {
    const text = printedLines(
      formatReceipt({
        result: BILINGUAL,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "ca-ES",
        printer: PRINTER_80,
      }),
    )
      .map((line) => line.trim().replace(/\s+/g, " "))
      .join("\n");
    expect(text).toMatch(/2 unit\. Pa amb tomàquet 3,50 €/u);
    expect(text).toContain("Tipus de pa: Sègol sencer");
    expect(text).toContain("Pernil extra 0,50 €");
  });
});

describe("the top block is centred: logo, names, slogan, address, phone, email, NIF (W111)", () => {
  const ADDRESS = ["Calle Mayor 1", "28013 Madrid"] as const;
  const FULL_TRIM: ReceiptTrim = {
    ...TRIM,
    phone: "912 345 678",
    email: "hola@labuena.es",
  };

  /** A logo as tall and as wide as the paper allows, with a pattern a text band never has. */
  function logoFor(printer: EscSetting): MonoRaster {
    const widthDots = safeWidthDots(printer.paperWidth);
    const heightDots = LOGO_MAX_HEIGHT_DOTS;
    return {
      widthDots,
      heightDots,
      bits: new Uint8Array(Math.ceil(widthDots / 8) * heightDots).fill(0xa5),
    };
  }

  /** Each image from the QR on: a drawn line of text as what it reads, any other as its size. */
  function afterQr(bytes: Uint8Array): string[] {
    return fromQr(bytes)
      .filter((c) => c.name === "GS v 0")
      .slice(1)
      .map((c) => c.text ?? `<${c.widthDots}×${c.heightDots}>`);
  }

  it.each([PRINTER_58, PRINTER_80])(
    "prints the block in its order, every line centred, after the QR block on $paperWidth",
    (printer) => {
      const logo = logoFor(printer);
      const lines = afterQr(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receiptHeader: { tradingName: "Bar La Buena", printTradingName: true },
          receipt: FULL_TRIM,
          venueAddress: ADDRESS,
          logo,
          invoiceLocale: "es-ES",
          printer,
          duplicate: true,
        }),
      );
      expect(lines.slice(0, 15)).toEqual([
        centred(printer, "VERI*FACTU"),
        "",
        `<${logo.widthDots}×${logo.heightDots}>`,
        centred(printer, "Bar La Buena"),
        centred(printer, TRIM.headerSubtitle!),
        centred(printer, ISSUER.venueName),
        centred(printer, "Calle Mayor 1"),
        centred(printer, "28013 Madrid"),
        centred(printer, "Tel. 912 345 678"),
        centred(printer, "hola@labuena.es"),
        centred(printer, "DUPLICADO"),
        centred(printer, "NIF: B12345678"),
        "",
        "Mesa 6 · Pedido 41",
        expect.stringMatching(/^Factura +A\/1$/u),
      ]);
    },
  );

  it.each([PRINTER_58, PRINTER_80])(
    "turns centring on before the logo and back off before the order line on $paperWidth",
    (printer) => {
      const logo = logoFor(printer);
      const commands = fromQr(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: FULL_TRIM,
          logo,
          invoiceLocale: "es-ES",
          printer,
        }),
      );
      const logoAt = commands.findIndex(
        (c) => c.widthDots === logo.widthDots && c.text === undefined,
      );
      expect(logoAt).toBeGreaterThan(0);
      const lastAlignBeforeLogo = commands
        .slice(0, logoAt)
        .filter((c) => c.name === "ESC a")
        .at(-1);
      expect([...lastAlignBeforeLogo!.bytes]).toEqual([0x1b, 0x61, 1]);
      expect(Buffer.from(commands[logoAt]!.bytes)).toEqual(Buffer.from(esc().bitmap(logo).bytes()));
      const nifAt = commands.findIndex((c) => c.text?.trim() === "NIF: B12345678");
      const orderAt = commands.findIndex((c) => c.text === "Mesa 6 · Pedido 41");
      const aligns = commands.slice(nifAt, orderAt).filter((c) => c.name === "ESC a");
      expect(aligns.map((c) => [...c.bytes])).toEqual([[0x1b, 0x61, 0]]);
    },
  );

  it("prints the logo first, centred, on a sale with no QR", () => {
    const logo = logoFor(PRINTER_80);
    const commands = printedCommands(
      formatReceipt({
        result: NO_QR_SALE,
        issuer: ISSUER,
        receipt: {},
        logo,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    ).filter((c) => c.name === "ESC a" || c.name === "GS v 0");
    expect([...commands[0]!.bytes]).toEqual([0x1b, 0x61, 1]);
    expect(commands[1]).toMatchObject({ widthDots: logo.widthDots, heightDots: logo.heightDots });
    expect(commands[1]!.text).toBeUndefined();
    expect(commands[2]!.text).toBe(centred(PRINTER_80, ISSUER.venueName));
  });

  it.each([
    { name: "nothing", receipt: {}, venueAddress: undefined, logo: undefined, extra: [] },
    {
      name: "a null logo and no address lines",
      receipt: {},
      venueAddress: [],
      logo: null,
      extra: [],
    },
    { name: "a phone", receipt: { phone: "912 345 678" }, extra: ["Tel. 912 345 678"] },
    { name: "an email", receipt: { email: "hola@labuena.es" }, extra: ["hola@labuena.es"] },
    {
      name: "a slogan",
      receipt: { headerSubtitle: "Desde 1952" },
      extra: [],
      before: ["Desde 1952"],
    },
    { name: "an address", receipt: {}, venueAddress: ["Calle Mayor 1"], extra: ["Calle Mayor 1"] },
  ])(
    "prints only the lines that are set: $name",
    ({ receipt, venueAddress, logo, extra, before }) => {
      const lines = afterQr(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt,
          ...(venueAddress === undefined ? {} : { venueAddress }),
          ...(logo === undefined ? {} : { logo }),
          invoiceLocale: "es-ES",
          printer: PRINTER_80,
        }),
      );
      const block = [...(before ?? []), ISSUER.venueName, ...extra, "NIF: B12345678"].map((s) =>
        centred(PRINTER_80, s),
      );
      expect(lines.slice(0, block.length + 4)).toEqual([
        centred(PRINTER_80, "VERI*FACTU"),
        "",
        ...block,
        "",
        "Mesa 6 · Pedido 41",
      ]);
    },
  );

  it("wraps a long address line like other text, each part centred and no word lost", () => {
    const long = "Polígono Industrial Las Mercedes, Nave 14, Calle de la Fundición 27";
    const lines = afterQr(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        venueAddress: [long],
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    const start = lines.indexOf(centred(PRINTER_58, ISSUER.venueName)) + 1;
    const end = lines.indexOf(centred(PRINTER_58, "NIF: B12345678"));
    const parts = lines.slice(start, end);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part).toBe(centred(PRINTER_58, part.trim()));
    expect(parts.map((part) => part.trim()).join(" ")).toBe(long);
  });

  it("keeps the goods, the VAT breakdown and the total in left-aligned columns", () => {
    const lines = afterQr(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: FULL_TRIM,
        venueAddress: ADDRESS,
        logo: logoFor(PRINTER_80),
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    const { columns } = textGrid(PRINTER_80.paperWidth, PRINTER_80.resolution);
    for (const start of ["1  Menú del día", "2  Agua mineral", "Base 21%", "IVA 10%", "TOTAL"]) {
      const line = lines.find((l) => l.startsWith(start));
      expect(line, start).toBeDefined();
      expect(line!.length, start).toBe(columns);
    }
  });

  it.each([PRINTER_58, PRINTER_80])(
    "centres the footer message, then returns to the left on $paperWidth",
    (printer) => {
      const commands = printedCommands(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: TRIM,
          invoiceLocale: "es-ES",
          printer,
        }),
      );
      const footerAt = commands.findIndex((c) => c.text?.trim() === TRIM.footerMessage);
      expect(commands[footerAt]!.text).toBe(centred(printer, TRIM.footerMessage!));
      const aligns = (from: typeof commands) =>
        from.filter((c) => c.name === "ESC a").map((c) => [...c.bytes]);
      expect(aligns(commands.slice(0, footerAt)).at(-1)).toEqual([0x1b, 0x61, 1]);
      expect(aligns(commands.slice(footerAt + 1))).toEqual([[0x1b, 0x61, 0]]);
    },
  );

  it("keeps the practice warning at the tear-off end left-aligned after a centred footer", () => {
    const lines = drawn(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
        simulated: true,
      }),
    );
    expect(lines.slice(-3)).toEqual([
      centred(PRINTER_80, TRIM.footerMessage!),
      "",
      "PRUEBA - SIN COBRO REAL",
    ]);
  });

  it.each(["es-ES", "ca-ES", "gl-ES", "eu-ES"])(
    "prints the phone under the receipt language's label in %s",
    (invoiceLocale) => {
      const lines = afterQr(
        formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: { phone: "912 345 678" },
          invoiceLocale,
          printer: PRINTER_80,
        }),
      );
      expect(lines).toContain(centred(PRINTER_80, "Tel. 912 345 678"));
    },
  );
});

describe("relative variant names on paper", () => {
  it.each([PRINTER_58, PRINTER_80])(
    "wraps a complete frozen customer pair on $paperWidth",
    (printer) => {
      const descriptions = joinCustomerPresentationText(
        { "es-ES": "Seagrams Gin reserva especial de la casa" },
        { "es-ES": "Single con hielo y rodaja de lima" },
        "Single",
      );
      const lines = printedLines(
        formatReceipt({
          result: {
            ...FILED_WITHOUT_TEXT,
            lines: FILED_WITHOUT_TEXT.lines.map((line, index) =>
              index === 0 ? { ...line, descriptions } : line,
            ),
          },
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer,
        }),
      );
      for (const line of lines)
        expect(line.length, line).toBeLessThanOrEqual(columnsFor(printer.paperWidth));
      expect(lines.map((line) => line.trim()).join(" ")).toContain(
        "Seagrams Gin reserva especial de la casa (Single con hielo y rodaja de lima)",
      );
    },
  );
});
