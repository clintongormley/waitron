import { describe, expect, it } from "vitest";
import type { EscSetting } from "@waitron/printing";
import {
  formatCorrectionSlip,
  formatKitchenNoteChangeSlip,
  formatKitchenTicket,
  formatMovedSlip,
} from "./kitchen-ticket.js";
import type { KitchenTicketStation } from "./kitchen-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";

describe.each([
  { paperWidth: "58mm", resolution: "203dpi" },
  { paperWidth: "80mm", resolution: "203dpi" },
] satisfies EscSetting[])("whole-order kitchen instructions on $paperWidth paper", (layout) => {
  const item = { qty: 1, name: "Burger", note: "No onions" };
  const head = {
    locale: "en-GB",
    tableLabel: "Table 2",
    orderNumber: "17",
    firedAt: new Date("2026-10-16T10:00:00Z"),
  };

  it.each([
    { locale: "en-GB", heading: "For the kitchen: Train 14:30" },
    { locale: "es-ES", heading: "Para cocina: Train 14:30" },
  ])(
    "prints the $locale heading above dishes on station, combined, HOLD, FIRE and reprint tickets",
    ({ locale, heading }) => {
      for (const flags of [
        {},
        { mark: "HOLD" as const },
        { mark: "FIRE" as const },
        { reprintedAt: new Date(2026, 7, 17, 15, 20) },
      ]) {
        for (const body of [
          { locale: "en-GB", scope: "station" as const, stationName: "Grill", items: [item] },
          {
            locale: "en-GB",
            scope: "stations" as const,
            stations: [
              { stationName: "Grill", items: [item] },
              { stationName: "Bar", items: [{ qty: 1, name: "Coffee" }] },
            ],
          },
        ]) {
          const lines = printedLines(
            formatKitchenTicket(
              { ...head, ...body, ...flags, kitchenNote: { text: "Train 14:30", locale } },
              layout,
            ),
          );
          expect(lines).toContain(heading);
          expect(lines.indexOf(heading)).toBeLessThan(lines.indexOf("1 x Burger"));
          expect(lines).toContain("  * No onions");
        }
      }
    },
  );

  it("removes control commands from the whole-order heading without losing its text", () => {
    const lines = printedLines(
      formatKitchenTicket(
        {
          ...head,
          scope: "station",
          stationName: "Grill",
          items: [item],
          kitchenNote: { text: "  Train\u001b\u001d\r\n\u008514:30  ", locale: "en-GB" },
        },
        layout,
      ),
    );
    expect(lines).toContain("For the kitchen: Train 14:30");
    expect(lines).toContain("1 x Burger");
  });

  it("prints the effective heading on MOVED and ordinary correction slips", () => {
    const kitchenNote = { text: "Train 14:30", locale: "en-GB" };
    const moved = printedLines(
      formatMovedSlip(
        {
          stationName: "Grill",
          fromNumber: "17",
          fromText: "Table 1",
          toText: "Table 2",
          at: head.firedAt.toISOString(),
          items: [item],
          held: [],
          locale: "en-GB",
          kitchenNote,
        },
        layout,
      ),
    );
    const corrected = printedLines(
      formatCorrectionSlip(
        {
          locale: "en-GB",
          kind: "VOID",
          stationName: "Grill",
          tableLabel: "Table 2",
          orderNumber: "17",
          at: head.firedAt.toISOString(),
          item,
          kitchenNote,
        },
        layout,
      ),
    );
    for (const lines of [moved, corrected]) {
      expect(lines).toContain("For the kitchen: Train 14:30");
      expect(lines.indexOf("For the kitchen: Train 14:30")).toBeLessThan(
        lines.indexOf("1 x Burger"),
      );
    }
  });

  it.each([
    {
      locale: "en-GB",
      changed: "KITCHEN NOTE CHANGED",
      removedHeading: "KITCHEN NOTE REMOVED",
      current: "For the kitchen: New time",
      before: "Was: Old time",
      removed: "Note for the kitchen removed",
    },
    {
      locale: "es-ES",
      changed: "NOTA PARA COCINA CAMBIADA",
      removedHeading: "NOTA PARA COCINA ELIMINADA",
      current: "Para cocina: New time",
      before: "Antes: Old time",
      removed: "Nota para cocina eliminada",
    },
  ])(
    "prints a $locale note edit or removal separately from the dish note",
    ({ locale, changed, removedHeading, current, before, removed }) => {
      for (const after of ["New time", null]) {
        const lines = printedLines(
          formatKitchenNoteChangeSlip(
            {
              locale,
              stations: [{ stationName: "Grill", items: [item] }],
              tableLabel: "Table 2",
              orderNumber: "17",
              at: head.firedAt.toISOString(),
              orderNoteChange: { before: "Old time", after },
            },
            layout,
          ),
        );
        expect(lines.slice(0, 2).join(" ")).toContain(after === null ? removedHeading : changed);
        expect(lines).toContain(after === null ? removed : current);
        expect(lines).toContain(before);
        expect(lines).toContain("  * No onions");
      }
    },
  );

  describe("A807 the slip for a kitchen-note change", () => {
    const sentAt = new Date(2026, 9, 16, 10, 0).toISOString();
    const slip = (
      stations: KitchenTicketStation[],
      locale = "en-GB",
      after: string | null = "New time",
    ) =>
      printedLines(
        formatKitchenNoteChangeSlip(
          {
            locale,
            stations,
            tableLabel: "Table 2",
            orderNumber: "17",
            at: sentAt,
            orderNoteChange: { before: "Old time", after },
          },
          layout,
        ),
      );
    const narrow = layout.paperWidth === "58mm";
    const singleDish = [
      {
        locale: "en-GB",
        after: "New time",
        head: ["*** KITCHEN NOTE CHANGED ***"],
        body: ["For the kitchen: New time", "Was: Old time"],
      },
      {
        locale: "en-GB",
        after: null,
        head: ["*** KITCHEN NOTE REMOVED ***"],
        body: ["Note for the kitchen removed", "Was: Old time"],
      },
      {
        locale: "es-ES",
        after: "New time",
        head: narrow
          ? ["*** NOTA PARA COCINA CAMBIADA", "***"]
          : ["*** NOTA PARA COCINA CAMBIADA ***"],
        body: ["Para cocina: New time", "Antes: Old time"],
      },
      {
        locale: "es-ES",
        after: null,
        head: narrow
          ? ["*** NOTA PARA COCINA ELIMINADA", "***"]
          : ["*** NOTA PARA COCINA ELIMINADA ***"],
        body: ["Nota para cocina eliminada", "Antes: Old time"],
      },
    ];

    it.each(singleDish)(
      "prints one station's single dish in the same lines as the single-dish slip ($locale, after $after)",
      ({ locale, after, head, body }) => {
        const top = [...head, "Grill", "Table 2", "17", "10:00", ...body];
        expect(
          slip(
            [{ stationName: "Grill", items: [{ qty: 2, name: "Burger", note: "No onions" }] }],
            locale,
            after,
          ),
        ).toEqual([...top, "2 x Burger", "  * No onions", ""]);
        expect(
          slip(
            [
              {
                stationName: "Grill",
                items: [{ qty: 2, name: "Burger", note: "No onions", group: 3 }],
              },
            ],
            locale,
            after,
          ),
        ).toEqual([...top, "GROUP 3", "2 x Burger", "  * No onions", ""]);
      },
    );

    it("lists two stations' dishes under each station's name", () => {
      const lines = slip([
        { stationName: "Grill", items: [{ qty: 2, name: "Burger", note: "No onions" }] },
        { stationName: "Pastry", items: [{ qty: 1, name: "Flan" }] },
      ]);
      expect(lines[1]).toBe("Grill · Pastry");
      expect(lines.slice(lines.indexOf("Was: Old time"))).toEqual([
        "Was: Old time",
        "Grill",
        "2 x Burger",
        "  * No onions",
        "Pastry",
        "1 x Flan",
        "",
      ]);
    });

    it("names a shared group once, and heads a second group", () => {
      const shared = slip([
        {
          stationName: "Grill",
          items: [
            { qty: 1, name: "Burger", group: 1 },
            { qty: 1, name: "Flan", group: 1 },
          ],
        },
      ]);
      expect(shared.slice(shared.indexOf("Was: Old time"))).toEqual([
        "Was: Old time",
        "GROUP 1",
        "1 x Burger",
        "1 x Flan",
        "",
      ]);
      const two = slip([
        {
          stationName: "Grill",
          items: [
            { qty: 1, name: "Burger", group: 1 },
            { qty: 1, name: "Flan", group: 2 },
          ],
        },
      ]);
      expect(two.slice(two.indexOf("Was: Old time"))).toEqual([
        "Was: Old time",
        "GROUP 1",
        "1 x Burger",
        "GROUP 2",
        "1 x Flan",
        "",
      ]);
    });
  });
});
