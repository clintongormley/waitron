import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-ticket-view.js";
import type { TicketIssuer, TillTicketView } from "./till-ticket-view.js";
import type { TillSaleResult } from "../api/client.js";

const result: TillSaleResult = {
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
  ],
  // The FILED line list the receipt renders (server's `TillSaleResult.lines`), not a client basket.
  // "Jamón" carries a selected option (ordering modifiers, Task 14) — the indented `.option` row is
  // swept here for both themes alongside the plain "Café" line.
  lines: [
    { descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" },
    { descriptions: { "es-ES": "Jamón" }, quantity: "0.32", gross: "6.40", parentLineNo: null },
    { descriptions: { "es-ES": "Extra queso" }, quantity: "1", gross: "0.50", parentLineNo: 2 },
  ],
  change: "0.60",
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1",
};

const issuer: TicketIssuer = { venueName: "Deli Delicioso SL", nif: "B12345678" };

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-ticket-view a11y (%s theme)", (theme) => {
  it("has no violations on the filed ticket with a QR", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      { result, issuer },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when the verification URL is empty (no QR)", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      { result: { ...result, qr: "" }, issuer },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the non-fiscal receipt trim rendered (header subtitle + footer message)", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      {
        result,
        issuer,
        receipt: {
          headerSubtitle: "Calle Mayor 1, Madrid",
          footerMessage: "Gracias por su visita",
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
