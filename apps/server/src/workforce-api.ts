// Side-effect: loads this host's errors.ts augmentation for `management.request_invalid`, thrown by
// the body/query screens below (the "every file that throws imports ./errors.js" convention). The
// workforce codes (roster.*, shift.*, convenio.not_found) are declared in @waitron/workforce /
// @waitron/workforce-es and load transitively via the value imports below; shared.invalid_id loads
// via the AppError value import.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, locations, type Database, type Transaction } from "@waitron/db";
import { authorizeManager, type Permission } from "@waitron/identity";
import {
  WorkforceBackend,
  decideSwap,
  listPendingSwaps,
  setAbsenceStatus,
  listPendingAbsences,
} from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "@waitron/workforce-es";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import {
  requireBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "./request-screens.js";
import type { Logger } from "./logger.js";

export interface WorkforceApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/** The permissions gating the workforce routes — referenced through these constants, never an inline
 * literal (the catalogue-api CATALOGUE_WRITE_PERMISSION pattern). `schedule.manage` gates the roster
 * read/write group and planned-vs-actual; `swap.approve` / `absence.decide` gate the two approval
 * queues added in roster slice 2. */
const SCHEDULE_PERMISSION: Permission = "schedule.manage";
const SWAP_APPROVE_PERMISSION: Permission = "swap.approve";
const ABSENCE_DECIDE_PERMISSION: Permission = "absence.decide";

// ±14h — the wall-offset domain the `shifts_*_offset_ck` check constraints enforce
// (`packages/workforce/src/schema/shifts.ts`); an offset outside it is a 23514 at the DB, screened
// here to a 400 instead.
const MAX_OFFSET_MINUTES = 840;

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "roster.not_found": 404,
  "roster.draft_exists": 409,
  "roster.not_draft": 409,
  "roster.already_published": 409,
  "roster.period_already_published": 409,
  "shift.not_found": 404,
  "shift.invalid": 400,
  "convenio.not_found": 409,
  "swap.not_found": 404,
  "swap.not_decidable": 409,
  "absence.not_found": 404,
};

const run = createErrorBoundary(STATUS, "workforce.failed");
const backend = new WorkforceBackend();

/** Screen a body `startsAt`/`endsAt` as a parseable instant. A non-parseable string is still a
 * `string`, so a bare type check would admit it — and `addShift`'s `Date.parse(x) >= Date.parse(y)`
 * interval guard then passes it too (`NaN >= NaN` is `false`) — so it lands in the `::timestamptz`
 * column as a 22007 → 500; screened here to a 400 `management.request_invalid` naming the field. */
function requireTimestamp(v: unknown, field: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v)))
    throw new AppError("management.request_invalid", { field });
  return v;
}
/** Screen a body offset as an integer inside the `±MAX_OFFSET_MINUTES` wall-offset domain. A bare
 * integer check admits an out-of-domain value, which then violates `shifts_*_offset_ck` as a 23514 →
 * 500; range-checked here to a 400 `management.request_invalid` naming the field. */
function requireOffsetMinutes(v: unknown, field: string): number {
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < -MAX_OFFSET_MINUTES ||
    v > MAX_OFFSET_MINUTES
  )
    throw new AppError("management.request_invalid", { field });
  return v;
}
/** Screen a body `decision` as exactly "approved" or "rejected" — any other value (a valid-looking
 * status like "requested"/"accepted" included) is a 400 `management.request_invalid` naming the field,
 * never a downstream enum 500. The `requireNullableString` pattern, narrowed to two literals. */
function requireDecision(v: unknown): "approved" | "rejected" {
  if (v !== "approved" && v !== "rejected")
    throw new AppError("management.request_invalid", { field: "decision" });
  return v;
}

