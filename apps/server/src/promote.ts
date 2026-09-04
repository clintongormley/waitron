import "./errors.js"; // register promotion.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import {
  persistNodeMembershipIfNewerTx,
  readNodeEndorsement,
  readNodeMembership,
  readStandardSeriesId,
  setDeploymentModeTx,
  setSingletonRoleTx,
  writeNodeMembershipTx,
  type Database,
  type Transaction,
} from "@waitron/db";
import { nextStandings, type SignedMembershipDocument } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import { refreshDeploymentHolders, type DeploymentHolders } from "./deployment-holders.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import type { Logger } from "./logger.js";

/**
 * The operator's attestation that the OLD node is physically neutralised (promotion runbook design §6) —
 * powered off, or demoted to sell-only at the box. A required human input because software cannot verify a
 * partitioned peer; without it, two submitters under one NIF could coexist.
 */
export interface FenceAttestation {
  readonly oldNodeNeutralised: boolean;
}

/** Whether the node already held the singletons — a `true` here means the promote was an idempotent no-op. */
export interface PromotionResult {
  readonly alreadyPrimary: boolean;
}

export interface PromoteDeps {
  /**
   * The app pool — the holder-refresh READ (`app_user` holds SELECT on `deployment`) and the identity
   * reads, all app-role: `readNodeIdentityKey` unseals the signing key under `withTenant` as `app_user`,
   * which holds SELECT on `tenant_credentials` (0001_credentials_rls.sql) — the same role and path
   * `readMirrorToken` uses at mirror boot; `readNodeMembership` reads the held org chart via `app_user`'s
   * SELECT on `node_membership` (0097).
   */
  readonly appDb: Database;
  /**
   * The owner/provisioning pool. The `singleton_role` flip is owner-role — `app_user` holds no UPDATE on
   * `deployment` — so the membership-document write shares its ONE transaction (CLAUDE.md §3: the flip and
   * the new document commit together, or neither does). That shared transaction is why the write runs here,
   * NOT a privilege gap: `app_user` DOES hold INSERT/UPDATE on `node_membership` (migration 0097), but the
   * plain-upsert accessor (`writeNodeMembership`/`writeNodeMembershipTx`) is reserved for the owner/promote
   * paths by convention (the runtime adoption path uses the term-guarded `persistNodeMembershipIfNewer` —
   * see `node-membership.ts`).
   */
  readonly ownerDb: Database;
  readonly holders: DeploymentHolders;
  readonly log: Logger;
  /** The box key ring — unseals this node's identity private key to sign the minted document. */
  readonly ring: KeyRing;
  /** This node's tenant — scopes the identity-key read and the trust set. */
  readonly tenantId: string;
  /** This node's id — the new document's `signerNodeId` and the node that becomes serving-primary. */
  readonly nodeId: string;
}

/**
 * Refuses to proceed without a fence attestation (promotion runbook design §6). A plain throw BEFORE any
 * state change, so a refused promote leaves the node exactly as it was (abort before the point-of-no-return,
 * §7). Extracted so the guard can be proven by deletion (CLAUDE.md §4).
 */
export function assertFenced(attestation: FenceAttestation): void {
  if (attestation.oldNodeNeutralised !== true) {
    throw new AppError("promotion.fence_not_attested", {});
  }
}

/**
 * Local secondary → primary (promotion runbook design §5a). The node already sells (`mode='primary'`); this
 * claims the singleton duties only. Idempotent and checkpointed (§3e): a fence refusal aborts with no
 * effect; an already-primary node is a no-op; a mirror is refused (it needs the SIF-mint path, §5b, a later
 * slice). The point-of-no-return (§7) is one owner transaction that flips `singleton_role` to primary AND
 * writes the freshly-minted membership document together (CLAUDE.md §3) — making this node the AEAT
 * submitter and recording the new org chart atomically, so a crash cannot leave a primary with no
 * document. The document is built and signed BEFORE that transaction, so a signing failure aborts with no
 * effect. The subsequent holder refresh flips the running fiscal pass from the empty pass to the real
 * drain on its next tick, with no restart (§3b/§3c).
 */
