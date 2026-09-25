import { afterEach, describe, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-expo-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoOrder, TillApi } from "../api/client.js";

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
  it("has no violations on a populated pass board (all three levers, both age extremes)", async () => {
    const { el, host } = await mountWidget<TillExpoScreen>(
      "till-expo-screen",
      { api: stubApi(), fireControl: "expo" },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
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