export function mountWorkforceApi(app: Hono, deps: WorkforceApiDeps, log: Logger): void {
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

  // The tenant's centros de trabajo, for the roster screen's location picker (design §3d gap-fill).
  app.get("/management-api/locations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        tx.select({ id: locations.id, name: locations.name }).from(locations),
      );
      return c.json(rows);
    }),
  );

  app.get("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.query("locationId") ?? "", "LocationId");
      const period = requirePeriod(c.req.query("period"), "period");
      const snapshot = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.getRoster(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json(snapshot);
    }),
  );

  app.post("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ locationId?: unknown; period?: unknown }>(c);
      const locationId = requireBodyUuid(body.locationId, "locationId");
      const period = requirePeriod(body.period, "period");
      const versionId = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.createRosterVersion(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json({ versionId }, 201);
    }),
  );

  app.post("/management-api/roster/:versionId/shifts", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const versionId = requireUuidParam(c.req.param("versionId"), "RosterVersionId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const personId = requireBodyUuid(body.personId, "personId");
      const locationId = requireBodyUuid(body.locationId, "locationId");
      const startsAt = requireTimestamp(body.startsAt, "startsAt");
      const endsAt = requireTimestamp(body.endsAt, "endsAt");
      const startsOffsetMinutes = requireOffsetMinutes(
        body.startsOffsetMinutes,
        "startsOffsetMinutes",
      );
      const endsOffsetMinutes = requireOffsetMinutes(body.endsOffsetMinutes, "endsOffsetMinutes");
      const role = requireNullableString(body.role, "role");
      const shiftId = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.addShift(tx, {
          tenantId: deps.cfg.tenantId,
          versionId,
          personId,
          locationId,
          startsAt,
          startsOffsetMinutes,
          endsAt,
          endsOffsetMinutes,
          role,
        }),
      );
      return c.json({ shiftId }, 201);
    }),
  );

  app.patch("/management-api/roster/shifts/:shiftId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const shiftId = requireUuidParam(c.req.param("shiftId"), "ShiftId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const patch: import("@waitron/workforce").UpdateShiftInput = {
        tenantId: deps.cfg.tenantId,
        shiftId,
      };
      if (body.personId !== undefined) patch.personId = requireBodyUuid(body.personId, "personId");
      if (body.startsAt !== undefined) patch.startsAt = requireTimestamp(body.startsAt, "startsAt");
      if (body.endsAt !== undefined) patch.endsAt = requireTimestamp(body.endsAt, "endsAt");
      if (body.startsOffsetMinutes !== undefined)
        patch.startsOffsetMinutes = requireOffsetMinutes(
          body.startsOffsetMinutes,
          "startsOffsetMinutes",
        );
      if (body.endsOffsetMinutes !== undefined)
        patch.endsOffsetMinutes = requireOffsetMinutes(body.endsOffsetMinutes, "endsOffsetMinutes");
      if (body.role !== undefined) patch.role = requireNullableString(body.role, "role");
      await gated(sessionId, SCHEDULE_PERMISSION, (tx) => backend.updateShift(tx, patch));
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/roster/shifts/:shiftId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const shiftId = requireUuidParam(c.req.param("shiftId"), "ShiftId");
      await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.removeShift(tx, { tenantId: deps.cfg.tenantId, shiftId }),
      );
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/roster/:versionId/publish", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const versionId = requireUuidParam(c.req.param("versionId"), "RosterVersionId");
      // Composed inline rather than via `gated`, because it needs authorizeManager's returned
      // `authorizedBy` for `publishedByPersonId` — the same reason management-api.ts's GET
      // /management-api/receipt composes authorizeManager inline.
      const breaches = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: SCHEDULE_PERMISSION,
        });
        const version = await backend.getRosterVersion(tx, {
          tenantId: deps.cfg.tenantId,
          versionId,
        });
        const ruleset = await resolveWorkTimeRuleset(tx, {
          tenantId: deps.cfg.tenantId,
          locationId: version.locationId,
        });
        return backend.publishRoster(tx, {
          tenantId: deps.cfg.tenantId,
          versionId,
          publishedByPersonId: authorizedBy,
          ruleset,
        });
      });
      return c.json({ breaches });
    }),
  );

  // The tenant's accepted swaps awaiting a manager decision (approvals screen).
  app.get("/management-api/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, SWAP_APPROVE_PERMISSION, (tx) =>
        listPendingSwaps(tx, { tenantId: deps.cfg.tenantId }),
      );
      return c.json(rows);
    }),
  );

  // Composed inline (not via `gated`) because it needs authorizeManager's returned `authorizedBy` for
  // `decidedByPersonId` — the same reason the publish route composes inline.
  app.post("/management-api/swaps/:swapId/decide", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      const body = await readJsonBody<{ decision?: unknown }>(c);
      const decision = requireDecision(body.decision);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: SWAP_APPROVE_PERMISSION,
        });
        await decideSwap(tx, {
          tenantId: deps.cfg.tenantId,
          swapId,
          decision,
          decidedByPersonId: authorizedBy,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The tenant's requested absences awaiting a manager decision.
  app.get("/management-api/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, ABSENCE_DECIDE_PERMISSION, (tx) =>
        listPendingAbsences(tx, { tenantId: deps.cfg.tenantId }),
      );
      return c.json(rows);
    }),
  );

  app.post("/management-api/absences/:absenceId/decide", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const absenceId = requireUuidParam(c.req.param("absenceId"), "AbsenceId");
      const body = await readJsonBody<{ decision?: unknown }>(c);
      const decision = requireDecision(body.decision);
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: ABSENCE_DECIDE_PERMISSION,
        });
        // setAbsenceStatus accepts any AbsenceStatus; "approved"/"rejected" are two of its three values.
        await setAbsenceStatus(tx, {
          tenantId: deps.cfg.tenantId,
          absenceId,
          status: decision,
          decidedByPersonId: authorizedBy,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The location's planned-vs-actual comparison over a half-open [from, to) local window.
  app.get("/management-api/planned-vs-actual", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.query("locationId") ?? "", "LocationId");
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await gated(sessionId, SCHEDULE_PERMISSION, (tx) =>
        backend.getPlannedVsActual(tx, {
          tenantId: deps.cfg.tenantId,
          locationId,
          period: { start: from, end: to },
        }),
      );
      return c.json(rows);
    }),
  );
}
