// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { nowIso, printAgents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { verifySecret } from "@waitron/identity";

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
 * Auth runs on every pull and report, so the sighting write is gated to one per
 * {@link SIGHTING_INTERVAL_MS}.
 */
export async function authenticateAgent(
  tx: Transaction,
  token: string,
): Promise<{ agentId: string }> {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("agent.unauthorized", {});
  const agentId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(agentId)) throw new AppError("agent.unauthorized", {});

  const [row] = await tx
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    // `active = true` is the revocation filter, so a revoke takes effect at once.
    .where(and(eq(printAgents.id, agentId), eq(printAgents.active, true)));
  if (row === undefined) throw new AppError("agent.unauthorized", {});
  if (!verifySecret(secret, row.tokenHash)) throw new AppError("agent.unauthorized", {});

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
  return { agentId };
}
