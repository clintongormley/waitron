// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared" as
// a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/credentials/src/errors.ts and packages/fiscal/src/errors.ts use.
import "@waitron/shared";

/**
 * packages/workforce's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`person.*`), never the package name (see
 * the design note atop packages/shared/src/errors.ts).
 *
 * Namespace choice: `person.*`, NOT `clock.*`. `clock.*` is already taken by packages/fiscal for
 * the trusted clock (`clock.degraded`, `clock.jump_detected` — packages/fiscal/src/errors.ts), and
 * clock-in/out attendance codes will be `attendance.*` (Slice 2) for that reason. These two name
 * the failures of this slice's own primitives — an identity lookup and a PIN verification — and
 * their throw sites arrive with the clock-in path (Slice 2). Registered here now so the type is in
 * place before the first caller, exactly as packages/shared's reachability rule intends.
 *
 * Reachability: index.ts side-effect-imports ./errors.js, so this augmentation is reachable from
 * the package's own public barrel. See ./errors.reachability.test.ts.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** No `persons` row for this id under the current tenant — never provisioned, or hidden by RLS
     * (identical from the caller's side). */
    "person.not_found": { tenantId: string; personId: string };
    /** The supplied PIN did not verify against `persons.pin_hash` (../verify-pin.ts returned
     * false). Carries no PIN and no hash — only the identity that failed. */
    "person.pin_invalid": { tenantId: string; personId: string };
  }
}
