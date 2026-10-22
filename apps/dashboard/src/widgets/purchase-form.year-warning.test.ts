import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { DashboardApi, PurchaseInvoice } from "../api/client.js";
import { PurchaseForm } from "./purchase-form.js";
import { PurchasesScreen } from "../screens/purchases-screen.js";

const originalLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const saved: PurchaseInvoice = {
  id: "prior-invoice",
  supplierTaxId: "B12345678",
  supplierName: "Supplier Ltd",
  supplierInvoiceNumber: "001",
  issuedOn: "2026-12-31",
  receivedOn: "2027-02-01",
  total: "121.00",
  regime: "general",
  deductibleProportion: "100.00",
  note: null,
  lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
};

async function change(el: PurchaseForm, field: string, value: string) {
  el.shadowRoot!.querySelector(`[data-test=${field}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

function warning(el: PurchaseForm) {
  return el.shadowRoot!.querySelector("[data-test=number-year-warning]")?.textContent?.trim() ?? "";
}

describe("purchase invoice number reuse warning", () => {
  it.each(["en-GB", "es-ES"] as const)(
    "names the other issue year before saving in %s",
    async (locale) => {
      setLocale(locale);
      const props = {
        open: true,
        invoice: { ...saved, id: "editing", issuedOn: "2027-01-01" },
        invoices: [saved],
      };
      const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", props);
      expect(warning(el)).toContain("2026");
      expect(warning(el)).toBe(t("purchase.number_used_in_year").replace("{year}", "2026"));
      await change(el, "supplier-name", "Supplier updated");
      const save =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
      await save.updateComplete;
      expect(save.disabled).toBe(false);
      const submitted = vi.fn();
      el.addEventListener("update-purchase", submitted);
      save.click();
      expect(submitted).toHaveBeenCalledOnce();
    },
  );

  it("tracks the issue date, supplier and number without discarding the draft", async () => {
    const props = { open: true, invoice: { ...saved, id: "editing" }, invoices: [saved] };
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", props);
    expect(warning(el)).toBe("");
    await change(el, "issued-on", "2027-01-01");
    expect(warning(el)).toContain("2026");
    await change(el, "received-on", "2026-12-31");
    expect(warning(el)).toContain("2026");
    await change(el, "supplier-tax-id", "B87654321");
    expect(warning(el)).toBe("");
    await change(el, "supplier-tax-id", saved.supplierTaxId);
    await change(el, "supplier-invoice-number", "002");
    expect(warning(el)).toBe("");
    await change(el, "supplier-invoice-number", "001");
    expect(warning(el)).toContain("2026");
    await change(el, "issued-on", "");
    expect(warning(el)).toBe("");
  });

  it("excludes the edited invoice itself after its year is changed", async () => {
    const props = { open: true, invoice: saved, invoices: [saved] };
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", props);
    await change(el, "issued-on", "2027-01-01");
    expect(warning(el)).toBe("");
  });

  it("gets the current invoice history from the purchases screen", async () => {
    const api = {
      listPurchaseInvoices: vi.fn().mockResolvedValue([saved]),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<PurchasesScreen>("dashboard-purchases-screen", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-purchase-list")).not.toBeNull(),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-purchase]")!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector<PurchaseForm>("dashboard-purchase-form")!;
    await form.updateComplete;
    await change(form, "supplier-tax-id", saved.supplierTaxId);
    await change(form, "supplier-invoice-number", "001");
    await change(form, "issued-on", "2027-01-01");
    expect(warning(form)).toContain("2026");
  });

  it("updates the warning from a new history snapshot while keeping an unsaved edit", async () => {
    const { el } = await mountWidget<PurchaseForm>("dashboard-purchase-form", {
      open: true,
      invoice: { ...saved, id: "editing", issuedOn: "2027-01-01" },
    });
    await change(el, "supplier-name", "Unsaved supplier name");
    el.invoices = [saved, { ...saved, id: "older", issuedOn: "2025-12-31" }];
    await el.updateComplete;
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-test=number-year-warning]")].map((p) =>
        p.textContent?.trim(),
      ),
    ).toEqual(
      ["2025", "2026"].map((year) => t("purchase.number_used_in_year").replace("{year}", year)),
    );
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=supplier-name]")!
        .value,
    ).toBe("Unsaved supplier name");
    el.invoices = [];
    await el.updateComplete;
    expect(warning(el)).toBe("");
  });

  for (const locale of ["en-GB", "es-ES"] as const) {
    for (const theme of ["light", "dark"] as const) {
      it.each([390, 1280])(
        `shows an accessible warning in ${locale}, ${theme}, at %spx`,
        async (width) => {
          const previous = { width: window.innerWidth, height: window.innerHeight };
          try {
            setLocale(locale);
            await page.viewport(width, 900);
            const props = {
              open: true,
              invoice: { ...saved, id: "editing", issuedOn: "2027-01-01" },
              invoices: [saved],
            };
            const { el, host } = await mountWidget<PurchaseForm>(
              "dashboard-purchase-form",
              props,
              theme,
            );
            const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
            await dialog.updateComplete;
            const native = dialog.shadowRoot!.querySelector("dialog")!;
            await vi.waitFor(() => expect(native.open).toBe(true));
            const text = el.shadowRoot!.querySelector<HTMLElement>(
              "[data-test=number-year-warning]",
            )!;
            text.scrollIntoView({ block: "center" });
            expect(text.textContent?.trim()).toBe(
              t("purchase.number_used_in_year").replace("{year}", "2026"),
            );
            const bounds = text.getBoundingClientRect();
            expect(bounds.width).toBeGreaterThan(0);
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(width);
            await expectNoA11yViolations(host);
            if (import.meta.env.VITE_A981_CAPTURE === "1") {
              await page.screenshot({
                path: `__screenshots__/a981/${locale}-${theme}-${width}.png`,
              });
            }
          } finally {
            await page.viewport(previous.width, previous.height);
          }
        },
      );
    }
  }
});
