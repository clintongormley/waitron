import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { products, menuOf } from "./till-table-order-screen.test-helpers.js";
import { current, groups, now } from "./till-table-order-screen.current-orders.test-helpers.js";

afterEach(cleanupWidgets);

// The fixture holds every row state Current orders draws: fired minutes ago, ready, en route,
// preparing, no kitchen item, partly served, served, held with extras, a group added later, rows in
// no group, and a due reminder with Snooze and Fire.
describe.each(["light", "dark"] as const)("Current orders a11y (%s theme)", (theme) => {
  async function mountDrawer(over: Partial<TillTableOrderScreen> = {}) {
    const mounted = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      {
        products,
        menus: menuOf(products),
        lines: [],
        statuses: [],
        orderId: "wo-4",
        draftStore: new DraftStore(),
        groups,
        currentOrders: current(),
        now,
        ...over,
      },
      theme,
    );
    mounted.el.shadowRoot!.querySelector<HTMLElement>("[data-open-drawer]")!.click();
    await mounted.el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await mounted.el.updateComplete;
    return mounted;
  }

  it("has no violations with every row state and a due reminder", async () => {
    const { host } = await mountDrawer();
    await expectNoA11yViolations(host);
  });

  it("has no violations with a reminder not yet due", async () => {
    const { host } = await mountDrawer({ now: now - 5 * 60_000 });
    await expectNoA11yViolations(host);
  });

  it("has no violations saying Current orders could not be read", async () => {
    const { host } = await mountDrawer({ currentOrders: null, currentOrdersUnread: true });
    await expectNoA11yViolations(host);
  });

  it("has no violations while a group command runs", async () => {
    const { host } = await mountDrawer({ groupCommandBusy: true });
    await expectNoA11yViolations(host);
  });

  it.each(["data-serve-row", "data-unserve-row"])(
    "has no violations with the how-many dialog open from %s",
    async (attribute) => {
      const { el, host } = await mountDrawer();
      el.shadowRoot!.querySelector<HTMLElement>(`[${attribute}="l-croq"]`)!.click();
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
