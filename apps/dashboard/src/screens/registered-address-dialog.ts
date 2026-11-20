import { customElement } from "lit/decorators.js";
import { TaxpayerFieldDialog, type TaxpayerFieldSettings } from "./taxpayer-field-dialog.js";

const SETTINGS: TaxpayerFieldSettings = {
  field: "taxpayerDomicile",
  dialogTest: "registered-address",
  buttonTest: "taxpayer-domicile",
  heading: "venue_details.change_taxpayer_domicile",
  label: "venue_details.taxpayer_domicile",
  hint: "venue_details.taxpayer_domicile_hint",
  note: "venue_details.taxpayer_domicile_note",
  changedElsewhere: "venue_details.taxpayer_domicile_changed",
  refusals: {
    required: "venue_details.required",
    unchanged: "venue_details.taxpayer_domicile_unchanged",
  },
  send: (api, taxpayerDomicile, expected) =>
    api.changeTaxpayerDomicile({ taxpayerDomicile, expected }),
};

/** Changes the registered address that full invoices issued from now on print. */
@customElement("dashboard-registered-address-dialog")
export class RegisteredAddressDialog extends TaxpayerFieldDialog {
  protected readonly settings = SETTINGS;
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-registered-address-dialog": RegisteredAddressDialog;
  }
}
