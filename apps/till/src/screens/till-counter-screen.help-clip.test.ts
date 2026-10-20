import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpBadgeLabel } from "../i18n/help-strings.js";
import type { StringKey } from "../i18n/strings.js";
import type { CounterWaitingOrder, HeldOrderSummary, TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "p1",
  catalogueId: "cat-default",
  name: "Café",
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

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

let locale = currentLocale();
let viewport = { width: 0, height: 0 };
beforeEach(() => {
  locale = currentLocale();
  viewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en");
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
  await page.viewport(viewport.width, viewport.height);
});

/** The parent in the rendered tree: a slotted node's slot, else its parent, else its shadow host. */
function renderedParent(node: Element): Element | null {
  if (node.assignedSlot !== null) return node.assignedSlot;
  if (node.parentElement !== null) return node.parentElement;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Every box above `node` that cuts off what overflows it. */
function clippingBoxes(node: Element): Element[] {
  const boxes: Element[] = [];
  for (let at = renderedParent(node); at !== null; at = renderedParent(at)) {
    const style = getComputedStyle(at);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") boxes.push(at);
  }
  return boxes;
}

interface Part {
  name: string;
  label: StringKey;
  over: Partial<TillCounterScreen>;
  /** The element whose shadow root holds the badge. */
  owner: (el: TillCounterScreen) => Element;
}

const shadowChild = (el: TillCounterScreen, tag: string) => el.shadowRoot!.querySelector(tag)!;

const parts: Part[] = [
  {
    name: "the dishes' search",
    label: "menu.search",
    over: {},
    owner: (el) => shadowChild(el, "till-menu-browser"),
  },
  {
    name: "Parked orders",
    label: "held.title",
    over: { orderList: "parked", heldOrders: [heldOrder] },
    owner: (el) => shadowChild(el, "till-held-orders"),
  },
  {
    name: "Waiting orders",
    label: "waiting.title",
    over: { orderList: "waiting", counterWaiting: [waitingOrder] },
    owner: (el) => shadowChild(el, "till-counter-waiting"),
  },
  {
    name: "Park",
    label: "action.hold",
    over: {},
    owner: (el) => shadowChild(el, "till-tender-pay"),
  },
];

async function mount(over: Partial<TillCounterScreen>) {
  const { el, host } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products: [cafe],
    menus: servedMenus(
      [{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }],
      [],
    ),
    operatorName: "Ana",
    ...over,
  });
  // As in the till, whose shell sets the badge's size and gives the screen the window's height.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  host.style.height = `${window.innerHeight}px`;
  return el;
}

describe("Counter's badges are whole", () => {
  for (const width of [1280, 390])
    it.each(parts.map((part) => [part.name, part] as const))(
      `at ${width} px, %s's badge is not cut off by any box around it`,
      async (_name, part) => {
        await page.viewport(width, 800);
        const el = await mount(part.over);
        const owner = part.owner(el) as Element & { updateComplete: Promise<unknown> };
        await owner.updateComplete;
        const badge = owner.shadowRoot!.querySelector<WtHelpTooltip>(
          `wt-help-tooltip[aria-label="${helpBadgeLabel(t(part.label))}"]`,
        )!;
        setHelpMode(true);
        await badge.updateComplete;
        await document.fonts.ready;
        const at = badge.getBoundingClientRect();
        expect(at.width).toBeGreaterThan(0);
        expect(at.top).toBeGreaterThanOrEqual(0);
        expect(at.right).toBeLessThanOrEqual(window.innerWidth);
        for (const box of clippingBoxes(badge)) {
          const room = box.getBoundingClientRect();
          const where = `${box.tagName.toLowerCase()}.${box.className}`;
          expect(at.top, where).toBeGreaterThanOrEqual(room.top);
          expect(at.left, where).toBeGreaterThanOrEqual(room.left);
          expect(at.bottom, where).toBeLessThanOrEqual(room.bottom);
          expect(at.right, where).toBeLessThanOrEqual(room.right);
        }
      },
    );
});
