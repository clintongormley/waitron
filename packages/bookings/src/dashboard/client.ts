import type { DashboardRequest } from "@waitron/dashboard-kit";

// The bookings dashboard sub-path's HTTP face. These are LOCAL copies of the server's booking JSON
// shapes (the `routes.ts` routes wrapping `bookings.ts`), never imported from the server barrel — a
// browser bundle must not drag `@waitron/db` and Node builtins in. The server shapes stay the source
// of truth; a mismatch surfaces as a runtime shape error a view test catches, not a compile break.

/** A reservation's lifecycle state — the `booking_status` pgEnum. */
export type BookingStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled";

/**
 * One reservation as `GET /management-api/bookings` returns it — a faithful mirror of the server's
 * `Booking` row. `bookingDate` is a `YYYY-MM-DD` civil date and `bookingTime` an `HH:MM:SS` wall-clock
 * time (BOTH plain local values, NOT a UTC instant — the #52 lesson, design §2b); the screen shows the
 * time as `HH:MM`. `tableId`/`tabId` are the optional TS-1 links (`tabId` set on seat); `createdAt` is
 * an ISO instant.
 */
export interface Booking {
  id: string;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone: string | null;
  notes: string | null;
  tableId: string | null;
  tabId: string | null;
  status: BookingStatus;
  createdBy: string;
  createdAt: string;
}

/**
 * The `POST /management-api/bookings` body — the new reservation's fields. `bookingDate`/`bookingTime`
 * are the plain local `YYYY-MM-DD` + `HH:MM` the form composes (NEVER a `${day}T${time}Z` instant —
 * design §2b, the anti-#52 rule). `createdBy` is set SERVER-SIDE from the session and is deliberately
 * absent here. `contactPhone`/`notes`/`tableId` are optional and may be `null`.
 */
export interface BookingInput {
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

/** The `PATCH /management-api/bookings/:id` body — the editable business fields of a `booked`
 * reservation. A field left absent is untouched; `contactPhone`/`notes`/`tableId` accept `null` to
 * clear them. Status moves only through the lifecycle verbs, so it is not here. */
export interface BookingPatch {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  contactName?: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

/** One `dining_tables` row as `GET /management-api/tables` returns it (active only, by `label`) — the
 * screen's table picker + seat prompt read `id` and `label`. A LOCAL copy: the core `DashboardTable`
 * also carries FP-2 placement fields other screens use, but the bookings sub-path needs only these,
 * so it keeps its own minimal shape rather than importing the app's. */
export interface DashboardTable {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
}

/**
 * The booking routes as a small class over an injected {@link DashboardRequest}. The contribution
 * builds one from the module context's `request` and hands it to the screen. `listTables` is NOT one
 * of the seven booking routes — it is the core `GET /management-api/tables` — but the screen's `.api`
 * is this class, so it carries `listTables` for the form's table picker + seat prompt.
 */
export class BookingApi {
  readonly #request: DashboardRequest;

  constructor(request: DashboardRequest) {
    this.#request = request;
  }

  /** `GET /management-api/bookings?date=YYYY-MM-DD` — the location's reservations for that wall-clock
   * day, ordered by time (all statuses; the screen filters/labels them). */
  listBookings(date: string): Promise<Booking[]> {
    return this.#request<Booking[]>(`/management-api/bookings?date=${date}`, "GET");
  }

  /** `POST /management-api/bookings` — create a `booked` reservation from its plain local date+time and
   * contact fields (NO `createdBy` — the server sets it from the session); returns the new id (201). */
  createBooking(input: BookingInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/bookings", "POST", input);
  }

  /** `PATCH /management-api/bookings/:id` — edit a `booked` reservation's business fields. Answers an
   * empty 204. */
  updateBooking(id: string, patch: BookingPatch): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}`, "PATCH", patch);
  }

  /** `POST /management-api/bookings/:id/seat` — open a TS-1 tab on the table (the passed `tableId`, else
   * the booking's own) and link it; returns the new `{ tabId }`. Passing no table sends an empty body so
   * the server reuses the booking's assigned table. */
  seatBooking(id: string, req: { tableId?: string } = {}): Promise<{ tabId: string }> {
    return this.#request<{ tabId: string }>(`/management-api/bookings/${id}/seat`, "POST", req);
  }

  /** `POST /management-api/bookings/:id/cancel` — `booked|seated → cancelled`. Answers an empty 204. */
  cancelBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/cancel`, "POST");
  }

  /** `POST /management-api/bookings/:id/no-show` — `booked → no_show`. Answers an empty 204. */
  markNoShow(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/no-show`, "POST");
  }

  /** `POST /management-api/bookings/:id/complete` — `seated → completed`. Answers an empty 204. */
  completeBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/complete`, "POST");
  }

  /** `GET /management-api/tables` — the venue's ACTIVE dining tables, by label. Populates the form's
   * table picker + the seat prompt (bookings-screen.ts calls it on connect). */
  listTables(): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>("/management-api/tables", "GET");
  }
}
