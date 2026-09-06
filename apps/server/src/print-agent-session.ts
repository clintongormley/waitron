// Side-effect only: keeps this host's errors.ts augmentation loaded alongside the file. This module
// throws exactly one code — `agent.unauthorized` — which is declared in @waitron/printing's own
// errors.ts and reaches here through the VALUE import of `authenticateAgent` below (that package's
// barrel does `import "./errors.js"`), so no apps/server code is thrown here; the import is kept for
// symmetry with the sibling session guards (device-session.ts) and is harmless.
import "./errors.js";
import type { Context } from "hono";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authenticateAgent } from "@waitron/printing";

/**
 * The deployment holds one tenant per database. Everything `requireAgent` needs: the app pool and
 * this venue's tenant, exactly the subset the other gated surfaces take. No cookie/session config
 * — a print agent authenticates with a BEARER token (the sync-api machine-to-machine shape),
 * never a browser cookie.
 */
export interface PrintAgentSessionDeps {
  db: Database;
  cfg: { tenantId: string };
}

/**
 * The Bearer guard for the print-agent API (design §3a, Controller Ruling 5). Lives in apps/server
 * (not @waitron/printing) because it is the HTTP seam: it extracts `Authorization: Bearer <token>`
 * from the Hono `Context` — the `sync-api.ts:101-108` parse shape, NOT a cookie — and hands the plain
 * token string to `@waitron/printing`'s `authenticateAgent` CORE, which owns the token split, the
 * scrypt `verifySecret`, the `active = true` revocation filter and the `last_seen_at` sighting write.
 *
 * A missing or malformed Authorization header short-circuits to `agent.unauthorized` (→ 401)
 * BEFORE any DB work — the empty-secret fail-closed the sync guard also takes — so a blank Bearer
 * never reaches `authenticateAgent`. Every other failure (an unknown selector, a REVOKED agent, a
 * secret that does not verify) folds into the SAME `agent.unauthorized` inside the core, so a
 * revoked agent fails INSTANTLY (its row is simply not found) with no oracle. The token
 * verification and the sighting write run under `withTenant` + `asAppUser`, and
 * `authenticateAgent` explicitly filters the token lookup by tenant id.
 */
export async function requireAgent(
  deps: PrintAgentSessionDeps,
  c: Context,
): Promise<{ agentId: string }> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Fail closed on a blank/absent Bearer before touching the DB — an empty token can never verify, so
  // there is nothing to gain from letting it reach `authenticateAgent`, and this keeps a header flood
  // off the connection pool (the same posture the enrol rate-limit takes for the sale path).
  if (token.length === 0) throw new AppError("agent.unauthorized", {});
  return withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return authenticateAgent(tx, { tenantId: deps.cfg.tenantId }, token);
  });
}
