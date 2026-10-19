import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { userEvent } from "vitest/browser";
import { chooseSentServing, sentPanelFor } from "./till-table-order-screen.sent.test-helpers.js";
import { DraftStore } from "../state/draft-sync.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { products, menuOf } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  groups,
  now,
  snoozed,
} from "./till-table-order-screen.current-orders.test-helpers.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("Sent service a11y (%s theme)", (theme) => {
  async function mountSent(over: Partial<TillTableOrderScreen> = {}) {
    const mounted = await mountWidget<TillTableOrderScreen>(
      "till-table-order-screen",
      {
        products,
        menus: menuOf(products),
        lines: [],
        orderId: "wo-4",
        draftStore: new DraftStore(),
        groups,
        currentOrders: current(),
        now,
        ...over,
      },
      theme,
    );
    const panel = await sentPanelFor(mounted.el);
    for (const selector of ["[data-sent-toggle]", "[data-held-toggle]", "[data-served-toggle]"]) {
      const toggle = panel.shadowRoot!.querySelector<HTMLElement>(selector);
      if (toggle?.getAttribute("aria-expanded") === "false") {
        await userEvent.click(toggle);
        await panel.updateComplete;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await mounted.el.updateComplete;
    return mounted;
  }

  it("has no violations with every row state and a due reminder", async () => {
    const { host } = await mountSent();
    await expectNoA11yViolations(host);
  });

  it("has no violations with a reminder not yet due", async () => {
    const { host } = await mountSent({ now: now - 5 * 60_000 });
    await expectNoA11yViolations(host);
  });

  it("has no violations with a snoozed reminder that is due", async () => {
    const { host } = await mountSent({ currentOrders: snoozed() });
    await expectNoA11yViolations(host);
  });

  it("has no violations with a snoozed reminder not yet due", async () => {
    const { host } = await mountSent({ currentOrders: snoozed(), now: now - 5 * 60_000 });
    await expectNoA11yViolations(host);
  });

  it("has no violations saying Current orders could not be read", async () => {
    const { host } = await mountSent({ currentOrders: null, currentOrdersUnread: true });
    await expectNoA11yViolations(host);
  });

  it("has no violations while a group command runs", async () => {
    const { host } = await mountSent({ groupCommandBusy: true });
    await expectNoA11yViolations(host);
  });

  it.each(["serve", "undo"])(
    "has no violations with the how-many dialog open from %s",
    async (attribute) => {
      const { el, host } = await mountSent();
      await chooseSentServing(el, "l-croq", attribute === "undo");
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});
