import { describe, expect, it } from "vitest";

import { FEED_BEFORE_CUT } from "@waitron/printing";
import { formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import type { KitchenLayout, KitchenTicket } from "./kitchen-ticket.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";

// The formatter is a PURE byte producer (design §3c) — no DB, no container — so these are ordinary
// unit tests. We decode the ESC/POS payload back to its Latin-1 text (the encoding escpos.ts uses,
// pinned in escpos.test.ts) to assert the human-readable content, and check the raw cut bytes at the
// tail. GS V 0 (full cut) is 0x1D 0x56 0x00 (escpos.ts / escpos.test.ts); feed precedes it, so the
// final three bytes are always the cut.
const CUT_BYTES = [0x1d, 0x56, 0x00];
/** ESC d n — the shared feed before every cut, so the tear-off clears the print head. */
const FEED_THEN_CUT = [0x1b, 0x64, FEED_BEFORE_CUT, ...CUT_BYTES];
const KITCHEN_80: KitchenLayout = { columns: 42, charset: "wpc1252" };
const KITCHEN_58: KitchenLayout = { columns: 30, charset: "pc858" };

describe("formatKitchenTicket", () => {
  describe("station scope", () => {
    it("prints the station name, table/order/time, each qty x name line, and ends in a cut", () => {
      const bytes = formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [
            { qty: 2, name: "Steak" },
            { qty: 1, name: "Chips" },
          ],
        },
        KITCHEN_80,
      );

      const text = decodeTicket(bytes);
      expect(text).toContain("Cocina");
      expect(text).toContain("Mesa 4");
      expect(text).toContain("A-17");
      expect(text).toContain("14:30");
      expect(text).toContain("2 x Steak");
      expect(text).toContain("1 x Chips");

      // Ends with the shared feed then the full-cut command.
      expect([...bytes.slice(-FEED_THEN_CUT.length)]).toEqual(FEED_THEN_CUT);
    });

    it("zero-pads a single-digit hour and minute to local HH:MM", () => {
      const text = decodeTicket(
        formatKitchenTicket(
          {
            scope: "station",
            stationName: "Cocina",
            tableLabel: "Mesa 1",
            orderNumber: "A-1",
            firedAt: new Date(2026, 7, 17, 9, 5),
            items: [{ qty: 1, name: "Cafe" }],
          },
          KITCHEN_80,
        ),
      );
      expect(text).toContain("09:05");
    });

    it("prints a snapshotted unit beside a fractional quantity", () => {
      const text = decodeTicket(
        formatKitchenTicket(
          {
            scope: "station",
            stationName: "Cocina",
            tableLabel: "Mesa 1",
            orderNumber: "A-1",
            firedAt: new Date(2026, 7, 17, 9, 5),
            items: [{ qty: "0.375", unit: "kg", name: "Jamón" }],
          },
          KITCHEN_80,
        ),
      );
      expect(text).toContain("0.375 kg x Jamón");
    });

    it("prints the doneness prominently and the note as indented sub-lines beneath the dish", () => {
      const text = decodeTicket(
        formatKitchenTicket(
          {
            scope: "station",
            stationName: "Cocina",
            tableLabel: "Mesa 4",
            orderNumber: "A-17",
            firedAt: new Date(2026, 7, 17, 14, 30),
            items: [
              {
                qty: 1,
                name: "Steak",
                doneness: "medium_rare",
                note: "sin sal",
                modifiers: ["Grande"],
              },
            ],
          },
          KITCHEN_80,
        ),
      );
      const lines = text.split("\n");
      const dish = lines.findIndex((l) => l.includes("1 x Steak"));
      expect(dish).toBeGreaterThanOrEqual(0);
      // Doneness is PROMINENT (upper-cased, underscores → spaces, marked) and sits directly beneath the
      // dish — the cook must read it first — above the `+ modifier` and the note sub-lines.
      expect(lines[dish + 1]).toContain("MEDIUM RARE");
      expect(lines[dish + 1]).not.toContain("medium_rare");
      expect(text).toContain("  + Grande");
      // The free-text note prints as its own indented sub-line, distinct from a `+ modifier`.
      expect(text).toMatch(/\n {2}\* sin sal/);
    });

    it("sanitizes a free-text note with a newline so it prints on ONE ticket line", () => {
      // A free-text note is operator-typed and may carry newlines / control bytes; printed raw they
      // would split the note across ticket lines (or emit stray control commands) and garble the
      // thermal ticket. The control chars collapse to a space so the note stays a single `* ` sub-line.
      const text = decodeTicket(
        formatKitchenTicket(
          {
            scope: "station",
            stationName: "Cocina",
            tableLabel: "Mesa 4",
            orderNumber: "A-17",
            firedAt: new Date(2026, 7, 17, 14, 30),
            items: [{ qty: 1, name: "Steak", note: "sin sal\nmuy hecho" }],
          },
          KITCHEN_80,
        ),
      );
      const lines = text.split("\n");
      // Exactly one sub-line, with the newline collapsed to a space — never a second "muy hecho" line.
      expect(lines).toContain("  * sin sal muy hecho");
      expect(lines.filter((l) => l.includes("* "))).toHaveLength(1);
    });

    it("prints a plain dish (no doneness, no note) byte-for-byte as before", () => {
      const withExtras = formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [{ qty: 1, name: "Chips", doneness: undefined, note: undefined }],
        },
        KITCHEN_80,
      );
      const plain = formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [{ qty: 1, name: "Chips" }],
        },
        KITCHEN_80,
      );
      expect([...withExtras]).toEqual([...plain]);
    });

    it("does not crash on a zero-item station ticket, and still ends in a cut", () => {
      const bytes = formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [],
        },
        KITCHEN_80,
      );
      expect(decodeTicket(bytes)).toContain("Cocina");
      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });
  });

  describe("order scope", () => {
    it("prints a pass header, table/order/time, and groups items under each station sub-header in order", () => {
      const bytes = formatKitchenTicket(
        {
          scope: "order",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          stations: [
            { stationName: "Cocina", items: [{ qty: 2, name: "Steak" }] },
            { stationName: "Parrilla", items: [{ qty: 1, name: "Chips" }] },
          ],
        },
        KITCHEN_80,
      );

      const text = decodeTicket(bytes);
      expect(text).toContain("PASE");
      expect(text).toContain("Mesa 4");
      expect(text).toContain("A-17");
      expect(text).toContain("14:30");

      // Each station's item appears UNDER that station's sub-header...
      expect(text.indexOf("Cocina")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("Cocina")).toBeLessThan(text.indexOf("2 x Steak"));
      expect(text.indexOf("Parrilla")).toBeLessThan(text.indexOf("1 x Chips"));

      // ...and the stations appear in the order they were passed, with the first station's item
      // grouped before the second station begins (not floating past its own header).
      expect(text.indexOf("Cocina")).toBeLessThan(text.indexOf("Parrilla"));
      expect(text.indexOf("2 x Steak")).toBeLessThan(text.indexOf("Parrilla"));

      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });

    it("does not crash on a zero-station order ticket, and still ends in a cut", () => {
      const bytes = formatKitchenTicket(
        {
          scope: "order",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          stations: [],
        },
        KITCHEN_80,
      );
      expect(decodeTicket(bytes)).toContain("PASE");
      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });
  });
});

