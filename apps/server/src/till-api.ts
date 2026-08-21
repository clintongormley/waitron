import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { asAppUser, tenants, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { authorize, endSession, listActiveStaff, loginWithPin } from "@waitron/identity";
import { listAvailableProducts } from "@waitron/catalogue";
import { getLayout } from "@waitron/layouts";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { collectOrder, payWorkingOrderIntegrated, recordTillSale } from "./till-sale.js";
import type { IntegratedPayRequest, TillSaleRequest, TillTender } from "./till-sale.js";
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
  advancePrep,
  cancelPlacedOrder,
  getHeldOrder,
  joinTable,
  listHeldOrders,
  listPrepQueue,
  listTablesWithState,
  markLineServed,
  mergeTabs,
  moveTab,
  openTab,
  parkOrder,
  placeOrder,
  readTabLines,
  sendToPrep,
  transferLines,
  unmarkLineServed,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import type { PrepState } from "./working-order.js";
import {
  clearSessionCookie,
  isUuid,
  readSessionId,
  requireSession,
  setSessionCookie,
} from "./till-session.js";
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
 * The working-order and prep codes are given SPECIFIC statuses rather than the 400 default: a
 * retrieve of an id that names no open order is a 404 (`working_order.not_found`); a MODIFY of an
 * order that is not open (`working_order.not_open`), not placed (`working_order.not_placed`), not
 * settled (`working_order.not_settled`, `sendToPrep`'s own guard), or a prep move the order's current
 * prep state forbids (`order_prep.invalid_transition`) are all 409 — the id may be valid, but the
 * order's (or its prep row's) STATE forbids the operation (see each code's own note in `errors.ts`).
 * `working_order.reason_required` is listed explicitly at 400 despite being the table's own default,
 * matching every other `working_order.*`/`sale.*` entry here.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "pin.invalid": 401,
  "person.not_found": 401,
  "person.suspended": 403,
  "session.not_open": 401,
  "session.required": 401,
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
  "working_order.reason_required": 400,
  "order_prep.invalid_transition": 409,
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
  // Manual service status (TS-2). Setting a table's status can fail two ways: an unknown status id
  // (or a malformed one screened at the route) names no status → 404 (`status.not_found`); a
  // deactivated status may not be set → 409 (`status.inactive`) — the id is valid but the status's
  // STATE forbids it, the same 409 shape `table.inactive`/`tab.not_open` use. (A bad TABLE id on this
  // route is `table.not_found`, already mapped above.)
  "status.not_found": 404,
  "status.inactive": 409,
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
 * → 409; `order_prep.invalid_transition` for prep → 409); every code carries `{ workingOrderId }`. The
 * seven retrieve/edit/abandon/place/prep/collect/cancel routes share this one guard.
 */
function requireUuidId(
  id: string,
  code:
    | "working_order.not_found"
    | "working_order.not_open"
    | "working_order.not_placed"
    | "order_prep.invalid_transition",
): string {
  if (!isUuid(id)) {
    throw new AppError(code, { workingOrderId: id });
  }
  return id;
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
 * Mounts the till's session, roster and boot-info routes on an existing Hono app. Log in / log out,
 * the pre-login staff roster and the public till info live here; Task 6 adds `GET /api/products` and
 * `POST /api/sales` to THIS same function, each handler wrapped in `run` (above) so the whole surface
 * maps errors identically.
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
      // Surface the operator's OWN role so the till can gate its manager-only affordances (FP-2's
      // on-till "Editar plano"). Convenience only — every server gate re-derives the role from the
      // session and re-checks the permission via `authorize` (e.g. the placement route below), so a
      // tampered client value grants nothing.
      return c.json({ personId: session.personId, role: session.role });
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
      // ONE transaction reads both the issuer identity and the authored layout/receipt: `getLayout`
      // runs inside the same `withTenant` + `asAppUser` block (RLS scopes both to this till's tenant),
      // never a second connection. `getLayout` does not authorize — this boot read is deliberately
      // unauthenticated (the browser fetches it before login), and the layout carries no secrets, only
      // the widget arrangement + receipt trim, same as `venueName`/`orderFlow` already here.
      const boot = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const [row] = await tx
          .select({ venueName: tenants.legalName, nif: tenants.taxId })
          .from(tenants)
          .where(eq(tenants.id, deps.cfg.tenantId));
        // Authored layout/receipt, or the built-in defaults when the tenant has never opened the
        // editor (`getLayout` returns DEFAULT_LAYOUT/DEFAULT_RECEIPT on absence, no backfill).
        const { definition, receipt } = await getLayout(tx, deps.cfg.tenantId);
        return { issuer: row, layout: definition, receipt };
      });
      /* v8 ignore start */
      if (boot.issuer === undefined) {
        // Structurally unreachable: `deps.cfg.tenantId` is the till's own tenant (provisioning
        // stamped it), so its `tenants` row always exists and RLS returns it. A misconfigured till
        // pointed at a nonexistent tenant becomes an opaque 500 via `run`, never a partial payload.
        throw new Error(`GET /api/till: no tenant row for ${deps.cfg.tenantId}`);
      }
      /* v8 ignore stop */
      return c.json({
        locale: deps.cfg.locale,
        venueName: boot.issuer.venueName,
        nif: boot.issuer.nif,
        orderFlow: deps.cfg.orderFlow,
        // The integrated card terminal (sub-project 7): the STRING provider selector and the tip flag
        // the till app reads BEFORE login to pick its card-collect route and show/hide the tip
        // affordance (Task 8). `cardProvider` is the config selector (`deps.cfg.cardProvider`), not the
        // built `PaymentProvider` on `deps` — the client needs the mode name, not the server object.
        // `tipsEnabled` comes from `deps.cfg` too — the single source (`TillConfig.tipsEnabled`,
        // set at boot from `config.till`), not a second copy on `deps` that could drift from it.
        cardProvider: deps.cfg.cardProvider,
        tipsEnabled: deps.cfg.tipsEnabled,
        // The authored (or default) till layout + receipt trim (Task 8). The till app renders
        // `layout` verbatim in place of the hardcoded `LAYOUT_A` and threads `receipt` to its ticket
        // view; both ride this same unauthenticated boot fetch, so the till makes no second request.
        layout: boot.layout,
        receipt: boot.receipt,
      });
    }),
  );

  // The sellable catalogue for this till's location. SESSION-GUARDED: `requireSession` runs FIRST, so
  // an unauthenticated request 401s (`session.required`) before any catalogue is read — the operator
  // must be logged in to see prices. The read itself runs as the app role under the till's tenant
  // (`withTenant` + `asAppUser`), so RLS scopes `listAvailableProducts` to this tenant's own products.
  app.get("/api/products", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const products = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listAvailableProducts(tx, deps.cfg.locationId);
      });
      return c.json(products);
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
      const body = await c.req.json<TillSaleRequest>();
      // `workingOrderId` is OPTIONAL: absent (a walk-up `recordTillSale` mints a fresh id for) and a
      // well-formed-but-unknown one are both valid; only a MALFORMED one is an error. Un-screened it
      // becomes `payWorkingOrder`'s `req.id` and `22P02`s at its `eq(workingOrders.id, req.id)` lock read
      // (till-sale.ts) → an opaque 500 (the 7b follow-up). `requireUuidParam` refuses it 400 first.
      if (body.workingOrderId !== undefined) {
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      }
      const result = await recordTillSale(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
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
      const outcome = await payWorkingOrderIntegrated(
        { db: deps.db, backend: deps.backend, clock: deps.clock, provider: deps.cardProvider },
        deps.cfg,
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
        lines: { productId: string; quantity: string }[];
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
        lines: { productId: string; quantity: string }[];
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
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const result = await placeOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
        id,
        personId,
      );
      return c.json(result);
    }),
  );

  // Advance an order's prep state, or (an EMPTY body) ENQUEUE it (7c, design §5). A body carrying
  // `{ to }` calls `advancePrep`; `to` absent (`{}`) calls `sendToPrep` — the Mode-P pickup for an
  // order that never places. SESSION-GUARDED. The id is `isUuid`-screened before any query, refused
  // as `order_prep.invalid_transition` — the code every other illegal prep move surfaces, since a
  // malformed id names no prep row exactly as legitimately as an absent one. Returns 200 with an
  // empty body (like `updateHeldOrder`'s PUT); the caller re-reads `GET /api/prep-queue` for the new
  // state.
  app.post("/api/working-orders/:id/prep", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "order_prep.invalid_transition");
      const body = await c.req.json<{ to?: PrepState }>();
      if (body.to === undefined) {
        await sendToPrep({ db: deps.db }, deps.cfg, id);
      } else {
        await advancePrep({ db: deps.db }, deps.cfg, id, body.to);
      }
      return c.body(null, 200);
    }),
  );

  // The node-scoped prep queue (7c, design §5) — every order still ACTIVE in prep on this node
  // (queued/preparing/ready, not yet collected), oldest first. SESSION-GUARDED; `listPrepQueue` is
  // node- and (via RLS) tenant-scoped from `deps.cfg` — the browser names nothing.
  app.get("/api/prep-queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const queue = await listPrepQueue({ db: deps.db }, deps.cfg);
      return c.json(queue);
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
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      const body = await c.req.json<{ tender: TillTender }>();
      const result = await collectOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
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
      const body = await c.req.json<{ lines: { productId: string; quantity: string }[] }>();
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
  // flips the staff case to a 204). The `:id`/`zoneId` isUuid screens run FIRST (before the tx), each a
  // pure shape check refusing a malformed value with the SAME domain code the sibling table routes use —
  // `table.not_found`/`zone.not_found` (404) — rather than the 22P02→500 the raw value would raise; the
  // verb owns the placement VALUE validation (`placement.invalid`) and the live-table/live-zone reads.
  // Returns 204 (the management-api placement sibling's convention).
  app.put("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const { sessionId } = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await c.req.json<{
        zoneId: string;
        posX: number;
        posY: number;
        shape: FloorTableShape;
        rotation: number;
      }>();
      // A string-typed but malformed zoneId un-screened reaches the `floor_zones.id` uuid column in
      // `setTablePlacement` → 22P02 → opaque 500, so it gets the SAME `zone.not_found` a
      // well-formed-but-missing zone does (the sibling `POST`/`PATCH /api/tables` screen, one field over).
      if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorize(tx, { sessionId, permission: "till.configure" });
        await setTablePlacement(tx, deps.cfg, id, body);
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
}
