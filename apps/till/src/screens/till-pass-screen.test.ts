import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allergenName } from "../i18n/allergen-names.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { kitchenScreenNoticeText } from "../kitchen-screen-notice.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PASS_COLUMNS } from "../state/kitchen-columns.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type { TillKitchenColumnsDialog } from "../widgets/kitchen-columns-dialog.js";
import type {
  DeviceIdentity,
  DevicePassBoard,
  PassBoard,
  PassCardItem,
  ResolvedKitchenScreen,
  TillApi,
} from "../api/client.js";
import {
  PASS_NOW,
  minutesAgo,
  passBoard,
  passCard,
  passItem,
} from "../../test/pass-board-fixtures.js";
import { TillPassScreen } from "./till-pass-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";
import "./till-station-screen.js";

const BOX = "https://box.local";
const COLUMNS_PREFIX = "waitron.kitchenColumns.";
const columnsKey = (screen: string) =>
  `${COLUMNS_PREFIX}v1.${JSON.stringify([BOX, "dev-1", screen, ""])}`;

const storedColumnKeys = (): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(COLUMNS_PREFIX)) keys.push(key);
  }
  return keys;
};

afterEach(cleanupWidgets);
afterEach(() => {
  for (const key of storedColumnKeys()) localStorage.removeItem(key);
});

const boardA = passBoard({ inProgress: [passCard({ key: "bill:a" })] });
const boardB = passBoard({ inProgress: [passCard({ key: "bill:b" })] });

const deviceBoard = (
  board: PassBoard = boardA,
  slots: Partial<Pick<DevicePassBoard, "stations" | "zones">> = {},
): DevicePassBoard => ({ board, stations: [], zones: null, ...slots });

function identity(kitchenScreens: ResolvedKitchenScreen[]): DeviceIdentity {
  return { deviceId: "dev-1", formFactor: "till", name: "Till 1", kitchenScreens };
}

const chosen = (kind: ResolvedKitchenScreen["kind"], available = true): ResolvedKitchenScreen => ({
  kind,
  available,
  stations: [],
  zones: null,
  nonPassStationsOverride: null,
  showNonPassStations: true,
});

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getDeviceIdentity: vi.fn().mockResolvedValue(identity([])),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getExpoBoard: vi.fn().mockResolvedValue({ board: boardA }),
    ...overrides,
  } as unknown as TillApi &
    Record<
      "getDeviceIdentity" | "getDevicePassBoard" | "getDevicePassMonitorBoard" | "getExpoBoard",
      ReturnType<typeof vi.fn>
    >;
}

const realSetTimeout = globalThis.setTimeout;
async function flush(el: TillPassScreen): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
  await boardOf(el)?.updateComplete;
}

async function mount(props: Partial<TillPassScreen>): Promise<TillPassScreen> {
  const { el } = await mountWidget<TillPassScreen>("till-pass-screen", {
    api: fakeApi(),
    runsPass: true,
    deviceId: "dev-1",
    serverOrigin: BOX,
    now: PASS_NOW,
    reducedMotion: false,
    ...props,
  });
  await flush(el);
  return el;
}

const boardOf = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board");
const cardKeys = (el: TillPassScreen) =>
  [...boardOf(el)!.shadowRoot!.querySelectorAll("[data-card]")].map((card) =>
    card.getAttribute("data-card"),
  );

