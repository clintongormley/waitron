// Side-effect: loads this host's errors.ts augmentation for `management.request_invalid`, thrown by
// `requireAbsenceKind` below and by the shared body/query screens in `request-screens.ts` (the "every
// file that throws imports ./errors.js" convention). The workforce codes (swap.*/shift.*/absence.*)
// load transitively via the verb value-imports below; shared.invalid_id loads via the AppError value
// import; `management_session.*` / `person.suspended` load via `resolveManagementSession`'s package.
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
import { resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { requireManagementSession } from "./management-session.js";
import {
  requireBodyUuid,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * The deps the "me" API needs — the SAME minimal shape `mountScheduleApi` takes: no fiscal backend,
 * clock or card provider, because these routes touch only the identity session (`management_sessions`)
 * and the planning tables (`shifts`/`shift_swaps`/`absences`). `cfg.tenantId` is this venue's one tenant,
 * scoping every `withTenant` below.
 */
export interface MeApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/**
 * Every AppError code the me API answers, and its HTTP status — the management-session twin of
 * `schedule-api.ts`'s `STATUS`, differing only in the session family: this surface is gated by a
 * MANAGEMENT session, so a missing/forged cookie or a session naming no live row is
 * `management_session.required` (401), an idled-out one `management_session.expired` (401), and a
 * mid-session suspension `person.suspended` (403) — the three faults `requireManagementSession` +
 * `resolveManagementSession` raise (identity's own codes). The request-shape and swap/absence domain
 * codes are identical to the till schedule surface (the shared `request-screens.ts` screens and the
 * #90 verbs), so their statuses match: a malformed body/query field is `management.request_invalid`
 * 400 and a malformed path `:swapId` is `shared.invalid_id` 400; an inverted absence range is
 * `absence.invalid` 400; `swap.not_permitted` is 403, `swap.not_acceptable`/`absence.overlaps` 409,
 * the `not_found` pair 404. A registered code absent here defaults to 400; the client codes are
 * enumerated anyway so this map is the surface's whole 4xx contract.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "absence.invalid": 400,
  "shift.not_found": 404,
  "swap.not_found": 404,
  "swap.not_permitted": 403,
  "swap.not_acceptable": 409,
  "absence.overlaps": 409,
};

const run = createErrorBoundary(STATUS, "me.failed");

/** Screen a body `kind` as one of the four `absence_kind` enum members — the SAME screen
 * `schedule-api.ts` uses. Any other value (a valid-looking-but-unknown string included) is a 400
 * `management.request_invalid` naming the field, never a downstream 22P02 enum 500. Validated against
 * the enum's own `enumValues` so it cannot drift from the schema. */
function requireAbsenceKind(v: unknown): AbsenceKind {
  if (typeof v !== "string" || !(absenceKind.enumValues as readonly string[]).includes(v)) {
    throw new AppError("management.request_invalid", { field: "kind" });
  }
  return v as AbsenceKind;
}

/**
 * Mounts the STAFF SELF-SERVICE routes on the management dashboard's HTTP surface (prefixes
 * `/management-api/session/me` and `/management-api/me/schedule`) — the browser twin of `apps/till`'s
 * till-PIN-gated `mountScheduleApi`. Every route resolves the requester from the MANAGEMENT SESSION
 * (`requireManagementSession` → `resolveManagementSession` → `personId`) FIRST and passes THAT
 * `personId` into the #90 verb; the request body is NEVER trusted for identity (the crux of this
 * surface — a staff member acts only as themselves). It is deliberately ROLE-BLIND: it calls
 * `resolveManagementSession` (which returns `personId` + `role` but gates only on idle-timeout +
 * suspension), NEVER `authorizeManager` — a `staff`-role person holds an EMPTY permission set, so an
 * `authorizeManager` gate would 403 every staff person, defeating the whole surface. The verb then runs
 * on the app role under this venue's tenant (`withTenant` + `asAppUser`), so RLS scopes it to this
 * tenant and the app's own `person_id` predicate scopes it to the requester (RLS is tenant-only).
 */
export function mountMeApi(app: Hono, deps: MeApiDeps, log: Logger): void {
  /** Run `fn` on the app role under this venue's tenant — the one place the withTenant/asAppUser pair
   * is expressed, so no route re-implements it. */
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });

  // Whoami: who is signed into this browser, and with what role. `requireManagementSession` screens the
  // cookie's SHAPE (401 before any DB work), then `resolveManagementSession` re-reads the live session +
  // the person's current role and status under RLS (a suspended person 403s here). Role-blind: NO
  // `authorizeManager`, so a staff session answers `{ role: "staff" }` rather than 403 — this is the
  // endpoint the dashboard shell probes to decide whether to open the staff view or the manager screens.
  app.get("/management-api/session/me", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, role } = await asStaff((tx) => resolveManagementSession(tx, sessionId));
      return c.json({ personId, role });
    }),
  );

  // The requester's OWN shifts over a half-open [from, to) local-date window.
  app.get("/management-api/me/schedule/shifts", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listShiftsForPerson(tx, { tenantId: deps.cfg.tenantId, personId, from, to });
      });
      return c.json(rows);
    }),
  );

  // The swaps the requester is party to (offered to them, or requested by them).
  app.get("/management-api/me/schedule/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listSwapsForPerson(tx, { tenantId: deps.cfg.tenantId, personId });
      });
      return c.json(rows);
    }),
  );

  // Request a swap: offer one of MY shifts to a colleague (`toShiftId` null = a one-sided give-away).
  // The requester is the session's person — never a body field.
  app.post("/management-api/me/schedule/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const fromShiftId = requireBodyUuid(body.fromShiftId, "fromShiftId");
      const toPersonId = requireBodyUuid(body.toPersonId, "toPersonId");
      const toShiftId = requireNullableBodyUuid(body.toShiftId, "toShiftId");
      const swapId = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return requestSwap(tx, {
          tenantId: deps.cfg.tenantId,
          requestedByPersonId: personId,
          fromShiftId,
          toPersonId,
          toShiftId,
        });
      });
      return c.json({ swapId }, 201);
    }),
  );

  // Accept a swap offered TO me — the acceptor is the session's person, so only the named recipient
  // can accept (acceptSwap's own guard).
  app.post("/management-api/me/schedule/swaps/:swapId/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return acceptSwap(tx, { tenantId: deps.cfg.tenantId, swapId, acceptingPersonId: personId });
      });
      return c.body(null, 204);
    }),
  );

  // The requester's OWN absences (every status).
  app.get("/management-api/me/schedule/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listAbsencesForPerson(tx, { tenantId: deps.cfg.tenantId, personId });
      });
      return c.json(rows);
    }),
  );

  // Request an absence for MYSELF — the person is the session's, never a body field.
  app.post("/management-api/me/schedule/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = (await c.req.json<Record<string, unknown>>()) ?? {};
      const kind = requireAbsenceKind(body.kind);
      const startsOn = requirePeriod(body.startsOn, "startsOn");
      const endsOn = requirePeriod(body.endsOn, "endsOn");
      const note = requireNullableString(body.note, "note");
      const absenceId = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return createAbsence(tx, {
          tenantId: deps.cfg.tenantId,
          personId,
          kind,
          startsOn,
          endsOn,
          note,
        });
      });
      return c.json({ absenceId }, 201);
    }),
  );
}
