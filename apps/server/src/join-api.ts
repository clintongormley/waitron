// Side-effect only: loads this host's errors.ts augmentation for the codes THIS file throws directly —
// `device.join_mismatch` (a wrong number, thrown AFTER the transaction commits the deny),
// `join_request.not_found` (the tenant holds no such pending row) and `management.request_invalid`
// (the `kind` query and accept-body screens). The accept-time binding codes reach here through the
// value import of `acceptDeviceJoinRequest` (`join-requests.js`, which calls `resolveDeviceBinding`),
// and the management-session/authorization codes through `@waitron/identity`. See the note atop
// `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { authorizeManager, withPassiveManagementRead, type Permission } from "@waitron/identity";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireString,
} from "@waitron/server-kit";
import {
  acceptDeviceJoinRequest,
  acceptPrintAgentJoinRequest,
  challengeFor,
  denyJoinRequest,
  joinRequestKind,
  listPendingJoinRequests,
  type JoinRequestKind,
} from "./join-requests.js";
import type { PairingMode } from "./pairing-mode.js";
import { isUuid } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import type { Logger } from "./logger.js";

/**
 * Everything `mountJoinApi` needs. `cfg` is the FULL `TillConfig` because the verbs it calls are typed
 * that way (`listPendingJoinRequests`, `challengeFor` and `acceptDeviceJoinRequest` read
 * `cfg.tenantId`, and accept stamps the device from the REQUEST's own `location_id`); the routes touch
 * none of the fiscal ids on it. `pairingMode` is the SAME holder `boot.ts` hands the device mount — one
 * window for the venue, a property of the wiring rather than a rule anyone has to remember.
 */
export interface JoinApiDeps {
  db: Database;
  cfg: TillConfig;
  pairingMode: PairingMode;
}

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a
 * genuine SERVER fault reaches `run` as a NON-AppError and becomes an opaque `server.internal` 500. A
 * registered code absent from this table defaults to 400 via `run`.
 *
 * The accept-time binding faults (`device.station_required`, `device.register_required`,
 * `device.register_name_taken`, `device.binding_invalid`, `device_profile.not_found`,
 * `station.not_found`) are `resolveDeviceBinding`'s, raised on this surface's accept route; they carry
 * the SAME statuses `device-api.ts` gives them, so a code answered by both surfaces has one status
 * everywhere.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  // Unknown, another tenant's, already decided, or (on the accept route) an agent's ask — all fold
  // here, because the caller's recovery is identical and none of them may confirm the others.
  "join_request.not_found": 404,
  // A wrong number denies the request (the row is already gone), so this is a plain request fault.
  "device.join_mismatch": 400,
  "device.station_required": 400,
  "device.register_required": 400,
  "device.register_name_taken": 409,
  "device.binding_invalid": 400,
  "device_profile.not_found": 404,
  "station.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
};

// The one error boundary every route on this surface wraps its handler in.
const run = createErrorBoundary(STATUS, "join.failed");

/**
 * Which permission a kind's rows are gated on. The shared routes read this rather than hard-coding
 * `device.manage`, so a `printer.manage` holder can work their own pending list and nobody else's.
 */
const PERMISSION_FOR: Record<JoinRequestKind, Permission> = {
  device: "device.manage",
  print_agent: "printer.manage",
};

/**
 * The permission a by-id route demands when the id names NO row of this tenant. It has to be some
 * fixed permission — there is no kind to read — and `device.manage` is the choice; see
 * `gatedByRowKind` for why the gate runs at all on a row that is not there.
 */
const MISSING_ROW_PERMISSION: Permission = "device.manage";

/** The screen for the `?kind=` query the pending list is asked in terms of. A kind is a value domain
 * the route is the authority for (the column is a pgEnum, so an unknown value would `22P02` a 500),
 * and it is required rather than defaulted: "which surface's queue am I looking at" is never an
 * assumption to make on the admin's behalf. */
function requireKind(value: string | undefined): JoinRequestKind {
  if (value === "device" || value === "print_agent") return value;
  throw new AppError("management.request_invalid", { field: "kind" });
}

/**
 * A present-but-optional body UUID: absent OR explicit `null` → `null` (the field does not apply to
 * this profile's form factor); a present value must be UUID-SHAPED (a non-uuid would `22P02` at the
 * bare-uuid column) → `management.request_invalid` naming the field. `resolveDeviceBinding` decides
 * whether the field is REQUIRED for the chosen profile (`device.station_required` /
 * `device.register_required`).
 */
function optionalBodyUuid(v: unknown, field: string): string | null {
  return v === undefined || v === null ? null : requireBodyUuid(v, field);
}

