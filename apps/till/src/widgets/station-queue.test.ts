import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationThresholds } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillStationQueue } from "./station-queue.js";
import type { StationQueueGroup } from "../api/client.js";

// The station's KDS order-timing thresholds (KDS order-timing alerts, design §4/§6) — the shipped
// DB defaults (warm 5 / overdue 10 / forgotten 15 minutes), reused across every fixture below so the
// existing minute-based scenarios keep meaning what they said before the two-band `#ageBucket` became
// the shared three-band `classifyBand`.
const DEFAULT_THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

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
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "ti-1",
      workingOrderLineId: "wol-1",
      state: "queued",
      descriptions: { "es-ES": "Paella" },
      quantity: "2.000",
      // KDS-1 world: no courses, everything auto-fired (advanceable). KDS-2's course-grouping /
      // held-greying cases live in their own `describe` below with their own fixtures.
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
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "ti-3",
      workingOrderLineId: "wol-3",
      state: "ready",
      descriptions: { "es-ES": "Café" },
      quantity: "3.000",
      course: null,
      firedAt: "2026-08-17T10:05:00.000Z",
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
      thresholds: DEFAULT_THRESHOLDS,
      items: [
        {
          id: "ti-x",
          workingOrderLineId: "wol-x",
          state: "queued",
          // No es-ES key (the operator locale) — the widget degrades to the only value present,
          // matching `productName`'s first-available fallback rather than blanking the cell.
          descriptions: { en: "Fish" },
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
        },
      ],
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
      stationId: "st-1",
    });
    expect(el.shadowRoot!.querySelector('[data-item="ti-x"]')!.textContent).toContain("1× Fish");
  });

  describe("ordering modifiers (Task 14): selected options as indented sub-text under the dish", () => {
    // A fired dish with TWO selected options — the wire shape `listStationQueue` already returns
    // (Task 7), the KDS widget just doesn't render it yet.
    const withModifiers: StationQueueGroup = {
      orderId: "wo-9",
      orderNumber: 9,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-9",
          workingOrderLineId: "wol-9",
          state: "queued",
          descriptions: { "es-ES": "Cortado" },
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          modifiers: [
            { descriptions: { "es-ES": "Grande" } },
            { descriptions: { "es-ES": "Leche avena" } },
          ],
        },
      ],
    };

    it("rail: renders the dish then its two options as indented '+ name' sub-text", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withModifiers],
        view: "rail",
        stationId: "st-9",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-9"]')!;
      expect(item.textContent).toContain("1× Cortado");
      expect(item.textContent).toContain("+ Grande");
      expect(item.textContent).toContain("+ Leche avena");
      // The dish precedes its modifiers in DOM order (kitchen-print ticket style: dish, then options).
      const html = item.innerHTML;
      expect(html.indexOf("Cortado")).toBeLessThan(html.indexOf("Grande"));
      expect(html.indexOf("Grande")).toBeLessThan(html.indexOf("Leche avena"));
    });

    it("kanban: renders the same indented options beneath the cell's dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withModifiers],
        stationId: "st-9",
      });
      const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-9"]')!;
      expect(cell.textContent).toContain("1× Cortado");
      expect(cell.textContent).toContain("+ Grande");
      expect(cell.textContent).toContain("+ Leche avena");
    });

    it("a modifier-free item renders flat, with no modifiers sub-text at all (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item here carries `modifiers`
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-modifiers")).toHaveLength(0);
    });
  });

  describe("as-served allergens (Task 9): contains chips, NO <CODE> removals, not-reviewed note", () => {
    // A fired dish carrying the server-attached as-served profile: it CONTAINS milk (a "+ extra cheese"
    // option added it) and REMOVED gluten (a "gluten-free bun" option stripped it) — the exact shape
    // `listStationQueue` now returns (Task 8), which the KDS just doesn't render yet.
    const withAllergens: StationQueueGroup = {
      orderId: "wo-a",
      orderNumber: 11,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-a",
          workingOrderLineId: "wol-a",
          state: "queued",
          descriptions: { "es-ES": "Hamburguesa" },
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: { milk: { presence: "contains" } }, pending: false },
          removed: ["gluten"],
        },
      ],
    };

    // A dish whose OWN allergens are unreviewed (a null base) — the Cautious fold is `pending`, so the
    // KDS must warn the cook the plate is not verified rather than read it as allergen-free.
    const pendingItem: StationQueueGroup = {
      orderId: "wo-p",
      orderNumber: 12,
      label: null,
      queuedAt: "2026-08-17T10:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS,
      status: "placed",
      items: [
        {
          id: "ti-p",
          workingOrderLineId: "wol-p",
          state: "queued",
          descriptions: { "es-ES": "Especial" },
          quantity: "1.000",
          course: null,
          firedAt: "2026-08-17T10:00:00.000Z",
          asServed: { allergens: {}, pending: true },
          removed: [],
        },
      ],
    };

    it("rail: shows a struck 'NO GLUTEN' removal callout and a localised 'Milk' contains chip", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withAllergens],
        view: "rail",
        stationId: "st-a",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-a"]')!;
      expect(item.textContent).toMatch(/no gluten/i);
      expect(item.textContent).toMatch(/milk/i);
      // The removal is a dedicated, targetable callout (its own class + data attribute), not just text.
      expect(item.querySelector('[data-removed="gluten"]')).not.toBeNull();
    });

    it("kanban: shows the same removal callout and contains chip beneath the cell's dish", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [withAllergens],
        stationId: "st-a",
      });
      const cell = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="ti-a"]')!;
      expect(cell.textContent).toMatch(/no gluten/i);
      expect(cell.textContent).toMatch(/milk/i);
    });

    it("shows a not-reviewed warning when the as-served fold is pending", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [pendingItem],
        view: "rail",
        stationId: "st-p",
      });
      const item = el.shadowRoot!.querySelector('[data-item="ti-p"]')!;
      expect(item.textContent).toContain(t("allergens.not_reviewed"));
    });

    it("a plain item with no as-served profile and nothing removed renders no allergen row (regression-safe)", async () => {
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups, // the top-level fixture — no item carries asServed/removed
        view: "rail",
        stationId: "st-1",
      });
      expect(el.shadowRoot!.querySelectorAll(".line-allergens")).toHaveLength(0);
    });
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

  it("advanceOnly: suppresses the collect button on a settled order (device mode has no collect route, §3d)", async () => {
    // In device mode the queue is advance-only: there is no device collect route, so the Mode-P handover
    // button must not render (a button that isn't there can't emit a no-op mark-collected).
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // groupB (wo-2) is settled → normally collectable
      view: "rail",
      stationId: "st-1",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-collect]")).toBeNull();
  });

  it("rail: showReprint renders a per-order reprint button on every card; off by default", async () => {
    // Default (showReprint unset) — the counter/app widget instances embed it WITHOUT reprint.
    const off = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
    });
    expect(off.el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();

    // showReprint on — one reprint button per order (both a placed and a settled order get it: reprint is
    // status-independent, unlike collect).
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
      showReprint: true,
    });
    const one = el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]');
    expect(one).not.toBeNull();
    expect(one!.textContent).toContain(t("station.reprint"));
    expect(el.shadowRoot!.querySelector('[data-reprint="wo-2"]')).not.toBeNull();
  });

  it("kanban: no per-order reprint button even with showReprint (it is a rail-card action)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups, // kanban cells cut across orders — no per-order card to host a reprint
      stationId: "st-1",
      showReprint: true,
    });
    expect(el.shadowRoot!.querySelector("[data-reprint]")).toBeNull();
  });

  it("rail: tapping the reprint button emits reprint-order { orderId }, composed and bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      stationId: "st-1",
      showReprint: true,
    });
    let captured: CustomEvent | undefined;
    el.addEventListener("reprint-order", (e) => (captured = e as CustomEvent));
    el.shadowRoot!.querySelector<HTMLElement>('[data-reprint="wo-1"]')!.click();
    expect(captured!.detail).toEqual({ orderId: "wo-1" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("age-colours each ticket by how long its oldest line has waited (fresh / warm / overdue)", async () => {
    // `now` is injected so the bands are deterministic. groupA queued at 10:00Z, groupB at 10:05Z.
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, B: 7 min → warm
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    const tickets = el.shadowRoot!.querySelectorAll(".ticket");
    expect(tickets[0]!.classList.contains("age-overdue")).toBe(true);
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

  it("a line 16 minutes old escalates to forgotten (past the default 15-minute threshold)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".ticket")!.classList.contains("age-forgotten")).toBe(true);
  });

  it("kanban: the age accent is also applied to each cell (today only the rail ticket carried it)", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      now, // default view: kanban
    });
    const cell = el.shadowRoot!.querySelector('[data-item="ti-1"]')!.closest(".cell")!;
    expect(cell.classList.contains("age-overdue")).toBe(true);
  });

  it("the header shows a legible overdue+forgotten count badge — a non-colour tell, not just borders", async () => {
    // groupA is 12 min old (overdue), groupB is 7 min old (warm) — one group has escalated.
    const now = Date.parse("2026-08-17T10:12:00.000Z");
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    const badge = el.shadowRoot!.querySelector(".overdue-count")!;
    expect(badge.textContent).toContain("1");
    expect(badge.textContent).toContain(t("station.overdue_count"));
  });

  it("the header shows no badge at all when nothing has escalated to overdue", async () => {
    const now = Date.parse("2026-08-17T10:01:00.000Z"); // both groups fresh/near-fresh
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")).toBeNull();
  });

  it("the header counts BOTH overdue and forgotten groups (band rank ≥ overdue)", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten, B: 11 min → overdue
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups,
      view: "rail",
      now,
    });
    expect(el.shadowRoot!.querySelector(".overdue-count")!.textContent).toContain("2");
  });

  it("forgotten flashes by default (motion allowed) — the flash class rides alongside the steady accent", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(true);
  });

  it("reduced motion: a forgotten ticket renders the steady-red class with NO flash/animation class", async () => {
    const now = Date.parse("2026-08-17T10:16:00.000Z"); // A: 16 min → forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: true,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    // Still the steady red accent — just never the class the flashing @keyframes is scoped to.
    expect(ticket.classList.contains("age-forgotten")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });

  it("reduced motion never applies flash to a merely-overdue (non-forgotten) ticket either", async () => {
    const now = Date.parse("2026-08-17T10:12:00.000Z"); // A: 12 min → overdue, not forgotten
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [groupA],
      view: "rail",
      now,
      reducedMotion: false,
    });
    const ticket = el.shadowRoot!.querySelector(".ticket")!;
    expect(ticket.classList.contains("age-overdue")).toBe(true);
    expect(ticket.classList.contains("flash")).toBe(false);
  });
});

