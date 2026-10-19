import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TillSeatDialog } from "../widgets/seat-dialog.js";
import type { TableState, TableParty, TableToday } from "../api/client.js";

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
    id: "t4",
    label: "4",
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

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v1",
    revision: 3,
    guestCount: 3,
    state: "open",
    name: null,
    displayName: "4",
    mainBillId: "wo-4",
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
    tabLineCount: 2,
    tabTotal: "14.00",
    party: party(partyOver),
    ...over,
  });
}

async function mountFloor(tables: TableState[]): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [
      {
        id: "z1",
        name: "Comedor",
        displayOrder: 0,
        active: true,
        closesAt: null,
        closed: false,
        hasPlan: false,
        layoutSetName: null,
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ],
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
    expect(card(el, "t4").querySelector(".total")!.textContent).toBe("€44.00");
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
    expect(card(el, "t4").querySelector(".total")!.textContent).toBe("€30.00");
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

  it("writes what the party owes the Spanish way in the list", async () => {
    setLocale("es");
    const el = await mountFloor([seated()]);

    expect(card(el, "t4").querySelector(".total")!.textContent).toBe("44,00\u00a0€");
  });

  it("writes what the party owes the Spanish way in the unplaced tray", async () => {
    setLocale("es");
    const el = await mountFloor([
      seated(),
      seated(
        { id: "t5", label: "5", today: today() },
        { id: "v5", outstanding: "30.00", tableIds: ["t5"] },
      ),
    ]);

    const tray = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[data-tray-table="t4"] wt-table-token',
    )!;
    await tray.updateComplete;
    expect(tray.shadowRoot!.querySelector(".total")!.textContent).toBe("44,00\u00a0€");
  });
});

describe("till-floor-screen: the party's name", () => {
  const partyName = (el: TillFloorScreen, id: string) =>
    card(el, id).querySelector("[data-party-name]")?.textContent?.trim() ?? null;

  it("shows a named party's name on its card", async () => {
    const list = await mountFloor([seated({}, { name: "Ana", displayName: "Ana" })]);
    expect(partyName(list, "t4")).toBe("Ana");
  });

  it("shows a joined party's tables, and nothing more for a party named after its one table", async () => {
    const joined = await mountFloor([
      seated({}, { displayName: "4, 5", tableIds: ["t4", "t5"] }),
      seated({ id: "t5", label: "5" }, { displayName: "4, 5", tableIds: ["t4", "t5"] }),
    ]);
    expect(partyName(joined, "t4")).toBe("4, 5");
    expect(partyName(joined, "t5")).toBe("4, 5");

    const alone = await mountFloor([seated()]);
    expect(partyName(alone, "t4")).toBeNull();
  });
});

describe("till-floor-screen: a table needing clearing", () => {
  const clearing = (id: string, label: string) => table({ id, label, condition: "needs_clearing" });

  it("says so on each table that needs clearing, each with Mark cleared", async () => {
    const el = await mountFloor([clearing("t4", "4"), { ...clearing("t5", "5") }]);

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
});

describe("till-floor-screen: a table's unsent orders", () => {
  const onMap = { today: today() };
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
      seated(
        {},
        { unsentDrafts: [{ billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 }] },
      ),
    ]);

    expect(marks(el, "t4")).toEqual(["Bill 1 · Alex has an unsent order: 2 items"]);
  });

  it("says one item in the singular", async () => {
    const el = await mountFloor([
      seated(
        {},
        { unsentDrafts: [{ billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 1 }] },
      ),
    ]);

    expect(marks(el, "t4")).toEqual(["Bill 1 · Alex has an unsent order: 1 item"]);
  });

  it("gives each bill with an unsent order a line of its own, in bill order", async () => {
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 },
            { billId: "bill-2", billNumber: 2, ownerName: "Sam", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual([
      "Bill 1 · Alex has an unsent order: 2 items",
      "Bill 2 · Sam has an unsent order: 1 item",
    ]);
  });

  it("names no one when the person is unknown", async () => {
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { billId: "bill-1", billNumber: 1, ownerName: "", lineCount: 3 },
            { billId: "bill-2", billNumber: 2, ownerName: "", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual([
      "Bill 1 · An unsent order: 3 items",
      "Bill 2 · An unsent order: 1 item",
    ]);
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountFloor([
      seated(
        {},
        {
          unsentDrafts: [
            { billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 },
            { billId: "bill-2", billNumber: 2, ownerName: "Sam", lineCount: 1 },
            { billId: "bill-3", billNumber: 3, ownerName: "", lineCount: 4 },
            { billId: "bill-4", billNumber: 4, ownerName: "", lineCount: 1 },
          ],
        },
      ),
    ]);

    expect(marks(el, "t4")).toEqual([
      "Cuenta 1 · Alex tiene un pedido sin enviar: 2 artículos",
      "Cuenta 2 · Sam tiene un pedido sin enviar: 1 artículo",
      "Cuenta 3 · Un pedido sin enviar: 4 artículos",
      "Cuenta 4 · Un pedido sin enviar: 1 artículo",
    ]);
  });

  it("shows no mark when the party has no unsent order", async () => {
    const el = await mountFloor([seated()]);

    expect(marks(el, "t4")).toEqual([]);
  });

  it("leaves room in the tray for a hanging mark, above the next row and the tray's edge", async () => {
    const unplaced = Array.from({ length: 6 }, (_, i) =>
      seated(
        { id: `u${i}`, label: `${i + 10}` },
        {
          id: `vu${i}`,
          unsentDrafts: [{ billId: `bill-u${i}`, billNumber: 1, ownerName: "Alex", lineCount: 2 }],
        },
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
      seated(
        {},
        { unsentDrafts: [{ billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 }] },
      ),
    ]);

    const tray = el.shadowRoot!.querySelector<Token>('[data-tray-table="t4"] wt-table-token')!;
    expect(await tokenMark(tray)).toBe("Unsent: Bill 1 · Alex has an unsent order: 2 items");
  });
});

