import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { keyed } from "lit/directives/keyed.js";
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
  #opening = {};
  #scope?: DraftScope<{ name: string; reference: string }>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy || !this.#scope) return true;
    const opening = this.#opening;
    const outcome = await this.#leave!.request({ scopes: [this], reason, proceed() {} });
    return opening === this.#opening && outcome === "proceeded";
  };

  #value() {
    return { name: this.name, reference: this.reference };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#opening = {};
    this.#closed = false;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register({
      id: this,
      parent: (this.getRootNode() as ShadowRoot).host,
      current: () => this.#value(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.busy || (a.name === b.name && a.reference === b.reference),
      restore: (value) => {
        this.name = value.name;
        this.reference = value.reference;
      },
    });
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#opening = {};
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.name = "";
    this.reference = "";
    this.attempted = false;
    this.refusal = "";
    this.busy = false;
    super.disconnectedCallback();
  }

  #cancel(opening: object): void {
    if (opening !== this.#opening || !this.isConnected || this.#closed) return;
    if (this.busy || !this.#scope) this.#close();
    else void this.shadowRoot!.querySelector("wt-dialog")!.requestClose("cancel");
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.requestUpdate();
    this.onClose();
  }

  #onField(
    event: CustomEvent<{ value: string }>,
    field: "name" | "reference",
    opening: object,
  ): void {
    event.stopPropagation();
    if (opening !== this.#opening || !this.isConnected || this.#closed) return;
    this[field] = event.detail.value;
    this.#scope?.changed();
  }

  #fieldErrors(): { name: string; reference: string } {
    if (!this.attempted) return { name: "", reference: "" };
    return {
      name: this.name.trim() === "" ? t("payments.stripe.reader_name_required") : "",
      reference: this.reference.trim() === "" ? t("payments.stripe.reader_id_required") : "",
    };
  }

  async #add(event: Event, opening: object): Promise<void> {
    event.stopPropagation();
    if (this.busy || opening !== this.#opening || !this.isConnected || this.#closed) return;
    const scope = this.#scope;
    const submitted = this.#value();
    const added = this.onAdded;
    this.attempted = true;
    this.refusal = "";
    const errors = this.#fieldErrors();
    if (errors.name !== "" || errors.reference !== "") {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.busy = true;
    scope?.changed();
    try {
      await new StripePaymentsClient(this.request).addReader({
        name: submitted.name,
        reference: submitted.reference,
      });
      if (opening !== this.#opening || !this.isConnected || this.#closed) {
        added();
        return;
      }
      this.busy = false;
      scope?.commit(submitted);
      added();
      if (opening === this.#opening && this.isConnected && !this.#closed && !scope?.isDirty()) {
        this.shadowRoot!.querySelector("wt-dialog")!.closeAfter("saved");
        this.#close();
      }
    } catch (error) {
      if (opening !== this.#opening || !this.isConnected || this.#closed) return;
      this.refusal =
        codeOf(error) === "reader.not_found" || codeOf(error) === "server.internal"
          ? t("payments.stripe.add_failed")
          : codeMessage(codeOf(error));
    } finally {
      if (opening === this.#opening) {
        this.busy = false;
        scope?.changed();
      }
    }
  }

  override render(): TemplateResult {
    return html`${keyed(this.#opening, this.#renderForm())}`;
  }

  #renderForm(): TemplateResult {
    const opening = this.#opening;
    const errors = this.#fieldErrors();
    const blocked = errors.name !== "" || errors.reference !== "";
    return html`
      <wt-dialog
        heading=${t("payments.stripe.add_reader_heading")}
        .open=${!this.#closed}
        .beforeClose=${this.#scope ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (opening === this.#opening) this.#close();
        }}
      >
        <wt-input
          class="field"
          name="name"
          data-test="reader-name"
          label=${t("payments.stripe.reader_name")}
          required
          error=${errors.name}
          .value=${this.name}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "name", opening)}
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
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onField(e, "reference", opening)}
        ></wt-input>
        <wt-form-actions
          slot="footer"
          .error=${[this.refusal, blocked ? t("payments.stripe.fix_fields") : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <wt-button slot="cancel" data-test="cancel" @click=${() => this.#cancel(opening)}
            >${t("payments.stripe.cancel")}</wt-button
          >
          <wt-button
            variant="primary"
            data-test="add"
            ?loading=${this.busy}
            ?disabled=${blocked}
            @click=${(e: Event) => void this.#add(e, opening)}
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
