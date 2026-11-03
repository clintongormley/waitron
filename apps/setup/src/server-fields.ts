/** Fiscal-regime refusal paths, compared with the regime by scripts/setup-wizard-fiscal-fields.test.ts.
 * VENUE_SERVER_FIELDS adds setup API paths for the shell and venue form.
 * Inputs clear refusal marks in #onField; dropdown handlers do not, so these keys must name inputs
 * wherever the venue form shows one; a refusal for a field it does not show appears above Next. */

import { t } from "./i18n/t.js";

export type ServerFieldKey =
  | "taxId"
  | "legalName"
  | "taxpayerDomicile"
  | "seriesCode"
  | "fullSeriesCode"
  | "rectificativeSeriesCode"
  | "operationDescription";

export interface ServerField {
  /** The field's `name` attribute where the venue form has one; the screen focuses that input. */
  readonly key: ServerFieldKey;
  /** Translated on each read, so it follows a language switch. */
  readonly message: string;
}

export const SERVER_FIELDS: Readonly<Record<string, ServerField | undefined>> = {
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
  fullSeriesCode: {
    key: "fullSeriesCode",
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
  operationDescription: {
    key: "operationDescription",
    get message() {
      return t("server_fields.operation_description");
    },
  },
};

/** The shell and form also handle fields refused by the setup API itself. */
export const VENUE_SERVER_FIELDS: Readonly<Record<string, ServerField | undefined>> = {
  ...SERVER_FIELDS,
  taxId: {
    key: "taxId",
    get message() {
      return t("server_fields.tax_id");
    },
  },
  taxpayerDomicile: {
    key: "taxpayerDomicile",
    get message() {
      return t("server_fields.taxpayer_domicile");
    },
  },
};
