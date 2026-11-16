import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { kitchenScreenNoticeText } from "../kitchen-screen-notice.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget, pageAt, resetPage } from "../widgets/test-helpers.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type {
  DeviceIdentity,
  DevicePassBoard,
  PassBoard,
  PassCard,
  PassReleaseAsk,
  PassReleaseResult,
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

afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Its release ids differ from its drawn Requested items' ids, so a filter to drawn items is seen. */
const fireCard = (overrides: Partial<PassCard> = {}): PassCard =>
  passCard({
    key: "group:g-1",
    target: { kind: "group", partyId: "p-1", groupId: "g-1" },
    kind: "next_course",
    items: [
      passItem({ id: "a", phase: "requested", firedAt: null }),
      passItem({ id: "b", lineId: "line-2", phase: "requested", firedAt: null }),
    ],
    releaseTicketItemIds: ["r-1", "r-2"],
    releaseContext: "ctx-1",
    ...overrides,
  });

const toFireBoard = (card: PassCard = fireCard()): PassBoard => passBoard({ toFire: [card] });
const deviceBoard = (board: PassBoard = toFireBoard()): DevicePassBoard => ({
  board,
  stations: [],
  zones: null,
  display: { showNonPassStations: true },
});

function identity(kind: "pass" | "pass_monitor" | null): DeviceIdentity {
  return {
    deviceId: "dev-1",
    formFactor: "till",
    name: "Till 1",
    kitchenScreens:
      kind === null
        ? []
        : [
            {
              kind,
              available: true,
              stations: [],
              zones: null,
              showNonPassStations: true,
            },
          ],
  };
}

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = TillApi &
  Record<
    | "getDeviceIdentity"
    | "getDevicePassBoard"
    | "getDevicePassMonitorBoard"
    | "getDevicePassBoard"
    | "releaseDevicePass",
    Fn
  >;

function fakeApi(overrides: Record<string, unknown> = {}): FakeApi {
  return {
    getDeviceIdentity: vi.fn().mockResolvedValue(identity("pass")),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    releaseDevicePass: vi.fn().mockResolvedValue({ releasedTicketItemIds: ["r-1", "r-2"] }),
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

/** A kitchen display's pass, handed its board, so every read after connect is one Fire caused. */
const mountDisplay = (api: FakeApi) =>
  mount({ api, deviceMode: true, initialBoard: deviceBoard() });
/** A till whose device chose a pass screen. */
const mountTill = (api: FakeApi) => mount({ api });

const boardOf = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board");
const fireButton = (el: TillPassScreen, key = "group:g-1") =>
  boardOf(el)!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-pass-fire="${key}"]`);
const tableChanged = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-table-changed]");
const leverError = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-lever-error]");

async function pressFire(el: TillPassScreen): Promise<void> {
  await userEvent.click(fireButton(el)!);
  await flush(el);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const refused = (code: string, status = 409) => ({ code, status });

async function withFakeTimers(run: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
}

async function refresh(el: TillPassScreen): Promise<void> {
  await vi.advanceTimersByTimeAsync(15_000);
  await flush(el);
}

describe("A773 pass screen: Fire", () => {
  it("sends exactly the card's target, release ids and context under a fresh submission id, then reloads the board", async () => {
    const api = fakeApi();
    const el = await mountDisplay(api);
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    await pressFire(el);
    expect(api.releaseDevicePass).toHaveBeenCalledOnce();
    const ask = api.releaseDevicePass.mock.calls[0]![0] as PassReleaseAsk;
    expect(ask).toEqual({
      submissionId: expect.stringMatching(UUID),
      target: { kind: "group", partyId: "p-1", groupId: "g-1" },
      ticketItemIds: ["r-1", "r-2"],
      expectedContext: "ctx-1",
    });
    expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
  });

  it("sends one ask for two presses before the answer", async () => {
    const answer = deferred<PassReleaseResult>();
    const api = fakeApi({ releaseDevicePass: vi.fn(() => answer.promise) });
    const el = await mountDisplay(api);
    await userEvent.dblClick(fireButton(el)!);
    boardOf(el)!.dispatchEvent(
      new CustomEvent("pass-fire", {
        detail: { key: "group:g-1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.releaseDevicePass).toHaveBeenCalledOnce();
    expect(fireButton(el)!.disabled).toBe(true);
    answer.resolve({ releasedTicketItemIds: ["r-1", "r-2"] });
    await flush(el);
    expect(fireButton(el)!.disabled).toBe(false);
  });

  it("resends a Fire that got no answer as the same ask, and drops it once the card's context changes", () =>
    withFakeTimers(async () => {
      const api = fakeApi({
        releaseDevicePass: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      const el = await mountDisplay(api);
      await pressFire(el);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      await pressFire(el);
      expect(api.releaseDevicePass).toHaveBeenCalledTimes(2);
      const [first, second] = api.releaseDevicePass.mock.calls.map(
        (call) => call[0] as PassReleaseAsk,
      );
      expect(second).toEqual(first);

      api.getDevicePassBoard.mockResolvedValue(
        deviceBoard(toFireBoard(fireCard({ releaseContext: "ctx-2" }))),
      );
      await refresh(el);
      await pressFire(el);
      const third = api.releaseDevicePass.mock.calls[2]![0] as PassReleaseAsk;
      expect(third.submissionId).not.toBe(first!.submissionId);
      expect(third.expectedContext).toBe("ctx-2");
    }));

  for (const code of ["ticket.pass_context_changed", "party.not_open"]) {
    it(`reloads once on ${code}, says the screen was refreshed and sends nothing more`, () =>
      withFakeTimers(async () => {
        const api = fakeApi({ releaseDevicePass: vi.fn().mockRejectedValue(refused(code)) });
        const el = await mountDisplay(api);
        await pressFire(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(api.releaseDevicePass).toHaveBeenCalledOnce();
        const line = tableChanged(el)!;
        expect(line.getAttribute("role")).toBe("status");
        expect(line.textContent!.trim()).toBe(t("station.table_changed"));
        expect(leverError(el)).toBeNull();

        api.getDevicePassBoard.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        await refresh(el);
        expect(tableChanged(el)).not.toBeNull();
        await refresh(el);
        expect(tableChanged(el)).toBeNull();
        expect(api.releaseDevicePass).toHaveBeenCalledOnce();
      }));
  }

  it("clears the refreshed sentence with the next Fire press, before its answer", async () => {
    const answer = deferred<PassReleaseResult>();
    const api = fakeApi({
      releaseDevicePass: vi
        .fn()
        .mockRejectedValueOnce(refused("ticket.pass_context_changed"))
        .mockImplementationOnce(() => answer.promise),
    });
    const el = await mountDisplay(api);
    await pressFire(el);
    expect(tableChanged(el)).not.toBeNull();
    await pressFire(el);
    expect(api.releaseDevicePass).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)).toBeNull();
    answer.resolve({ releasedTicketItemIds: [] });
    await flush(el);
  });

  for (const [where, mountOn] of [
    ["a kitchen display", mountDisplay],
    ["a till", mountTill],
  ] as const) {
    it(`on ${where}, shows another refusal's words until the next press, through good reads`, () =>
      withFakeTimers(async () => {
        const answer = deferred<PassReleaseResult>();
        const api = fakeApi({
          releaseDevicePass: vi
            .fn()
            .mockRejectedValueOnce(refused("device.forbidden_action", 403))
            .mockImplementationOnce(() => answer.promise),
        });
        const el = await mountOn(api);
        await pressFire(el);
        expect(leverError(el)!.textContent).toContain(codeMessage("device.forbidden_action"));
        expect(leverError(el)!.textContent!.trim()).toBe(
          `#1 T1: ${codeMessage("device.forbidden_action")}`,
        );
        await refresh(el);
        await refresh(el);
        expect(leverError(el)!.textContent).toContain(codeMessage("device.forbidden_action"));
        await pressFire(el);
        expect(leverError(el)).toBeNull();
        answer.resolve({ releasedTicketItemIds: [] });
        await flush(el);
      }));
  }

  for (const [where, props] of [
    ["a pass monitor", { monitor: true, initialBoard: deviceBoard() }],
  ] as const) {
    it(`never releases from ${where}`, async () => {
      const api = fakeApi({ getDeviceIdentity: vi.fn().mockResolvedValue(identity(null)) });
      const el = await mount({ api, ...props });
      expect(boardOf(el)!.mode).not.toBe("pass");
      expect(fireButton(el)).toBeNull();
      boardOf(el)!.dispatchEvent(
        new CustomEvent("pass-fire", {
          detail: { key: "group:g-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.releaseDevicePass).not.toHaveBeenCalled();
    });
  }

  it("says the screen was refreshed in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es");
    try {
      const api = fakeApi({
        releaseDevicePass: vi.fn().mockRejectedValue(refused("ticket.pass_context_changed")),
      });
      const el = await mountDisplay(api);
      await pressFire(el);
      expect(tableChanged(el)!.textContent!.trim()).toBe(
        "La pantalla se ha actualizado: revísala y vuelve a pulsar.",
      );
    } finally {
      setLocale(previous);
    }
  });

  for (const code of ["device.unauthorized", "kitchen_screen.not_allowed"]) {
    it(`on a kitchen display, a Fire refused ${code} asks the app to re-read the screen and shows no refusal`, async () => {
      const api = fakeApi({ releaseDevicePass: vi.fn().mockRejectedValue(refused(code, 403)) });
      const el = await mountDisplay(api);
      const switched = vi.fn();
      document.addEventListener("kitchen-screen-changed", switched);
      try {
        await pressFire(el);
      } finally {
        document.removeEventListener("kitchen-screen-changed", switched);
      }
      expect(switched).toHaveBeenCalledOnce();
      expect((switched.mock.calls[0]![0] as CustomEvent).detail).toEqual({ from: "pass" });
      expect(leverError(el)).toBeNull();
      expect(tableChanged(el)).toBeNull();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    });
  }

  it("on a till, a Fire refused service_zone.not_allowed says the profile can be changed, in both languages", async () => {
    const api = fakeApi({
      releaseDevicePass: vi.fn().mockRejectedValue(refused("service_zone.not_allowed", 403)),
    });
    const el = await mountTill(api);
    await pressFire(el);
    expect(leverError(el)!.textContent!.trim()).toBe(
      "#1 T1: This device's profile does not work in that area. It can be changed in the dashboard, under Device profiles.",
    );
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const inSpanish = await mountTill(api);
      await pressFire(inSpanish);
      expect(leverError(inSpanish)!.textContent!.trim()).toBe(
        "#1 T1: El perfil de este dispositivo no trabaja en esa zona. Se puede cambiar en el panel, en Perfiles de dispositivo.",
      );
    } finally {
      setLocale(previous);
    }
  });

  it("on a till, a Fire refused kitchen_screen.not_allowed shows its words and asks for nothing", async () => {
    const code = "kitchen_screen.not_allowed";
    const api = fakeApi({ releaseDevicePass: vi.fn().mockRejectedValue(refused(code, 403)) });
    const el = await mountTill(api);
    const switched = vi.fn();
    document.addEventListener("kitchen-screen-changed", switched);
    try {
      await pressFire(el);
    } finally {
      document.removeEventListener("kitchen-screen-changed", switched);
    }
    expect(switched).not.toHaveBeenCalled();
    expect(leverError(el)!.textContent).toContain(codeMessage(code));
  });

  it("on a till, a Fire refused device.unauthorized re-reads the device's choice, follows it and says the screen was refreshed", async () => {
    const api = fakeApi({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce(identity("pass"))
        .mockResolvedValue(identity(null)),
      releaseDevicePass: vi.fn().mockRejectedValue(refused("device.unauthorized", 401)),
    });
    const el = await mountTill(api);
    const switched = vi.fn();
    document.addEventListener("kitchen-screen-changed", switched);
    try {
      await pressFire(el);
    } finally {
      document.removeEventListener("kitchen-screen-changed", switched);
    }
    expect(switched).not.toHaveBeenCalled();
    expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
    expect(boardOf(el)).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("kitchen_screen.none"));
    expect(leverError(el)).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(codeMessage("device.unauthorized"));
  });

  it("on a till whose pass screen a narrowing took, a Fire refused device.unauthorized shows the screen's line, and no sentence once it is back", () =>
    withFakeTimers(async () => {
      const gone = identity("pass");
      gone.kitchenScreens = [{ ...gone.kitchenScreens[0]!, available: false }];
      const api = fakeApi({
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValueOnce(identity("pass"))
          .mockResolvedValueOnce(gone)
          .mockResolvedValue(identity("pass")),
        releaseDevicePass: vi.fn().mockRejectedValue(refused("device.unauthorized", 401)),
      });
      const el = await mountTill(api);
      await pressFire(el);
      expect(boardOf(el)).toBeNull();
      expect(
        [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
          line.textContent!.trim(),
        ),
      ).toEqual([kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" })]);
      expect(el.shadowRoot!.textContent).not.toContain(codeMessage("device.unauthorized"));

      await refresh(el);
      expect(boardOf(el)).not.toBeNull();
      expect(tableChanged(el)).toBeNull();
    }));

  for (const [answer, settle] of [
    ["success", (fire: Fn) => fire.mockResolvedValueOnce({ releasedTicketItemIds: ["r-1"] })],
    ["refusal", (fire: Fn) => fire.mockRejectedValueOnce(refused("device.forbidden_action", 403))],
  ] as const) {
    it(`sends a new submission id on the press after an answered Fire (${answer})`, async () => {
      const fire = vi.fn();
      settle(fire);
      fire.mockResolvedValue({ releasedTicketItemIds: ["r-1"] });
      const api = fakeApi({
        releaseDevicePass: fire,
        getDevicePassBoard: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      const el = await mountDisplay(api);
      await pressFire(el);
      expect(fireButton(el)).not.toBeNull();
      await pressFire(el);
      const [first, second] = fire.mock.calls.map((call) => call[0] as PassReleaseAsk);
      expect(fire).toHaveBeenCalledTimes(2);
      expect(second!.submissionId).toMatch(UUID);
      expect(second!.submissionId).not.toBe(first!.submissionId);
    });
  }

  for (const [why, props, card] of [
    ["a device that does not run the pass", { runsPass: false }, fireCard()],
    ["a card with nothing to release", {}, fireCard({ releaseTicketItemIds: [] })],
  ] as const) {
    it(`sends nothing for a Fire event from ${why}`, async () => {
      const api = fakeApi();
      const el = await mount({
        api,
        deviceMode: true,
        ...props,
        initialBoard: deviceBoard(toFireBoard(card)),
      });
      boardOf(el)!.dispatchEvent(
        new CustomEvent("pass-fire", {
          detail: { key: "group:g-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.releaseDevicePass).not.toHaveBeenCalled();
    });
  }

  /** A read that lands while a Fire is out, then the Fire's answer is lost. */
  async function loseAnswerAfterRead(readContext: string): Promise<PassReleaseAsk[]> {
    const answer = deferred<PassReleaseResult>();
    const api = fakeApi({
      releaseDevicePass: vi
        .fn()
        .mockImplementationOnce(() => answer.promise)
        .mockResolvedValue({ releasedTicketItemIds: [] }),
      getDevicePassBoard: vi
        .fn()
        .mockResolvedValue(
          deviceBoard(
            toFireBoard(
              fireCard({ releaseContext: readContext, releaseTicketItemIds: ["r-1", "r-3"] }),
            ),
          ),
        ),
    });
    const el = await mountDisplay(api);
    await pressFire(el);
    await refresh(el);
    expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
    answer.reject(new TypeError("Failed to fetch"));
    await flush(el);
    await pressFire(el);
    expect(api.releaseDevicePass).toHaveBeenCalledTimes(2);
    return api.releaseDevicePass.mock.calls.map((call) => call[0] as PassReleaseAsk);
  }

  it("keeps a Fire's ask through a board read that lands while it is out with the same context, so a lost answer resends it unchanged", () =>
    withFakeTimers(async () => {
      const [first, second] = await loseAnswerAfterRead("ctx-1");
      expect(second).toEqual(first);
    }));

  it("drops a Fire's ask when a board read that landed while it was out offers a different context, so the next press sends the card as last read", () =>
    withFakeTimers(async () => {
      const [first, second] = await loseAnswerAfterRead("ctx-2");
      expect(second).toEqual({
        submissionId: expect.stringMatching(UUID),
        target: { kind: "group", partyId: "p-1", groupId: "g-1" },
        ticketItemIds: ["r-1", "r-3"],
        expectedContext: "ctx-2",
      });
      expect(second!.submissionId).not.toBe(first!.submissionId);
    }));

  it("drops a Fire's ask when a board read that landed while it was out no longer offers the card, so a later Fire event sends nothing", () =>
    withFakeTimers(async () => {
      const answer = deferred<PassReleaseResult>();
      const api = fakeApi({
        releaseDevicePass: vi
          .fn()
          .mockImplementationOnce(() => answer.promise)
          .mockResolvedValue({ releasedTicketItemIds: [] }),
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(passBoard())),
      });
      const el = await mountDisplay(api);
      await pressFire(el);
      await refresh(el);
      answer.reject(new TypeError("Failed to fetch"));
      await flush(el);
      boardOf(el)!.dispatchEvent(
        new CustomEvent("pass-fire", {
          detail: { key: "group:g-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.releaseDevicePass).toHaveBeenCalledOnce();
    }));

  it("on a till whose screen changed while a Fire was out, the answer shows no refusal and reads no board", () =>
    withFakeTimers(async () => {
      const answer = deferred<PassReleaseResult>();
      const api = fakeApi({
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValueOnce(identity("pass"))
          .mockResolvedValue(identity(null)),
        releaseDevicePass: vi.fn(() => answer.promise),
      });
      const el = await mountTill(api);
      await pressFire(el);
      await refresh(el);
      expect(boardOf(el)).toBeNull();
      answer.reject(refused("device.forbidden_action", 403));
      await flush(el);
      expect(leverError(el)).toBeNull();
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
    }));
});

describe("A773 pass screen: a refusal line after a press low in a long column", () => {
  afterEach(resetPage);

  const longBoard = passBoard({
    toFire: Array.from({ length: 12 }, (_, index) =>
      fireCard({
        key: `group:g-${index + 1}`,
        target: { kind: "group", partyId: "p-1", groupId: `g-${index + 1}` },
      }),
    ),
  });
  /** In progress group cards of tables T1 to T12, each with its own order. */
  const longReadyBoard = passBoard({
    inProgress: Array.from({ length: 12 }, (_, index) =>
      passCard({
        key: `group:g-${index + 1}`,
        target: { kind: "group", partyId: `p-${index + 1}`, groupId: `g-${index + 1}` },
        kind: "next_course",
        party: { id: `p-${index + 1}`, revision: 7 },
        orders: [
          {
            dining: "eat_in",
            orderId: `order-${index + 1}`,
            orderNumber: index + 1,
            tableLabel: `T${index + 1}`,
            kitchenNote: null,
          },
        ],
        group: { displayNumber: 1, position: 1 },
        items: [passItem({ id: `i-${index + 1}`, orderId: `order-${index + 1}` })],
      }),
    ),
  });

  const lowControl = (el: TillPassScreen, selector: string) =>
    boardOf(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;
  const scroller = () => document.scrollingElement!;

  async function pressLow(el: TillPassScreen, selector: string): Promise<void> {
    lowControl(el, selector).scrollIntoView({ block: "end" });
    expect(scroller().scrollTop).toBeGreaterThan(0);
    await userEvent.click(lowControl(el, selector));
    await flush(el);
  }

  function expectInView(line: HTMLElement | null): void {
    expect(line).not.toBeNull();
    const box = line!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(scroller().clientHeight);
  }

  /** Safari before 27 keeps the scroll position when content above the view changes height. */
  async function withoutScrollAnchoring(run: () => Promise<void>): Promise<void> {
    document.documentElement.style.overflowAnchor = "none";
    try {
      await run();
    } finally {
      document.documentElement.style.overflowAnchor = "";
    }
  }

  /** At 390 px the title, the overdue count and Columns wrap onto two rows; without the count, one. */
  async function mountOverdueThenNot(api: FakeApi): Promise<TillPassScreen> {
    await pageAt(390, 844);
    const overdue = passCard({
      key: "bill:late",
      items: [passItem({ id: "late-item", queuedAt: minutesAgo(12), band: "fresh" })],
    });
    const el = await mount({
      api,
      deviceMode: true,
      deviceName: "Pass by the back door",
      initialBoard: deviceBoard(passBoard({ toFire: longBoard.toFire, inProgress: [overdue] })),
    });
    expect(boardOf(el)!.shadowRoot!.querySelector("[data-overdue-count]")).not.toBeNull();
    return el;
  }

  for (const [code, status, line] of [
    ["ticket.pass_context_changed", 409, tableChanged],
    ["device.forbidden_action", 403, leverError],
  ] as const)
    it(`at 390 px, keeps a Fire's ${code} line fully in view when the board read after it drops the overdue count above it`, () =>
      withoutScrollAnchoring(async () => {
        const api = fakeApi({
          getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longBoard)),
          releaseDevicePass: vi.fn().mockRejectedValue(refused(code, status)),
        });
        const el = await mountOverdueThenNot(api);
        await pressLow(el, '[data-pass-fire="group:g-12"]');
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.shadowRoot!.querySelector("[data-overdue-count]")).toBeNull();
        expectInView(line(el));
      }));

  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ] as const) {
    it(`at ${width} px, brings the refreshed line into view when a Fire scrolled down to is refused as changed, and an unrelated redraw scrolls nothing`, async () => {
      await pageAt(width, height);
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longBoard)),
        releaseDevicePass: vi.fn().mockRejectedValue(refused("ticket.pass_context_changed")),
      });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(longBoard) });
      await pressLow(el, '[data-pass-fire="group:g-12"]');
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      expectInView(tableChanged(el));

      fireButton(el, "group:g-12")!.scrollIntoView({ block: "end" });
      const scrolledBack = scroller().scrollTop;
      el.requestUpdate();
      await flush(el);
      expect(tableChanged(el)).not.toBeNull();
      expect(scroller().scrollTop).toBe(scrolledBack);
    });

    it(`at ${width} px, brings a Fire's other refusal into view`, async () => {
      await pageAt(width, height);
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longBoard)),
        releaseDevicePass: vi.fn().mockRejectedValue(refused("device.forbidden_action", 403)),
      });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(longBoard) });
      await pressLow(el, '[data-pass-fire="group:g-12"]');
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      expect(tableChanged(el)).toBeNull();
      expectInView(leverError(el));
    });

    it(`at ${width} px, brings the stale line into view when a Fire gets no answer`, async () => {
      await pageAt(width, height);
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longBoard)),
        releaseDevicePass: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(longBoard) });
      await pressLow(el, '[data-pass-fire="group:g-12"]');
      expect(api.releaseDevicePass).toHaveBeenCalledOnce();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      expectInView(el.shadowRoot!.querySelector<HTMLElement>("[data-stale]"));
    });

    it(`at ${width} px, scrolls nothing when a background read fails`, async () => {
      await pageAt(width, height);
      await withFakeTimers(async () => {
        const api = fakeApi({
          getDevicePassBoard: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        });
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(longBoard) });
        const low = () => fireButton(el, "group:g-12")!;
        low().scrollIntoView({ block: "end" });
        expect(scroller().scrollTop).toBeGreaterThan(0);
        const shownAt = low().getBoundingClientRect().top;
        await refresh(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
        // The page's scroll position moves by the line's height, so the card is what stays put.
        expect(low().getBoundingClientRect().top).toBe(shownAt);
      });
    });

    it(`at ${width} px, brings the refreshed line naming the table into view when a group Ready is refused as out of date`, async () => {
      await pageAt(width, height);
      const ready = vi.fn().mockRejectedValue(refused("party.out_of_date"));
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longReadyBoard)),
        bumpDeviceGroupReady: ready,
      });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(longReadyBoard) });
      await pressLow(el, '[data-group-ready="g-12"]');
      expect(ready).toHaveBeenCalledOnce();
      expect(tableChanged(el)!.textContent).toContain("T12");
      expectInView(tableChanged(el));
    });

    it(`at ${width} px, brings a refused reprint into view`, async () => {
      await pageAt(width, height);
      const reprint = vi.fn().mockRejectedValue(refused("printer.not_found", 502));
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(longReadyBoard)),
        reprintOrder: reprint,
      });
      const el = await mountTill(api);
      await pressLow(el, '[data-card="group:g-12"] [data-reprint="order-12"]');
      expect(reprint).toHaveBeenCalledWith("order-12");
      expectInView(el.shadowRoot!.querySelector<HTMLElement>("[data-reprint-error]"));
    });
  }
});
