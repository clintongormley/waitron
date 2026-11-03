import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { DeviceIdentity, PassBoard, PassCard, TillApi } from "../api/client.js";
import { helpBadgeLabel, helpEn, helpEs, helpText } from "../i18n/help-strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";

const course = (id: string, name: string) => ({ id, name, displayOrder: 0 });

function billCard(orderNumber: number, dishes: [string, string, string][]): PassCard {
  const orderId = `wo-${orderNumber}`;
  return passCard({
    key: `bill:${orderId}`,
    target: { kind: "bill", workingOrderId: orderId },
    orders: [{ orderId, orderNumber, kitchenNote: null }],
    items: dishes.map(([id, name, courseId]) =>
      passItem({
        id,
        name,
        orderId,
        state: "preparing",
        phase: "preparing",
        course: course(courseId, courseId),
      }),
    ),
  });
}

function groupCard(groupId: string, position: number, dish: string): PassCard {
  return passCard({
    key: `group:${groupId}`,
    target: { kind: "group", partyId: "v-4", groupId },
    kind: "next_course",
    party: { id: "v-4", revision: 7 },
    group: { displayNumber: position, position },
    orders: [{ orderId: "wo-9", orderNumber: 9, tableLabel: "Mesa 4", kitchenNote: null }],
    items: [passItem({ id: `it-${groupId}`, name: dish, orderId: "wo-9", course: null })],
  });
}

// Two cards, three course Ready levers: two on the first card, one on the second.
const courseBoard = (): PassBoard =>
  passBoard({
    inProgress: [
      billCard(5, [
        ["ti-1", "Croquetas", "co-1"],
        ["ti-2", "Merluza", "co-2"],
      ]),
      billCard(6, [["ti-3", "Flan", "co-3"]]),
    ],
  });

// A table's two group cards, neither ready: two group Ready levers.
const groupBoard = (): PassBoard =>
  passBoard({ inProgress: [groupCard("g-1", 1, "Caña"), groupCard("g-2", 2, "Croquetas")] });

// Two cards in two columns, so they sit side by side at 1280.
const sideBySide = (): PassBoard => {
  const ready = billCard(6, [["ti-3", "Flan", "co-3"]]);
  return passBoard({
    inProgress: [billCard(5, [["ti-1", "Croquetas", "co-1"]])],
    ready: [
      {
        ...ready,
        allReady: true,
        readyAt: minutesAgo(1),
        items: ready.items.map((item) => ({ ...item, state: "ready", phase: "ready" })),
      },
    ],
  });
};

// One card whose dish name is long enough to make the card as wide as a phone's screen.
const wideBoard = (): PassBoard =>
  passBoard({
    inProgress: [
      billCard(7, [
        [
          "ti-9",
          "Croquetas caseras de jamón ibérico con alioli de ajo negro y perejil fresco",
          "co-9",
        ],
      ]),
    ],
  });

const identity = (kind: "pass" | "pass_monitor"): DeviceIdentity => ({
  deviceId: "dev-1",
  formFactor: "till",
  name: "Till 1",
  kitchenScreens: [{ kind, available: true, stations: [], zones: null }],
});

function stubApi(board: PassBoard, overrides: Record<string, unknown> = {}) {
  const read = { board, stations: [], zones: null };
  return {
    getExpoBoard: vi.fn().mockResolvedValue({ board }),
    getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity("pass"), kitchenScreens: [] }),
    getDevicePassBoard: vi.fn().mockResolvedValue(read),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(read),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    bumpDeviceCourseReady: vi.fn().mockResolvedValue(undefined),
    bumpGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    bumpDeviceGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi & Record<string, ReturnType<typeof vi.fn>>;
}

const realSetTimeout = globalThis.setTimeout;

const boardOf = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!;
const inBoard = (el: TillPassScreen) => boardOf(el).shadowRoot!;

async function mount(props: Partial<TillPassScreen>) {
  const { el, host } = await mountWidget<TillPassScreen>("till-pass-screen", {
    now: PASS_NOW,
    reducedMotion: true,
    deviceId: "dev-1",
    serverOrigin: "https://box.local",
    ...props,
  });
  // The till's shell sets the badge's size; a screen mounted alone takes the dashboard's.
  host.style.setProperty("--wt-help-badge-target", "32px");
  host.style.setProperty("--wt-help-badge-size", "24px");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-pass-board")).not.toBeNull());
  await vi.waitFor(() => expect(inBoard(el).querySelector("[data-card]")).not.toBeNull());
  await settle(el);
  return { el, host };
}