async function withFakeTimers(run: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
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

/** Answers as `fetch` does: at once, refused, when its signal was cancelled before it set out. */
const likeFetch =
  <T>(value: T) =>
  (options?: { signal?: AbortSignal }) =>
    options?.signal?.aborted ? Promise.reject(options.signal.reason) : Promise.resolve(value);
const hangUntilAborted = (options?: { signal?: AbortSignal }) =>
  new Promise<never>((_resolve, reject) =>
    options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
  );

async function listening(run: (reboot: ReturnType<typeof vi.fn>) => Promise<void>): Promise<void> {
  const reboot = vi.fn();
  document.addEventListener("device-unauthorized", reboot);
  try {
    await run(reboot);
  } finally {
    document.removeEventListener("device-unauthorized", reboot);
  }
}

describe("A773 pass screen", () => {
  describe("a kitchen display's pass", () => {
    it("reads its board once on connect when none was handed to it, and draws it as the pass", async () => {
      const api = fakeApi();
      const el = await mount({ api, deviceMode: true });
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      expect(boardOf(el)!.mode).toBe("pass");
      expect(boardOf(el)!.board).toEqual(boardA);
      expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
      expect(api.getExpoBoard).not.toHaveBeenCalled();
      expect(api.getDeviceIdentity).not.toHaveBeenCalled();
    });

    it("adopts a board handed to it without a read, then refreshes every fifteen seconds", () =>
      withFakeTimers(async () => {
        const api = fakeApi({ getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)) });
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(cardKeys(el)).toEqual(["bill:b"]);
      }));

    it("that does not run the pass draws its board with no Fire, Ready or Reprint", async () => {
      const board = passBoard({
        toFire: [
          passCard({
            key: "group:g-2",
            target: { kind: "group", partyId: "p-1", groupId: "g-2" },
            items: [passItem({ id: "f-a", phase: "requested", firedAt: null })],
            releaseTicketItemIds: ["f-a"],
            releaseContext: "ctx-1",
          }),
        ],
        inProgress: [
          passCard({
            key: "group:g-1",
            target: { kind: "group", partyId: "p-1", groupId: "g-1" },
            party: { id: "p-1", revision: 7 },
          }),
          passCard(),
        ],
      });
      const buttons = "[data-pass-fire], [data-group-ready], [data-ready], [data-reprint]";
      const runs = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
      expect(boardOf(runs)!.shadowRoot!.querySelectorAll(buttons).length).toBeGreaterThan(0);
      runs.remove();
      const el = await mount({
        deviceMode: true,
        runsPass: false,
        initialBoard: deviceBoard(board),
      });
      expect(cardKeys(el)).toEqual(["group:g-2", "group:g-1", "bill:order-1"]);
      expect(boardOf(el)!.shadowRoot!.querySelectorAll(buttons)).toHaveLength(0);
    });

    it("embedded in its card, adopts the board handed to it without a read, then refreshes its own pass board", () =>
      withFakeTimers(async () => {
        const api = fakeApi({ getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)) });
        const el = await mount({
          api,
          embedded: true,
          deviceMode: true,
          initialBoard: deviceBoard(),
        });
        expect(boardOf(el)!.mode).toBe("pass");
        expect(cardKeys(el)).toEqual(["bill:a"]);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(cardKeys(el)).toEqual(["bill:b"]);
        expect(api.getExpoBoard).not.toHaveBeenCalled();
        expect(api.getDeviceIdentity).not.toHaveBeenCalled();
      }));
  });

  it("a pass monitor reads the monitor's board and draws it as a monitor", async () => {
    const api = fakeApi();
    const el = await mount({ api, monitor: true });
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    expect(boardOf(el)!.mode).toBe("monitor");
    expect(boardOf(el)!.board).toEqual(boardA);
  });

  describe("a till follows its device's choice", () => {
    it.each([
      [[chosen("pass")], "getDevicePassBoard", "pass"],
      [[chosen("pass_monitor")], "getDevicePassMonitorBoard", "monitor"],
      [[], "getExpoBoard", "all_stations"],
    ] as const)("%j reads %s and draws %s", async (screens, read, mode) => {
      const api = fakeApi({ getDeviceIdentity: vi.fn().mockResolvedValue(identity([...screens])) });
      const el = await mount({ api });
      for (const name of [
        "getDevicePassBoard",
        "getDevicePassMonitorBoard",
        "getExpoBoard",
      ] as const)
        expect(api[name]).toHaveBeenCalledTimes(name === read ? 1 : 0);
      expect(boardOf(el)!.mode).toBe(mode);
      expect(cardKeys(el)).toEqual(["bill:a"]);
    });

    it.each([
      [[], "all_stations"],
      [[chosen("pass")], "pass"],
    ] as const)(
      "%j draws group and course Ready only when the till runs the pass",
      async (screens, mode) => {
        const board = passBoard({
          inProgress: [
            passCard({
              key: "group:g-1",
              target: { kind: "group", partyId: "p-1", groupId: "g-1" },
              party: { id: "p-1", revision: 7 },
            }),
            passCard(),
          ],
        });
        const api = () =>
          fakeApi({
            getDeviceIdentity: vi.fn().mockResolvedValue(identity([...screens])),
            getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(board)),
            getExpoBoard: vi.fn().mockResolvedValue({ board }),
          });
        const ready = "[data-group-ready], [data-ready]";
        const runs = await mount({ api: api() });
        expect(boardOf(runs)!.mode).toBe(mode);
        expect(boardOf(runs)!.shadowRoot!.querySelectorAll(ready).length).toBeGreaterThan(0);
        runs.remove();
        const el = await mount({ api: api(), runsPass: false });
        expect(boardOf(el)!.mode).toBe(mode);
        expect(cardKeys(el)).toEqual(["group:g-1", "bill:order-1"]);
        expect(boardOf(el)!.shadowRoot!.querySelectorAll(ready)).toHaveLength(0);
      },
    );

    it("switches the read and clears the old board when the choice changes between refreshes", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getExpoBoard: vi.fn(() => new Promise(() => {})),
        });
        const el = await mount({ api });
        expect(cardKeys(el)).toEqual(["bill:a"]);
        api.getDeviceIdentity.mockResolvedValue(identity([]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getExpoBoard).toHaveBeenCalledOnce();
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("all_stations");
        expect(cardKeys(el)).toEqual([]);
      }));

    const goneLine = () => kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" });
    const unavailableLines = (el: TillPassScreen) =>
      [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
        line.textContent!.trim(),
      );
    const boardButtons = (el: TillPassScreen) =>
      boardOf(el)!.shadowRoot!.querySelectorAll(
        "[data-pass-fire], [data-group-ready], [data-ready], [data-reprint]",
      );

    it("shows the pass board again when the pass screen is given back while its line shows", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        api.getDeviceIdentity
          .mockResolvedValueOnce(identity([chosen("pass", false)]))
          .mockResolvedValue(identity([chosen("pass")]));
        const el = await mount({ api });
        expect(unavailableLines(el)).toEqual([goneLine()]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(unavailableLines(el)).toEqual([]);
        expect(cardKeys(el)).toEqual(["bill:a"]);
      }));

    it("keeps its line when reading the choice again fails", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        api.getDeviceIdentity
          .mockResolvedValueOnce(identity([chosen("pass", false)]))
          .mockRejectedValue({ code: "server.internal" });
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(unavailableLines(el)).toEqual([goneLine()]);
        expect(api.getExpoBoard).not.toHaveBeenCalled();
        expect(boardOf(el)).toBeNull();
      }));

    it("ignores an older choice read that answers after a newer one", () =>
      withFakeTimers(async () => {
        const late = deferred<DeviceIdentity>();
        const api = fakeApi();
        api.getDeviceIdentity
          .mockResolvedValueOnce(identity([chosen("pass", false)]))
          .mockReturnValueOnce(late.promise)
          .mockResolvedValue(identity([chosen("pass")]));
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(30_000);
        await flush(el);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
        expect(cardKeys(el)).toEqual(["bill:a"]);
        late.resolve(identity([chosen("pass", false)]));
        await flush(el);
        expect(unavailableLines(el)).toEqual([]);
        expect(cardKeys(el)).toEqual(["bill:a"]);
      }));

    it("leaves the pass for the pass monitor at the next refresh when the choice is now a monitor", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)),
        });
        const el = await mount({ api });
        expect(cardKeys(el)).toEqual(["bill:a"]);
        expect(boardButtons(el).length).toBeGreaterThan(0);
        api.getDeviceIdentity.mockResolvedValue(identity([chosen("pass_monitor")]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("monitor");
        expect(cardKeys(el)).toEqual(["bill:b"]);
        expect(boardButtons(el)).toHaveLength(0);
      }));

    it("marks its pass board out of date, reading no other board, when a refresh is refused device.unauthorized and the choice is unchanged", () =>
      listening((reboot) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          });
          const el = await mount({ api });
          api.getDevicePassBoard.mockRejectedValue({ code: "device.unauthorized" });
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
          expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
          expect(api.getExpoBoard).not.toHaveBeenCalled();
          expect(el.shadowRoot!.querySelector(".stale[data-stale]")).not.toBeNull();
          expect(cardKeys(el)).toEqual(["bill:a"]);
          expect(reboot).not.toHaveBeenCalled();
        }),
      ));

    it.each([
      ["pass", "getDevicePassBoard", "pass", true],
      ["pass_monitor", "getDevicePassMonitorBoard", "monitor", false],
    ] as const)(
      "leaves All stations for a %s chosen while it is open, and keeps reading it",
      (kind, read, mode, buttons) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)),
            getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)),
          });
          const el = await mount({ api });
          expect(api.getExpoBoard).toHaveBeenCalledOnce();
          api.getDeviceIdentity.mockResolvedValue(identity([chosen(kind)]));
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(api.getExpoBoard).toHaveBeenCalledOnce();
          expect(api[read]).toHaveBeenCalledOnce();
          expect(boardOf(el)!.mode).toBe(mode);
          expect(cardKeys(el)).toEqual(["bill:b"]);
          expect(boardButtons(el).length > 0).toBe(buttons);
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
          expect(api[read]).toHaveBeenCalledTimes(2);
        }),
    );

    it("refreshes All stations every fifteen seconds at a till with no pass choice", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        const el = await mount({ api });
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
      }));
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-pass-screen")).toBe(TillPassScreen);
  });

  it("never lets a late read replace a newer one", () =>
    withFakeTimers(async () => {
      const first = deferred<DevicePassBoard>();
      const api = fakeApi({
        getDevicePassBoard: vi
          .fn()
          .mockReturnValueOnce(first.promise)
          .mockResolvedValueOnce(deviceBoard(boardB)),
      });
      const el = await mount({ api, deviceMode: true });
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(cardKeys(el)).toEqual(["bill:b"]);
      first.resolve(deviceBoard(boardA));
      await flush(el);
      expect(cardKeys(el)).toEqual(["bill:b"]);
    }));

  it("keeps the board and shows the stale line when a refresh fails, until the next good read", () =>
    withFakeTimers(async () => {
      const api = fakeApi({
        getDevicePassBoard: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValueOnce(deviceBoard(boardB)),
      });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
      expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-stale] till-stale-since")).not.toBeNull();
      expect(cardKeys(el)).toEqual(["bill:a"]);
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
      expect(cardKeys(el)).toEqual(["bill:b"]);
    }));

  it("draws a stale read's line as the station screen draws its own", () =>
    withFakeTimers(async () => {
      const api = fakeApi({ getDevicePassBoard: vi.fn().mockRejectedValue(new Error("offline")) });
      const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
      const { el: station } = await mountWidget<TillStationScreen>("till-station-screen", {
        api: {
          getDeviceStationScreen: vi.fn().mockRejectedValue(new Error("offline")),
        } as unknown as TillApi,
        deviceMode: true,
        initialDeviceStation: {
          stations: [
            {
              id: "st-1",
              name: "Cocina",
              available: true,
              today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" },
              queue: [],
              notices: [],
              printersDown: [],
            },
          ],
        },
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      await station.updateComplete;
      const look = (root: ShadowRoot) => {
        const style = getComputedStyle(root.querySelector("[data-stale]")!);
        return [
          style.backgroundColor,
          style.color,
          style.fontWeight,
          style.paddingTop,
          style.paddingLeft,
          style.borderTopLeftRadius,
        ];
      };
      expect(look(el.shadowRoot!)).toEqual(look(station.shadowRoot!));
      expect(
        getComputedStyle(el.shadowRoot!.querySelector("[data-stale]")!).backgroundColor,
      ).not.toBe("rgba(0, 0, 0, 0)");
    }));

  it("on a kitchen display, a read refused device.unauthorized emits device-unauthorized", async () => {
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const refused = Object.assign(new Error("401"), { code: "device.unauthorized" });
      await mount({
        api: fakeApi({ getDevicePassBoard: vi.fn().mockRejectedValue(refused) }),
        deviceMode: true,
      });
      expect(reboot).toHaveBeenCalledOnce();
      await mount({
        api: fakeApi({ getDevicePassMonitorBoard: vi.fn().mockRejectedValue(refused) }),
        monitor: true,
      });
      expect(reboot).toHaveBeenCalledTimes(2);
      await mount({
        api: fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockRejectedValue(refused),
        }),
      });
      expect(reboot).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("at a till, a pass read refused device.unauthorized re-boots nothing and the refresh goes on", () =>
    listening((reboot) =>
      withFakeTimers(async () => {
        const refused = Object.assign(new Error("401"), { code: "device.unauthorized" });
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockRejectedValue(refused),
        });
        await mount({ api });
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
        expect(reboot).not.toHaveBeenCalled();
      }),
    ));

  describe("reads and refreshes", () => {
    const stale = (el: TillPassScreen) => el.shadowRoot!.querySelector(".stale[data-stale]");

    it("hands the board the time it was given", async () => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard() });
      expect(boardOf(el)!.now).toBe(PASS_NOW);
    });

    it("marks its board out of date when a choice read never answers and is cancelled 25 seconds after it set out", () =>
      withFakeTimers(async () => {
        const api = fakeApi({ getDevicePassBoard: vi.fn(likeFetch(deviceBoard())) });
        api.getDeviceIdentity
          .mockResolvedValueOnce(identity([chosen("pass")]))
          .mockImplementation(hangUntilAborted);
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(39_999); // the choice read that set out at 15 s is still out
        await flush(el);
        expect(stale(el)).toBeNull();
        await vi.advanceTimersByTimeAsync(1); // and is cancelled at 40 s
        await flush(el);
        expect(stale(el)).not.toBeNull();
        expect(cardKeys(el)).toEqual(["bill:a"]);
      }));

    it("shows no stale line when an older refresh's choice read is cancelled after a newer refresh read its board", () =>
      withFakeTimers(async () => {
        const api = fakeApi({ getDevicePassBoard: vi.fn(likeFetch(deviceBoard())) });
        api.getDeviceIdentity
          .mockResolvedValueOnce(identity([chosen("pass")]))
          .mockImplementationOnce(hangUntilAborted) // 15 s, cancelled at 40 s
          .mockRejectedValueOnce({ code: "server.internal" }) // 30 s: keeps the pass and reads it
          .mockImplementation(() => new Promise(() => {}));
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(31_000);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(9_000);
        await flush(el);
        expect(stale(el)).toBeNull();
      }));

    it("shows no stale line when an older refresh's read fails after a newer refresh read its board", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDevicePassBoard: vi
            .fn()
            .mockImplementationOnce(hangUntilAborted) // 15 s, cancelled at 40 s
            .mockResolvedValueOnce(deviceBoard(boardB)) // 30 s
            .mockImplementation(() => new Promise(() => {})),
        });
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
        await vi.advanceTimersByTimeAsync(31_000);
        await flush(el);
        expect(cardKeys(el)).toEqual(["bill:b"]);
        await vi.advanceTimersByTimeAsync(9_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
        expect(stale(el)).toBeNull();
        expect(cardKeys(el)).toEqual(["bill:b"]);
      }));

    it("ignores a read that answers after it left the page", async () => {
      const answer = deferred<DevicePassBoard>();
      const api = fakeApi({ getDevicePassBoard: vi.fn(() => answer.promise) });
      const el = await mount({ api, deviceMode: true });
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      el.remove();
      answer.resolve(deviceBoard(boardB));
      await flush(el);
      expect(cardKeys(el)).toEqual([]);
    });

    it("ignores a failed read that answers after it left the page", async () => {
      const answer = deferred<DevicePassBoard>();
      const api = fakeApi({ getDevicePassBoard: vi.fn(() => answer.promise) });
      const el = await mount({ api, deviceMode: true });
      el.remove();
      answer.reject(new Error("offline"));
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
    });

    it("stops refreshing once taken off the page", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
        el.remove();
        await vi.advanceTimersByTimeAsync(45_000);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      }));

    it("at a till, stays on All stations, reading it, while the device's choice cannot be read", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockRejectedValue({ code: "server.internal" }),
        });
        const el = await mount({ api });
        expect(api.getExpoBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("all_stations");
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
        expect(cardKeys(el)).toEqual(["bill:a"]);
      }));

    it("an embedded card reads All stations every fifteen seconds and never the device's choice", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        const el = await mount({ api, embedded: true });
        expect(api.getExpoBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("all_stations");
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
        expect(api.getDeviceIdentity).not.toHaveBeenCalled();
      }));

    it("on a kitchen display, re-boots when a refresh is refused device.unauthorized, and not for any other failure", () =>
      listening((reboot) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getDevicePassBoard: vi.fn().mockRejectedValueOnce({ code: "server.internal" }),
          });
          const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(stale(el)).not.toBeNull();
          expect(reboot).not.toHaveBeenCalled();
          api.getDevicePassBoard.mockRejectedValueOnce({ code: "device.unauthorized" });
          await vi.advanceTimersByTimeAsync(15_000);
          expect(reboot).toHaveBeenCalledOnce();
        }),
      ));

    it("as a pass monitor, re-boots when a refresh is refused device.unauthorized", () =>
      listening((reboot) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getDevicePassMonitorBoard: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
          });
          await mount({ api, monitor: true, initialBoard: deviceBoard() });
          expect(reboot).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
          expect(reboot).toHaveBeenCalledOnce();
        }),
      ));

    it("an embedded card whose refresh is refused device.unauthorized marks its board out of date and re-boots nothing", () =>
      listening((reboot) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getExpoBoard: vi
              .fn()
              .mockResolvedValueOnce({ board: boardA })
              .mockRejectedValue({ code: "device.unauthorized" }),
          });
          const el = await mount({ api, embedded: true });
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(api.getExpoBoard).toHaveBeenCalledTimes(2);
          expect(reboot).not.toHaveBeenCalled();
          expect(stale(el)).not.toBeNull();
          expect(cardKeys(el)).toEqual(["bill:a"]);
        }),
      ));
  });

  describe("lost slots and a lost screen", () => {
    const lines = (el: TillPassScreen) =>
      [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
        line.textContent!.trim(),
      );

    it("shows each station and zone a narrowing took, in the board's status slot", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          stations: [
            { id: "st-1", name: "Parrilla", available: true },
            { id: "st-2", name: "Freidora", available: false },
          ],
          zones: [
            { id: "z-1", name: "Terraza", available: false },
            { id: "z-2", name: "Sala", available: true },
          ],
        }),
      });
      expect(lines(el)).toEqual([
        t("station.unavailable").replace("{name}", "Freidora"),
        t("zone.unavailable").replace("{name}", "Terraza"),
      ]);
      for (const line of el.shadowRoot!.querySelectorAll("[data-unavailable]")) {
        expect(line.getAttribute("slot")).toBe("status");
        expect(line.parentElement).toBe(boardOf(el));
      }
    });

    it("shows only its lines when a narrowing took every station", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          stations: [{ id: "st-2", name: "Freidora", available: false }],
        }),
      });
      expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Freidora")]);
      expect(boardOf(el)).toBeNull();
      expect(el.shadowRoot!.querySelector(".stale")).toBeNull();
    });

    it.each([
      [
        "a till following its pass",
        "getDevicePassBoard",
        { getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])) },
        {},
      ],
      ["a pass monitor", "getDevicePassMonitorBoard", {}, { monitor: true }],
    ] as const)(
      "%s shows only its lines when a narrowing took every station",
      async (_, read, overrides, props) => {
        const api = fakeApi({
          ...overrides,
          [read]: vi.fn().mockResolvedValue(
            deviceBoard(boardA, {
              stations: [{ id: "st-2", name: "Freidora", available: false }],
            }),
          ),
        });
        const el = await mount({ api, ...props });
        expect(api[read]).toHaveBeenCalledOnce();
        expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Freidora")]);
        expect(boardOf(el)).toBeNull();
      },
    );

    it("shows only its lines when a narrowing took every zone", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          zones: [{ id: "z-1", name: "Terraza", available: false }],
        }),
      });
      expect(lines(el)).toEqual([t("zone.unavailable").replace("{name}", "Terraza")]);
      expect(boardOf(el)).toBeNull();
    });

    it("at a till whose pass screen a narrowing took, says so and reads no board", async () => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass", false)])),
      });
      const el = await mount({ api });
      expect(lines(el)).toEqual([kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" })]);
      expect(boardOf(el)).toBeNull();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      expect(api.getExpoBoard).not.toHaveBeenCalled();
    });

    it("at a till whose pass screen a narrowing took, reads no board on a refresh either", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass", false)])),
        });
        await mount({ api });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
        expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
        expect(api.getExpoBoard).not.toHaveBeenCalled();
      }));

    it.each([
      [
        "en-GB",
        "This station is no longer available: Freidora",
        "This zone is no longer available: Terraza",
      ],
      [
        "es-ES",
        "Esta estación ya no está disponible: Freidora",
        "Esta zona ya no está disponible: Terraza",
      ],
    ])(
      "at a till following its pass, shows each station and zone a narrowing took (%s)",
      async (locale, stationLine, zoneLine) => {
        const previous = currentLocale();
        setLocale(locale);
        try {
          const api = fakeApi({
            getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
            getDevicePassBoard: vi.fn().mockResolvedValue(
              deviceBoard(boardA, {
                stations: [
                  { id: "st-grill", name: "Parrilla", available: true },
                  { id: "st-fryer", name: "Freidora", available: false },
                ],
                zones: [
                  { id: "z-room", name: "Sala", available: true },
                  { id: "z-terrace", name: "Terraza", available: false },
                ],
              }),
            ),
          });
          const el = await mount({ api });
          expect(lines(el)).toEqual([stationLine, zoneLine]);
          expect(cardKeys(el)).toEqual(["bill:a"]);
        } finally {
          setLocale(previous);
        }
      },
    );

    it("shows the board again once a read gives it a station back", () =>
      withFakeTimers(async () => {
        const lost = deviceBoard(boardA, {
          stations: [{ id: "st-2", name: "Freidora", available: false }],
        });
        const api = fakeApi({ getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)) });
        const el = await mount({ api, deviceMode: true, initialBoard: lost });
        expect(boardOf(el)).toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(lines(el)).toEqual([]);
        expect(cardKeys(el)).toEqual(["bill:b"]);
      }));

    it("at a till on All stations, drops that board when a later choice read says a narrowing took the pass screen", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        api.getDeviceIdentity
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(identity([chosen("pass", false)]));
        const el = await mount({ api });
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(boardOf(el)).toBeNull();
        expect(lines(el)).toEqual([
          kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" }),
        ]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getExpoBoard).toHaveBeenCalledOnce();
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      }));
  });

  describe("Columns", () => {
    const stored = (screen: string) => {
      const raw = localStorage.getItem(columnsKey(screen));
      return raw === null ? null : JSON.parse(raw);
    };
    const columnsWindow = (el: TillPassScreen) =>
      el.shadowRoot!.querySelector<TillKitchenColumnsDialog>("till-kitchen-columns-dialog");
    async function press(el: TillPassScreen, selector: string) {
      await userEvent.click(columnsWindow(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!);
      await flush(el);
    }
    async function changeAll(el: TillPassScreen) {
      boardOf(el)!
        .shadowRoot!.querySelector<HTMLElement>('[data-column-toggle="inProgress"]')!
        .click();
      await flush(el);
      await userEvent.click(
        boardOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-columns-open]")!,
      );
      await flush(el);
      await press(el, '[data-column-down="held"]');
      await press(el, '[data-column-show="ready"]');
    }
    const changed = {
      order: ["overview", "toFire", "held", "inProgress", "ready"],
      hidden: ["overview", "ready"],
      collapsed: ["inProgress"],
    };

    it("saves moving, hiding and collapsing under the pass's own key, and a remount reads it back", async () => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard() });
      expect(boardOf(el)!.columns).toEqual(PASS_COLUMNS);
      await changeAll(el);
      expect(boardOf(el)!.columns).toEqual(changed);
      expect(stored("pass")).toEqual({ version: 1, ...changed });
      expect(storedColumnKeys()).toEqual([columnsKey("pass")]);
      el.remove();
      const again = await mount({ deviceMode: true, initialBoard: deviceBoard() });
      expect(boardOf(again)!.columns).toEqual(changed);
    });

    it("keeps a pass monitor's layout under its own key", async () => {
      const el = await mount({ monitor: true, initialBoard: deviceBoard() });
      await changeAll(el);
      expect(storedColumnKeys()).toEqual([columnsKey("pass_monitor")]);
    });

    it("keeps a till's All stations layout under its own key", async () => {
      const el = await mount({});
      await changeAll(el);
      expect(storedColumnKeys()).toEqual([columnsKey("all_stations")]);
    });

    it("names the pass's columns, and the board, in the Columns window", async () => {
      const names = (el: TillPassScreen) =>
        [...columnsWindow(el)!.shadowRoot!.querySelectorAll("[data-column-name]")].map((name) =>
          name.textContent!.trim(),
        );
      const boardName = (el: TillPassScreen) =>
        columnsWindow(el)!
          .shadowRoot!.querySelector("wt-dialog")!
          .shadowRoot!.querySelector(".description")
          ?.textContent!.trim();
      const open = async (el: TillPassScreen) => {
        await userEvent.click(
          boardOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-columns-open]")!,
        );
        await flush(el);
        await columnsWindow(el)!.updateComplete;
      };
      const words = [
        t("station.overview"),
        t("pass.column.held"),
        t("pass.column.to_fire"),
        t("pass.column.in_progress"),
        t("pass.column.ready"),
      ];
      const display = await mount({
        deviceMode: true,
        deviceName: "Pass 1",
        initialBoard: deviceBoard(),
      });
      await open(display);
      expect(names(display)).toEqual(words);
      expect(boardName(display)).toBe("Pass 1");
      display.remove();
      const till = await mount({});
      await open(till);
      expect(names(till)).toEqual(words);
      expect(boardName(till)).toBe(t("expo.title"));
    });

    it("with a store that refuses every read and write, still changes the layout in memory", async () => {
      const refuse = () => {
        throw new DOMException("refused", "SecurityError");
      };
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
      try {
        const el = await mount({ deviceMode: true, initialBoard: deviceBoard() });
        expect(boardOf(el)!.columns).toEqual(PASS_COLUMNS);
        await changeAll(el);
        expect(boardOf(el)!.columns).toEqual(changed);
        expect(getItem).toHaveBeenCalled();
        expect(setItem).toHaveBeenCalled();
      } finally {
        getItem.mockRestore();
        setItem.mockRestore();
      }
    });

    it("with no device id saves nothing and still changes the layout in memory", async () => {
      const el = await mount({ deviceMode: true, deviceId: "", initialBoard: deviceBoard() });
      await changeAll(el);
      expect(boardOf(el)!.columns).toEqual(changed);
      expect(storedColumnKeys()).toEqual([]);
    });
  });

  describe("header", () => {
    const lead = (el: TillPassScreen) =>
      [...el.shadowRoot!.querySelectorAll('till-pass-board > [slot="lead"]')].map((node) =>
        node.textContent!.trim(),
      );

    it("on a display names the device and draws no Back", async () => {
      const el = await mount({
        deviceMode: true,
        deviceName: "Pass 1",
        initialBoard: deviceBoard(),
      });
      expect(lead(el)).toEqual(["Pass 1"]);
      expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
    });

    it("on a till names the pass and its Back emits back-to-counter once", async () => {
      const el = await mount({});
      expect(lead(el)).toEqual([t("expo.title"), t("expo.back")]);
      const back = el.shadowRoot!.querySelector<HTMLElement>("till-pass-board > [data-back]")!;
      expect(back.getAttribute("slot")).toBe("lead");
      const seen = vi.fn();
      el.addEventListener("back-to-counter", seen);
      back.click();
      expect(seen).toHaveBeenCalledOnce();
    });

    it("an embedded card draws no title and no Back", async () => {
      const el = await mount({ embedded: true });
      expect(boardOf(el)).not.toBeNull();
      expect(lead(el)).toEqual([]);
      expect(el.shadowRoot!.querySelector("[data-back], .title")).toBeNull();
    });

    it("puts the stale line in the board's status slot", async () => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard() });
      const stale = el.shadowRoot!.querySelector(".stale")!;
      expect(stale.getAttribute("slot")).toBe("status");
      expect(stale.parentElement).toBe(boardOf(el));
    });
  });

  describe("an empty board", () => {
    const empty = deviceBoard(passBoard());
    const words = (el: TillPassScreen) =>
      [...el.shadowRoot!.querySelectorAll("till-pass-board > [data-empty]")].map((node) =>
        node.textContent!.trim(),
      );

    it.each([
      ["a kitchen display's pass", "expo.watcher_empty", { deviceMode: true, initialBoard: empty }],
      ["a pass monitor", "expo.empty", { monitor: true, initialBoard: empty }],
      ["an embedded card on All stations", "expo.empty", { embedded: true }],
    ] as const)("%s says %s in the board's status slot", async (_, key, props) => {
      const api = fakeApi({ getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard() }) });
      const el = await mount({ api, ...props });
      expect(words(el)).toEqual([t(key)]);
      expect(el.shadowRoot!.querySelector("[data-empty]")!.getAttribute("slot")).toBe("status");
    });

    it("draws the words last in the status slot, after the stale line, and as no live region", async () => {
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const el = await mount({ api, deviceMode: true });
      const status = [...boardOf(el)!.querySelectorAll(':scope > [slot="status"]')];
      expect(el.shadowRoot!.querySelector(".stale[data-stale]")).not.toBeNull();
      expect(status.at(-1)!.hasAttribute("data-empty")).toBe(true);
      expect(status.at(-1)!.hasAttribute("role")).toBe(false);
    });

    it("draws the words after the table-changed line when a refused Fire's reload finds the board empty", async () => {
      const toFire = passCard({
        key: "group:g-1",
        target: { kind: "group", partyId: "p-1", groupId: "g-1" },
        kind: "next_course",
        items: [passItem({ id: "a", phase: "requested", firedAt: null })],
        releaseTicketItemIds: ["r-1"],
        releaseContext: "ctx-1",
      });
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(empty),
        releaseDevicePass: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409 }),
      });
      const el = await mount({
        api,
        deviceMode: true,
        initialBoard: deviceBoard(passBoard({ toFire: [toFire] })),
      });
      await userEvent.click(
        boardOf(el)!.shadowRoot!.querySelector<HTMLButtonElement>('[data-pass-fire="group:g-1"]')!,
      );
      await vi.waitFor(() => expect(api.getDevicePassBoard).toHaveBeenCalledOnce());
      await flush(el);
      const status = [...boardOf(el)!.querySelectorAll(':scope > [slot="status"]')];
      expect(el.shadowRoot!.querySelector("[data-table-changed]")).not.toBeNull();
      expect(status.at(-1)!.hasAttribute("data-empty")).toBe(true);
    });

    it.each([
      [[chosen("pass")], "expo.watcher_empty"],
      [[chosen("pass_monitor")], "expo.empty"],
      [[], "expo.empty"],
    ] as const)("a till whose device chose %j says %s", async (screens, key) => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue(identity([...screens])),
        getDevicePassBoard: vi.fn().mockResolvedValue(empty),
        getDevicePassMonitorBoard: vi.fn().mockResolvedValue(empty),
        getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard() }),
      });
      const el = await mount({ api });
      expect(words(el)).toEqual([t(key)]);
      expect(boardOf(el)!.shadowRoot!.querySelector("[data-card]")).toBeNull();
    });

    it.each(["held", "toFire", "inProgress", "ready"] as const)(
      "says nothing while one card waits in %s",
      async (column) => {
        const board = passBoard({ [column]: [passCard()] });
        const el = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
        expect(words(el)).toEqual([]);
      },
    );

    it("says nothing while the pass is gone", async () => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass", false)])),
        getExpoBoard: vi.fn().mockResolvedValue({ board: passBoard() }),
      });
      const el = await mount({ api });
      expect(el.shadowRoot!.querySelector("[data-empty]")).toBeNull();
    });
  });
});

