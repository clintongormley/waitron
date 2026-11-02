import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import { codeMessage } from "../i18n/codes.js";
import { helpBadgeLabel, helpEn, helpEs, helpText } from "../i18n/help-strings.js";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type {
  DeviceIdentity,
  DevicePassBoard,
  PassBoard,
  PassCard,
  TillApi,
} from "../api/client.js";
import { PASS_NOW, passBoard, passCard, passItem } from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An In progress group card of Table T7's party, at revision 7. */
const groupCard = (overrides: Partial<PassCard> = {}): PassCard =>
  passCard({
    key: "group:g-1",
    target: { kind: "group", partyId: "p-1", groupId: "g-1" },
    kind: "next_course",
    party: { id: "p-1", revision: 7 },
    orders: [{ orderId: "order-7", orderNumber: 7, tableLabel: "T7", kitchenNote: null }],
    group: { displayNumber: 1, position: 1 },
    items: [passItem({ id: "g-a", orderId: "order-7" })],
    ...overrides,
  });

/** An In progress To fire card, so a Fire refusal can be set beside a Ready one. */
const fireCard = (): PassCard =>
  passCard({
    key: "group:g-2",
    target: { kind: "group", partyId: "p-1", groupId: "g-2" },
    kind: "next_course",
    items: [passItem({ id: "f-a", phase: "requested", firedAt: null })],
    releaseTicketItemIds: ["f-a"],
    releaseContext: "ctx-1",
  });

const leverBoard = (): PassBoard =>
  passBoard({ toFire: [fireCard()], inProgress: [groupCard(), passCard()] });
const deviceBoard = (board: PassBoard = leverBoard()): DevicePassBoard => ({
  board,
  stations: [],
  zones: null,
});

const identity = (): DeviceIdentity => ({
  deviceId: "dev-1",
  formFactor: "till",
  name: "Till 1",
  kitchenScreens: [{ kind: "pass", available: true, stations: [], zones: null }],
});

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = TillApi &
  Record<
    | "getDevicePassBoard"
    | "bumpDeviceGroupReady"
    | "bumpGroupReady"
    | "bumpDeviceCourseReady"
    | "bumpCourseReady"
    | "reprintOrder",
    Fn
  >;

function fakeApi(overrides: Record<string, unknown> = {}): FakeApi {
  return {
    getDeviceIdentity: vi.fn().mockResolvedValue(identity()),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getExpoBoard: vi.fn().mockResolvedValue({ board: leverBoard() }),
    releaseDevicePass: vi.fn().mockResolvedValue({ releasedTicketItemIds: ["f-a"] }),
    bumpDeviceGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    bumpGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
    bumpDeviceCourseReady: vi.fn().mockResolvedValue(undefined),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FakeApi;
}

const realSetTimeout = globalThis.setTimeout;
async function flush(el: TillPassScreen): Promise<void> {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    await el.updateComplete;
    await boardOf(el)?.updateComplete;
  }
}

async function mount(props: Partial<TillPassScreen>): Promise<TillPassScreen> {
  const { el } = await mountWidget<TillPassScreen>("till-pass-screen", {
    runsPass: true,
    deviceId: "dev-1",
    serverOrigin: "https://box.local",
    now: PASS_NOW,
    reducedMotion: false,
    ...props,
  });
  await flush(el);
  return el;
}

/** A kitchen display's pass, handed its board, so every read after connect is one a press caused. */
const mountDisplay = (api: FakeApi) =>
  mount({ api, deviceMode: true, deviceName: "Pase", initialBoard: deviceBoard() });
const mountTill = (api: FakeApi) => mount({ api });
const mountMonitor = (api: FakeApi) =>
  mount({ api, deviceMode: true, monitor: true, initialBoard: deviceBoard() });

const surfaces = [
  {
    where: "a kitchen display",
    mountOne: mountDisplay,
    group: "bumpDeviceGroupReady",
    course: "bumpDeviceCourseReady",
  },
  { where: "a till", mountOne: mountTill, group: "bumpGroupReady", course: "bumpCourseReady" },
] as const;

