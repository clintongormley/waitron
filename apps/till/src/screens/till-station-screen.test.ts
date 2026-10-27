import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { page, userEvent } from "vitest/browser";
import type { WtDialog } from "@waitron/ui";
import { cleanupWidgets, mountWidget, resetPage } from "../widgets/test-helpers.js";
import type { TillKitchenColumnsDialog } from "../widgets/kitchen-columns-dialog.js";
import { TillStationScreen } from "./till-station-screen.js";
import type {
  DeviceIdentity,
  DeviceStationScreen,
  KitchenNotice,
  ResolvedKitchenScreen,
  Station,
  StationQueue,
  StationQueueGroup,
  TillApi,
} from "../api/client.js";
import { TillApi as StationTodayApi } from "../api/client.js";
import type { TillStationToday } from "../widgets/station-today.js";
import type { TillStationQueue } from "../widgets/station-queue.js";
import type { TillStationChoiceDialog } from "../widgets/station-choice-dialog.js";
import { SUBMIT_RETRIES, SUBMIT_RETRY_PAUSE_MS } from "../state/draft-sync.js";

const stations: Station[] = [
  {
    id: "st-1",
    name: "Cocina",
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
    isDefault: false,
    active: true,
    open: true,
    byHand: null,
    sendsTo: null,
    why: "open" as const,
  },
];

// None of these tests are about ageing; they only need a valid shape.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

const kitchenQueue: StationQueueGroup[] = [
  {
    kitchenNote: null,
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: "2026-08-17T10:00:00.000Z",
    status: "settled", // a Mode-P pickup — collectable (the handover test below)
    thresholds: DEFAULT_THRESHOLDS,
    bumpMode: "line",
    items: [
      {
        allergy: null,
        id: "ti-1",
        workingOrderLineId: "wol-1",
        state: "queued",
        name: "Paella",
        quantity: "2.000",
        course: null,
        firedAt: "2026-08-17T10:00:00.000Z",
        queuedAt: "2026-08-17T10:00:00.000Z",
      },
    ],
  },
];

const barQueue: StationQueueGroup[] = [
  {
    kitchenNote: null,
    orderId: "wo-2",
    orderNumber: 6,
    label: null,
    queuedAt: "2026-08-17T10:05:00.000Z",
    status: "placed",
    thresholds: DEFAULT_THRESHOLDS,
    bumpMode: "line",
    items: [
      {
        allergy: null,
        id: "ti-2",
        workingOrderLineId: "wol-2",
        state: "preparing",
        name: "Vino",
        quantity: "1.000",
        course: null,
        firedAt: "2026-08-17T10:05:00.000Z",
        queuedAt: "2026-08-17T10:05:00.000Z",
      },
    ],
  },
];

function stubApi(
  overrides: Record<string, unknown> = {},
): TillApi & { fireCourse: ReturnType<typeof vi.fn> } {
  return {
    previewPartyAllergy: vi.fn(async (partyId: string) => ({
      partyId,
      snapshot: {
        answer: "none",
        guests: [],
        ticks: [],
        changedAt: null,
        changedBy: null,
        revision: 12,
      },
      dishes: [],
    })),
    listStations: vi.fn().mockResolvedValue(stations),
    getFindBill: vi.fn(async (workingOrderId: string) => ({
      workingOrderId,
      partyId: null,
      edit: null,
    })),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "dev-1",
      formFactor: "till",
      name: "Till",
      kitchenScreens: [],
    }),
    getStationQueue: vi
      .fn()
      .mockResolvedValue({ printersDown: [], items: kitchenQueue, notices: [] }),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    markCollected: vi.fn().mockResolvedValue(undefined),
    fireCourse: vi.fn().mockResolvedValue(undefined),
    reprintOrder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi & { fireCourse: ReturnType<typeof vi.fn> };
}

// Captured before any test fakes timers, so `flush` still yields a real macrotask under fake ones.
const realSetTimeout = globalThis.setTimeout;

async function flush(el: TillStationScreen): Promise<void> {
  await new Promise((resolve) => realSetTimeout(resolve, 0));
  await el.updateComplete;
}

const queueWidget = (el: TillStationScreen) =>
  el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue");

const COLUMNS_PREFIX = "waitron.kitchenColumns.";
const BOX = "https://box.local";

const columnsKey = (stationId: string) =>
  `${COLUMNS_PREFIX}v1.${JSON.stringify([BOX, "dev-1", "station", stationId])}`;

const storedColumnKeys = (): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(COLUMNS_PREFIX)) keys.push(key);
  }
  return keys;
};

const clearStoredColumns = () => {
  for (const key of storedColumnKeys()) localStorage.removeItem(key);
};

const columnToggle = (queue: TillStationQueue, key: string) =>
  queue.shadowRoot!.querySelector<HTMLElement>(`[data-column-toggle="${key}"]`)!;

const isCollapsed = (queue: TillStationQueue, key: string) =>
  columnToggle(queue, key).getAttribute("aria-expanded") === "false";

async function tapColumn(el: TillStationScreen, key: string, queue = queueWidget(el)!) {
  columnToggle(queue, key).click();
  await flush(el);
}

const columnsWindow = (el: TillStationScreen) =>
  el.shadowRoot!.querySelector<TillKitchenColumnsDialog>("till-kitchen-columns-dialog");

