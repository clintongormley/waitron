import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  acceptSwap,
  createAbsence,
  listAbsencesForPerson,
  listShiftsForPerson,
  listSwapsForPerson,
  requestSwap,
  absenceKind,
} from "@waitron/workforce";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireSession } from "./till-session.js";
import {
  requireBodyUuid,
  requireEnum,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";

export interface ScheduleApiDeps {
  db: Database;
}

/** The surface's whole 4xx contract; a registered code absent here defaults to 400. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "session.required": 401,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "absence.invalid": 400,
  "shift.not_found": 404,
  "swap.not_found": 404,
  "swap.not_permitted": 403,
  "swap.not_acceptable": 409,
  "absence.overlaps": 409,
};

const run = createErrorBoundary(STATUS, "schedule.failed");

/**
 * Mounts the STAFF-FACING schedule request routes. Every route takes the requester's `personId` from
 * `requireSession`, never from the request body: a staff member acts only as themselves.
 */
export function mountScheduleApi(app: Hono, deps: ScheduleApiDeps, log: Logger): void {
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      return fn(tx);
    });

  // The requester's OWN shifts over a half-open [from, to) local-date window.
  app.get("/api/schedule/shifts", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await asStaff((tx) => listShiftsForPerson(tx, { personId, from, to }));
      return c.json(rows);
    }),
  );

  app.get("/api/schedule/swaps", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const rows = await asStaff((tx) => listSwapsForPerson(tx, { personId }));
      return c.json(rows);
    }),
  );

  // `toShiftId` null = a one-sided give-away.
  app.post("/api/schedule/swaps", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const fromShiftId = requireBodyUuid(body.fromShiftId, "fromShiftId");
      const toPersonId = requireBodyUuid(body.toPersonId, "toPersonId");
      const toShiftId = requireNullableBodyUuid(body.toShiftId, "toShiftId");
      const swapId = await asStaff((tx) =>
        requestSwap(tx, {
          requestedByPersonId: personId,
          fromShiftId,
          toPersonId,
          toShiftId,
        }),
      );
      return c.json({ swapId }, 201);
    }),
  );

  app.post("/api/schedule/swaps/:swapId/accept", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      await asStaff((tx) => acceptSwap(tx, { swapId, acceptingPersonId: personId }));
      return c.body(null, 204);
    }),
  );

  app.get("/api/schedule/absences", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const rows = await asStaff((tx) => listAbsencesForPerson(tx, { personId }));
      return c.json(rows);
    }),
  );

  app.post("/api/schedule/absences", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const kind = requireEnum(body.kind, "kind", absenceKind.enumValues);
      const startsOn = requirePeriod(body.startsOn, "startsOn");
      const endsOn = requirePeriod(body.endsOn, "endsOn");
      const note = requireNullableString(body.note, "note");
      const absenceId = await asStaff((tx) =>
        createAbsence(tx, { personId, kind, startsOn, endsOn, note }),
      );
      return c.json({ absenceId }, 201);
    }),
  );
}
