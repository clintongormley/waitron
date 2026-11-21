// No apps/server code is thrown here (`agent.unauthorized` is @waitron/printing's); kept for symmetry
// with the sibling session guards.
import "./errors.js";
import type { Context } from "hono";
import { AppError } from "@waitron/shared";
import { readNodeMembership, type Database } from "@waitron/db";
import { standingOf } from "@waitron/membership";
import { authenticateAgent } from "@waitron/printing";

export interface PrintAgentSessionDeps {
  db: Database;
}

/**
 * The Bearer guard for the print-agent API. Every failure — no token, an unknown selector, a revoked
 * agent, a secret that does not verify, an agent whose box the held chart has removed — is the same
 * `agent.unauthorized`. The chart is read here, rather than the row switched off at removal,
 * because a chart reaches this box by more than one path, and a box listed again needs no repair.
 */
export async function requireAgent(
  deps: PrintAgentSessionDeps,
  c: Context,
): Promise<{ agentId: string }> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (token.length === 0) throw new AppError("agent.unauthorized", {});
  return authenticateAgent(deps.db, token, {
    admits: async (nodeId) => {
      const held = await readNodeMembership(deps.db);
      return held === null || standingOf(held, nodeId) !== "evicted";
    },
  });
}
