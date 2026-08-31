import { afterEach, describe, it } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./station-queue.js";
import type { TillStationQueue } from "./station-queue.js";
import type { StationQueueGroup } from "../api/client.js";

// The station's KDS order-timing thresholds (design §4/§6) — the shipped DB defaults, reused across
// every fixture below. No fixture injects `now`, so every ticket ages off the REAL wall clock against
// its fixed `queuedAt` — every one of these fixtures predates "now" by far more than 15 minutes, so
// each ticket renders `forgotten` (flashing, unless the test browser's `prefers-reduced-motion` is on)
// and the header's overdue-count badge appears too; the sweep below covers exactly that state.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// One order with a line in each of the three kitchen states + a second order, so axe sees the queued,
// preparing and (inert) ready cells plus a labelled and an unlabelled ticket in one mount.
const groups: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "placed", // awaiting the fiscal collect — no handover button
    thresholds: DEFAULT_THRESHOLDS,
    items: [
      {
        id: "ti-1",
        workingOrderLineId: "wol-1",
        state: "queued",
        descriptions: { "es-ES": "Paella" },
        quantity: "2.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        descriptions: { "es-ES": "Agua" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "ti-3",
        workingOrderLineId: "wol-3",
        state: "ready",
        descriptions: { "es-ES": "Café" },
        quantity: "3.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
    ],
  },
  {
    orderId: "wo-2",
    orderNumber: 6,
    label: null,
    queuedAt: "2026-08-17T10:05:00.000Z",
    status: "settled", // a Mode-P pickup — its rail card carries the collect button (a11y-checked here)
    thresholds: DEFAULT_THRESHOLDS,
    items: [
      {
        id: "ti-4",
        workingOrderLineId: "wol-4",
        state: "queued",
        descriptions: { "es-ES": "Vino" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:05:00.000Z",
      },
    ],
  },
];

