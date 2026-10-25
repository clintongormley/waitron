import type { Context, Hono } from "hono";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { findIncident, markIncidentHandled } from "@waitron/core";
import { permissionsForRole, resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { AppError, diskFullIn, isUuid } from "@waitron/shared";
import {
  alertsVisible,
  claimFor,
  readHandledAlerts,
  readOpenAlerts,
  readOutsideTransactionAlerts,
  sortAndDeduplicateOpenAlerts,
  type AlertRegistry,
} from "./alerts.js";
import "./errors.js";

export interface AlertsApiDeps {
  db: Database;
  registry: AlertRegistry;
  now: () => Date;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "alert.not_found": 404,
  "management.request_invalid": 400,
  "alert.already_handled": 409,
} as const;

const NOTE_MAX = 500;
const NOTE_CODE = "clock.records_misdated";

/**
 * Judges a note request's raw body: the trimmed note, or null for none. An empty body, `null`, an
 * object without `note` and a blank note are no note; with `required`, none is refused.
 */
function judgeNoteBody(text: string, required: boolean): string | null {
  let note: string | null = null;
  if (text !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError("management.request_invalid", { field: "body" });
    }
    if (parsed !== null) {
      if (typeof parsed !== "object" || Array.isArray(parsed))
        throw new AppError("management.request_invalid", { field: "note" });
      const raw = (parsed as { note?: unknown }).note;
      if (raw !== undefined) {
        if (typeof raw !== "string")
          throw new AppError("management.request_invalid", { field: "note" });
        const trimmed = raw.trim();
        if (trimmed.length > NOTE_MAX)
          throw new AppError("management.request_invalid", { field: "note" });
        if (trimmed !== "") note = trimmed;
      }
    }
  }
  if (required && note === null)
    throw new AppError("management.request_invalid", { field: "note" });
  return note;
}

/**
 * The dashboard alerts: open alerts, recently handled ones, and marking an incident handled. Each
 * request opens one transaction; a read refused by a full disk retries in a turn with no drain.
 */
export function mountAlertsApi(app: Hono, deps: AlertsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "alerts.failed");

  const inSession = <T>(
    c: Context,
    fn: (tx: Transaction, session: { personId: string; held: ReadonlySet<string> }) => Promise<T>,
  ): Promise<T> => {
    const sessionId = requireManagementSession(c);
    return withTransaction(deps.db, async (tx) => {
      const session = await resolveManagementSession(tx, sessionId);
      const held = new Set(permissionsForRole(session.role));
      return fn(tx, { personId: session.personId, held });
    });
  };

  const list = (read: typeof readOpenAlerts, includeExternal: boolean) => (c: Context) =>
    run(c, log, async () => {
      const now = deps.now();
      const sessionId = requireManagementSession(c);
      const readAs = async (tx: Transaction, touch: boolean) => {
        const session = await resolveManagementSession(tx, sessionId, { touch });
        const held: ReadonlySet<string> = new Set(permissionsForRole(session.role));
        if (!alertsVisible(deps.registry, held)) return { visible: false, alerts: [], held };
        const alerts = await read(tx, { registry: deps.registry, now, log }, held);
        return { visible: true, alerts, held };
      };
      let body: Awaited<ReturnType<typeof readAs>>;
      try {
        body = await withTransaction(deps.db, (tx) => readAs(tx, true));
      } catch (error) {
        if (!diskFullIn(error)) throw error;
        // On a full disk the last-seen stamp or the transaction's closing change-log drain is
        // refused, so the same checks run again with neither: the bell is how a manager learns the
        // disk is full.
        body = await deps.db.withWriteLock(() => readAs(deps.db, false));
      }
      const alerts =
        body.visible && includeExternal
          ? sortAndDeduplicateOpenAlerts([
              ...body.alerts,
              ...(await readOutsideTransactionAlerts(
                deps.db,
                { registry: deps.registry, now, log },
                body.held,
              )),
            ])
          : body.alerts;
      return c.json({ visible: body.visible, alerts });
    });

  app.get("/management-api/alerts", list(readOpenAlerts, true));
  app.get("/management-api/alerts/handled", list(readHandledAlerts, false));

  app.post("/management-api/alerts/incidents/:id/handled", (c) =>
    run(c, log, async () => {
      const id = c.req.param("id");
      const text = await c.req.text();
      await inSession(c, async (tx, { personId, held }) => {
        const incident =
          alertsVisible(deps.registry, held) && isUuid(id) ? await findIncident(tx, id) : null;
        if (incident === null) throw new AppError("alert.not_found", { id });
        const { permission } = claimFor(deps.registry, incident.code);
        if (!held.has(permission))
          throw new AppError("authorization.not_permitted", { permission });
        const note = judgeNoteBody(text, false);
        // No screen shows another code's note, so one is not taken for it.
        if (note !== null && incident.code !== NOTE_CODE)
          throw new AppError("alert.not_found", { id });
        const changed = await markIncidentHandled(tx, {
          id,
          personId,
          handledAt: deps.now(),
          note,
        });
        if (!changed && note !== null) throw new AppError("alert.already_handled", { id });
      });
      return c.body(null, 204);
    }),
  );
}
