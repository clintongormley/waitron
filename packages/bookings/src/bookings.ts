// Booking operations run on the caller's transaction. Creation and day lists use the
// configured location; table assignments also check that location. Route handlers
// own authorization. A by-id read or write needs only the id.
import "./errors.js";
import { and, asc, eq, inArray, type InferSelectModel } from "drizzle-orm";
import { diningTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import type { CoreServices } from "@waitron/module";
import { bookings } from "./schema/bookings.js";

export type Booking = InferSelectModel<typeof bookings>;

export interface BookingConfig {
  locationId: LocationId;
}

export interface CreateBookingInput {
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  contactName: string;
  contactPhone?: string;
  notes?: string;
  tableId?: string;
  createdBy: string;
}

/** A field left `undefined` is untouched; `null` clears a nullable one. */
export interface UpdateBookingPatch {
  bookingDate?: string;
  bookingTime?: string;
  partySize?: number;
  contactName?: string;
  contactPhone?: string | null;
  notes?: string | null;
  tableId?: string | null;
}

/**
 * The column is plain text and `routes.ts`'s `TIME_HHMM` accepts `HH:MM` and `HH:MM:SS`, so every
 * write stores `HH:MM:SS`: otherwise one time would have two stored spellings and an equality read
 * could miss a booking.
 */
function storedTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

async function requireActiveTable(
  tx: Transaction,
  locationId: LocationId,
  tableId: string,
): Promise<void> {
  const [table] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.id, tableId),
        eq(diningTables.active, true),
        eq(diningTables.locationId, locationId),
      ),
    );
  if (table === undefined) {
    throw new AppError("table.not_found", { tableId });
  }
}

export async function createBooking(
  tx: Transaction,
  cfg: BookingConfig,
  input: CreateBookingInput,
): Promise<{ id: string }> {
  if (input.partySize <= 0) {
    throw new AppError("booking.invalid", { partySize: input.partySize });
  }
  if (input.tableId !== undefined) {
    await requireActiveTable(tx, cfg.locationId, input.tableId);
  }
  const [row] = await tx
    .insert(bookings)
    .values({
      locationId: cfg.locationId,
      bookingDate: input.bookingDate,
      bookingTime: storedTime(input.bookingTime),
      partySize: input.partySize,
      contactName: input.contactName,
      contactPhone: input.contactPhone ?? null,
      notes: input.notes ?? null,
      tableId: input.tableId ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: bookings.id });
  return { id: row!.id };
}

export async function listBookings(
  tx: Transaction,
  cfg: BookingConfig,
  { date }: { date: string },
): Promise<Booking[]> {
  return tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.locationId, cfg.locationId), eq(bookings.bookingDate, date)))
    .orderBy(asc(bookings.bookingTime), asc(bookings.id));
}

export async function getBooking(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
): Promise<Booking | undefined> {
  void cfg;
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id));
  return row;
}

/** A row that is missing or no longer `booked` is refused as `booking.not_found`. */
export async function updateBooking(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
  patch: UpdateBookingPatch,
): Promise<void> {
  if (patch.partySize !== undefined && patch.partySize <= 0) {
    throw new AppError("booking.invalid", { partySize: patch.partySize });
  }
  if (patch.tableId !== undefined && patch.tableId !== null) {
    await requireActiveTable(tx, cfg.locationId, patch.tableId);
  }
  const updated = await tx
    .update(bookings)
    .set({
      // Drizzle skips an `undefined` value, leaving that column untouched.
      bookingDate: patch.bookingDate,
      bookingTime: patch.bookingTime === undefined ? undefined : storedTime(patch.bookingTime),
      partySize: patch.partySize,
      contactName: patch.contactName,
      contactPhone: patch.contactPhone,
      notes: patch.notes,
      tableId: patch.tableId,
    })
    .where(and(eq(bookings.id, id), eq(bookings.status, "booked")))
    .returning({ id: bookings.id });
  if (updated.length === 0) {
    throw new AppError("booking.not_found", { bookingId: id });
  }
}

async function advanceStatus(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
  from: readonly ("booked" | "seated" | "completed" | "no_show" | "cancelled")[],
  to: "seated" | "completed" | "no_show" | "cancelled",
): Promise<void> {
  void cfg;
  const updated = await tx
    .update(bookings)
    .set({ status: to })
    .where(and(eq(bookings.id, id), inArray(bookings.status, from)))
    .returning({ id: bookings.id });
  if (updated.length > 0) {
    return;
  }
  const [row] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, id));
  if (row === undefined) {
    throw new AppError("booking.not_found", { bookingId: id });
  }
  throw new AppError("booking.invalid_transition", { bookingId: id });
}

export async function cancelBooking(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
): Promise<void> {
  await advanceStatus(tx, cfg, id, ["booked", "seated"], "cancelled");
}

export async function markNoShow(tx: Transaction, cfg: BookingConfig, id: string): Promise<void> {
  await advanceStatus(tx, cfg, id, ["booked"], "no_show");
}

export async function completeBooking(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
): Promise<void> {
  await advanceStatus(tx, cfg, id, ["seated"], "completed");
}

/** Opens a tab on the requested table, or the booking's own, and links it to the booking. */
export async function seatBooking(
  tx: Transaction,
  cfg: BookingConfig,
  id: string,
  req: { tableId?: string },
  core: CoreServices,
): Promise<{ tabId: string }> {
  const booking = await getBooking(tx, cfg, id);
  if (booking === undefined) {
    throw new AppError("booking.not_found", { bookingId: id });
  }
  if (booking.status !== "booked") {
    throw new AppError("booking.invalid_transition", { bookingId: id });
  }
  const tableId = req.tableId ?? booking.tableId;
  if (tableId === null || tableId === undefined) {
    throw new AppError("booking.table_required", {});
  }
  // Only the location is checked here: `openTab` refuses a missing or inactive table itself, keeping
  // `table.inactive` distinct.
  if (req.tableId !== undefined) {
    const [inLocation] = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(
        and(eq(diningTables.id, req.tableId), eq(diningTables.locationId, booking.locationId)),
      );
    if (inLocation === undefined) {
      throw new AppError("table.not_found", { tableId: req.tableId });
    }
  }
  // A throw after `openTab` relies on the caller's transaction to roll back the tab it opened.
  const { tabId } = await core.openTab(tx, { tableId });
  const seated = await tx
    .update(bookings)
    .set({ tableId, tabId, status: "seated" })
    .where(and(eq(bookings.id, id), eq(bookings.status, "booked")))
    .returning({ id: bookings.id });
  if (seated.length === 0) {
    throw new AppError("booking.invalid_transition", { bookingId: id });
  }
  return { tabId };
}
