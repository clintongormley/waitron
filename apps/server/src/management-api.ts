// Side-effect only: keeps this host's `server.internal` code (and the rest of errors.ts) reachable
// from the file that answers with it — the reachability convention till-api.ts and
// management-session.ts follow. `@waitron/identity`'s own error-code augmentations
// (`password.invalid`, `person.*`, `totp.invalid`, `management_session.*`, `authorization.*`, …)
// load transitively via the value imports from that package below, so no bare
// `import "@waitron/identity"` is needed on top of them.
import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isAppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import {
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
  setPassword,
  setRole,
  suspendPerson,
  type PersonRoleValue,
} from "@waitron/identity";
import { codeOf } from "./error-code.js";
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
  // Passkey (WebAuthn) ceremony faults, thrown by the four `finishPasskey*`/`beginPasskey*` calls the
  // routes below wrap. Both authentication-failure codes are 401 — the auth-verify route IS the login,
  // so a credential that is not registered (`passkey.not_registered`) or an assertion that fails to
  // verify (`passkey.verification_failed`, also thrown on registration verify) is a failed credential
  // check, the same family as `password.invalid`. `passkey.challenge_expired` is a 400: the request was
  // well-formed but its challenge lapsed past `CHALLENGE_TTL_MS`, a client-retryable request-timing
  // fault rather than a rejected credential.
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
  // Login-enumeration trade-off, ACCEPTED and recorded here (not changed). This map is SHARED with the
  // authenticated staff routes, where 404/403 are the CORRECT semantics: the write routes
  // (PATCH/reset-pin/password `/management-api/staff/:id`) screen `:id` with `isUuid` and refuse a
  // malformed one as `person.not_found` (404), and `resolveManagementSession` re-reads `persons.status`
  // on every gated request and throws `person.suspended` (403) when the logged-in manager was
  // suspended mid-session (`packages/identity/src/management-session.ts`). A global remap to 401 to
  // hide enumeration would mislabel both. The cost falls on the LOGIN route
  // (`POST /management-api/session`): an unknown `personId` surfaces 404 and a suspended one 403, so a
  // caller can distinguish either from a wrong password (`password.invalid`, 401) — where the till
  // login deliberately maps `person.not_found → 401` instead (till-api.ts's `STATUS`). The enumeration
  // value is negligible: active person ids are ALREADY public via the unauthenticated
  // `GET /management-api/staff-roster` (`listActiveStaff` returns `{personId, displayName}` for every
  // active person), so a 404-vs-401 split reveals nothing new about them; a suspended person is
  // excluded from that roster, so a 403 can only be provoked by already holding their id — a 122-bit
  // random v4 UUID (`persons.id` is `gen_random_uuid()`), infeasible to guess.
  "person.suspended": 403,
  "person.not_found": 404,
  "authorization.not_permitted": 403,
  "pin.too_short": 400,
  "password.too_short": 400,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
};

/**
 * The one error boundary every management route wraps its handler in — the local counterpart of
 * till-api.ts's exported `run`, identical in shape but keyed on the management `STATUS` map and
 * logging server faults under `management.failed`.
 *
 * An `AppError` becomes a structured `{ error: { code, params } }` at its mapped status (or 400 when
 * unmapped), logged at `warn`: every code the API surfaces is a client 4xx by construction (see
 * `STATUS`), so there is no `error`-level AppError to distinguish. Anything else IS a server fault:
 * logged at `error` under `management.failed` with only `codeOf`'s classification (never the caught
 * value's `.message`, which a driver can load with a connection string), and answered with an opaque
 * `server.internal` 500 that leaks nothing. Local, not exported: Task 4's gated routes live in this
 * same file and reach it directly.
 */
async function run(c: Context, log: Logger, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (cause) {
    if (isAppError(cause)) {
      const status = STATUS[cause.code] ?? 400;
      log("warn", cause.code, cause.params);
      return c.json({ error: { code: cause.code, params: cause.params } }, status);
    }
    log("error", "management.failed", { errorCode: codeOf(cause) });
    return c.json({ error: { code: "server.internal" } }, 500);
  }
}

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
 * Mounts the dashboard's management-session routes on an existing Hono app: the pre-login staff
 * roster, login and logout. Task 4 adds the gated staff CRUD routes to THIS same function, each
 * handler wrapped in `run` (above) so the whole surface maps errors identically. Mirrors
 * `mountTillApi`'s shape — `withTenant(deps.db, deps.cfg.tenantId, …)` + `asAppUser(tx)` on every DB
 * touch, so RLS scopes each read/write to this dashboard's own tenant.
 */
