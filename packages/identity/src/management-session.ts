import "./errors.js";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import type { PersonRoleValue } from "./permissions.js";

/**
 * The lifecycle of a browser MANAGEMENT session — the seam the dashboard login (Task 8) and the
 * server API (slice 1b) build on. Distinct from a till's PIN shift-login (`sessions`): this is a
 * person signed into the management dashboard from a browser.
 *
 * `resolveManagementSession` is the guard every authenticated request runs: it enforces a SLIDING
 * idle timeout and — importantly — re-reads `persons.status` on every call, so a mid-session
 * suspension loses access immediately rather than at the next login.
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes, sliding

export interface ManagementSession {
  id: string;
  tenantId: string;
  personId: string;
}

/** Open a management session for a person. The caller has already authenticated them. */
export async function startManagementSession(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<ManagementSession> {
  const [row] = await tx
    .insert(managementSessions)
    .values({ tenantId: input.tenantId, personId: input.personId })
    .returning({ id: managementSessions.id });
  return { id: row!.id, tenantId: input.tenantId, personId: input.personId };
}

/**
 * Resolve a live session to its person + role, or throw. Missing/ended → `management_session.required`;
 * idled past `IDLE_TIMEOUT_MS` → `management_session.expired`; person suspended → `person.suspended`.
 * On success it bumps `last_seen_at` (the sliding window) and returns the person's current role.
 */
export async function resolveManagementSession(
  tx: Transaction,
  sessionId: string,
): Promise<{ personId: string; role: PersonRoleValue; locale: string | null }> {
  const [row] = await tx
    .select({
      personId: managementSessions.personId,
      lastSeenAt: managementSessions.lastSeenAt,
      role: persons.role,
      status: persons.status,
      locale: persons.locale,
    })
    .from(managementSessions)
    .innerJoin(persons, eq(persons.id, managementSessions.personId))
    .where(and(eq(managementSessions.id, sessionId), isNull(managementSessions.endedAt)));
  if (row === undefined) throw new AppError("management_session.required", {});
  if (Date.now() - Date.parse(row.lastSeenAt) > IDLE_TIMEOUT_MS) {
    throw new AppError("management_session.expired", {});
  }
  if (row.status === "suspended") {
    throw new AppError("person.suspended", { personId: row.personId });
  }
  await tx
    .update(managementSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(and(eq(managementSessions.id, sessionId), isNull(managementSessions.endedAt)));
  return { personId: row.personId, role: row.role as PersonRoleValue, locale: row.locale };
}

/** Stamp `ended_at` on a live session. Returns true if one was ended, false if none was live. */
export async function endManagementSession(tx: Transaction, sessionId: string): Promise<boolean> {
  const updated = await tx
    .update(managementSessions)
    .set({ endedAt: sql`now()` })
    .where(and(eq(managementSessions.id, sessionId), isNull(managementSessions.endedAt)))
    .returning({ id: managementSessions.id });
  return updated.length > 0;
}
