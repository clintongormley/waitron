import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillStationQueue } from "./station-queue.js";
import type { StationQueueGroup } from "../api/client.js";

// Two orders' worth of lines at one station: order 5 has a queued + a preparing line, order 6 a ready
// line — one item in each of the three kitchen states, so the kanban columns and the rail cards can be
// asserted from a single mount.
const groupA: StationQueueGroup = {
  orderId: "wo-1",
  orderNumber: 5,
  label: "Mesa 4",
  queuedAt: "2026-08-17T10:00:00.000Z",
  // A fired-at-placing Mode-I/T order awaiting the FISCAL collect — NOT collectable via the Mode-P
  // handover, so its card shows no collect button.
  status: "placed",
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
  ],
};

const groupB: StationQueueGroup = {
  orderId: "wo-2",
  orderNumber: 6,
  label: null,
  queuedAt: "2026-08-17T10:05:00.000Z",
  // A SETTLED Mode-P pickup awaiting its counter handover — COLLECTABLE, so its rail card shows the
  // collect button.
  status: "settled",
  items: [
    {
      id: "ti-3",
      workingOrderLineId: "wol-3",
      state: "ready",
      descriptions: { "es-ES": "Café" },
      quantity: "3.000",
    },
  ],
};

const groups = [groupA, groupB];

afterEach(cleanupWidgets);

describe("till-station-queue", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-station-queue")).toBe(TillStationQueue);
  });

  it("shows the empty placeholder and no tickets when the station queue is empty", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", { groups: [] });
    expect(el.shadowRoot!.textContent).toContain(t("station.empty"));
    expect(el.shadowRoot!.querySelectorAll("[data-item]")).toHaveLength(0);
  });

  it("kanban is the default view: three state columns, each holding its state's lines", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    expect(
      el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-1"]'),
    ).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector('[data-column="preparing"] [data-item="ti-2"]'),
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-column="ready"] [data-item="ti-3"]')).not.toBeNull();
    // Each column is headed by its localised state name.
    const queuedCol = el.shadowRoot!.querySelector('[data-column="queued"]')!;
    expect(queuedCol.textContent).toContain(t("station.state.queued"));
  });

  it("rail view renders one ticket card per order with its number and label", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets).toHaveLength(2);
    expect(tickets[0]!.textContent).toContain("5");
    expect(tickets[0]!.textContent).toContain("Mesa 4");
    // Both of order 5's lines render inside its own card.
    expect(tickets[0]!.querySelector('[data-item="ti-1"]')).not.toBeNull();
    expect(tickets[0]!.querySelector('[data-item="ti-2"]')).not.toBeNull();
  });

  it("rail: each line shows its quantity × dish name (the cook's line), not a bare line number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-1"]')!.textContent).toContain("2× Paella");
    expect(el.shadowRoot!.querySelector('[data-item="ti-2"]')!.textContent).toContain("1× Agua");
  });

  it("kanban: each cell shows its quantity × dish name alongside the order number", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-1"]')!;
    expect(cell.textContent).toContain("2× Paella");
    // The order-number context (which order this dish belongs to) is preserved for the cook.
    expect(cell.textContent).toContain("5");
  });

  it("resolves the dish name in the operator locale, falling back to the first available description", async () => {
    const group: StationQueueGroup = {
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      status: "settled",
      items: [
        {
          id: "ti-x",
          workingOrderLineId: "wol-x",
          state: "queued",
          // No es-ES key (the operator locale) — the widget degrades to the only value present,
          // matching `productName`'s first-available fallback rather than blanking the cell.
          descriptions: { en: "Fish" },
          quantity: "1.000",
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-x"]')!.textContent).toContain("1× Fish");
  });

  it("line mode: tapping a queued line emits advance-ticket-item { itemId, to: 'preparing' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-1", to: "preparing" });
  });

  it("line mode: tapping a preparing line emits advance-ticket-item { itemId, to: 'ready' }", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-2"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "ti-2", to: "ready" });
  });

  it("a ready line renders no bump control (its kitchen state is terminal)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    // The item is still shown, but as an inert element — never a button.
    expect(el.shadowRoot!.querySelector('[data-item="ti-3"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('button[data-item="ti-3"]')).toBeNull();
  });

  it("ticket mode: tapping a line emits advance-ticket { orderId, stationId, to } (whole-ticket)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
      bumpMode: "ticket",
    });
    const item = vi.fn();
    const ticket = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => item((e as CustomEvent).detail));
    el.addEventListener("advance-ticket", (e) => ticket((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    // The whole-ticket convenience fires instead of the per-line one.
    expect(item).not.toHaveBeenCalled();
    expect(ticket).toHaveBeenCalledWith({ orderId: "wo-1", stationId: "st-1", to: "preparing" });
  });

  it("ticket mode without a stationId cannot fire a whole-ticket bump (the route is station-keyed)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      bumpMode: "ticket", // no stationId
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket", (e) => spy((e as CustomEvent).detail));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("the advance events are composed and bubble", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("advance-ticket-item", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="ti-1"]')!.click();
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("rail: a SETTLED (collectable) order shows a per-order collect button; a placed one does not", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    // groupB (wo-2) is settled → the Mode-P handover is offered; groupA (wo-1) is placed → not.
    const collectB = el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]');
    expect(collectB).not.toBeNull();
    expect(collectB!.textContent).toContain(t("station.collect"));
    expect(el.shadowRoot!.querySelector('[data-collect="wo-1"]')).toBeNull();
  });

  it("rail: tapping the collect button emits mark-collected { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("mark-collected", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-collect="wo-2"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-2" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("kanban: no per-order collect button (the handover is a rail-card, counter-side action)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // groupB is settled, but kanban cells cut across orders — no per-order card to host it
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("age-colours each ticket by how long its oldest line has waited (fresh / warm / hot)", async () => {
    // `now` is injected so the buckets are deterministic. groupA queued at 10:00Z, groupB at 10:05Z.
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → hot, B: 7 min → warm
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets[0]!.classList.contains("age-hot")).toBe(true);
    expect(tickets[1]!.classList.contains("age-warm")).toBe(true);
  });

  it("age-colours a just-queued ticket as fresh", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // A: 1 min → fresh
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-fresh")).toBe(true);
  });
});
