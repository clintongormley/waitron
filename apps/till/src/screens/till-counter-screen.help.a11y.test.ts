import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { CounterWaitingOrder, HeldOrderSummary } from "../api/client.js";

const heldOrder: HeldOrderSummary = {
  items: [],
  id: "held",
  orderNumber: 1,
  label: "Ana",
  itemCount: 1,
  total: "1.50",
  outstanding: "1.50",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-10-16T10:00:00.000Z",
  signals: [],
};

const waitingOrder: CounterWaitingOrder = {
  items: [],
  id: "waiting",
  orderNumber: 2,
  label: "Luis",
  status: "settled",
  openedAt: "2026-10-16T10:00:00.000Z",
  settledAt: "2026-10-16T10:01:00.000Z",
  collectedAt: null,
  total: "1.50",
  canHandOver: true,
  serviceMode: null,
  movableDishes: [],
};

let viewport = { width: 0, height: 0 };
beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await page.viewport(viewport.width, viewport.height);
});

const lists = [
  { list: "parked", badges: 3 },
  { list: "waiting", badges: 3 },
] as const;

describe.each(["light", "dark"] as const)("Counter's help badges a11y (%s theme)", (theme) => {
  it.each(lists.flatMap(({ list, badges }) => [390, 1280].map((width) => [list, width, badges])))(
    "the payment area and the %s list at %i px with help on have no violations",
    async (list, width, badges) => {
      await page.viewport(width as number, 900);
      setHelpMode(true);
      const { el, host } = await mountWidget<TillCounterScreen>(
        "till-counter-screen",
        {
          store: new WorkingOrderStore(),
          operatorName: "Ana",
          asksGuests: true,
          orderList: list as "parked" | "waiting",
          heldOrders: [heldOrder],
          counterWaiting: [waitingOrder],
        },
        theme,
      );
      const shown: WtHelpTooltip[] = [];
      for (const owner of el.shadowRoot!.querySelectorAll<HTMLElement>(
        "till-tender-pay, till-held-orders, till-counter-waiting",
      )) {
        await (owner as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
        shown.push(...owner.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip"));
      }
      for (const badge of shown) await badge.updateComplete;
      expect(shown.filter((badge) => badge.getBoundingClientRect().width > 0)).toHaveLength(
        badges as number,
      );
      await expectNoA11yViolations(host);
    },
  );
});
