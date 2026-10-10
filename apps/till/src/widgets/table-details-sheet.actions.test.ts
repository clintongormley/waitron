import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./table-details-sheet.js";
import type { TillTableDetailsSheet } from "./table-details-sheet.js";
import type { TableParty, TableState, TableToday } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 10, y: 10, width: 8, height: 8, shape: "rect", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    ...over,
  };
}

const party: TableParty = {
  id: "p1",
  revision: 1,
  guestCount: 2,
  state: "open",
  name: null,
  displayName: "1",
  mainBillId: null,
  outstanding: "0.00",
  billCount: 1,
  tableIds: ["t1"],
  unsentDrafts: [],
  reminder: null,
};

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: null,
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
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
    today: today(),
    signals: [],
    party: null,
    ...over,
  };
}

const merged = today({ joinId: "j1", joinSeats: 8 });

async function mount(over: Partial<TillTableDetailsSheet> = {}): Promise<TillTableDetailsSheet> {
  const { el } = await mountWidget<TillTableDetailsSheet>("till-table-details-sheet", {
    table: table(),
    heading: "1",
    actions: true,
    ...over,
  });
  return el;
}

const buttons = (el: TillTableDetailsSheet) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-today-action]"),
];
const offered = (el: TillTableDetailsSheet) =>
  buttons(el).map((button) => button.dataset["todayAction"]);
const button = (el: TillTableDetailsSheet, action: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-today-action="${action}"]`)!;

function captureEvents(el: TillTableDetailsSheet): string[] {
  const seen: string[] = [];
  for (const type of ["today-action", "details-close"]) {
    el.addEventListener(type, (event) => {
      expect(event.bubbles && event.composed).toBe(true);
      const detail = (event as CustomEvent).detail;
      seen.push(detail == null ? type : `${type} ${JSON.stringify(detail)}`);
    });
  }
  return seen;
}

describe("till-table-details-sheet's actions for today", () => {
  it("shows no actions unless asked", async () => {
    const el = await mount({ actions: false });
    expect(offered(el)).toEqual([]);
  });

  it("offers a free single table every action but Split", async () => {
    const el = await mount();
    expect(offered(el)).toEqual(["join-with", "rotate", "seats", "back", "take-off"]);
    expect(buttons(el).map((each) => each.getAttribute("variant"))).toEqual(
      Array(5).fill("secondary"),
    );
    expect(buttons(el).map((each) => each.textContent!.trim())).toEqual([
      "Join with…",
      "Rotate",
      "Change seats",
      "Back to saved place",
      "Take off for today",
    ]);
    expect(buttons(el).some((each) => each.getAttribute("slot") === "footer")).toBe(false);
  });

  it("offers a merge Split, seats and back, and no Join with…, Rotate or Take off", async () => {
    const el = await mount({ table: table({ today: merged }) });
    expect(offered(el)).toEqual(["split", "seats", "back"]);
  });

  it("does not offer Rotate for a fixed table, nor Take off for a seated one or one needing clearing", async () => {
    const fixed = await mount({ table: table({ today: today({ fixed: true }) }) });
    expect(offered(fixed)).toEqual(["join-with", "seats", "back", "take-off"]);
    cleanupWidgets();

    const seated = await mount({
      table: table({ state: "open-tab", condition: "held", hasOpenTab: true, party }),
    });
    expect(offered(seated)).toEqual(["join-with", "rotate", "seats", "back"]);
    cleanupWidgets();

    const clearing = await mount({ table: table({ condition: "needs_clearing" }) });
    expect(offered(clearing)).toEqual(["join-with", "rotate", "seats", "back"]);
    expect(clearing.shadowRoot!.querySelector("[data-mark-cleared]")!.getAttribute("slot")).toBe(
      "footer",
    );
    cleanupWidgets();

    const delivery = await mount({ table: table({ pendingDeliveries: 1 }) });
    expect(offered(delivery)).toEqual(["join-with", "rotate", "seats", "back"]);
  });

  it("offers nothing for a table with no today's row", async () => {
    const none = await mount({ table: table({ today: null }) });
    expect(offered(none)).toEqual([]);
    cleanupWidgets();

    const spare = await mount({ table: table({ today: today({ placement: null }) }) });
    expect(offered(spare)).toEqual([]);
    cleanupWidgets();

    const takenOff = await mount({
      table: table({ today: today({ placement: null, takenOff: true }) }),
    });
    expect(offered(takenOff)).toEqual([]);
  });

  it("sends the action and asks to close, except after Rotate", async () => {
    const el = await mount({ table: table({ id: "t7", today: merged }) });
    const seen = captureEvents(el);
    await userEvent.click(button(el, "split"));
    expect(seen).toEqual([
      `today-action ${JSON.stringify({ action: "split", tableId: "t7" })}`,
      "details-close",
    ]);
    cleanupWidgets();

    const single = await mount({ table: table({ id: "t8" }) });
    const after = captureEvents(single);
    await userEvent.click(button(single, "rotate"));
    expect(after).toEqual([`today-action ${JSON.stringify({ action: "rotate", tableId: "t8" })}`]);
  });

  it("names the actions in Spanish", async () => {
    setLocale("es-ES");
    const free = await mount();
    const merge = await mount({ table: table({ id: "t2", today: merged }) });
    const names = [...buttons(free), ...buttons(merge)].map((each) => each.textContent!.trim());
    expect([...new Set(names)]).toEqual([
      "Unir con…",
      "Girar",
      "Cambiar plazas",
      "Volver a su sitio",
      "Quitar por hoy",
      "Separar",
    ]);
  });
});
