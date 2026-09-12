import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { StripePaymentsClient } from "./client.js";

/**
 * The Stripe ADD-READER DIALOG (`readerAdd.kind === "reference"`): a reader-name field and the Stripe
 * Terminal reader-id field, with a help tooltip explaining where to find it. Pressing _Add_ POSTs the
 * reference; the server verifies it with one retrieve, so there is no countdown — success saves the row
 * (`onAdded`) and closes, and a rejection shows the not-accepted copy for another try.
 */
@customElement("stripe-add-reader")
export class StripeAddReader extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .id-label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        margin-bottom: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) request!: DashboardRequest;
  @property({ attribute: false }) onAdded: () => void = () => {};
  @property({ attribute: false }) onClose: () => void = () => {};

  @state() private name = "";
  @state() private reference = "";
  @state() private errors: string[] = [];
  @state() private busy = false;

  #onField(event: CustomEvent<{ value: string }>, field: "name" | "reference"): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  #validate(): string[] {
    const errors: string[] = [];
    if (this.name.trim() === "") errors.push("payments.stripe.reader_name_required");
    if (this.reference.trim() === "") errors.push("payments.stripe.reader_id_required");
    return errors;
  }

  async #add(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    const errorKeys = this.#validate();
    if (errorKeys.length > 0) {
      this.errors = errorKeys.map((k) => t(k as Parameters<typeof t>[0]));
      return;
    }
    this.errors = [];
    this.busy = true;
    try {
      await new StripePaymentsClient(this.request).addReader({
        name: this.name,
        reference: this.reference,
      });
      this.onAdded();
      this.onClose();
    } catch (error) {
      this.errors = [
        codeOf(error) === "reader.not_found" || codeOf(error) === "server.internal"
          ? t("payments.stripe.add_failed")
          : codeMessage(codeOf(error)),
      ];
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <wt-dialog
        heading=${t("payments.stripe.add_reader_heading")}
        .open=${true}
        @wt-close=${() => this.onClose()}
      >
        <wt-form-error-summary
          heading=${t("payments.stripe.form_problem")}
          .errors=${this.errors}
        ></wt-form-error-summary>
        <wt-input
          class="field"
          name="name"
          data-test="reader-name"
          label=${t("payments.stripe.reader_name")}
          required
          .value=${this.name}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "name")}
        ></wt-input>
        <div class="id-label">
          <span>${t("payments.stripe.reader_id")}</span>
          <wt-help-tooltip aria-label=${t("payments.stripe.reader_id")} data-test="reader-id-help">
            ${t("payments.stripe.reader_id_help")}
          </wt-help-tooltip>
        </div>
        <wt-input
          class="field"
          name="reference"
          data-test="reader-id"
          label=${t("payments.stripe.reader_id")}
          required
          .value=${this.reference}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "reference")}
        ></wt-input>
        <wt-button slot="footer" data-test="cancel" @click=${() => this.onClose()}
          >${t("payments.stripe.cancel")}</wt-button
        >
        <wt-button
          slot="footer"
          variant="primary"
          data-test="add"
          ?loading=${this.busy}
          @click=${(e: Event) => void this.#add(e)}
          >${t("payments.stripe.add")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "stripe-add-reader": StripeAddReader;
  }
}