const windowPart = (el: TillStationScreen, selector: string) =>
  columnsWindow(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;

const windowBoardName = (el: TillStationScreen) =>
  columnsWindow(el)!.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.description;

async function openColumns(el: TillStationScreen, queue = queueWidget(el)!) {
  await userEvent.click(queue.shadowRoot!.querySelector<HTMLElement>("[data-columns-open]")!);
  await flush(el);
}

async function pressInWindow(el: TillStationScreen, selector: string) {
  await userEvent.click(windowPart(el, selector));
  await flush(el);
}

const leadChildren = (queue: TillStationQueue) =>
  [...queue.children].filter((child) => child.getAttribute("slot") === "lead");

beforeEach(async () => {
  await page.viewport(1280, 900);
});
afterEach(resetPage);
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
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] }) // default station on connect
        .mockResolvedValueOnce({ printersDown: [], items: barQueue, notices: [] }), // the picked station
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(api.getStationQueue).toHaveBeenLastCalledWith("st-2");
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.classList).toContain("active");
  });

  it("hands the widget each station's orders with their own bump mode", async () => {
    const ticketQueue = kitchenQueue.map((group) => ({ ...group, bumpMode: "ticket" as const }));
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValue({ printersDown: [], items: ticketQueue, notices: [] }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(queueWidget(el)!.groups[0]!.bumpMode).toBe("ticket");
    await queueWidget(el)!.updateComplete;
    expect(
      queueWidget(el)!.shadowRoot!.querySelector('button[data-item="ti-1"] .visually-hidden')!
        .textContent,
    ).toBe("Advance ticket #5");
  });

  it("A773 waiter authority: leaves the retired control out of the queue widget", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      ...{ fireControl: "kitchen" },
    });
    await flush(el);
    expect("fireControl" in queueWidget(el)!).toBe(false);
  });

  it.each(["waiter", "kitchen", "expo"] as const)(
    "A773 waiter authority: ignores a course Fire under the former %s control",
    async (fireControl) => {
      const api = stubApi({ fireCourse: vi.fn().mockRejectedValue({ code: "course.not_found" }) });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        ...{ fireControl },
      });
      await flush(el);
      const before = queueWidget(el)!.groups;
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("fire-course", {
          detail: { orderId: "wo-1", courseId: "co-2" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.getFindBill).not.toHaveBeenCalled();
      expect(api.previewPartyAllergy).not.toHaveBeenCalled();
      expect(api.fireCourse).not.toHaveBeenCalled();
      expect(api.getStationQueue).toHaveBeenCalledOnce();
      expect(queueWidget(el)!.groups).toBe(before);
      expect(el.shadowRoot!.querySelector('till-party-allergy-dialog, [role="alert"]')).toBeNull();
    },
  );

  it("an advance-ticket-item from the widget calls advanceTicketItem then reloads the active queue", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    // The event must not escape the screen (it owns the advance; the app must not double-handle it).
    const escaped = vi.fn();
    host.addEventListener("advance-ticket-item", escaped);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-2", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.advanceTicketItem).toHaveBeenCalledWith("ti-1", "st-2", "preparing");
    // Reloaded: once on connect, once after the advance.
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(escaped).not.toHaveBeenCalled();
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
    expect(api.markCollected).toHaveBeenCalledWith(
      "wo-1",
      expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
      { signal: expect.any(AbortSignal) },
    );
    // Reloaded: once on connect, once after the handover — so the collected order drops off the display.
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("station Collect resends a lost reply with the same wire submission id", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new StationTodayApi("", fetch);
    const api = stubApi({
      markCollected: client.markCollected.bind(client),
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ items: kitchenQueue, notices: [] })
        .mockResolvedValue({ items: [], notices: [] }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("mark-collected", {
          detail: { orderId: "wo-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS);
      await flush(el);
      expect(fetch).toHaveBeenCalledTimes(2);
      const [first, second] = fetch.mock.calls;
      expect(first![0]).toBe("/api/orders/wo-1/collect");
      expect(JSON.parse(first![1].body)).toEqual({
        submissionId: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
      });
      expect(second![1].body).toBe(first![1].body);
      expect(second![1].signal).toBe(first![1].signal);
      expect(queueWidget(el)!.groups).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("station Collect holds reload and ignores a second press until its send settles", async () => {
    let finish!: () => void;
    const markCollected = vi.fn<(id: string, submissionId?: string) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const api = stubApi({ markCollected });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const held: Promise<unknown>[] = [];
    host.addEventListener("hold-reload", (event) => {
      held.push((event as CustomEvent<{ until: Promise<unknown> }>).detail.until);
    });
    const press = () =>
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("mark-collected", {
          detail: { orderId: "wo-1" },
          bubbles: true,
          composed: true,
        }),
      );
    press();
    await flush(el);
    expect(held).toHaveLength(1);
    let released = false;
    void held[0]!.then(() => {
      released = true;
    });
    expect(released).toBe(false);
    press();
    await flush(el);
    expect(markCollected).toHaveBeenCalledTimes(1);
    expect(held).toHaveLength(1);
    finish();
    await flush(el);
    expect(released).toBe(true);
    press();
    await flush(el);
    expect(markCollected).toHaveBeenCalledTimes(2);
    expect(markCollected.mock.calls[1]![1]).not.toBe(markCollected.mock.calls[0]![1]);
    expect(held).toHaveLength(2);
    finish();
    await flush(el);
  });

  it("station Collect does not resend across disconnect and reconnect", async () => {
    const markCollected = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = stubApi({ markCollected });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("mark-collected", {
          detail: { orderId: "wo-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      el.remove();
      host.append(el);
      await flush(el);
      await vi.advanceTimersByTimeAsync(SUBMIT_RETRY_PAUSE_MS);
      await flush(el);
      expect(markCollected).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed advance still reloads the queue (reconciling to server truth)", async () => {
    const api = stubApi({
      advanceTicketItem: vi.fn().mockRejectedValue({ code: "ticket.invalid_transition" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  const alertText = (el: TillStationScreen) =>
    [...el.shadowRoot!.querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent!.trim())
      .filter(Boolean);

  const bump = (el: TillStationScreen) =>
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );

  const diskFull = { code: "storage.disk_full", status: 507 };

  it("a bump refused on a full disk says so and still reloads the queue", async () => {
    const api = stubApi({ advanceTicketItem: vi.fn().mockRejectedValue(diskFull) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    bump(el);
    await flush(el);
    expect(alertText(el)).toEqual([codeMessage("storage.disk_full")]);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("the next bump clears the full-disk line", async () => {
    const advanceTicketItem = vi
      .fn()
      .mockRejectedValueOnce(diskFull)
      .mockResolvedValueOnce(undefined);
    const api = stubApi({ advanceTicketItem });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    bump(el);
    await flush(el);
    expect(alertText(el)).toEqual([codeMessage("storage.disk_full")]);
    bump(el);
    await flush(el);
    expect(alertText(el)).toEqual([]);
  });

  it("picking another station clears the full-disk line", async () => {
    const api = stubApi({ advanceTicketItem: vi.fn().mockRejectedValue(diskFull) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    bump(el);
    await flush(el);
    expect(alertText(el)).toEqual([codeMessage("storage.disk_full")]);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(alertText(el)).toEqual([]);
  });

  it("a Collect refused on a full disk says so and still reloads the queue", async () => {
    const api = stubApi({ markCollected: vi.fn().mockRejectedValue(diskFull) });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: "wo-1" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(alertText(el)).toEqual([codeMessage("storage.disk_full")]);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("a bump refused for any other reason shows no line", async () => {
    const api = stubApi({
      advanceTicketItem: vi.fn().mockRejectedValue({ code: "ticket.invalid_transition" }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    bump(el);
    await flush(el);
    expect(alertText(el)).toEqual([]);
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

  it("operator mode shows the per-order Reprint button on its card (deviceMode === false, R-K)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    expect(queueWidget(el)!.shadowRoot!.querySelector('[data-reprint="wo-1"]')).not.toBeNull();
  });

  it("clicking Reprint calls reprintOrder(orderId) and does not escape the screen", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
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
        detail: { itemId: "ti-1", stationId: "st-1", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() =>
      expect(api.advanceTicketItem).toHaveBeenCalledWith("ti-1", "st-1", "preparing"),
    );
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
    resolveReload({ printersDown: [], items: barQueue, notices: [] });
    await vi.waitFor(() => expect(queueWidget(el)!.groups).toEqual(barQueue));
  });

  it("switching to another station clears the old queue while the new one loads", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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

  it("suppresses its own header + Back when embedded, keeping the out-of-date banner", async () => {
    const api = stubApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      embedded: true,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-back]")).toBeNull();
    expect(el.shadowRoot!.querySelector(".actions .stale")).not.toBeNull();
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
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-dev",
            printersDown: [],
            queue: [],
            notices: [],
          },
        ],
      }),
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
  const boundStation = {
    id: "st-dev",
    name: "Cocina",
    available: true as const,
    today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
    printersDown: [],
    queue: kitchenQueue,
    notices: [],
  };

  /** Carries the session verbs the screen must NEVER reach in device mode, so a stray call is
   * observable. */
  function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
    return {
      getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [boundStation] }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      listStations: vi.fn().mockResolvedValue(stations),
      getStationQueue: vi
        .fn()
        .mockResolvedValue({ printersDown: [], items: kitchenQueue, notices: [] }),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
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
    expect(api.getDeviceStationScreen).toHaveBeenCalledOnce();
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
    expect(queueWidget(el)!.stationId).toBe("st-dev");
    // The station is fixed by enrolment: NO picker nav, and the session station-list/queue are never read.
    expect(el.shadowRoot!.querySelector("[data-station]")).toBeNull();
    expect(api.listStations).not.toHaveBeenCalled();
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it("cold boot adopts initialDeviceStation and does NOT re-fetch getDeviceStationScreen (fast-path, §5a)", async () => {
    // getDeviceStationScreen returns a DISTINCT queue, so losing the fast path would both re-fetch AND render
    // the wrong queue.
    const api = deviceApi({
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-dev",
            printersDown: [],
            queue: barQueue,
            notices: [],
          },
        ],
      }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      initialDeviceStation: { stations: [boundStation] },
    });
    await flush(el);
    expect(api.getDeviceStationScreen).not.toHaveBeenCalled();
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
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
        getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
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
        getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "server.internal" }),
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

  it("a per-line bump routes through deviceAdvance (never the session verb) and reloads via getDeviceStationScreen", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
    expect(api.advanceTicketItem).not.toHaveBeenCalled();
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
  });

  it("a kitchen display's bump refused on a full disk says so", async () => {
    const api = deviceApi({
      deviceAdvance: vi.fn().mockRejectedValue({ code: "storage.disk_full", status: 507 }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    const lines = [...el.shadowRoot!.querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent!.trim())
      .filter(Boolean);
    expect(lines).toEqual([codeMessage("storage.disk_full")]);
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
  });

  it("a kitchen display's full-disk line clears when the device's stations change", async () => {
    const api = deviceApi({
      deviceAdvance: vi.fn().mockRejectedValue({ code: "storage.disk_full", status: 507 }),
    });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    const lines = () =>
      [...el.shadowRoot!.querySelectorAll('[role="alert"]')]
        .map((node) => node.textContent!.trim())
        .filter(Boolean);
    expect(lines()).toEqual([codeMessage("storage.disk_full")]);
    vi.mocked(api.getDeviceStationScreen).mockResolvedValue({
      stations: [{ ...boundStation, id: "st-bar", name: "Barra" }],
    });
    // Reconnecting reads the device's stations again, as a refresh does.
    host.removeChild(el);
    host.appendChild(el);
    await flush(el);
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(3);
    expect(lines()).toEqual([]);
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
    // boundStation's kitchenQueue is a SETTLED Mode-P order → collectable on the OPERATOR path; in device
    // mode the advance-only widget must not render the handover button.
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    expect(queueWidget(el)!.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("device mode hides the kitchen-fire button on a held course (no device fire route, §3d)", async () => {
    const heldCourseQueue: StationQueueGroup[] = [
      {
        kitchenNote: null,
        orderId: "wo-h",
        orderNumber: 9,
        label: null,
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "placed",
        thresholds: DEFAULT_THRESHOLDS,
        bumpMode: "line",
        items: [
          {
            allergy: null,
            id: "it-h",
            workingOrderLineId: "wl-h",
            state: "queued",
            name: "Solomillo",
            quantity: "1.000",
            // A HELD later course — normally fireable under `fire_control = 'kitchen'`.
            course: { id: "co-h", name: "Principales", displayOrder: 2 },
            firedAt: null,
            queuedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const api = deviceApi({
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Cocina",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-dev",
            printersDown: [],
            queue: heldCourseQueue,
            notices: [],
          },
        ],
      }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      ...{ fireControl: "kitchen" },
    });
    await flush(el);
    expect(queueWidget(el)!.shadowRoot!.querySelector("[data-fire]")).toBeNull();
  });

  it("device mode hides the Reprint button (session-guarded route, no device session — R-K)", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
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
    expect(api.getDeviceStationScreen).toHaveBeenCalledOnce();
  });

  it("a failed device reload after a bump leaves the last-known queue in place, shows the out-of-date banner and re-boots nothing", async () => {
    // The post-bump reload rejects: the display keeps its last-known queue rather than blanking.
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const getDeviceStationScreen = vi
        .fn()
        .mockResolvedValueOnce({ stations: [boundStation] }) // connect
        .mockRejectedValueOnce({ code: "device.unauthorized" }); // reload after the bump fails
      const api = deviceApi({ getDeviceStationScreen });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      // Bump attempted, reload rejected, last-known queue retained (the widget still renders it).
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
      expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
      expect(el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      expect(reboot).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("device-unauthorized", reboot);
    }
  });

  it("a heading tap on a kitchen display advances each of its dishes through deviceAdvance", async () => {
    const twoLine: StationQueueGroup[] = [
      {
        kitchenNote: null,
        orderId: "wo-1",
        orderNumber: 5,
        label: null,
        queuedAt: "2026-08-17T10:00:00.000Z",
        status: "placed",
        thresholds: DEFAULT_THRESHOLDS,
        bumpMode: "ticket",
        items: [
          {
            allergy: null,
            id: "ti-a",
            workingOrderLineId: "wl-a",
            state: "queued",
            name: "A",
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
            queuedAt: "2026-08-17T10:00:00.000Z",
          },
          {
            allergy: null,
            id: "ti-b",
            workingOrderLineId: "wl-b",
            state: "queued",
            name: "B",
            quantity: "1.000",
            course: null,
            firedAt: "2026-08-17T10:00:00.000Z",
            queuedAt: "2026-08-17T10:00:00.000Z",
          },
        ],
      },
    ];
    const api = deviceApi({
      getDeviceStationScreen: vi.fn().mockResolvedValue({
        stations: [
          {
            name: "Kitchen",
            available: true,
            today: {
              open: true,
              isDefault: false,
              byHand: null,
              sendsTo: null,
              why: "open" as const,
            },
            id: "st-dev",
            printersDown: [],
            queue: twoLine,
            notices: [],
          },
        ],
      }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    const queue = queueWidget(el)!;
    await queue.updateComplete;
    queue.shadowRoot!.querySelector<HTMLElement>("button[data-card-head]")!.click();
    await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.deviceAdvance).mock.calls).toEqual([
      ["ti-a", "preparing"],
      ["ti-b", "preparing"],
    ]);
    expect(api.advanceTicketItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a bump",
      "line",
      "advance-ticket-item",
      { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
    ],
    [
      "a whole-ticket bump",
      "ticket",
      "advance-dishes",
      { itemIds: ["ti-1"], stationId: "st-dev", to: "preparing" },
    ],
  ] as const)(
    "%s refused device.unauthorized asks at once to switch, naming the station screen",
    async (_name, bumpMode, type, detail) => {
      const switched = vi.fn();
      document.addEventListener("kitchen-screen-changed", switched);
      try {
        const api = deviceApi({
          getDeviceStationScreen: vi.fn().mockResolvedValue({
            stations: [
              {
                ...boundStation,
                queue: kitchenQueue.map((group) => ({ ...group, bumpMode })),
              },
            ],
          }),
          deviceAdvance: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
        });
        const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
          api,
          deviceMode: true,
        });
        await flush(el);
        queueWidget(el)!.dispatchEvent(
          new CustomEvent(type, { detail, bubbles: true, composed: true }),
        );
        await flush(el);
        expect(switched).toHaveBeenCalledTimes(1);
        expect((switched.mock.calls[0]![0] as CustomEvent<{ from: string }>).detail.from).toBe(
          "station",
        );
        expect(api.getDeviceStationScreen).toHaveBeenCalledOnce();
      } finally {
        document.removeEventListener("kitchen-screen-changed", switched);
      }
    },
  );
});

describe("till-station-screen device mode with several stations (A366 decision 7)", () => {
  const kitchenNotice: KitchenNotice = {
    id: "kn-cocina",
    stationId: "st-1",
    workingOrderId: "wo-1",
    orderLabel: "#5 · Mesa 4",
    kind: "void",
    lineName: "Paella",
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
  const available = (
    id: string,
    name: string,
    queue: StationQueueGroup[],
    notices: KitchenNotice[] = [],
  ) => ({
    id,
    name,
    available: true as const,
    today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
    queue,
    notices,
    printersDown: [] as { printerId: string; printerName: string; since: string }[],
  });
  const gone = (id: string, name: string) => ({
    id,
    name,
    available: false as const,
    switchedOff: false as const,
  });
  /** A station switched off on its own page, still holding the dishes waiting there. */
  const switchedOff = (
    id: string,
    name: string,
    queue: StationQueueGroup[],
    notices: KitchenNotice[] = [],
  ) => ({
    ...available(id, name, queue, notices),
    available: false as const,
    switchedOff: true as const,
    today: {
      open: false,
      isDefault: false,
      byHand: null,
      sendsTo: null,
      why: "switched_off" as const,
    },
  });
  const deliQueue: StationQueueGroup[] = [
    {
      ...kitchenQueue[0]!,
      orderId: "wo-3",
      orderNumber: 7,
      queuedAt: "2026-08-17T09:30:00.000Z",
      items: [{ ...kitchenQueue[0]!.items[0]!, id: "ti-3", workingOrderLineId: "wol-3" }],
    },
  ];
  const deliNotice: KitchenNotice = { ...kitchenNotice, id: "kn-deli", stationId: "st-deli" };

  async function mountDevice(screen: DeviceStationScreen, overrides: Record<string, unknown> = {}) {
    const api = {
      getDeviceStationScreen: vi.fn().mockResolvedValue(screen),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    return { el, api };
  }

  const sections = (el: TillStationScreen) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-device-station]"),
  ];
  const sectionQueue = (section: HTMLElement) =>
    section.querySelector<TillStationQueue>("till-station-queue");

  it("two stations render two sections, each named and with its own queue and notices", async () => {
    const printer = { printerId: "p-1", printerName: "Epson", since: "2026-08-17T18:14:00Z" };
    const { el } = await mountDevice({
      stations: [
        { ...available("st-1", "Cocina", kitchenQueue, [kitchenNotice]), printersDown: [printer] },
        available("st-2", "Barra", barQueue),
      ],
    });
    const [first, second] = sections(el);
    expect(sections(el)).toHaveLength(2);
    expect(first!.dataset.deviceStation).toBe("st-1");
    expect(first!.querySelector("h2")!.textContent!.trim()).toBe("Cocina");
    expect(sectionQueue(first!)!.groups).toEqual(kitchenQueue);
    expect(sectionQueue(first!)!.notices).toEqual([kitchenNotice]);
    expect(sectionQueue(first!)!.stationId).toBe("st-1");
    expect(first!.querySelectorAll("[data-printer-down]")).toHaveLength(1);
    expect(second!.querySelector("h2")!.textContent!.trim()).toBe("Barra");
    expect(sectionQueue(second!)!.groups).toEqual(barQueue);
    expect(sectionQueue(second!)!.notices).toEqual([]);
    expect(sectionQueue(second!)!.stationId).toBe("st-2");
    expect(second!.querySelectorAll("[data-printer-down]")).toHaveLength(0);
  });

  it("one station renders without a section, its name in its board's header row", async () => {
    const { el } = await mountDevice({ stations: [available("st-1", "Cocina", kitchenQueue)] });
    expect(sections(el)).toHaveLength(0);
    const names = el.shadowRoot!.querySelectorAll("h2.station-name");
    expect(names).toHaveLength(1);
    expect(names[0]!.parentElement).toBe(queueWidget(el));
    expect(names[0]!.getAttribute("slot")).toBe("lead");
    expect(names[0]!.textContent!.trim()).toBe("Cocina");
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
  });

  it("bumping in the second section advances that section's item", async () => {
    const { el, api } = await mountDevice({
      stations: [available("st-1", "Cocina", kitchenQueue), available("st-2", "Barra", barQueue)],
    });
    sectionQueue(sections(el)[1]!)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-2", stationId: "st-2", to: "ready" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-2", "ready");
    expect(api.advanceTicketItem).not.toHaveBeenCalled();
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
  });

  it("a whole-ticket bump in a section advances that station's lines of an order both stations hold", async () => {
    const sameOrderAtBarra: StationQueueGroup[] = [
      {
        ...barQueue[0]!,
        orderId: "wo-1",
        bumpMode: "ticket",
        items: [{ ...barQueue[0]!.items[0]!, state: "queued" }],
      },
    ];
    const { el, api } = await mountDevice({
      stations: [
        available("st-1", "Cocina", kitchenQueue),
        available("st-2", "Barra", sameOrderAtBarra),
      ],
    });
    const barra = sectionQueue(sections(el)[1]!)!;
    await barra.updateComplete;
    barra.shadowRoot!.querySelector<HTMLElement>('button[data-item="ti-2"]')!.click();
    await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2));
    expect(api.deviceAdvance).toHaveBeenCalledTimes(1);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-2", "preparing");
  });

  it("a station no longer available keeps its section between its neighbours, holding only its line", async () => {
    const { el } = await mountDevice({
      stations: [
        available("st-1", "Cocina", kitchenQueue),
        gone("st-deli", "Deli"),
        available("st-2", "Barra", barQueue),
      ],
    });
    const all = sections(el);
    expect(all.map((section) => section.dataset.deviceStation)).toEqual([
      "st-1",
      "st-deli",
      "st-2",
    ]);
    const deli = all[1]!;
    expect(sectionQueue(deli)).toBeNull();
    expect(deli.querySelector("h2")).toBeNull();
    expect(deli.querySelector("[data-station-unavailable]")!.textContent!.trim()).toBe(
      "This station is no longer available: Deli",
    );
    expect(el.shadowRoot!.querySelectorAll("[data-station-unavailable]")).toHaveLength(1);
  });

  describe("a station switched off on its own page (owner 2026-10-09)", () => {
    it("the Columns window: a station drawn while unavailable has only today's control in its header row", async () => {
      const { el } = await mountDevice({
        stations: [
          available("st-1", "Cocina", kitchenQueue),
          switchedOff("st-deli", "Deli", deliQueue, [deliNotice]),
        ],
      });
      const deli = sections(el)[1]!;
      const queue = sectionQueue(deli)!;
      expect(leadChildren(queue).map((child) => child.tagName.toLowerCase())).toEqual([
        "till-station-today",
      ]);
      expect(deli.querySelector("h2")).toBeNull();
      const line = deli.querySelector("[data-station-unavailable]")!;
      expect(line.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("shows its line and then the dishes still waiting there, which bump", async () => {
      const { el, api } = await mountDevice({
        stations: [
          available("st-1", "Cocina", kitchenQueue),
          switchedOff("st-deli", "Deli", deliQueue, [deliNotice]),
        ],
      });
      const deli = sections(el)[1]!;
      expect(deli.dataset.deviceStation).toBe("st-deli");
      const line = deli.querySelector("[data-station-unavailable]")!;
      expect(line.textContent!.trim()).toBe("This station is no longer available: Deli");
      const queue = sectionQueue(deli)!;
      expect(queue.groups).toEqual(deliQueue);
      expect(queue.notices).toEqual([deliNotice]);
      expect(queue.stationId).toBe("st-deli");
      expect(line.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      queue.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-3", stationId: "st-deli", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-3", "preparing");
    });

    it("as the only station, keeps its dish until the queue is empty, then guides", async () => {
      const { el, api } = await mountDevice({
        stations: [switchedOff("st-deli", "Deli", deliQueue)],
      });
      expect(el.shadowRoot!.querySelector("[data-choose-again]")).toBeNull();
      const queue = el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!;
      expect(queue.groups).toEqual(deliQueue);
      vi.mocked(api.getDeviceStationScreen).mockResolvedValue({
        stations: [switchedOff("st-deli", "Deli", [])],
      });
      queue.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-3", stationId: "st-deli", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-3", "preparing");
      expect(el.shadowRoot!.querySelector("till-station-queue")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-choose-again]")).not.toBeNull();
      expect(el.shadowRoot!.querySelectorAll("[data-station-unavailable]")).toHaveLength(1);
    });

    it("acknowledging its notice goes through the device route and removes it", async () => {
      const { el, api } = await mountDevice(
        {
          stations: [
            available("st-1", "Cocina", kitchenQueue),
            switchedOff("st-deli", "Deli", deliQueue, [deliNotice]),
          ],
        },
        { deviceAcknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined) },
      );
      sectionQueue(sections(el)[1]!)!.dispatchEvent(
        new CustomEvent("acknowledge-notice", {
          detail: { noticeId: "kn-deli" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.deviceAcknowledgeKitchenNotice).toHaveBeenCalledWith("kn-deli");
      expect(sectionQueue(sections(el)[1]!)!.notices).toEqual([]);
    });
  });

  it("reads the line in Spanish", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountDevice({
        stations: [available("st-1", "Cocina", kitchenQueue), gone("st-deli", "Deli")],
      });
      expect(el.shadowRoot!.querySelector("[data-station-unavailable]")!.textContent!.trim()).toBe(
        "Esta estación ya no está disponible: Deli",
      );
    } finally {
      setLocale("en-GB");
    }
  });

  it("with no station left available, shows only the lines", async () => {
    const { el } = await mountDevice({
      stations: [gone("st-deli", "Deli"), gone("st-bar", "Barra")],
    });
    expect(el.shadowRoot!.querySelector("till-station-queue")).toBeNull();
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-station-unavailable]")].map((line) =>
        line.textContent!.trim(),
      ),
    ).toEqual([
      "This station is no longer available: Deli",
      "This station is no longer available: Barra",
    ]);
    expect(el.shadowRoot!.querySelector("[data-merge-toggle]")).toBeNull();
    const guidance = el.shadowRoot!.querySelector<HTMLElement>("[data-choose-again]")!;
    expect(guidance.textContent!.trim()).toBe(
      "Ask a manager to choose its screens again in Devices.",
    );
    const last = [...el.shadowRoot!.querySelectorAll("[data-station-unavailable]")].at(-1)!;
    expect(last.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with no station left available, says in Spanish who chooses its screens again", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountDevice({ stations: [gone("st-deli", "Deli")] });
      expect(el.shadowRoot!.querySelector("[data-choose-again]")!.textContent!.trim()).toBe(
        "Pide a un responsable que vuelva a elegir sus pantallas en Dispositivos.",
      );
    } finally {
      setLocale("en-GB");
    }
  });

  it("with no station left available and the merged view remembered, shows no queue", async () => {
    localStorage.setItem("waitron.stationScreenView.dev-gone", "merged");
    try {
      const api = {
        getDeviceStationScreen: vi.fn().mockResolvedValue({
          stations: [gone("st-deli", "Deli"), gone("st-bar", "Barra")],
        }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
        deviceId: "dev-gone",
      });
      await flush(el);
      expect(el.shadowRoot!.querySelector("till-station-queue")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("[data-station-unavailable]")).toHaveLength(2);
      expect(el.shadowRoot!.querySelector("[data-choose-again]")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("[data-merge-toggle]")).toBeNull();
    } finally {
      localStorage.removeItem("waitron.stationScreenView.dev-gone");
    }
  });

  it("with one station still available, offers the merge switch and no guidance", async () => {
    const { el } = await mountDevice({
      stations: [gone("st-deli", "Deli"), available("st-1", "Cocina", kitchenQueue)],
    });
    expect(el.shadowRoot!.querySelector("[data-merge-toggle]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-choose-again]")).toBeNull();
  });

  it("acknowledging a notice in one section removes it there", async () => {
    const { el } = await mountDevice(
      {
        stations: [
          available("st-1", "Cocina", kitchenQueue, [kitchenNotice]),
          available("st-2", "Barra", barQueue),
        ],
      },
      { deviceAcknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined) },
    );
    sectionQueue(sections(el)[0]!)!.dispatchEvent(
      new CustomEvent("acknowledge-notice", {
        detail: { noticeId: "kn-cocina" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(sectionQueue(sections(el)[0]!)!.notices).toEqual([]);
  });

  it("offers no Board or Tickets switch, on a till or a kitchen display", async () => {
    const { el: till } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: stubApi(),
    });
    await flush(till);
    expect(till.shadowRoot!.querySelector("till-station-queue")).not.toBeNull();
    expect(till.shadowRoot!.querySelector("[data-view-toggle]")).toBeNull();
    const { el: display } = await mountDevice({
      stations: [available("st-1", "Kitchen", kitchenQueue), available("st-2", "Bar", barQueue)],
    });
    expect(display.shadowRoot!.querySelector("till-station-queue")).not.toBeNull();
    expect(display.shadowRoot!.querySelector("[data-view-toggle]")).toBeNull();
    expect(display.shadowRoot!.querySelector("[data-merge-toggle]")).not.toBeNull();
  });

  describe("the merged view (A12b)", () => {
    const viewKey = (deviceId: string) => `waitron.stationScreenView.${deviceId}`;
    afterEach(() => {
      for (const id of ["dev-1", "dev-2"]) localStorage.removeItem(viewKey(id));
      vi.restoreAllMocks();
    });

    const olderBarQueue: StationQueueGroup[] = [
      { ...barQueue[0]!, queuedAt: "2026-08-17T09:00:00.000Z" },
    ];
    const barNotice: KitchenNotice = { ...kitchenNotice, id: "kn-barra", stationId: "st-2" };
    const twoStations: DeviceStationScreen = {
      stations: [
        {
          ...available("st-1", "Cocina", kitchenQueue, [kitchenNotice]),
          printersDown: [{ printerId: "p-1", printerName: "Epson", since: "2026-08-17T18:14:00Z" }],
        },
        gone("st-deli", "Deli"),
        available("st-2", "Barra", olderBarQueue, [barNotice]),
      ],
    };

    async function mountFor(deviceId: string | undefined, screen = twoStations) {
      const api = {
        getDeviceStationScreen: vi.fn().mockResolvedValue(screen),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
        advanceTicketItem: vi.fn().mockResolvedValue(undefined),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
        deviceId,
      });
      await flush(el);
      return { el, api };
    }

    const toggle = (el: TillStationScreen) =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-merge-toggle]");

    async function merge(el: TillStationScreen) {
      toggle(el)!.click();
      await el.updateComplete;
    }

    it("the Columns window: each stacked board's header row holds its own station; the merged board's holds none", async () => {
      const { el } = await mountFor("dev-1");
      for (const section of [sections(el)[0]!, sections(el)[2]!]) {
        const queue = sectionQueue(section)!;
        const name = section.querySelector("h2.station-name")!;
        const today = section.querySelector("till-station-today")!;
        expect(leadChildren(queue)).toEqual([name, today]);
      }
      await merge(el);
      expect(leadChildren(queueWidget(el)!)).toEqual([]);
      expect(el.shadowRoot!.querySelectorAll("[data-station-controls]")).toHaveLength(2);
    });

    it("the Columns window: Cocina's printer-down line follows its header row", async () => {
      const { el } = await mountFor("dev-1");
      const cocina = sections(el)[0]!;
      const line = cocina.querySelector("[data-printer-down]")!;
      expect(line.parentElement).toBe(sectionQueue(cocina));
      expect(line.getAttribute("slot")).toBe("status");
    });

    it.each([
      ["one station", "Cocina"],
      ["the second stacked board", "Barra"],
      ["the merged board", "Cocina and Barra"],
    ])(
      "the Columns window: Columns opens the window named for its board (%s)",
      async (board, name) => {
        if (board === "one station") {
          const { el } = await mountFor("dev-1", {
            stations: [available("st-1", "Cocina", kitchenQueue)],
          });
          await openColumns(el);
          expect(windowBoardName(el)).toBe(name);
          return;
        }
        const { el } = await mountFor("dev-1");
        if (board === "the merged board") await merge(el);
        await openColumns(
          el,
          board === "the merged board" ? queueWidget(el)! : sectionQueue(sections(el)[2]!)!,
        );
        expect(windowBoardName(el)).toBe(name);
      },
    );

    it("the Columns window: hiding a column hides it on that board only, and showing it brings it back", async () => {
      const { el } = await mountFor("dev-1");
      const cocina = () => sectionQueue(sections(el)[0]!)!;
      const barra = () => sectionQueue(sections(el)[2]!)!;
      await openColumns(el, cocina());
      await pressInWindow(el, '[data-column-show="ready"]');
      expect(cocina().columns.hidden).toEqual(["ready"]);
      expect(barra().columns.hidden).toEqual([]);
      await pressInWindow(el, "[data-columns-done]");
      await vi.waitFor(() => expect(columnsWindow(el)).toBeNull());
      await merge(el);
      expect(queueWidget(el)!.columns.hidden).toEqual([]);
      await merge(el);
      expect(cocina().columns.hidden).toEqual(["ready"]);
      await openColumns(el, cocina());
      await pressInWindow(el, '[data-column-show="ready"]');
      expect(cocina().columns.hidden).toEqual([]);
    });

    it("offers the switch with two stations, in the actions row, and opens stacked", async () => {
      const { el } = await mountFor("dev-1");
      expect(toggle(el)!.textContent!.trim()).toBe("Merged");
      expect(toggle(el)!.parentElement).toBe(el.shadowRoot!.querySelector(".actions"));
      expect(sections(el)).toHaveLength(3);
    });

    it("offers no switch with one station", async () => {
      const { el } = await mountFor("dev-1", {
        stations: [available("st-1", "Cocina", kitchenQueue)],
      });
      expect(toggle(el)).toBeNull();
    });

    it("merged shows one queue, oldest first, each order labelled by its station", async () => {
      const { el } = await mountFor("dev-1");
      await merge(el);
      expect(sections(el)).toHaveLength(0);
      const queues = el.shadowRoot!.querySelectorAll<TillStationQueue>("till-station-queue");
      expect(queues).toHaveLength(1);
      const queue = queues[0]!;
      expect(queue.groups.map((group) => [group.orderId, group.stationId])).toEqual([
        ["wo-2", "st-2"],
        ["wo-1", "st-1"],
      ]);
      expect([...queue.stationNames!]).toEqual([
        ["st-1", "Cocina"],
        ["st-2", "Barra"],
      ]);
      expect(queue.notices.map((notice) => notice.id)).toEqual(["kn-cocina", "kn-barra"]);
      expect(toggle(el)!.textContent!.trim()).toBe("Stacked");
    });

    it("merged keeps the printers-down and no-longer-available lines above the queue, in station order", async () => {
      const { el } = await mountFor("dev-1");
      await merge(el);
      const lines = [
        ...el.shadowRoot!.querySelectorAll<HTMLElement>(
          "[data-printer-down], [data-station-unavailable]",
        ),
      ];
      expect(lines.map((line) => line.textContent!.replace(/\s+/g, " ").trim())).toEqual([
        expect.stringMatching(/^Cocina: .*Epson/),
        "This station is no longer available: Deli",
      ]);
      const queue = el.shadowRoot!.querySelector("till-station-queue")!;
      for (const line of lines)
        expect(line.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("merged takes in a switched-off station's waiting dishes, labelled, under its line", async () => {
      const { el, api } = await mountFor("dev-1", {
        stations: [
          available("st-1", "Cocina", kitchenQueue, [kitchenNotice]),
          switchedOff("st-deli", "Deli", deliQueue, [deliNotice]),
          available("st-2", "Barra", olderBarQueue),
        ],
      });
      await merge(el);
      const queue = el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!;
      expect(queue.groups.map((group) => [group.orderId, group.stationId])).toEqual([
        ["wo-2", "st-2"],
        ["wo-3", "st-deli"],
        ["wo-1", "st-1"],
      ]);
      expect(queue.stationNames!.get("st-deli")).toBe("Deli");
      expect(queue.notices.map((notice) => notice.id)).toEqual(["kn-cocina", "kn-deli"]);
      const line = el.shadowRoot!.querySelector("[data-station-unavailable]")!;
      expect(line.textContent!.trim()).toBe("This station is no longer available: Deli");
      expect(line.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      queue.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: "ti-3", stationId: "st-deli", to: "preparing" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-3", "preparing");
    });

    it("a whole-ticket bump in merged advances that order's lines at its own station", async () => {
      const sameOrderAtBarra: StationQueueGroup[] = [
        {
          ...barQueue[0]!,
          orderId: "wo-1",
          bumpMode: "ticket",
          items: [{ ...barQueue[0]!.items[0]!, state: "queued" }],
        },
      ];
      const { el, api } = await mountFor("dev-1", {
        stations: [
          available("st-1", "Cocina", kitchenQueue),
          available("st-2", "Barra", sameOrderAtBarra),
        ],
      });
      await merge(el);
      const queue = el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!;
      queue.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!.click();
      await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2));
      expect(api.deviceAdvance).toHaveBeenCalledTimes(1);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-2", "preparing");
    });

    it("a merged device screen bumps a whole order at one station and a single dish at another", async () => {
      const wholeOrderAtKitchen: StationQueueGroup[] = [
        {
          ...kitchenQueue[0]!,
          bumpMode: "ticket",
          items: [
            kitchenQueue[0]!.items[0]!,
            { ...kitchenQueue[0]!.items[0]!, id: "ti-1b", workingOrderLineId: "wol-1b" },
          ],
        },
      ];
      const { el, api } = await mountFor("dev-1", {
        stations: [
          available("st-1", "Cocina", wholeOrderAtKitchen),
          available("st-2", "Barra", olderBarQueue),
        ],
      });
      await merge(el);
      const queue = el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!;
      const holder = (itemId: string) =>
        queue.shadowRoot!.querySelector(`[data-item="${itemId}"]`)!.closest(".ticket")!;
      const marks = [...queue.shadowRoot!.querySelectorAll<HTMLElement>("[data-whole-ticket]")];
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) {
        expect([holder("ti-1"), holder("ti-1b")]).toContain(mark.closest(".ticket"));
        expect(mark.getBoundingClientRect().width).toBeGreaterThan(1);
      }
      expect(holder("ti-1").querySelector("[data-whole-ticket]")).not.toBeNull();
      expect(holder("ti-2").querySelector("[data-whole-ticket]")).toBeNull();
      const ticket = vi.fn();
      const item = vi.fn();
      queue.addEventListener("advance-dishes", (e) => ticket((e as CustomEvent).detail));
      queue.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
      queue.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
      await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2));
      expect(ticket).toHaveBeenCalledWith({
        itemIds: ["ti-1", "ti-1b"],
        stationId: "st-1",
        to: "preparing",
      });
      expect(item).not.toHaveBeenCalled();
      expect(api.deviceAdvance).toHaveBeenCalledTimes(2);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1b", "preparing");
      await el.updateComplete;
      await queue.updateComplete;
      queue.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!.click();
      await vi.waitFor(() => expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(3));
      expect(item).toHaveBeenCalledWith({ itemId: "ti-2", stationId: "st-2", to: "ready" });
      expect(ticket).toHaveBeenCalledOnce();
      expect(api.deviceAdvance).toHaveBeenCalledTimes(3);
      expect(api.deviceAdvance).toHaveBeenLastCalledWith("ti-2", "ready");
    });

    it("a line bump in merged advances that item", async () => {
      const { el, api } = await mountFor("dev-1");
      await merge(el);
      el.shadowRoot!.querySelector<TillStationQueue>("till-station-queue")!
        .shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!
        .click();
      await flush(el);
      expect(api.deviceAdvance).toHaveBeenCalledWith("ti-2", "ready");
    });

    it("remembers the choice for its device id across a reload, and not for another device", async () => {
      const first = await mountFor("dev-1");
      await merge(first.el);
      cleanupWidgets();
      const again = await mountFor("dev-1");
      expect(again.el.shadowRoot!.querySelectorAll("till-station-queue")).toHaveLength(1);
      expect(toggle(again.el)!.textContent!.trim()).toBe("Stacked");
      const other = await mountFor("dev-2");
      expect(sections(other.el)).toHaveLength(3);
    });

    it("switching back to stacked is remembered too", async () => {
      const first = await mountFor("dev-1");
      await merge(first.el);
      await merge(first.el);
      cleanupWidgets();
      const again = await mountFor("dev-1");
      expect(sections(again.el)).toHaveLength(3);
    });

    it("a local storage that throws leaves it stacked, and the switch still works", async () => {
      localStorage.setItem(viewKey("dev-1"), "merged");
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      const { el } = await mountFor("dev-1");
      expect(sections(el)).toHaveLength(3);
      await merge(el);
      expect(el.shadowRoot!.querySelectorAll("till-station-queue")).toHaveLength(1);
    });

    it("reads the switch in Spanish", async () => {
      setLocale("es-ES");
      try {
        const { el } = await mountFor("dev-1");
        expect(toggle(el)!.textContent!.trim()).toBe("Todo junto");
        await merge(el);
        expect(toggle(el)!.textContent!.trim()).toBe("Por estación");
      } finally {
        setLocale("en-GB");
      }
    });

    describe("the device's kitchen columns", () => {
      afterEach(clearStoredColumns);

      it("the device's kitchen columns: a kitchen display keeps each stacked station's columns, and the merged board's apart", async () => {
        const api = {
          getDeviceStationScreen: vi.fn().mockResolvedValue(twoStations),
        } as unknown as TillApi;
        const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
          api,
          deviceMode: true,
          deviceId: "dev-1",
          serverOrigin: BOX,
        });
        await flush(el);
        const queueOf = (id: string) =>
          sectionQueue(
            el.shadowRoot!.querySelector<HTMLElement>(`[data-device-station="${id}"]`)!,
          )!;

        await tapColumn(el, "ready", queueOf("st-1"));
        expect(isCollapsed(queueOf("st-1"), "ready")).toBe(true);
        expect(isCollapsed(queueOf("st-2"), "ready")).toBe(false);

        await merge(el);
        expect(isCollapsed(queueWidget(el)!, "ready")).toBe(false);
        await tapColumn(el, "waiting");
        expect(isCollapsed(queueWidget(el)!, "waiting")).toBe(true);

        await merge(el);
        await flush(el);
        expect(isCollapsed(queueOf("st-1"), "ready")).toBe(true);
        expect(isCollapsed(queueOf("st-2"), "ready")).toBe(false);
        expect(isCollapsed(queueOf("st-1"), "waiting")).toBe(false);
        expect(isCollapsed(queueOf("st-2"), "waiting")).toBe(false);
      });
    });
  });
});

describe("till-station-screen follows its device's station screen choice (A366 decision 20)", () => {
  const venueStations: Station[] = [
    {
      id: "st-c",
      name: "Cocina",
      isDefault: true,
      active: true,
      open: true,
      byHand: null,
      sendsTo: null,
      why: "default",
    },
    {
      id: "st-g",
      name: "Grill",
      isDefault: false,
      active: true,
      open: true,
      byHand: null,
      sendsTo: null,
      why: "open",
    },
    {
      id: "st-f",
      name: "Fryer",
      isDefault: false,
      active: true,
      open: true,
      byHand: null,
      sendsTo: null,
      why: "open",
    },
  ];
  const identity = (kitchenScreens: ResolvedKitchenScreen[]): DeviceIdentity => ({
    deviceId: "dev-till",
    formFactor: "till",
    name: "Till 1",
    kitchenScreens,
  });
  const stationScreen = (
    slots: { id: string; name: string; available: boolean }[],
  ): ResolvedKitchenScreen => ({ kind: "station", available: true, stations: slots, zones: null });

  async function mountOperator(identityRead: () => Promise<DeviceIdentity>) {
    const api = stubApi({
      listStations: vi.fn().mockResolvedValue(venueStations),
      getDeviceIdentity: vi.fn(identityRead),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    return { el, api };
  }

  const picks = (el: TillStationScreen) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-station]")].map(
      (pick) => pick.dataset.station,
    );
  const lines = (el: TillStationScreen) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-station-unavailable]")].map((line) =>
      line.textContent!.trim(),
    );

  it("a till that chose Grill and Fryer shows two picks and opens the first of them", async () => {
    const { el, api } = await mountOperator(() =>
      Promise.resolve(
        identity([
          stationScreen([
            { id: "st-g", name: "Grill", available: true },
            { id: "st-f", name: "Fryer", available: true },
          ]),
        ]),
      ),
    );
    expect(picks(el)).toEqual(["st-g", "st-f"]);
    expect(api.getStationQueue).toHaveBeenCalledWith("st-g");
    expect(api.getStationQueue).not.toHaveBeenCalledWith("st-c");
    expect(lines(el)).toEqual([]);
  });

  it("a narrowed Fryer shows its line above the picker and leaves one pick", async () => {
    const { el } = await mountOperator(() =>
      Promise.resolve(
        identity([
          stationScreen([
            { id: "st-g", name: "Grill", available: true },
            { id: "st-f", name: "Fryer", available: false },
          ]),
        ]),
      ),
    );
    expect(picks(el)).toEqual(["st-g"]);
    expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Fryer")]);
    const line = el.shadowRoot!.querySelector("[data-station-unavailable]")!;
    const picker = el.shadowRoot!.querySelector("nav.picker")!;
    expect(line.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists the no longer available lines in station order", async () => {
    const { el } = await mountOperator(() =>
      Promise.resolve(
        identity([
          stationScreen([
            { id: "st-c", name: "Cocina", available: false },
            { id: "st-g", name: "Grill", available: true },
            { id: "st-f", name: "Fryer", available: false },
          ]),
        ]),
      ),
    );
    expect(lines(el)).toEqual(
      ["Cocina", "Fryer"].map((name) => t("station.unavailable").replace("{name}", name)),
    );
  });

  it("with no station screen choice shows every station, the default first", async () => {
    const { el, api } = await mountOperator(() =>
      Promise.resolve(identity([{ kind: "pass", available: true, stations: [], zones: null }])),
    );
    expect(picks(el)).toEqual(["st-c", "st-g", "st-f"]);
    expect(api.getStationQueue).toHaveBeenCalledWith("st-c");
  });

  it("a choice a narrowing emptied shows only its line: no picker, no queue and no fallback", async () => {
    const { el, api } = await mountOperator(() =>
      Promise.resolve(identity([stationScreen([{ id: "st-f", name: "Fryer", available: false }])])),
    );
    expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Fryer")]);
    expect(picks(el)).toEqual([]);
    expect(el.shadowRoot!.querySelector("nav.picker, till-station-queue, .empty")).toBeNull();
    expect(api.getStationQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["en-GB", "This screen is no longer available: Station screen"],
    ["es-ES", "Esta pantalla ya no está disponible: Pantalla de estación"],
  ])("a station screen a narrowing took says so, alone (%s)", async (locale, text) => {
    setLocale(locale);
    try {
      const { el, api } = await mountOperator(() =>
        Promise.resolve(
          identity([{ kind: "station", available: false, stations: [], zones: null }]),
        ),
      );
      expect(
        [...el.shadowRoot!.querySelectorAll("[data-unavailable]")].map((line) =>
          line.textContent!.trim(),
        ),
      ).toEqual([text]);
      expect(el.shadowRoot!.querySelector("nav.picker, till-station-queue, .empty")).toBeNull();
      expect(api.getStationQueue).not.toHaveBeenCalled();
    } finally {
      setLocale("en-GB");
    }
  });

  it("reads the device's choice again at the next refresh after a failed read, and then follows it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const chosen = identity([
        stationScreen([
          { id: "st-g", name: "Grill", available: true },
          { id: "st-f", name: "Fryer", available: true },
        ]),
      ]);
      const { el, api } = await mountOperator(
        vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error("down"), { code: "server.internal" }))
          .mockResolvedValue(chosen),
      );
      expect(picks(el)).toEqual(["st-c", "st-g", "st-f"]);
      expect(queueWidget(el)!.stationId).toBe("st-c");
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(picks(el)).toEqual(["st-g", "st-f"]);
      expect(queueWidget(el)!.stationId).toBe("st-g");
      expect(api.getStationQueue).toHaveBeenLastCalledWith("st-g");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the open station when the choice read again still lists it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const { el, api } = await mountOperator(
        vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error("down"), { code: "server.internal" }))
          .mockResolvedValue(
            identity([
              stationScreen([
                { id: "st-c", name: "Cocina", available: true },
                { id: "st-f", name: "Fryer", available: true },
              ]),
            ]),
          ),
      );
      el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-f"]')!.click();
      await flush(el);
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(picks(el)).toEqual(["st-c", "st-f"]);
      expect(queueWidget(el)!.stationId).toBe("st-f");
      expect(api.getStationQueue).toHaveBeenLastCalledWith("st-f", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the open station when the choice read again was emptied by a narrowing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const { el, api } = await mountOperator(
        vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error("down"), { code: "server.internal" }))
          .mockResolvedValue(
            identity([stationScreen([{ id: "st-f", name: "Fryer", available: false }])]),
          ),
      );
      expect(queueWidget(el)!.stationId).toBe("st-c");
      vi.mocked(api.getStationQueue).mockClear();
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(lines(el)).toEqual([t("station.unavailable").replace("{name}", "Fryer")]);
      expect(el.shadowRoot!.querySelector("nav.picker, till-station-queue")).toBeNull();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.getStationQueue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the open station at the next refresh when it is taken out of the choice", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const { el, api } = await mountOperator(
        vi
          .fn()
          .mockResolvedValueOnce(
            identity([
              stationScreen([
                { id: "st-g", name: "Grill", available: true },
                { id: "st-f", name: "Fryer", available: true },
              ]),
            ]),
          )
          .mockResolvedValue(
            identity([stationScreen([{ id: "st-f", name: "Fryer", available: true }])]),
          ),
      );
      expect(queueWidget(el)!.stationId).toBe("st-g");
      await vi.advanceTimersByTimeAsync(15_000);
      await el.updateComplete;
      expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
      expect(picks(el)).toEqual(["st-f"]);
      expect(queueWidget(el)!.stationId).toBe("st-f");
      expect(api.getStationQueue).toHaveBeenLastCalledWith("st-f");
      expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("given back while its line shows", () => {
    const screenGone = identity([{ kind: "station", available: false, stations: [], zones: null }]);
    const grillOnly = identity([stationScreen([{ id: "st-g", name: "Grill", available: true }])]);
    const withFakeTimers = async (run: () => Promise<void>) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      try {
        await run();
      } finally {
        vi.useRealTimers();
      }
    };
    const screenLine = (el: TillStationScreen) =>
      el.shadowRoot!.querySelector("[data-unavailable]");

    it("a station screen opens its station at the next refresh", () =>
      withFakeTimers(async () => {
        const { el, api } = await mountOperator(
          vi.fn().mockResolvedValueOnce(screenGone).mockResolvedValue(grillOnly),
        );
        expect(screenLine(el)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(screenLine(el)).toBeNull();
        expect(picks(el)).toEqual(["st-g"]);
        expect(queueWidget(el)!.stationId).toBe("st-g");
      }));

    it("a narrowed station is listed again, and the open one stays open", () =>
      withFakeTimers(async () => {
        const { el } = await mountOperator(
          vi
            .fn()
            .mockResolvedValueOnce(
              identity([
                stationScreen([
                  { id: "st-g", name: "Grill", available: true },
                  { id: "st-f", name: "Fryer", available: false },
                ]),
              ]),
            )
            .mockResolvedValue(
              identity([
                stationScreen([
                  { id: "st-g", name: "Grill", available: true },
                  { id: "st-f", name: "Fryer", available: true },
                ]),
              ]),
            ),
        );
        expect(lines(el)).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(lines(el)).toEqual([]);
        expect(picks(el)).toEqual(["st-g", "st-f"]);
        expect(queueWidget(el)!.stationId).toBe("st-g");
      }));

    it("keeps its line when reading the choice again fails", () =>
      withFakeTimers(async () => {
        const { el, api } = await mountOperator(
          vi
            .fn()
            .mockResolvedValueOnce(screenGone)
            .mockRejectedValue(Object.assign(new Error("down"), { code: "server.internal" })),
        );
        await vi.advanceTimersByTimeAsync(15_000);
        await el.updateComplete;
        expect(api.getDeviceIdentity).toHaveBeenCalledTimes(2);
        expect(screenLine(el)).not.toBeNull();
        expect(picks(el)).toEqual([]);
        expect(api.getStationQueue).not.toHaveBeenCalled();
      }));

    it("ignores an older choice read that answers after a newer one", () =>
      withFakeTimers(async () => {
        let answerLate: (value: DeviceIdentity) => void = () => {};
        const { el } = await mountOperator(
          vi
            .fn()
            .mockResolvedValueOnce(screenGone)
            .mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)))
            .mockResolvedValue(grillOnly),
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await el.updateComplete;
        expect(picks(el)).toEqual(["st-g"]);
        answerLate(screenGone);
        await flush(el);
        expect(screenLine(el)).toBeNull();
        expect(picks(el)).toEqual(["st-g"]);
      }));
  });

  it("a failed identity read shows every station, as before a choice existed", async () => {
    const { el, api } = await mountOperator(() =>
      Promise.reject(Object.assign(new Error("down"), { code: "server.internal" })),
    );
    expect(picks(el)).toEqual(["st-c", "st-g", "st-f"]);
    expect(api.getStationQueue).toHaveBeenCalledWith("st-c");
  });

  it("an address naming a station outside the choice opens the first chosen one", async () => {
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-c");
    const { el, api } = await mountOperator(() =>
      Promise.resolve(
        identity([
          stationScreen([
            { id: "st-g", name: "Grill", available: true },
            { id: "st-f", name: "Fryer", available: true },
          ]),
        ]),
      ),
    );
    expect(queueWidget(el)!.stationId).toBe("st-g");
    expect(api.getStationQueue).not.toHaveBeenCalledWith("st-c");
    expect(location.pathname).toBe("/tabs/counter/view/station/station/st-g");
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
        getStationQueue: vi
          .fn()
          .mockResolvedValue({ printersDown: [], items: barQueue, notices: [] }),
      }),
    });
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-2");
    expect(queueWidget(el)!.groups).toEqual(barQueue);
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
            : Promise.resolve({ printersDown: [], items: kitchenQueue, notices: [] }),
        ),
      }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush(el);
    resolve({ printersDown: [], items: barQueue, notices: [] });
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-1");
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
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
    reroutedTo: null,
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
  const twoNotices: StationQueue = {
    printersDown: [],
    items: kitchenQueue,
    notices: [voidStarted, changed],
  };

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
    answerBarra({ printersDown: [], items: barQueue, notices: [] });
    await flush(el);
  });

  describe("device mode", () => {
    function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
      return {
        getDeviceStationScreen: vi.fn().mockResolvedValue({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [voidStarted, changed],
            },
          ],
        }),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
        deviceAcknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined),
        acknowledgeKitchenNotice: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as TillApi;
    }

    it("shows its station's notices from the device read", async () => {
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
        initialDeviceStation: {
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [changed],
            },
          ],
        },
      });
      await flush(el);
      expect(api.getDeviceStationScreen).not.toHaveBeenCalled();
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

    it("an Acknowledge refused device.unauthorized asks at once to switch", async () => {
      const switched = vi.fn();
      document.addEventListener("kitchen-screen-changed", switched);
      try {
        const api = deviceApi({
          deviceAcknowledgeKitchenNotice: vi
            .fn()
            .mockRejectedValue({ code: "device.unauthorized" }),
        });
        const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
          api,
          deviceMode: true,
        });
        await flush(el);
        acknowledge(el, "kn-changed");
        await flush(el);
        expect(switched).toHaveBeenCalledTimes(1);
        expect((switched.mock.calls[0]![0] as CustomEvent<{ from: string }>).detail.from).toBe(
          "station",
        );
      } finally {
        document.removeEventListener("kitchen-screen-changed", switched);
      }
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
    printersDown: [],
    items: barQueue,
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
        reroutedTo: null,
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
  });

  describe("the device's kitchen columns", () => {
    afterEach(() => {
      clearStoredColumns();
      vi.restoreAllMocks();
    });

    it("the Columns window: a refresh keeps the window open and the moves made", async () => {
      const api = stubApi({
        getStationQueue: vi
          .fn()
          .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
          .mockResolvedValue(later),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceId: "dev-1",
        serverOrigin: BOX,
      });
      await flush(el);
      await openColumns(el);
      await pressInWindow(el, '[data-column-up="ready"]');
      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(api.getStationQueue).toHaveBeenCalledTimes(2);
      expect(columnsWindow(el)).not.toBeNull();
      expect(queueWidget(el)!.columns.order).toEqual(["waiting", "ready", "preparing"]);
    });

    it("the board's narrow tabs: the chosen tab survives the screen's 15-second refresh", async () => {
      await page.viewport(390, 844);
      const api = stubApi({
        getStationQueue: vi
          .fn()
          .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
          .mockResolvedValue(later),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
      await flush(el);
      const board = queueWidget(el)!;
      const pressed = () =>
        [
          ...board.shadowRoot!.querySelectorAll<HTMLElement>(
            '[data-column-tab][aria-pressed="true"]',
          ),
        ].map((button) => button.dataset.columnTab);
      board.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="preparing"]')!.click();
      await board.updateComplete;
      expect(pressed()).toEqual(["preparing"]);
      vi.advanceTimersByTime(15_000);
      await flush(el);
      await board.updateComplete;
      expect(api.getStationQueue).toHaveBeenCalledTimes(2);
      expect(queueWidget(el)).toBe(board);
      expect(board.groups).toEqual(barQueue);
      expect(pressed()).toEqual(["preparing"]);
    });

    it("the Columns window: a refresh that drops its station closes it", async () => {
      const board = (id: string, name: string, queue: StationQueueGroup[]) => ({
        id,
        name,
        available: true as const,
        today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
        queue,
        notices: [],
        printersDown: [],
      });
      const api = {
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValueOnce({
            stations: [board("st-1", "Cocina", kitchenQueue), board("st-2", "Barra", barQueue)],
          })
          .mockResolvedValue({ stations: [board("st-1", "Cocina", kitchenQueue)] }),
        deviceAdvance: vi.fn().mockResolvedValue(undefined),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      const queues = el.shadowRoot!.querySelectorAll<TillStationQueue>("till-station-queue");
      await openColumns(el, queues[1]!);
      expect(windowBoardName(el)).toBe("Barra");
      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
      expect(columnsWindow(el)).toBeNull();
    });

    it("the device's kitchen columns: a refresh keeps the collapse and does not read the store again", async () => {
      const getItem = vi.spyOn(Storage.prototype, "getItem");
      const columnReads = () =>
        getItem.mock.calls.filter(([key]) => key.startsWith(COLUMNS_PREFIX)).length;
      const api = stubApi({
        getStationQueue: vi
          .fn()
          .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
          .mockResolvedValue(later),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceId: "dev-1",
        serverOrigin: BOX,
      });
      await flush(el);
      await tapColumn(el, "ready");
      const readsBefore = columnReads();
      expect(readsBefore).toBeGreaterThan(0);

      vi.advanceTimersByTime(15_000);
      await flush(el);
      expect(api.getStationQueue).toHaveBeenCalledTimes(2);
      expect(queueWidget(el)!.groups).toEqual(barQueue);
      expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
      expect(columnReads()).toBe(readsBefore);
    });
  });

  it("a read that never answers does not stop the next tick's read, and its late answer is dropped", async () => {
    // A stalled socket after a Wi-Fi drop: the refresh is the display's only way to hear of new work,
    // so one hung read must not freeze it.
    let answerHung!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    answerHung({ printersDown: [], items: kitchenQueue, notices: [] }); // older than what is on screen
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("a station's changed bump mode reaches an open device screen at its next refresh", async () => {
    const order = (bumpMode: "line" | "ticket"): StationQueueGroup => ({
      ...kitchenQueue[0]!,
      bumpMode,
      items: [
        kitchenQueue[0]!.items[0]!,
        { ...kitchenQueue[0]!.items[0]!, id: "ti-1b", workingOrderLineId: "wol-1b" },
      ],
    });
    const screen = (bumpMode: "line" | "ticket"): DeviceStationScreen => ({
      stations: [
        {
          id: "st-dev",
          name: "Cocina",
          available: true,
          today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" },
          printersDown: [],
          queue: [order(bumpMode)],
          notices: [],
        },
      ],
    });
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce(screen("line"))
        .mockResolvedValue(screen("ticket")),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
    const queue = queueWidget(el)!;
    await queue.updateComplete;
    const ticket = vi.fn();
    const item = vi.fn();
    queue.addEventListener("advance-dishes", (e) => ticket((e as CustomEvent).detail));
    queue.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    queue.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    await flush(el);
    expect(ticket).toHaveBeenCalledWith({
      itemIds: ["ti-1", "ti-1b"],
      stationId: "st-dev",
      to: "preparing",
    });
    expect(item).not.toHaveBeenCalled();
    expect(api.deviceAdvance).toHaveBeenCalledTimes(2);
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1", "preparing");
    expect(api.deviceAdvance).toHaveBeenCalledWith("ti-1b", "preparing");
  });

  it("device mode: a read that never answers does not stop the next tick's read", async () => {
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        })
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: barQueue,
              notices: later.notices,
            },
          ],
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
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(3);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  /** Read `n`'s answer: the Barra queue and one notice named after it, so the test can tell which
   * read's answer is on screen. */
  const answerNumber = (n: number): StationQueue => ({
    printersDown: [],
    items: barQueue,
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    await vi.advanceTimersByTimeAsync(30_000); // read 2 set out at 15 s, read 3 at 30 s
    await flush(el);
    expect(api.getStationQueue).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5_000); // read 2 answers at 35 s, after read 3 set out
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-2"]);
    await vi.advanceTimersByTimeAsync(15_000); // read 3 answers at 50 s
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-3"]);
  });

  it("an older answer arriving after a newer one is on screen is dropped", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(answerNumber(2)), 20_000)),
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(answerNumber(3)), 1_000)),
        ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await vi.advanceTimersByTimeAsync(31_000); // read 2 out since 15 s; read 3 set out at 30 s and answered
    await flush(el);
    await queueWidget(el)!.updateComplete;
    expect(shownRead(el)).toEqual(["kn-read-3"]);
    await vi.advanceTimersByTimeAsync(4_000); // read 2 answers at 35 s
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
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("reads that never answer do not pile up: when a read sets out, at most one other is still out", async () => {
    const signals: AbortSignal[] = [];
    const outWhenSettingOut: number[] = [];
    const hang = hangUntilAborted(signals);
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    answerBarra({ printersDown: [], items: barQueue, notices: [] });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
  });

  it("device mode: a display slower than the interval still updates, and a hung read is cancelled", async () => {
    const signals: AbortSignal[] = [];
    const station = (n: number): DeviceStationScreen => ({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          id: "st-dev",
          printersDown: [],
          queue: barQueue,
          notices: answerNumber(n).notices,
        },
      ],
    });
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        })
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    expect(queueWidget(el)!.groups).toEqual(barQueue);
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
    const withNotice: StationQueue = {
      printersDown: [],
      items: kitchenQueue,
      notices: later.notices,
    };
    let answerPoll!: (queue: StationQueue) => void;
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce(withNotice)
        .mockImplementationOnce(() => new Promise((resolve) => (answerPoll = resolve)))
        .mockResolvedValue({ printersDown: [], items: kitchenQueue, notices: [] }),
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

  it("device mode re-reads its station screen on the same timer", async () => {
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        })
        .mockResolvedValue({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: barQueue,
              notices: later.notices,
            },
          ],
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
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
    expect(api.getStationQueue).not.toHaveBeenCalled();
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
  });

  it("device mode: a refresh that set out before a bump's reload never overwrites the newer answer", async () => {
    let answerRefresh!: (station: DeviceStationScreen) => void;
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        })
        .mockImplementationOnce(() => new Promise((resolve) => (answerRefresh = resolve)))
        .mockResolvedValue({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: barQueue,
              notices: [],
            },
          ],
        }),
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
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    answerRefresh({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          id: "st-dev",
          printersDown: [],
          queue: kitchenQueue,
          notices: [],
        },
      ],
    });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
  });

  it("device mode: a bump's reload that set out before a refresh never overwrites the newer answer", async () => {
    let answerReload!: (station: DeviceStationScreen) => void;
    const api = {
      getDeviceStationScreen: vi
        .fn()
        .mockResolvedValueOnce({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        })
        .mockImplementationOnce(() => new Promise((resolve) => (answerReload = resolve)))
        .mockResolvedValue({
          stations: [
            {
              name: "Cocina",
              available: true,
              today: {
                open: true,
                isDefault: false,
                byHand: null,
                sendsTo: null,
                why: "open" as const,
              },
              id: "st-dev",
              printersDown: [],
              queue: barQueue,
              notices: [],
            },
          ],
        }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el); // the bump's reload sets out, and hangs
    vi.advanceTimersByTime(15_000);
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    answerReload({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          id: "st-dev",
          printersDown: [],
          queue: kitchenQueue,
          notices: [],
        },
      ],
    });
    await flush(el);
    expect(queueWidget(el)!.groups).toEqual(barQueue);
  });

  it("a device refresh answered 401 (the display was removed) sends the app back to its front door", async () => {
    const reboot = vi.fn();
    document.addEventListener("device-unauthorized", reboot);
    try {
      const api = {
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValueOnce({
            stations: [
              {
                name: "Cocina",
                available: true,
                today: {
                  open: true,
                  isDefault: false,
                  byHand: null,
                  sendsTo: null,
                  why: "open" as const,
                },
                id: "st-dev",
                printersDown: [],
                queue: kitchenQueue,
                notices: [],
              },
            ],
          })
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
      expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
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
    printersDown: [],
    items: barQueue,
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
        reroutedTo: null,
        direction: null,
        cancelledExtra: null,
        createdAt: "2026-08-17T10:20:00.000Z",
      },
    ],
  };

  const banner = (el: TillStationScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-stale]");

  async function tick(el: TillStationScreen, ms = 15_000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] }) // 10:19:50
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
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    await tick(el, 45_000); // 10:21:05, still failing: the time is the last GOOD read's, not the latest failure's
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:20, 1 minute ago");
  });

  it("the next good refresh clears the banner", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
  });

  it("a late failure of an older read, after a newer read's answer is on screen, shows no banner", async () => {
    const api = stubApi({
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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

  it("a late failure of an older refresh's station list, after a newer refresh answered, shows no banner", async () => {
    const api = stubApi({
      listStations: vi
        .fn()
        .mockResolvedValueOnce(stations)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) =>
              setTimeout(() => reject({ code: "server.internal" }), 20_000),
            ),
        )
        .mockResolvedValueOnce(stations)
        .mockImplementation(() => new Promise(() => {})),
      getStationQueue: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
        .mockResolvedValue(later),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el, 31_000); // refresh 1's list out since 15 s; refresh 2's set out at 30 s and answered
    expect(queueWidget(el)!.notices).toEqual(later.notices);
    await tick(el, 4_000); // refresh 1's list fails at 35 s
    expect(banner(el)).toBeNull();
  });

  it("a choice read that never answers is cancelled 25 seconds after it set out, and shows the banner", async () => {
    // Answers as `fetch` does: at once, refused, when its signal was cancelled before it set out.
    const answer = (options?: { signal?: AbortSignal }) =>
      options?.signal?.aborted
        ? Promise.reject(options.signal.reason)
        : Promise.resolve({ printersDown: [], items: kitchenQueue, notices: [] });
    const api = stubApi({
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValueOnce({
          deviceId: "dev-1",
          formFactor: "till",
          name: "Till",
          kitchenScreens: [],
        })
        .mockImplementation(
          (options?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
            ),
        ),
      getStationQueue: vi.fn((_stationId: string, options?: { signal?: AbortSignal }) =>
        answer(options),
      ),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    await tick(el, 39_999); // the choice read that set out at 15 s is still out
    expect(banner(el)).toBeNull();
    await tick(el, 1); // and is cancelled at 40 s
    expect(banner(el)!.textContent!.trim()).toBe("No updates since 10:19, less than a minute ago");
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] }) // 10:19:50
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
        .mockResolvedValueOnce({ printersDown: [], items: kitchenQueue, notices: [] })
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
    const deviceStation = (queue: StationQueueGroup[]): DeviceStationScreen => ({
      stations: [
        {
          name: "Cocina",
          available: true,
          today: {
            open: true,
            isDefault: false,
            byHand: null,
            sendsTo: null,
            why: "open" as const,
          },
          id: "st-dev",
          printersDown: [],
          queue,
          notices: [],
        },
      ],
    });

    it("a failed refresh shows the banner, and the next good one clears it", async () => {
      const api = {
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(kitchenQueue)) // 10:19:50
          .mockResolvedValueOnce(deviceStation(barQueue)) // 10:20:05
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(deviceStation(barQueue)),
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
      expect(queueWidget(el)!.groups).toEqual(barQueue);
      await tick(el);
      expect(banner(el)).toBeNull();
    });

    it("a station adopted from the cold boot counts as a good read", async () => {
      const api = {
        getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "server.internal" }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
        initialDeviceStation: deviceStation(kitchenQueue),
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
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(kitchenQueue))
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
          detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
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
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValueOnce(deviceStation(kitchenQueue))
          .mockRejectedValue({ code: "device.unauthorized" }),
      } as unknown as TillApi;
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      await tick(el);
      expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
      expect(banner(el)).toBeNull();
    });
  });
});

