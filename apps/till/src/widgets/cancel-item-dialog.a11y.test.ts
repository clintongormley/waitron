import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./cancel-item-dialog.js";
import type { TillCancelItemDialog } from "./cancel-item-dialog.js";

beforeEach(() => setLocale("es-ES"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
const consent = (
  status: "open" | "settled",
  stage: "not_started" | "started",
): CancellationRead => ({
  billId: "b",
  revision: 1,
  billRevision: 1,
  context: {
    billStatus: status,
    stage,
    components: [
      {
        id: "ticket",
        lineId: "dish",
        state: stage === "started" ? "preparing" : "queued",
        firedAt: null,
        quantity: "3.000",
        kitchenQuantity: "3.000",
        servedQuantity: "0.000",
        cancelledQuantity: "0.000",
      },
    ],
  },
});
describe.each(["light", "dark"] as const)("Cancel item accessibility (%s)", (theme) => {
  const mount = (over: Partial<TillCancelItemDialog> = {}) =>
    mountWidget<TillCancelItemDialog>(
      "till-cancel-item-dialog",
      {
        name: "Solomillo con patatas y salsa de pimienta",
        lineId: "dish",
        consent: consent("open", "not_started"),
        ...over,
      },
      theme,
    );
  it.each(["not_started", "started"] as const)(
    "has no violations for unpaid %s choices",
    async (stage) => {
      const { host } = await mount({ consent: consent("open", stage) });
      await expectNoA11yViolations(host);
    },
  );
  it.each([false, true])(
    "has no violations on a paid bill, with refund handoff %s",
    async (refundAvailable) => {
      const { host } = await mount({ consent: consent("settled", "started"), refundAvailable });
      await expectNoA11yViolations(host);
    },
  );
  it("has no violations with a selected money choice", async () => {
    const { el, host } = await mount({ consent: consent("open", "started") });
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("input[value=keep_charge]")!),
    );
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-confirm]")!.disabled,
    ).toBe(false);
    await expectNoA11yViolations(host);
  });
  it("has no violations with an invalid quantity and bottom field summary", async () => {
    const { el, host } = await mount();
    const field = el.shadowRoot!.querySelector("wt-number-stepper")!;
    await field.updateComplete;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "0");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
    await el.updateComplete;
    expect(field.error).not.toBe("");
    await expectNoA11yViolations(host);
  });
  it("has no violations for a weighed whole quantity, a busy choice or unavailable food", async () => {
    const read = consent("open", "started");
    read.context.components[0]!.quantity = "0.750";
    const { el, host } = await mount({ consent: read, unitPrecision: 3 });
    await expectNoA11yViolations(host);
    el.busy = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.busy = false;
    el.consent = null;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("has no violations when a request refusal permits another attempt", async () => {
    const { host } = await mount({ refusal: "No se ha podido cancelar. Vuelve a intentarlo." });
    await expectNoA11yViolations(host);
  });
});
