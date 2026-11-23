// Side-effect only: registers this package's codes, `setup.request_invalid` among them.
// See ./errors.ts.
import "./errors.js";
import { AppError } from "@waitron/shared";
import { MAX_BASE_CODE_LENGTH } from "./reserved-series.js";

/**
 * The venue fields a Veri*Factu filing puts on the wire verbatim. The host supplies them through
 * `FiscalContribution.venueFields` so the active filing regime owns their validation.
 */
export interface VenueFiscalFields {
  readonly legalName: string;
  readonly seriesCode: string;
  readonly fullSeriesCode: string;
  readonly correctiveSeriesCode: string;
  readonly fullCorrectiveSeriesCode: string;
}

/* The next four constants restate rules `@waitron/verifactu` owns, which exports only the
 * whole-record validator; ./venue-fields.charset.test.ts compares each against its verdict. */

/** The character set the validator applies to `NumSerieFactura` (`NUMSERIE_PATTERN`). */
const NUMSERIE_CHARSET = /^[A-Za-z0-9/_.-]+$/;
/** AEAT's cap on DescripcionOperacion, as `validate` applies it. */
const DESCRIPTION_MAX = 500;
/** AEAT's cap on a NombreRazon, the issuer's and a recipient's alike, counted in characters (code
 * points) as `validate` counts it. */
export const NOMBRE_RAZON_MAX = 120;
/** The C0 control characters XML forbids (`CONTROL_CHAR_PATTERN`). Tab, line feed and carriage
 * return are deliberately NOT in the range — XML permits those three — which is why this is not a
 * blanket `\x00-\x1F`. */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * Every field path this validator can name, as the request body spells it. Exported so the setup
 * wizard's own copy can be checked against it (`scripts/setup-wizard-fiscal-fields.test.ts`).
 *
 * `refuse` takes this union rather than a bare string, so a call naming a path that is not here
 * fails to compile. What that does NOT catch is the other direction — a path listed here that
 * nothing refuses any more; the per-path cases in ./venue-fields.test.ts are what cover that.
 */
export const VENUE_FISCAL_FIELD_PATHS = [
  "legalName",
  "seriesCode",
  "fullSeriesCode",
  "correctiveSeriesCode",
  "fullCorrectiveSeriesCode",
] as const;

export type VenueFiscalFieldPath = (typeof VENUE_FISCAL_FIELD_PATHS)[number];

function refuse(field: VenueFiscalFieldPath | "operationDescription"): never {
  throw new AppError("setup.request_invalid", { field });
}

/** Refuse a venue whose fiscal text fields would produce a record AEAT cannot accept, naming the
 * offending field and writing nothing. Run BEFORE `provisionVenue` mints the unrepairable SIF and
 * hash chain, so the operator fixes it in the wizard rather than discovering it at
 * the till when the first sale is refused. */
export function validateVenueFiscalFields(venue: VenueFiscalFields): void {
  for (const [field, code] of [
    ["seriesCode", venue.seriesCode],
    ["fullSeriesCode", venue.fullSeriesCode],
    ["correctiveSeriesCode", venue.correctiveSeriesCode],
    ["fullCorrectiveSeriesCode", venue.fullCorrectiveSeriesCode],
  ] as const) {
    if (!NUMSERIE_CHARSET.test(code)) refuse(field);
    // The cap is on the BASE, not on what is typed: a cold restore suffixes the installation
    // number and the counter is appended after a slash, and both must still fit inside
    // NumSerieFactura's 60 characters.
    if (code.length > MAX_BASE_CODE_LENGTH) refuse(field);
  }
  validateLegalName(venue.legalName);
}

export function validateLegalName(name: string): void {
  if (CONTROL_CHARS.test(name) || Array.from(name).length > NOMBRE_RAZON_MAX) refuse("legalName");
}

export function validateOperationDescription(description: string): void {
  if (CONTROL_CHARS.test(description) || description.length > DESCRIPTION_MAX) {
    refuse("operationDescription");
  }
}
