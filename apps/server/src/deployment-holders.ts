import {
  readDeploymentMode,
  readSingletonRole,
  type Database,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";

/**
 * The two orthogonal `deployment` axes the running process gates on, each in a one-field cell read live
 * per request / per pass so a promotion is a genuine flag-flip with no restart (promotion runbook design
 * §3b). `mode` fronts the read-only gate + ambient viewer; `singletonRole` gates the fiscal drain/reconcile
 * pass (see `singletonPass`). Held together so the promote action refreshes both in one call.
 */
export interface DeploymentHolders {
  readonly mode: { current: DeploymentMode };
  readonly singletonRole: { current: SingletonRole };
}

/** Builds the holders from values already read at boot — no I/O. */
export function createDeploymentHolders(
  mode: DeploymentMode,
  singletonRole: SingletonRole,
): DeploymentHolders {
  return { mode: { current: mode }, singletonRole: { current: singletonRole } };
}

/**
 * Re-reads both axes from the database into the holders. The read runs on the app pool (`app_user` holds
 * SELECT on `deployment`, migration 0010); the promote action calls this AFTER its owner-role write so the
 * running gates and the fiscal pass observe the new state on their next tick (promotion runbook design §3b).
 */
export async function refreshDeploymentHolders(
  db: Database,
  holders: DeploymentHolders,
): Promise<void> {
  holders.mode.current = await readDeploymentMode(db);
  holders.singletonRole.current = await readSingletonRole(db);
}
