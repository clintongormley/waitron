// A bare side-effect import, not a value used anywhere in this file. It is what makes TypeScript
// treat "@waitron/shared" as a real module to augment rather than defining a fresh ambient module
// of the same name — the same idiom packages/db/src/errors.ts and packages/fiscal/src/errors.ts
// already use for their own contributions.
import "@waitron/shared";

/**
 * packages/fiscal-verifactu's own contribution to the shared error registry, added by declaration
 * merging rather than pre-declared in packages/shared itself — see the design note atop
 * packages/shared/src/errors.ts. packages/shared is the leaf every package depends on and must
 * never need to change just because a dependent package adds a code; this file is how
 * packages/fiscal-verifactu adds its own without packages/shared knowing about it in advance.
 *
 * **Deviation from Task 13's brief.** The brief's Step 3 said to append `SIF_NOT_REGISTERED`
 * (SCREAMING_SNAKE_CASE) directly to packages/shared/src/errors.ts's `ErrorCode` union. Both parts
 * of that instruction are wrong under this repo's OWN documented conventions and were overridden
 * per the task's own governing context, not invented here:
 *
 *   - packages/shared/src/errors.ts's design note is explicit that only codes NATIVE to
 *     packages/shared itself (ids.ts, money.ts) belong in that file; every dependent package
 *     (packages/db, packages/fiscal, and now packages/fiscal-verifactu) contributes its own by
 *     `declare module "@waitron/shared"`, exactly as packages/db/src/errors.ts and
 *     packages/fiscal/src/errors.ts already do.
 *   - The naming convention is DOMAIN-CONCEPT, lowercase, dot-namespaced (`series.not_found`,
 *     `clock.degraded`, `fiscal.till_not_registered`) — never SCREAMING_SNAKE_CASE and never the
 *     name of the package whose source throws it.
 *
 * Namespace choice: `sif.*`, not `till.not_registered` and not a reuse of packages/fiscal's own
 * `fiscal.till_not_registered`. Those are DIFFERENT facts. `fiscal.till_not_registered`
 * (packages/fiscal/src/errors.ts) is the regime-neutral `FiscalBackend`'s own bookkeeping — no
 * `registerTill` call on record with the generic backend, whatever the regime. This code is about
 * a narrower and later fact: a till that IS known to some backend but has no *live* Veri*Factu SIF
 * identity — a NIF + IdSIF + NúmeroInstalación triple — registered against the upstream node. A
 * till can only reach `currentSif`/`esPrimerRegistro` after a generic `FiscalBackend.registerTill`
 * already succeeded, so collapsing the two into one code would erase which layer refused. `sif.*`
 * names the concept this package's own vocabulary already uses throughout (`registro_sif`,
 * `esPrimerRegistro`) and reads naturally as a translation key: "no SIF is registered [for this
 * till]".
 *
 * Reachability: this file is a side-effect import of ./registro-sif.ts (`import "./errors.js"`),
 * which is re-exported from ./index.ts, so this augmentation is transitively reachable from the
 * package's own public barrel. See ./errors.reachability.test.ts, which mirrors
 * packages/db/src/errors.reachability.test.ts and packages/fiscal/src/errors.reachability.test.ts's
 * identical mechanical check for the same property.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Thrown by `currentSif` for a till with no LIVE `registro_sif` row — never provisioned, or
     * provisioned once and then revoked by a re-registration that has not yet completed. The
     * concrete encoding of "a till cannot be provisioned offline" (spec's stated limitation): a
     * caller that reaches here gets a structured, translatable refusal rather than a locally
     * invented installation number. See ./registro-sif.ts. */
    "sif.not_registered": { tenantId: string; tillId: string };

    /**
     * Task 14's brief drafted this as `ErrorCode.FISCAL_CHAIN_APPEND_CONTENTION`, appended
     * directly to `packages/shared/src/errors.ts`'s `ErrorCode` — the same SCREAMING_SNAKE_CASE,
     * wrong-file, package-named form Task 13's brief drafted for `SIF_NOT_REGISTERED` and that this
     * file's own design note above already overrides. Overridden here for the identical reasons:
     * `packages/shared` holds only codes native to itself (see its design note), and the naming
     * convention is domain-concept, lowercase, dot-namespaced — never the throwing package's name.
     *
     * Namespace choice: `chain.*`, matching `packages/shared/src/errors.ts`'s own worked example
     * (`chain.verification_failed`, reserved there for Task 15's art. 7.i verification) and this
     * package's established vocabulary (`cadenas`, `secuencia`, `huella`). `append_contention`,
     * not `verification_failed` or a shared `chain.error` — a caller needs to distinguish "the
     * chain could not be extended right now" (retry the sale) from "a stored chain link does not
     * match its own huella" (a tamper/corruption alarm), and collapsing the two into one code
     * would erase which failure a translator or an on-call human is looking at.
     *
     * Thrown by `appendToChain` (./chain.ts) only after `MAX_APPEND_ATTEMPTS` savepoint retries
     * each lost the race on SQLSTATE 23505 — in practice, several tabs/processes racing to create
     * the very first `cadenas` row for a till that has never sold before (the one window
     * `lockChainHead`'s row lock cannot cover, because there is no row yet to lock). A bare
     * `throw new Error(...)` here would reach a till screen as untranslatable prose (Global
     * Constraint, spec §9) for exactly the failure a human most needs explained in their own
     * language.
     */
    "chain.append_contention": { tenantId: string; tillId: string; attempts: number };
  }
}
