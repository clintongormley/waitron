import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";
import type { TillSaleResult } from "../api/client.js";

afterEach(cleanupWidgets);
describe("customer ticket metadata boundary", () => {
  it("renders the customer invoice without operational instructions", async () => {
    const result = {
      orderLabel: null,
      orderNumber: 7,
      kitchenNote: "KITCHEN-ONLY train at 14:30",
      receiptTrim: {},
      venueAddress: [],
      receiptSettings: { printAddress: false },
      invoiceNumber: "A/1",
      issuedAt: "2026-10-15T12:00:00Z",
      total: "12.00",
      vatBreakdown: [{ rate: "10", base: "10.91", tax: "1.09" }],
      lines: [{ descriptions: { "en-GB": "House burger" }, quantity: "1", gross: "12.00" }],
      tender: { method: "cash", change: "0.00" },
      qr: "",
    } satisfies TillSaleResult & { kitchenNote: string };
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result,
      issuer: { venueName: "House Restaurant", nif: "B12345674" },
      invoiceLocale: "en-GB",
    });
    expect(el.shadowRoot!.textContent).toContain("House burger");
    expect(el.shadowRoot!.textContent).toContain("A/1");
    expect(el.shadowRoot!.textContent).not.toContain("KITCHEN-ONLY");
  });
});
