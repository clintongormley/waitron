// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError, isUuid } from "@waitron/shared";
import { printAgents } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { SIGHTING_INTERVAL_MS, signInWithToken } from "@waitron/identity";

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

  const readRow = async (on: Database | Transaction) => {
    const [found] = await on
      .select({ tokenHash: printAgents.tokenHash, lastSeenAt: printAgents.lastSeenAt })
      .from(printAgents)
      .where(and(eq(printAgents.id, agentId), eq(printAgents.active, true)));
    return found;
  };
  const row = await signInWithToken(db, {
    token: secret,
    readRow,
    // The staleness check on the row read spares a call the write lock; the same check in this
    // update keeps calls that all read a stale row to one write.
    recordSighting: async (tx, seenAt) => {
      const staleBefore = new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();
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
    },
  });
  if (row === null) throw new AppError("agent.unauthorized", {});
  return { agentId };
}
