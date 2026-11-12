/** Core's claim on its own incident codes, for the dashboard alerts seat: chain integrity, clock
 * trust and unfinished invoice corrections, shown with the tax-filing alerts, and every `backup.`
 * incident, shown with the backup alerts under `system.manage`. Written without the `ModuleAlerts`
 * type, because `@waitron/module` depends on this package. */
export const CORE_ALERTS = {
  events: [
    { prefix: "chain.", area: "fiscal", permission: "fiscal.view" },
    { prefix: "clock.", area: "fiscal", permission: "fiscal.view" },
    { prefix: "invoice_correction.", area: "fiscal", permission: "fiscal.view" },
    { prefix: "backup.", area: "backup", permission: "system.manage", screen: "backup" },
  ],
} as const;
