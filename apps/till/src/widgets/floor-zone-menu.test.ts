import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./floor-zone-menu.js";
import type { TillFloorZoneMenu } from "./floor-zone-menu.js";
import type { FloorZone, TableState, TableToday } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

const terrace: FloorZone = {
  id: "z1",
  name: "Terrace",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
};

function table(id: string, over: Partial<TableToday> = {}): TableState {
  return {
    id,
    label: id.slice(1),
    zoneId: "z1",
    capacity: 4,
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
    today: {
      placement: { x: 2, y: 2, width: 8, height: 8, shape: "rect", rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      ...over,
    },
    signals: [],
    party: null,
  };
}

const placed = table("t1");
const spare = table("t9", { placement: null });
const fixedSpare = table("t8", { placement: null, fixed: true });
const takenOff = table("t3", { placement: null, takenOff: true });

async function mount(tables: TableState[] = [placed, spare, fixedSpare, takenOff]) {
  const { el } = await mountWidget<TillFloorZoneMenu>("till-floor-zone-menu", {
    zone: terrace,
    tables,
  });
  return el;
}

function captured(el: TillFloorZoneMenu): unknown[] {
  const seen: unknown[] = [];
  for (const type of ["zone-place-spare", "zone-put-back", "zone-reset"])
    el.addEventListener(type, (event) => {
      const custom = event as CustomEvent;
      seen.push({
        type,
        detail: custom.detail,
        bubbles: custom.bubbles,
        composed: custom.composed,
      });
    });
  return seen;
}

const root = (el: TillFloorZoneMenu) => el.shadowRoot!;
const dialogOf = (el: TillFloorZoneMenu, name: string) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-dialog"]>(`wt-dialog[data-dialog="${name}"]`)!;
const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim();

async function choose(el: TillFloorZoneMenu, item: string): Promise<void> {
  root(el).querySelector<HTMLElement>(`[data-menu-item="${item}"]`)!.click();
  await el.updateComplete;
}

it("is a menu named Today's plan holding the three actions", async () => {
  const el = await mount();
  const menu = root(el).querySelector("wt-row-actions")!;
  expect(menu.getAttribute("label")).toBe("Today's plan");
  expect([...menu.querySelectorAll("wt-button")].map(text)).toEqual([
    "Add a spare table",
    "Taken off today",
    "Reset to saved plan",
  ]);
  expect(dialogOf(el, "spares").open).toBe(false);
  expect(dialogOf(el, "taken-off").open).toBe(false);
  expect(dialogOf(el, "reset").open).toBe(false);
});

it("draws nothing without a zone", async () => {
  const { el } = await mountWidget<TillFloorZoneMenu>("till-floor-zone-menu", {
    zone: null,
    tables: [spare],
  });
  expect(root(el).querySelector("wt-row-actions")).toBeNull();
});

it("lists the movable spares in number order, and places the one picked", async () => {
  const el = await mount([
    placed,
    table("t10", { placement: null }),
    table("t2", { placement: null }),
    spare,
    fixedSpare,
    takenOff,
  ]);
  const seen = captured(el);
  await choose(el, "spares");

  const dialog = dialogOf(el, "spares");
  expect(dialog.open).toBe(true);
  expect(dialog.heading).toBe("Add a spare table");
  expect(
    [...dialog.querySelectorAll<HTMLElement>("[data-spare]")].map((row) => [
      row.dataset.spare,
      text(row),
    ]),
  ).toEqual([
    ["t2", "2"],
    ["t9", "9"],
    ["t10", "10"],
  ]);

  dialog.querySelector<HTMLElement>('[data-spare="t10"]')!.click();
  await el.updateComplete;

  expect(seen).toEqual([
    { type: "zone-place-spare", detail: { tableId: "t10" }, bubbles: true, composed: true },
  ]);
  expect(dialog.open).toBe(false);
});

it("says there are no spares", async () => {
  const el = await mount([placed, fixedSpare, takenOff]);
  await choose(el, "spares");
  const dialog = dialogOf(el, "spares");
  expect(dialog.querySelectorAll("[data-spare]")).toHaveLength(0);
  expect(text(dialog.querySelector("[data-empty]"))).toBe("No spare tables");
});

it("lists the tables taken off today in number order, each with Put back", async () => {
  const el = await mount([
    placed,
    spare,
    table("t10", { takenOff: true }),
    table("t2", { takenOff: true }),
    table("x9", { takenOff: true }),
  ]);
  const seen = captured(el);
  await choose(el, "taken-off");

  const dialog = dialogOf(el, "taken-off");
  expect(dialog.open).toBe(true);
  expect(dialog.heading).toBe("Taken off today");
  expect(
    [...dialog.querySelectorAll<HTMLElement>("[data-taken-off]")].map((row) => [
      row.dataset.takenOff,
      text(row.querySelector("[data-label]")),
      text(row.querySelector("[data-put-back]")),
    ]),
  ).toEqual([
    ["t2", "2", "Put back"],
    ["x9", "9", "Put back"],
    ["t10", "10", "Put back"],
  ]);

  dialog.querySelector<HTMLElement>('[data-taken-off="t10"] [data-put-back]')!.click();
  await el.updateComplete;

  expect(seen).toEqual([
    { type: "zone-put-back", detail: { tableId: "t10" }, bubbles: true, composed: true },
  ]);
  expect(dialog.open).toBe(false);
});

it("says None when no table is taken off", async () => {
  const el = await mount([placed, spare]);
  await choose(el, "taken-off");
  const dialog = dialogOf(el, "taken-off");
  expect(dialog.querySelectorAll("[data-taken-off]")).toHaveLength(0);
  expect(text(dialog.querySelector("[data-empty]"))).toBe("None");
});

it("asks before resetting the zone, and sends nothing on Cancel", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, "reset");

  const dialog = dialogOf(el, "reset");
  expect(dialog.open).toBe(true);
  expect(dialog.heading).toBe("Reset Terrace?");
  expect(text(dialog.querySelector("[data-reset-body]"))).toBe(
    "Free tables go back now, occupied ones once free.",
  );
  const confirm = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-reset-confirm]")!;
  expect(text(confirm)).toBe("Reset");
  expect(confirm.variant).toBe("danger");

  dialog.querySelector<HTMLElement>("[data-cancel]")!.click();
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(seen).toEqual([]);

  await choose(el, "reset");
  expect(dialog.open).toBe(true);
  confirm.click();
  await el.updateComplete;
  expect(seen).toEqual([
    { type: "zone-reset", detail: { zoneId: "z1" }, bubbles: true, composed: true },
  ]);
  expect(dialog.open).toBe(false);
});

