// Side-effect only: loads this host's errors.ts augmentation for the codes this file throws. See the
// note atop `errors.ts`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorizeManager,
  hashSessionToken,
  persons,
  withPassiveManagementRead,
  type Permission,
} from "@waitron/identity";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireString,
} from "@waitron/server-kit";
import { requireDeviceName } from "./device.js";
import {
  acceptDeviceJoinRequest,
  acceptPrintAgentJoinRequest,
  challengeFor,
  checkDeviceJoinNumber,
  denyJoinRequest,
  discardLapsedDeviceRequests,
  joinRequestKind,
  listPendingJoinRequests,
  returningDevicesOf,
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
  deviceAddress: string;
}

/**
 * The accept-time binding faults are `resolveDeviceBinding`'s; they carry the SAME statuses
 * `device-api.ts` gives them, so a code answered by both surfaces has one status everywhere.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  // Unknown, already decided, or (on a per-surface route) the other kind's ask. On the device accept
  // route a device id this login holds no live claim on answers `join_request.unclaimed` instead,
  // whether or not the request still exists.
  "join_request.not_found": 404,
  "device.join_mismatch": 400,
  "device.station_required": 400,
  "device.name_taken": 409,
  "device.binding_invalid": 400,
  "device_profile.not_found": 404,
  "station.not_found": 404,
  "watcher.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "device.pairing_hold_lapsed": 409,
  "join_request.claimed": 409,
  "join_request.unclaimed": 409,
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
 * Check and accept are per-surface, because that is where the kinds differ in how a request is
 * approved and what it becomes; each refuses the OTHER kind's ask 404.
 */
