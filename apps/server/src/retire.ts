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
import type { DrainProgress } from "@waitron/sync";
import type { KeyRing } from "@waitron/credentials";
import { mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

export interface RetireDeps {
  /** The app pool — `node_membership` read/write and the identity-key read, all app-role. `app_user`
   * holds SELECT on `node_membership` (0096) and, via `readNodeIdentityKey`, SELECT on
   * `tenant_credentials` (0001_credentials_rls.sql); `evicted` flips no deployment axis, so unlike the
   * promote paths this action needs NO owner pool — `app_user` holds INSERT/UPDATE on `node_membership`
   * (0097), which is all the term-guarded persist requires. */
  readonly appDb: Database;
  /** The box key ring — unseals this node's identity private key to sign the minted document. */
  readonly ring: KeyRing;
  /** This node's tenant — scopes the identity-key read. */
  readonly tenantId: string;
  /** THIS (departing) node — the node that becomes `evicted`, and the document's `signerNodeId`. */
  readonly nodeId: string;
  /**
   * The disposal/drain-progress reader (the same drain the box-status `disposal` surface
   * reports), or `undefined` when the held document names no carrier. `undefined` on a fenced
   * node means "fenced, no carrier" → refuse `node.retire_no_carrier`. The caller (boot/Task 3)
   * wraps `readDrainProgress` on the sync pool under `withTenant`, exactly as box-status's
   * `readDisposal` does; retire never touches that pool itself.
   */
  readonly readDrainProgress: (() => Promise<DrainProgress>) | undefined;
  /** The carrier node id the injected `readDrainProgress` reader keys its cursor lookup on — captured at
   *  BOOT (`servingPrimaryNodeId` of the held doc at boot). retireSelf re-derives the CURRENT carrier
   *  from the fresh held chart and refuses (`node.retire_carrier_changed`) if it differs, because a
   *  fenced node does not restart on a carrier change so the reader would otherwise measure drain against
   *  a stale carrier. `undefined` exactly when `readDrainProgress` is `undefined` (both boot-derived from
   *  the same carrier). */
  readonly carrierNodeId: string | undefined;
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
 * A fenced (`sell-only`) node that has fully drained onto its carrier SELF-EVICTS (retire/evict R3;
 * decommission design §3, §6): it mints a `sell-only → evicted` membership document signed with its
 * OWN identity key and persists it term-guarded. No HTTP, no owner-pool write — `evicted` flips no
 * deployment axis, and `app_user` holds INSERT/UPDATE on `node_membership` (0097).
 *
 * ABORT-BEFORE-WRITE (promote's discipline): every gate throws BEFORE any write, and the document is
 * built and signed in memory BEFORE the persist, so a refusal or a signing failure leaves the node
 * exactly as it was. The ordered guards are idempotent-evicted → not_fenced → no_carrier →
 * carrier_changed → not_drained → mint → persist. The gate ORDER is what keeps decommission design fact
 * (ii)'s states distinct — an already-evicted no-op, a serving/absent node (`not_fenced`), a fenced node
 * with no carrier (`no_carrier`), a fenced node whose carrier CHANGED since boot so its drain reader is
 * stale (`carrier_changed`), and a fenced node still shipping rows (`not_drained`) are distinct
 * outcomes, checked in that order. The departing node signs with its OWN directly-trusted identity key
 * (`endorsements: []`) — its key is in every former peer's trust set from setup/adopt, so an
 * endorsement chain is unnecessary, exactly as R1's local promote does. Idempotent: an already-evicted
 * node returns before consulting the drain guard or minting, so a re-run never bumps the term.
 */
export async function retireSelf(deps: RetireDeps): Promise<RetireResult> {
  // 1-2. Read the freshest held chart and this node's standing in it — a concurrent adopt, or a prior
  // completed retire, is reflected here, which is what makes the flow idempotent on re-run.
  const held = await readNodeMembership(deps.appDb);
  const selfStanding = held === null ? undefined : standingOf(held, deps.nodeId);

  // 3. Idempotent no-op: this node has already left. Return the held evicted term without a re-mint,
  // and WITHOUT consulting the drain guard (there is nothing left to drain).
  if (selfStanding === "evicted") {
    return { evicted: false, term: held!.body.term };
  }

  // 4. Not fenced: after step 3 this means serving-primary/serving-secondary, absent from the chart,
  // or no held document at all — none is retirable. Only a fenced (`sell-only`) node leaves for good.
  if (!isFencedStanding(selfStanding)) {
    throw new AppError("node.retire_not_fenced", {});
  }

  // 5. No carrier: fenced, but no serving-primary is available to carry the tail forward, so the drain
  // cannot be confirmed. Signalled by an `undefined` drain-progress reader OR an `undefined` boot carrier
  // id. Boot derives both from the same condition, so in practice they are undefined together; guarding
  // BOTH here refuses fail-safe on a caller that passes one without the other, and — the point — narrows
  // `deps.carrierNodeId` to a string for step 5b so the carrier-change guard needs no non-null assertion.
  if (deps.readDrainProgress === undefined || deps.carrierNodeId === undefined) {
    throw new AppError("node.retire_no_carrier", {});
  }

  // 5b. Carrier freshness: the injected reader keys on the BOOT carrier; a fenced node does not restart
  // on a carrier change, so confirm the held chart still names that same serving-primary before trusting
  // the drain verdict. A mismatch means the reader would measure against a stale carrier — refuse and let
  // the operator restart the box to re-measure (fiscal-unrecoverable: never evict against a stale
  // survivor). `held!` is non-null here (steps 3-4 return/throw on a null held).
  const currentCarrier = servingPrimaryNodeId(held!);
  if (currentCarrier !== deps.carrierNodeId) {
    throw new AppError("node.retire_carrier_changed", {
      boundCarrierNodeId: deps.carrierNodeId,
      currentCarrierNodeId: currentCarrier ?? null,
    });
  }

  // 6. Not drained: gate on the disposal guard's `drained` BOOLEAN only, never a seq comparison (the
  // MAX/MIN legitimately differ while drained — see RetireDeps.readDrainProgress / readDrainProgress).
  const progress = await deps.readDrainProgress();
  if (!progress.drained) {
    throw new AppError("node.retire_not_drained", {});
  }

  // 7. Mint the eviction BEFORE any write (abort-before-write): read this node's signing key and
  // build+sign the `sell-only → evicted` document in memory, so a signing failure aborts with no
  // effect. `held` is non-null here (steps 3-4 return/throw on a null held), so `held!` is safe.
  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      tenantId: deps.tenantId,
      heldDocument: held,
      nodes: evictNode(held!.body.nodes, deps.nodeId),
      signerNodeId: deps.nodeId,
      endorsements: [],
    },
  );

  // 8. Persist term-guarded: refuse to regress the org chart under a concurrent gossip-adopt race.
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
