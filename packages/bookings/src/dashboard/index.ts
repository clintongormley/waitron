import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";
import { BOOKINGS_STRINGS } from "./strings.js";
import "./bookings-screen.js"; // side-effect: defines <dashboard-bookings-screen>

// Importing `./strings.js` above runs its module-load registerCatalogue + registerCodeMessages, so the
// booking strings and error copy are registered by the time this contribution is mounted.

/** The bookings module's dashboard contribution: the Bookings screen, its nav placement + permission,
 * its strings, and a factory that wires the module context's request to a {@link BookingApi}. */
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
