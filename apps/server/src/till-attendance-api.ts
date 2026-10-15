import "./errors.js";
import type { Context, Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  locations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  authorizeByPin,
  canUseDeviceProfile,
  listActivePersonsWithPermission,
  persons,
  type Override,
  type PinAttempts,
} from "@waitron/identity";
import { AppError, deviceOrigin } from "@waitron/shared";
import { createErrorBoundary, readRawJsonBody, requireBodyUuid } from "@waitron/server-kit";
import {
  attendanceQuestions,
  executeAttendanceCommand,
  readAttendanceCommand,
  readAttendanceDay,
  readAttendanceInbox,
  reconcileAttendanceResponses,
  timeEntries,
} from "@waitron/workforce";
import type { AttendanceCommand, CorrectionItem } from "@waitron/workforce/attendance-contract";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
} from "./device-session.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { reconcileAttendanceBeforeClock } from "./attendance-discovery.js";
import { parseAttendanceCommand, parseAttendanceDayQuery } from "./attendance-request.js";
import { withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import type { Logger } from "./logger.js";

export interface TillAttendanceApiDeps {
  db: Database;
  cfg: { nodeId: string; locationId: string };
  now: () => Date;
  attemptsFor: (deviceId: string) => PinAttempts;
}
const run = createErrorBoundary(
  {
    "session.required": 401,
    "session.not_open": 401,
    "device.unauthorized": 403,
    "device.forbidden_action": 403,
    "attendance.not_permitted": 403,
    "correction.not_permitted": 403,
    "authorization.not_permitted": 403,
    "pin.invalid": 403,
    "pin.throttled": 429,
    "attendance.state_changed": 409,
    "attendance.not_pending": 409,
    "correction.not_pending": 409,
    "correction.target_not_found": 400,
    "attendance.already_open": 409,
    "attendance.no_open_entry": 409,
  },
  "workforce.failed",
);
const runItem = createErrorBoundary(
  {
    "session.required": 401,
    "device.unauthorized": 403,
    "device.forbidden_action": 403,
    "attendance.not_permitted": 403,
    "correction.target_not_found": 404,
    "correction.not_pending": 409,
  },
  "workforce.failed",
);
type SignedIn = Awaited<ReturnType<typeof requireSession>>;
function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}
function id(value: unknown, field: string): string {
  return requireBodyUuid(value, field).toLowerCase();
}
function noQuery(c: Context): void {
  if (new URL(c.req.url).search) invalid("query");
}
async function admit(tx: Transaction, deps: TillAttendanceApiDeps, session: SignedIn) {
  await assertStillSignedIn(tx, session);
  const [current] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(eq(devices.id, session.deviceId));
  if (!current) throw new AppError("device.unauthorized", {});
  if (current.locationId !== deps.cfg.locationId)
    throw new AppError("attendance.not_permitted", { personId: session.personId });
  assertProfileAction(toDeviceBinding(session.deviceId, current), "clock-in");
  if (!(await canUseDeviceProfile(tx, current.deviceProfileId, session.personId)))
    throw new AppError("attendance.not_permitted", { personId: session.personId });
}
async function ownLocation(
  tx: Transaction,
  deps: TillAttendanceApiDeps,
  personId: string,
  locationId: string,
) {
  if (locationId === deps.cfg.locationId) return;
  const [entry] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, personId), eq(timeEntries.locationId, locationId)))
    .limit(1);
  if (entry) return;
  const [question] = await tx
    .select({ id: attendanceQuestions.id })
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, personId),
        eq(attendanceQuestions.locationId, locationId),
      ),
    )
    .limit(1);
  if (!question) throw new AppError("attendance.not_permitted", { personId });
}
async function ownItem(tx: Transaction, personId: string, itemId: string): Promise<CorrectionItem> {
  const inbox = await readAttendanceInbox(tx, personId);
  const item = inbox.items.find((i) => i.id === itemId || i.requestEntryIds.includes(itemId));
  if (item) return item;
  // A legacy pair can split into terminal singletons after its original receipt was committed.
  const receipt = await readAttendanceCommand(tx, {
    commandId: itemId,
    requestedByPersonId: personId,
  });
  const retained =
    receipt && inbox.items.find((i) => i.history.some((e) => receipt.entryIds.includes(e.entryId)));
  if (!retained) throw new AppError("correction.target_not_found", { entryId: itemId });
  return retained;
}
function envelope(raw: unknown): { command: AttendanceCommand; override?: Override } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid("command");
  const body = raw as Record<string, unknown>;
  if (body.action !== "approve" && body.action !== "decline")
    return { command: parseAttendanceCommand(raw, "worker") };
  const { override, ...command } = body;
  if (override === null || typeof override !== "object" || Array.isArray(override))
    invalid("override");
  const selected = override as Record<string, unknown>;
  if (Object.keys(selected).length !== 2 || typeof selected.pin !== "string") invalid("override");
  return {
    command: parseAttendanceCommand(command, "worker"),
    override: { personId: id(selected.personId, "personId"), pin: selected.pin },
  };
}