/**
 * Mounts the join-request management surface on an existing Hono app — the `mountDeviceApi` /
 * `mountManagementApi` convention, attached to the SAME app. Every handler is wrapped in `run`.
 *
 * Two groups:
 *
 *  1. THE PAIRING WINDOW (`GET`/`POST`/`DELETE /management-api/pairing-mode` and `POST /renew`) —
 *     read it, open or extend it, shut it. The holder is the venue's one window (`pairing-mode.ts`),
 *     shared with every surface that has a knock.
 *  2. THE PENDING REQUESTS. Everything that is the MECHANISM is shared across the surfaces — list,
 *     challenge, deny — and takes its permission from the row's kind. Only ACCEPT is per-surface,
 *     because that is the one step where the surfaces differ in what an approved request becomes; this
 *     file mounts BOTH accepts (device → `device.manage`, print agent → `printer.manage`), and each
 *     refuses the OTHER kind 404 via the predicate riding its consuming delete.
 */
export function mountJoinApi(app: Hono, deps: JoinApiDeps, log: Logger): void {
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // `permission`, then run `fn` — `device-api.ts`'s `gated`, with the permission passed in rather than
  // baked in, because this surface gates on two of them.
  const gated = <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });

  /**
   * The shared by-id routes need the permission the ROW's kind demands, which is not known until the
   * row is read — so `gated` cannot take it up front. The shape, exactly:
   *
   *   1. inside `withTenant` + `asAppUser`, read the row's kind (tenant-scoped);
   *   2. `authorizeManager` for `PERMISSION_FOR[kind]`;
   *   3. act.
   *
   * A caller holding neither permission gets 403 whether or not the row exists: step 2 runs before
   * anything is disclosed, and a MISSING row still authorizes (against `MISSING_ROW_PERMISSION`)
   * before the route answers `join_request.not_found`. Otherwise the status code itself is the oracle
   * — an unauthorised caller learns which ids are live from the 403-vs-404 split and enumerates the
   * venue's pending requests one guess at a time.
   *
   * A MALFORMED id takes the same path as an unknown one: it never reaches a bare-uuid comparison
   * (which would `22P02` → an opaque 500), and it is refused after the gate like any other miss.
   */
  const gatedByRowKind = <T>(
    sessionId: string,
    id: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const kind = isUuid(id) ? await joinRequestKind(tx, deps.cfg, id) : undefined;
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: kind === undefined ? MISSING_ROW_PERMISSION : PERMISSION_FOR[kind],
      });
      if (kind === undefined) throw new AppError("join_request.not_found", {});
      return fn(tx);
    });

  // The window routes are gated on `device.manage` ALONE, not on "either management permission".
  // `device.manage` and `printer.manage` are held by exactly the same roles today
  // (`packages/identity/src/permissions.ts`: MANAGER carries both, and `admin` holds ALL), so one gate
  // excludes nobody who could otherwise open one of the two queues this window feeds. That is a claim
  // about the role map, not about the permissions themselves — if the map ever separates them, this
  // gate has to become "either", and nothing else here would notice.
  //
  // Authorization resolves the session inside a transaction even when the route only changes memory.

  // ── Read the window (device.manage) ─────────────────────────────────────────────────────────────
  app.get("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
      // `refusedRecently` is the count of knocks the shut window turned away in the last
      // REFUSED_WINDOW_MS — the dashboard renders it beside the toggle, so an admin who left the door
      // shut can see that something is out there waiting to be let in.
      return c.json({
        open: deps.pairingMode.isOpen(),
        openUntil: deps.pairingMode.openUntil(),
        refusedRecently: deps.pairingMode.refusedRecently(),
      });
    }),
  );

  // ── Open or extend the window (device.manage) ───────────────────────────────────────────────────
  app.post("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
      // `open()` on an already-open window MOVES the lapse to one window from now rather than adding
      // another — so the admin's "still doing this" is one idempotent tap, and a run of them cannot
      // leave the door open for hours.
      return c.json(deps.pairingMode.open(), 200);
    }),
  );

  // ── Renew the window while an enrolment dialog is open (device.manage) ──────────────────────────
  app.post("/management-api/pairing-mode/renew", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Automatic renewal must still authorize the caller without counting as human activity.
      await withPassiveManagementRead(() =>
        gated(sessionId, "device.manage", async () => undefined),
      );
      return c.json(deps.pairingMode.open(), 200);
    }),
  );

  // ── Shut the window (device.manage) ─────────────────────────────────────────────────────────────
  app.delete("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
      // Shutting refuses the NEXT knock only. Requests already pending stay pending and are still
      // acceptable — the window admits an ask, it does not hold one open.
      deps.pairingMode.close();
      return c.body(null, 204);
    }),
  );

  // ── The pending queue for one surface (permission from the asked-for kind) ──────────────────────
  // The kind is a QUERY parameter, so unlike the by-id routes below the permission IS known up front.
  app.get("/management-api/join-requests", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const kind = requireKind(c.req.query("kind"));
      // `listPendingJoinRequests`'s return type has no number field at all — the list must never carry
      // the answer beside the question, and a type that cannot express it is a stronger guarantee than
      // a `select` that happens not to ask for it.
      return c.json(
        await gated(sessionId, PERMISSION_FOR[kind], (tx) =>
          listPendingJoinRequests(tx, deps.cfg, kind),
        ),
      );
    }),
  );

  // ── The three numbers to pick from (permission from the ROW's kind) ─────────────────────────────
  app.get("/management-api/join-requests/:id/challenge", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      return c.json(await gatedByRowKind(sessionId, id, (tx) => challengeFor(tx, deps.cfg, id)));
    }),
  );

  // ── Refuse a request (permission from the ROW's kind) ───────────────────────────────────────────
  app.post("/management-api/join-requests/:id/deny", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      await gatedByRowKind(sessionId, id, (tx) => denyJoinRequest(tx, deps.cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Approve a DEVICE's ask (device.manage) ──────────────────────────────────────────────────────
  // Per-surface, unlike the three above: accept is the one step where the surfaces differ in what an
  // approved request becomes (here, a `devices` row carrying the request's own id and token hash). An
  // agent's ask is refused 404 by the kind predicate riding `acceptDeviceJoinRequest`'s consuming
  // delete, so a `device.manage` holder can never turn one into a device.
  app.post("/management-api/device-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // PARSED out here, SCREENED inside the gate. Parsing awaits the request stream, so doing it
      // under `withTenant` would hold a pool connection across a network read; screening is pure and
      // belongs after `authorizeManager`, so this route refuses an unauthorised caller 403 before it
      // says anything about their id or body — the ordering `gatedByRowKind` documents, applied here
      // too so the file's two by-id paths do not disagree. Throwing from inside the transaction is
      // safe HERE, unlike the mismatch below: nothing has been written when a screen fires.
      // `readJsonBody` coerces an empty/malformed/`null` body to `{}` (never an opaque 500).
      const body = await readJsonBody<{
        choice?: unknown;
        profileId?: unknown;
        stationId?: unknown;
        registerId?: unknown;
      }>(c);
      const result = await gated(sessionId, "device.manage", (tx) => {
        // `choice` is a plain string, not a two-digit screen: the verb compares it against the row's
        // own number, and a value of any other shape is simply wrong — which must DENY the request,
        // not be argued about in the route.
        const choice = requireString(body.choice, "choice");
        const profileId = requireBodyUuid(body.profileId, "profileId");
        const stationId = optionalBodyUuid(body.stationId, "stationId");
        const registerId = optionalBodyUuid(body.registerId, "registerId");
        // A malformed id names no request — refused before it reaches a bare-uuid comparison (which
        // would `22P02` → an opaque 500), exactly as an unknown one is.
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        return acceptDeviceJoinRequest(tx, deps.cfg, id, {
          choice,
          profileId,
          stationId,
          registerId,
        });
      });
      // THE MISMATCH IS THROWN AFTER THE TRANSACTION, NEVER INSIDE IT. `withTenant` IS the transaction
      // (`packages/db/src/tenancy.ts:15`), so an AppError raised inside it rolls the consuming delete
      // back into existence and a wrong tap becomes an unlimited retry — the exact opposite of the
      // property that makes one-in-three an acceptable guess rate. The verb returns the mismatch as a
      // RESULT for this reason; the route commits it, then answers.
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.json(
        { deviceId: result.deviceId, name: result.name, formFactor: result.formFactor },
        200,
      );
    }),
  );

  // ── Approve a PRINT AGENT's ask (printer.manage) ─────────────────────────────────────────────────
  // The other per-surface accept, gated on `printer.manage` rather than `device.manage`. What an
  // approved request becomes differs (here, a `print_agents` row carrying the request's own id + token
  // hash, so the agent's Bearer keeps working — no device binding), which is why accept is per-surface
  // while list/challenge/deny are shared above. A device ask is refused 404 by the kind predicate riding
  // `acceptPrintAgentJoinRequest`'s consuming delete, so a `printer.manage` holder can never turn one
  // into an agent. The body is just `{ choice }` — there is no binding to resolve.
  app.post("/management-api/print-agent-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // PARSED out here, screened inside the gate — the device accept route's ordering, so the file's two
      // by-id accept paths do not disagree: an unauthorised caller is refused 403 before the route says
      // anything about its id or body. `readJsonBody` coerces an empty/malformed/`null` body to `{}`.
      const body = await readJsonBody<{ choice?: unknown }>(c);
      const result = await gated(sessionId, "printer.manage", (tx) => {
        const choice = requireString(body.choice, "choice");
        // A malformed id names no request — refused before it reaches a bare-uuid comparison (which
        // would `22P02` → an opaque 500), exactly as an unknown one is (oracle-free, decision M3).
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        return acceptPrintAgentJoinRequest(tx, deps.cfg, id, { choice });
      });
      // THE MISMATCH IS THROWN AFTER THE TRANSACTION, NEVER INSIDE IT — an AppError raised inside
      // `withTenant` (which IS the transaction) would roll the consuming delete back into existence and
      // turn a wrong tap into an unlimited retry. The verb returns the mismatch as a RESULT for exactly
      // this reason; the route commits it, then answers (see `acceptPrintAgentJoinRequest`'s header).
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.body(null, 204);
    }),
  );
}
