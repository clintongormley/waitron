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
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
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
  display: { showNonPassStations: true, nonPassStationsOverride: null },
});

const identity = (): DeviceIdentity => ({
  deviceId: "dev-1",
  formFactor: "till",
  name: "Till 1",
  kitchenScreens: [
    {
      kind: "pass",
      available: true,
      stations: [],
      zones: null,
      nonPassStationsOverride: null,
      showNonPassStations: true,
    },
  ],
});

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = TillApi &
  Record<
    | "getDevicePassBoard"
    | "bumpDeviceGroupReady"
    | "bumpGroupReady"
    | "bumpDeviceCourseReady"
    | "bumpCourseReady"
    | "reprintOrder"
    | "getExpoBoard"
    | "releaseDevicePass",
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
/** One card's own Reprint for a bill; several cards can carry the same bill. */
const reprintOn = (cardKey: string, orderId: string) =>
  `[data-card="${cardKey}"] [data-reprint="${orderId}"]`;
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
      const other = group === "bumpGroupReady" ? "bumpDeviceGroupReady" : "bumpGroupReady";
      expect(api[other]).not.toHaveBeenCalled();
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
      expect(leverError(el)!.getAttribute("role")).toBe("alert");
      expect(tableChanged(el)).toBeNull();
      await press(el, '[data-ready="course-mains"]');
      expect(text(leverError(el))).toBe(`#1 T1: ${codeMessage("order.payment_in_flight")}`);
      expect(leverError(el)!.getAttribute("role")).toBe("alert");
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

  it("a Ready refused service_zone.not_allowed on a till says the profile can be changed", async () => {
    const code = refused("service_zone.not_allowed", 403);
    const api = fakeApi({
      bumpGroupReady: vi.fn().mockRejectedValue(code),
      bumpCourseReady: vi.fn().mockRejectedValue(code),
    });
    const el = await mountTill(api);
    const sentence =
      "This device's profile does not work in that area. It can be changed in the dashboard, under Device profiles.";
    await press(el, '[data-group-ready="g-1"]');
    expect(text(leverError(el))).toBe(`#7 T7: ${sentence}`);
    await press(el, '[data-ready="course-mains"]');
    expect(text(leverError(el))).toBe(`#1 T1: ${sentence}`);
  });

  it("a till reprints each bill of a card", async () => {
    const api = fakeApi();
    const el = await mountTill(api);
    expect(inBoard(el, reprintOn("group:g-2", "order-1"))).not.toBeNull();
    expect(inBoard(el, reprintOn("group:g-1", "order-7"))).not.toBeNull();
    expect(inBoard(el, reprintOn("bill:order-1", "order-1"))).not.toBeNull();
    await press(el, reprintOn("bill:order-1", "order-1"));
    expect(api.reprintOrder).toHaveBeenCalledExactlyOnceWith("order-1");
    expect(el.shadowRoot!.querySelector("[data-reprint-error]")).toBeNull();
  });

  it("a Reprint refused service_zone.not_allowed says the profile can be changed, in both languages", async () => {
    const api = fakeApi({
      reprintOrder: vi.fn().mockRejectedValue(refused("service_zone.not_allowed", 403)),
    });
    const reprintError = (el: TillPassScreen) =>
      el.shadowRoot!.querySelector("[data-reprint-error]");
    const el = await mountTill(api);
    await press(el, reprintOn("bill:order-1", "order-1"));
    expect(text(reprintError(el))).toBe(
      "This device's profile does not work in that area. It can be changed in the dashboard, under Device profiles.",
    );
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const inSpanish = await mountTill(api);
      await press(inSpanish, reprintOn("bill:order-1", "order-1"));
      expect(text(reprintError(inSpanish))).toBe(
        "El perfil de este dispositivo no trabaja en esa zona. Se puede cambiar en el panel, en Perfiles de dispositivo.",
      );
    } finally {
      setLocale(previous);
    }
  });

  it("the next Reprint press clears a failed reprint's error", async () => {
    const api = fakeApi({
      reprintOrder: vi
        .fn()
        .mockRejectedValueOnce(refused("printer.not_found", 502))
        .mockResolvedValue(undefined),
    });
    const el = await mountTill(api);
    await press(el, reprintOn("bill:order-1", "order-1"));
    expect(el.shadowRoot!.querySelector("[data-reprint-error]")).not.toBeNull();
    await press(el, reprintOn("bill:order-1", "order-1"));
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
    await press(el, reprintOn("bill:order-1", "order-1"));
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
    expect(card.getAttribute("guide-href")).toBe("/help/en/kitchen-service#pass-screen");

    const ready = badges(el).filter((badge) => badge.textContent === helpText("help.pass.ready"));
    expect(ready).toHaveLength(1);
    expect(ready[0]!.getAttribute("aria-label")).toBe(helpBadgeLabel(t("expo.group_ready")));
    expect(ready[0]!.parentElement!.querySelector(":scope > .lever")).not.toBeNull();

    const columns = badgeFor(el, t("station.columns"))!;
    expect(columns.textContent).toBe(helpText("help.kitchen.columns"));
    expect(columns.parentElement!.querySelector(":scope > [data-columns-open]")).not.toBeNull();
    expect(columns.getAttribute("guide-href")).toBe("/help/en/kitchen-service#pass-screen");
    expect(ready[0]!.getAttribute("guide-href")).toBe("/help/en/kitchen-service#pass-screen");
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
      "Opens the pass: a card for each order from a table or the counter, in columns from To fire to Ready.",
    );
    expect(helpEs["help.more.pass"]).toContain(es["pass.column.to_fire"]);
    expect(helpEs["help.more.pass"]).toContain(es["pass.column.ready"]);
    expect(helpEs["help.more.pass"]).not.toContain("curso");
    expect(helpEn["help.more.pass"]).toContain(en["pass.column.to_fire"]);
    expect(helpEn["help.more.pass"]).toContain(en["pass.column.ready"]);
  });

  it("the pass's help texts read the words posted to the owner on 2026-11-03, in both languages", () => {
    expect(helpEn["help.pass.card"]).toBe(
      "Each card is an order from a table or the counter. Fire, where it shows, sends the card's dishes marked Waiting for the pass to their stations to be cooked. A dashed card is held: the waiter hasn't asked for it yet. A card's left edge changes colour, then turns red, the longer its dishes wait.",
    );
    expect(helpEs["help.pass.card"]).toBe(
      "Cada tarjeta es un pedido de una mesa o del mostrador. Marchar, donde aparece, manda a sus estaciones los platos de la tarjeta que dicen Esperando al pase, para que los preparen. Una tarjeta con borde discontinuo está en espera: el camarero aún no la ha pedido. El borde izquierdo de una tarjeta cambia de color y luego pasa a rojo cuanto más esperan sus platos.",
    );
    expect(helpEs["help.more.pass"]).toBe(
      "Abre el pase: una tarjeta por cada pedido de una mesa o del mostrador, en columnas de Por marchar a Listo.",
    );
    expect(helpEn["help.pass.ready"]).toBe(
      "Marks the food of this course or group ready at every station, including dishes this screen doesn't show. Dishes not yet sent to cook stay as they are.",
    );
    expect(helpEs["help.pass.ready"]).toBe(
      "Marca como lista la comida de este curso o grupo en todas las estaciones, también los platos que esta pantalla no muestra. Los platos que aún no se han mandado a preparar se quedan como están.",
    );
  });
});

