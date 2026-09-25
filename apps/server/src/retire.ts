import "./errors.js";
import { AppError } from "@waitron/shared";
import { persistNodeMembershipIfNewer, readNodeMembership, type Database } from "@waitron/db";
import {
  evictNode,
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import { mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

export interface RetireDeps {
  readonly appDb: Database;
  /** Unseals this node's identity private key to sign the minted document. */
  readonly ring: KeyRing;
  /** The departing node: the one that becomes `evicted`, and the document's signer. */
  readonly nodeId: string;
  readonly log: Logger;
}

export interface RetireResult {
  /** False when the node was already evicted and nothing was written. */
  readonly evicted: boolean;
  readonly term: number;
}

/**
 * A fenced (`sell-only`) node evicts itself with a document signed by its own key, persisted
 * term-guarded. Every gate throws before any write and the document is signed in memory before the
 * persist, so a refusal or a signing failure leaves the node exactly as it was.
 */
export async function retireSelf(deps: RetireDeps): Promise<RetireResult> {
  const held = await readNodeMembership(deps.appDb);
  const selfStanding = held === null ? undefined : standingOf(held, deps.nodeId);

  // Already left: no re-mint, so a re-run never bumps the term, and no carrier gate.
  if (selfStanding === "evicted") {
    return { evicted: false, term: held!.body.term };
  }

  if (!isFencedStanding(selfStanding)) {
    throw new AppError("node.retire_not_fenced", {});
  }

  // Never evict the last node that knows the venue (CLAUDE.md §5). `held` is non-null here: a null
  // one has no standing, refused above.
  if (servingPrimaryNodeId(held!) === undefined) {
    throw new AppError("node.retire_no_carrier", {});
  }

  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      heldDocument: held,
      nodes: evictNode(held!.body.nodes, deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  // Term-guarded, so a concurrent adopt is never regressed.
  await persistEvictionOrThrow(deps.appDb, document);

  deps.log("info", "retire.completed", { nodeId: deps.nodeId, term: document.body.term });
  return { evicted: true, term: document.body.term };
}

export async function persistEvictionOrThrow(
  db: Database,
  document: SignedMembershipDocument,
): Promise<void> {
  const accepted = await persistNodeMembershipIfNewer(db, document);
  if (!accepted) {
    const current = await readNodeMembership(db);
    throw new AppError("node.retire_superseded", {
      heldTerm: current?.body.term ?? -1,
      mintedTerm: document.body.term,
    });
  }
}
