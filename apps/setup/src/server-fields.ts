/**
 * The venue fields the SERVER can refuse with `setup.request_invalid`, and what to tell the operator
 * about each. This is NOT every venue field the request carries: `parseVenue`
 * (`apps/server/src/setup-api.ts`) throws the same code for about sixteen paths, and all the others
 * are fields whose own wizard screen already validates the same rule, so they keep the review
 * screen's banner. These four are the ones the fiscal regime's venue-field seat refuses
 * (`packages/fiscal-verifactu/src/venue-fields.ts`) — rules the wizard cannot evaluate itself, which
 * is why the operator has to be sent back to the field rather than shown a raw field path.
 *
 * It lives in its own Lit-free module so both the shell (`setup-app.ts`, which decides where a
 * refusal routes) and the venue form (`screens/venue-screen.ts`, which marks and explains the field)
 * read ONE list — a path known to one and not the other would route the operator to a form with no
 * mark, no sentence and no banner. `scripts/setup-wizard-fiscal-fields.test.ts` ties these keys to
 * the regime's own `VENUE_FISCAL_FIELD_PATHS`, which no runtime import here could do: nothing under
 * `apps/` may import a regime package (`scripts/module-seams.test.ts`).
 *
 * The keys are the server's paths: the operation description is named by its position in the request
 * body while the venue form calls the same field `operationDescription`, so `key` reconciles the two
 * spellings rather than assuming them equal.
 *
 * Every field here is a `wt-input`, which matters: the venue form clears a mark from its `#onField`
 * handler, and the two SELECT-backed fields (`country`, `province`) have their own handlers that
 * never touch it. Adding a select-backed field to this map means updating those handlers too, or the
 * mark would stay red however the operator corrects it.
 *
 * The rules themselves belong to the regime, and the wizard cannot evaluate them, so each sentence
 * says what the operator should DO — never the rule or the pattern behind it.
 */

/** The venue form's own key for each field this map covers — a subset of that screen's fields. */
export type ServerFieldKey =
  "legalName" | "seriesCode" | "rectificativeSeriesCode" | "operationDescription";

export interface ServerField {
  /** The venue form's own field key. It is also the field's `name` attribute, which is how the
   * screen finds the input to focus, and its `data-test` hook. The `name` is the production
   * dependency; the test hook is not (CLAUDE.md §3 → Forms). */
  readonly key: ServerFieldKey;
  /** What is wrong, in the operator's terms. */
  readonly message: string;
}

/** Both invoice series codes carry the same rule, so they carry the same sentence. The 38 is the
 * real cap: `NumSerieFactura` holds 60 characters and a cold restore appends an installation-number
 * suffix and a counter (`MAX_BASE_CODE_LENGTH`, `packages/fiscal-verifactu/src/reserved-series.ts`). */
const SERIES_CODE_MESSAGE =
  "Use letters, numbers, and the characters / _ . and - only, up to 38 characters.";

/** Indexed by the server's field path; `undefined` for any path this map does not cover. */
export const SERVER_FIELDS: Readonly<Record<string, ServerField | undefined>> = {
  // Never phrased as the tax agency disliking the NAME: it is refused only for control characters a
  // paste carried in, so advice to try a different trading name is the one thing that cannot help.
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
