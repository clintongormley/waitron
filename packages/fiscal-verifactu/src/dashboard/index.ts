import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";

export const VERIFACTU_DASHBOARD: DashboardContribution = {
  module: "fiscal-verifactu",
  strings: { en: {}, es: {} },
  settingsPanels: [
    {
      id: "aeat-certificate",
      tab: "venue-details",
      order: 1,
      requiresPermission: "system.manage",
      readPermission: "fiscal.view",
      create: () => ({ render: () => html`` }),
    },
  ],
};
