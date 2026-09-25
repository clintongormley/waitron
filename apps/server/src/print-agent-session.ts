// No apps/server code is thrown here (`agent.unauthorized` is @waitron/printing's); kept for symmetry
// with the sibling session guards.
import "./errors.js";
import type { Context } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database } from "@waitron/db";
import { authenticateAgent } from "@waitron/printing";

export interface PrintAgentSessionDeps {
  db: Database;
}

/**
 * The Bearer guard for the print-agent API. Every failure — no token, an unknown selector, a revoked
 * agent, a secret that does not verify — is the same `agent.unauthorized`, so none is an oracle.
 */
export async function requireAgent(
  deps: PrintAgentSessionDeps,
  c: Context,
): Promise<{ agentId: string }> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (token.length === 0) throw new AppError("agent.unauthorized", {});
  return withTransaction(deps.db, async (tx) => {
    return authenticateAgent(tx, token);
  });
}
