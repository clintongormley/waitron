/**
 * The venue fields the fiscal regime refuses with `setup.request_invalid`, and what to tell the
 * operator about each. The wizard does not evaluate those rules, so the operator is sent back to the
 * field. The shell (which routes a refusal) and the venue form (which marks the field) read this one
 * list. `scripts/setup-wizard-fiscal-fields.test.ts` ties the keys to the regime's
 * `VENUE_FISCAL_FIELD_PATHS`.
 *
 * The keys are the server's paths; `key` is the venue form's own name for the same field.
 *
 * Every field here is a `wt-input`: the venue form clears a mark in `#onField`, and its handlers for
 * the select-backed `country` and `province` do not, so a select-backed field added here would stay
 * marked however the operator corrects it.
 */

export type ServerFieldKey =
  "legalName" | "seriesCode" | "rectificativeSeriesCode" | "operationDescription";

export interface ServerField {
  /** Also the field's `name` attribute, which is how the screen finds the input to focus. */
  readonly key: ServerFieldKey;
  readonly message: string;
}

/** 38 is `MAX_BASE_CODE_LENGTH` (`packages/fiscal-verifactu/src/reserved-series.ts`). */
const SERIES_CODE_MESSAGE =
  "Use letters, numbers, and the characters / _ . and - only, up to 38 characters.";

export const SERVER_FIELDS: Readonly<Record<string, ServerField | undefined>> = {
  // Refused only for control characters, so advice to choose a different name cannot help.
  legalName: {
    key: "legalName",
    message:
      "This name contains characters the tax agency's records cannot carry — they are invisible, so you will not see them. Typing the name out instead of pasting it usually clears them.",
  },
  seriesCode: { key: "seriesCode", message: SERIES_CODE_MESSAGE },
  rectificativeSeriesCode: { key: "rectificativeSeriesCode", message: SERIES_CODE_MESSAGE },
  "location.operationDescription": {
    key: "operationDescription",
    message:
      "Keep this to 500 characters or fewer, and remove any hidden characters — typing it out instead of pasting it usually clears them.",
  },
};