describe.each(["Table 4", null, "missing card"])(
  "A773 waiter authority — station group events (%s)",
  (label) => {
    it.each([
      ["success", null],
      ["changed party", "party.out_of_date"],
      ["group no longer held", "group.not_held"],
      ["allergy unanswered", "allergy.unanswered"],
    ] as const)("does not start a group write or its %s response", async (_label, code) => {
      const fireGroup =
        code === null
          ? vi.fn().mockResolvedValue({ revision: 13 })
          : vi.fn().mockRejectedValue({ code });
      const queue: StationQueueGroup[] =
        label === "missing card"
          ? []
          : [
              {
                ...kitchenQueue[0]!,
                label,
                party: { id: "v-4", revision: 12 },
                items: [
                  {
                    ...kitchenQueue[0]!.items[0]!,
                    firedAt: null,
                    group: {
                      id: "g-3",
                      position: 3,
                      displayNumber: 3,
                      numberPartyId: "v-4",
                      state: "held",
                    },
                  },
                ],
              },
            ];
      const api = stubApi({
        fireGroup,
        getStationQueue: vi.fn().mockResolvedValue({ items: queue, notices: [], printersDown: [] }),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        ...{ fireControl: "kitchen" },
      });
      await flush(el);
      expect(queueWidget(el)!.groups).toEqual(queue);
      const before = queueWidget(el)!.groups;
      for (let press = 0; press < 2; press++) {
        queueWidget(el)!.dispatchEvent(
          new CustomEvent("fire-kitchen-group", {
            detail: { partyId: "v-4", groupId: "g-3", expectedPartyRevision: 12 },
            bubbles: true,
            composed: true,
          }),
        );
        await flush(el);
      }
      expect(fireGroup).not.toHaveBeenCalled();
      expect(api.previewPartyAllergy).not.toHaveBeenCalled();
      expect(api.getFindBill).not.toHaveBeenCalled();
      expect(api.getStationQueue).toHaveBeenCalledOnce();
      expect(queueWidget(el)!.groups).toBe(before);
      expect(
        el.shadowRoot!.querySelector(
          'till-party-allergy-dialog, [data-table-changed], [role="alert"]',
        ),
      ).toBeNull();
    });
  },
);

