import { esc, type EscSetting } from "@waitron/printing";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";

export function formatOrderNumberSlip(
  input: { orderNumber: number; language: string },
  layout: EscSetting,
): Uint8Array {
  const builder = esc(layout);
  return builder
    .init()
    .printArea(builder.grid.widthDots)
    .align("center")
    .line(kitchenTicketWords(input.language).collectionOrder)
    .line(String(input.orderNumber))
    .feedAndCut()
    .bytes();
}
