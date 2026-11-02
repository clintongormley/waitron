import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { kitchenScreenNoticeText } from "../kitchen-screen-notice.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PASS_COLUMNS } from "../state/kitchen-columns.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import type { TillKitchenColumnsDialog } from "../widgets/kitchen-columns-dialog.js";
import type {
  DeviceIdentity,
  DevicePassBoard,
  PassBoard,
  ResolvedKitchenScreen,
  TillApi,
} from "../api/client.js";
import { PASS_NOW, passBoard, passCard } from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";
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
});
