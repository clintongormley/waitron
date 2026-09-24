import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState, TillApi } from "../api/client.js";

function zone(over: Partial<FloorZone> = {}): FloorZone {
  return { id: "z1", name: "Comedor", displayOrder: 0, active: true, ...over };
}

/** Defaults to a free, unstatused, UNPLACED table in zone z1, so the screen defaults to the LIST view. */
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
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    ...over,
  };
}

function placed(id: string, over: Partial<TableState> = {}): TableState {
  return table({ id, posX: 250, posY: 400, shape: "round", rotation: 0, ...over });
}

function fakeTillApi(overrides: Partial<TillApi> = {}): TillApi {
  return {
    setTablePlacement: vi.fn().mockResolvedValue(undefined),
    clearPlacement: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TillApi;
}

const EDIT_ROLES = new Set(["manager", "admin"]);

async function mountFloor(
  opts: {
    role?: string;
    canEdit?: boolean;
    editing?: boolean;
    api?: TillApi;
    zones?: FloorZone[];
    tables?: TableState[];
  } = {},
): Promise<TillFloorScreen> {
  const canEdit = opts.canEdit ?? (opts.role !== undefined && EDIT_ROLES.has(opts.role));
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: opts.zones ?? [zone()],
    tables: opts.tables ?? [table()],
    canEdit,
    api: opts.api,
  });
  if (opts.editing) {
    el.shadowRoot!.querySelector<HTMLElement>("[data-edit-toggle]")!.click();
    await el.updateComplete;
  }
  return el;
}

const mount = (over: Partial<TillFloorScreen> = {}) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone()],
    tables: [table()],
    ...over,
  });

function captureOpenTable(el: TillFloorScreen): { detail?: unknown } {
  const seen: { detail?: unknown; event?: Event } = {};
  el.addEventListener("open-table", (event) => {
    seen.event = event;
    seen.detail = (event as CustomEvent).detail;
  });
  return seen;
}

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

