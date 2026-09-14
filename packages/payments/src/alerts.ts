/** The payments area's claim on `payment.` incidents, for the dashboard alerts seat. */
export const PAYMENTS_ALERTS = {
  events: [{ prefix: "payment.", area: "payments", permission: "payments.manage" }],
} as const;
