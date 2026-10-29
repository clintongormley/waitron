import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, locationId as brandLocationId, nodeId } from "@waitron/shared";
import type { LocationId, NodeId } from "@waitron/shared";
import { locations, nodes, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { isUnset } from "./env-value.js";

export interface NodeIdentityConfig {
  nodeId: NodeId;
}
export interface NodeConfig extends NodeIdentityConfig {
  locationId: LocationId;
}

/** Only the variable NAME travels in the error, never the value. */
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new AppError("server.node_config_missing", { key });
  }
  return value;
}

/** The rejected value is deliberately not carried: it may be a secret pasted into the wrong variable. */
function brand<T>(key: string, fn: (value: string) => T, raw: string): T {
  try {
    return fn(raw);
  } catch {
    throw new AppError("server.node_config_invalid", { key });
  }
}

export function loadNodeIdentity(env: NodeJS.ProcessEnv): NodeIdentityConfig {
  return { nodeId: brand("WAITRON_NODE_ID", nodeId, required(env, "WAITRON_NODE_ID")) };
}

export function tryLoadNodeIdentity(env: NodeJS.ProcessEnv): NodeIdentityConfig | undefined {
  return isUnset(env.WAITRON_NODE_ID) ? undefined : loadNodeIdentity(env);
}

export async function readNodeLocation(
  db: Database | Transaction,
  id: NodeId,
): Promise<LocationId | null> {
  const [row] = await db
    .select({ locationId: locations.id })
    .from(nodes)
    .innerJoin(locations, eq(locations.id, nodes.locationId))
    .where(eq(nodes.id, id));
  return row === undefined ? null : brandLocationId(row.locationId);
}

/**
 * The node's stamped filing module, which `fiscalSlot` cross-checks against the enabled fiscal
 * module.
 */
export async function readFilingModule(
  db: Database,
  cfg: NodeIdentityConfig,
): Promise<string | null> {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ filingModule: nodes.filingModule })
      .from(nodes)
      .where(eq(nodes.id, cfg.nodeId));
    /* v8 ignore start */
    if (row === undefined) {
      throw new Error(`readFilingModule: no node ${cfg.nodeId}`);
    }
    /* v8 ignore stop */
    return row.filingModule;
  });
}