describe("till-floor-screen: bill editor pairs", () => {
  const pairs = [
    { billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 },
    { billId: "bill-2", billNumber: 2, ownerName: "Alex", lineCount: 1 },
  ];
  const marks = (el: TillFloorScreen) =>
    [...card(el, "t4").querySelectorAll<HTMLElement>("[data-unsent]")].map((mark) =>
      mark.textContent!.replace(/\s+/g, " ").trim(),
    );

  it("shows equal editor names on independent numbered bills and updates only the changed pair", async () => {
    const el = await mountFloor([seated({}, { unsentDrafts: pairs })]);
    expect(marks(el)).toEqual([
      "Bill 1 · Alex has an unsent order: 2 items",
      "Bill 2 · Alex has an unsent order: 1 item",
    ]);
    el.tables = [seated({}, { unsentDrafts: [{ ...pairs[0]!, ownerName: "Sam" }, pairs[1]!] })];
    await el.updateComplete;
    expect(marks(el)).toEqual([
      "Bill 1 · Sam has an unsent order: 2 items",
      "Bill 2 · Alex has an unsent order: 1 item",
    ]);
    el.tables = [seated({}, { unsentDrafts: [pairs[1]!] })];
    await el.updateComplete;
    expect(marks(el)).toEqual(["Bill 2 · Alex has an unsent order: 1 item"]);
  });

  it("names both numbered bills in a compact map token's accessible unsent label", async () => {
    const el = await mountFloor([
      table({ id: "t5", label: "5", today: today() }),
      seated({}, { unsentDrafts: pairs }),
    ]);
    const token = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      '[data-tray-table="t4"] wt-table-token',
    )!;
    await token.updateComplete;
    expect(token.shadowRoot!.querySelector("[data-unsent]")!.getAttribute("aria-label")).toBe(
      "Unsent: Bill 1 · Alex has an unsent order: 2 items, Bill 2 · Alex has an unsent order: 1 item",
    );
  });

  it.each([360, 390])(
    "keeps long bill editor pairs inside their phone card at %i px",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const el = await mountFloor([
          seated(
            {},
            {
              unsentDrafts: [
                { ...pairs[0]!, ownerName: "AlexandradelRosariodelasMercedesFernandezFernandez" },
                pairs[1]!,
              ],
            },
          ),
        ]);
        const box = card(el, "t4").getBoundingClientRect();
        for (const mark of card(el, "t4").querySelectorAll<HTMLElement>("[data-unsent]")) {
          const range = document.createRange();
          range.selectNodeContents(mark);
          const bounds = range.getBoundingClientRect();
          expect(bounds.left).toBeGreaterThanOrEqual(box.left);
          expect(bounds.right).toBeLessThanOrEqual(box.right);
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );

  it("keeps both bill labels in Spanish including the unknown-editor fallback", async () => {
    setLocale("es");
    const el = await mountFloor([
      seated({}, { unsentDrafts: [pairs[0]!, { ...pairs[1]!, ownerName: "" }] }),
    ]);
    expect(marks(el)).toEqual([
      "Cuenta 1 · Alex tiene un pedido sin enviar: 2 artículos",
      "Cuenta 2 · Un pedido sin enviar: 1 artículo",
    ]);
  });
});

