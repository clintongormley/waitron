import { customElement } from "lit/decorators.js";
import { TaxpayerFieldDialog, type TaxpayerFieldSettings } from "./taxpayer-field-dialog.js";

const SETTINGS: TaxpayerFieldSettings = {
  field: "taxpayerDomicile",
  dataTest: "taxpayer-domicile",
  heading: "venue_details.change_taxpayer_domicile",
  label: "venue_details.taxpayer_domicile",
  hint: "venue_details.taxpayer_domicile_hint",
  addressSearch: true,
  note: "venue_details.taxpayer_domicile_note",
  changedElsewhere: "venue_details.taxpayer_domicile_changed",
  notSaved: "venue_details.taxpayer_domicile_not_saved",
  refusals: {
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
