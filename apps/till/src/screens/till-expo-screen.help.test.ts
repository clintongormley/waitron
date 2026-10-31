import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type {
  DeviceIdentity,
  ExpoCourse,
  ExpoGroup,
  ExpoItem,
  ExpoOrder,
  TillApi,
  WatcherOrder,
} from "../api/client.js";
import { helpBadgeLabel, helpEn, helpEs, helpText } from "../i18n/help-strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import "./till-expo-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const FIRED = "2026-08-17T10:00:00.000Z";
const NOW = Date.parse(FIRED) + 2 * 60_000;

function item(id: string, name: string, state: ExpoItem["state"] = "preparing"): ExpoItem {
  return {
    allergy: null,
    id,
    name,
    qty: "1.000",
    stationName: "Cocina",
    state,
    firedAt: FIRED,
    queuedAt: FIRED,
    thresholds: THRESHOLDS,
    band: "fresh",
  };
}

function course(courseId: string, courseName: string, items: ExpoItem[]): ExpoCourse {
  return { courseId, courseName, displayOrder: 0, fired: true, items };
}

function order(orderNumber: number, courses: ExpoCourse[]): ExpoOrder {
  return {
    kitchenNote: null,
    orderId: `wo-${orderNumber}`,
    orderNumber,

    openedMinutes: 3,
    worstBand: "fresh",
    courses,
  };
}

// Two cards side by side at 1280, three Course ready levers: two on the first card, one on the second.
const courseBoard = (): ExpoOrder[] => [
  order(5, [
    course("co-1", "Entrantes", [item("ti-1", "Croquetas")]),
    { ...course("co-2", "Principales", [item("ti-2", "Merluza", "queued")]), displayOrder: 1 },
  ]),
  order(6, [course("co-3", "Postres", [item("ti-3", "Flan")])]),
];

function group(groupId: string, position: number, items: ExpoItem[]): ExpoGroup {
  return {
    groupId,
    position,
    displayNumber: position,
    numberPartyId: "v-4",
    state: "fired",
    fired: true,
    items,
  };
}

// A table's bill with two fired groups, neither ready: two Group ready levers on one card.
const groupBoard = (): ExpoOrder[] => [
  {
    ...order(9, []),
    tableLabel: "Mesa 4",
    party: { id: "v-4", revision: 7 },
    groups: [group("g-1", 1, [item("it-1", "Caña")]), group("g-2", 2, [item("it-2", "Croquetas")])],
  },
];

// One card whose dish name is long enough to make the card as wide as a phone's screen.
const wideBoard = (): ExpoOrder[] => [
  order(7, [
    course("co-9", "Entrantes", [
      item("ti-9", "Croquetas caseras de jamón ibérico con alioli de ajo negro y perejil fresco"),
    ]),
  ]),
];

function asPassOrder(expo: ExpoOrder): WatcherOrder {
  const allReady = (items: ExpoItem[]) => items.every((one) => one.state === "ready");
  return {
    ...expo,
    courses: expo.courses.map((one) => ({ ...one, allReady: allReady(one.items) })),
    groups: (expo.groups ?? []).map((one) => ({ ...one, allReady: allReady(one.items) })),
  };
}

const identity = (kind: "pass" | "pass_monitor"): DeviceIdentity => ({
  deviceId: "dev-1",
  formFactor: "till",
  name: "Till 1",
  kitchenScreens: [{ kind, available: true, stations: [], zones: null }],
});

function stubApi(orders: ExpoOrder[], overrides: Record<string, unknown> = {}) {
  return {
    getExpoQueue: vi.fn().mockResolvedValue(orders),
    getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity("pass"), kitchenScreens: [] }),
    getDevicePassScreen: vi
      .fn()
      .mockResolvedValue({ orders: orders.map(asPassOrder), stations: [], zones: null }),
    getDevicePassMonitor: vi.fn().mockResolvedValue({ orders, stations: [], zones: null }),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    bumpDeviceCourseReady: vi.fn().mockResolvedValue(undefined),
    bumpGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    bumpDeviceGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi & Record<string, ReturnType<typeof vi.fn>>;
}

const realSetTimeout = globalThis.setTimeout;

async function mount(props: Partial<TillExpoScreen>) {
  const { el, host } = await mountWidget<TillExpoScreen>("till-expo-screen", {
    now: NOW,
    reducedMotion: true,
    ...props,
  });
  // The till's shell sets the badge's size; a screen mounted alone takes the dashboard's.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
  return { el, host };
}

/** A kitchen screen's pass, where the pass is run. */
const mountPass = (orders: ExpoOrder[] = courseBoard()) => {
  const api = stubApi(orders);
  return mount({
    api,
    deviceMode: true,
    deviceName: "Pase",
    runsPass: true,
    initialDevicePass: { orders: orders.map(asPassOrder), stations: [], zones: null },
  }).then((mounted) => ({ ...mounted, api }));
};