export function mountManagementApi(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  // Pre-login roster for the login screen. Deliberately UNAUTHENTICATED — it is what the manager picks
  // their name from before any session exists — so it calls `listActiveStaff` under `withTenant` +
  // `asAppUser` (RLS scopes it to this dashboard's tenant) rather than `requireManagementSession`.
  // `listActiveStaff` returns `{ personId, displayName }` only: no password material, role or status,
  // so there is nothing here a bystander must not see. The till's `GET /api/staff` parallel.
  app.get("/management-api/staff-roster", (c) =>
    run(c, log, async () => {
      const roster = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return listActiveStaff(tx);
      });
      return c.json(roster);
    }),
  );

  // Login: password (+ TOTP iff the person is enrolled) → management-session cookie. Runs as the app
  // role under the dashboard's tenant (`withTenant` + `asAppUser`), so RLS scopes the person lookup and
  // a wrong password, missing/wrong TOTP, unknown or suspended person surfaces as the identity
  // credential codes `STATUS` maps to 401/403/404. The parsed body is coerced to `{}` (`?? {}`) FIRST,
  // and this is the representative site for WHY every body-parsing route below does the same: a valid
  // JSON `null` body (the 4-byte string `null`) parses to `null`, and reading a field off `null` — or
  // destructuring it — throws a `TypeError` that `run` cannot tell from a server fault, turning a
  // client's degenerate body into an opaque 500. `?? {}` makes a `null`/`undefined` body fall through
  // the screen as the route's own 4xx instead; a JSON primitive/array body needs no coercion, since a
  // field access on it is `undefined` rather than a throw. The body is then screened: a non-string or
  // non-UUID `personId`, a non-string `password`, or a `totp` present but not a string, is refused as
  // `password.invalid` — the SAME code a wrong password gets, so nothing in the response tells an
  // unauthenticated caller which field failed. (Screening `totp` does NOT avert a 500: `verifyTotp`
  // fails closed — probed against otplib@12.0.1, a non-string token returns `false`, never throws — so
  // a non-string `totp` reaching `loginManager` yields `totp.invalid` when the person is enrolled and
  // is ignored when they are not, never a throw. It is screened for response uniformity and to keep the
  // runtime value matching its declared `string` type; see this task's fix report for the correction to
  // the review's "totp → 500" claim.)
  app.post("/management-api/session", (c) =>
    run(c, log, async () => {
      const body =
        (await c.req.json<{ personId?: string; password?: string; totp?: string }>()) ?? {};
      if (
        typeof body.personId !== "string" ||
        !isUuid(body.personId) ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      // Bind the validated fields to locals: the guard narrows `body.personId`/`body.password` to
      // `string` HERE, but that narrowing does not survive into the `withTenant` closure below (TS
      // resets a captured property to its declared `string | undefined`), so the closure reads these.
      const { personId, password, totp } = body;
      const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return loginManager(tx, {
          tenantId: deps.cfg.tenantId,
          personId,
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
  // The parsed body is coerced to `{}` (`?? {}`, see the login route for why) and screened: a missing
  // or non-string `displayName`, `role` or `pin` — every field of a `null`/non-object body included —
  // is refused as `management.request_invalid` naming the FIELDS, never their values. The narrowed
  // fields are bound to locals AFTER the guard because that narrowing does not survive into the
  // `withTenant` closure — the same pattern the login route above uses. Returns the new id at 201.
  app.post("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body =
        (await c.req.json<{
          displayName?: string;
          role?: PersonRoleValue;
          pin?: string;
        }>()) ?? {};
      if (
        typeof body.displayName !== "string" ||
        typeof body.role !== "string" ||
        typeof body.pin !== "string"
      ) {
        throw new AppError("management.request_invalid", { field: "displayName|role|pin" });
      }
      const { displayName, role, pin } = body;
      const created = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return createPerson(tx, {
          tenantId: deps.cfg.tenantId,
          managementSessionId: sessionId,
          displayName,
          role,
          pin,
        });
      });
      return c.json(created, 201);
    }),
  );

  // Update a person's role and/or status. Gated. `:id` is screened with `isUuid` first — a
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
  // The parsed body is coerced to `{}` (`?? {}`, see the login route): an empty JSON object `{}`, or
  // a `null`/non-object body, leaves both `role` and `status` undefined → no writes → a no-op 204.
  // (Only a JSON `null` body would otherwise throw on the destructure below; a truly empty or
  // unparseable HTTP body is the separate SyntaxError→500 case that `run` maps to `server.internal`,
  // out of scope here.) `role`/`status` are bound to locals before the closure and narrowed inside
  // it, so no field narrowing has to cross the closure boundary. The identity calls enforce
  // `person.manage`.
  app.patch("/management-api/staff/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body =
        (await c.req.json<{ role?: PersonRoleValue; status?: "active" | "suspended" }>()) ?? {};
      const { role, status } = body;
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
      });
      return c.body(null, 204);
    }),
  );

  // Reset a person's PIN. Gated. `:id` screened with `isUuid` (→ `person.not_found`); the body is
  // coerced to `{}` (`?? {}`, see the login route) so a `null`/non-object body hits the same guard,
  // then `pin` must be a string else `management.request_invalid` naming the FIELD, never the PIN
  // itself. The narrowed `pin` is bound to a local before the closure; `resetPin` enforces
  // `person.manage` and length-checks the value.
  app.post("/management-api/staff/:id/reset-pin", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body = (await c.req.json<{ pin?: string }>()) ?? {};
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
  // the body is coerced to `{}` (`?? {}`, see the login route) so a `null`/non-object body hits the
  // same guard, then `password` must be a string else `management.request_invalid` naming the FIELD,
  // never the password itself. The narrowed `password` is bound to a local before the closure;
  // `setPassword` enforces `person.manage` and length-checks the value.
  app.post("/management-api/staff/:id/password", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      const body = (await c.req.json<{ password?: string }>()) ?? {};
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
  // persist the credential. The parsed body is coerced to `{}` (`?? {}`, see the login route for why a
  // `null`/non-object body must not TypeError → 500) and `challengeHandle` is screened to a UUID (else
  // `management.request_invalid` naming the FIELD, matching the sibling write routes). The UUID screen
  // is load-bearing, not cosmetic: `challengeHandle` flows into `eq(webauthnChallenges.id, …)` against
  // a `uuid` PK column, so a well-formed-string-but-non-UUID value would `22P02` → opaque 500 — the
  // same failure `requirePersonId`'s `isUuid` screen above exists to prevent, keeping `run`'s
  // "every surfaced code is a client 4xx" invariant true. `response` is handed straight to
  // `@simplewebauthn/server`, which validates its shape and throws the mapped `passkey.*` codes
  // (`verification_failed`, `challenge_expired`) on a bad or lapsed ceremony.
  app.post("/management-api/passkey/register/verify", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<{ challengeHandle?: string; response?: unknown }>()) ?? {};
      if (typeof body.challengeHandle !== "string" || !isUuid(body.challengeHandle)) {
        throw new AppError("management.request_invalid", { field: "challengeHandle" });
      }
      const { challengeHandle, response } = body;
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
  // unauthenticated 500 — the login route's own `isUuid(body.personId)` screen exists for exactly this.
  // `passkey.not_registered`/`verification_failed`/`challenge_expired` map to 401/401/400 via `STATUS`.
  // `setManagementCookie` uses `deps.secureCookies`, mirroring `POST /management-api/session`.
  app.post("/management-api/passkey/auth/verify", (c) =>
    run(c, log, async () => {
      const body = (await c.req.json<{ challengeHandle?: string; response?: unknown }>()) ?? {};
      if (typeof body.challengeHandle !== "string" || !isUuid(body.challengeHandle)) {
        throw new AppError("management.request_invalid", { field: "challengeHandle" });
      }
      const { challengeHandle, response } = body;
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
