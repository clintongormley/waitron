import { describe, expect, it } from "vitest";
import type { EscSetting } from "@waitron/printing";
import { formatCorrectionSlip, formatKitchenTicket, formatMovedSlip } from "./kitchen-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";

describe.each([
  { paperWidth: "58mm", resolution: "203dpi" },
  { paperWidth: "80mm", resolution: "203dpi" },
] satisfies EscSetting[])("whole-order kitchen instructions on $paperWidth paper", (layout) => {
  const item = { qty: 1, name: "Burger", note: "No onions" };
  const head = {
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
        { reprint: true },
      ]) {
        for (const body of [
          { scope: "station" as const, stationName: "Grill", items: [item] },
          {
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
      changed: "*** CHANGED ***",
      current: "For the kitchen: New time",
      before: "Was: Old time",
      removed: "Note for the kitchen removed",
    },
    {
      locale: "es-ES",
      changed: "*** CAMBIADO ***",
      current: "Para cocina: New time",
      before: "Antes: Old time",
      removed: "Nota para cocina eliminada",
    },
  ])(
    "prints a $locale note edit or removal separately from the dish note",
    ({ locale, changed, current, before, removed }) => {
      for (const after of ["New time", null]) {
        const lines = printedLines(
          formatCorrectionSlip(
            {
              kind: "ORDER NOTE CHANGED",
              stationName: "Grill",
              tableLabel: "Table 2",
              orderNumber: "17",
              at: head.firedAt.toISOString(),
              item,
              locale,
              orderNoteChange: { before: "Old time", after },
            },
            layout,
          ),
        );
        expect(lines).toContain(changed);
        expect(lines).toContain(after === null ? removed : current);
        expect(lines).toContain(before);
        expect(lines).toContain("  * No onions");
      }
    },
  );
});
