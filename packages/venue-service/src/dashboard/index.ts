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

export const VENUE_SERVICE_DASHBOARD: DashboardContribution = {
  module: "venue-service",
  screen: {
    id: "venue-operations",
    navLabelKey: "nav.departments_zones",
    group: "operations",
    order: 10,
    requiresPermission: "venue_service.manage",
  },
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
        order: 30,
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
        id: "opening-hours",
        navLabelKey: "nav.opening_hours",
        group: "operations",
        order: 15,
        requiresPermission: "venue_service.manage",
        readPermission: "venue.view",
      },
      create(ctx) {
        const api = new OpeningHoursApi(ctx.request, ctx.liveData);
        return {
          render: (readOnly = false) =>
            html`<dashboard-opening-hours-screen
              .api=${api}
              .readOnly=${readOnly}
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
