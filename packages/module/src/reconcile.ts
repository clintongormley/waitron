/** DESIRED (the enabled set) against ACTUAL (the migrated modules); each module is in one class. */
export interface Reconciliation {
  /** enabled but not yet migrated. */
  readonly toMigrate: readonly string[];
  /** enabled and already migrated. */
  readonly steady: readonly string[];
  /** migrated but no longer enabled: skipped, data kept. */
  readonly softDisabled: readonly string[];
}

/** `enabled` order is preserved in `toMigrate`/`steady`; `softDisabled` is in `migrated` order. */
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
