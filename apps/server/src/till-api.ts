import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import { AppError, SUPPORTED_LOCALES } from "@waitron/shared";
import { asAppUser, locations, tenants, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorize,
  endSession,
  listActivePersonsWithPermission,
  listActiveStaff,
  loginWithPin,
  roleHasPermission,
  setPersonLocale,
} from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import { getReceipt, getCanvas, getCanvasForFormFactor } from "@waitron/layouts";
import type { CanvasDef } from "@waitron/layouts";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import {
  collectOrder,
  payWorkingOrderIntegrated,
  recordTillSale,
  reprintSale,
} from "./till-sale.js";
import type { IntegratedPayRequest, TillSaleRequest, TillTender } from "./till-sale.js";
import { enqueueManualDrawerOpen, resolveReceiptPrinter } from "./receipt-print.js";
import {
  clearPlacement,
  createTable,
  deactivateTable,
  listServiceStatuses,
  listTables,
  listZones,
  setTablePlacement,
  setTableStatus,
  updateTable,
  type FloorTableShape,
} from "./tables.js";
import {
  abandonHeldOrder,
  addTabRound,
  advanceTicket,
  advanceTicketItem,
  bumpCourseReady,
  cancelPlacedOrder,
  fireCourse,
  getHeldOrder,
  joinTable,
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  listTablesWithState,
  markCollected,
  markCourseAway,
  markLineServed,
  mergeTabs,
  moveTab,
  openTab,
  parkOrder,
  placeOrder,
  readTabLines,
  recallLines,
  sendLines,
  sendToPrep,
  setLineCourse,
  splitOffCheck,
  transferLines,
  unjoinTable,
  unmarkLineServed,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import type { LineExtras, TicketState } from "./working-order.js";
import { listCourses, listStations } from "./kitchen.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import {
  clearSessionCookie,
  isUuid,
  readSessionId,
  requireSession,
  setSessionCookie,
} from "./till-session.js";
import {
  assertDeviceCapability,
  assertNotHandheld,
  requireSaleTillId,
  tryReadDevice,
} from "./device-session.js";
import { deviceFormFactor } from "./device.js";
import { requireUuidParam } from "./request-screens.js";
// Side-effect only: loads errors.ts's augmentation for the host codes this file THROWS — the
// `working_order.*` / `order_prep.*` it constructs via `requireUuidId` — under the "every file that
// throws one of these imports ./errors.js" convention errors.ts states. (The sale/pay body id screens
// throw `shared.invalid_id` via `requireUuidParam`, whose own file loads that shared code.) The shared
// `error-boundary.ts` these routes wrap through is what answers with `server.internal` now, and it
// emits that as a bare literal, so it needs no such import of its own. See errors.ts.
import "./errors.js";

/**
 * Everything the till's HTTP routes need, defined COMPLETE now even though the session routes below
 * touch only some of it. `backend`/`clock` are unused here but Tasks 5/6's `POST /api/sales` calls
 * `recordTillSale` with them, so wiring them into this one interface now keeps it — and every caller
 * that builds it — stable across the whole slice. `secureCookies` decides the session cookie's
 * `Secure` attribute (TRUE on a production HTTPS host, FALSE on loopback dev with no TLS).
 */
export interface TillApiDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TillConfig;
  secureCookies: boolean;
  /**
   * The integrated card-payment provider `boot.ts` built for this till's tenant, or `undefined` when
   * `WAITRON_TILL_CARD_PROVIDER=none`. Unused by the routes below — the card-collect route (Task 8)
   * drives it — but wired into this one interface now, beside the fiscal `backend`/`clock`, so the
   * shape and every caller stay stable across the slice. `deps.cfg.cardProvider` carries the STRING
   * form `GET /api/till` echoes; THIS is the built object the collect path invokes.
   */
  cardProvider?: PaymentProvider;
  /**
   * Whether this host runs in DEV mode (SP-C, `config.devMode`) — the switch the per-tab device
   * override header (`x-waitron-dev-device`) gates on. Boot wires `config.devMode`; forwarded to the
   * device guards (`tryReadDevice`/`requireSaleTillId`/`assertNotHandheld`/`assertDeviceCapability`)
   * so the override reaches the sale/pay routes. OPTIONAL and defaulting to fail-closed (unset ⇒ the
   * header is inert), so every existing `TillApiDeps` construction — tests included — compiles
   * unchanged, exactly as `DeviceApiDeps.devMode` does (Controller Ruling 1). The routes that pass
   * `deps` wholesale inherit it; the ONE that reconstructs a narrow `{ db, cfg }` (`GET /api/till`'s
   * `tryReadDevice`) forwards `deps.devMode` explicitly.
   */
  devMode?: boolean;
  /**
   * The venue's DEFAULT UI locale, derived ONCE at boot (`readVenueLocale`, boot.ts) from geography +
   * the optional `WAITRON_TILL_LOCALE` override. `GET /api/till` echoes it as `locale` (the language
   * the till app defaults to before a per-user preference is known), and `GET /api/locales` returns it
   * as `venueDefault`. DISTINCT from the fiscal `cfg.locale`/`cfg.invoiceLocales`, which are unchanged.
   */
  venueLocale: string;
}

/**
 * Every AppError CODE the till API answers, and the HTTP status it maps to. CLIENT faults only: the
 * identity credential codes (`pin.invalid`/`person.*`/`session.*`), the `sale.*` request codes, the
 * shared `shared.invalid_id` branded-id code (a malformed working-order id in a sale/pay/park body,
 * 400) and the `working_order.*` park-and-retrieve codes are all 4xx. A genuine SERVER fault never appears
 * here — it reaches `run` as a NON-AppError and becomes an opaque 500. A registered code absent from
 * this table defaults to 400 (a client fault not yet given a more specific status), which is why
 * `run` needs the `?? 400`.
 *
 * The working-order and kitchen codes are given SPECIFIC statuses rather than the 400 default: a
 * retrieve of an id that names no open order is a 404 (`working_order.not_found`); a MODIFY of an
 * order that is not open (`working_order.not_open`), not placed (`working_order.not_placed`), not
 * settled (`working_order.not_settled`, `sendToPrep`'s own guard), a re-fire of an order already sent
 * to the kitchen (`ticket.already_fired`), or a per-line bump the item's current kitchen state forbids
 * (`ticket.invalid_transition`) are all 409 — the id may be valid, but the order's (or its ticket
 * item's) STATE forbids the operation (see each code's own note in `errors.ts`). A fire to a venue with
 * no default station is `station.no_default` (409, a misconfiguration blocking the fire); a station id
 * naming no live station is `station.not_found` (404). `working_order.reason_required` is listed
 * explicitly at 400 despite being the table's own default, matching every other
 * `working_order.*`/`sale.*` entry here. (`order_prep.invalid_transition` is retired from this surface
 * with the KDS-1 rework — its throw sites are gone, so it is no longer mapped here; it stays REGISTERED
 * in `errors.ts`, never renamed, spec §6.)
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "pin.invalid": 401,
  "person.not_found": 401,
  "person.suspended": 403,
  // The handheld firewall (spec §5; owner reversal 2026-08-30): a handheld device tried a fiscal/cash
  // action it may not perform — the INTEGRATED card reader (`POST /api/pay`), reprint, drawer, place,
  // collect or cancel. (`POST /api/sales` is NOT here: a handheld settles cash or a manual card there,
  // both node-keyed, record-sale.ts:79-82.) `assertNotHandheld` refuses it server-side even if the client
  // is bypassed. 403: authenticated but forbidden.
  "device.forbidden_action": 403,
  // The SP-A.2 sale-time device gate (§16.4/§16.5): a sale route resolves its `till_id` from the
  // authenticated enrolled device (`requireSaleTillId`) — a SETUP precondition, not a per-sale block. A
  // request carrying no `waitron_device` cookie is refused `device.unauthorized` (401, the device-auth
  // status), and an authenticated device with no till (a `kds_station`, which rings no sale)
  // `device.till_required` (400, the validation status). Same codes AND same statuses `device-api.ts`'s
  // own map assigns them — this fiscal surface does not diverge from that sibling.
  "device.unauthorized": 401,
  "device.till_required": 400,
  "session.not_open": 401,
  "session.required": 401,
  // The operator picked an unsupported UI language on `PUT /api/session/locale` — a request-shape
  // fault, so 400. Thrown by `setPersonLocale`'s `assertSupportedLocale` (identity), BEFORE any write.
  "locale.unsupported": 400,
  "sale.empty_basket": 400,
  "sale.unknown_product": 400,
  "sale.unsupported_tender": 400,
  "sale.tender_shortfall": 400,
  // A malformed working-order id in a `POST /api/sales` / `POST /api/pay` / `POST /api/working-orders`
  // body — the shared branded-id code (`@waitron/shared`), screened by `requireUuidParam` so it is a
  // clean 400, not a `22P02` → 500.
  "shared.invalid_id": 400,
  "authorization.not_permitted": 403,
  "working_order.not_found": 404,
  "working_order.not_open": 409,
  "working_order.not_placed": 409,
  "working_order.not_settled": 409,
  // The Mode-P counter handover (`markCollected`, `POST /api/orders/:id/collect`). Re-collecting an
  // already-handed-over order is `working_order.already_collected`, and collecting an order that was
  // never fired is `ticket.not_fired` — both 409, the same family as `not_settled`/`ticket.already_fired`
  // (the id is valid, but the order's handover/kitchen state forbids the operation).
  "working_order.already_collected": 409,
  "ticket.not_fired": 409,
  "working_order.reason_required": 400,
  // Kitchen tickets (KDS-1). A re-fire of an order already sent to the kitchen is `ticket.already_fired`
  // (409 — the order's lines are already in the kitchen; `sendToPrep`'s double-send, mapped from the
  // per-line unique in `fireLines`); a per-line bump the item's state forbids (skip/repeat/backwards, or
  // an absent/foreign/malformed item id) is `ticket.invalid_transition` (409). A fire to a venue with no
  // default station is `station.no_default` (409, a misconfiguration blocking the fire); a station id
  // naming no live station (or a malformed one, screened) is `station.not_found` (404).
  "ticket.already_fired": 409,
  "ticket.invalid_transition": 409,
  // Coursing (KDS-2). A per-line bump the item's HELD state forbids — its course has not been fired, so
  // the kitchen must not start it — is `ticket.item_held` (409, thrown by `advanceTicketItem`'s held
  // guard), the same STATE-forbids-it family as `ticket.invalid_transition` beside it. The course-fire
  // route (`POST /api/orders/:id/courses/:courseId/fire`) and the KDS-3 expo dispatch route
  // (`POST /api/orders/:id/courses/:courseId/away`) surface `course.not_found` (404) for an
  // absent/foreign/malformed course id — thrown by `fireCourse`'s / `markCourseAway`'s `requireCourse`
  // (EXISTENCE-not-liveness: a course DEACTIVATED while it holds plated items still passes, so `retired`
  // is NOT a 404 here), the SAME code and 404 the management config surface maps it to (courses are a
  // management concept, but the fire/dispatch verbs are operational and run here). The expo `ready` route
  // (`bumpCourseReady`) does NOT existence-check, so it never surfaces this. A malformed ORDER id on any
  // of those routes is `working_order.not_found` (404, already mapped above), the honest "no such order".
  "ticket.item_held": 409,
  // Coursing editing (A4). A recall of a line the kitchen has already STARTED (`state` preparing/ready, not
  // queued) is `ticket.already_started` (409, thrown by `recallLines` after reading the offending item) —
  // the inverse-direction sibling of `ticket.already_fired`/`ticket.not_fired` beside it, the same
  // STATE-forbids-it family: the id is valid, but un-firing a line that is cooking is refused (it is cancelled,
  // not recalled). An already-held or unknown line is not this — a held line is a no-op and an absent `line_no`
  // is `tab.line_not_found` (404, already mapped above via the sibling tab verbs).
  "ticket.already_started": 409,
  "course.not_found": 404,
  "station.no_default": 409,
  "station.not_found": 404,
  // The generic request-shape 400 the sibling gated surfaces (`workforce-api.ts`,
  // `catalogue-api.ts`) use for a malformed body field — here, an out-of-range `capacity` on the
  // table create/patch routes (see `requireCapacity`). Listed explicitly though 400 is the table's
  // default, matching those siblings.
  "management.request_invalid": 400,
  // Table + tab (TS-1). A bad/absent/foreign table id is a 404 (`table.not_found`); a label
  // collision or an already-open tab / non-open tab / deactivated table is a 409 (the id may be
  // valid but the table's or tab's STATE forbids the operation); a `line_no` naming no line is a 404
  // (`tab.line_not_found`) — the same shape `working_order.not_found` uses for the retrieve side.
  "table.not_found": 404,
  "table.label_taken": 409,
  "table.inactive": 409,
  // Floor-plan zone (FP-1). The table create/patch routes now accept a `zoneId`; one naming no
  // `floor_zones` row (or another tenant's, RLS-hidden) surfaces `zone.not_found` — a 404, the same
  // shape `table.not_found`/`status.not_found` use for an absent referenced row. (`zone.name_taken`
  // is thrown only by the zone CRUD verbs, which the MANAGEMENT API exposes and maps there; the till
  // surface only LISTS zones (`GET /api/zones`) and never creates/renames one, so it never throws it.)
  "zone.not_found": 404,
  // Floor-plan spatial placement (FP-2, Task 4). A `posX`/`posY`/`rotation` out of range or a `shape`
  // naming no `floor_table_shape` enum member is `setTablePlacement`'s per-field `placement.invalid` — a
  // request-shape fault, 400. Listed explicitly (house style) though 400 is the map's default; the
  // on-till placement routes (`PUT`/`DELETE /api/tables/:id/placement`) surface it. (`table.not_found`/
  // `zone.not_found`, already mapped above, cover the missing/inactive table or zone the verb also throws.)
  "placement.invalid": 400,
  "tab.already_open": 409,
  "tab.not_open": 409,
  "tab.line_not_found": 404,
  // Table service move/join/merge (TS-3). A move/join onto a table already covered by a STILL-OPEN tab
  // is a 409 (`table.occupied`) — the id is valid but the target's STATE (occupied) forbids it, the
  // same 409 shape `tab.already_open` uses; a merge of a tab into ITSELF is a request-shape fault, a
  // 400 (`tab.merge_self`). `tab.not_open`/`table.not_found`/`table.inactive` (already mapped above) are
  // reused for the non-open tab, absent/malformed target, and deactivated target the verbs also throw.
  "table.occupied": 409,
  "tab.merge_self": 400,
  // Table service transfer (TS-4). A transfer named the SAME tab as source and destination is a
  // request-shape fault, a 400 (`tab.transfer_self`), the same shape `tab.merge_self` uses; a `quantity`
  // outside `0 < quantity ≤ line.quantity` (zero, negative, over-quantity, malformed) is also a 400
  // (`tab.transfer_quantity_invalid`); a batch naming the same source `line_no` more than once is a 400
  // too (`tab.transfer_duplicate_line`) — the ids may be valid, the request itself is malformed.
  // `tab.not_open`/`tab.line_not_found` (already mapped above) are reused for a non-open tab and an
  // unknown source `line_no`.
  "tab.transfer_self": 400,
  "tab.transfer_quantity_invalid": 400,
  "tab.transfer_duplicate_line": 400,
  // Split-bill un-join (TS-5). Un-joining a table that is not currently joined to the named tab — an
  // absent/foreign table, a free table, or one joined to a DIFFERENT tab (all read as tab_id ≠ tabId) —
  // is `table.not_joined` (409): the ids may be valid, but the table's STATE (not joined here) forbids
  // the detach, the same 409 shape `table.occupied`/`tab.not_open` use. Thrown by `unjoinTable`. (Split's
  // `splitOffCheck` throws only already-mapped codes — `tab.not_open`, the reused transfer codes.)
  "table.not_joined": 409,
  // Un-joining WITH items a table that solely anchors its tab — no other table shares the tab, so there
  // is no join to split off — is `table.not_shared` (409): the ids may be valid, but the table's STATE
  // (un-shared) forbids the un-join, the same 409 shape `table.not_joined`/`table.occupied` use. Thrown by
  // `unjoinTable`'s with-items branch before it mints anything.
  "table.not_shared": 409,
  // A transfer that would separate a modifier from its dish — a child line named on its own, or a
  // partial split of a dish that carries modifiers (ordering modifiers). A malformed request regardless
  // of any tab's STATE, so a 400, the same shape the other `tab.transfer_*` request-shape faults carry.
  "tab.transfer_modifier_line": 400,
  // Manual service status (TS-2). Setting a table's status can fail two ways: an unknown status id
  // (or a malformed one screened at the route) names no status → 404 (`status.not_found`); a
  // deactivated status may not be set → 409 (`status.inactive`) — the id is valid but the status's
  // STATE forbids it, the same 409 shape `table.inactive`/`tab.not_open` use. (A bad TABLE id on this
  // route is `table.not_found`, already mapped above.)
  "status.not_found": 404,
  "status.inactive": 409,
  // Manual cash-drawer open (counter receipt/drawer §3d). `POST /api/drawer/open` on a till whose
  // `receipt_printer_id` is unset has no printer to kick the drawer through — a configuration gap the
  // operator fixes via the dashboard's printer picker, so a request-shape 400 (errors.ts spells out the
  // 400 and the `drawer.*`-not-`printer.*`/`till.*` naming). Listed explicitly though 400 is the map's
  // default, matching `placement.invalid`'s both-maps precedent and the rest of this table's 400 entries.
  "drawer.no_printer": 400,
};

// The one error boundary every till route wraps its handler in — the shared `createErrorBoundary`
// (see `error-boundary.ts` for its full behaviour) closed over this surface's `STATUS` map and its
// `till.failed` log tag. Exported so Tasks 5/6's routes wrap theirs in this EXACT mapping rather than
// each inventing one.
export const run = createErrorBoundary(STATUS, "till.failed");

/**
 * Screen a path `:id` param as a UUID before it reaches a query, returning it for the caller. A
 * malformed id passed straight into `eq(workingOrders.id, id)` would `22P02` in the DB → an opaque 500;
 * screening it here refuses it with the SAME domain `code` an absent/wrong-state id gets on that route
 * — the fail-closed shape each route documents. `code` is the caller's deliberate per-route choice
 * (`working_order.not_found` for retrieve → 404 — the retrieve route's absent-order code;
 * `working_order.not_open` for edit/abandon/place → 409; `working_order.not_placed` for collect/cancel
 * → 409; `working_order.not_settled` for send-to-prep → 409, `sendToPrep`'s own guard code); every code
 * carries `{ workingOrderId }`. The retrieve/edit/abandon/place/prep/collect/cancel routes share this
 * one guard.
 */
