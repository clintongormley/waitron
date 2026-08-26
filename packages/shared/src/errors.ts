/**
 * The registry of every error code that may cross a package boundary, mapped to the params that
 * code carries. `ErrorCode` is derived from the keys, so adding a code and forgetting its params
 * is a type error rather than a runtime surprise.
 *
 * This interface holds ONLY the codes native to `@waitron/shared` itself: `ids.ts` and
 * `money.ts` are the only things in this package that throw. Every other package — `packages/db`
 * today, `packages/core` and `packages/fiscal` once they exist, `packages/fiscal-verifactu` once
 * IT exists — contributes its own codes from its own source, by declaration merging:
 *
 *   declare module "@waitron/shared" {
 *     interface ErrorParams {
 *       "chain.verification_failed": { tillId: string; sequence: number };
 *     }
 *   }
 *
 * `packages/fiscal-verifactu` is the example above deliberately, not `packages/verifactu`:
 * `packages/verifactu` is a standalone, publishable library with an enforced
 * zero-in-repo-dependency boundary (see its zone in `eslint.config.js`) and cannot add
 * `@waitron/shared` as a dependency — the lint rule rejects it — so it can never declare-merge
 * into this interface. `packages/fiscal-verifactu` depends on both `packages/verifactu` and
 * `@waitron/shared`, which is what lets it translate a library-level condition into a structured
 * `AppError` at all.
 *
 * Nothing here enumerates a dependent package's codes on its behalf, and it must not:
 * `packages/core`, `packages/fiscal` and `packages/fiscal-verifactu` do not exist yet in this
 * repo's history, so pre-declaring their codes here would mean the leaf package changes every
 * time a package built later adds a code — exactly the coupling this design exists to avoid. It
 * would also risk regime vocabulary (a future backend's "chain", "huella") arriving in the one
 * package that must never carry it (spec §2). `packages/db` exists today and augments this
 * registry from its own source (`packages/db/src/errors.ts`) rather than having its codes
 * declared here on its behalf, for the same reason: the leaf does not get to know what its
 * dependents throw, whether or not the dependent already exists.
 *
 * **Namespace convention: the prefix names the DOMAIN CONCEPT the code describes — `sale.*`,
 * `series.*`, `chain.*`, `clock.*`, `tenant.*` — never the package whose source happens to
 * contain the `throw new AppError(...)` call.** (This overturns an earlier draft of this
 * comment, which used the throwing package as the prefix; that convention is retired.) Spec §9
 * requires every code to double as a translation key looked up at display time.
 * `sale.tender_shortfall` tells a translator what happened at the till; `core.tender_shortfall`
 * would tell them which package's source happened to throw it, which is an implementation
 * detail that must not leak into the layer a translator works from. A package-of-origin prefix
 * also drifts under refactor without the underlying concept changing — series allocation might
 * move from `packages/db` into a future `packages/core` some day, and a package-named code would
 * then need renaming for a reason no translator cares about, at the exact moment the "codes are
 * never renamed" rule below says it must not. The plan's own draft text for later tasks already
 * follows this without being told to: it files `sale.tender_shortfall`, `sale.series_not_found`,
 * `sale.not_found` and `chain.verification_failed` as the codes `packages/core` throws — never
 * `core.*`. See `packages/db/src/errors.ts` for the concrete case this decided in this codebase: a
 * series-allocation error thrown from `packages/db`'s own source today, filed as `series.*`, not
 * `db.*` and not `core.*`.
 *
 * **Corrected 2026-07-21 (Task 18).** This paragraph previously listed `clock.degraded` alongside
 * the `packages/core` codes above. It is not one: `clock.degraded` is attached (constructed, never
 * thrown — see its own doc comment on `TrustedReading.warning`) by `packages/fiscal`'s
 * `createTrustedClock` (`packages/fiscal/src/clock.ts`, Task 10), which is also where it augments
 * this registry (`packages/fiscal/src/errors.ts`). `packages/core`'s own `recordSale` forwards
 * `TrustedReading.warning` verbatim onto an incident rather than constructing this code itself.
 *
 * `shared.*` is the one package-shaped-looking prefix that stays, and it is not an exception to
 * the rule above — it names a domain concept too, just one genuinely common to every package
 * that constructs a branded id or an exact decimal, rather than a fact about which file threw.
 *
 * Codes are stable identifiers. They are translation keys and they may already have been
 * written into an incident record, so a code is never renamed — a wrong one is deprecated and a
 * new one added beside it. (`packages/db/src/errors.ts` documents the one exception made so far,
 * `series.not_found`, and why a clean rename was correct there rather than a deprecate-and-add.)
 *
 * **Reachability rule for anything that augments this registry:** a package that adds codes via
 * `declare module "@waitron/shared"` must ensure the augmenting file is transitively reachable
 * from THAT PACKAGE'S OWN public barrel (its `index.ts`), not merely present somewhere under its
 * `src/`. Declaration merging is a whole-program fact for whichever files the TypeScript compiler
 * actually loads for a given program — and a package's own `pnpm typecheck` loads every file its
 * tsconfig `include`s, whether or not anything imports it, so an augmenting file that sits in
 * `src/` unimported can pass that package's own typecheck while being invisible to any external
 * consumer, whose program only sees what the public barrel transitively imports. See
 * `packages/db/src/allocate-number.ts`'s `import "./errors.js"` for the concrete shape this
 * takes — a side-effect-only import whose sole job is keeping `packages/db/src/errors.ts`
 * reachable from `packages/db/src/index.ts` — and the comment there for what breaks without it.
 * Tasks 12 onward will all add a package-local `errors.ts`; this is the rule to follow rather
 * than rediscover.
 */
