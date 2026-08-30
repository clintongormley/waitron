// Side-effect only: loads errors.ts's augmentation for the host code this file THROWS
// (`management.request_invalid`) under the "every file that throws one of these imports ./errors.js"
// convention errors.ts states. The shared `error-boundary.ts` these routes wrap through is what
// answers with `server.internal` now, emitting it as a bare literal, so it needs no such import of
// its own. `@waitron/identity`'s own error-code augmentations
// (`password.invalid`, `person.*`, `totp.invalid`, `management_session.*`, `authorization.*`, …)
// load transitively via the value imports from that package below, so no bare
// `import "@waitron/identity"` is needed on top of them.
import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import {
  asAppUser,
  fireControlMode,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  authorizeManager,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  createPerson,
  endManagementSession,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listActiveStaff,
  listPersons,
  loginManager,
  reactivatePerson,
  resetPin,
  setEmail,
  setPassword,
  setRole,
  suspendPerson,
  type PersonRoleValue,
} from "@waitron/identity";
import { getLayout, putLayout, putReceipt } from "@waitron/layouts";
import {
  clearPlacement,
  createStatus,
  createTable,
  createZone,
  deactivateStatus,
  deactivateTable,
  deactivateZone,
  type FloorTableShape,
  listStatuses,
  listTables,
  listZones,
  setTablePlacement,
  updateStatus,
  updateTable,
  updateZone,
} from "./tables.js";
import {
  createCourse,
  createStation,
  deactivateCourse,
  deactivateStation,
  getFireControl,
  listCourses,
  listStations,
  setBumpMode,
  setCategoryStation,
  setDefaultStation,
  setFireControl,
  setProductCourse,
  setProductStation,
  updateCourse,
  updateStation,
  type BumpMode,
  type FireControl,
} from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import {
  clearManagementCookie,
  readManagementSessionId,
  requireManagementSession,
  setManagementCookie,
} from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js"; // the same Logger till-api.ts's routes take

/**
 * Everything the dashboard's management HTTP routes need. The management surface reads and writes only
 * the tenant's own identity records, so — unlike `TillApiDeps` — it wires no fiscal backend, clock or
 * card provider. `cfg.tenantId` is the dashboard's own tenant (provisioning stamped it), scoping every
 * `withTenant` below. `secureCookies` decides the management cookie's `Secure` attribute (TRUE on a
 * production HTTPS host, FALSE on loopback dev with no TLS), mirroring `TillApiDeps.secureCookies`.
 */
export interface ManagementApiDeps {
  db: Database;
  cfg: { tenantId: string };
  /**
   * The venue's own config — the tenant + LOCATION the floor-zone and table config routes (FP-1) scope
   * their reads and writes to. The zone/table verbs are location-scoped (`floor_zones` / `dining_tables`
   * carry a `location_id`), so those routes need the venue's location, which `cfg.tenantId` alone cannot
   * give; `boot.ts` threads the deployed `till` config here, the SAME value `mountTillApi` receives, so
   * the dashboard "Sala" config surface and the operator till surface CRUD the same tables under one
   * scope. Only `tenantId` + `locationId` are read on this surface (the fiscal ids a `TillConfig` also
   * carries are inert here — these are config routes that touch no fiscal path). OPTIONAL so the
   * identity/passkey unit-test harnesses, which never exercise the zone/table routes, can omit it; a
   * request that reaches one of those routes without it fails closed (see `requireVenueCfg`).
   */
  venueCfg?: TillConfig;
  secureCookies: boolean;
  /** The WebAuthn Relying Party ID the passkey ceremonies below bind credentials to (`config.ts`'s
   * `managementRpId`, defaulted to `localhost` for dev). A passkey is bound to its RP ID, so this is
   * config threaded from boot, never a constant in `@waitron/identity` (spec §4c). */
  rpId: string;
  /** The exact served origin `@simplewebauthn/server` verifies each ceremony's response against
   * (`config.ts`'s `managementOrigin`, defaulted to `http://localhost:5191`). Carries scheme + port,
   * unlike the bare-domain `rpId`. */
  origin: string;
}

