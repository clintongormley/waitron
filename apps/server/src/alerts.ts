import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { listHandledIncidents, listOpenIncidents, type TenantIncident } from "@waitron/core";
import { persons } from "@waitron/identity";
import type { Alert, AlertEventClaim, AlertSource } from "@waitron/module";
import { codeOf, type Logger } from "@waitron/server-kit";
import type { TenantId } from "@waitron/shared";
import "./errors.js";

/** Where an incident whose code no area claims is shown, so a new code is never recorded and then
 * hidden from everyone. */
export const UNCLAIMED: AlertEventClaim = {
  prefix: "",
  area: "diagnostics",
  permission: "diagnostics.view",
};

export const HANDLED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface AlertRegistry {
  readonly claims: readonly AlertEventClaim[];
  readonly sources: readonly AlertSource[];
}

export function createAlertRegistry(parts: {
  claims: readonly AlertEventClaim[];
  sources: readonly AlertSource[];
}): AlertRegistry {
  const seen = new Set<string>();
  for (const claim of parts.claims) {
    if (seen.has(claim.prefix)) throw new Error(`two alert claims on the prefix "${claim.prefix}"`);
    seen.add(claim.prefix);
  }
  // Sources may share an area: one area can carry a module-owned and a server-owned source at once.
  return { claims: [...parts.claims], sources: [...parts.sources] };
}

export function claimFor(registry: AlertRegistry, code: string): AlertEventClaim {
  let best: AlertEventClaim | undefined;
  for (const claim of registry.claims) {
    if (
      code.startsWith(claim.prefix) &&
      (best === undefined || claim.prefix.length > best.prefix.length)
    )
      best = claim;
  }
  return best ?? UNCLAIMED;
}

export function alertsVisible(registry: AlertRegistry, held: ReadonlySet<string>): boolean {
  return [UNCLAIMED, ...registry.claims, ...registry.sources].some((p) => held.has(p.permission));
}

export function incidentKey(id: string): string {
  return `incident:${id}`;
}

export interface AlertReadDeps {
  registry: AlertRegistry;
  tenantId: TenantId;
  now: Date;
  log: Logger;
}

function eventAlert(incident: TenantIncident, claim: AlertEventClaim): Alert {
  return {
    key: incidentKey(incident.id),
    kind: "event",
    code: incident.code,
    params: incident.params,
    severity: incident.severity,
    since: incident.detectedAt.toISOString(),
    area: claim.area,
  };
}

const SEVERITY_RANK = { error: 0, warning: 1 } as const;

function compareOpen(a: Alert, b: Alert): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.since === null || b.since === null) {
    if (a.since !== b.since) return a.since === null ? 1 : -1;
  } else {
    // Compared as instants: a source may write `since` with an offset rather than as UTC.
    const byTime = Date.parse(b.since) - Date.parse(a.since);
    if (byTime !== 0) return byTime;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export async function readOpenAlerts(
  tx: Transaction,
  deps: AlertReadDeps,
  held: ReadonlySet<string>,
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  for (const incident of await listOpenIncidents(tx, deps.tenantId)) {
    const claim = claimFor(deps.registry, incident.code);
    if (held.has(claim.permission)) alerts.push(eventAlert(incident, claim));
  }
  // The synthetic is keyed by area, so two failed sources in one area would collide; show it once.
  const failedAreas = new Set<string>();
  for (const source of deps.registry.sources) {
    if (!held.has(source.permission)) continue;
    try {
      // A savepoint per source: a failed query aborts only this source's work, not the transaction
      // every later source reads on.
      const found = await tx.transaction((sp) =>
        source.read({ tx: sp, tenantId: deps.tenantId, now: deps.now }),
      );
      for (const alert of found) alerts.push({ ...alert, kind: "ongoing", area: source.area });
    } catch (error) {
      deps.log("error", "alert.source_unavailable", {
        area: source.area,
        errorCode: codeOf(error),
      });
      if (failedAreas.has(source.area)) continue;
      failedAreas.add(source.area);
      alerts.push({
        key: `alert.source_unavailable:${source.area}`,
        kind: "ongoing",
        code: "alert.source_unavailable",
        params: { area: source.area },
        severity: "error",
        since: deps.now.toISOString(),
        area: source.area,
      });
    }
  }
  return alerts.sort(compareOpen);
}

export async function readHandledAlerts(
  tx: Transaction,
  deps: AlertReadDeps,
  held: ReadonlySet<string>,
): Promise<Alert[]> {
  const since = new Date(deps.now.getTime() - HANDLED_WINDOW_MS);
  const visible = (await listHandledIncidents(tx, deps.tenantId, since)).flatMap((incident) => {
    const claim = claimFor(deps.registry, incident.code);
    return held.has(claim.permission) ? [{ incident, claim }] : [];
  });
  const ids = [...new Set(visible.flatMap(({ incident }) => incident.acknowledgedBy ?? []))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(and(eq(persons.tenantId, deps.tenantId), inArray(persons.id, ids)));
    for (const row of rows) names.set(row.id, row.displayName);
  }
  return visible.map(({ incident, claim }) => ({
    ...eventAlert(incident, claim),
    handledAt: incident.acknowledgedAt!.toISOString(),
    handledBy:
      incident.acknowledgedBy === null ? null : (names.get(incident.acknowledgedBy) ?? null),
  }));
}
