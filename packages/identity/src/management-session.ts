import "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "@waitron/shared";
import { nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { and, eq, isNull } from "drizzle-orm";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashSessionToken, mintSessionToken } from "./session-token.js";

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

const passiveRead = new AsyncLocalStorage<boolean>();

/** An automatic HTTP read verifies the session without counting as human activity. */
export function withPassiveManagementRead<T>(read: () => T): T {
  return passiveRead.run(true, read);
}

export interface ManagementSession {
  /** The bearer token the dashboard cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
}

/** Open a management session for a person. The caller has already authenticated them. */
export async function startManagementSession(
  tx: Transaction,
  input: { personId: string },
): Promise<ManagementSession> {
  const token = mintSessionToken();
  await tx
    .insert(managementSessions)
    .values({ personId: input.personId, tokenHash: hashSessionToken(token) });
  return { token, personId: input.personId };
}

/**
 * Resolve a live session to its person + role, or throw. `token` is the cookie's raw value; a
 * session's row id or stored hash names no session. Missing, ended, or — the
 * table holds no foreign key to `persons` — pointing at a person row that is gone →
 * `management_session.required` (two nets refuse that last one: the inner join finds nothing, and the
 * status check below refuses a status that is not `active`);
 * idled past `IDLE_TIMEOUT_MS` → `management_session.expired`; person suspended → `person.suspended`;
 * a pending person → `management_session.required`.
 * On success it bumps `last_seen_at` (the sliding window) and returns the session's row id, the
 * person's current role and their stored UI `locale` (`persons.locale`, `null` when they have set no
 * preference).
 */
export async function resolveManagementSession(
  tx: Transaction,
  token: string,
  options: { touch?: boolean } = {},
): Promise<{
  sessionRowId: string;
  personId: string;
  role: PersonRoleValue;
  email: string | null;
  locale: string | null;
  expiresAt: string;
}> {
  const [row] = await tx
    .select({
      sessionRowId: managementSessions.id,
      personId: managementSessions.personId,
      lastSeenAt: managementSessions.lastSeenAt,
      role: persons.role,
      status: persons.status,
      email: persons.email,
      locale: persons.locale,
    })
    .from(managementSessions)
    .innerJoin(persons, eq(persons.id, managementSessions.personId))
    .where(
      and(
        eq(managementSessions.tokenHash, hashSessionToken(token)),
        isNull(managementSessions.endedAt),
      ),
    );
  if (row === undefined) throw new AppError("management_session.required", {});
  if (Date.now() - Date.parse(row.lastSeenAt) > IDLE_TIMEOUT_MS) {
    throw new AppError("management_session.expired", {});
  }
  if (row.status === "suspended") {
    throw new AppError("person.suspended", { personId: row.personId });
  }
  if (row.status !== "active") throw new AppError("management_session.required", {});
  const touch = options.touch !== false && passiveRead.getStore() !== true;
  if (touch) {
    await tx
      .update(managementSessions)
      .set({ lastSeenAt: nowIso() })
      .where(and(eq(managementSessions.id, row.sessionRowId), isNull(managementSessions.endedAt)));
  }
  return {
    sessionRowId: row.sessionRowId,
    personId: row.personId,
    role: row.role as PersonRoleValue,
    email: row.email,
    locale: row.locale,
    expiresAt: new Date(
      (touch ? Date.now() : Date.parse(row.lastSeenAt)) + IDLE_TIMEOUT_MS,
    ).toISOString(),
  };
}

/** Stamp `ended_at` on a live session. Returns true if one was ended, false if none was live. */
export async function endManagementSession(tx: Transaction, token: string): Promise<boolean> {
  const tokenHash = hashSessionToken(token);
  const updated = await tx
    .update(managementSessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(managementSessions.tokenHash, tokenHash), isNull(managementSessions.endedAt)))
    .returning({ id: managementSessions.id });
  return updated.length > 0;
}
