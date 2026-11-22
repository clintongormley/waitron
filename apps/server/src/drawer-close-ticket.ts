import { esc, labelAmountLines, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import type { DrawerCloseForPrint } from "./drawer-close-report.js";
import { DRAWER_CLOSE_TICKET_WORDS } from "./i18n/drawer-close-ticket.js";
import { formatMoney } from "./receipt-money.js";

export function formatDrawerCloseTicket(
  close: DrawerCloseForPrint,
  printer: EscSetting,
  locale: SupportedLocale,
  timeZone: string,
): Uint8Array {
  const words = DRAWER_CLOSE_TICKET_WORDS[locale];
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
  const builder = esc(printer);
  const { columns, widthDots } = builder.grid;
  builder.init().printArea(widthDots);
  const text = (value: string) => {
    for (const line of wrapText(prepareText(value), columns)) builder.line(line);
  };

  text(words.heading);
  text(close.drawerName);
  text(`${words.from} ${date.format(new Date(close.from))}`);
  text(`${words.to} ${date.format(new Date(close.finished.at))}`);
  text(`${words.closedBy} ${close.finished.person}`);
  if (close.count.cashMoved) text(words.moved);
  builder.line();
  const afterCount = close.finished.cashAfterCount;
  for (const [label, amount, signed] of [
    [words.cashSales, close.cashSales],
    [words.cashRefunds, close.cashRefunds],
    [words.cashIn, close.cashIn],
    [words.cashOut, close.cashOut],
    [words.expected, close.count.expected],
    [words.counted, close.count.counted],
    [words.difference, close.finished.difference],
    ...(afterCount === "0.00" ? [] : ([[words.afterCount, afterCount, true]] as const)),
    [words.bank, close.finished.bankWithdrawal],
    [words.left, close.finished.amountLeft],
    [words.cards, close.cardPayments],
  ] as const) {
    for (const line of labelAmountLines(
      prepareText(label),
      prepareText((signed && !amount.startsWith("-") ? "+" : "") + formatMoney(amount, locale)),
      columns,
    ))
      builder.line(line);
  }
  return builder.feedAndCut().bytes();
}