describe.each([false, true])("printer warnings (device mode: %s)", (deviceMode) => {
  const down = [
    {
      printerId: "printer-1",
      printerName: "Epson",
      since: new Date(2026, 7, 17, 20, 14).toISOString(),
    },
    {
      printerId: "printer-2",
      printerName: "Star",
      since: new Date(2026, 7, 17, 20, 18).toISOString(),
    },
  ];
  beforeEach(() => {
    setLocale("en-GB");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setLocale("en-GB");
  });

  async function mount(printersDown = down.slice(0, 1), next = printersDown) {
    const response = (printers: typeof down) =>
      deviceMode
        ? {
            stations: [
              {
                name: "Cocina",
                available: true,
                today: {
                  open: true,
                  isDefault: true,
                  byHand: null,
                  sendsTo: null,
                  why: "default" as const,
                },
                id: "st-1",
                queue: kitchenQueue,
                notices: [],
                printersDown: printers,
              },
            ],
          }
        : { items: kitchenQueue, notices: [], printersDown: printers };
    const read = vi
      .fn()
      .mockResolvedValueOnce(response(printersDown))
      .mockResolvedValue(response(next));
    const api = stubApi(deviceMode ? { getDeviceStationScreen: read } : { getStationQueue: read });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api, deviceMode });
    await flush(el);
    return el;
  }

  const warnings = (el: TillStationScreen) => [
    ...el.shadowRoot!.querySelectorAll("[data-printer-down]"),
  ];

  it("shows one printer's name and sent time above tickets as a status", async () => {
    const el = await mount();
    const rows = warnings(el);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent?.trim()).toBe(
      "Printer Epson has printed nothing since something sent to it at 20:14 got stuck. Tickets are still shown here; tell a manager.",
    );
    expect(rows[0].getAttribute("role")).toBe("status");
    // The widget draws its status slot above its board.
    expect(rows[0].parentElement).toBe(queueWidget(el));
    expect(rows[0].getAttribute("slot")).toBe("status");
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
  });

  it("shows a separate warning for each down printer", async () => {
    const el = await mount(down);
    expect(warnings(el)).toHaveLength(2);
    expect(warnings(el)[1].textContent).toContain("Printer Star");
    expect(warnings(el)[1].textContent).toContain("20:18");
  });

  it("shows no printer warning when the response lists none", async () => {
    const el = await mount([]);
    expect(warnings(el)).toHaveLength(0);
    expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
  });

  it("removes a recovered printer on the next fifteen-second read", async () => {
    const el = await mount(down, down.slice(1));
    expect(warnings(el)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush(el);
    expect(warnings(el)).toHaveLength(1);
    expect(warnings(el)[0].textContent).toContain("Printer Star");
    await vi.advanceTimersByTimeAsync(15_000);
    await flush(el);
    expect(warnings(el)).toHaveLength(1);
  });

  it("removes all warnings when the next read lists no down printers", async () => {
    const el = await mount(down, []);
    expect(warnings(el)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(15_000);
    await flush(el);
    expect(warnings(el)).toHaveLength(0);
  });

  it("explains the printer failure in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    expect(warnings(el)[0]?.textContent?.trim()).toBe(
      "La impresora Epson no ha impreso nada desde que se atascó algo que se le envió a las 20:14. Las comandas siguen apareciendo aquí; avisa a un encargado.",
    );
  });
});

