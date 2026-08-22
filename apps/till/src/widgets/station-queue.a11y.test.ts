import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./station-queue.js";
import type { TillStationQueue } from "./station-queue.js";
import type { StationQueueGroup } from "../api/client.js";

// One order with a line in each of the three kitchen states + a second order, so axe sees the queued,
// preparing and (inert) ready cells plus a labelled and an unlabelled ticket in one mount.
const groups: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "placed", // awaiting the fiscal collect — no handover button
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
});