export async function promoteLocalSecondaryToPrimary(
  deps: PromoteDeps,
  attestation: FenceAttestation,
): Promise<PromotionResult> {
  assertFenced(attestation); // before PONR: abortable, zero lasting effect

  // Read the freshest state before deciding — a concurrent write, or a prior half-completed promote, is
  // reflected here, which is what makes the flow idempotent on re-run (§3e).
  await refreshDeploymentHolders(deps.appDb, deps.holders);

  if (deps.holders.mode.current === "mirror") {
    // A mirror cannot become the submitter by a bare role flip; refuse with a clean code before the write
    // (the (mirror, primary) CHECK is the backstop, not the primary guard).
    throw new AppError("promotion.not_a_local_secondary", { mode: deps.holders.mode.current });
  }
  if (deps.holders.singletonRole.current === "primary") {
    return { alreadyPrimary: true }; // already the singleton holder — idempotent no-op
  }

  // Build the next membership document BEFORE the point-of-no-return: read the held org chart, flip
  // standings (this node -> serving-primary, the outgoing primary -> sell-only), then read this node's
  // signing key and sign — all reads plus the in-memory sign, no write yet, so a failure here aborts
  // with no effect. R1 signs with this node's OWN directly-trusted identity key (`endorsements: []`); the
  // endorsement chain is an R2/R3 concern. The held read and the key read run sequentially rather than in
  // parallel: `mintNextMembershipDocument` (the design-named shared helper, §6 R1 item 2) owns the key
  // read, and the node list it needs is derived from the held document, so the shared helper wins over
  // saving one round trip on this rare failover path.
  const held = await readNodeMembership(deps.appDb);
  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      tenantId: deps.tenantId,
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
    },
  );

  // PONR: the role flip and the new document commit together in ONE owner transaction (CLAUDE.md §3), so
  // a crash between the two writes cannot leave a primary with no document. Both writes are owner-role.
  await deps.ownerDb.transaction(async (tx) => {
    await setSingletonRoleTx(tx, "primary"); // claims the submitter (§7)
    await writeNodeMembershipTx(tx, document);
  });

  // Flip the running pass on its next tick. If THIS read throws after the transaction above committed (a
  // transient app-pool blip), the caller sees an error while the process keeps the stale 'secondary'
  // holder — so it won't drain yet. Self-healing (§3e): a re-run (its refresh #1 + the already-primary
  // path re-syncs the holder) or a restart starts the drain, and fiscal submission is a delay-tolerant
  // outbox. A re-run is a no-op on the document too — the already-primary early return above fires before
  // any re-mint, so the term is never bumped twice.
  await refreshDeploymentHolders(deps.appDb, deps.holders);

  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
}

export interface MirrorPromotionResult extends PromotionResult {
  /** The cloud's OWN reserved standard series id the promote persisted into trading.env, so the promoted
   * primary numbers under its disjoint series, not the primary's (spec §4.3). Returned so the caller can
   * assert on it / decide whether to restart. */
  readonly seriesId: string;
}

export interface MirrorPromoteDeps extends PromoteDeps {
  /**
   * Persist the corrected `trading.env` (its `seriesId` = the cloud's OWN reserved standard series) so the
   * NEXT boot comes up primary numbering under the right series. Injected (the boot supplies
   * `writeTradingEnv`) so this DB-centric module stays out of the filesystem/process transition.
   *
   * Called BEFORE the point-of-no-return (owner decision, 2026-09-04): a corrected `seriesId` is INERT on a
   * still-read-only mirror (the read-only gate rejects every non-GET, so `config.till.seriesId` is never
   * used to allocate), so persisting it early is SAFE even if the promote later aborts — the file it leaves
   * is durable but never consulted while the box stays a mirror. It closes the PROCESS-crash window a
   * persist-AFTER-PONR leaves: the env write is issued (atomic rename, `fs-atomic.ts`) before the PONR
   * commits, so a process crash between them reboots the box either still a mirror or `mode=primary` on the
   * CORRECT series — never `mode=primary` on the primary's series with no mirror-promote path left to
   * self-heal it. It does NOT close the narrower POWER-LOSS window: `writeFileAtomic` does not fsync
   * (`fs-atomic.ts` — atomic visibility, no durability across power loss), while the PONR is a durable
   * Postgres commit, so a power cut can leave the rename unflushed behind a durable commit. That residual is
   * benign in R3b (nothing sells against a promoted cloud until the deferred till-reroute slice) and is the
   * carry-in for closing it (fsync the env write, or resolve the series at boot). Ordering the persist
   * before the flip is a correctness invariant, so it lives here rather than in the caller.
   */
  readonly persistTradingEnv: (seriesId: string) => Promise<void>;
}

/**
 * The point-of-no-return body of a mirror→primary promote, extracted so the term-guard can be proven
 * as a unit (parent spec §8 "R3 sharp edge"; CLAUDE.md §4). Runs in ONE owner transaction, in an order
 * that respects `deployment_role_valid_ck`: flip `mode → primary` FIRST (leaving `singleton_role`, so
 * the transient pair is the valid `(primary, secondary)`, never the forbidden `(mirror, primary)`), then
 * `singleton_role → primary`, then the TERM-GUARDED document write. A `false` from the guard means a
 * concurrent gossip-adopt already landed a >= term, so writing would REGRESS the org chart — the whole
 * transaction is aborted (`promotion.membership_superseded`) and the mode/singleton flip does not commit
 * against a superseded chart.
 *
 * The diagnostic held-term read runs `readNodeMembership` on `tx`, NOT a separate app handle: under
 * READ COMMITTED the row holds the raced-in committed term either way (our no-op upsert already saw it).
 * Reading it on the app handle instead was measured to hang the suite to the vitest timeout, because on
 * PGlite the app handle and this owner transaction share ONE backend connection, so the app read blocks
 * behind this still-open transaction; on `tx` it does not, and the value read is identical on real
 * Postgres. (`readNodeMembership` accepts a `Database | Transaction` for exactly this — the value is only
 * for the error message; the throw is what rolls the transaction back regardless.)
 */
