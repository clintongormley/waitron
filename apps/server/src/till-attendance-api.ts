import type { ModuleTimeRecordExport } from "@waitron/module";
import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  readVenueClock,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { authorizeApproval, canUseDeviceProfile } from "@waitron/identity";
import { AppError, deviceOrigin } from "@waitron/shared";
import { createErrorBoundary, readRawJsonBody, requireBodyUuid } from "@waitron/server-kit";
import {
  approveAttendanceDays,
  executeAttendanceCommand,
  readAttendanceCommand,
  readAttendanceDay,
  readAttendanceInbox,
  readAttendanceManagerQueue,
  readPersonHours,
  reconcileAttendanceResponses,
} from "@waitron/workforce";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
} from "./device-session.js";
import { assertStillSignedIn, requireSession, SESSION_STATUS } from "./till-session.js";
import { reconcileAttendanceBeforeClock } from "./attendance-discovery.js";
import { readAttendanceLookups } from "./attendance-lookups.js";
import {
  parseAttendanceCommand,
  parseAttendanceDayApprovals,
  parseAttendanceDayQuery,
} from "./attendance-request.js";
import { parseHoursQuery, parseOwnAttendanceCommand } from "./hours-request.js";
import type { Logger } from "./logger.js";

export interface TillAttendanceApiDeps {
  exporter?: ModuleTimeRecordExport;
  db: Database;
  devMode?: boolean;
  deviceChooserEnabled?: boolean;
  cfg: { nodeId: string };
  now: () => Date;
}
const run = createErrorBoundary(
  {
    ...SESSION_STATUS,
    "session.not_open": 401,
    "device.unauthorized": 403,
    "device.forbidden_action": 403,
    "attendance.not_permitted": 403,
    "correction.not_permitted": 403,
    "authorization.not_permitted": 403,
    "attendance.state_changed": 409,
    "attendance.not_pending": 409,
    "correction.not_pending": 409,
    "correction.target_not_found": 400,
    "attendance.already_open": 409,
    "attendance.no_open_entry": 409,
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
async function admit(tx: Transaction, session: SignedIn) {
  await assertStillSignedIn(tx, session);
  const [current] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(eq(devices.id, session.deviceId));
  if (!current) throw new AppError("device.unauthorized", {});
  assertProfileAction(toDeviceBinding(session.deviceId, current), "clock-in");
  if (!(await canUseDeviceProfile(tx, current.deviceProfileId, session.personId)))
    throw new AppError("attendance.not_permitted", { personId: session.personId });
}
async function assertOwnItem(tx: Transaction, personId: string, itemId: string): Promise<void> {
  const inbox = await readAttendanceInbox(tx, personId);
  const item = inbox.items.find((i) => i.id === itemId || i.requestEntryIds.includes(itemId));
  if (item) return;
  // A legacy pair can split into terminal singletons after its original receipt was committed.
  const receipt = await readAttendanceCommand(tx, {
    commandId: itemId,
    requestedByPersonId: personId,
  });
  const retained =
    receipt && inbox.items.find((i) => i.history.some((e) => receipt.entryIds.includes(e.entryId)));
  if (!retained) throw new AppError("correction.target_not_found", { entryId: itemId });
}
async function admitManager(tx: Transaction, session: SignedIn) {
  await admit(tx, session);
  await authorizeApproval(tx, { personId: session.personId, permission: "workforce.correct" });
}

export function mountTillAttendanceApi(app: Hono, deps: TillAttendanceApiDeps, log: Logger): void {
  app.get("/api/attendance/hours", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      const scope = parseHoursQuery(new URL(c.req.url).searchParams, "own");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, session);
          const now = deps.now();
          const clock = await readVenueClock(tx);
          return readPersonHours(
            tx,
            { ...scope, personId: session.personId, clock, now },
            (await deps.exporter?.paidBreakPolicy?.(tx)) ?? null,
          );
        }),
      );
    }),
  );
  app.get("/api/attendance/inbox", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      noQuery(c);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admit(tx, session);
          await reconcileAttendanceBeforeClock(
            tx,
            { ...deps.cfg, personId: session.personId },
            deps.now(),
          );
          await reconcileAttendanceResponses(tx, session.personId);
          return readAttendanceInbox(tx, session.personId);
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
          await admit(tx, session);
          return readAttendanceDay(
            tx,
            { ...scope, personId: session.personId },
            (await deps.exporter?.paidBreakPolicy?.(tx)) ?? null,
          );
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
          await admit(tx, session);
          return readAttendanceCommand(tx, { commandId, requestedByPersonId: session.personId });
        }),
      );
    }),
  );
  app.post("/api/attendance/commands", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in" });
      noQuery(c);
      const command = parseOwnAttendanceCommand(await readRawJsonBody<unknown>(c));
      const result = await withTransaction(deps.db, async (tx) => {
        await admit(tx, session);
        if ("itemId" in command) await assertOwnItem(tx, session.personId, command.itemId);
        const now = deps.now();
        await reconcileAttendanceBeforeClock(tx, { ...deps.cfg, personId: session.personId }, now);
        await reconcileAttendanceResponses(tx, session.personId);
        try {
          return {
            value: await executeAttendanceCommand(tx, {
              nodeId: deps.cfg.nodeId,
              requestedByPersonId: session.personId,
              authorizedByPersonId: session.personId,
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
      });
      if (result.error) throw result.error;
      return c.json(result.value);
    }),
  );

  const managerWriteSession = async (c: Context) => {
    const session = await requireSession(deps, c, { action: "clock-in" });
    await withTransaction(deps.db, (tx) => admitManager(tx, session));
    noQuery(c);
    return session;
  };

  app.get("/api/attendance/manager/lookups", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admitManager(tx, session);
          noQuery(c);
          return readAttendanceLookups(tx, session.personId);
        }),
      );
    }),
  );
  app.get("/api/attendance/manager/queue", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admitManager(tx, session);
          noQuery(c);
          return readAttendanceManagerQueue(tx);
        }),
      );
    }),
  );
  app.get("/api/attendance/manager/day", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admitManager(tx, session);
          const scope = parseAttendanceDayQuery(new URL(c.req.url).searchParams, "manager");
          return readAttendanceDay(
            tx,
            { ...scope, personId: scope.personId! },
            (await deps.exporter?.paidBreakPolicy?.(tx)) ?? null,
          );
        }),
      );
    }),
  );
  app.get("/api/attendance/manager/commands/:commandId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admitManager(tx, session);
          noQuery(c);
          const commandId = id(c.req.param("commandId"), "commandId");
          return readAttendanceCommand(tx, { commandId, requestedByPersonId: session.personId });
        }),
      );
    }),
  );
  app.post("/api/attendance/manager/commands", (c) =>
    run(c, log, async () => {
      const session = await managerWriteSession(c);
      const command = parseAttendanceCommand(await readRawJsonBody<unknown>(c), "manager");
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          await admitManager(tx, session);
          return executeAttendanceCommand(tx, {
            nodeId: deps.cfg.nodeId,
            requestedByPersonId: session.personId,
            authorizedByPersonId: session.personId,
            origin: deviceOrigin(session.deviceId),
            command,
            now: deps.now(),
          });
        }),
      );
    }),
  );
  app.post("/api/attendance/manager/approve-days", (c) =>
    run(c, log, async () => {
      const session = await managerWriteSession(c);
      const days = parseAttendanceDayApprovals(await readRawJsonBody<unknown>(c));
      await withTransaction(deps.db, async (tx) => {
        await admitManager(tx, session);
        await approveAttendanceDays(tx, {
          days,
          actorPersonId: session.personId,
          nodeId: deps.cfg.nodeId,
          origin: deviceOrigin(session.deviceId),
          now: deps.now(),
        });
      });
      return c.body(null, 204);
    }),
  );
}
