import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "./strings.js";

export interface ServiceSettingsValue {
  orderStart: "table" | "counter" | null;
  paidWhen: "prepay" | "ticket_then_pay" | null;
  collectionNumber: "none" | "numbered" | null;
  receiptPrintMode: "auto" | "on_request" | null;
}
type Field = keyof ServiceSettingsValue;

@customElement("dashboard-service-settings-fields")
export class ServiceSettingsFields extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        margin: var(--wt-space-1) 0 0;
      }
    `,
  ];
  @property({ attribute: false }) value: ServiceSettingsValue = {
    orderStart: "table",
    paidWhen: "prepay",
    collectionNumber: "none",
    receiptPrintMode: "auto",
  };
  @property({ attribute: false }) follows?: ServiceSettingsValue;
  @property({ attribute: false }) errors: Partial<Record<Field, string>> = {};
  @property({ type: Boolean }) disabled = false;

  #change<K extends Field>(event: Event, field: K, value: ServiceSettingsValue[K]) {
    event.stopPropagation();
    if (this.disabled) return;
    this.value = { ...this.value, [field]: value };
    this.dispatchEvent(
      new CustomEvent("service-settings-change", {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #choice<K extends Field>(
    field: K,
    label: string,
    options: { value: NonNullable<ServiceSettingsValue[K]>; label: string }[],
    hint = "",
  ) {
    const following = this.follows !== undefined;
    const placeholder = following
      ? (options.find((option) => option.value === this.follows![field])?.label ?? "")
      : "";
    return html`<wt-combobox
      name=${field}
      label=${label}
      search="never"
      .options=${following ? [{ value: "", label: t("venue.clear") }, ...options] : options}
      .value=${this.value[field] ?? ""}
      .placeholder=${placeholder}
      .hint=${hint}
      .error=${this.errors[field] ?? ""}
      ?required=${!following}
      ?disabled=${this.disabled}
      @wt-change=${(event: CustomEvent<{ value: string }>) =>
        this.#change(event, field, (event.detail.value || null) as ServiceSettingsValue[K])}
    ></wt-combobox>`;
  }

  override render() {
    return html`
      ${this.#choice("orderStart", t("venue.order_start"), [
        { value: "table", label: t("venue.table_service") },
        { value: "counter", label: t("venue.counter_service") },
      ])}
      ${this.#choice(
        "paidWhen",
        t("venue.counter_paid_when"),
        [
          { value: "prepay", label: t("venue.paid_before_preparation") },
          { value: "ticket_then_pay", label: t("venue.paid_at_collection") },
        ],
        this.follows === undefined && this.value.orderStart === "table"
          ? t("venue.counter_paid_when_hint")
          : "",
      )}
      ${
        this.follows === undefined
          ? html`<div>
              <wt-switch
                name="collectionNumber"
                label=${t("venue.print_collection_ticket")}
                .checked=${this.value.collectionNumber === "numbered"}
                .description=${this.errors.collectionNumber ?? ""}
                ?disabled=${this.disabled}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
                  this.#change(
                    event,
                    "collectionNumber",
                    event.detail.checked ? "numbered" : "none",
                  )}
              ></wt-switch>
              ${
                this.errors.collectionNumber
                  ? html`<p class="error" data-field-error="collectionNumber">
                      ${this.errors.collectionNumber}
                    </p>`
                  : nothing
              }
            </div>`
          : this.#choice("collectionNumber", t("venue.print_collection_ticket"), [
              { value: "numbered", label: t("venue.print") },
              { value: "none", label: t("venue.dont_print") },
            ])
      }
      ${this.#choice("receiptPrintMode", t("venue.print_receipt"), [
        { value: "auto", label: t("venue.always") },
        { value: "on_request", label: t("venue.on_request") },
      ])}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-service-settings-fields": ServiceSettingsFields;
  }
}
