import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { VENUE_SERVICE_STRINGS } from "./strings.js";
import "./venue-operations-screen.js";

export const VENUE_SERVICE_DASHBOARD: DashboardContribution = {
  module: "venue-service",
  screen: {
    id: "venue-operations",
    navLabelKey: "nav.venue_operations",
    group: "service",
    requiresPermission: "venue_service.manage",
  },
  strings: VENUE_SERVICE_STRINGS,
  create(ctx) {
    const api = new VenueServiceApi(ctx.request, ctx.liveData);
    return {
      render: () =>
        html`<dashboard-venue-operations-screen .api=${api}></dashboard-venue-operations-screen>`,
    };
  },
};
