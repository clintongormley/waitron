import { describe, expect, it } from "vitest";
import { formatOrderNumberSlip } from "./order-number-slip.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import {
  printedLines,
  printedCommands,
  commandNames,
  opensDrawer,
} from "./testing/decode-ticket.js";

describe("A964 collection language", () => {
  it.each(["en", "es"] as const)(
    "prints a centered two-line %s slip at each supported layout",
    (language) => {
      for (const [paperWidth, resolution, width] of [
        ["58mm", "180dpi", 360],
        ["58mm", "203dpi", 384],
        ["80mm", "180dpi", 512],
        ["80mm", "203dpi", 576],
      ] as const) {
        const bytes = formatOrderNumberSlip(
          { orderNumber: 281, language },
          { paperWidth, resolution },
        );
        expect(printedLines(bytes).map((l) => l.trim())).toEqual([
          kitchenTicketWords(language).collectionOrder,
          "281",
          "",
        ]);
        const commands = printedCommands(bytes);
        const names = commandNames(bytes);
        expect(names.indexOf("GS L")).toBeLessThan(names.indexOf("ESC a"));
        expect(names.indexOf("GS W")).toBeLessThan(names.indexOf("ESC a"));
        const area = commands.find((c) => c.name === "GS W")!.bytes;
        expect(area[2]! + 256 * area[3]!).toBe(width);
        expect(names.filter((n) => n === "GS V")).toHaveLength(1);
        expect(opensDrawer(bytes)).toBe(false);
      }
    },
  );
});