export function mountTillAttendanceApi(app: Hono, deps: TillAttendanceApiDeps, log: Logger): void {
  app.get("/api/attendance/inbox", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      noQuery(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          await reconcileAttendanceBeforeClock(
            tx,
            { ...deps.cfg, personId: session.personId },
            deps.now(),
          );
          await reconcileAttendanceResponses(tx, session.personId);
          const inbox = await readAttendanceInbox(tx, session.personId);
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
  app.get("/api/attendance/day", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      const scope = parseAttendanceDayQuery(new URL(c.req.url).searchParams, "worker");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          await ownLocation(tx, deps, session.personId, scope.locationId);
          return readAttendanceDay(tx, { ...scope, personId: session.personId });
        }),
      );
    }),
  );
  app.get("/api/attendance/commands/:commandId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      noQuery(c);
      const commandId = id(c.req.param("commandId"), "commandId");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          return readAttendanceCommand(tx, { commandId, requestedByPersonId: session.personId });
        }),
      );
    }),
  );
  app.get("/api/attendance/items/:itemId/approvers", (c) =>
    runItem(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      const query = new URL(c.req.url).searchParams;
      const action = query.get("action");
      if (query.size !== 1 || (action !== "approve" && action !== "decline")) invalid("action");
      const itemId = id(c.req.param("itemId"), "itemId");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          const item = await ownItem(tx, session.personId, itemId);
          if (item.direction !== "worker_request" || item.status !== "waiting-manager")
            throw new AppError("correction.not_pending", { correctionId: itemId });
          const eligible = await listActivePersonsWithPermission(tx, "workforce.correct");
          const [operator] = await tx
            .select({ role: persons.role })
            .from(persons)
            .where(eq(persons.id, session.personId));
          return eligible.filter(
            (p) =>
              p.personId !== item.requestedByPersonId ||
              (action === "approve" &&
                p.personId === session.personId &&
                operator!.role === "admin"),
          );
        }),
      );
    }),
  );
  app.post("/api/attendance/commands", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in" });
      noQuery(c);
      const { command, override } = envelope(await readRawJsonBody<unknown>(c));
      const attempts = deps.attemptsFor(session.deviceId);
      const result = await withPinCheckAhead(deps.db, override, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          if ("itemId" in command) await ownItem(tx, session.personId, command.itemId);
          if (command.action === "request")
            await ownLocation(tx, deps, session.personId, command.locationId);
          const authorizedByPersonId =
            override === undefined
              ? session.personId
              : (
                  await authorizeByPin(
                    tx,
                    { permission: "workforce.correct", override: withCheck(override, checked)! },
                    attempts,
                  )
                ).authorizedBy;
          const now = deps.now();
          await reconcileAttendanceBeforeClock(
            tx,
            { ...deps.cfg, personId: session.personId },
            now,
          );
          await reconcileAttendanceResponses(tx, session.personId);
          try {
            return {
              value: await executeAttendanceCommand(tx, {
                nodeId: deps.cfg.nodeId,
                requestedByPersonId: session.personId,
                authorizedByPersonId,
                origin: deviceOrigin(session.deviceId),
                command,
                now,
              }),
            };
          } catch (error) {
            if (error instanceof AppError && error.code === "attendance.state_changed")
              return { error };
            throw error;
          }
        }),
      );
      if (result.error) throw result.error;
      return c.json(result.value);
    }),
  );
}
