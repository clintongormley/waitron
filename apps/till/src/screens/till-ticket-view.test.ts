import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";
import type { TicketIssuer } from "./till-ticket-view.js";
import type { TillSaleResult } from "../api/client.js";
import type { ReceiptConfig } from "../layout.js";

// es-ES currency formatting separates the amount and € with a non-breaking space (U+00A0, or a
// narrow no-break U+202F on some ICU builds); normalise both to a plain space before asserting.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

// The FILED line list as the server returns it (`TillSaleResult.lines`) — the receipt renders THESE,
// never a client basket. A mixed-rate ticket with a weighed line: café 2 → 3,00 (21 %), jamón 0,320 kg
// → 6,40 (10 %). Total 9,40; €10 cash tendered → 0,60 change. The weighed quantity arrives
// trailing-zero-trimmed ("0.32"): the filed record carries no unit of measure to append "kg".
const result: TillSaleResult = {
  invoiceNumber: "A/1",
  issuedAt: "2026-08-05T12:34:56.000Z",
  total: "9.40",
  vatBreakdown: [
    { rate: "21.00", base: "2.48", tax: "0.52" },
    { rate: "10.00", base: "5.82", tax: "0.58" },
  ],
  lines: [
    { descriptions: { "es-ES": "Café", en: "Coffee" }, quantity: "2", gross: "3.00" },
    { descriptions: { "es-ES": "Jamón", en: "Ham" }, quantity: "0.32", gross: "6.40" },
  ],
  change: "0.60",
  qr: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=05-08-2026&importe=9.40",
};

const issuer: TicketIssuer = { venueName: "Deli Delicioso SL", nif: "B12345678" };

const mount = (over: Partial<TillSaleResult> = {}, receipt?: ReceiptConfig) =>
  mountWidget<TillTicketView>("till-ticket-view", {
    result: { ...result, ...over },
    issuer,
    // The receipt renders in its INVOICE locale prop (fed from server config), never the operator UI.
    // Pin it explicitly so the "operator UI is English, ticket stays Spanish" test is unambiguous.
    invoiceLocale: "es-ES",
    // The non-fiscal trim (design §8) — omitted (undefined) by default so the fiscal-core tests above
    // exercise the receipt-less ticket; the trim suite below passes it explicitly.
    ...(receipt ? { receipt } : {}),
  });

const text = (el: TillTicketView): string => norm(el.shadowRoot!.textContent ?? "");

