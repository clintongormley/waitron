// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError, isUuid } from "@waitron/shared";
import { printAgents } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { signInWithToken, staleBefore } from "@waitron/identity";

/**
 * Resolves a bearer token `${agentId}.${secret}` to its agent id. The id selects the row and the
 * secret validates it, through {@link signInWithToken}. Every refusal is the same
 * `agent.unauthorized`.
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
      await tx
        .update(printAgents)
        .set({ lastSeenAt: seenAt })
        .where(
          and(
            eq(printAgents.id, agentId),
            // `<` is UNKNOWN for NULL, so a never-seen agent needs its own alternative.
            or(isNull(printAgents.lastSeenAt), lt(printAgents.lastSeenAt, staleBefore(seenAt))),
          ),
        );
    },
  });
  if (row === null) throw new AppError("agent.unauthorized", {});
  return { agentId };
}
