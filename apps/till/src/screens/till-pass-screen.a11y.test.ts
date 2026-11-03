import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { DevicePassBoard, PassBoard, PassCard, TillApi } from "../api/client.js";
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
  { id: "st-1", name: "Parrilla", available: true },
  { id: "st-2", name: "Freidora", available: false },
];
const zones = [
  { id: "z-1", name: "Terraza", available: false },
  { id: "z-2", name: "Sala", available: true },
];

/** To fire, a fresh In progress card with a course to mark ready, and a forgotten one. */
const populated = (): PassBoard =>
  passBoard({
    toFire: [
      passCard({
        key: "bill:wo-f",
        target: { kind: "bill", workingOrderId: "wo-f" },
        orders: [{ orderId: "wo-f", orderNumber: 3, tableLabel: "Mesa 2", kitchenNote: null }],
        items: [passItem({ id: "it-f", name: "Pulpo", orderId: "wo-f", phase: "requested" })],
        releaseTicketItemIds: ["it-f"],
        releaseContext: "ctx-1",
      }),
    ],
    inProgress: [
      passCard({ items: [passItem({ id: "it-fresh", name: "Croquetas" })] }),
      passCard({
        key: "bill:wo-old",
        target: { kind: "bill", workingOrderId: "wo-old" },
        requestedAt: minutesAgo(40),
        orders: [{ orderId: "wo-old", orderNumber: 4, tableLabel: "Mesa 5", kitchenNote: null }],
        items: [
          passItem({
            id: "it-old",
            name: "Ensalada",
            orderId: "wo-old",
            queuedAt: minutesAgo(40),
            requestedAt: minutesAgo(40),
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
    orders: [{ orderId: "wo-p", orderNumber: 9, tableLabel: "Mesa 7", kitchenNote: null }],
    items: [passItem({ id: `it-${groupId}`, name: "Croquetas", orderId: "wo-p", course: null })],
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
            name: "Solomillo",
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
      bumpDeviceCourseReady: vi.fn().mockRejectedValue({ code: "device.forbidden_action" }),
    } as unknown as TillApi;
    const { el, host } = await mount({
      api,
      deviceMode: true,
      deviceName: "Pantalla Pase",
      runsPass: true,
      initialBoard: board,
    });
    expect(inBoard(el).querySelector(".lever")).not.toBeNull();
    expect(inBoard(el).querySelector("[data-pass-fire]")).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
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
      inBoard(el).querySelector('[data-column="held"] [data-card="group:g-4"]'),
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
          deviceName: "Pared del pase",
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
    const board = read(passBoard({ inProgress: [passCard(), groupCard("g-2", 2)] }));
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
        deviceName: "Pase",
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
    await expectNoA11yViolations(host);
  });
});
