import { afterEach, describe, expect, it } from "vitest";
import type { ReceiptPresentation } from "@waitron/shared";
import type { TillSaleResult } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";

const issuer = { venueName: "Filed Legal SL", nif: "B12345678", domicile: "Filed Fiscal Street" };
const facts: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  venueReceiptSettings: {},
  invoiceNumber: "A/42",
  issuedAt: "2026-08-05T12:34:56.000Z",
  orderLabel: null,
  orderNumber: 42,
  total: "3.00",
  vatBreakdown: [{ rate: "10.00", base: "2.73", tax: "0.27" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "1", gross: "3.00" }],
  tender: { method: "cash", change: "2.00" },
  qr: "",
  issuer,
  locale: "es-ES",
};
const rich: ReceiptPresentation = {
  receiptTrim: {
    logo: `${"a".repeat(64)}.png`,
    headerSubtitle: "Terraza",
    phone: "910001111",
    email: "terraza@example.com",
    footerMessage: "Hasta pronto",
  },
  venueAddress: ["Current Street", "Madrid"],
  venueReceiptSettings: {},
};
const answer = (presentation: ReceiptPresentation): TillSaleResult & ReceiptPresentation => ({
  ...facts,
  ...presentation,
});
const header = (el: TillTicketView) =>
  [...el.shadowRoot!.querySelector(".issuer")!.children].map((node) =>
    node instanceof HTMLImageElement ? node.getAttribute("src") : node.textContent!.trim(),
  );
afterEach(cleanupWidgets);

describe("per-answer receipt presentation", () => {
  it("renders answer trim before filed legal identity and uses its current address", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: answer(rich),
      issuer,
    });
    expect(header(el)).toEqual([
      `/media/${rich.receiptTrim.logo}`,
      "Terraza",
      "Filed Legal SL",
      "Current Street",
      "Madrid",
      "Tel. 910001111",
      "terraza@example.com",
      "NIF: B12345678",
    ]);
    expect(el.shadowRoot!.querySelector(".footer-message")!.textContent).toBe("Hasta pronto");
  });

  it("replaces department details and clears every optional line on an empty next answer", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: answer(rich),
      issuer,
    });
    el.result = answer({
      receiptTrim: { headerSubtitle: "Comedor", footerMessage: "Gracias" },
      venueAddress: ["Edited Street"],
      venueReceiptSettings: {},
    });
    await el.updateComplete;
    expect(header(el)).toEqual(["Comedor", "Filed Legal SL", "Edited Street", "NIF: B12345678"]);
    expect(el.shadowRoot!.querySelector(".footer-message")!.textContent).toBe("Gracias");
    el.result = answer({ receiptTrim: {}, venueAddress: [], venueReceiptSettings: {} });
    await el.updateComplete;
    expect(header(el)).toEqual(["Filed Legal SL", "NIF: B12345678"]);
    expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("Terraza");
    expect(el.shadowRoot!.textContent).not.toContain("Comedor");
    expect(el.shadowRoot!.textContent).toContain("2,00");
  });

  it.each(["F1", "F2"] as const)(
    "global address switch hides current address for %s and preserves filed domicile",
    async (invoiceType) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...answer(rich), invoiceType, venueReceiptSettings: { printAddress: false } },
        issuer,
      });
      expect(el.shadowRoot!.textContent).not.toContain("Current Street");
      expect(el.shadowRoot!.textContent).not.toContain("Madrid");
      expect(el.shadowRoot!.querySelector(".domicile")?.textContent ?? null).toBe(
        invoiceType === "F1" ? "Filed Fiscal Street" : null,
      );
      expect(el.shadowRoot!.textContent).toContain("terraza@example.com");
    },
  );

  it("shows optional current address beside a distinct filed F1 domicile when enabled", async () => {
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
      result: { ...answer(rich), invoiceType: "F1" },
      issuer,
    });
    expect(header(el)).toEqual([
      "Factura completa",
      `/media/${rich.receiptTrim.logo}`,
      "Terraza",
      "Filed Legal SL",
      "Current Street",
      "Madrid",
      "Tel. 910001111",
      "terraza@example.com",
      "NIF: B12345678",
      "Filed Fiscal Street",
    ]);
  });
});
