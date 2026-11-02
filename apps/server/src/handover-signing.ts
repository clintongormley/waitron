import type { KeyRing } from "@waitron/credentials";
import {
  readDeploymentEnvironment,
  readNodeMembership,
  readTenant,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  sha256Hex,
  signEnvelope,
  type HandoverBinding,
  type HandoverKind,
  type HandoverScenario,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { canonicalize, endorsedKeyOf, type CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { readStoredTrustSet, type StoredTrustDeps } from "./membership-trust.js";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

export async function signAsThisBox<B extends CanonicalValue>(
  deps: { node: NodeDatabase; ring: KeyRing; nodeId: string },
  kind: HandoverKind,
  body: B,
): Promise<SignedHandoverEnvelope<B>> {
  const privateKey = await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId);
  return signEnvelope(kind, body, { nodeId: deps.nodeId, privateKey });
}

/**
 * The key this box stores for a node, or one the held chart's endorsements vouch for, by the
 * membership package's rule (`endorsedKeyOf`); never the keys venue.db's `nodes` names.
 */
export async function peerKeyOf(
  deps: StoredTrustDeps & { db: Database },
): Promise<(nodeId: string) => string | undefined> {
  const held = await readNodeMembership(deps.db);
  return endorsedKeyOf(held, await readStoredTrustSet(deps));
}

/** The binding for a new operation: the taxpayer, the environment stamp and the held chart. */
export async function currentBinding(
  deps: { db: Database },
  scenario: HandoverScenario,
  sourceNodeId: string,
  destinationNodeId: string,
  operationId: string,
): Promise<HandoverBinding> {
  const tenant = await readTenant(deps.db);
  const environment = await readDeploymentEnvironment(deps.db);
  if (environment === null) throw new AppError("deployment.not_stamped", {});
  const held = await readNodeMembership(deps.db);
  // A fault in Waitron: a handover is started only on a set-up box that holds a chart.
  if (tenant === null || held === null) throw new Error("no taxpayer or held chart to bind");
  return {
    operationId,
    scenario,
    venue: { country: tenant.country, taxId: tenant.taxId, environment },
    sourceNodeId,
    destinationNodeId,
    membership: {
      term: held.body.term,
      digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)),
    },
  };
}
