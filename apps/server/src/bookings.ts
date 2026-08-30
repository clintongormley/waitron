// The booking CRUD + lifecycle service (design §3a) — a dedicated module, imported by Task 5's
// `booking-api.ts` routes, the same split `purchasing-api.ts` uses over the `@waitron/purchasing`
// operations (routes on one side, DB ops on the other). NO HTTP, NO seat (Task 4's `seatBooking`), NO
// floor read (Task 6) here — just the tab-less reservation CRUD and its status machine.
//
// Every verb runs on the CALLER's transaction, already tenant-scoped as `app_user` (Task 5's `gated`
// wrapper = withTenant + asAppUser + authorizeManager). RLS confines every read/write to the tenant, so
// a by-id verb needs no tenant predicate of its own; `cfg` supplies the LOCATION scope, which RLS does
// not (a tenant can hold several locations), so only `createBooking`/`listBookings` read it — the
// lifecycle/by-id verbs take `_cfg` unused, keeping one uniform signature the routes call.
//
// "One of these throws imports ./errors.js" — the booking + table codes load here directly.
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
 * The tenant + location a booking verb operates in. A NARROW object (not the till-scoped `TillConfig`):
 * bookings are a management-dashboard surface, not a till, so — like `mountPurchasingApi`'s
 * `{ tenantId }` and `mountWorkforceApi`'s tenant-only deps — it carries only what these verbs need.
 * `tenantId` stamps the `tenant_id` column on insert (RLS `WITH CHECK` requires it match
 * `current_tenant_id()`); `locationId` is the day-list / creation scope RLS cannot supply.
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
 * The table exists AND is active, or `table.not_found`. Bookings collapse "no such table" and
 * "deactivated table" into the ONE reused TS-1 code (design §3a) — a booking may not be assigned to a
 * table that cannot take a party, and the distinction `openTab` draws (`table.inactive`) is a running-
 * service concern, not a reservation one. Existence-and-active only; no `FOR UPDATE` — a reservation
 * takes no lock on the table (it is not opening a tab).
 */
async function requireActiveTable(tx: Transaction, tableId: string): Promise<void> {
  const [table] = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(eq(diningTables.id, tableId), eq(diningTables.active, true)));
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
    await requireActiveTable(tx, input.tableId);
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
 * The location's reservations for one wall-clock day, ordered by `booking_time` (design §3a) — ALL
 * statuses, since the day-list screen filters/labels them itself. RLS scopes to the tenant; the
 * `location_id` + `booking_date` predicates match the `(tenant_id, location_id, booking_date)` index.
 * Ties on time are broken by `id` (canonical uuid order) so the list is deterministic, not insert-order
 * reliant.
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
 * One reservation by id, or `undefined` if none is visible to the caller (absent, or another tenant's —
 * RLS hides it). A plain read primitive Task 4's seat and Task 5's read-back compose on; it does NOT
 * throw `booking.not_found` — the verbs that must (the lifecycle ones) raise it themselves.
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
 * Edit a reservation's business fields while it is `booked` (design §3a). Validates a patched
 * `partySize > 0` (`booking.invalid`) and a patched non-null `tableId` (`table.not_found`) first, then a
 * conditional UPDATE gated on `status = 'booked'`. An empty match — the id is absent, another tenant's
 * (RLS-hidden), OR the row is no longer `booked` (seated/completed/…): all outside the editable window —
 * raises `booking.not_found`, the ONE error design §3a lists for this verb. It is deliberately NOT
 * `booking.invalid_transition`: `errors.ts` scopes that code to the lifecycle verbs
 * (cancel/no-show/complete/seat), and an edit is not a lifecycle move.
 */
export async function updateBooking(
  tx: Transaction,
  _cfg: BookingConfig,
  id: string,
  patch: UpdateBookingPatch,
): Promise<void> {
  if (patch.partySize !== undefined && patch.partySize <= 0) {
    throw new AppError("booking.invalid", { partySize: patch.partySize });
  }
  if (patch.tableId !== undefined && patch.tableId !== null) {
    await requireActiveTable(tx, patch.tableId);
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
 * A lifecycle move as a conditional UPDATE — the `advancePrep`/`advanceTicketItem` shape: `set status =
 * to where id = ? and status in (<legal predecessors>)`, so the legality of the move IS the write and
 * the common success is one query. On an empty match a single disambiguating read splits the two
 * refusals design §3a / `errors.ts` require: an ABSENT (or RLS-hidden) row → `booking.not_found`; a row
 * in a state the move is not legal from → `booking.invalid_transition`. Both carry the caller-supplied
 * `bookingId` (not a secret).
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
 * Seat a reservation: open a TS-1 tab on its table and link the two (design §3b). The party has
 * arrived, so this is the `booked → seated` move — but unlike the pure-status lifecycle verbs it takes
 * the FULL `TillConfig`, not `BookingConfig`: `openTab` → `createOpenOrder` → `allocateOrderNumber`
 * read `cfg.tillId`/`cfg.nodeId` to mint the order number, which the narrow config cannot supply. A
 * `TillConfig` is a structural superset of `BookingConfig`, so Task 5 mounts every verb with the same
 * object; only this one is typed for the wider shape.
 *
 * 1. the booking must exist (`booking.not_found`) and be `booked` (`booking.invalid_transition`) —
 *    the not_found/invalid_transition split the other lifecycle verbs draw;
 * 2. resolve the table — the passed `tableId` ?? the booking's own — or `booking.table_required` when
 *    neither is set (a booking with no table cannot be seated without one);
 * 3. `openTab` opens the pre-fiscal working order and takes the table `FOR UPDATE`, enforcing
 *    one-open-tab-per-table; its `table.not_found`/`table.inactive`/`tab.already_open` bubble up
 *    unchanged (a busy or missing table is the caller's to resolve). Its `orderNumber` is discarded —
 *    the booking links to the tab, not to the order number.
 * 4. stamp `table_id` (in case it was newly chosen via `req.tableId`), `tab_id`, and `status = seated`
 *    on the booking. RLS scopes the write to the tenant, as it does every by-id verb here.
 *
 * No fiscal path is touched: `openTab` writes a pre-fiscal working order, never a
 * `registros_facturacion` row / `huella` / invoice number (design §3b, §5).
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