describe("operator station-today controls", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));

  function server(closed = false) {
    let rows: Station[] = [
      { ...stations[0]!, name: "Pass" },
      {
        ...stations[1]!,
        name: "Bar",
        open: !closed,
        byHand: closed ? "closed" : null,
        sendsTo: closed ? "st-1" : null,
        why: closed ? "closed_by_hand" : "open",
      },
    ];
    const reads: string[] = [];
    let failRead = false;
    const writes: unknown[] = [];
    const api = new StationTodayApi("", async (input, init) => {
      const path = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (path === "/api/stations") {
        reads.push(path);
        return failRead
          ? json({ error: { code: "server.internal", params: {} } }, 500)
          : json(rows);
      }
      if (path.endsWith("/queue"))
        return json({
          items: path.includes("st-1") ? kitchenQueue : barQueue,
          notices: [],
          printersDown: [],
        });
      if (path === "/api/stations/st-2/today") {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            state: "open" | "closed";
            sendsToStationId?: string;
          };
          writes.push(body);
          rows = rows.map((row) =>
            row.id !== "st-2"
              ? row
              : {
                  ...row,
                  open: body.state === "open",
                  byHand: body.state,
                  sendsTo: body.sendsToStationId ?? null,
                  why: body.state === "open" ? "open" : "closed_by_hand",
                },
          );
          return new Response(null, { status: 204 });
        }
        return json({
          destinations: [{ id: "st-1", name: "Pass", isDefault: true }],
          openDishCount: 0,
        });
      }
      throw new Error(`Unexpected station request: ${path}`);
    });
    return {
      api,
      reads,
      writes,
      closeFromElsewhere: () => {
        rows = rows.map((row) =>
          row.id !== "st-2"
            ? row
            : { ...row, open: false, byHand: "closed", sendsTo: "st-1", why: "closed_by_hand" },
        );
      },
      failRefresh: () => {
        failRead = true;
      },
    };
  }
  async function mountToday(closed = false) {
    const backend = server(closed);
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
      api: backend.api,
    });
    await flush(el);
    const control = () => el.shadowRoot!.querySelector<TillStationToday>("till-station-today");
    const line = () => control()?.shadowRoot?.querySelector("[data-status]")?.textContent?.trim();
    const pickBar = async () => {
      el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
      await flush(el);
      await control()?.updateComplete;
    };
    return { ...backend, el, host, control, line, pickBar };
  }
  it("shows the selected station status above its queue", async () => {
    const { el, control, line } = await mountToday();
    expect(line()).toBe("Always open: this is the default station.");
    expect(control()!.parentElement).toBe(queueWidget(el));
    expect(control()!.getAttribute("slot")).toBe("lead");
    expect(control()!.shadowRoot!.querySelector("[data-action]")).toBeNull();
  });
  it("switches the control along with the picked station", async () => {
    const { control, line, pickBar } = await mountToday();
    await pickBar();
    expect(line()).toBe("Open");
    expect(control()!.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
      "Close for today",
    );
  });
  it.each([
    ["en", "Bar · Closed"],
    ["es", "Bar · Cerrada"],
  ])("marks the closed picker in %s", async (locale, label) => {
    setLocale(locale);
    const { el } = await mountToday(true);
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.textContent!.trim()).toBe(label);
    expect(el.shadowRoot!.querySelector('[data-station="st-1"]')!.textContent!.trim()).toBe("Pass");
  });
  it("resolves the stored destination id to its station name", async () => {
    const { line, pickBar } = await mountToday(true);
    await pickBar();
    expect(line()).toBe("Closed for today → Pass");
  });
  it("closes through the real widget and refreshes the picker and status without changing the pick", async () => {
    const { el, host, control, line, pickBar, writes } = await mountToday();
    await pickBar();
    const escaped = vi.fn();
    host.addEventListener("station-today-changed", escaped);
    control()!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
    await expect
      .poll(() => control()!.shadowRoot!.querySelector("till-station-today-dialog"))
      .not.toBeNull();
    const dialog = control()!.shadowRoot!.querySelector("till-station-today-dialog")!;
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
    await expect.poll(line).toBe("Closed for today → Pass");
    expect(writes).toEqual([{ state: "closed", sendsToStationId: "st-1" }]);
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.textContent!.trim()).toBe(
      "Bar · Closed",
    );
    expect(queueWidget(el)!.groups).toEqual(barQueue);
    expect(escaped).not.toHaveBeenCalled();
  });
  it("reopens the picked station and clears its closed marker", async () => {
    const { el, control, line, pickBar, writes } = await mountToday(true);
    await pickBar();
    control()!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
    await expect.poll(line).toBe("Open");
    expect(writes).toEqual([{ state: "open" }]);
    expect(el.shadowRoot!.querySelector('[data-station="st-2"]')!.textContent!.trim()).toBe("Bar");
  });
  it("a failed refresh keeps the saved dialog closed and the last queue, with a stale warning", async () => {
    const { el, control, pickBar, failRefresh, writes } = await mountToday(true);
    await pickBar();
    failRefresh();
    control()!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
    expect(writes).toEqual([{ state: "open" }]);
    expect(control()!.shadowRoot!.querySelector("till-station-today-dialog")).toBeNull();
    expect(control()!.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(queueWidget(el)!.groups).toEqual(barQueue);
  });
  it("the periodic refresh follows a station closed at another till", async () => {
    vi.useFakeTimers();
    try {
      const { line, pickBar, closeFromElsewhere } = await mountToday();
      await pickBar();
      expect(line()).toBe("Open");
      closeFromElsewhere();
      await vi.advanceTimersByTimeAsync(15_000);
      vi.useRealTimers();
      await expect.poll(line).toBe("Closed for today → Pass");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("kitchen display station-today controls", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("en"));
  async function kitchen(closed = false, initial = false) {
    let today = {
      open: !closed,
      isDefault: false,
      byHand: closed ? ("closed" as const) : null,
      sendsTo: closed ? { id: "pass", name: "Pass" } : null,
      why: closed ? ("closed_by_hand" as const) : ("open" as const),
    };
    const answer = () => ({
      stations: [
        {
          id: "grill",
          name: "Grill",
          available: true as const,
          today,
          queue: kitchenQueue,
          notices: [],
          printersDown: [],
        },
      ],
    });
    const calls: { path: string; body: unknown }[] = [];
    let fail = false;
    const api = new StationTodayApi("", async (path, init) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      calls.push({ path: String(path), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(path) === "/api/device/station-screen")
        return fail
          ? json({ error: { code: "server.internal", params: {} } }, 500)
          : json(answer());
      if (String(path) === "/api/device/stations/grill/today") {
        if (init?.method === "PUT") {
          today = {
            open: false,
            isDefault: false,
            byHand: "closed",
            sendsTo: { id: "pass", name: "Pass" },
            why: "closed_by_hand",
          };
          return new Response(null, { status: 204 });
        }
        return json({
          openDishCount: 0,
          destinations: [{ id: "pass", name: "Pass", isDefault: true }],
          authorizers: [{ personId: "manager", displayName: "Ana" }],
        });
      }
      throw new Error(`Unexpected device request: ${String(path)}`);
    });
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      ...(initial ? { initialDeviceStation: answer() } : {}),
    });
    await flush(el);
    const control = () => el.shadowRoot!.querySelector<TillStationToday>("till-station-today");
    const line = () => control()?.shadowRoot?.querySelector("[data-status]")?.textContent?.trim();
    return {
      el,
      host,
      calls,
      control,
      line,
      fail: () => {
        fail = true;
      },
      closeElsewhere: () => {
        today = {
          open: false,
          isDefault: false,
          byHand: "closed",
          sendsTo: { id: "pass", name: "Pass" },
          why: "closed_by_hand",
        };
      },
    };
  }
  it.each([false, true])(
    "renders device status above its queue (cold boot answer: %s)",
    async (initial) => {
      const { el, control, line, calls } = await kitchen(true, initial);
      expect(line()).toBe("Closed for today → Pass");
      expect(control()!.deviceMode).toBe(true);
      expect(control()!.parentElement).toBe(queueWidget(el));
      expect(control()!.getAttribute("slot")).toBe("lead");
      expect(calls.map((c) => c.path)).toEqual(initial ? [] : ["/api/device/station-screen"]);
    },
  );
  it.each([false, true])(
    "a successful close refreshes device state (refresh refused: %s)",
    async (failed) => {
      const { el, host, control, line, calls, fail } = await kitchen();
      expect(line()).toBe("Open");
      const escaped = vi.fn();
      host.addEventListener("station-today-changed", escaped);
      control()!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
      await expect
        .poll(() => control()!.shadowRoot!.querySelector("till-station-today-dialog"))
        .not.toBeNull();
      const dialog = control()!.shadowRoot!.querySelector("till-station-today-dialog")!;
      await dialog.updateComplete;
      dialog.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
      await expect
        .poll(() => control()!.shadowRoot!.querySelector("till-supervisor-override-dialog"))
        .not.toBeNull();
      if (failed) fail();
      control()!
        .shadowRoot!.querySelector("till-supervisor-override-dialog")!
        .dispatchEvent(
          new CustomEvent("override-confirm", { detail: { personId: "manager", pin: "1234" } }),
        );
      if (failed)
        await expect.poll(() => el.shadowRoot!.querySelector("[data-stale]")).not.toBeNull();
      else await expect.poll(line).toBe("Closed for today → Pass");
      expect(calls.at(-1)!.path).toBe("/api/device/station-screen");
      expect(queueWidget(el)!.groups).toEqual(kitchenQueue);
      expect(control()!.shadowRoot!.querySelector("till-station-today-dialog")).toBeNull();
      expect(control()!.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      expect(escaped).not.toHaveBeenCalled();
    },
  );
  it("polling follows a close at another till", async () => {
    vi.useFakeTimers();
    try {
      const { line, closeElsewhere } = await kitchen();
      expect(line()).toBe("Open");
      closeElsewhere();
      await vi.advanceTimersByTimeAsync(15_000);
      vi.useRealTimers();
      await expect.poll(line).toBe("Closed for today → Pass");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("till-station-screen moves a dish to another station (A439)", () => {
  const kitchenDevice = {
    id: "st-dev",
    name: "Cocina",
    available: true as const,
    today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
    printersDown: [],
    queue: kitchenQueue,
    notices: [],
  };
  const destinations: Station[] = [{ ...stations[0]!, id: "st-dev" }, stations[1]!];

  async function mountMove(
    props: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) {
    const api = {
      ...stubApi(),
      getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [kitchenDevice] }),
      deviceStations: vi.fn().mockResolvedValue(destinations),
      deviceMoveDishStation: vi
        .fn()
        .mockResolvedValue({ revision: 2, stationId: "st-2", moved: [] }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TillApi;
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
      canMoveStation: true,
      ...props,
    });
    await flush(el);
    return { el, api };
  }

  const moveButton = (el: TillStationScreen) =>
    queueWidget(el)!.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-1"]');
  const dialogs = (el: TillStationScreen) => [
    ...el.shadowRoot!.querySelectorAll<TillStationChoiceDialog>("till-station-choice-dialog"),
  ];
  const dialog = (el: TillStationScreen) => dialogs(el)[0];

  async function open(el: TillStationScreen): Promise<TillStationChoiceDialog> {
    moveButton(el)!.click();
    await expect.poll(() => dialog(el)).toBeDefined();
    await dialog(el)!.updateComplete;
    return dialog(el)!;
  }

  function choose(target: TillStationChoiceDialog, stationId: string | null): void {
    target.dispatchEvent(
      new CustomEvent("station-chosen", { detail: { stationId }, bubbles: true, composed: true }),
    );
  }

  it("a kitchen display with Take orders draws Move on its queued dishes", async () => {
    const { el } = await mountMove();
    expect(queueWidget(el)!.canMove).toBe(true);
    expect(moveButton(el)).not.toBeNull();
  });

  it("a kitchen display without Take orders draws no Move", async () => {
    const { el } = await mountMove({ canMoveStation: false });
    expect(queueWidget(el)!.canMove).toBe(false);
    expect(moveButton(el)).toBeNull();
  });

  it("the till's own Station screen moves through the signed-in route with Take orders", async () => {
    const moveDishStation = vi
      .fn()
      .mockResolvedValue({ revision: 2, stationId: "st-2", moved: [] });
    const { el, api } = await mountMove({ deviceMode: false }, { moveDishStation });
    expect(queueWidget(el)!.canMove).toBe(true);
    expect(moveButton(el)).not.toBeNull();
    const target = await open(el);
    expect(target.stations).toEqual(stations);
    expect(api.listStations).toHaveBeenCalled();
    expect(api.deviceStations).not.toHaveBeenCalled();
    choose(target, "st-2");
    await expect.poll(() => dialog(el)).toBeUndefined();
    expect(moveDishStation).toHaveBeenCalledWith(
      "wo-1",
      {
        submissionId: expect.any(String),
        lineIds: ["wol-1"],
        stationId: "st-2",
        expectedEdit: null,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(api.deviceMoveDishStation).not.toHaveBeenCalled();
    await expect.poll(() => vi.mocked(api.getStationQueue).mock.calls.length).toBe(2);
  });

  describe("A773 signed-in station move observations", () => {
    const expectedEdit = { billId: "wo-1", editorVersion: 6, draftId: null, draftRevision: null };
    it("keeps counter station moves unowned when the bill read carries a retained version", async () => {
      const getFindBill = vi.fn().mockResolvedValue({
        workingOrderId: "wo-1",
        partyId: null,
        edit: { ...expectedEdit, editorId: null, editorName: null },
      });
      const moveDishStation = vi.fn().mockResolvedValue({ revision: 2, moved: [] });
      const { el } = await mountMove({ deviceMode: false }, { getFindBill, moveDishStation });
      choose(await open(el), "st-2");
      await expect.poll(() => moveDishStation.mock.calls.length).toBe(1);
      expect(moveDishStation.mock.calls[0]![1]).toEqual({
        submissionId: expect.any(String),
        lineIds: ["wol-1"],
        stationId: "st-2",
        expectedEdit: null,
      });
    });
    it("reads the table bill before opening and carries that observation to the signed-in route", async () => {
      const getFindBill = vi.fn().mockResolvedValue({
        workingOrderId: "wo-1",
        partyId: "party-1",
        edit: { ...expectedEdit, editorId: null, editorName: null },
      });
      const moveDishStation = vi.fn().mockResolvedValue({ revision: 2, moved: [] });
      const { el } = await mountMove({ deviceMode: false }, { getFindBill, moveDishStation });
      choose(await open(el), "st-2");
      await expect.poll(() => moveDishStation.mock.calls.length).toBe(1);
      expect(getFindBill).toHaveBeenCalledExactlyOnceWith("wo-1", {
        signal: expect.any(AbortSignal),
      });
      expect(moveDishStation.mock.calls[0]![1]).toEqual({
        submissionId: expect.any(String),
        lineIds: ["wol-1"],
        stationId: "st-2",
        expectedEdit,
      });
    });
    it("keeps a failed ownership read out of the destination dialog", async () => {
      const getFindBill = vi.fn().mockRejectedValue({ code: "draft.out_of_date" });
      const { el } = await mountMove({ deviceMode: false }, { getFindBill });
      moveButton(el)!.click();
      await flush(el);
      expect(dialog(el)).toBeUndefined();
      expect(el.shadowRoot!.textContent).toContain(codeMessage("draft.out_of_date"));
    });
    it("does not open on an API replacement while the bill read is unanswered", async () => {
      let answer!: (value: unknown) => void;
      const getFindBill = vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      const { el } = await mountMove({ deviceMode: false }, { getFindBill });
      moveButton(el)!.click();
      await flush(el);
      expect(getFindBill).toHaveBeenCalledOnce();
      el.api = stubApi();
      await flush(el);
      answer({
        workingOrderId: "wo-1",
        partyId: "party-1",
        edit: { ...expectedEdit, editorId: null, editorName: null },
      });
      await flush(el);
      expect(dialog(el)).toBeUndefined();
    });
    it("does not change a signed-in choice into a kitchen-device write when mode changes", async () => {
      const moveDishStation = vi.fn();
      const deviceMoveDishStation = vi.fn();
      const { el } = await mountMove(
        { deviceMode: false },
        { moveDishStation, deviceMoveDishStation },
      );
      const target = await open(el);
      el.deviceMode = true;
      await flush(el);
      choose(target, "st-2");
      await flush(el);
      expect(moveDishStation).not.toHaveBeenCalled();
      expect(deviceMoveDishStation).not.toHaveBeenCalled();
    });
  });

  it("the till's own Station screen without Take orders draws no Move", async () => {
    const { el, api } = await mountMove({ deviceMode: false, canMoveStation: false });
    expect(queueWidget(el)!.canMove).toBe(false);
    expect(moveButton(el)).toBeNull();
    const escaped = vi.fn();
    document.addEventListener("move-station", escaped);
    try {
      queueWidget(el)!.dispatchEvent(
        new CustomEvent("move-station", {
          detail: { workingOrderId: "wo-1", lineId: "wol-1", name: "Paella", stationId: "st-1" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
    } finally {
      document.removeEventListener("move-station", escaped);
    }
    expect(escaped).not.toHaveBeenCalled();
    expect(dialog(el)).toBeUndefined();
    expect(api.deviceStations).not.toHaveBeenCalled();
    expect(api.listStations).toHaveBeenCalledOnce();
  });

  it("the merged view of several stations draws Move too", async () => {
    const { el } = await mountMove(
      {},
      {
        getDeviceStationScreen: vi.fn().mockResolvedValue({
          stations: [kitchenDevice, { ...kitchenDevice, id: "st-2", name: "Barra", queue: [] }],
        }),
      },
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-merge-toggle]")!.click();
    await flush(el);
    expect(queueWidget(el)!.canMove).toBe(true);
    expect(moveButton(el)).not.toBeNull();
  });

  it("Move opens the station dialog naming the dish, with its station marked as now", async () => {
    const { el, api } = await mountMove();
    const escaped = vi.fn();
    document.addEventListener("move-station", escaped);
    let target: TillStationChoiceDialog;
    try {
      target = await open(el);
    } finally {
      document.removeEventListener("move-station", escaped);
    }
    expect(escaped).not.toHaveBeenCalled();
    expect(api.deviceStations).toHaveBeenCalledOnce();
    expect(api.listStations).not.toHaveBeenCalled();
    expect(target.mode).toBe("move");
    expect(target.dishName).toBe("Paella");
    expect(target.currentStationId).toBe("st-dev");
    expect(target.stations).toEqual(destinations);
    expect(target.busy).toBe(false);
    expect(target.refusal).toBeNull();
    const combobox = target.shadowRoot!.querySelector<
      HTMLElement & { options: { label: string }[] }
    >("wt-combobox")!;
    expect(combobox.options.map((option) => option.label)).toEqual([
      t("move_station.now").replace("{station}", "Cocina"),
      "Barra",
    ]);
  });

  it("choosing a station moves the dish through the display's route, closes and reloads", async () => {
    const { el, api } = await mountMove();
    const target = await open(el);
    choose(target, "st-2");
    await expect.poll(() => dialog(el)).toBeUndefined();
    expect(api.deviceMoveDishStation).toHaveBeenCalledOnce();
    expect(api.deviceMoveDishStation).toHaveBeenCalledWith(
      "wo-1",
      { submissionId: expect.any(String), lineIds: ["wol-1"], stationId: "st-2" },
      { signal: expect.any(AbortSignal) },
    );
    await expect.poll(() => vi.mocked(api.getDeviceStationScreen).mock.calls.length).toBe(2);
  });

  it("marks the dialog busy while the move is sent", async () => {
    let answer!: (value: unknown) => void;
    const { el, api } = await mountMove(
      {},
      { deviceMoveDishStation: vi.fn(() => new Promise((resolve) => (answer = resolve))) },
    );
    const target = await open(el);
    choose(target, "st-2");
    await flush(el);
    expect(dialog(el)!.busy).toBe(true);
    choose(dialog(el)!, "st-2");
    expect(api.deviceMoveDishStation).toHaveBeenCalledOnce();
    answer({ revision: 2, stationId: "st-2", moved: [] });
    await expect.poll(() => dialog(el)).toBeUndefined();
  });

  it("sends a move that got no answer again under the same submission", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ revision: 2, stationId: "st-2", moved: [] });
    const { el } = await mountMove({}, { deviceMoveDishStation: send });
    choose(await open(el), "st-2");
    await expect.poll(() => dialog(el)).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![1]).toEqual(send.mock.calls[0]![1]);
  });

  it("a refusal stays in the dialog in its own words, and the queue reloads", async () => {
    const { el, api } = await mountMove(
      {},
      {
        deviceMoveDishStation: vi.fn().mockRejectedValue({ code: "device.forbidden_station" }),
      },
    );
    choose(await open(el), "st-2");
    await expect.poll(() => dialog(el)?.refusal).toBe("device.forbidden_station");
    const target = dialog(el)!;
    await target.updateComplete;
    expect(target.busy).toBe(false);
    expect(target.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
      codeMessage("device.forbidden_station"),
    );
    expect(codeMessage("device.forbidden_station")).not.toBe(codeMessage("server.internal"));
    await expect.poll(() => vi.mocked(api.getDeviceStationScreen).mock.calls.length).toBe(2);
  });

  it("a move refused device.unauthorized asks at once to switch, and reads nothing", async () => {
    const { el, api } = await mountMove(
      {},
      { deviceMoveDishStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }) },
    );
    const switched = vi.fn();
    document.addEventListener("kitchen-screen-changed", switched);
    try {
      choose(await open(el), "st-2");
      await expect.poll(() => switched.mock.calls.length).toBe(1);
      await flush(el);
    } finally {
      document.removeEventListener("kitchen-screen-changed", switched);
    }
    expect((switched.mock.calls[0]![0] as CustomEvent<{ from: string }>).detail.from).toBe(
      "station",
    );
    expect(api.getDeviceStationScreen).toHaveBeenCalledOnce();
  });

  it("a refusal with no code shows the general sentence", async () => {
    const { el } = await mountMove(
      {},
      { deviceMoveDishStation: vi.fn().mockRejectedValue(new Error("boom")) },
    );
    choose(await open(el), "st-2");
    await expect.poll(() => dialog(el)?.refusal).toBe("server.internal");
  });

  it.each([
    ["answers", (send: { resolve: () => void; reject: () => void }) => send.resolve()],
    ["is refused", (send: { resolve: () => void; reject: () => void }) => send.reject()],
  ])("a dialog closed while its move is sent stays closed when the move %s", async (_, settle) => {
    const send = { resolve: () => {}, reject: () => {} };
    const { el, api } = await mountMove(
      {},
      {
        deviceMoveDishStation: vi.fn(
          () =>
            new Promise((resolve, reject) => {
              send.resolve = () => resolve({ revision: 2, stationId: "st-2", moved: [] });
              send.reject = () => reject({ code: "ticket.already_started" });
            }),
        ),
      },
    );
    const target = await open(el);
    choose(target, "st-2");
    await flush(el);
    target.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
    await flush(el);
    expect(dialog(el)).toBeUndefined();
    settle(send);
    await expect.poll(() => vi.mocked(api.getDeviceStationScreen).mock.calls.length).toBe(2);
    expect(dialog(el)).toBeUndefined();
  });

  it("a move answered after its dialog closed leaves another dish's dialog open", async () => {
    let answer!: (value: unknown) => void;
    const twoDishes: StationQueueGroup[] = [
      {
        ...kitchenQueue[0]!,
        items: [
          ...kitchenQueue[0]!.items,
          {
            ...kitchenQueue[0]!.items[0]!,
            id: "ti-3",
            workingOrderLineId: "wol-3",
            name: "Tortilla",
          },
        ],
      },
    ];
    const { el, api } = await mountMove(
      {},
      {
        getDeviceStationScreen: vi
          .fn()
          .mockResolvedValue({ stations: [{ ...kitchenDevice, queue: twoDishes }] }),
        deviceMoveDishStation: vi.fn(() => new Promise((resolve) => (answer = resolve))),
      },
    );
    const first = await open(el);
    choose(first, "st-2");
    await flush(el);
    first.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
    await flush(el);
    expect(dialog(el)).toBeUndefined();
    queueWidget(el)!.shadowRoot!.querySelector<HTMLElement>('[data-move-station="ti-3"]')!.click();
    await expect.poll(() => dialog(el)?.dishName).toBe("Tortilla");
    answer({ revision: 2, stationId: "st-2", moved: [] });
    await expect.poll(() => vi.mocked(api.getDeviceStationScreen).mock.calls.length).toBe(2);
    await flush(el);
    expect(dialog(el)?.dishName).toBe("Tortilla");
  });

  it("an aborted move shows the general sentence", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const { el } = await mountMove({}, { deviceMoveDishStation: send });
    choose(await open(el), "st-2");
    // An abort is no answer, so the move is sent SUBMIT_RETRIES more times, a pause apart, first.
    await expect
      .poll(() => dialog(el)?.refusal, { timeout: SUBMIT_RETRIES * SUBMIT_RETRY_PAUSE_MS + 2_000 })
      .toBe("server.internal");
    expect(send).toHaveBeenCalledTimes(SUBMIT_RETRIES + 1);
  });

  it("Cancel closes the dialog and moves nothing", async () => {
    const { el, api } = await mountMove();
    const target = await open(el);
    target.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
    await expect.poll(() => dialog(el)).toBeUndefined();
    expect(api.deviceMoveDishStation).not.toHaveBeenCalled();
  });

  it.each([null, "st-dev"])("a choice of %s moves nothing", async (stationId) => {
    const { el, api } = await mountMove();
    choose(await open(el), stationId);
    await flush(el);
    expect(api.deviceMoveDishStation).not.toHaveBeenCalled();
    expect(dialog(el)).toBeDefined();
  });

  it("a second press while the stations are read opens one dialog", async () => {
    let answer!: (value: Station[]) => void;
    const { el, api } = await mountMove(
      {},
      { deviceStations: vi.fn(() => new Promise<Station[]>((resolve) => (answer = resolve))) },
    );
    moveButton(el)!.click();
    moveButton(el)!.click();
    answer(destinations);
    await expect.poll(() => dialog(el)).toBeDefined();
    moveButton(el)!.click();
    await flush(el);
    expect(api.deviceStations).toHaveBeenCalledOnce();
    expect(dialogs(el)).toHaveLength(1);
  });

  const moveError = (el: TillStationScreen) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-move-error]");

  it.each([
    ["no answer", new TypeError("Failed to fetch")],
    ["a timeout", new DOMException("The operation was aborted.", "AbortError")],
  ])(
    "stations that cannot be read (%s) say so, and a later press that reads them opens the dialog and clears it",
    async (_, failure) => {
      const deviceStations = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(destinations);
      const { el } = await mountMove({}, { deviceStations });
      moveButton(el)!.click();
      await expect.poll(() => moveError(el)).not.toBeNull();
      expect(dialog(el)).toBeUndefined();
      expect(moveError(el)!.getAttribute("role")).toBe("alert");
      expect(moveError(el)!.textContent!.trim()).toBe("Something went wrong, try again");
      await open(el);
      expect(deviceStations).toHaveBeenCalledTimes(2);
      expect(moveError(el)).toBeNull();
    },
  );

  it("a station read refused device.unauthorized asks at once to switch and shows no message", async () => {
    const { el } = await mountMove(
      {},
      { deviceStations: vi.fn().mockRejectedValue({ code: "device.unauthorized" }) },
    );
    const reboot = vi.fn();
    document.addEventListener("kitchen-screen-changed", reboot);
    try {
      moveButton(el)!.click();
      await expect.poll(() => reboot.mock.calls.length).toBe(1);
      await flush(el);
    } finally {
      document.removeEventListener("kitchen-screen-changed", reboot);
    }
    expect(reboot).toHaveBeenCalledOnce();
    expect((reboot.mock.calls[0]![0] as CustomEvent<{ from: string }>).detail.from).toBe("station");
    expect(moveError(el)).toBeNull();
    expect(dialog(el)).toBeUndefined();
  });

  it("a queue read that succeeds after a failed station read keeps its message", async () => {
    const { el, api } = await mountMove(
      {},
      { deviceStations: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) },
    );
    moveButton(el)!.click();
    await expect.poll(() => moveError(el)).not.toBeNull();
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-ticket-item", {
        detail: { itemId: "ti-1", stationId: "st-dev", to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );
    await expect.poll(() => vi.mocked(api.getDeviceStationScreen).mock.calls.length).toBe(2);
    await flush(el);
    expect(moveError(el)!.textContent!.trim()).toBe("Something went wrong, try again");
  });
});

describe("moving the dishes a card names", () => {
  const ids = ["ti-1", "ti-2", "ti-3"];

  const deviceStation = {
    id: "st-dev",
    name: "Kitchen",
    available: true as const,
    today: { open: true, isDefault: false, byHand: null, sendsTo: null, why: "open" as const },
    printersDown: [],
    queue: kitchenQueue,
    notices: [],
  };

  function deviceApi(overrides: Record<string, unknown> = {}): TillApi {
    return {
      getDeviceStationScreen: vi.fn().mockResolvedValue({ stations: [deviceStation] }),
      deviceAdvance: vi.fn().mockResolvedValue(undefined),
      listStations: vi.fn().mockResolvedValue(stations),
      getStationQueue: vi
        .fn()
        .mockResolvedValue({ printersDown: [], items: kitchenQueue, notices: [] }),
      advanceTicketItem: vi.fn().mockResolvedValue(undefined),
      reprintOrder: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as TillApi;
  }

  const move = (el: TillStationScreen, stationId: string) =>
    queueWidget(el)!.dispatchEvent(
      new CustomEvent("advance-dishes", {
        detail: { itemIds: ids, stationId, to: "preparing" },
        bubbles: true,
        composed: true,
      }),
    );

  const alerts = (el: TillStationScreen) =>
    [...el.shadowRoot!.querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent!.trim())
      .filter(Boolean);

  it("on a till, advances each named dish in turn, then reloads the queue", async () => {
    let releaseFirst!: () => void;
    const advanceTicketItem = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(undefined);
    const api = stubApi({ advanceTicketItem });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    move(el, "st-1");
    await flush(el);
    expect(advanceTicketItem).toHaveBeenCalledTimes(1);
    expect(advanceTicketItem).toHaveBeenCalledWith("ti-1", "st-1", "preparing");
    expect(api.getStationQueue).toHaveBeenCalledTimes(1);
    releaseFirst();
    await flush(el);
    expect(advanceTicketItem.mock.calls).toEqual([
      ["ti-1", "st-1", "preparing"],
      ["ti-2", "st-1", "preparing"],
      ["ti-3", "st-1", "preparing"],
    ]);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("on a kitchen display, through deviceAdvance, then reloads the display", async () => {
    const api = deviceApi();
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceMode: true,
    });
    await flush(el);
    move(el, "st-dev");
    await flush(el);
    expect(vi.mocked(api.deviceAdvance).mock.calls).toEqual([
      ["ti-1", "preparing"],
      ["ti-2", "preparing"],
      ["ti-3", "preparing"],
    ]);
    expect(api.advanceTicketItem).not.toHaveBeenCalled();
    expect(api.getDeviceStationScreen).toHaveBeenCalledTimes(2);
  });

  it("stops at the first refusal and still reloads, with no line", async () => {
    const advanceTicketItem = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: "ticket.invalid_transition" })
      .mockResolvedValue(undefined);
    const api = stubApi({ advanceTicketItem });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    move(el, "st-1");
    await flush(el);
    expect(advanceTicketItem).toHaveBeenCalledTimes(2);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
    expect(alerts(el)).toEqual([]);
  });

  it("a refusal on a full disk says so", async () => {
    const api = stubApi({
      advanceTicketItem: vi.fn().mockRejectedValue({ code: "storage.disk_full", status: 507 }),
    });
    const { el } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    move(el, "st-1");
    await flush(el);
    expect(alerts(el)).toEqual([codeMessage("storage.disk_full")]);
    expect(api.getStationQueue).toHaveBeenCalledTimes(2);
  });

  it("a kitchen display whose screen was taken asks to switch", async () => {
    const switched = vi.fn();
    document.addEventListener("kitchen-screen-changed", switched);
    try {
      const api = deviceApi({
        deviceAdvance: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
      });
      const { el } = await mountWidget<TillStationScreen>("till-station-screen", {
        api,
        deviceMode: true,
      });
      await flush(el);
      move(el, "st-dev");
      await flush(el);
      expect(switched).toHaveBeenCalledTimes(1);
      expect((switched.mock.calls[0]![0] as CustomEvent<{ from: string }>).detail.from).toBe(
        "station",
      );
      expect(api.deviceAdvance).toHaveBeenCalledTimes(1);
      expect(api.getDeviceStationScreen).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("kitchen-screen-changed", switched);
    }
  });

  it("the event stops at the screen", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<TillStationScreen>("till-station-screen", { api });
    await flush(el);
    const escaped = vi.fn();
    host.addEventListener("advance-dishes", escaped);
    move(el, "st-1");
    await flush(el);
    expect(api.advanceTicketItem).toHaveBeenCalledTimes(3);
    expect(escaped).not.toHaveBeenCalled();
  });
});

