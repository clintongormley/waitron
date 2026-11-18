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
      receiptPreview: [
        { kind: "amount", caption: "A/1", amount: "15 Oct 2026", indent: 0 },
        { kind: "amount", caption: "House burger", amount: "12.00", indent: 0 },
      ],
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
      invoiceLocale: "en-GB",
    });
    expect(el.shadowRoot!.textContent).toContain("House burger");
    expect(el.shadowRoot!.textContent).toContain("A/1");
    expect(el.shadowRoot!.textContent).not.toContain("KITCHEN-ONLY");
  });
});
