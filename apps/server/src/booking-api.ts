// Side-effect only: loads this host's errors.ts augmentation for the codes the body/query screens
// below throw directly — `management.request_invalid` (the empty-patch / malformed-field guard) — under
// the "every file that throws one of these imports ./errors.js" convention. `shared.invalid_id` (thrown
// by `requireUuidParam`) is declared in `@waitron/shared` and loads via the `AppError` value import;
// the `booking.*` / `table.*` / `tab.*` codes these routes answer are thrown by the `@waitron/bookings`
// verbs (`./bookings.js`), whose `import "./errors.js"` registers them, and load transitively through
// the value imports of those verbs below — the same transitive-reachability shape `purchasing-api.ts`
// relies on. So this one line is all this file needs.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  listBookings,
  markNoShow,
  seatBooking,
  updateBooking,
  type CreateBookingInput,
  type UpdateBookingPatch,
} from "./bookings.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import {
  requireBodyUuid,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "./request-screens.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's booking routes need: `db` + this venue's FULL `TillConfig`. Unlike
 * `PurchasingApiDeps`'s `{ tenantId }`, bookings carry the whole box config because `seatBooking` opens
 * a real TS-1 tab (`openTab` → `allocateOrderNumber`) that reads `cfg.tillId`/`cfg.nodeId` to mint the
 * order number, which a narrow `{ tenantId, locationId }` cannot supply; `createBooking`/`listBookings`
 * additionally read `cfg.locationId` (the day-list / creation scope RLS cannot supply). `boot.ts` passes
 * the same `till` object every sibling mount holds, so scope cannot drift.
 */
export interface BookingsApiDeps {
  db: Database;
  cfg: TillConfig;
}

/**
 * The ONE permission that gates every booking route — one named constant referenced at every route
 * rather than an inline literal, so a future re-mapping is a one-line swap here. `booking.manage` maps
 * to `manager` + `admin` (the dashboard's audience), the same shape `purchase.manage` takes.
 */
const BOOKING_WRITE: Permission = "booking.manage";

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to — the booking parallel of
 * `purchasing-api.ts`'s `STATUS`. CLIENT faults only: a genuine SERVER fault reaches `run` as a
 * NON-AppError and becomes an opaque 500. A registered code absent from this table defaults to 400 via
 * `run`. The `table.*` / `tab.*` codes appear because `seatBooking` surfaces them (a bad/inactive table
 * or an already-open tab), the same "list the codes the routes can throw" style purchasing takes.
 */
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

// The one error boundary every booking route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `booking.failed` log tag.
const run = createErrorBoundary(STATUS, "booking.failed");

/** Screen a REQUIRED body field as a string, refusing an absent/wrong-typed one as
 * `management.request_invalid` naming the field (never a downstream `text`/`numeric` 500). */
function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}

/** Screen a field that must reach an `integer` column: any non-integer (a float, a string, `undefined`)
 * is refused as `management.request_invalid` naming the field, never a downstream `22P02`. The
 * `party_size > 0` business rule is the verb's (`booking.invalid`), so `0`/negatives PASS this screen
 * and reach `createBooking`/`updateBooking` to be echoed there. */
function requireInteger(v: unknown, field: string): number {
  if (!Number.isInteger(v)) throw new AppError("management.request_invalid", { field });
  return v as number;
}

const TIME_HHMM = /^\d{2}:\d{2}(:\d{2})?$/;

/** Screen a `HH:MM` / `HH:MM:SS` wall-clock time before it reaches the `time` column (where a malformed
 * value would `22007` → an opaque 500), refusing an absent/wrong-typed/mis-shaped one as
 * `management.request_invalid` naming the field. Range (`25:61`) is left to the `time` column, as
 * `requirePeriod` leaves the impossible-day check split between regex and round-trip. */