describe("the device's kitchen columns", () => {
  afterEach(() => {
    clearStoredColumns();
    vi.restoreAllMocks();
  });

  async function mountOperator(props: Record<string, unknown> = {}) {
    const api = stubApi();
    const mounted = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceId: "dev-1",
      serverOrigin: BOX,
      ...props,
    });
    await flush(mounted.el);
    return mounted;
  }

  it("the device's kitchen columns: a collapsed column stays collapsed when the screen opens again", async () => {
    const first = await mountOperator();
    await tapColumn(first.el, "ready");
    expect(isCollapsed(queueWidget(first.el)!, "ready")).toBe(true);
    expect(storedColumnKeys()).toEqual([columnsKey("st-1")]);
    expect(JSON.parse(localStorage.getItem(columnsKey("st-1"))!)).toEqual({
      version: 1,
      order: ["waiting", "preparing", "ready"],
      hidden: [],
      collapsed: ["ready"],
    });
    cleanupWidgets();

    const again = await mountOperator();
    expect(isCollapsed(queueWidget(again.el)!, "ready")).toBe(true);
    expect(isCollapsed(queueWidget(again.el)!, "waiting")).toBe(false);
  });

  it("the device's kitchen columns: each station picked on the till keeps its own columns", async () => {
    const { el } = await mountOperator();
    await tapColumn(el, "ready");
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-2"]')!.click();
    await flush(el);
    expect(isCollapsed(queueWidget(el)!, "ready")).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-1"]')!.click();
    await flush(el);
    expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
  });

  it.each([
    ["no origin", { serverOrigin: undefined }],
    ["an empty origin", { serverOrigin: "" }],
    ["no device", { deviceId: undefined }],
  ])(
    "the device's kitchen columns: with %s it collapses for this screen only and stores nothing",
    async (_label, props) => {
      const { el } = await mountOperator(props);
      await tapColumn(el, "ready");
      expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
      await tapColumn(el, "ready");
      expect(isCollapsed(queueWidget(el)!, "ready")).toBe(false);
      expect(storedColumnKeys()).toEqual([]);
    },
  );

  it("the device's kitchen columns: a store that refuses still collapses", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      const { el } = await mountOperator();
      await tapColumn(el, "ready");
      expect(setItem).toHaveBeenCalled();
      expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    } finally {
      setItem.mockRestore();
    }
    expect(storedColumnKeys()).toEqual([]);
  });

  it("the device's kitchen columns: a browser that refuses storage altogether still collapses", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    let refused = 0;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        refused++;
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      const { el } = await mountOperator();
      await tapColumn(el, "ready");
      expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
      expect(refused).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("the device's kitchen columns: the column tap stops at the screen", async () => {
    const { el, host } = await mountOperator();
    const escaped = vi.fn();
    host.addEventListener("toggle-column", escaped);
    await tapColumn(el, "ready");
    expect(isCollapsed(queueWidget(el)!, "ready")).toBe(true);
    expect(escaped).not.toHaveBeenCalled();
  });
});