function requireUuidId(
  id: string,
  code:
    | "working_order.not_found"
    | "working_order.not_open"
    | "working_order.not_placed"
    | "working_order.not_settled",
): string {
  if (!isUuid(id)) {
    throw new AppError(code, { workingOrderId: id });
  }
  return id;
}

/**
 * Parse and SCREEN the optional supervisor `override` on `POST /api/drawer/open` before it reaches
 * `authorize()`'s credential gate. The whole override is optional — a supervisor opening directly, and
 * every `open`-policy open, sends none, so an absent `raw` returns `undefined` (no override) and the
 * gate falls back to the operator's own role.
 *
 * When an override IS supplied it must be well-formed, mapped to the SAME codes the credential gate
 * gives a bad credential so a malformed one never becomes an opaque 500:
 *   • `personId` must be a UUID string — a non-string or malformed value is refused `person.not_found`
 *     (401) BEFORE it can reach the `persons.id` uuid column inside `verifyPersonCredential` as a
 *     `22P02` → opaque 500, the same code a well-formed-but-absent id gets from that gate;
 *   • `pin` must be a string — a missing/non-string PIN is refused `pin.invalid` (401), the code a
 *     wrong PIN already gets, rather than reaching `verifyPin` as a non-string.
 * (A well-formed-but-UNKNOWN personId needs no screen here — the credential gate returns
 * `person.not_found` for it already.)
 */
function parseDrawerOverride(
  raw: { personId?: unknown; pin?: unknown } | undefined | null,
): { personId: string; pin: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    // `raw.personId` is `unknown` here (a non-string or a non-UUID string); coerce for the debug param,
    // which the ErrorParams type declares `string`. A caller-supplied id is safe to echo.
    throw new AppError("person.not_found", { personId: String(raw.personId) });
  }
  if (typeof raw.pin !== "string") {
    throw new AppError("pin.invalid", {});
  }
  return { personId: raw.personId, pin: raw.pin };
}

/**
 * Screen a body `capacity` as a non-negative int4 before it reaches the `dining_tables.capacity`
 * column (int4) on the create/patch table routes. Optional, so an ABSENT capacity (`undefined`)
 * passes through untouched — the column stays NULL / unchanged; a value present but not a
 * non-negative integer within int4's range (`< 0`, `> 2_147_483_647`, fractional, or not a number)
 * would otherwise reach the insert/update and raise `22003`/`22P02` — a non-AppError the boundary
 * turns into an opaque `server.internal` 500, the same class the `:lineNo` range screen prevents.
 * Refused here as `management.request_invalid` naming the FIELD, the generic request-shape 400 the
 * sibling surfaces (`workforce-api.ts`'s `requireOffsetMinutes`) use for an out-of-range numeric body
 * field. Only the field NAME travels, matching that code's no-value discipline (a headcount is not a
 * secret, but the convention is uniform).
 */
function requireCapacity(capacity: number | undefined): void {
  if (capacity === undefined) return;
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 2_147_483_647) {
    throw new AppError("management.request_invalid", { field: "capacity" });
  }
}

/**
 * Screen a tab `:id` path param as a UUID before it reaches a query — a malformed id passed into
 * `eq(workingOrders.id, id)` would `22P02` → an opaque 500 (the fail-closed shape the working-order
 * routes' `requireUuidId` uses). A non-UUID names no open tab exactly as legitimately as an absent one,
 * so it is refused with `tab.not_open` (409). See Plan note 3 on the param key (`tabId`).
 */
function requireTabParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("tab.not_open", { tabId: id });
  }
  return id;
}

/**
 * Screen a `:lineNo` path param as an in-range int4 line number before it reaches a query — the ONE
 * screen the void-line `DELETE /api/working-orders/:id/lines/:lineNo` (voidTabLine) route and the served
 * POST/DELETE all share. `line_no` is int4 (orders.ts) and `voidTabLine`/`markLineServed`/
 * `unmarkLineServed` bind it parameterised, so a non-numeric value (`NaN`) or a fractional one is
 * refused before any query, and an integer ABOVE int4's max (which clears `Number.isInteger`) is too —
 * un-screened it would reach `where line_no = $n` and raise `22003` (out of range), a non-AppError the
 * boundary turns into an opaque `server.internal` 500. A line number that cannot exist names no line,
 * so it is refused as `tab.line_not_found` (404) — the honest 404 an absent line gets, exactly as the
 * verbs themselves throw for an in-range `line_no` matching nothing. `tabId` travels for the same
 * fail-closed error shape the void-line route carries.
 */
function requireLineNo(tabId: string, raw: string): number {
  const lineNo = Number(raw);
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > 2_147_483_647) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  return lineNo;
}

/**
 * Mount ONE per-course expo/kitchen verb route — `POST /api/orders/:id/courses/:courseId/<suffix>` — the
 * shared shape the three course verbs (`fire`/`ready`/`away`, KDS-2/3 §3c–d) are byte-for-byte identical
 * in. SESSION-GUARDED (`requireSession`, no permission — the `fire_control` venue setting decides which UI
 * SHOWS the button, not who may call it; every surface is session-gated, spec §3c). `:id` (the order) is
 * `isUuid`-screened as `working_order.not_found` (404) and `:courseId` as `course.not_found` (404) BEFORE
 * either reaches a `uuid` column — a malformed id passed straight into `eq(…, id)` would `22P02` → an
 * opaque 500 — then `verb(tx, cfg, orderId, courseId)` runs under the till's tenant/`app_user` scope and
 * the route returns 200 with an empty body (the display re-reads the queue). The three verbs differ only
 * in what they stamp on `ticket_items` and whether they existence-check the course — `fireCourse`/
 * `markCourseAway` do (via `requireCourse`, so an unknown/foreign course is `course.not_found`),
 * `bumpCourseReady` no-throws-on-empty (an unknown course updates zero rows, 200) — but that difference
 * lives IN the verb, not in this route shape. OPERATIONAL, not fiscal: every verb writes only the mutable
 * `ticket_items` (§4/§5), so none can block a sale. Each call site below carries its own verb-specific note.
 */
function mountCourseVerb(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  suffix: string,
  verb: (tx: Transaction, cfg: TillConfig, orderId: string, courseId: string) => Promise<void>,
): void {
  app.post(`/api/orders/:id/courses/:courseId/${suffix}`, (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const courseId = c.req.param("courseId");
      if (!isUuid(courseId)) throw new AppError("course.not_found", { courseId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await verb(tx, deps.cfg, orderId, courseId);
      });
      return c.body(null, 200);
    }),
  );
}

