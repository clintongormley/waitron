import "./errors.js";
import type { Context, Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager, persons, resolveManagementSession } from "@waitron/identity";
import { readLocationClock } from "@waitron/reporting";
import { AppError, jobOrigin } from "@waitron/shared";
import {
  createErrorBoundary,
  readRawJsonBody,
  requireBodyUuid,
  requireManagementSession,
} from "@waitron/server-kit";
import {
  executeAttendanceCommand,
  readAttendanceCommand,
  readAttendanceDay,
  readAttendanceManagerQueue,
  readAttendanceInbox,
  readPersonHours,
  readManagerHours,
} from "@waitron/workforce";
import type { AttendanceLookups } from "@waitron/workforce/attendance-contract";
import {
  parseAttendanceCommand,
  parseAttendanceDayQuery,
  parseAttendanceLocationQuery,
} from "./attendance-request.js";
import type { Logger } from "./logger.js";
import { parseHoursQuery, parseOwnAttendanceCommand } from "./hours-request.js";
import { assertOwnAttendanceLocation } from "./attendance-own-scope.js";
export interface ManagementAttendanceApiDeps {
  db: Database;
  cfg: { nodeId: string; locationId: string };
  now: () => Date;
}
const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "correction.not_permitted": 403,
    "attendance.not_permitted": 403,
    "attendance.state_changed": 409,
    "attendance.not_pending": 409,
    "correction.not_pending": 409,
    "attendance.already_open": 409,
    "attendance.no_open_entry": 409,
  },
  "workforce.failed",
);
function noQuery(c: Context) {
  if (new URL(c.req.url).search)
    throw new AppError("management.request_invalid", { field: "query" });
}
function authorize(tx: Transaction, token: string, touch = true) {
  return authorizeManager(tx, {
    managementSessionId: token,
    permission: "workforce.correct",
    touch,
  });
}
export function mountManagementAttendanceApi(
  app: Hono,
  deps: ManagementAttendanceApiDeps,
  log: Logger,
): void {
  app.get("/management-api/me/attendance/inbox", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await resolveManagementSession(tx, token);
          noQuery(c);
          const inbox = await readAttendanceInbox(tx, viewer.personId);
          if (!inbox.locations.some((location) => location.id === deps.cfg.locationId)) {
            const current = await tx
              .select({ id: locations.id, name: locations.name, timeZone: locations.timeZone })
              .from(locations)
              .where(eq(locations.id, deps.cfg.locationId));
            inbox.locations.push(...current);
          }
          return inbox;
        }),
      );
    }),
  );
  app.get("/management-api/me/attendance/hours", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await resolveManagementSession(tx, token);
          const scope = parseHoursQuery(new URL(c.req.url).searchParams, "own");
          await assertOwnAttendanceLocation(tx, {
            personId: viewer.personId,
            locationId: scope.locationId,
            currentLocationId: deps.cfg.locationId,
          });
          const now = deps.now();
          const clock = await readLocationClock(tx, scope.locationId);
          return readPersonHours(tx, { ...scope, personId: viewer.personId, clock, now });
        }),
      );
    }),
  );
  app.get("/management-api/me/attendance/day", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await resolveManagementSession(tx, token);
          const scope = parseAttendanceDayQuery(new URL(c.req.url).searchParams, "worker");
          await assertOwnAttendanceLocation(tx, {
            personId: viewer.personId,
            locationId: scope.locationId,
            currentLocationId: deps.cfg.locationId,
          });
          return readAttendanceDay(tx, { ...scope, personId: viewer.personId });
        }),
      );
    }),
  );
  app.get("/management-api/me/attendance/commands/:commandId", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await resolveManagementSession(tx, token);
          noQuery(c);
          const commandId = requireBodyUuid(c.req.param("commandId"), "commandId").toLowerCase();
          return readAttendanceCommand(tx, { commandId, requestedByPersonId: viewer.personId });
        }),
      );
    }),
  );
  app.post("/management-api/me/attendance/commands", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      await withTransaction(deps.db, (tx) => resolveManagementSession(tx, token, { touch: false }));
      noQuery(c);
      const command = parseOwnAttendanceCommand(await readRawJsonBody<unknown>(c));
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await resolveManagementSession(tx, token);
          if (command.action === "request")
            await assertOwnAttendanceLocation(tx, {
              personId: viewer.personId,
              locationId: command.locationId,
              currentLocationId: deps.cfg.locationId,
            });
          return executeAttendanceCommand(tx, {
            nodeId: deps.cfg.nodeId,
            requestedByPersonId: viewer.personId,
            authorizedByPersonId: viewer.personId,
            origin: jobOrigin("dashboard"),
            command,
            now: deps.now(),
          });
        }),
      );
    }),
  );
  app.get("/management-api/attendance/hours", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await authorize(tx, token);
          const scope = parseHoursQuery(new URL(c.req.url).searchParams, "manager");
          const [location] = await tx
            .select({ id: locations.id })
            .from(locations)
            .where(eq(locations.id, scope.locationId))
            .limit(1);
          if (!location)
            throw new AppError("attendance.invalid", { reason: "record_scope_or_period" });
          const now = deps.now();
          const clock = await readLocationClock(tx, scope.locationId);
          return readManagerHours(tx, { ...scope, clock, now });
        }),
      );
    }),
  );
  app.get("/management-api/attendance/lookups", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx): Promise<AttendanceLookups> => {
          const viewer = await authorize(tx, token);
          noQuery(c);
          const locationRows = await tx
            .select({ id: locations.id, name: locations.name, timeZone: locations.timeZone })
            .from(locations)
            .orderBy(asc(locations.name), asc(locations.id));
          const people = await tx
            .select({ personId: persons.id, displayName: persons.displayName })
            .from(persons)
            .orderBy(asc(persons.displayName), asc(persons.id));
          return {
            viewer: { personId: viewer.authorizedBy, canSelfApprove: viewer.role === "admin" },
            locations: locationRows,
            people,
          };
        }),
      );
    }),
  );
  app.get("/management-api/attendance/queue", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await authorize(tx, token);
          const scope = parseAttendanceLocationQuery(new URL(c.req.url).searchParams);
          return readAttendanceManagerQueue(tx, scope.locationId);
        }),
      );
    }),
  );
  app.get("/management-api/attendance/day", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await authorize(tx, token);
          const scope = parseAttendanceDayQuery(new URL(c.req.url).searchParams, "manager");
          return readAttendanceDay(tx, { ...scope, personId: scope.personId! });
        }),
      );
    }),
  );
  app.get("/management-api/attendance/commands/:commandId", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await authorize(tx, token);
          noQuery(c);
          const commandId = requireBodyUuid(c.req.param("commandId"), "commandId").toLowerCase();
          return readAttendanceCommand(tx, { commandId, requestedByPersonId: viewer.authorizedBy });
        }),
      );
    }),
  );
  app.post("/management-api/attendance/commands", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      // Authenticate before reading the body; recheck current authority in the human write.
      await withTransaction(deps.db, (tx) => authorize(tx, token, false));
      noQuery(c);
      const command = parseAttendanceCommand(await readRawJsonBody<unknown>(c), "manager");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const viewer = await authorize(tx, token);
          return executeAttendanceCommand(tx, {
            nodeId: deps.cfg.nodeId,
            requestedByPersonId: viewer.authorizedBy,
            authorizedByPersonId: viewer.authorizedBy,
            origin: jobOrigin("dashboard"),
            command,
            now: deps.now(),
          });
        }),
      );
    }),
  );
}
