import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import { readLocationClock } from "@waitron/reporting";
import { AppError, deviceOrigin, isUuid } from "@waitron/shared";
import { createErrorBoundary } from "@waitron/server-kit";
import { offsetMinutes } from "@waitron/venue-service";
import { WorkforceBackend } from "@waitron/workforce";
import type { Logger } from "./logger.js";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
} from "./device-session.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { readTillClockState, type TillClockState } from "./till-clock-state.js";

export interface TillClockApiDeps {
  db: Database;
  cfg: { nodeId: string; locationId: string };
  now: () => Date;
}

const run = createErrorBoundary(
  {
    "session.required": 401,
    "session.not_open": 401,
    "device.unauthorized": 403,
    "device.forbidden_action": 403,
    "attendance.not_permitted": 403,
    "attendance.invalid": 400,
    "attendance.state_changed": 409,
    "attendance.already_open": 409,
    "attendance.no_open_entry": 409,
  },
  "workforce.failed",
);
const backend = new WorkforceBackend();
type ClockAction = "in" | "out" | "break-start" | "break-end";
type SignedIn = Awaited<ReturnType<typeof requireSession>>;

function invalid(): never {
  throw new AppError("attendance.invalid", { reason: "clock_request" });
}

async function expectedEntry(c: Context): Promise<string | null> {
  const body: unknown = await c.req.json().catch(() => invalid());
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "expectedEntryId")
  )
    invalid();
  const value: unknown = (body as Record<string, unknown>).expectedEntryId;
  if (value !== null && (typeof value !== "string" || !isUuid(value))) invalid();
  return value;
}

async function admit(tx: Transaction, deps: TillClockApiDeps, session: SignedIn): Promise<void> {
  await assertStillSignedIn(tx, session);
  const [current] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(eq(devices.id, session.deviceId));
  if (current === undefined) throw new AppError("device.unauthorized", {});
  if (current.locationId !== deps.cfg.locationId)
    throw new AppError("attendance.not_permitted", { personId: session.personId });
  assertProfileAction(toDeviceBinding(session.deviceId, current), "clock-in");
  if (!(await canUseDeviceProfile(tx, current.deviceProfileId, session.personId)))
    throw new AppError("attendance.not_permitted", { personId: session.personId });
}

export function mountTillClockApi(app: Hono, deps: TillClockApiDeps, log: Logger): void {
  app.get("/api/clock/state", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "clock-in", passive: true });
      if (new URL(c.req.url).search !== "") invalid();
      const state = await withTransaction(deps.db, async (tx) => {
        await admit(tx, deps, session);
        return readTillClockState(
          tx,
          { personId: session.personId, locationId: deps.cfg.locationId },
          deps.now(),
        );
      });
      return c.json(state);
    }),
  );

  for (const action of ["in", "out", "break-start", "break-end"] as const) {
    app.post(`/api/clock/${action}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "clock-in" });
        const expectedEntryId = await expectedEntry(c);
        // Admission may change after authentication while this write waits for the venue lock.
        const state = await withTransaction(deps.db, async (tx) => {
          await admit(tx, deps, session);
          const at = deps.now();
          const before = await readTillClockState(
            tx,
            { personId: session.personId, locationId: deps.cfg.locationId },
            at,
          );
          if (before.lastEntryId !== expectedEntryId)
            throw new AppError("attendance.state_changed", {});
          return writeClock(tx, deps, session, action, before, at);
        });
        return c.json(state);
      }),
    );
  }
}

async function writeClock(
  tx: Transaction,
  deps: TillClockApiDeps,
  session: SignedIn,
  action: ClockAction,
  before: TillClockState,
  at: Date,
): Promise<TillClockState> {
  if (
    action !== "in" &&
    before.activeLocationId !== null &&
    before.activeLocationId !== deps.cfg.locationId
  )
    throw new AppError("attendance.not_permitted", { personId: session.personId });
  const clock = await readLocationClock(tx, deps.cfg.locationId);
  const input = {
    nodeId: deps.cfg.nodeId,
    locationId: deps.cfg.locationId,
    personId: session.personId,
    recordedByPersonId: session.personId,
    at: at.toISOString(),
    offsetMinutes: offsetMinutes(at.getTime(), clock.timeZone),
    origin: deviceOrigin(session.deviceId),
  };
  if (action === "in") await backend.clockIn(tx, input);
  else if (action === "break-start") await backend.breakStart(tx, input);
  else if (action === "break-end") await backend.breakEnd(tx, input);
  else {
    if (before.state === "on_break") await backend.breakEnd(tx, input);
    await backend.clockOut(tx, input);
  }
  return readTillClockState(
    tx,
    { personId: session.personId, locationId: deps.cfg.locationId },
    at,
  );
}
