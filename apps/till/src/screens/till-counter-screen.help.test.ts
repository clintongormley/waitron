import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { html, render } from "lit";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import "../widgets/seat-dialog.js";
import type { TillSeatDialog } from "../widgets/seat-dialog.js";
import { guestsStepper } from "../widgets/guest-count.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { helpBadgeLabel, helpEn, helpEs, type HelpKey } from "../i18n/help-strings.js";
import type { StringKey } from "../i18n/strings.js";
import type { CounterWaitingOrder, HeldOrderSummary, TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "p1",
  catalogueId: "cat-default",
  name: "Café",
  customerName: { es: "Café para el cliente" },
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
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
});

const mount = (over: Partial<TillCounterScreen> = {}) =>
  mountWidget<TillCounterScreen>("till-counter-screen", {
    store: new WorkingOrderStore(),
    products: [cafe],
    menus: servedMenus(
      [{ id: "cat-default", name: "Carta", isDefault: true, versionId: "v1" }],
      [],
    ),
    operatorName: "Ana",
    ...over,
  });

type Lit = HTMLElement & { updateComplete: Promise<unknown> };
const tender = (el: TillCounterScreen) => el.shadowRoot!.querySelector<Lit>("till-tender-pay")!;
const held = (el: TillCounterScreen) => el.shadowRoot!.querySelector<Lit>("till-held-orders")!;
const waiting = (el: TillCounterScreen) =>
  el.shadowRoot!.querySelector<Lit>("till-counter-waiting")!;

interface Part {
  name: string;
  key: HelpKey;
  label: StringKey;
  over: Partial<TillCounterScreen>;
  /** The element whose shadow root holds the badge. */
  owner: (el: TillCounterScreen) => Lit;
  /** The box the badge hangs over. */
  box: (owner: Lit) => HTMLElement;
  /** The part whose size the badge must not change. */
  room: (owner: Lit) => HTMLElement;
}

const parts: Part[] = [
  {
    name: "Park",
    key: "help.counter.park",
    label: "action.hold",
    over: {},
    owner: tender,
    box: (owner) => owner.shadowRoot!.querySelector<HTMLElement>(".hold")!,
    room: (owner) => owner.shadowRoot!.querySelector<HTMLElement>(".hold")!,
  },
  {
    name: "Parked orders",
    key: "help.counter.parked_orders",
    label: "held.title",
    over: { orderList: "parked", heldOrders: [heldOrder] },
    owner: held,
    box: (owner) => owner.shadowRoot!.querySelector<HTMLElement>("h2")!,
    room: (owner) => owner.shadowRoot!.querySelector<HTMLElement>(".title-anchor")!,
  },
  {
    name: "Waiting orders",
    key: "help.counter.waiting_orders",
    label: "waiting.title",
    over: { orderList: "waiting", counterWaiting: [waitingOrder] },
    owner: waiting,
    box: (owner) => owner.shadowRoot!.querySelector<HTMLElement>("h2")!,
    room: (owner) => owner.shadowRoot!.querySelector<HTMLElement>(".title-anchor")!,
  },
  {
    name: "Guests",
    key: "help.counter.guests",
    label: "seat.guest_count",
    over: { asksGuests: true },
    owner: tender,
    box: (owner) =>
      owner
        .shadowRoot!.querySelector("wt-number-stepper")!
        .shadowRoot!.querySelector<HTMLElement>(".field")!,
    room: (owner) => owner.shadowRoot!.querySelector<HTMLElement>("wt-number-stepper")!,
  },
];

const badgeIn = (owner: Lit, label: StringKey) =>
  owner.shadowRoot!.querySelector<WtHelpTooltip>(
    `wt-help-tooltip[aria-label="${helpBadgeLabel(t(label))}"]`,
  );

const size = (box: HTMLElement) => {
  const { width, height } = box.getBoundingClientRect();
  return { width, height };
};

const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");

async function helpOn(badge: WtHelpTooltip): Promise<void> {
  setHelpMode(true);
  await badge.updateComplete;
}

