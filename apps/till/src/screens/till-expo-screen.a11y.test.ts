import { afterEach, describe, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-expo-screen.js";
import type { TillExpoScreen } from "./till-expo-screen.js";
import type { ExpoOrder, TillApi } from "../api/client.js";

const FIRED = "2026-08-17T10:00:00.000Z";

// The station's KDS order-timing thresholds (design §4/§6) — the shipped DB defaults. No fixture
// injects `now`, so every item ages off the REAL wall clock against its fixed `queuedAt` (`FIRED`,
// which predates "now" by far more than 15 minutes) — every card renders `age-forgotten` (flashing,
// unless the test browser's `prefers-reduced-motion` is on) with its forgotten item flagged, and the
// pass-wide overdue-count badge appears too; the sweep below covers exactly that state (the same
// deliberate choice `station-queue.a11y.test.ts` documents for its own fixtures).
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// A single mount that exercises every visual branch axe should sweep: a labelled + an unlabelled order
// card, the null course + two named courses, a HELD item (greyed), the forgotten age accent + item
// flag + pass-wide count badge, and — under `fire_control = 'expo'` — each of the three per-course
// levers (Fire on the held course, Curso listo on the fired-not-ready course, En camino on the
// all-ready course), plus a fully-away course that must be absent.
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
            name: { "es-ES": "Pan" },
            qty: "1.000",
            stationName: "Barra",
            state: "ready",
            firedAt: FIRED,
            awayAt: null,
            // A dish with selected options (ordering modifiers, Task 14) — the indented "+ name" sub-text
            // is non-interactive plain text under the same item box, swept here for both themes.
            modifiers: [{ descriptions: { "es-ES": "Sin gluten" } }],
            // As-served allergens (modifier↔allergen, Task 9): a CONTAINS-milk chip and a struck
            // "NO GLUTEN" removal callout — their danger colour + strike-through swept for contrast here.
            asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
            removed: ["gluten"],
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
            name: { "es-ES": "Croquetas" },
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
            name: { "es-ES": "Solomillo" },
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
            name: { "es-ES": "Flan" },
            qty: "1.000",
            stationName: "Cocina",
            state: "preparing", // fired, not-all-ready → the Curso listo lever
            firedAt: FIRED,
            awayAt: null,
            // Own allergens unreviewed (null base) ⇒ pending — the "not reviewed" warning, swept here.
            asServed: { allergens: {}, pending: true },
            removed: [],
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
    // The per-order Reprint wt-button (KDS-4) renders on every populated card — swept in both themes below.
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
