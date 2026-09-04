// A bare side-effect import, not a value used anywhere in this file. It is what makes
// TypeScript treat "@waitron/shared" as a real module to augment rather than defining a fresh
// ambient module of the same name — the same idiom used to add fields to Express's `Request`.
import "@waitron/shared";

/**
 * packages/db's own contribution to the shared error registry, added by declaration merging
 * rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/db adds one without packages/shared knowing about it in advance.
 *
 * Namespace convention: the prefix names the DOMAIN CONCEPT the code describes, never the
 * package whose source happens to contain the `throw new AppError(...)` call — see the design
 * note atop packages/shared/src/errors.ts for the full reasoning (spec §9: a code is a
 * translation key, and "which package's source threw this" is an implementation detail that
 * must not leak into it). `allocateInvoiceNumber` (./allocate-number.ts) throws this one for
 * "there is no such series" — a fact about a series, not about packages/db — so it is
 * `series.not_found`, not `db.series_not_found` and not `core.series_not_found`, regardless of
 * which package's source happens to contain the throw today or after some later refactor.
 *
 * This code has been renamed twice, and both renames were clean rather than deprecate-and-add,
 * for the same reason each time: the "codes are never renamed" rule (see
 * packages/shared/src/errors.ts) protects a code that might already be written into an incident
 * record or a dashboard, and this one never was.
 *
 *   1. `SERIES_NOT_FOUND` (Task 6's pre-Task-9 stand-in `@waitron/shared`) → `db.series_not_found`
 *      (Task 9, throwing-package convention — since overruled).
 *   2. `db.series_not_found` → `series.not_found` (this fix round, domain-concept convention).
 *
 * Neither name was ever logged, persisted, or had a consumer outside this workspace's own test
 * suite, and every call site (allocate-number.ts and allocate-number.test.ts) is renamed in the
 * same commit each time. A deprecated-but-dead alias sitting in the registry forever would be
 * pure clutter protecting nothing.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    "series.not_found": { seriesId: string };
    /**
     * A node has no `purpose='standard'` invoice series. Reached by R3b's mirror→primary promote when
     * correcting `config.till.seriesId` to the cloud's OWN reserved standard series (the code the primary
     * derived at adopt, `<primaryCode>-<numeroInstalacion>`). A promoted cloud always has one (R2
     * established it), so this is a corruption/misuse refusal, structured so it reaches a screen
     * translatable rather than a raw empty-result crash — the shape `sif.not_registered` follows.
     * `series.*` names the domain concept; never renamed once shipped.
     */
    "series.no_standard_for_node": { tenantId: string; nodeId: string };
    /**
     * A database already belongs to a different environment. Never overwritten: the rows written
     * under the first stamp cannot be moved to the second — an invoice series that filed to
     * pre-production has a numbering hole in production that nothing can fill.
     */
    "deployment.already_stamped": { stamped: string; requested: string };
    /**
     * `setDeploymentMode` found no `deployment` singleton row to update — the database was never
     * stamped (`stampDeployment` must run first). Fails loud rather than a silent 0-row no-op, because
     * this is a promotion primitive: a mis-sequenced provision/promote that "succeeded" while leaving
     * the database in the wrong mode is exactly the kind of silent state a mirror must never reach.
     */
    "deployment.not_stamped": Record<string, never>;
  }
}
