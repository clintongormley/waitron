/** The payments area's claims on `payment.` incidents, for the dashboard alerts seat. */
export const PAYMENTS_ALERTS = {
  events: [
    { prefix: "payment.", area: "payments", permission: "hardware.manage" },
    {
      prefix: "payment.reconcile_held",
      area: "payments",
      permission: "hardware.manage",
      screen: "payments",
    },
  ],
} as const;
