import { describe, expect, it } from "vitest";

import { FEED_BEFORE_CUT } from "@waitron/printing";
import { arrangeTicketItems, formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import type { KitchenLayout, KitchenTicket, KitchenTicketItem } from "./kitchen-ticket.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";

// Decodes the payload as Latin-1 to assert the readable content; the final three bytes are always the
// full cut, GS V 0 (0x1D 0x56 0x00).
const CUT_BYTES = [0x1d, 0x56, 0x00];
/** ESC d n — the shared feed before every cut, so the tear-off clears the print head. */
const FEED_THEN_CUT = [0x1b, 0x64, FEED_BEFORE_CUT, ...CUT_BYTES];
const KITCHEN_80: KitchenLayout = { columns: 42, charset: "wpc1252", characterTable: 16 };
const KITCHEN_58: KitchenLayout = { columns: 30, charset: "pc858", characterTable: 19 };

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
            items: [{ qty: "0.375", unit: "kg", name: "Jamón", printedAsSold: true }],
          },
          KITCHEN_80,
        ),
      );
      expect(text).toContain("0.375 kg x Jamón");
    });

    it("prints the note as an indented sub-line beneath the dish", () => {
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
      // The modifiers sit directly beneath the dish, and the free-text note prints as its own
      // indented sub-line after them, distinct from a `+ modifier`.
      expect(lines[dish + 1]).toBe("  + Grande");
      expect(lines[dish + 2]).toBe("  * sin sal");
    });

    it("sanitizes a free-text note with a newline so it prints on ONE ticket line", () => {
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
      expect(lines).toContain("  * sin sal muy hecho");
      expect(lines.filter((l) => l.includes("* "))).toHaveLength(1);
    });

    it("prints a plain dish (no note) byte-for-byte as before", () => {
      const withExtras = formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [{ qty: 1, name: "Chips", note: undefined }],
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

describe("formatCorrectionSlip for work moved to another table", () => {
  it("prints the table and order number the kitchen had, then the ones the work moved to", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          kind: "MOVED",
          stationName: "Cocina",
          tableLabel: "Mesa 7",
          orderNumber: "15",
          movedFrom: { tableLabel: "Mesa 3", orderNumber: "12" },
          at: new Date(2026, 7, 17, 14, 30).toISOString(),
          item: { qty: 2, name: "Tiramisu", note: "sin nata" },
        },
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "*** MOVED ***",
      "Cocina",
      "Mesa 3 -> Mesa 7",
      "12 -> 15",
      "14:30",
      "2 x Tiramisu",
      "  * sin nata",
      "",
    ]);
  });

  it("prints the order number once when the order moved with its work, and a dash for no table", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          kind: "MOVED",
          stationName: "Cocina",
          tableLabel: null,
          orderNumber: "12",
          movedFrom: { tableLabel: "Mesa 3", orderNumber: "12" },
          at: new Date(2026, 7, 17, 9, 5).toISOString(),
          item: { qty: 1, name: "Chips" },
        },
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "*** MOVED ***",
      "Cocina",
      "Mesa 3 -> -",
      "12",
      "09:05",
      "1 x Chips",
      "",
    ]);
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

    const tableSix = [
      ...formatKitchenTicket(
        { ...ticket, items: [{ qty: 1, name: "Café" }] },
        { ...KITCHEN_80, characterTable: 6 },
      ),
    ];
    expect(tableSix.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 6]);
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

describe("a note made only of control characters", () => {
  it("prints no note sub-line, leaving the dish exactly as a dish with no note", () => {
    const ticket = (note?: string) =>
      formatKitchenTicket(
        {
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: new Date(2026, 7, 17, 14, 30),
          items: [{ qty: 1, name: "Steak", ...(note === undefined ? {} : { note }) }],
        },
        KITCHEN_80,
      );
    expect([...ticket("\r\n\t\u0007")]).toEqual([...ticket()]);
  });
});

