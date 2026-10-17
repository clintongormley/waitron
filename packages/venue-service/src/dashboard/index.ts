import { createRef, ref } from "lit/directives/ref.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";
import "./prep-stations-screen.js";
import { VenueServiceApi } from "./client.js";
import { VENUE_SERVICE_STRINGS } from "./strings.js";
import "./venue-operations-screen.js";
import "./service-settings-panel.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
import "./periods-screen.js";

export const VENUE_SERVICE_DASHBOARD: DashboardContribution = {
  module: "venue-service",
  screen: {
    id: "venue-operations",
    navLabelKey: "nav.departments_zones",
    group: "operations",
    order: 10,
    requiresPermission: "venue_service.manage",
  },
  searchDestinations: [
    {
      id: "venue-service:seasons",
      screen: "opening-hours",
      labelKey: "season.seasons",
      path: "/manage/opening-hours/view/year/window/seasons",
    },
    {
      id: "venue-service:year",
      screen: "opening-hours",
      labelKey: "opening.view.year",
      path: "/manage/opening-hours/view/year",
    },
    {
      id: "venue-service:month",
      screen: "opening-hours",
      labelKey: "opening.view.month",
      path: "/manage/opening-hours/view/month",
    },
    {
      id: "venue-service:week",
      screen: "opening-hours",
      labelKey: "opening.view.week",
      path: "/manage/opening-hours/view/week",
    },
    ...(["stations", "routing"] as const).map((view) => ({
      id: `venue-service:prep:${view}`,
      screen: "prep-stations",
      labelKey: `prep.tab.${view}`,
      path: `/manage/prep-stations/view/${view}`,
    })),
  ],
  strings: VENUE_SERVICE_STRINGS,
  create(ctx) {
    const api = new VenueServiceApi(ctx.request, ctx.liveData);
    return {
      render: () =>
        html`<dashboard-venue-operations-screen
          .api=${api}
          .renderPanel=${ctx.renderPanel}
        ></dashboard-venue-operations-screen>`,
    };
  },
  moreScreens: [
    {
      screen: {
        id: "prep-stations",
        navLabelKey: "nav.prep_stations",
        group: "operations",
        order: 12,
        requiresPermission: "venue_service.manage",
      },
      create(ctx) {
        const api = new PrepStationsApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<dashboard-prep-stations-screen .api=${api}></dashboard-prep-stations-screen>`,
        };
      },
    },
    {
      screen: {
        id: "periods",
        navLabelKey: "nav.periods",
        group: "operations",
        order: 20,
        requiresPermission: "venue_service.manage",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-periods-screen
              .api=${api}
              .readOnly=${readOnly}
            ></dashboard-periods-screen>`,
        };
      },
    },
    {
      screen: {
        id: "opening-hours",
        navLabelKey: "nav.calendar",
        group: "operations",
        order: 15,
        requiresPermission: "venue_service.manage",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        const calendar = { ctx, views: ctx.calendarViews ?? [] };
        const screen = createRef<OpeningHoursScreen>();
        return {
          navigationScopes: (destination) => screen.value?.navigationScopes(destination),
          render: (readOnly = false) =>
            html`<dashboard-opening-hours-screen
              ${ref(screen)}
              .api=${api}
              .readOnly=${readOnly}
              .calendar=${calendar}
            ></dashboard-opening-hours-screen>`,
        };
      },
    },
  ],
  settingsPanels: [
    {
      id: "venue-service-kitchen",
      tab: "kitchen",
      order: 10,
      requiresPermission: "venue_service.manage",
      readPermission: "venue.view",
      create(ctx) {
        const api = new VenueServiceApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-venue-service-settings
              subject="kitchen"
              .api=${api}
              .readOnly=${readOnly}
            ></dashboard-venue-service-settings>`,
        };
      },
    },
    {
      id: "venue-service-tables",
      tab: "tables",
      // Above the core Statuses panel, which counts as 0.
      order: -10,
      requiresPermission: "venue_service.manage",
      readPermission: "venue.view",
      create(ctx) {
        const api = new VenueServiceApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-venue-service-settings
              subject="tables"
              .api=${api}
              .readOnly=${readOnly}
            ></dashboard-venue-service-settings>`,
        };
      },
    },
  ],
};