/** A kitchen screen's pass monitor. */
const mountMonitor = (orders: ExpoOrder[] = courseBoard()) =>
  mount({
    api: stubApi(orders),
    deviceMode: true,
    monitor: true,
    deviceName: "Pared",
    runsPass: true,
    initialDevicePassMonitor: { orders, stations: [], zones: null },
  });

/** A till's or handheld's Pass, inside its card host. */
const mountEmbedded = (orders: ExpoOrder[] = courseBoard()) => {
  const api = stubApi(orders);
  return mount({ api, embedded: true, runsPass: true }).then((mounted) => ({ ...mounted, api }));
};

/** A till whose device chose a pass monitor. */
const mountTillMonitor = (orders: ExpoOrder[] = courseBoard()) =>
  mount({
    api: stubApi(orders, {
      getDeviceIdentity: vi.fn().mockResolvedValue(identity("pass_monitor")),
    }),
    runsPass: true,
  });

const shadow = (el: TillExpoScreen) => el.shadowRoot!;
const cards = (el: TillExpoScreen) => [
  ...shadow(el).querySelectorAll<HTMLElement>("article.order"),
];
const levers = (el: TillExpoScreen) => [
  ...shadow(el).querySelectorAll<HTMLElement>("button.lever"),
];
const allBadges = (el: TillExpoScreen) => [
  ...shadow(el).querySelectorAll<WtHelpTooltip>("wt-help-tooltip"),
];
const badgeFor = (el: TillExpoScreen, part: string) =>
  shadow(el).querySelector<WtHelpTooltip>(`wt-help-tooltip[aria-label="${helpBadgeLabel(part)}"]`);
const cardBadge = (el: TillExpoScreen) => badgeFor(el, helpText("help.pass.cards_part"));
const cardsWithBadge = (el: TillExpoScreen) =>
  cards(el).filter((card) => card.querySelector(":scope > wt-help-tooltip") !== null);
const leversWithBadge = (el: TillExpoScreen) =>
  levers(el).filter(
    (lever) => lever.parentElement!.querySelector(":scope > wt-help-tooltip") !== null,
  );
const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");
const rect = (box: Element) => {
  const { left, top, width, height } = box.getBoundingClientRect();
  return { left, top, width, height };
};

async function settle(el: TillExpoScreen): Promise<void> {
  await el.updateComplete;
  for (const badge of allBadges(el)) await badge.updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function helpOn(el: TillExpoScreen): Promise<void> {
  setHelpMode(true);
  await settle(el);
}

/** Every element in `root` and in each shadow root below it. */
function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const node of root.querySelectorAll("*"))
    if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
  return found;
}

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

