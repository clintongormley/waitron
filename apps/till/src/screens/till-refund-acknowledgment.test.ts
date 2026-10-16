import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TenderRefundAcknowledgment } from "../api/tender-refund-types.js";

const modules = import.meta.glob("./till-refund-acknowledgment.ts");
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const acknowledgment: TenderRefundAcknowledgment = {
  refund: {
    id: "refund-1",
    saleId: "sale-1",
    tenderId: "tender-1",
    state: "completed",
    appliedAmount: "12.50",
    tipAmount: "1.25",
    createdAt: "2026-10-16T10:00:00Z",
    completedAt: "2026-10-16T10:01:00Z",
  },
  invoiceNumber: "F/0012",
  issuer: { venueName: "Original issuer", nif: "61000002T", domicile: "Original address" },
  customerName: "Original customer",
  method: "card",
  last4: "0091",
};
type View = HTMLElement & {
  acknowledgment: TenderRefundAcknowledgment;
  busy: boolean;
  canPrint: boolean;
  updateComplete: Promise<unknown>;
};
async function mount(theme: "light" | "dark" = "light", patch = {}) {
  expect(modules["./till-refund-acknowledgment.ts"], "separate payment acknowledgment").toBeTypeOf(
    "function",
  );
  await modules["./till-refund-acknowledgment.ts"]!();
  return mountWidget<View>(
    "till-refund-acknowledgment",
    { acknowledgment, canPrint: true, ...patch },
    theme,
  );
}
describe.each(["light", "dark"] as const)("refund acknowledgment %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "shows completed payment facts without fiscal document controls in %s",
    async (language) => {
      setLocale(language);
      await page.viewport(390, 844);
      const { el, host } = await mount(theme);
      const text = el.shadowRoot!.textContent!;
      for (const value of [
        "Original issuer",
        "61000002T",
        "Original address",
        "Original customer",
        "F/0012",
        "refund-1",
        "0091",
        "13",
        "75",
        "12",
        "50",
        "1",
        "25",
      ])
        expect(text).toContain(value);
      expect(text).toContain(
        language === "en-GB"
          ? "Payment refund acknowledgment"
          : "Justificante de devolución del pago",
      );
      expect(text).toContain(
        language === "en-GB"
          ? "The original invoice is unchanged"
          : "La factura original no cambia",
      );
      expect(el.shadowRoot!.querySelector("[data-applied]")!.textContent).toBe(
        language === "en-GB" ? "€12.50" : "12,50 €",
      );
      expect(el.shadowRoot!.querySelector("[data-tip]")!.textContent).toBe(
        language === "en-GB" ? "€1.25" : "1,25 €",
      );
      expect(el.shadowRoot!.querySelector("[data-total]")!.textContent!.trim()).toBe(
        language === "en-GB" ? "€13.75" : "13,75 €",
      );
      expect(el.shadowRoot!.querySelector("time")!.dateTime).toBe("2026-10-16T10:01:00Z");
      expect(el.shadowRoot!.querySelector("time")!.textContent).toContain("UTC");
      expect(
        el.shadowRoot!.querySelector(
          "till-ticket-view, svg, img, [data-tender-refund], [data-test=open-drawer], [data-test=original-delivery]",
        ),
      ).toBeNull();
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(390);
      await expectNoA11yViolations(host);
    },
  );
});
it("emits separate read, reprint and Back actions, and disables duplicate print/read while busy", async () => {
  const { el } = await mount();
  const print = vi.fn(),
    original = vi.fn(),
    back = vi.fn();
  el.addEventListener("reprint", print);
  el.addEventListener("refund-original", original);
  el.addEventListener("back-to-find-bill", back);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-refund-reprint]")!);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-refund-original]")!);
  expect(print).toHaveBeenCalledOnce();
  expect(original).toHaveBeenCalledOnce();
  el.busy = true;
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<import("@waitron/ui").WtButton>("[data-refund-reprint]")!.disabled,
  ).toBe(true);
  expect(
    el.shadowRoot!.querySelector<import("@waitron/ui").WtButton>("[data-refund-original]")!
      .disabled,
  ).toBe(true);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-back-to-find-bill]")!);
  expect(back).toHaveBeenCalledOnce();
});
it("hides reprint when this device cannot print", async () => {
  const { el } = await mount("light", { canPrint: false });
  expect(el.shadowRoot!.querySelector("[data-refund-reprint]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-refund-original]")).not.toBeNull();
});
it.each(["pending", "failed"] as const)(
  "never presents %s as a completed acknowledgment",
  async (state) => {
    const { el } = await mount("light", {
      acknowledgment: {
        ...acknowledgment,
        refund: { ...acknowledgment.refund, state, completedAt: null },
      },
    });
    expect(el.shadowRoot!.querySelector("article, [data-refund-reprint]")).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain(
      state === "pending" ? "awaiting confirmation" : "failed",
    );
  },
);
