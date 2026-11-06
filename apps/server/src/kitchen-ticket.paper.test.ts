import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { describe, expect, it } from "vitest";
import type { EscSetting } from "@waitron/printing";
import {
  formatCorrectionSlip,
  formatKitchenNoteChangeSlip,
  formatKitchenTicket,
  formatMovedSlip,
} from "./kitchen-ticket.js";
import { printedLines } from "./testing/decode-ticket.js";

const layout: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };
const at = "2026-07-17T23:30:00Z";
const item = { qty: "2.000", name: "Steak" };
const ticket = {
  locale: "en",
  scope: "station" as const,
  stationName: "Grill",
  tableLabel: "Table 4",
  orderNumber: "17",
  firedAt: new Date(at),
  items: [item],
};

describe("A1378 station FIRE and party identity", () => {
  it.each([false, true])("keeps FIRE within its recorded station section (last: %s)", (last) => {
    const cold = {
      stationName: "Cold",
      items: [{ qty: 1, name: "Salad" }],
      ...(last ? {} : { mark: "FIRE" as const }),
    };
    const grill = {
      stationName: "Grill",
      items: [{ qty: 1, name: "Steak" }],
      ...(last ? { mark: "FIRE" as const } : {}),
    };
    const lines = printedLines(
      formatKitchenTicket({ ...ticket, scope: "stations", stations: [cold, grill] }, layout, "UTC"),
    );
    expect(lines[0]).toBe("Cold · Grill");
    expect(lines.slice(4)).toEqual(
      last
        ? ["Cold", "1 x Salad", "Grill", "*** FIRE ***", "1 x Steak", ""]
        : ["Cold", "*** FIRE ***", "1 x Salad", "Grill", "1 x Steak", ""],
    );
  });

  it.each(["en", "es"])("names the party on a %s correction", (locale) => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          locale,
          kind: "VOID",
          stationName: "Grill",
          tableLabel: "Table 4",
          orderNumber: "17",
          at,
          item,
          party: { name: "Ana", locale },
        },
        layout,
        "UTC",
      ),
    );
    expect(lines[3]).toBe(`${kitchenTicketWords(locale).order} 17 · Ana`);
  });
});

describe("kitchen paper in the venue's time zone", () => {
  it.each([
    ["Europe/Madrid", "2026-07-17T23:30:00Z", "01:30"],
    ["Atlantic/Canary", "2026-07-17T23:30:00Z", "00:30"],
    ["Europe/Madrid", "2026-01-17T23:30:00Z", "00:30"],
    ["Atlantic/Canary", "2026-01-17T23:30:00Z", "23:30"],
    ["Europe/Madrid", "2026-10-25T00:30:00Z", "02:30"],
    ["Europe/Madrid", "2026-10-25T01:30:00Z", "02:30"],
  ])("prints %s at %s as %s", (timeZone, instant, expected) => {
    const lines = printedLines(
      formatKitchenTicket({ ...ticket, firedAt: new Date(instant) }, layout, timeZone),
    );
    expect(lines[3]).toBe(expected);
  });

  it("converts the send and reprint instants separately across the summer-time change", () => {
    expect(
      printedLines(
        formatKitchenTicket(
          {
            ...ticket,
            firedAt: new Date("2026-03-29T00:30:00Z"),
            reprintedAt: new Date("2026-03-29T01:40:00Z"),
          },
          layout,
          "Europe/Madrid",
        ),
      ).slice(0, 5),
    ).toEqual(["*** REPRINT 03:40 ***", "Grill", "Table 4", "17", "01:30"]);
  });

  it("dates correction, note-change and MOVED slips in the same venue zone", () => {
    const common = {
      locale: "en",
      stationName: "Grill",
      tableLabel: "Table 4",
      orderNumber: "17",
      at,
    };
    const correction = formatCorrectionSlip(
      { ...common, kind: "VOID", item },
      layout,
      "Atlantic/Canary",
    );
    const note = formatKitchenNoteChangeSlip(
      {
        ...common,
        stations: [{ stationName: "Grill", items: [item] }],
        orderNoteChange: { before: "No salt", after: "Less salt" },
      },
      layout,
      "Atlantic/Canary",
    );
    const moved = formatMovedSlip(
      {
        ...common,
        fromNumber: "17",
        fromText: "Table 4",
        toText: "Table 5",
        items: [item],
        held: [],
      },
      layout,
      "Atlantic/Canary",
    );
    expect(printedLines(correction)[4]).toBe("00:30");
    expect(printedLines(note)[4]).toBe("00:30");
    expect(printedLines(moved)[5]).toBe("00:30");
  });
});

