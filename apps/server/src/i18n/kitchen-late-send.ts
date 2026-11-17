import type { KitchenLanguage } from "./kitchen-ticket.js";

export const KITCHEN_LATE_SEND_WORDS = {
  en: { mark: "After {period} — agreed", unaskedMark: "After {period}" },
  es: { mark: "Tras {period} — aceptado", unaskedMark: "Tras {period}" },
} as const satisfies Record<KitchenLanguage, { mark: string; unaskedMark: string }>;
