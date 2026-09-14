import type { Context, Hono } from "hono";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
import { findIncident, markIncidentHandled } from "@waitron/core";
import { permissionsForRole, resolveManagementSession } from "@waitron/identity";
import { createErrorBoundary, requireManagementSession, type Logger } from "@waitron/server-kit";
import { AppError, isUuid, tenantId as brandTenantId } from "@waitron/shared";
import {
  alertsVisible,
  claimFor,
  readHandledAlerts,
  readOpenAlerts,
  type AlertRegistry,
} from "./alerts.js";
import "./errors.js";

export interface AlertsApiDeps {
  db: Database;
  cfg: { tenantId: string };
  registry: AlertRegistry;
  now: () => Date;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "alert.not_found": 404,
} as const;

/**
 * The dashboard alerts: open alerts, recently handled ones, and marking an incident handled. Each
 * request opens one transaction as the app role. A session from another tenant holds no permissions
 * here, so it sees nothing and can handle nothing.
 */
export function mountAlertsApi(app: Hono, deps: AlertsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "alerts.failed");
  const tenantId = brandTenantId(deps.cfg.tenantId);

  const inSession = <T>(
    c: Context,
    fn: (tx: Transaction, session: { personId: string; held: ReadonlySet<string> }) => Promise<T>,
  ): Promise<T> => {
    const sessionId = requireManagementSession(c);
    return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const session = await resolveManagementSession(tx, sessionId);
      const held = new Set(
        session.tenantId === deps.cfg.tenantId ? permissionsForRole(session.role) : [],
      );
      return fn(tx, { personId: session.personId, held });
    });
  };

  const list = (read: typeof readOpenAlerts) => (c: Context) =>
    run(c, log, async () => {
      const body = await inSession(c, async (tx, { held }) => {
        if (!alertsVisible(deps.registry, held)) return { visible: false, alerts: [] };
        const alerts = await read(
          tx,
          { registry: deps.registry, tenantId, now: deps.now(), log },
          held,
        );
        return { visible: true, alerts };
      });
      return c.json(body);
    });

  app.get("/management-api/alerts", list(readOpenAlerts));
  app.get("/management-api/alerts/handled", list(readHandledAlerts));

  app.post("/management-api/alerts/incidents/:id/handled", (c) =>
    run(c, log, async () => {
      const id = c.req.param("id");
      await inSession(c, async (tx, { personId, held }) => {
        const incident =
          alertsVisible(deps.registry, held) && isUuid(id)
            ? await findIncident(tx, tenantId, id)
            : null;
        if (incident === null) throw new AppError("alert.not_found", { id });
        const { permission } = claimFor(deps.registry, incident.code);
        if (!held.has(permission))
          throw new AppError("authorization.not_permitted", { permission });
        await markIncidentHandled(tx, { tenantId, id, personId, handledAt: deps.now() });
      });
      return c.body(null, 204);
    }),
  );
}
