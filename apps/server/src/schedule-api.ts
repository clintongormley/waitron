// Side-effect: loads this host's errors.ts augmentation for `management.request_invalid`, thrown by
// `requireAbsenceKind` below and by the shared body/query screens in `request-screens.ts` (the "every
// file that throws imports ./errors.js" convention). The workforce codes (swap.*/shift.*/absence.*)
// load transitively via the verb value-imports below; shared.invalid_id / session.required load via
// the AppError value import and `requireSession`.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import {
  acceptSwap,
  createAbsence,
  listAbsencesForPerson,
  listShiftsForPerson,
  listSwapsForPerson,
  requestSwap,
  absenceKind,
} from "@waitron/workforce";
import type { AbsenceKind } from "@waitron/workforce";
import { createErrorBoundary } from "./error-boundary.js";
import { requireSession } from "./till-session.js";
import {
  requireBodyUuid,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * The deps the staff schedule API needs — the SAME minimal shape `mountWorkforceApi` takes, plus what
 * `requireSession` reads (only `cfg.tenantId`). No fiscal backend, clock or card provider: these routes
 * touch only the planning tables (`shifts`/`shift_swaps`/`absences`).
 */
export interface ScheduleApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/**
 * Every AppError code the schedule API answers, and its HTTP status. CLIENT faults only (a genuine
 * server fault reaches `run` as a NON-AppError → an opaque 500). `session.required` (no/expired
 * cookie) is 401; a malformed body/query field is `management.request_invalid` 400 and a malformed
 * path `:swapId` is `shared.invalid_id` 400 (the request-screens split); a cross-field bad interval (an
 * inverted absence range) is `absence.invalid` 400. The swap/shift/absence domain
 * codes carry their meaning — `swap.not_permitted` is a 403 (a permission fact: you may offer only your
 * own shift, supply only the recipient's own shift as the return leg, and accept only what is offered to
 * you — the three cases in errors.ts's `swap.not_permitted` doc), `swap.not_acceptable`/`absence.overlaps`
 * are 409 (exists but wrong state), the `not_found` pair 404. A registered code absent here defaults to
 * 400; the client codes are enumerated anyway so this map is the surface's whole 4xx contract.
 */
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

/** Screen a body `kind` as one of the four `absence_kind` enum members. Any other value (a
 * valid-looking-but-unknown string included) is a 400 `management.request_invalid` naming the field,
 * never a downstream 22P02 enum 500. Validated against the enum's own `enumValues` so it cannot drift
 * from the schema. */
function requireAbsenceKind(v: unknown): AbsenceKind {
  if (typeof v !== "string" || !(absenceKind.enumValues as readonly string[]).includes(v)) {
    throw new AppError("management.request_invalid", { field: "kind" });
  }
  return v as AbsenceKind;
}

/**
 * Mounts the STAFF-FACING schedule request routes (prefix `/api/schedule`) — the counterpart to the
 * manager approval half. Every route resolves the requester via `requireSession(deps, c)` FIRST and
 * passes THAT `personId` into the verb; the request body is NEVER trusted for identity (the crux of
 * this surface — a staff member acts only as themselves). The verb then runs on the app role under the
 * till's tenant (`withTenant` + `asAppUser`), so RLS scopes it to this tenant and the app's own
 * `person_id` predicate scopes it to the requester (RLS is tenant-only).
 */
export function mountScheduleApi(app: Hono, deps: ScheduleApiDeps, log: Logger): void {
  /** Run `fn` on the app role under the till's tenant — the one place the withTenant/asAppUser pair
   * is expressed, so no route re-implements it. */
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });

  // The requester's OWN shifts over a half-open [from, to) local-date window.
  app.get("/api/schedule/shifts", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await asStaff((tx) =>
        listShiftsForPerson(tx, { tenantId: deps.cfg.tenantId, personId, from, to }),
      );
      return c.json(rows);
    }),
  );

  // The swaps the requester is party to (offered to them, or requested by them).
  app.get("/api/schedule/swaps", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const rows = await asStaff((tx) =>
        listSwapsForPerson(tx, { tenantId: deps.cfg.tenantId, personId }),
      );
      return c.json(rows);
    }),
  );

  // Request a swap: offer one of MY shifts to a colleague (`toShiftId` null = a one-sided give-away).
  // The requester is the session's person — never a body field.
  app.post("/api/schedule/swaps", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const fromShiftId = requireBodyUuid(body.fromShiftId, "fromShiftId");
      const toPersonId = requireBodyUuid(body.toPersonId, "toPersonId");
      const toShiftId = requireNullableBodyUuid(body.toShiftId, "toShiftId");
      const swapId = await asStaff((tx) =>
        requestSwap(tx, {
          tenantId: deps.cfg.tenantId,
          requestedByPersonId: personId,
          fromShiftId,
          toPersonId,
          toShiftId,
        }),
      );
      return c.json({ swapId }, 201);
    }),
  );

  // Accept a swap offered TO me — the acceptor is the session's person, so only the named recipient
  // can accept (acceptSwap's own guard).
  app.post("/api/schedule/swaps/:swapId/accept", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      await asStaff((tx) =>
        acceptSwap(tx, { tenantId: deps.cfg.tenantId, swapId, acceptingPersonId: personId }),
      );
      return c.body(null, 204);
    }),
  );

  // The requester's OWN absences (every status).
  app.get("/api/schedule/absences", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const rows = await asStaff((tx) =>
        listAbsencesForPerson(tx, { tenantId: deps.cfg.tenantId, personId }),
      );
      return c.json(rows);
    }),
  );

  // Request an absence for MYSELF — the person is the session's, never a body field.
  app.post("/api/schedule/absences", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const kind = requireAbsenceKind(body.kind);
      const startsOn = requirePeriod(body.startsOn, "startsOn");
      const endsOn = requirePeriod(body.endsOn, "endsOn");
      const note = requireNullableString(body.note, "note");
      const absenceId = await asStaff((tx) =>
        createAbsence(tx, { tenantId: deps.cfg.tenantId, personId, kind, startsOn, endsOn, note }),
      );
      return c.json({ absenceId }, 201);
    }),
  );
}
