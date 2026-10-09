import { afterEach, describe, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { allergenName } from "../i18n/allergen-names.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";
import "./till-station-screen.js";
import type {
  DeviceIdentity,
  ExpoGroup,
  ExpoItem,
  ExpoOrder,
  ResolvedKitchenScreen,
  DevicePassMonitor,
  DevicePassScreen,
  TillApi,
  WatcherOrder,
} from "../api/client.js";

const FIRED = "2026-08-17T10:00:00.000Z";

// The lever/course fixtures below don't test bands; the age-band fixtures further down (bandOrder)
// vary `queuedAt` against an injected `now` instead.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

/** The null (auto-fired) course, a FIRED all-ready course (the away lever) and a HELD later course (the
 *  fire lever). Each item carries a distinct station so the cross-station labelling is visible. */
const threeCourseOrder: ExpoOrder = {
  orderId: "wo-1",
  orderNumber: 5,
  tableLabel: "Mesa 4",
  openedMinutes: 3,
  worstBand: "fresh",
  courses: [
    {
      courseId: null,
      courseName: null,
      displayOrder: null,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-0",
          name: "Pan",
          qty: "1.000",
          stationName: "Barra",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-1",
      courseName: "Entrantes",
      displayOrder: 0,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-1",
          name: "Croquetas",
          qty: "2.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-2",
      courseName: "Principales",
      displayOrder: 1,
      fired: false,
      away: false,
      items: [
        {
          id: "ti-2",
          name: "Solomillo",
          qty: "1.000",
          stationName: "Parrilla",
          state: "queued",
          firedAt: null,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

const deviceBoard = (
  slots: Partial<Pick<DevicePassScreen, "stations" | "zones">> = {},
): DevicePassScreen => ({
  orders: [asPassOrder(threeCourseOrder)],
  stations: slots.stations ?? [],
  zones: slots.zones ?? null,
});

const firedNotReadyOrder: ExpoOrder = {
  orderId: "wo-2",
  orderNumber: 6,
  openedMinutes: 7,
  worstBand: "fresh",
  courses: [
    {
      courseId: "co-3",
      courseName: "Postres",
      displayOrder: 2,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-3",
          name: "Flan",
          qty: "1.000",
          stationName: "Cocina",
          state: "preparing",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

const withAwayCourse: ExpoOrder = {
  orderId: "wo-3",
  orderNumber: 8,
  openedMinutes: 12,
  worstBand: "fresh",
  courses: [
    {
      courseId: "co-4",
      courseName: "Entrantes",
      displayOrder: 0,
      fired: true,
      away: true,
      items: [
        {
          id: "ti-4",
          name: "Gazpacho",
          qty: "1.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: FIRED,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
    {
      courseId: "co-5",
      courseName: "Principales",
      displayOrder: 1,
      fired: true,
      away: false,
      items: [
        {
          id: "ti-5",
          name: "Merluza",
          qty: "1.000",
          stationName: "Cocina",
          state: "ready",
          firedAt: FIRED,
          awayAt: null,
          queuedAt: FIRED,
          thresholds: DEFAULT_THRESHOLDS,
          band: "fresh",
        },
      ],
    },
  ],
};

function stubApi(queue: ExpoOrder[] = [threeCourseOrder], overrides: Record<string, unknown> = {}) {
  return {
    getExpoQueue: vi.fn().mockResolvedValue(queue),
    getDeviceIdentity: vi.fn().mockResolvedValue(identity([])),
    getDevicePassScreen: vi
      .fn()
      .mockResolvedValue({ orders: queue.map(asPassOrder), stations: [], zones: null }),
    markDevicePassDone: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    fireDeviceCourse: vi.fn().mockResolvedValue(undefined),
    bumpDeviceCourseReady: vi.fn().mockResolvedValue(undefined),
    markDeviceCourseAway: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

function identity(kitchenScreens: ResolvedKitchenScreen[]): DeviceIdentity {
  return { deviceId: "dev-1", formFactor: "till", name: "Till 1", kitchenScreens };
}

/** Each course and group of `order` as a pass screen sends it. */
function asPassOrder(order: ExpoOrder): WatcherOrder {
  const allReady = (items: ExpoItem[]) => items.every((item) => item.state === "ready");
  return {
    ...order,
    courses: order.courses.map((course) => ({ ...course, allReady: allReady(course.items) })),
    groups: (order.groups ?? []).map((group) => ({ ...group, allReady: allReady(group.items) })),
  };
}

/** A till whose device chose a pass screen. */
function passApi(
  orders: ExpoOrder[],
  screen: Partial<Pick<ResolvedKitchenScreen, "available" | "stations" | "zones">> = {},
  overrides: Record<string, unknown> = {},
) {
  const { available = true, stations = [], zones = null } = screen;
  return stubApi(orders, {
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue(identity([{ kind: "pass", available, stations, zones }])),
    getDevicePassScreen: vi
      .fn()
      .mockResolvedValue({ orders: orders.map(asPassOrder), stations, zones }),
    markDevicePassDone: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

const realSetTimeout = globalThis.setTimeout;
async function flush(el: TillExpoScreen): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(props: {
  api?: TillApi;
  fireControl?: "waiter" | "kitchen" | "expo";
  now?: number;
  reducedMotion?: boolean;
  embedded?: boolean;
  deviceMode?: boolean;
  deviceName?: string;
  initialDevicePass?: DevicePassScreen;
  monitor?: boolean;
  initialDevicePassMonitor?: DevicePassMonitor;
  runsPass?: boolean;
}): Promise<TillExpoScreen> {
  const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", {
    api: stubApi([]),
    runsPass: true,
    ...props,
  });
  await flush(el);
  return el;
}

const orderCard = (el: TillExpoScreen, orderNumber: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-order="${orderNumber}"]`);

afterEach(cleanupWidgets);

describe("till-expo-screen", () => {
  it("titles a kitchen display's pass screen with the device's name, and without Run the pass offers Done alone", async () => {
    const api = stubApi([threeCourseOrder], {
      getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()),
    });
    const el = await mount({
      api,
      deviceMode: true,
      deviceName: "Pantalla Pase",
      fireControl: "expo",
      runsPass: false,
      initialDevicePass: deviceBoard(),
    });
    expect(el.shadowRoot!.textContent).toContain("Pan");
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Pantalla Pase");
    expect(api.getDevicePassScreen).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector(
        "[data-back], [data-change], [data-watcher], [data-reprint], .lever",
      ),
    ).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0"], true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0"], false);
    expect(api.getExpoQueue).not.toHaveBeenCalled();
  });

  it("refreshes and offers Undo after Done on an embedded kitchen display's pass card", async () => {
    const api = stubApi([], {
      getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()),
    });
    const el = await mount({
      api,
      embedded: true,
      deviceMode: true,
      initialDevicePass: deviceBoard(),
    });

    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0"], true);
    expect(api.getDevicePassScreen).toHaveBeenCalledTimes(1);
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0"], false);
    expect(api.getDevicePassScreen).toHaveBeenCalledTimes(2);
    expect(api.getExpoQueue).not.toHaveBeenCalled();
  });

  it("shows a kitchen display's no longer available lines above its board", async () => {
    const el = await mount({
      api: stubApi(),
      deviceMode: true,
      initialDevicePass: deviceBoard({
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
    const lines = [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
      line.textContent!.trim(),
    );
    expect(lines).toEqual([
      t("station.unavailable").replace("{name}", "Freidora"),
      t("zone.unavailable").replace("{name}", "Terraza"),
    ]);
    expect(el.shadowRoot!.querySelector('[data-order="5"]')).not.toBeNull();
  });

  it("sends All done through the device's pass route", async () => {
    const api = stubApi([], {
      getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()),
    });
    const el = await mount({ api, deviceMode: true, initialDevicePass: deviceBoard() });
    el.shadowRoot!.querySelector<HTMLElement>('[data-all-done="wo-1"]')!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0", "ti-1", "ti-2"], true);
  });

  it("refreshes a kitchen display's pass screen every fifteen seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([], { getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()) });
      const el = await mount({
        api,
        deviceMode: true,
        initialDevicePass: { ...deviceBoard(), orders: [] },
      });
      expect(el.shadowRoot!.textContent).not.toContain("Pan");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDevicePassScreen).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.textContent).toContain("Pan");
      expect(api.getExpoQueue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("a kitchen display whose pass screen the server no longer serves", () => {
    const refused = () => Object.assign(new Error("401"), { code: "device.unauthorized" });
    async function listening(run: (reboot: ReturnType<typeof vi.fn>) => Promise<void>) {
      const reboot = vi.fn();
      document.addEventListener("device-unauthorized", reboot);
      try {
        await run(reboot);
      } finally {
        document.removeEventListener("device-unauthorized", reboot);
      }
    }

    it("reads its board on connect when none was handed to it, and re-boots when that read is refused", () =>
      listening(async (reboot) => {
        const read = await mount({
          api: stubApi([], { getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()) }),
          deviceMode: true,
        });
        expect(read.shadowRoot!.querySelector('[data-order="5"]')).not.toBeNull();
        expect(reboot).not.toHaveBeenCalled();
        await mount({
          api: stubApi([], { getDevicePassScreen: vi.fn().mockRejectedValue(refused()) }),
          deviceMode: true,
        });
        expect(reboot).toHaveBeenCalledOnce();
      }));

    it("re-boots when a refresh is refused device.unauthorized, and not for any other failure", () =>
      listening(async (reboot) => {
        vi.useFakeTimers({
          toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
        });
        try {
          const api = stubApi([], {
            getDevicePassScreen: vi.fn().mockRejectedValueOnce({ code: "server.internal" }),
          });
          const el = await mount({ api, deviceMode: true, initialDevicePass: deviceBoard() });
          await vi.advanceTimersByTimeAsync(15_000);
          await el.updateComplete;
          expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
          expect(reboot).not.toHaveBeenCalled();
          vi.mocked(api.getDevicePassScreen).mockRejectedValueOnce(refused());
          await vi.advanceTimersByTimeAsync(15_000);
          expect(reboot).toHaveBeenCalledOnce();
        } finally {
          vi.useRealTimers();
        }
      }));

    it("as a pass monitor, re-boots when a refresh is refused device.unauthorized", () =>
      listening(async (reboot) => {
        vi.useFakeTimers({
          toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
        });
        try {
          const api = stubApi([], { getDevicePassMonitor: vi.fn().mockRejectedValue(refused()) });
          await mount({
            api,
            deviceMode: true,
            monitor: true,
            initialDevicePassMonitor: { orders: [], stations: [], zones: null },
          });
          expect(reboot).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(15_000);
          expect(reboot).toHaveBeenCalledOnce();
        } finally {
          vi.useRealTimers();
        }
      }));

    it("keeps its board when the read after a Done is refused, as a station screen does after a bump", () =>
      listening(async (reboot) => {
        const api = stubApi([], { getDevicePassScreen: vi.fn().mockRejectedValue(refused()) });
        const el = await mount({ api, deviceMode: true, initialDevicePass: deviceBoard() });
        el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
        await flush(el);
        expect(api.getDevicePassScreen).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector('[data-order="5"]')).not.toBeNull();
        expect(reboot).not.toHaveBeenCalled();
      }));

    it("at a till, a refused pass read re-boots nothing", () =>
      listening(async (reboot) => {
        vi.useFakeTimers({
          toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
        });
        try {
          const api = passApi([threeCourseOrder], {}, {});
          vi.mocked(api.getDevicePassScreen).mockRejectedValue(refused());
          await mount({ api });
          await vi.advanceTimersByTimeAsync(15_000);
          expect(api.getDevicePassScreen).toHaveBeenCalledTimes(2);
          expect(reboot).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      }));
  });

  it("offers Fire, Ready and Away on a kitchen display with Run the pass, through the device's routes", async () => {
    const api = stubApi([], {
      getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()),
    });
    const el = await mount({
      api,
      deviceMode: true,
      fireControl: "expo",
      runsPass: true,
      initialDevicePass: { ...deviceBoard(), orders: [asPassOrder(threeCourseOrder)] },
    });
    const root = el.shadowRoot!;
    root.querySelector<HTMLElement>('[data-fire="co-2"]')!.click();
    await flush(el);
    expect(api.fireDeviceCourse).toHaveBeenCalledWith("wo-1", "co-2");
    root.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.markDeviceCourseAway).toHaveBeenCalledWith("wo-1", "co-1");
    expect(api.fireCourse).not.toHaveBeenCalled();
    expect(api.markCourseAway).not.toHaveBeenCalled();
    expect(root.querySelector("[data-reprint]")).toBeNull();
  });

  it("sends a kitchen display's Ready through the device's route", async () => {
    const board: DevicePassScreen = {
      orders: [asPassOrder(firedNotReadyOrder)],
      stations: [],
      zones: null,
    };
    const api = stubApi([], { getDevicePassScreen: vi.fn().mockResolvedValue(board) });
    const el = await mount({ api, deviceMode: true, runsPass: true, initialDevicePass: board });
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]')!.click();
    await flush(el);
    expect(api.bumpDeviceCourseReady).toHaveBeenCalledWith("wo-2", "co-3");
    expect(api.bumpCourseReady).not.toHaveBeenCalled();
  });

  it.each(["device.forbidden_action", "kitchen_screen.zone_not_allowed"])(
    "shows a kitchen display's lever refused %s as its sentence",
    async (code) => {
      const api = stubApi([], {
        getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()),
        fireDeviceCourse: vi.fn().mockRejectedValue({ code }),
      });
      const el = await mount({
        api,
        deviceMode: true,
        fireControl: "expo",
        runsPass: true,
        initialDevicePass: deviceBoard(),
      });
      el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-2"]')!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
        `#5 Mesa 4: ${codeMessage(code)}`,
      );
      expect(codeMessage(code)).not.toBe(codeMessage("some.unmapped_code"));
    },
  );

  it("names a refused lever's order by its number alone when it has no table", async () => {
    const board: DevicePassScreen = {
      orders: [asPassOrder(firedNotReadyOrder)],
      stations: [],
      zones: null,
    };
    const api = stubApi([], {
      getDevicePassScreen: vi.fn().mockResolvedValue(board),
      bumpDeviceCourseReady: vi.fn().mockRejectedValue({ code: "kitchen_screen.zone_not_allowed" }),
    });
    const el = await mount({ api, deviceMode: true, runsPass: true, initialDevicePass: board });
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-lever-error]")!.textContent!.trim()).toBe(
      `#6: ${codeMessage("kitchen_screen.zone_not_allowed")}`,
    );
  });

  it("keeps the embedded card on All stations without reading the device's choice", async () => {
    const api = passApi([threeCourseOrder]);
    const el = await mount({ api, embedded: true });
    expect(el.shadowRoot!.textContent).toContain("Pan");
    expect(api.getExpoQueue).toHaveBeenCalled();
    expect(api.getDeviceIdentity).not.toHaveBeenCalled();
    expect(el.shadowRoot!.textContent).not.toContain("What should this screen show?");
  });

  it("refreshes the embedded All stations card every fifteen seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder]);
      const el = await mount({ api, embedded: true });
      expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
      expect(api.getDeviceIdentity).not.toHaveBeenCalled();
      expect(el.shadowRoot!.textContent).toContain("Pan");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no chooser at a till with no pass choice, and reads All stations with no Done", async () => {
    const api = stubApi([threeCourseOrder]);
    const el = await mount({ api });
    expect(el.shadowRoot!.textContent).toContain("Pan");
    expect(api.getExpoQueue).toHaveBeenCalled();
    expect(api.getDevicePassScreen).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-watcher], [data-change]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-done], [data-all-done]")).toBeNull();
  });

  it("reads All stations when the device's identity cannot be read", async () => {
    const api = stubApi([threeCourseOrder], {
      getDeviceIdentity: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount({ api });
    expect(api.getExpoQueue).toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-done]")).toBeNull();
  });

  it("follows the device's pass choice and marks a dish Done with Undo through the device route", async () => {
    const api = passApi([threeCourseOrder]);
    const el = await mount({ api });
    expect(api.getExpoQueue).not.toHaveBeenCalled();
    expect(api.getDevicePassScreen).toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-watcher], [data-change]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Pan");
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0"], true);
    expect(el.shadowRoot!.textContent).toContain("marked done");
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markDevicePassDone).toHaveBeenLastCalledWith(["ti-0"], false);
  });

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
    "shows each station and zone a narrowing took above the pass board (%s)",
    async (locale, stationLine, zoneLine) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const api = passApi([threeCourseOrder], {
          stations: [
            { id: "st-grill", name: "Parrilla", available: true },
            { id: "st-fryer", name: "Freidora", available: false },
          ],
          zones: [
            { id: "z-room", name: "Sala", available: true },
            { id: "z-terrace", name: "Terraza", available: false },
          ],
        });
        const el = await mount({ api });
        const lines = [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
          line.textContent!.trim(),
        );
        expect(lines).toEqual([stationLine, zoneLine]);
        const board = el.shadowRoot!.querySelector(".board")!;
        expect(
          el.shadowRoot!.querySelector("[data-unavailable]")!.compareDocumentPosition(board) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  describe("a pass screen a narrowing left with no station or no zone shows only its lines", () => {
    const lostOnly = {
      stations: [{ id: "st-fryer", name: "Freidora", available: false }],
      zones: null,
    };
    const lostZones = {
      stations: [{ id: "st-grill", name: "Parrilla", available: true }],
      zones: [{ id: "z-terrace", name: "Terraza", available: false }],
    };
    const shown = (el: TillExpoScreen) => ({
      lines: [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
        line.textContent!.trim(),
      ),
      board: el.shadowRoot!.querySelector("[data-order], .empty, .board, .stale") !== null,
    });

    it("at a till", async () => {
      const el = await mount({ api: passApi([], lostOnly) });
      expect(shown(el)).toEqual({
        lines: [t("station.unavailable").replace("{name}", "Freidora")],
        board: false,
      });
    });

    it("on a kitchen display, its zones all taken", async () => {
      const el = await mount({
        api: stubApi(),
        deviceMode: true,
        initialDevicePass: { orders: [], ...lostZones },
      });
      expect(shown(el)).toEqual({
        lines: [t("zone.unavailable").replace("{name}", "Terraza")],
        board: false,
      });
    });

    it("on a pass monitor", async () => {
      const el = await mount({
        api: stubApi(),
        deviceMode: true,
        monitor: true,
        initialDevicePassMonitor: { orders: [], ...lostOnly },
      });
      expect(shown(el).board).toBe(false);
    });

    it("and shows the board again once a read gives it a station", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      try {
        const api = stubApi([], { getDevicePassScreen: vi.fn().mockResolvedValue(deviceBoard()) });
        const el = await mount({
          api,
          deviceMode: true,
          initialDevicePass: { orders: [], ...lostOnly },
        });
        expect(shown(el).board).toBe(false);
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(shown(el)).toEqual({ lines: [], board: true });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("shows only its line when a narrowing took the pass screen itself", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    try {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      const api = passApi([threeCourseOrder], { available: false });
      const el = await mount({ api });
      expect(
        [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
          line.textContent!.trim(),
        ),
      ).toEqual(["This screen is no longer available: Pass screen"]);
      expect(el.shadowRoot!.querySelector("[data-order], .empty")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDevicePassScreen).not.toHaveBeenCalled();
      expect(api.getExpoQueue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      setLocale(previousLocale);
    }
  });

  it("reads the device's choice again at the next refresh after a failed read, and then follows it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = passApi([threeCourseOrder]);
      vi.mocked(api.getDeviceIdentity).mockRejectedValueOnce({ code: "server.internal" });
      const el = await mount({ api });
      expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.querySelector("[data-done]")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(api.getDevicePassScreen).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
      expect(api.getDevicePassScreen).toHaveBeenCalledTimes(2);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays on All stations, reading it, while the device's choice cannot be read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder], {
        getDeviceIdentity: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const el = await mount({ api });
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.textContent).toContain("Pan");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops All stations' board when a choice read later says a narrowing took the pass screen", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = passApi([threeCourseOrder], { available: false });
      vi.mocked(api.getDeviceIdentity).mockRejectedValueOnce({ code: "server.internal" });
      const el = await mount({ api });
      expect(el.shadowRoot!.querySelector('[data-order="5"]')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-order], .empty")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
      expect(api.getDevicePassScreen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("at a till, the device's choice changing while the screen is open", () => {
    const passScreen = (available: boolean) =>
      identity([{ kind: "pass", available, stations: [], zones: null }]);
    const passMonitor = identity([
      { kind: "pass_monitor", available: true, stations: [], zones: null },
    ]);
    const refused = () => Object.assign(new Error("401"), { code: "device.unauthorized" });
    const withFakeTimers = async (run: () => Promise<void>) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      try {
        await run();
      } finally {
        vi.useRealTimers();
      }
    };

    it("shows the pass board again when the pass screen is given back while its line shows", () =>
      withFakeTimers(async () => {
        const api = passApi([threeCourseOrder], { available: false });
        vi.mocked(api.getDeviceIdentity)
          .mockResolvedValueOnce(passScreen(false))
          .mockResolvedValue(passScreen(true));
        const el = await mount({ api });
        expect(el.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(el.shadowRoot!.querySelector("[data-unavailable]")).toBeNull();
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
      }));

    it("keeps its line when reading the choice again fails", () =>
      withFakeTimers(async () => {
        const api = passApi([threeCourseOrder], { available: false });
        vi.mocked(api.getDeviceIdentity)
          .mockResolvedValueOnce(passScreen(false))
          .mockRejectedValue({ code: "server.internal" });
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(el.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
        expect(api.getExpoQueue).not.toHaveBeenCalled();
        expect(el.shadowRoot!.querySelector("[data-order]")).toBeNull();
      }));

    it("ignores an older choice read that answers after a newer one", () =>
      withFakeTimers(async () => {
        const api = passApi([threeCourseOrder], { available: false });
        let answerLate: (value: DeviceIdentity) => void = () => {};
        vi.mocked(api.getDeviceIdentity)
          .mockResolvedValueOnce(passScreen(false))
          .mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)))
          .mockResolvedValue(passScreen(true));
        const el = await mount({ api });
        await vi.advanceTimersByTimeAsync(30_000);
        await el.updateComplete;
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
        answerLate(passScreen(false));
        await flush(el);
        expect(el.shadowRoot!.querySelector("[data-unavailable]")).toBeNull();
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
      }));

    it("becomes the pass monitor when the choice is now a monitor, whose pass board is refused", () =>
      withFakeTimers(async () => {
        const api = passApi(
          [threeCourseOrder],
          {},
          {
            getDevicePassMonitor: vi
              .fn()
              .mockResolvedValue({ orders: [threeCourseOrder], stations: [], zones: null }),
          },
        );
        const el = await mount({ api });
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
        vi.mocked(api.getDeviceIdentity).mockResolvedValue(passMonitor);
        vi.mocked(api.getDevicePassScreen).mockRejectedValue(refused());
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDevicePassMonitor).toHaveBeenCalledTimes(1);
        expect(api.getDevicePassScreen).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector('[data-order="5"]')).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".board button, .board wt-button")).toBeNull();
        expect(el.shadowRoot!.querySelector(".stale[data-stale]")).toBeNull();
      }));

    it("marks its pass board out of date, reading no other board, when it is refused and the choice is unchanged", () =>
      withFakeTimers(async () => {
        const getDevicePassMonitor = vi.fn();
        const api = passApi([threeCourseOrder], {}, { getDevicePassMonitor });
        const el = await mount({ api });
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
        vi.mocked(api.getDevicePassScreen).mockRejectedValue(refused());
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDevicePassScreen).toHaveBeenCalledTimes(2);
        expect(getDevicePassMonitor).not.toHaveBeenCalled();
        expect(api.getExpoQueue).not.toHaveBeenCalled();
        expect(el.shadowRoot!.querySelector(".stale[data-stale]")).not.toBeNull();
        expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
      }));

    it.each([
      ["pass", '[data-done="ti-0"]', true],
      ["pass_monitor", '[data-order="5"]', false],
    ] as const)("leaves All stations for a %s chosen while it is open", (kind, shown, buttons) =>
      withFakeTimers(async () => {
        const board = { orders: [threeCourseOrder], stations: [], zones: null };
        const api = stubApi([threeCourseOrder], {
          getDevicePassMonitor: vi.fn().mockResolvedValue(board),
        });
        const el = await mount({ api });
        expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
        vi.mocked(api.getDeviceIdentity).mockResolvedValue(
          identity([{ kind, available: true, stations: [], zones: null }]),
        );
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getExpoQueue).toHaveBeenCalledTimes(1);
        expect(
          kind === "pass" ? api.getDevicePassScreen : api.getDevicePassMonitor,
        ).toHaveBeenCalledTimes(1);
        expect(el.shadowRoot!.querySelector(shown)).not.toBeNull();
        expect(el.shadowRoot!.querySelector(".board button, .board wt-button") !== null).toBe(
          buttons,
        );
        await vi.advanceTimersByTimeAsync(15_000);
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
        expect(
          kind === "pass" ? api.getDevicePassScreen : api.getDevicePassMonitor,
        ).toHaveBeenCalledTimes(2);
      }),
    );
  });

  it("reports a refused Undo and keeps the dish Done", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    try {
      const api = passApi([threeCourseOrder]);
      const el = await mount({ api });
      el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
      await flush(el);
      vi.mocked(api.markDevicePassDone).mockRejectedValueOnce({ code: "session.required" });
      el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
      await flush(el);
      expect(api.markDevicePassDone).toHaveBeenLastCalledWith(["ti-0"], false);
      expect(el.shadowRoot!.querySelector("[data-undo]")).toBeNull();
      expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
        codeMessage("session.required"),
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("shows no Fire, Ready or Away without Run the pass, and each of them with it", async () => {
    const api = stubApi([threeCourseOrder]);
    const el = await mount({ api, fireControl: "expo", runsPass: false });
    expect(el.shadowRoot!.querySelector(".lever")).toBeNull();
    el.runsPass = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-1"]')).not.toBeNull();
    const notReady = await mount({
      api: stubApi([firedNotReadyOrder]),
      fireControl: "expo",
      runsPass: true,
    });
    expect(notReady.shadowRoot!.querySelector('[data-ready="co-3"]')).not.toBeNull();
  });

  it("removes Undo ten seconds after a Done", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const el = await mount({ api: passApi([threeCourseOrder]) });
      el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-undo]")).not.toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-undo]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps sent-out dishes visible without lateness on a pass choice", async () => {
    const old = { ...threeCourseOrder.courses[0]!.items[0]!, awayAt: FIRED, queuedAt: FIRED };
    const fresh = {
      ...threeCourseOrder.courses[1]!.items[0]!,
      queuedAt: "2026-08-17T11:00:00.000Z",
    };
    const order = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[0]!, away: false, items: [old, fresh] }],
    };
    const el = await mount({ api: passApi([order]), now: Date.parse("2026-08-17T11:01:00.000Z") });
    expect(el.shadowRoot!.querySelector('[data-item="ti-0"]')!.textContent).toContain("Sent out");
    expect(el.shadowRoot!.querySelector('[data-item="ti-0"] [data-forgotten]')).toBeNull();
    expect(orderCard(el, 5)!.classList.contains("age-forgotten")).toBe(false);
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("keeps an away section on a pass choice but offers no lever", async () => {
    const el = await mount({ api: passApi([withAwayCourse]), fireControl: "expo" });
    expect(el.shadowRoot!.querySelector('[data-item="ti-4"]')!.textContent).toContain("Sent out");
    expect(el.shadowRoot!.querySelector('[data-course="co-4"] .lever')).toBeNull();
  });

  it("uses Run the pass and the server's allReady for whole-course levers on a pass choice", async () => {
    const held = { ...threeCourseOrder.courses[2]!, allReady: false };
    const ready = {
      ...threeCourseOrder.courses[1]!,
      allReady: true,
      items: [{ ...threeCourseOrder.courses[1]!.items[0]!, state: "preparing" as const }],
    };
    const order = { ...threeCourseOrder, courses: [held, ready], groups: [] };
    const api = passApi(
      [],
      {},
      {
        getDevicePassScreen: vi
          .fn()
          .mockResolvedValue({ orders: [order], stations: [], zones: null }),
      },
    );
    const el = await mount({ api, fireControl: "expo", runsPass: false });
    expect(el.shadowRoot!.querySelector(".lever")).toBeNull();
    el.runsPass = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-1"]')).not.toBeNull();
    el.fireControl = "kitchen";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-1"]')).not.toBeNull();
  });

  it("marks a course's dishes Done after sending it Away on a pass choice", async () => {
    const passOrder = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[1]!, allReady: true }],
      groups: [],
    };
    const api = passApi(
      [],
      {},
      {
        getDevicePassScreen: vi
          .fn()
          .mockResolvedValue({ orders: [passOrder], stations: [], zones: null }),
      },
    );
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.markCourseAway).toHaveBeenCalledWith("wo-1", "co-1");
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-1"], true);
  });

  it("marks a group's dishes Done after sending it Away on a pass choice", async () => {
    const passOrder = {
      ...threeCourseOrder,
      party: { id: "party-1", revision: 3 },
      courses: [],
      groups: [
        {
          groupId: "g-3",
          position: 3,
          state: "fired" as const,
          fired: true,
          away: false,
          allReady: true,
          items: [threeCourseOrder.courses[1]!.items[0]!],
        },
      ],
    };
    const api = passApi(
      [],
      {},
      {
        getDevicePassScreen: vi
          .fn()
          .mockResolvedValue({ orders: [passOrder], stations: [], zones: null }),
        markGroupAway: vi.fn().mockResolvedValue({ revision: 4 }),
      },
    );
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    expect(api.markGroupAway).toHaveBeenCalled();
    expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-1"], true);
  });

  it("sends every shown dish on All done and reports a refused Done", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    try {
      const api = passApi([threeCourseOrder]);
      const el = await mount({ api });
      el.shadowRoot!.querySelector<HTMLElement>('[data-all-done="wo-1"]')!.click();
      await flush(el);
      expect(api.markDevicePassDone).toHaveBeenCalledWith(["ti-0", "ti-1", "ti-2"], true);
      vi.mocked(api.markDevicePassDone).mockRejectedValueOnce({ code: "session.required" });
      el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
        codeMessage("session.required"),
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("refreshes the pass choice after fifteen seconds and labels a failed read stale", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = passApi([threeCourseOrder]);
      const el = await mount({ api });
      vi.mocked(api.getDevicePassScreen).mockRejectedValueOnce(new Error("offline"));
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDevicePassScreen).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes All stations every fifteen seconds at a till with no pass choice", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder]);
      const el = await mount({ api });
      expect(el.shadowRoot!.textContent).toContain("Pan");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps dish and modifier receipt snapshots visible with an unrelated content default", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
    try {
      const order: ExpoOrder = {
        ...threeCourseOrder,
        courses: [
          {
            ...threeCourseOrder.courses[0]!,
            items: [
              {
                ...threeCourseOrder.courses[0]!.items[0]!,
                modifiers: [{ descriptions: { "es-ES": "Mantequilla" } }],
              },
            ],
          },
        ],
      };
      const el = await mount({ api: stubApi([order]) });
      expect(el.shadowRoot!.querySelector(".item-name")!.textContent).toBe("1× Pan");
      expect(el.shadowRoot!.textContent).toContain("Mantequilla");
    } finally {
      setLocale(previousLocale);
    }
  });

  it("shows each extra's own allergens and diet on the pass, distinct from the dish's own", async () => {
    const item: ExpoItem = {
      ...threeCourseOrder.courses[0]!.items[0]!,
      // The DISH declares its own gluten; the EXTRA declares its own milk + halal.
      asServed: { allergens: { gluten: { presence: "contains" } }, pending: false },
      modifiers: [
        {
          descriptions: { "es-ES": "Bacon" },
          addAllergens: { milk: { presence: "contains" } },
          suitableFor: ["halal"],
        },
      ],
    };
    const order: ExpoOrder = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[0]!, items: [item] }],
    };
    const el = await mount({ api: stubApi([order]) });
    const milkName = allergenName("milk", currentLocale());
    const optAllergens = el.shadowRoot!.querySelector(
      `[data-test="item-modifier-allergens-${item.id}-0"]`,
    );
    expect(optAllergens).not.toBeNull();
    expect(optAllergens!.textContent).toContain(milkName);
    const optDiet = el.shadowRoot!.querySelector(`[data-test="item-modifier-diet-${item.id}-0"]`);
    expect(optDiet).not.toBeNull();
    expect(optDiet!.querySelector("[data-diet='halal']")).not.toBeNull();
    // The dish's OWN allergen row shows its gluten, a node distinct from the extra's milk (no fold).
    const dishAllergens = el.shadowRoot!.querySelector(`[data-item-allergens="${item.id}"]`);
    expect(dishAllergens!.textContent).toMatch(/gluten/i);
    expect(dishAllergens!.textContent).not.toContain(milkName);
  });

  it("registers as a custom element", () => {
    expect(customElements.get("till-expo-screen")).toBe(TillExpoScreen);
  });

  it("on connect fetches the expo queue and renders a card per open order", async () => {
    const api = stubApi([threeCourseOrder, firedNotReadyOrder]);
    const el = await mount({ api });
    expect(api.getExpoQueue).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelectorAll("[data-order]")).toHaveLength(2);
    expect(orderCard(el, 5)).not.toBeNull();
    expect(orderCard(el, 6)).not.toBeNull();
  });

  it("renders each order's table label and open-minutes age", async () => {
    const el = await mount({ api: stubApi() });
    const card = orderCard(el, 5)!;
    expect(card.textContent).toContain("#5");
    expect(card.textContent).toContain("Mesa 4");
    expect(card.textContent).toContain(`3 ${t("station.min")}`);
  });

  it("groups by course in display_order, null-course first", async () => {
    const el = await mount({ api: stubApi() });
    const courses = [...orderCard(el, 5)!.querySelectorAll("[data-course]")].map((c) =>
      c.getAttribute("data-course"),
    );
    // Null course sorts earliest (NEGATIVE_INFINITY), then Entrantes (0), then Principales (1).
    expect(courses).toEqual(["none", "co-1", "co-2"]);
  });

  it("sorts a named course with no display order at position 0, and fires it under the verb alone", async () => {
    const item = (id: string): ExpoItem => ({
      ...threeCourseOrder.courses[2]!.items[0]!,
      id,
    });
    const order: ExpoOrder = {
      ...threeCourseOrder,
      courses: [
        {
          courseId: "co-late",
          courseName: "Postres",
          displayOrder: 1,
          fired: false,
          away: false,
          items: [item("ti-late")],
        },
        {
          courseId: "co-unordered",
          courseName: null,
          displayOrder: null,
          fired: false,
          away: false,
          items: [item("ti-unordered")],
        },
        threeCourseOrder.courses[0]!,
      ],
    };
    const el = await mount({ api: stubApi([order]), fireControl: "expo" });
    const courses = [...orderCard(el, 5)!.querySelectorAll("[data-course]")].map((c) =>
      c.getAttribute("data-course"),
    );
    expect(courses).toEqual(["none", "co-unordered", "co-late"]);
    const unnamed = orderCard(el, 5)!.querySelector('[data-course="co-unordered"]')!;
    expect(unnamed.querySelector(".course-head")).toBeNull();
    const fire = unnamed.querySelector<HTMLElement>('[data-fire="co-unordered"]')!;
    expect(fire.getAttribute("aria-label")!.trim()).toBe(t("expo.fire"));
  });

  it("renders per item its name, quantity, station and state", async () => {
    const el = await mount({ api: stubApi() });
    const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!;
    expect(item.textContent).toContain("1× Solomillo"); // qty trimmed + name
    expect(item.textContent).toContain("Parrilla"); // the cross-station station name
    expect(item.textContent).toContain(t("station.state.queued")); // the kitchen state
  });

  it("renders a fractional item with its snapshotted unit", async () => {
    const item: ExpoItem = {
      ...threeCourseOrder.courses[0]!.items[0]!,
      qty: "0.375",
      unitName: { "es-ES": "kg" },
      unitPrecision: 3,
    };
    const order: ExpoOrder = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[0]!, items: [item] }],
    };
    const el = await mount({ api: stubApi([order]) });
    expect(el.shadowRoot!.querySelector(".item-name")!.textContent).toBe("0.375 kg× Pan");
  });

  it("leaves the unit out for a dish sold in Each, and keeps it for every other unit", async () => {
    const base = threeCourseOrder.courses[0]!.items[0]!;
    const items: ExpoItem[] = [
      {
        ...base,
        id: "ti-each",
        name: "Croqueta",
        qty: "2.000",
        unitName: { "es-ES": "ud" },
        unitPrecision: 0,
        soldInEach: true,
      },
      {
        ...base,
        id: "ti-kg",
        name: "Pulpo",
        qty: "0.500",
        unitName: { "es-ES": "kg" },
        unitPrecision: 3,
        soldInEach: false,
      },
      {
        ...base,
        id: "ti-g",
        name: "Almendras",
        qty: "200.000",
        unitName: { "es-ES": "g" },
        unitPrecision: 0,
        soldInEach: false,
      },
    ];
    const order: ExpoOrder = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[0]!, items }],
    };
    const el = await mount({ api: stubApi([order]) });
    const names = [...el.shadowRoot!.querySelectorAll(".item-name")].map((n) => n.textContent);
    expect(names).toEqual(["2× Croqueta", "0.5 kg× Pulpo", "200 g× Almendras"]);
  });

  describe("ordering modifiers (Task 14): selected options as indented sub-text under the item", () => {
    const orderWithModifiers: ExpoOrder = {
      orderId: "wo-9",
      orderNumber: 9,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [
            {
              id: "ti-9",
              name: "Cortado",
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              modifiers: [
                { descriptions: { "es-ES": "Grande" } },
                { descriptions: { "es-ES": "Leche avena" } },
              ],
            },
          ],
        },
      ],
    };

    it("renders the dish then its two options as indented '+ name' sub-text", async () => {
      const el = await mount({ api: stubApi([orderWithModifiers]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-9"]')!;
      expect(item.textContent).toContain("1× Cortado");
      expect(item.textContent).toContain("+ Grande");
      expect(item.textContent).toContain("+ Leche avena");
      // The dish precedes its modifiers in DOM order.
      const html = item.innerHTML;
      expect(html.indexOf("Cortado")).toBeLessThan(html.indexOf("Grande"));
    });

    it("an item with no modifiers renders flat, with no modifiers sub-text at all (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries `modifiers`
      expect(el.shadowRoot!.querySelectorAll(".item-modifiers")).toHaveLength(0);
    });
  });

  describe("per-line customisation (Task 5): the snapshotted note as sub-text under the item", () => {
    const orderWithCustomisation: ExpoOrder = {
      orderId: "wo-c",
      orderNumber: 12,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [
            {
              id: "ti-c",
              name: "Chuletón",
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              note: "sin sal",
            },
          ],
        },
      ],
    };

    it("renders the note as sub-text beneath the item", async () => {
      const el = await mount({ api: stubApi([orderWithCustomisation]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-c"]')!;
      expect(item.textContent).toContain("1× Chuletón");
      expect(item.querySelector("[data-note]")!.textContent).toContain("sin sal");
    });

    it("an EMPTY note renders no customisation row (an empty string is not a note)", async () => {
      const emptyNote: ExpoOrder = {
        ...orderWithCustomisation,
        courses: [
          {
            ...orderWithCustomisation.courses[0]!,
            items: [{ ...orderWithCustomisation.courses[0]!.items[0]!, note: "" }],
          },
        ],
      };
      const el = await mount({ api: stubApi([emptyNote]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-c"]')!;
      expect(item.querySelector("[data-note]")).toBeNull();
      expect(item.querySelector(".item-customisation")).toBeNull();
    });

    it("a null note renders no customisation row", async () => {
      const noNote: ExpoOrder = {
        ...orderWithCustomisation,
        courses: [
          {
            ...orderWithCustomisation.courses[0]!,
            items: [{ ...orderWithCustomisation.courses[0]!.items[0]!, note: null }],
          },
        ],
      };
      const el = await mount({ api: stubApi([noNote]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-c"]')!;
      expect(item.querySelector(".item-customisation")).toBeNull();
    });

    it("an item with no note renders no customisation row at all (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries a note
      expect(el.shadowRoot!.querySelectorAll(".item-customisation")).toHaveLength(0);
    });
  });

  describe("as-served allergens: the dish's own contains chips + not-reviewed note", () => {
    const orderWithAllergens: ExpoOrder = {
      orderId: "wo-a",
      orderNumber: 11,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [
            {
              id: "ti-a",
              name: "Hamburguesa",
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
            },
            {
              id: "ti-p",
              name: "Especial",
              qty: "1.000",
              stationName: "Cocina",
              state: "queued",
              firedAt: FIRED,
              awayAt: null,
              queuedAt: FIRED,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh",
              // Own allergens unreviewed (null base) ⇒ the Cautious profile is pending.
              asServed: { allergens: {}, pending: true },
            },
          ],
        },
      ],
    };

    it("shows the dish's own localised 'Milk' contains chip", async () => {
      const el = await mount({ api: stubApi([orderWithAllergens]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-a"]')!;
      expect(item.textContent).toMatch(/milk/i);
    });

    it("shows a not-reviewed warning when the dish's own allergens are pending", async () => {
      const el = await mount({ api: stubApi([orderWithAllergens]) });
      const item = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-p"]')!;
      expect(item.textContent).toContain(t("allergens.not_reviewed"));
    });

    it("a plain item with no as-served profile renders no allergen row (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries asServed
      expect(el.shadowRoot!.querySelectorAll(".item-allergens")).toHaveLength(0);
    });
  });

  describe("as-served diet badges (Task 7): vegan/vegetarian/contains chips, neutral not-reviewed note", () => {
    const dietItem = (id: string, asServedDiet: ExpoItem["asServedDiet"]): ExpoItem => ({
      id,
      name: "Ensalada",
      qty: "1.000",
      stationName: "Cocina",
      state: "queued",
      firedAt: FIRED,
      awayAt: null,
      queuedAt: FIRED,
      thresholds: DEFAULT_THRESHOLDS,
      band: "fresh",
      asServedDiet,
    });
    const orderWithDiet = (item: ExpoItem): ExpoOrder => ({
      orderId: "wo-d",
      orderNumber: 31,
      openedMinutes: 1,
      worstBand: "fresh",
      courses: [
        {
          courseId: null,
          courseName: null,
          displayOrder: null,
          fired: true,
          away: false,
          items: [item],
        },
      ],
    });

    it("shows vegan + vegetarian badges for a plant-only plate", async () => {
      const item = dietItem("ti-v", { vegan: "yes", vegetarian: "yes", contains: [] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-v"]')!;
      expect(node.querySelector("[data-diet='vegan']")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegetarian']")).not.toBeNull();
      expect(node.textContent).not.toMatch(/review|revisi/i);
    });

    it("shows a contains-meat chip and no positive badge for a meat plate", async () => {
      const item = dietItem("ti-m", { vegan: "no", vegetarian: "no", contains: ["meat"] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-m"]')!;
      expect(node.querySelector("[data-diet-contains='meat']")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("shows the NEUTRAL 'not reviewed' state for a pending diet, never a positive claim", async () => {
      const item = dietItem("ti-pd", { vegan: "unknown", vegetarian: "unknown", contains: [] });
      const el = await mount({ api: stubApi([orderWithDiet(item)]) });
      const node = el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-pd"]')!;
      expect(node.querySelector("[data-diet-pending]")).not.toBeNull();
      expect(node.querySelector("[data-diet='vegan']")).toBeNull();
    });

    it("a plain item with no asServedDiet renders no diet row (regression-safe)", async () => {
      const el = await mount({ api: stubApi() }); // threeCourseOrder — no item carries asServedDiet
      expect(el.shadowRoot!.querySelectorAll(".line-diet")).toHaveLength(0);
    });
  });

  it("a HELD course under fire_control='expo' shows the Fire lever", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const fire = el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-2"]');
    expect(fire).not.toBeNull();
    expect(fire!.textContent).toContain(t("expo.fire"));
    // The fired course offers no fire lever.
    expect(el.shadowRoot!.querySelector('[data-fire="co-1"]')).toBeNull();
  });

  it("a HELD course under fire_control='waiter' shows NO Fire lever (the expo does not own the fire)", async () => {
    const el = await mount({ api: stubApi(), fireControl: "waiter" });
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).toBeNull();
  });

  it("a FIRED, not-all-ready course shows the Curso-listo lever", async () => {
    const el = await mount({ api: stubApi([firedNotReadyOrder]), fireControl: "expo" });
    const ready = el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]');
    expect(ready).not.toBeNull();
    expect(ready!.textContent).toContain(t("expo.ready"));
    // It is neither a fire nor an away lever.
    expect(el.shadowRoot!.querySelector('[data-fire="co-3"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-3"]')).toBeNull();
  });

  it("a FIRED, all-ready course shows the En-camino (away) lever", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const away = el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]');
    expect(away).not.toBeNull();
    expect(away!.textContent).toContain(t("expo.away"));
    expect(el.shadowRoot!.querySelector('[data-ready="co-1"]')).toBeNull();
  });

  it("the null (courseless) course shows no per-course lever (it has no course route)", async () => {
    const el = await mount({ api: stubApi(), fireControl: "expo" });
    const nullCourse = orderCard(el, 5)!.querySelector('[data-course="none"]')!;
    expect(nullCourse.querySelector(".lever")).toBeNull();
  });

  it("a fully-away course drops off the board; its live sibling stays", async () => {
    const el = await mount({ api: stubApi([withAwayCourse]), fireControl: "expo" });
    const card = orderCard(el, 8)!;
    expect(card.querySelector('[data-course="co-4"]')).toBeNull(); // away → hidden
    expect(card.querySelector('[data-course="co-5"]')).not.toBeNull(); // live → shown
  });

  it("clicking Fire calls fireCourse(orderId, courseId) then reloads the queue", async () => {
    const api = stubApi();
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-2"]')!.click();
    await flush(el);
    expect(api.fireCourse).toHaveBeenCalledWith("wo-1", "co-2");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2); // connect + after fire
  });

  it("clicking Curso listo calls bumpCourseReady(orderId, courseId) then reloads", async () => {
    const api = stubApi([firedNotReadyOrder]);
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready="co-3"]')!.click();
    await flush(el);
    expect(api.bumpCourseReady).toHaveBeenCalledWith("wo-2", "co-3");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  it("clicking En camino calls markCourseAway(orderId, courseId) then reloads", async () => {
    const api = stubApi();
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.markCourseAway).toHaveBeenCalledWith("wo-1", "co-1");
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  it("a failed action still reloads the queue (reconciling to server truth)", async () => {
    const api = stubApi(undefined, {
      markCourseAway: vi.fn().mockRejectedValue({ code: "course.not_found" }),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
  });

  it("shows a per-order Reprint button on every card (the pass always has a session)", async () => {
    const el = await mount({ api: stubApi([threeCourseOrder, firedNotReadyOrder]) });
    // One reprint control per order, keyed by orderId (not the display number).
    const one = orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]');
    expect(one).not.toBeNull();
    expect(one!.textContent).toContain(t("expo.reprint"));
    expect(orderCard(el, 6)!.querySelector('[data-reprint="wo-2"]')).not.toBeNull();
  });

  it("clicking Reprint calls reprintOrder(orderId) with that order's id", async () => {
    const api = stubApi();
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    // The actual call + arg, not merely "a handler fired".
    expect(api.reprintOrder).toHaveBeenCalledWith("wo-1");
    // Reprint changes no state, so it never re-reads the queue (only the connect read ran).
    expect(api.getExpoQueue).toHaveBeenCalledOnce();
  });

  it("a rejected Reprint surfaces the localised banner, never the raw code (negative control)", async () => {
    // A mapped code → its SPECIFIC localised sentence, proving the banner never shows the wire code.
    const api = stubApi(undefined, {
      reprintOrder: vi.fn().mockRejectedValue({ code: "session.required" }),
    });
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    // The banner shows the localised sentence (in the active default locale), never the wire code.
    expect(alert!.textContent).toContain(codeMessage("session.required"));
    expect(alert!.textContent).not.toContain("session.required");
  });

  it("a codeless Reprint rejection (a fetch network throw) falls back to the generic banner", async () => {
    // A rejection with no `code` (e.g. fetch itself throwing before the client wraps it) degrades to
    // `server.internal` — the generic sentence — never an empty banner or a raw throw.
    const api = stubApi(undefined, {
      reprintOrder: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const el = await mount({ api });
    orderCard(el, 5)!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("server.internal"));
  });

  /** `openedMinutes` is set to an unrelated value so the accent is shown not to consult it. */
  function bandOrder(
    orderId: string,
    orderNumber: number,
    itemId: string,
    queuedAt: string,
  ): ExpoOrder {
    return {
      orderId,
      orderNumber,
      openedMinutes: 999, // deliberately absurd — proves the accent ignores it
      worstBand: "fresh", // the server's fetch-time value — the live accent re-derives, not this
      courses: [
        {
          courseId: "co-x",
          courseName: "Postres",
          displayOrder: 0,
          fired: true,
          away: false,
          items: [
            {
              id: itemId,
              name: "Flan",
              qty: "1.000",
              stationName: "Cocina",
              state: "preparing",
              firedAt: FIRED,
              awayAt: null,
              queuedAt,
              thresholds: DEFAULT_THRESHOLDS,
              band: "fresh", // the server's fetch-time value — likewise re-derived, not read
            },
          ],
        },
      ],
    };
  }

  it("colours a card by classifyBand on its item's queuedAt/thresholds, ignoring openedMinutes", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue
    const el = await mount({
      api: stubApi([bandOrder("wo-a", 21, "ti-a", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 21)!.classList).toContain("age-overdue");
  });

  it("a fresh item's card carries no escalation accent", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // 1 min → fresh
    const el = await mount({
      api: stubApi([bandOrder("wo-fresh", 20, "ti-fresh", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 20)!.classList).toContain("age-fresh");
  });

  it("a forgotten item flags BOTH the card's accent and the item itself (a non-colour tell)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // 16 min → forgotten (past the 15-min default)
    const el = await mount({
      api: stubApi([bandOrder("wo-b", 22, "ti-b", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    const card = orderCard(el, 22)!;
    expect(card.classList).toContain("age-forgotten");
    const flag = card.querySelector<HTMLElement>('[data-item="ti-b"] [data-forgotten]');
    expect(flag).not.toBeNull();
    expect(flag!.textContent).toContain(t("expo.item_forgotten"));
  });

  it("a merely-overdue item is NOT flagged forgotten (negative control)", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue, not forgotten
    const el = await mount({
      api: stubApi([bandOrder("wo-c", 23, "ti-c", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(orderCard(el, 23)!.querySelector('[data-item="ti-c"] [data-forgotten]')).toBeNull();
  });

  it("the pass-wide count reads the number of orders at overdue-or-worse (BAND_RANK)", async () => {
    // wo-d is 16 min old (forgotten); wo-e is 15 min old (still just overdue, not forgotten) —
    // both count; a third, fresh order (from bandOrder's own fresh-item test) is not mixed in here.
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([
        bandOrder("wo-d", 24, "ti-d", "2026-08-17T10:00:00.000Z"),
        bandOrder("wo-e", 25, "ti-e", "2026-08-17T10:01:00.000Z"),
      ]),
      now,
    });
    const badge = el.shadowRoot!.querySelector(".overdue-count")!;
    expect(badge.textContent).toContain("2");
    expect(badge.textContent).toContain(t("station.overdue_count"));
  });

  it("shows no pass-wide count badge when nothing has escalated to overdue", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // 1 min → fresh
    const el = await mount({
      api: stubApi([bandOrder("wo-f", 26, "ti-f", "2026-08-17T10:00:00.000Z")]),
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("forgotten flashes by default (motion allowed) — the flash class rides the steady accent", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([bandOrder("wo-g", 27, "ti-g", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: false,
    });
    const card = orderCard(el, 27)!;
    expect(card.classList).toContain("age-forgotten");
    expect(card.classList).toContain("flash");
  });

  it("reduced motion: a forgotten card renders the steady accent with NO flash class", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z");
    const el = await mount({
      api: stubApi([bandOrder("wo-h", 28, "ti-h", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: true,
    });
    const card = orderCard(el, 28)!;
    expect(card.classList).toContain("age-forgotten");
    expect(card.classList).not.toContain("flash");
  });

  it("reduced motion never applies flash to a merely-overdue (non-forgotten) card either", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // 12 min → overdue, not forgotten
    const el = await mount({
      api: stubApi([bandOrder("wo-i", 29, "ti-i", "2026-08-17T10:00:00.000Z")]),
      now,
      reducedMotion: false,
    });
    const card = orderCard(el, 29)!;
    expect(card.classList).toContain("age-overdue");
    expect(card.classList).not.toContain("flash");
  });

  it("injected now advances the band without a new fetch (the ticking-clock contract)", async () => {
    const api = stubApi([bandOrder("wo-j", 30, "ti-j", "2026-08-17T10:00:00.000Z")]);
    const el = await mount({ api, now: Date.parse("2026-08-17T10:01:00.000Z") }); // 1 min → fresh
    expect(orderCard(el, 30)!.classList).toContain("age-fresh");

    // Move the injected clock forward past the forgotten threshold and re-render — no re-fetch.
    el.now = Date.parse("2026-08-17T10:16:00.000Z"); // 16 min → forgotten
    await el.updateComplete;
    expect(orderCard(el, 30)!.classList).toContain("age-forgotten");
    expect(api.getExpoQueue).toHaveBeenCalledOnce(); // still just the initial connect fetch
  });

  it("shows the empty message when the pass has no open orders", async () => {
    const el = await mount({ api: stubApi([]) });
    expect(el.shadowRoot!.textContent).toContain(t("expo.empty"));
    expect(el.shadowRoot!.querySelector("[data-order]")).toBeNull();
  });

  it("a failed queue read leaves the board empty (degrade gracefully)", async () => {
    const api = stubApi(undefined, {
      getExpoQueue: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount({ api });
    expect(el.shadowRoot!.textContent).toContain(t("expo.empty"));
  });

  it("the Back control emits back-to-counter", async () => {
    const el = await mount({ api: stubApi() });
    const spy = vi.fn();
    el.addEventListener("back-to-counter", spy);
    el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("suppresses its own header + back button when embedded", async () => {
    const el = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector(".back")).toBeNull();
  });

  it("renders its header + back button when standalone (default)", async () => {
    const el = await mount({});
    expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
  });
});

it("shows a dish's frozen options answers in the KITCHEN's wording", async () => {
  // Three different texts per name, so the assertion fails if the pass reads the staff or the
  // customer side by mistake (CLAUDE.md §3).
  const first = threeCourseOrder.courses[0]!;
  const order: ExpoOrder = {
    ...threeCourseOrder,
    courses: [
      {
        ...first,
        items: [
          {
            ...first.items[0]!,
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
          },
        ],
      },
    ],
  };
  const el = await mount({ api: stubApi([order]) });
  expect(el.shadowRoot!.querySelector(".modifier-answer")!.textContent).toBe("PTO: PH");
});

describe("till-expo-screen — a seated party's groups", () => {
  function passItem(id: string, name: string, over: Partial<ExpoItem> = {}): ExpoItem {
    return {
      id,
      name,
      qty: "1.000",
      stationName: "Cocina",
      state: "queued",
      firedAt: FIRED,
      awayAt: null,
      queuedAt: FIRED,
      thresholds: DEFAULT_THRESHOLDS,
      band: "fresh",
      ...over,
    };
  }

  function section(
    groupId: string | null,
    position: number | null,
    state: "held" | "fired" | null,
    items: ExpoItem[],
    away = false,
  ): ExpoGroup {
    return { groupId, position, state, fired: state !== "held", away, items };
  }

  // Listed out of position order, with a course on none of them, so the card must section by group.
  const partyOrder: ExpoOrder = {
    orderId: "wo-p",
    orderNumber: 9,
    tableLabel: "Mesa 4",
    openedMinutes: 20,
    worstBand: "fresh",
    party: { id: "v-4", revision: 7 },
    courses: [],
    groups: [
      section("g-4", 4, "held", [passItem("it-steak", "Solomillo", { firedAt: null })]),
      section("g-2", 2, "fired", [passItem("it-croq", "Croquetas", { state: "preparing" })]),
      section(
        "g-1",
        1,
        "fired",
        [passItem("it-beer", "Caña", { state: "ready", awayAt: FIRED })],
        true,
      ),
      section(null, null, null, [passItem("it-moved", "Pan", { state: "ready" })]),
      section("g-5", 5, "held", [passItem("it-flan", "Flan", { firedAt: null })]),
      section("g-3", 3, "fired", [passItem("it-salad", "Ensalada", { state: "ready" })]),
    ],
  };

  const sections = (el: TillExpoScreen) => [
    ...orderCard(el, 9)!.querySelectorAll<HTMLElement>("[data-group-section]"),
  ];
  const tableChanged = (el: TillExpoScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-table-changed]");
  const groupName = (n: number) => t("table.group_n").replace("{n}", String(n));

  function partyApi(overrides: Record<string, unknown> = {}) {
    return stubApi([partyOrder], {
      fireGroup: vi.fn().mockResolvedValue({ revision: 8 }),
      bumpGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
      markGroupAway: vi.fn().mockResolvedValue({ revision: 8 }),
      ...overrides,
    });
  }

  it("shows the lines with no group first, then each group by position; a group already away drops off", async () => {
    const el = await mount({ api: partyApi(), fireControl: "expo" });
    expect(sections(el).map((s) => s.dataset.groupSection)).toEqual([
      "none",
      "g-2",
      "g-3",
      "g-4",
      "g-5",
    ]);
    expect(sections(el)[0]!.querySelector(".course-head")).toBeNull();
    expect(sections(el)[1]!.querySelector(".course-head")!.textContent).toContain(groupName(2));
    expect(orderCard(el, 9)!.querySelector("[data-course]")).toBeNull();
  });

  it("labels each held group held, not released, and no fired one", async () => {
    const el = await mount({ api: partyApi(), fireControl: "expo" });
    const held = sections(el).filter((s) => s.querySelector("[data-group-held]") !== null);
    expect(held.map((s) => s.dataset.groupSection)).toEqual(["g-4", "g-5"]);
    expect(held[0]!.querySelector("[data-group-held]")!.textContent).toContain(
      t("station.group_held"),
    );
    expect(held[0]!.querySelector('[data-item="it-steak"]')!.classList.contains("held")).toBe(true);
  });

  it("offers Ready on a fired group not all ready, Away on one all ready, and nothing on the lines with no group", async () => {
    const el = await mount({ api: partyApi(), fireControl: "expo" });
    const [none, preparing, plated] = sections(el);
    expect(none!.querySelector(".lever")).toBeNull();
    const ready = preparing!.querySelector<HTMLElement>('[data-group-ready="g-2"]')!;
    expect(ready.textContent).toContain(t("expo.group_ready"));
    expect(ready.getAttribute("aria-label")).toBe(`${t("expo.group_ready")} ${groupName(2)}`);
    expect(preparing!.querySelector("[data-group-away]")).toBeNull();
    const away = plated!.querySelector<HTMLElement>('[data-group-away="g-3"]')!;
    expect(away.textContent).toContain(t("expo.away"));
    expect(plated!.querySelector("[data-group-ready]")).toBeNull();
  });

  it("under fire control expo, offers Fire on each held group", async () => {
    const el = await mount({ api: partyApi(), fireControl: "expo" });
    const fires = [...orderCard(el, 9)!.querySelectorAll<HTMLElement>("[data-group-fire]")];
    expect(fires.map((f) => f.dataset.groupFire)).toEqual(["g-4", "g-5"]);
    expect(fires[0]!.textContent).toContain(t("expo.fire"));
  });

  it.each(["waiter", "kitchen"] as const)(
    "under fire control %s, offers no Fire on a held group but keeps Ready and Away",
    async (fireControl) => {
      const el = await mount({ api: partyApi(), fireControl });
      expect(el.shadowRoot!.querySelector("[data-group-fire]")).toBeNull();
      expect(el.shadowRoot!.querySelector('[data-group-ready="g-2"]')).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-group-away="g-3"]')).not.toBeNull();
    },
  );

  it.each([
    ["Ready", "data-group-ready", "g-2", "bumpGroupReady"],
    ["Away", "data-group-away", "g-3", "markGroupAway"],
    ["Fire", "data-group-fire", "g-4", "fireGroup"],
  ] as const)(
    "%s calls the group verb with a fresh submission id per press and the card's revision, then reloads",
    async (_name, attribute, groupId, verb) => {
      const api = partyApi();
      const el = await mount({ api, fireControl: "expo" });
      el.shadowRoot!.querySelector<HTMLElement>(`[${attribute}="${groupId}"]`)!.click();
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>(`[${attribute}="${groupId}"]`)!.click();
      await flush(el);
      const calls = (api as unknown as Record<string, ReturnType<typeof vi.fn>>)[verb]!.mock.calls;
      expect(calls).toEqual([
        ["v-4", groupId, { submissionId: expect.any(String), expectedPartyRevision: 7 }],
        ["v-4", groupId, { submissionId: expect.any(String), expectedPartyRevision: 7 }],
      ]);
      expect(calls[0]![2].submissionId).not.toBe(calls[1]![2].submissionId);
      expect(api.getExpoQueue).toHaveBeenCalledTimes(3);
      expect(api.bumpCourseReady).not.toHaveBeenCalled();
      expect(api.markCourseAway).not.toHaveBeenCalled();
      expect(api.fireCourse).not.toHaveBeenCalled();
    },
  );

  it("on party.out_of_date it reloads and says the table changed, and never sends again on its own", async () => {
    const api = partyApi({
      markGroupAway: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const el = await mount({ api, fireControl: "expo" });
    expect(tableChanged(el)).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    await flush(el);
    expect(api.markGroupAway).toHaveBeenCalledOnce();
    expect(api.getExpoQueue).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)!.textContent).toContain(t("station.table_changed"));
    expect(tableChanged(el)!.getAttribute("role")).toBe("status");
  });

  it("the next press clears the notice, and another refusal does not raise it", async () => {
    const api = partyApi({
      bumpGroupReady: vi
        .fn()
        .mockRejectedValueOnce({ code: "party.out_of_date" })
        .mockRejectedValue({ code: "group.not_found" }),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-ready="g-2"]')!.click();
    await flush(el);
    expect(tableChanged(el)).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-ready="g-2"]')!.click();
    await flush(el);
    expect(tableChanged(el)).toBeNull();
    expect(api.getExpoQueue).toHaveBeenCalledTimes(3);
  });

  const staleNotice = (label: string) =>
    `${t("station.table_changed_named").replace("{table}", label)} ${t("station.table_changed")}`;

  it("names the table that changed, and never says where it changed", async () => {
    const api = partyApi({
      markGroupAway: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    const text = tableChanged(el)!.textContent!.replace(/\s+/g, " ").trim();
    expect(text).toBe(staleNotice("Mesa 4"));
    expect(text).not.toContain("till");
  });

  it("names a card with no table by its order number", async () => {
    const unlabelled: ExpoOrder = { ...partyOrder };
    delete unlabelled.tableLabel;
    const api = partyApi({
      markGroupAway: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    (api.getExpoQueue as ReturnType<typeof vi.fn>).mockResolvedValue([unlabelled]);
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    expect(tableChanged(el)!.textContent!.replace(/\s+/g, " ").trim()).toBe(staleNotice("#9"));
  });

  it("the next successful read after the one that showed it clears the notice", async () => {
    const api = partyApi({
      markGroupAway: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    (api.getExpoQueue as ReturnType<typeof vi.fn>).mockResolvedValue([
      threeCourseOrder,
      partyOrder,
    ]);
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    expect(tableChanged(el)).not.toBeNull();
    const counterAway = () => orderCard(el, 5)!.querySelector<HTMLElement>('[data-away="co-1"]')!;
    (api.getExpoQueue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError("offline"));
    counterAway().click();
    await flush(el);
    expect(tableChanged(el)).not.toBeNull();
    counterAway().click();
    await flush(el);
    expect(tableChanged(el)).toBeNull();
  });

  it("a counter order beside a party's keeps its course sections and course levers", async () => {
    const api = partyApi();
    (api.getExpoQueue as ReturnType<typeof vi.fn>).mockResolvedValue([
      threeCourseOrder,
      partyOrder,
    ]);
    const el = await mount({ api, fireControl: "expo" });
    const counter = orderCard(el, 5)!;
    expect(
      [...counter.querySelectorAll<HTMLElement>("[data-course]")].map((c) => c.dataset.course),
    ).toEqual(["none", "co-1", "co-2"]);
    expect(counter.querySelector("[data-group-section]")).toBeNull();
    counter.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    await flush(el);
    expect(api.markCourseAway).toHaveBeenCalledWith("wo-1", "co-1");
    expect(api.markGroupAway).not.toHaveBeenCalled();
  });

  it("a party's card with no group sections shows its header and nothing to act on", async () => {
    const bare: ExpoOrder = { ...partyOrder };
    delete bare.groups;
    const el = await mount({ api: stubApi([bare]), fireControl: "expo" });
    expect(orderCard(el, 9)!.textContent).toContain("Mesa 4");
    expect(orderCard(el, 9)!.querySelector(".lever")).toBeNull();
  });

  it("ages a party's card by its groups' items", async () => {
    const forgotten = {
      ...partyOrder,
      groups: [
        section("g-2", 2, "fired", [
          passItem("it-late", "Croquetas", { queuedAt: "2026-08-17T09:40:00.000Z" }),
        ]),
      ],
    };
    const el = await mount({
      api: stubApi([forgotten]),
      now: Date.parse(FIRED),
      reducedMotion: true,
    });
    expect(orderCard(el, 9)!.classList.contains("age-forgotten")).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-forgotten]")).not.toBeNull();
  });

  function devicePartyApi(overrides: Record<string, unknown> = {}) {
    const board: DevicePassScreen = {
      orders: [asPassOrder(partyOrder)],
      stations: [],
      zones: null,
    };
    return {
      board,
      api: partyApi({
        getDevicePassScreen: vi.fn().mockResolvedValue(board),
        fireDeviceGroup: vi.fn().mockResolvedValue({ revision: 8 }),
        bumpDeviceGroupReady: vi.fn().mockResolvedValue({ revision: 8 }),
        markDeviceGroupAway: vi.fn().mockResolvedValue({ revision: 8 }),
        ...overrides,
      }),
    };
  }

  it.each([
    ["Ready", "data-group-ready", "g-2", "bumpDeviceGroupReady", "bumpGroupReady"],
    ["Away", "data-group-away", "g-3", "markDeviceGroupAway", "markGroupAway"],
    ["Fire", "data-group-fire", "g-4", "fireDeviceGroup", "fireGroup"],
  ] as const)(
    "a kitchen display's %s goes through the device's group route",
    async (_name, attribute, groupId, verb, sessionVerb) => {
      const { api, board } = devicePartyApi();
      const el = await mount({
        api,
        deviceMode: true,
        fireControl: "expo",
        runsPass: true,
        initialDevicePass: board,
      });
      el.shadowRoot!.querySelector<HTMLElement>(`[${attribute}="${groupId}"]`)!.click();
      await flush(el);
      const stubs = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
      expect(stubs[verb]!).toHaveBeenCalledWith("v-4", groupId, {
        submissionId: expect.any(String),
        expectedPartyRevision: 7,
      });
      expect(stubs[sessionVerb]!).not.toHaveBeenCalled();
    },
  );

  it("shows a kitchen display's group lever refused kitchen_screen.zone_not_allowed as its sentence", async () => {
    const { api, board } = devicePartyApi({
      bumpDeviceGroupReady: vi.fn().mockRejectedValue({ code: "kitchen_screen.zone_not_allowed" }),
    });
    const el = await mount({ api, deviceMode: true, runsPass: true, initialDevicePass: board });
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-ready="g-2"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
      `#9 Mesa 4: ${codeMessage("kitchen_screen.zone_not_allowed")}`,
    );
  });

  it("offers a kitchen display no group lever without Run the pass", async () => {
    const { api, board } = devicePartyApi();
    const el = await mount({
      api,
      deviceMode: true,
      fireControl: "expo",
      runsPass: false,
      initialDevicePass: board,
    });
    expect(
      el.shadowRoot!.querySelector("[data-group-fire], [data-group-ready], [data-group-away]"),
    ).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-done="it-croq"]')).not.toBeNull();
  });
});

describe("cross-station extra references on pass", () => {
  it("renders both kinds and the extra's nutrition without duplicating its modifier", async () => {
    const first = {
      ...threeCourseOrder.courses[0]!.items[0]!,
      crossRefs: [
        {
          kind: "with" as const,
          name: "CHIPS",
          perDish: 2,
          stationName: "Fryer",
          addAllergens: { gluten: { presence: "contains" as const } },
          suitableFor: [],
        },
      ],
    };
    const second = {
      ...threeCourseOrder.courses[1]!.items[0]!,
      crossRefs: [{ kind: "for" as const, name: "BURG", stationName: "Grill" }],
    };
    const order = {
      ...threeCourseOrder,
      courses: [
        { ...threeCourseOrder.courses[0]!, items: [first] },
        { ...threeCourseOrder.courses[1]!, items: [second] },
      ],
    };
    const el = await mount({ api: stubApi([order]) });
    const refs = [...el.shadowRoot!.querySelectorAll("[data-crossref]")].map(
      (node) => node.textContent!,
    );
    expect(refs[0]).toContain("with CHIPS x2 from Fryer");
    expect(refs[0]).toContain(allergenName("gluten", currentLocale()));
    expect(refs[1]).toContain("for BURG at Grill");
    expect(el.shadowRoot!.textContent).not.toContain("+ CHIPS");
  });
  it("renders no-preparation wording in English and Spanish", async () => {
    const previousLocale = currentLocale();
    try {
      for (const [locale, expected] of [
        ["en-GB", "for AGUA, no preparation"],
        ["es-ES", "para AGUA, sin preparación"],
      ] as const) {
        setLocale(locale);
        const item = {
          ...threeCourseOrder.courses[0]!.items[0]!,
          crossRefs: [{ kind: "for" as const, name: "AGUA", stationName: null }],
        };
        const order = {
          ...threeCourseOrder,
          courses: [{ ...threeCourseOrder.courses[0]!, items: [item] }],
        };
        const el = await mount({ api: stubApi([order]) });
        expect(el.shadowRoot!.querySelector("[data-crossref]")!.textContent).toContain(expected);
      }
    } finally {
      setLocale(previousLocale);
    }
  });
  it("omits references when none exist", async () => {
    const el = await mount({ api: stubApi([threeCourseOrder]) });
    expect(el.shadowRoot!.querySelector(".crossref")).toBeNull();
  });
});

describe("Spanish split extra wording on pass", () => {
  it("names the split extra and its station", async () => {
    const previousLocale = currentLocale();
    setLocale("es-ES");
    try {
      const item = {
        ...threeCourseOrder.courses[0]!.items[0]!,
        crossRefs: [{ kind: "with" as const, name: "CHIPS", perDish: 2, stationName: "Fryer" }],
      };
      const order = {
        ...threeCourseOrder,
        courses: [{ ...threeCourseOrder.courses[0]!, items: [item] }],
      };
      const el = await mount({ api: stubApi([order]) });
      expect(el.shadowRoot!.querySelector("[data-crossref]")!.textContent).toContain(
        "con CHIPS x2 de Fryer",
      );
    } finally {
      setLocale(previousLocale);
    }
  });
});

describe("till-expo-screen — a pass monitor", () => {
  const partyOrder: ExpoOrder = {
    orderId: "wo-p",
    orderNumber: 9,
    tableLabel: "Mesa 7",
    openedMinutes: 20,
    worstBand: "fresh",
    party: { id: "v-7", revision: 3 },
    courses: [],
    groups: [
      {
        groupId: "g-2",
        position: 2,
        state: "fired",
        fired: true,
        away: false,
        items: [{ ...threeCourseOrder.courses[1]!.items[0]!, id: "it-croq" }],
      },
      {
        groupId: "g-4",
        position: 4,
        state: "held",
        fired: false,
        away: false,
        items: [{ ...threeCourseOrder.courses[2]!.items[0]!, id: "it-steak" }],
      },
    ],
  };

  const monitorBoard = (
    slots: Partial<Pick<DevicePassMonitor, "stations" | "zones">> = {},
    orders: ExpoOrder[] = [threeCourseOrder, partyOrder],
  ): DevicePassMonitor => ({
    orders,
    stations: slots.stations ?? [],
    zones: slots.zones ?? null,
  });

  function monitorApi(board: DevicePassMonitor = monitorBoard()) {
    return stubApi([], { getDevicePassMonitor: vi.fn().mockResolvedValue(board) });
  }

  const mountMonitor = (api: TillApi, board?: DevicePassMonitor) =>
    mount({
      api,
      deviceMode: true,
      monitor: true,
      deviceName: "Pared del pase",
      fireControl: "expo",
      runsPass: true,
      initialDevicePassMonitor: board,
    });

  /** Every element in the screen's shadow root and in each shadow root below it. */
  function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
    const found = [...root.querySelectorAll(selector)];
    for (const node of root.querySelectorAll("*"))
      if (node.shadowRoot) found.push(...deepQueryAll(node.shadowRoot, selector));
    return found;
  }

  it("lists the monitor read's orders under the device's name, read from the pass monitor route", async () => {
    const api = monitorApi();
    const el = await mountMonitor(api);
    expect(api.getDevicePassMonitor).toHaveBeenCalledTimes(1);
    expect(orderCard(el, 5)).not.toBeNull();
    expect(orderCard(el, 9)).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Solomillo");
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Pared del pase");
    expect(api.getExpoQueue).not.toHaveBeenCalled();
    expect(api.getDevicePassScreen).not.toHaveBeenCalled();
    expect(api.getDeviceIdentity).not.toHaveBeenCalled();
  });

  it("draws the board it was handed without reading it again", async () => {
    const api = monitorApi();
    const el = await mountMonitor(api, monitorBoard());
    expect(api.getDevicePassMonitor).not.toHaveBeenCalled();
    expect(orderCard(el, 5)).not.toBeNull();
  });

  it("contains no button of any kind, even with Run the pass and fire control at the pass", async () => {
    const el = await mountMonitor(monitorApi(), monitorBoard());
    expect(orderCard(el, 9)).not.toBeNull();
    expect(deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']")).toEqual([]);
  });

  it("contains no button with a stale read and an overdue order", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = monitorApi();
      vi.mocked(api.getDevicePassMonitor).mockRejectedValue(new Error("offline"));
      const el = await mount({
        api,
        monitor: true,
        deviceMode: true,
        runsPass: true,
        fireControl: "expo",
        now: Date.parse(FIRED) + 60 * 60_000,
        initialDevicePassMonitor: monitorBoard(),
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector(".overdue-count")).not.toBeNull();
      expect(deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a narrowed station's and zone's no longer available lines above its board", async () => {
    const el = await mountMonitor(
      monitorApi(),
      monitorBoard({
        stations: [
          { id: "st-1", name: "Parrilla", available: true },
          { id: "st-2", name: "Freidora", available: false },
        ],
        zones: [
          { id: "z-1", name: "Terraza", available: false },
          { id: "z-2", name: "Sala", available: true },
        ],
      }),
    );
    const lines = [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
      line.textContent!.trim(),
    );
    expect(lines).toEqual([
      t("station.unavailable").replace("{name}", "Freidora"),
      t("zone.unavailable").replace("{name}", "Terraza"),
    ]);
    expect(orderCard(el, 5)).not.toBeNull();
  });

  it("refreshes every fifteen seconds and labels a failed read stale", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = monitorApi(monitorBoard({}, [threeCourseOrder]));
      const el = await mountMonitor(api, monitorBoard({}, []));
      expect(el.shadowRoot!.textContent).not.toContain("Pan");
      expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDevicePassMonitor).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.textContent).toContain("Pan");
      vi.mocked(api.getDevicePassMonitor).mockRejectedValueOnce(new Error("offline"));
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDevicePassMonitor).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("[data-stale] till-stale-since")).not.toBeNull();
      expect(el.shadowRoot!.textContent).toContain("Pan");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws a stale read's line as the station screen draws its own", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = monitorApi();
      vi.mocked(api.getDevicePassMonitor).mockRejectedValue(new Error("offline"));
      const el = await mountMonitor(api, monitorBoard());
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
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              queue: [],
              notices: [],
              printersDown: [],
            },
          ],
        },
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops refreshing once taken off the page", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = monitorApi();
      const el = await mountMonitor(api, monitorBoard());
      el.remove();
      await vi.advanceTimersByTimeAsync(45_000);
      expect(api.getDevicePassMonitor).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a read that answers after the monitor left the page", async () => {
    let answer!: (board: DevicePassMonitor) => void;
    const api = stubApi([], {
      getDevicePassMonitor: vi.fn(
        () =>
          new Promise<DevicePassMonitor>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    const el = await mountMonitor(api);
    expect(api.getDevicePassMonitor).toHaveBeenCalledTimes(1);
    el.remove();
    answer(monitorBoard());
    await flush(el);
    expect(orderCard(el, 5)).toBeNull();
  });

  it("ignores a failed read that answers after the monitor left the page", async () => {
    let refuse!: (error: unknown) => void;
    const api = stubApi([], {
      getDevicePassMonitor: vi.fn(
        () =>
          new Promise<DevicePassMonitor>((_resolve, reject) => {
            refuse = reject;
          }),
      ),
    });
    const el = await mountMonitor(api);
    el.remove();
    refuse(new Error("offline"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-stale]")).toBeNull();
  });

  it("says the pass is empty when the read has no orders", async () => {
    const el = await mountMonitor(monitorApi(), monitorBoard({}, []));
    expect(el.shadowRoot!.querySelector(".empty")!.textContent!.trim()).toBe(t("expo.empty"));
  });
});

describe("till-expo-screen — a till whose device chose a pass monitor", () => {
  function tillMonitorApi(
    orders: ExpoOrder[],
    screen: Partial<Pick<ResolvedKitchenScreen, "available" | "stations" | "zones">> = {},
  ) {
    const { available = true, stations = [], zones = null } = screen;
    return stubApi(orders, {
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue(identity([{ kind: "pass_monitor", available, stations, zones }])),
      getDevicePassMonitor: vi.fn().mockResolvedValue({ orders, stations, zones }),
    });
  }

  /** Every element in the screen's shadow root and below it, leaving out the till's own Back. */
  function deepQueryAll(root: ShadowRoot | Element, selector: string): Element[] {
    const found = [...root.querySelectorAll(selector)].filter(
      (node) => !node.matches("[data-back]"),
    );
    for (const node of root.querySelectorAll("*"))
      if (node.shadowRoot && !node.matches("[data-back]"))
        found.push(...deepQueryAll(node.shadowRoot, selector));
    return found;
  }

  const unavailableLines = (el: TillExpoScreen) =>
    [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
      line.textContent!.trim(),
    );

  it("reads the pass monitor route and draws the board with no button, even with Run the pass", async () => {
    const api = tillMonitorApi([threeCourseOrder, firedNotReadyOrder]);
    const el = await mount({ api, fireControl: "expo", runsPass: true });
    expect(api.getDevicePassMonitor).toHaveBeenCalled();
    expect(api.getExpoQueue).not.toHaveBeenCalled();
    expect(api.getDevicePassScreen).not.toHaveBeenCalled();
    expect(orderCard(el, threeCourseOrder.orderNumber)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-back]")).not.toBeNull();
    expect(deepQueryAll(el.shadowRoot!, "button, wt-button, [role='button']")).toEqual([]);
  });

  it("shows a narrowed station's and zone's no longer available lines above its board", async () => {
    const api = tillMonitorApi([threeCourseOrder], {
      stations: [
        { id: "st-grill", name: "Parrilla", available: true },
        { id: "st-fryer", name: "Freidora", available: false },
      ],
      zones: [
        { id: "z-room", name: "Sala", available: true },
        { id: "z-terrace", name: "Terraza", available: false },
      ],
    });
    const el = await mount({ api });
    expect(unavailableLines(el)).toEqual([
      t("station.unavailable").replace("{name}", "Freidora"),
      t("zone.unavailable").replace("{name}", "Terraza"),
    ]);
    expect(orderCard(el, threeCourseOrder.orderNumber)).not.toBeNull();
  });

  it("shows only its lines and no board when a narrowing left it no station", async () => {
    const api = tillMonitorApi([], {
      stations: [{ id: "st-fryer", name: "Freidora", available: false }],
    });
    const el = await mount({ api });
    expect(unavailableLines(el)).toEqual([t("station.unavailable").replace("{name}", "Freidora")]);
    expect(el.shadowRoot!.querySelector("[data-order], .empty, .board, .stale")).toBeNull();
  });

  it.each([
    ["en-GB", "This screen is no longer available: Pass monitor"],
    ["es-ES", "Esta pantalla ya no está disponible: Monitor de pase"],
  ])("shows only its line when a narrowing took the monitor itself (%s)", async (locale, line) => {
    const previousLocale = currentLocale();
    setLocale(locale);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = tillMonitorApi([threeCourseOrder], { available: false });
      const el = await mount({ api });
      expect(unavailableLines(el)).toEqual([line]);
      expect(el.shadowRoot!.querySelector("[data-order], .empty")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDevicePassMonitor).not.toHaveBeenCalled();
      expect(api.getExpoQueue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      setLocale(previousLocale);
    }
  });

  it("a till with a pass choice still draws Done and its levers", async () => {
    const el = await mount({ api: passApi([threeCourseOrder]), fireControl: "expo" });
    expect(el.shadowRoot!.querySelector('[data-done="ti-0"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).not.toBeNull();
  });
});
