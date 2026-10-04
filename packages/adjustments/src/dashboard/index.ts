import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { AdjustmentsApi } from "./client.js";
import { ADJUSTMENTS_STRINGS } from "./strings.js";
import "./reasons-screen.js";
import "./adjustment-report-screen.js";

export const ADJUSTMENTS_DASHBOARD: DashboardContribution = {
  module: "adjustments",
  screen: {
    id: "adjustment-report",
    navLabelKey: "nav.adjustment_report",
    group: "reports",
    requiresPermission: "report.view",
  },
  strings: ADJUSTMENTS_STRINGS,
  create(ctx) {
    const api = new AdjustmentsApi(ctx.request, ctx.liveData);
    return {
      render: () =>
        html`<dashboard-adjustment-report-screen .api=${api}></dashboard-adjustment-report-screen>`,
    };
  },
  settingsPanels: [
    {
      id: "adjustment-reasons",
      tab: "adjustment-reasons",
      requiresPermission: "adjustment.manage",
      create(ctx) {
        const api = new AdjustmentsApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<dashboard-adjustment-reasons-screen
              .api=${api}
            ></dashboard-adjustment-reasons-screen>`,
        };
      },
    },
  ],
};
