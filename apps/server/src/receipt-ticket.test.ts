import { esc } from "@waitron/printing";
import { describe, expect, it } from "vitest";

import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptIssuer, ReceiptTrim } from "./receipt-ticket.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import type { TillSaleResult } from "./till-sale.js";

// `formatReceipt` is a PURE byte producer (design §3b) — no DB, no container, no fiscal state — so
// these are ordinary unit tests. We decode the ESC/POS payload back to its Latin-1 text (the encoding
// `escpos.ts` uses, pinned in `escpos.test.ts`) via the shared `decodeTicket` helper to assert the
// human-readable content, and inspect the raw bytes for the native QR command and the tail cut.
//
// This is the LOAD-BEARING test of the slice (spec §4/§7): the printed paper is a factura simplificada,
// a legal document, so the completeness test proves the paper carries EVERY mandated art. 7.1 /
// arts. 20-21 element — never fewer than the on-screen receipt. Non-suppression of a mandated element
// is proven BY DELETION in the implementation (see the task report): commenting out the legend line, or
// the VAT-breakdown loop, turns the relevant assertions RED.

/** GS V 0 (full cut) — the final three bytes of every ticket (`escpos.ts` / `escpos.test.ts`). */
const CUT_BYTES = [0x1d, 0x56, 0x00];
/** GS ( k — the lead bytes of the native two-dimensional-symbol (QR) command family (`escpos.ts`). */
const QR_LEAD_BYTES = Uint8Array.from([0x1d, 0x28, 0x6b]);

/**
 * A realistic filed sale: multi-line, two VAT rates, a non-empty cotejo `qr`. The figures are exact
 * and self-consistent — Σ(line.gross) === total, Σ(base + tax) === total, and total + change === the
 * cash tendered — so every printed amount can be asserted by its digit portion.
 */
const FILED_SALE: TillSaleResult = {
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
  change: "9.10",
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

/** True iff `needle` occurs as a contiguous subsequence of `haystack`. */
function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("formatReceipt — the faithful, legally-complete customer receipt", () => {
  it("reproduces every mandated art. 7.1 / arts. 20-21 element of a filed receipt", () => {
    const bytes = formatReceipt({
      result: FILED_SALE,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
    });
    const s = decodeTicket(bytes);

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

    // Amounts render in the invoice locale (es-ES → comma decimals). Assert the digit portions ONLY:
    // the €-symbol and its NBSP/NNBSP separator do NOT survive the Latin-1 round-trip the decoder does,
    // and the separator differs between ICU builds — see `formatMoney`'s note.
    expect(s).toContain("12,10"); // line 1 gross
    expect(s).toContain("8,80"); // line 2 gross
    expect(s).toContain("10,00"); // base 21%
    // IVA 21% cuota — pinned on the SAME rendered line as its label (lines are LF-separated). A bare
    // `toContain("2,10")` would be satisfied by the "2,10" inside line-1 gross "12,10" (asserted above,
    // a different/earlier line), so it would pass even with the 21% cuota suppressed; requiring the
    // label and the amount on one line closes that hole while still failing if the cuota is removed.
    expect(s).toMatch(/IVA 21%[^\n]*2,10/u); // IVA 21% cuota
    expect(s).toContain("8,00"); // base 10%
    expect(s).toContain("0,80"); // IVA 10%
    expect(s).toContain("20,90"); // TOTAL
    expect(s).toContain("30,00"); // Efectivo = total + change
    expect(s).toContain("9,10"); // Cambio

    // The QR (§3a, arts. 20-21): the exact native GS ( k byte sequence Task 3's builder emits for this
    // payload must appear verbatim in the receipt bytes.
    expect(bytesInclude(bytes, esc().qr(FILED_SALE.qr).bytes())).toBe(true);
  });

  it("emits the mandated elements in the art. 7.1 order", () => {
    const s = decodeTicket(
      formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: TRIM, invoiceLocale: "es-ES" }),
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
      formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: TRIM, invoiceLocale: "es-ES" }),
    );
    expect(s).toContain(TRIM.headerSubtitle!);
    expect(s).toContain(TRIM.footerMessage!);
  });

  it("omits the header subtitle and footer message when the trim is empty, keeping the core", () => {
    const s = decodeTicket(
      formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES" }),
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
    });
    // No native QR command is emitted (mirrors `qrSvg("") === ""` on the screen)...
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
      formatReceipt({ result, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES" }),
    );
    // The es-ES-less line degrades to its only description; the empty-map line prints nothing but does
    // not throw (a catalogue defect must never block the paper — spec §4).
    expect(s).toContain("Fallback only");
    expect(s).toContain("VERI*FACTU");
  });

  it("ends in the full-cut command", () => {
    const bytes = formatReceipt({
      result: FILED_SALE,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES",
    });
    expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
  });

  it("normalises the amount/€ separator to an ASCII space (0x20), not NBSP/NNBSP", () => {
    // `Intl.NumberFormat("es-ES", …)` separates the amount and the € with a NON-BREAKING space —
    // U+00A0, or a narrow no-break space U+202F on some ICU builds. The Latin-1 ESC/POS encoder maps
    // each character to its low byte, so U+00A0 → 0xA0 and U+202F → 0x2F (a `/`), the latter printing a
    // customer total as `20,90/€`-garble. `formatMoney` normalises that separator to an ASCII space, so
    // the printed total reads `20,90 €` on any ICU build. Proven by DELETION: drop the `.replace(...)`
    // in `formatMoney` and this test goes RED (`20,90/…` or `20,90 …`).
    const s = decodeTicket(
      formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: TRIM, invoiceLocale: "es-ES" }),
    );
    // No non-break space survives to the decoded text (neither the wide NBSP nor the narrow one — the
    // narrow one is what mangles to `/`, so its raw form is already gone; the wide one decodes 1:1).
    expect(s).not.toMatch(/[\u00a0\u202f]/u);
    // The character right after the TOTAL amount is a plain ASCII space (0x20), never `/` or U+00A0.
    const idx = s.indexOf("20,90");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(s[idx + "20,90".length]).toBe(" ");
  });
});