// A coursed order (KDS-2 §5a) for the course-grouping / held-greying / kitchen-fire a11y sweep: a fired
// null course (no header), a fired named course, and a HELD later course (greyed lines + the fire button).
const coursedGroups: StationQueueGroup[] = [
  {
    orderId: "wo-c",
    orderNumber: 7,
    label: "Mesa 2",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    items: [
      {
        id: "it-bread",
        workingOrderLineId: "wl-bread",
        state: "preparing",
        descriptions: { "es-ES": "Pan" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "it-start",
        workingOrderLineId: "wl-start",
        state: "queued",
        descriptions: { "es-ES": "Ensalada" },
        quantity: "1.000",
        course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "it-main",
        workingOrderLineId: "wl-main",
        state: "queued",
        descriptions: { "es-ES": "Solomillo" },
        quantity: "1.000",
        // HELD — greyed + non-advanceable, and the kitchen-fire target below.
        course: { id: "co-main", name: "Principales", displayOrder: 2 },
        firedAt: null,
      },
    ],
  },
];

// A dish with two selected options (ordering modifiers, Task 14) — the indented "+ name" sub-text is
// non-interactive plain text under the same tappable line, so it must not introduce any new violation.
const modifierGroups: StationQueueGroup[] = [
  {
    orderId: "wo-mod",
    orderNumber: 9,
    label: null,
    queuedAt: "2026-08-17T10:00:00.000Z",
    thresholds: DEFAULT_THRESHOLDS,
    status: "placed",
    items: [
      {
        id: "ti-mod",
        workingOrderLineId: "wol-mod",
        state: "queued",
        descriptions: { "es-ES": "Cortado" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        modifiers: [
          { descriptions: { "es-ES": "Grande" } },
          { descriptions: { "es-ES": "Leche avena" } },
        ],
      },
    ],
  },
];

// A dish carrying the per-line customisation (order-line customisation, Task 5): a PROMINENT doneness
// label (bold text — the non-colour tell) and a muted free-text note, both indented sub-text under the
// same tappable line, so axe sweeps their contrast in both themes and confirms no new violation.
const customisationGroups: StationQueueGroup[] = [
  {
    orderId: "wo-cust",
    orderNumber: 12,
    label: null,
    queuedAt: "2026-08-17T10:00:00.000Z",
    thresholds: DEFAULT_THRESHOLDS,
    status: "placed",
    items: [
      {
        id: "ti-cust",
        workingOrderLineId: "wol-cust",
        state: "queued",
        descriptions: { "es-ES": "Chuletón" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        note: "sin sal",
        doneness: "medium_rare",
      },
    ],
  },
];

// A dish carrying an as-served allergen profile (modifier↔allergen, Task 9): a CONTAINS-milk chip, a
// struck localised "NO Cereals containing gluten" removal callout, and a second, PENDING item
// (unreviewed base ⇒ the "not reviewed" warning). The chip/callout/warning use a data-driven danger
// colour + strike-through/text weight, so axe sweeps their contrast in both themes here (colour is
// never the only signal — the sweep confirms the colour that IS there also passes).
const allergenGroups: StationQueueGroup[] = [
  {
    orderId: "wo-al",
    orderNumber: 11,
    label: null,
    queuedAt: "2026-08-17T10:00:00.000Z",
    thresholds: DEFAULT_THRESHOLDS,
    status: "placed",
    items: [
      {
        id: "ti-al",
        workingOrderLineId: "wol-al",
        state: "queued",
        descriptions: { "es-ES": "Hamburguesa" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
        removed: ["gluten"],
      },
      {
        id: "ti-al-pending",
        workingOrderLineId: "wol-al-pending",
        state: "queued",
        descriptions: { "es-ES": "Especial" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServed: { allergens: {}, pending: true },
        removed: [],
      },
    ],
  },
];

// A dish carrying an as-served DIET profile (dietary-classification, Task 7): a vegan+vegetarian
// success-toned badge pair, a contains-meat chip on a second item, and a PENDING item (the neutral
// "not reviewed" note). The badges/chips carry a data-driven colour plus a text label, so axe sweeps
// their contrast in both themes here (colour is never the only signal).
const dietGroups: StationQueueGroup[] = [
  {
    orderId: "wo-di",
    orderNumber: 21,
    label: null,
    queuedAt: "2026-08-17T10:00:00.000Z",
    thresholds: DEFAULT_THRESHOLDS,
    status: "placed",
    items: [
      {
        id: "ti-di-v",
        workingOrderLineId: "wol-di-v",
        state: "queued",
        descriptions: { "es-ES": "Ensalada" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [], halal: "yes" },
      },
      {
        id: "ti-di-m",
        workingOrderLineId: "wol-di-m",
        state: "queued",
        descriptions: { "es-ES": "Chuleta" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
      },
      {
        id: "ti-di-p",
        workingOrderLineId: "wol-di-p",
        state: "queued",
        descriptions: { "es-ES": "Especial" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServedDiet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
      },
    ],
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-station-queue a11y (%s theme)", (theme) => {
  it("an empty queue has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: [] },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the kanban board (bump controls across three columns) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups, stationId: "st-1", view: "kanban" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the ticket rail (age-coloured cards, per-line bump) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("whole-ticket bump mode has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups, stationId: "st-1", view: "rail", bumpMode: "ticket" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the course-grouped rail (headers, greyed held lines, kitchen-fire button) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: coursedGroups, stationId: "st-1", view: "rail", fireControl: "kitchen" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("a dish with selected options (ordering modifiers, indented sub-text) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: modifierGroups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("a dish with a per-line note + prominent doneness (indented sub-text) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: customisationGroups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the as-served allergen rail (contains chips, struck localised NO <allergen> removals, pending note) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: allergenGroups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the as-served diet rail (vegan/vegetarian/halal badges, contains-meat chip, not-reviewed note) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: dietGroups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the reprint rail (per-order Reprint wt-button on each card, KDS-4) has no violations", async () => {
    // showReprint on → a secondary reprint wt-button at every card foot (beside the settled order's
    // collect button), so axe sweeps the reprint control's colour pairing + accessible name in both themes.
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups, stationId: "st-1", view: "rail", showReprint: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