/**
 * Every AppError CODE the management API answers, and the HTTP status it maps to — the management
 * parallel of till-api.ts's `STATUS`. Defined ONCE here and shared by every route Task 4 adds to
 * `mountManagementApi` too, which is why it already lists the credential codes those gated routes
 * surface (`pin.too_short`, `password.too_short`, `person.not_found`, `authorization.not_permitted`).
 * CLIENT faults only: a genuine SERVER fault never appears here — it reaches `run` as a NON-AppError
 * and becomes an opaque 500. A registered code absent from this table defaults to 400, which is why
 * `run` needs the `?? 400`.
 *
 * `shared.invalid_id` is listed for completeness of the branded-id family but is not, on today's
 * routes, reachable on this surface: request ids are screened with `isUuid` and passed to the identity
 * functions as plain strings, and `cfg.tenantId` arrives pre-validated from boot — the only thrower is
 * `@waitron/shared`'s branded-id constructor, which no route here calls with request input. Left in
 * rather than dropped so a future route that DOES construct a branded id gets the 400 rather than the
 * `?? 400` default; see this task's report for the reviewer note.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "password.invalid": 401,
  "totp.invalid": 401,
  // Passkey (WebAuthn) ceremony faults, thrown by the two `finishPasskey*` calls the verify routes
  // below wrap (the `beginPasskey*` options calls never throw these). Both authentication-failure codes
  // are 401 — the auth-verify route IS the login,
  // so a credential that is not registered (`passkey.not_registered`) or an assertion that fails to
  // verify (`passkey.verification_failed`, also thrown on registration verify) is a failed credential
  // check, the same family as `password.invalid`. `passkey.challenge_expired` is a 400: the request was
  // well-formed but its challenge lapsed past `CHALLENGE_TTL_MS`, a client-retryable request-timing
  // fault rather than a rejected credential. The auth-verify route ALSO surfaces `person.suspended`
  // (403, below): `finishPasskeyAuthentication` gates on the credential owner's status the way
  // `loginManager` gates a password login, so a person suspended after enrolling a passkey is refused.
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
  // A duplicate credential on register/verify: `finishPasskeyRegistration` translated a
  // `(tenant_id, credential_id)` 23505 into this code. 409 Conflict, the house convention for a
  // "already exists" collision (`table.label_taken`, `tab.already_open`, `roster.already_published`,
  // `purchase.duplicate` all → 409) — not the `?? 400` default, which would still be a 4xx but the
  // wrong one.
  "passkey.already_registered": 409,
  // Login-enumeration posture, recorded here. This map is SHARED with the authenticated staff routes,
  // where 404/403 are the CORRECT semantics: the write routes
  // (PATCH/reset-pin/password `/management-api/staff/:id`) screen `:id` with `isUuid` and refuse a
  // malformed one as `person.not_found` (404), and `resolveManagementSession` re-reads `persons.status`
  // on every gated request and throws `person.suspended` (403) when the logged-in manager was
  // suspended mid-session (`packages/identity/src/management-session.ts`). The LOGIN route
  // (`POST /management-api/session`) resolves the person by EMAIL and `loginManager` hardens it against
  // enumeration itself: an unknown email is INDISTINGUISHABLE from a wrong password — both
  // `password.invalid` (401) — so `person.not_found` is NOT reachable on login, and its only sources on
  // this surface are the write routes' malformed-`:id` screens above. `person.suspended` (403) IS still
  // surfaced by login: `loginManager` throws it pre-password, so a suspended account is revealed to an
  // unauthenticated caller BY DESIGN — the accepted trade-off (see `loginManager`'s own note on the
  // suspension-before-password ordering). The residual enumeration value is negligible: a suspended
  // person is excluded from the unauthenticated `GET /management-api/staff-roster`
  // (`listActiveStaff` returns only ACTIVE persons), so provoking the 403 needs the account's email,
  // which is published nowhere. The passkey auth-verify route surfaces the same 403 (a suspended
  // credential owner), and provoking it there is HARDER still: it needs the owner's random
  // `credential_id`, not merely their email.
  "person.suspended": 403,
  "person.not_found": 404,
  // The email write boundary (`createPerson`/`setEmail`): a malformed address is a request-shape
  // fault (400), a per-tenant `persons_tenant_email_uq` collision is a "already exists" conflict
  // (409, the house convention — `passkey.already_registered`/`table.label_taken` map the same way,
  // not the `?? 400` default).
  "person.email_invalid": 400,
  "person.email_taken": 409,
  "authorization.not_permitted": 403,
  "pin.too_short": 400,
  "password.too_short": 400,
  "management.request_invalid": 400,
  // The layouts service's validation faults, surfaced by the PUT layout/receipt routes below when
  // `putLayout`/`putReceipt` reject an invalid `definition`/`receipt` (design D8, fail-closed). Both
  // are 400 — a well-formed request whose payload the validator refuses. The `?? 400` default already
  // covers them, but they are listed explicitly as the house style requires (see this map's doc).
  "layout.invalid": 400,
  "receipt.invalid": 400,
  "shared.invalid_id": 400,
  // Service-status config CRUD (TS-2). An unknown status id (or a malformed one screened to it at the
  // PATCH/DELETE routes) names no status → 404 (`status.not_found`); a duplicate label collides on the
  // `(tenant, label)` unique → 409 (`status.label_taken`), the same conflict shape a taken table label
  // has on the till surface. (`status.inactive` is a till-surface set-time fault, not reachable on this
  // config surface, so it is deliberately absent here.)
  "status.not_found": 404,
  "status.label_taken": 409,
  // Floor-zone + table config CRUD (FP-1). An unknown zone/table id (or a malformed one screened to it
  // at the PATCH/DELETE routes) names no row → 404 (`zone.not_found` / `table.not_found`); a duplicate
  // name/label collides on the `(tenant, location, …)` unique → 409 (`zone.name_taken` /
  // `table.label_taken`), the same conflict shape a taken status label has. `zone.not_found` is ALSO
  // surfaced by the table routes when a `zoneId` names no `floor_zones` row (the composite FK, mapped in
  // the verb). The code's own semantics already imply these statuses, but they are listed explicitly as
  // the house style requires (see this map's doc) — an unmapped code would default to 400, the wrong 4xx.
  "zone.not_found": 404,
  "zone.name_taken": 409,
  "table.not_found": 404,
  "table.label_taken": 409,
  // Floor-plan spatial placement (FP-2). A `posX`/`posY`/`rotation` out of range or a `shape` naming no
  // `floor_table_shape` enum member — `setTablePlacement`'s per-field guards — is a well-formed request
  // whose payload the verb refuses → 400, the same family as `management.request_invalid` (which the
  // placement route's own body-shape/type screens throw for a MISSING or wrong-TYPE field). Registered
  // in `errors.ts` (Task 2) where it already defaults to 400; listed explicitly as the house style
  // requires (see this map's doc, and `errors.ts`'s note that the route task would list it here).
  "placement.invalid": 400,
  // Kitchen-station config CRUD (KDS-1). An unknown station id (or a malformed one screened to it at the
  // PATCH/DELETE/default routes), OR a deactivated station named as a routing/default target, names no
  // LIVE station → 404 (`station.not_found`); a duplicate name collides on the `(tenant, location, name)`
  // unique → 409 (`station.name_taken`), the same conflict shape a taken zone name has. (`station.no_default`
  // is a FIRE-time code on the till surface, never thrown by these config routes, so it is absent here.)
  "station.not_found": 404,
  "station.name_taken": 409,
  // Kitchen-course config CRUD (KDS-2, design §3a). An unknown course id (or a malformed one screened to
  // it at the PATCH/DELETE routes), OR a retired/cross-venue course named as a product's default route,
  // names no LIVE course → 404 (`course.not_found`); a duplicate name collides on the
  // `(tenant, location, name)` unique → 409 (`course.name_taken`), the same conflict shape a taken
  // station name has. Courses are a management/config concern, so both codes are mapped HERE — beside the
  // station codes above; `course.not_found` is ALSO mapped on the till surface (`till-api.ts`), where the
  // OPERATIONAL fire route surfaces it. The code's own semantics imply these statuses, but they are
  // listed explicitly as the house style requires (an unmapped code would default to 400, the wrong 4xx).
  "course.not_found": 404,
  "course.name_taken": 409,
};

// The one error boundary every management route wraps its handler in — the shared
// `createErrorBoundary` (see `error-boundary.ts` for its full behaviour) closed over this surface's
// `STATUS` map and its `management.failed` log tag, the management counterpart of till-api.ts's
// exported `run`. Local, not exported: Task 4's gated routes live in this same file and reach it
// directly.
const run = createErrorBoundary(STATUS, "management.failed");

/**
 * Screen a `/management-api/staff/:id` path param as a UUID before it reaches a query, returning it. A
 * malformed id passed straight into a `uuid` column would `22P02` → an opaque 500; refusing it here as
 * `person.not_found` (a caller-supplied uuid, safe to echo) turns that 500 into a clean 404. This
 * screens SHAPE only — it does NOT check existence: a WELL-FORMED id that names no row (a person that
 * does not exist, or another tenant's row RLS hides) passes this guard, reaches the identity
 * `UPDATE persons … WHERE id = <id>` (which matches zero rows and throws nothing — the staff mutations
 * carry no `.returning()`/row-count check), and the route answers 204, the same silent no-op an
 * out-of-range PATCH `status` gets. This is where the guard DIVERGES from till-api.ts's `requireUuidId`:
 * that file's routes then look the row up and throw on absence; the identity staff mutations do not.
 * The three gated `/staff/:id/…` routes (patch, reset-pin, set-password) pass `c.req.param("id")` (a
 * `string` in their route-typed context) and share this one guard.
 */
function requirePersonId(id: string): string {
  if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
  return id;
}

/**
 * Screen a `/management-api/service-statuses/:id` path param as a UUID before it reaches a query,
 * returning it. Mirrors `requirePersonId` for the status routes: a malformed id passed into a `uuid`
 * column would `22P02` → an opaque 500, so refusing it here as `status.not_found` (a caller-supplied
 * uuid, safe to echo) turns that 500 into a clean 404. Proven by deletion in `management-api.status.test.ts`.
 * Shared by the PATCH and DELETE `:id` routes below.
 */
function requireStatusId(id: string): string {
  if (!isUuid(id)) throw new AppError("status.not_found", { statusId: id });
  return id;
}

/**
 * Screen a `/management-api/zones/:id` path param as a UUID, returning it. Mirrors `requireStatusId`
 * for the zone routes: a malformed id passed into a `uuid` column would `22P02` → an opaque 500, so
 * refusing it here as `zone.not_found` (a caller-supplied uuid, safe to echo) turns that 500 into a
 * clean 404. Shared by the PATCH and DELETE `:id` zone routes below.
 */
function requireZoneId(id: string): string {
  if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
  return id;
}

/**
 * Screen a `/management-api/tables/:id` path param as a UUID, returning it. Mirrors `requireStatusId`
 * for the table routes: a malformed id → `22P02` → opaque 500 without this, so it is refused as
 * `table.not_found` (a caller-supplied uuid, safe to echo) for a clean 404 — the same screen
 * `till-api.ts`'s `PATCH`/`DELETE /api/tables/:id` routes apply inline. Shared by the PATCH and DELETE
 * `:id` table routes below.
 */
function requireTableId(id: string): string {
  if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
  return id;
}

/**
 * Screen a `/management-api/stations/:id` path param as a UUID, returning it. Mirrors `requireZoneId`
 * for the kitchen-station routes: a malformed id → `22P02` → opaque 500 without this, so it is refused
 * as `station.not_found` (a caller-supplied uuid, safe to echo) for a clean 404 — the SAME code an absent
 * station gets from the by-id station verbs. Shared by the PATCH, DELETE and set-default `:id` routes.
 */
function requireStationId(id: string): string {
  if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
  return id;
}

/**
 * Screen a `/management-api/courses/:id` path param as a UUID, returning it. Mirrors `requireStationId`
 * for the kitchen-course routes: a malformed id → `22P02` → opaque 500 without this, so it is refused as
 * `course.not_found` (a caller-supplied uuid, safe to echo) for a clean 404 — the SAME code an absent
 * course gets from the by-id course verbs. Shared by the PATCH and DELETE `:id` course routes.
 */
function requireCourseId(id: string): string {
  if (!isUuid(id)) throw new AppError("course.not_found", { courseId: id });
  return id;
}

/**
 * The venue config the floor-zone + table config routes need (`deps.venueCfg`), or a fail-closed throw.
 * `venueCfg` is OPTIONAL on `ManagementApiDeps` (the identity/passkey harnesses omit it), so a route that
 * reaches a config verb has to narrow `TillConfig | undefined` to `TillConfig` first. `boot.ts` always
 * supplies it for a real venue server, so the throw is structurally unreachable in production and is a
 * misconfiguration guard, not a request fault — the same posture `readOrderFlow`'s "no location" guard
 * takes (`till-config.ts`).
 */
