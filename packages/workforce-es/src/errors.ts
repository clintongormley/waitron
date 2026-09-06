// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/workforce/src/errors.ts and packages/fiscal/src/errors.ts use.
import "@waitron/shared";

/**
 * packages/workforce-es's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (see the design note atop
 * packages/shared/src/errors.ts), never the package name.
 *
 * Namespace choice: `convenio.*`. This package is EXEMPT from the english-only guard, so a Spanish
 * domain token is consistent with the `fiscal.huella_divergente` / fiscal-verifactu precedent and
 * with the module's own vocabulary. Grepped against the whole registry first: no `convenio`, `shift`,
 * `roster`, `absence`, `swap` or `schedule` prefix existed — `convenio.*` was free. Codes are never
 * renamed once shipped.
 *
 * Reachability: index.ts side-effect-imports ./errors.js, so this augmentation is reachable from the
 * package's own public barrel. See ./errors.reachability.test.ts.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No `convenio_config` row for this (tenant, location) — not configured. The overtime rule and guardrails a work-time summary needs
     * cannot be resolved without one. */
    "convenio.not_found": { tenantId: string; locationId: string };
  }
}