describe("the reprint mark and a party's group numbers", () => {
  const at = new Date(2026, 7, 17, 14, 30);
  const station = (items: KitchenTicketItem[]) =>
    ({
      scope: "station",
      stationName: "Cocina",
      tableLabel: "Mesa 4",
      orderNumber: "A-17",
      firedAt: at,
      items,
    }) as const;

  // Fails if a reprint prints as a fresh fire, or the mark moves off the first line.
  it("opens a reprint with *** REPRINT *** and prints the rest as the ticket would", () => {
    const items = [{ qty: 2, name: "Steak" }];
    const plain = printedLines(formatKitchenTicket(station(items), KITCHEN_80));
    const again = printedLines(
      formatKitchenTicket({ ...station(items), reprint: true }, KITCHEN_80),
    );
    expect(again).toEqual(["*** REPRINT ***", ...plain]);
  });

  // Fails if a group's fire ticket stops naming its group under the header.
  it("names the one group a ticket carries under the header", () => {
    const lines = printedLines(
      formatKitchenTicket(
        station([
          { qty: 2, name: "Steak", group: 2 },
          { qty: 1, name: "Fish", group: 2 },
        ]),
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "Cocina",
      "Mesa 4",
      "A-17",
      "14:30",
      "GROUP 2",
      "2 x Steak",
      "1 x Fish",
      "",
    ]);
  });

  // Fails if items of several groups print as one run, or group-less items gain a heading.
  it("heads each group's items when a ticket spans groups, group-less items first with none", () => {
    const lines = printedLines(
      formatKitchenTicket(
        station([
          { qty: 1, name: "Bread" },
          { qty: 2, name: "Beer", group: 1 },
          { qty: 4, name: "Croquettes", group: 2 },
          { qty: 1, name: "Olives", group: 2 },
        ]),
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "Cocina",
      "Mesa 4",
      "A-17",
      "14:30",
      "1 x Bread",
      "GROUP 1",
      "2 x Beer",
      "GROUP 2",
      "4 x Croquettes",
      "1 x Olives",
      "",
    ]);
  });

  it("prints no group line for a ticket with no group, as before", () => {
    const lines = printedLines(
      formatKitchenTicket(station([{ qty: 1, name: "Chips" }]), KITCHEN_80),
    );
    expect(lines).toEqual(["Cocina", "Mesa 4", "A-17", "14:30", "1 x Chips", ""]);
  });

  it("names a pass copy's one group once under the header, and heads each group within a station otherwise", () => {
    const pass = (
      stations: { stationName: string; items: { qty: number; name: string; group?: number }[] }[],
    ) =>
      printedLines(
        formatKitchenTicket(
          { scope: "order", tableLabel: "Mesa 4", orderNumber: "A-17", firedAt: at, stations },
          KITCHEN_80,
        ),
      );
    expect(
      pass([
        { stationName: "Barra", items: [{ qty: 2, name: "Beer", group: 3 }] },
        { stationName: "Cocina", items: [{ qty: 1, name: "Steak", group: 3 }] },
      ]),
    ).toEqual([
      "PASE",
      "Mesa 4",
      "A-17",
      "14:30",
      "GROUP 3",
      "Barra",
      "2 x Beer",
      "Cocina",
      "1 x Steak",
      "",
    ]);
    expect(
      pass([
        { stationName: "Barra", items: [{ qty: 2, name: "Beer", group: 1 }] },
        {
          stationName: "Cocina",
          items: [
            { qty: 4, name: "Croquettes", group: 2 },
            { qty: 1, name: "Steak", group: 4 },
          ],
        },
      ]),
    ).toEqual([
      "PASE",
      "Mesa 4",
      "A-17",
      "14:30",
      "Barra",
      "GROUP 1",
      "2 x Beer",
      "Cocina",
      "GROUP 2",
      "4 x Croquettes",
      "GROUP 4",
      "1 x Steak",
      "",
    ]);
  });
});

describe("arrangeTicketItems (D14)", () => {
  const burger = { qty: "1.000", name: "Burger", modifiers: ["Cheese"] };

  // Fails if identical entries stop merging, or the quantities are not added.
  it("combined: merges entries that would print identically into one, adding the quantities", () => {
    expect(
      arrangeTicketItems(
        [burger, { ...burger, qty: "2.000" }, { ...burger, note: "no onion" }, { ...burger }],
        "combined",
      ),
    ).toEqual([
      { ...burger, qty: "4.000" },
      { ...burger, note: "no onion" },
    ]);
  });

  // Fails if entries that print differently are merged.
  it("combined: keeps apart entries differing in modifiers, their order, unit, note or group", () => {
    const items = [
      burger,
      { ...burger, modifiers: ["Bacon"] },
      { ...burger, modifiers: ["Cheese", "Bacon"] },
      { ...burger, modifiers: ["Bacon", "Cheese"] },
      { ...burger, unit: "kg", printedAsSold: true },
      { ...burger, note: "rare" },
      { ...burger, group: 2 },
    ];
    expect(arrangeTicketItems(items, "combined")).toEqual(items);
  });

  // Fails if two non-whole quantities are added together, or whole-number ones stop merging.
  it("combined: prints each non-whole quantity on its own, still merging whole-number ones", () => {
    const hake = { qty: "0.350", name: "Hake" };
    expect(arrangeTicketItems([hake, burger, { ...hake }, burger], "combined")).toEqual([
      hake,
      { ...burger, qty: "2.000" },
      hake,
    ]);
  });

  // Fails if the merge compares the note as typed rather than as it prints.
  it("combined: merges entries whose notes print the same once cleaned", () => {
    expect(
      arrangeTicketItems(
        [
          burger,
          { ...burger, note: "" },
          { ...burger, note: "\n\t" },
          { ...burger, note: " rare\n" },
          { ...burger, note: "rare" },
        ],
        "combined",
      ),
    ).toEqual([
      { ...burger, qty: "3.000" },
      { ...burger, note: " rare\n", qty: "2.000" },
    ]);
  });

  // Fails if a whole-number quantity is not split, or a non-whole one is.
  it("separate: splits a whole-number quantity into entries of one, never a non-whole quantity", () => {
    expect(
      arrangeTicketItems(
        [
          { ...burger, qty: "3.000" },
          { ...burger, name: "Hake", qty: "0.350" },
        ],
        "separate",
      ),
    ).toEqual([
      { ...burger, qty: "1.000" },
      { ...burger, qty: "1.000" },
      { ...burger, qty: "1.000" },
      { ...burger, name: "Hake", qty: "0.350" },
    ]);
  });

  // Fails if a `printedAsSold` entry whose quantity happens to be whole is merged or split like a
  // count.
  it("prints an entry printed as sold as it is, under combined and separate alike", () => {
    const hake = { qty: "350.000", unit: "g", name: "Hake", printedAsSold: true };
    expect(arrangeTicketItems([hake, burger, { ...hake }, burger], "combined")).toEqual([
      hake,
      { ...burger, qty: "2.000" },
      hake,
    ]);
    expect(arrangeTicketItems([hake, { ...burger, qty: "2.000" }], "separate")).toEqual([
      hake,
      { ...burger, qty: "1.000" },
      { ...burger, qty: "1.000" },
    ]);
  });

  it("separate: never splits a quantity of one-and-a-half, and leaves separate lines separate", () => {
    const items = [{ ...burger, qty: "1.500" }, burger, burger];
    expect(arrangeTicketItems(items, "separate")).toEqual(items);
  });
});

