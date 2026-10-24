export const TICKET_GROUPINGS = ["combined", "separate"] as const;
export type TicketGrouping = (typeof TICKET_GROUPINGS)[number];

export function isTicketGrouping(value: unknown): value is TicketGrouping {
  return (TICKET_GROUPINGS as readonly unknown[]).includes(value);
}
