import "./errors.js"; // register promotion.* on the shared registry (reachability convention)
import { AppError } from "@waitron/shared";
import { setSingletonRole, type Database } from "@waitron/db";
import { refreshDeploymentHolders, type DeploymentHolders } from "./deployment-holders.js";
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
  /** The app pool — used only for the holder-refresh READ (`app_user` holds SELECT on `deployment`). */
  readonly appDb: Database;
  /** The owner/provisioning pool — the `singleton_role` write is owner-role (`app_user` has no UPDATE). */
  readonly ownerDb: Database;
  readonly holders: DeploymentHolders;
  readonly log: Logger;
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
 * slice). The single write — `setSingletonRole('primary')` — is the point-of-no-return (§7): it makes this
 * node the AEAT submitter. The subsequent holder refresh flips the running fiscal pass from the empty pass
 * to the real drain on its next tick, with no restart (§3b/§3c).
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

  await setSingletonRole(deps.ownerDb, "primary"); // PONR: claims the submitter (§7)
  // Flip the running pass on its next tick. If THIS read throws after the write above committed (a transient
  // app-pool blip), the caller sees an error while the process keeps the stale 'secondary' holder — so it
  // won't drain yet. Self-healing (§3e): a re-run (its refresh #1 + the already-primary path re-syncs the
  // holder) or a restart starts the drain, and fiscal submission is a delay-tolerant outbox.
  await refreshDeploymentHolders(deps.appDb, deps.holders);

  deps.log("info", "promotion.completed", { target: "local_secondary" });
  return { alreadyPrimary: false };
}
