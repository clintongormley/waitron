import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtDialog, WtFloorMap } from "@waitron/ui";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import "./till-floor-screen.js";
import type { FloorZone, TableState, TableToday, TillApi } from "../api/client.js";

const zone: FloorZone = {
  id: "z1",
  name: "Comedor",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

function planned(id: string, x: number, over: Partial<TableToday> = {}): TableState {
  return {
    id,
    label: id.slice(1),
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
    today: {
      placement: { x, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 6,
      ...over,
    },
    signals: [],
    party: null,
  };
}

const moving = (id: string, x: number, over: Partial<TableToday> = {}) =>
  planned(id, x, { needsMoving: true, ...over });

function stubApi() {
  return {
    leaveHereToday: vi.fn<TillApi["leaveHereToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 7 }),
    ),
    markMovedToday: vi.fn<TillApi["markMovedToday"]>(() =>
      Promise.resolve({ zoneId: "z1", revision: 7 }),
    ),
    mergeToday: vi.fn<TillApi["mergeToday"]>(() => Promise.resolve({ zoneId: "z1", revision: 7 })),
  };
}

type Stub = ReturnType<typeof stubApi>;

async function mount(tables: TableState[], api: Stub = stubApi()) {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone],
    tables,
    api: api as unknown as TillApi,
    canChangeToday: true,
  });
  return el;
}

const mapOf = (el: TillFloorScreen) => el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!;
const drawn = (el: TillFloorScreen, id: string) => mapOf(el).tables.find((each) => each.id === id)!;
const moveDialog = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<WtDialog>("[data-move-dialog]");
const refusal = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent?.trim() ?? null;
const footer = (el: TillFloorScreen) =>
  [...moveDialog(el)!.querySelectorAll('wt-button[slot="footer"]')].map((button) =>
    button.textContent!.trim(),
  );
