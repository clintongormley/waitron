import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import { codeMessage, codeOf, type DashboardRequest } from "@waitron/dashboard-kit";
import { t } from "./strings.js";
import { StripePaymentsClient } from "./client.js";

/** The server verifies the reader id in one call, so there is no pairing countdown. */
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
  @state() private attempted = false;
  /** A refusal that names no field, shown above Add until the next press. */
  @state() private refusal = "";
  @state() private busy = false;
  #closed = false;

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.onClose();
  }

  #onField(event: CustomEvent<{ value: string }>, field: "name" | "reference"): void {
    event.stopPropagation();
    this[field] = event.detail.value;
  }

  #fieldErrors(): { name: string; reference: string } {
    if (!this.attempted) return { name: "", reference: "" };
    return {
      name: this.name.trim() === "" ? t("payments.stripe.reader_name_required") : "",
      reference: this.reference.trim() === "" ? t("payments.stripe.reader_id_required") : "",
    };
  }

  async #add(event: Event): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    this.attempted = true;
    this.refusal = "";
    const errors = this.#fieldErrors();
    if (errors.name !== "" || errors.reference !== "") {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.busy = true;
    try {
      await new StripePaymentsClient(this.request).addReader({
        name: this.name,
        reference: this.reference,
      });
      // The reader exists whether or not the dialog is still open, so the host refreshes its list;
      // a cancelled or removed dialog does not close again.
      this.onAdded();
      if (this.isConnected) this.#close();
    } catch (error) {
      this.refusal =
        codeOf(error) === "reader.not_found" || codeOf(error) === "server.internal"
          ? t("payments.stripe.add_failed")
          : codeMessage(codeOf(error));
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    const errors = this.#fieldErrors();
    const blocked = errors.name !== "" || errors.reference !== "";
    return html`
      <wt-dialog
        heading=${t("payments.stripe.add_reader_heading")}
        .open=${true}
        @wt-close=${() => this.#close()}
      >
        <wt-input
          class="field"
          name="name"
          data-test="reader-name"
          label=${t("payments.stripe.reader_name")}
          required
          error=${errors.name}
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
          error=${errors.reference}
          .value=${this.reference}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "reference")}
        ></wt-input>
        <wt-form-actions
          slot="footer"
          .error=${[this.refusal, blocked ? t("payments.stripe.fix_fields") : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <wt-button slot="cancel" data-test="cancel" @click=${() => this.#close()}
            >${t("payments.stripe.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="add"
            ?loading=${this.busy}
            ?disabled=${blocked}
            @click=${(e: Event) => void this.#add(e)}
            >${t("payments.stripe.add")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "stripe-add-reader": StripeAddReader;
  }
}
