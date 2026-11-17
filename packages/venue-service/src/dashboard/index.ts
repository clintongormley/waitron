import { createRef, ref } from "lit/directives/ref.js";
import type { VenueOperationsScreen } from "./venue-operations-screen.js";
import { html } from "lit";
import type { DashboardContribution, DashboardFurtherScreen } from "@waitron/dashboard-kit";
import { PrepStationsApi } from "./routing-client.js";
import "./prep-stations-screen.js";
import { zoneSettingSearchDestinations } from "./zone-setting-search.js";
import { departmentSettingSearchDestinations } from "./department-setting-search.js";
import { VenueServiceApi } from "./client.js";
import { VENUE_SERVICE_STRINGS } from "./strings.js";
import "./venue-operations-screen.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
import "./periods-list.js";
import "./seasons-screen.js";
import "./floor-plans-screen.js";

export const VENUE_SERVICE_DASHBOARD: DashboardContribution & DashboardFurtherScreen = {
  module: "venue-service",
  screen: {
    id: "venue-operations",
    navLabelKey: "nav.departments_zones",
    group: "operations",
    order: 10,
    requiresPermission: "venue.configure",
  },
  searchDestinations: [
    ...departmentSettingSearchDestinations,
    ...zoneSettingSearchDestinations,
    {
      id: "venue-service:year",
      screen: "opening-hours",
      labelKey: "opening.view.year",
      path: "/opening-hours/view/year",
    },
    {
      id: "venue-service:month",
      screen: "opening-hours",
      labelKey: "opening.view.month",
      path: "/opening-hours/view/month",
    },
    {
      id: "venue-service:week",
      screen: "opening-hours",
      labelKey: "opening.view.week",
      path: "/opening-hours/view/week",
    },
    ...(["stations", "routing"] as const).map((view) => ({
      id: `venue-service:prep:${view}`,
      screen: "prep-stations",
      labelKey: `prep.tab.${view}`,
      path: `/prep-stations/view/${view}`,
    })),
  ],
  strings: VENUE_SERVICE_STRINGS,
  create(ctx) {
    const api = new VenueServiceApi(ctx.request, ctx.liveData);
    const screen = createRef<VenueOperationsScreen>();
    return {
      navigationScopes: (destination) => screen.value?.navigationScopes(destination),
      render: () =>
        html`<dashboard-venue-operations-screen
          ${ref(screen)}
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
        requiresPermission: "venue.configure",
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
        id: "floor-plans",
        navLabelKey: "nav.floor_plans",
        group: "operations",
        order: 13,
        requiresPermission: "venue.configure",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new VenueServiceApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-floor-plans-screen
              .api=${api}
              .readOnly=${readOnly}
            ></dashboard-floor-plans-screen>`,
        };
      },
    },
    {
      screen: {
        id: "opening-hours",
        navLabelKey: "nav.calendar",
        group: "operations",
        order: 15,
        requiresPermission: "venue.configure",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        const calendar = { ctx, views: ctx.calendarViews ?? [] };
        return {
          render: (readOnly = false) =>
            html`<dashboard-opening-hours-screen
              .api=${api}
              .readOnly=${readOnly}
              .calendar=${calendar}
            ></dashboard-opening-hours-screen>`,
        };
      },
    },
    {
      screen: {
        id: "seasons",
        navLabelKey: "season.seasons",
        group: "operations",
        order: 16,
        requiresPermission: "venue.configure",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-seasons-screen
              .api=${api}
              .readOnly=${readOnly}
            ></dashboard-seasons-screen>`,
        };
      },
    },
    {
      screen: {
        id: "periods",
        navLabelKey: "period.title",
        group: "operations",
        order: 17,
        requiresPermission: "venue.configure",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<periods-list .api=${api} .readOnly=${readOnly}></periods-list>`,
        };
      },
    },
  ],
};
