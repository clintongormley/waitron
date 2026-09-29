import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TillSeatDialog } from "../widgets/seat-dialog.js";
import type { TableState, TableParty } from "../api/client.js";

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t4",
    label: "4",
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
    party: null,
    ...over,
  };
}

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    outstanding: "44.00",
    billCount: 2,
    tableIds: ["t4"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function seated(over: Partial<TableState> = {}, partyOver: Partial<TableParty> = {}): TableState {
  return table({
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabId: "wo-4",
    tabLineCount: 2,
    tabTotal: "14.00",
    party: party(partyOver),
    ...over,
  });
}

async function mountFloor(tables: TableState[]): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }],
    tables,
  });
  return el;
}

const card = (el: TillFloorScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-table="${id}"]`)!;
const seatDialog = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<TillSeatDialog>("till-seat-dialog");

function capture(el: TillFloorScreen, type: string): unknown[] {
  const seen: unknown[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent).detail));
  return seen;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-floor-screen: seating a party", () => {
  it("opens the seat dialog for a free table instead of opening a tab at once", async () => {
    const el = await mountFloor([table()]);
    const opened = capture(el, "open-table");

    card(el, "t4").click();
    await el.updateComplete;

    expect(opened).toEqual([]);
    expect(seatDialog(el)!.tableLabel).toBe("4");
  });

  it("seats the table with the guest count the dialog confirms, and closes it", async () => {
    const el = await mountFloor([table()]);
    const opened = capture(el, "open-table");
    card(el, "t4").click();
    await el.updateComplete;

    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-confirm", { detail: { guestCount: 3 }, bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(opened).toEqual([{ tableId: "t4", seated: false, guestCount: 3 }]);
    expect(seatDialog(el)).toBeNull();
  });

  it("seats nobody when the dialog is cancelled", async () => {
    const el = await mountFloor([table()]);
    const opened = capture(el, "open-table");
    card(el, "t4").click();
    await el.updateComplete;

    seatDialog(el)!.dispatchEvent(
      new CustomEvent("seat-cancel", { bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(opened).toEqual([]);
    expect(seatDialog(el)).toBeNull();
  });

  it("opens the seat dialog for a free table tapped on the map", async () => {
    const el = await mountFloor([table({ posX: 200, posY: 200, shape: "round", rotation: 0 })]);

    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t4" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    expect(seatDialog(el)!.tableLabel).toBe("4");
  });

  it("resumes a seated party whose tab has been paid rather than seating the table again", async () => {
    const el = await mountFloor([
      seated(
        { hasOpenTab: false, tabLineCount: undefined, tabTotal: undefined },
        {
          outstanding: "0.00",
        },
      ),
    ]);
    const opened = capture(el, "open-table");

    card(el, "t4").click();
    await el.updateComplete;

    expect(opened).toEqual([{ tableId: "t4", seated: true }]);
    expect(seatDialog(el)).toBeNull();
  });
});

describe("till-floor-screen: what a seated party owes", () => {
  it("shows what the whole party still has to pay, its guests and its bills", async () => {
    const el = await mountFloor([seated()]);

    const text = card(el, "t4").textContent!;
    expect(card(el, "t4").querySelector(".total")!.textContent).toBe("44.00 €");
    expect(text).toContain(`${t("floor.guests")}: 3`);
    expect(text).toContain(`${t("floor.bills")}: 2`);
    expect(card(el, "t4").querySelector("[data-paid]")).toBeNull();
  });

  it("never reads as paid while a related bill is unpaid, even with the table's tab paid", async () => {
    const el = await mountFloor([
      seated(
        { hasOpenTab: false, tabLineCount: undefined, tabTotal: undefined },
        {
          outstanding: "30.00",
        },
      ),
    ]);

    expect(card(el, "t4").querySelector("[data-paid]")).toBeNull();
    expect(card(el, "t4").querySelector(".total")!.textContent).toBe("30.00 €");
  });

  it("reads as paid once no bill of the party is left to pay", async () => {
    const el = await mountFloor([
      seated(
        { hasOpenTab: false, tabLineCount: undefined, tabTotal: undefined },
        {
          outstanding: "0.00",
        },
      ),
    ]);

    expect(card(el, "t4").querySelector("[data-paid]")!.textContent).toBe(t("floor.paid"));
    expect(card(el, "t4").querySelector(".total")).toBeNull();
  });

  it("shows no party line for a party with no guest count and one bill", async () => {
    const el = await mountFloor([seated({}, { guestCount: null, billCount: 1 })]);

    expect(card(el, "t4").querySelector(".party")).toBeNull();
  });

  it("does not call a just-seated party with an empty tab paid", async () => {
    const el = await mountFloor([
      seated({ tabLineCount: 0, tabTotal: "0.00" }, { outstanding: "0.00", billCount: 1 }),
    ]);

    expect(card(el, "t4").querySelector("[data-paid]")).toBeNull();
  });

  it("shows the party's outstanding amount on the map token", async () => {
    const el = await mountFloor([
      seated(
        {
          hasOpenTab: false,
          tabLineCount: undefined,
          tabTotal: undefined,
          posX: 200,
          posY: 200,
          shape: "round",
          rotation: 0,
        },
        { outstanding: "30.00" },
      ),
    ]);

    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    expect(canvas.tables[0]!.tabTotal).toBe("30.00");
  });
});

describe("till-floor-screen: a table needing clearing", () => {
  const clearing = (id: string, label: string) => table({ id, label, condition: "needs_clearing" });

  it("says so on each table that needs clearing, each with Mark cleared", async () => {
    const el = await mountFloor([clearing("t4", "4"), { ...clearing("t5", "5"), capacity: null }]);

    for (const id of ["t4", "t5"]) {
      expect(card(el, id).querySelector("[data-needs-clearing]")!.textContent).toBe(
        t("floor.needs_clearing"),
      );
      expect(card(el, id).querySelector("[data-mark-cleared]")!.textContent!.trim()).toBe(
        t("floor.mark_cleared"),
      );
    }
    expect(card(el, "t5").querySelector(".capacity")).toBeNull();
  });

  it("asks to clear the one table whose Mark cleared was tapped", async () => {
    const el = await mountFloor([clearing("t4", "4"), clearing("t5", "5")]);
    const cleared = capture(el, "mark-cleared");

    card(el, "t5").querySelector<HTMLElement>("[data-mark-cleared]")!.click();

    expect(cleared).toEqual([{ tableId: "t5" }]);
  });

  it("offers nothing to clear on a free table or a table a party holds", async () => {
    const el = await mountFloor([
      table({ id: "t4", label: "4" }),
      seated({ id: "t5", label: "5" }),
    ]);

    for (const id of ["t4", "t5"]) {
      expect(card(el, id).querySelector("[data-needs-clearing]")).toBeNull();
      expect(card(el, id).querySelector("[data-mark-cleared]")).toBeNull();
    }
  });

  it("neither opens nor seats the table when its card is tapped", async () => {
    const el = await mountFloor([clearing("t4", "4")]);
    const opened = capture(el, "open-table");

    card(el, "t4").click();
    await el.updateComplete;

    expect(opened).toEqual([]);
    expect(seatDialog(el)).toBeNull();
  });

  it("shows the state on the map token and offers Mark cleared when it is tapped there", async () => {
    const el = await mountFloor([
      { ...clearing("t4", "4"), posX: 200, posY: 200, shape: "round", rotation: 0 },
    ]);
    const cleared = capture(el, "mark-cleared");
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    expect(canvas.tables[0]!.status?.label).toBe(t("floor.needs_clearing"));

    canvas.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t4" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-clear-dialog] [data-mark-cleared]")!.click();
    await el.updateComplete;

    expect(cleared).toEqual([{ tableId: "t4" }]);
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).toBeNull();
  });

  it("does not paint a table needing clearing as free on the map, although no party holds it", async () => {
    const el = await mountFloor([
      { ...clearing("t4", "4"), posX: 200, posY: 200, shape: "round", rotation: 0 },
    ]);
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    const token = canvas.shadowRoot!.querySelector<HTMLElement>(
      '[data-table="t4"] wt-table-token',
    )!;
    await (token as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const card = token.shadowRoot!.querySelector(".card")!;
    expect(card.classList.contains("state-free")).toBe(false);
  });

  it("closes the map's clearing dialog without clearing when it is cancelled", async () => {
    const el = await mountFloor([
      { ...clearing("t4", "4"), posX: 200, posY: 200, shape: "round", rotation: 0 },
    ]);
    const cleared = capture(el, "mark-cleared");
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t4" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-clear-dialog] [data-clear-cancel]")!.click();
    await el.updateComplete;

    expect(cleared).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).toBeNull();
  });

  it("closes the map's clearing dialog when it is dismissed", async () => {
    const el = await mountFloor([
      { ...clearing("t4", "4"), posX: 200, posY: 200, shape: "round", rotation: 0 },
    ]);
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t4" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    el.shadowRoot!.querySelector("[data-clear-dialog]")!.dispatchEvent(new CustomEvent("wt-close"));
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("[data-clear-dialog]")).toBeNull();
  });
});

describe("till-floor-screen: a table's unsent orders", () => {
  const onMap = { posX: 200, posY: 200, shape: "round" as const, rotation: 0 };
  const marks = (el: TillFloorScreen, id: string) =>
    [...card(el, id).querySelectorAll<HTMLElement>("[data-unsent]")].map((mark) =>
      mark.textContent!.replace(/\s+/g, " ").trim(),
    );
  type Token = HTMLElement & { updateComplete: Promise<unknown> };
  async function tokenMark(token: Token): Promise<string | undefined> {
    await token.updateComplete;
    return (
      token.shadowRoot!.querySelector("[data-unsent]")?.getAttribute("aria-label") ?? undefined
    );
  }

  it("shows Mesa 4 with a mark naming who has an unsent order and how many items", async () => {
    const el = await mountFloor([
      seated({}, { unsentDrafts: [{ ownerName: "Alex", lineCount: 2 }] }),
    ]);

    expect(marks(el, "t4")).toEqual(["Alex has an unsent order: 2 items"]);
  });

  it("says one item in the singular", async () => {
    const el = await mountFloor([
      seated({}, { unsentDrafts: [{ ownerName: "Alex", lineCount: 1 }] }),
    ]);

    expect(marks(el, "t4")).toEqual(["Alex has an unsent order: 1 item"]);
  });

  it("gives each person with an unsent order a line of their own, oldest first", async () => {
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { ownerName: "Alex", lineCount: 2 },
            { ownerName: "Sam", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual([
      "Alex has an unsent order: 2 items",
      "Sam has an unsent order: 1 item",
    ]);
  });

  it("names no one when the person is unknown", async () => {
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { ownerName: "", lineCount: 3 },
            { ownerName: "", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual(["An unsent order: 3 items", "An unsent order: 1 item"]);
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { ownerName: "Alex", lineCount: 2 },
            { ownerName: "Sam", lineCount: 1 },
            { ownerName: "", lineCount: 4 },
            { ownerName: "", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual([
      "Alex tiene un pedido sin enviar: 2 artículos",
      "Sam tiene un pedido sin enviar: 1 artículo",
      "Un pedido sin enviar: 4 artículos",
      "Un pedido sin enviar: 1 artículo",
    ]);
  });

  it("shows no mark when the party has no unsent order", async () => {
    const el = await mountFloor([seated()]);

    expect(marks(el, "t4")).toEqual([]);
  });

  it("marks Mesa 4's token on the map with everyone's name", async () => {
    const el = await mountFloor([
      seated(onMap, {
        unsentDrafts: [
          { ownerName: "Alex", lineCount: 2 },
          { ownerName: "Sam", lineCount: 1 },
        ],
      }),
      table({ id: "t5", label: "5", ...onMap, posX: 600 }),
    ]);

    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    const token = (id: string) =>
      canvas.shadowRoot!.querySelector<Token>(`[data-table="${id}"] wt-table-token`)!;
    expect(await tokenMark(token("t4"))).toBe("Unsent: Alex, Sam");
    expect(await tokenMark(token("t5"))).toBeUndefined();
  });

  it("marks the token in Spanish on the map", async () => {
    setLocale("es");
    const el = await mountFloor([
      seated(onMap, { unsentDrafts: [{ ownerName: "Alex", lineCount: 2 }] }),
    ]);

    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    expect(
      await tokenMark(canvas.shadowRoot!.querySelector<Token>('[data-table="t4"] wt-table-token')!),
    ).toBe("Sin enviar: Alex");
  });

  it("leaves room in the tray for a hanging mark, above the next row and the tray's edge", async () => {
    const unplaced = Array.from({ length: 6 }, (_, i) =>
      seated(
        { id: `u${i}`, label: `${i + 10}` },
        { id: `vu${i}`, unsentDrafts: [{ ownerName: "Alex", lineCount: 2 }] },
      ),
    );
    const el = await mountFloor([table({ id: "t5", label: "5", ...onMap }), ...unplaced]);
    el.style.display = "block";
    el.style.width = "300px";
    await el.updateComplete;

    const tray = el.shadowRoot!.querySelector<HTMLElement>(".tray")!;
    const items = [...tray.querySelectorAll<HTMLElement>(".tray-item")];
    const rowTops = [...new Set(items.map((item) => item.getBoundingClientRect().top))];
    expect(rowTops.length).toBeGreaterThan(1);
    const clearances: number[] = [];
    for (const item of items) {
      const token = item.querySelector<Token>("wt-table-token")!;
      await token.updateComplete;
      const tagBottom = token
        .shadowRoot!.querySelector("[data-unsent]")!
        .getBoundingClientRect().bottom;
      const top = item.getBoundingClientRect().top;
      const nextRow = rowTops.filter((rowTop) => rowTop > top);
      const limit =
        nextRow.length > 0
          ? Math.min(...nextRow)
          : tray.getBoundingClientRect().bottom -
            Number.parseFloat(getComputedStyle(tray).borderBottomWidth);
      clearances.push(limit - tagBottom);
    }
    expect(Math.min(...clearances)).toBeGreaterThan(0);
  });

  it("marks an unplaced table's token in the map's tray", async () => {
    const el = await mountFloor([
      table({ id: "t5", label: "5", ...onMap }),
      seated({}, { unsentDrafts: [{ ownerName: "Alex", lineCount: 2 }] }),
    ]);

    const tray = el.shadowRoot!.querySelector<Token>('[data-tray-table="t4"] wt-table-token')!;
    expect(await tokenMark(tray)).toBe("Unsent: Alex");
  });
});