export async function commitMirrorPromotionTx(
  tx: Transaction,
  document: SignedMembershipDocument,
): Promise<void> {
  await setDeploymentModeTx(tx, "primary"); // (primary, secondary) — valid transient pair
  await setSingletonRoleTx(tx, "primary"); // (primary, primary)
  const accepted = await persistNodeMembershipIfNewerTx(tx, document);
  if (!accepted) {
    const current = await readNodeMembership(tx);
    throw new AppError("promotion.membership_superseded", {
      heldTerm: current?.body.term ?? -1,
      mintedTerm: document.body.term,
    });
  }
}

/**
 * Mirror → primary (parent SIF spec §5b; R3 design §4). A read-only mirror becomes the venue's primary
 * on the identity it already holds (R3a gave it its own nodeId; R2 reserved its SIF + disjoint series +
 * sealed key + the primary's endorsement). No identity ceremony, no SIF re-mint: `currentSif` returns
 * the reserved SIF once the box reboots `mode=primary`.
 *
 * ABORT-BEFORE-PONR (parent spec §7): the fence check, the held/endorsement/series reads, the in-memory
 * mint AND the `trading.env` correction (`persistTradingEnv`, inert on a still-read-only mirror) all run
 * BEFORE the one owner transaction, so any failure there leaves the mirror exactly as it was. The PONR is
 * ONE owner transaction (`commitMirrorPromotionTx`) — `mode → primary`, `singleton_role → primary`, then
 * the TERM-GUARDED document write; if that write is refused (a concurrent gossip-adopt landed a >= term),
 * the whole transaction aborts with `promotion.membership_superseded` and the flip does not commit against
 * a superseded chart (spec §8 "R3 sharp edge"). Idempotent: an already-primary node returns
 * `{ alreadyPrimary: true }` before any mint or persist. Because the env write is issued before the flip,
 * a PROCESS crash between them can never leave the box primary on the primary's series (only still-mirror,
 * or primary on the correct series); the narrower power-loss window is a documented residual, benign until
 * till-reroute (see `MirrorPromoteDeps.persistTradingEnv`). The caller only restarts on
 * `{ alreadyPrimary: false }` — the mirror is not selling, so a restart costs nothing (contrast the LIVE
 * local-secondary promote).
 */
export async function promoteMirrorToPrimary(
  deps: MirrorPromoteDeps,
  attestation: FenceAttestation,
): Promise<MirrorPromotionResult> {
  assertFenced(attestation); // before PONR: abortable, zero lasting effect

  await refreshDeploymentHolders(deps.appDb, deps.holders);
  // Read the corrected series id up front — it is also the value an already-primary re-run returns.
  const seriesId = await readStandardSeriesId(deps.appDb, deps.tenantId, deps.nodeId);

  if (deps.holders.mode.current === "primary") {
    // Already promoted — idempotent no-op. trading.env was already corrected before this box's own PONR,
    // so there is nothing to re-persist here.
    return { alreadyPrimary: true, seriesId };
  }

  // Build the endorsed document BEFORE the PONR: read the held org chart, flip standings (this node →
  // serving-primary, outgoing primary → sell-only), read the primary's endorsement of this node's key,
  // and sign with this node's OWN key. R3b attaches the endorsement so a peer trusting only the primary
  // transitively trusts this document (parent wire-protocol §4) — the first production doc signed by a
  // non-setup key.
  const held = await readNodeMembership(deps.appDb);
  const endorsement = await readNodeEndorsement(deps.appDb, deps.tenantId, deps.nodeId);
  const document = await mintNextMembershipDocument(
    { db: deps.appDb, ring: deps.ring },
    {
      tenantId: deps.tenantId,
      heldDocument: held,
      nodes: nextStandings(held?.body.nodes ?? [], deps.nodeId),
      signerNodeId: deps.nodeId,
      endorsements: endorsement === null ? [] : [endorsement],
    },
  );

  // Persist the corrected trading.env BEFORE the point-of-no-return (owner decision, 2026-09-04). A
  // corrected series is inert on a still-read-only mirror, so this is safe even if the promote aborts, and
  // issuing the env write before the flip closes the PROCESS-crash window a persist-after-PONR would leave
  // (the power-loss window is a documented residual — writeFileAtomic does not fsync). See
  // `MirrorPromoteDeps.persistTradingEnv`.
  await deps.persistTradingEnv(seriesId);

  // PONR: mode + singleton + term-guarded doc in ONE owner transaction (CLAUDE.md §3).
  await deps.ownerDb.transaction((tx) => commitMirrorPromotionTx(tx, document));

  await refreshDeploymentHolders(deps.appDb, deps.holders);
  deps.log("info", "promotion.completed", { target: "mirror" });
  return { alreadyPrimary: false, seriesId };
}