describe("till-floor-screen: a party's release reminder", () => {
  const now = Date.parse("2026-09-29T20:00:00.000Z");
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const onMap = { today: today() };
  type Token = HTMLElement & { updateComplete: Promise<unknown> };

  /** `clock: "real"` leaves the screen on its own clock. */
  async function mountAt(tables: TableState[], clock: number | "real" = now) {
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      zones: [
        {
          id: "z1",
          name: "Comedor",
          displayOrder: 0,
          active: true,
          closesAt: null,
          closed: false,
          hasPlan: false,
          layoutSetName: null,
          layoutDue: null,
          serviceMode: "table_tab",
        },
      ],
      tables,
      now: clock === "real" ? undefined : clock,
    });
    return el;
  }
  const chip = (el: TillFloorScreen, id: string) =>
    card(el, id).querySelector<HTMLElement>("[data-fire-due]");
  async function tokenChip(token: Token): Promise<string | undefined> {
    await token.updateComplete;
    return token.shadowRoot!.querySelector("[data-fire-due]")?.textContent?.trim();
  }

  it("marks a table's card when its party's reminder has fallen due", async () => {
    const el = await mountAt([
      seated({}, { reminder: { groupId: "g2", dueAt: at(-60_000) } }),
      seated({ id: "t5", label: "5" }, { id: "v5", reminder: { groupId: "g2", dueAt: at(0) } }),
    ]);
    expect(chip(el, "t4")!.textContent!.trim()).toBe("Time to fire");
    expect(chip(el, "t4")!.closest(".badges")).not.toBeNull();
    expect(chip(el, "t5")).not.toBeNull();
  });

  it.each([
    ["is not yet due", { groupId: "g2", dueAt: at(60_000) }],
    ["has no time", { groupId: "g2", dueAt: null }],
    ["does not exist", null],
  ])("shows no mark while the reminder %s", async (_state, reminder) => {
    const el = await mountAt([seated({}, { reminder })]);
    expect(chip(el, "t4")).toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountAt([seated({}, { reminder: { groupId: "g2", dueAt: at(-1) } })]);
    expect(chip(el, "t4")!.textContent!.trim()).toBe("Hora de marchar");
  });

  it("marks an unplaced table's token in the map's tray", async () => {
    const el = await mountAt([
      table({ id: "t5", label: "5", ...onMap }),
      seated({}, { reminder: { groupId: "g2", dueAt: at(-1) } }),
    ]);
    const tray = el.shadowRoot!.querySelector<Token>('[data-tray-table="t4"] wt-table-token')!;
    expect(await tokenChip(tray)).toBe("Time to fire");
  });

  describe("on the screen's own clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("marks the table the moment its reminder falls due, with no new floor read", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt(
        [
          seated({}, { reminder: { groupId: "g2", dueAt: at(120_000) } }),
          seated(
            { id: "t5", label: "5" },
            { id: "v5", reminder: { groupId: "g2", dueAt: at(60_000) } },
          ),
        ],
        "real",
      );
      expect(chip(el, "t5")).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(chip(el, "t5")).not.toBeNull();
      expect(chip(el, "t4")).toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      await el.updateComplete;
      expect(chip(el, "t4")).not.toBeNull();
    });

    it.each([
      ["cannot be read", "not a time"],
      ["is beyond the longest timer a browser keeps", "2100-01-01T00:00:00.000Z"],
    ])("does not keep redrawing for a reminder time that %s", async (_why, dueAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt([seated({}, { reminder: { groupId: "g2", dueAt } })], "real");
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(redraws).not.toHaveBeenCalled();
      expect(chip(el, "t4")).toBeNull();
    });

    it("does not keep redrawing for a reminder already due", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt(
        [seated({}, { reminder: { groupId: "g2", dueAt: at(-1) } })],
        "real",
      );
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(redraws).not.toHaveBeenCalled();
      expect(chip(el, "t4")).not.toBeNull();
    });

    it("marks the table on coming back to the page after its reminder fell due", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt(
        [seated({}, { reminder: { groupId: "g2", dueAt: at(60_000) } })],
        "real",
      );
      const parent = el.parentElement!;
      el.remove();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(chip(el, "t4")).toBeNull();
      parent.append(el);
      await vi.advanceTimersByTimeAsync(0);
      await el.updateComplete;
      expect(chip(el, "t4")).not.toBeNull();
    });

    it("an update queued before the screen is removed does not restart its reminder timer", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt([], "real");
      el.tables = [seated({}, { reminder: { groupId: "g2", dueAt: at(60_000) } })];
      el.remove();
      await el.updateComplete;
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(redraws).not.toHaveBeenCalled();
    });

    it("arms no timer when the screen is given its clock", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      vi.setSystemTime(now);
      const el = await mountAt([seated({}, { reminder: { groupId: "g2", dueAt: at(60_000) } })]);
      const redraws = vi.spyOn(el, "requestUpdate");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(redraws).not.toHaveBeenCalled();
    });
  });
});

it("shows today's seats on a tray token", async () => {
  const el = await mountFloor([
    table({ id: "t1", label: "1", today: today() }),
    seated({ today: { ...today(), placement: null, seats: 6 } }),
  ]);
  const token = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    '[data-tray-table="t4"] wt-table-token',
  )!;
  await token.updateComplete;
  expect(
    token.shadowRoot!.querySelector(".capacity")!.textContent?.replace(/\s+/g, " ").trim(),
  ).toBe("6 pax");
});