// KDS-2 (design §5a): the station display groups each order's lines BY COURSE (a header per course, in
// `display_order`, with the null course — the auto-fired earliest — first). A HELD course (every line
// `firedAt == null`) renders greyed + non-advanceable; a fired course behaves as KDS-1. When
// `fire_control = 'kitchen'` the display owns the fire, so each held course shows an "Empezar curso"
// button → `fire-course { orderId, courseId }`; under `waiter` (the default) it shows none. Course
// grouping + fire live on the RAIL lens (a per-order card action, like the collect handover), while the
// held-greying invariant applies to the cross-order kanban cells too.
//
// The fixture is one order with three courses listed OUT of display order — a held later course first,
// then a fired middle course, then the fired null (bread) course — so a passing grouping test proves the
// widget re-orders (null, then by display_order) rather than echoing the item order.
const coursedOrder: StationQueueGroup = {
  orderId: "wo-c",
  orderNumber: 7,
  label: "Mesa 2",
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: DEFAULT_THRESHOLDS,
  items: [
    {
      id: "it-main",
      workingOrderLineId: "wl-main",
      state: "queued",
      descriptions: { "es-ES": "Solomillo" },
      quantity: "1.000",
      // Principales — HELD (fired_at null), display_order 2: must render LAST despite being listed first.
      course: { id: "co-main", name: "Principales", displayOrder: 2 },
      firedAt: null,
    },
    {
      id: "it-start",
      workingOrderLineId: "wl-start",
      state: "preparing",
      descriptions: { "es-ES": "Ensalada" },
      quantity: "1.000",
      // Entrantes — FIRED, display_order 1: renders after the null course, before Principales.
      course: { id: "co-start", name: "Entrantes", displayOrder: 1 },
      firedAt: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "it-bread",
      workingOrderLineId: "wl-bread",
      state: "queued",
      descriptions: { "es-ES": "Pan" },
      quantity: "1.000",
      // The null course — auto-fired earliest — must render FIRST, and carries no header.
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
};

describe("till-station-queue — KDS-2 courses & fire", () => {
  it("rail: groups a card's lines by course, header per named course, ordered null-course-first then by displayOrder", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const sections = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-course]")];
    // Three course sections in display order: the null course, then Entrantes (1), then Principales (2).
    expect(sections.map((s) => s.dataset.course)).toEqual(["none", "co-start", "co-main"]);
    // The null course carries no header; the named courses show their name.
    expect(sections[0]!.querySelector(".course-head")).toBeNull();
    expect(sections[0]!.querySelector('[data-item="it-bread"]')).not.toBeNull();
    expect(sections[1]!.querySelector(".course-head")!.textContent).toContain("Entrantes");
    expect(sections[2]!.querySelector(".course-head")!.textContent).toContain("Principales");
  });

  it("rail: a HELD course's line renders greyed (held) and non-advanceable — a span, never a bump button", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const held = el.shadowRoot!.querySelector('[data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    // Non-advanceable: it is the inert span, not the tappable button (so no advance can be emitted).
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
    expect(held.tagName).toBe("SPAN");
  });

  it("rail: a held line does not emit an advance when clicked (it is not a bump target)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", spy);
    el.shadowRoot!.querySelector<HTMLElement>('[data-item="it-main"]')!.click();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rail: a FIRED course's line stays advanceable (KDS-1 behaviour is unchanged for fired items)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
    });
    const spy = vi.fn();
    el.addEventListener("advance-ticket-item", (e) => spy((e as CustomEvent).detail));
    // Entrantes is fired + preparing → tappable, advances to ready.
    el.shadowRoot!.querySelector<HTMLElement>('button[data-item="it-start"]')!.click();
    expect(spy).toHaveBeenCalledWith({ itemId: "it-start", to: "ready" });
  });

  it("kitchen fire: a held course shows the Empezar curso button; clicking it emits fire-course, composed + bubbling", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    const fire = el.shadowRoot!.querySelector<HTMLElement>('[data-fire="co-main"]')!;
    expect(fire).not.toBeNull();
    expect(fire.textContent).toContain(t("station.fire_course"));
    let captured: CustomEvent | undefined;
    el.addEventListener("fire-course", (e) => (captured = e as CustomEvent));
    fire.click();
    expect(captured!.detail).toEqual({ orderId: "wo-c", courseId: "co-main" });
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("kitchen fire: a FIRED course and the null course show no fire button (nothing to release)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
    });
    // Only the held Principales course is fireable; the fired Entrantes and the (null, always-fired)
    // bread course are not.
    expect(el.shadowRoot!.querySelectorAll("[data-fire]")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector('[data-fire="co-start"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-fire="none"]')).toBeNull();
  });

  it("waiter fire: the display shows no fire button even for a held course (the tab screen fires — Task 7)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      view: "rail",
      stationId: "st-1",
      fireControl: "waiter", // the default; the held course is still greyed, just not fireable here
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    // The held line is still greyed + non-advanceable regardless of who owns the fire.
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });

  it("kanban: a held line renders greyed and non-advanceable in its state column too", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1", // default kanban view
    });
    const held = el.shadowRoot!.querySelector('[data-column="queued"] [data-item="it-main"]')!;
    expect(held.classList.contains("held")).toBe(true);
    expect(el.shadowRoot!.querySelector('button[data-item="it-main"]')).toBeNull();
  });

  it("kanban: no fire button (the fire is a per-order rail-card action, like the collect handover)", async () => {
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder],
      stationId: "st-1",
      fireControl: "kitchen", // even in kitchen mode, kanban has no per-order card to host the action
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
  });

  it("advanceOnly: suppresses the kitchen-fire button on a held course (device mode has no fire route, §3d)", async () => {
    // Device mode is advance-only: there is no device fire route, so even a held course under
    // `fire_control = 'kitchen'` shows no Empezar curso button (it would only 401 → no-op).
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [coursedOrder], // Principales (co-main) is held → normally fireable under kitchen
      view: "rail",
      stationId: "st-1",
      fireControl: "kitchen",
      advanceOnly: true,
    });
    expect(el.shadowRoot!.querySelector("[data-fire]")).toBeNull();
    // The held line is still greyed + non-advanceable — advanceOnly hides the FIRE button, not the greying.
    expect(el.shadowRoot!.querySelector('[data-item="it-main"]')!.classList.contains("held")).toBe(
      true,
    );
  });
});
