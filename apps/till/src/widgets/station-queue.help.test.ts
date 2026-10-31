import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type { KitchenNotice, StationQueueGroup } from "../api/client.js";
import { helpBadgeLabel, helpEn, helpEs, helpText, type HelpKey } from "../i18n/help-strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage, textRects } from "./test-helpers.js";
import "./station-queue.js";
import type { TillStationQueue } from "./station-queue.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const SENT = "2026-08-17T10:00:00.000Z";
const NOW = Date.parse(SENT) + 2 * 60_000;

function dish(id: string, state: "queued" | "preparing", name: string) {
  return {
    allergy: null,
    id,
    workingOrderLineId: `wol-${id}`,
    state,
    name,
    quantity: "1.000",
    course: null,
    firedAt: SENT,
    queuedAt: SENT,
  };
}

// One card under Waiting and one under Preparing.
function board(): StationQueueGroup[] {
  return [
    {
      kitchenNote: null,
      orderId: "wo-1",
      orderNumber: 5,
      label: "Mesa 4",
      queuedAt: SENT,
      status: "placed",
      thresholds: THRESHOLDS,
      bumpMode: "line",
      items: [dish("ti-1", "queued", "Paella"), dish("ti-2", "preparing", "Agua")],
    },
    {
      kitchenNote: null,
      orderId: "wo-2",
      orderNumber: 6,
      label: null,
      queuedAt: SENT,
      status: "placed",
      thresholds: THRESHOLDS,
      bumpMode: "line",
      items: [dish("ti-3", "preparing", "Vino")],
    },
  ];
}

const notice: KitchenNotice = {
  id: "kn-void",
  stationId: "st-1",
  workingOrderId: "wo-1",
  orderLabel: "#5 · Mesa 4",
  kind: "void",
  lineName: "Burger",
  unitName: null,
  soldInEach: false,
  quantity: "1.000",
  note: null,
  wasStarted: true,
  movedTo: null,
  reroutedTo: null,
  direction: null,
  cancelledExtra: null,
  createdAt: "2026-08-17T10:01:00.000Z",
};

let locale = currentLocale();
beforeEach(async () => {
  locale = currentLocale();
  setLocale("en");
  await page.viewport(1280, 900);
});
afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(locale);
  await resetPage();
});

async function mount(over: Partial<TillStationQueue> = {}) {
  const { el, host } = await mountWidget<TillStationQueue>("till-station-queue", {
    groups: board(),
    notices: [notice],
    stationId: "st-1",
    now: NOW,
    ...over,
  });
  // The till's shell sets the badge's size; a board mounted alone takes the dashboard's.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  await el.updateComplete;
  return { el, host };
}

const shadow = (el: TillStationQueue) => el.shadowRoot!;
const cards = (el: TillStationQueue) => [
  ...shadow(el).querySelectorAll<HTMLElement>("article.ticket"),
];
const allBadges = (el: TillStationQueue) => [
  ...shadow(el).querySelectorAll<WtHelpTooltip>("wt-help-tooltip"),
];
const badgeFor = (el: TillStationQueue, part: string) =>
  shadow(el).querySelector<WtHelpTooltip>(`wt-help-tooltip[aria-label="${helpBadgeLabel(part)}"]`);
const cardBadge = (el: TillStationQueue) => badgeFor(el, helpText("help.kitchen.cards_part"))!;
const columnsBadge = (el: TillStationQueue) => badgeFor(el, t("station.columns"))!;
const noticesBadge = (el: TillStationQueue) => badgeFor(el, t("station.notices"));
const columnsButton = (el: TillStationQueue) =>
  shadow(el).querySelector<HTMLElement>("[data-columns-open]")!;
const noticesHeading = (el: TillStationQueue) =>
  shadow(el).querySelector<HTMLElement>(".notices-title")!;
const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");
const rect = (box: Element) => {
  const { left, top, width, height } = box.getBoundingClientRect();
  return { left, top, width, height };
};

