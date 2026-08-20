import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";

/** A fully-typed zone; overrides tweak the fields a case cares about (the render asserts real data). */
function zone(over: Partial<FloorZone> = {}): FloorZone {
  return { id: "z1", name: "Comedor", displayOrder: 0, active: true, ...over };
}

/** A fully-typed occupancy row; defaults to a free, unstatused table in zone z1. */
function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
    state: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    status: null,
    ...over,
  };
}

const mount = (over: Partial<TillFloorScreen> = {}) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone()],
    tables: [table()],
    ...over,
  });

/** Captures the first `open-table` event the element emits (composed + bubbling). */
function captureOpenTable(el: TillFloorScreen): { detail?: unknown } {
  const seen: { detail?: unknown; event?: Event } = {};
  el.addEventListener("open-table", (event) => {
    seen.event = event;
    seen.detail = (event as CustomEvent).detail;
  });
  return seen;
}

afterEach(cleanupWidgets);

describe("till-floor-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-floor-screen")).toBe(TillFloorScreen);
  });

  it("groups tables by zone and shows occupancy + por-servir badges", async () => {
    const { el } = await mount({
      zones: [zone({ id: "z1", name: "Comedor" })],
      tables: [
        table({
          id: "t1",
          label: "4",
          zoneId: "z1",
          state: "open-tab",
          hasOpenTab: true,
          tabId: "wo-9",
          tabLineCount: 3,
          tabTotal: "47.50",
          pendingToServe: 2,
          status: null,
        }),
      ],
    });
    // The zone name labels its tab; the open tab's gross total shows on the card.
    expect(el.shadowRoot!.textContent).toContain("Comedor");
    expect(el.shadowRoot!.textContent).toContain("47.50");
    // The "N still to serve" badge carries the pendingToServe count.
    expect(el.shadowRoot!.querySelector("[data-por-servir]")!.textContent).toContain("2");
  });

  it("emits open-table with hasOpenTab:false when a free table is tapped", async () => {
    const { el } = await mount({
      zones: [zone()],
      tables: [table({ id: "t1", state: "free", hasOpenTab: false })],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!.click();
    expect(seen.detail).toEqual({ tableId: "t1", hasOpenTab: false });
  });

  it("emits open-table with hasOpenTab:true when an occupied table is tapped", async () => {
    const { el } = await mount({
      zones: [zone()],
      tables: [
        table({
          id: "t7",
          state: "open-tab",
          hasOpenTab: true,
          tabId: "wo-7",
          tabLineCount: 1,
          tabTotal: "9.00",
        }),
      ],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t7"]')!.click();
    expect(seen.detail).toEqual({ tableId: "t7", hasOpenTab: true });
  });

  it("emits a composed, bubbling open-table event (it must reach the app)", async () => {
    const { el } = await mount({ tables: [table({ id: "t1" })] });
    let captured: Event | undefined;
    el.addEventListener("open-table", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });

  it("renders a free table as available (Libre), with no tab total and no por-servir badge", async () => {
    const { el } = await mount({
      tables: [
        table({ id: "t1", label: "5", state: "free", hasOpenTab: false, pendingToServe: 0 }),
      ],
    });
    const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
    expect(card.textContent).toContain("Libre");
    // A free table carries no open-tab total and no "to serve" badge.
    expect(el.shadowRoot!.querySelector("[data-por-servir]")).toBeNull();
  });

  it("renders a delivery-pending table with its pending-deliveries count", async () => {
    const { el } = await mount({
      tables: [
        table({
          id: "t2",
          label: "2",
          state: "delivery-pending",
          hasOpenTab: false,
          pendingDeliveries: 3,
        }),
      ],
    });
    const card = el.shadowRoot!.querySelector('[data-table="t2"]')!;
    expect(card.textContent).toContain("3");
  });

  it("shows a manual service-status badge (label + colour) when the table carries one", async () => {
    const { el } = await mount({
      tables: [
        table({
          id: "t1",
          status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
        }),
      ],
    });
    const badge = el.shadowRoot!.querySelector('[data-table="t1"] [data-status]')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("Reservada");
    // The manual status colour is applied as a data-driven accent, not baked into the class list.
    expect(badge.getAttribute("style")).toContain("#8b5cf6");
  });

  it("omits the status badge when the table has no manual status", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", status: null })],
    });
    expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-status]')).toBeNull();
  });

  it("renders a table whose capacity is unknown without a pax count", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", capacity: null })],
    });
    const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
    expect(card.querySelector(".capacity")).toBeNull();
  });

  it("orders the zone tabs by displayOrder", async () => {
    const { el } = await mount({
      zones: [
        zone({ id: "z2", name: "Terraza", displayOrder: 1 }),
        zone({ id: "z1", name: "Comedor", displayOrder: 0 }),
      ],
      tables: [table({ id: "t1", zoneId: "z1" })],
    });
    const tabs = [...el.shadowRoot!.querySelectorAll("[data-zone]")].map((tab) =>
      tab.getAttribute("data-zone"),
    );
    // Comedor (displayOrder 0) precedes Terraza (displayOrder 1) regardless of array order.
    expect(tabs).toEqual(["z1", "z2"]);
  });

  it("groups zoneless tables under a 'Sin zona' tab and shows them when it is selected", async () => {
    const { el } = await mount({
      zones: [zone({ id: "z1", name: "Comedor" })],
      tables: [table({ id: "t1", zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: null })],
    });
    // The default tab is the first zone: the zoneless table is not shown yet.
    expect(el.shadowRoot!.querySelector('[data-table="t9"]')).toBeNull();
    const sinZona = el.shadowRoot!.querySelector<HTMLElement>('[data-zone="none"]')!;
    expect(sinZona.textContent).toContain("Sin zona");
    sinZona.click();
    await el.updateComplete;
    // Selecting "Sin zona" reveals the null-zone table (and hides the zoned one).
    expect(el.shadowRoot!.querySelector('[data-table="t9"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-table="t1"]')).toBeNull();
  });

  it("keeps a table whose zone was deactivated (unknown zoneId) under 'Sin zona', never lost", async () => {
    // `deactivateZone` is a soft `active=false` and never nulls a table's zoneId, so a table can carry
    // a zoneId that is not among the ACTIVE zones. It must not vanish — least of all one owing money.
    const { el } = await mount({
      zones: [zone({ id: "z1", name: "Comedor" })],
      tables: [
        table({ id: "t1", zoneId: "z1" }),
        table({
          id: "tg",
          label: "G",
          zoneId: "ghost",
          state: "open-tab",
          hasOpenTab: true,
          tabId: "wo-g",
          tabLineCount: 1,
          tabTotal: "20.00",
        }),
      ],
    });
    // Not on the default (Comedor) tab — its zone is not active…
    expect(el.shadowRoot!.querySelector('[data-table="tg"]')).toBeNull();
    // …but a "Sin zona" tab exists to catch it, and selecting it reveals the orphaned table.
    const sinZona = el.shadowRoot!.querySelector<HTMLElement>('[data-zone="none"]')!;
    expect(sinZona).not.toBeNull();
    sinZona.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-table="tg"]')).not.toBeNull();
  });

  it("shows no 'Sin zona' tab when every table belongs to a zone", async () => {
    const { el } = await mount({
      zones: [zone({ id: "z1", name: "Comedor" })],
      tables: [table({ id: "t1", zoneId: "z1" })],
    });
    expect(el.shadowRoot!.querySelector('[data-zone="none"]')).toBeNull();
  });

  it("renders an empty floor without tabs or cards", async () => {
    const { el } = await mount({ zones: [], tables: [] });
    expect(el.shadowRoot!.querySelectorAll("[data-zone]")).toHaveLength(0);
    expect(el.shadowRoot!.querySelectorAll("[data-table]")).toHaveLength(0);
  });

  it("emits a composed, bubbling back-to-counter event when the back control is tapped", async () => {
    const { el } = await mount();
    let captured: Event | undefined;
    el.addEventListener("back-to-counter", (event) => (captured = event));
    el.shadowRoot!.querySelector<HTMLElement>("wt-button.back")!.click();
    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
  });
});
