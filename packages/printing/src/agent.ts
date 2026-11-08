// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError, diskFullIn, isUuid } from "@waitron/shared";
import { nowIso, printAgents, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { createVerifiedTokenMemory, verifySecretAsync } from "@waitron/identity";

/** How stale a recorded sighting has to be before auth writes a fresh one. */
const SIGHTING_INTERVAL_MS = 60_000;

export const VERIFIED_AGENTS_LIMIT = 256;
const verifiedAgents = createVerifiedTokenMemory(VERIFIED_AGENTS_LIMIT);

/**
 * Resolves a bearer token `${agentId}.${secret}` to its agent id. The id selects the row (the scrypt
 * salt is per row) and the secret validates it. Every refusal is the same `agent.unauthorized`.
 *
 * The key is derived on the thread pool and the row re-read afterwards, both with no transaction
 * open, so a revoke or a re-key committed while the key was derived refuses this token. A secret
 * that passes is remembered against the row's hash, and a request whose secret and current hash
 * match what is remembered skips the derivation; the row is read on every request, so a revoke or
 * a re-key committed before that read refuses the token.
 *
 * Auth runs on every pull and report, so the sighting write is gated to one per
 * {@link SIGHTING_INTERVAL_MS}, and the venue's write lock is taken only when that write is due.
 * That write re-reads the row inside its transaction first, so a revoke or a re-key committed
 * while this call waited for the lock refuses the token too.
 */
export async function authenticateAgent(db: Database, token: string): Promise<{ agentId: string }> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("agent.unauthorized", {});
  const agentId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!isUuid(agentId)) throw new AppError("agent.unauthorized", {});

  const current = and(eq(printAgents.id, agentId), eq(printAgents.active, true));
  const readRow = async (on: Database | Transaction = db) => {
    const [found] = await on
      .select({ tokenHash: printAgents.tokenHash, lastSeenAt: printAgents.lastSeenAt })
      .from(printAgents)
      .where(current);
    return found;
  };
  let row = await readRow();
  if (row === undefined) {
    verifiedAgents.forget(agentId);
    throw new AppError("agent.unauthorized", {});
  }
  if (!verifiedAgents.alreadyVerified(agentId, secret, row.tokenHash)) {
    const checkedHash = row.tokenHash;
    if (!(await verifySecretAsync(secret, checkedHash))) {
      throw new AppError("agent.unauthorized", {});
    }
    row = await readRow();
    if (row === undefined || row.tokenHash !== checkedHash) {
      throw new AppError("agent.unauthorized", {});
    }
    verifiedAgents.remember(agentId, secret, checkedHash);
  }

  // `last_seen_at` is text, so `<` is a string comparison, a correct time order only for the
  // `toISOString()` spelling `nowIso` writes.
  const seenAt = nowIso();
  const staleBefore = new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();
  if (row.lastSeenAt === null || row.lastSeenAt < staleBefore) {
    const verifiedHash = row.tokenHash;
    const stillCurrent = async (on: Database | Transaction): Promise<boolean> =>
      (await readRow(on))?.tokenHash === verifiedHash;
    let stillValid: boolean;
    try {
      stillValid = await withTransaction(db, async (tx) => {
        if (!(await stillCurrent(tx))) return false;
        // The staleness check on the row read spares a call the write lock; the same check in this
        // update keeps calls that all read a stale row to one write.
        await tx
          .update(printAgents)
          .set({ lastSeenAt: seenAt })
          .where(
            and(
              eq(printAgents.id, agentId),
              // `<` is UNKNOWN for NULL, so a never-seen agent needs its own alternative.
              or(isNull(printAgents.lastSeenAt), lt(printAgents.lastSeenAt, staleBefore)),
            ),
          );
        return true;
      });
    } catch (error) {
      // A full disk refuses the sighting, not the agent: the same check runs again, unstamped.
      if (!diskFullIn(error)) throw error;
      stillValid = await stillCurrent(db);
    }
    if (!stillValid) {
      verifiedAgents.forget(agentId);
      throw new AppError("agent.unauthorized", {});
    }
  }
  return { agentId };
}
