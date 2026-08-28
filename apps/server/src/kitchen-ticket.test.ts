import { describe, expect, it } from "vitest";

import { formatKitchenTicket } from "./kitchen-ticket.js";
import { decodeTicket } from "./testing/decode-ticket.js";

// The formatter is a PURE byte producer (design §3c) — no DB, no container — so these are ordinary
// unit tests. We decode the ESC/POS payload back to its Latin-1 text (the encoding escpos.ts uses,
// pinned in escpos.test.ts) to assert the human-readable content, and check the raw cut bytes at the
// tail. GS V 0 (full cut) is 0x1D 0x56 0x00 (escpos.ts / escpos.test.ts); feed precedes it, so the
// final three bytes are always the cut.
const CUT_BYTES = [0x1d, 0x56, 0x00];

describe("formatKitchenTicket", () => {
  describe("station scope", () => {
    it("prints the station name, table/order/time, each qty x name line, and ends in a cut", () => {
      const bytes = formatKitchenTicket({
        scope: "station",
        stationName: "Cocina",
        tableLabel: "Mesa 4",
        orderNumber: "A-17",
        firedAt: new Date(2026, 7, 17, 14, 30),
        items: [
          { qty: 2, name: "Steak" },
          { qty: 1, name: "Chips" },
        ],
      });

      const text = decodeTicket(bytes);
      expect(text).toContain("Cocina");
      expect(text).toContain("Mesa 4");
      expect(text).toContain("A-17");
      expect(text).toContain("14:30");
      expect(text).toContain("2 x Steak");
      expect(text).toContain("1 x Chips");

      // Ends with the full-cut command.
      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });

    it("zero-pads a single-digit hour and minute to local HH:MM", () => {
      const text = decodeTicket(
        formatKitchenTicket({
          scope: "station",
          stationName: "Cocina",
          tableLabel: "Mesa 1",
          orderNumber: "A-1",
          firedAt: new Date(2026, 7, 17, 9, 5),
          items: [{ qty: 1, name: "Cafe" }],
        }),
      );
      expect(text).toContain("09:05");
    });

    it("does not crash on a zero-item station ticket, and still ends in a cut", () => {
      const bytes = formatKitchenTicket({
        scope: "station",
        stationName: "Cocina",
        tableLabel: "Mesa 4",
        orderNumber: "A-17",
        firedAt: new Date(2026, 7, 17, 14, 30),
        items: [],
      });
      expect(decodeTicket(bytes)).toContain("Cocina");
      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });
  });

  describe("order scope", () => {
    it("prints a pass header, table/order/time, and groups items under each station sub-header in order", () => {
      const bytes = formatKitchenTicket({
        scope: "order",
        tableLabel: "Mesa 4",
        orderNumber: "A-17",
        firedAt: new Date(2026, 7, 17, 14, 30),
        stations: [
          { stationName: "Cocina", items: [{ qty: 2, name: "Steak" }] },
          { stationName: "Parrilla", items: [{ qty: 1, name: "Chips" }] },
        ],
      });

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
      const bytes = formatKitchenTicket({
        scope: "order",
        tableLabel: "Mesa 4",
        orderNumber: "A-17",
        firedAt: new Date(2026, 7, 17, 14, 30),
        stations: [],
      });
      expect(decodeTicket(bytes)).toContain("PASE");
      expect([...bytes.slice(-CUT_BYTES.length)]).toEqual(CUT_BYTES);
    });
  });
});
