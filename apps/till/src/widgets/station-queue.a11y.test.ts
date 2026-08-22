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
    items: [
      {
        id: "ti-1",
        workingOrderLineId: "wol-1",
        state: "queued",
        descriptions: { "es-ES": "Paella" },
        quantity: "2.000",
      },
      {
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        descriptions: { "es-ES": "Agua" },
        quantity: "1.000",
      },
      {
        id: "ti-3",
        workingOrderLineId: "wol-3",
        state: "ready",
        descriptions: { "es-ES": "Café" },
        quantity: "3.000",
      },
    ],
  },
  {
    orderId: "wo-2",
    orderNumber: 6,
    label: null,
    queuedAt: "2026-08-17T10:05:00.000Z",
    items: [
      {
        id: "ti-4",
        workingOrderLineId: "wol-4",
        state: "queued",
        descriptions: { "es-ES": "Vino" },
        quantity: "1.000",
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
});
