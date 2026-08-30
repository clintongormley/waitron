import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { BookingForm } from "./booking-form.js";
import type { Booking, BookingInput, DashboardTable } from "../api/client.js";

afterEach(cleanupWidgets);

const TABLES: DashboardTable[] = [
  { id: "t-1", label: "Mesa 1", zoneId: null, capacity: 4, active: true, createdAt: "2026-01-01" },
  { id: "t-2", label: "Mesa 2", zoneId: null, capacity: 2, active: true, createdAt: "2026-01-01" },
];

/** Base props: an open create form seeded to a known day, with the tables loaded for the picker. */
function baseProps(overrides: Partial<BookingForm> = {}): Partial<BookingForm> {
  return { open: true, tables: TABLES, defaultDate: "2026-08-20", ...overrides };
}

/** Type into a wt-input by its data-test, via the composed `wt-change` it dispatches. */
async function setInput(el: BookingForm, testId: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
  await el.updateComplete;
}

/** Pick a native <select>'s option by its data-test. */
async function setSelect(el: BookingForm, testId: string, value: string): Promise<void> {
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(`[data-test=${testId}]`)!;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

/** Click a control by its data-test. */
async function click(el: BookingForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!.click();
  await el.updateComplete;
}

/** Resolve with the next event of `type` dispatched from the form host. */
function nextEvent<T>(el: BookingForm, type: string): Promise<CustomEvent<T>> {
  return new Promise((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }),
  );
}

/** Fill the four required create fields with a valid reservation. */
async function fillValid(el: BookingForm): Promise<void> {
  await setInput(el, "booking-date", "2026-08-20");
  await setInput(el, "booking-time", "20:00");
  await setInput(el, "party-size", "4");
  await setInput(el, "contact-name", "García");
}

const EDIT_BOOKING: Booking = {
  id: "bk-1",
  bookingDate: "2026-07-01",
  bookingTime: "13:30:00",
  partySize: 2,
  contactName: "Pérez",
  contactPhone: "600100200",
  notes: "Ventana",
  tableId: "t-2",
  tabId: null,
  status: "booked",
  createdBy: "p1",
  createdAt: "2026-06-30T09:00:00.000Z",
};

describe("booking-form", () => {
  it("seeds a create's date to defaultDate and starts otherwise blank", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    const date = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=booking-date]",
    )!;
    expect(date.value).toBe("2026-08-20");
    const time = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "[data-test=booking-time]",
    )!;
    expect(time.value).toBe("");
  });

  it("offers a table picker with a no-table option plus every loaded table, keeping ids", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    const options = [
      ...el.shadowRoot!.querySelectorAll<HTMLOptionElement>("[data-test=booking-table] option"),
    ];
    expect(options.map((o) => o.value)).toEqual(["", "t-1", "t-2"]);
  });

  // The LOAD-BEARING anti-#52 assertion: the create body carries a plain local date + time, NEVER a
  // `${day}T${time}Z` instant (the shift-dialog shortcut this must not copy — design §2b).
  it("submits plain local date+time, not a UTC instant", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    const done = nextEvent<BookingInput>(el, "create-booking");
    await fillValid(el);
    await click(el, "confirm");
    const { detail } = await done;
    expect(detail).toMatchObject({
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
    });
    // No instant leaked in: no `T…` separator and no trailing `Z`.
    expect(JSON.stringify(detail)).not.toContain("T20:00");
    expect(JSON.stringify(detail)).not.toContain("Z");
  });

  it("carries the optional phone, notes and table when filled (else null)", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    const done = nextEvent<BookingInput>(el, "create-booking");
    await fillValid(el);
    await setInput(el, "contact-phone", "600100200");
    await setInput(el, "notes", "Cumpleaños");
    await setSelect(el, "booking-table", "t-1");
    await click(el, "confirm");
    const { detail } = await done;
    expect(detail).toMatchObject({
      contactPhone: "600100200",
      notes: "Cumpleaños",
      tableId: "t-1",
    });
  });

  it("sends null for an empty phone/notes and no table", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    const done = nextEvent<BookingInput>(el, "create-booking");
    await fillValid(el);
    await click(el, "confirm");
    const { detail } = await done;
    expect(detail.contactPhone).toBeNull();
    expect(detail.notes).toBeNull();
    expect(detail.tableId).toBeNull();
  });

  it("pre-fills an edit and shows the time as HH:MM (not HH:MM:SS)", async () => {
    const { el } = await mountWidget<BookingForm>(
      "dashboard-booking-form",
      baseProps({ booking: EDIT_BOOKING }),
    );
    const value = (testId: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>(`[data-test=${testId}]`)!.value;
    expect(value("booking-date")).toBe("2026-07-01");
    expect(value("booking-time")).toBe("13:30"); // sliced from 13:30:00
    expect(value("party-size")).toBe("2");
    expect(value("contact-name")).toBe("Pérez");
    expect(
      el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=booking-table]")!.value,
    ).toBe("t-2");
  });

  it("emits update-booking { id, patch } for an edit", async () => {
    const { el } = await mountWidget<BookingForm>(
      "dashboard-booking-form",
      baseProps({ booking: EDIT_BOOKING }),
    );
    const done = nextEvent<{ id: string; patch: Record<string, unknown> }>(el, "update-booking");
    await setInput(el, "party-size", "3");
    await click(el, "confirm");
    const { detail } = await done;
    expect(detail.id).toBe("bk-1");
    expect(detail.patch).toMatchObject({ bookingTime: "13:30", partySize: 3 });
  });

  it("blocks and shows an alert when a required field is empty", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    let fired = false;
    el.addEventListener("create-booking", () => (fired = true));
    await setInput(el, "booking-date", "2026-08-20");
    await setInput(el, "booking-time", "20:00");
    await setInput(el, "party-size", "4");
    // contact-name left blank
    await click(el, "confirm");
    expect(fired).toBe(false);
    const alert = el.shadowRoot!.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(codeMessage("booking.fields_required", "es-ES"));
  });

  it("blocks and shows an alert when the party size is not a positive whole number", async () => {
    const { el } = await mountWidget<BookingForm>("dashboard-booking-form", baseProps());
    let fired = false;
    el.addEventListener("create-booking", () => (fired = true));
    await fillValid(el);
    await setInput(el, "party-size", "0");
    await click(el, "confirm");
    expect(fired).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      codeMessage("booking.party_invalid", "es-ES"),
    );
  });

  it("makes confirm a no-op while busy (single-flight)", async () => {
    const { el } = await mountWidget<BookingForm>(
      "dashboard-booking-form",
      baseProps({ busy: true }),
    );
    let fired = false;
    el.addEventListener("create-booking", () => (fired = true));
    await fillValid(el);
    await click(el, "confirm");
    expect(fired).toBe(false);
  });
});
