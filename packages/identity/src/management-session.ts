import "./errors.js";
import { readPersonAuthority } from "./authority.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "@waitron/shared";
import { nowIso, managementSessions, persons } from "@waitron/db";
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

export interface ManagementSession {
  /** The bearer token the dashboard cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
}

/** The caller has already authenticated the person. */
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

async function readManagementSession(tx: Database | Transaction, token: string) {
  const [row] = await tx
    .select({
      sessionRowId: managementSessions.id,
      personId: managementSessions.personId,
      lastSeenAt: managementSessions.lastSeenAt,
      status: persons.status,
      email: persons.email,
      displayName: persons.displayName,
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
  // Mirrored: a backward clock step past the idle timeout ends the session as a forward one does.
  if (Math.abs(Date.now() - Date.parse(row.lastSeenAt)) > IDLE_TIMEOUT_MS) {
    throw new AppError("management_session.expired", {});
  }
  if (row.status === "suspended") {
    throw new AppError("person.suspended", { personId: row.personId });
  }
  if (row.status !== "active") throw new AppError("management_session.required", {});
  return row;
}

export async function resolveManagementSession(
  tx: Transaction,
  token: string,
  options: { touch?: boolean } = {},
) {
  const row = await readManagementSession(tx, token);
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
    authority: await readPersonAuthority(tx, row.personId),
    email: row.email,
    displayName: row.displayName,
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

export async function checkManagementSession(db: Database, token: string): Promise<void> {
  await readManagementSession(db, token);
}
