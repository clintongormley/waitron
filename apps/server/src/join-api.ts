// Side-effect only: loads this host's errors.ts augmentation for the codes this file throws. See the
// note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
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

/** `pairingMode` must be the SAME holder `boot.ts` hands the device mount: one window per venue. */
export interface JoinApiDeps {
  db: Database;
  cfg: TillConfig;
  pairingMode: PairingMode;
}

/**
 * The accept-time binding faults are `resolveDeviceBinding`'s; they carry the SAME statuses
 * `device-api.ts` gives them, so a code answered by both surfaces has one status everywhere.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  // Unknown, already decided, or (on the accept route) an agent's ask — all fold
  // here, because the caller's recovery is identical and none of them may confirm the others.
  "join_request.not_found": 404,
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

const run = createErrorBoundary(STATUS, "join.failed");

const PERMISSION_FOR: Record<JoinRequestKind, Permission> = {
  device: "device.manage",
  print_agent: "printer.manage",
};

/** The permission a by-id route demands when the id names no row; see `gatedByRowKind` for why. */
const MISSING_ROW_PERMISSION: Permission = "device.manage";

/** Required rather than defaulted: which surface's queue is being read is never assumed on the
 * admin's behalf. */
function requireKind(value: string | undefined): JoinRequestKind {
  if (value === "device" || value === "print_agent") return value;
  throw new AppError("management.request_invalid", { field: "kind" });
}

/**
 * Absent or explicit `null` → `null`; a present value must be UUID-shaped, because the id columns are
 * plain `text` and refuse nothing. `resolveDeviceBinding` decides whether the field is required.
 */
function optionalBodyUuid(v: unknown, field: string): string | null {
  return v === undefined || v === null ? null : requireBodyUuid(v, field);
}

/**
 * List, challenge and deny are shared across kinds and take their permission from the row's kind.
 * Only accept is per-surface, because that is where the kinds differ in what an approved request
 * becomes; each accept refuses the OTHER kind 404 via the predicate riding its consuming delete.
 */
export function mountJoinApi(app: Hono, deps: JoinApiDeps, log: Logger): void {
  const gated = <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
      return fn(tx);
    });

  /**
   * A caller holding neither permission gets 403 whether or not the row exists: a MISSING row still
   * authorizes (against `MISSING_ROW_PERMISSION`) before the route answers `join_request.not_found`.
   * Otherwise the 403-vs-404 split tells an unauthorised caller which ids are live. A malformed id
   * takes the same path as an unknown one.
   */
  const gatedByRowKind = <T>(
    sessionId: string,
    id: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const kind = isUuid(id) ? await joinRequestKind(tx, deps.cfg, id) : undefined;
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: kind === undefined ? MISSING_ROW_PERMISSION : PERMISSION_FOR[kind],
      });
      if (kind === undefined) throw new AppError("join_request.not_found", {});
      return fn(tx);
    });

  // The window routes are gated on `device.manage` ALONE. That excludes nobody only because
  // `device.manage` and `printer.manage` are held by the same roles
  // (`packages/identity/src/permissions.ts`, pinned by `join-api.test.ts`); if the map ever
  // separates them, this gate has to become "either".

  // ── Read the window (device.manage) ─────────────────────────────────────────────────────────────
  app.get("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, "device.manage", async () => undefined);
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
      return c.json(deps.pairingMode.open(), 200);
    }),
  );

  // ── Renew the window while an enrolment dialog is open (device.manage) ──────────────────────────
  app.post("/management-api/pairing-mode/renew", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // A dialog can reopen a lapsed window, but renewal never counts as human session activity.
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
      // Shutting refuses the NEXT knock only; requests already pending stay acceptable.
      deps.pairingMode.close();
      return c.body(null, 204);
    }),
  );

  // ── The pending queue for one surface (permission from the asked-for kind) ──────────────────────
  app.get("/management-api/join-requests", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const kind = requireKind(c.req.query("kind"));
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
  app.post("/management-api/device-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // PARSED out here, SCREENED inside the gate. Parsing awaits the request stream, and
      // `withTransaction` holds the write lock (`packages/db/src/tenancy.ts`); screening after
      // `authorizeManager` refuses an unauthorised caller 403 before saying anything about its id or
      // body.
      const body = await readJsonBody<{
        choice?: unknown;
        profileId?: unknown;
        stationId?: unknown;
        registerId?: unknown;
      }>(c);
      const result = await gated(sessionId, "device.manage", (tx) => {
        // Any string, not a two-digit screen: a value that is not the row's number must DENY.
        const choice = requireString(body.choice, "choice");
        const profileId = requireBodyUuid(body.profileId, "profileId");
        const stationId = optionalBodyUuid(body.stationId, "stationId");
        const registerId = optionalBodyUuid(body.registerId, "registerId");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        return acceptDeviceJoinRequest(tx, deps.cfg, id, {
          choice,
          profileId,
          stationId,
          registerId,
        });
      });
      // THE MISMATCH IS THROWN AFTER THE TRANSACTION, NEVER INSIDE IT: thrown inside, it would roll
      // the consuming delete back and turn a wrong tap into an unlimited retry. The verb returns the
      // mismatch as a RESULT for this reason; the route commits it, then answers.
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.json(
        { deviceId: result.deviceId, name: result.name, formFactor: result.formFactor },
        200,
      );
    }),
  );

  // ── Approve a PRINT AGENT's ask (printer.manage) ─────────────────────────────────────────────────
  app.post("/management-api/print-agent-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // PARSED out here, screened inside the gate, for the device accept route's reasons.
      const body = await readJsonBody<{ choice?: unknown }>(c);
      const result = await gated(sessionId, "printer.manage", (tx) => {
        const choice = requireString(body.choice, "choice");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        return acceptPrintAgentJoinRequest(tx, deps.cfg, id, { choice });
      });
      // Thrown AFTER the transaction, for the device accept route's reason.
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.body(null, 204);
    }),
  );
}
