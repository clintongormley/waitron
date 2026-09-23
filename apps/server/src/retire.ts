import "./errors.js"; // register node.retire_* on the shared registry (reachability convention)
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
  /** The venue handle — `node_membership` read/write and the identity-key read. The name records
   * which PATH this write belongs on, not a privilege: there is one handle and no roles here, and
   * what keeps a write of a protected table in a named file is `scripts/write-path-tables.test.ts`.
   * `evicted` flips no deployment axis, so unlike the promote paths this action touches nothing on
   * the owner path. */
  readonly appDb: Database;
  /** The box key ring — unseals this node's identity private key to sign the minted document. */
  readonly ring: KeyRing;
  /** THIS (departing) node — the node that becomes `evicted`, and the document's `signerNodeId`. */
  readonly nodeId: string;
  readonly log: Logger;
}

export interface RetireResult {
  /** True iff this call minted+persisted a new `evicted` document; false iff already evicted (an
   * idempotent no-op). */
  readonly evicted: boolean;
  /** The term now held — the minted term, or the already-held evicted term. */
  readonly term: number;
}

/**
 * A fenced (`sell-only`) node SELF-EVICTS (retire/evict R3; decommission design §3, §6): it mints a
 * `sell-only → evicted` membership document signed with its OWN identity key and persists it
 * term-guarded. No HTTP and nothing on the owner path — `evicted` flips no deployment axis.
 *
 * ABORT-BEFORE-WRITE (promote's discipline): every gate throws BEFORE any write, and the document is
 * built and signed in memory BEFORE the persist, so a refusal or a signing failure leaves the node
 * exactly as it was. The ordered guards are idempotent-evicted → not_fenced → no_carrier → mint →
 * persist. The gate ORDER is what keeps decommission design fact (ii)'s states distinct — an
 * already-evicted no-op, a serving/absent node (`not_fenced`) and a fenced node with no surviving
 * primary to carry the venue forward (`no_carrier`) are distinct outcomes, checked in that order. The
 * departing node signs with its OWN directly-trusted key
 * (`endorsements: []`) — its key is in every former peer's trust set from setup/adopt, so an
 * endorsement chain is unnecessary, exactly as R1's local promote does. Idempotent: an already-evicted
 * node returns before the carrier gate or the mint, so a re-run never bumps the term.
 */
export async function retireSelf(deps: RetireDeps): Promise<RetireResult> {
  // 1-2. Read the freshest held chart and this node's standing in it — a concurrent adopt, or a prior
  // completed retire, is reflected here, which is what makes the flow idempotent on re-run.
  const held = await readNodeMembership(deps.appDb);
  const selfStanding = held === null ? undefined : standingOf(held, deps.nodeId);

  // 3. Idempotent no-op: this node has already left. Return the held evicted term without a re-mint,
  // and WITHOUT consulting the carrier gate (there is nothing left to hand over).
  if (selfStanding === "evicted") {
    return { evicted: false, term: held!.body.term };
  }

  // 4. Not fenced: after step 3 this means serving-primary/serving-secondary, absent from the chart,
  // or no held document at all — none is retirable. Only a fenced (`sell-only`) node leaves for good.
  if (!isFencedStanding(selfStanding)) {
    throw new AppError("node.retire_not_fenced", {});
  }

  // 5. No carrier: fenced, but the held chart names no serving primary to carry the venue forward, so
  // there is nothing for this node to hand over to. Refuse fail-safe rather than evict the last node
  // that knows the venue (fiscal-unrecoverable, CLAUDE.md §5). `held!` is non-null here (steps 3-4
  // return/throw on a null held).
  if (servingPrimaryNodeId(held!) === undefined) {
    throw new AppError("node.retire_no_carrier", {});
  }

  // 6. Mint the eviction BEFORE any write (abort-before-write): read this node's signing key and
  // build+sign the `sell-only → evicted` document in memory, so a signing failure aborts with no
  // effect. `held` is non-null here (steps 3-4 return/throw on a null held), so `held!` is safe.
  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      heldDocument: held,
      nodes: evictNode(held!.body.nodes, deps.nodeId),
      signerNodeId: deps.nodeId,
      endorsements: [],
    },
  );

  // 7. Persist term-guarded: refuse to regress the org chart under a concurrent gossip-adopt race.
  await persistEvictionOrThrow(deps.appDb, document);

  deps.log("info", "retire.completed", { nodeId: deps.nodeId, term: document.body.term });
  return { evicted: true, term: document.body.term };
}

/**
 * The term-guarded persist tail, extracted so the superseded branch is deterministically testable
 * (mirroring promote's `commitMirrorPromotionTx`): a real race has no seam between the held read and
 * the write on one connection, so the guard is exercised by handing a STALE document to a
 * higher-term DB directly. Writes through `persistNodeMembershipIfNewer` (the runtime term-guarded
 * accessor); a `false` return means a concurrent ≥ term already landed, so the eviction was NOT
 * applied and this throws `node.retire_superseded` with the held term for diagnosis (the `?? -1`
 * mirrors promote — the row can only be absent under a concurrent delete, which the app never issues).
 */
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
