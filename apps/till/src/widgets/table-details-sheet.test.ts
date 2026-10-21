import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import "./table-details-sheet.js";
import type { TillTableDetailsSheet } from "./table-details-sheet.js";
import type { TableParty, TableState } from "../api/client.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));
beforeEach(() => setLocale("en"));

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "p1" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 1,
    },
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

function table(over: Partial<TableState> & { enRoute?: number } = {}): TableState {
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
    timingBand: "fresh",
    nextReservation: null,
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
  it("labels Split tables… in English and Spanish", async () => {
    const long = table({
      id: "long",
      label: "Long table",
      today: {
        placement: { x: 10, y: 20, width: 6, height: 2, shape: "rect", rotation: 0 },
        seats: 10,
        fixed: false,
        takenOff: false,
        joinId: null,
        joinSeats: null,
        inJoinedTable: null,
        joined: { parts: ["c3", "c4"], splitOff: ["c5"], apart: false },
        splitOffFrom: null,
        zoneRevision: 0,
      },
    });
    const el = await mount({ table: long, heading: "Long table", actions: true });
    expect(text(el, '[data-today-action="split-off"]')).toBe("Split tables…");
    setLocale("es-ES");
    const es = await mount({ table: long, heading: "Long table", actions: true });
    expect(text(es, '[data-today-action="split-off"]')).toBe("Separar mesas…");
  });

  describe("Reset table", () => {
    const todayOf = (over: Partial<NonNullable<TableState["today"]>>) => ({
      placement: { x: 10, y: 20, width: 6, height: 2, shape: "rect" as const, rotation: 0 },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      inJoinedTable: null,
      joined: null,
      splitOffFrom: null,
      zoneRevision: 0,
      ...over,
    });
    const long = table({
      id: "long",
      label: "Long table",
      today: todayOf({
        seats: 10,
        joined: { parts: ["c3", "c4"], splitOff: ["c5"], apart: false },
      }),
    });
    const c5 = table({ id: "c5", label: "Counter 5", today: todayOf({ splitOffFrom: "long" }) });

    it("labels Reset table in English and Spanish", async () => {
      const el = await mount({
        table: long,
        heading: "Long table",
        actions: true,
        tables: [long, c5],
      });
      expect(text(el, '[data-today-action="reset-table"]')).toBe("Reset table");
      setLocale("es-ES");
      const es = await mount({
        table: c5,
        heading: "Counter 5",
        actions: true,
        tables: [long, c5],
      });
      expect(text(es, '[data-today-action="reset-table"]')).toBe("Restablecer mesa");
    });

    it("offers no Reset table without the zone's tables", async () => {
      const el = await mount({ table: long, heading: "Long table", actions: true });
      expect(find(el, '[data-today-action="split-off"]')).not.toBeNull();
      expect(find(el, '[data-today-action="reset-table"]')).toBeNull();
    });
  });

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
          inJoinedTable: null,
          joined: null,
          splitOffFrom: null,
          zoneRevision: 0,
        },
      }),
    });
    expect(dialogOf(el).open).toBe(true);
    expect(dialogOf(el).heading).toBe("Terrace 4+5");
    expect(text(el, "[data-seats]")).toBe("6 seats");
  });

  it("says the saved name under a heading that is today's name, in English and Spanish", async () => {
    const el = await mount({ heading: "Window", savedName: "Counter 4" });
    expect(text(el, "[data-saved-name]")).toBe("Saved as Counter 4");
    expect(lines(el)).not.toContain("Saved as Counter 4");

    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(el, "[data-saved-name]")).toBe("Guardada como Counter 4");
  });

  it("says no saved name when it is given none", async () => {
    const el = await mount({ heading: "Table 1" });
    expect(find(el, "[data-saved-name]")).toBeNull();
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
    expect(text(el, "[data-kitchen]")).toBe("3 to serve · 3 ready");
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

  it("says one ready dish in the singular, as the pin does", async () => {
    setLocale("es");
    const el = await mount({
      table: table({ ...seated, pendingToServe: 2, readyToServe: 1, party: party() }),
    });
    expect(text(el, "[data-kitchen]")).toBe("1 por servir · 1 listo");
    el.table = table({ ...seated, pendingToServe: 3, readyToServe: 2, enRoute: 1, party: party() });
    await el.updateComplete;
    expect(text(el, "[data-kitchen]")).toBe(
      `1 ${es["floor.to_serve"]} · ${es["table.flash_ready"].replace("{n}", "2")}`,
    );
    setLocale("en");
    el.table = table({ ...seated, pendingToServe: 2, readyToServe: 1, party: party() });
    await el.updateComplete;
    expect(text(el, "[data-kitchen]")).toBe("1 to serve · 1 ready");
  });

  describe.each(["en", "es"] as const)("A773 no dispatch state (%s)", (locale) => {
    const strings = locale === "en" ? en : es;

    it("keeps every ready dish when the server omits dispatch, including after Serve and Undo", async () => {
      setLocale(locale);
      const shown = table({
        ...seated,
        pendingToServe: 6,
        readyToServe: 3,
        party: party(),
      });
      Reflect.deleteProperty(shown, "enRoute");
      const el = await mount({ table: shown });
      const initial = `3 ${strings["floor.to_serve"]} · ${strings["table.flash_ready"].replace("{n}", "3")}`;
      expect(text(el, "[data-kitchen]")).toBe(initial);

      el.table = { ...shown, pendingToServe: 4, readyToServe: 1 };
      await el.updateComplete;
      expect(text(el, "[data-kitchen]")).toBe(
        `3 ${strings["floor.to_serve"]} · ${strings["table.flash_ready_one"]}`,
      );

      el.table = { ...shown };
      await el.updateComplete;
      expect(text(el, "[data-kitchen]")).toBe(initial);
    });

    it("does not subtract or display legacy dispatch beside a station's ready chip", async () => {
      setLocale(locale);
      const el = await mount({
        table: table({
          ...seated,
          pendingToServe: 6,
          readyToServe: 3,
          enRoute: 2,
          party: party(),
          signals: [
            {
              kind: "ready",
              byStation: [{ stationId: "s1", stationName: "Kitchen", count: 3 }],
            },
          ],
        }),
      });
      expect(text(el, "[data-kitchen]")).toBe(`3 ${strings["floor.to_serve"]}`);
      expect(text(el, "[data-chip='ready']")).toBe(
        strings["signal.ready_at"].replace("{station}", "Kitchen").replace("{n}", "3"),
      );
    });

    it("never invents an in-transit dish from a legacy dispatch count", async () => {
      setLocale(locale);
      const el = await mount({
        table: table({ ...seated, pendingToServe: 1, enRoute: 2, party: party() }),
      });
      expect(text(el, "[data-kitchen]")).toBe(`1 ${strings["floor.to_serve"]}`);
      expect(find(el, "[data-chip='ready']")).toBeNull();
    });
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
        party: party({
          outstanding: "5.00",
          unsentDrafts: [{ billId: "bill-1", billNumber: 1, ownerName: "Luis", lineCount: 2 }],
        }),
      }),
    });
    expect(text(el, "[data-unsent]")).toBe("Bill 1 · Luis has an unsent order: 2 items");
  });

  it("keeps every bill/editor pair visible in the expanded detail alongside independent service signals", async () => {
    const el = await mount({
      table: table({
        ...seated,
        pendingToServe: 3,
        readyToServe: 1,
        party: party({
          billCount: 2,
          unsentDrafts: [
            { billId: "b1", billNumber: 1, ownerName: "Luis", lineCount: 2 },
            { billId: "b2", billNumber: 2, ownerName: "Luis", lineCount: 1 },
          ],
          reminder: { groupId: "g1", dueAt: "2026-10-10T11:00:00Z" },
        }),
      }),
      now: Date.parse("2026-10-10T12:00:00Z"),
    });
    expect(
      [...el.shadowRoot!.querySelectorAll("[data-unsent]")].map((li) =>
        li.textContent!.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual([
      "Bill 1 · Luis has an unsent order: 2 items",
      "Bill 2 · Luis has an unsent order: 1 item",
    ]);
    expect(text(el, "[data-kitchen]")).toBe("2 to serve · 1 ready");
    expect(text(el, "[data-fire-due]")).toBe("Time to fire");
  });

  it.each([360, 390])(
    "keeps a long bill editor name inside the expanded phone detail at %i px",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const el = await mount({
          table: table({
            ...seated,
            party: party({
              unsentDrafts: [
                {
                  billId: "b1",
                  billNumber: 1,
                  ownerName: "AlexandradelRosariodelasMercedesFernandezFernandez",
                  lineCount: 2,
                },
                { billId: "b2", billNumber: 2, ownerName: "Luis", lineCount: 1 },
              ],
            }),
          }),
        });
        const dialog = dialogOf(el);
        await dialog.updateComplete;
        const box = dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
        for (const mark of el.shadowRoot!.querySelectorAll<HTMLElement>("[data-unsent]")) {
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

  it("lists the chips in the card's order", async () => {
    const el = await mount({
      table: table({
        ...seated,
        party: party(),
        signals: [
          { kind: "ready", byStation: [{ stationId: "s1", stationName: "Kitchen", count: 1 }] },
          { kind: "bill_requested", requestedAt: "2026-10-10T12:00:00Z" },
        ],
      }),
    });
    const chips = [...el.shadowRoot!.querySelectorAll("[data-chip]")];
    expect(chips.map((chip) => chip.getAttribute("data-chip"))).toEqual([
      "bill-requested",
      "ready",
    ]);
  });

  it("spaces the chips from the last line as the lines are spaced", async () => {
    const el = await mount({
      table: table({
        pendingDeliveries: 1,
        signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T12:00:00Z" }],
      }),
    });
    const list = find(el, ".lines")!;
    const last = list.lastElementChild!.getBoundingClientRect();
    const chips = find(el, ".chips")!.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(list).rowGap);
    expect(gap).toBeGreaterThan(0);
    expect(chips.top - last.bottom).toBeCloseTo(gap);
  });

  it("with no lines, draws no list and puts no space above the chips", async () => {
    const el = await mount({
      table: table({
        today: {
          placement: null,
          seats: null,
          fixed: false,
          takenOff: false,
          joinId: null,
          joinSeats: null,
          inJoinedTable: null,
          joined: null,
          splitOffFrom: null,
          zoneRevision: 0,
        },
        signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T12:00:00Z" }],
      }),
    });
    expect(find(el, ".lines")).toBeNull();
    expect(getComputedStyle(find(el, ".chips")!).marginTop).toBe("0px");
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

for (const theme of ["light", "dark"] as const) {
  it(`paints the details' Bill requested chip purple in ${theme}`, async () => {
    const { el, host } = await mountWidget<TillTableDetailsSheet>(
      "till-table-details-sheet",
      {
        table: table({
          signals: [{ kind: "bill_requested", requestedAt: "2026-10-10T12:00:00Z" }],
        }),
        heading: "Table 9",
      },
      theme,
    );
    const chip = el.shadowRoot!.querySelector("[data-chip='bill-requested']")!;
    const control = document.createElement("span");
    control.style.backgroundColor = "var(--wt-color-table-bill)";
    control.style.color = "var(--wt-color-on-table-bill)";
    host.appendChild(control);
    expect(getComputedStyle(chip).backgroundColor).toBe(getComputedStyle(control).backgroundColor);
    expect(getComputedStyle(chip).color).toBe(getComputedStyle(control).color);
  });
}
