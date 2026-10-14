import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";

function zone(over: Partial<FloorZone> = {}): FloorZone {
  return {
    id: "z1",
    name: "Comedor",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: false,
    serviceMode: "table_tab",
    ...over,
  };
}

/** Defaults to a free, unstatused, UNPLACED table in zone z1, so the screen defaults to the LIST view. */
function today(): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

function placed(id: string, over: Partial<TableState> = {}): TableState {
  return table({ id, today: today(), ...over });
}

async function mountFloor(
  opts: {
    api?: TillApi;
    zones?: FloorZone[];
    tables?: TableState[];
  } = {},
): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: opts.zones ?? [zone()],
    tables: opts.tables ?? [table()],
    api: opts.api,
  });
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

  it("asks for the guest count when a free table is tapped, and seats it once that is given", async () => {
    const { el } = await mount({
      zones: [zone()],
      tables: [table({ id: "t1", state: "free", hasOpenTab: false })],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!.click();
    await el.updateComplete;
    expect(seen.detail).toBeUndefined();
    el.shadowRoot!.querySelector("till-seat-dialog")!.dispatchEvent(
      new CustomEvent("seat-confirm", {
        detail: { guestCount: null },
        bubbles: true,
        composed: true,
      }),
    );
    expect(seen.detail).toEqual({ tableId: "t1", seated: false, guestCount: null });
  });

  it("emits open-table with seated:true when an occupied table is tapped", async () => {
    const { el } = await mount({
      zones: [zone()],
      tables: [
        table({
          id: "t7",
          state: "open-tab",
          hasOpenTab: true,
          tabLineCount: 1,
          tabTotal: "9.00",
        }),
      ],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t7"]')!.click();
    expect(seen.detail).toEqual({ tableId: "t7", seated: true });
  });

  it("emits a composed, bubbling open-table event (it must reach the app)", async () => {
    const { el } = await mount({
      tables: [table({ id: "t1", state: "open-tab", hasOpenTab: true })],
    });
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
      tables: [table({ id: "t1" })],
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

  it("suppresses its own header + back when embedded, keeping the view toggle", async () => {
    const { el } = await mount({ embedded: true });
    expect(el.shadowRoot!.querySelector("header.head")).toBeNull();
    expect(el.shadowRoot!.querySelector(".back")).toBeNull();
    expect(el.shadowRoot!.querySelector(".edit-toggle")).toBeNull();
  });
});

describe("till-floor-screen — map/list toggle and tray", () => {
  it("lists the active zone's UNPLACED tables in a tray in map view (placed stays on the canvas)", async () => {
    const el = await mountFloor({
      zones: [zone({ id: "z1" })],
      tables: [placed("t1", { zoneId: "z1" }), table({ id: "t9", label: "9", zoneId: "z1" })],
    });
    expect(el.shadowRoot!.querySelector('[data-tray-table="t9"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-tray-table="t1"]')).toBeNull();
  });

  it("opens a free tray table (asking for its guest count) when it is tapped in VIEW mode", async () => {
    const el = await mountFloor({ tables: [placed("t1"), table({ id: "t9", label: "9" })] });
    el.shadowRoot!.querySelector<HTMLElement>('[data-tray-table="t9"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")!.tableLabel).toBe("9");
  });

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
});

describe("closed floor zones", () => {
  it.each(["en-GB", "es-ES"])("labels the zone and refuses a free table in %s", async (locale) => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mount({ zones: [zone({ name: "Terrace", closed: true })] });
      const open = vi.fn();
      el.addEventListener("open-table", open);
      expect(el.shadowRoot!.querySelector("[data-zone]")!.textContent?.trim()).toBe(
        locale === "en-GB" ? "Terrace · Closed" : "Terrace · Cerrada",
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
      const notice = el.shadowRoot!.querySelector("[data-zone-closed]");
      expect(notice?.textContent?.trim()).toBe(
        locale === "en-GB"
          ? "Terrace is closed: nothing new can be ordered here. Bills can be paid or moved to another area."
          : "Terrace está cerrada: no se puede pedir nada nuevo aquí. Las cuentas se pueden cobrar o mover a otra zona.",
      );
      expect(notice?.getAttribute("role")).toBe("status");
      expect(open).not.toHaveBeenCalled();
    } finally {
      setLocale(previous);
    }
  });

  it("still resumes an occupied table in a closed zone", async () => {
    const { el } = await mount({
      zones: [zone({ closed: true })],
      tables: [table({ hasOpenTab: true, state: "open-tab", tabTotal: "12.00", tabLineCount: 1 })],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(seen.detail).toEqual({ tableId: "t1", seated: true });
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
  });

  it("seats free tables after the zone reopens and clears the old notice", async () => {
    const { el } = await mount({ zones: [zone({ closed: true })] });
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-zone-closed]")).not.toBeNull();
    el.zones = [zone({ closed: false })];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-zone-closed]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).not.toBeNull();
  });
});

it("opens the first zone for an address with an empty zone segment", async () => {
  const url = new URL(location.href);
  url.pathname = "/tabs/floor/zone/~";
  history.replaceState(null, "", url);
  const { el } = await mount({
    zones: [zone(), zone({ id: "z2", name: "Terrace", displayOrder: 1 })],
    tables: [table(), table({ id: "t9", label: "9", zoneId: null })],
  });
  expect(el.shadowRoot!.querySelector('[data-zone="none"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-zone="z1"]')!.getAttribute("variant")).toBe("primary");
  expect(el.shadowRoot!.querySelector('[data-table="t1"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelector('[data-table="t9"]')).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>('[data-zone="z2"]')!.click();
  await el.updateComplete;
  expect(location.pathname).toBe("/tabs/floor/zone/z2");
});

describe("floor zones that seat no one", () => {
  it.each(["en-GB", "es-ES"])("refuses a free table in a prepay zone in %s", async (locale) => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mount({ zones: [zone({ serviceMode: "prepay" })] });
      const open = vi.fn();
      el.addEventListener("open-table", open);
      el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
      const notice = el.shadowRoot!.querySelector("[data-zone-no-seating]");
      expect(notice?.textContent?.trim()).toBe(
        locale === "en-GB"
          ? "That table is in an area that does not seat guests. Choose another table"
          : "Esa mesa está en una zona sin servicio de mesa. Elige otra mesa",
      );
      expect(notice?.getAttribute("role")).toBe("status");
      expect(open).not.toHaveBeenCalled();
    } finally {
      setLocale(previous);
    }
  });

  it("refuses a free table in a zone with no service mode", async () => {
    const { el } = await mount({ zones: [zone({ serviceMode: null })] });
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).not.toBeNull();
  });

  it("still resumes a seated table there", async () => {
    const { el } = await mount({
      zones: [zone({ serviceMode: "prepay" })],
      tables: [table({ hasOpenTab: true, state: "open-tab", tabTotal: "12.00", tabLineCount: 1 })],
    });
    const seen = captureOpenTable(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(seen.detail).toEqual({ tableId: "t1", seated: true });
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).toBeNull();
  });

  it("leaves a table whose zone the till has not read to the server", async () => {
    const { el } = await mount({ zones: [zone({ serviceMode: "prepay" })] });
    const card = el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!;
    el.zones = [];
    card.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).not.toBeNull();
  });

  it("still seats a free table in a table-service zone", async () => {
    const { el } = await mount({ zones: [zone({ serviceMode: "table_tab" })] });
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).toBeNull();
  });

  it("seats free tables once the zone takes table service and clears the old notice", async () => {
    const { el } = await mount({ zones: [zone({ serviceMode: "prepay" })] });
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
    el.zones = [zone({ serviceMode: "table_tab" })];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-zone-no-seating]")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).not.toBeNull();
  });
});
