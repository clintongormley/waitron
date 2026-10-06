import { afterEach, describe, expect, it, vi } from "vitest";
import { setContentLanguages } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { allergenName } from "../i18n/allergen-names.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoGroup, ExpoItem, ExpoOrder, TillApi, WatcherBoard } from "../api/client.js";

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

const deviceBoard = (active: boolean): WatcherBoard => ({
  watcher: { id: "pass", name: "Pass", runsPass: true, active },
  orders: [
    {
      ...threeCourseOrder,
      courses: threeCourseOrder.courses.map((course) => ({
        ...course,
        allReady: course.items.every((item) => item.state === "ready"),
      })),
      groups: [],
    },
  ],
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
    listWatchers: vi.fn().mockResolvedValue([]),
    getWatcherQueue: vi.fn().mockResolvedValue({
      watcher: { id: "pass", name: "Pass", runsPass: true, active: true },
      orders: queue,
    }),
    markWatcherDone: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
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
  initialDeviceWatcher?: WatcherBoard;
}): Promise<TillExpoScreen> {
  const { el } = await mountWidget<TillExpoScreen>("till-expo-screen", {
    api: stubApi([]),
    ...props,
  });
  await flush(el);
  return el;
}

const orderCard = (el: TillExpoScreen, orderNumber: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-order="${orderNumber}"]`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(cleanupWidgets);

describe("till-expo-screen", () => {
  it("keeps an unattended watcher on its bound board with Done as its only action", async () => {
    const api = stubApi([threeCourseOrder], {
      getDeviceWatcher: vi.fn().mockResolvedValue(deviceBoard(true)),
      markDeviceWatcherDone: vi.fn().mockResolvedValue(undefined),
    });
    const el = await mount({
      api,
      deviceMode: true,
      fireControl: "expo",
      initialDeviceWatcher: deviceBoard(true),
    });
    expect(el.shadowRoot!.textContent).toContain("Pan");
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe("Pass");
    expect(api.getDeviceWatcher).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector(
        "[data-back], [data-change], [data-watcher], [data-reprint], .lever",
      ),
    ).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markDeviceWatcherDone).toHaveBeenCalledWith(["ti-0"], true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markDeviceWatcherDone).toHaveBeenCalledWith(["ti-0"], false);
    expect(api.getWatcherQueue).not.toHaveBeenCalled();
  });

  it("refreshes and offers Undo after Done on an embedded watcher device card", async () => {
    const api = stubApi([], {
      getDeviceWatcher: vi.fn().mockResolvedValue(deviceBoard(true)),
      markDeviceWatcherDone: vi.fn().mockResolvedValue(undefined),
    });
    const el = await mount({
      api,
      embedded: true,
      deviceMode: true,
      initialDeviceWatcher: deviceBoard(true),
    });

    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markDeviceWatcherDone).toHaveBeenCalledWith(["ti-0"], true);
    expect(api.getDeviceWatcher).toHaveBeenCalledTimes(1);
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markDeviceWatcherDone).toHaveBeenCalledWith(["ti-0"], false);
    expect(api.getDeviceWatcher).toHaveBeenCalledTimes(2);
    expect(api.getExpoQueue).not.toHaveBeenCalled();
  });

  it.each([
    [
      "en-GB",
      "This screen's watcher was disabled. A manager can enable it again in Prep stations → Watchers, or set this screen up again.",
    ],
    [
      "es-ES",
      "Se ha deshabilitado el punto de seguimiento de esta pantalla. Un encargado puede volver a habilitarlo en Estaciones de preparación → Puntos de seguimiento, o volver a configurar esta pantalla.",
    ],
  ])(
    "shows only the disabled notice for an unattended watcher that was disabled (%s)",
    async (locale, notice) => {
      const previousLocale = currentLocale();
      setLocale(locale);
      try {
        const el = await mount({
          api: stubApi(),
          deviceMode: true,
          initialDeviceWatcher: deviceBoard(false),
        });
        expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(notice);
        expect(
          el.shadowRoot!.querySelector("[data-order], [data-done], [data-all-done]"),
        ).toBeNull();
      } finally {
        setLocale(previousLocale);
      }
    },
  );

  it("says a chosen watcher the server no longer has was deleted, not disabled", async () => {
    const previousLocale = currentLocale();
    setLocale("en-GB");
    try {
      const api = stubApi([threeCourseOrder], {
        listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: false }]),
        getWatcherQueue: vi.fn().mockRejectedValue({ code: "watcher.not_found" }),
      });
      const el = await mount({ api });
      el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
      await flush(el);
      expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
        "This screen's watcher was deleted. Ask a manager to set this screen up again.",
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("sends All done through the bound device route", async () => {
    const api = stubApi([], {
      getDeviceWatcher: vi.fn().mockResolvedValue(deviceBoard(true)),
      markDeviceWatcherDone: vi.fn().mockResolvedValue(undefined),
    });
    const el = await mount({ api, deviceMode: true, initialDeviceWatcher: deviceBoard(true) });
    el.shadowRoot!.querySelector<HTMLElement>('[data-all-done="wo-1"]')!.click();
    await flush(el);
    expect(api.markDeviceWatcherDone).toHaveBeenCalledWith(["ti-0", "ti-1", "ti-2"], true);
  });

  it("refreshes the bound device watcher every fifteen seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([], { getDeviceWatcher: vi.fn().mockResolvedValue(deviceBoard(true)) });
      const el = await mount({
        api,
        deviceMode: true,
        initialDeviceWatcher: { ...deviceBoard(true), orders: [] },
      });
      expect(el.shadowRoot!.textContent).not.toContain("Pan");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDeviceWatcher).toHaveBeenCalledTimes(1);
      expect(el.shadowRoot!.textContent).toContain("Pan");
      expect(api.getWatcherQueue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the embedded card on All stations without requesting watchers", async () => {
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: true }]),
    });
    const el = await mount({ api, embedded: true });
    expect(el.shadowRoot!.textContent).toContain("Pan");
    expect(api.getExpoQueue).toHaveBeenCalled();
    expect(api.listWatchers).not.toHaveBeenCalled();
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
      expect(api.listWatchers).not.toHaveBeenCalled();
      expect(el.shadowRoot!.textContent).toContain("Pan");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not paint a former watcher's pending read on the selected watcher", async () => {
    const pending = deferred<Awaited<ReturnType<TillApi["getWatcherQueue"]>>>();
    const runnerPending = deferred<Awaited<ReturnType<TillApi["getWatcherQueue"]>>>();
    const runnerOrder = {
      ...firedNotReadyOrder,
      courses: firedNotReadyOrder.courses.map((course) => ({ ...course, allReady: false })),
      groups: [],
    };
    const api = stubApi([], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      getWatcherQueue: vi.fn((id: string) =>
        id === "pass" ? pending.promise : runnerPending.promise,
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    pending.resolve({
      watcher: { id: "pass", name: "Pass", runsPass: true, active: true },
      orders: [
        {
          ...threeCourseOrder,
          courses: threeCourseOrder.courses.map((course) => ({ ...course, allReady: false })),
          groups: [],
        },
      ],
    });
    await flush(el);
    expect(orderCard(el, 5)).toBeNull();
    runnerPending.resolve({
      watcher: { id: "runner", name: "Runner", runsPass: false, active: true },
      orders: [runnerOrder],
    });
    await flush(el);
    expect(orderCard(el, 6)).not.toBeNull();
  });

  it("finishes a pending Done on its original watcher without showing Undo on the new board", async () => {
    const pending = deferred<void>();
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: false },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      markWatcherDone: vi.fn().mockImplementation(() => pending.promise),
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: false, active: true },
          orders: id === "pass" ? [threeCourseOrder] : [firedNotReadyOrder],
        }),
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    pending.resolve();
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-0"], true);
    expect(orderCard(el, 6)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-undo]")).toBeNull();
  });

  it("finishes a pending Undo on its original watcher after switching boards", async () => {
    const pending = deferred<void>();
    const mark = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => pending.promise);
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: false },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      markWatcherDone: mark,
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: false, active: true },
          orders: id === "pass" ? [threeCourseOrder] : [firedNotReadyOrder],
        }),
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    const reads = vi.mocked(api.getWatcherQueue).mock.calls.length;
    pending.resolve();
    await flush(el);
    expect(mark).toHaveBeenLastCalledWith("pass", ["ti-0"], false);
    expect(orderCard(el, 6)).not.toBeNull();
    expect(api.getWatcherQueue).toHaveBeenCalledTimes(reads);
  });

  it("does not show a former watcher's reprint error on the selected board", async () => {
    const pending = deferred<void>();
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: false },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      reprintOrder: vi.fn().mockImplementation(() => pending.promise),
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: false, active: true },
          orders: id === "pass" ? [threeCourseOrder] : [firedNotReadyOrder],
        }),
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    pending.reject({ code: "server.internal" });
    await flush(el);
    expect(orderCard(el, 6)).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("marks Away items Done for their original watcher after switching boards", async () => {
    const pending = deferred<void>();
    const passOrder = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[1]!, allReady: true }],
      groups: [],
    };
    const api = stubApi([passOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      markCourseAway: vi.fn().mockImplementation(() => pending.promise),
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: id === "pass", active: true },
          orders: id === "pass" ? [passOrder] : [firedNotReadyOrder],
        }),
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-away="co-1"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    const reads = vi.mocked(api.getWatcherQueue).mock.calls.length;
    pending.resolve();
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-1"], true);
    expect(orderCard(el, 6)).not.toBeNull();
    expect(api.getWatcherQueue).toHaveBeenCalledTimes(reads);
  });

  it("marks group Away items Done for their original watcher after switching boards", async () => {
    const pending = deferred<{ revision: number }>();
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
    const api = stubApi([passOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      markGroupAway: vi.fn().mockImplementation(() => pending.promise),
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: id === "pass", active: true },
          orders: id === "pass" ? [passOrder] : [firedNotReadyOrder],
        }),
      ),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    const reads = vi.mocked(api.getWatcherQueue).mock.calls.length;
    pending.resolve({ revision: 4 });
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-1"], true);
    expect(orderCard(el, 6)).not.toBeNull();
    expect(api.getWatcherQueue).toHaveBeenCalledTimes(reads);
  });

  it("offers watchers and marks a dish Done with Undo on its board", async () => {
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Terrace runner", runsPass: false },
      ]),
    });
    const el = await mount({ api });
    expect(el.shadowRoot!.textContent).toContain("What should this screen show?");
    expect(el.shadowRoot!.textContent).toContain("Terrace runner");
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    expect(api.getWatcherQueue).toHaveBeenCalledWith("pass", expect.anything());
    expect(el.shadowRoot!.textContent).toContain("Pan");
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-0"], true);
    expect(el.shadowRoot!.textContent).toContain("marked done");
    el.shadowRoot!.querySelector<HTMLElement>("[data-undo]")!.click();
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-0"], false);
  });

  it("does not offer the previous watcher's Undo after changing boards", async () => {
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-undo]")).toBeNull();
  });

  it("removes Undo ten seconds after a Done", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder], {
        listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: false }]),
      });
      const el = await mount({ api });
      el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
      await flush(el);
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

  it("keeps sent-out dishes visible without lateness on a watcher", async () => {
    const old = { ...threeCourseOrder.courses[0]!.items[0]!, awayAt: FIRED, queuedAt: FIRED };
    const fresh = {
      ...threeCourseOrder.courses[1]!.items[0]!,
      queuedAt: "2026-08-17T11:00:00.000Z",
    };
    const order = {
      ...threeCourseOrder,
      courses: [{ ...threeCourseOrder.courses[0]!, away: false, items: [old, fresh] }],
    };
    const api = stubApi([order], {
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: true }]),
    });
    const el = await mount({ api, now: Date.parse("2026-08-17T11:01:00.000Z") });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-item="ti-0"]')!.textContent).toContain("Sent out");
    expect(el.shadowRoot!.querySelector('[data-item="ti-0"] [data-forgotten]')).toBeNull();
    expect(orderCard(el, 5)!.classList.contains("age-forgotten")).toBe(false);
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("keeps an away section on a watcher board but offers no lever", async () => {
    const api = stubApi([withAwayCourse], {
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: true }]),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-item="ti-4"]')!.textContent).toContain("Sent out");
    expect(el.shadowRoot!.querySelector('[data-course="co-4"] .lever')).toBeNull();
  });

  it("uses the watcher's runsPass switch and server allReady for whole-course levers", async () => {
    const held = { ...threeCourseOrder.courses[2]!, allReady: false };
    const ready = {
      ...threeCourseOrder.courses[1]!,
      allReady: true,
      items: [{ ...threeCourseOrder.courses[1]!.items[0]!, state: "preparing" as const }],
    };
    const order = { ...threeCourseOrder, courses: [held, ready] };
    const api = stubApi([order], {
      listWatchers: vi.fn().mockResolvedValue([
        { id: "pass", name: "Pass", runsPass: true },
        { id: "runner", name: "Runner", runsPass: false },
      ]),
      getWatcherQueue: vi.fn((id: string) =>
        Promise.resolve({
          watcher: { id, name: id, runsPass: id === "pass", active: true },
          orders: [order],
        }),
      ),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="runner"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector(".lever")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-change]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-1"]')).not.toBeNull();
    el.fireControl = "kitchen";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-away="co-1"]')).not.toBeNull();
  });

  it("updates pass levers when a refreshed board changes its runsPass switch", async () => {
    const order = {
      ...threeCourseOrder,
      groups: [],
      courses: [{ ...threeCourseOrder.courses[2]!, allReady: false }],
    };
    const api = stubApi([order], {
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: true }]),
    });
    const el = await mount({ api, fireControl: "expo" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).not.toBeNull();
    vi.mocked(api.getWatcherQueue).mockResolvedValueOnce({
      watcher: { id: "pass", name: "Pass", runsPass: false, active: true },
      orders: [order],
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-2"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-fire="co-2"]')).toBeNull();
  });

  it("sends every shown dish on All done and reports a refused Done", async () => {
    const api = stubApi([threeCourseOrder], {
      listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: false }]),
    });
    const el = await mount({ api });
    el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-all-done="wo-1"]')!.click();
    await flush(el);
    expect(api.markWatcherDone).toHaveBeenCalledWith("pass", ["ti-0", "ti-1", "ti-2"], true);
    vi.mocked(api.markWatcherDone).mockRejectedValueOnce({ code: "watcher.not_found" });
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
      "That watcher no longer exists",
    );
  });

  it("refreshes the selected watcher after fifteen seconds and labels a failed read stale", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder], {
        listWatchers: vi.fn().mockResolvedValue([{ id: "pass", name: "Pass", runsPass: false }]),
      });
      const el = await mount({ api });
      el.shadowRoot!.querySelector<HTMLElement>('[data-watcher="pass"]')!.click();
      await flush(el);
      vi.mocked(api.getWatcherQueue).mockRejectedValueOnce(new Error("offline"));
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getWatcherQueue).toHaveBeenCalledTimes(2);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps All stations on an empty watcher list and refreshes it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi([threeCourseOrder]);
      const el = await mount({ api });
      expect(el.shadowRoot!.textContent).toContain("Pan");
      expect(el.shadowRoot!.textContent).not.toContain("What should this screen show?");
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