function requireTime(v: unknown, field: string): string {
  if (typeof v !== "string" || !TIME_HHMM.test(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

/**
 * Screen the create body into a `CreateBookingInput` MINUS `createdBy` (the route supplies that from
 * `authorizeManager`'s `authorizedBy`, never the body). Every required scalar present and well-typed;
 * the optional `contactPhone`/`notes`/`tableId` screened ONLY when present. A malformed value is a
 * clean `management.request_invalid` naming the field, never a downstream column 500.
 */
function screenCreate(v: Record<string, unknown>): Omit<CreateBookingInput, "createdBy"> {
  const input: Omit<CreateBookingInput, "createdBy"> = {
    bookingDate: requirePeriod(v.bookingDate, "bookingDate"),
    bookingTime: requireTime(v.bookingTime, "bookingTime"),
    partySize: requireInteger(v.partySize, "partySize"),
    contactName: requireString(v.contactName, "contactName"),
  };
  if (v.contactPhone !== undefined)
    input.contactPhone = requireString(v.contactPhone, "contactPhone");
  if (v.notes !== undefined) input.notes = requireString(v.notes, "notes");
  if (v.tableId !== undefined) input.tableId = requireBodyUuid(v.tableId, "tableId");
  return input;
}

/**
 * Screen the PATCH body into an `UpdateBookingPatch`: any subset of the editable fields, each screened
 * ONLY when present (a PATCH touches only what it names). `contactPhone`/`notes`/`tableId` accept an
 * explicit `null` to CLEAR them (the verb's contract). An empty patch — the body names no editable
 * field — is refused as `management.request_invalid { field: "patch" }` (see the empty-patch note on the
 * PATCH route) rather than reaching `updateBooking`, whose all-`undefined` `set(...)` throws a raw
 * Drizzle error.
 */
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

/**
 * Mounts the dashboard's gated booking write group on an existing Hono app — `mountPurchasingApi`'s
 * sibling, attached to the SAME app (the `mountWebhook`/`mountTillApi` convention). Every route wraps
 * its handler in `run`, calls `requireManagementSession(c)` (→ 401 before any DB work) and then, inside
 * `withTenant` + `asAppUser`, `authorizeManager(...)` (→ 403) before the `./bookings.js` verb, so RLS
 * scopes each read/write to this server's one tenant and the `booking.manage` gate runs on every route
 * through one constant. No fiscal path is touched: `seatBooking` opens a pre-fiscal working order only.
 */
export function mountBookingsApi(app: Hono, deps: BookingsApiDeps, log: Logger): void {
  const { cfg } = deps;

  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // BOOKING_WRITE, then run `fn` with the tx AND the authorization result. Every route funnels its DB
  // work through here so the gate is applied identically and in exactly one place. `fn` receives
  // `{ authorizedBy }` (the person id the session resolved to) so the create route can stamp
  // `bookings.created_by` from the authorized manager rather than trusting the request body.
  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction, auth: { authorizedBy: string }) => Promise<T>,
  ): Promise<T> =>
    withTenant(deps.db, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const auth = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: BOOKING_WRITE,
      });
      return fn(tx, auth);
    });

  // ── List by day ──────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/bookings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // `date` is REQUIRED; `requirePeriod` refuses both an absent value (`undefined` is not a string)
      // and a malformed/impossible day as `management.request_invalid { field: "date" }`.
      const date = requirePeriod(c.req.query("date"), "date");
      const rows = await gated(sessionId, (tx) => listBookings(tx, cfg, { date }));
      return c.json(rows);
    }),
  );

  // ── Create ───────────────────────────────────────────────────────────────────────────────────────
  app.post("/management-api/bookings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // `readJsonBody` coerces an empty/malformed/`null` body to `{}` so the field screens reject it
      // with a specific 400 rather than an opaque 500.
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = screenCreate(body);
      // `createdBy` is the AUTHORIZED person, taken from `authorizeManager` — never the request body.
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
      // `screenPatch` throws `management.request_invalid` on an empty patch BEFORE the op — an
      // all-`undefined` `set(...)` throws a raw Drizzle error, so the empty case is refused here as a
      // clean 400 (the domain code the other management surfaces use for a request-shape fault).
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
      // `tableId` is OPTIONAL (the seat may reuse the booking's own table); screened to a uuid when
      // present so a malformed one is a 400, not a downstream `22P02`. A `null` is treated as absent.
      const req: { tableId?: string } = {};
      if (body.tableId !== undefined && body.tableId !== null) {
        req.tableId = requireBodyUuid(body.tableId, "tableId");
      }
      const seated = await gated(sessionId, (tx) => seatBooking(tx, cfg, id, req));
      return c.json(seated);
    }),
  );

  // ── Lifecycle moves (no body) ────────────────────────────────────────────────────────────────────
  app.post("/management-api/bookings/:id/cancel", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BookingId");
      await gated(sessionId, (tx) => cancelBooking(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/bookings/:id/no-show", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BookingId");
      await gated(sessionId, (tx) => markNoShow(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/bookings/:id/complete", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "BookingId");
      await gated(sessionId, (tx) => completeBooking(tx, cfg, id));
      return c.body(null, 204);
    }),
  );
}
