import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillStationScreen } from "./till-station-screen.js";
import type { Station, StationQueue, StationQueueGroup, TillApi } from "../api/client.js";
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

async function flush(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("a failed device reload after a bump leaves the last-known queue in place (degrade gracefully)", async () => {
    // The post-bump reload rejects: the display keeps its last-known queue rather than blanking.
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
