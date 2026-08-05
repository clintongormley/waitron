import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isAppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { endSession, loginWithPin } from "@waitron/identity";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
import type { TillConfig } from "./till-config.js";
import { clearSessionCookie, readSessionId, setSessionCookie } from "./till-session.js";
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
 * Mounts the till's session routes on an existing Hono app. Only log in / log out live here; Tasks
 * 5/6 add `GET /api/staff`, `GET /api/till`, `GET /api/products` and `POST /api/sales` to THIS same
 * function, each handler wrapped in `run` (above) so the whole surface maps errors identically.
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

  // Log out: end the shift session and clear the cookie. Idempotent — a request with no cookie, or
  // one naming an already-closed session (`endSession` returns false), still clears the cookie and
  // answers 200, so a double logout or a stale tab is never an error.
  app.delete("/api/session", (c) =>
    run(c, log, async () => {
      const id = readSessionId(c);
      if (id !== null) {
        await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await endSession(tx, id);
        });
      }
      clearSessionCookie(c);
      return c.json({ ok: true });
    }),
  );
}
