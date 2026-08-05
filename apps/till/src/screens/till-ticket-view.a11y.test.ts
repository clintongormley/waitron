import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-ticket-view.js";
import type { TicketIssuer, TillTicketView } from "./till-ticket-view.js";
import type { TillProduct, TillSaleResult } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";

const lines: OrderLine[] = [
  {
    product: {
      id: "p1",
      descriptions: { "es-ES": "Café" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
    } satisfies TillProduct,
    quantity: "2",
  },
  {
    product: {
      id: "p2",
      descriptions: { "es-ES": "Jamón" },
      pricingUnit: "weight",
      unitPrice: "20.00",
      vatClass: "reduced",
      category: null,
    } satisfies TillProduct,
    quantity: "0.320",
  },
];

const result: TillSaleResult = {
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
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
      { result, issuer, lines },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when the verification URL is empty (no QR)", async () => {
    const { host } = await mountWidget<TillTicketView>(
      "till-ticket-view",
      { result: { ...result, qr: "" }, issuer, lines },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