function requireVenueCfg(deps: ManagementApiDeps): TillConfig {
  /* v8 ignore next 4 -- boot always threads venueCfg; only a harness that omits it AND hits a zone/table
     route reaches this, which no suite does — a config error, surfaced as an opaque 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error("mountManagementApi: venueCfg is required for the zone/table config routes");
  }
  return deps.venueCfg;
}

/**
 * The one authorize gate every floor-zone + table config route (FP-1) runs its DB work through: open a
 * tenant-scoped transaction as the app role, confirm the caller's management session carries
 * `till.configure`, then run `fn`. Extracted verbatim from the eight zone/table routes so the gate is
 * applied identically and in exactly one place (the `gated` seam `catalogue-api.ts` uses). The route's
 * own `requireManagementSession` (→ 401) still runs FIRST, BEFORE this — this helper only carries the
 * `withTenant` + `asAppUser` + `authorizeManager` block that followed it. `cfg` is the venue config the
 * route resolved via `requireVenueCfg`, whose `tenantId` scopes the transaction (the zone/table verbs
 * are location-scoped, so they take `cfg`, unlike the status verbs).
 */
function withVenueAuth<T>(
  deps: ManagementApiDeps,
  cfg: TillConfig,
  sessionId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    await authorizeManager(tx, { managementSessionId: sessionId, permission: "till.configure" });
    return fn(tx);
  });
}

/**
 * Parse and validate a `displayOrder` request field, shared by the status POST and PATCH routes. An
 * absent field stays `undefined` (a legitimate no-op — POST then defaults it, PATCH leaves it
 * untouched); a PRESENT value must be an integer NUMBER, else it is refused as
 * `management.request_invalid` naming the FIELD (never the value). The `typeof value !== "number"`
 * screen comes FIRST and is deliberate — matching the typeof checks the sibling label/color/active
 * fields use — so a non-number is REJECTED rather than coerced. An earlier `Number(value)` +
 * `Number.isInteger` check silently ACCEPTED `null`/`true`/`""`/`[]` (they coerce to 0/1/0/0), which
 * let an explicit `null` on PATCH reset displayOrder to 0. The dashboard sends `Number(...) || 0`
 * (already a number), so it is unaffected.
 */
function parseDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  // typeof + integer + int4 RANGE: `display_order` is a Postgres `integer`, so a value outside int4's
  // range clears `Number.isInteger` but would reach the column and raise `22003` (an opaque 500) rather
  // than a clean 400 — the same opaque-500-on-int4-overflow class the `capacity` / `line_no` guards close.
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  )
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  return value;
}

/**
 * Parse and validate a `capacity` request field for the table config routes, shared by the table POST
 * and PATCH routes. An absent field stays `undefined` (a legitimate no-op — POST leaves the column NULL,
 * PATCH leaves it untouched); a PRESENT value must be a non-negative integer NUMBER in int4 range, else
 * it is refused as `management.request_invalid` naming the FIELD (never the value). The `typeof` screen
 * comes first (matching `parseDisplayOrder`), so a non-number such as `null` is REJECTED rather than
 * coerced; the int4 upper bound closes the same opaque-500-on-overflow class (`capacity` is a Postgres
 * `integer`; "Plazas" is only its Spanish UI label). The same rule `till-api.ts`'s `requireCapacity`
 * applies to the operator table routes.
 */
function parseCapacity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_147_483_647)
    throw new AppError("management.request_invalid", { field: "capacity" });
  return value;
}

/**
 * Parse and screen a passkey VERIFY route's body, returning the narrowed `{ challengeHandle, response }`
 * pair both `register/verify` and `auth/verify` need — the shared shape those two routes had inline.
 * The body is coerced to `{}` (via `readJsonBody`, see the login route for why a `null`/non-object body must not
 * TypeError → 500). `challengeHandle` is screened to a UUID (load-bearing, not cosmetic: it flows into
 * `eq(webauthnChallenges.id, …)` against a `uuid` PK, so a non-UUID would `22P02` → opaque 500) and
 * `response` to a non-null object before it reaches the verifier; either failure is
 * `management.request_invalid` naming the FIELD, the same code and shape as the sibling write routes.
 * Called AFTER each route's own gating — `register/verify` runs `requireManagementSession` first,
 * `auth/verify` is unauthenticated (it IS the login) — so this helper screens body shape only.
 */
async function parsePasskeyVerifyBody(
  c: Context,
): Promise<{ challengeHandle: string; response: object }> {
  const body = await readJsonBody<{ challengeHandle?: string; response?: unknown }>(c);
  if (typeof body.challengeHandle !== "string" || !isUuid(body.challengeHandle)) {
    throw new AppError("management.request_invalid", { field: "challengeHandle" });
  }
  if (typeof body.response !== "object" || body.response === null) {
    throw new AppError("management.request_invalid", { field: "response" });
  }
  return { challengeHandle: body.challengeHandle, response: body.response };
}

/**
 * Mounts the dashboard's management-session routes on an existing Hono app: the pre-login staff
 * roster, login and logout. Task 4 adds the gated staff CRUD routes to THIS same function, each
 * handler wrapped in `run` (above) so the whole surface maps errors identically. Mirrors
 * `mountTillApi`'s shape — `withTenant(deps.db, deps.cfg.tenantId, …)` + `asAppUser(tx)` on every DB
 * touch, so RLS scopes each read/write to this dashboard's own tenant.
 */
