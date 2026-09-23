// Side-effect only: keeps this package's `agent.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention every code-throwing file in the tree follows, guarded
// tree-wide by scripts/errors-reachable.test.ts. See errors.ts.
import "./errors.js";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { nowIso, printAgents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { verifySecret } from "@waitron/identity";

// Printing subsystem §3a — the agent-auth CORE. `authenticateAgent` resolves a presented bearer token
// to its `print_agents` row id, or throws `agent.unauthorized`; a revoked (`active = false`) agent
// fails instantly. Agent enrolment is join-and-accept (the shared join_requests mechanism, in
// apps/server/src/join-requests.ts) — there is no pairing-code verb here. The Task-6 route layer wraps
// this call in `withTransaction`, owns the HTTP status mapping and parses the Bearer header.
//
// The agent token's secret half is LONG-LIVED and salted per row, so it is hashed with scrypt
// (verifySecret, @waitron/identity) — the same KDF PINs, passwords and device tokens use — and the
// plaintext is never compared with `===` nor persisted in the clear.

/**
 * The tenant + venue scope an agent is minted under. The route resolves it (single-tenant deli
 * deployment, the location) and passes it down, so this verb never derives scope from client
 * input.
 */
export interface PrintAgentConfig {
  locationId: string;
}

/**
 * Anchored UUID shape check for the bearer token's SELECTOR half. `print_agents.id` is a Postgres
 * `uuid` column, so a bearer whose selector is NOT a uuid would make `eq(printAgents.id, agentId)`
 * raise `22P02 invalid input syntax for type uuid` — which the route maps to an opaque 500. A forged
 * bearer is a client fault, not a server one, so its shape is screened first and fails as a clean
 * `agent.unauthorized`. Mirrors `till-session.ts`'s `isUuid`; not reusing that one because it lives in
 * apps/server (packages never import apps, design/Ruling 5) and `@waitron/shared`'s validator is a
 * private, unexported const (the same reason `till-session.ts` re-declares it).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How stale a recorded sighting has to be before auth writes a fresh one.
 *
 * It was the SQL literal `interval '1 minute'`; it is a named millisecond count because the cutoff
 * is now computed here and bound, not built in SQL — see the gate in `authenticateAgent`.
 */
const SIGHTING_INTERVAL_MS = 60_000;

/**
 * The agent-auth CORE (§3a, Ruling 5). Resolves a presented bearer token STRING to its agent id, or
 * throws `agent.unauthorized`. The Task-6 Hono wrapper (`requireAgent`) extracts the
 * `Authorization: Bearer <token>` header and calls this; header parsing is that wrapper's trivial
 * concern, so this core takes a plain string and never sees Hono. The `tx` is opened by that wrapper
 * (`withTransaction`), the machine-to-machine shape.
 *
 * The token is `${agentId}.${secret}`: the id SELECTS the row (scrypt is per-row-salted, so the id is
 * needed to fetch the salt) and the secret VALIDATES it. Every failure — a malformed token, a
 * non-uuid selector, an unknown or REVOKED (`active = false`) agent, or a secret that does not
 * `verifySecret` against the stored hash — folds into the SAME `agent.unauthorized`, so the response
 * confirms neither an agent's existence nor its revocation state (the oracle-free reasoning in
 * errors.ts). `active = true` is the revocation filter, which makes revoke INSTANT: a revoked row is
 * simply not found, with no token lifetime to expire. `verifySecret` (scrypt, @waitron/identity) is
 * constant-time — the secret is NEVER compared with `===`.
 *
 * On success the sighting is recorded (`last_seen_at`), gated to at most one write per minute — auth
 * runs on every pull/report (the hot path) and the dashboard renders last-seen coarsely, so a
 * sub-minute re-write is invisible write amplification. The gate keeps the first sighting (NULL →
 * written) and one write per minute thereafter, exactly as `requireDevice` does.
 */
export async function authenticateAgent(
  tx: Transaction,
  token: string,
): Promise<{ agentId: string }> {
  // Split on the FIRST `.` only: the id is a uuid (no dots) and a base64url secret has none either,
  // but splitting on the first separator keeps a secret that somehow carried one intact rather than
  // truncated. `dot <= 0` rejects both a missing separator (indexOf → -1) and an empty selector (dot at
  // index 0); `dot === token.length - 1` rejects an empty secret. Either malformed shape is unauthorized.
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("agent.unauthorized", {});
  const agentId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  // Screen the selector's SHAPE before the DB: a non-uuid id looked up against the `uuid` column would
  // raise 22P02 → an opaque 500, so a forged bearer stays a clean `agent.unauthorized` (see `UUID_RE`).
  if (!UUID_RE.test(agentId)) throw new AppError("agent.unauthorized", {});

  const [row] = await tx
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    // `active = true` is the revocation filter: a revoked agent is simply not found. All bind as
    // parameters, never string-concatenated.
    .where(and(eq(printAgents.id, agentId), eq(printAgents.active, true)));
  if (row === undefined) throw new AppError("agent.unauthorized", {});
  // Constant-time scrypt check (REUSED, never home-rolled): the secret is never compared with `===`.
  if (!verifySecret(secret, row.tokenHash)) throw new AppError("agent.unauthorized", {});

  // Record the sighting, SKIPPING the write when `last_seen_at` is already within the last
  // SIGHTING_INTERVAL_MS (the gate stays in the WHERE clause, so it still costs no JS branch and no
  // extra read). Both values bind — nothing is concatenated.
  //
  // `last_seen_at` is a text column, so `<` on it is a STRING comparison, and that is a correct
  // time ordering only for the one spelling every writer of these columns uses: `toISOString()`,
  // which is what `nowIso` returns and what `print_agents.enrolled_at` takes its own default from.
  // The clock read once, so the stamp and the cutoff are the same moment. This is the same shape
  // `apps/server/src/alert-sources.ts` already reads `last_seen_at` with.
  const seenAt = nowIso();
  const staleBefore = new Date(Date.parse(seenAt) - SIGHTING_INTERVAL_MS).toISOString();
  await tx
    .update(printAgents)
    .set({ lastSeenAt: seenAt })
    .where(
      and(
        eq(printAgents.id, agentId),
        // A never-seen agent has NULL here, and `<` is UNKNOWN for NULL, so the first sighting needs
        // its own alternative or it would never be written.
        or(isNull(printAgents.lastSeenAt), lt(printAgents.lastSeenAt, staleBefore)),
      ),
    );
  return { agentId };
}
