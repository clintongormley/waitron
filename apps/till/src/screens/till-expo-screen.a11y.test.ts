import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-expo-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoGroup, ExpoItem, ExpoOrder, TillApi } from "../api/client.js";

const FIRED = "2026-08-17T10:00:00.000Z";

// No fixture injects `now`, so every item ages off the REAL wall clock against its fixed `queuedAt`,
// long past: every card renders `age-forgotten` with its item flagged, and the overdue-count badge shows.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// A single mount that exercises every visual branch axe should sweep, including — under
// `fire_control = 'expo'` — each of the three per-course levers.
const queue: ExpoOrder[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    tableLabel: "Mesa 4",
    openedMinutes: 3,
    worstBand: "fresh", // server's fetch-time value — the a11y sweep re-derives live off the real clock
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
            crossRefs: [
              {
                kind: "with",
                name: "CHIPS",
                perDish: 2,
                stationName: "Fryer",
                addAllergens: { gluten: { presence: "contains" } },
              },
            ],
            qty: "1.000",
            stationName: "Barra",
            state: "ready",
            firedAt: FIRED,
            awayAt: null,
            modifiers: [{ descriptions: { "es-ES": "Sin gluten" } }],
            asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
            asServedDiet: { vegan: "no", vegetarian: "yes", contains: [], halal: "yes" },
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
            crossRefs: [{ kind: "for", name: "BURG", stationName: "Grill" }],
            qty: "2.000",
            stationName: "Cocina",
            state: "ready", // all-ready → the En camino (away) lever
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
        fired: false, // held → the Fire lever + a greyed item
        away: false,
        items: [
          {
            id: "ti-2",
            name: "Solomillo",
            crossRefs: [{ kind: "for", name: "AGUA", stationName: null }],
            qty: "1.000",
            stationName: "Parrilla",
            state: "queued",
            firedAt: null,
            awayAt: null,
            // A contains-meat chip + the NEUTRAL "not reviewed" diet note, swept here (a held/greyed item).
            asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: ["meat"] },
            note: "poco hecho por dentro",
            queuedAt: FIRED,
            thresholds: DEFAULT_THRESHOLDS,
            band: "fresh",
          },
        ],
      },
    ],
  },
  {
    orderId: "wo-2",
    orderNumber: 6,
    openedMinutes: 12, // no table label (bare walk-up)
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
            state: "preparing", // fired, not-all-ready → the Curso listo lever
            firedAt: FIRED,
            awayAt: null,
            // Own allergens unreviewed (null base) ⇒ pending — the "not reviewed" warning, swept here.
            asServed: { allergens: {}, pending: true },
            queuedAt: FIRED,
            thresholds: DEFAULT_THRESHOLDS,
            band: "fresh",
          },
        ],
      },
    ],
  },
];

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
): ExpoGroup {
  return { groupId, position, state, fired: state !== "held", away: false, items };
}

// A seated party's bill: the lines with no group, a group to mark ready, one to send away, and a held
// one ("held, not released", with Fire under `expo`).
const partyOrder: ExpoOrder = {
  orderId: "wo-p",
  orderNumber: 9,
  tableLabel: "Mesa 7",
  openedMinutes: 20,
  worstBand: "fresh",
  party: { id: "v-7", revision: 3 },
  courses: [],
  groups: [
    section(null, null, null, [passItem("it-moved", "Pan", { state: "ready" })]),
    section("g-2", 2, "fired", [passItem("it-croq", "Croquetas", { state: "preparing" })]),
    section("g-3", 3, "fired", [passItem("it-salad", "Ensalada", { state: "ready" })]),
    section("g-4", 4, "held", [passItem("it-steak", "Solomillo", { firedAt: null })]),
  ],
};

function stubApi(): TillApi {
  return {
    getExpoQueue: vi.fn().mockResolvedValue(queue),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    bumpCourseReady: vi.fn().mockResolvedValue(undefined),
    markCourseAway: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
  } as unknown as TillApi;
}

