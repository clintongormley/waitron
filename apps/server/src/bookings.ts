// Booking operations run on the caller's transaction. Creation and day lists use the
// configured location; table assignments also check that location. Route handlers
// own authorization. By-id lifecycle operations address the supplied reservation id.
import "./errors.js";
import { and, asc, eq, inArray, type InferSelectModel } from "drizzle-orm";
import { bookings, diningTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { openTab } from "./working-order.js";

/** A stored reservation row, exactly as `listBookings`/`getBooking` return it (camelCase columns). */
export type Booking = InferSelectModel<typeof bookings>;

/**
 * tenantId stamps new reservations; locationId scopes day lists and table assignments.
 */
export interface BookingConfig {
  tenantId: TenantId;
  locationId: LocationId;
}

/**
 * Everything `createBooking` needs. `createdBy` (the identity person who took the booking) is REQUIRED
 * beyond design §3a's field list because `bookings.created_by` is NOT NULL — Task 5's route sources it
 * from `authorizeManager`'s `{ authorizedBy }`. The optional `tableId`, if given, must name an ACTIVE
 * `dining_tables` row; the location comes from `cfg`, not here.
 */
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

/**
 * The editable business fields of a `booked` reservation (design §3a "edit fields while booked"). A
 * field left `undefined` is untouched; `contactPhone`/`notes`/`tableId` accept `null` to clear them.
 * Status is NOT here — it only moves through the lifecycle verbs.
 */
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
 * Require an active table in this location, otherwise table.not_found.
 * A reservation checks availability of the table definition without taking a row lock.
 */
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

/**
 * Create a `booked` reservation (design §3a). Validates `partySize > 0` (`booking.invalid`, echoing the
 * offending size) BEFORE the DB CHECK would, and the optional `tableId` (`table.not_found`) before the
 * insert. `status` falls to its `'booked'` column default; `tab_id` stays NULL until Task 4's seat.
 */
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
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      bookingDate: input.bookingDate,
      bookingTime: input.bookingTime,
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

/**
 * List every status for the location and wall-clock date, ordered by time then id.
 */
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

/**
 * Read one reservation by id, returning undefined when absent. Lifecycle verbs
 * translate absence into booking.not_found.
 */
export async function getBooking(
  tx: Transaction,
  _cfg: BookingConfig,
  id: string,
): Promise<Booking | undefined> {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id));
  return row;
}

/**
 * Edit business fields only while booked. Validate party size and any table assignment
 * before the conditional update; a missing or non-booked row is booking.not_found.
 */
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
      // Only the keys the caller set are written; `undefined` is skipped by Drizzle, so an omitted
      // field is untouched while an explicit `null` clears a nullable one.
      bookingDate: patch.bookingDate,
      bookingTime: patch.bookingTime,
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

/**
 * Change status only from a legal predecessor. A failed conditional update is read
 * back to distinguish booking.not_found from booking.invalid_transition.
 */
async function advanceStatus(
  tx: Transaction,
  id: string,
  from: readonly ("booked" | "seated" | "completed" | "no_show" | "cancelled")[],
  to: "seated" | "completed" | "no_show" | "cancelled",
): Promise<void> {
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

/** `booked | seated → cancelled` (design §3a). A no-show/completed/already-cancelled row is refused. */
export async function cancelBooking(
  tx: Transaction,
  _cfg: BookingConfig,
  id: string,
): Promise<void> {
  await advanceStatus(tx, id, ["booked", "seated"], "cancelled");
}

/** `booked → no_show` (design §3a) — the party never arrived. Any other state is refused. */
export async function markNoShow(tx: Transaction, _cfg: BookingConfig, id: string): Promise<void> {
  await advanceStatus(tx, id, ["booked"], "no_show");
}

/** `seated → completed` (design §3a) — the seated party has left. Only a seated row may complete. */
export async function completeBooking(
  tx: Transaction,
  _cfg: BookingConfig,
  id: string,
): Promise<void> {
  await advanceStatus(tx, id, ["seated"], "completed");
}

/**
 * Seat a booked reservation by opening a tab and linking it in the same transaction.
 * Use the requested table or the reservation's table; require one before opening the tab.
 * openTab supplies its table checks and locking. No fiscal record is filed here.
 */
export async function seatBooking(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  req: { tableId?: string },
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
  // Check a newly selected table against the reservation's location. openTab handles
  // existence and activity, preserving table.inactive for an inactive local table.
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
  const { tabId } = await openTab(tx, cfg, { tableId });
  // Compare-and-swap on the `booked` predecessor (the `advanceStatus` shape), NOT a bare id write. The
  // pre-`openTab` check above is the fast common-path error; this is the concurrency backstop for the
  // window between that lock-free `getBooking` read and here — a concurrent cancel (would be silently
  // overwritten back to `seated`) or a second seat onto another table (last-write-wins, orphaning a
  // tab). An empty match means the row left `booked` under us; the throw rolls back the whole caller tx
  // INCLUDING this `openTab`, so no orphan tab survives.
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
