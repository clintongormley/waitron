import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";
import type { TicketIssuer } from "./till-ticket-view.js";
import type { TillProduct, TillSaleResult } from "../api/client.js";
import type { OrderLine } from "../state/working-order.js";

// es-ES currency formatting separates the amount and € with a non-breaking space (U+00A0, or a
// narrow no-break U+202F on some ICU builds); normalise both to a plain space before asserting.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

const cafe: TillProduct = {
  id: "p1",
  descriptions: { "es-ES": "Café", en: "Coffee" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};
const jamon: TillProduct = {
  id: "p2",
  descriptions: { "es-ES": "Jamón", en: "Ham" },
  pricingUnit: "weight",
  unitPrice: "20.00",
  vatClass: "reduced",
  category: null,
};

// A mixed-rate basket with a weighed line: café 2 × 1,50 = 3,00 (21 %), jamón 0,320 kg × 20 = 6,40
// (10 %). Total 9,40; €10 cash tendered → 0,60 change.
const lines: OrderLine[] = [
  { product: cafe, quantity: "2" },
  { product: jamon, quantity: "0.320" },
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
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=05-08-2026&importe=9.40",
};

const issuer: TicketIssuer = { venueName: "Deli Delicioso SL", nif: "B12345678" };

const mount = (over: Partial<TillSaleResult> = {}) =>
  mountWidget<TillTicketView>("till-ticket-view", {
    result: { ...result, ...over },
    issuer,
    lines,
    // The receipt renders in its INVOICE locale prop (fed from server config), never the operator UI.
    // Pin it explicitly so the "operator UI is English, ticket stays Spanish" test is unambiguous.
    invoiceLocale: "es-ES",
  });

const text = (el: TillTicketView): string => norm(el.shadowRoot!.textContent ?? "");

// setLocale mutates module-level state; put the shipped default back for the other suites.
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("till-ticket-view", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-ticket-view")).toBe(TillTicketView);
  });

  it("prints the issuer venue name and NIF (RD 1619/2012 art. 7.1.d)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Deli Delicioso SL");
    expect(t).toContain("NIF");
    expect(t).toContain("B12345678");
  });

  it("prints the invoice number + series and the formatted issue date (art. 7.1.a, 7.1.b)", async () => {
    const { el } = await mount();
    const expectedDate = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(result.issuedAt));
    expect(text(el)).toContain("A/1");
    expect(text(el)).toContain(norm(expectedDate));
  });

  it("identifies each good: name (invoice locale), quantity and per-line gross (art. 7.1.e)", async () => {
    const { el } = await mount();
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Café");
    expect(rows[0]!.textContent).toContain("2");
    expect(norm(rows[0]!.textContent!)).toContain("3,00 €");
    expect(rows[1]!.textContent).toContain("Jamón");
    expect(rows[1]!.textContent).toContain("0.320 kg"); // weighed line shows kg
    expect(norm(rows[1]!.textContent!)).toContain("6,40 €");
  });

  it("shows the taxable base per rate, plus the (allowed extra) cuota per rate (art. 7.1.f)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Base 21.00%");
    expect(t).toContain("2,48 €"); // base at 21 %
    expect(t).toContain("Base 10.00%");
    expect(t).toContain("5,82 €"); // base at 10 %
    expect(t).toContain("IVA 21.00%");
    expect(t).toContain("0,52 €"); // cuota at 21 %
    expect(t).toContain("IVA 10.00%");
    expect(t).toContain("0,58 €"); // cuota at 10 %
  });

  it("shows the total and the operational efectivo/cambio lines (art. 7.1.g + allowed extras)", async () => {
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("TOTAL");
    expect(t).toContain("9,40 €");
    expect(t).toContain("Efectivo");
    expect(t).toContain("10,00 €"); // tendered = total + change
    expect(t).toContain("Cambio");
    expect(t).toContain("0,60 €");
  });

  it("renders the QR from the verification URL and the VERI*FACTU legend", async () => {
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
    expect(text(el)).toContain("VERI*FACTU");
  });

  it("prints the legend but no QR when the verification URL is empty", async () => {
    const { el } = await mount({ qr: "" });
    expect(el.shadowRoot!.querySelector("svg")).toBeNull();
    expect(text(el)).toContain("VERI*FACTU");
  });

  it("emits a composed new-sale event when New sale is pressed", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("new-sale", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.new-sale")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
  });

  it("renders the fiscal labels in the INVOICE locale (Spanish) even when the operator UI is English", async () => {
    // The receipt is a legal document issued in Spain: its labels are the invoice locale's, NOT the
    // operator's UI language. An English-speaking operator still hands over a Spanish ticket.
    setLocale("en");
    const { el } = await mount();
    const t = text(el);
    expect(t).toContain("Efectivo"); // es — the operator-UI word would be "Cash"
    expect(t).toContain("Cambio"); // es — the operator-UI word would be "Change"
    expect(t).toContain("Café"); // product name in the invoice locale, not "Coffee"
    expect(t).not.toContain("Cash");
    expect(t).not.toContain("Change");
    expect(t).not.toContain("Coffee");
  });
});
