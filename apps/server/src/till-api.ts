import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { AppError, isAppError } from "@waitron/shared";
import { asAppUser, tenants, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { endSession, listActiveStaff, loginWithPin } from "@waitron/identity";
import { listAvailableProducts } from "@waitron/catalogue";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { PaymentProvider } from "@waitron/payments";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { collectOrder, recordTillSale } from "./till-sale.js";
import type { TillSaleRequest, TillTender } from "./till-sale.js";
import {
  abandonHeldOrder,
  advancePrep,
  cancelPlacedOrder,
  getHeldOrder,
  listHeldOrders,
  listPrepQueue,
  parkOrder,
  placeOrder,
  sendToPrep,
  updateHeldOrder,
} from "./working-order.js";
import type { PrepState } from "./working-order.js";
import {
  clearSessionCookie,
  isUuid,
  readSessionId,
  requireSession,
  setSessionCookie,
} from "./till-session.js";
// Side-effect only: keeps this host's `server.internal` / `session.required` codes reachable from
// the file that answers with them — the reachability convention `webhook.ts` follows. See errors.ts.
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
   * Whether the till offers a tip prompt at card collect (`config.till.tipsEnabled`). Echoed on
   * `GET /api/till` so the client shows or hides the tip affordance (Task 8). Carried on the deps
   * alongside `cardProvider` — both are the boot-resolved card wiring — rather than read off
   * `deps.cfg`, keeping the two card facts the route exposes side by side.
   */
  tipsEnabled: boolean;
}

/**
 * Every AppError CODE the till API answers, and the HTTP status it maps to. CLIENT faults only: the
 * identity credential codes (`pin.invalid`/`person.*`/`session.*`), the `sale.*` request codes and
 * the `working_order.*` park-and-retrieve codes are all 4xx. A genuine SERVER fault never appears
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
  "authorization.not_permitted": 403,
  "working_order.not_found": 404,
  "working_order.not_open": 409,
  "working_order.not_placed": 409,
  "working_order.not_settled": 409,
  "working_order.reason_required": 400,
  "order_prep.invalid_transition": 409,
};

/**
 * The one error boundary every till route wraps its handler in — exported so Tasks 5/6's routes wrap
 * theirs in this EXACT mapping rather than each inventing one.
 *
 * An `AppError` becomes a structured `{ error: { code, params } }` at its mapped status (or 400 when
 * unmapped), logged at `warn`: every code the API surfaces is a client 4xx by construction (see
 * `STATUS`), so there is no `error`-level AppError to distinguish — a 5xx-worthy fault is never an
 * AppError on this surface. Anything else IS that server fault: logged at `error` under `till.failed`
 * with only `codeOf`'s classification (never the caught value's `.message`, which a driver can load
 * with a connection string), and answered with an opaque `server.internal` 500 that leaks nothing.
 */
export async function run(c: Context, log: Logger, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (cause) {
    if (isAppError(cause)) {
      const status = STATUS[cause.code] ?? 400;
      log("warn", cause.code, cause.params);
      return c.json({ error: { code: cause.code, params: cause.params } }, status);
    }
    log("error", "till.failed", { errorCode: codeOf(cause) });
    return c.json({ error: { code: "server.internal" } }, 500);
  }
}

/**
 * Screen a path `:id` param as a UUID before it reaches a query, returning it for the caller. A
 * malformed id passed straight into `eq(workingOrders.id, id)` would `22P02` in the DB → an opaque 500;
 * screening it here refuses it with the SAME domain `code` an absent/wrong-state id gets on that route
 * — the fail-closed shape each route documents. `code` is the caller's deliberate per-route choice
 * (`working_order.not_open` for place, `working_order.not_placed` for collect/cancel,
 * `order_prep.invalid_transition` for prep); all three carry `{ workingOrderId }`. The four
 * place/prep/collect/cancel routes share this one guard.
 */
