import { expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { DrawerCloseForPrint } from "./drawer-close-report.js";
import { formatDrawerCloseTicket } from "./drawer-close-ticket.js";
import { DRAWER_CLOSE_TICKET_WORDS } from "./i18n/drawer-close-ticket.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";

const close: DrawerCloseForPrint = {
  drawerName: "Bar drawer",
  from: "2026-11-19T17:02:00Z",
  finished: {
    id: "closed",
    person: "Robin",
    at: "2026-11-20T19:04:00Z",
    bankWithdrawal: decimal("500.50"),
    amountLeft: decimal("150.00"),
    difference: decimal("-0.50"),
    cashAfterCount: decimal("0.00"),
  },
  count: {
    person: "Alex",
    at: "2026-11-20T19:00:00Z",
    cashMoved: true,
    counted: decimal("650.50"),
    expected: decimal("651.00"),
    difference: decimal("-0.50"),
  },
  cashSales: decimal("532.50"),
  cashRefunds: decimal("-12.00"),
  cashIn: decimal("50.00"),
  cashOut: decimal("-20.00"),
  cardPayments: decimal("1310.00"),
};

it("prints the stored amounts and identifies that card payments are before refunds", () => {
  const ticket = formatDrawerCloseTicket(
    close,
    { paperWidth: "80mm", resolution: "203dpi" },
    "en-GB",
    "Europe/Madrid",
  );
  expect(
    printedLines(ticket)
      .map((line) => line.trim().replace(/ +/g, " "))
      .filter(Boolean),
  ).toEqual([
    "Drawer close",
    "Bar drawer",
    "From 19/11/2026, 18:02",
    "To 20/11/2026, 20:04",
    "Closed by Robin",
    "Cash moved while counting.",
    "Cash sales €532.50",
    "Cash refunds -€12.00",
    "Cash in €50.00",
    "Cash out -€20.00",
    "Expected in drawer €651.00",
    "Counted €650.50",
    "Difference -€0.50",
    "For the bank €500.50",
    "Cash left €150.00",
    "Card payments taken, before refunds",
    "€1,310.00",
  ]);
});

it("wraps the Spanish labels to the selected 58 mm print area", () => {
  const ticket = formatDrawerCloseTicket(
    { ...close, count: { ...close.count, cashMoved: false } },
    { paperWidth: "58mm", resolution: "180dpi" },
    "es-ES",
    "Europe/Madrid",
  );
  const commands = printedCommands(ticket);
  expect([...commands.find(({ name }) => name === "GS W")!.bytes]).toEqual([29, 87, 104, 1]);
  expect([...new Set(commands.flatMap(({ widthDots }) => widthDots ?? []))]).toEqual([360]);
  const text = printedLines(ticket).join(" ").replace(/ +/g, " ");
  expect(text).toContain(`${DRAWER_CLOSE_TICKET_WORDS["es-ES"].cards} 1310,00 €`);
  expect(text).not.toContain("Hubo movimientos");
});
