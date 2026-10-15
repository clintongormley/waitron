import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { StaffingApi } from "./client.js";
import { STAFFING_STRINGS } from "./strings.js";
import "./staff-roles-screen.js";
import "./staffing-month.js";

export const STAFFING_DASHBOARD: DashboardContribution = {
  module: "staffing",
  screen: {
    id: "staff-roles",
    navLabelKey: "nav.staff_roles",
    group: "team",
    requiresPermission: "staffing.manage",
    readPermission: "venue.view",
  },
  strings: STAFFING_STRINGS,
  calendarViews: [
    {
      id: "staffing",
      labelKey: "staffing.view.tab",
      order: 10,
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
      create(ctx, host) {
        const api = new StaffingApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<staffing-month
              .api=${api}
              .month=${host.month}
              .params=${host.params}
              .canWrite=${host.canWrite}
              .open=${host.open}
            ></staffing-month>`,
        };
      },
    },
  ],
  create(ctx) {
    const api = new StaffingApi(ctx.request, ctx.liveData);
    return {
      render: (readOnly = false) =>
        html`<dashboard-staff-roles-screen
          .api=${api}
          .readOnly=${readOnly}
        ></dashboard-staff-roles-screen>`,
    };
  },
};
