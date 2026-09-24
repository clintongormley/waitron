import "./errors.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes } from "@waitron/module";
import type { Logger } from "@waitron/server-kit";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  listBookings,
  markNoShow,
  seatBooking,
  updateBooking,
  type BookingConfig,
  type CreateBookingInput,
  type UpdateBookingPatch,
} from "./bookings.js";
import { BOOKINGS_PERMISSIONS } from "./permissions.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import {
  requireBodyUuid,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";

// Read from the permissions seat so the route gate and the ladder cannot name different strings.
const [{ permission: BOOKING_WRITE }] = BOOKINGS_PERMISSIONS;

// A code missing from this map answers 400.
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "booking.not_found": 404,
  "booking.invalid": 400,
  "booking.invalid_transition": 409,
  "booking.table_required": 400,
  "table.not_found": 404,
  "table.inactive": 400,
  "tab.already_open": 409,
};

const run = createErrorBoundary(STATUS, "booking.failed");

/** Zero and negatives pass: `party_size > 0` is the verbs' rule (`booking.invalid`). */
function requireInteger(v: unknown, field: string): number {
  if (!Number.isInteger(v)) throw new AppError("management.request_invalid", { field });
  return v as number;
}

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** The column is plain text and refuses nothing, so this regex is the only range check. Both
 * spellings pass unchanged; `storedTime` in `./bookings.ts` picks the stored one. */
function requireTime(v: unknown, field: string): string {
  if (typeof v !== "string" || !TIME_HHMM.test(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

/**
 * On a create there is nothing to clear, so an explicit `null` — what the dashboard form sends for a
 * blank optional field — means absent. On a PATCH, `null` clears.
 */
function screenCreate(v: Record<string, unknown>): Omit<CreateBookingInput, "createdBy"> {
  const input: Omit<CreateBookingInput, "createdBy"> = {
    bookingDate: requirePeriod(v.bookingDate, "bookingDate"),
    bookingTime: requireTime(v.bookingTime, "bookingTime"),
    partySize: requireInteger(v.partySize, "partySize"),
    contactName: requireString(v.contactName, "contactName"),
  };
  if (v.contactPhone !== undefined && v.contactPhone !== null)
    input.contactPhone = requireString(v.contactPhone, "contactPhone");
  if (v.notes !== undefined && v.notes !== null) input.notes = requireString(v.notes, "notes");
  if (v.tableId !== undefined && v.tableId !== null)
    input.tableId = requireBodyUuid(v.tableId, "tableId");
  return input;
}

/** An empty patch is refused here: `updateBooking`'s all-`undefined` `set(...)` would throw a raw
 * Drizzle error. */
function screenPatch(v: Record<string, unknown>): UpdateBookingPatch {
  const patch: UpdateBookingPatch = {};
  if (v.bookingDate !== undefined) patch.bookingDate = requirePeriod(v.bookingDate, "bookingDate");
  if (v.bookingTime !== undefined) patch.bookingTime = requireTime(v.bookingTime, "bookingTime");
  if (v.partySize !== undefined) patch.partySize = requireInteger(v.partySize, "partySize");
  if (v.contactName !== undefined) patch.contactName = requireString(v.contactName, "contactName");
  if (v.contactPhone !== undefined) {
    patch.contactPhone = requireNullableString(v.contactPhone, "contactPhone");
  }
  if (v.notes !== undefined) patch.notes = requireNullableString(v.notes, "notes");
  if (v.tableId !== undefined) patch.tableId = requireNullableBodyUuid(v.tableId, "tableId");
  if (Object.keys(patch).length === 0) {
    throw new AppError("management.request_invalid", { field: "patch" });
  }
  return patch;
}

export const BOOKINGS_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const { db, cfg, core } = ctx;

    // Every route's database work goes through here, so the permission check is in one place.
    const gated = <T>(
      sessionId: string,
      fn: (tx: Transaction, auth: { authorizedBy: string }) => Promise<T>,
    ): Promise<T> =>
      withTransaction(db, async (tx) => {
        const auth = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: BOOKING_WRITE,
        });
        return fn(tx, auth);
      });

    const mountBookingLifecycleVerb = (
      suffix: string,
      verb: (tx: Transaction, cfg: BookingConfig, id: string) => Promise<void>,
    ): void => {
      app.post(`/management-api/bookings/:id/${suffix}`, (c) =>
        run(c, log, async () => {
          const sessionId = requireManagementSession(c);
          const id = requireUuidParam(c.req.param("id"), "BookingId");
          await gated(sessionId, (tx) => verb(tx, cfg, id));
          return c.body(null, 204);
        }),
      );
    };

    // ── List by day ──────────────────────────────────────────────────────────────────────────────────
    app.get("/management-api/bookings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const date = requirePeriod(c.req.query("date"), "date");
        const rows = await gated(sessionId, (tx) => listBookings(tx, cfg, { date }));
        return c.json(rows);
      }),
    );

    // ── Create ───────────────────────────────────────────────────────────────────────────────────────
    app.post("/management-api/bookings", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const input = screenCreate(body);
        // `createdBy` is the authorized person, never a value from the request body.
        const created = await gated(sessionId, (tx, { authorizedBy }) =>
          createBooking(tx, cfg, { ...input, createdBy: authorizedBy }),
        );
        return c.json(created, 201);
      }),
    );

    // ── Update (edit while booked) ───────────────────────────────────────────────────────────────────
    app.patch("/management-api/bookings/:id", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "BookingId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const patch = screenPatch(body);
        await gated(sessionId, (tx) => updateBooking(tx, cfg, id, patch));
        return c.body(null, 204);
      }),
    );

    // ── Seat (open a tab and link it) ────────────────────────────────────────────────────────────────
    app.post("/management-api/bookings/:id/seat", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const id = requireUuidParam(c.req.param("id"), "BookingId");
        const body = await readJsonBody<{ tableId?: unknown }>(c);
        // Optional: without one the booking's own table is used. `null` means absent.
        const req: { tableId?: string } = {};
        if (body.tableId !== undefined && body.tableId !== null) {
          req.tableId = requireBodyUuid(body.tableId, "tableId");
        }
        const seated = await gated(sessionId, (tx) => seatBooking(tx, cfg, id, req, core));
        return c.json(seated);
      }),
    );

    // ── Lifecycle moves (no body) ────────────────────────────────────────────────────────────────────
    mountBookingLifecycleVerb("cancel", cancelBooking);
    mountBookingLifecycleVerb("no-show", markNoShow);
    mountBookingLifecycleVerb("complete", completeBooking);
  },
};