export interface ErrorParams {
  "shared.invalid_id": { kind: string; value: string };
  "shared.invalid_decimal": { value: string };
  "shared.decimal_overflow": { value: string; maxIntegerDigits: number };
  "locale.unsupported": { locale: string };
}

export type ErrorCode = keyof ErrorParams;

/**
 * The only error type permitted to cross a package boundary. `message` is deliberately the code
 * itself: prose in an error message reaches a screen untranslatable (spec §9), and making the
 * message a key means even a careless `console.error(e.message)` produces something the
 * translation table can catch.
 *
 * **Narrowing `.code` does not narrow `.params`.** `error: AppError` is really
 * `AppError<ErrorCode>` — one instantiation over the full union, not a discriminated union of
 * per-code instantiations — so TypeScript's control-flow narrowing on `error.code === "x"` narrows
 * the read type of `.code` inside that branch but does not narrow the generic parameter `C`
 * itself, and `.params` stays typed as `ErrorParams[ErrorCode]`, the union of every code's params,
 * whichever branch you're in. This is inherited from the class shape above (a single generic
 * class, not a discriminated union of concrete classes) and is not unsound: TypeScript refuses
 * the access — `error.params.kind` still fails to compile — rather than mistyping it, so nothing
 * downstream can silently read the wrong shape.
 *
 * Use `hasCode` instead of a bare `.code` check when you need `.params` narrowed too:
 *
 *   if (hasCode(error, "shared.invalid_id")) { error.params.kind; } // narrows both
 */
export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly params: Readonly<ErrorParams[C]>;

  constructor(code: C, params: ErrorParams[C]) {
    super(code);
    this.name = "AppError";
    this.code = code;
    // Frozen because an AppError is frequently attached to a result and carried across an
    // async boundary before display. A caller that mutates params in passing would change what
    // a later reader believes happened.
    this.params = Object.freeze({ ...params });
  }
}

/**
 * Narrowing guard. `instanceof` rather than duck typing: an object that merely has `code` and
 * `params` has no stack, and accepting it would let a hand-rolled literal masquerade as a real
 * failure all the way to a support ticket.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Narrows an `AppError` by code AND params together — see the "Narrowing `.code` does not narrow
 * `.params`" note on the class itself for why the obvious `error.code === code` check alone does
 * not do this. A type predicate over the class's own generic parameter is enough: nothing about
 * `AppError`'s existing shape changes, this is purely additive.
 */
export function hasCode<C extends ErrorCode>(error: AppError, code: C): error is AppError<C> {
  return error.code === code;
}