/** A kitchen display's pass, where the pass is run. */
const mountPass = (board: PassBoard = courseBoard()) => {
  const api = stubApi(board);
  return mount({
    api,
    deviceMode: true,
    deviceName: "Pase",
    runsPass: true,
    initialBoard: { board, stations: [], zones: null },
  }).then((mounted) => ({ ...mounted, api }));
};

/** A kitchen display's pass monitor. */
const mountMonitor = (board: PassBoard = courseBoard()) =>
  mount({
    api: stubApi(board),
    deviceMode: true,
    monitor: true,
    deviceName: "Pared",
    runsPass: true,
    initialBoard: { board, stations: [], zones: null },
  });

/** A till's or handheld's Pass, inside its card host. */
const mountEmbedded = (board: PassBoard = courseBoard()) => {
  const api = stubApi(board);
  return mount({ api, embedded: true, runsPass: true }).then((mounted) => ({ ...mounted, api }));
};

/** A till whose device chose a pass monitor. */
const mountTillMonitor = (board: PassBoard = courseBoard()) =>
  mount({
    api: stubApi(board, {
      getDeviceIdentity: vi.fn().mockResolvedValue(identity("pass_monitor")),
    }),
    runsPass: true,
  });

const cards = (el: TillPassScreen) => [
  ...inBoard(el).querySelectorAll<HTMLElement>("article[data-card]"),
];
const levers = (el: TillPassScreen) => [
  ...inBoard(el).querySelectorAll<HTMLElement>("button.lever"),
];

/** Every element in `root` and in each shadow root below it. */
function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const node of root.querySelectorAll("*"))
    if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
  return found;
}

const allBadges = (el: TillPassScreen) =>
  deepQueryAll(el.shadowRoot!, "wt-help-tooltip") as WtHelpTooltip[];
const badgeFor = (el: TillPassScreen, part: string) =>
  allBadges(el).find((badge) => badge.getAttribute("aria-label") === helpBadgeLabel(part));
const cardBadge = (el: TillPassScreen) => badgeFor(el, helpText("help.kitchen.cards_part"));
const columnsBadge = (el: TillPassScreen) => badgeFor(el, t("station.columns"));
const cardsWithBadge = (el: TillPassScreen) =>
  cards(el).filter((card) => card.querySelector(":scope > wt-help-tooltip") !== null);
/** A lever whose own Ready badge sits beside it; the card's badge also sits beside a lever. */
const leversWithBadge = (el: TillPassScreen) =>
  levers(el).filter((lever) =>
    [...lever.parentElement!.querySelectorAll(":scope > wt-help-tooltip")].some(
      (badge) => badge.textContent === helpText("help.pass.ready"),
    ),
  );
const isOpen = (badge: WtHelpTooltip) =>
  badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open");
const rect = (box: Element) => {
  const { left, top, width, height } = box.getBoundingClientRect();
  return { left, top, width, height };
};

/** A button that is a column heading's open-or-close toggle, or Columns itself. */
const isBoardControl = (button: Element) =>
  button.matches("[data-columns-open], [data-column-toggle]");

