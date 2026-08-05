import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { isAppError } from "@waitron/shared";
import { asAppUser, tenants, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { endSession, listActiveStaff, loginWithPin } from "@waitron/identity";
import { listAvailableProducts } from "@waitron/catalogue";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { recordTillSale } from "./till-sale.js";
import type { TillSaleRequest } from "./till-sale.js";
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
}

/**
 * Every AppError CODE the till API answers, and the HTTP status it maps to. CLIENT faults only: the
 * identity credential codes (`pin.invalid`/`person.*`/`session.*`) and the `sale.*` request codes
 * Tasks 5/6 raise are all 4xx. A genuine SERVER fault never appears here — it reaches `run` as a
 * NON-AppError and becomes an opaque 500. A registered code absent from this table defaults to 400
 * (a client fault not yet given a more specific status), which is why `run` needs the `?? 400`.
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
  // server code), and `locale` drives the UI language. Read from the `tenants` row under `withTenant`
  // + `asAppUser`: `app_user` holds SELECT on `tenants` and RLS scopes it to this till's own tenant
  // row, so the `eq(id)` filter selects exactly that row.
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
      return c.json({ locale: deps.cfg.locale, venueName: issuer.venueName, nif: issuer.nif });
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
}
