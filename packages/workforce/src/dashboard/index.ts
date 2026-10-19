import { html } from "lit";
import type { DashboardContribution, DashboardFurtherScreen } from "@waitron/dashboard-kit";
import { WORKFORCE_STRINGS } from "./strings.js";

export { QUERY_DEPENDENCIES as ATTENDANCE_QUERY_DEPENDENCIES } from "./live-queries.js";

export const WORKFORCE_DASHBOARD: DashboardContribution & DashboardFurtherScreen = {
  module: "workforce",
  screen: {
    id: "time-corrections",
    navLabelKey: "nav.time_corrections",
    group: "team",
    requiresPermission: "workforce.correct",
  },
  moreScreens: [
    {
      screen: {
        id: "hours",
        navLabelKey: "nav.hours",
        group: "team",
        requiresPermission: "workforce.correct",
      },
      create(ctx) {
        return {
          render: () =>
            html`<dashboard-attendance-corrections-screen
              .mode=${"hours"}
              .request=${ctx.request}
              .liveData=${ctx.liveData}
            ></dashboard-attendance-corrections-screen>`,
        };
      },
    },
  ],
  strings: WORKFORCE_STRINGS,
  create(ctx) {
    return {
      render: () =>
        html`<dashboard-attendance-corrections-screen
          .request=${ctx.request}
          .liveData=${ctx.liveData}
        ></dashboard-attendance-corrections-screen>`,
    };
  },
};
