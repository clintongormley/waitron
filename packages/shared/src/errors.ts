/**
 * The registry of every error code that may cross a package boundary, mapped to the params that
 * code carries. `ErrorCode` is derived from the keys.
 *
 * This interface holds only `@waitron/shared`'s own codes. Every other package contributes its
 * codes from its own source, by declaration merging, so this leaf never knows what its dependents
 * throw:
 *
 *   declare module "@waitron/shared" {
 *     interface ErrorParams {
 *       "series.not_found": { seriesId: string };
 *     }
 *   }
 *
 * The prefix names the DOMAIN CONCEPT (`sale.*`, `series.*`), never the package that throws,
 * because every code doubles as a translation key. Codes are never renamed once shipped; a wrong
 * one is deprecated and a new one added beside it.
 *
 * `shared.*` is not an exception: it names the value types this package defines (ids, exact
 * decimals and the stored counts they convert to), common to every package that parses one.
 *
 * An augmenting `errors.ts` must be transitively reachable from its package's own `index.ts`.
 * Declaration merging only covers the files a program loads, so an unimported `errors.ts` can pass
 * the package's own typecheck and still be invisible to a consumer that loads only the barrel.
 * Guard: `scripts/errors-reachable.test.ts`, weaker than its name: it reads import TEXT, so such
 * an import written in a comment or string of another file the barrel reaches fakes an edge.
 */
export interface ErrorParams {
  /** A content language is not a recognised language identifier. */
  "content.language_invalid": Record<string, never>;
  "shared.invalid_id": { kind: string; value: string };
  "shared.invalid_decimal": { value: string };
  "shared.decimal_overflow": { value: string; maxIntegerDigits: number };
  "shared.invalid_cents": { value: string };
  "shared.invalid_thousandths": { value: string };
  "shared.invalid_basis_points": { value: string };
  "locale.unsupported": { locale: string };
}

export type ErrorCode = keyof ErrorParams;

/**
 * The only error type permitted to cross a package boundary. `message` is the code itself, so even
 * a careless `console.error(e.message)` prints a translation key rather than untranslatable prose.
 *
 * Checking `.code` alone does not narrow `.params`; {@link hasCode} narrows both.
 */
export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly params: Readonly<ErrorParams[C]>;

  constructor(code: C, params: ErrorParams[C]) {
    super(code);
    this.name = "AppError";
    this.code = code;
    // Frozen: an AppError is often carried across an async boundary before display, and a caller
    // mutating params in passing would change what a later reader believes happened.
    this.params = Object.freeze({ ...params });
  }
}

/**
 * `instanceof` rather than duck typing, so a hand-rolled `{ code, params }` literal cannot pass as
 * a real failure.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Narrows an `AppError` by code and params together. */
export function hasCode<C extends ErrorCode>(error: AppError, code: C): error is AppError<C> {
  return error.code === code;
}