// setLocale mutates module-level state; put the shipped default (en-GB) back for the other suites.
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
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

  it("identifies each good from the FILED lines: name (invoice locale), quantity and per-line gross (art. 7.1.e)", async () => {
    // The rows come from `result.lines` (the server's filed composition), NOT a client basket — so the
    // printed line list is the invoiced one. Name resolves in the invoice locale, quantity is the filed
    // display string (weighed "0.32", no "kg" — the fiscal record has no unit of measure), gross is the
    // filed per-line total.
    const { el } = await mount();
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Café");
    expect(rows[0]!.textContent).toContain("2");
    expect(norm(rows[0]!.textContent!)).toContain("3,00 €");
    expect(rows[1]!.textContent).toContain("Jamón");
    expect(rows[1]!.textContent).toContain("0.32");
    expect(norm(rows[1]!.textContent!)).toContain("6,40 €");
  });

  it("renders the SERVER's filed lines, not any client basket — a diverging line list follows result.lines", async () => {
    // Finding 2, at the render seam: the receipt has no access to the client basket — it renders
    // whatever `result.lines` carries. Overriding `lines` to a DIFFERENT composition (a single "Agua"
    // line) proves the rows track the filed result, so a local basket edit can never diverge the printed
    // list from the invoice.
    const { el } = await mount({
      lines: [{ descriptions: { "es-ES": "Agua" }, quantity: "3", gross: "6.00" }],
    });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Agua");
    expect(rows[0]!.textContent).toContain("3");
    expect(norm(rows[0]!.textContent!)).toContain("6,00 €");
    expect(el.shadowRoot!.textContent).not.toContain("Café");
    expect(el.shadowRoot!.textContent).not.toContain("Jamón");
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

  it("emits a composed, bubbling reprint event when Reprint is pressed (no API call from the view)", async () => {
    // The view is PRESENTATIONAL: it dispatches the intent and never touches the API or the working-order
    // id (till-app owns both). The event must bubble + compose so the app shell's `@reprint` catches it.
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("reprint", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reprint]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("emits a composed, bubbling open-drawer event when Abrir cajón is pressed", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("open-drawer", (e) => (captured = e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=open-drawer]")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("labels the reprint + open-drawer buttons in the operator-UI locale, flipping with the UI language", async () => {
    // UNLIKE the fiscal ticket body (invoice-locale Spanish constants), these two OPERATOR actions read
    // the operator-UI `t()`, so they flip with the UI language — the i18n keys are English identifiers
    // (`action.reprint`/`action.open_drawer`), the values are localised copy. Set es-ES explicitly (the
    // shipped default is en-GB) to observe the Spanish side, then switch to English.
    setLocale("es-ES");
    const { el } = await mount();
    expect(el.shadowRoot!.querySelector("[data-test=reprint]")!.textContent).toContain(
      "Reimprimir",
    );
    expect(el.shadowRoot!.querySelector("[data-test=open-drawer]")!.textContent).toContain(
      "Abrir cajón",
    );
    setLocale("en");
    const { el: enEl } = await mount();
    expect(enEl.shadowRoot!.querySelector("[data-test=reprint]")!.textContent).toContain("Reprint");
    expect(enEl.shadowRoot!.querySelector("[data-test=open-drawer]")!.textContent).toContain(
      "Open drawer",
    );
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

  // -----------------------------------------------------------------------------------------------
  // Receipt trim (non-fiscal, design §8): the owner-authored headerSubtitle + footerMessage render
  // AROUND the immutable art. 7.1 core — under the venue name and under the VERI*FACTU legend — never
  // inside or reordering it. The fiscal-core-cannot-be-suppressed test is the load-bearing guard.
  // -----------------------------------------------------------------------------------------------
  describe("receipt trim (design §8)", () => {
    const following = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it("renders headerSubtitle under the venue name and footerMessage under the legend", async () => {
      const { el } = await mount(
        {},
        { headerSubtitle: "Calle Mayor 1, Madrid", footerMessage: "Gracias por su visita" },
      );
      const sub = el.shadowRoot!.querySelector(".header-subtitle");
      const foot = el.shadowRoot!.querySelector(".footer-message");
      expect(sub!.textContent).toContain("Calle Mayor 1, Madrid");
      expect(foot!.textContent).toContain("Gracias por su visita");
      // header-subtitle sits inside the issuer header, immediately after the venue name.
      const venue = el.shadowRoot!.querySelector(".issuer .venue")!;
      expect(el.shadowRoot!.querySelector(".issuer .header-subtitle")).not.toBeNull();
      expect(following(venue, sub!)).toBe(true);
      // footer-message follows the legend in document order.
      const legend = el.shadowRoot!.querySelector(".legend")!;
      expect(following(legend, foot!)).toBe(true);
    });

    it("renders neither slot (no empty node) when the receipt config is absent", async () => {
      const { el } = await mount(); // no receipt prop
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    });

    it("renders neither slot when the receipt config is empty ({})", async () => {
      const { el } = await mount({}, {});
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    });

    it("renders only the field that is present (footer only)", async () => {
      const { el } = await mount({}, { footerMessage: "Wifi: DELI-2026" });
      expect(el.shadowRoot!.querySelector(".header-subtitle")).toBeNull();
      expect(el.shadowRoot!.querySelector(".footer-message")!.textContent).toContain(
        "Wifi: DELI-2026",
      );
    });

    it("FISCAL-SAFETY: a receipt config cannot suppress or reorder any mandated art. 7.1 element, the QR or the legend", async () => {
      // The load-bearing guard (design §8): the trim only ADDS content in its two designated slots; the
      // whole immutable core must still render, in its fixed positions, even WITH both trim fields set.
      // A future editor extension that let ReceiptConfig remove or reorder a mandated element fails here.
      const { el } = await mount({}, { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias" });
      const t = text(el);
      // 7.1.d issuer venue + NIF
      expect(t).toContain("Deli Delicioso SL");
      expect(t).toContain("NIF");
      expect(t).toContain("B12345678");
      // 7.1.a número/serie + 7.1.b fecha
      expect(t).toContain("A/1");
      // 7.1.e goods identification — both filed lines still present
      expect(el.shadowRoot!.querySelectorAll(".line")).toHaveLength(2);
      expect(t).toContain("Café");
      expect(t).toContain("Jamón");
      // 7.1.f tipo + base per rate (both rates)
      expect(t).toContain("Base 21.00%");
      expect(t).toContain("Base 10.00%");
      expect(t).toContain("IVA 21.00%");
      expect(t).toContain("IVA 10.00%");
      // 7.1.g total
      expect(t).toContain("TOTAL");
      expect(t).toContain("9,40 €");
      // QR + VERI*FACTU legend
      expect(el.shadowRoot!.querySelector("svg")).not.toBeNull();
      expect(t).toContain("VERI*FACTU");
      // The trim renders ONLY in its two slots — the core order is untouched: the issuer header still
      // precedes the meta block, and the legend still precedes the footer trim.
      const header = el.shadowRoot!.querySelector(".issuer")!;
      const meta = el.shadowRoot!.querySelector(".meta")!;
      const legend = el.shadowRoot!.querySelector(".legend")!;
      const foot = el.shadowRoot!.querySelector(".footer-message")!;
      expect(following(header, meta)).toBe(true);
      expect(following(legend, foot)).toBe(true);
    });
  });
});
