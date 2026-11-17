import { es } from "../i18n/strings.js";
import { liveConnectionFixture } from "../../test/live-connection.js";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allergenLabel } from "../i18n/allergen-names.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { kitchenScreenNoticeText } from "../kitchen-screen-notice.js";
import {
  cleanupWidgets,
  mountWidget,
  namedIcons,
  pageAt,
  resetPage,
} from "../widgets/test-helpers.js";
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
): DevicePassBoard => ({
  board,
  stations: [],
  zones: null,
  display: { showNonPassStations: true },
  ...slots,
});

function identity(kitchenScreens: ResolvedKitchenScreen[]): DeviceIdentity {
  return { deviceId: "dev-1", formFactor: "till", name: "Till 1", kitchenScreens };
}

const chosen = (kind: ResolvedKitchenScreen["kind"], available = true): ResolvedKitchenScreen => ({
  kind,
  available,
  stations: [],
  zones: null,
  showNonPassStations: true,
});

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
    getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard()),
    getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard()),
    ...overrides,
  } as unknown as TillApi &
    Record<
      "getDeviceIdentity" | "getDevicePassBoard" | "getDevicePassMonitorBoard",
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
const unavailableLines = (el: TillPassScreen) =>
  [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
    line.textContent!.trim(),
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
  it("an embedded screen reads the configured Pass instead of every station", async () => {
    const api = fakeApi();
    await mount({ api, embedded: true });
    expect(api.getDevicePassBoard).toHaveBeenCalled();
  });
  describe("a kitchen display's pass", () => {
    it("reads its board once on connect when none was handed to it, and draws it as the pass", async () => {
      const api = fakeApi();
      const el = await mount({ api, deviceMode: true });
      expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
      expect(boardOf(el)!.mode).toBe("pass");
      expect(boardOf(el)!.board).toEqual(boardA);
      expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
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
    ] as const)("%j reads %s and draws %s", async (screens, read, mode) => {
      const api = fakeApi({ getDeviceIdentity: vi.fn().mockResolvedValue(identity([...screens])) });
      const el = await mount({ api });
      for (const name of [
        "getDevicePassBoard",
        "getDevicePassMonitorBoard",
        "getDevicePassBoard",
      ] as const)
        expect(api[name]).toHaveBeenCalledTimes(name === read ? 1 : 0);
      expect(boardOf(el)!.mode).toBe(mode);
      expect(cardKeys(el)).toEqual(["bill:a"]);
    });

    it.each([[[chosen("pass")], "pass"]] as const)(
      "%j draws group and bill Ready only when the till runs the pass",
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

    it("carries the pass's display choice, and configured Pass' default, from each board read (D70)", () =>
      withFakeTimers(async () => {
        const hidden = { showNonPassStations: false };
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockResolvedValue({ ...deviceBoard(), display: hidden }),
        });
        const el = await mount({ api });
        expect(el.display).toEqual(hidden);
        api.getDeviceIdentity.mockResolvedValue(identity([]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(boardOf(el)).toBeNull();
      }));

    it("switches the read and clears the old board when the choice changes between refreshes", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardA)),
        });
        const el = await mount({ api });
        expect(cardKeys(el)).toEqual(["bill:a"]);
        api.getDeviceIdentity.mockResolvedValue(identity([]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)).toBeNull();
      }));

    const goneLine = () => kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" });
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
          expect(el.shadowRoot!.querySelector(".stale[data-stale]")).not.toBeNull();
          expect(cardKeys(el)).toEqual(["bill:a"]);
          expect(reboot).not.toHaveBeenCalled();
        }),
      ));

    it.each([
      ["pass", "getDevicePassBoard", "pass", true],
      ["pass_monitor", "getDevicePassMonitorBoard", "monitor", false],
    ] as const)(
      "opens a %s configured while it is open, and keeps reading it",
      (kind, read, mode, buttons) =>
        withFakeTimers(async () => {
          const api = fakeApi({
            getDeviceIdentity: vi.fn().mockResolvedValue(identity([])),
            getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)),
            getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard(boardB)),
          });
          const el = await mount({ api });
          api.getDeviceIdentity.mockResolvedValue(identity([chosen(kind)]));
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(api[read]).toHaveBeenCalledOnce();
          expect(boardOf(el)!.mode).toBe(mode);
          expect(cardKeys(el)).toEqual(["bill:b"]);
          expect(boardButtons(el).length > 0).toBe(buttons);
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
          expect(api[read]).toHaveBeenCalledTimes(2);
        }),
    );

    it("rechecks an unconfigured profile without reading any board", () =>
      withFakeTimers(async () => {
        const api = fakeApi({ getDeviceIdentity: vi.fn().mockResolvedValue(identity([])) });
        const el = await mount({ api });
        expect(boardOf(el)).toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      }));
  });

  it("an unconfigured profile shows no pass board or implicit configured Pass", async () => {
    const api = fakeApi({ getDeviceIdentity: vi.fn().mockResolvedValue(identity([])) });
    const el = await mount({ api });
    expect(boardOf(el)).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("kitchen_screen.none"));
    expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
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

    it("keeps the stale line when an older read answers after a newer one failed, until a read newer than the failure answers", () =>
      withFakeTimers(async () => {
        const older = deferred<DevicePassBoard>();
        const api = fakeApi({
          getDevicePassBoard: vi
            .fn()
            .mockReturnValueOnce(older.promise) // 15 s
            .mockRejectedValueOnce({ code: "server.internal" }) // 30 s
            .mockResolvedValueOnce(deviceBoard(boardA)), // 45 s
        });
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard() });
        await vi.advanceTimersByTimeAsync(30_000);
        await flush(el);
        expect(stale(el)).not.toBeNull();
        older.resolve(deviceBoard(boardB));
        await flush(el);
        expect(cardKeys(el)).toEqual(["bill:b"]);
        expect(stale(el)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(3);
        expect(cardKeys(el)).toEqual(["bill:a"]);
        expect(stale(el)).toBeNull();
      }));

    it("keeps the stale line a Fire with no answer set when a read that set out before the Fire answers, until a later read answers", () =>
      withFakeTimers(async () => {
        const fireBoard = passBoard({
          toFire: [
            passCard({
              key: "group:g-1",
              target: { kind: "group", partyId: "p-1", groupId: "g-1" },
              kind: "next_course",
              releaseTicketItemIds: ["r-1"],
              releaseContext: "ctx-1",
            }),
          ],
        });
        const older = deferred<DevicePassBoard>();
        const api = fakeApi({
          getDevicePassBoard: vi
            .fn()
            .mockReturnValueOnce(older.promise) // 15 s
            .mockResolvedValueOnce(deviceBoard(boardA)), // 30 s
          releaseDevicePass: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        });
        const el = await mount({ api, deviceMode: true, initialBoard: deviceBoard(fireBoard) });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        boardOf(el)!
          .shadowRoot!.querySelector<HTMLButtonElement>('[data-pass-fire="group:g-1"]')!
          .click();
        await flush(el);
        expect(api.releaseDevicePass).toHaveBeenCalledOnce();
        expect(stale(el)).not.toBeNull();
        older.resolve(deviceBoard(boardB));
        await flush(el);
        expect(cardKeys(el)).toEqual(["bill:b"]);
        expect(stale(el)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
        expect(cardKeys(el)).toEqual(["bill:a"]);
        expect(stale(el)).toBeNull();
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

    it("at a till, reads no board while the profile cannot be read", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockRejectedValue({ code: "server.internal" }),
        });
        const el = await mount({ api });
        expect(boardOf(el)).toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      }));

    it("an embedded card follows the configured Pass every fifteen seconds", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        const el = await mount({ api, embedded: true });
        expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("pass");
        expect(cardKeys(el)).toEqual(["bill:a"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
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
            getDeviceIdentity: vi.fn().mockResolvedValue({
              kitchenScreens: [
                {
                  kind: "pass",
                  available: true,
                  stations: [],
                  zones: null,
                  showNonPassStations: true,
                },
              ],
            }),
            getDevicePassBoard: vi
              .fn()
              .mockResolvedValueOnce({
                board: boardA,
                stations: [],
                zones: null,
                display: { showNonPassStations: true },
              })
              .mockRejectedValue({ code: "device.unauthorized" }),
          });
          const el = await mount({ api, embedded: true });
          await vi.advanceTimersByTimeAsync(15_000);
          await flush(el);
          expect(api.getDevicePassBoard).toHaveBeenCalledTimes(2);
          expect(reboot).not.toHaveBeenCalled();
          expect(stale(el)).not.toBeNull();
          expect(cardKeys(el)).toEqual(["bill:a"]);
        }),
      ));
  });

  describe("the header names what the pass covers", () => {
    const covers = (el: TillPassScreen) =>
      el.shadowRoot!.querySelector("[data-covers]")?.textContent?.trim() ?? null;
    const stations = [
      { id: "st-2", name: "Parrilla", available: true },
      { id: "st-1", name: "Freidora", available: true },
    ];

    it("names the stations in the server's order, in the board's lead slot, with no zone filter", async () => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard(boardA, { stations }) });
      expect(covers(el)).toBe("Stations: Parrilla, Freidora");
      const line = el.shadowRoot!.querySelector("[data-covers]")!;
      expect(line.getAttribute("slot")).toBe("lead");
      expect(line.parentElement).toBe(boardOf(el));
    });

    it("names the zones after the stations when the pass has a zone filter", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          stations,
          zones: [
            { id: "z-2", name: "Terraza", available: true },
            { id: "z-1", name: "Sala", available: true },
          ],
        }),
      });
      expect(covers(el)).toBe("Stations: Parrilla, Freidora · Zones: Terraza, Sala");
    });

    it("leaves a station or zone no longer available to its lost line", async () => {
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
      expect(covers(el)).toBe("Stations: Parrilla · Zones: Sala");
      expect(unavailableLines(el)).toEqual([
        t("station.unavailable").replace("{name}", "Freidora"),
        t("zone.unavailable").replace("{name}", "Terraza"),
      ]);
    });

    it("shows the same line on the pass monitor", async () => {
      const api = fakeApi({
        getDevicePassMonitorBoard: vi.fn().mockResolvedValue(deviceBoard(boardA, { stations })),
      });
      const el = await mount({ api, monitor: true });
      expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
      expect(covers(el)).toBe("Stations: Parrilla, Freidora");
    });

    it("shows the same line on the pass opened from the counter", async () => {
      const api = fakeApi({
        getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardA, { stations })),
      });
      const el = await mount({ api });
      expect(covers(el)).toBe("Stations: Parrilla, Freidora");
    });

    it.each([
      ["names no station at all", { stations: [] }],
      [
        "has lost every station",
        { stations: [{ id: "st-1", name: "Freidora", available: false }] },
      ],
    ])("draws no line when the pass %s", async (_, slots) => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard(boardA, slots) });
      expect(covers(el)).toBeNull();
    });

    it("draws a name holding replacement patterns as written", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          stations: [{ id: "st-1", name: "Grill $& $1 {names}", available: true }],
          zones: [{ id: "z-1", name: "Bar $& $1 {names}", available: true }],
        }),
      });
      expect(covers(el)).toBe("Stations: Grill $& $1 {names} · Zones: Bar $& $1 {names}");
    });

    it("drops the old pass's line while the pass monitor it switched to is still being read", () =>
      withFakeTimers(async () => {
        const monitorRead = deferred<DevicePassBoard>();
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockResolvedValue(deviceBoard(boardA, { stations })),
          getDevicePassMonitorBoard: vi.fn(() => monitorRead.promise),
        });
        const el = await mount({ api });
        expect(covers(el)).toBe("Stations: Parrilla, Freidora");
        api.getDeviceIdentity.mockResolvedValue(identity([chosen("pass_monitor")]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
        expect(boardOf(el)!.mode).toBe("monitor");
        expect(covers(el)).toBeNull();
        monitorRead.resolve(
          deviceBoard(boardB, { stations: [{ id: "st-3", name: "Postres", available: true }] }),
        );
        await flush(el);
        expect(covers(el)).toBe("Stations: Postres");
      }));

    it("words the line in Spanish", async () => {
      const previous = currentLocale();
      setLocale("es-ES");
      try {
        const el = await mount({
          deviceMode: true,
          initialBoard: deviceBoard(boardA, {
            stations,
            zones: [{ id: "z-1", name: "Terraza", available: true }],
          }),
        });
        expect(covers(el)).toBe("Estaciones: Parrilla, Freidora · Zonas: Terraza");
      } finally {
        setLocale(previous);
      }
    });

    it.each([
      [
        "en-GB",
        ["Kitchen", "Downstairs bar prep", "Upstairs bar prep", "Deli prep"],
        ["Upstairs bar", "Deli counter"],
      ],
      [
        "es-ES",
        [
          "Cocina",
          "Preparación del bar de abajo",
          "Preparación del bar de arriba",
          "Preparación de charcutería",
        ],
        ["Bar de arriba", "Mostrador de charcutería"],
      ],
    ])(
      "wraps the demo venue's names inside the header at 390 and 1024 px, splitting no word (%s)",
      async (locale, stationNames, zoneNames) => {
        const slot = (name: string, index: number) => ({ id: `s-${index}`, name, available: true });
        const previous = currentLocale();
        setLocale(locale);
        try {
          for (const width of [390, 1024]) {
            await pageAt(width, 800);
            const el = await mount({
              deviceMode: true,
              deviceName: "Pass",
              initialBoard: deviceBoard(boardA, {
                stations: stationNames.map(slot),
                zones: zoneNames.map(slot),
              }),
            });
            const head = boardOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-board-head]")!;
            const line = el.shadowRoot!.querySelector<HTMLElement>("[data-covers]")!;
            expect(covers(el)).toContain(stationNames.at(-1));
            expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth);
            expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(
              head.getBoundingClientRect().right + 0.5,
            );
            const text = [...line.childNodes].find(
              (node): node is Text => node instanceof Text && node.data.trim() !== "",
            )!;
            const rows = (start: number, end: number) => {
              const range = document.createRange();
              range.setStart(text, start);
              range.setEnd(text, end);
              return new Set(
                [...range.getClientRects()]
                  .filter((rect) => rect.width > 0)
                  .map((rect) => Math.round(rect.top)),
              ).size;
            };
            if (width === 390) expect(rows(0, text.length)).toBeGreaterThan(1);
            const split = [...text.data.matchAll(/\S+/g)]
              .filter((word) => rows(word.index, word.index + word[0].length) > 1)
              .map((word) => word[0]);
            expect(split, `${width} px`).toEqual([]);
            cleanupWidgets();
          }
        } finally {
          setLocale(previous);
          await resetPage();
        }
      },
    );
  });

  describe("lost slots and a lost screen", () => {
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
      expect(unavailableLines(el)).toEqual([
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
      expect(unavailableLines(el)).toEqual([
        t("station.unavailable").replace("{name}", "Freidora"),
      ]);
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
        expect(unavailableLines(el)).toEqual([
          t("station.unavailable").replace("{name}", "Freidora"),
        ]);
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
      expect(unavailableLines(el)).toEqual([t("zone.unavailable").replace("{name}", "Terraza")]);
      expect(boardOf(el)).toBeNull();
    });

    it("names no station it still has when a narrowing took every zone", async () => {
      const el = await mount({
        deviceMode: true,
        initialBoard: deviceBoard(boardA, {
          stations: [{ id: "st-1", name: "Parrilla", available: true }],
          zones: [{ id: "z-1", name: "Terraza", available: false }],
        }),
      });
      expect(unavailableLines(el)).toEqual([t("zone.unavailable").replace("{name}", "Terraza")]);
      expect(boardOf(el)).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-covers]")).toBeNull();
    });

    it("names no station once a narrowing took the till's pass screen", () =>
      withFakeTimers(async () => {
        const api = fakeApi({
          getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
          getDevicePassBoard: vi.fn().mockResolvedValue(
            deviceBoard(boardA, {
              stations: [{ id: "st-1", name: "Parrilla", available: true }],
            }),
          ),
        });
        const el = await mount({ api });
        expect(el.shadowRoot!.querySelector("[data-covers]")).not.toBeNull();
        api.getDeviceIdentity.mockResolvedValue(identity([chosen("pass", false)]));
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(unavailableLines(el)).toEqual([
          kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" }),
        ]);
        expect(el.shadowRoot!.querySelector("[data-covers]")).toBeNull();
      }));

    it("at a till whose pass screen a narrowing took, says so and reads no board", async () => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass", false)])),
      });
      const el = await mount({ api });
      expect(unavailableLines(el)).toEqual([
        kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" }),
      ]);
      expect(boardOf(el)).toBeNull();
      expect(api.getDevicePassBoard).not.toHaveBeenCalled();
    });

    it.each([
      [
        "en-GB",
        "Set this device's screen, stations and zones in the dashboard, under Device profiles.",
        "This device's profile can offer it again in the dashboard, under Device profiles.",
      ],
      [
        "es-ES",
        "Configura la pantalla, las estaciones y las zonas de este dispositivo en el panel, en Perfiles de dispositivo.",
        "El perfil de este dispositivo puede volver a ofrecerla en el panel, en Perfiles de dispositivo.",
      ],
    ])(
      "at a till left with nothing to show, says what to do (%s)",
      async (locale, choose, offer) => {
        const guidance = (el: TillPassScreen) =>
          el.shadowRoot!.querySelector("[data-choose-again]")?.textContent?.trim() ?? null;
        const previous = currentLocale();
        setLocale(locale);
        try {
          const emptied = await mount({
            api: fakeApi({
              getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
              getDevicePassBoard: vi.fn().mockResolvedValue(
                deviceBoard(boardA, {
                  zones: [{ id: "z-1", name: "Terraza", available: false }],
                }),
              ),
            }),
          });
          expect(guidance(emptied)).toBe(choose);
          emptied.remove();
          const gone = await mount({
            api: fakeApi({
              getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass", false)])),
            }),
          });
          expect(guidance(gone)).toBe(offer);
          gone.remove();
          const left = await mount({
            api: fakeApi({
              getDeviceIdentity: vi.fn().mockResolvedValue(identity([chosen("pass")])),
              getDevicePassBoard: vi.fn().mockResolvedValue(
                deviceBoard(boardA, {
                  zones: [
                    { id: "z-1", name: "Terraza", available: false },
                    { id: "z-2", name: "Sala", available: true },
                  ],
                }),
              ),
            }),
          });
          expect(cardKeys(left)).toEqual(["bill:a"]);
          expect(guidance(left)).toBeNull();
        } finally {
          setLocale(previous);
        }
      },
    );

    it("at a till still reading the device's choice, says nothing about choosing screens again", async () => {
      const choice = deferred<DeviceIdentity>();
      const api = fakeApi({ getDeviceIdentity: vi.fn(() => choice.promise) });
      const el = await mount({ api });
      expect(el.shadowRoot!.querySelector("[data-choose-again]")).toBeNull();
      choice.resolve(identity([chosen("pass")]));
      await flush(el);
      expect(cardKeys(el)).toEqual(["bill:a"]);
      expect(el.shadowRoot!.querySelector("[data-choose-again]")).toBeNull();
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
          expect(unavailableLines(el)).toEqual([stationLine, zoneLine]);
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
        expect(unavailableLines(el)).toEqual([]);
        expect(cardKeys(el)).toEqual(["bill:b"]);
      }));

    it("a failed initial profile read never widens access while a later read reports a removed screen", () =>
      withFakeTimers(async () => {
        const api = fakeApi();
        api.getDeviceIdentity
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(identity([chosen("pass", false)]));
        const el = await mount({ api });
        expect(boardOf(el)).toBeNull();
        expect(unavailableLines(el)).toEqual(["The screen could not be read. Trying again…"]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(boardOf(el)).toBeNull();
        expect(unavailableLines(el)).toEqual([
          kitchenScreenNoticeText({ kind: "unavailable", screen: "pass" }),
        ]);
        await vi.advanceTimersByTimeAsync(15_000);
        await flush(el);
        expect(api.getDevicePassBoard).not.toHaveBeenCalled();
      }));
  });

  describe("Columns", () => {
    it("keeps column layout controls while inheriting the profile's other-stations policy", async () => {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard() });
      await userEvent.click(
        boardOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-columns-open]")!,
      );
      await flush(el);
      const dialog = el.shadowRoot!.querySelector<TillKitchenColumnsDialog>(
        "till-kitchen-columns-dialog",
      )!;
      await dialog.updateComplete;
      expect(dialog.shadowRoot!.querySelector("[data-other-stations]")).toBeNull();
      expect(dialog.shadowRoot!.querySelector("[data-column-down]")).not.toBeNull();
    });

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
      order: ["overview", "toFire", "toFireOnly", "held", "inProgress", "ready"],
      hidden: ["overview", "held", "toFireOnly", "ready"],
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

    it("keeps an embedded configured Pass layout under its own key", async () => {
      const el = await mount({ embedded: true });
      await changeAll(el);
      expect(storedColumnKeys()).toEqual([columnsKey("pass")]);
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
        t("pass.columns_held_to_fire"),
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

    describe("D95 the pass's Columns choices", () => {
      const heldCard = passCard({
        key: "bill:order-6",
        target: { kind: "bill", workingOrderId: "order-6" },
        kind: "held",
        requestedAt: null,
        orders: [
          {
            dining: "eat_in",
            orderId: "order-6",
            orderNumber: 17,
            tableLabel: "T9",
            kitchenNote: null,
          },
        ],
        items: [passItem({ id: "held-1", orderId: "order-6", phase: "held", firedAt: null })],
      });
      const toFireCard = passCard({
        key: "bill:order-2",
        target: { kind: "bill", workingOrderId: "order-2" },
        orders: [
          {
            dining: "eat_in",
            orderId: "order-2",
            orderNumber: 13,
            tableLabel: "T5",
            kitchenNote: null,
          },
        ],
        items: [passItem({ id: "req-1", orderId: "order-2", phase: "requested", firedAt: null })],
        releaseTicketItemIds: ["req-1"],
        releaseContext: "ctx-1",
      });
      const board = passBoard({ held: [heldCard], toFire: [toFireCard] });
      const section = (el: TillPassScreen, key: string) =>
        boardOf(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-column="${key}"]`)!;
      const sections = (el: TillPassScreen) =>
        [...boardOf(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-column]")].map(
          (column) => column.dataset.column,
        );
      const cardsIn = (el: TillPassScreen, key: string) =>
        [...section(el, key).querySelectorAll("[data-card]")].map((card) =>
          card.getAttribute("data-card"),
        );
      async function openColumns(el: TillPassScreen) {
        await userEvent.click(
          boardOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-columns-open]")!,
        );
        await flush(el);
      }

      it("with Held and To fire switched on and Held + To fire off, draws each apart and keeps it", async () => {
        await pageAt(1280, 800);
        try {
          const el = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
          await openColumns(el);
          await press(el, '[data-column-show="held"]');
          await press(el, '[data-column-show="toFireOnly"]');
          await press(el, '[data-column-show="toFire"]');
          const drawsApart = (on: TillPassScreen) => {
            expect(sections(on)).toEqual(["held", "toFireOnly", "inProgress", "ready"]);
            expect(cardsIn(on, "held")).toEqual([heldCard.key]);
            expect(cardsIn(on, "toFireOnly")).toEqual([toFireCard.key]);
            expect(section(on, "toFireOnly").querySelector("[data-held-part]")).toBeNull();
            expect(boardOf(on)!.shadowRoot!.querySelector("[data-held-part]")).toBeNull();
            const heading = section(on, "held").querySelector(".column-heading")!.textContent;
            expect(heading).toContain(t("pass.column.held"));
            expect(heading).not.toContain(t("pass.column.to_fire"));
          };
          drawsApart(el);
          expect(stored("pass").hidden).toEqual(["overview", "toFire"]);
          el.remove();
          const again = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
          expect(boardOf(again)!.columns.hidden).toEqual(["overview", "toFire"]);
          drawsApart(again);
        } finally {
          await resetPage();
        }
      });

      it("switching Held on leaves Held + To fire shown, so the held card is drawn in both", async () => {
        await pageAt(1280, 800);
        try {
          const el = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
          await openColumns(el);
          await press(el, '[data-column-show="held"]');
          expect(stored("pass").hidden).toEqual(["overview", "toFireOnly"]);
          expect(cardsIn(el, "held")).toEqual([heldCard.key]);
          const toFire = section(el, "toFire");
          const part = toFire.querySelector("[data-held-part]")!;
          const drawnHeld = toFire.querySelector(`[data-card="${heldCard.key}"]`)!;
          expect(
            part.compareDocumentPosition(drawnHeld) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).not.toBe(0);
        } finally {
          await resetPage();
        }
      });
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

    it.each([
      ["en-GB", "expo.back", "Back to counter"],
      ["es-ES", "expo.back", "Volver al mostrador"],
      ["en-GB", "action.back", "Back"],
      ["es-ES", "action.back", "Atrás"],
    ] as const)("in %s, the Back given %s reads %s", async (language, backKey, words) => {
      const previous = currentLocale();
      try {
        setLocale(language);
        const el = await mount({ backKey } as Partial<TillPassScreen>);
        expect(el.shadowRoot!.querySelector("[data-back]")!.textContent!.trim()).toBe(words);
      } finally {
        setLocale(previous);
      }
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
      ["an embedded card on configured Pass", "expo.watcher_empty", { embedded: true }],
    ] as const)("%s says %s in the board's status slot", async (_, key, props) => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue({
          kitchenScreens: [
            {
              kind: "pass",
              available: true,
              stations: [],
              zones: null,
              showNonPassStations: true,
            },
          ],
        }),
        getDevicePassBoard: vi.fn().mockResolvedValue({
          board: passBoard(),
          stations: [],
          zones: null,
          display: { showNonPassStations: true },
        }),
      });
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
    ] as const)("a till whose device chose %j says %s", async (screens, key) => {
      const api = fakeApi({
        getDeviceIdentity: vi.fn().mockResolvedValue(identity([...screens])),
        getDevicePassBoard: vi.fn().mockResolvedValue(empty),
        getDevicePassMonitorBoard: vi.fn().mockResolvedValue(empty),
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
        getDevicePassBoard: vi.fn().mockResolvedValue({
          board: passBoard(),
          stations: [],
          zones: null,
          display: { showNonPassStations: true },
        }),
      });
      const el = await mount({ api });
      expect(el.shadowRoot!.querySelector("[data-empty]")).toBeNull();
    });
  });
});

describe("A773 pass screen: a till's configured Pass", () => {
  const mountAll = (board: PassBoard, props: Partial<TillPassScreen> = {}) => {
    const api = fakeApi({
      getDeviceIdentity: vi.fn().mockResolvedValue({
        kitchenScreens: [
          { kind: "pass", available: true, stations: [], zones: null, showNonPassStations: true },
        ],
      }),
      getDevicePassBoard: vi.fn().mockResolvedValue({
        board,
        stations: [],
        zones: null,
        display: { showNonPassStations: true },
      }),
    });
    return mount({ api, embedded: true, ...props }).then((el) => ({ api, el }));
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
    expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
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
    expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
  });

  it("says the pass is empty, drawing no card, when its first read fails", async () => {
    const api = fakeApi({
      getDevicePassBoard: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount({ api });
    expect(api.getDevicePassBoard).toHaveBeenCalledOnce();
    expect(
      [...el.shadowRoot!.querySelectorAll("till-pass-board > [data-empty]")].map((node) =>
        node.textContent!.trim(),
      ),
    ).toEqual([t("expo.watcher_empty")]);
    expect(inBoard(el).querySelector("[data-card]")).toBeNull();
  });
});

describe("A773 pass screen: a till's configured Pass, its extras and portions", () => {
  const mountAll = async (board: PassBoard) => {
    const api = fakeApi({
      getDeviceIdentity: vi.fn().mockResolvedValue({
        kitchenScreens: [
          { kind: "pass", available: true, stations: [], zones: null, showNonPassStations: true },
        ],
      }),
      getDevicePassBoard: vi.fn().mockResolvedValue({
        board,
        stations: [],
        zones: null,
        display: { showNonPassStations: true },
      }),
    });
    const el = await mount({ api, embedded: true });
    expect(boardOf(el)!.mode).toBe("pass");
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
    const withRef = itemOf(el, "with").querySelector("[data-crossref]")!;
    expect(withRef.textContent).toContain("with CHIPS x2 from Fryer");
    expect(await namedIcons(withRef.querySelector(".extra-allergens")!)).toEqual([
      ["allergen-gluten", "img", allergenLabel("gluten", { kinds: ["wheat"] }, currentLocale())],
    ]);
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
    ["another extra", { modifiers: [{ name: "Cheese" }] }],
    ["another note", { note: "no salt" }],
    ["a measure", { qty: "200.000", unitName: { "en-GB": "ml" }, soldInEach: false }],
  ])("draws a portion with %s apart", async (_, overrides) => {
    const el = await mountAll(onCard([portion("p1"), portion("p2", overrides)]));
    expect(inBoard(el).querySelectorAll("[data-item]")).toHaveLength(2);
  });

  it("draws a portion whose extra has another count apart, each row with its own count", async () => {
    const cheese = (perDish: number) => [{ name: "Cheese", perDish }];
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
      expect(cardKeys(el)).toEqual(["group:g-2", "group:g-4", "group:g-1", "bill:order-1"]);
      expect(boardOf(el)!.shadowRoot!.querySelector("[data-columns-open]")).not.toBeNull();
      expect(actionButtons(el, excused)).toEqual([]);
    },
  );

  it("at a till whose device chose it, reads only the monitor's board and keeps its Back", async () => {
    const api = tillApi(deviceBoard(busyBoard()));
    const el = await mount({ api });
    expect(api.getDevicePassMonitorBoard).toHaveBeenCalledOnce();
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
    expect(unavailableLines(el)).toEqual([
      t("station.unavailable").replace("{name}", "Freidora"),
      t("zone.unavailable").replace("{name}", "Terraza"),
    ]);
    expect(cardKeys(el)).toEqual(["bill:a"]);
  });

  it("at a till whose device chose it, shows only its lines and no board when a narrowing left it no station", async () => {
    const slots = { stations: [{ id: "st-2", name: "Freidora", available: false }] };
    const el = await mount({ api: tillApi(deviceBoard(passBoard(), slots), slots) });
    expect(unavailableLines(el)).toEqual([t("station.unavailable").replace("{name}", "Freidora")]);
    expect(boardOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-card], [data-empty], .stale")).toBeNull();
  });

  it.each([
    ["en-GB", "This screen is no longer available: Pass display (view only)"],
    [
      "es-ES",
      es["kitchen_screen.unavailable"].replace("{screen}", es["kitchen_screen.pass_monitor"]),
    ],
  ])(
    "at a till whose device chose it, shows only its line when a narrowing took the monitor itself, reading no board (%s)",
    (locale, line) =>
      withFakeTimers(async () => {
        const previous = currentLocale();
        setLocale(locale);
        try {
          const api = tillApi(deviceBoard(), { available: false });
          const el = await mount({ api });
          expect(unavailableLines(el)).toEqual([line]);
          expect(boardOf(el)).toBeNull();
          expect(el.shadowRoot!.querySelector("[data-empty]")).toBeNull();
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
          expect(api.getDevicePassMonitorBoard).not.toHaveBeenCalled();
        } finally {
          setLocale(previous);
        }
      }),
  );
});

describe("D95 the pass on a 1024 px tablet", () => {
  afterEach(resetPage);

  const held = passCard({
    key: "bill:order-6",
    target: { kind: "bill", workingOrderId: "order-6" },
    kind: "held",
    requestedAt: null,
    orders: [
      {
        dining: "eat_in",
        orderId: "order-6",
        orderNumber: 17,
        tableLabel: "T9",
        kitchenNote: null,
      },
    ],
    items: [passItem({ id: "held-1", orderId: "order-6", phase: "held", firedAt: null })],
  });
  const toFire = passCard({
    key: "bill:order-2",
    target: { kind: "bill", workingOrderId: "order-2" },
    orders: [
      {
        dining: "eat_in",
        orderId: "order-2",
        orderNumber: 13,
        tableLabel: "T5",
        kitchenNote: null,
      },
    ],
    items: [passItem({ id: "req-1", orderId: "order-2", phase: "requested", firedAt: null })],
    releaseTicketItemIds: ["req-1"],
    releaseContext: "ctx-1",
  });
  const inProgress = passCard({ key: "bill:order-5" });
  const ready = passCard({
    key: "bill:order-7",
    target: { kind: "bill", workingOrderId: "order-7" },
    readyAt: minutesAgo(3),
    allReady: true,
    orders: [
      {
        dining: "eat_in",
        orderId: "order-7",
        orderNumber: 18,
        tableLabel: "T10",
        kitchenNote: null,
      },
    ],
    items: [passItem({ id: "ready-1", orderId: "order-7", phase: "ready", state: "ready" })],
  });
  const withHeld = passBoard({
    held: [held],
    toFire: [toFire],
    inProgress: [inProgress],
    ready: [ready],
  });
  const withoutHeld = passBoard({ toFire: [toFire], inProgress: [inProgress], ready: [ready] });

  const store = (hidden: string[]) =>
    localStorage.setItem(
      columnsKey("pass"),
      JSON.stringify({ version: 1, order: [...PASS_COLUMNS.order], hidden, collapsed: [] }),
    );
  const drawn = (el: TillPassScreen) => {
    const shadow = boardOf(el)!.shadowRoot!;
    return {
      kanban: shadow.querySelector(".kanban") !== null,
      list: shadow.querySelector(".list") !== null,
      sections: [...shadow.querySelectorAll<HTMLElement>("[data-column]")].map(
        (section) => section.dataset.column,
      ),
    };
  };

  it("measures a 944 px board, and draws the default's columns with and without a held card", async () => {
    await pageAt(1024, 768);
    for (const board of [withHeld, withoutHeld]) {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
      expect(Math.abs(boardOf(el)!.getBoundingClientRect().width - 944)).toBeLessThanOrEqual(1);
      expect(drawn(el)).toEqual({
        kanban: true,
        list: false,
        sections: ["toFire", "inProgress", "ready"],
      });
      cleanupWidgets();
    }
  });

  it("with Held and To fire apart, draws the narrow list at 1024 px and columns at 1280 px", async () => {
    store(["overview", "toFire"]);
    await pageAt(1024, 768);
    for (const board of [withHeld, withoutHeld]) {
      const el = await mount({ deviceMode: true, initialBoard: deviceBoard(board) });
      expect(drawn(el)).toMatchObject({ kanban: false, list: true });
      expect(drawn(el).sections).toEqual(["held", "toFireOnly", "inProgress", "ready"]);
      cleanupWidgets();
    }
    const el = await mount({ deviceMode: true, initialBoard: deviceBoard(withHeld) });
    expect(drawn(el)).toMatchObject({ kanban: false, list: true });
    await pageAt(1280, 800);
    await vi.waitFor(() => expect(drawn(el)).toMatchObject({ kanban: true, list: false }));
  });

  it("with Overview shown as well, still draws columns at 1024 px", async () => {
    store(["held", "toFireOnly"]);
    await pageAt(1024, 768);
    const el = await mount({ deviceMode: true, initialBoard: deviceBoard(withHeld) });
    expect(drawn(el)).toEqual({
      kanban: true,
      list: false,
      sections: ["overview", "toFire", "inProgress", "ready"],
    });
  });
});

it.each(["ticket_items", "ticket_item_moves", "categories"])(
  "live pass %s changes coalesce behind one read while the fifteen-second timer keeps reading",
  async (type) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const live = liveConnectionFixture();
    const api = fakeApi();
    try {
      const el = await mount({ api, live: live.connection });
      await flush(el);
      live.ready();
      await flush(el);
      const read = vi.mocked(api.getDevicePassBoard);
      const before = read.mock.calls.length;
      live.change(type);
      await flush(el);
      expect(read).toHaveBeenCalledTimes(before + 1);
      await vi.advanceTimersByTimeAsync(15_000);
      await flush(el);
      expect(read).toHaveBeenCalledTimes(before + 2);
      let release!: (value: Awaited<ReturnType<typeof api.getDevicePassBoard>>) => void;
      const answer = await read.mock.results.at(-1)!.value;
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      live.change("ticket_items");
      await flush(el);
      live.change("ticket_items");
      await flush(el);
      live.change("ticket_items");
      await flush(el);
      expect(read).toHaveBeenCalledTimes(before + 3);
      release(answer);
      await flush(el);
      expect(read).toHaveBeenCalledTimes(before + 4);
      el.remove();
      live.change("ticket_items");
      await flush(el);
      expect(read).toHaveBeenCalledTimes(before + 4);
    } finally {
      live.connection.stop();
      vi.useRealTimers();
    }
  },
);
