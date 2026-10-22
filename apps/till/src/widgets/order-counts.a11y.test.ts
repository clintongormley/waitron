import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import type { OrderStateCounts } from "../api/client.js";
import { orderCountStyles, orderCounts } from "./order-counts.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

class OrderCountsA11yHost extends LitElement {
  static override styles = orderCountStyles;
  static override properties = { counts: { attribute: false } };
  declare counts: OrderStateCounts;
  override render() {
    return html`${orderCounts(this.counts)}`;
  }
}
customElements.define("order-counts-a11y-host", OrderCountsA11yHost);

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("order counts a11y (%s theme)", (theme) => {
  it("all five chips have no violations", async () => {
    const { el, host } = await mountWidget<OrderCountsA11yHost>(
      "order-counts-a11y-host",
      { counts: { ordered: 9, unsent: 1, held: 2, waiting: 3, ready: 2 } },
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("[data-count]")).toHaveLength(5);
    await expectNoA11yViolations(host);
  });
});
