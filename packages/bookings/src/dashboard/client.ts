import type { LiveData } from "@waitron/dashboard-kit";
import type { DashboardRequest } from "@waitron/dashboard-kit";

// Local copies of the server's JSON shapes: importing the server barrel would pull `@waitron/db` and
// Node builtins into the browser bundle.

export type BookingStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled";

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

/** `createdBy` is absent: the server sets it from the session. */
export interface BookingInput {
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

export interface BookingPatch {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  contactName?: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

export interface DashboardTable {
  id: string;
  label: string;
  zoneId: string | null;
  capacity: number | null;
  active: boolean;
  createdAt: string;
}

export class BookingApi {
  readonly #request: DashboardRequest;

  constructor(
    request: DashboardRequest,
    readonly liveData?: LiveData,
    private readonly passive = false,
  ) {
    this.#request = request;
  }

  get background(): BookingApi {
    return new BookingApi(this.#request, this.liveData, true);
  }

  listBookings(date: string): Promise<Booking[]> {
    return this.#request<Booking[]>(`/management-api/bookings?date=${date}`, "GET", undefined, {
      passive: this.passive,
    });
  }

  createBooking(input: BookingInput): Promise<{ id: string }> {
    return this.#request<{ id: string }>("/management-api/bookings", "POST", input);
  }

  updateBooking(id: string, patch: BookingPatch): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}`, "PATCH", patch);
  }

  seatBooking(id: string, req: { tableId?: string } = {}): Promise<{ tabId: string }> {
    return this.#request<{ tabId: string }>(`/management-api/bookings/${id}/seat`, "POST", req);
  }

  cancelBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/cancel`, "POST");
  }

  markNoShow(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/no-show`, "POST");
  }

  completeBooking(id: string): Promise<void> {
    return this.#request<void>(`/management-api/bookings/${id}/complete`, "POST");
  }

  /** Core's route, not a booking one: the venue's active tables, by label. */
  listTables(): Promise<DashboardTable[]> {
    return this.#request<DashboardTable[]>("/management-api/tables", "GET", undefined, {
      passive: this.passive,
    });
  }
}
