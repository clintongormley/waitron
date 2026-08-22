import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-station-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";
import type { Station, StationQueueGroup, TillApi } from "../api/client.js";

const stations: Station[] = [
  { id: "st-1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "st-2", name: "Barra", displayOrder: 1, isDefault: false, active: true },
];

// One order with a line in each kitchen state + a second order carrying a HELD later course, so axe sees
// the queued/preparing/ready cells, the active + inactive picker tabs, the toggle and Back, both a
// labelled and an unlabelled ticket, a course header, a greyed (held) line and — under `fire_control =
// 'kitchen'` — the "Empezar curso" fire button, all in a single mount.
const groups: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "settled", // collectable — surfaces the rail card's collect button for the a11y sweep
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
    status: "placed",
    items: [
      {
        id: "ti-4",
        workingOrderLineId: "wol-4",
        state: "queued",
        descriptions: { "es-ES": "Vino" },
        quantity: "1.000",
        // A HELD later course (fired_at null) — greyed + non-advanceable, and the kitchen-fire target.
        course: { id: "co-2", name: "Postres", displayOrder: 2 },
        firedAt: null,
      },
    ],
  },
];

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations),
    getStationQueue: vi.fn().mockResolvedValue(groups),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-station-screen a11y (%s theme)", (theme) => {
  it("has no violations on the KANBAN board (picker + three columns of bump controls)", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the TICKET RAIL (toggle switches the widget, age-coloured cards)", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the kitchen-fire RAIL (held course greyed, the Empezar curso button shown)", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      { api: stubApi(), fireControl: "kitchen" },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with no stations configured", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      { api: stubApi({ listStations: vi.fn().mockResolvedValue([]) }) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
