import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./bookings-screen.js";
import type { BookingsScreen } from "./bookings-screen.js";
import type { Booking, DashboardApi, DashboardTable } from "../api/client.js";

/**
 * The bookings screen scanned by axe in both themes, in its two shapes: with bookings loaded (the date
 * picker + the day list + its per-row actions) and with NONE (the empty prompt). Mounted by ASSIGNING
 * the `api` stub as a property — the screen loads on connect, so the stub must resolve `listTables` and
 * `listBookings` or a stray rejection pollutes the run. The booking form is left CLOSED (its default),
 * so its dialog renders nothing to the a11y tree (scanned in `booking-form.a11y.test.ts`).
 */
const TABLES: DashboardTable[] = [
  { id: "t-1", label: "Mesa 1", zoneId: null, capacity: 4, active: true, createdAt: "2026-01-01" },
];

// One booked row (seat / no-show / cancel / edit actions) and one seated row (the Complete action), so
// axe scans BOTH per-row control shapes the status-gating renders (design §6).
const BOOKINGS: Booking[] = [
  {
    id: "bk-1",
    bookingDate: "2026-08-20",
    bookingTime: "20:00:00",
    partySize: 4,
    contactName: "García",
    contactPhone: null,
    notes: null,
    tableId: null,
    tabId: null,
    status: "booked",
    createdBy: "p1",
    createdAt: "2026-08-19T10:00:00.000Z",
  },
  {
    id: "bk-2",
    bookingDate: "2026-08-20",
    bookingTime: "21:00:00",
    partySize: 2,
    contactName: "Pérez",
    contactPhone: null,
    notes: null,
    tableId: "t-1",
    tabId: "tab-1",
    status: "seated",
    createdBy: "p1",
    createdAt: "2026-08-19T10:00:00.000Z",
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listTables: vi.fn().mockResolvedValue(TABLES),
    listBookings: vi.fn().mockResolvedValue(BOOKINGS),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: BookingsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("bookings-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with bookings loaded", async () => {
    const { el, host } = await mountWidget<BookingsScreen>(
      "dashboard-bookings-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when no bookings exist for the day", async () => {
    const api = stubApi({ listBookings: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<BookingsScreen>(
      "dashboard-bookings-screen",
      { api },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
