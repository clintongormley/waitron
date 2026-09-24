import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";
import { BOOKINGS_STRINGS } from "./strings.js";
import "./bookings-screen.js";

export const BOOKINGS_DASHBOARD: DashboardContribution = {
  module: "bookings",
  screen: {
    id: "bookings",
    navLabelKey: "nav.bookings",
    group: "service",
    requiresPermission: "booking.manage",
  },
  strings: BOOKINGS_STRINGS,
  create(ctx) {
    const api = new BookingApi(ctx.request, ctx.liveData);
    return {
      render: () => html`<dashboard-bookings-screen .api=${api}></dashboard-bookings-screen>`,
    };
  },
};