it("Cancel closes a list without sending anything", async () => {
  const el = await mount();
  const seen = captured(el);
  for (const name of ["spares", "taken-off"]) {
    await choose(el, name);
    dialogOf(el, name).querySelector<HTMLElement>("[data-cancel]")!.click();
    await el.updateComplete;
    expect(dialogOf(el, name).open).toBe(false);
  }
  expect(seen).toEqual([]);
});

it("closes on Escape", async () => {
  const el = await mount();
  const seen = captured(el);
  await choose(el, "reset");
  const dialog = dialogOf(el, "reset");
  const closed = new Promise((resolve) =>
    dialog.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(seen).toEqual([]);
});

it("speaks Spanish", async () => {
  setLocale("es-ES");
  const el = await mount();
  const menu = root(el).querySelector("wt-row-actions")!;
  expect(menu.getAttribute("label")).toBe("Plano de hoy");
  expect([...menu.querySelectorAll("wt-button")].map(text)).toEqual([
    "Añadir mesa de reserva",
    "Quitadas hoy",
    "Volver al plano guardado",
  ]);
  await choose(el, "reset");
  expect(dialogOf(el, "reset").heading).toBe("¿Restablecer Terrace?");
  expect(text(dialogOf(el, "reset").querySelector("[data-reset-body]"))).toBe(
    "Las libres vuelven ya; las ocupadas, al quedar libres.",
  );
  expect(text(dialogOf(el, "reset").querySelector("[data-reset-confirm]"))).toBe("Restablecer");
  expect(text(dialogOf(el, "reset").querySelector("[data-cancel]"))).toBe("Cancelar");
  expect(text(dialogOf(el, "taken-off").querySelector("[data-put-back]"))).toBeUndefined();

  el.tables = [placed];
  dialogOf(el, "reset").querySelector<HTMLElement>("[data-cancel]")!.click();
  await choose(el, "spares");
  expect(text(dialogOf(el, "spares").querySelector("[data-empty]"))).toBe(
    "No hay mesas de reserva",
  );
  dialogOf(el, "spares").querySelector<HTMLElement>("[data-cancel]")!.click();
  await choose(el, "taken-off");
  expect(text(dialogOf(el, "taken-off").querySelector("[data-empty]"))).toBe("Ninguna");

  el.tables = [takenOff];
  await el.updateComplete;
  expect(text(dialogOf(el, "taken-off").querySelector("[data-put-back]"))).toBe("Volver a poner");
});