describe("A773 pass screen: levers on a till's All stations", () => {
  const heldCard = passCard({
    key: "held:h-1",
    kind: "held",
    items: [passItem({ id: "h-a", phase: "held", firedAt: null })],
  });
  const allApi = (board: PassBoard, overrides: Record<string, unknown> = {}) =>
    fakeApi({
      getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity(), kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board }),
      ...overrides,
    });
  const allBoard = () =>
    passBoard({ held: [heldCard], toFire: [fireCard()], inProgress: [groupCard(), passCard()] });

  it("draws a released course's Ready and no Fire on a held or To fire card, though it runs the pass", async () => {
    const api = allApi(allBoard());
    const el = await mountTill(api);
    expect(boardOf(el)!.mode).toBe("all_stations");
    expect(inBoard(el, '[data-card="held:h-1"]')).not.toBeNull();
    expect(inBoard(el, '[data-card="group:g-2"]')).not.toBeNull();
    expect(boardOf(el)!.shadowRoot!.querySelectorAll("[data-pass-fire]")).toHaveLength(0);
    expect(text(inBoard(el, '[data-ready="course-mains"]'))).toBe(`${t("expo.ready")} Mains`);
  });

  it("a Ready refused service_zone.not_allowed says the profile can be changed, in both languages, since this board has no zone limit", async () => {
    const api = allApi(allBoard(), {
      bumpCourseReady: vi.fn().mockRejectedValue(refused("service_zone.not_allowed", 403)),
    });
    const el = await mountTill(api);
    await press(el, '[data-ready="course-mains"]');
    expect(text(leverError(el))).toBe(
      "#1 T1: This device's profile does not work in that area. It can be changed in the dashboard, under Device profiles.",
    );
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const inSpanish = await mountTill(api);
      await press(inSpanish, '[data-ready="course-mains"]');
      expect(text(leverError(inSpanish))).toBe(
        "#1 T1: El perfil de este dispositivo no trabaja en esa zona. Se puede cambiar en el panel, en Perfiles de dispositivo.",
      );
    } finally {
      setLocale(previous);
    }
  });

  it("sends nothing, and reads nothing more, for a Fire event", async () => {
    const api = allApi(allBoard());
    const el = await mountTill(api);
    boardOf(el)!.dispatchEvent(
      new CustomEvent("pass-fire", {
        detail: { key: "group:g-2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.releaseDevicePass).not.toHaveBeenCalled();
    expect(api.getExpoBoard).toHaveBeenCalledOnce();
  });

  it("keeps a course whose dishes are all ready, and a dish with no course, on the card with no Ready", async () => {
    const card = passCard({
      items: [
        passItem({
          id: "starter",
          phase: "ready",
          state: "ready",
          course: { id: "course-starters", name: "Starters", displayOrder: 1 },
        }),
        passItem({ id: "bread", name: "Bread", course: null }),
        passItem({ id: "main" }),
      ],
    });
    const el = await mountTill(allApi(passBoard({ inProgress: [card] })));
    for (const id of ["starter", "bread", "main"])
      expect(inBoard(el, `[data-item="${id}"]`)).not.toBeNull();
    expect(
      [...boardOf(el)!.shadowRoot!.querySelectorAll("[data-ready]")].map((lever) =>
        lever.getAttribute("data-ready"),
      ),
    ).toEqual(["course-mains"]);
  });

  it("Course Ready sends the order and course through the till's route, then reads All stations again", async () => {
    const api = allApi(allBoard());
    const el = await mountTill(api);
    await press(el, '[data-ready="course-mains"]');
    expect(api.bumpCourseReady).toHaveBeenCalledExactlyOnceWith("order-1", "course-mains");
    expect(api.bumpDeviceCourseReady).not.toHaveBeenCalled();
    expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
  });

  it("a refused Course Ready shows its words and still reads All stations again", async () => {
    const api = allApi(allBoard(), {
      bumpCourseReady: vi.fn().mockRejectedValue(refused("course.not_found", 404)),
    });
    const el = await mountTill(api);
    await press(el, '[data-ready="course-mains"]');
    expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
    expect(text(leverError(el))).toBe(`#1 T1: ${codeMessage("course.not_found")}`);
  });

  it("draws Reprint on each card's bill, and a press reprints that bill and reads nothing", async () => {
    const api = allApi(allBoard());
    const el = await mountTill(api);
    expect(text(inBoard(el, reprintOn("group:g-2", "order-1")))).toBe(t("expo.reprint"));
    expect(text(inBoard(el, reprintOn("group:g-1", "order-7")))).toBe(t("expo.reprint"));
    expect(text(inBoard(el, reprintOn("bill:order-1", "order-1")))).toBe(t("expo.reprint"));
    expect(inBoard(el, '[data-card="held:h-1"] [data-reprint]')).toBeNull();
    await press(el, reprintOn("group:g-2", "order-1"));
    expect(api.reprintOrder).toHaveBeenCalledExactlyOnceWith("order-1");
    expect(api.getExpoBoard).toHaveBeenCalledOnce();
  });

  it.each([
    ["a coded refusal", { code: "session.required", status: 401 }, "session.required"],
    ["a refusal with no code", new Error("network down"), "server.internal"],
  ] as const)(
    "announces %s of a Reprint as an alert in words, never the code",
    async (_, rejection, code) => {
      const api = allApi(allBoard(), { reprintOrder: vi.fn().mockRejectedValue(rejection) });
      const el = await mountTill(api);
      await press(el, reprintOn("bill:order-1", "order-1"));
      const alert = el.shadowRoot!.querySelector('[role="alert"]');
      expect(alert!.hasAttribute("data-reprint-error")).toBe(true);
      expect(text(alert)).toBe(codeMessage(code));
      expect(alert!.textContent).not.toContain(code);
    },
  );
});

describe("A773 pass screen: a party's group cards on a till's All stations", () => {
  const groupNamed = (n: string) => t("table.group_n").replace("{n}", n);
  const allApi = (board: PassBoard, overrides: Record<string, unknown> = {}) =>
    fakeApi({
      getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity(), kitchenScreens: [] }),
      getExpoBoard: vi.fn().mockResolvedValue({ board }),
      ...overrides,
    });
  const mountAll = async (api: FakeApi) => {
    const el = await mountTill(api);
    expect(boardOf(el)!.mode).toBe("all_stations");
    return el;
  };
  const cardOf = (el: TillPassScreen, key: string) =>
    inBoard<HTMLElement>(el, `[data-card="${key}"]`)!;
  /** Table T7's party: a held group, a group cooking, a group plated, and a moved dish on its bill. */
  const partyBoard = () =>
    passBoard({
      held: [
        groupCard({
          key: "group:g-4",
          target: { kind: "group", partyId: "p-1", groupId: "g-4" },
          kind: "held",
          requestedAt: null,
          group: { displayNumber: 4, position: 4 },
          items: [passItem({ id: "steak", phase: "held", firedAt: null, orderId: "order-7" })],
        }),
      ],
      inProgress: [
        groupCard({
          key: "group:g-2",
          target: { kind: "group", partyId: "p-1", groupId: "g-2" },
          group: { displayNumber: 2, position: 2 },
          items: [passItem({ id: "croq", state: "preparing", phase: "preparing" })],
        }),
      ],
      ready: [
        groupCard({
          key: "group:g-3",
          target: { kind: "group", partyId: "p-1", groupId: "g-3" },
          group: { displayNumber: 3, position: 3 },
          readyAt: minutesAgo(1),
          allReady: true,
          items: [
            passItem({ id: "salad", state: "ready", phase: "ready", readyAt: minutesAgo(1) }),
          ],
        }),
        passCard({
          key: "bill:order-7",
          target: { kind: "bill", workingOrderId: "order-7" },
          orders: [{ orderId: "order-7", orderNumber: 7, tableLabel: "T7", kitchenNote: null }],
          readyAt: minutesAgo(1),
          allReady: true,
          items: [
            passItem({
              id: "moved",
              orderId: "order-7",
              course: null,
              state: "ready",
              phase: "ready",
              readyAt: minutesAgo(1),
            }),
          ],
        }),
      ],
    });
  const staleNotice = (label: string) =>
    `${t("station.table_changed_named").replace("{table}", label)} ${t("station.table_changed")}`;

  it("heads a group card with its kept number and the numbering party's label, never its firing position", async () => {
    const card = groupCard({
      group: { displayNumber: 5, position: 1, numberPartyLabel: "Terrace 7" },
    });
    const el = await mountAll(allApi(passBoard({ inProgress: [card] })));
    expect(text(cardOf(el, "group:g-1").querySelector(".group-name"))).toBe(
      groupNamed("5 · Terrace 7"),
    );
  });

  it("draws a held group's card dashed and untimed, its dishes held, and offers Ready only on a group cooking", async () => {
    const el = await mountAll(allApi(partyBoard()));
    const held = cardOf(el, "group:g-4");
    expect(held.classList).toContain("held");
    expect(held.querySelector(".age")).toBeNull();
    expect(held.querySelector('[data-item="steak"]')!.classList).toContain("held");
    expect(held.querySelector(".lever")).toBeNull();

    const ready = cardOf(el, "group:g-2").querySelector<HTMLElement>('[data-group-ready="g-2"]')!;
    expect(text(ready)).toBe(t("expo.group_ready"));
    expect(ready.getAttribute("aria-label")).toBe(`${t("expo.group_ready")} ${groupNamed("2")}`);

    for (const [key, item] of [
      ["group:g-3", "salad"],
      ["bill:order-7", "moved"],
    ] as const) {
      expect(cardOf(el, key).querySelector(`[data-item="${item}"]`)).not.toBeNull();
      expect(cardOf(el, key).querySelector(".lever")).toBeNull();
    }
    expect(boardOf(el)!.shadowRoot!.querySelectorAll("[data-group-ready]")).toHaveLength(1);
  });

  it("ages a group card by its dishes, marking a forgotten one", async () => {
    const card = groupCard({ items: [passItem({ id: "late", queuedAt: minutesAgo(20) })] });
    const el = await mountTill(
      fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue({ ...identity(), kitchenScreens: [] }),
        getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard({ inProgress: [card] }) }),
      }),
    );
    expect(cardOf(el, "group:g-1").classList).toContain("age-forgotten");
    expect(
      cardOf(el, "group:g-1").querySelector('[data-item="late"] [data-forgotten]'),
    ).not.toBeNull();
  });

  it("sends each group Ready press under a fresh submission id and the card's revision, reading All stations after each", async () => {
    const api = allApi(partyBoard());
    const el = await mountAll(api);
    await press(el, '[data-group-ready="g-2"]');
    await press(el, '[data-group-ready="g-2"]');
    const ask = { submissionId: expect.stringMatching(UUID), expectedPartyRevision: 7 };
    expect(api.bumpGroupReady.mock.calls).toEqual([
      ["p-1", "g-2", ask],
      ["p-1", "g-2", ask],
    ]);
    expect(api.bumpGroupReady.mock.calls[0]![2].submissionId).not.toBe(
      api.bumpGroupReady.mock.calls[1]![2].submissionId,
    );
    expect(api.getExpoBoard).toHaveBeenCalledTimes(3);
    expect(api.bumpDeviceGroupReady).not.toHaveBeenCalled();
    expect(api.bumpCourseReady).not.toHaveBeenCalled();
    expect(api.releaseDevicePass).not.toHaveBeenCalled();
  });

  it("on party.out_of_date reads All stations again, names the table that changed, and never sends again on its own", async () => {
    const api = allApi(partyBoard(), {
      bumpGroupReady: vi.fn().mockRejectedValue(refused("party.out_of_date")),
    });
    const el = await mountAll(api);
    expect(tableChanged(el)).toBeNull();
    await press(el, '[data-group-ready="g-2"]');
    await flush(el);
    expect(api.bumpGroupReady).toHaveBeenCalledOnce();
    expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
    expect(text(tableChanged(el))).toBe(staleNotice("T7"));
    expect(tableChanged(el)!.getAttribute("role")).toBe("status");
    expect(leverError(el)).toBeNull();
  });

  it("names a group card with no table by its order number", async () => {
    const untabled = groupCard({
      orders: [{ orderId: "order-9", orderNumber: 9, kitchenNote: null }],
    });
    const api = allApi(passBoard({ inProgress: [untabled] }), {
      bumpGroupReady: vi.fn().mockRejectedValue(refused("party.out_of_date")),
    });
    const el = await mountAll(api);
    await press(el, '[data-group-ready="g-1"]');
    expect(text(tableChanged(el))).toBe(staleNotice("#9"));
  });

  it("clears the table-changed line with the next group Ready press, before its answer, and another refusal does not raise it", async () => {
    let refuse!: (error: unknown) => void;
    const api = allApi(partyBoard(), {
      bumpGroupReady: vi
        .fn()
        .mockRejectedValueOnce(refused("party.out_of_date"))
        .mockReturnValueOnce(
          new Promise((_resolve, reject) => {
            refuse = reject;
          }),
        ),
    });
    const el = await mountAll(api);
    await press(el, '[data-group-ready="g-2"]');
    expect(tableChanged(el)).not.toBeNull();
    await press(el, '[data-group-ready="g-2"]');
    expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)).toBeNull();
    refuse(refused("group.not_found", 404));
    await flush(el);
    expect(tableChanged(el)).toBeNull();
    expect(api.getExpoBoard).toHaveBeenCalledTimes(3);
  });

  it("keeps the table-changed line through a failed read and clears it at the next good one, a course Ready press clearing nothing", async () => {
    const api = allApi(passBoard({ inProgress: [groupCard(), passCard()] }), {
      bumpGroupReady: vi.fn().mockRejectedValue(refused("party.out_of_date")),
    });
    const el = await mountAll(api);
    await press(el, '[data-group-ready="g-1"]');
    expect(tableChanged(el)).not.toBeNull();
    api.getExpoBoard.mockRejectedValueOnce(new TypeError("offline"));
    await press(el, '[data-ready="course-mains"]');
    expect(tableChanged(el)).not.toBeNull();
    await press(el, '[data-ready="course-mains"]');
    expect(api.bumpCourseReady).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)).toBeNull();
  });
});

describe("A773 pass screen: a group card's Ready refused on a kitchen display", () => {
  it("shows kitchen_screen.zone_not_allowed as the card's label and its words, asking for no switch", async () => {
    const api = fakeApi({
      bumpDeviceGroupReady: vi
        .fn()
        .mockRejectedValue(refused("kitchen_screen.zone_not_allowed", 403)),
    });
    const el = await mountDisplay(api);
    const changed = vi.fn();
    el.addEventListener("kitchen-screen-changed", changed);
    await press(el, '[data-group-ready="g-1"]');
    expect(changed).not.toHaveBeenCalled();
    expect(leverError(el)!.getAttribute("role")).toBe("alert");
    expect(text(leverError(el))).toBe(`#7 T7: ${codeMessage("kitchen_screen.zone_not_allowed")}`);
  });
});
