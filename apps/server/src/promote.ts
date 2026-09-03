import "./errors.js"; // register promotion.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import {
  readNodeMembership,
  setSingletonRoleTx,
  writeNodeMembershipTx,
  type Database,
} from "@waitron/db";
import { nextStandings } from "@waitron/membership";
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