describe("the Columns window on the till", () => {
  afterEach(() => {
    clearStoredColumns();
    vi.restoreAllMocks();
    history.replaceState(null, "", "/");
  });

  async function mountOperator(props: Record<string, unknown> = {}) {
    const api = stubApi();
    const mounted = await mountWidget<TillStationScreen>("till-station-screen", {
      api,
      deviceId: "dev-1",
      serverOrigin: BOX,
      ...props,
    });
    await flush(mounted.el);
    return mounted;
  }

  it("the Columns window: on the till it is named for the picked station", async () => {
    const { el } = await mountOperator();
    await openColumns(el);
    expect(windowBoardName(el)).toBe("Cocina");
  });

  it("the Columns window: a move reorders that board at once and is kept on the device", async () => {
    const { el } = await mountOperator();
    await openColumns(el);
    await pressInWindow(el, '[data-column-up="ready"]');
    expect(columnsWindow(el)).not.toBeNull();
    expect(queueWidget(el)!.columns.order).toEqual(["waiting", "ready", "preparing"]);
    expect(JSON.parse(localStorage.getItem(columnsKey("st-1"))!).order).toEqual([
      "waiting",
      "ready",
      "preparing",
    ]);
    cleanupWidgets();
    const again = await mountOperator();
    expect(queueWidget(again.el)!.columns.order).toEqual(["waiting", "ready", "preparing"]);
  });

  it("the Columns window: its events stop at the screen", async () => {
    const { el, host } = await mountOperator();
    const escaped = vi.fn();
    for (const name of ["open-columns", "column-move", "column-show", "close"])
      host.addEventListener(name, escaped);
    await openColumns(el);
    await pressInWindow(el, '[data-column-up="ready"]');
    await pressInWindow(el, '[data-column-show="waiting"]');
    await pressInWindow(el, "[data-columns-done]");
    await vi.waitFor(() => expect(columnsWindow(el)).toBeNull());
    expect(queueWidget(el)!.columns.hidden).toEqual(["waiting"]);
    expect(escaped).not.toHaveBeenCalled();
  });

  it("the Columns window: with no origin or device it still reorders, for this screen only", async () => {
    const { el } = await mountOperator({ serverOrigin: undefined });
    await openColumns(el);
    await pressInWindow(el, '[data-column-up="ready"]');
    expect(queueWidget(el)!.columns.order).toEqual(["waiting", "ready", "preparing"]);
    expect(storedColumnKeys()).toEqual([]);
  });

  it.each(["Done", "Escape"] as const)(
    "the Columns window: %s puts the focus back on Columns",
    async (how) => {
      const { el } = await mountOperator();
      await openColumns(el);
      if (how === "Done") await pressInWindow(el, "[data-columns-done]");
      else {
        windowPart(el, '[data-column-down="waiting"]').focus();
        await userEvent.keyboard("{Escape}");
      }
      await vi.waitFor(() => expect(columnsWindow(el)).toBeNull());
      const queue = queueWidget(el)!;
      await vi.waitFor(() =>
        expect(queue.shadowRoot!.activeElement).toBe(
          queue.shadowRoot!.querySelector("[data-columns-open]"),
        ),
      );
    },
  );

  it("the Columns window: a device change closes it", async () => {
    const { el } = await mountOperator();
    await openColumns(el);
    expect(columnsWindow(el)).not.toBeNull();
    el.deviceId = "dev-2";
    await flush(el);
    expect(columnsWindow(el)).toBeNull();
  });

  it("the Columns window: a new API closes it", async () => {
    const { el } = await mountOperator();
    await openColumns(el);
    expect(columnsWindow(el)).not.toBeNull();
    el.api = stubApi();
    await flush(el);
    expect(columnsWindow(el)).toBeNull();
  });

  it("the Columns window: leaving kitchen-device mode closes it", async () => {
    const { el, host } = await mountOperator({
      api: stubApi({
        getDeviceStationScreen: vi.fn().mockResolvedValue({
          stations: [
            {
              id: "st-1",
              name: "Cocina",
              available: true,
              today: { open: true, isDefault: true, byHand: null, sendsTo: null, why: "open" },
              printersDown: [],
              queue: kitchenQueue,
              notices: [],
            },
          ],
        }),
      }),
    });
    // Both modes' stations are loaded before the flip, so st-1's board is still drawn after it and
    // only the mode change itself can close the window.
    el.deviceMode = true;
    el.remove();
    host.appendChild(el);
    await flush(el);
    await vi.waitFor(() => expect(queueWidget(el)?.stationId).toBe("st-1"));
    await openColumns(el);
    expect(windowBoardName(el)).toBe("Cocina");
    el.deviceMode = false;
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-1");
    expect(columnsWindow(el)).toBeNull();
  });

  it("the Columns window: the device getting its first id closes it", async () => {
    const { el } = await mountOperator({ deviceId: undefined });
    await openColumns(el);
    expect(columnsWindow(el)).not.toBeNull();
    el.deviceId = "dev-1";
    await flush(el);
    expect(columnsWindow(el)).toBeNull();
  });

  it("the Columns window: Back to another station closes it", async () => {
    history.replaceState(null, "", "/tabs/counter/view/station/station/st-2");
    const { el } = await mountOperator();
    expect(queueWidget(el)!.stationId).toBe("st-2");
    el.shadowRoot!.querySelector<HTMLElement>('[data-station="st-1"]')!.click();
    await flush(el);
    expect(queueWidget(el)!.stationId).toBe("st-1");
    await openColumns(el);
    expect(windowBoardName(el)).toBe("Cocina");
    history.back();
    await vi.waitFor(() => expect(queueWidget(el)!.stationId).toBe("st-2"));
    await flush(el);
    expect(columnsWindow(el)).toBeNull();
  });
});
