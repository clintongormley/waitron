import { eq } from "drizzle-orm";
import type { KeyRing } from "@waitron/credentials";
import {
  readDeploymentEnvironment,
  readNodeMembership,
  tenants,
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
import {
  canonicalize,
  fencedOutNodeIds,
  verifyEndorsement,
  verifyMembershipDocument,
  type CanonicalValue,
} from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { readStoredTrustSet } from "./membership-trust.js";
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
 * The keys this box stores itself, and those the held chart's endorsements vouch for when a stored
 * key signed that chart. An endorsement counts only when an already-trusted key signed it and
 * neither its node nor its endorser is removed in the chart; never the keys venue.db's `nodes` names.
 */
export async function peerKeyOf(deps: {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
}): Promise<(nodeId: string) => string | undefined> {
  const trust = await readStoredTrustSet(deps);
  const keys = new Map(Object.entries(trust));
  const held = await readNodeMembership(deps.db);
  if (held !== null && verifyMembershipDocument(held, trust, held).valid) {
    const removed = fencedOutNodeIds(held);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of held.endorsements) {
        if (keys.has(e.nodeId) || removed.has(e.nodeId) || removed.has(e.endorsedBy)) continue;
        const endorserKey = keys.get(e.endorsedBy);
        if (endorserKey === undefined || !verifyEndorsement(e, endorserKey)) continue;
        keys.set(e.nodeId, e.publicKey);
        changed = true;
      }
    }
  }
  return (nodeId) => keys.get(nodeId);
}

/** The binding for a new operation: the taxpayer, the environment stamp and the held chart. */
export async function currentBinding(
  deps: { db: Database },
  scenario: HandoverScenario,
  sourceNodeId: string,
  destinationNodeId: string,
  operationId: string,
): Promise<HandoverBinding> {
  const [tenant] = await deps.db
    .select({ country: tenants.country, taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, 1));
  const environment = await readDeploymentEnvironment(deps.db);
  if (environment === null) throw new AppError("deployment.not_stamped", {});
  const held = await readNodeMembership(deps.db);
  // A fault in Waitron: a handover is started only on a set-up box that holds a chart.
  if (tenant === undefined || held === null) throw new Error("no taxpayer or held chart to bind");
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
