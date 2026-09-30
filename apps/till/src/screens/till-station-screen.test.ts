import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillStationScreen } from "./till-station-screen.js";
import type {
  DeviceStation,
  KitchenNotice,
  Station,
  StationQueue,
  StationQueueGroup,
  TillApi,
} from "../api/client.js";
import type { TillStationQueue } from "../widgets/station-queue.js";

const stations: Station[] = [
  { id: "st-1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "st-2", name: "Barra", displayOrder: 1, isDefault: false, active: true },
];

// None of these tests are about ageing; they only need a valid shape.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

const cocinaQueue: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "settled", // a Mode-P pickup — collectable from the rail lens (the handover test below)
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
    ],
  },
];

const barraQueue: StationQueueGroup[] = [
  {
    orderId: "wo-2",
    orderNumber: 6,
    label: null,
    queuedAt: "2026-08-17T10:05:00.000Z",
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    items: [
      {
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        name: "Vino",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:05:00.000Z",
      },
    ],
  },
];

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations),
    getStationQueue: vi.fn().mockResolvedValue({ items: cocinaQueue, notices: [] }),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

// Captured before any test fakes timers, so `flush` still yields a real macrotask under fake ones.
const realSetTimeout = globalThis.setTimeout;

async function flush(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
}

const queueWidget = (el: TillStationScreen) =>
  el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue");

afterEach(cleanupWidgets);