async function settle(el: TillStationQueue): Promise<void> {
  await el.updateComplete;
  for (const badge of allBadges(el)) await badge.updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function helpOn(el: TillStationQueue): Promise<void> {
  setHelpMode(true);
  await settle(el);
}

/** At 390 the board draws tabs; Overview is first and holds no cards. */
async function phoneWaiting(el: TillStationQueue): Promise<void> {
  await vi.waitFor(() => expect(shadow(el).querySelector("[data-column-tabs]")).not.toBeNull());
  await userEvent.click(
    shadow(el).querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')!,
  );
  await settle(el);
}

const cardsWithBadge = (el: TillStationQueue) =>
  cards(el).filter((card) => card.querySelector(":scope > wt-help-tooltip") !== null);

describe("the station board's help badges", () => {
  it("with help on, the first card has a badge and no other card does, at 1280 (columns)", async () => {
    const { el } = await mount();
    await helpOn(el);
    expect(shadow(el).querySelector(".kanban")).not.toBeNull();
    expect(cards(el)).toHaveLength(2);
    expect(cardsWithBadge(el)).toEqual([cards(el)[0]]);
    expect(cardBadge(el).getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("with help on, the first card has a badge and no other card does, at 390 (tabs)", async () => {
    await pageAt(390, 844);
    const { el } = await mount({
      groups: [
        ...board(),
        { ...board()[1]!, orderId: "wo-3", orderNumber: 7, items: [dish("ti-4", "queued", "Pan")] },
      ],
    });
    await phoneWaiting(el);
    await helpOn(el);
    expect(cards(el)).toHaveLength(2);
    expect(cardsWithBadge(el)).toEqual([cards(el)[0]]);
    expect(cardBadge(el).getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("a card's badge hangs over its top edge inside its trailing edge, and the card is the same size with help off and on", async () => {
    const { el } = await mount();
    const card = cards(el)[0]!;
    const off = rect(card);
    await helpOn(el);
    expect(rect(card)).toEqual(off);
    const at = cardBadge(el).getBoundingClientRect();
    const box = card.getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.top).toBeLessThan(box.top);
    expect(at.bottom).toBeGreaterThan(box.top);
    expect(at.right).toBeLessThanOrEqual(box.right + 0.5);
  });

  it("at 390 no badge reaches past the window and the page does not scroll sideways", async () => {
    await pageAt(390, 844);
    const { el } = await mount();
    await phoneWaiting(el);
    await helpOn(el);
    const card = cards(el)[0]!;
    const panel = shadow(el).querySelector<HTMLElement>("[data-tab-panel]")!;
    expect(card.getBoundingClientRect().width).toBeCloseTo(panel.getBoundingClientRect().width, 0);
    const shown = allBadges(el).filter((badge) => badge.getBoundingClientRect().width > 0);
    expect(shown.length).toBe(3);
    for (const badge of shown)
      expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("Columns has a badge and stays where it was", async () => {
    const { el } = await mount();
    const off = rect(columnsButton(el));
    await helpOn(el);
    expect(rect(columnsButton(el))).toEqual(off);
    const head = shadow(el).querySelector<HTMLElement>("[data-board-head]")!;
    expect(columnsButton(el).getBoundingClientRect().right).toBeCloseTo(
      head.getBoundingClientRect().right,
      0,
    );
    const at = columnsBadge(el).getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.right).toBeLessThanOrEqual(columnsButton(el).getBoundingClientRect().right + 0.5);
  });

  it("the notices heading has a badge while there are notices, and none without", async () => {
    const { el } = await mount();
    await helpOn(el);
    expect(noticesBadge(el)!.getBoundingClientRect().width).toBeGreaterThan(0);
    el.notices = [];
    await settle(el);
    expect(noticesBadge(el)).toBeNull();
  });

  it.each(["en", "es"])(
    "the notices badge covers none of the heading's words (%s)",
    async (lang) => {
      setLocale(lang);
      const { el } = await mount();
      await helpOn(el);
      const textEnd = Math.max(...textRects(noticesHeading(el)).map((line) => line.right));
      expect(noticesBadge(el)!.getBoundingClientRect().left).toBeGreaterThanOrEqual(textEnd - 0.5);
    },
  );

  it.each([
    { lang: "en", text: helpEn },
    { lang: "es", text: helpEs },
  ])(
    "each box says its text and the card's, Columns' and notices' links lead to their guide sections ($lang)",
    async ({ lang, text }) => {
      setLocale(lang);
      const { el } = await mount();
      await helpOn(el);
      const cases: [WtHelpTooltip, HelpKey, string][] = [
        [cardBadge(el), "help.kitchen.card", `/help/${lang}/kitchen-service#kitchen-screen`],
        [columnsBadge(el), "help.kitchen.columns", `/help/${lang}/kitchen-service#kitchen-screen`],
        [noticesBadge(el)!, "help.kitchen.notices", `/help/${lang}/kitchen-service#corrections`],
      ];
      for (const [badge, key, href] of cases) {
        expect(badge.mode).toBe("help-mode");
        expect(badge.textContent).toBe(text[key]);
        await userEvent.click(badge.shadowRoot!.querySelector("button")!);
        expect(isOpen(badge)).toBe(true);
        const link = badge.shadowRoot!.querySelector<HTMLAnchorElement>('[part="guide"]')!;
        expect(link.getAttribute("href")).toBe(href);
        expect(link.textContent).toBe(text["help.guide_link"]);
        await userEvent.keyboard("{Escape}");
      }
    },
  );

  it("a tap on the card's badge opens its box and moves no dish", async () => {
    const { el } = await mount();
    await helpOn(el);
    expect(cards(el)[0]!.querySelector("button[data-card-head]")).not.toBeNull();
    const moved = vi.fn();
    el.addEventListener("advance-ticket-item", moved);
    el.addEventListener("advance-dishes", moved);
    await userEvent.click(cardBadge(el).shadowRoot!.querySelector("button")!);
    expect(isOpen(cardBadge(el))).toBe(true);
    expect(moved).not.toHaveBeenCalled();
  });

  it("a tap on a dish still moves it with help on", async () => {
    const { el } = await mount();
    await helpOn(el);
    const moved = vi.fn();
    el.addEventListener("advance-ticket-item", (event) => moved((event as CustomEvent).detail));
    await userEvent.click(shadow(el).querySelector<HTMLElement>('[data-item="ti-1"]')!);
    expect(moved).toHaveBeenCalledWith({ itemId: "ti-1", stationId: "st-1", to: "preparing" });
  });

  it("a new read that keeps the first card first keeps its box open", async () => {
    const { el } = await mount();
    await helpOn(el);
    const badge = cardBadge(el);
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    expect(isOpen(badge)).toBe(true);
    el.groups = board();
    await settle(el);
    expect(cardBadge(el)).toBe(badge);
    expect(isOpen(badge)).toBe(true);
  });

  it.each([
    { lang: "en", text: helpEn },
    { lang: "es", text: helpEs },
  ])(
    "the badges are named Help: Cards, Help: Columns and Help: Changes to orders, and in Spanish Ayuda: … ($lang)",
    async ({ lang, text }) => {
      setLocale(lang);
      const { el } = await mount();
      await helpOn(el);
      const names = allBadges(el).map((badge) => badge.getAttribute("aria-label"));
      const name = (part: string) => text["help.badge_label"].replace("{part}", part);
      expect(names).toEqual([
        name(t("station.columns")),
        name(t("station.notices")),
        name(text["help.kitchen.cards_part"]),
      ]);
      if (lang === "en")
        expect(names).toEqual(["Help: Columns", "Help: Changes to orders", "Help: Cards"]);
    },
  );

  it("help off: no badge, and nothing moved", async () => {
    const { el } = await mount();
    const parts = () => [cards(el)[0]!, columnsButton(el), noticesHeading(el)];
    const off = parts().map(rect);
    for (const badge of allBadges(el)) {
      await badge.updateComplete;
      expect(badge.getBoundingClientRect().width).toBe(0);
    }
    await helpOn(el);
    expect(parts().map(rect)).toEqual(off);
  });
});
