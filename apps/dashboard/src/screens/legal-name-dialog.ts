import { customElement } from "lit/decorators.js";
import { TaxpayerFieldDialog, type TaxpayerFieldSettings } from "./taxpayer-field-dialog.js";

const SETTINGS: TaxpayerFieldSettings = {
  field: "legalName",
  dataTest: "legal-name",
  heading: "venue_details.change_legal_name",
  label: "venue_details.legal_name",
  note: "venue_details.legal_name_note",
  changedElsewhere: "venue_details.legal_name_changed",
  notSaved: "venue_details.legal_name_not_saved",
  refusals: {
    unchanged: "venue_details.legal_name_unchanged",
    fiscal_format: "venue_details.legal_name_format",
  },
  send: (api, legalName, expected) => api.renameTaxpayer({ legalName, expected }),
};

/** Renames the taxpayer. */
@customElement("dashboard-legal-name-dialog")
export class LegalNameDialog extends TaxpayerFieldDialog {
  protected readonly settings = SETTINGS;
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-legal-name-dialog": LegalNameDialog;
  }
}