const boardOf = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board");
const inBoard = <T extends Element>(el: TillPassScreen, selector: string) =>
  boardOf(el)!.shadowRoot!.querySelector<T>(selector);
const tableChanged = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-table-changed]");
const leverError = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-lever-error]");
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim();

async function press(el: TillPassScreen, selector: string): Promise<void> {
  await userEvent.click(inBoard<HTMLElement>(el, selector)!);
  await flush(el);
}

/** Every element in `root` and in each shadow root below it. */
function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const node of root.querySelectorAll("*"))
    if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
  return found;
}

const badges = (el: TillPassScreen) =>
  deepQueryAll(el.shadowRoot!, "wt-help-tooltip") as WtHelpTooltip[];
const badgeFor = (el: TillPassScreen, part: string) =>
  badges(el).find((badge) => badge.getAttribute("aria-label") === helpBadgeLabel(part));

const refused = (code: string, status = 409) => ({ code, status });

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

describe("A773 pass screen: levers", () => {
  it.each(surfaces)(
    "Group Ready on $where sends the card's party, group and revision, then reloads",
    async ({ mountOne, group }) => {
      const api = fakeApi();
      const el = await mountOne(api);
      const reads = api.getDevicePassBoard.mock.calls.length;
      await press(el, '[data-group-ready="g-1"]');
      expect(api[group]).toHaveBeenCalledExactlyOnceWith("p-1", "g-1", {
        submissionId: expect.stringMatching(UUID),
        expectedPartyRevision: 7,
      });
      expect(api.getDevicePassBoard).toHaveBeenCalledTimes(reads + 1);
    },
  );

  it.each(surfaces)(
    "Group Ready refused party.out_of_date on $where names the table beside the refresh sentence",
    async ({ mountOne, group }) => {
      const api = fakeApi({ [group]: vi.fn().mockRejectedValue(refused("party.out_of_date")) });
      const el = await mountOne(api);
      await press(el, '[data-group-ready="g-1"]');
      expect(text(tableChanged(el))).toBe(
        `${t("station.table_changed_named").replace("{table}", "T7")} ${t("station.table_changed")}`,
      );
      expect(leverError(el)).toBeNull();
    },
  );

  it("Fire's refresh sentence names no table", async () => {
    const api = fakeApi({
      releaseDevicePass: vi.fn().mockRejectedValue(refused("ticket.pass_context_changed")),
    });
    const el = await mountDisplay(api);
    await press(el, '[data-pass-fire="group:g-2"]');
    expect(text(tableChanged(el))).toBe(t("station.table_changed"));
  });

  it.each(surfaces)(
    "another Ready refusal on $where shows the card's label and the code's words",
    async ({ mountOne, group, course }) => {
      const api = fakeApi({
        [group]: vi.fn().mockRejectedValue(refused("device.forbidden_action", 403)),
        [course]: vi.fn().mockRejectedValue(refused("order.payment_in_flight", 404)),
      });
      const el = await mountOne(api);
      await press(el, '[data-group-ready="g-1"]');
      expect(text(leverError(el))).toBe(`#7 T7: ${codeMessage("device.forbidden_action")}`);
      expect(tableChanged(el)).toBeNull();
      await press(el, '[data-ready="course-mains"]');
      expect(text(leverError(el))).toBe(`#1 T1: ${codeMessage("order.payment_in_flight")}`);
    },
  );

  it.each(surfaces)(
    "Course Ready on a bill card on $where sends the order and course, then reloads",
    async ({ mountOne, course }) => {
      const api = fakeApi();
      const el = await mountOne(api);
      const reads = api.getDevicePassBoard.mock.calls.length;
      await press(el, '[data-ready="course-mains"]');
      expect(api[course]).toHaveBeenCalledExactlyOnceWith("order-1", "course-mains");
      expect(api.getDevicePassBoard).toHaveBeenCalledTimes(reads + 1);
    },
  );

  it.each([
    ["device.unauthorized", '[data-group-ready="g-1"]'],
    ["kitchen_screen.not_allowed", '[data-group-ready="g-1"]'],
    ["device.unauthorized", '[data-ready="course-mains"]'],
    ["kitchen_screen.not_allowed", '[data-ready="course-mains"]'],
  ] as const)(
    "a lever refused %s on a kitchen display asks the app to re-read the device's choice (%s)",
    async (code, selector) => {
      const api = fakeApi({
        bumpDeviceGroupReady: vi.fn().mockRejectedValue(refused(code, 401)),
        bumpDeviceCourseReady: vi.fn().mockRejectedValue(refused(code, 401)),
      });
      const el = await mountDisplay(api);
      const changed = vi.fn();
      el.addEventListener("kitchen-screen-changed", changed);
      await press(el, selector);
      expect(changed).toHaveBeenCalledOnce();
      expect((changed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ from: "pass" });
      expect(leverError(el)).toBeNull();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    },
  );

  it("on a kitchen display, keeps its board and re-boots nothing when the read after Ready is refused device.unauthorized", async () => {
    const api = fakeApi({
      getDevicePassBoard: vi.fn().mockRejectedValue(refused("device.unauthorized", 401)),
    });
    const el = await mountDisplay(api);
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      await press(el, '[data-ready="course-mains"]');
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      expect(reboot).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(inBoard(el, '[data-card="bill:order-1"]')).not.toBeNull();
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("on a till, a course Ready refused kitchen_screen.not_allowed shows its words, reads the board again and asks for no switch", async () => {
    const api = fakeApi({
      bumpCourseReady: vi.fn().mockRejectedValue({
        ...refused("kitchen_screen.not_allowed", 403),
        params: { screen: "pass" },
      }),
    });
    const el = await mountTill(api);
    const changed = vi.fn();
    el.addEventListener("kitchen-screen-changed", changed);
    const reads = api.getDevicePassBoard.mock.calls.length;
    await press(el, '[data-ready="course-mains"]');
    expect(api.bumpCourseReady).toHaveBeenCalledExactlyOnceWith("order-1", "course-mains");
    expect(api.getDevicePassBoard).toHaveBeenCalledTimes(reads + 1);
    expect(changed).not.toHaveBeenCalled();
    expect(text(leverError(el))).toBe(`#1 T1: ${codeMessage("kitchen_screen.not_allowed")}`);
  });

  it("names a refused Ready's card by its order number alone when it has no table", async () => {
    const untabled = passCard({
      orders: [{ orderId: "order-6", orderNumber: 6, kitchenNote: null }],
    });
    const api = fakeApi({
      getDevicePassBoard: vi
        .fn()
        .mockResolvedValue(deviceBoard(passBoard({ inProgress: [untabled] }))),
      bumpDeviceCourseReady: vi
        .fn()
        .mockRejectedValue(refused("kitchen_screen.zone_not_allowed", 403)),
    });
    const el = await mount({
      api,
      deviceMode: true,
      initialBoard: deviceBoard(passBoard({ inProgress: [untabled] })),
    });
    await press(el, '[data-ready="course-mains"]');
    expect(text(leverError(el))).toBe(`#6: ${codeMessage("kitchen_screen.zone_not_allowed")}`);
  });

  it("a till reprints each bill of a card", async () => {
    const api = fakeApi();
    const el = await mountTill(api);
    expect(inBoard(el, '[data-reprint="order-7"]')).not.toBeNull();
    await press(el, '[data-reprint="order-1"]');
    expect(api.reprintOrder).toHaveBeenCalledExactlyOnceWith("order-1");
    expect(el.shadowRoot!.querySelector("[data-reprint-error]")).toBeNull();
  });

  it("the next Reprint press clears a failed reprint's error", async () => {
    const api = fakeApi({
      reprintOrder: vi
        .fn()
        .mockRejectedValueOnce(refused("printer.not_found", 502))
        .mockResolvedValue(undefined),
    });
    const el = await mountTill(api);
    await press(el, '[data-reprint="order-1"]');
    expect(el.shadowRoot!.querySelector("[data-reprint-error]")).not.toBeNull();
    await press(el, '[data-reprint="order-1"]');
    expect(el.shadowRoot!.querySelector("[data-reprint-error]")).toBeNull();
  });

  it("a group Ready press clears the refresh sentence, the one still waiting for a read, and a refusal", async () => {
    const api = fakeApi({
      bumpDeviceCourseReady: vi.fn().mockRejectedValue(refused("order.payment_in_flight", 404)),
      bumpDeviceGroupReady: vi
        .fn()
        .mockRejectedValueOnce(refused("party.out_of_date"))
        .mockRejectedValueOnce(refused("party.out_of_date"))
        .mockResolvedValue({ revision: 8 }),
    });
    const el = await mountDisplay(api);
    await press(el, '[data-ready="course-mains"]');
    expect(leverError(el)).not.toBeNull();
    await press(el, '[data-group-ready="g-1"]');
    expect(leverError(el)).toBeNull();
    expect(tableChanged(el)).not.toBeNull();

    api.getDevicePassBoard.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await press(el, '[data-group-ready="g-1"]');
    expect(tableChanged(el)).toBeNull();

    await press(el, '[data-group-ready="g-1"]');
    expect(tableChanged(el)).toBeNull();
  });

  it("a course Ready press clears a refusal and leaves the refresh sentence", async () => {
    const api = fakeApi({
      bumpDeviceGroupReady: vi.fn().mockRejectedValue(refused("party.out_of_date")),
      bumpDeviceCourseReady: vi
        .fn()
        .mockRejectedValueOnce(refused("order.payment_in_flight", 404))
        .mockResolvedValue(undefined),
    });
    const el = await mountDisplay(api);
    await press(el, '[data-group-ready="g-1"]');
    expect(tableChanged(el)).not.toBeNull();

    api.getDevicePassBoard.mockRejectedValue(new TypeError("Failed to fetch"));
    await press(el, '[data-ready="course-mains"]');
    expect(leverError(el)).not.toBeNull();
    await press(el, '[data-ready="course-mains"]');
    expect(leverError(el)).toBeNull();
    expect(tableChanged(el)).not.toBeNull();
  });

  it("a failed reprint shows its error", async () => {
    const api = fakeApi({
      reprintOrder: vi.fn().mockRejectedValue(refused("printer.not_found", 502)),
    });
    const el = await mountTill(api);
    await press(el, '[data-reprint="order-1"]');
    expect(text(el.shadowRoot!.querySelector("[data-reprint-error]"))).toBe(
      codeMessage("printer.not_found"),
    );
  });

  it.each([
    ["a kitchen display", mountDisplay],
    ["a monitor", mountMonitor],
  ] as const)("%s draws no Reprint", async (_, mountOne) => {
    const el = await mountOne(fakeApi());
    expect(boardOf(el)!.shadowRoot!.querySelectorAll("[data-card]").length).toBeGreaterThan(0);
    expect(boardOf(el)!.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("with help on, the first card, the first Ready lever and Columns carry their badges", async () => {
    const el = await mountDisplay(fakeApi());
    setHelpMode(true);
    await flush(el);
    const cards = [...boardOf(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-card]")];
    expect(cards.length).toBeGreaterThan(1);
    const withBadge = cards.filter((card) => card.querySelector(":scope > wt-help-tooltip"));
    expect(withBadge).toEqual([cards[0]]);
    const card = badgeFor(el, helpText("help.kitchen.cards_part"))!;
    expect(card.textContent).toBe(helpText("help.pass.card"));
    expect(card.getAttribute("guide-href")).toBe("/help/en/kitchen-service#service-lifetime");

    const ready = badges(el).filter((badge) => badge.textContent === helpText("help.pass.ready"));
    expect(ready).toHaveLength(1);
    expect(ready[0]!.getAttribute("aria-label")).toBe(helpBadgeLabel(t("expo.group_ready")));
    expect(ready[0]!.parentElement!.querySelector(":scope > .lever")).not.toBeNull();

    const columns = badgeFor(el, t("station.columns"))!;
    expect(columns.textContent).toBe(helpText("help.kitchen.columns"));
    expect(columns.parentElement!.querySelector(":scope > [data-columns-open]")).not.toBeNull();
    expect(columns.getAttribute("guide-href")).toBe("/help/en/kitchen-service#kitchen-screen");
  });

  it("with help on, the Ready badge is still drawn after the board is read again", async () => {
    const api = fakeApi();
    api.getDevicePassBoard.mockImplementation(async () => deviceBoard());
    const el = await mountDisplay(api);
    setHelpMode(true);
    await flush(el);
    const before = boardOf(el)!.board;
    await press(el, '[data-ready="course-mains"]');
    expect(boardOf(el)!.board).not.toBe(before);
    const ready = badges(el).filter((badge) => badge.textContent === helpText("help.pass.ready"));
    expect(ready).toHaveLength(1);
    expect(ready[0]!.parentElement!.querySelector(":scope > .lever")).not.toBeNull();
  });

  it.each([
    ["a monitor", mountMonitor],
    ["a kitchen display", mountDisplay],
    ["a till", mountTill],
  ] as const)("with help off, %s draws no help badge anywhere", async (_, mountOne) => {
    const el = await mountOne(fakeApi());
    expect(boardOf(el)!.shadowRoot!.querySelectorAll("[data-card]").length).toBeGreaterThan(0);
    expect(badges(el)).toEqual([]);
  });

  it("the More menu's Pass help describes the new board, in both languages", () => {
    expect(helpEn["help.more.pass"]).toBe(
      "Opens the pass: a card for each group a table sends, or each counter order, in columns from held to ready.",
    );
    expect(helpEs["help.more.pass"]).toContain(es["pass.column.held"].toLowerCase());
    expect(helpEs["help.more.pass"]).toContain(es["pass.column.ready"].toLowerCase());
    expect(helpEs["help.more.pass"]).not.toContain("curso");
    expect(helpEn["help.more.pass"]).toContain(en["pass.column.held"].toLowerCase());
  });

  it("the pass's new help texts read the owner-approved words, in both languages", () => {
    expect(helpEn["help.pass.card"]).toBe(
      "One card for each group a table sends, across its bills, or for each counter order. Its minutes count from when the waiter sent it, or on a Ready card from when its last dish was ready. The left edge takes the brand colour, then turns red, as its dishes wait, by their stations' late flags; a dish that waits too long says Forgotten. Dimmed dishes are shown for information only: dishes this pass does not cover and, once a station it covers waits for the pass, dishes of the stations that do not and dishes sent before their station began waiting.",
    );
    expect(helpEs["help.pass.card"]).toBe(
      "Una tarjeta por cada grupo que envía una mesa, en todas sus cuentas, o por cada pedido de mostrador. Sus minutos cuentan desde que el camarero lo envió o, en una tarjeta lista, desde que su último plato estuvo listo. El borde izquierdo toma el color de marca y luego pasa a rojo mientras sus platos esperan, según los avisos de demora de sus estaciones; un plato que espera demasiado dice Olvidado. Los platos atenuados se muestran solo como información: los que este pase no cubre y, cuando una estación que cubre espera al pase, los de las estaciones que no esperan y los enviados antes de que su estación empezara a esperar.",
    );
    expect(helpEs["help.more.pass"]).toBe(
      "Abre el pase: una tarjeta por cada grupo que envía una mesa, o por cada pedido de mostrador, en columnas de en espera a listo.",
    );
  });
});
