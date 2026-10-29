import { esc, type EscSetting } from "@waitron/printing";
import { KITCHEN_TICKET_WORDS, type KitchenLanguage } from "./i18n/kitchen-ticket.js";

export function formatOrderNumberSlip(
  input: { orderNumber: number; language: KitchenLanguage },
  layout: EscSetting,
): Uint8Array {
  const builder = esc(layout);
  return builder
    .init()
    .printArea(builder.grid.widthDots)
    .align("center")
    .line(KITCHEN_TICKET_WORDS[input.language].collectionOrder)
    .line(String(input.orderNumber))
    .feedAndCut()
    .bytes();
}
