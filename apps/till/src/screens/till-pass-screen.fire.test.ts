import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
import { PASS_NOW, passBoard, passCard, passItem } from "../../test/pass-board-fixtures.js";
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
});

function identity(kind: "pass" | "pass_monitor" | null): DeviceIdentity {
  return {
    deviceId: "dev-1",
    formFactor: "till",
    name: "Till 1",
    kitchenScreens: kind === null ? [] : [{ kind, available: true, stations: [], zones: null }],
  };
}

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = TillApi &
  Record<
    | "getDeviceIdentity"
    | "getDevicePassBoard"
    | "getDevicePassMonitorBoard"
    | "getExpoBoard"
    | "releaseDevicePass",
    Fn
  >;

function fakeApi(overrides: Record<string, unknown> = {}): FakeApi {
  return {
    getDeviceIdentity: vi.fn().mockResolvedValue(identity("pass")),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getExpoBoard: vi.fn().mockResolvedValue({ board: toFireBoard() }),
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
    ["a till's All stations", {}],
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
    });

    it(`on a till, a Fire refused ${code} shows its words and asks for nothing`, async () => {
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
  }
});
