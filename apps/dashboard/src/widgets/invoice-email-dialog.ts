import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import { isValidEmail } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

/** Asks for the customer's address and emails a bill's full invoice to it. On success it sends a
 *  bubbling, composed `invoice-email-requested` carrying the bill's id. */
@customElement("dashboard-invoice-email-dialog")
export class InvoiceEmailDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      wt-input {
        display: block;
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      wt-dialog {
        --wt-field-max-width: var(--wt-form-max-width);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  /** The bill being emailed; null while the dialog is shut. */
  @state() private orderId: string | null = null;
  @state() private copy = false;
  @state() private value = "";
  @state() private busy = false;
  @state() private attempted = false;
  /** A refusal of the address, kept until the field changes or Send is pressed again. */
  @state() private refusal = "";
  @state() private bottom = "";

  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #opening = 0;

  show(orderId: string, copy = false): void {
    if (this.orderId !== null) return;
    this.#opening += 1;
    this.orderId = orderId;
    this.copy = copy;
    this.value = "";
    this.busy = false;
    this.attempted = false;
    this.refusal = "";
    this.bottom = "";
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: {},
      current: () => this.value.trim(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.value = value;
        this.refusal = "";
        this.bottom = "";
        this.attempted = false;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit("");
    void this.#focusField();
  }

  /** Closes without asking, for an order detail that closed or moved to another bill. */
  dismiss(): void {
    if (this.orderId !== null) this.#close();
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  #close(): void {
    this.#opening += 1;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.orderId = null;
    this.busy = false;
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  #ownError(): string {
    return this.attempted && !isValidEmail(this.value) ? t("receipts.invalid_email") : "";
  }

  #change(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.busy) return;
    this.value = event.detail.value;
    this.refusal = "";
    this.bottom = "";
    this.#scope?.changed();
  }

  async #send(): Promise<void> {
    const id = this.orderId;
    if (id === null || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusal = "";
    this.bottom = "";
    if (this.#ownError()) {
      await this.#focusField();
      return;
    }
    const recipient = this.value.trim();
    const opening = this.#opening;
    this.busy = true;
    try {
      await this.api.requestOrderEmailDelivery(id, recipient, crypto.randomUUID());
      if (opening !== this.#opening) return;
      this.dispatchEvent(
        new CustomEvent("invoice-email-requested", {
          detail: { id },
          bubbles: true,
          composed: true,
        }),
      );
      this.#dialog()?.closeAfter("saved");
      this.#close();
    } catch (error) {
      if (opening !== this.#opening) return;
      this.busy = false;
      const params = (error as { params?: { field?: unknown } } | undefined)?.params;
      if (codeOf(error) === "management.request_invalid" && params?.field === "recipient") {
        this.refusal = t("receipts.invalid_email");
        await this.#focusField();
      } else this.bottom = codeMessage(codeOf(error));
    }
  }

  async #focusField(): Promise<void> {
    await this.updateComplete;
    this.#dialog()?.querySelector<HTMLElement>("wt-input[name=email]")?.focus();
  }

  override render(): TemplateResult {
    const open = this.orderId !== null;
    const fieldError = this.refusal || this.#ownError();
    const bottom = [this.bottom, fieldError ? t("form.fix_fields") : ""].filter(Boolean).join(" ");
    const action = saveActionState(this.#scope);
    return html`<wt-dialog
      data-test="invoice-email-dialog"
      heading=${t(this.copy ? "orders.email_copy" : "orders.email")}
      .open=${open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${
        open
          ? html`<wt-input
              name="email"
              type="email"
              autocomplete="off"
              required
              label=${t("orders.email.address")}
              .value=${this.value}
              .error=${fieldError}
              ?disabled=${this.busy}
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(
                  event,
                  this.renderRoot.querySelector<HTMLElement>("[data-test=send-email]"),
                )}
              @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(event)}
            ></wt-input>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-email"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="send-email"
          variant=${action.variant}
          ?loading=${this.busy}
          ?disabled=${action.unchanged || this.#ownError() !== ""}
          @click=${() => void this.#send()}
          >${t("orders.email.send")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-invoice-email-dialog": InvoiceEmailDialog;
  }
}
