import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillStationScreen } from "./till-station-screen.js";
import type { Station, StationQueueGroup, TillApi } from "../api/client.js";
import type { TillStationQueue } from "../widgets/station-queue.js";

const stations: Station[] = [
  { id: "st-1", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
  { id: "st-2", name: "Barra", displayOrder: 1, isDefault: false, active: true },
];

const cocinaQueue: StationQueueGroup[] = [
  {
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "settled", // a Mode-P pickup — collectable from the rail lens (the handover test below)
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
    items: [
      {
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        descriptions: { "es-ES": "Vino" },
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:05:00.000Z",
      },
    ],
  },
];

/**
 * A fake `TillApi` exposing only the four kitchen methods the station screen calls. `listStations`
 * defaults to the two-station venue and `getStationQueue` to the default station's queue for any id; a
 * test overrides either. Cast through `unknown` because the screen touches only this surface.
 */
function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    listStations: vi.fn().mockResolvedValue(stations),
    getStationQueue: vi.fn().mockResolvedValue(cocinaQueue),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    advanceTicket: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

/** Settles the in-flight listStations/getStationQueue promises and re-renders. */
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
    // The default station (Cocina) is the one whose queue is loaded.
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
        .mockResolvedValueOnce(cocinaQueue) // default station on connect
        .mockResolvedValueOnce(barraQueue), // the picked station
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
});

describe("till-station-screen device mode (device-identity-1 §5a)", () => {
  const boundStation = { id: "st-dev", queue: cocinaQueue };

  /**
   * A fake `TillApi` for the ENROLLED-display path: the three device verbs plus the session verbs the
   * screen must NEVER reach in device mode (present so a stray call is observable, not silently absent).
   */
  function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
    return {
      getDeviceStation: vi.fn().mockResolvedValue({ station: boundStation }),
      enrolDevice: vi.fn().mockResolvedValue({
        deviceId: "dev-1",
        kind: "kds_station",
        stationId: "st-dev",
        label: "Pase",
      }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      listStations: vi.fn().mockResolvedValue(stations),
      getStationQueue: vi.fn().mockResolvedValue(cocinaQueue),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
      advanceTicket: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TillApi;
  }

  const enrolInput = (el: TillStationScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol-code]");
  const typeCode = async (el: TillStationScreen, value: string): Promise<void> => {
    enrolInput(el)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
  };

  it("probes the device station on connect and renders its queue — no picker, no session reads", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(api.getDeviceStation).toHaveBeenCalledOnce();
    // The bound station's queue is threaded to the widget the SAME way the operator path threads it.
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    expect(queueWidget(el)!.stationId).toBe("st-dev");
    // The station is fixed by enrolment: NO picker nav, and the session station-list/queue are never read.
    expect(el.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(api.listStations).not.toHaveBeenCalled();
    expect(api.getStationQueue).not.toHaveBeenCalled();
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

  it("a 401 device probe shows the enrol view (a code field), not the queue", async () => {
    const api = deviceApi({
      getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(enrolInput(el)).not.toBeNull();
    expect(queueWidget(el)).toBeNull();
  });

  it("enrolling with a code sends it verbatim then re-probes into the queue", async () => {
    const getDeviceStation = vi
      .fn()
      .mockRejectedValueOnce({ code: "device.unauthorized" }) // not enrolled yet → enrol view
      .mockResolvedValueOnce({ station: boundStation }); // after enrol → the bound queue
    const api = deviceApi({ getDeviceStation });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    await typeCode(el, "ABCD-1234");
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol-submit]")!.click();
    await flush(el);
    // Sent verbatim — the server normalises the code, the client does not.
    expect(api.enrolDevice).toHaveBeenCalledWith("ABCD-1234");
    expect(queueWidget(el)!.groups).toEqual(cocinaQueue);
    expect(enrolInput(el)).toBeNull();
  });

  it("a rejected enrol shows the localized reason and stays on the enrol view (never the raw code)", async () => {
    const api = deviceApi({
      getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      enrolDevice: vi.fn().mockRejectedValue({ code: "device.pairing_expired" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    await typeCode(el, "STALE");
    el.shadowRoot!.querySelector<HTMLElement>("[data-enrol-submit]")!.click();
    await flush(el);
    const alert = el.shadowRoot!.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("device.pairing_expired", "es-ES"));
    expect(alert!.textContent).not.toContain("device.pairing_expired");
    // Still on the enrol view so the operator can retry a fresh code.
    expect(enrolInput(el)).not.toBeNull();
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
    // Reloaded through the DEVICE probe: once on connect, once after the bump.
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
        items: [
          {
            id: "it-h",
            workingOrderLineId: "wl-h",
            state: "queued",
            descriptions: { "es-ES": "Solomillo" },
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
        .mockResolvedValue({ station: { id: "st-dev", queue: heldCourseQueue } }),
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

  it("device mode ignores a stray mark-collected / fire-course (belt-and-braces: no session verb, no reload)", async () => {
    // The advance-only widget never renders these buttons, so the events cannot fire from the UI; the
    // handlers guard anyway, so a stray composed event never reaches the session verbs (which a device
    // has no cookie for) nor triggers a reload.
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
    await flush(el);
    expect(
      (api as unknown as { markCollected: ReturnType<typeof vi.fn> }).markCollected,
    ).not.toHaveBeenCalled();
    expect(
      (api as unknown as { fireCourse: ReturnType<typeof vi.fn> }).fireCourse,
    ).not.toHaveBeenCalled();
    // Only the initial probe ran — a guarded stray event triggers no reload.
    expect(api.getDeviceStation).toHaveBeenCalledOnce();
  });

  it("a failed device reload after a bump leaves the last-known queue in place (degrade gracefully)", async () => {
    // The probe succeeds on connect, then the post-bump reload rejects (e.g. a mid-session revocation):
    // the display keeps its last-known queue rather than blanking — the kitchen display touches no fiscal
    // path, and a reload recovers.
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
        items: [
          {
            id: "ti-a",
            workingOrderLineId: "wl-a",
            state: "queued",
            descriptions: { "es-ES": "A" },
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
          {
            id: "ti-b",
            workingOrderLineId: "wl-b",
            state: "queued",
            descriptions: { "es-ES": "B" },
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const api = deviceApi({
      getDeviceStation: vi.fn().mockResolvedValue({ station: { id: "st-dev", queue: twoLine } }),
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
