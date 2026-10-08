import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-station-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";
import type { KitchenNotice, Station, StationQueueGroup, TillApi } from "../api/client.js";

const stations: Station[] = [
  {
    id: "st-1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "default" as const,
  },
  {
    id: "st-2",
    name: "Barra",
    displayOrder: 1,
    isDefault: false,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "open" as const,
  },
];

// No fixture below injects `now`, so every ticket ages off the real wall clock against a `queuedAt` far
// in the past and the queue always sweeps in its `forgotten` (flashing) state.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

// One order with a line in each kitchen state + a second order carrying a HELD later course, so axe sees
// every cell state, a course header, a greyed (held) line and — under `fire_control = 'kitchen'` — the
// fire button, all in a single mount.
const groups: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "settled", // collectable — surfaces the rail card's collect button for the a11y sweep
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
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    items: [
      {
        id: "ti-4",
        workingOrderLineId: "wol-4",
        state: "queued",
        name: "Vino",
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
    getStationQueue: vi.fn().mockResolvedValue({ items: groups, notices: [] }),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const baseNotice: KitchenNotice = {
  id: "kn-void",
  stationId: "st-1",
  workingOrderId: "wo-1",
  orderLabel: "#5 · Mesa 4",
  kind: "void",
  lineName: "Burger",
  unitName: null,
  soldInEach: false,
  quantity: "1.000",
  note: null,
  wasStarted: true,
  movedTo: null,
  reroutedTo: null,
  direction: null,
  cancelledExtra: null,
  createdAt: "2026-08-17T10:10:00.000Z",
};
const notices: KitchenNotice[] = [
  baseNotice,
  { ...baseNotice, id: "kn-recalled", kind: "recalled", wasStarted: false },
  { ...baseNotice, id: "kn-changed", kind: "changed", wasStarted: false, note: "no onions" },
  { ...baseNotice, id: "kn-moved", kind: "moved", wasStarted: false, movedTo: "Terraza 2" },
];

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

  it("has no violations with a notice of each kind above the queue", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      { api: stubApi({ getStationQueue: vi.fn().mockResolvedValue({ items: groups, notices }) }) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations while an Acknowledge failure is shown", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({
          getStationQueue: vi.fn().mockResolvedValue({ items: groups, notices }),
          acknowledgeKitchenNotice: vi.fn().mockRejectedValue({ code: "server.internal" }),
        }),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector("till-station-queue")!
      .shadowRoot!.querySelector<HTMLElement>("[data-acknowledge]")!
      .click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations while the out-of-date banner shows above the list", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({
          getStationQueue: vi
            .fn()
            .mockResolvedValueOnce({ items: groups, notices })
            .mockRejectedValue({ code: "server.internal" }),
        }),
      },
      theme,
    );
    await flush(el);
    // A bump reloads the queue, and that reload fails.
    el.shadowRoot!.querySelector("till-station-queue")!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations while the table-changed notice shows", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({ fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date" }) }),
        fireControl: "kitchen",
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector("till-station-queue")!.dispatchEvent(
      new CustomEvent("fire-kitchen-group", {
        detail: { partyId: "v-4", groupId: "g-3", expectedPartyRevision: 12 },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-table-changed]")).not.toBeNull();
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

function deviceStubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getDeviceStation: vi
      .fn()
      .mockResolvedValue({ station: { id: "st-dev", queue: groups, notices: [] } }),
    deviceAdvance: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

describe.each(["light", "dark"] as const)(
  "till-station-screen device mode a11y (%s theme)",
  (theme) => {
    it("has no violations on the enrolled device queue (no picker, view toggle only)", async () => {
      const { el, host } = await mountWidget<TillStationScreen>(
        "till-station-screen",
        { api: deviceStubApi(), deviceMode: true },
        theme,
      );
      await flush(el);
      await expectNoA11yViolations(host);
    });
    it("has no violations with the bound station's notices above its queue", async () => {
      const api = deviceStubApi({
        getDeviceStation: vi
          .fn()
          .mockResolvedValue({ station: { id: "st-dev", queue: groups, notices } }),
      });
      const { el, host } = await mountWidget<TillStationScreen>(
        "till-station-screen",
        { api, deviceMode: true },
        theme,
      );
      await flush(el);
      await expectNoA11yViolations(host);
    });
  },
);

describe.each(["light", "dark"] as const)("printer warning a11y (%s theme)", (theme) => {
  it.each([false, true])(
    "has no violations with two printer statuses (device mode: %s)",
    async (deviceMode) => {
      const printersDown = [
        { printerId: "p-1", printerName: "Epson", since: "2026-08-17T18:14:00Z" },
        { printerId: "p-2", printerName: "Star", since: "2026-08-17T18:18:00Z" },
      ];
      const api = deviceMode
        ? deviceStubApi({
            getDeviceStation: vi.fn().mockResolvedValue({
              station: { id: "st-dev", queue: groups, notices: [], printersDown },
            }),
          })
        : stubApi({
            getStationQueue: vi
              .fn()
              .mockResolvedValue({ items: groups, notices: [], printersDown }),
          });
      const { el, host } = await mountWidget<TillStationScreen>(
        "till-station-screen",
        { api, deviceMode },
        theme,
      );
      await flush(el);
      expect(el.shadowRoot!.querySelectorAll("[data-printer-down][role=status]")).toHaveLength(2);
      await expectNoA11yViolations(host);
    },
  );
});

describe.each(["light", "dark"] as const)("operator station-today a11y (%s)", (theme) => {
  it.each([false, true])("shows the picked station control (closed: %s)", async (closed) => {
    const rows: Station[] = stations.map((row) =>
      row.id !== "st-2"
        ? row
        : {
            ...row,
            open: !closed,
            byHand: closed ? "closed" : null,
            sendsTo: closed ? "st-1" : null,
            why: closed ? "closed_by_hand" : "open",
          },
    );
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({ listStations: vi.fn().mockResolvedValue(rows) }),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    const control = el.shadowRoot!.querySelector("till-station-today")!;
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector("[data-action]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
  it("shows the close dialog above the queue", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({
          stationToday: vi
            .fn()
            .mockResolvedValue({ destinations: [{ id: "st-1", name: "Cocina", isDefault: true }] }),
        }),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    const control = el.shadowRoot!.querySelector("till-station-today")!;
    await control.updateComplete;
    control.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
    await expect
      .poll(() => control.shadowRoot!.querySelector("till-station-today-dialog"))
      .not.toBeNull();
    const dialog = control.shadowRoot!.querySelector("till-station-today-dialog")!;
    await dialog.updateComplete;
    await expectNoA11yViolations(host);
  });
  it("shows the manager PIN step above the queue", async () => {
    const { el, host } = await mountWidget<TillStationScreen>(
      "till-station-screen",
      {
        api: stubApi({
          listStations: vi.fn().mockResolvedValue(
            stations.map((row) =>
              row.id !== "st-2"
                ? row
                : {
                    ...row,
                    open: false,
                    byHand: "closed",
                    sendsTo: "st-1",
                    why: "closed_by_hand",
                  },
            ),
          ),
          setStationToday: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
          serviceDayAuthorizers: vi
            .fn()
            .mockResolvedValue([{ personId: "manager", displayName: "Ana" }]),
        }),
      },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    const control = el.shadowRoot!.querySelector("till-station-today")!;
    await control.updateComplete;
    control.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
    await expect
      .poll(() => control.shadowRoot!.querySelector("till-supervisor-override-dialog"))
      .not.toBeNull();
    const dialog = control.shadowRoot!.querySelector("till-supervisor-override-dialog")!;
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-person]")!.click();
    await dialog.updateComplete;
    await expectNoA11yViolations(host);
  });
});
