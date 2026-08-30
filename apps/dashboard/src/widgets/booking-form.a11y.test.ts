import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./booking-form.js";
import type { BookingForm } from "./booking-form.js";
import type { Booking, DashboardTable } from "../api/client.js";

/**
 * The booking dialog only exposes anything to the accessibility tree once it is OPEN — a closed
 * <dialog> renders nothing — so it is mounted with `open = true` and its wt-dialog's first render
 * (which calls showModal) is settled before axe runs, in both themes. axe is run against the themed host
 * so a color-contrast check means what it means in the app.
 *
 * Two shapes are scanned: a CREATE (blank, seeded date, the table picker) and an EDIT pre-filled from a
 * booking with a table assigned — so axe sees the date/time/party/contact inputs and the table select in
 * both states.
 */
afterEach(cleanupWidgets);

const TABLES: DashboardTable[] = [
  { id: "t-1", label: "Mesa 1", zoneId: null, capacity: 4, active: true, createdAt: "2026-01-01" },
  { id: "t-2", label: "Mesa 2", zoneId: null, capacity: 2, active: true, createdAt: "2026-01-01" },
];

const EDIT_BOOKING: Booking = {
  id: "bk-1",
  bookingDate: "2026-08-20",
  bookingTime: "20:00:00",
  partySize: 4,
  contactName: "García",
  contactPhone: "600100200",
  notes: "Ventana",
  tableId: "t-2",
  tabId: null,
  status: "booked",
  createdBy: "p1",
  createdAt: "2026-08-19T10:00:00.000Z",
};

async function settle(el: BookingForm): Promise<void> {
  const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

describe.each(["light", "dark"] as const)("booking-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open for a create", async () => {
    const { el, host } = await mountWidget<BookingForm>(
      "dashboard-booking-form",
      { open: true, tables: TABLES, defaultDate: "2026-08-20" },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when open for an edit", async () => {
    const { el, host } = await mountWidget<BookingForm>(
      "dashboard-booking-form",
      { open: true, tables: TABLES, defaultDate: "2026-08-20", booking: EDIT_BOOKING },
      theme,
    );
    await settle(el);
    await expectNoA11yViolations(host);
  });
});
