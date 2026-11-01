import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import type { ReceiptPresentation } from "@waitron/shared";
import type { TillSaleResult } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillTicketView } from "./till-ticket-view.js";

const issuer = { venueName: "Filed Legal SL", nif: "B12345678", domicile: "Filed Fiscal Street" };
const facts: TillSaleResult = {
  receiptTrim: {},
  venueAddress: [],
  receiptSettings: { printAddress: false },
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
  receiptSettings: { printAddress: true },
};
const answer = (presentation: ReceiptPresentation): TillSaleResult & ReceiptPresentation => ({
  ...facts,
  ...presentation,
});
const header = (el: TillTicketView) =>
  [...el.shadowRoot!.querySelector(".issuer")!.children].map((node) =>
    node instanceof HTMLImageElement ? node.getAttribute("src") : node.textContent!.trim(),
  );
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("per-answer receipt presentation", () => {
  it("uses the answer's immutable current logo URL and retains the earlier answer after replacement", async () => {
    const firstUrl = `/media/renditions/v1/${"b".repeat(64)}.webp/display/7500-2500-200.webp`;
    const nextUrl = `/media/renditions/v1/${"c".repeat(64)}.webp/display/5000-5000-100.webp`;
    const first = answer({ ...rich, receiptTrim: { ...rich.receiptTrim, logoUrl: firstUrl } });
    const saved = structuredClone(first);
    const { el } = await mountWidget<TillTicketView>("till-ticket-view", { result: first, issuer });
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src")).toBe(
      firstUrl,
    );
    el.result = answer({ ...rich, receiptTrim: { ...rich.receiptTrim, logoUrl: nextUrl } });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLImageElement>("img.logo")!.getAttribute("src")).toBe(
      nextUrl,
    );
    expect(first).toEqual(saved);
    expect(el.result.receiptTrim.logo).toBe(rich.receiptTrim.logo);
    expect(el.shadowRoot!.textContent).toContain("Filed Legal SL");
    expect(el.shadowRoot!.textContent).toContain("2,00");
  });
  it.each([false, true])(
    "uses department address permission %j beside filed identity",
    async (printAddress) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...answer(rich), invoiceType: "F1", receiptSettings: { printAddress } },
        issuer,
      });
      expect(el.shadowRoot!.textContent!.includes("Current Street")).toBe(printAddress);
      expect(el.shadowRoot!.textContent!.includes("Madrid")).toBe(printAddress);
      expect(el.shadowRoot!.querySelector(".domicile")!.textContent).toBe("Filed Fiscal Street");
      expect(el.shadowRoot!.textContent).toContain("terraza@example.com");
    },
  );

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
      receiptSettings: { printAddress: true },
    });
    await el.updateComplete;
    expect(header(el)).toEqual(["Comedor", "Filed Legal SL", "Edited Street", "NIF: B12345678"]);
    expect(el.shadowRoot!.querySelector(".footer-message")!.textContent).toBe("Gracias");
    el.result = answer({
      receiptTrim: {},
      venueAddress: [],
      receiptSettings: { printAddress: false },
    });
    await el.updateComplete;
    expect(header(el)).toEqual(["Filed Legal SL", "NIF: B12345678"]);
    expect(el.shadowRoot!.querySelector(".footer-message")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("Terraza");
    expect(el.shadowRoot!.textContent).not.toContain("Comedor");
    expect(el.shadowRoot!.textContent).toContain("2,00");
  });

  it.each(["F1", "F2"] as const)(
    "department address switch hides current address for %s and preserves filed domicile",
    async (invoiceType) => {
      const { el } = await mountWidget<TillTicketView>("till-ticket-view", {
        result: { ...answer(rich), invoiceType, receiptSettings: { printAddress: false } },
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

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`keeps recorded F2 dates on reprint in ${locale}/${theme}/${width}`, async () => {
        const previous = { width: window.innerWidth, height: window.innerHeight };
        try {
          await page.viewport(width, 1000);
          setLocale(locale);
          const { el } = await mountWidget<TillTicketView>(
            "till-ticket-view",
            {
              historical: true,
              invoiceLocale: locale,
              result: {
                ...facts,
                locale,
                invoiceType: "F2",
                issuedAt: "2026-10-14T23:30:00.000Z",
                issuedOffsetMinutes: 120,
              },
              issuer,
            },
            theme,
          );
          for (const offset of [120, 0]) {
            el.result = { ...el.result!, issuedOffsetMinutes: offset };
            await el.updateComplete;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const expected = new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "UTC",
            })
              .formatToParts(
                new Date(offset === 120 ? "2026-10-15T01:30:00Z" : "2026-10-14T23:30:00Z"),
              )
              .map((part) => (part.type === "hour" ? part.value.padStart(2, "0") : part.value))
              .join("");
            expect(el.shadowRoot!.querySelectorAll(".meta-row")[1]!.textContent).toContain(
              expected,
            );
            expect(el.shadowRoot!.querySelector(".recipient")).toBeNull();
            expect(el.shadowRoot!.querySelector(".domicile")).toBeNull();
            expect(el.shadowRoot!.querySelector("[data-test=reprint]")).not.toBeNull();
            await page.screenshot({
              path: `__screenshots__/a696-recorded-offset/${locale}-${theme}-${width}-${offset}.png`,
            });
          }
        } finally {
          await page.viewport(previous.width, previous.height);
        }
      });
    }
  }
}
