import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./table-details-sheet.js";
import type { TillTableDetailsSheet } from "./table-details-sheet.js";
import type { TableParty, TableState } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    id: "p1",
    revision: 1,
    guestCount: null,
    state: "open",
    name: null,
    displayName: "1",
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: ["t1"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

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
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

const seated = { state: "open-tab" as const, condition: "held" as const, hasOpenTab: true };

async function mount(over: Partial<TillTableDetailsSheet> = {}): Promise<TillTableDetailsSheet> {
  const { el } = await mountWidget<TillTableDetailsSheet>("till-table-details-sheet", {
    table: table(),
    heading: "1",
    ...over,
  });
  return el;
}

const dialogOf = (el: TillTableDetailsSheet) => el.shadowRoot!.querySelector("wt-dialog")!;
const find = (el: TillTableDetailsSheet, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const text = (el: TillTableDetailsSheet, selector: string) =>
  find(el, selector)?.textContent?.replace(/\s+/g, " ").trim();
const lines = (el: TillTableDetailsSheet) =>
  [...el.shadowRoot!.querySelectorAll(".lines > li")].map((li) =>
    li.textContent!.replace(/\s+/g, " ").trim(),
  );

function captureEvents(el: TillTableDetailsSheet): string[] {
  const seen: string[] = [];
  el.addEventListener("details-close", (event) => {
    expect(event.bubbles && event.composed).toBe(true);
    seen.push("details-close");
  });
  el.addEventListener("mark-cleared", (event) => {
    expect(event.bubbles && event.composed).toBe(true);
    seen.push(`mark-cleared ${JSON.stringify((event as CustomEvent).detail)}`);
  });
  return seen;
}

describe("till-table-details-sheet", () => {
  it("is closed with no table", async () => {
    const el = await mount({ table: null });
    expect(dialogOf(el).open).toBe(false);
  });

  it("heads itself with the name it is given and shows today's seats", async () => {
    const el = await mount({
      heading: "Terrace 4+5",
      table: table({
        label: "Terrace 4",
        today: {
          placement: null,
          seats: 4,
          fixed: false,
          takenOff: false,
          joinId: "j1",
          joinSeats: 6,
        },
      }),
    });
    expect(dialogOf(el).open).toBe(true);
    expect(dialogOf(el).heading).toBe("Terrace 4+5");
    expect(text(el, "[data-seats]")).toBe("6 seats");
  });

  it("shows a seated party: its name, guests, what it owes, its bills and its kitchen progress", async () => {
    const el = await mount({
      heading: "4",
      table: table({
        ...seated,
        label: "4",
        pendingToServe: 6,
        readyToServe: 3,
        enRoute: 1,
        party: party({
          name: "Ana",
          displayName: "Ana",
          guestCount: 4,
          outstanding: "47.50",
          billCount: 2,
        }),
      }),
    });
    expect(text(el, "[data-party-name]")).toBe("Ana");
    expect(text(el, "[data-guests]")).toBe("Guests: 4");
    expect(text(el, "[data-owed]")).toBe(
      `Owes ${formatMoney("47.50", currentLocale())}`.replace(/\s+/g, " "),
    );
    expect(find(el, "[data-paid]")).toBeNull();
    expect(text(el, "[data-bills]")).toBe("Bills: 2");
    expect(text(el, "[data-kitchen]")).toBe("3 to serve · 2 ready · 1 en route");
    expect(find(el, "[data-free]")).toBeNull();
  });

  it("leaves out the party's name when it is the heading or staff gave none", async () => {
    const named = await mount({
      heading: "Ana",
      table: table({ ...seated, label: "4", party: party({ name: "Ana", displayName: "Ana" }) }),
    });
    expect(find(named, "[data-party-name]")).toBeNull();

    const unnamed = await mount({
      heading: "4+5",
      table: table({ ...seated, label: "4", party: party({ name: null, displayName: "4, 5" }) }),
    });
    expect(find(unnamed, "[data-party-name]")).toBeNull();
  });

  it("leaves out the ready count while a station's ready chip shows, and a single bill", async () => {
    const el = await mount({
      table: table({
        ...seated,
        pendingToServe: 3,
        readyToServe: 2,
        party: party({ outstanding: "5.00" }),
        signals: [
          {
            kind: "ready",
            byStation: [{ stationId: "s1", stationName: "Kitchen", count: 2 }],
          },
        ],
      }),
    });
    expect(text(el, "[data-kitchen]")).toBe("1 to serve");
    expect(find(el, "[data-chip='ready']")).not.toBeNull();
    expect(find(el, "[data-bills]")).toBeNull();
    expect(find(el, "[data-guests]")).toBeNull();
  });

  it("says Paid when the party owes nothing", async () => {
    const el = await mount({
      table: table({ ...seated, hasOpenTab: false, party: party({ outstanding: "0.00" }) }),
    });
    expect(text(el, "[data-paid]")).toBe("Paid");
    expect(find(el, "[data-owed]")).toBeNull();
    expect(find(el, "[data-kitchen]")).toBeNull();
  });

  it("says Time to fire when the held group is due, and not before", async () => {
    const due = Date.parse("2026-10-10T12:00:00Z");
    const held = table({
      ...seated,
      party: party({
        outstanding: "5.00",
        reminder: { groupId: "g1", dueAt: "2026-10-10T12:00:00Z" },
      }),
    });
    const el = await mount({ table: held, now: due - 1000 });
    expect(find(el, "[data-fire-due]")).toBeNull();

    el.now = due;
    await el.updateComplete;
    expect(text(el, "[data-fire-due]")).toBe("Time to fire");
  });

  it("shows the unsent orders", async () => {
    const el = await mount({
      table: table({
        ...seated,
        party: party({ outstanding: "5.00", unsentDrafts: [{ ownerName: "Luis", lineCount: 2 }] }),
      }),
    });
    expect(text(el, "[data-unsent]")).toBe("Luis has an unsent order: 2 items");
  });

  it("shows the signal chips, the booking and a delivery", async () => {
    const el = await mount({
      table: table({
        state: "delivery-pending",
        pendingDeliveries: 2,
        nextReservation: { time: "20:30" },
        signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T12:00:00Z" }],
      }),
    });
    expect(find(el, "[data-chip='bill-requested']")).not.toBeNull();
    expect(text(el, "[data-reserved]")).toBe("Reserved 20:30");
    expect(text(el, "[data-delivery]")).toBe("2 to deliver");
    expect(find(el, "[data-free]")).toBeNull();
  });

  it("says Free for a free table with nothing on it", async () => {
    const el = await mount({ table: table() });
    expect(lines(el)).toEqual(["Free"]);
    expect(find(el, "[data-mark-cleared]")).toBeNull();
  });

  it("does not say Free beside a chip", async () => {
    const el = await mount({ table: table({ signals: [{ kind: "long_wait", band: "warm" }] }) });
    expect(lines(el)).toEqual([]);
    expect(find(el, "[data-chip='long-wait']")).not.toBeNull();
  });

  it("says a table needs clearing, not that it is free", async () => {
    const el = await mount({ table: table({ condition: "needs_clearing" }) });
    expect(lines(el)).toEqual(["Needs clearing"]);
  });

  it("offers Mark cleared only for a table needing clearing, and closes after it", async () => {
    const el = await mount({ table: table({ condition: "needs_clearing" }) });
    const seen = captureEvents(el);
    find(el, "[data-mark-cleared]")!.click();
    expect(seen).toEqual(['mark-cleared {"tableId":"t1"}', "details-close"]);

    const free = await mount({ table: table() });
    expect(find(free, "[data-mark-cleared]")).toBeNull();
  });

  it("Close asks to close", async () => {
    const el = await mount();
    const seen = captureEvents(el);
    find(el, "[data-details-close]")!.click();
    await el.updateComplete;
    expect(seen).toEqual(["details-close"]);
  });

  it("Escape asks to close", async () => {
    const el = await mount();
    const seen = captureEvents(el);
    const closed = new Promise((resolve) =>
      dialogOf(el).addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(seen).toEqual(["details-close"]);
  });

  it("asks nothing when its table is taken away", async () => {
    const el = await mount();
    const seen = captureEvents(el);
    const closed = new Promise((resolve) =>
      dialogOf(el).addEventListener("wt-close", resolve, { once: true }),
    );
    el.table = null;
    await closed;
    expect(dialogOf(el).open).toBe(false);
    expect(seen).toEqual([]);
  });

  it("reads Spanish", async () => {
    setLocale("es-ES");
    const el = await mount({
      table: table({ ...seated, party: party({ outstanding: "47.50" }) }),
    });
    expect(text(el, "[data-owed]")).toBe(
      `Debe ${formatMoney("47.50", "es-ES")}`.replace(/\s+/g, " "),
    );
    expect(text(el, "[data-details-close]")).toBe("Cerrar");
  });
});