describe("A773 pass screen: a till's All stations", () => {
  const mountAll = (board: PassBoard, props: Partial<TillPassScreen> = {}) => {
    const api = fakeApi({ getExpoBoard: vi.fn().mockResolvedValue({ board }) });
    return mount({ api, ...props }).then((el) => ({ api, el }));
  };
  const inBoard = (el: TillPassScreen) => boardOf(el)!.shadowRoot!;
  const cardOf = (el: TillPassScreen, key: string) =>
    inBoard(el).querySelector<HTMLElement>(`[data-card="${key}"]`)!;
  const itemOf = (el: TillPassScreen, id: string) =>
    inBoard(el).querySelector<HTMLElement>(`[data-item="${id}"]`)!;
  /** A card whose one dish was sent `minutes` ago, though the server still calls it fresh. */
  const aged = (key: string, minutes: number) =>
    passCard({
      key,
      items: [passItem({ id: `${key}-item`, queuedAt: minutesAgo(minutes), band: "fresh" })],
    });

  it("draws each dish's diet badges, contains chip and not-reviewed note, and no diet row on a plain dish", async () => {
    const card = passCard({
      items: [
        passItem({ id: "vegan", asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [] } }),
        passItem({
          id: "meat",
          asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
        }),
        passItem({
          id: "unknown",
          asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
        }),
        passItem({ id: "plain" }),
      ],
    });
    const { api, el } = await mountAll(passBoard({ inProgress: [card] }));
    expect(api.getExpoBoard).toHaveBeenCalledOnce();
    expect(itemOf(el, "vegan").querySelector("[data-diet='vegan']")).not.toBeNull();
    expect(itemOf(el, "vegan").querySelector("[data-diet='vegetarian']")).not.toBeNull();
    expect(itemOf(el, "vegan").textContent).not.toMatch(/review|revisi/i);
    expect(itemOf(el, "meat").querySelector("[data-diet-contains='meat']")).not.toBeNull();
    expect(itemOf(el, "meat").querySelector("[data-diet='vegan']")).toBeNull();
    expect(itemOf(el, "unknown").querySelector("[data-diet-pending]")).not.toBeNull();
    expect(itemOf(el, "unknown").querySelector("[data-diet='vegan']")).toBeNull();
    expect(itemOf(el, "plain").querySelector(".line-diet")).toBeNull();
  });

  it("draws a dish's option answers in the kitchen's wording, never the staff's or the customer's", async () => {
    const card = passCard({
      items: [
        passItem({
          optionSnapshots: [
            {
              listName: { es: "Punto personal" },
              listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
              listKitchenName: "PTO",
              labelName: { es: "Poco personal" },
              labelCustomerName: { "es-ES": "Poco hecho" },
              labelKitchenName: "PH",
            },
          ],
        }),
      ],
    });
    const { el } = await mountAll(passBoard({ inProgress: [card] }));
    expect(inBoard(el).querySelector(".modifier-answer")!.textContent).toBe("PTO: PH");
  });

  it("colours each card by its dishes' age on the screen's clock, not the server's band, and marks only a forgotten dish", async () => {
    const { el } = await mountAll(
      passBoard({ inProgress: [aged("fresh", 1), aged("overdue", 12), aged("forgotten", 16)] }),
    );
    expect(cardOf(el, "fresh").classList).toContain("age-fresh");
    expect(cardOf(el, "overdue").classList).toContain("age-overdue");
    expect(cardOf(el, "forgotten").classList).toContain("age-forgotten");
    const flag = itemOf(el, "forgotten-item").querySelector("[data-forgotten]");
    expect(flag!.textContent).toContain(t("expo.item_forgotten"));
    expect(itemOf(el, "overdue-item").querySelector("[data-forgotten]")).toBeNull();
    expect(itemOf(el, "fresh-item").querySelector("[data-forgotten]")).toBeNull();
  });

  it("counts the cards at overdue or worse, in English and Spanish, and shows no count when none is", async () => {
    const late = passBoard({ inProgress: [aged("a", 16), aged("b", 12), aged("c", 1)] });
    const count = (el: TillPassScreen) =>
      inBoard(el).querySelector("[data-overdue-count]")?.textContent?.trim();
    const { el } = await mountAll(late);
    expect(count(el)).toBe(`2 ${t("station.overdue_count")}`);

    cleanupWidgets();
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const { el: spanish } = await mountAll(late);
      expect(count(spanish)).toBe("2 con retraso");
    } finally {
      setLocale(previous);
    }

    cleanupWidgets();
    const { el: calm } = await mountAll(passBoard({ inProgress: [aged("c", 1)] }));
    expect(inBoard(calm).querySelector("[data-overdue-count]")).toBeNull();
  });

  it("flashes a forgotten card at the fast pulse token unless reduced motion is asked for, and never an overdue one", async () => {
    const board = passBoard({ inProgress: [aged("forgotten", 16), aged("overdue", 12)] });
    const { el } = await mountAll(board);
    const forgotten = cardOf(el, "forgotten");
    expect(forgotten.classList).toContain("flash");
    expect(getComputedStyle(forgotten).animationName).toBe("age-forgotten-flash");
    expect(getComputedStyle(forgotten).animationDuration).toBe("1s");
    el.style.setProperty("--wt-duration-pulse-fast", "3000ms");
    expect(getComputedStyle(forgotten).animationDuration).toBe("3s");
    expect(cardOf(el, "overdue").classList).not.toContain("flash");

    cleanupWidgets();
    const { el: still } = await mountAll(board, { reducedMotion: true });
    expect(cardOf(still, "forgotten").classList).toContain("age-forgotten");
    expect(cardOf(still, "forgotten").classList).not.toContain("flash");
    expect(cardOf(still, "overdue").classList).not.toContain("flash");
  });

  it("moves a card's colour on when its clock moves, without reading the board again", async () => {
    const { api, el } = await mountAll(passBoard({ inProgress: [aged("card", 1)] }));
    expect(cardOf(el, "card").classList).toContain("age-fresh");
    el.now = PASS_NOW + 15 * 60_000;
    await flush(el);
    expect(cardOf(el, "card").classList).toContain("age-forgotten");
    expect(api.getExpoBoard).toHaveBeenCalledOnce();
  });

  it("says the pass is empty, drawing no card, when its first read fails", async () => {
    const api = fakeApi({ getExpoBoard: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const el = await mount({ api });
    expect(api.getExpoBoard).toHaveBeenCalledOnce();
    expect(
      [...el.shadowRoot!.querySelectorAll("till-pass-board > [data-empty]")].map((node) =>
        node.textContent!.trim(),
      ),
    ).toEqual([t("expo.empty")]);
    expect(inBoard(el).querySelector("[data-card]")).toBeNull();
  });
});

