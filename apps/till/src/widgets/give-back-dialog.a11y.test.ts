import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { VIEW, fakeGiveBackApi } from "./give-back-dialog.test-helpers.js";
import "./give-back-dialog.js";
import type { TillGiveBackDialog } from "./give-back-dialog.js";

beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("give money back accessibility (%s)", (theme) => {
  async function mount(api = fakeGiveBackApi()) {
    const mounted = await mountWidget<TillGiveBackDialog>(
      "till-give-back-dialog",
      { api, saleId: "s1", invoiceNumber: "A/1042", namesLocale: "es" },
      theme,
    );
    await vi.waitFor(() =>
      expect(mounted.el.shadowRoot!.querySelector("[data-loading]")).toBeNull(),
    );
    await mounted.el.updateComplete;
    return mounted;
  }
  async function choose(el: TillGiveBackDialog, purpose: string) {
    el.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${purpose}]`)!.click();
    await el.updateComplete;
  }

  it("has no violations while the receipt is read", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockReturnValue(new Promise(() => {}));
    const { host } = await mountWidget<TillGiveBackDialog>(
      "till-give-back-dialog",
      { api, saleId: "s1", invoiceNumber: "A/1042" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations when the receipt could not be read", async () => {
    const api = fakeGiveBackApi();
    api.readGiveBack.mockRejectedValue(new TypeError("Failed to fetch"));
    const { host } = await mount(api);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the choice, one choice waiting and one with nothing left", async () => {
    const { host } = await mount(
      fakeGiveBackApi({
        ...VIEW,
        choices: {
          dishes: { available: false, reason: null },
          goodwill: { available: false, reason: { code: "invoice_correction.refund_pending" } },
          extra: { available: true, reason: null },
        },
      }),
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on a dish's form with a line waiting, extras and a dish given free", async () => {
    const { el, host } = await mount(
      fakeGiveBackApi({
        ...VIEW,
        lines: VIEW.lines.map((line) =>
          line.id === "croquetas"
            ? { ...line, available: false, reason: { code: "invoice_correction.refund_pending" } }
            : line,
        ),
      }),
    );
    await choose(el, "dishes");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the money and reason marked missing", async () => {
    const { el, host } = await mount();
    await choose(el, "goodwill");
    el.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with the summary and the PIN line shown", async () => {
    const api = fakeGiveBackApi();
    api.previewGiveBack.mockResolvedValue({
      parts: [{ kind: "correction", amount: "7.00", way: "card-1" }],
      leftUnderWay: "3.00",
      needs: ["sale.rectify"],
      manual: false,
    });
    const { el, host } = await mount(api);
    await choose(el, "goodwill");
    const field = el
      .shadowRoot!.querySelector("wt-price-input[name=amount]")!
      .shadowRoot!.querySelector("input")!;
    await userEvent.fill(page.elementLocator(field), "10");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-pin]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it("has no violations on the extra's form", async () => {
    const { el, host } = await mount();
    await choose(el, "extra");
    await expectNoA11yViolations(host);
  });
});
