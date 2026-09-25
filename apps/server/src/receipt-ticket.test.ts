import { FEED_BEFORE_CUT, columnsFor, esc, withQuietZone } from "@waitron/printing";
import { compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { describe, expect, it } from "vitest";

import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptIssuer, ReceiptPrinterSettings, ReceiptTrim } from "./receipt-ticket.js";
import { qrModules } from "./qr-matrix.js";
import { bytesInclude, decodeTicket, printedLines } from "./testing/decode-ticket.js";
import type { TillSaleResult } from "./till-sale.js";

// `formatReceipt` is pure, so these are unit tests. `printedLines` decodes each byte through the
// character-set table the job selects (the layout tests); `decodeTicket` decodes byte-exact Latin-1
// (the byte-level assertions).
//
// The printed paper is a factura simplificada, a legal document: the completeness test pins that it
// carries every mandated art. 7.1 / arts. 20-21 element, never fewer than the on-screen receipt.

/** GS V 0 (full cut) — the final three bytes of every ticket (`escpos.ts` / `escpos.test.ts`). */
const CUT_BYTES = [0x1d, 0x56, 0x00];
/** ESC d n — the shared feed before every cut (`FEED_BEFORE_CUT`), so the tear-off clears the head. */
const FEED_THEN_CUT = [0x1b, 0x64, FEED_BEFORE_CUT, ...CUT_BYTES];
/** GS ( k — the lead bytes of the native two-dimensional-symbol (QR) command family (`escpos.ts`). */
const QR_LEAD_BYTES = Uint8Array.from([0x1d, 0x28, 0x6b]);
/** GS v 0 with m = 0 — the lead bytes of a raster image (`escpos.ts` `qrRaster`). */
const RASTER_LEAD_BYTES = Uint8Array.from([0x1d, 0x76, 0x30, 0x00]);

const PRINTER_80: ReceiptPrinterSettings = {
  paperWidth: "80mm",
  resolution: "180dpi",
  characterSet: "wpc1252",
  characterTable: 16,
};
const PRINTER_58: ReceiptPrinterSettings = {
  paperWidth: "58mm",
  resolution: "180dpi",
  characterSet: "pc858",
  characterTable: 19,
};

/**
 * A realistic filed sale: multi-line, two VAT rates, a non-empty cotejo `qr`. The figures are exact
 * and self-consistent — Σ(line.gross) === total, Σ(base + tax) === total, and total + change === the
 * cash tendered — so every printed amount can be asserted by its digit portion.
 */