describe("till-station-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-station-screen")).toBe(TillStationScreen);
  });

  it("on connect fetches the stations and the default station's queue, threading it to the widget", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(api.listStations).toHaveBeenCalledOnce();
    expect(api.getStationQueue).toHaveBeenCalledWith("st-1");
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
  });

  it("renders a picker button per station with the default station active", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const picks = el.shadowRoot!.querySelectorAll("[data-station]");
    expect(picks).toHaveLength(2);
    expect(el.shadowRoot!.querySelector('[data-station="st-1"]')!.classList).toContain("active");
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.classList).not.toContain(
      "active",
    );
  });

  it("picking another station loads that station's queue", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] }) // default station on connect
        .mockResolvedValueOnce({ items: barraQueue, notices: [] }), // the picked station
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(api.getStationQueue).toHaveBeenLastCalledWith("st-2");
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.classList).toContain("active");
  });

  it("kanban is the default view; the toggle flips the widget to rail and back", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(queueWidget(el)!.view).toBe("kanban");
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.view).toBe("rail");
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.view).toBe("kanban");
  });

  it("threads bumpMode through to the widget", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      bumpMode: "ticket",
    });
    await flush(el);
    expect(queueWidget(el)!.bumpMode).toBe("ticket");
  });

  it("threads fireControl through to the widget", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    expect(queueWidget(el)!.fireControl).toBe("kitchen");
  });

  it("a fire-course from the widget calls fireCourse then reloads the active queue, and does not escape the screen", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    // Stopped at the screen (it owns the fire here), so the app never double-handles it.
    const escaped = vi.fn();
    host.addEventListener("fire-course", escaped);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: "wo-1", courseId: "co-2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.fireCourse).toHaveBeenCalledWith("wo-1", "co-2");
    // Reloaded: once on connect, once after the fire — so the released course drops its greying.
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("a failed fire-course still reloads the queue (reconciling to server truth)", async () => {
    const api = stubApi({
      fireCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: "wo-1", courseId: "co-2" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("an advance-ticket-item from the widget calls advanceTicketItem then reloads the active queue", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    // The event must not escape the screen (it owns the advance; the app must not double-handle it).
    const escaped = vi.fn();
    host.addEventListener("advance-ticket-item", escaped);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.advanceTicketItem).toHaveBeenCalledWith("ti-1", "preparing");
    // Reloaded: once on connect, once after the advance.
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("an advance-ticket from the widget calls advanceTicket then reloads the active queue", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      bumpMode: "ticket",
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket", {
        detail: { orderId: "wo-1", stationId: "st-1", to: "ready" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.advanceTicket).toHaveBeenCalledWith("wo-1", "st-1", "ready");
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("a mark-collected from the widget calls markCollected then reloads the active queue, and does not escape the screen", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    // Stopped at the screen (it owns the handover here too), so the app never double-handles it.
    const escaped = vi.fn();
    host.addEventListener("mark-collected", escaped);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: "wo-1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.markCollected).toHaveBeenCalledWith("wo-1");
    // Reloaded: once on connect, once after the handover — so the collected order drops off the display.
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("a failed advance still reloads the queue (reconciling to server truth)", async () => {
    const api = stubApi({
      advanceTicketItem: vi.fn().mockRejectedValue({ code: "ticket.invalid_transition" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("the Back control emits back-to-counter", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const spy = vi.fn();
    el.addEventListener("back-to-counter", spy);
    el.shadowRoot!.querySelector<HTMLElement>("[data-back]")!.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("operator mode shows the per-order Reprint button in the rail (deviceMode === false, R-K)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    // The reprint action is a rail-card control, so switch to the rail lens first.
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.shadowRoot!.querySelector('[data-reprint="wo-1"]')).not.toBeNull();
  });

  it("clicking Reprint calls reprintOrder(orderId) and does not escape the screen", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    // Stopped at the screen (it owns the reprint), so the app never double-handles it.
    const escaped = vi.fn();
    host.addEventListener("reprint-order", escaped);
    queueWidget(el)!.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    expect(api.reprintOrder).toHaveBeenCalledWith("wo-1");
    expect(escaped).not.toHaveBeenCalled();
    // Reprint changes no state, so it never re-reads the queue (only the connect read ran).
    expect(api.getStationQueue).toHaveBeenCalledOnce();
  });

  it("a rejected Reprint surfaces the localised banner, never the raw code", async () => {
    // A mapped code → its SPECIFIC localised sentence, proving the banner never shows the wire code.
    const api = stubApi({
      reprintOrder: vi.fn().mockRejectedValue({ code: "session.required" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    queueWidget(el)!.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("session.required"));
    expect(alert!.textContent).not.toContain("session.required");
  });

  it("a codeless Reprint rejection (a fetch network throw) falls back to the generic banner", async () => {
    // A rejection with no `code` degrades to `server.internal` — the generic sentence — not an empty banner.
    const api = stubApi({
      reprintOrder: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    queueWidget(el)!.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("server.internal"));
  });

  it("shows the no-stations message when the venue has none configured", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("station.no_stations"));
    expect(queueWidget(el)).toBeNull();
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("a failed listStations degrades to the no-stations state (never an unhandled rejection)", async () => {
    const api = stubApi({ listStations: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("station.no_stations"));
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("a stray advance with no station configured reads no queue", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector(".empty")!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(api.advanceTicketItem).toHaveBeenCalledWith("ti-1", "preparing"));
    await flush(el);
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("stops before choosing a station when removed while the station list is loading", async () => {
    let resolveStations!: (value: Station[]) => void;
    const api = stubApi({
      listStations: vi.fn(
        () =>
          new Promise<Station[]>((done) => {
            resolveStations = done;
          }),
      ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    el.remove();
    resolveStations(stations);
    await flush(el);
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("re-tapping the active station keeps its queue on screen while it reloads", async () => {
    let resolveReload!: (value: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(
          () =>
            new Promise<StationQueue>((done) => {
              resolveReload = done;
            }),
        ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-1"]')!.click();
    await el.updateComplete;
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    resolveReload({ items: barraQueue, notices: [] });
    await vi.waitFor(() => expect(queueWidget(el)!.groups).toEqual(barraQueue));
  });

  it("switching to another station clears the old queue while the new one loads", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(() => new Promise<StationQueue>(() => {})),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.groups).toEqual([]);
  });

  it("a failed queue read leaves the queue empty (degrade gracefully)", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    // The station picker still renders (stations loaded), but the queue stays empty.
    expect(el.shadowRoot!.querySelector('[data-station="st-1"]')).not.toBeNull();
    expect(queueWidget(el)!.groups).toEqual([]);
  });

  it("a failed whole-ticket advance still reloads the queue (reconciling)", async () => {
    const api = stubApi({
      advanceTicket: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      bumpMode: "ticket",
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket", {
        detail: { orderId: "wo-1", stationId: "st-1", to: "ready" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("suppresses its own header + Back when embedded, keeping the view toggle", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      embedded: true,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-view-toggle]")).not.toBeNull(); // body function stays
  });

  it("renders its header when standalone (default)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
  });

  it("suppresses the queue-surface header when embedded", async () => {
    // deviceMode renders the queue surface; embedded drops its own header (the card host supplies chrome).
    const api = stubApi({
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-dev", queue: [], notices: [] } }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      embedded: true,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
  });
});

describe("till-station-screen device mode (device-identity-1 §5a)", () => {
  const boundStation = { id: "st-dev", queue: cocinaQueue, notices: [] };

  /** Carries the session verbs the screen must NEVER reach in device mode, so a stray call is
   * observable. */
  function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
    return {
      getDeviceStation: vi.fn().mockResolvedValue({ station: boundStation }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      listStations: vi.fn().mockResolvedValue(stations),
      getStationQueue: vi.fn().mockResolvedValue({ items: cocinaQueue, notices: [] }),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
      advanceTicket: vi.fn().mockResolvedValue(undefined),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TillApi;
  }

  it("probes the device station on connect and renders its queue — no picker, no session reads", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(api.getDeviceStation).toHaveBeenCalledOnce();
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    expect(queueWidget(el)!.stationId).toBe("st-dev");
    // The station is fixed by enrolment: NO picker nav, and the session station-list/queue are never read.
    expect(el.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(api.listStations).not.toHaveBeenCalled();
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("cold boot adopts initialDeviceStation and does NOT re-fetch getDeviceStation (fast-path, §5a)", async () => {
    // getDeviceStation returns a DISTINCT queue, so losing the fast path would both re-fetch AND render
    // the wrong queue.
    const api = deviceApi({
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-dev", queue: barraQueue, notices: [] } }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      initialDeviceStation: { station: boundStation }, // boundStation.queue === cocinaQueue
    });
    await flush(el);
    // No second probe, and the prop's queue rendered — never the fetch's barraQueue.
    expect(api.getDeviceStation).not.toHaveBeenCalled();
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    expect(queueWidget(el)!.stationId).toBe("st-dev");
  });

  it("shows no Back-to-counter control in device mode (a device never logged in)", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
  });

  it("a 401 device probe (revoked cookie) emits device-unauthorized and shows no enrol sub-view", async () => {
    // The composed event fires from `#loadDevice` (connectedCallback) during mount, so listen at the
    // document BEFORE mounting — attaching after would miss it.
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const api = deviceApi({
        getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      expect(reboot).toHaveBeenCalledOnce();
      expect(el.shadowRoot!.querySelector("[data-enrol-code]")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-enrol-submit]")).toBeNull();
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("a NON-401 device probe failure keeps the queue chrome and does NOT emit device-unauthorized", async () => {
    // A transient 5xx/network blip must not tear the kiosk down — only a genuine 401 does.
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const api = deviceApi({
        getDeviceStation: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      expect(reboot).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[data-enrol-code]")).toBeNull();
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("a per-line bump routes through deviceAdvance (never the session verb) and reloads via getDeviceStation", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
    expect(api.advanceTicketItem).not.toHaveBeenCalled();
    expect(api.getDeviceStation).toHaveBeenCalledTimes(2);
  });

  it("threads advanceOnly=true to the widget so it hides the collect/fire buttons (device has no such route)", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(queueWidget(el)!.advanceOnly).toBe(true);
  });

  it("device mode hides the Collect button on a settled order (no device collect route, §3d)", async () => {
    // boundStation's cocinaQueue is a SETTLED Mode-P order → collectable on the OPERATOR path; in device
    // mode the advance-only widget must not render the handover button. Switch to the rail lens (where
    // the per-order collect lives) and assert it is absent from the widget's shadow.
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("device mode hides the kitchen-fire button on a held course (no device fire route, §3d)", async () => {
    const heldCourseQueue: StationQueueGroup[] = [
      {
        orderId: "wo-h",
        orderNumber: 9,
        label: null,
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "placed",
        thresholds: DEFAULT_THRESHOLDS,
        items: [
          {
            id: "it-h",
            workingOrderLineId: "wl-h",
            state: "queued",
            name: "Solomillo",
            quantity: "1.000",
            // A HELD later course — normally fireable under `fire_control = 'kitchen'`.
            course: { id: "co-h", name: "Principales", displayOrder: 2 },
            firedAt: null,
          },
        ],
      },
    ];
    const api = deviceApi({
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-dev", queue: heldCourseQueue, notices: [] } }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      fireControl: "kitchen",
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.shadowRoot!.querySelector("[data-fire]")).toBeNull();
  });

  it("device mode hides the Reprint button (session-guarded route, no device session — R-K)", async () => {
    // Switch to the rail lens, where reprint would live.
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(queueWidget(el)!.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("device mode ignores a stray mark-collected / fire-course / reprint-order (belt-and-braces: no session verb, no reload)", async () => {
    // The advance-only widget never renders these buttons (and reprint is off via showReprint), so the
    // events cannot fire from the UI; the handlers guard anyway, so a stray composed event never reaches
    // the session verbs (which a device has no cookie for) nor triggers a reload.
    const api = deviceApi({ markCollected: vi.fn(), fireCourse: vi.fn() });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: "wo-1" },
        bubbles: true,
        composed: true,
      }),
    );
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: "wo-1", courseId: "co-1" },
        bubbles: true,
        composed: true,
      }),
    );
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("reprint-order", {
        detail: { orderId: "wo-1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(
      (api as unknown as { markCollected: ReturnType<typeof vi.fn> }).markCollected,
    ).not.toHaveBeenCalled();
    expect(
      (api as unknown as { fireCourse: ReturnType<typeof vi.fn> }).fireCourse,
    ).not.toHaveBeenCalled();
    expect(api.reprintOrder).not.toHaveBeenCalled();
    // Only the initial probe ran — a guarded stray event triggers no reload.
    expect(api.getDeviceStation).toHaveBeenCalledOnce();
  });

  it("a failed device reload after a bump leaves the last-known queue in place, shows the out-of-date banner and re-boots nothing", async () => {
    // The post-bump reload rejects: the display keeps its last-known queue rather than blanking.
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const getDeviceStation = vi
        .fn()
        .mockResolvedValueOnce({ station: boundStation }) // connect
        .mockRejectedValueOnce({ code: "device.unauthorized" }); // reload after the bump fails
      const api = deviceApi({ getDeviceStation });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-1", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      // Bump attempted, reload rejected, last-known queue retained (the widget still renders it).
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
      expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(reboot).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("a whole-ticket bump expands to a deviceAdvance for each advanceable item at the bound station", async () => {
    // `bump_mode = ticket` fires `advance-ticket`; the device API has only a per-line advance, so the
    // screen advances every fired item whose legitimate next step is `to` — never the session verb.
    const twoLine: StationQueueGroup[] = [
      {
        orderId: "wo-1",
        orderNumber: 5,
        label: null,
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "placed",
        thresholds: DEFAULT_THRESHOLDS,
        items: [
          {
            id: "ti-a",
            workingOrderLineId: "wl-a",
            state: "queued",
            name: "A",
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
          {
            id: "ti-b",
            workingOrderLineId: "wl-b",
            state: "queued",
            name: "B",
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const api = deviceApi({
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-dev", queue: twoLine, notices: [] } }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      bumpMode: "ticket",
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket", {
        detail: { orderId: "wo-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-a", "preparing");
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-b", "preparing");
    expect(api.advanceTicket).not.toHaveBeenCalled();
  });
});

describe("till-station-screen device-mode whole-ticket bump selection", () => {
  const firedAt = "2026-08-17T10:00:00.000Z";
  const mixed: StationQueueGroup[] = [
    {
      orderId: "wo-1",
      orderNumber: 5,
      label: null,
      queuedAt: firedAt,
      status: "placed",
      thresholds: DEFAULT_THRESHOLDS,
      items: [
        {
          id: "ti-fired-queued",
          workingOrderLineId: "wl-1",
          state: "queued",
          name: "A",
          quantity: "1.000",
          course: null,
          firedAt,
        },
        {
          id: "ti-held",
          workingOrderLineId: "wl-2",
          state: "queued",
          name: "B",
          quantity: "1.000",
          course: null,
          firedAt: null,
        },
        {
          id: "ti-already-preparing",
          workingOrderLineId: "wl-3",
          state: "preparing",
          name: "C",
          quantity: "1.000",
          course: null,
          firedAt,
        },
      ],
    },
  ];

  function deviceApi(): TillApi {
    return {
      getDeviceStation: vi
        .fn()
        .mockResolvedValue({ station: { id: "st-dev", queue: mixed, notices: [] } }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      advanceTicket: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
  }

  async function bump(api: TillApi, orderId: string): Promise<void> {
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      bumpMode: "ticket",
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket", {
        detail: { orderId, stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(api.getDeviceStation).toHaveBeenCalledTimes(2));
  }

  it("advances only the fired lines whose next step is the target, skipping held and later lines", async () => {
    const api = deviceApi();
    await bump(api, "wo-1");
    expect(api.deviceAdvance).toHaveBeenCalledTimes(1);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-fired-queued", "preparing");
    expect(api.advanceTicket).not.toHaveBeenCalled();
  });

  it("advances nothing for an order no longer on the loaded queue, and still reloads", async () => {
    const api = deviceApi();
    await bump(api, "wo-gone");
    expect(api.deviceAdvance).not.toHaveBeenCalled();
    expect(api.advanceTicket).not.toHaveBeenCalled();
  });
});

describe("station destination history", () => {
  it("drops a requested station from the address when the venue has no stations", async () => {
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-2");
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await vi.waitFor(() => expect(location.pathname).toBe("/tabs/counter/view/station"));
    expect(el.shadowRoot!.textContent).toContain(t("station.no_stations"));
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("restores a validated station after refresh and replaces an unavailable station", async () => {
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-2");
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: stubApi({
        getStationQueue: vi.fn().mockResolvedValue({ items: barraQueue, notices: [] }),
      }),
    });
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-2");
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    history.replaceState(null, "", "/tabs/counter/view/station/station/missing");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-1");
    expect(location.pathname).toBe("/tabs/counter/view/station/station/st-1");
  });

  it("does not let an older queue response replace the station reached through Back", async () => {
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-1");
    let resolve!: (value: StationQueue) => void;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: stubApi({
        getStationQueue: vi.fn((id: string) =>
          id === "st-2"
            ? new Promise((done) => {
                resolve = done;
              })
            : Promise.resolve({ items: cocinaQueue, notices: [] }),
        ),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    resolve({ items: barraQueue, notices: [] });
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-1");
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
  });

  it("keeps an embedded station picker local to its enclosing destination", async () => {
    history.replaceState(null, "", "/tabs/kitchen/view/schedule");
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: stubApi(),
      embedded: true,
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-2");
    expect(location.pathname).toBe("/tabs/kitchen/view/schedule");
  });
});

describe("till-station-screen kitchen notices", () => {
  const notice = (overrides: Partial<KitchenNotice>): KitchenNotice => ({
    id: "kn-1",
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
    direction: null,
    cancelledExtra: null,
    createdAt: "2026-08-17T10:10:00.000Z",
    ...overrides,
  });
  const voidStarted = notice({ id: "kn-void" });
  const changed = notice({
    id: "kn-changed",
    kind: "changed",
    note: "no onions",
    wasStarted: false,
  });
  const twoNotices: StationQueue = { items: cocinaQueue, notices: [voidStarted, changed] };

  const noticeRows = (el: TillStationScreen) => [
    ...queueWidget(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-notice]"),
  ];
  const acknowledge = (el: TillStationScreen, id: string) =>
    queueWidget(el)!
      .shadowRoot!.querySelector<HTMLElement>(`[data-notice="${id}"] [data-acknowledge]`)!
      .click();

  it("threads the queue answer's notices to the widget, which shows them above the items in order", async () => {
    const api = stubApi({ getStationQueue: vi.fn().mockResolvedValue(twoNotices) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(queueWidget(el)!.notices).toEqual([voidStarted, changed]);
    const rows = noticeRows(el);
    expect(rows.map((row) => row.dataset.notice)).toEqual(["kn-void", "kn-changed"]);
    expect(rows[0]!.textContent).toContain(t("station.notice.void"));
    expect(rows[0]!.textContent).toContain(t("station.notice.started"));
    expect(rows[1]!.textContent).not.toContain(t("station.notice.started"));
  });

  it("Acknowledge calls the session route and removes the row once it answers, without escaping the screen", async () => {
    let answer!: () => void;
    const api = stubApi({
      getStationQueue: vi.fn().mockResolvedValue(twoNotices),
      acknowledgeKitchenNotice: vi.fn(() => new Promise<void>((resolve) => (answer = resolve))),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const escaped = vi.fn();
    document.addEventListener("acknowledge-notice", escaped);
    try {
      acknowledge(el, "kn-void");
      await flush(el);
      expect(api.acknowledgeKitchenNotice).toHaveBeenCalledWith("kn-void");
      // Still there until the route answers.
      expect(noticeRows(el).map((row) => row.dataset.notice)).toEqual(["kn-void", "kn-changed"]);
      answer();
      await flush(el);
      await queueWidget(el)!.updateComplete;
      expect(noticeRows(el).map((row) => row.dataset.notice)).toEqual(["kn-changed"]);
      expect(escaped).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("acknowledge-notice", escaped);
    }
  });

  it("an unknown notice (another screen already acknowledged it) is removed as gone, with no error shown", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockResolvedValue(twoNotices),
      acknowledgeKitchenNotice: vi.fn().mockRejectedValue({ code: "kitchen_notice.not_found" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    acknowledge(el, "kn-void");
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(noticeRows(el).map((row) => row.dataset.notice)).toEqual(["kn-changed"]);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("a failed Acknowledge keeps the row and says so", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockResolvedValue(twoNotices),
      acknowledgeKitchenNotice: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    acknowledge(el, "kn-void");
    await flush(el);
    expect(noticeRows(el).map((row) => row.dataset.notice)).toEqual(["kn-void", "kn-changed"]);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      t("station.acknowledge_error"),
    );
  });

  it("switching station clears the old station's notices while the new queue loads", async () => {
    let answerBarra!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce(twoNotices)
        .mockImplementationOnce(() => new Promise((resolve) => (answerBarra = resolve))),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(queueWidget(el)!.notices).toEqual([]);
    answerBarra({ items: barraQueue, notices: [] });
    await flush(el);
  });

  describe("device mode", () => {
    function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
      return {
        getDeviceStation: vi.fn().mockResolvedValue({
          station: { id: "st-dev", queue: cocinaQueue, notices: [voidStarted, changed] },
        }),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
        deviceAcknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined),
        acknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as TillApi;
    }

    it("shows the bound station's notices from the device read", async () => {
      const api = deviceApi();
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      expect(queueWidget(el)!.notices).toEqual([voidStarted, changed]);
    });

    it("adopts the notices of the station the app probed at cold boot", async () => {
      const api = deviceApi();
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
        initialDeviceStation: { station: { id: "st-dev", queue: cocinaQueue, notices: [changed] } },
      });
      await flush(el);
      expect(api.getDeviceStation).not.toHaveBeenCalled();
      expect(queueWidget(el)!.notices).toEqual([changed]);
    });

    it("Acknowledge goes through the device route, never the session one, and removes the row", async () => {
      const api = deviceApi();
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      acknowledge(el, "kn-changed");
      await flush(el);
      await queueWidget(el)!.updateComplete;
      expect(api.deviceAcknowledgeKitchenNotice).toHaveBeenCalledWith("kn-changed");
      expect(api.acknowledgeKitchenNotice).not.toHaveBeenCalled();
      expect(noticeRows(el).map((row) => row.dataset.notice)).toEqual(["kn-void"]);
    });
  });
});

describe("till-station-screen 15-second refresh", () => {
  // Animation frames are not faked, and `flush` yields through the real `setTimeout`, so no test here
  // can stall on a paused frame (CLAUDE.md §4).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const later: StationQueue = {
    items: barraQueue,
    notices: [
      {
        id: "kn-new",
        stationId: "st-1",
        workingOrderId: "wo-1",
        orderLabel: "#5",
        kind: "recalled",
        lineName: "Paella",
        unitName: null,
        soldInEach: false,
        quantity: "2.000",
        note: null,
        wasStarted: false,
        movedTo: null,
        direction: null,
        cancelledExtra: null,
        createdAt: "2026-08-17T10:20:00.000Z",
      },
    ],
  };

  it("re-reads the station's queue and notices every 15 seconds, and not before", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(14_999);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(api.getStationQueue).toHaveBeenLastCalledWith("st-1", {
      signal: expect.any(AbortSignal),
    });
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
  });

  it("a read that never answers does not stop the next tick's read, and its late answer is dropped", async () => {
    // A stalled socket after a Wi-Fi drop: the refresh is the display's only way to hear of new work,
    // so one hung read must not freeze it.
    let answerHung!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(() => new Promise((resolve) => (answerHung = resolve)))
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000); // this read hangs
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    answerHung({ items: cocinaQueue, notices: [] }); // older than what is on screen
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("device mode: a read that never answers does not stop the next tick's read", async () => {
    const api = {
      getDeviceStation: vi
        .fn()
        .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue({
          station: { id: "st-dev", queue: barraQueue, notices: later.notices },
        }),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    vi.advanceTimersByTime(15_000); // this read hangs
    await flush(el);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getDeviceStation).toHaveBeenCalledTimes(3);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  /** Read `n`'s answer: the Barra queue and one notice named after it, so the test can tell which
   * read's answer is on screen. */
  const answerNumber = (n: number): StationQueue => ({
    items: barraQueue,
    notices: [{ ...later.notices[0]!, id: `kn-read-${n}` }],
  });
  const shownRead = (el: TillStationScreen) => queueWidget(el)!.notices.map((notice) => notice.id);

  /** A read that answers only when its signal aborts it, as `fetch` does. */
  function hangUntilAborted(signals: AbortSignal[]) {
    return (_stationId: string, options?: { signal?: AbortSignal }) => {
      const signal = options!.signal!;
      signals.push(signal);
      return new Promise<StationQueue>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    };
  }

  it("a server slower than the interval still updates the screen: each answer lands after the next read set out", async () => {
    let read = 1;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementation((_stationId: string, options?: { signal?: AbortSignal }) => {
          const answer = answerNumber(++read);
          // As fetch does, a cancelled read never answers.
          return new Promise((resolve, reject) => {
            const answering = setTimeout(() => resolve(answer), 20_000);
            options!.signal!.addEventListener("abort", () => {
              clearTimeout(answering);
              reject(options!.signal!.reason);
            });
          });
        }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(30_000); // read 2 set out at 15 s, read 3 at 30 s
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(5_000); // read 2 answers at 35 s, after read 3 set out
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-2"]);
    vi.advanceTimersByTime(15_000); // read 3 answers at 50 s
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-3"]);
  });

  it("an older answer arriving after a newer one is on screen is dropped", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(answerNumber(2)), 20_000)),
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(answerNumber(3)), 1_000)),
        ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(31_000); // read 2 out since 15 s; read 3 set out at 30 s and answered
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-3"]);
    vi.advanceTimersByTime(4_000); // read 2 answers at 35 s
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-3"]);
  });

  it("a refresh read that never answers is cancelled 25 seconds after it set out, raising no error alert, and later reads go ahead", async () => {
    const signals: AbortSignal[] = [];
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce(later)
        .mockImplementationOnce(hangUntilAborted(signals))
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000); // the hung read sets out
    await flush(el);
    expect(signals).toHaveLength(1);
    vi.advanceTimersByTime(24_999);
    await flush(el);
    expect(signals[0]!.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    await flush(el);
    expect(signals[0]!.aborted).toBe(true);
    vi.advanceTimersByTime(5_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(4); // at 30 s and 45 s the reads went ahead
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("reads that never answer do not pile up: when a read sets out, at most one other is still out", async () => {
    const signals: AbortSignal[] = [];
    const outWhenSettingOut: number[] = [];
    const hang = hangUntilAborted(signals);
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementation((stationId: string, options?: { signal?: AbortSignal }) => {
          // Counted as the read starts: a limit due at the same moment as a tick is still pending here.
          outWhenSettingOut.push(signals.filter((signal) => !signal.aborted).length + 1);
          return hang(stationId, options);
        }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    for (let tick = 0; tick < 10; tick++) {
      vi.advanceTimersByTime(15_000);
      await flush(el);
    }
    expect(outWhenSettingOut).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("taking the screen off the page cancels a read still out", async () => {
    const signals: AbortSignal[] = [];
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementation(hangUntilAborted(signals)),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    el.remove();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("an answer for the station just left never shows under the station picked", async () => {
    let answerCocina!: (queue: StationQueue) => void;
    let answerBarra!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(() => new Promise((resolve) => (answerCocina = resolve)))
        .mockImplementationOnce(() => new Promise((resolve) => (answerBarra = resolve))),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000); // a Cocina refresh sets out
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    answerCocina(answerNumber(2)); // lands before Barra's own answer
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual([]);
    expect(queueWidget(el)!.notices).toEqual([]);
    answerBarra({ items: barraQueue, notices: [] });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
  });

  it("device mode: a display slower than the interval still updates, and a hung read is cancelled", async () => {
    const signals: AbortSignal[] = [];
    const station = (n: number): DeviceStation => ({
      station: { id: "st-dev", queue: barraQueue, notices: answerNumber(n).notices },
    });
    const api = {
      getDeviceStation: vi
        .fn()
        .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(station(2)), 20_000)),
        )
        .mockImplementationOnce((options?: { signal?: AbortSignal }) => {
          const signal = options!.signal!;
          signals.push(signal);
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          );
        })
        .mockResolvedValue(station(4)),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    vi.advanceTimersByTime(35_000); // read 2 set out at 15 s and answers at 35 s; read 3 hangs from 30 s
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-2"]);
    vi.advanceTimersByTime(25_000); // read 4 answered at 45 s; read 3 is cancelled at 55 s
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(signals[0]!.aborted).toBe(true);
    expect(shownRead(el)).toEqual(["kn-read-4"]);
  });

  it("taken off the page and put back, it refreshes on the timer again, even after a hung read", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(later),
    });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000); // this read hangs
    await flush(el);
    el.remove();
    host.appendChild(el); // re-attaching reads once on its own
    await flush(el);
    const afterReattach = vi.mocked(api.getStationQueue).mock.calls.length;
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(afterReattach + 1);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("taken off the page and put back, it runs one timer, not two", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.remove();
    host.appendChild(el);
    await flush(el);
    const afterReattach = vi.mocked(api.getStationQueue).mock.calls.length;
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(afterReattach + 1);
  });

  it("a failed refresh keeps the last good queue and notices on screen", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce(later)
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    // The next tick is not blocked by the failed one.
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
  });

  it("stops refreshing once the screen is removed", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.remove();
    vi.advanceTimersByTime(60_000);
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    expect(api.getStationQueue).toHaveBeenCalledTimes(1);
  });

  it("an answer that set out before an Acknowledge does not bring the acknowledged row back", async () => {
    const withNotice: StationQueue = { items: cocinaQueue, notices: later.notices };
    let answerPoll!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce(withNotice)
        .mockImplementationOnce(() => new Promise((resolve) => (answerPoll = resolve)))
        .mockResolvedValue({ items: cocinaQueue, notices: [] }),
      acknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.advanceTimersByTime(15_000); // the refresh sets out, and hangs
    await flush(el);
    queueWidget(el)!
      .shadowRoot!.querySelector<HTMLElement>('[data-notice="kn-new"] [data-acknowledge]')!
      .click();
    await flush(el);
    answerPoll(withNotice); // read before the acknowledge landed
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(queueWidget(el)!.notices).toEqual([]);
    // Once an answer arrives without it, the screen stops remembering it, so an always-on display does
    // not collect every id it ever acknowledged. The only way to see that is a (never real) answer
    // listing it again.
    vi.advanceTimersByTime(15_000);
    await flush(el);
    vi.mocked(api.getStationQueue).mockResolvedValue(withNotice);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("device mode re-reads its bound station on the same timer", async () => {
    const api = {
      getDeviceStation: vi
        .fn()
        .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
        .mockResolvedValue({
          station: { id: "st-dev", queue: barraQueue, notices: later.notices },
        }),
      getStationQueue: vi.fn(),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getDeviceStation).toHaveBeenCalledTimes(2);
    expect(api.getStationQueue).not.toHaveBeenCalled();
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("device mode: a refresh that set out before a bump's reload never overwrites the newer answer", async () => {
    let answerRefresh!: (station: DeviceStation) => void;
    const api = {
      getDeviceStation: vi
        .fn()
        .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
        .mockImplementationOnce(() => new Promise((resolve) => (answerRefresh = resolve)))
        .mockResolvedValue({ station: { id: "st-dev", queue: barraQueue, notices: [] } }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    vi.advanceTimersByTime(15_000); // the refresh sets out, and hangs
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    answerRefresh({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
  });

  it("device mode: a bump's reload that set out before a refresh never overwrites the newer answer", async () => {
    let answerReload!: (station: DeviceStation) => void;
    const api = {
      getDeviceStation: vi
        .fn()
        .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
        .mockImplementationOnce(() => new Promise((resolve) => (answerReload = resolve)))
        .mockResolvedValue({ station: { id: "st-dev", queue: barraQueue, notices: [] } }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el); // the bump's reload sets out, and hangs
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    answerReload({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
  });

  it("a device refresh answered 401 (the display was removed) sends the app back to its front door", async () => {
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const api = {
        getDeviceStation: vi
          .fn()
          .mockResolvedValueOnce({ station: { id: "st-dev", queue: cocinaQueue, notices: [] } })
          .mockRejectedValue({ code: "device.unauthorized" }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      expect(reboot).not.toHaveBeenCalled();
      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(reboot).toHaveBeenCalledOnce();
      expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });
});

describe("till-station-screen out-of-date banner", () => {
  // The clock is faked too, so the banner's time is a known wall-clock minute. Local-time `Date`
  // arguments keep that minute the same in every time zone.
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
    });
    vi.setSystemTime(new Date(2026, 7, 17, 10, 19, 50));
    setLocale("en-GB");
  });
  afterEach(() => {
    vi.useRealTimers();
    setLocale("en-GB");
  });

  const later: StationQueue = {
    items: barraQueue,
    notices: [
      {
        id: "kn-new",
        stationId: "st-1",
        workingOrderId: "wo-1",
        orderLabel: "#5",
        kind: "recalled",
        lineName: "Paella",
        unitName: null,
        soldInEach: false,
        quantity: "2.000",
        note: null,
        wasStarted: false,
        movedTo: null,
        direction: null,
        cancelledExtra: null,
        createdAt: "2026-08-17T10:20:00.000Z",
      },
    ],
  };

  const banner = (el: TillStationScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-stale]");

  async function tick(el: TillStationScreen, ms = 15_000): Promise<void> {
    vi.advanceTimersByTime(ms);
    await flush(el);
  }

  it("a healthy screen shows no banner", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el);
    expect(banner(el)).toBeNull();
  });

  it("a refresh that fails after a good one says since when the list is out of date, and keeps the list", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] }) // 10:19:50
        .mockResolvedValueOnce(later) // 10:20:05
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el); // 10:20:05, good
    expect(banner(el)).toBeNull();
    await tick(el); // 10:20:20, fails
    expect(banner(el)!.getAttribute("role")).toBe("status");
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:20, less than a minute ago");
    expect(queueWidget(el)!.groups).toEqual(barraQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    await tick(el, 45_000); // 10:21:05, still failing: the time is the last GOOD read's, not the latest failure's
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:20, 1 minute ago");
  });

  it("the next good refresh clears the banner", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el);
    expect(banner(el)).not.toBeNull();
    await tick(el);
    expect(banner(el)).toBeNull();
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("when the first read fails, the list is out of date since the screen opened", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:19, less than a minute ago");
  });

  it("a station list that answers 20 seconds late, in the next minute, still dates a failed first read from when the screen opened", async () => {
    const api = stubApi({
      listStations: vi.fn(
        () => new Promise((resolve) => setTimeout(() => resolve(stations), 20_000)),
      ),
      getStationQueue: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el, 20_000); // 10:20:10: the stations answer, and the first queue read fails
    expect(api.getStationQueue).toHaveBeenCalledWith("st-1");
    expect(api.getStationQueue).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:19, less than a minute ago");
  });

  it("a read cancelled by the 25-second limit shows the banner", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementation(
          (_stationId: string, options?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason)),
            ),
        ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el, 39_999); // the read that set out at 15 s is still out
    expect(banner(el)).toBeNull();
    await tick(el, 1); // and is cancelled at 40 s
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:19, less than a minute ago");
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
  });

  it("a late failure of an older read, after a newer read's answer is on screen, shows no banner", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) =>
              setTimeout(() => reject({ code: "server.internal" }), 20_000),
            ),
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(later), 1_000)),
        )
        .mockImplementation(() => new Promise(() => {})),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el, 31_000); // read 2 out since 15 s; read 3 set out at 30 s and answered
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    await tick(el, 4_000); // read 2 fails at 35 s
    expect(banner(el)).toBeNull();
  });

  it("switching station clears the banner, and a failure there dates from the switch", async () => {
    let failBarra!: (reason: unknown) => void;
    const api = stubApi({
      getStationQueue: vi.fn((stationId: string) =>
        stationId === "st-2"
          ? new Promise((_resolve, reject) => (failBarra = reject))
          : Promise.reject({ code: "server.internal" }),
      ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:19, less than a minute ago");
    vi.advanceTimersByTime(20_000); // 10:20:10 — the 10:20:05 Cocina refresh also failed
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(banner(el)).toBeNull();
    failBarra({ code: "server.internal" });
    await flush(el);
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:20, less than a minute ago");
  });

  it("shows the Spanish text under the Spanish locale", async () => {
    setLocale("es-ES");
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el);
    expect(banner(el)!.textContent!.trim()).toBe(
      "Sin actualizaciones desde las 10:19, hace menos de un minuto",
    );
  });

  const failingAfterFirstRead = () =>
    stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] }) // 10:19:50
        .mockRejectedValue({ code: "server.internal" }),
    });

  const bannerText = (el: TillStationScreen) => banner(el)!.textContent!.trim();

  it("says how long ago the last good list was, and keeps counting while every refresh fails", async () => {
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: failingAfterFirstRead(),
    });
    await flush(el);
    await tick(el); // 10:20:05, fails
    expect(bannerText(el)).toBe("No updates since 10:19, less than a minute ago");
    await tick(el, 44_999); // 10:20:49.999
    expect(bannerText(el)).toBe("No updates since 10:19, less than a minute ago");
    await tick(el, 1); // 10:20:50, a minute after the last good read
    expect(bannerText(el)).toBe("No updates since 10:19, 1 minute ago");
    await tick(el, 60_000); // 10:21:50
    expect(bannerText(el)).toBe("No updates since 10:19, 2 minutes ago");
    await tick(el, 180_000); // 10:24:50
    expect(bannerText(el)).toBe("No updates since 10:19, 5 minutes ago");
  });

  it("counts the minutes in Spanish under the Spanish locale", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: failingAfterFirstRead(),
    });
    await flush(el);
    await tick(el); // 10:20:05, fails
    expect(bannerText(el)).toBe("Sin actualizaciones desde las 10:19, hace menos de un minuto");
    await tick(el, 45_000); // 10:20:50
    expect(bannerText(el)).toBe("Sin actualizaciones desde las 10:19, hace 1 minuto");
    await tick(el, 240_000); // 10:24:50
    expect(bannerText(el)).toBe("Sin actualizaciones desde las 10:19, hace 5 minutos");
  });

  it("a station list that cannot be read on open shows the banner beside No stations, dated from when the screen opened", async () => {
    const api = stubApi({ listStations: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("station.no_stations"));
    expect(banner(el)!.getAttribute("role")).toBe("status");
    expect(bannerText(el)).toBe("No updates since 10:19, less than a minute ago");
    await tick(el, 60_000); // 10:20:50
    expect(bannerText(el)).toBe("No updates since 10:19, 1 minute ago");
    await tick(el, 240_000); // 10:24:50
    expect(bannerText(el)).toBe("No updates since 10:19, 5 minutes ago");
  });

  it("a venue with no stations configured shows no banner", async () => {
    const api = stubApi({ listStations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(t("station.no_stations"));
    expect(banner(el)).toBeNull();
    await tick(el, 60_000);
    expect(banner(el)).toBeNull();
  });

  it("the minute count runs only while the banner shows: a good read stops it", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: cocinaQueue, notices: [] })
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const healthy = vi.getTimerCount();
    await tick(el); // fails
    expect(banner(el)).not.toBeNull();
    expect(vi.getTimerCount()).toBe(healthy + 1);
    await tick(el); // good
    expect(banner(el)).toBeNull();
    expect(vi.getTimerCount()).toBe(healthy);
  });

  it("removing the screen while the banner shows stops the minute count", async () => {
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: failingAfterFirstRead(),
    });
    await flush(el);
    const healthy = vi.getTimerCount();
    await tick(el); // fails
    expect(vi.getTimerCount()).toBe(healthy + 1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("device mode", () => {
    const deviceStation = (queue: StationQueueGroup[]): DeviceStation => ({
      station: { id: "st-dev", queue, notices: [] },
    });

    it("a failed refresh shows the banner, and the next good one clears it", async () => {
      const api = {
        getDeviceStation: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(cocinaQueue)) // 10:19:50
          .mockResolvedValueOnce(deviceStation(barraQueue)) // 10:20:05
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(deviceStation(barraQueue)),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      await tick(el);
      await tick(el); // 10:20:20, fails
      expect(banner(el)!.textContent!.trim()).toBe(
        "No updates since 10:20, less than a minute ago",
      );
      expect(queueWidget(el)!.groups).toEqual(barraQueue);
      await tick(el);
      expect(banner(el)).toBeNull();
    });

    it("a station adopted from the cold boot counts as a good read", async () => {
      const api = {
        getDeviceStation: vi.fn().mockRejectedValue({ code: "server.internal" }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
        initialDeviceStation: deviceStation(cocinaQueue),
      });
      await flush(el);
      expect(banner(el)).toBeNull();
      await tick(el);
      expect(banner(el)!.textContent!.trim()).toBe(
        "No updates since 10:19, less than a minute ago",
      );
    });

    it("a bump whose reload fails shows the banner", async () => {
      const api = {
        getDeviceStation: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(cocinaQueue))
          .mockRejectedValue({ code: "server.internal" }),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-1", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
      expect(banner(el)!.textContent!.trim()).toBe(
        "No updates since 10:19, less than a minute ago",
      );
    });

    it("a 401 (the display was removed) shows no banner: the app re-boots instead", async () => {
      const api = {
        getDeviceStation: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(cocinaQueue))
          .mockRejectedValue({ code: "device.unauthorized" }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      await tick(el);
      expect(api.getDeviceStation).toHaveBeenCalledTimes(2);
      expect(banner(el)).toBeNull();
    });
  });
});

describe("till-station-screen — firing a party's held group", () => {
  const fireDetail = { partyId: "v-4", groupId: "g-3", expectedPartyRevision: 12 };

  function fireFromWidget(el: TillStationScreen): void {
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("fire-kitchen-group", { detail: fireDetail, bubbles: true, composed: true }),
    );
  }

  const tableChanged = (el: TillStationScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-table-changed]");

  it("calls fireGroup with a fresh submission id per press and the card's revision, reloads, and does not escape the screen", async () => {
    const api = stubApi({ fireGroup: vi.fn().mockResolvedValue({ revision: 13 }) });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    const escaped = vi.fn();
    host.addEventListener("fire-kitchen-group", escaped);
    fireFromWidget(el);
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    const calls = vi.mocked(api.fireGroup).mock.calls;
    expect(calls).toEqual([
      ["v-4", "g-3", { submissionId: expect.any(String), expectedPartyRevision: 12 }],
      ["v-4", "g-3", { submissionId: expect.any(String), expectedPartyRevision: 12 }],
    ]);
    expect(calls[0]![2].submissionId).not.toBe(calls[1]![2].submissionId);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
    expect(escaped).not.toHaveBeenCalled();
    expect(tableChanged(el)).toBeNull();
  });

  it("on party.out_of_date it reloads and says the table changed, and never sends again on its own", async () => {
    const api = stubApi({
      fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    await flush(el);
    expect(api.fireGroup).toHaveBeenCalledOnce();
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)!.textContent).toContain(t("station.table_changed"));
    expect(tableChanged(el)!.getAttribute("role")).toBe("status");
  });

  it("the next press clears the notice", async () => {
    const api = stubApi({
      fireGroup: vi
        .fn()
        .mockRejectedValueOnce({ code: "party.out_of_date" })
        .mockResolvedValue({ revision: 14 }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    expect(tableChanged(el)).not.toBeNull();
    fireFromWidget(el);
    await flush(el);
    expect(tableChanged(el)).toBeNull();
  });

  function partyQueue(label: string | null): StationQueueGroup[] {
    return [
      {
        ...cocinaQueue[0]!,
        orderId: "wo-4",
        orderNumber: 12,
        label,
        status: "placed",
        party: { id: "v-4", revision: 12 },
        items: [
          {
            ...cocinaQueue[0]!.items[0]!,
            id: "ti-4",
            firedAt: null,
            group: { id: "g-3", position: 3, state: "held" },
          },
        ],
      },
    ];
  }

  const staleNotice = (label: string) =>
    `${t("station.table_changed_named").replace("{table}", label)} ${t("station.table_changed")}`;

  it("names the table that changed, and never says where it changed", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockResolvedValue({ items: partyQueue("Mesa 4"), notices: [] }),
      fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    const text = tableChanged(el)!.textContent!.replace(/\s+/g, " ").trim();
    expect(text).toBe(staleNotice("Mesa 4"));
    expect(text).not.toContain("till");
  });

  it("names a card with no label by its order number", async () => {
    const api = stubApi({
      getStationQueue: vi.fn().mockResolvedValue({ items: partyQueue(null), notices: [] }),
      fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    expect(tableChanged(el)!.textContent!.replace(/\s+/g, " ").trim()).toBe(staleNotice("#12"));
  });

  it("says a table changed when the group's card is not on screen", async () => {
    const api = stubApi({
      fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    expect(tableChanged(el)!.textContent!.replace(/\s+/g, " ").trim()).toBe(
      `${t("station.table_changed_unnamed")} ${t("station.table_changed")}`,
    );
  });

  it("the next successful read after the one that showed it clears the notice", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const api = stubApi({
        getStationQueue: vi.fn().mockResolvedValue({ items: partyQueue("Mesa 4"), notices: [] }),
        fireGroup: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v-4" }),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        fireControl: "kitchen",
      });
      await flush(el);
      fireFromWidget(el);
      await flush(el);
      expect(tableChanged(el)).not.toBeNull();
      vi.mocked(api.getStationQueue).mockRejectedValueOnce(new TypeError("offline"));
      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(tableChanged(el)).not.toBeNull();
      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(tableChanged(el)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("another refusal reloads without the notice", async () => {
    const api = stubApi({ fireGroup: vi.fn().mockRejectedValue({ code: "group.not_held" }) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      fireControl: "kitchen",
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(tableChanged(el)).toBeNull();
  });

  it("device mode ignores a stray fire-kitchen-group: no session verb, no reload", async () => {
    const api = {
      getDeviceStation: vi.fn().mockResolvedValue({
        station: { id: "st-dev", queue: cocinaQueue, notices: [] },
      }),
      fireGroup: vi.fn(),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    fireFromWidget(el);
    await flush(el);
    expect(api.fireGroup).not.toHaveBeenCalled();
    expect(api.getDeviceStation).toHaveBeenCalledOnce();
  });
});