describe("formatCorrectionSlip", () => {
  it("prints a VOID header, station, table, order, time, and the item via emitItem, ending in a cut", () => {
    const bytes = formatCorrectionSlip(
      {
        kind: "VOID",
        stationName: "Cocina",
        tableLabel: "Mesa 6",
        orderNumber: "A-12",
        at: new Date(2026, 7, 17, 14, 30).toISOString(),
        item: { qty: 2, name: "Tiramisu", modifiers: ["extra nata x2"] },
      },
      KITCHEN_80,
    );

    const text = decodeTicket(bytes);
    expect(text).toContain("*** VOID ***");
    expect(text).toContain("Cocina");
    expect(text).toContain("Mesa 6");
    expect(text).toContain("A-12");
    expect(text).toContain("14:30");
    expect(text).toContain("2 x Tiramisu");
    expect(text).toContain("  + extra nata x2");

    expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
  });

  it("prints a RECALLED header for a recalled slip", () => {
    const text = decodeTicket(
      formatCorrectionSlip(
        {
          kind: "RECALLED",
          stationName: "Parrilla",
          tableLabel: "Mesa 2",
          orderNumber: "A-5",
          at: new Date(2026, 7, 17, 9, 5).toISOString(),
          item: { qty: 1, name: "Chips" },
        },
        KITCHEN_80,
      ),
    );
    expect(text).toContain("*** RECALLED ***");
    expect(text).not.toContain("VOID");
    expect(text).toContain("09:05");
  });

  it("omits the table line entirely when tableLabel is null", () => {
    const text = decodeTicket(
      formatCorrectionSlip(
        {
          kind: "VOID",
          stationName: "Cocina",
          tableLabel: null,
          orderNumber: "A-9",
          at: new Date(2026, 7, 17, 12, 0).toISOString(),
          item: { qty: 1, name: "Cafe" },
        },
        KITCHEN_80,
      ),
    );
    expect(text).toContain("VOID");
    expect(text).toContain("A-9");
    expect(text).not.toContain("Mesa");
  });
});

