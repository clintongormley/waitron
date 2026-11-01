import { establishNodeSigningKey, readNodeSigningKey, type KeyRing } from "@waitron/credentials";
import type { Database, NodeDatabase } from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";

export const NODE_KEY_PURPOSE = "membership.node_key";

/**
 * The handle is named `ownerDb` because `nodes` is one of the tables
 * `scripts/write-path-tables.json` lists, which request code may read and never write; nothing in
 * the engine enforces that.
 */
export interface EstablishIdentityDeps {
  ownerDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
}

/** Give the node its Ed25519 identity, as {@link establishNodeSigningKey} does. */
export function establishNodeIdentity(deps: EstablishIdentityDeps, nodeId: string): Promise<void> {
  return establishNodeSigningKey(deps.ownerDb, deps.node, deps.ring, nodeId);
}

/** Unseal the node's identity private key (base64 PKCS8). */
export async function readNodeIdentityKey(
  node: NodeDatabase,
  ring: KeyRing,
  nodeId: string,
): Promise<string> {
  let privateKey: string | null;
  try {
    privateKey = await readNodeSigningKey(node, ring, nodeId);
  } catch (error) {
    if (isAppError(error) && error.code === "credentials.malformed_payload")
      throw new AppError("server.credential_unusable", {
        purpose: NODE_KEY_PURPOSE,
        field: "privateKey",
      });
    throw error;
  }
  if (privateKey === null) throw new AppError("credentials.missing", { purpose: NODE_KEY_PURPOSE });
  return privateKey;
}
