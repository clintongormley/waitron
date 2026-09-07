import { html } from "lit";
import { registerCodeMessages, type DashboardContribution } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";
import { BOOKINGS_STRINGS, BOOKINGS_CODE_MESSAGES } from "./strings.js";
import "./bookings-screen.js"; // side-effect: defines <dashboard-bookings-screen>

// Register the booking error copy at load. strings.ts also registers it (so importing the module's `t`
// alone resolves the codes), but the app mounts a contribution by its declared surface, so this keeps
// the registration on the contribution's own entry point too — idempotent.
registerCodeMessages(BOOKINGS_CODE_MESSAGES);

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
    const api = new BookingApi(ctx.request);
    return {
      render: () => html`<dashboard-bookings-screen .api=${api}></dashboard-bookings-screen>`,
    };
  },
};
