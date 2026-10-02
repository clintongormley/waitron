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
 * the dropdown-backed `country` and `province` do not, so a dropdown-backed field added here would
 * stay marked however the operator corrects it.
 */

import { t } from "./i18n/t.js";

export type ServerFieldKey =
  "legalName" | "seriesCode" | "rectificativeSeriesCode" | "operationDescription";

export interface ServerField {
  /** Also the field's `name` attribute, which is how the screen finds the input to focus. */
  readonly key: ServerFieldKey;
  /** Translated on each read, so it follows a language switch. */
  readonly message: string;
}

export const SERVER_FIELDS: Readonly<Record<string, ServerField | undefined>> = {
  // Refused only for control characters, so advice to choose a different name cannot help.
  legalName: {
    key: "legalName",
    get message() {
      return t("server_fields.legal_name");
    },
  },
  seriesCode: {
    key: "seriesCode",
    get message() {
      return t("server_fields.series_code");
    },
  },
  rectificativeSeriesCode: {
    key: "rectificativeSeriesCode",
    get message() {
      return t("server_fields.series_code");
    },
  },
  "location.operationDescription": {
    key: "operationDescription",
    get message() {
      return t("server_fields.operation_description");
    },
  },
};
