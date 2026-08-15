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
import { WorkforceBackend } from "@waitron/workforce";
import { resolveWorkTimeRuleset } from "@waitron/workforce-es";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";

export interface WorkforceApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/** The ONE permission gating every workforce route — referenced through this single constant, never
 * an inline literal (the catalogue-api CATALOGUE_WRITE_PERMISSION pattern). Later slices add
 * swap.approve / absence.decide beside it. */
const SCHEDULE_PERMISSION: Permission = "schedule.manage";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

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
};

const run = createErrorBoundary(STATUS, "workforce.failed");
const backend = new WorkforceBackend();

function requireUuidParam(id: string, kind: string): string {
  if (!isUuid(id)) throw new AppError("shared.invalid_id", { kind, value: id });
  return id;
}

/** Screen a `period` query/body value as a YYYY-MM-DD date shape (a non-date would 22007 → 500 at the
 * `date` column). Refuses as `management.request_invalid` naming the field. */
function requirePeriod(value: unknown): string {
  if (typeof value !== "string" || !YYYY_MM_DD.test(value)) {
    throw new AppError("management.request_invalid", { field: "period" });
  }
  return value;
}

function requireBodyString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}
function requireBodyUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !isUuid(v))
    throw new AppError("management.request_invalid", { field });
  return v;
}
function requireBodyInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new AppError("management.request_invalid", { field });
  return v;
}
function requireNullableString(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}

export function mountWorkforceApi(app: Hono, deps: WorkforceApiDeps, log: Logger): void {
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: SCHEDULE_PERMISSION,
      });
      return fn(tx);
    });

  // The tenant's centros de trabajo, for the roster screen's location picker (design §3d gap-fill).
  app.get("/management-api/locations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx.select({ id: locations.id, name: locations.name }).from(locations),
      );
      return c.json(rows);
    }),
  );

  app.get("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationId = requireUuidParam(c.req.query("locationId") ?? "", "LocationId");
      const period = requirePeriod(c.req.query("period"));
      const snapshot = await gated(sessionId, (tx) =>
        backend.getRoster(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json(snapshot);
    }),
  );

  app.post("/management-api/roster", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<{ locationId?: unknown; period?: unknown }>()) ?? {};
      if (typeof body.locationId !== "string" || !isUuid(body.locationId)) {
        throw new AppError("management.request_invalid", { field: "locationId" });
      }
      const period = requirePeriod(body.period);
      const { locationId } = body;
      const versionId = await gated(sessionId, (tx) =>
        backend.createRosterVersion(tx, { tenantId: deps.cfg.tenantId, locationId, period }),
      );
      return c.json({ versionId }, 201);
    }),
  );

  app.post("/management-api/roster/:versionId/shifts", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const versionId = requireUuidParam(c.req.param("versionId"), "RosterVersionId");
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const personId = requireBodyUuid(body.personId, "personId");
      const locationId = requireBodyUuid(body.locationId, "locationId");
      const startsAt = requireBodyString(body.startsAt, "startsAt");
      const endsAt = requireBodyString(body.endsAt, "endsAt");
      const startsOffsetMinutes = requireBodyInt(body.startsOffsetMinutes, "startsOffsetMinutes");
      const endsOffsetMinutes = requireBodyInt(body.endsOffsetMinutes, "endsOffsetMinutes");
      const role = requireNullableString(body.role, "role");
      const shiftId = await gated(sessionId, (tx) =>
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
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const patch: import("@waitron/workforce").UpdateShiftInput = {
        tenantId: deps.cfg.tenantId,
        shiftId,
      };
      if (body.personId !== undefined) patch.personId = requireBodyUuid(body.personId, "personId");
      if (body.startsAt !== undefined)
        patch.startsAt = requireBodyString(body.startsAt, "startsAt");
      if (body.endsAt !== undefined) patch.endsAt = requireBodyString(body.endsAt, "endsAt");
      if (body.startsOffsetMinutes !== undefined)
        patch.startsOffsetMinutes = requireBodyInt(body.startsOffsetMinutes, "startsOffsetMinutes");
      if (body.endsOffsetMinutes !== undefined)
        patch.endsOffsetMinutes = requireBodyInt(body.endsOffsetMinutes, "endsOffsetMinutes");
      if (body.role !== undefined) patch.role = requireNullableString(body.role, "role");
      await gated(sessionId, (tx) => backend.updateShift(tx, patch));
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/roster/shifts/:shiftId", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const shiftId = requireUuidParam(c.req.param("shiftId"), "ShiftId");
      await gated(sessionId, (tx) =>
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
      // /management-api/layout calls authorizeManager inline.
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
}
