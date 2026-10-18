import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { current, now } from "../screens/till-table-order-screen.current-orders.test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillSentOrders } from "./sent-orders.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Sent accessibility (%s)", (theme) => {
  const mount = (over: Partial<TillSentOrders> = {}) =>
    mountWidget<TillSentOrders>(
      "till-sent-orders",
      {
        scope: "visit",
        billId: "wo-4",
        now,
        snapshot: { scope: "visit", billId: "wo-4", current: current() },
        billLabels: new Map([["wo-check", "Bill 2"]]),
        ...over,
      },
      theme,
    );
  async function click(el: TillSentOrders, selector: string) {
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>(selector)!),
    );
    await el.updateComplete;
  }
  it("has no violations while attention is expanded, collapsed or fully unfolded", async () => {
    const { el, host } = await mount();
    await expectNoA11yViolations(host);
    await click(el, "[data-sent-toggle]");
    await expectNoA11yViolations(host);
    await click(el, "[data-sent-toggle]");
    await click(el, "[data-served-toggle]");
    await click(el, "[data-held-toggle]");
    await expectNoA11yViolations(host);
  });
  it("has no violations for busy service, unknown reads and an empty bill", async () => {
    const { el, host } = await mount({ busy: true });
    await expectNoA11yViolations(host);
    el.snapshot = null;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    el.snapshot = {
      scope: "visit",
      billId: "wo-4",
      current: current({ groups: [], ungrouped: [], reminder: null }),
    };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-sent-panel]")).toBeNull();
    await expectNoA11yViolations(host);
  });
  it("uses inherited text/spacing tokens and keeps information targets at least 44px", async () => {
    const { el, host } = await mount();
    host.style.setProperty("--wt-color-text-muted", "rgb(12, 34, 56)");
    host.style.setProperty("--wt-space-2", "9px");
    const summary = el.shadowRoot!.querySelector<HTMLElement>(".summary")!;
    expect(getComputedStyle(summary).color).toBe("rgb(12, 34, 56)");
    expect(getComputedStyle(el.shadowRoot!.querySelector(".content")!).paddingTop).toBe("9px");
    for (const button of el.shadowRoot!.querySelectorAll<HTMLElement>("[data-sent-info]")) {
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
