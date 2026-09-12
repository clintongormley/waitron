// Side-effect only: registers this package's codes on the shared registry. `setup.request_invalid`,
// the code thrown below, is declared in ./errors.ts — this package's own contribution, beside
// ./provisioning-secret.ts's use of the same code. Reachability from the package barrel is guarded
// once, in the root project's scripts/errors-reachable.test.ts (CLAUDE.md §4).
import "./errors.js";
import { AppError } from "@waitron/shared";
import { MAX_BASE_CODE_LENGTH } from "./reserved-series.js";

/**
 * The venue fields a Veri*Factu filing puts on the wire verbatim, as the host hands them over. The
 * host does not know these rules — `@waitron/verifactu` is a regime package and nothing under
 * `apps/server/src` may import one (`scripts/module-seams.test.ts`) — so they are reached through
 * `FiscalContribution.venueFields`, exactly as the AEAT certificate is reached through
 * `provisioningSecret`.
 */
export interface VenueFiscalFields {
  readonly legalName: string;
  readonly seriesCode: string;
  readonly rectificativeSeriesCode: string;
  readonly operationDescription: string;
}

/* The next three constants restate rules `@waitron/verifactu` owns, rather than importing them:
 * that module exports the whole-record validator and not its individual patterns. Nothing in the
 * type system keeps a restatement honest, so ./venue-fields.charset.test.ts runs each of the three
 * against `validate`'s own verdict on a real record and compares them. Every case in its tables is
 * there because some narrowing or widening of these three flips it — measured by making each of
 * those changes and watching a case go red. */

/** The character set the validator applies to `NumSerieFactura` (`NUMSERIE_PATTERN`). */
const NUMSERIE_CHARSET = /^[A-Za-z0-9/_.-]+$/;
/** AEAT's cap on DescripcionOperacion, as `validate` applies it. */
const DESCRIPTION_MAX = 500;
/** The C0 control characters XML forbids (`CONTROL_CHAR_PATTERN`). Tab, line feed and carriage
 * return are deliberately NOT in the range — XML permits those three — which is why this is not a
 * blanket `\x00-\x1F`. */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * Every field path this validator can name, as the request body spells it. Exported so the setup
 * wizard's own copy can be checked against it (`scripts/setup-wizard-fiscal-fields.test.ts`) — the
 * wizard marks and explains the refused field, and nothing under `apps/` may import a regime package
 * (`scripts/module-seams.test.ts`), so the two lists are tied together in the root project instead.
 *
 * `refuse` takes this union rather than a bare string, so a call naming a path that is not here
 * fails to compile. What that does NOT catch is the other direction — a path listed here that
 * nothing refuses any more; the per-path cases in ./venue-fields.test.ts are what cover that.
 */
export const VENUE_FISCAL_FIELD_PATHS = [
  "legalName",
  "seriesCode",
  "rectificativeSeriesCode",
  "location.operationDescription",
] as const;

export type VenueFiscalFieldPath = (typeof VENUE_FISCAL_FIELD_PATHS)[number];

function refuse(field: VenueFiscalFieldPath): never {
  throw new AppError("setup.request_invalid", { field });
}

/** Refuse a venue whose fiscal text fields would produce a record AEAT cannot accept, naming the
 * offending field and writing nothing. Run BEFORE `provisionVenue` mints the unrepairable SIF and
 * hash chain (CLAUDE.md §5), so the operator fixes it in the wizard rather than discovering it at
 * the till when the first sale is refused. */
export function validateVenueFiscalFields(venue: VenueFiscalFields): void {
  for (const [field, code] of [
    ["seriesCode", venue.seriesCode],
    ["rectificativeSeriesCode", venue.rectificativeSeriesCode],
  ] as const) {
    if (!NUMSERIE_CHARSET.test(code)) refuse(field);
    // The cap is on the BASE, not on what is typed: a cold restore suffixes the installation
    // number and the counter is appended after a slash, and both must still fit inside
    // NumSerieFactura's 60 characters.
    if (code.length > MAX_BASE_CODE_LENGTH) refuse(field);
  }
  if (CONTROL_CHARS.test(venue.legalName)) refuse("legalName");
  validateOperationDescription(venue.operationDescription);
}

export function validateOperationDescription(description: string): void {
  if (CONTROL_CHARS.test(description) || description.length > DESCRIPTION_MAX) {
    refuse("location.operationDescription");
  }
}