describe("the pass's help badges", () => {
  it.each([
    ["a pass", mountPass],
    ["a monitor", mountMonitor],
    ["a till's Pass", mountEmbedded],
  ] as const)(
    "with help on, the first order card has a badge and no other card does (%s)",
    async (_, mountOne) => {
      const { el } = await mountOne();
      await helpOn(el);
      expect(cards(el)).toHaveLength(2);
      expect(cardsWithBadge(el)).toEqual([cards(el)[0]]);
      expect(cardBadge(el)!.getBoundingClientRect().width).toBeGreaterThan(0);
    },
  );

  it("the first order card's badge hangs over that card's top edge, inside its trailing edge", async () => {
    const { el } = await mountPass();
    await helpOn(el);
    const [first, second] = cards(el);
    // Side by side, so a badge hung from the board or the screen would not sit on the first card.
    expect(second!.getBoundingClientRect().top).toBeCloseTo(first!.getBoundingClientRect().top, 0);
    const at = cardBadge(el)!.getBoundingClientRect();
    const box = first!.getBoundingClientRect();
    expect(at.width).toBeGreaterThan(0);
    expect(at.top).toBeLessThan(box.top);
    expect(at.bottom).toBeGreaterThan(box.top);
    expect(at.right).toBeLessThanOrEqual(box.right + 0.5);
    expect(at.right).toBeGreaterThan(box.right - at.width);
  });

  it.each([
    { lang: "en", text: helpEn },
    { lang: "es", text: helpEs },
  ])(
    "its box says the card's text and links to /help/<language>/kitchen-service#service-lifetime ($lang)",
    async ({ lang, text }) => {
      setLocale(lang);
      const { el } = await mountPass();
      await helpOn(el);
      const badge = cardBadge(el)!;
      expect(badge.mode).toBe("help-mode");
      expect(badge.textContent).toBe(text["help.pass.card"]);
      await userEvent.click(badge.shadowRoot!.querySelector("button")!);
      expect(isOpen(badge)).toBe(true);
      const link = badge.shadowRoot!.querySelector<HTMLAnchorElement>('[part="guide"]')!;
      expect(link.getAttribute("href")).toBe(`/help/${lang}/kitchen-service#service-lifetime`);
      expect(link.textContent).toBe(text["help.guide_link"]);
    },
  );

  it.each([
    { kind: "course", board: courseBoard, label: "expo.ready", count: 3 },
    { kind: "group", board: groupBoard, label: "expo.group_ready", count: 2 },
  ] as const)(
    "where the pass is run, the first $kind ready has a badge and no other lever does",
    async ({ board, label, count }) => {
      const { el } = await mountPass(board());
      await helpOn(el);
      expect(levers(el)).toHaveLength(count);
      expect(leversWithBadge(el)).toEqual([levers(el)[0]]);
      const badge = badgeFor(el, t(label))!;
      expect(badge.textContent).toBe(helpEn["help.pass.ready"]);
      const at = badge.getBoundingClientRect();
      const lever = levers(el)[0]!.getBoundingClientRect();
      expect(at.width).toBeGreaterThan(0);
      expect(at.top).toBeLessThan(lever.top);
      expect(at.bottom).toBeGreaterThan(lever.top);
      expect(at.right).toBeLessThanOrEqual(lever.right + 0.5);
      expect(at.right).toBeGreaterThan(lever.right - at.width);
    },
  );

  it.each([
    ["a monitor", mountMonitor],
    ["a till whose device chose a pass monitor", mountTillMonitor],
  ] as const)("%s has the card's badge and no lever's", async (_, mountOne) => {
    const { el } = await mountOne();
    await helpOn(el);
    expect(cards(el)).toHaveLength(2);
    expect(levers(el)).toEqual([]);
    expect(allBadges(el)).toEqual([cardBadge(el)]);
  });

  it("with help on, a monitor's only buttons are help badges", async () => {
    const { el } = await mountMonitor([...courseBoard(), ...groupBoard()]);
    await helpOn(el);
    const buttons = deepQueryAll(shadow(el), "button, wt-button, [role='button']");
    expect(buttons.length).toBeGreaterThan(0);
    for (const match of buttons)
      expect((match.getRootNode() as ShadowRoot).host.localName).toBe("wt-help-tooltip");
  });

  it.each([
    ["a pass", mountPass],
    ["a monitor", mountMonitor],
    ["a till's Pass", mountEmbedded],
  ] as const)(
    "with help off, the screen draws no wt-help-tooltip at all (%s)",
    async (_, mountOne) => {
      const { el } = await mountOne();
      await settle(el);
      expect(cards(el)).toHaveLength(2);
      expect(deepQueryAll(shadow(el), "wt-help-tooltip")).toEqual([]);
    },
  );

  it("a tap on the lever's badge does not press the lever", async () => {
    const { el, api } = await mountPass();
    await helpOn(el);
    const badge = badgeFor(el, t("expo.ready"))!;
    await userEvent.click(badge.shadowRoot!.querySelector("button")!);
    expect(isOpen(badge)).toBe(true);
    expect(api.bumpDeviceCourseReady).not.toHaveBeenCalled();
    expect(api.bumpCourseReady).not.toHaveBeenCalled();
  });

  it("the first lever still marks its course ready with help on", async () => {
    const { el, api } = await mountPass();
    await helpOn(el);
    await userEvent.click(levers(el)[0]!);
    expect(api.bumpDeviceCourseReady).toHaveBeenCalledWith("wo-5", "co-1");
  });

  it("the first lever is as wide with help on as off, and as wide as its course", async () => {
    const { el } = await mountPass();
    const off = levers(el)[0]!.getBoundingClientRect().width;
    await helpOn(el);
    const lever = levers(el)[0]!;
    expect(lever.getBoundingClientRect().width).toBeCloseTo(off, 1);
    const section = lever.closest<HTMLElement>(".course")!;
    expect(lever.getBoundingClientRect().width).toBeCloseTo(
      section.getBoundingClientRect().width,
      1,
    );
  });

  it("at 390 no badge reaches past the window and the page does not scroll sideways", async () => {
    await pageAt(390, 844);
    const { el } = await mountEmbedded(wideBoard());
    await helpOn(el);
    const card = cards(el)[0]!;
    const board = shadow(el).querySelector<HTMLElement>(".board")!;
    expect(card.getBoundingClientRect().width).toBeCloseTo(board.getBoundingClientRect().width, 0);
    const shown = allBadges(el).filter((badge) => badge.getBoundingClientRect().width > 0);
    expect(shown).toHaveLength(2);
    for (const badge of shown)
      expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("help off: nothing moved", async () => {
    const { el } = await mountPass();
    const parts = () => [cards(el)[0]!, levers(el)[0]!];
    const off = parts().map(rect);
    await helpOn(el);
    expect(allBadges(el)).toHaveLength(2);
    expect(parts().map(rect)).toEqual(off);
  });
});