const card = (el: TillFloorScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;

function send(target: Element, type: string, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

async function settle(el: TillFloorScreen): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  await el.updateComplete;
}

async function tap(el: TillFloorScreen, tableId: string): Promise<void> {
  send(mapOf(el), "wt-table-tap", { tableId });
  await el.updateComplete;
}

async function toList(el: TillFloorScreen): Promise<void> {
  await toggleFloorView(el);
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-floor-screen: a table that needs moving", () => {
  it("is drawn in its old place, in the clearing colour, read as Needs moving", async () => {
    const el = await mount([moving("t3", 12), planned("t4", 30)]);

    const table = drawn(el, "t3");
    expect(table.placement.x).toBe(12);
    expect(table.fill).toBe("clearing");
    expect(table.description).toBe("Needs moving");
    expect(drawn(el, "t4").description).toBe(t("floor.free"));
  });

  it("shows Needs clearing while it also needs clearing", async () => {
    const el = await mount([{ ...moving("t3", 12), condition: "needs_clearing" }]);

    expect(drawn(el, "t3").fill).toBe("clearing");
    expect(drawn(el, "t3").description).toBe(t("floor.needs_clearing"));
    await tap(el, "t3");
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).not.toBeNull();
    expect(moveDialog(el)).toBeNull();
  });

  it("asks to mark it moved when tapped, and Mark moved sends the room's revision", async () => {
    const api = stubApi();
    const el = await mount([moving("t3", 12)], api);
    const opened: unknown[] = [];
    el.addEventListener("open-table", (event) => opened.push((event as CustomEvent).detail));

    await tap(el, "t3");

    const dialog = moveDialog(el)!;
    expect(dialog.heading).toBe("Table 3 needs moving");
    expect(dialog.textContent).toContain(
      "Mark it moved once it stands, is put away or is taken apart as the new layout has it.",
    );
    expect(dialog.querySelector("[data-move-cancel]")!.textContent!.trim()).toBe("Cancel");
    expect(dialog.querySelector("[data-mark-moved]")!.textContent!.trim()).toBe("Mark moved");
    expect(opened).toEqual([]);
    expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();

    dialog.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(api.markMovedToday).toHaveBeenCalledWith("t3", 6);
    expect(moveDialog(el)).toBeNull();
  });

  it("Cancel closes the question and sends nothing", async () => {
    const api = stubApi();
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");

    moveDialog(el)!.querySelector<HTMLElement>("[data-move-cancel]")!.click();
    await el.updateComplete;

    expect(moveDialog(el)).toBeNull();
    expect(api.markMovedToday).not.toHaveBeenCalled();
  });

  it("asks in Spanish, by today's name for a renamed table", async () => {
    setLocale("es");
    const el = await mount([moving("t3", 12, { name: "Ventana" })]);
    await tap(el, "t3");

    const dialog = moveDialog(el)!;
    expect(dialog.heading).toBe("Ventana está por mover");
    expect(dialog.textContent).toContain(
      "Márcala como movida cuando esté colocada, guardada o separada como indica el plano nuevo.",
    );
    expect(dialog.querySelector("[data-mark-moved]")!.textContent!.trim()).toBe("Marcar movida");
  });

  it("on the list is a plain card reading Needs moving, whose Mark moved sends the room's revision", async () => {
    const api = stubApi();
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);
    await toList(el);

    const plain = card(el, "t3");
    expect(plain.tagName).toBe("DIV");
    expect(plain.querySelector("[data-needs-moving]")!.textContent).toBe("Needs moving");
    expect(card(el, "t4").querySelector("[data-needs-moving]")).toBeNull();

    plain.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(api.markMovedToday).toHaveBeenCalledWith("t3", 6);
  });

  it("on the list reads Needs clearing while it also needs clearing", async () => {
    const el = await mount([{ ...moving("t3", 12), condition: "needs_clearing" }]);
    await toList(el);

    expect(card(el, "t3").querySelector("[data-needs-clearing]")).not.toBeNull();
    expect(card(el, "t3").querySelector("[data-needs-moving]")).toBeNull();
  });

  it("Join with… is not offered on it, and lists it as a target that cannot be picked", async () => {
    const el = await mount([moving("t3", 12), planned("t4", 30), planned("t5", 50)]);

    send(mapOf(el), "wt-table-details", { tableId: "t3" });
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
    await sheet.updateComplete;
    expect(sheet.shadowRoot!.querySelector('[data-today-action="join-with"]')).toBeNull();
    send(sheet, "details-close");
    await el.updateComplete;

    send(mapOf(el), "wt-table-details", { tableId: "t4" });
    await el.updateComplete;
    const other = el.shadowRoot!.querySelector("till-table-details-sheet")!;
    await other.updateComplete;
    other.shadowRoot!.querySelector<HTMLElement>('[data-today-action="join-with"]')!.click();
    await settle(el);

    const dialog =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["till-join-with-dialog"]>(
        "till-join-with-dialog",
      )!;
    expect(dialog.targets.map((table) => table.id)).toEqual(["t3", "t5"]);
    await dialog.updateComplete;
    const row =
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-target="t3"]')!;
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain("Needs moving");
    expect(dialog.shadowRoot!.querySelector('[data-target-reason="t3"]')!.textContent!.trim()).toBe(
      codeMessage("table.needs_moving"),
    );
  });

  it("names both tables when Mark moved is refused because another stands in the new place", async () => {
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({
      code: "table.new_place_taken",
      tableId: "t3",
      standingId: "t4",
    });
    const el = await mount([moving("t3", 12), planned("t4", 30, { name: "Ventana" })], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refusal(el)).toBe("Ventana is standing in 3's new place. Move Ventana first.");
  });

  it("names both tables in Spanish", async () => {
    setLocale("es");
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({
      code: "table.new_place_taken",
      tableId: "t3",
      standingId: "t4",
    });
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refusal(el)).toBe("4 ocupa el nuevo sitio de 3. Mueve 4 primero.");
  });

  it("says the code's own words when the new place's table is not on this read", async () => {
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({
      code: "table.new_place_taken",
      tableId: "t3",
      standingId: "t9",
    });
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refusal(el)).toBe(codeMessage("table.new_place_taken"));
  });

  it("names the table a needs-moving refusal names, and falls back to the code's words", async () => {
    const api = stubApi();
    api.mergeToday.mockRejectedValueOnce({ code: "table.needs_moving", tableId: "t3" });
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);

    send(mapOf(el), "wt-table-drag-end", { tableId: "t4", x: 30, y: 3, targetId: "t3" });
    await settle(el);
    expect(refusal(el)).toBe("Table 3 needs moving. Mark it moved first.");

    setLocale("es");
    api.markMovedToday.mockRejectedValueOnce({ code: "table.needs_moving", tableId: "t9" });
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);
    expect(refusal(el)).toBe(codeMessage("table.needs_moving", "es"));
  });

  it("names a renamed table in a needs-moving refusal, in Spanish", async () => {
    setLocale("es");
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({ code: "table.needs_moving", tableId: "t3" });
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);
    expect(refusal(el)).toBe("La mesa 3 está por mover. Márcala como movida primero.");

    el.tables = [moving("t3", 12, { name: "Ventana" })];
    await el.updateComplete;
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);
    expect(refusal(el)).toBe("Ventana está por mover. Márcala como movida primero.");
  });

  it("offers no Mark moved on a device that cannot change today's plan", async () => {
    const el = await mount([moving("t3", 12)]);
    el.canChangeToday = false;
    await el.updateComplete;

    await tap(el, "t3");
    expect(moveDialog(el)!.querySelector("[data-move-cancel]")).not.toBeNull();
    expect(moveDialog(el)!.querySelector("[data-mark-moved]")).toBeNull();
    expect(moveDialog(el)!.querySelector("[data-leave-here]")).toBeNull();
    moveDialog(el)!.querySelector<HTMLElement>("[data-move-cancel]")!.click();
    await el.updateComplete;

    await toList(el);
    expect(card(el, "t3").querySelector("[data-needs-moving]")).not.toBeNull();
    expect(card(el, "t3").querySelector("[data-mark-moved]")).toBeNull();
    expect(card(el, "t3").querySelector("[data-leave-here]")).toBeNull();
  });

  it("closes the question once a read no longer has the table needing moving", async () => {
    const el = await mount([moving("t3", 12)]);
    await tap(el, "t3");
    expect(moveDialog(el)).not.toBeNull();

    el.tables = [planned("t3", 40)];
    await el.updateComplete;

    expect(moveDialog(el)).toBeNull();
  });

  it("asks the floor to read again once Mark moved is answered", async () => {
    const el = await mount([moving("t3", 12)]);
    const refreshes: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => refreshes.push((event as CustomEvent).detail));
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refreshes).toHaveLength(1);
    expect(refusal(el)).toBeNull();
  });

  it("names the table a booking holds back when Mark moved is refused for it", async () => {
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({
      code: "table.booked",
      tableId: "t4",
      date: "2026-10-18",
      time: "21:00",
    });
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);
    expect(refusal(el)).toBe("Table 4 has a booking. Move or cancel it first.");

    setLocale("es");
    el.tables = [moving("t3", 12), planned("t4", 30, { name: "Ventana" })];
    await el.updateComplete;
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);
    expect(refusal(el)).toBe("Ventana tiene una reserva. Muévela o cancélala primero.");
  });

  it("says a booking holds a table back in the code's own words when the read lacks that table", async () => {
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({ code: "table.booked", tableId: "t9" });
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refusal(el)).toBe("That table has a booking. Move or cancel it first");
    expect(refusal(el)).not.toBe(codeMessage("server.internal"));
  });

  it("says what still holds the table back in that code's own words", async () => {
    const api = stubApi();
    api.markMovedToday.mockRejectedValue({ code: "tab.already_open", tableId: "t4" });
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-mark-moved]")!.click();
    await settle(el);

    expect(refusal(el)).toBe(codeMessage("tab.already_open"));
  });

  it("asks Cancel, Leave it here or Mark moved, in that order, and Leave it here sends the room's revision", async () => {
    const api = stubApi();
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");

    expect(footer(el)).toEqual(["Cancel", "Leave it here", "Mark moved"]);
    moveDialog(el)!.querySelector<HTMLElement>("[data-leave-here]")!.click();
    await settle(el);

    expect(api.leaveHereToday).toHaveBeenCalledWith("t3", 6);
    expect(api.markMovedToday).not.toHaveBeenCalled();
    expect(moveDialog(el)).toBeNull();
  });

  it("asks the three in Spanish", async () => {
    setLocale("es");
    const el = await mount([moving("t3", 12)]);
    await tap(el, "t3");

    expect(footer(el)).toEqual(["Cancelar", "Dejar aquí", "Marcar movida"]);
  });

  it("on the list the card offers Leave it here before Mark moved", async () => {
    const api = stubApi();
    const el = await mount([moving("t3", 12), planned("t4", 30)], api);
    await toList(el);

    const plain = card(el, "t3");
    expect(
      [...plain.querySelectorAll("wt-button")].map((each) => each.textContent!.trim()),
    ).toEqual(["Leave it here", "Mark moved"]);
    plain.querySelector<HTMLElement>("[data-leave-here]")!.click();
    await settle(el);

    expect(api.leaveHereToday).toHaveBeenCalledWith("t3", 6);
    expect(api.markMovedToday).not.toHaveBeenCalled();
  });

  it("asks the floor to read again once Leave it here is answered", async () => {
    const el = await mount([moving("t3", 12)]);
    const refreshes: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => refreshes.push((event as CustomEvent).detail));
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-leave-here]")!.click();
    await settle(el);

    expect(refreshes).toHaveLength(1);
    expect(refusal(el)).toBeNull();
  });

  it("says the room has moved on when Leave it here is refused", async () => {
    const api = stubApi();
    api.leaveHereToday.mockRejectedValue({ code: "floor_today.out_of_date" });
    const el = await mount([moving("t3", 12)], api);
    await tap(el, "t3");
    moveDialog(el)!.querySelector<HTMLElement>("[data-leave-here]")!.click();
    await settle(el);

    expect(refusal(el)).toBe(codeMessage("floor_today.out_of_date"));
  });

  it("offers Join with… once the floor read no longer shows the table needing moving", async () => {
    const el = await mount([moving("t3", 12), planned("t4", 30)]);
    el.tables = [planned("t3", 12), planned("t4", 30)];
    await el.updateComplete;

    send(mapOf(el), "wt-table-details", { tableId: "t3" });
    await el.updateComplete;
    const sheet = el.shadowRoot!.querySelector("till-table-details-sheet")!;
    await sheet.updateComplete;
    expect(sheet.shadowRoot!.querySelector('[data-today-action="join-with"]')).not.toBeNull();
  });
});