export function mountJoinApi(app: Hono, deps: JoinApiDeps, log: Logger): void {
  // `gated` and `gatedByRowKind` discard the device requests a shut window or an ended claim
  // strands, and drop those claims only once the transaction has committed. `authorized` does not:
  // the window's read, take and renew routes act on no request, and the dashboard calls the read
  // and renew ones repeatedly.
  const authorized = (sessionId: string, permission: Permission): Promise<void> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission });
    });

  const gated = async <T>(
    sessionId: string,
    permission: Permission,
    fn: (tx: Transaction, personId: string) => Promise<T>,
  ): Promise<T> => {
    let dropped: string[] = [];
    const result = await withTransaction(deps.db, async (tx) => {
      dropped = await discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx, authorizedBy);
    });
    for (const id of dropped) deps.pairingMode.dropClaim(id);
    return result;
  };

  /**
   * A caller holding neither permission gets 403 whether or not the row exists: a MISSING row still
   * authorizes (against `MISSING_ROW_PERMISSION`) before the route answers `join_request.not_found`.
   * Otherwise the 403-vs-404 split tells an unauthorised caller which ids are live. A malformed id
   * takes the same path as an unknown one.
   */
  const gatedByRowKind = async <T>(
    sessionId: string,
    id: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    let dropped: string[] = [];
    const result = await withTransaction(deps.db, async (tx) => {
      dropped = await discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
      const kind = isUuid(id) ? await joinRequestKind(tx, deps.cfg, id) : undefined;
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: kind === undefined ? MISSING_ROW_PERMISSION : PERMISSION_FOR[kind],
      });
      if (kind === undefined) throw new AppError("join_request.not_found", {});
      return fn(tx);
    });
    for (const id of dropped) deps.pairingMode.dropClaim(id);
    return result;
  };

  // The window routes are gated on `device.manage` ALONE. That excludes nobody only because
  // `device.manage` and `printer.manage` are held by the same roles
  // (`packages/identity/src/permissions.ts`, pinned by `join-api.test.ts`); if the map ever
  // separates them, this gate has to become "either".

  // ── Read the window (device.manage) ─────────────────────────────────────────────────────────────
  app.get("/management-api/pairing-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await authorized(sessionId, "device.manage");
      return c.json({
        open: deps.pairingMode.isOpen(),
        openUntil: deps.pairingMode.openUntil(),
        deviceAddress: deps.deviceAddress,
      });
    }),
  );

  // ── Take a hold on the window while an Add dialog is open (device.manage) ───────────────────────
  app.post("/management-api/pairing-mode/holds", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await authorized(sessionId, "device.manage");
      return c.json(deps.pairingMode.open(), 200);
    }),
  );

  // ── Renew a hold (device.manage) ────────────────────────────────────────────────────────────────
  app.post("/management-api/pairing-mode/holds/:holdId/renew", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Renewal never counts as someone using the dashboard, so an unattended dialog lapses with the
      // login.
      await withPassiveManagementRead(() => authorized(sessionId, "device.manage"));
      const renewed = deps.pairingMode.renew(c.req.param("holdId"));
      if (renewed === null) throw new AppError("device.pairing_hold_lapsed", {});
      return c.json(renewed, 200);
    }),
  );

  // ── Release a hold (device.manage); an unknown hold is not an error ─────────────────────────────
  app.delete("/management-api/pairing-mode/holds/:holdId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const holdId = c.req.param("holdId");
      // The gate discards before its callback, while this hold is still live, so the requests its
      // release strands are discarded here, after it.
      const dropped = await gated(sessionId, "device.manage", async (tx) => {
        deps.pairingMode.release(holdId);
        return discardLapsedDeviceRequests(tx, deps.cfg, deps.pairingMode);
      });
      for (const id of dropped) deps.pairingMode.dropClaim(id);
      return c.body(null, 204);
    }),
  );

  // ── The pending queue for one surface (permission from the asked-for kind) ──────────────────────
  app.get("/management-api/join-requests", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const kind = requireKind(c.req.query("kind"));
      const { rows, returning } = await gated(sessionId, PERMISSION_FOR[kind], async (tx) => {
        const rows = await listPendingJoinRequests(tx, deps.cfg, kind);
        const ids = kind === "device" ? rows.map((row) => row.id) : [];
        return { rows, returning: await returningDevicesOf(tx, ids) };
      });
      if (kind === "print_agent") return c.json(rows);
      const sessionKey = hashSessionToken(sessionId);
      return c.json(
        rows.map((row) => {
          const claim = deps.pairingMode.claimOf(row.id);
          return {
            ...row,
            pairingBy:
              claim === undefined
                ? null
                : { name: claim.personName, mine: claim.sessionKey === sessionKey },
            returning: returning.get(row.id) ?? null,
          };
        }),
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
      const sessionKey = hashSessionToken(sessionId);
      await gatedByRowKind(sessionId, id, (tx) => {
        const claim = deps.pairingMode.claimOf(id);
        if (claim !== undefined && claim.sessionKey !== sessionKey)
          throw new AppError("join_request.claimed", {});
        return denyJoinRequest(tx, deps.cfg, id);
      });
      deps.pairingMode.dropClaim(id);
      return c.body(null, 204);
    }),
  );

  // ── Check the number a manager tapped against a DEVICE's ask (device.manage) ─────────────────
  app.post("/management-api/device-join-requests/:id/check", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const sessionKey = hashSessionToken(sessionId);
      const id = c.req.param("id");
      // Parsed out here and screened inside the gate, for the accept route's reasons.
      const body = await readJsonBody<{ choice?: unknown; holdId?: unknown }>(c);
      const result = await gated(sessionId, "device.manage", async (tx, personId) => {
        // Any string, not a two-digit screen: a value that is not the row's number must delete it.
        const choice = requireString(body.choice, "choice");
        const holdId = requireString(body.holdId, "holdId");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        const claim = deps.pairingMode.claimOf(id);
        if (claim !== undefined && claim.sessionKey !== sessionKey)
          throw new AppError("join_request.claimed", {});
        if (!deps.pairingMode.hasHold(holdId)) throw new AppError("device.pairing_hold_lapsed", {});
        const checked = await checkDeviceJoinNumber(tx, deps.cfg, id, choice);
        if (checked.ok) {
          const [person] = await tx
            .select({ name: persons.displayName })
            .from(persons)
            .where(eq(persons.id, personId));
          // Claimed inside the transaction, so no other check can run between the match and the
          // claim: the write queue runs one transaction at a time (`packages/store/src/write-queue.ts`).
          deps.pairingMode.claim(id, { holdId, sessionKey, personName: person!.name });
        }
        return checked;
      });
      // After the transaction, so the deletion of a mismatched request commits before its claim (if
      // this login held one) is forgotten and the refusal is thrown.
      if (!result.ok) {
        deps.pairingMode.dropClaim(id);
        throw new AppError("device.join_mismatch", {});
      }
      return c.body(null, 204);
    }),
  );

  // ── Approve a DEVICE's ask this login has checked (device.manage) ───────────────────────────────
  app.post("/management-api/device-join-requests/:id/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = c.req.param("id");
      // PARSED out here, SCREENED inside the gate. Parsing awaits the request stream, and
      // `withTransaction` holds the write lock (`packages/db/src/tenancy.ts`); screening after
      // `authorizeManager` refuses an unauthorised caller 403 before saying anything about its id or
      // body.
      const body = await readJsonBody<{
        name?: unknown;
        profileId?: unknown;
        stationId?: unknown;
        watcherId?: unknown;
      }>(c);
      const accepted = await gated(sessionId, "device.manage", async (tx) => {
        const label = requireDeviceName(body.name);
        const profileId = requireBodyUuid(body.profileId, "profileId");
        const stationId = optionalBodyUuid(body.stationId, "stationId");
        const watcherId = optionalBodyUuid(body.watcherId, "watcherId");
        if (!isUuid(id)) throw new AppError("join_request.not_found", {});
        // Before the claim, so a print agent's ask answers 404, as on the check route.
        if ((await joinRequestKind(tx, deps.cfg, id)) === "print_agent")
          throw new AppError("join_request.not_found", {});
        if (deps.pairingMode.claimOf(id)?.sessionKey !== hashSessionToken(sessionId))
          throw new AppError("join_request.unclaimed", {});
        return acceptDeviceJoinRequest(tx, deps.cfg, id, {
          label,
          profileId,
          stationId,
          watcherId,
        });
      });
      deps.pairingMode.dropClaim(id);
      return c.json(accepted, 200);
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
      // Thrown AFTER the transaction, so the consuming delete commits and a wrong tap cannot be retried.
      if (!result.ok) throw new AppError("device.join_mismatch", {});
      return c.body(null, 204);
    }),
  );
}