describe("kitchen paper layout", () => {
  const ticket: KitchenTicket = {
    scope: "station",
    stationName: "Cocina",
    tableLabel: "Mesa 4",
    orderNumber: "A-17",
    firedAt: new Date(2026, 7, 17, 14, 30),
    items: [
      {
        qty: 2,
        name: "Chuletón de buey madurado a la brasa",
        doneness: "medium_rare",
        modifiers: ["Grande", "Salsa de setas silvestres con trufa negra"],
        note: "sin sal y con la guarnición aparte por favor",
      },
    ],
  };

  it.each([KITCHEN_80, KITCHEN_58])(
    "keeps every line within $columns columns, indented under its text",
    (layout) => {
      const lines = printedLines(formatKitchenTicket(ticket, layout));
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(layout.columns);
      expect(lines).toContain("  + Grande");
    },
  );

  it("wraps item, modifier and note lines at 30 columns with their indents", () => {
    const lines = printedLines(formatKitchenTicket(ticket, KITCHEN_58));
    const first = lines.indexOf("2 x Chuletón de buey madurado");
    expect(first).toBeGreaterThan(0);
    expect(lines.slice(first)).toEqual([
      "2 x Chuletón de buey madurado",
      "    a la brasa",
      "  ** MEDIUM RARE **",
      "  + Grande",
      "  + Salsa de setas silvestres",
      "    con trufa negra",
      "  * sin sal y con la",
      "    guarnición aparte por",
      "    favor",
      "",
    ]);
  });

  it("encodes with the layout's character set", () => {
    const bytes = [
      ...formatKitchenTicket({ ...ticket, items: [{ qty: 1, name: "Café" }] }, KITCHEN_58),
    ];
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(bytes).toContain(0x82); // é in code page 858
    expect(bytes).not.toContain(0xe9);
  });

  it("wraps a correction slip to the layout too", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          kind: "VOID",
          stationName: "Cocina",
          tableLabel: null,
          orderNumber: "A-17",
          at: "2026-08-17T12:30:00.000Z",
          item: ticket.items[0]!,
        },
        KITCHEN_58,
      ),
    );
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    expect(lines).toContain("  + Salsa de setas silvestres");
  });
});