async function flush(el: TillExpoScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-expo-screen a11y (%s theme)", (theme) => {
  it("has no violations on a kitchen display's pass screen with its lost lines, levers, a refusal and Undo notice", async () => {
    const board = {
      orders: queue.map((order) => ({
        ...order,
        courses: order.courses.map((course) => ({ ...course, allReady: true })),
        groups: [],
      })),
      stations: [
        { id: "st-1", name: "Parrilla", available: true },
        { id: "st-2", name: "Freidora", available: false },
      ],
      zones: [
        { id: "z-1", name: "Terraza", available: false },
        { id: "z-2", name: "Sala", available: true },
      ],
    };
    const api = {
      ...stubApi(),
      getDevicePassScreen: vi.fn().mockResolvedValue(board),
      markDevicePassDone: vi.fn().mockResolvedValue(undefined),
      fireDeviceCourse: vi.fn().mockRejectedValue({ code: "device.forbidden_action" }),
      bumpDeviceCourseReady: vi.fn().mockResolvedValue(undefined),
      markDeviceCourseAway: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      {
        api,
        deviceMode: true,
        deviceName: "Pantalla Pase",
        runsPass: true,
        fireControl: "expo",
        initialDevicePass: board,
      },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector(".lever")).not.toBeNull();
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>("[data-fire]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });
  it("has no violations on a till's pass screen with its lost lines, levers and Undo notice", async () => {
    const stations = [
      { id: "st-1", name: "Parrilla", available: true },
      { id: "st-2", name: "Freidora", available: false },
    ];
    const zones = [
      { id: "z-1", name: "Terraza", available: false },
      { id: "z-2", name: "Sala", available: true },
    ];
    const api = {
      ...stubApi(),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "dev-1",
        formFactor: "till",
        name: "Till 1",
        kitchenScreens: [{ kind: "pass", available: true, stations, zones }],
      }),
      getDevicePassScreen: vi.fn().mockResolvedValue({
        orders: queue.map((order) => ({
          ...order,
          courses: order.courses.map((course) => ({
            ...course,
            allReady: course.items.every((item) => item.state === "ready"),
          })),
          groups: [],
        })),
        stations,
        zones,
      }),
      markDevicePassDone: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      { api, fireControl: "expo", runsPass: true },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
    expect(el.shadowRoot!.querySelector(".lever")).not.toBeNull();
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>('[data-done="ti-0"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-undo]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations when a narrowing took a till's pass screen", async () => {
    const api = {
      ...stubApi(),
      getDeviceIdentity: vi.fn().mockResolvedValue({
        deviceId: "dev-1",
        formFactor: "till",
        name: "Till 1",
        kitchenScreens: [{ kind: "pass", available: false, stations: [], zones: null }],
      }),
      getDevicePassScreen: vi.fn().mockResolvedValue({ orders: [], stations: [], zones: null }),
    } as unknown as TillApi;
    const { el, host } = await mountWidget<TillExpoScreen>("till-expo-screen", { api }, theme);
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-unavailable]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a populated pass board (all three levers, both age extremes)", async () => {
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      { api: stubApi(), fireControl: "expo", runsPass: true },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on a party's groups with the table-changed notice", async () => {
    const api = {
      getExpoQueue: vi.fn().mockResolvedValue([partyOrder]),
      markGroupAway: vi.fn().mockRejectedValue({ code: "party.out_of_date" }),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      { api, fireControl: "expo", runsPass: true },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-group-away="g-3"]')!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-table-changed]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-group-held]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on a pass monitor with its lost lines, a party's groups and a stale read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const board = {
        orders: [...queue, partyOrder],
        stations: [
          { id: "st-1", name: "Parrilla", available: true },
          { id: "st-2", name: "Freidora", available: false },
        ],
        zones: [
          { id: "z-1", name: "Terraza", available: false },
          { id: "z-2", name: "Sala", available: true },
        ],
      };
      const api = {
        getDevicePassMonitor: vi.fn().mockRejectedValue(new Error("offline")),
      } as unknown as TillApi;
      const { el, host } = await mountWidget<TillExpoScreen>(
        "till-expo-screen",
        {
          api,
          deviceMode: true,
          monitor: true,
          deviceName: "Pared del pase",
          runsPass: true,
          fireControl: "expo",
          initialDevicePassMonitor: board,
        },
        theme,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("[data-unavailable]")).toHaveLength(2);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector('[data-order="9"]')).not.toBeNull();
      vi.useRealTimers();
      await expectNoA11yViolations(host);
    } finally {
      vi.useRealTimers();
    }
  });

  it("has no violations on an empty pass", async () => {
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      { api: { getExpoQueue: vi.fn().mockResolvedValue([]) } as unknown as TillApi },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