describe("till-floor-screen", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-floor-screen")).toBe(TillFloorScreen);
  });

  it("groups tables by zone and shows occupancy + to-serve badges", async () => {
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
    expect(el.shadowRoot!.querySelector("[data-to-serve]")!.textContent).toContain("2");
  });

  it("shows the ready-to-serve badge with the readyToServe count (KDS-1 §3d, 'N listos')", async () => {
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
          pendingToServe: 1,
          readyToServe: 2,
        }),
      ],
    });
    // readyToServe outranks pendingToServe, so only the ready badge renders.
    const ready = el.shadowRoot!.querySelector("[data-ready]")!;
    expect(ready.textContent).toContain("2");
    expect(ready.textContent).toContain(t("floor.ready"));
  });

  it("renders no ready-to-serve badge when readyToServe is 0", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", state: "open-tab", hasOpenTab: true, readyToServe: 0 })],
    });
    expect(el.shadowRoot!.querySelector("[data-ready]")).toBeNull();
  });

  it("shows the en-camino badge with the enRoute count (KDS-3 §3c, 'en camino')", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", state: "open-tab", hasOpenTab: true, enRoute: 2 })],
    });
    const enRoute = el.shadowRoot!.querySelector("[data-en-route]")!;
    expect(enRoute.textContent).toContain("2");
    expect(enRoute.textContent).toContain(t("floor.en_route"));
  });

  it("renders no en-camino badge when enRoute is 0", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", state: "open-tab", hasOpenTab: true, enRoute: 0 })],
    });
    expect(el.shadowRoot!.querySelector("[data-en-route]")).toBeNull();
  });

  it("renders ONLY the most-advanced hint per table: en camino wins over listos and por servir", async () => {
    // A table with all three signals positive (a dispatched item is still ready + unserved, so all three
    // counts can be non-zero at once) shows en camino only — the other two hints are suppressed.
    const { el } = await mount({
      tables: [
        table({
          id: "t1",
          state: "open-tab",
          hasOpenTab: true,
          pendingToServe: 3,
          readyToServe: 2,
          enRoute: 1,
        }),
      ],
    });
    expect(el.shadowRoot!.querySelector("[data-en-route]")!.textContent).toContain("1");
    expect(el.shadowRoot!.querySelector("[data-ready]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-to-serve]")).toBeNull();
  });

  it("shows listos (not por servir) when ready but nothing dispatched", async () => {
    const { el } = await mount({
      tables: [
        table({
          id: "t1",
          state: "open-tab",
          hasOpenTab: true,
          pendingToServe: 3,
          readyToServe: 2,
          enRoute: 0,
        }),
      ],
    });
    expect(el.shadowRoot!.querySelector("[data-ready]")!.textContent).toContain("2");
    expect(el.shadowRoot!.querySelector("[data-en-route]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-to-serve]")).toBeNull();
  });

  it("shows por servir when nothing is ready or dispatched", async () => {
    const { el } = await mount({
      tables: [
        table({
          id: "t1",
          state: "open-tab",
          hasOpenTab: true,
          pendingToServe: 3,
          readyToServe: 0,
          enRoute: 0,
        }),
      ],
    });
    expect(el.shadowRoot!.querySelector("[data-to-serve]")!.textContent).toContain("3");
    expect(el.shadowRoot!.querySelector("[data-ready]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-en-route]")).toBeNull();
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

  it("renders a free table as available, with no tab total and no to-serve badge", async () => {
    const { el } = await mount({
      tables: [
        table({ id: "t1", label: "5", state: "free", hasOpenTab: false, pendingToServe: 0 }),
      ],
    });
    const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
    expect(card.textContent).toContain(t("floor.free"));
    // A free table carries no open-tab total and no "to serve" badge.
    expect(el.shadowRoot!.querySelector("[data-to-serve]")).toBeNull();
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

  it("shows a 'Reservada HH:MM' chip on the list card when the table has a next reservation", async () => {
    const { el } = await mount({
      tables: [
        table({
          id: "t1",
          nextReservation: { time: "20:30" },
        }),
      ],
    });
    const chip = el.shadowRoot!.querySelector('[data-table="t1"] [data-reserved]')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain(t("floor.reserved"));
    expect(chip.textContent).toContain("20:30");
  });

  it("omits the reserved chip when the table has no next reservation", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", nextReservation: null })],
    });
    expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-reserved]')).toBeNull();
  });

  it("renders the reserved chip on the map token for a placed reserved table", async () => {
    const el = await mountFloor({
      tables: [placed("t1", { nextReservation: { time: "21:00" } })],
    });
    const token = el
      .shadowRoot!.querySelector("wt-floor-canvas")!
      .shadowRoot!.querySelector("wt-table-token")!;
    const chip = token.shadowRoot!.querySelector("[data-reserved]")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain(t("floor.reserved"));
    expect(chip.textContent).toContain("21:00");
  });

  describe("order-timing accent (timingBand)", () => {
    it("renders no timing accent for a fresh table (the existing occupancy accent is untouched)", async () => {
      const { el } = await mount({ tables: [table({ id: "t1", timingBand: "fresh" })] });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("state-free")).toBe(true);
      expect([...card.classList].some((c) => c.startsWith("age-"))).toBe(false);
      expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-forgotten]')).toBeNull();
    });

    it("renders the subtler steady accent for a warm table, no flash, no badge", async () => {
      const { el } = await mount({ tables: [table({ id: "t1", timingBand: "warm" })] });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("age-warm")).toBe(true);
      expect(card.classList.contains("flash")).toBe(false);
      expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-forgotten]')).toBeNull();
    });

    it("renders the steady red accent for an overdue table, no flash, no badge", async () => {
      const { el } = await mount({ tables: [table({ id: "t1", timingBand: "overdue" })] });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("age-overdue")).toBe(true);
      expect(card.classList.contains("flash")).toBe(false);
      expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-forgotten]')).toBeNull();
    });

    it("forgotten flashes by default (motion allowed) and shows the non-colour forgotten badge", async () => {
      const { el } = await mount({
        tables: [table({ id: "t1", timingBand: "forgotten" })],
        reducedMotion: false,
      });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("age-forgotten")).toBe(true);
      expect(card.classList.contains("flash")).toBe(true);
      const badge = el.shadowRoot!.querySelector('[data-table="t1"] [data-forgotten]')!;
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain(t("floor.forgotten"));
    });

    it("reduced motion: a forgotten table renders steady red with NO flash class, but keeps the badge", async () => {
      const { el } = await mount({
        tables: [table({ id: "t1", timingBand: "forgotten" })],
        reducedMotion: true,
      });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("age-forgotten")).toBe(true);
      expect(card.classList.contains("flash")).toBe(false);
      expect(el.shadowRoot!.querySelector('[data-table="t1"] [data-forgotten]')).not.toBeNull();
    });

    it("reduced motion never applies flash to a merely-overdue (non-forgotten) table either", async () => {
      const { el } = await mount({
        tables: [table({ id: "t1", timingBand: "overdue" })],
        reducedMotion: false,
      });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("age-overdue")).toBe(true);
      expect(card.classList.contains("flash")).toBe(false);
    });

    it("coexists with the occupancy accent — a forgotten OPEN-TAB table carries BOTH classes", async () => {
      // The occupancy state-* accent and the timing age-* accent must never clobber one another.
      const { el } = await mount({
        tables: [table({ id: "t1", state: "open-tab", hasOpenTab: true, timingBand: "forgotten" })],
      });
      const card = el.shadowRoot!.querySelector('[data-table="t1"]')!;
      expect(card.classList.contains("state-open-tab")).toBe(true);
      expect(card.classList.contains("age-forgotten")).toBe(true);
    });
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

  it("groups zoneless tables under a no-zone tab and shows them when it is selected", async () => {
    const { el } = await mount({
      zones: [zone({ id: "z1", name: "Comedor" })],
      tables: [table({ id: "t1", zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: null })],
    });
    // The default tab is the first zone: the zoneless table is not shown yet.
    expect(el.shadowRoot!.querySelector('[data-table="t9"]')).toBeNull();
    const sinZona = el.shadowRoot!.querySelector<HTMLElement>('[data-zone="none"]')!;
    expect(sinZona.textContent).toContain(t("floor.no_zone"));
    sinZona.click();
    await el.updateComplete;
    // Selecting the no-zone tab reveals the null-zone table (and hides the zoned one).
    expect(el.shadowRoot!.querySelector('[data-table="t9"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-table="t1"]')).toBeNull();
  });

  it("keeps a table whose zone was deactivated (unknown zoneId) under the no-zone tab, never lost", async () => {
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
    // …but a no-zone tab exists to catch it, and selecting it reveals the orphaned table.
    const sinZona = el.shadowRoot!.querySelector<HTMLElement>('[data-zone="none"]')!;
    expect(sinZona).not.toBeNull();
    sinZona.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-table="tg"]')).not.toBeNull();
  });

  it("shows no zoneless tab when every table belongs to a zone", async () => {
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

  it("offers no back-to-counter control on a face that cannot return to the counter", async () => {
    const { el } = await mount({ canExitToCounter: false });
    expect(el.shadowRoot!.querySelector("header.head")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-button.back")).toBeNull();
  });

  it("suppresses its own header + back when embedded, keeping view/edit toggles", async () => {
    const { el } = await mount({ embedded: true, canEdit: true });
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector(".back")).toBeNull();
    expect(el.shadowRoot!.querySelector(".edit-toggle")).not.toBeNull();
  });
});

