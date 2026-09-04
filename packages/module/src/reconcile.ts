/**
 * The outcome of comparing DESIRED (the modules.json enabled set) against ACTUAL (the modules whose
 * schema the database has already migrated, derived from appliedSchemaVersion — spec §3). Every
 * module lands in exactly one class.
 */
export interface Reconciliation {
  /** enabled but not yet migrated → migrate (and, when provisioned, seed). */
  readonly toMigrate: readonly string[];
  /** enabled and already migrated → nothing (an idempotent re-run is a no-op). */
  readonly steady: readonly string[];
  /** migrated but no longer enabled → soft-disable: skip, data kept (spec §5). */
  readonly softDisabled: readonly string[];
}

/**
 * Pure set arithmetic. `enabled` order is preserved in `toMigrate`/`steady`; `softDisabled` is in
 * `migrated` iteration order. No DB access here — the caller derives `migrated` from
 * appliedSchemaVersion and runs this OUTSIDE any transaction (spec §3: that probe's 42P01 catch
 * would poison one).
 */
export function reconcile(
  enabled: readonly string[],
  migrated: ReadonlySet<string>,
): Reconciliation {
  const enabledSet = new Set(enabled);
  return {
    toMigrate: enabled.filter((m) => !migrated.has(m)),
    steady: enabled.filter((m) => migrated.has(m)),
    softDisabled: [...migrated].filter((m) => !enabledSet.has(m)),
  };
}
