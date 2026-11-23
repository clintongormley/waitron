import { css, html, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-input.js";
import { ibanGroups, ibanProblem, normalizeIban } from "@waitron/shared";
import { t } from "../i18n/t.js";
import {
  normalizedText,
  TaxpayerFieldDialog,
  type TaxpayerFieldSettings,
  type TaxpayerFieldsView,
} from "./taxpayer-field-dialog.js";

/** `""` in either field stands for none. */
export interface BankAccountValue {
  iban: string;
  bankName: string;
}

const SETTINGS: TaxpayerFieldSettings<BankAccountValue> = {
  field: "iban",
  dataTest: "bank-account",
  heading: "venue_details.change_bank_account",
  note: "venue_details.bank_account_note",
  changedElsewhere: "venue_details.bank_account_changed",
  notSaved: "venue_details.bank_account_not_saved",
  refusals: {
    required: "venue_details.bank_iban_required",
    format: "venue_details.iban_format",
    checksum: "venue_details.iban_checksum",
    unchanged: "venue_details.bank_account_unchanged",
  },
  send: (api, { iban, bankName }, expected) => api.saveBankAccount({ iban, bankName, expected }),
};

/** Sets, changes or clears the bank account that invoices for deferred-payment bills print. An
 *  empty IBAN clears it. */
@customElement("dashboard-bank-account-dialog")
export class BankAccountDialog extends TaxpayerFieldDialog<BankAccountValue, BankAccountValue> {
  protected readonly settings = SETTINGS;

  static override styles = [
    ...TaxpayerFieldDialog.styles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
    `,
  ];

  protected override draftFor(stored: BankAccountValue): BankAccountValue {
    return { iban: ibanGroups(stored.iban).join(" "), bankName: stored.bankName };
  }

  protected override storedForm(value: BankAccountValue): BankAccountValue {
    return { iban: normalizeIban(value.iban), bankName: normalizedText(value.bankName) };
  }

  protected override sameValue(a: BankAccountValue, b: BankAccountValue): boolean {
    return a.iban === b.iban && a.bankName === b.bankName;
  }

  protected override fieldErrors(draft: BankAccountValue): Record<string, string> {
    const { iban, bankName } = this.storedForm(draft);
    if (iban === "") return bankName === "" ? {} : { iban: t("venue_details.bank_iban_required") };
    const problem = ibanProblem(iban);
    if (problem === undefined) return {};
    return {
      iban: t(problem === "checksum" ? "venue_details.iban_checksum" : "venue_details.iban_format"),
    };
  }

  protected override renderFields(view: TaxpayerFieldsView<BankAccountValue>): TemplateResult {
    const field = (name: keyof BankAccountValue, label: string) =>
      html`<wt-input
        name=${name}
        autocomplete="off"
        label=${label}
        .value=${view.draft[name]}
        .error=${view.errors[name] ?? ""}
        ?disabled=${view.busy}
        @keydown=${view.submitOnEnter}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          view.change({ ...view.draft, [name]: event.detail.value });
        }}
      ></wt-input>`;
    return html`<div class="fields">
      ${field("iban", t("venue_details.iban"))} ${field("bankName", t("venue_details.bank_name"))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-bank-account-dialog": BankAccountDialog;
  }
}
