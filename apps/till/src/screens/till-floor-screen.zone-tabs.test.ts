import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { TableSignal } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState, TableToday } from "../api/client.js";

const now = Date.parse("2026-10-20T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

const zone = (id: string, name: string, displayOrder: number): FloorZone => ({
  id,
  name,
  displayOrder,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
});

const zones = [zone("z1", "Inside", 0), zone("z2", "Terrace", 1)];

function party(id: string, over: Partial<TableParty> = {}): TableParty {
  return {
    id,
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 1 },
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: id,
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: [],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(x: number, placed = true): TableToday {
  return {
    placement: placed ? { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 } : null,
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

function free(id: string, zoneId: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId,
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: today(Number(id.slice(1)) * 3),
    signals: [],
    party: null,
    ...over,
  };
}

const seated = (id: string, zoneId: string, over: Partial<TableState> = {}): TableState =>
  free(id, zoneId, {
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    party: party(`p-${id}`),
    ...over,
  });

const held: TableSignal = { kind: "held", count: 2 };

// Inside comes first, so it is the zone on screen.
const mount = (tables: TableState[]) =>
  mountWidget<TillFloorScreen>("till-floor-screen", {
    zones,
    tables,
    now,
    reducedMotion: true,
  });

const tabOf = (el: TillFloorScreen, zoneId: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`wt-button.tab[data-zone="${zoneId}"]`)!;

const stateOf = (el: TillFloorScreen, zoneId: string) =>
  tabOf(el, zoneId).closest(".zone-tab")?.getAttribute("data-zone-state") ?? null;

const buttonOf = (el: TillFloorScreen, zoneId: string) =>
  tabOf(el, zoneId).shadowRoot!.querySelector<HTMLButtonElement>('[part="button"]')!;

const originalUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
});

describe("till-floor-screen: zone tabs", () => {
  it("tints a hidden zone's tab with its most urgent state, a bar and its icon", async () => {
    const { el, host } = await mount([
      seated("t1", "z1"),
      seated("t2", "z2", { signals: [{ kind: "bill_requested", requestedAt: inMinutes(-3) }] }),
      seated("t3", "z2", { timingBand: "forgotten" }),
    ]);
    host.style.setProperty("--wt-color-tab-danger-tint", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-danger", "rgb(4, 5, 6)");

    expect(stateOf(el, "z2")).toBe("forgotten");
    const button = buttonOf(el, "z2");
    const style = getComputedStyle(button);
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toContain("rgb(4, 5, 6)");
    expect(style.boxShadow).toContain("inset");

    const tab = tabOf(el, "z2");
    const icon = tab.querySelector('wt-icon[name="floor-timer"]');
    expect(icon).not.toBeNull();
    const name = [...tab.childNodes].find((node) => node.textContent?.trim() === "Terrace")!;
    expect(name.compareDocumentPosition(icon!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("Terrace, Forgotten");
  });

  it.each<[string, Partial<TableState>, string, string]>([
    ["overdue", { timingBand: "overdue" }, "tab-danger-tint", "danger"],
    [
      "unavailable",
      { signals: [{ kind: "held_unavailable", groupId: "g", lineNames: ["Steak"] }] },
      "tab-warning-tint",
      "warning",
    ],
    [
      "fire",
      { party: party("p-t2", { reminder: { groupId: "g", dueAt: inMinutes(-1) } }) },
      "tab-warning-tint",
      "warning",
    ],
    ["waiting", { signals: [{ kind: "long_wait", band: "warm" }] }, "tab-warning-tint", "warning"],
    [
      "clearing",
      { party: null, state: "free", condition: "needs_clearing" },
      "tab-warning-tint",
      "warning",
    ],
    [
      "moving",
      { party: null, state: "free", today: { ...today(6), needsMoving: true } },
      "tab-warning-tint",
      "warning",
    ],
    [
      "bill",
      { signals: [{ kind: "bill_requested", requestedAt: inMinutes(-3) }] },
      "tab-bill-tint",
      "table-bill",
    ],
    ["ready", { readyToServe: 2 }, "tab-ready-tint", "success"],
    ["step", { signals: [{ kind: "take_order" }] }, "tab-seated-tint", "table-seated"],
    [
      "delivery",
      { party: null, state: "delivery-pending", pendingDeliveries: 1 },
      "tab-seated-tint",
      "table-seated",
    ],
    [
      "not-sent",
      {
        party: party("p-t2", {
          unsentDrafts: [{ billId: "b", billNumber: 3, ownerName: "Alex", lineCount: 1 }],
        }),
      },
      "tab-seated-tint",
      "table-seated",
    ],
  ])("paints %s with its family's tint and bar", async (kind, over, tint, bar) => {
    const { el, host } = await mount([seated("t1", "z1"), seated("t2", "z2", over)]);
    host.style.setProperty(`--wt-color-${tint}`, "rgb(1, 2, 3)");
    host.style.setProperty(`--wt-color-${bar}`, "rgb(4, 5, 6)");
    expect(stateOf(el, "z2")).toBe(kind);
    const style = getComputedStyle(buttonOf(el, "z2"));
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toBe("rgb(4, 5, 6) 0px -4px 0px 0px inset");
  });

  it("keeps the tint and bar while the tab is hovered", async () => {
    const { el, host } = await mount([seated("t1", "z1"), seated("t2", "z2", { readyToServe: 2 })]);
    host.style.setProperty("--wt-color-tab-ready-tint", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-success", "rgb(4, 5, 6)");
    const button = buttonOf(el, "z2");
    await userEvent.hover(button);
    expect(button.matches(":hover")).toBe(true);
    const style = getComputedStyle(button);
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.boxShadow).toBe("rgb(4, 5, 6) 0px -4px 0px 0px inset");
  });

  it("leaves the zone on screen plain", async () => {
    const { el } = await mount([seated("t1", "z1", { timingBand: "forgotten" }), free("t2", "z2")]);
    expect(stateOf(el, "z1")).toBeNull();
    expect(buttonOf(el, "z1").hasAttribute("aria-label")).toBe(false);
    expect(stateOf(el, "z2")).toBeNull();

    await userEvent.click(buttonOf(el, "z2"));
    await el.updateComplete;
    expect(stateOf(el, "z1")).toBe("forgotten");
    expect(stateOf(el, "z2")).toBeNull();
  });

  it("leaves a tab plain for held, calm, reserved and free tables", async () => {
    const { el } = await mount([
      seated("t1", "z1"),
      seated("t2", "z2", {
        signals: [held],
        party: party("p-t2", { reminder: { groupId: "g1", dueAt: inMinutes(10) } }),
      }),
      seated("t3", "z2"),
      free("t4", "z2", { nextReservation: { time: "21:30" } }),
      free("t5", "z2"),
    ]);
    expect(stateOf(el, "z2")).toBeNull();
    expect(tabOf(el, "z2").querySelector("wt-icon")).toBeNull();
    expect(buttonOf(el, "z2").hasAttribute("aria-label")).toBe(false);
  });

  it("counts every table of the zone, not only the drawn ones", async () => {
    const { el } = await mount([
      seated("t1", "z1"),
      free("t2", "z2"),
      seated("t3", "z2", { timingBand: "forgotten", today: today(0, false) }),
    ]);
    expect(stateOf(el, "z2")).toBe("forgotten");
  });

  it("says it in Spanish", async () => {
    const previous = currentLocale();
    setLocale("es");
    try {
      const { el } = await mount([
        seated("t1", "z1"),
        seated("t2", "z2", { timingBand: "forgotten" }),
      ]);
      expect(buttonOf(el, "z2").getAttribute("aria-label")).toBe(
        `Terrace, ${es["floor.forgotten"]}`,
      );
    } finally {
      setLocale(previous);
    }
  });
});