export function mountManagementApi(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  // Roster of active persons. Deliberately UNAUTHENTICATED — it exposes no secret, so it calls
  // `listActiveStaff` under `withTenant` + `asAppUser` (RLS scopes it to this dashboard's tenant)
  // rather than `requireManagementSession`. Two dashboard screens fetch it via `api.getStaffRoster()`
  // today: the pre-login `login-screen.ts` roster PICKER — which is still the dashboard login flow at
  // HEAD (its `#submit` POSTs `{ personId }`) until spec §4.4's email-login migration, a LATER task not
  // yet landed, removes that use — and `my-schedule-screen.ts`'s staff self-service view (the colleague
  // picker + name resolution), which KEEPS using it. So the route stays. (The till has its OWN
  // active-staff route, `GET /api/staff` in till-api.ts — not this one.) `listActiveStaff` returns
  // `{ personId, displayName }` only: no password material, role or status, so there is nothing here a
  // bystander must not see.
  app.get("/management-api/staff-roster", (c) =>
    run(c, log, async () => {
      const roster = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listActiveStaff(tx);
      });
      return c.json(roster);
    }),
  );

  // Login: EMAIL + password (+ TOTP iff the person is enrolled) → management-session cookie. Runs as
  // the app role under the dashboard's tenant (`withTenant` + `asAppUser`), so RLS scopes the person
  // lookup. `loginManager` resolves the person by EMAIL (not a client-supplied id) and hardens against
  // enumeration: an unknown email and a wrong password BOTH surface as `password.invalid` (401), so the
  // response never reveals which addresses have accounts; a suspended person surfaces as
  // `person.suspended` (403), a missing/wrong TOTP as `totp.invalid` (401) — the identity credential
  // codes `STATUS` maps. The body is read via `readJsonBody`
  // (`read-json-body.ts`), which coerces an empty/malformed/`null` body to `{}` so it never reaches
  // `run` as an opaque 500 — see its doc for the two degenerate-body cases it handles. This is the
  // representative site the other body-parsing routes point at: a degenerate body falls through to the
  // screen as the route's OWN 4xx. (A JSON primitive/array body needs no coercion — a field access on
  // it is `undefined`, not a throw.) The body is then screened: a missing/empty `email` (not a string,
  // or a string that trims to empty), a non-string `password`, or a `totp` present but not a string, is
  // refused as `password.invalid` — the SAME code a wrong password or unknown email gets, so nothing in
  // the response tells an unauthenticated caller which field failed. Email FORMAT is validated at
  // WRITE-time (`createPerson`/`setEmail`'s `screenEmail`), NOT here: login screens only that a
  // non-empty string was supplied and leaves a well-formed-but-unknown address to `loginManager`, which
  // answers `password.invalid` uniformly. (Screening `totp` does NOT avert a 500: `verifyTotp`
  // fails closed — probed against otplib@13.4.1, `verifyTotp` returns `false` for a non-string `totp`
  // (number/null/undefined/object/boolean/non-six-digit string all tested): v13's `verifySync` throws
  // on such input and `verifyTotp`'s catch swallows the throw, so the wrapper never surfaces it — a
  // non-string `totp` reaching `loginManager` yields `totp.invalid` when the person is enrolled and is
  // ignored when they are not, never a throw. It is screened for response uniformity and to keep the
  // runtime value matching its declared `string` type; see this task's fix report for the correction to
  // the review's "totp → 500" claim.)
  app.post("/management-api/session", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{ email?: string; password?: string; totp?: string }>(c);
      if (
        typeof body.email !== "string" ||
        body.email.trim() === "" ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      // Bind the validated fields to locals: the guard narrows `body.email`/`body.password` to
      // `string` HERE, but that narrowing does not survive into the `withTenant` closure below (TS
      // resets a captured property to its declared `string | undefined`), so the closure reads these.
      const { email, password, totp } = body;
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManager(tx, {
          tenantId: deps.cfg.tenantId,
          email,
          password,
          totp,
        });
      });
      setManagementCookie(c, session.id, deps.secureCookies);
      return c.json({ personId: session.personId });
    }),
  );

  // Logout: end the management session and clear the cookie. Idempotent — a request with no cookie, or
  // one whose cookie is not even UUID-shaped (so it names no `uuid` row), still clears the cookie and
  // answers 204, so a double logout or a stale tab is never an error. `readManagementSessionId` +
  // `isUuid` skip the DB touch in exactly those cases (the till's `/api/session` logout shape); a valid
  // id ends its session under `withTenant` + `asAppUser`, and `endManagementSession` is itself a no-op
  // on an already-ended one.
  app.delete("/management-api/session", (c) =>
    run(c, log, async () => {
      const id = readManagementSessionId(c);
      if (id !== null && isUuid(id)) {
        await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
          await asAppUser(tx);
          await endManagementSession(tx, id);
        });
      }
      clearManagementCookie(c);
      return c.body(null, 204);
    }),
  );

  // List every person of the tenant (roles, status, credential BOOLEANS — never secrets). Gated:
  // `requireManagementSession` refuses an unauthenticated request with 401 before any DB work, then
  // `listPersons`'s own `authorizeManager` enforces `person.manage` under RLS. The admin-roster
  // counterpart of the unauthenticated `staff-roster` above.
  app.get("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const people = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listPersons(tx, { managementSessionId: sessionId });
      });
      return c.json(people);
    }),
  );

  // Create a person. Gated (401 before any DB work; `createPerson` then enforces `person.manage`).
  // The parsed body is coerced to `{}` (via `readJsonBody`, see the login route for why) and screened: a missing
  // or non-string `displayName`, `role` or `pin` — every field of a `null`/non-object body included —
  // is refused as `management.request_invalid` naming the FIELDS, never their values. `email` is
  // OPTIONAL (till-only PIN staff carry none) and screened typeof-only when present; its SHAPE and
  // per-tenant uniqueness are `createPerson`'s job (`person.email_invalid` → 400, `person.email_taken`
  // → 409). The narrowed
  // fields are bound to locals AFTER the guard because that narrowing does not survive into the
  // `withTenant` closure — the same pattern the login route above uses. Returns the new id at 201.
  app.post("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        displayName?: string;
        role?: PersonRoleValue;
        pin?: string;
        email?: string;
      }>(c);
      if (
        typeof body.displayName !== "string" ||
        typeof body.role !== "string" ||
        typeof body.pin !== "string"
      ) {
        throw new AppError("management.request_invalid", { field: "displayName|role|pin" });
      }
      // `email` is OPTIONAL (till-only PIN staff carry none). A PRESENT-but-non-string value is a
      // request-shape fault named by FIELD, the same typeof-only screen the required fields get; a
      // present string flows on to `createPerson`, which validates its SHAPE (`person.email_invalid`)
      // and per-tenant uniqueness (`person.email_taken`). An absent field stays `undefined` → no email.
      if (body.email !== undefined && typeof body.email !== "string") {
        throw new AppError("management.request_invalid", { field: "email" });
      }
      const { displayName, role, pin, email } = body;
      const created = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createPerson(tx, {
          tenantId: deps.cfg.tenantId,
          managementSessionId: sessionId,
          displayName,
          role,
          pin,
          email,
        });
      });
      return c.json(created, 201);
    }),
  );

  // Update a person's role, status and/or login email. Gated. `:id` is screened with `isUuid` first — a
  // non-UUID names no row, so it is `person.not_found` (the id is a caller-supplied uuid, safe to
  // echo) rather than a request-shape error. Both fields are OPTIONAL, but each is type-screened the
  // way the three sibling write routes screen their required fields: a field PRESENT with a
  // non-string value is refused as `management.request_invalid` naming the FIELD (never the value),
  // so `{ role: 123 }`/`{ status: 123 }` are a 400 rather than flowing on to the `person_role`
  // pgEnum (a non-string `role` → `22P02` → opaque 500) or silently no-op'ing (a non-string
  // `status` matches neither branch below). An ABSENT field is left `undefined` and is a legitimate
  // no-op — that is where PATCH differs from create/reset-pin/set-password, whose fields are
  // required. Given a well-formed value the writes fire: `role` present drives `setRole`, `status`
  // "suspended"/"active" drives suspend/reactivate (a STRING `status` outside that pair, e.g.
  // "frozen", matches neither branch and is a deliberate 204 no-op — a value check the pgEnum would
  // catch on `role` is intentionally NOT applied here, keeping the screen typeof-only like create).
  // The parsed body is coerced to `{}` (via `readJsonBody`, see the login route): an empty JSON object
  // `{}`, or a `null`/non-object/empty/unparseable body — all handed back as `{}` by `readJsonBody` —
  // leaves both `role` and `status` undefined → no writes → a no-op 204. (A `null` body would
  // otherwise throw on the destructure below, and an empty/unparseable body would otherwise reach `run`
  // as a SyntaxError → `server.internal` 500; `readJsonBody` averts both.) `role`/`status` are bound to
  // locals before the closure and narrowed inside
  // it, so no field narrowing has to cross the closure boundary. `email` is OPTIONAL too and
  // independent: present-and-a-string drives `setEmail` (shape → `person.email_invalid` 400,
  // per-tenant collision → `person.email_taken` 409); a non-string is a 400 naming the field; absent
  // is a no-op. The identity calls enforce `person.manage`.
  app.patch("/management-api/staff/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{
        role?: PersonRoleValue;
        status?: "active" | "suspended";
        email?: string;
      }>(c);
      const { role, status, email } = body;
      // Typeof screen mirroring the create/reset-pin/set-password routes: refuse a PRESENT field that
      // is not a string (leaving an absent one as the no-op it should be). This is where a non-string
      // `role` would otherwise reach the `person_role` pgEnum and 500; a non-string `status` would
      // silently no-op. An out-of-enum STRING is left to flow through (create screens `role` the same
      // typeof-only way), so `role: "chef"` still reaches the pgEnum by design.
      if (role !== undefined && typeof role !== "string") {
        throw new AppError("management.request_invalid", { field: "role" });
      }
      if (status !== undefined && typeof status !== "string") {
        throw new AppError("management.request_invalid", { field: "status" });
      }
      // `email` is OPTIONAL and independent of role/status: a PRESENT-but-non-string value is a
      // request-shape 400 named by field; a present string drives `setEmail`, which validates the
      // address (`person.email_invalid` → 400) and per-tenant uniqueness (`person.email_taken` → 409).
      if (email !== undefined && typeof email !== "string") {
        throw new AppError("management.request_invalid", { field: "email" });
      }
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        if (role !== undefined) {
          await setRole(tx, { managementSessionId: sessionId, personId: id, role });
        }
        if (status === "suspended") {
          await suspendPerson(tx, { managementSessionId: sessionId, personId: id });
        }
        if (status === "active") {
          await reactivatePerson(tx, { managementSessionId: sessionId, personId: id });
        }
        if (typeof email === "string") {
          await setEmail(tx, { managementSessionId: sessionId, personId: id, email });
        }
      });
      return c.body(null, 204);
    }),
  );

  // Reset a person's PIN. Gated. `:id` screened with `isUuid` (→ `person.not_found`); the body is
  // coerced to `{}` (via `readJsonBody`, see the login route) so a `null`/non-object body hits the same guard,
  // then `pin` must be a string else `management.request_invalid` naming the FIELD, never the PIN
  // itself. The narrowed `pin` is bound to a local before the closure; `resetPin` enforces
  // `person.manage` and length-checks the value.
  app.post("/management-api/staff/:id/reset-pin", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{ pin?: string }>(c);
      if (typeof body.pin !== "string") {
        throw new AppError("management.request_invalid", { field: "pin" });
      }
      const { pin } = body;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await resetPin(tx, { managementSessionId: sessionId, personId: id, pin });
      });
      return c.body(null, 204);
    }),
  );

  // Set a person's dashboard password. Gated. `:id` screened with `isUuid` (→ `person.not_found`);
  // the body is coerced to `{}` (via `readJsonBody`, see the login route) so a `null`/non-object body hits the
  // same guard, then `password` must be a string else `management.request_invalid` naming the FIELD,
  // never the password itself. The narrowed `password` is bound to a local before the closure;
  // `setPassword` enforces `person.manage` and length-checks the value.
  app.post("/management-api/staff/:id/password", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{ password?: string }>(c);
      if (typeof body.password !== "string") {
        throw new AppError("management.request_invalid", { field: "password" });
      }
      const { password } = body;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await setPassword(tx, { managementSessionId: sessionId, personId: id, password });
      });
      return c.body(null, 204);
    }),
  );

  // ── Layout + receipt configuration (Task 7) ───────────────────────────────────────────────────
  // The dashboard's till-layout / receipt-trim editor surface. All three routes are gated
  // (`requireManagementSession` first, 401 before any DB work) and every DB touch runs under
  // `withTenant` + `asAppUser`, so RLS scopes both the authorize gate and the `till_layouts` row to
  // this dashboard's own tenant. The two PUTs delegate the authorize + validate + upsert to
  // `@waitron/layouts`'s `putLayout`/`putReceipt`; the GET calls `getLayout`, which does NOT authorize
  // (see below), so it carries its own gate.

  // Read the tenant's authored layout + receipt (or the built-in defaults). Gated on `till.configure`,
  // NOT merely on holding a session — least-privilege: only a manager/admin who may EDIT the layout may
  // open the editor (design §7's "403 not-permitted" row). `getLayout` itself deliberately does NOT
  // authorize — it is SHARED with the unauthenticated till boot read (`GET /api/till`, till-api.ts) —
  // so this route calls `authorizeManager` explicitly, unlike the PUT routes below whose gate lives
  // inside the store. Proven by deletion in `management-api.rls.test.ts`: dropping this
  // `authorizeManager` call flips the staff-role case from 403 to 200.
  app.get("/management-api/layout", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { definition, receipt } = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "till.configure",
        });
        return getLayout(tx, deps.cfg.tenantId);
      });
      return c.json({ definition, receipt });
    }),
  );

  // Author (full replacement) the tenant's till layout. Gated (401 before any DB work); `putLayout`
  // then enforces `till.configure` (403 `authorization.not_permitted`) and validates the definition
  // (400 `layout.invalid`) before the upsert. The parsed body is coerced to `{}` (via `readJsonBody`,
  // see the login route for why an empty/malformed/`null` body must not reach `run` as a 500) and
  // screened: a body that
  // is not a plain object, or one that omits `definition`, is refused as `management.request_invalid`
  // naming the FIELD (never the value) — the same shape as the staff write routes. A PRESENT
  // `definition` (even `null` or a malformed shape) flows to `putLayout`, whose `validateLayout`
  // rejects it as `layout.invalid`, keeping request-shape faults (400 request_invalid) distinct from
  // payload-validation faults (400 layout.invalid).
  app.put("/management-api/layout", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ definition?: unknown }>(c);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        !("definition" in body)
      ) {
        throw new AppError("management.request_invalid", { field: "definition" });
      }
      const { definition } = body;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await putLayout(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          definition,
        });
      });
      return c.body(null, 204);
    }),
  );

  // Author (full replacement) the tenant's receipt trim. Same gating + body-screen shape as
  // `PUT /management-api/layout`: `putReceipt` enforces `till.configure` and validates the receipt
  // (400 `receipt.invalid`); the body-shape screen refuses a non-object body or an absent `receipt`
  // key as `management.request_invalid` naming the FIELD.
  app.put("/management-api/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ receipt?: unknown }>(c);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        !("receipt" in body)
      ) {
        throw new AppError("management.request_invalid", { field: "receipt" });
      }
      const { receipt } = body;
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await putReceipt(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          receipt,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Service-status configuration (TS-2) ──────────────────────────────────────────────────────────
  // The dashboard's service-status editor surface (design §3a), mirroring the layout/receipt routes
  // above. All four are gated (`requireManagementSession` first, 401 before any DB work); each verb's
  // own `authorizeManager(..., "till.configure")` enforces the write gate under RLS.

  // Create a status. Body { label, color, displayOrder? }; a bad shape → management.request_invalid
  // naming the FIELD; a duplicate label → status.label_taken (409); a bad color → request_invalid.
  app.post("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ label?: unknown; color?: unknown; displayOrder?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.label !== "string")
        throw new AppError("management.request_invalid", { field: "label" });
      if (typeof body.color !== "string")
        throw new AppError("management.request_invalid", { field: "color" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      // Bind the validated fields to locals: the `typeof` guards narrow `body.label`/`body.color` to
      // `string` HERE, but that narrowing does not survive into the `withTenant` closure (TS resets a
      // captured property to its declared type), so the closure reads these — the login/create-person
      // pattern above.
      const { label, color } = body;
      const result = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createStatus(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          label,
          color,
          displayOrder,
        });
      });
      return c.json(result, 201);
    }),
  );

  // The whole status set (active + inactive), for the editor. Gated on till.configure via listStatuses.
  app.get("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const statuses = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listStatuses(tx, { managementSessionId: sessionId, tenantId: deps.cfg.tenantId });
      });
      return c.json(statuses);
    }),
  );

  // Edit a status (label/color/displayOrder/active — any subset). Malformed :id → status.not_found (a
  // bad id names no status), not a 500. A present field with the wrong type → management.request_invalid.
  app.patch("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStatusId(c.req.param("id"));
      const body = await readJsonBody<{
        label?: unknown;
        color?: unknown;
        displayOrder?: unknown;
        active?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: {
        managementSessionId: string;
        tenantId: string;
        id: string;
        label?: string;
        color?: string;
        displayOrder?: number;
        active?: boolean;
      } = {
        managementSessionId: sessionId,
        tenantId: deps.cfg.tenantId,
        id,
      };
      if (body.label !== undefined) {
        if (typeof body.label !== "string")
          throw new AppError("management.request_invalid", { field: "label" });
        patch.label = body.label;
      }
      if (body.color !== undefined) {
        if (typeof body.color !== "string")
          throw new AppError("management.request_invalid", { field: "color" });
        patch.color = body.color;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      // A patch carrying no mutable field is a no-op — the SAME shape the staff PATCH route treats an
      // empty/`null` body as (`PATCH /management-api/staff/:id` → 204, no write). Return 204 WITHOUT
      // touching the DB rather than reaching `updateStatus`'s `.set()` with an empty object, which
      // Drizzle rejects ("No values to set") — a non-AppError the boundary would turn into an opaque
      // 500. A `null`/`{}`/malformed body coerces to `{}` above (via `readJsonBody`), so this is where a degenerate PATCH
      // body maps to a clean 204 rather than a 500, the same null-body discipline the sibling
      // layout/receipt PUT routes follow.
      if (
        patch.label === undefined &&
        patch.color === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await updateStatus(tx, patch);
      });
      return c.body(null, 204);
    }),
  );

  // Deactivate a status (DELETE = deactivate; app_user holds no hard DELETE). Malformed :id →
  // status.not_found.
  app.delete("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStatusId(c.req.param("id"));
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await deactivateStatus(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          id,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Floor-plan zone + table configuration (FP-1) ──────────────────────────────────────────────────
  // The dashboard "Sala" config screen (design §3d): CRUD the venue's floor zones and — as thin
  // wrappers over TS-1's table verbs — its dining tables. All eight routes are gated exactly like the
  // layout `GET` above: `requireManagementSession` first (401 before any DB work), then each route calls
  // `authorizeManager(…, "till.configure")` EXPLICITLY inside `withTenant` + `asAppUser` (unlike the
  // status verbs, the zone/table verbs do NOT authorize themselves — they take a plain venue `cfg` — so
  // the gate lives at the route, the layout-`GET` shape). The verbs are location-scoped, so each reads
  // the venue's config via `requireVenueCfg`. Body-shape screens mirror the service-status routes above.

  // Create a zone. Body { name, displayOrder? }; a bad shape → management.request_invalid naming the
  // FIELD; a duplicate name → zone.name_taken (409). Returns the new id at 201, matching every other
  // management-surface create (createPerson/staff, createStatus).
  app.post("/management-api/zones", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      // Bind the validated field to a local: the `typeof` guard narrows `body.name` to `string` HERE,
      // but that narrowing does not survive into the `withTenant` closure (TS resets a captured property
      // to its declared type), so the closure reads this — the login/create-person pattern above.
      const { name } = body;
      const result = await withVenueAuth(deps, cfg, sessionId, (tx) =>
        createZone(tx, cfg, { name, displayOrder }),
      );
      return c.json(result, 201);
    }),
  );

  // The venue's ACTIVE zones, by display order, for the editor. Gated on till.configure.
  app.get("/management-api/zones", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const zones = await withVenueAuth(deps, cfg, sessionId, (tx) => listZones(tx, cfg));
      return c.json(zones);
    }),
  );

  // Edit a zone (name/displayOrder/active — any subset). Malformed :id → zone.not_found (a bad id names
  // no zone), not a 500. A present field with the wrong type → management.request_invalid. A patch
  // carrying no mutable field is a 204 no-op (the sibling status PATCH shape) — returned WITHOUT reaching
  // updateZone's empty `.set()`, which Drizzle rejects ("No values to set") as an opaque 500.
  app.patch("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { name?: string; displayOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, cfg, sessionId, (tx) => updateZone(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // Deactivate a zone (DELETE = deactivate; app_user holds no hard DELETE). Malformed :id → zone.not_found.
  app.delete("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => deactivateZone(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // Create a table (thin wrapper over TS-1's `createTable`). Body { label, zoneId?, capacity? }; a bad
  // shape → management.request_invalid naming the FIELD; a duplicate label → table.label_taken (409); a
  // `zoneId` naming no floor_zones row (or another tenant's) → zone.not_found (404), mapped in the verb
  // (`isZoneFkViolation`) and NOT re-mapped here. Returns the new id at 201 (the management-surface
  // create convention; TS-1's till POST returns 200, but this surface is 201 throughout).
  app.post("/management-api/tables", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ label?: unknown; zoneId?: unknown; capacity?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.label !== "string")
        throw new AppError("management.request_invalid", { field: "label" });
      let zoneId: string | undefined;
      if (body.zoneId !== undefined) {
        if (typeof body.zoneId !== "string")
          throw new AppError("management.request_invalid", { field: "zoneId" });
        // A string-typed but MALFORMED zoneId passes the `typeof` screen above, then un-screened reaches
        // the `zone_id` uuid column → `22P02` → opaque 500. Screen it as a UUID and give it the SAME
        // `zone.not_found` a well-formed-but-missing zoneId gets (the composite FK's 23503, mapped in the
        // verb) — the till surface's create/patch routes screen it identically.
        if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
        zoneId = body.zoneId;
      }
      const capacity = parseCapacity(body.capacity);
      // Bind the validated `label` to a local: the `typeof` guard narrows `body.label` to `string` HERE,
      // but that narrowing does not survive into the `withTenant` closure (a captured property resets to
      // its declared type), so the closure reads this local — the login/create-person pattern above.
      const { label } = body;
      const result = await withVenueAuth(deps, cfg, sessionId, (tx) =>
        createTable(tx, cfg, { label, zoneId, capacity }),
      );
      return c.json(result, 201);
    }),
  );

  // The venue's ACTIVE tables, by label (thin wrapper over TS-1's `listTables`). Gated on till.configure.
  app.get("/management-api/tables", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const tables = await withVenueAuth(deps, cfg, sessionId, (tx) => listTables(tx, cfg));
      return c.json(tables);
    }),
  );

  // Edit a table — label/zoneId/capacity, any subset (thin wrapper over TS-1's `updateTable`). Malformed
  // :id → table.not_found; an unknown id → table.not_found; a label collision → table.label_taken; a
  // `zoneId` naming no zone → zone.not_found (verb-mapped). A present field with the wrong type →
  // management.request_invalid; a patch with no mutable field is a 204 no-op (avoids updateTable's empty
  // `.set()` 500, the sibling status/zone PATCH shape).
  app.patch("/management-api/tables/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ label?: unknown; zoneId?: unknown; capacity?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { label?: string; zoneId?: string; capacity?: number } = {};
      if (body.label !== undefined) {
        if (typeof body.label !== "string")
          throw new AppError("management.request_invalid", { field: "label" });
        patch.label = body.label;
      }
      if (body.zoneId !== undefined) {
        if (typeof body.zoneId !== "string")
          throw new AppError("management.request_invalid", { field: "zoneId" });
        // Screen a string-typed but MALFORMED zoneId as a UUID (same as the POST route above): un-screened
        // it reaches the `zone_id` uuid column → `22P02` → opaque 500, so it gets the SAME `zone.not_found`
        // a well-formed-but-missing zoneId does.
        if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
        patch.zoneId = body.zoneId;
      }
      if (body.capacity !== undefined) {
        patch.capacity = parseCapacity(body.capacity);
      }
      if (patch.label === undefined && patch.zoneId === undefined && patch.capacity === undefined) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, cfg, sessionId, (tx) => updateTable(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // Deactivate a table (DELETE = deactivate; app_user holds no hard DELETE; the table has order history).
  // Malformed :id → table.not_found (thin wrapper over TS-1's `deactivateTable`).
  app.delete("/management-api/tables/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => deactivateTable(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Floor-plan spatial placement (FP-2) ───────────────────────────────────────────────────────────
  // The dashboard "Sala" editor's place / un-place actions (design §placement): thin wrappers over Task
  // 2's `setTablePlacement` / `clearPlacement`. Same gating and mapping as the FP-1 zone/table routes
  // above — `requireManagementSession` first (401 before any DB work), then `withVenueAuth` runs the verb
  // under `withTenant` + `asAppUser` + `authorizeManager(…, "till.configure")`, so a staff session is
  // refused 403 before any write (proven by dropping the authorize in `withVenueAuth`, the deletion-proof
  // the test names). `requireTableId` screens `:id` (malformed → table.not_found, not an opaque 22P02
  // 500); the verbs own the placement VALUE validation (`placement.invalid`) and the live-table /
  // live-zone reads (`table.not_found` / `zone.not_found`).

  // Place a table (PUT = full placement). Body { zoneId, posX, posY, shape, rotation }; the body-shape
  // screen mirrors the sibling table routes — a non-object body → management.request_invalid naming
  // "body", each MISSING or wrong-TYPE field → the same code naming THAT field. A string-typed but
  // MALFORMED `zoneId` is screened to zone.not_found (as the sibling POST/PATCH do: un-screened it reaches
  // the `id` uuid column → 22P02 → opaque 500). The narrowed fields are bound to locals before the
  // closure (the login/create-person pattern). Value/range faults (posX/posY 0..1000, shape enum,
  // rotation 0..359) are the verb's `placement.invalid`; a missing/inactive table or zone is its
  // table.not_found/zone.not_found. Returns 204 (the sibling PATCH/DELETE convention on this surface).
  app.put("/management-api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{
        zoneId?: unknown;
        posX?: unknown;
        posY?: unknown;
        shape?: unknown;
        rotation?: unknown;
      }>(c);
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
      // `withVenueAuth` closure — a captured property resets to its declared type). `shape` is cast to
      // `FloorTableShape` here; the verb re-validates enum membership (→ placement.invalid), so the cast
      // asserts nothing the verb does not check.
      const { zoneId, posX, posY, rotation } = body;
      const shape = body.shape as FloorTableShape;
      await withVenueAuth(deps, cfg, sessionId, (tx) =>
        setTablePlacement(tx, cfg, id, { zoneId, posX, posY, shape, rotation }),
      );
      return c.body(null, 204);
    }),
  );

  // Un-place a table (DELETE = clear placement; NULLs the four columns, leaves zone_id as-is). Malformed
  // :id → table.not_found; an absent row → table.not_found (the verb's row-count check). Same gate as the
  // PUT above; mirrors the sibling `DELETE /management-api/tables/:id` shape exactly. Returns 204.
  app.delete("/management-api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => clearPlacement(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Kitchen-station + routing configuration (KDS-1, design §3a/§3f) ────────────────────────────────
  // The dashboard "Cocina" config screen: CRUD the venue's kitchen stations, pick the default, route
  // categories/products to a station, and set the whole-ticket `bump_mode`. All gated exactly like the
  // FP-1 zone/table routes above — `requireManagementSession` first (401 before any DB work), then
  // `withVenueAuth` runs the verb under `withTenant` + `asAppUser` + `authorizeManager(…, "till.configure")`,
  // so a staff session is refused 403 before any write (proven by dropping the authorize in `withVenueAuth`,
  // the deletion-proof the tests name). The verbs are location-scoped, so each reads the venue's config via
  // `requireVenueCfg`. Body-shape screens mirror the service-status / zone routes above.

  // Create a station. Body { name, displayOrder?, isDefault? }; a bad shape → management.request_invalid
  // naming the FIELD; a duplicate name → station.name_taken (409). Marking it default ADOPTS it as THE
  // default (the verb clears any prior default in the same tx). Returns the new id at 201.
  app.post("/management-api/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        isDefault?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      let isDefault: boolean | undefined;
      if (body.isDefault !== undefined) {
        if (typeof body.isDefault !== "boolean")
          throw new AppError("management.request_invalid", { field: "isDefault" });
        isDefault = body.isDefault;
      }
      // Bind the validated `name` to a local: the `typeof` guard narrows `body.name` to `string` HERE,
      // but that narrowing does not survive into the `withVenueAuth` closure (a captured property resets
      // to its declared type), so the closure reads this local — the login/create-person pattern above.
      const { name } = body;
      const result = await withVenueAuth(deps, cfg, sessionId, (tx) =>
        createStation(tx, cfg, { name, displayOrder, isDefault }),
      );
      return c.json(result, 201);
    }),
  );

  // The venue's ACTIVE stations, by display order then name (the picker's own read shape). Gated on
  // till.configure.
  app.get("/management-api/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const stations = await withVenueAuth(deps, cfg, sessionId, (tx) => listStations(tx, cfg));
      return c.json(stations);
    }),
  );

  // Edit a station (name/displayOrder/active — any subset; NOT is_default, which only the set-default
  // route flips). Malformed :id → station.not_found (a bad id names no station), not a 500; an unknown id
  // → station.not_found; a name collision → station.name_taken. A present field with the wrong type →
  // management.request_invalid; a patch carrying no mutable field is a 204 no-op (the sibling zone PATCH
  // shape) — returned WITHOUT reaching updateStation's empty `.set()`, which Drizzle rejects.
  app.patch("/management-api/stations/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { name?: string; displayOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, cfg, sessionId, (tx) => updateStation(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // Deactivate a station (DELETE = deactivate; app_user holds no hard DELETE — a `ticket_items.station_id`
  // snapshot may reference it). Malformed :id → station.not_found; an unknown id → station.not_found.
  app.delete("/management-api/stations/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => deactivateStation(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // Make a station the venue's single default (the counter/pass fallback). Malformed :id →
  // station.not_found; a retired or foreign station → station.not_found (the verb's live-station check,
  // which runs BEFORE any write so a bad id never clears the existing default). Returns 204.
  app.post("/management-api/stations/:id/default", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => setDefaultStation(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // Route a CATEGORY (its default route) or a PRODUCT (its override, winning over the category default)
  // to a station — byte-identical PUTs but for the resource segment and the setter verb, so ONE factory
  // registers both. Body { stationId: string | null } (null clears it). A non-null stationId must be a
  // LIVE station of this venue (the verb → station.not_found); a malformed one is screened to that SAME
  // code before the DB touch. A malformed :id names no such entity — the verb no-ops on an unknown one, so
  // it is the same no-op (INSIDE `withVenueAuth`, so the gate still runs first for a validly-shaped
  // request), never a 22P02 500. KDS-1 mints no `category.not_found`/`product.not_found` (spec §6).
  // Returns 204.
  const registerStationRoute = (
    segment: string,
    setStation: (
      tx: Transaction,
      cfg: TillConfig,
      id: string,
      stationId: string | null,
    ) => Promise<void>,
  ): void => {
    app.put(`/management-api/${segment}/:id/station`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const cfg = requireVenueCfg(deps);
        const id = c.req.param("id");
        const body = await readJsonBody<{ stationId?: unknown }>(c);
        if (typeof body.stationId !== "string" && body.stationId !== null) {
          throw new AppError("management.request_invalid", { field: "stationId" });
        }
        const stationId = body.stationId;
        if (stationId !== null && !isUuid(stationId)) {
          throw new AppError("station.not_found", { stationId });
        }
        await withVenueAuth(deps, cfg, sessionId, async (tx) => {
          if (!isUuid(id)) return; // malformed id names no entity → the verb's unknown-id no-op
          await setStation(tx, cfg, id, stationId);
        });
        return c.body(null, 204);
      }),
    );
  };
  registerStationRoute("categories", setCategoryStation);
  registerStationRoute("products", setProductStation);

  // Set the venue's whole-ticket bump mode (KDS-1 §2e) — body { mode: "line" | "ticket" }. A missing or
  // non-{line,ticket} value is a request-shape fault → management.request_invalid naming the FIELD (which
  // also keeps a bad value off the `bump_mode` enum column). `setBumpMode` writes `locations.bump_mode`
  // scoped to this venue. Returns 204.
  app.put("/management-api/bump-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ mode?: unknown }>(c);
      if (body.mode !== "line" && body.mode !== "ticket") {
        throw new AppError("management.request_invalid", { field: "mode" });
      }
      // Bind `mode` to a local (the narrowing above does not survive into the `withVenueAuth` closure).
      const mode: BumpMode = body.mode;
      await withVenueAuth(deps, cfg, sessionId, (tx) => setBumpMode(tx, cfg, mode));
      return c.body(null, 204);
    }),
  );

  // ── Kitchen-course + fire-control configuration (KDS-2, design §3a) ────────────────────────────────
  // The dashboard "Cursos" panel: CRUD the venue's coursing sequence, route a product to its default
  // course, and read/write the fire-control setting. All gated exactly like the KDS-1 station routes above
  // — `requireManagementSession` first (401 before any DB work), then `withVenueAuth` runs the verb under
  // `withTenant` + `asAppUser` + `authorizeManager(…, "till.configure")`, so a staff session is refused 403
  // before any write (proven by dropping the authorize in `withVenueAuth`, the deletion-proof the tests
  // name). The verbs are location-scoped, so each reads the venue's config via `requireVenueCfg`.
  // Body-shape screens mirror the station / service-status routes above.

  // Create a course. Body { name, displayOrder? }; a bad shape → management.request_invalid naming the
  // FIELD; a duplicate name → course.name_taken (409). No default concept (courses have none, spec §2b),
  // so no isDefault field. Returns the new id at 201, matching every other management-surface create.
  app.post("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      // Bind the validated `name` to a local: the `typeof` guard narrows `body.name` HERE, but that
      // narrowing does not survive into the `withVenueAuth` closure — the login/create-person pattern.
      const { name } = body;
      const result = await withVenueAuth(deps, cfg, sessionId, (tx) =>
        createCourse(tx, cfg, { name, displayOrder }),
      );
      return c.json(result, 201);
    }),
  );

  // The venue's ACTIVE courses, by display order then name (the coursing SEQUENCE). Gated on till.configure.
  app.get("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const courses = await withVenueAuth(deps, cfg, sessionId, (tx) => listCourses(tx, cfg));
      return c.json(courses);
    }),
  );

  // Edit a course (name/displayOrder/active — any subset). Malformed :id → course.not_found (a bad id
  // names no course), not a 500; an unknown id → course.not_found; a name collision → course.name_taken.
  // A present field with the wrong type → management.request_invalid; a patch carrying no mutable field is
  // a 204 no-op (the sibling station PATCH shape) — returned WITHOUT reaching updateCourse's empty `.set()`.
  app.patch("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { name?: string; displayOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, cfg, sessionId, (tx) => updateCourse(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // Deactivate a course (DELETE = deactivate; app_user holds no hard DELETE — a `ticket_items.course_id`
  // snapshot may reference it). Malformed :id → course.not_found; an unknown id → course.not_found.
  app.delete("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, cfg, sessionId, (tx) => deactivateCourse(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // Set (or clear, with null) a PRODUCT's default kitchen course (the catalogue config, spec §3a). Body
  // { courseId: string | null }. A non-null courseId must be a LIVE course of this venue (the verb's
  // `requireLiveCourse` → course.not_found); a malformed one is screened to that SAME code before the DB
  // touch. A malformed PRODUCT :id names no such product — the verb no-ops on an unknown one, so it is the
  // same no-op (INSIDE `withVenueAuth`, so the gate still runs first for a validly-shaped request), never a
  // 22P02 500. The sibling of the `PUT /management-api/products/:id/station` route above. Returns 204.
  app.put("/management-api/products/:id/course", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const id = c.req.param("id");
      const body = await readJsonBody<{ courseId?: unknown }>(c);
      if (typeof body.courseId !== "string" && body.courseId !== null) {
        throw new AppError("management.request_invalid", { field: "courseId" });
      }
      const courseId = body.courseId;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withVenueAuth(deps, cfg, sessionId, async (tx) => {
        if (!isUuid(id)) return; // malformed id names no product → the verb's unknown-id no-op
        await setProductCourse(tx, cfg, id, courseId);
      });
      return c.body(null, 204);
    }),
  );

  // Read the venue's fire-control setting (spec §3a: read AND written with the other venue config, for the
  // dashboard's toggle). Gated on till.configure. Returns { mode: "waiter" | "kitchen" | "expo" }.
  app.get("/management-api/fire-control", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const mode = await withVenueAuth(deps, cfg, sessionId, (tx) => getFireControl(tx, cfg));
      return c.json({ mode });
    }),
  );

  // Set the venue's fire-control setting — body { mode: "waiter" | "kitchen" | "expo" }. A missing or
  // out-of-enum value is a request-shape fault → management.request_invalid naming the FIELD (which also
  // keeps a bad value off the `fire_control_mode` enum column). The valid set is DERIVED from the DB enum
  // (`fireControlMode.enumValues`, re-exported by `@waitron/db`'s barrel just like the sibling `orderFlow`
  // this file's neighbours import), so a new `ADD VALUE 'x'` in the migration is accepted here with no
  // hand-edit — this is the one drift site typecheck cannot protect (`const mode: FireControl = body.mode`
  // only rejects an EXTRA member, never a MISSING one, so a stale literal list would silently 400 a valid
  // mode). `setFireControl` writes `locations.fire_control` scoped to this venue. Sibling of
  // `PUT /management-api/bump-mode`. Returns 204.
  app.put("/management-api/fire-control", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ mode?: unknown }>(c);
      if (
        typeof body.mode !== "string" ||
        !(fireControlMode.enumValues as readonly string[]).includes(body.mode)
      ) {
        throw new AppError("management.request_invalid", { field: "mode" });
      }
      // Membership above verifies `mode` is a real enum value; narrow it for the `withVenueAuth` closure.
      const mode = body.mode as FireControl;
      await withVenueAuth(deps, cfg, sessionId, (tx) => setFireControl(tx, cfg, mode));
      return c.body(null, 204);
    }),
  );

  // ── Passkey (WebAuthn) ceremonies ─────────────────────────────────────────────────────────────
  // Each ceremony is the WebAuthn two-phase handshake the browser drives: an `options` call issues
  // (and stores) the challenge the authenticator signs, and a `verify` call checks the signed response
  // against that stored challenge. `rpId`/`origin` come from `deps` (config threaded from boot, never
  // hardcoded — a passkey is bound to its RP ID + origin, spec §4c). REGISTRATION is GATED
  // (`requireManagementSession` before any DB work): a signed-in operator enrolls a passkey for
  // themselves, and the person is resolved from the session, never a client id. AUTHENTICATION is
  // UNGATED because it IS the login — the exact parallel of `POST /management-api/session` — so a
  // caller with no session can complete it, and the verify half sets the management cookie itself.

  // Begin passkey registration (gated): issue + store the creation options for the signed-in person.
  app.post("/management-api/passkey/register/options", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return beginPasskeyRegistration(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          rpId: deps.rpId,
          rpName: "Waitron",
        });
      });
      return c.json(out);
    }),
  );

  // Finish passkey registration (gated): verify the signed response against the stored challenge and
  // persist the credential. The parsed body is coerced to `{}` (via `readJsonBody`, see the login route for why a
  // `null`/non-object body must not TypeError → 500) and `challengeHandle` is screened to a UUID (else
  // `management.request_invalid` naming the FIELD, matching the sibling write routes). The UUID screen
  // is load-bearing, not cosmetic: `challengeHandle` flows into `eq(webauthnChallenges.id, …)` against
  // a `uuid` PK column, so a well-formed-string-but-non-UUID value would `22P02` → opaque 500 — the
  // same failure `requirePersonId`'s `isUuid` screen above exists to prevent, keeping `run`'s
  // "every surfaced code is a client 4xx" invariant true. `response` is then required to be a non-null
  // object (else the same `management.request_invalid`) before it reaches the verifier.
  //
  // `finishPasskeyRegistration`'s `@simplewebauthn/server` verify call throws a GENERIC `Error` on a
  // bad/mismatched response (a missing/non-base64url credential id, wrong origin/RPID, a malformed
  // attestation) — NOT a mapped `passkey.*` code — so `finishPasskeyRegistration` wraps it and throws
  // `passkey.verification_failed` (also the code for a `verified:false` return). The ceremony's TTL is
  // OUR check inside that function, not the library's: it throws `passkey.challenge_expired` when the
  // stored challenge has lapsed past `CHALLENGE_TTL_MS`. Both map via `STATUS` (401 / 400).
  app.post("/management-api/passkey/register/verify", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { challengeHandle, response } = await parsePasskeyVerifyBody(c);
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return finishPasskeyRegistration(tx, {
          managementSessionId: sessionId,
          tenantId: deps.cfg.tenantId,
          challengeHandle,
          response: response as never,
          rpId: deps.rpId,
          origin: deps.origin,
        });
      });
      return c.json(out);
    }),
  );

  // Begin passkey authentication (UNGATED — this IS the login): issue + store the discoverable request
  // options. No session and no body: the person is unknown until the assertion is verified on finish.
  app.post("/management-api/passkey/auth/options", (c) =>
    run(c, log, async () => {
      const out = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return beginPasskeyAuthentication(tx, { tenantId: deps.cfg.tenantId, rpId: deps.rpId });
      });
      return c.json(out);
    }),
  );

  // Finish passkey authentication (UNGATED — this IS the login): verify the signed assertion, open a
  // management session for the credential's owner, set the cookie, and return the person id — the exact
  // shape of the password login route. Same body coercion + `challengeHandle` UUID screen as
  // register/verify above; the UUID screen matters MORE here because this route is UNAUTHENTICATED, so
  // a non-UUID `challengeHandle` reaching the `uuid` PK column (`22P02` → opaque 500) would be an
  // unauthenticated 500 — the same failure the write routes' `requirePersonId` `isUuid` screen prevents
  // (the password login route no longer screens a UUID: it screens a non-empty `email` string).
  // `response` is then required to be a non-null object (else `management.request_invalid`): this route
  // is UNAUTHENTICATED and `finishPasskeyAuthentication` reads `response.id` to resolve the credential,
  // so a missing/non-object `response` must be a clean 400 here rather than an unauthenticated fault.
  //
  // `finishPasskeyAuthentication`'s `@simplewebauthn/server` verify call throws a GENERIC `Error` on a
  // bad/mismatched assertion (a bad signature, wrong origin/RPID, UV not performed) — NOT a mapped
  // code — which that function wraps into `passkey.verification_failed`. Its other faults:
  // `passkey.not_registered` (no credential matched the returned id, or the returned id was non-string),
  // `person.suspended` (the credential's owner was suspended after enrolling — the same gate
  // `loginManager` applies), and `passkey.challenge_expired` (OUR TTL check, not the library's). These
  // map to 401 / 401 / 403 / 400 via `STATUS`. `setManagementCookie` uses `deps.secureCookies`,
  // mirroring `POST /management-api/session`.
  app.post("/management-api/passkey/auth/verify", (c) =>
    run(c, log, async () => {
      const { challengeHandle, response } = await parsePasskeyVerifyBody(c);
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return finishPasskeyAuthentication(tx, {
          tenantId: deps.cfg.tenantId,
          challengeHandle,
          response: response as never,
          rpId: deps.rpId,
          origin: deps.origin,
        });
      });
      setManagementCookie(c, session.id, deps.secureCookies);
      return c.json({ personId: session.personId });
    }),
  );
}