async function settle(el: TillPassScreen): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")?.updateComplete;
  for (const badge of allBadges(el)) await badge.updateComplete;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function helpOn(el: TillPassScreen): Promise<void> {
  setHelpMode(true);
  await settle(el);
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

describe("A773 pass screen: help badges", () => {
  it.each([
    ["a pass", mountPass],
    ["a monitor", mountMonitor],
    ["a till's Pass", mountEmbedded],
  ] as const)(
    "with help on, the first card has a badge and no other card does (%s)",
    async (_, mountOne) => {
      const { el } = await mountOne();
      await helpOn(el);
      expect(cards(el)).toHaveLength(2);
      expect(cardsWithBadge(el)).toEqual([cards(el)[0]]);
      expect(cardBadge(el)!.getBoundingClientRect().width).toBeGreaterThan(0);
    },
  );

  it("the first card's badge hangs over that card's top edge, inside its trailing edge", async () => {
    const { el } = await mountPass(sideBySide());
    await helpOn(el);
    const [first, second] = cards(el);
    // Side by side, so a badge hung from the board or the screen would not sit on the first card.
    expect(second!.getBoundingClientRect().top).toBeCloseTo(first!.getBoundingClientRect().top, 0);
    expect(second!.getBoundingClientRect().left).toBeGreaterThan(
      first!.getBoundingClientRect().right,
    );
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
    "the card's box says the card's text and links to /help/<language>/kitchen-service#pass-screen ($lang)",
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
      expect(link.getAttribute("href")).toBe(`/help/${lang}/kitchen-service#pass-screen`);
      expect(link.textContent).toBe(text["help.guide_link"]);
    },
  );

  it.each([
    { kind: "course", board: courseBoard, label: "expo.ready", count: 3 },
    { kind: "group", board: groupBoard, label: "expo.group_ready", count: 2 },
  ] as const)(
    "where the pass is run, the first $kind Ready has a badge and no other lever does",
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
  ] as const)("%s has the card's and Columns' badges and no lever's", async (_, mountOne) => {
    const { el } = await mountOne();
    await helpOn(el);
    expect(cards(el)).toHaveLength(2);
    expect(levers(el)).toEqual([]);
    expect(new Set(allBadges(el))).toEqual(new Set([cardBadge(el), columnsBadge(el)]));
    expect(allBadges(el)).toHaveLength(2);
  });

  it("with help on, a monitor's only buttons are help badges, Columns and its column headings", async () => {
    const { el } = await mountMonitor(
      passBoard({ inProgress: [...courseBoard().inProgress, ...groupBoard().inProgress] }),
    );
    await helpOn(el);
    const buttons = deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']");
    const badgeButtons = buttons.filter(
      (match) => (match.getRootNode() as ShadowRoot).host.localName === "wt-help-tooltip",
    );
    expect(badgeButtons.length).toBeGreaterThan(0);
    for (const match of buttons) {
      const host = (match.getRootNode() as ShadowRoot).host;
      if (host.localName === "wt-help-tooltip") continue;
      const control = host.localName === "wt-button" ? host : match;
      expect(isBoardControl(control)).toBe(true);
    }
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
      expect(deepQueryAll(el.shadowRoot!, "wt-help-tooltip")).toEqual([]);
    },
  );

  it("with help off, a monitor has no badge button: its only buttons are Columns and its column headings", async () => {
    const { el } = await mountMonitor();
    await settle(el);
    const buttons = deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']");
    expect(buttons.length).toBeGreaterThan(0);
    for (const match of buttons) {
      const host = (match.getRootNode() as ShadowRoot).host;
      expect(host.localName).not.toBe("wt-help-tooltip");
      expect(isBoardControl(host.localName === "wt-button" ? host : match)).toBe(true);
    }
  });

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

  it("the first lever is as wide with help on as off, and as wide as the card's next lever", async () => {
    const { el } = await mountPass();
    const off = levers(el)[0]!.getBoundingClientRect().width;
    await helpOn(el);
    const [first, second] = levers(el);
    expect(first!.getBoundingClientRect().width).toBeCloseTo(off, 1);
    expect(first!.closest("[data-card]")).toBe(second!.closest("[data-card]"));
    expect(first!.getBoundingClientRect().width).toBeCloseTo(
      second!.getBoundingClientRect().width,
      1,
    );
  });

  it("at 390 no badge reaches past the window and the page does not scroll sideways", async () => {
    await pageAt(390, 844);
    const { el } = await mountEmbedded(wideBoard());
    await helpOn(el);
    const card = cards(el)[0]!;
    expect(card.getBoundingClientRect().width).toBeCloseTo(
      boardOf(el).getBoundingClientRect().width,
      0,
    );
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    const shown = allBadges(el).filter((badge) => badge.getBoundingClientRect().width > 0);
    expect(new Set(shown)).toEqual(
      new Set([cardBadge(el), badgeFor(el, t("expo.ready")), columnsBadge(el)]),
    );
    for (const badge of shown)
      expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("help off: nothing moved", async () => {
    const { el } = await mountPass();
    const parts = () => [cards(el)[0]!, levers(el)[0]!];
    const off = parts().map(rect);
    await helpOn(el);
    expect(allBadges(el)).toHaveLength(3);
    expect(parts().map(rect)).toEqual(off);
  });
});
