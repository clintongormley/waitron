import { html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import {
  TaxpayerFieldDialog,
  type TaxpayerFieldSettings,
  type TaxpayerFieldsView,
} from "./taxpayer-field-dialog.js";

const LABEL: StringKey = "venue_details.legal_name";

const SETTINGS: TaxpayerFieldSettings = {
  field: "legalName",
  dataTest: "legal-name",
  heading: "venue_details.change_legal_name",
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

  protected override renderFields(view: TaxpayerFieldsView<string>): TemplateResult {
    return html`<wt-input
      name="legalName"
      required
      label=${t(LABEL)}
      .value=${view.draft}
      .error=${view.errors.legalName ?? ""}
      ?disabled=${view.busy}
      @keydown=${view.submitOnEnter}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        view.change(event.detail.value);
      }}
    ></wt-input>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-legal-name-dialog": LegalNameDialog;
  }
}
