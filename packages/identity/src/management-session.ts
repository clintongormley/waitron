import "./errors.js";
import { authorityForRoles, inspectsInvoicesOnly, type PersonAuthority } from "./authority.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "@waitron/shared";
import {
  recordActivity,
  type ActivityKindData,
  nowIso,
  dashboardSessions,
  personRoles,
  persons,
  roles,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { and, eq, isNull } from "drizzle-orm";
import { hashSessionToken, mintSessionToken } from "./session-token.js";

/** Sliding: a resolve restarts it unless the read is passive or passes `touch: false`. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const passiveRead = new AsyncLocalStorage<boolean>();

/** An automatic HTTP read verifies the session without counting as human activity. */
export function withPassiveManagementRead<T>(read: () => T): T {
  return passiveRead.run(true, read);
}

const inspectorAdmitted = new AsyncLocalStorage<boolean>();

/** Lets a session holding `invoice.inspect` alone past the inspection-only refusal inside `route`;
 * the route's own permission checks still apply. */
export function withInspectorAdmitted<T>(route: () => T): T {
  return inspectorAdmitted.run(true, route);
}

export interface ManagementSession {
  /** The bearer token the dashboard cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
}

export type DashboardSignInMethod = ActivityKindData["dashboard.signed_in"]["method"];
export type DashboardSignOutReason = ActivityKindData["dashboard.signed_out"]["reason"];

/** The caller has already authenticated the person. */
export async function startManagementSession(
  tx: Transaction,
  input: { personId: string; method: DashboardSignInMethod },
): Promise<ManagementSession> {
  const token = mintSessionToken();
  await tx
    .insert(dashboardSessions)
    .values({ personId: input.personId, tokenHash: hashSessionToken(token) });
  await recordActivity(tx, {
    kind: "dashboard.signed_in",
    subjectId: input.personId,
    personId: input.personId,
    data: { method: input.method },
  });
  return { token, personId: input.personId };
}

/** The live session and the person's roles, in one read. */
async function readManagementSession(tx: Database | Transaction, token: string) {
  const rows = await tx
    .select({
      sessionRowId: dashboardSessions.id,
      personId: dashboardSessions.personId,
      lastSeenAt: dashboardSessions.lastSeenAt,
      status: persons.status,
      email: persons.email,
      displayName: persons.displayName,
      locale: persons.locale,
      roleId: roles.id,
      builtInKey: roles.builtInKey,
      permissions: roles.permissions,
    })
    .from(dashboardSessions)
    .innerJoin(persons, eq(persons.id, dashboardSessions.personId))
    .leftJoin(personRoles, eq(personRoles.personId, dashboardSessions.personId))
    .leftJoin(roles, eq(roles.id, personRoles.roleId))
    .where(
      and(
        eq(dashboardSessions.tokenHash, hashSessionToken(token)),
        isNull(dashboardSessions.endedAt),
      ),
    );
  const row = rows[0];
  if (row === undefined) throw new AppError("management_session.required", {});
  // Mirrored: a backward clock step past the idle timeout ends the session as a forward one does.
  if (Math.abs(Date.now() - Date.parse(row.lastSeenAt)) > IDLE_TIMEOUT_MS) {
    throw new AppError("management_session.expired", {});
  }
  if (row.status === "suspended") {
    throw new AppError("person.suspended", { personId: row.personId });
  }
  if (row.status !== "active") throw new AppError("management_session.required", {});
  const held = rows.flatMap(({ roleId, builtInKey, permissions }) =>
    roleId === null || permissions === null ? [] : [{ id: roleId, builtInKey, permissions }],
  );
  return { ...row, authority: authorityForRoles(row.personId, held) };
}

function refuseUnadmittedInspector(authority: PersonAuthority, admitInspector?: boolean): void {
  if (
    inspectsInvoicesOnly(authority) &&
    admitInspector !== true &&
    inspectorAdmitted.getStore() !== true
  )
    throw new AppError("authorization.inspection_only", {});
}

/** Refuses a session holding `invoice.inspect` alone unless `admitInspector` or
 * `withInspectorAdmitted` admits it, so a route that does not opt in is closed to it. */
export async function resolveManagementSession(
  tx: Transaction,
  token: string,
  options: { touch?: boolean; admitInspector?: boolean } = {},
) {
  const row = await readManagementSession(tx, token);
  const { authority } = row;
  refuseUnadmittedInspector(authority, options.admitInspector);
  const touch = options.touch !== false && passiveRead.getStore() !== true;
  if (touch) {
    await tx
      .update(dashboardSessions)
      .set({ lastSeenAt: nowIso() })
      .where(and(eq(dashboardSessions.id, row.sessionRowId), isNull(dashboardSessions.endedAt)));
  }
  return {
    sessionRowId: row.sessionRowId,
    personId: row.personId,
    authority,
    email: row.email,
    displayName: row.displayName,
    locale: row.locale,
    expiresAt: new Date(
      (touch ? Date.now() : Date.parse(row.lastSeenAt)) + IDLE_TIMEOUT_MS,
    ).toISOString(),
  };
}

export async function endManagementSession(
  tx: Transaction,
  token: string,
  reason: DashboardSignOutReason,
): Promise<boolean> {
  const removed = await tx
    .delete(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.tokenHash, hashSessionToken(token)),
        isNull(dashboardSessions.endedAt),
      ),
    )
    .returning({ personId: dashboardSessions.personId });
  for (const row of removed)
    await recordActivity(tx, {
      kind: "dashboard.signed_out",
      subjectId: row.personId,
      personId: row.personId,
      data: { reason },
    });
  return removed.length > 0;
}

/** Refuses what `resolveManagementSession` refuses, a session holding `invoice.inspect` alone
 * included, without stamping its activity. */
export async function checkManagementSession(db: Database, token: string): Promise<void> {
  refuseUnadmittedInspector((await readManagementSession(db, token)).authority);
}