const FILED_SALE: TillSaleResult = {
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

const ISSUER: ReceiptIssuer = { venueName: "Charcutería La Buena", nif: "B12345678" };
const TRIM: ReceiptTrim = {
  headerSubtitle: "Calle Mayor 1, Madrid",
  footerMessage: "¡Gracias por su visita!",
};

/** Resolve a line's goods name the way the receipt does — invoice locale, then any description. */
function lineName(line: TillSaleResult["lines"][number]): string {
  return line.descriptions["es-ES"] ?? Object.values(line.descriptions)[0] ?? "";
}

describe("formatReceipt — the faithful, legally-complete customer receipt", () => {
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

      // The Veri*Factu legend — a FIXED legal string, always printed (Orden HAC/1177/2024 art. 20.1.b).
      expect(s).toContain("VERI*FACTU");

      // Digits only: the € glyph and the amount/€ separator vary by character set and ICU build.
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
      ISSUER.venueName,
      TRIM.headerSubtitle!,
      `NIF: ${ISSUER.nif}`,
      FILED_SALE.invoiceNumber,
      "Fecha",
      lineName(FILED_SALE.lines[0]!),
      "Base 21%",
      "TOTAL",
      "Efectivo",
      "VERI*FACTU",
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

  it("prints no QR command when the regime minted none, but still prints the legend", () => {
    const bytes = formatReceipt({
      result: { ...FILED_SALE, qr: "" },
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
      printer: PRINTER_80,
    });
    // No QR image or native QR command is emitted (mirrors `qrSvg("") === ""` on the screen)...
    expect(bytesInclude(bytes, RASTER_LEAD_BYTES)).toBe(false);
    expect(bytesInclude(bytes, QR_LEAD_BYTES)).toBe(false);
    // ...but the legend is unconditional in Veri*Factu mode (art. 20.1.b).
    expect(decodeTicket(bytes)).toContain("VERI*FACTU");
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

  it("groups modifier lines under their dish — dish at its price, options indented at their delta, and the lines reconcile with the filed desglose", () => {
    // The dish is a PARENT line and each option a CHILD line pointing at it, each a filed sale
    // line. Σ(line.gross) === total and Σ(base + tax) === total: the receipt groups the filed lines
    // and never recomputes a fiscal figure.
    const withOptions: TillSaleResult = {
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
    // The "×N" badge appears only when the PER-DISH count is above 1.
    const withPerOptionQty: TillSaleResult = {
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
        // An option taken ×2 per dish → filed at the COMBINED quantity 6 (3 dishes × 2). Per-dish = 2 →
        // badged "×2". Its gross is the FILED delta, unchanged by the badge.
        { descriptions: { "es-ES": "Extra queso" }, quantity: "6", gross: "1.50", parentLineNo: 1 },
        // A plain option taken once per dish → filed at quantity 3 (== dish quantity). Per-dish = 1
        // → NO badge.
        { descriptions: { "es-ES": "Sin cebolla" }, quantity: "3", gross: "0.00", parentLineNo: 1 },
      ],
      tender: { method: "cash", change: "0.00" },
      qr: FILED_SALE.qr,
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

    // The ×2 option: an indented line carrying the "×2" badge after the name, its filed gross unchanged.
    expect(s).toMatch(/\n {2,}Extra queso ×2[^\n]*1,50/u);
    // The plain option: NO badge — name, padding, then the gross.
    expect(s).toMatch(/\n {2,}Sin cebolla {2,}0,00/u);
    expect(s).not.toContain("Sin cebolla ×");

    // Without the badge the ×2 line would read like the control.
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

  it("normalises the amount/€ separator to an ASCII space (0x20), not NBSP/NNBSP", () => {
    // `Intl.NumberFormat("es-ES")` separates amount and € with a no-break space (U+00A0 or U+202F),
    // and this printer's wpc1252 table can encode U+00A0, so `prepareText` keeps it; `formatMoney`
    // must rewrite it.
    const s = decodeTicket(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer: PRINTER_80,
      }),
    );
    // No non-break space survives to the decoded text (neither U+00A0 nor U+202F): the byte-exact
    // decode reads byte 0xA0 back as U+00A0, so a separator left in place by `formatMoney` is caught.
    expect(s).not.toMatch(/[\u00a0\u202f]/u);
    // The character right after the TOTAL amount is a plain ASCII space (0x20), never `/` or U+00A0.
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
  expect(Buffer.from(duplicate).toString("latin1").replace("DUPLICADO\n", "")).toBe(
    Buffer.from(original).toString("latin1"),
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
    { paperWidth: "58mm", resolution: "203dpi", characterSet: "plain", characterTable: 0 } as const,
    {
      paperWidth: "80mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 19,
    } as const,
  ])("keeps every printed line within the column count ($paperWidth, $characterSet)", (printer) => {
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

  it("measures the euro sign after conversion: EUR takes three columns in plain letters", () => {
    const lines = printedLines(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: {
          paperWidth: "58mm",
          resolution: "180dpi",
          characterSet: "plain",
          characterTable: 0,
        },
      }),
    );
    expect(lines).toContain(`TOTAL${" ".repeat(16)}20,90 EUR`);
    expect(lines).toContain(`Base 21%${" ".repeat(13)}10,00 EUR`);
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
          printer: { paperWidth, resolution, characterSet: "wpc1252", characterTable: 16 },
        });
        expect(bytesInclude(bytes, QR_LEAD_BYTES)).toBe(false);
        const at = bytes.findIndex((_, i) => RASTER_LEAD_BYTES.every((v, j) => bytes[i + j] === v));
        expect(at).toBeGreaterThan(0);
        // GS v 0 m xL xH yL yH: x is bytes per row, y is the height in dots.
        expect(bytes[at + 4]! + 256 * bytes[at + 5]!).toBe(widthBytes);
        expect(bytes[at + 6]! + 256 * bytes[at + 7]!).toBe(heightDots);
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