function requireUuidId(
  id: string,
  code: "working_order.not_open" | "working_order.not_placed" | "order_prep.invalid_transition",
): string {
  if (!isUuid(id)) {
    throw new AppError(code, { workingOrderId: id });
  }
  return id;
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
      return c.json({ personId: session.personId });
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
      const issuer = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const [row] = await tx
          .select({ venueName: tenants.legalName, nif: tenants.taxId })
          .from(tenants)
          .where(eq(tenants.id, deps.cfg.tenantId));
        return row;
      });
      /* v8 ignore start */
      if (issuer === undefined) {
        // Structurally unreachable: `deps.cfg.tenantId` is the till's own tenant (provisioning
        // stamped it), so its `tenants` row always exists and RLS returns it. A misconfigured till
        // pointed at a nonexistent tenant becomes an opaque 500 via `run`, never a partial payload.
        throw new Error(`GET /api/till: no tenant row for ${deps.cfg.tenantId}`);
      }
      /* v8 ignore stop */
      return c.json({
        locale: deps.cfg.locale,
        venueName: issuer.venueName,
        nif: issuer.nif,
        orderFlow: deps.cfg.orderFlow,
        // The integrated card terminal (sub-project 7): the STRING provider selector and the tip flag
        // the till app reads BEFORE login to pick its card-collect route and show/hide the tip
        // affordance (Task 8). `cardProvider` is the config selector (`deps.cfg.cardProvider`), not the
        // built `PaymentProvider` on `deps` — the client needs the mode name, not the server object.
        cardProvider: deps.cfg.cardProvider,
        tipsEnabled: deps.tipsEnabled,
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
      const result = await recordTillSale(
        { db: deps.db, backend: deps.backend, clock: deps.clock },
        deps.cfg,
        body,
        personId,
      );
      return c.json(result);
    }),
  );

  // Park a working order to pay later (park & retrieve, sub-project 7b). SESSION-GUARDED like the
  // sale routes: `requireSession` runs FIRST, and the guard — not the browser — supplies the
  // attribution, so `operatorId` is `session.personId`. The client mints `body.id`, so a re-sent park
  // collides on the primary key and rolls back rather than creating a second order — but that is NOT
  // an idempotent replay: `parkOrder` does a plain INSERT, so the retry surfaces as a 23505 error, not
  // the original result. (Idempotent replay applies to pay, `payWorkingOrder`, not park.) `parkOrder`
  // re-reads the catalogue and prices authoritatively (the request carries no price), opening its OWN
  // `withTenant`/`asAppUser` transaction, so it is called OUTSIDE any transaction here. Returns the
  // persisted `{ id, orderNumber }`.
  app.post("/api/working-orders", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await c.req.json<{
        id: string;
        lines: { productId: string; quantity: string }[];
        label?: string;
      }>();
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

  // Retrieve one parked order to rebuild its basket. SESSION-GUARDED. An id naming no OPEN order (an
  // absent, settled/abandoned, or another tenant's order — RLS hides it) surfaces `working_order.not_found`,
  // which `STATUS` maps to 404. Returns `{ id, orderNumber, label, lines }` — the pricing INPUTS only,
  // never a stored price, so the till re-prices on retrieve.
  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const order = await getHeldOrder({ db: deps.db }, deps.cfg, c.req.param("id"));
      return c.json(order);
    }),
  );

  // Edit a parked order — the whole new basket plus an optional new label, a full REPLACEMENT.
  // SESSION-GUARDED. Only an `open` order may change; a non-open or unknown id surfaces
  // `working_order.not_open` → 409. `updateHeldOrder` re-prices authoritatively (the request carries
  // no price) and returns nothing, so this answers 200 with an empty body.
  app.put("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const body = await c.req.json<{
        lines: { productId: string; quantity: string }[];
        label?: string;
      }>();
      await updateHeldOrder({ db: deps.db }, deps.cfg, c.req.param("id"), {
        lines: body.lines,
        label: body.label,
      });
      return c.body(null, 200);
    }),
  );

  // Discard a parked order (`open → abandoned`). SESSION-GUARDED. A non-open or unknown id surfaces
  // `working_order.not_open` → 409, the same open-only guard `updateHeldOrder` makes. Returns 200 with
  // an empty body.
  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      await abandonHeldOrder({ db: deps.db }, deps.cfg, c.req.param("id"));
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
}
