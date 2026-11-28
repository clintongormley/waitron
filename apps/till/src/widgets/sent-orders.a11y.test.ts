import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import {
  cake,
  coffee,
  current,
  currentGroup,
  flan,
  now,
} from "../screens/till-table-order-screen.current-orders.test-helpers.js";
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
  it("has no violations with every fired, held and served row in its section", async () => {
    const { el, host } = await mount();
    expect(el.shadowRoot!.querySelector("[data-held-line]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-served-line]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-fired-line]")).not.toBeNull();
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
  it("has no violations and keeps Fire and Serve all apart on a held heading with a released dish", async () => {
    const { el, host } = await mount({
      snapshot: {
        scope: "visit",
        billId: "wo-4",
        current: current({
          groups: [
            currentGroup("g3", 3, "held", [flan, { ...coffee, lineNo: 9 }]),
            currentGroup("g4", 4, "held", [cake]),
          ],
          ungrouped: [],
        }),
      },
    });
    const heading = el.shadowRoot!.querySelector("[data-sent-section=g3] wt-course-heading")!;
    const fire = heading.querySelector<HTMLElement>("[data-group-fire]")!;
    const serve = heading.querySelector<HTMLElement>("[data-serve-all]")!;
    await expectNoA11yViolations(host);
    const [a, b] = [fire.getBoundingClientRect(), serve.getBoundingClientRect()];
    expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(
      true,
    );
    for (const box of [a, b]) expect(box.height).toBeGreaterThanOrEqual(44);
  });
  it("uses inherited text/spacing tokens and keeps information targets at least 44px", async () => {
    const { el, host } = await mount();
    host.style.setProperty("--wt-color-text-muted", "rgb(12, 34, 56)");
    host.style.setProperty("--wt-space-2", "9px");
    const row = el.shadowRoot!.querySelector<HTMLElement>(".sent-row")!;
    expect(getComputedStyle(row).color).toBe("rgb(12, 34, 56)");
    expect(getComputedStyle(row.querySelector(".row-price")!).marginInlineStart).toBe("9px");
    for (const button of el.shadowRoot!.querySelectorAll<HTMLElement>("[data-sent-info]")) {
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
