import { afterEach, describe, it } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./station-queue.js";
import type { TillStationQueue } from "./station-queue.js";
import type { StationQueueGroup } from "../api/client.js";

// The shipped DB defaults. No fixture injects `now`, so every ticket ages off the REAL wall clock
// against its fixed `queuedAt` and renders `forgotten`, and the header's overdue-count badge appears
// too; the sweep below covers exactly that state.
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
        name: "Paella",
        quantity: "2.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        name: "Agua",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "ti-3",
        workingOrderLineId: "wol-3",
        state: "ready",
        name: "Café",
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
        name: "Vino",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:05:00.000Z",
      },
    ],
  },
];

// A coursed order for the course-grouping / held-greying / kitchen-fire a11y sweep: a fired
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
        name: "Pan",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "it-start",
        workingOrderLineId: "wl-start",
        state: "queued",
        name: "Ensalada",
        quantity: "1.000",
        course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
        firedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "it-main",
        workingOrderLineId: "wl-main",
        state: "queued",
        name: "Solomillo",
        quantity: "1.000",
        // HELD — greyed + non-advanceable, and the kitchen-fire target below.
        course: { id: "co-main", name: "Principales", displayOrder: 2 },
        firedAt: null,
      },
    ],
  },
];

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
        name: "Cortado",
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
        name: "Chuletón",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        note: "sin sal",
      },
    ],
  },
];

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
        name: "Hamburguesa",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
      },
      {
        id: "ti-al-pending",
        workingOrderLineId: "wol-al-pending",
        state: "queued",
        name: "Especial",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServed: { allergens: {}, pending: true },
      },
    ],
  },
];

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
        name: "Ensalada",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServedDiet: { vegan: "yes", vegetarian: "yes", contains: [], halal: "yes" },
      },
      {
        id: "ti-di-m",
        workingOrderLineId: "wol-di-m",
        state: "queued",
        name: "Chuleta",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        asServedDiet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
      },
      {
        id: "ti-di-p",
        workingOrderLineId: "wol-di-p",
        state: "queued",
        name: "Especial",
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

  it("a dish with a per-line note (indented sub-text) has no violations", async () => {
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups: customisationGroups, stationId: "st-1", view: "rail" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the as-served allergen rail (contains chips, pending note) has no violations", async () => {
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
    const { host } = await mountWidget<TillStationQueue>(
      "till-station-queue",
      { groups, stationId: "st-1", view: "rail", showReprint: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