describe("A773 pass screen: a till's All stations, its extras and portions", () => {
  const mountAll = async (board: PassBoard) => {
    const api = fakeApi({ getExpoBoard: vi.fn().mockResolvedValue({ board }) });
    const el = await mount({ api });
    expect(boardOf(el)!.mode).toBe("all_stations");
    return el;
  };
  const inBoard = (el: TillPassScreen) => boardOf(el)!.shadowRoot!;
  const itemOf = (el: TillPassScreen, id: string) =>
    inBoard(el).querySelector<HTMLElement>(`[data-item="${id}"]`)!;
  const names = (el: TillPassScreen) =>
    [...inBoard(el).querySelectorAll(".item-name")].map((name) => name.textContent);
  const portion = (id: string, overrides: Partial<PassCardItem> = {}): PassCardItem =>
    passItem({
      id,
      name: "Burger",
      qty: "1.000",
      unitName: null,
      unitPrecision: 0,
      soldInEach: true,
      state: "preparing",
      phase: "preparing",
      ...overrides,
    });
  const onCard = (items: PassCardItem[]) => passBoard({ inProgress: [passCard({ items })] });

  it("names extras made at another station, with the extra's nutrition, never as a '+' extra, and none on a dish without", async () => {
    const el = await mountAll(
      onCard([
        passItem({
          id: "with",
          crossRefs: [
            {
              kind: "with",
              name: "CHIPS",
              perDish: 2,
              stationName: "Fryer",
              addAllergens: { gluten: { kinds: ["wheat"] } },
              suitableFor: [],
            },
          ],
        }),
        passItem({ id: "for", crossRefs: [{ kind: "for", name: "BURG", stationName: "Grill" }] }),
        passItem({ id: "none", crossRefs: [{ kind: "for", name: "AGUA", stationName: null }] }),
        passItem({ id: "plain" }),
      ]),
    );
    const withRef = itemOf(el, "with").querySelector("[data-crossref]")!.textContent!;
    expect(withRef).toContain("with CHIPS x2 from Fryer");
    expect(withRef).toContain(allergenName("gluten", currentLocale()));
    expect(itemOf(el, "for").querySelector("[data-crossref]")!.textContent).toContain(
      "for BURG at Grill",
    );
    expect(itemOf(el, "none").querySelector("[data-crossref]")!.textContent).toContain(
      "for AGUA, no preparation",
    );
    expect(itemOf(el, "plain").querySelector(".crossref, [data-crossref]")).toBeNull();
    expect(inBoard(el).textContent).not.toContain("+ CHIPS");
  });

  it("words extras made at another station in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es-ES");
    try {
      const el = await mountAll(
        onCard([
          passItem({
            id: "with",
            crossRefs: [{ kind: "with", name: "CHIPS", perDish: 2, stationName: "Fryer" }],
          }),
          passItem({ id: "none", crossRefs: [{ kind: "for", name: "AGUA", stationName: null }] }),
        ]),
      );
      expect(itemOf(el, "with").querySelector("[data-crossref]")!.textContent).toContain(
        "con CHIPS x2 de Fryer",
      );
      expect(itemOf(el, "none").querySelector("[data-crossref]")!.textContent).toContain(
        "para AGUA, sin preparación",
      );
    } finally {
      setLocale(previous);
    }
  });

  it("draws identical portions as one row with their count", async () => {
    const el = await mountAll(
      onCard([portion("p1"), portion("f1", { name: "Fish" }), portion("p2")]),
    );
    expect(names(el)).toEqual(["2× Burger", "1× Fish"]);
    expect(inBoard(el).querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it.each<[string, Partial<PassCardItem>]>([
    ["another state", { state: "ready", phase: "ready" }],
    ["another station", { stationName: "Parrilla" }],
    ["another extra", { modifiers: [{ descriptions: { "en-GB": "Cheese" } }] }],
    ["another note", { note: "no salt" }],
    ["a measure", { qty: "200.000", unitName: { "en-GB": "ml" }, soldInEach: false }],
  ])("draws a portion with %s apart", async (_, overrides) => {
    const el = await mountAll(onCard([portion("p1"), portion("p2", overrides)]));
    expect(inBoard(el).querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it("draws a portion whose extra has another count apart, each row with its own count", async () => {
    const cheese = (perDish: number) => [{ descriptions: { "en-GB": "Cheese" }, perDish }];
    const el = await mountAll(
      onCard([
        portion("p1", { modifiers: cheese(1) }),
        portion("p2", { modifiers: cheese(2) }),
        portion("p3", { modifiers: cheese(1) }),
      ]),
    );
    expect(names(el)).toEqual(["2× Burger", "1× Burger"]);
    expect(
      [...inBoard(el).querySelectorAll<HTMLElement>("[data-item] .modifier")].map((modifier) =>
        modifier.textContent!.trim(),
      ),
    ).toEqual(["+ Cheese", "+ Cheese x2"]);
  });

  it("draws portions sent a millisecond apart as one row", async () => {
    const el = await mountAll(
      onCard([
        portion("p1"),
        portion("p2", { queuedAt: new Date(Date.parse(minutesAgo(1)) + 1).toISOString() }),
      ]),
    );
    expect(names(el)).toEqual(["2× Burger"]);
  });

  it("draws a forgotten portion apart from a fresh one, and marks only the forgotten", async () => {
    const el = await mountAll(onCard([portion("p1"), portion("p2", { queuedAt: minutesAgo(20) })]));
    expect(names(el)).toEqual(["1× Burger", "1× Burger"]);
    expect(inBoard(el).querySelectorAll("[data-forgotten]")).toHaveLength(1);
    expect(itemOf(el, "p2").querySelector("[data-forgotten]")).not.toBeNull();
  });

  it("draws identical portions on a group card as one row", async () => {
    const el = await mountAll(
      passBoard({
        inProgress: [
          passCard({
            key: "group:g-3",
            target: { kind: "group", partyId: "party-1", groupId: "g-3" },
            party: { id: "party-1", revision: 3 },
            group: { displayNumber: 3, position: 3 },
            items: [portion("p1"), portion("p2")],
          }),
        ],
      }),
    );
    expect(names(el)).toEqual(["2× Burger"]);
  });

  it("exposes no Fire-control property", async () => {
    const el = await mount({});
    expect("fireControl" in el).toBe(false);
  });
});

describe("A773 pass screen: a pass monitor", () => {
  /** A Held group card, a To fire group card, an In progress group card and an In progress bill card. */
  const busyBoard = (minutes = 1) =>
    passBoard({
      held: [
        passCard({
          key: "group:g-4",
          target: { kind: "group", partyId: "p-1", groupId: "g-4" },
          kind: "held",
          requestedAt: null,
          items: [passItem({ id: "h-a", phase: "held", firedAt: null })],
        }),
      ],
      toFire: [
        passCard({
          key: "group:g-2",
          target: { kind: "group", partyId: "p-1", groupId: "g-2" },
          kind: "next_course",
          items: [passItem({ id: "f-a", phase: "requested", firedAt: null })],
          releaseTicketItemIds: ["f-a"],
          releaseContext: "ctx-1",
        }),
      ],
      inProgress: [
        passCard({
          key: "group:g-1",
          target: { kind: "group", partyId: "p-1", groupId: "g-1" },
          party: { id: "p-1", revision: 7 },
          items: [passItem({ id: "g-a", queuedAt: minutesAgo(minutes) })],
        }),
        passCard(),
      ],
    });
  const lostSlots = {
    stations: [
      { id: "st-1", name: "Parrilla", available: true },
      { id: "st-2", name: "Freidora", available: false },
    ],
    zones: [
      { id: "z-1", name: "Terraza", available: false },
      { id: "z-2", name: "Sala", available: true },
    ],
  };
  const mountDisplay = (api = fakeApi(), initialBoard?: DevicePassBoard, props = {}) =>
    mount({
      api,
      deviceMode: true,
      monitor: true,
      deviceName: "Pared del pase",
      initialBoard,
      ...props,
    });
  const tillApi = (read: DevicePassBoard, screen: Partial<ResolvedKitchenScreen> = {}) =>
    fakeApi({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue(identity([{ ...chosen("pass_monitor"), ...screen }])),
      getDevicePassMonitorBoard: vi.fn().mockResolvedValue(read),
    });
  const lines = (el: TillPassScreen) =>
    [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
      line.textContent!.trim(),
    );

  /** Every element in `root` and in each shadow root below it. */
  function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
    const found = [...root.querySelectorAll(selector)];
    for (const node of root.querySelectorAll("*"))
      if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
    return found;
  }
  /** The board's own Columns and column headings (D72); only a till's monitor adds its Back. */
  const BOARD_CONTROLS = "[data-columns-open], [data-column-toggle]";
  const TILL_CONTROLS = `${BOARD_CONTROLS}, [data-back]`;
  const actionButtons = (el: TillPassScreen, excused = BOARD_CONTROLS) =>
    deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']").filter((node) => {
      const host = (node.getRootNode() as ShadowRoot).host;
      return !node.matches(excused) && !host?.matches(excused);
    });

  it("on a kitchen display, reads the monitor's board under the device's name and nothing else", async () => {
    const api = fakeApi({ getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()) });
    const el = await mountDisplay(api);
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
    expect(boardOf(el)!.mode).toBe("monitor");
    expect(cardKeys(el)).toEqual(["bill:a"]);
    expect(el.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Pared del pase");
    expect(api.getExpoBoard).not.toHaveBeenCalled();
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    expect(api.getDeviceIdentity).not.toHaveBeenCalled();
  });

  it("on a kitchen display, draws the board it was handed without reading it again", async () => {
    const api = fakeApi();
    const el = await mountDisplay(api, deviceBoard(boardB));
    expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
    expect(cardKeys(el)).toEqual(["bill:b"]);
  });

  it.each([
    [
      "on a kitchen display",
      () => mountDisplay(fakeApi(), deviceBoard(busyBoard())),
      BOARD_CONTROLS,
    ],
    [
      "at a till whose device chose it",
      () => mount({ api: tillApi(deviceBoard(busyBoard())) }),
      TILL_CONTROLS,
    ],
  ])(
    "%s, draws its Held cards and no button but Columns, its column headings and a till's Back, though it runs the pass",
    async (_, mountOne, excused) => {
      const el = await mountOne();
      expect(boardOf(el)!.mode).toBe("monitor");
      expect(boardOf(el)!.runsPass).toBe(true);
      expect(cardKeys(el)).toEqual(["group:g-4", "group:g-2", "group:g-1", "bill:order-1"]);
      expect(boardOf(el)!.shadowRoot!.querySelector("[data-columns-open]")).not.toBeNull();
      expect(actionButtons(el, excused)).toEqual([]);
    },
  );

  it("at a till whose device chose it, reads only the monitor's board and keeps its Back", async () => {
    const api = tillApi(deviceBoard(busyBoard()));
    const el = await mount({ api });
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
    expect(api.getExpoBoard).not.toHaveBeenCalled();
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-back]")).not.toBeNull();
  });

  it("on a kitchen display, draws no button but Columns and its headings with a stale read and an overdue card", () =>
    withFakeTimers(async () => {
      const api = fakeApi({
        getDevicePassMonitorBoard: vi.fn().mockRejectedValue(new Error("offline")),
      });
      const el = await mountDisplay(api, deviceBoard(busyBoard(12)));
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(boardOf(el)!.shadowRoot!.querySelector("[data-overdue-count]")).not.toBeNull();
      expect(boardOf(el)!.shadowRoot!.querySelector("[data-columns-open]")).not.toBeNull();
      expect(actionButtons(el)).toEqual([]);
    }));

  it("on a kitchen display, ignores a read that answers after it left the page", async () => {
    const answer = deferred<DevicePassBoard>();
    const api = fakeApi({ getDevicePassMonitorBoard: vi.fn(() => answer.promise) });
    const el = await mountDisplay(api);
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
    el.remove();
    answer.resolve(deviceBoard(boardB));
    await flush(el);
    expect(cardKeys(el)).toEqual([]);
  });

  it("on a kitchen display, ignores a failed read that answers after it left the page", async () => {
    const answer = deferred<DevicePassBoard>();
    const api = fakeApi({ getDevicePassMonitorBoard: vi.fn(() => answer.promise) });
    const el = await mountDisplay(api);
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
    el.remove();
    answer.reject(new Error("offline"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
  });

  it("on a kitchen display, refreshes every fifteen seconds and keeps its board under a stale line when a read fails", () =>
    withFakeTimers(async () => {
      const api = fakeApi({
        getDevicePassMonitorBoard: vi
          .fn()
          .mockResolvedValueOnce(deviceBoard(boardB))
          .mockRejectedValueOnce(new Error("offline")),
      });
      const el = await mountDisplay(api, deviceBoard(passBoard()));
      expect(cardKeys(el)).toEqual([]);
      expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
      expect(cardKeys(el)).toEqual(["bill:b"]);
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(api.getDevicePassMonitorBoard).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("[data-stale] till-stale-since")).not.toBeNull();
      expect(cardKeys(el)).toEqual(["bill:b"]);
    }));

  it.each([
    ["on a kitchen display", () => mountDisplay(fakeApi(), deviceBoard(boardA, lostSlots))],
    [
      "at a till whose device chose it",
      () => mount({ api: tillApi(deviceBoard(boardA, lostSlots), lostSlots) }),
    ],
  ])("%s, shows each station and zone a narrowing took, and its board", async (_, mountOne) => {
    const el = await mountOne();
    expect(lines(el)).toEqual([
      t("station.unavailable").replace("{name}", "Freidora"),
      t("zone.unavailable").replace("{name}", "Terraza"),
    ]);
    expect(cardKeys(el)).toEqual(["bill:a"]);
  });

  it("at a till whose device chose it, shows only its lines and no board when a narrowing left it no station", async () => {
    const slots = { stations: [{ id: "st-2", name: "Freidora", available: false }] };
    const el = await mount({ api: tillApi(deviceBoard(passBoard(), slots), slots) });
    expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Freidora")]);
    expect(boardOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-card], [data-empty], .stale")).toBeNull();
  });

  it.each([
    ["en-GB", "This screen is no longer available: Pass monitor"],
    ["es-ES", "Esta pantalla ya no está disponible: Monitor de pase"],
  ])(
    "at a till whose device chose it, shows only its line when a narrowing took the monitor itself, reading no board (%s)",
    (locale, line) =>
      withFakeTimers(async () => {
        const previous = currentLocale();
        setLocale(locale);
        try {
          const api = tillApi(deviceBoard(), { available: false });
          const el = await mount({ api });
          expect(lines(el)).toEqual([line]);
          expect(boardOf(el)).toBeNull();
          expect(el.shadowRoot!.querySelector("[data-empty]")).toBeNull();
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
          expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
          expect(api.getExpoBoard).not.toHaveBeenCalled();
        } finally {
          setLocale(previous);
        }
      }),
  );
});
