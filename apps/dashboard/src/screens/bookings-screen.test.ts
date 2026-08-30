import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { bookingStatusName } from "../i18n/domain.js";
import { today } from "../date-utils.js";
import type { Booking, DashboardApi, DashboardTable } from "../api/client.js";
import type { BookingForm } from "../widgets/booking-form.js";
import { BookingsScreen } from "./bookings-screen.js";

const TABLES: DashboardTable[] = [
  { id: "t-1", label: "Mesa 1", zoneId: null, capacity: 4, active: true, createdAt: "2026-01-01" },
  { id: "t-2", label: "Mesa 2", zoneId: null, capacity: 2, active: true, createdAt: "2026-01-01" },
];

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
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
    ...overrides,
  };
}

// Two bookings supplied OUT of time order, so a passing "ordered by time" assertion proves the screen
// orders them rather than trusting insert order.
const BOOKINGS: Booking[] = [
  booking({ id: "bk-late", bookingTime: "20:00:00", contactName: "García" }),
  booking({ id: "bk-early", bookingTime: "13:30:00", contactName: "Pérez", tableId: "t-2" }),
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listTables: vi.fn().mockResolvedValue(TABLES),
    listBookings: vi.fn().mockResolvedValue(BOOKINGS),
    createBooking: vi.fn().mockResolvedValue({ id: "bk-new" }),
    updateBooking: vi.fn().mockResolvedValue(undefined),
    seatBooking: vi.fn().mockResolvedValue({ tabId: "tab-9" }),
    cancelBooking: vi.fn().mockResolvedValue(undefined),
    markNoShow: vi.fn().mockResolvedValue(undefined),
    completeBooking: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: BookingsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const form = (el: BookingsScreen): BookingForm =>
  el.shadowRoot!.querySelector("dashboard-booking-form")!;

function emitFromChild(child: Element, type: string, detail: unknown): void {
  child.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

async function click(el: BookingsScreen, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe("bookings-screen", () => {
  it("loads the tables and today's bookings on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    expect(api.listTables).toHaveBeenCalledTimes(1);
    expect(api.listBookings).toHaveBeenCalledWith(today());
  });

  it("renders the day list ordered by time, each row as time · party · name · status", async () => {
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", {
      api: stubApi(),
    });
    await flush(el);
    const rows = [...el.shadowRoot!.querySelectorAll("[data-test=row]")];
    expect(rows).toHaveLength(2);
    // Ordered by time: 13:30 before 20:00, regardless of the input order.
    expect(rows[0]!.querySelector("[data-test=row-time]")!.textContent!.trim()).toBe("13:30");
    expect(rows[1]!.querySelector("[data-test=row-time]")!.textContent!.trim()).toBe("20:00");
    // Time is HH:MM (sliced from the server's HH:MM:SS), party + name shown.
    expect(rows[0]!.querySelector("[data-test=row-name]")!.textContent).toContain("Pérez");
    expect(rows[0]!.querySelector("[data-test=row-party]")!.textContent).toContain("4");
  });

  it("labels the status through the i18n layer (no hardcoded literal) and defaults to English", async () => {
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", {
      api: stubApi(),
    });
    await flush(el);
    const status = el.shadowRoot!.querySelector("[data-test=row-status]")!;
    // Rendered label matches the domain resolver (so it is not a hardcoded literal)…
    expect(status.textContent!.trim()).toBe(bookingStatusName("booked", "es-ES"));
    // …and the English source of truth is "Booked", never a Spanish default.
    expect(bookingStatusName("booked", "en-GB")).toBe("Booked");
    expect(bookingStatusName("no_show", "en-GB")).toBe("No-show");
    expect(bookingStatusName("cancelled", "en-GB")).toBe("Cancelled");
  });

  it("shows the empty prompt when there are no bookings for the day", async () => {
    const api = stubApi({ listBookings: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-bookings]")).not.toBeNull();
  });

  it("reloads for the newly picked day when the date changes", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    const picker = el.shadowRoot!.querySelector<HTMLElement>("[data-test=booking-date-picker]")!;
    picker.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2026-09-01" } }));
    await flush(el);
    expect(api.listBookings).toHaveBeenLastCalledWith("2026-09-01");
  });

  it("shows a localised error banner when the load fails", async () => {
    const api = stubApi({ listBookings: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });

  it("surfaces a table-load failure even when the bookings load succeeds", async () => {
    // #init loads the tables (form picker + seat prompt) AND the day's bookings. A `listTables` failure
    // must not be hidden by a successful `listBookings` — the picker and the seat prompt are broken, so
    // the banner must show rather than the screen reporting no error.
    const api = stubApi({ listTables: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    const alert = el.shadowRoot!.querySelector("[role=alert]");
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain(codeMessage("server.internal", "es-ES"));
  });

  it("opens the create form and, on create-booking, creates then closes and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "add-booking");
    expect(form(el).open).toBe(true);
    expect(form(el).booking).toBeNull();
    const detail = {
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
      contactPhone: null,
      notes: null,
      tableId: null,
    };
    emitFromChild(form(el), "create-booking", detail);
    await flush(el);
    expect(api.createBooking).toHaveBeenCalledWith(detail);
    expect(form(el).open).toBe(false);
    // listBookings: once on connect + once after the create.
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  // The LOAD-BEARING anti-#52 test at the screen level: fill the real form and submit; the body the
  // API receives must carry a plain local date + time, never a `…Z` instant.
  it("submits plain local date+time, not a UTC instant", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "add-booking");
    const f = form(el);
    const set = async (testId: string, value: string) => {
      f.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value } }),
      );
      await f.updateComplete;
    };
    await set("booking-date", "2026-08-20");
    await set("booking-time", "20:00");
    await set("party-size", "4");
    await set("contact-name", "García");
    f.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await flush(el);
    expect(api.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ bookingDate: "2026-08-20", bookingTime: "20:00" }),
    );
    const arg = (api.createBooking as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(JSON.stringify(arg)).not.toContain("Z");
  });

  it("opens the form pre-filled to edit a booking, then updates", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "edit-bk-early");
    expect(form(el).open).toBe(true);
    expect(form(el).booking!.id).toBe("bk-early");
    emitFromChild(form(el), "update-booking", { id: "bk-early", patch: { partySize: 6 } });
    await flush(el);
    expect(api.updateBooking).toHaveBeenCalledWith("bk-early", { partySize: 6 });
    expect(form(el).open).toBe(false);
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  it("seats a booking that already has a table without prompting", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "seat-bk-early"); // bk-early has tableId t-2
    await flush(el);
    expect(api.seatBooking).toHaveBeenCalledWith("bk-early");
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  it("prompts for a table when seating a booking with none assigned", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "seat-bk-late"); // bk-late has no table → arms the picker, no call yet
    expect(api.seatBooking).not.toHaveBeenCalled();
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=seat-table-bk-late]",
    )!;
    expect(select).not.toBeNull();
    select.value = "t-1";
    select.dispatchEvent(new Event("change"));
    await el.updateComplete;
    await click(el, "confirm-seat-bk-late");
    await flush(el);
    expect(api.seatBooking).toHaveBeenCalledWith("bk-late", { tableId: "t-1" });
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  it("marks a no-show and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "no-show-bk-late");
    await flush(el);
    expect(api.markNoShow).toHaveBeenCalledWith("bk-late");
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  it("cancels a booking and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "cancel-bk-late");
    await flush(el);
    expect(api.cancelBooking).toHaveBeenCalledWith("bk-late");
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  // ── Per-row actions gated on booking.status (design §6) ────────────────────────────────────────────
  const q = (el: BookingsScreen, testId: string): HTMLElement | null =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`);

  it("a booked row shows Seat/Edit/No-show/Cancel and NOT Complete", async () => {
    const api = stubApi({
      listBookings: vi.fn().mockResolvedValue([booking({ id: "bk-b", status: "booked" })]),
    });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    expect(q(el, "seat-bk-b")).not.toBeNull();
    expect(q(el, "edit-bk-b")).not.toBeNull();
    expect(q(el, "no-show-bk-b")).not.toBeNull();
    expect(q(el, "cancel-bk-b")).not.toBeNull();
    expect(q(el, "complete-bk-b")).toBeNull();
  });

  it("a seated row shows only Complete (and clicking it completes) — no Seat/Edit/No-show/Cancel", async () => {
    const api = stubApi({
      listBookings: vi
        .fn()
        .mockResolvedValue([booking({ id: "bk-s", status: "seated", tableId: "t-2" })]),
    });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    expect(q(el, "complete-bk-s")).not.toBeNull();
    expect(q(el, "seat-bk-s")).toBeNull();
    expect(q(el, "edit-bk-s")).toBeNull();
    expect(q(el, "no-show-bk-s")).toBeNull();
    expect(q(el, "cancel-bk-s")).toBeNull();
    await click(el, "complete-bk-s");
    await flush(el);
    expect(api.completeBooking).toHaveBeenCalledWith("bk-s");
    // listBookings: once on connect + once after the complete.
    expect(api.listBookings).toHaveBeenCalledTimes(2);
  });

  it.each(["completed", "no_show", "cancelled"] as const)(
    "a terminal (%s) row shows no action buttons",
    async (status) => {
      const api = stubApi({
        listBookings: vi.fn().mockResolvedValue([booking({ id: "bk-t", status })]),
      });
      const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
      await flush(el);
      expect(el.shadowRoot!.querySelector("[data-test=row]")).not.toBeNull();
      for (const action of ["seat", "edit", "no-show", "cancel", "complete"]) {
        expect(q(el, `${action}-bk-t`)).toBeNull();
      }
    },
  );

  it("shows the error when a seat fails (table busy) and keeps the list", async () => {
    const api = stubApi({ seatBooking: vi.fn().mockRejectedValue({ code: "tab.already_open" }) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "seat-bk-early");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("tab.already_open", "es-ES"),
    );
  });

  it("keeps the form open and shows the error when a create fails", async () => {
    const api = stubApi({ createBooking: vi.fn().mockRejectedValue({ code: "booking.invalid" }) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "add-booking");
    emitFromChild(form(el), "create-booking", {
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
      contactPhone: null,
      notes: null,
      tableId: null,
    });
    await flush(el);
    expect(form(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("booking.invalid", "es-ES"),
    );
  });

  it("keeps the form open and shows the error when an update fails", async () => {
    const api = stubApi({
      updateBooking: vi.fn().mockRejectedValue({ code: "booking.not_found" }),
    });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "edit-bk-early");
    emitFromChild(form(el), "update-booking", { id: "bk-early", patch: { partySize: 6 } });
    await flush(el);
    expect(form(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("booking.not_found", "es-ES"),
    );
  });

  it("shows the error when a lifecycle move fails (no-show)", async () => {
    const api = stubApi({
      markNoShow: vi.fn().mockRejectedValue({ code: "booking.invalid_transition" }),
    });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "no-show-bk-late");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("booking.invalid_transition", "es-ES"),
    );
  });

  it("single-flights the create: a second create while one is in flight is dropped", async () => {
    let resolve!: () => void;
    const createBooking = vi
      .fn()
      .mockImplementation(
        () => new Promise<{ id: string }>((r) => (resolve = () => r({ id: "x" }))),
      );
    const api = stubApi({ createBooking });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "add-booking");
    const detail = {
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
      contactPhone: null,
      notes: null,
      tableId: null,
    };
    emitFromChild(form(el), "create-booking", detail);
    emitFromChild(form(el), "create-booking", detail);
    await el.updateComplete;
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(form(el).busy).toBe(true);
    resolve();
    await flush(el);
    expect(form(el).busy).toBe(false);
  });

  it("surfaces table_required (no API call, no confirm) when a table-less booking has no tables to offer", async () => {
    // A booking with NO assigned table AND no tables loaded cannot pick one, so seating it can only
    // ever fail server-side with `booking.table_required`. The screen refuses to present a
    // guaranteed-to-fail confirm: clicking Seat surfaces the error locally and arms no picker.
    const api = stubApi({ listTables: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", { api });
    await flush(el);
    await click(el, "seat-bk-late"); // no table assigned, and no tables to offer
    await flush(el);
    expect(api.seatBooking).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("[data-test=confirm-seat-bk-late]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("booking.table_required", "es-ES"),
    );
  });

  it("renders exactly one h1 (its own title)", async () => {
    const { el } = await mountWidget<BookingsScreen>("dashboard-bookings-screen", {
      api: stubApi(),
    });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);
  });
});
