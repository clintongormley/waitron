import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { DevicePassBoard, PassBoard, PassCard, PassCardItem, TillApi } from "../api/client.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "../widgets/test-helpers.js";
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

const stations = [
  { id: "st-1", name: "Grill", available: true },
  { id: "st-2", name: "Fryer", available: false },
];
const zones = [
  { id: "z-1", name: "Terrace", available: false },
  { id: "z-2", name: "Dining room", available: true },
];

/** Every dish detail the board draws: cross-station references of each kind, an extra, as-served
 * allergens, diet badges, the contains-meat chip and the "not reviewed" note, and a dish note. */
const detailed = {
  fresh: {
    crossRefs: [
      {
        kind: "with" as const,
        name: "CHIPS",
        perDish: 2,
        stationName: "Fryer",
        addAllergens: { gluten: { kinds: ["wheat" as const] } },
      },
      { kind: "for" as const, name: "BURG", stationName: "Grill" },
      { kind: "for" as const, name: "WATER", stationName: null },
    ],
    modifiers: [{ name: "GLUTEN FREE" }],
    asServed: { allergens: { milk: {} }, pending: false },
    asServedDiet: {
      vegan: "no" as const,
      vegetarian: "yes" as const,
      contains: [],
      halal: "yes" as const,
    },
  },
  forgotten: {
    asServed: { allergens: {}, pending: true },
    asServedDiet: {
      vegan: "unknown" as const,
      vegetarian: "unknown" as const,
      contains: ["meat" as const],
    },
    note: "rare inside",
  },
} satisfies Record<string, Partial<PassCardItem>>;

/** Requires the board to draw {@link detailed}'s details, so an axe run covers them. */
function expectDishDetails(root: ShadowRoot): void {
  expect(root.querySelectorAll("[data-crossref]")).toHaveLength(3);
  expect(root.querySelector(".item-modifiers .modifier")).not.toBeNull();
  expect(root.querySelector("[data-item-allergens] .allergen-chip")).not.toBeNull();
  expect(root.querySelector(".extra-allergens .allergen-chip")).not.toBeNull();
  expect(root.querySelector('[data-diet="vegetarian"]')).not.toBeNull();
  expect(root.querySelector('[data-diet="halal"]')).not.toBeNull();
  expect(root.querySelector('[data-diet-contains="meat"]')).not.toBeNull();
  expect(root.querySelector("[data-diet-pending]")).not.toBeNull();
  expect(root.querySelector("[data-note]")).not.toBeNull();
}

/** To fire, a fresh In progress card to mark ready, and a forgotten one. */
const populated = (): PassBoard =>
  passBoard({
    toFire: [
      passCard({
        key: "bill:wo-f",
        target: { kind: "bill", workingOrderId: "wo-f" },
        orders: [{ orderId: "wo-f", orderNumber: 3, tableLabel: "Table 2", kitchenNote: null }],
        items: [passItem({ id: "it-f", name: "Octopus", orderId: "wo-f", phase: "requested" })],
        releaseTicketItemIds: ["it-f"],
        releaseContext: "ctx-1",
      }),
    ],
    inProgress: [
      passCard({ items: [passItem({ id: "it-fresh", name: "Croquettes", ...detailed.fresh })] }),
      passCard({
        key: "bill:wo-old",
        target: { kind: "bill", workingOrderId: "wo-old" },
        requestedAt: minutesAgo(40),
        orders: [{ orderId: "wo-old", orderNumber: 4, tableLabel: "Table 5", kitchenNote: null }],
        items: [
          passItem({
            id: "it-old",
            name: "Salad",
            orderId: "wo-old",
            queuedAt: minutesAgo(40),
            requestedAt: minutesAgo(40),
            ...detailed.forgotten,
          }),
        ],
      }),
    ],
  });

const groupCard = (groupId: string, position: number, overrides: Partial<PassCard> = {}) =>
  passCard({
    key: `group:${groupId}`,
    target: { kind: "group", partyId: "v-7", groupId },
    kind: "next_course",
    party: { id: "v-7", revision: 3 },
    group: { displayNumber: position, position },
    orders: [{ orderId: "wo-p", orderNumber: 9, tableLabel: "Table 7", kitchenNote: null }],
    items: [passItem({ id: `it-${groupId}`, name: "Croquettes", orderId: "wo-p", course: null })],
    ...overrides,
  });