describe("whole quantities on kitchen paper", () => {
  it("wraps a dish's continuation under its shortened quantity prefix", () => {
    expect(
      printedLines(
        formatKitchenTicket(
          { ...ticket, items: [{ qty: "2.000", name: "Roast beef with peppercorn sauce" }] },
          { ...layout, paperWidth: "58mm" },
          "UTC",
        ),
      ).slice(4),
    ).toEqual(["2 x Roast beef with peppercorn", "    sauce", ""]);
  });
  it("shortens whole quantities and keeps fractional amounts and units", () => {
    const lines = printedLines(
      formatKitchenTicket(
        {
          ...ticket,
          items: [
            item,
            { qty: "0.350", unit: "kg", name: "Fish" },
            { qty: "350.000", unit: "g", name: "Chips" },
          ],
          alsoOnOrder: {
            locale: "en",
            items: [
              { qty: "3.000", name: "Water", stationName: "Bar", held: false },
              { qty: "1.250", unit: "l", name: "Juice", stationName: "Bar", held: true },
            ],
          },
        },
        layout,
        "UTC",
      ),
    );
    expect(lines.slice(4)).toEqual([
      "2 x Steak",
      "0.350 kg x Fish",
      "350 g x Chips",
      "-- Also on this order --",
      "3 x Water — Bar",
      "1.250 l x Juice — Bar (on hold)",
      "",
    ]);
  });

  it("uses the shorter quantity in correction, note-change and MOVED slips too", () => {
    const common = {
      locale: "en",
      stationName: "Grill",
      tableLabel: "Table 4",
      orderNumber: "17",
      at,
    };
    const correction = formatCorrectionSlip(
      { ...common, kind: "HOLD CHANGED", direction: "removed", item },
      layout,
      "UTC",
    );
    const note = formatKitchenNoteChangeSlip(
      {
        ...common,
        stations: [{ stationName: "Grill", items: [item] }],
        orderNoteChange: { before: "No salt", after: null },
      },
      layout,
      "UTC",
    );
    const moved = formatMovedSlip(
      {
        ...common,
        fromNumber: "17",
        fromText: "Table 4",
        toText: "Table 5",
        items: [item],
        held: [{ group: 2, items: [item] }],
      },
      layout,
      "UTC",
    );
    expect(printedLines(correction)).toContain("-2 x Steak");
    expect(printedLines(note)).toContain("2 x Steak");
    expect(printedLines(moved).filter((line) => line === "2 x Steak")).toHaveLength(2);
  });
});

describe("the end of a late-send run", () => {
  it("prints no late-run divider on MOVED or note-change slips", () => {
    const items = [
      { qty: 1, name: "Steak", afterPeriod: "Lunch" },
      { qty: 1, name: "Water" },
    ];
    const common = {
      locale: "en",
      stationName: "Grill",
      tableLabel: "Table 4",
      orderNumber: "17",
      at,
    };
    const moved = formatMovedSlip(
      { ...common, fromNumber: "17", fromText: "Table 4", toText: "Table 5", items, held: [] },
      layout,
      "UTC",
    );
    const note = formatKitchenNoteChangeSlip(
      {
        ...common,
        stations: [{ stationName: "Grill", items }],
        orderNoteChange: { before: "No salt", after: null },
      },
      layout,
      "UTC",
    );
    expect(printedLines(moved).slice(-3)).toEqual(["1 x Steak", "1 x Water", ""]);
    expect(printedLines(note).slice(-3)).toEqual(["1 x Steak", "1 x Water", ""]);
  });
  it.each(["58mm", "80mm"] as const)(
    "separates an unmarked dish from the marked run on %s",
    (paperWidth) => {
      const lines = printedLines(
        formatKitchenTicket(
          {
            ...ticket,
            items: [
              { ...item, afterPeriod: "Lunch" },
              { qty: 1, name: "Fish", afterPeriod: "Lunch" },
              { qty: 1, name: "Water" },
            ],
          },
          { ...layout, paperWidth },
          "UTC",
        ),
      );
      expect(lines.slice(4)).toEqual([
        "** AFTER LUNCH — AGREED **",
        "2 x Steak",
        "1 x Fish",
        paperWidth === "58mm"
          ? "------------------------------"
          : "------------------------------------------",
        "1 x Water",
        "",
      ]);
    },
  );

  it("uses the next group or station heading as the boundary", () => {
    const groups = printedLines(
      formatKitchenTicket(
        {
          ...ticket,
          items: [
            { qty: 1, name: "Steak", group: 1, afterPeriod: "Lunch" },
            { qty: 1, name: "Water", group: 2 },
          ],
        },
        layout,
        "UTC",
      ),
    );
    expect(groups.slice(4)).toEqual([
      "GROUP 1",
      "** AFTER LUNCH — AGREED **",
      "1 x Steak",
      "GROUP 2",
      "1 x Water",
      "",
    ]);
    const stations = printedLines(
      formatKitchenTicket(
        {
          ...ticket,
          scope: "stations",
          stations: [
            { stationName: "Grill", items: [{ ...item, afterPeriod: "Lunch" }] },
            { stationName: "Bar", items: [{ qty: 1, name: "Water" }] },
          ],
        },
        layout,
        "UTC",
      ),
    );
    expect(stations.slice(4)).toEqual([
      "Grill",
      "** AFTER LUNCH — AGREED **",
      "2 x Steak",
      "Bar",
      "1 x Water",
      "",
    ]);
  });
});

it("wraps a party note's long bill list without reducing its name to one character per line", () => {
  const lines = printedLines(
    formatKitchenNoteChangeSlip(
      {
        locale: "en",
        stations: [{ stationName: "Grill", items: [item] }],
        tableLabel: "Table 4",
        orderNumber: "10001",
        orderNumbers: ["10001", "10002", "10003", "10004", "10005", "10006"],
        party: { name: "Ana and friends", locale: "en" },
        at,
        orderNoteChange: { before: null, after: "Bring together" },
      },
      { paperWidth: "58mm", resolution: "203dpi" },
      "Europe/Madrid",
    ),
  );
  expect(lines.some((line) => line.includes("Ana and friends"))).toBe(true);
  expect(lines.filter((line) => line.trim().length === 1)).toEqual([]);
});