/**
 * Mounts the till's session, roster and boot-info routes on an existing Hono app. Log in / log out,
 * the pre-login staff roster and the public till info live here; Task 6 adds `GET /api/products` and
 * `POST /api/sales` to THIS same function, each handler wrapped in `run` (above) so the whole surface
 * maps errors identically.
 *
 * HANDHELD FIREWALL — the classification a NEW route inherits (spec §5, decision 0.1; owner reversal
 * 2026-08-30, widened same day). A `handheld` device may TAKE and FIRE orders, and may SETTLE a sale on
 * `POST /api/sales` for CASH or a MANUAL card tender — both file under the submitting NODE's SIF
 * (`nodeId`), not the till (record-sale.ts:79-82), so a handheld registro is indistinguishable from a
 * counter one; the manual card is the datáfono leg (a SEPARATE bank terminal the POS never talks to,
 * `recordManualCardPayment` makes no network call), so it needs no reader. What stays fenced is the
 * INTEGRATED card reader (`POST /api/pay`) and the deferred-settlement / amendment-log / drawer writers —
 * every other fiscal record, chain link, invoice number, cash-drawer row or amendment-log entry settles at
 * the fixed till. The fenced routes run `assertNotHandheld` right after `requireSession`; the sale route
 * and the rest run neither. When you add a route, decide which side it is on and, if it touches ANY
 * fiscal/cash write NOT reachable through the node-keyed sale path, FENCE it (fail-safe for fiscal — when
 * in doubt, fence). The full split:
 *
 *   FENCED (integrated card + deferred-settlement / cash / amendment-log writers — `assertNotHandheld`):
 *     POST /api/pay                        pay          — integrated-card reader settlement
 *     POST /api/sales/:id/reprint          reprint      — reprints a FILED fiscal ticket
 *     POST /api/drawer/open                drawer_open  — cash-drawer open + audit row
 *     POST /api/working-orders/:id/place   place        — Mode I files a deferred chained invoice
 *     POST /api/working-orders/:id/collect collect      — Mode T immediate sale / Mode I settlement
 *     POST /api/working-orders/:id/cancel  cancel       — appends `order_cancelled` to the amendment log
 *
 *   ALLOWED (order-taking, the node-keyed sale, floor-ops, reads, config — NO fenced fiscal/cash/amendment
 *     write): the session/locale/roster/boot routes; GET /api/products;
 *     POST /api/sales itself (a handheld settles cash or a manual card there — both file a chained registro
 *     under the node's SIF, no reader, exactly like a counter walk-up sale); the
 *     park/list/retrieve/edit/abandon working-order
 *     routes; send-to-prep and every kitchen/expo verb (fire/ready/away, per-line + whole-ticket bump,
 *     `GET /api/stations`+queues, `GET /api/expo/queue`); the NON-fiscal kitchen handover
 *     `POST /api/orders/:id/collect` (stamps only `collected_at`) and reprint `POST /api/orders/:id/reprint`
 *     (kitchen paper, files nothing); open-tab, add-round, void-line, serve/unserve line; table CRUD +
 *     status + FP-2 placement; and the tab move/join/merge/transfer verbs (all operate on OPEN,
 *     pre-placement tabs and write no fiscal record — verified in working-order.ts: `appendOrderAmendment`
 *     and `recordSale` are reached ONLY by `placeOrder`/`cancelPlacedOrder`/`collectOrder`).
 */