describe("till-floor-screen — FP-2 map/list toggle, tray, Editar plano", () => {
  it("defaults to the MAP (shared canvas) when the active zone has a placed table", async () => {
    const el = await mountFloor({ tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".grid")).toBeNull();
  });

  it("threads a placed table's timingBand through to the canvas's wt-table-token (forgotten flashes on the map too)", async () => {
    const el = await mountFloor({ tables: [placed("t1", { timingBand: "forgotten" })] });
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    const token = canvas.shadowRoot!.querySelector(
      '[data-table="t1"] wt-table-token',
    ) as HTMLElement & { table: { timingBand?: string }; shadowRoot: ShadowRoot };
    // The DATA reaches the token regardless of the token's own render timing…
    expect(token.table.timingBand).toBe("forgotten");
    // …and the token renders the SAME age-forgotten flashing-red accent the till's LIST card shows.
    const card = token.shadowRoot.querySelector(".card")!;
    expect(card.classList.contains("age-forgotten")).toBe(true);
  });

  it("threads a warm timingBand through to the canvas token as the subtler steady accent (no flash)", async () => {
    const el = await mountFloor({ tables: [placed("t1", { timingBand: "warm" })] });
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    const token = canvas.shadowRoot!.querySelector(
      '[data-table="t1"] wt-table-token',
    ) as HTMLElement & { shadowRoot: ShadowRoot };
    const card = token.shadowRoot.querySelector(".card")!;
    expect(card.classList.contains("age-warm")).toBe(true);
    expect(card.classList.contains("flash")).toBe(false);
  });

  it("defaults to the LIST (FP-1 cards) when the active zone has no placed table", async () => {
    const el = await mountFloor({ tables: [table({ id: "t1" })] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).toBeNull();
    expect(el.shadowRoot!.querySelector('.grid [data-table="t1"]')).not.toBeNull();
  });

  it("a manual toggle flips the map to the list", async () => {
    const el = await mountFloor({ tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).toBeNull();
    expect(el.shadowRoot!.querySelector('.grid [data-table="t1"]')).not.toBeNull();
  });

  it("a manual toggle flips the list to the map", async () => {
    const el = await mountFloor({ tables: [table({ id: "t1" })] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")).not.toBeNull();
  });

  it("lists the active zone's UNPLACED tables in a tray in map view (placed stays on the canvas)", async () => {
    const el = await mountFloor({
      zones: [zone({ id: "z1" })],
      tables: [placed("t1", { zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: "z1" })],
    });
    expect(el.shadowRoot!.querySelector('[data-tray-table="t9"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-tray-table="t1"]')).toBeNull();
  });

  it("emits open-table (with the resolved hasOpenTab) when a tray table is tapped in VIEW mode", async () => {
    const el = await mountFloor({ tables: [placed("t1"), table({ id: "t9", label: "9" })] });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-tray-table="t9"]')!.click();
    expect(seen.detail).toEqual({ tableId: "t9", hasOpenTab: false });
  });

  it("in EDIT mode, tapping an unplaced tray table PLACES it (not opens it)", async () => {
    // In edit mode a tray tap places the table; it must NOT emit open-table.
    const api = fakeTillApi();
    const el = await mountFloor({
      role: "manager",
      api,
      editing: true,
      zones: [zone({ id: "z1" })],
      tables: [placed("t1", { zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: "z1" })],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-tray-table="t9"]')!.click();
    expect(api.setTablePlacement).toHaveBeenCalledWith(
      "t9",
      expect.objectContaining({
        zoneId: "z1",
        shape: "round",
        rotation: 0,
        posY: 500,
        posX: expect.any(Number),
      }),
    );
    // The default coords are in the canvas's 0..1000 permille range.
    const placement = (api.setTablePlacement as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      posX: number;
    };
    expect(placement.posX).toBeGreaterThanOrEqual(0);
    expect(placement.posX).toBeLessThanOrEqual(1000);
    expect(seen.detail).toBeUndefined();
  });

  it("swallows a rejected tap-to-place and still refreshes", async () => {
    const api = fakeTillApi({
      setTablePlacement: vi.fn().mockRejectedValue({ code: "zone.not_found" }),
    });
    const el = await mountFloor({
      role: "manager",
      api,
      editing: true,
      zones: [zone({ id: "z1" })],
      tables: [placed("t1", { zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: "z1" })],
    });
    let refreshed = false;
    el.addEventListener("floor-refresh", () => (refreshed = true));
    el.shadowRoot!.querySelector<HTMLElement>('[data-tray-table="t9"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).toBe(true);
  });

  it("re-emits a canvas wt-open-table as open-table with hasOpenTab resolved from the read-model", async () => {
    const el = await mountFloor({
      tables: [
        placed("t1", {
          state: "open-tab",
          hasOpenTab: true,
          tabId: "wo-1",
          tabLineCount: 1,
          tabTotal: "9.00",
        }),
      ],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(seen.detail).toEqual({ tableId: "t1", hasOpenTab: true });
  });

  it("ignores a canvas wt-open-table for a table the read-model does not know", async () => {
    const el = await mountFloor({ tables: [placed("t1")] });
    const seen = captureOpenTable(el);
    const escaped = vi.fn();
    el.addEventListener("wt-open-table", escaped);
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "gone" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(seen.detail).toBeUndefined();
    expect(escaped).not.toHaveBeenCalled();
  });

  it("leaving edit mode makes the canvas read-only again and keeps the map", async () => {
    const el = await mountFloor({ role: "manager", editing: true, tables: [table({ id: "t1" })] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")!.hasAttribute("editable")).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-edit-toggle]")!.click();
    await el.updateComplete;
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.hasAttribute("editable")).toBe(false);
  });

  it("without an API, a canvas placement edit writes nothing and asks for no refresh", async () => {
    const el = await mountFloor({ role: "manager", editing: true, tables: [placed("t1")] });
    const refreshed = vi.fn();
    el.addEventListener("floor-refresh", refreshed);
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    canvas.dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    canvas.dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).not.toHaveBeenCalled();
  });

  it("without an API, an edit-mode tray tap neither places nor opens the table", async () => {
    const el = await mountFloor({
      role: "manager",
      editing: true,
      tables: [placed("t1"), table({ id: "t9", label: "9" })],
    });
    const seen = captureOpenTable(el);
    const refreshed = vi.fn();
    el.addEventListener("floor-refresh", refreshed);
    el.shadowRoot!.querySelector<HTMLElement>('[data-tray-table="t9"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen.detail).toBeUndefined();
    expect(refreshed).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[data-tray-table="t9"]')).not.toBeNull();
  });

  it("hides Editar plano for a non-manager operator", async () => {
    const el = await mountFloor({ role: "staff", tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("[data-edit-toggle]")).toBeNull();
  });

  it("shows Editar plano for a manager operator", async () => {
    const el = await mountFloor({ role: "manager", tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("[data-edit-toggle]")).not.toBeNull();
  });

  it("entering edit mode makes the shared canvas editable", async () => {
    const el = await mountFloor({ role: "manager", tables: [placed("t1")] });
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")!.hasAttribute("editable")).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-edit-toggle]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-floor-canvas")!.hasAttribute("editable")).toBe(true);
  });

  it("persists a canvas placement-change via the till route", async () => {
    const api = fakeTillApi();
    const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(api.setTablePlacement).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" }),
    );
  });

  it("un-places a table via the canvas placement-clear → clearPlacement", async () => {
    const api = fakeTillApi();
    const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(api.clearPlacement).toHaveBeenCalledWith("t1");
  });

  it("asks the app to refresh the floor after a placement write lands", async () => {
    const api = fakeTillApi();
    const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
    let refreshed = false;
    el.addEventListener("floor-refresh", () => (refreshed = true));
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    // The write is awaited before the refresh dispatch, so let the microtask queue settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).toBe(true);
  });

  it("swallows a rejected placement-change and still refreshes (reconciles to server truth)", async () => {
    // The screen must not throw on a refused write; it refreshes so the map snaps back to what persisted.
    const api = fakeTillApi({
      setTablePlacement: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
    let refreshed = false;
    el.addEventListener("floor-refresh", () => (refreshed = true));
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-placement-change", {
        detail: { tableId: "t1", posX: 100, posY: 100, shape: "round", rotation: 0, zoneId: "z1" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).toBe(true);
  });

  it("swallows a rejected placement-clear and still refreshes", async () => {
    const api = fakeTillApi({
      clearPlacement: vi.fn().mockRejectedValue({ code: "table.not_found" }),
    });
    const el = await mountFloor({ role: "manager", api, editing: true, tables: [placed("t1")] });
    let refreshed = false;
    el.addEventListener("floor-refresh", () => (refreshed = true));
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-placement-clear", {
        detail: { tableId: "t1" },
        bubbles: true,
        composed: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshed).toBe(true);
  });
});

describe("floor zone URL navigation", () => {
  it("restores the zone after refresh and records a new zone selection", async () => {
    const url = new URL(location.href);
    url.pathname = "/tabs/floor/zone/z2";
    history.replaceState(null, "", url);
    const { el } = await mount({
      zones: [zone(), zone({ id: "z2", name: "Terrace" })],
      tables: [table(), table({ id: "t2", zoneId: "z2" })],
    });
    expect(el.shadowRoot!.querySelector('[data-table="t2"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-table="t1"]')).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z1"]')!.click();
    await el.updateComplete;
    expect(location.pathname).toBe("/tabs/floor/zone/z1");
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-table="t2"]')).not.toBeNull();
  });

  it("restores and records the no-zone tab as an empty zone segment", async () => {
    const url = new URL(location.href);
    url.pathname = "/tabs/floor/zone/~";
    history.replaceState(null, "", url);
    const { el } = await mount({
      zones: [zone()],
      tables: [table(), table({ id: "t9", label: "9", zoneId: null })],
    });
    expect(el.shadowRoot!.querySelector('[data-table="t9"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-table="t1"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-zone="none"]')!.getAttribute("variant")).toBe(
      "primary",
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z1"]')!.click();
    await el.updateComplete;
    expect(location.pathname).toBe("/tabs/floor/zone/z1");
    el.shadowRoot!.querySelector<HTMLElement>('[data-zone="none"]')!.click();
    await el.updateComplete;
    expect(location.pathname).toBe("/tabs/floor/zone/~");
  });
});