/** A seated party: a group cooking and a held one. */
const party = (): PassBoard =>
  passBoard({
    held: [
      groupCard("g-4", 4, {
        kind: "held",
        requestedAt: null,
        items: [
          passItem({
            id: "it-steak",
            name: "Sirloin",
            orderId: "wo-p",
            phase: "held",
            firedAt: null,
            requestedAt: null,
            course: null,
          }),
        ],
      }),
    ],
    inProgress: [groupCard("g-2", 2)],
  });

const read = (board: PassBoard, slots: Partial<DevicePassBoard> = {}): DevicePassBoard => ({
  board,
  stations: [],
  zones: null,
  display: { showNonPassStations: true, nonPassStationsOverride: null },
  ...slots,
});

const realSetTimeout = globalThis.setTimeout;

async function flush(el: TillPassScreen): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    await el.updateComplete;
    await el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")?.updateComplete;
  }
}

const inBoard = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.shadowRoot!;

/** Every element in `root` and in each shadow root below it. */
function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const node of root.querySelectorAll("*"))
    if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
  return found;
}

const base = { deviceId: "dev-1", serverOrigin: "https://box.local", now: PASS_NOW };

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await resetPage();
});

describe.each(["light", "dark"] as const)("till-pass-screen a11y (%s theme)", (theme) => {
  const mount = async (props: Partial<TillPassScreen>) => {
    const mounted = await mountWidget<TillPassScreen>(
      "till-pass-screen",
      { ...base, ...props },
      theme,
    );
    await flush(mounted.el);
    return mounted;
  };

  it("has no violations on a kitchen display's pass screen with its lost lines, levers and a refusal", async () => {
    const board = read(populated(), { stations, zones });
    const api = {
      getDevicePassBoard: vi.fn().mockResolvedValue(board),
      bumpDeviceBillReady: vi.fn().mockRejectedValue({ code: "device.forbidden_action" }),
    } as unknown as TillApi;
    const { el, host } = await mount({
      api,
      deviceMode: true,
      deviceName: "Pass screen",
      runsPass: true,
      initialBoard: board,
    });
    expect(inBoard(el).querySelector(".lever")).not.toBeNull();
    expect(inBoard(el).querySelector("[data-pass-fire]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
    expectDishDetails(inBoard(el));
    await expectNoA11yViolations(host);
    await userEvent.click(inBoard(el).querySelector<HTMLElement>("[data-ready]")!);
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-lever-error][role="alert"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a till's pass screen with its lost lines and levers", async () => {
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "dev-1",
        formFactor: "till",
        name: "Till 1",
        kitchenScreens: [{ kind: "pass", available: true, stations, zones }],
      }),
      getDevicePassBoard: vi.fn().mockResolvedValue(read(populated(), { stations, zones })),
    } as unknown as TillApi;
    const { el, host } = await mount({ api, runsPass: true });
    expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
    expect(inBoard(el).querySelector(".lever")).not.toBeNull();
    expectDishDetails(inBoard(el));
    await expectNoA11yViolations(host);
  });

  it("has no violations when a narrowing took a till's pass screen", async () => {
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "dev-1",
        formFactor: "till",
        name: "Till 1",
        kitchenScreens: [{ kind: "pass", available: false, stations: [], zones: null }],
      }),
      getDevicePassBoard: vi.fn().mockResolvedValue(read(passBoard())),
    } as unknown as TillApi;
    const { el, host } = await mount({ api });
    expect(el.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a till's All stations board with Ready and both age extremes", async () => {
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({ kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board: populated() }),
    } as unknown as TillApi;
    const { el, host } = await mount({ api, runsPass: true });
    expect(inBoard(el).querySelector(".age-forgotten")).not.toBeNull();
    expect(inBoard(el).querySelector(".lever")).not.toBeNull();
    expectDishDetails(inBoard(el));
    await expectNoA11yViolations(host);
  });

  it("has no violations on a card whose dishes were sent under other numbers", async () => {
    const board = passBoard({
      inProgress: [
        passCard({
          orders: [
            {
              orderId: "order-1",
              orderNumber: 27,
              formerNumbers: [28, 30],
              tableLabel: "T1",
              kitchenNote: null,
            },
          ],
        }),
      ],
    });
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({ kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board }),
    } as unknown as TillApi;
    const { el, host } = await mount({ api, runsPass: true });
    expect(inBoard(el).querySelector(".ticket-head .number")!.textContent).toContain("28, 30");
    await expectNoA11yViolations(host);
  });

  it("has no violations on a party's group cards with the table-changed notice", async () => {
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({ kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board: party() }),
      bumpGroupReady: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
    } as unknown as TillApi;
    const { el, host } = await mount({ api, runsPass: true });
    await userEvent.click(inBoard(el).querySelector<HTMLElement>('[data-group-ready="g-2"]')!);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-table-changed]")).not.toBeNull();
    expect(
      inBoard(el).querySelector(
        '[data-column="toFire"] [data-held-part] ~ [data-card="group:g-4"]',
      ),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a pass monitor with its lost lines, a party's group cards and a stale read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const board = read(passBoard({ ...party(), toFire: populated().toFire }), {
        stations,
        zones,
      });
      const api = {
        getDevicePassMonitorBoard: vi.fn().mockRejectedValue(new Error("offline")),
      } as unknown as TillApi;
      const { el, host } = await mountWidget<TillPassScreen>(
        "till-pass-screen",
        {
          ...base,
          api,
          deviceMode: true,
          monitor: true,
          deviceName: "Pass wall",
          runsPass: true,
          initialBoard: board,
        },
        theme,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      vi.useRealTimers();
      await flush(el);
      expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(inBoard(el).querySelector('[data-card="group:g-2"]')).not.toBeNull();
      await expectNoA11yViolations(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no violations on an empty pass", async () => {
    const api = {
      getDeviceIdentity: vi.fn().mockResolvedValue({ kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard() }),
    } as unknown as TillApi;
    const { el, host } = await mount({ api });
    expect(el.shadowRoot!.querySelector("[data-empty]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("the pass's help badges a11y (%s theme)", (theme) => {
  async function mount(width: number, monitor: boolean) {
    await pageAt(width, width === 390 ? 844 : 900);
    setHelpMode(true);
    const board = read(
      passBoard({
        inProgress: [
          passCard({
            items: [
              passItem({ id: "it-a", lineId: "line-a", ...detailed.fresh }),
              passItem({ id: "it-b", lineId: "line-b", ...detailed.forgotten }),
            ],
          }),
          groupCard("g-2", 2),
        ],
      }),
    );
    const mounted = await mountWidget<TillPassScreen>(
      "till-pass-screen",
      {
        ...base,
        api: {
          getDevicePassBoard: vi.fn(),
          getDevicePassMonitorBoard: vi.fn(),
        } as unknown as TillApi,
        deviceMode: true,
        monitor,
        deviceName: "Pass",
        runsPass: true,
        reducedMotion: true,
        initialBoard: board,
      },
      theme,
    );
    mounted.host.style.setProperty("--wt-help-badge-target", "32px");
    mounted.host.style.setProperty("--wt-help-badge-size", "24px");
    await flush(mounted.el);
    return mounted;
  }

  const shown = async (el: TillPassScreen) => {
    const badges = deepQueryAll(el.shadowRoot!, "wt-help-tooltip") as WtHelpTooltip[];
    for (const badge of badges) await badge.updateComplete;
    return badges.filter((badge) => badge.getBoundingClientRect().width > 0);
  };

  // A pass shows its card's, its first Ready's and Columns' badges; a monitor has no lever.
  it.each([
    [1280, "a pass with levers", false, 3],
    [390, "a pass with levers", false, 3],
    [1280, "a monitor", true, 2],
    [390, "a monitor", true, 2],
  ] as const)("help on at %i on %s has no violations", async (width, _, monitor, badges) => {
    const { el, host } = await mount(width, monitor);
    expect(await shown(el)).toHaveLength(badges);
    expectDishDetails(inBoard(el));
    await expectNoA11yViolations(host);
  });
});