describe("advance HOLD tickets, FIRE slips and HOLD corrections", () => {
  const at = new Date(2026, 7, 17, 14, 30);
  const station = (items: KitchenTicketItem[]) =>
    ({
      scope: "station",
      stationName: "Cocina",
      tableLabel: "Mesa 4",
      orderNumber: "A-17",
      firedAt: at,
      items,
    }) as const;
  const slip = {
    stationName: "Cocina",
    tableLabel: "Mesa 4",
    orderNumber: "A-17",
    at: at.toISOString(),
  };

  // Fails if a HOLD or FIRE ticket loses its mark, or the mark moves off the first line.
  it.each(["HOLD", "FIRE"] as const)(
    "opens a %s ticket with its mark and prints the rest as the fire ticket would",
    (mark) => {
      const items = [
        { qty: 2, name: "Steak", group: 4 },
        { qty: 1, name: "Fish", group: 4 },
      ];
      const plain = printedLines(formatKitchenTicket(station(items), KITCHEN_80));
      const marked = printedLines(formatKitchenTicket({ ...station(items), mark }, KITCHEN_80));
      expect(marked).toEqual([`*** ${mark} ***`, ...plain]);
      expect(plain[4]).toBe("GROUP 4");
    },
  );

  it("marks the pass copy too", () => {
    const lines = printedLines(
      formatKitchenTicket(
        {
          scope: "order",
          mark: "HOLD",
          tableLabel: "Mesa 4",
          orderNumber: "A-17",
          firedAt: at,
          stations: [{ stationName: "Cocina", items: [{ qty: 1, name: "Fish", group: 4 }] }],
        },
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "*** HOLD ***",
      "PASE",
      "Mesa 4",
      "A-17",
      "14:30",
      "GROUP 4",
      "Cocina",
      "1 x Fish",
      "",
    ]);
  });

  // Fails if a HOLD correction drops its sign or its group, or reads like a plain ticket line.
  it.each([
    ["added", "+1 x Steak"],
    ["removed", "-1 x Steak"],
  ] as const)("prints a HOLD correction for work %s with its sign and group", (direction, row) => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          ...slip,
          kind: "HOLD CHANGED",
          direction,
          item: { qty: 1, name: "Steak", group: 4, modifiers: ["Pepper"], note: "rare" },
        },
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "*** HOLD CHANGED ***",
      "Cocina",
      "Mesa 4",
      "A-17",
      "14:30",
      "GROUP 4",
      row,
      "  + Pepper",
      "  * rare",
      "",
    ]);
  });

  it("prints a HOLD cancellation with its group and no sign", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        { ...slip, kind: "HOLD CANCELLED", item: { qty: 1, name: "Fish", group: 4 } },
        KITCHEN_80,
      ),
    );
    expect(lines).toEqual([
      "*** HOLD CANCELLED ***",
      "Cocina",
      "Mesa 4",
      "A-17",
      "14:30",
      "GROUP 4",
      "1 x Fish",
      "",
    ]);
  });

  // A signed line wraps under the text after its marker, as an unsigned one does.
  it("wraps a signed line under the dish name", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          ...slip,
          kind: "HOLD CHANGED",
          direction: "removed",
          item: { qty: 1, name: "Steak with a very long kitchen name indeed", group: 4 },
        },
        KITCHEN_58,
      ),
    );
    expect(lines.slice(6, 8)).toEqual(["-1 x Steak with a very long", "     kitchen name indeed"]);
  });
});
