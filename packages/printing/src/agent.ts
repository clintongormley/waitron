// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { nowIso, printAgents, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { verifySecretAsync } from "@waitron/identity";

/** The venue scope, resolved by the route and never derived from client input. */
export interface PrintAgentConfig {
  locationId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How stale a recorded sighting has to be before auth writes a fresh one. */
const SIGHTING_INTERVAL_MS = 60_000;

/**
 * Resolves a bearer token `${agentId}.${secret}` to its agent id. The id selects the row (the scrypt
 * salt is per row) and the secret validates it. Every failure throws the same `agent.unauthorized`,
 * so the response confirms neither an agent's existence nor its revocation.
 *
 * The key is derived on the thread pool with no transaction open, so neither the event loop nor the
 * venue's write lock waits on scrypt. The transaction that follows re-reads the row, so a revoke or a
 * re-key that commits while the key is derived still refuses this token.
 *
 * Auth runs on every pull and report, so the sighting write is gated to one per
 * {@link SIGHTING_INTERVAL_MS}.
 */
export async function authenticateAgent(db: Database, token: string): Promise<{ agentId: string }> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("agent.unauthorized", {});
  const agentId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(agentId)) throw new AppError("agent.unauthorized", {});

  // `active = true` is the revocation filter, so a revoke takes effect at once.
  const current = and(eq(printAgents.id, agentId), eq(printAgents.active, true));
  const [row] = await db
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    .where(current);
  if (row === undefined) throw new AppError("agent.unauthorized", {});
  if (!(await verifySecretAsync(secret, row.tokenHash))) {
    throw new AppError("agent.unauthorized", {});
  }

  await withTransaction(db, async (tx) => {
    const [still] = await tx
      .select({ tokenHash: printAgents.tokenHash })
      .from(printAgents)
      .where(current);
    if (still?.tokenHash !== row.tokenHash) throw new AppError("agent.unauthorized", {});

    // `last_seen_at` is text, so `<` is a string comparison, a correct time order only for the
    // `toISOString()` spelling `nowIso` writes.
    const seenAt = nowIso();
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
  });
  return { agentId };
}