describe("Counter's help badges", () => {
  it.each(parts.map((part) => [part.name, part] as const))(
    "with help on, %s has a badge over its top trailing corner that takes no room",
    async (_name, part) => {
      const { el } = await mount(part.over);
      const owner = part.owner(el);
      await owner.updateComplete;
      const box = part.box(owner);
      const off = size(part.room(owner));
      const badge = badgeIn(owner, part.label)!;
      await helpOn(badge);
      const at = badge.getBoundingClientRect();
      const corner = box.getBoundingClientRect();
      expect(at.width).toBeGreaterThan(0);
      expect(at.left + at.width / 2).toBeCloseTo(corner.right, 0);
      expect(at.top + at.height / 2).toBeCloseTo(corner.top, 0);
      expect(size(part.room(owner))).toEqual(off);
    },
  );

  it.each(
    parts.flatMap((part) =>
      [
        { lang: "en", text: helpEn },
        { lang: "es", text: helpEs },
      ].map(({ lang, text }) => [part.name, lang, part, text] as const),
    ),
  )("its box says the help text (%s, %s)", async (_name, lang, part, text) => {
    setLocale(lang);
    const { el } = await mount(part.over);
    const owner = part.owner(el);
    await owner.updateComplete;
    const badge = badgeIn(owner, part.label)!;
    await helpOn(badge);
    expect(badge.mode).toBe("help-mode");
    expect(badge.textContent).toBe(text[part.key]);
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    expect(isOpen(badge)).toBe(true);
  });

  it.each(parts.map((part) => [part.name, part] as const))(
    "with help off there is no badge (%s)",
    async (_name, part) => {
      const { el } = await mount(part.over);
      const owner = part.owner(el);
      await owner.updateComplete;
      const badge = badgeIn(owner, part.label)!;
      await badge.updateComplete;
      expect(badge.getBoundingClientRect().width).toBe(0);
      expect(getComputedStyle(badge).display).toBe("none");
    },
  );

  it("the Park badge opens its box while Park is disabled", async () => {
    const { el } = await mount();
    const owner = tender(el);
    const park = owner.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".hold")!;
    expect(park.disabled).toBe(true);
    const badge = badgeIn(owner, "action.hold")!;
    await helpOn(badge);
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    expect(isOpen(badge)).toBe(true);
  });

  it("turning help off closes the Park box", async () => {
    const { el } = await mount();
    const badge = badgeIn(tender(el), "action.hold")!;
    await helpOn(badge);
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    expect(isOpen(badge)).toBe(true);
    setHelpMode(false);
    await badge.updateComplete;
    expect(isOpen(badge)).toBe(false);
  });

  it("Park still parks with help on", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mount({ store });
    const owner = tender(el);
    const parks: unknown[] = [];
    el.addEventListener("park-order", (event) => parks.push((event as CustomEvent).detail));
    await helpOn(badgeIn(owner, "action.hold")!);
    await userEvent.click(owner.shadowRoot!.querySelector<HTMLElement>(".hold")!);
    await owner.updateComplete;
    await userEvent.click(owner.shadowRoot!.querySelector<HTMLElement>(".park")!);
    expect(parks).toEqual([{ label: undefined }]);
  });

  it("the guests badge is only on the Counter's payment, not in the seat dialog", async () => {
    setHelpMode(true);
    const { el } = await mountWidget<TillSeatDialog>("till-seat-dialog", { tableLabel: "4" });
    expect(el.shadowRoot!.querySelector("wt-help-tooltip")).toBeNull();

    const host = document.createElement("div");
    document.body.append(host);
    try {
      render(
        html`${guestsStepper({ text: "", disabled: false, error: "", onChange: () => {} })}`,
        host,
      );
      expect(host.querySelector("wt-help-tooltip")).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("with no waiting orders there is no Waiting heading and so no badge", async () => {
    setHelpMode(true);
    const { el } = await mount({ orderList: "waiting", counterWaiting: [] });
    expect(waiting(el)).toBeNull();
    const statuses = [...el.shadowRoot!.querySelectorAll('p[role="status"]')];
    expect(statuses.map((status) => status.textContent)).toContain(t("shell.waiting_empty"));
    const label = helpBadgeLabel(t("waiting.title"));
    expect(el.shadowRoot!.querySelector(`wt-help-tooltip[aria-label="${label}"]`)).toBeNull();
  });
});