export function mountTillApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  // Log in: verify the operator's PIN and set the httpOnly session cookie. The login runs as the app
  // role under the till's tenant — `withTenant` + `asAppUser`, exactly as the sale path does — so RLS
  // scopes the person lookup to this tenant and a wrong PIN, unknown or suspended person surfaces as
  // the identity credential codes `STATUS` maps to 401/403.
  app.post("/api/session", (c) =>
    run(c, log, async () => {
      const { personId, pin } = await c.req.json<{ personId: string; pin: string }>();
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginWithPin(tx, {
          tenantId: deps.cfg.tenantId,
          tillId: deps.cfg.tillId,
          personId,
          pin,
        });
      });
      setSessionCookie(c, session.id, deps.secureCookies);
      // Surface the derived CAPABILITY the till needs — whether this operator may configure the till
      // (FP-2's on-till "Editar plano") — computed server-side from the session's role via the identity
      // package's own `roleHasPermission`, never mirrored as a role→permission map on the client (which
      // would silently drift from `permissions.ts`). Convenience only: every server gate re-derives the
      // role from the session and re-checks the permission via `authorize` (e.g. the placement route
      // below), so a tampered client value grants nothing.
      const canConfigureTill = roleHasPermission(session.role, "till.configure");
      // `locale` is the operator's OWN UI-language preference (`persons.locale`, carried on the session
      // by `loginWithPin` — Task 3), or null when they have set none. The till app defaults to the
      // venue locale (`GET /api/till`'s `locale`) until login, then switches to this per-user value.
      return c.json({ personId: session.personId, canConfigureTill, locale: session.locale });
    }),
  );

  // Log out: end the shift session and clear the cookie. Idempotent — a request with no cookie, one
  // whose cookie is not even UUID-shaped (so it names no `uuid` row and would 22P02 in the DB), or one
  // naming an already-closed session (`endSession` returns false), still clears the cookie and answers
  // 200, so a double logout or a stale tab is never an error. The `isUuid` screen keeps a malformed
  // cookie a 200 no-op rather than the opaque 500 the raw value would raise (see `till-session.ts`).
  app.delete("/api/session", (c) =>
    run(c, log, async () => {
      const id = readSessionId(c);
      if (id !== null && isUuid(id)) {
        await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await endSession(tx, id);
        });
      }
      clearSessionCookie(c);
      return c.json({ ok: true });
    }),
  );

  // Set the LOGGED-IN operator's OWN UI-language preference (`persons.locale`). SESSION-GUARDED, and
  // the guard — not the body — supplies the identity: the write targets `session.personId`, so an
  // operator can only ever set THEIR OWN locale (the body carries `locale` and nothing else). Read via
  // `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque 500) and flows
  // through the same `locale` coercion below, so a missing/non-string/unparsable `locale` all coerce to
  // `""`, which `setPersonLocale`'s `assertSupportedLocale` rejects as `locale.unsupported` (400) —
  // the ONE rejection path, no separate request-invalid branch. Runs under `withTenant` + `asAppUser`
  // (RLS scopes the UPDATE to this till's tenant), and returns 204 on success (no body).
  app.put("/api/session/locale", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      // `persons` is a sync-enrolled table (identity config flow-down), so `setPersonLocale`'s UPDATE is
      // captured to `sync_log`, stamped with `app.node_id` as its origin. Thread this till's `nodeId` so
      // the write records a REAL origin — a bare 3-arg withTenant leaves it the all-zero uuid, which
      // `source.ts` never delivers and `retention.ts` never prunes (unbounded log growth).
      await withTenant(
        deps.db,
        deps.cfg.tenantId,
        async (tx) => {
          await asAppUser(tx);
          await setPersonLocale(tx, { tenantId: deps.cfg.tenantId, personId, locale });
        },
        { nodeId: deps.cfg.nodeId },
      );
      return c.body(null, 204);
    }),
  );

  // Pre-login roster for the lock screen. Deliberately UNAUTHENTICATED — it is what the operator
  // picks their name from before any session exists — so it calls `listActiveStaff` under
  // `withTenant` + `asAppUser` (RLS scopes it to this till's tenant) rather than `requireSession`.
  // `listActiveStaff` returns `{ personId, displayName }` only: no PIN material, role or status, so
  // there is nothing here a bystander at the counter must not see.
  app.get("/api/staff", (c) =>
    run(c, log, async () => {
      const staff = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listActiveStaff(tx);
      });
      return c.json(staff);
    }),
  );

  // Public boot info for the till app. Also UNAUTHENTICATED (the browser fetches it before login) and
  // deliberately free of secrets: `venueName` + `nif` are the receipt-issuer identity legally printed
  // on every customer ticket (Task 17's ticket view reads them from here, so its client never touches
  // server code), `locale` drives the UI language, and `orderFlow` (7c prepare & collect) is the
  // location's pay-timing mode — already resolved onto `deps.cfg` at boot (`readOrderFlow`,
  // `till-config.ts`), so this is a plain field read, no extra query. The till UI needs it BEFORE
  // login to select which pay control to render (Place/Collect for Modes I/T vs the unchanged Pay for
  // Mode P), so it rides on this same unauthenticated boot-info route rather than a session-guarded
  // one. `venueName`/`nif` still come from the `tenants` row under `withTenant` + `asAppUser`:
  // `app_user` holds SELECT on `tenants` and RLS scopes it to this till's own tenant row, so the
  // `eq(id)` filter selects exactly that row.
  app.get("/api/till", (c) =>
    run(c, log, async () => {
      // Resolve the CALLING device (if any) BEFORE the boot transaction: `tryReadDevice` opens its OWN
      // `withTenant` tx (auth + `last_seen_at`), so it cannot nest inside the read below. EVERY request
      // resolves a canvas: a cookieless request (no device) gets the `till` form-factor default, and an
      // ENROLLED device gets its assigned `canvasId` if set and resolvable, else the built-in default for
      // its form factor (SP-B4, generalising SP-B1 / SP-A.2 §16.3). The counter therefore always has a
      // canvas to render from.
      const device = await tryReadDevice({ db: deps.db, cfg: deps.cfg, devMode: deps.devMode }, c);
      // ONE transaction reads the issuer identity and the authored receipt trim (`getReceipt`, its own
      // `tenant_receipts` row — SP-B4), plus the resolved canvas below: all run inside the same
      // `withTenant` + `asAppUser` block (RLS scopes each to this till's tenant), never a second
      // connection. `getReceipt` does not authorize — this boot read is deliberately unauthenticated (the
      // browser fetches it before login), and it carries no secrets, only the receipt trim + canvas, same
      // as `venueName`/`orderFlow` already here.
      const boot = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const [row] = await tx
          .select({ venueName: tenants.legalName, nif: tenants.taxId })
          .from(tenants)
          .where(eq(tenants.id, deps.cfg.tenantId));
        // The venue's KDS whole-ticket bump mode (KDS-1 §2e, `locations.bump_mode`) — read HERE from
        // the till's own location rather than off `deps.cfg` like `orderFlow`: `orderFlow` rides the
        // config because the SALE PATH dispatches on it, whereas `bump_mode` has no server-side
        // consumer at all (it drives only the client's whole-ticket affordance), so it is read where
        // it is used and kept off the config surface. Same `eq(id)` shape `readOrderFlow` uses, under
        // the same RLS scope, so it selects exactly this till's location row.
        // `fire_control` (KDS-2 §2c) rides the SAME location read as `bump_mode` — both are
        // client-only display-convenience flags with no server-side sale-path consumer, so both are
        // read here where they are used rather than lifted onto `deps.cfg`. The station-display screen
        // reads it to show the per-course kitchen-fire action only for a `kitchen` venue.
        const [loc] = await tx
          .select({ bumpMode: locations.bumpMode, fireControl: locations.fireControl })
          .from(locations)
          .where(eq(locations.id, deps.cfg.locationId));
        // The venue's ACTIVE kitchen courses (KDS-2 §5b), by `display_order` then name — the coursing
        // sequence the tab-order screen's per-line course picker offers, and the id→name map its
        // waiter-fire actions read. Rides this same unauthenticated boot read for the same reason as
        // `bump_mode`/`fire_control`: venue KDS config with no secrets, no server-side sale-path consumer,
        // read where it is used rather than lifted onto `deps.cfg`. Trimmed to the picker's shape
        // (`active` is always true here — `listCourses` is active-only — so it is dropped from the wire).
        const courses = (await listCourses(tx, deps.cfg)).map((course) => ({
          id: course.id,
          name: course.name,
          displayOrder: course.displayOrder,
        }));
        // The authored receipt trim, or the built-in default when the tenant has never opened the editor:
        // `getReceipt` reads it from `tenant_receipts`, returning DEFAULT_RECEIPT on absence — no backfill.
        const receipt = await getReceipt(tx, deps.cfg.tenantId);
        // SP-B4: EVERY request resolves a CanvasDef (never undefined), so the counter always has a canvas
        // to render. Cookieless (no device) → the `till` form-factor default (`getCanvasForFormFactor`
        // falls back to DEFAULT_CANVASES.till when the tenant has authored none). An enrolled device →
        // its explicitly assigned canvas if the id resolves, else the built-in/default canvas for its
        // form factor.
        let canvas: CanvasDef;
        if (device != null) {
          let assigned: CanvasDef | undefined;
          if (device.canvasId != null) {
            assigned = (await getCanvas(tx, deps.cfg.tenantId, device.canvasId))?.definition;
          }
          // The `?.definition` (getCanvas's return is optional) then `??` is belt-and-braces: a
          // NON-null `canvasId` that resolves to NO canvas is UNREACHABLE by construction, so it
          // is intentionally untested. The composite FK `devices(tenant_id, canvas_id) →
          // canvases(tenant_id, id)` is ON DELETE RESTRICT
          // (packages/db/drizzle/0095_parched_meteorite.sql:16), enforced even on PGlite: a device can
          // neither be enrolled with a non-existent canvas id (FK violation at insert) nor keep a
          // reference to a canvas deleted out from under it (RESTRICT blocks the delete). The `??` still
          // yields a valid form-factor default should that invariant ever be relaxed.
          canvas =
            assigned ??
            (await getCanvasForFormFactor(tx, deps.cfg.tenantId, deviceFormFactor(device.kind)));
        } else {
          canvas = await getCanvasForFormFactor(tx, deps.cfg.tenantId, "till");
        }
        return {
          issuer: row,
          bumpMode: loc?.bumpMode,
          fireControl: loc?.fireControl,
          courses,
          receipt,
          canvas,
        };
      });
      /* v8 ignore start */
      if (
        boot.issuer === undefined ||
        boot.bumpMode === undefined ||
        boot.fireControl === undefined
      ) {
        // Structurally unreachable: `deps.cfg.tenantId`/`locationId` are the till's own tenant and
        // location (provisioning stamped both), so their rows always exist and RLS returns them. A
        // misconfigured till pointed at a nonexistent tenant/location becomes an opaque 500 via `run`,
        // never a partial payload.
        throw new Error(`GET /api/till: no tenant/location row for ${deps.cfg.tenantId}`);
      }
      /* v8 ignore stop */
      return c.json({
        // The venue's DEFAULT UI locale (`readVenueLocale`, boot.ts) — geography-derived + override,
        // NOT the fiscal `cfg.locale`. The till app defaults its language to this until a per-user
        // preference is loaded; `GET /api/locales` returns the same value as `venueDefault`.
        locale: deps.venueLocale,
        // The RECEIPT (fiscal document) locale — the language the printed legal ticket renders in.
        // Sourced from the fiscal `cfg.locale` (the pre-per-user-locale `locale` value), DELIBERATELY
        // kept SEPARATE from the UI `locale` above: the venue-default UI derivation drops
        // UI-unsupported codes (a `ca-ES` fiscal locale would surface as `es-ES` there), which must
        // never reach the receipt. Decision 2 of the per-user-language spec: the receipt is the
        // venue's language and is not an input to the UI derivation. The till threads THIS to
        // `till-ticket-view.invoiceLocale`, and the UI `locale` to `setLocale` — two different things.
        invoiceLocale: deps.cfg.locale,
        venueName: boot.issuer.venueName,
        nif: boot.issuer.nif,
        orderFlow: deps.cfg.orderFlow,
        // The venue's whole-ticket bump mode (KDS-1 §2e), read from the location above — the till app
        // threads it to the station-display screen to enable/disable the whole-ticket bump affordance.
        bumpMode: boot.bumpMode,
        // The venue's KDS fire-control mode (KDS-2 §2c), read from the location above — the till app
        // threads it to the station-display screen, which shows the per-course kitchen-fire action only
        // when this is `kitchen` (under `waiter` the tab screen owns the fire, Task 7).
        fireControl: boot.fireControl,
        // The venue's ACTIVE kitchen courses (KDS-2 §5b) — the tab-order screen's course picker options
        // and the id→name source for its waiter-fire actions. `[]` for a venue with no courses configured.
        courses: boot.courses,
        // The integrated card terminal (sub-project 7): the STRING provider selector and the tip flag
        // the till app reads BEFORE login to pick its card-collect route and show/hide the tip
        // affordance (Task 8). `cardProvider` is the config selector (`deps.cfg.cardProvider`), not the
        // built `PaymentProvider` on `deps` — the client needs the mode name, not the server object.
        // `tipsEnabled` comes from `deps.cfg` too — the single source (`TillConfig.tipsEnabled`,
        // set at boot from `config.till`), not a second copy on `deps` that could drift from it.
        cardProvider: deps.cfg.cardProvider,
        tipsEnabled: deps.cfg.tipsEnabled,
        // The authored (or default) receipt trim (Task 8) — the till app threads it to its ticket view.
        // Rides this same unauthenticated boot fetch, so the till makes no second request.
        receipt: boot.receipt,
        // The calling device's resolved layout CANVAS (SP-B4), a bare `CanvasDef`, ALWAYS present so the
        // counter always has a canvas to render. For an enrolled device it is the assigned canvas if the
        // `canvasId` resolves, else the built-in default for its form factor; for a cookieless request it
        // is the `till` form-factor default. There is no longer a `layout` field — the canvas replaces it.
        canvas: boot.canvas,
      });
    }),
  );

  // The public supported-locale list + the venue's default UI locale. Deliberately UNAUTHENTICATED
  // (the till app fetches it before login, beside `GET /api/till`) and free of secrets — `locales` is
  // the static catalogue the language picker offers and `venueDefault` is the geography-derived boot
  // value (`deps.venueLocale`). NO session gate, matching the sibling `GET /management-api/locales`.
  app.get("/api/locales", (c) =>
    run(c, log, async () => c.json({ locales: SUPPORTED_LOCALES, venueDefault: deps.venueLocale })),
  );

  // The sellable catalogue for this till's location. SESSION-GUARDED: `requireSession` runs FIRST, so
  // an unauthenticated request 401s (`session.required`) before any catalogue is read — the operator
  // must be logged in to see prices. The read itself runs as the app role under the till's tenant
  // (`withTenant` + `asAppUser`), so RLS scopes both reads to this tenant's own rows. `menus` (the
  // location's accessible catalogues, default flagged, for the till's menu switcher) and `products`
  // (tagged with the catalogue each came from) are read in the SAME transaction so they describe one
  // consistent snapshot of the accessible set.
  app.get("/api/products", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const { menus, products } = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return {
          menus: await listAccessibleCatalogues(tx, deps.cfg.locationId),
          products: (await listAvailableProducts(tx, deps.cfg.locationId)).products,
        };
      });
      return c.json({ menus, products });
    }),
  );

  // Ring one walk-up sale — the HTTP face of the fiscal sale path. SESSION-GUARDED, and the guard
  // supplies the attribution: the sale is filed as `operatorId = session.personId`, so who rang it is
  // the logged-in operator, never a browser-sent value. `recordTillSale` opens its OWN
  // `withTenant`/`asAppUser` transaction and re-prices the basket authoritatively (the request
  // carries no price), so it is called OUTSIDE any transaction here — nesting would deadlock the pool.
  // The sale route neither opens nor rotates the session, so it emits no Set-Cookie.
  app.post("/api/sales", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // NOT fenced against a handheld (owner reversal, widened 2026-08-30): `POST /api/sales` settles a
      // cash OR a manual-card tender, and both file under the submitting node's SIF (`nodeId`), not the
      // till (record-sale.ts:79-82). The manual `card` tender is the datáfono leg — the operator charges a
      // SEPARATE bank terminal the POS never talks to (`recordManualCardPayment` makes no network call), so
      // it is fiscally identical to cash and needs no reader. Only the INTEGRATED reader (`POST /api/pay`,
      // below) stays fenced (`assertNotHandheld`). An ordinary till carries no device cookie either way.
      const body = await c.req.json<TillSaleRequest>();
      // `workingOrderId` is OPTIONAL: absent (a walk-up `recordTillSale` mints a fresh id for) and a
      // well-formed-but-unknown one are both valid; only a MALFORMED one is an error. Un-screened it
      // becomes `payWorkingOrder`'s `req.id` and `22P02`s at its `eq(workingOrders.id, req.id)` lock read
      // (till-sale.ts) → an opaque 500 (the 7b follow-up). `requireUuidParam` refuses it 400 first.
      if (body.workingOrderId !== undefined) {
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      }
      // SP-A.2 §16.4 cutover: the sale's `till_id` comes from the AUTHENTICATED enrolled device, not env.
      // Only `tillId` changes — `nodeId`/`seriesId` (the SIF/chain key) stay `deps.cfg`; a `DeviceBinding`
      // carries no node/series. `recordTillSale` reads `cfg.tillId` unchanged, now the device's via `saleCfg`.
      const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c) };
      const result = await recordTillSale(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        saleCfg,
        body,
        personId,
      );
      return c.json(result);
    }),
  );

  // Pay over the INTEGRATED card terminal (sub-project 7, Task 7) — a DELIBERATE divergence from
  // /api/sales's throw-or-ticket shape: a payment outcome (declined / network-unavailable) is neither
  // a client (4xx) nor a server (5xx) fault, so `payWorkingOrderIntegrated` returns it as DATA and this
  // route answers 200 with the outcome UNCHANGED, even a decline (nothing may block a sale on anything
  // but the sale itself, CLAUDE.md §5). Genuine faults still throw and map through `run`: an empty
  // walk-up basket surfaces `sale.empty_basket` (400), a non-open/placed order `working_order.not_open`
  // (409), and corruption or any other unexpected failure the opaque `server.internal` (500) every
  // route gets — the same `STATUS` table above, unchanged. SESSION-GUARDED like `/api/sales`;
  // `operatorId` is `session.personId`, never a browser-sent value.
  app.post("/api/pay", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Resolve the calling device ONCE and thread it to both device guards below (the capability
      // firewall and `requireSaleTillId`): `tryReadDevice` opens a `withTenant` tx and runs the CPU-heavy
      // scrypt `verifySecret`, so a single read keeps both — and the one gated `last_seen_at` sighting —
      // off the redundant second pass. `null` (no cookie) still threads through fail-closed.
      const device = await tryReadDevice(deps, c);
      // Capability firewall (SP-A.2 §16): integrated card pay drives a real reader, so it requires the
      // device's assigned canvas to declare `integrated-card-payment`. This generalises the old
      // hardcoded handheld check — a handheld carries a capability-less canvas (or none), so it is
      // still refused `device.forbidden_action` (403) here, before the provider guard and any fiscal
      // write, so the fence holds even if the client were bypassed. A cookie-less caller passes THIS
      // capability guard (there is no device to check) — but the route still nets to a rejection, because
      // `requireSaleTillId` below fails closed with `device.unauthorized` on a missing cookie (§16.4): an
      // ordinary env-only till is no longer a sellable box on `/api/pay`. (A handheld may still settle a
      // cash or manual-card sale on `/api/sales`, node-keyed, which runs NO capability guard — only the
      // INTEGRATED leg here is fenced.)
      await assertDeviceCapability(deps, c, "integrated-card-payment", "pay", device);
      const body = await c.req.json<IntegratedPayRequest>();
      // The pay-body `id` is REQUIRED (it names the order to charge), and un-screened it `22P02`s at
      // `payWorkingOrderIntegrated`'s `eq(workingOrders.id, req.id)` lock read (till-sale.ts) → an opaque
      // 500 — the identical exposure to `/api/sales`'s `workingOrderId`. Screened here (before the
      // provider guard, so a malformed body is a 400 whatever the till's card config) as the 7b sibling.
      requireUuidParam(body.id, "WorkingOrderId");
      // `deps.cardProvider` is `undefined` on a till booted with `WAITRON_TILL_CARD_PROVIDER=none`
      // (`boot.ts`'s `buildCardProvider`). `mountTillApi` mounts this route on EVERY till regardless of
      // `cardProvider` (`boot.ts` calls it unconditionally), so this branch stays reachable at the HTTP
      // layer even on a "none" till — only the till UI's own affordance is expected not to post here.
      // A request that does is therefore a genuine misconfiguration/foreign-request fault, never a
      // payment outcome, refused BEFORE any DB write. Covered directly by
      // `till-api.test.ts` ("500s server.internal when the till has no integrated card provider
      // configured"), not ignored.
      if (deps.cardProvider === undefined) {
        throw new Error("/api/pay: no integrated card provider configured");
      }
      // SP-A.2 §16.4 cutover: the integrated pay's `till_id` comes from the AUTHENTICATED device, not env
      // (only `tillId` changes — `nodeId`/`seriesId` stay `deps.cfg`). Resolved AFTER the capability
      // firewall + provider guard so those refusals keep their existing status; the reader-identity till
      // (`provider.collect`) moves to the same device till, consistent with the fiscal record it files.
      // Threads the once-resolved `device` so the fail-closed `unauthorized`/`till_required` checks reuse
      // the binding read above rather than a second scrypt pass.
      const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c, device) };
      const outcome = await payWorkingOrderIntegrated(
        { db: deps.db, backend: deps.backend, clock: deps.clock, provider: deps.cardProvider },
        saleCfg,
        body,
        personId,
      );
      return c.json(outcome); // 200 with the discriminated outcome — even a decline.
    }),
  );

  // Park a working order to pay later (park & retrieve, sub-project 7b). SESSION-GUARDED like the
  // sale routes: `requireSession` runs FIRST, and the guard — not the browser — supplies the
  // attribution, so `operatorId` is `session.personId`. The client mints `body.id` and holds it stable
  // across a retry, which makes park IDEMPOTENT: a re-sent park (a lost-response retry) PK-collides on
  // the primary key, and `parkOrder` catches that 23505 and REPLAYS the existing open order's
  // `{ id, orderNumber }` — the same idempotent-replay shape pay uses (`payWorkingOrder`) — so at most
  // one order is ever parked for the id and the retry sees the original result (a colliding id whose row
  // is no longer open re-throws the raw 23505). `parkOrder` re-reads the catalogue and prices
  // authoritatively (the request carries no price), opening its OWN `withTenant`/`asAppUser` transaction,
  // so it is called OUTSIDE any transaction here. Returns the persisted `{ id, orderNumber }`.
  app.post("/api/working-orders", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await c.req.json<{
        id: string;
        // A parked line MAY carry per-line `LineExtras` (NON-FISCAL) — forwarded to `parkOrder` →
        // `priceOrderLines`, which validates + persists them on the parent dish line.
        lines: ({ productId: string; quantity: string } & LineExtras)[];
        label?: string;
      }>();
      // The client MINTS `body.id` — it becomes the `working_orders.id` PK `createOpenOrder` INSERTs
      // (a `uuid` column), so un-screened a malformed one `22P02`s → an opaque 500, the same 7b exposure
      // as the sale/pay bodies. (Distinct from the 23505 re-park idempotency `parkOrder` now handles: that
      // is a VALID id colliding with an existing open row, which REPLAYS; this is a malformed one refused
      // before any INSERT.)
      requireUuidParam(body.id, "WorkingOrderId");
      const result = await parkOrder({ db: deps.db }, deps.cfg, {
        id: body.id,
        lines: body.lines,
        label: body.label,
        operatorId: personId,
      });
      return c.json(result);
    }),
  );

  // The cross-till held list for this node: every OPEN working order any register on the node can
  // retrieve. SESSION-GUARDED — the operator must be logged in to see parked orders. `listHeldOrders`
  // is node- and (via RLS) tenant-scoped from `deps.cfg`; the browser names nothing.
  //
  // LATENT MIRROR TRAP (whole-branch review, membership promotion R3a): this and every other till/KDS
  // read below that filters by `deps.cfg.nodeId` (`getHeldOrder`; `listStationQueue`/`listExpoQueue` in
  // working-order.ts) is scoped to the SERVER'S OWN node id. Since R3a a mirror runs under its OWN
  // reserved id, distinct from the primary it replicates from — but `working_orders`/`ticket_items` are
  // sync-enrolled, so a replicated row on a mirror still carries the PRIMARY's `node_id`. Filtering by
  // the mirror's own id would therefore return EMPTY on a mirror, not the primary's data (unlike
  // `report-api.ts`, which was fixed to resolve `dataNodeId` = the origin on a mirror — see its comment
  // near `mirror-e2e.rls.test.ts:39`). These reads were NOT given the same fix, deliberately:
  // `deps.cfg.nodeId` also stamps WRITE origin on this surface (sale/park/fire — `cfg.nodeId` at
  // record-sale.ts:79-82 and elsewhere in this file), so blanket-swapping it for the origin would corrupt
  // that. The routing fix belongs to the till-side reroute slice (R3b+).
  //
  // It is safe TODAY only because no till session can exist on a mirror to REACH this filter:
  // `POST /api/session` (till PIN login) is a write, and the read-only gate (`read-only-gate.ts`) 403s
  // every non-GET on a mirror with no path exceptions, so `requireSession` — which every route below
  // calls FIRST — always 401s (`session.required`) before `listHeldOrders`/`getHeldOrder` ever run. The
  // ambient viewer (`mirror-session.ts`) only auto-authenticates the MANAGEMENT session, never a till
  // one. `boot.mirror.rls.test.ts` pins this reachability with a guard test; if a later slice makes a
  // till session reachable on a mirror (the till-side reroute itself, or an ambient till viewer), THAT
  // slice must route these reads through the displayed-data node — the way `report-api` does — before
  // whatever makes the session reachable ships.
  app.get("/api/working-orders", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const orders = await listHeldOrders({ db: deps.db }, deps.cfg);
      return c.json(orders);
    }),
  );

  // Retrieve one parked order to rebuild its basket. SESSION-GUARDED. An id naming no OPEN order THIS
  // node may reach (an absent, settled/abandoned, another tenant's — RLS hides it — or a same-tenant
  // order on ANOTHER node, the by-id lookups being node-scoped) surfaces `working_order.not_found`,
  // which `STATUS` maps to 404. Returns `{ id, orderNumber, label, lines }` — the pricing INPUTS only,
  // never a stored price, so the till re-prices on retrieve. The id is `isUuid`-screened before the
  // query: a malformed one passed straight into `eq(workingOrders.id, id)` would `22P02` → an opaque
  // 500 (the 7b follow-up), so it is refused as `working_order.not_found` — the SAME 404 an absent open
  // order gets.
  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const order = await getHeldOrder({ db: deps.db }, deps.cfg, id);
      return c.json(order);
    }),
  );

  // Edit a parked order — the whole new basket plus an optional new label, a full REPLACEMENT.
  // SESSION-GUARDED. Only an `open` order on THIS node may change; a non-open, unknown, or foreign-node
  // id surfaces `working_order.not_open` → 409. `updateHeldOrder` re-prices authoritatively (the request carries
  // no price) and returns nothing, so this answers 200 with an empty body. The id is `isUuid`-screened
  // before the query, refused as `working_order.not_open` → 409 — the SAME code a non-open/absent id
  // gets — rather than the `22P02`-driven opaque 500 the raw value would raise (the 7b follow-up).
  app.put("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const body = await c.req.json<{
        // A line MAY carry per-line `LineExtras` (NON-FISCAL) — forwarded to `updateHeldOrder` →
        // `priceOrderLines`, which validates + persists them on the parent dish line.
        lines: ({ productId: string; quantity: string } & LineExtras)[];
        label?: string;
      }>();
      await updateHeldOrder({ db: deps.db }, deps.cfg, id, {
        lines: body.lines,
        label: body.label,
      });
      return c.body(null, 200);
    }),
  );

  // Discard a parked order (`open → abandoned`). SESSION-GUARDED. A non-open, unknown, or foreign-node
  // id surfaces `working_order.not_open` → 409, the same open-only guard `updateHeldOrder` makes. Returns 200 with
  // an empty body. The id is `isUuid`-screened before the query, refused as `working_order.not_open`
  // → 409 — the SAME code — rather than the `22P02`-driven opaque 500 the raw value would raise (the
  // 7b follow-up).
  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await abandonHeldOrder({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  // Place a working order (7c prepare & collect, design §3): `open → placed`, freezing composition
  // and opening the amendment log — and, for Modes I/T, enqueueing the node-scoped prep row at
  // `queued` (send-to-prep = placing, inside `placeOrder` itself). SESSION-GUARDED — `operatorId` is
  // `session.personId`, never a browser-sent value, both for the amendment's `actor_id` and (Mode I)
  // the deferred invoice's attribution. The id is `isUuid`-screened BEFORE any query: passed straight
  // into `eq(workingOrders.id, id)` a malformed one would `22P02` in the DB → an opaque 500 (the 7b
  // follow-up docs/backlog.md names), so it is refused as `working_order.not_open` instead — the SAME
  // code an absent id gets, the fail-closed shape that code's own note in `errors.ts` describes.
  app.post("/api/working-orders/:id/place", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall (spec §5): placing a Mode-I order FILES a deferred chained invoice
      // (`placeOrder` → `recordSale`) — the unrecoverable fiscal record (CLAUDE.md §5) — so a handheld,
      // which never settles THROUGH place (that deferred invoice settles at the fixed till; a handheld's
      // settlement is a cash or manual-card sale on `/api/sales`), is refused `device.forbidden_action` (403) HERE,
      // before the id parse and any fiscal write, exactly as pay/collect are. An ordinary till carries no
      // device cookie and passes.
      // Resolve the calling device ONCE and thread it to both the handheld firewall and `requireSaleTillId`
      // below, so scrypt + the `withTenant` read run once per request rather than twice (perf; §16 path).
      const device = await tryReadDevice(deps, c);
      await assertNotHandheld(deps, c, "place", device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      // SP-A.2 §16.4 cutover: a Mode-I place files a deferred chained invoice under the AUTHENTICATED
      // device's `till_id`, which `placeOrder` takes as `saleTillId`. That device till reaches the FISCAL
      // record ONLY; the `order_placed` amendment's `capturedByTillId` stays the box's CONFIGURED register
      // (`deps.cfg.tillId`), matching `cancelPlacedOrder` so a re-homed box's place/cancel history agrees.
      const saleTillId = await requireSaleTillId(deps, c, device);
      const result = await placeOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
        id,
        personId,
        saleTillId,
      );
      return c.json(result);
    }),
  );

  // Send a SETTLED order to the kitchen — Mode P's pickup (design §5, reworked to KDS-1's ticket model).
  // SESSION-GUARDED. `sendToPrep` fires the order's lines through the shared `fireLines`, inserting one
  // `ticket_items` row per line, each routed to a station (product ?? category ?? default) SNAPSHOTTED at
  // fire time. It is the ONE fire path with a public route (place fires inside `placeOrder`; a tab round
  // fires inside `addTabRound`), so this route stays — but it no longer advances anything (the removed
  // `advancePrep` `{ to }` branch is gone; advancing is now per-line/whole-ticket, below). A non-settled,
  // absent or foreign order is refused `working_order.not_settled` (409) BEFORE any write; a re-fire of an
  // already-sent order collides on the per-line unique and is refused `ticket.already_fired` (409, mapped
  // in `fireLines`) rather than an opaque 500; a venue with no default station fails the fire loud with
  // `station.no_default` (409). The id is `isUuid`-screened before any query, refused as
  // `working_order.not_settled` — the SAME code a non-settled/absent id gets — rather than the `22P02`
  // opaque 500 the raw value would raise. Returns 200 with an empty body.
  app.post("/api/working-orders/:id/prep", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      await sendToPrep({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  // The venue's ACTIVE kitchen stations (KDS-1, design §3f), for the station-display picker. SESSION-
  // GUARDED (kitchen staff log in with a PIN and pick a station, §0). `listStations` is RLS- + location-
  // scoped from `deps.cfg`, ordered by display order then name — the same LIST-ONLY, active-only shape
  // `GET /api/zones` uses; station CRUD is the MANAGEMENT API's, so this surface throws no config code.
  app.get("/api/stations", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const stations = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listStations(tx, deps.cfg);
      });
      return c.json(stations);
    }),
  );

  // One station's kitchen queue (KDS-1, design §3c/§3f) — this node's ticket items AT `:id`, grouped by
  // order, oldest first. SESSION-GUARDED. `listStationQueue` is node- + (via RLS) tenant-scoped from
  // `deps.cfg`. The `:id` is `isUuid`-screened first: an unknown station id already yields an empty
  // queue (it names no items), so a MALFORMED one — which likewise names no live station — is refused
  // `station.not_found` (404) rather than reaching the `station_id` uuid column and raising `22P02` → an
  // opaque 500, the SAME 404 the config surface gives an absent station.
  app.get("/api/stations/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
      const queue = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listStationQueue(tx, deps.cfg, id);
      });
      return c.json(queue);
    }),
  );

  // Bump ONE ticket item one kitchen step (KDS-1 §3c) — the per-line advance that is the source of truth.
  // Body `{ to }` (`"preparing" | "ready"`). SESSION-GUARDED. `advanceTicketItem` is a single conditional
  // UPDATE: a skip/repeat/backwards move, an absent/foreign item, OR any non-{preparing,ready} `to`
  // (including a missing body — the verb's TICKET_TRANSITIONS-table lookup throws BEFORE any query when
  // `to` is not a key, so no bad enum reaches the DB) all surface `ticket.invalid_transition` (409). The
  // `:id` is `isUuid`-screened first, refused as that SAME code — a malformed id names no item exactly as
  // an absent one — rather than a `22P02` 500. Returns 200 with an empty body; the display re-reads the
  // station queue.
  app.post("/api/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("ticket.invalid_transition", { ticketItemId: id });
      const body = await c.req.json<{ to?: string }>();
      // `body.to` reaches `advanceTicketItem` as-is (cast): the verb owns the target validation, throwing
      // `ticket.invalid_transition` for `"queued"`, a missing field, or any garbage value — no route-level
      // `to` screen is needed because the verb's TICKET_TRANSITIONS-table lookup never lets an invalid
      // value reach the enum column (a lookup miss is refused before the update runs, not after).
      const to = body.to as TicketState;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await advanceTicketItem(tx, deps.cfg, id, to);
      });
      return c.body(null, 200);
    }),
  );

  // Bump a WHOLE ticket — every not-yet-`to` line of one order at one station (KDS-1 §3c) — the
  // convenience the `bump_mode = 'ticket'` venue setting (and a "bump all" affordance) drives, over the
  // per-line truth above. `:id` is the order, `:sid` the station; body `{ to }` (`"preparing" | "ready"`).
  // SESSION-GUARDED. UNLIKE the per-line verb, `advanceTicket` has no target-validation switch and NO-OPs
  // on an empty match by design (bumping a ticket whose lines have all advanced is a convenience, not an
  // error), so the route screens `to` itself — a non-{preparing,ready} value is `management.request_invalid`
  // (400, the request-shape code the sibling routes use), which also keeps a bad enum off the column. A
  // malformed order/station id names nothing, which is the SAME no-op the verb makes for an unknown one, so
  // it is screened to a clean 200 (never the `22P02` 500 the raw value would raise). Returns 200 empty.
  app.post("/api/orders/:id/stations/:sid/advance", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const orderId = c.req.param("id");
      const stationId = c.req.param("sid");
      const body = await c.req.json<{ to?: string }>();
      if (body.to !== "preparing" && body.to !== "ready") {
        throw new AppError("management.request_invalid", { field: "to" });
      }
      // Bind `to` to a local: the narrowing above does not survive into the `withTenant` closure (a
      // captured property resets to its declared `string | undefined`), the login/create-person pattern.
      const to = body.to;
      if (!isUuid(orderId) || !isUuid(stationId)) return c.body(null, 200);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await advanceTicket(tx, deps.cfg, orderId, stationId, to);
      });
      return c.body(null, 200);
    }),
  );

  // Fire a HELD course of an order (KDS-2 §3c) — the operator's "release this course" action. `fireCourse`
  // stamps `fired_at = now()` on every HELD item of this order + course, so they stop being greyed on the
  // display and become advanceable. EXISTENCE-checks the course (`requireCourse`, EXISTENCE-not-liveness),
  // so a DEACTIVATED course still fires and an absent/foreign one is `course.not_found` (404). Shared route
  // shape, session gate and id screens are `mountCourseVerb`'s.
  mountCourseVerb(app, deps, log, "fire", fireCourse);

  // The expo (pass) queue (KDS-3 §3d) — this node's live orders, aggregated into courses ACROSS stations,
  // for the expediter's display. SESSION-GUARDED (kitchen/pass staff log in with a PIN, §0). `listExpoQueue`
  // is node- + (via RLS) tenant-scoped from `deps.cfg` — the SAME LIST-ONLY, session-gated shape the
  // station queue (`GET /api/stations/:id/queue`) and the station list (`GET /api/stations`) use, minus a
  // path param: the pass is the whole node's, so there is nothing to screen. Returns the `ExpoOrder[]`
  // aggregation (orders oldest-first, courses by display_order, each item carrying its station name +
  // fired/away roll-ups); the display re-reads it after each bump/dispatch. READ-ONLY, no fiscal touch.
  app.get("/api/expo/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const queue = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listExpoQueue(tx, deps.cfg);
      });
      return c.json(queue);
    }),
  );

  // Bump a WHOLE course to `ready` across every station (KDS-3 §3d) — the expediter's "this course is all
  // plated" lever on the pass. UNLIKE the fire/away verbs, `bumpCourseReady` does NOT existence-check the
  // course (it is `advanceTicket`'s no-throw-on-empty bulk shape): a well-formed-but-unknown course, or one
  // with nothing fired left to bump, updates zero rows and returns 200. Shared route shape, session gate
  // and id screens are `mountCourseVerb`'s.
  mountCourseVerb(app, deps, log, "ready", bumpCourseReady);

  // Dispatch a plated course to the floor (KDS-3 §3d) — the expediter's "this course is away" verb, the
  // pass counterpart to `ready`. Like `fire`, `markCourseAway` EXISTENCE-checks the course (`requireCourse`,
  // EXISTENCE-not-liveness — a course deactivated while holding plated items is still dispatchable), so a
  // well-formed-but-unknown/foreign course is `course.not_found` (404). It stamps `away_at = now()` on this
  // course's `ready` items (idempotent: already-away items are skipped). Shared route shape, session gate
  // and id screens are `mountCourseVerb`'s.
  mountCourseVerb(app, deps, log, "away", markCourseAway);

  // Hand a SETTLED, fired order to the customer — Mode P's counter handover (KDS-1 §3e). SESSION-GUARDED.
  // `markCollected` stamps the order-level `collected_at`, which drops the order off `listStationQueue`
  // (the display shows an order until it is collected). NON-FISCAL — it writes ONLY `collected_at`,
  // touching no sale/registro/tender/huella (the order was already paid + filed at settle). DISTINCT from
  // the placed-collect FISCAL route `POST /api/working-orders/:id/collect` (`collectOrder`), hence the
  // distinct `/api/orders/:id/collect` path (the sibling `/api/orders/:id/stations/:sid/advance` already
  // lives here). A non-settled/absent/foreign id is refused `working_order.not_settled` (409), an
  // already-handed-over order `working_order.already_collected` (409), and an order never fired
  // `ticket.not_fired` (409) — all BEFORE any write. The id is `isUuid`-screened first, refused as
  // `working_order.not_settled` (the SAME code an absent/non-settled id gets) rather than the `22P02`
  // opaque 500 the raw value would raise. Returns 200 with an empty body; the display re-reads the queue.
  app.post("/api/orders/:id/collect", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      await markCollected({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  // Reprint an order's current kitchen tickets (KDS-4 §3d) — the operator's "a jam ate the paper, print
  // it again" lever, surfaced on the station display + expo. SESSION-GUARDED: an OPERATIONAL floor action
  // a logged-in operator takes, gated by the session (not a permission), like the fire/bump verbs.
  // `reprintOrderTickets` re-queries the order's currently-fired `ticket_items` and re-enqueues the WHOLE
  // current ticket through the SAME never-block outbox path a fire uses (design §3d/§4) — so a
  // broken/absent printer can never make this hang, and it touches no fiscal record. An order with no
  // fired items (unknown/never-fired, or all-held) enqueues nothing and is a 200 NO-OP — no new error
  // code (design §6). The `:id` is `isUuid`-screened first, refused as `working_order.not_found` (404,
  // the honest "no such order") rather than the `22P02` opaque 500 a malformed value would raise in the
  // uuid column. Returns 200 with an empty body; the display re-reads its queue.
  app.post("/api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await reprintOrderTickets(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  // Reprint a FILED sale's customer receipt to the till's printer (counter receipt/drawer §3d) — the
  // operator's "print it again" lever on the ticket screen. SESSION-GUARDED (an operational action, like
  // the kitchen reprint above). The `:id` is the till's WORKING-ORDER id — the id the till holds after a
  // sale (`#store.id`, the client-minted key it sent on `POST /api/sales`); `reprintSale` reads the
  // ALREADY-FILED sale back by it (`readSettledTicket` reads ANY invoice filed under this id — incl. a
  // Mode-I one filed at placement, a genuine legal document with `change` "0.00"; the name predates that
  // case and the reprint UI only surfaces post-collect, so reprinting a placed order is route-only, not a
  // defect) and re-enqueues PAPER only,
  // filing NOTHING (§4). It IGNORES the location's `receipt_print_mode` (a reprint is always available,
  // §0), so it works even under `on_request`/`never`, and never opens the drawer. An id naming no filed
  // sale (unknown/open/foreign), or a till with no active printer, is a 200 NO-OP — the kitchen-reprint
  // shape. The `:id` is `isUuid`-screened first, refused as `working_order.not_found` (404, the honest
  // "no such order") rather than the `22P02` opaque 500 a malformed value would raise. Returns 200 empty.
  app.post("/api/sales/:id/reprint", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      // Handheld firewall (spec §5): a handheld may not reprint a fiscal ticket — refused
      // `device.forbidden_action` (403) before the id parse. An ordinary till carries no device cookie.
      await assertNotHandheld(deps, c, "reprint");
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await reprintSale({ db: deps.db, backend: deps.backend }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  // The eligible authorizers for a gated privileged action — the active persons whose role holds
  // `cash.drawer` (cash-drawer-authorization §5). SESSION-GUARDED, not permission-gated: ANY logged-in
  // operator may call it (they are about to request a supervisor override and need the picker of who
  // could authorize it), so `requireSession` runs FIRST and no `authorize` gate follows. Runs under
  // `withTenant` + `asAppUser` (RLS scopes it to this till's tenant), returning the SAME no-secrets
  // `{ personId, displayName }` shape as `GET /api/staff` — no PIN material, role or status: the till
  // shows this picker BEFORE the supervisor has entered their credential. The client sends the chosen
  // `{ personId, pin }` only on the authenticated `POST /api/drawer/open` override request.
  app.get("/api/drawer/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const authorizers = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listActivePersonsWithPermission(tx, "cash.drawer");
      });
      return c.json(authorizers);
    }),
  );

  // Manually open the cash drawer (counter receipt/drawer §3d + cash-drawer-authorization §3) — the
  // operator's "open drawer" button, for a no-sale open (giving change, a cash count). SESSION-GUARDED,
  // AUTHORIZED and AUDITED: it records a `drawer_opens('manual')` row (who performed it, who authorized
  // it, whether via override) beside a kick-only outbox job to the till's receipt printer (the drawer IS
  // that printer's kick — deli-hardware §6).
  //
  // This is the FIRST till route to parse a supervisor OVERRIDE and call `authorize()` WITH one (FP-2
  // already calls `authorize(…"till.configure")` at the table-placement routes, but with NO override —
  // it is the reusable OVERRIDE hop that is new here). The per-location `drawer_open_policy` decides:
  //   • `open`  → any logged-in operator opens directly; `authorizedBy = personId`, `viaOverride = false`.
  //   • `gated` → `authorize(tx, { sessionId, permission: "cash.drawer", override })`, satisfied by the
  //     operator's OWN role OR a supervisor PIN override (a second person who holds `cash.drawer`); an
  //     unpermitted operator with no/insufficient override throws `authorization.not_permitted` (403).
  // The gate runs BEFORE the printer resolution (spec §3 order), so an unpermitted operator is refused
  // regardless of printer state. An optional `override: { personId, pin }` is parsed from the body (a
  // supervisor opening directly, and every `open`-policy open, sends NO body): a missing/empty/malformed
  // body is coerced to `{}` (`readJsonBody`), never a 500. A present-but-malformed `override.personId`
  // (non-UUID) is screened to `person.not_found` (401) rather than reaching the `persons.id` uuid column
  // as a 22P02 → opaque 500 — the same code a well-formed-but-absent id gets from the credential gate.
  //
  // A till with NO receipt printer set has nothing to kick, refused `drawer.no_printer` (400, errors.ts)
  // — the resolve + throw is at this route layer (which imports errors.js), so `receipt-print.ts` stays
  // throw-free. `resolveReceiptPrinter` takes the same `active = true` + `FOR SHARE` posture the sale hook
  // uses, so an absent/inactive printer is the no-printer case. Returns 200 with an empty body.
  app.post("/api/drawer/open", (c) =>
    run(c, log, async () => {
      const { personId, sessionId } = await requireSession(deps, c);
      // Capability firewall (SP-A.2 §16): opening the cash drawer requires the device's assigned
      // canvas to declare `open-cash-drawer`. This generalises the old hardcoded handheld check — a
      // handheld carries a capability-less canvas (or none) and so has no drawer to open, refused
      // `device.forbidden_action` (403) before the policy/printer resolution. An ordinary till carries
      // no device cookie and passes.
      await assertDeviceCapability(deps, c, "open-cash-drawer", "drawer_open");
      const body = await readJsonBody<{ override?: { personId?: unknown; pin?: unknown } }>(c);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const [loc] = await tx
          .select({ policy: locations.drawerOpenPolicy })
          .from(locations)
          .where(
            and(eq(locations.tenantId, deps.cfg.tenantId), eq(locations.id, deps.cfg.locationId)),
          );
        // The till's own location always resolves under RLS (tenant-scoped, like the receipt-mode read
        // in `receipt-print.ts`); if it somehow does not, fall back to the SECURE 'gated' default so a
        // missing row can never leave the gate open.
        /* v8 ignore next -- unreachable: the till's own location row always resolves under RLS */
        const policy = loc?.policy ?? "gated";

        // `authorize()` returns `{ authorizedBy, viaOverride }` (plus `permission`), the same names the
        // `'open'` branch supplies directly — so a ternary destructure covers both policies.
        const { authorizedBy, viaOverride } =
          policy === "open"
            ? { authorizedBy: personId, viaOverride: false }
            : await authorize(tx, {
                sessionId,
                permission: "cash.drawer",
                override: parseDrawerOverride(body.override),
              });

        const printer = await resolveReceiptPrinter(tx, deps.cfg);
        if (printer === undefined) {
          throw new AppError("drawer.no_printer", { tillId: deps.cfg.tillId });
        }
        await enqueueManualDrawerOpen(
          tx,
          deps.cfg,
          printer.id,
          personId,
          authorizedBy,
          viaOverride,
        );
      });
      return c.body(null, 200);
    }),
  );

  // Collect and finalise a PLACED order (7c prepare & collect): Mode I settles the ALREADY-issued
  // deferred invoice, Mode T files `recordSale` immediate — `collectOrder`'s own mode dispatch
  // (design §3). SESSION-GUARDED; `operatorId` is `session.personId`. The body carries only the
  // tender: `collectOrder` ignores `req.lines` entirely (a placed order files its frozen stored
  // composition, never a client basket — see `PayWorkingOrderRequest`'s own doc comment), so this
  // route need not even ask the till for one. The id is `isUuid`-screened before any query, refused
  // as `working_order.not_placed` — the SAME code an absent or non-placed id gets from `collectOrder`
  // itself.
  app.post("/api/working-orders/:id/collect", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall (spec §5): collecting SETTLES the order — Mode T files `recordSale` immediate,
      // Mode I settles the deferred invoice (`collectOrder`) — a chained fiscal write, the unrecoverable
      // record (CLAUDE.md §5). A handheld never settles THROUGH collect (that stays fenced even for cash;
      // a handheld's settlement path is a cash or manual-card sale on `/api/sales`), so it is refused
      // `device.forbidden_action` (403) HERE, before the id parse and any fiscal write. An ordinary till
      // carries no device cookie and passes.
      // Resolve the calling device ONCE and thread it to both the handheld firewall and `requireSaleTillId`
      // below, so scrypt + the `withTenant` read run once per request rather than twice (perf; §16 path).
      const device = await tryReadDevice(deps, c);
      await assertNotHandheld(deps, c, "collect", device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      const body = await c.req.json<{ tender: TillTender }>();
      // SP-A.2 §16.4 cutover: collect settles under the AUTHENTICATED device's `till_id`, not env — Mode T
      // files `recordSale` immediate, Mode I settles the deferred invoice. Only `tillId` changes;
      // `nodeId`/`seriesId` (the SIF/chain key) stay `deps.cfg`.
      const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c, device) };
      const result = await collectOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        saleCfg,
        { id, lines: [], tender: body.tender },
        personId,
      );
      return c.json(result);
    }),
  );

  // Cancel a PLACED order (7c, spec §4): `placed → abandoned`, appending an `order_cancelled`
  // amendment carrying the operator's reason. SESSION-GUARDED; `operatorId` is `session.personId`. An
  // absent/empty/whitespace reason is refused by `cancelPlacedOrder` itself with
  // `working_order.reason_required` (400) BEFORE any transition or amendment. The id is
  // `isUuid`-screened before any query, refused as `working_order.not_placed` — the SAME code a
  // non-placed or absent id gets.
  app.post("/api/working-orders/:id/cancel", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall (spec §5): cancelling a placed order APPENDS an `order_cancelled` entry to the
      // tamper-evident hash-chained amendment log (`cancelPlacedOrder`) — a fiscal-adjacent mutation a
      // handheld must not perform. Refused `device.forbidden_action` (403) HERE, before the reason/id
      // parse and any amendment write. An ordinary till carries no device cookie and passes.
      await assertNotHandheld(deps, c, "cancel");
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      const body = await c.req.json<{ reason: string }>();
      await cancelPlacedOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
        id,
        body.reason,
        personId,
      );
      return c.body(null, 200);
    }),
  );

  // Create a dining table. SESSION-GUARDED. `createTable` throws table.label_taken (→ 409) on a
  // duplicate label, or zone.not_found (→ 404) when `zoneId` names no floor_zones row. The client
  // sends { label, zoneId?, capacity? }.
  app.post("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const body = await c.req.json<{ label: string; zoneId?: string; capacity?: number }>();
      requireCapacity(body.capacity);
      // Screen a present `zoneId` as a UUID BEFORE the DB touch — the twin of the `:id` screen on the
      // sibling routes, one field over. A well-formed-but-missing zoneId already surfaces
      // `zone.not_found` (the composite FK's 23503, `isZoneFkViolation`); a MALFORMED one un-screened
      // reaches the `zone_id` uuid column and raises `22P02` → an opaque `server.internal` 500, so it
      // gets the SAME domain `zone.not_found`. An ABSENT zoneId (`undefined`) is a legitimate unassigned
      // table and is left alone.
      if (body.zoneId !== undefined && !isUuid(body.zoneId))
        throw new AppError("zone.not_found", { zoneId: body.zoneId });
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createTable(tx, deps.cfg, body);
      });
      return c.json(result);
    }),
  );

  // The venue's active tables. SESSION-GUARDED; RLS + the location filter scope it.
  app.get("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tables = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listTables(tx, deps.cfg);
      });
      return c.json(tables);
    }),
  );

  // The occupancy read-model (design §4). SESSION-GUARDED. Task 4 extended `listTablesWithState` so
  // each row now carries `zoneId` (the table's floor zone) and `pendingToServe` (its open tab's lines
  // still to serve); this route returns that shape DIRECTLY, so both flow through unchanged.
  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const state = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listTablesWithState(tx, deps.cfg);
      });
      return c.json(state);
    }),
  );

  // The venue's active floor-plan zones (FP-1, design §4). SESSION-GUARDED; RLS + the location filter
  // scope `listZones` to this till's venue, ordered by `display_order`. LIST-ONLY: zone CRUD is the
  // management API's (`POST/PATCH/DELETE /management-api/zones`, Task 5), so this surface throws none
  // of the create-side codes (`zone.name_taken`) — the till only reads zones to render the live floor.
  app.get("/api/zones", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const zones = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listZones(tx, deps.cfg);
      });
      return c.json(zones);
    }),
  );

  // The venue's ACTIVE service statuses (FP-1, TS-2), for the table-order screen's Estado picker.
  // SESSION-GUARDED (operator PIN, NOT the manager-only `listStatuses`): `requireSession` runs FIRST, and
  // RLS scopes `listServiceStatuses` to this till's tenant. LIST-ONLY, active-only (a deactivated status
  // can't be applied); status CRUD is the management API's, so this surface throws no domain code.
  app.get("/api/statuses", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const statuses = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listServiceStatuses(tx);
      });
      return c.json(statuses);
    }),
  );

  // Edit a table (label/zoneId/capacity). SESSION-GUARDED. A malformed :id is screened to
  // table.not_found (→ 404) rather than a 500; `updateTable` throws table.not_found / table.label_taken,
  // or zone.not_found (→ 404) when `zoneId` names no floor_zones row.
  app.patch("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ label?: string; zoneId?: string; capacity?: number }>();
      requireCapacity(body.capacity);
      // Screen a present `zoneId` as a UUID BEFORE the DB touch — same as the create route above and the
      // `:id` screen on this route: a malformed zoneId un-screened reaches the `zone_id` uuid column →
      // `22P02` → opaque 500, so it gets the SAME `zone.not_found` a well-formed-but-missing one does. An
      // ABSENT zoneId is left alone (an unassigned table, legitimate).
      if (body.zoneId !== undefined && !isUuid(body.zoneId))
        throw new AppError("zone.not_found", { zoneId: body.zoneId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await updateTable(tx, deps.cfg, id, body);
      });
      return c.body(null, 200);
    }),
  );

  // Deactivate a table (DELETE = deactivate; app_user holds no hard DELETE). SESSION-GUARDED.
  app.delete("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await deactivateTable(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  // Open the table's running tab. SESSION-GUARDED. Malformed :id → table.not_found (a bad table id names
  // no table). `openTab` throws table.not_found / table.inactive / tab.already_open.
  app.post("/api/tables/:id/tab", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ lines?: { productId: string; quantity: string }[] }>();
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return openTab(tx, deps.cfg, { tableId: id, lines: body.lines });
      });
      return c.json(result);
    }),
  );

  // Append a round to an open tab. SESSION-GUARDED. Malformed :id → tab.not_open (a bad id names no open
  // tab). `addTabRound` throws tab.not_open / sale.empty_basket.
  app.post("/api/working-orders/:id/round", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      // Each round line MAY carry a `courseId` OVERRIDE (KDS-2 §5b) the tab screen's per-line course
      // picker set — the ring-time resolver applies `<override> ?? product.course_id` (`addTabRound` →
      // `priceOrderLines`). Absent (the picker left on the product default) = the product's default course.
      const body = await c.req.json<{
        // A round line MAY carry selected modifier `options` (ordering modifiers) — threaded through
        // `addTabRound` → `priceOrderLines`, which expands each into a parent + child rows. Optional, so
        // a plain `{productId, quantity}` round is unchanged. An option MAY carry a per-option `quantity`
        // (absent = 1), validated + priced server-side against the item's `max_quantity`. A round line
        // MAY also carry per-line `LineExtras` (NON-FISCAL) — validated + persisted on the parent dish
        // line and snapshotted onto its ticket item at fire. Coursing editing (A3): a round line MAY carry
        // `hold: true` — the tab screen's per-line hold toggle; `addTabRound` inserts it HELD (no fire, no
        // print) regardless of course, released later by `sendLines`.
        lines: ({
          productId: string;
          quantity: string;
          courseId?: string | null;
          options?: { optionGroupItemId: string; quantity?: number }[];
          hold?: boolean;
        } & LineExtras)[];
      }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await addTabRound(tx, deps.cfg, id, body.lines);
      });
      return c.body(null, 200);
    }),
  );

  // Void one line from an open tab. SESSION-GUARDED. Malformed :id → tab.not_open; a :lineNo that is
  // not a valid int4 line number → tab.line_not_found (it names no line) — the SAME `requireLineNo`
  // screen the served POST/DELETE routes use (see its doc for why the int4 upper bound is not cosmetic:
  // `voidTabLine` binds `line_no` parameterised, so an out-of-range integer un-screened would reach the
  // `where line_no = $n` delete and raise `22003` → an opaque `server.internal` 500). `voidTabLine`
  // still throws tab.not_open / tab.line_not_found for the in-range cases it reaches.
  app.delete("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await voidTabLine(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );

  // Read ONE open tab's lines for the table-order screen (design §3b, FP-1) — per line: `lineNo`,
  // `productId`, `quantity`, the LOCKED gross unit price (`unitPriceGross`) and the `servedAt` marker.
  // SESSION-GUARDED. A READ, so no FOR UPDATE lock (`readTabLines` uses `assertTabOpen`, not
  // `lockOpenTab`). Malformed :id → `tab.not_open` (a bad id names no open tab), the SAME `requireTabParam`
  // screen the served routes use; `readTabLines` throws `tab.not_open` for a non-open/absent tab. Returns
  // `TabLine[]`. A tab does NOT re-price — the STORED locked gross rides back verbatim (see `readTabLines`).
  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lines = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return readTabLines(tx, deps.cfg, id);
      });
      return c.json(lines);
    }),
  );

  // Mark ONE line of an open tab as DELIVERED — `served_at = now()` (design §3b, FP-1), the live floor's
  // "this went out" tap. SESSION-GUARDED; it is an OPERATIONAL verb a logged-in runner uses like ringing
  // a sale, gated by the session (`requireSession`), NOT by a permission. `served_at` is a PRE-FISCAL
  // operational field (design H2) — it never enters `registros`/`computeHuella`/`recordSale`, so this is
  // a floor-ops route with no fiscal path. The `:id`/`:lineNo` screens are the SAME as the sibling
  // void-line DELETE above (`requireTabParam` → `tab.not_open` on a malformed tab id; `requireLineNo` →
  // `tab.line_not_found` on a non-int4/out-of-range one), so a bad param is a clean 4xx, never a
  // `22P02`/`22003` 500. `markLineServed` still throws `tab.not_open` (a non-open/absent/foreign tab a
  // table points at) / `tab.line_not_found` (an in-range line matching nothing) for the cases it reaches.
  app.post("/api/working-orders/:id/lines/:lineNo/served", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await markLineServed(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );

  // Clear ONE line's delivered marker — `served_at = NULL` (the inverse of the POST above, for a
  // mis-tap). SESSION-GUARDED, same `:id`/`:lineNo` screens, same PRE-FISCAL note; `unmarkLineServed`
  // throws the same `tab.not_open`/`tab.line_not_found` guards.
  app.delete("/api/working-orders/:id/lines/:lineNo/served", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await unmarkLineServed(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );

  // Move ONE not-yet-fired line of an open tab into another course, or clear its course to null (coursing
  // editing A1, design §3b) — the tab screen's per-line course re-picker. SESSION-GUARDED, an operational
  // floor verb gated by the session, NOT a permission. `:id`/`:lineNo` screens are the SAME as the sibling
  // served/void line routes (`requireTabParam` → `tab.not_open` on a malformed tab id; `requireLineNo` →
  // `tab.line_not_found` on a non-int4/out-of-range one). A present-but-malformed body `courseId` is
  // screened to `course.not_found` (it names no course) BEFORE it reaches `requireLiveCourse`'s uuid cast —
  // the same 404 the fire route's `:courseId` screen gives — while `null` (clear the course) is left alone.
  // `setLineCourse` then throws `tab.not_open` / `course.not_found` (absent/foreign/retired target) /
  // `tab.line_not_found` (an in-range line matching nothing) / `ticket.already_fired` (the line's ticket
  // has fired — corrected via recall, not a move) for the cases it reaches. Body: { courseId: string | null }.
  app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const body = await c.req.json<{ courseId?: string | null }>();
      // An absent `courseId` key means "clear the course" (the null branch) — coerce it so `undefined`
      // never reaches `setLineCourse`, where an omitted query param would surface as an opaque
      // `server.internal` 500 instead of the clean null-clear the `{ courseId: string | null }` contract
      // declares. The `{}`-body route test proves the 200 and fails (500) if this coercion is reverted.
      const courseId = body.courseId ?? null;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await setLineCourse(tx, deps.cfg, id, lineNo, courseId);
      });
      return c.body(null, 200);
    }),
  );

  // Fire SPECIFIC held lines of an open tab — a finer release than the whole-course fire route (coursing
  // editing A2, design §3b). The line set rides in the BODY (`{ lineNos?: number[] }`), not a `:lineNo`
  // path param, so ONE request releases several lines at once — and an OMITTED / empty list means "send
  // all together" (release every held line of the tab), the `body.lineNos ?? []` default. SESSION-GUARDED,
  // an operational floor verb gated by the session, NOT a permission. Malformed :id → `tab.not_open`
  // (via `requireTabParam`, the same screen the sibling tab routes use); `sendLines` then locks the open
  // tab (`tab.not_open` for a non-open/absent tab) and no-ops on a `line_no` naming no held line — an
  // unknown or already-fired line simply matches nothing (idempotent, like the course fire). PRE-FISCAL:
  // it writes only `ticket_items` (fired_at/queued_at) + the kitchen-print outbox, never a filed record.
  app.post("/api/working-orders/:id/lines/send", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ lineNos?: number[] }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await sendLines(tx, deps.cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  // UN-SEND not-yet-started lines of an open tab — the inverse of the /lines/send route (coursing editing
  // A4, design §3b). The line set rides in the BODY (`{ lineNos: number[] }`), not a `:lineNo` path param,
  // like /lines/send — one request recalls several lines at once. SESSION-GUARDED, an operational floor verb
  // gated by the session, NOT a permission. Malformed :id → `tab.not_open` (via `requireTabParam`, the same
  // screen the sibling tab routes use); `recallLines` then locks the open tab (`tab.not_open` for a
  // non-open/absent tab), throws `tab.line_not_found` for an absent `line_no` and `ticket.already_started`
  // (409) for a line the kitchen has already started (preparing/ready) — an already-held line is a no-op.
  // PRE-FISCAL: it writes `ticket_items` (clearing `fired_at`) plus, for a previously-fired line, a
  // RECALLED correction slip to the `print_jobs` outbox; never a filed record.
  app.post("/api/working-orders/:id/lines/recall", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ lineNos?: number[] }>();
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await recallLines(tx, deps.cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  // Set (or clear) a table's manual service status (design §3b). SESSION-GUARDED. A malformed :id →
  // table.not_found (a bad table id names no table). `setTableStatus` throws table.not_found /
  // status.not_found / status.inactive. Body: { statusId: string | null }.
  app.post("/api/tables/:id/status", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{ statusId: string | null }>();
      const statusId = body.statusId ?? null;
      // A present-but-malformed statusId is screened to status.not_found (it names no status), not a 500.
      if (statusId !== null && !isUuid(statusId))
        throw new AppError("status.not_found", { statusId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await setTableStatus(tx, deps.cfg, id, statusId);
      });
      return c.body(null, 200);
    }),
  );

  // Place a table on the FP-2 spatial floor plan (design §placement) — the FIRST on-till
  // `authorize(till.configure)` gate. Unlike every sibling above, `requireSession` is not the whole
  // guard: the session only IDENTIFIES the operator, and the write is a manager-level venue-config
  // action. So this route pulls `sessionId` out of the session (the sale routes ignore it) and, inside
  // the tenant/app_user transaction, calls `authorize(tx, { sessionId, permission: "till.configure" })`
  // — which resolves the OPERATOR's OWN role and throws `authorization.not_permitted` (→ 403) when it
  // lacks the permission. NO supervisor `override` is parsed this slice (manager-on-till only, spec
  // §3c): a staff/supervisor operator is simply refused. The gate runs BEFORE `setTablePlacement`, so a
  // rejected operator performs no write (proven by-deletion in the suite — dropping the `authorize` call
  // flips the staff case to a 204). The `:id` isUuid screen runs FIRST (before the tx), refusing a
  // malformed value with the SAME domain code the sibling table routes use — `table.not_found` (404) —
  // rather than the 22P02→500 the raw value would raise. The body-shape screen mirrors the
  // `management-api.ts` placement sibling exactly: a non-object body → `management.request_invalid`
  // naming "body", each MISSING or wrong-TYPE field → the same code naming THAT field, and a
  // string-typed but MALFORMED `zoneId` → `zone.not_found` (the sibling POST/PATCH `/api/tables`
  // convention, one field over — un-screened it reaches the `floor_zones.id` uuid column in
  // `setTablePlacement` → 22P02 → opaque 500). The verb owns the placement VALUE validation
  // (`placement.invalid`) and the live-table/live-zone reads. Returns 204 (the management-api
  // placement sibling's convention).
  app.put("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const { sessionId } = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body =
        (await c.req.json<{
          zoneId?: unknown;
          posX?: unknown;
          posY?: unknown;
          shape?: unknown;
          rotation?: unknown;
        }>()) ?? {};
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.zoneId !== "string")
        throw new AppError("management.request_invalid", { field: "zoneId" });
      // Screen a string-typed but MALFORMED zoneId as a UUID (the sibling table POST/PATCH shape): the
      // verb reads `floor_zones … where id = ${zoneId}`, so an un-screened non-UUID reaches the `uuid`
      // column → 22P02 → opaque 500. Give it the SAME zone.not_found a well-formed-but-missing one gets.
      if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
      if (typeof body.posX !== "number")
        throw new AppError("management.request_invalid", { field: "posX" });
      if (typeof body.posY !== "number")
        throw new AppError("management.request_invalid", { field: "posY" });
      if (typeof body.shape !== "string")
        throw new AppError("management.request_invalid", { field: "shape" });
      if (typeof body.rotation !== "number")
        throw new AppError("management.request_invalid", { field: "rotation" });
      // Bind the narrowed fields to locals (the typeof narrowings above do not survive into the
      // `withTenant` closure — a captured property resets to its declared type). `shape` is cast to
      // `FloorTableShape` here; the verb re-validates enum membership (→ placement.invalid), so the cast
      // asserts nothing the verb does not check.
      const { zoneId, posX, posY, rotation } = body;
      const shape = body.shape as FloorTableShape;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorize(tx, { sessionId, permission: "till.configure" });
        await setTablePlacement(tx, deps.cfg, id, { zoneId, posX, posY, shape, rotation });
      });
      return c.body(null, 204);
    }),
  );

  // Un-place a table (NULL the four placement columns, leave zone_id as-is — an FP-1 assignment).
  // Mirrors the PUT's gate exactly: the operator's OWN `till.configure` via `authorize` (no override),
  // BEFORE `clearPlacement`, so a staff operator is 403 and writes nothing. Malformed :id → table.not_found
  // (the isUuid screen, never a 22P02 500); an absent row → table.not_found (the verb's row-count check).
  // Returns 204.
  app.delete("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const { sessionId } = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorize(tx, { sessionId, permission: "till.configure" });
        await clearPlacement(tx, deps.cfg, id);
      });
      return c.body(null, 204);
    }),
  );

  // Relocate a tab to a free table (TS-3, design §3a). SESSION-GUARDED. The tab `:id` and the body
  // `toTableId` are both isUuid-screened before any query — a malformed tab id → `tab.not_open` (409),
  // a malformed target → `table.not_found` (404), never a 500. The verb runs on a fresh
  // withTenant/asAppUser transaction (RLS scopes it to this till's tenant). Returns 200 empty.
  app.post("/api/tabs/:id/move", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ toTableId: string }>();
      if (!isUuid(body.toTableId))
        throw new AppError("table.not_found", { tableId: body.toTableId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await moveTab(tx, deps.cfg, tabId, body.toTableId);
      });
      return c.body(null, 200);
    }),
  );

  // Extend a tab's coverage to a free table (TS-3, a join). SESSION-GUARDED; same isUuid screening as
  // move. Returns 200 empty.
  app.post("/api/tabs/:id/join", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ tableId: string }>();
      if (!isUuid(body.tableId)) throw new AppError("table.not_found", { tableId: body.tableId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await joinTable(tx, deps.cfg, tabId, body.tableId);
      });
      return c.body(null, 200);
    }),
  );

  // Combine two tabs onto one bill (TS-3). SESSION-GUARDED. The destination tab `:id` and the body
  // `fromTabId` are both isUuid-screened → `tab.not_open` on a malformed id; a self-merge is
  // `tab.merge_self` (400), a non-open tab `tab.not_open` (409), both from `mergeTabs`. Returns 200 empty.
  app.post("/api/tabs/:id/merge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const intoTabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{ fromTabId: string; freeSourceTable: boolean }>();
      if (!isUuid(body.fromTabId)) throw new AppError("tab.not_open", { tabId: body.fromTabId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await mergeTabs(tx, deps.cfg, intoTabId, body.fromTabId, {
          freeSourceTable: body.freeSourceTable,
        });
      });
      return c.body(null, 200);
    }),
  );

  // Move SELECTED items — whole lines or PART of a line — from one open tab to another (TS-4, design
  // §3a). `:id` is the SOURCE tab; the body carries the destination and the line selection. SESSION-
  // GUARDED. Both ids are `isUuid`-screened BEFORE any query — a malformed one passed into
  // `eq(workingOrders.id, …)` would 22P02 → an opaque 500, so it is refused as `tab.not_open` (the SAME
  // fail-closed code an absent/closed/foreign tab gets). `transferLines` is tx-level, so this route
  // opens the `withTenant`/`asAppUser` transaction around it. Returns 200 with an empty body; the till
  // re-reads the two tabs' state.
  app.post("/api/tabs/:id/transfer", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const fromTabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{
        toTabId: string;
        transfers: { lineNo: number; quantity?: string }[];
      }>();
      if (!isUuid(body.toTabId)) throw new AppError("tab.not_open", { tabId: body.toTabId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await transferLines(tx, deps.cfg, fromTabId, body.toTabId, body.transfers);
      });
      return c.body(null, 200);
    }),
  );

  // Split-bill (TS-5, design §3): spin SELECTED items off this open tab (`:id` = fromTabId) into a NEW
  // separately-filing check — a detached, table-LESS open working order the till then pays via the
  // existing pay path. SESSION-GUARDED. The tab `:id` is `requireTabParam`-screened (a malformed id →
  // `tab.not_open` 409, the SAME fail-closed code the sibling tab routes use — a malformed id passed into
  // `eq(workingOrders.id, …)` would 22P02 → an opaque 500). The body is shape-screened (non-object/null/
  // array → `management.request_invalid` naming "body") before any field access — a literal JSON `null`
  // body used to reach `body.transfers` as a TypeError → opaque 500 (Copilot). `splitOffCheck` is
  // tx-level, so this route opens the `withTenant`/`asAppUser` transaction around it. Returns 200
  // `{ checkId }`; no fiscal write happens here (the check files only when it is later paid), so this
  // stays on the ALLOWED side of the order-only firewall like the other tab verbs.
  app.post("/api/tabs/:id/split", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const fromTabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{
        transfers: { lineNo: number; quantity?: string }[];
      }>();
      // Screen the body shape BEFORE any field access: a literal JSON `null` body parses successfully
      // (no SyntaxError — `c.req.json()` just returns `null`), so `body.transfers` below would throw
      // `Cannot read properties of null` and escape as an opaque 500, the exact class the id screen above
      // exists to prevent. Same object/null/array guard as the `/api/tables/:id/placement` sibling
      // (till-api.ts, PUT placement route above), naming "body" — checked on the RAW parse result (no
      // `?? {}` first), because coalescing null to `{}` before this check would make it unreachable for
      // a null body (proven: `null ?? {}` is `{}`, so `body === null` never fires downstream of that).
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      // A non-array `transfers` ({}/5) reaches `splitOffCheck`'s `transfers.length` as a TypeError →
      // opaque 500. Refused here as `management.request_invalid` naming the field (the generic
      // request-shape 400, `requireCapacity`'s discipline). Only the array shape is screened — the verb +
      // `assertDistinctTransferLines` + `carveOffLines` raise the domain errors for bad contents.
      if (!Array.isArray(body.transfers)) {
        throw new AppError("management.request_invalid", { field: "transfers" });
      }
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return splitOffCheck(tx, deps.cfg, fromTabId, body.transfers);
      });
      return c.json(result);
    }),
  );

  // Un-join (TS-5, deferred from TS-3): detach a joined table (`:id` = the shared tabId) from its tab —
  // WITH items into its own new table-anchored bill, or WITHOUT into a free table (turnover). SESSION-
  // GUARDED; both the path `:id` (the shared tab) and the body `tableId` are `isUuid`-screened before any
  // query. A malformed tab id → `tab.not_open` (409, via `requireTabParam`); a malformed `tableId` →
  // `table.not_joined` (409) — the SAME code `unjoinTable` throws for a table not currently joined to this
  // tab, so a malformed target fails closed to the honest "that table is not joined here" rather than an
  // opaque 500. The body is shape-screened (non-object/null/array → `management.request_invalid` naming
  // "body") BEFORE the `tableId` check — a literal JSON `null` body used to reach `body.tableId` as a
  // TypeError → opaque 500 (Copilot); screening it first also keeps a missing body out of the
  // domain-specific `table.not_joined`, since "no body" is a request-shape fault, not a claim about a
  // table. The verb is tx-level, so this route opens the `withTenant`/`asAppUser` transaction around
  // it. Returns 200 `{ tabId }` (the new anchored tab, with items) or `{}` (freed). No fiscal write.
  app.post("/api/tabs/:id/unjoin", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await c.req.json<{
        tableId: string;
        transfers?: { lineNo: number; quantity?: string }[];
      }>();
      // Screen the body shape BEFORE any field access — same reasoning as `/split` above: a literal
      // JSON `null` body parses successfully, so `body.tableId` would throw before `isUuid` ever ran,
      // escaping as an opaque 500. This ALSO keeps a null body out of the domain-specific
      // `table.not_joined` a well-formed-but-wrong `tableId` gets below — a missing body is a request-
      // shape fault, not a claim about a table.
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (!isUuid(body.tableId))
        throw new AppError("table.not_joined", { tableId: body.tableId, tabId });
      // `transfers` is OPTIONAL here (absent = free the table, a turnover), so screen only a PRESENT
      // non-array before the verb: a present non-array reaches `unjoinTable`'s `transferLines` as
      // `.length` → opaque 500. Same request-shape 400 as `/split`, naming the field.
      if (body.transfers !== undefined && !Array.isArray(body.transfers)) {
        throw new AppError("management.request_invalid", { field: "transfers" });
      }
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return unjoinTable(tx, deps.cfg, tabId, body.tableId, body.transfers);
      });
      return c.json(result);
    }),
  );
}
