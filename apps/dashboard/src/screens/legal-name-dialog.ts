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
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

const REFUSALS: Record<string, StringKey> = {
  required: "venue_details.required",
  unchanged: "venue_details.legal_name_unchanged",
  fiscal_format: "venue_details.legal_name_format",
};

export interface VenueIdentityChanged {
  model: VenueDetailsModel;
}

/** Renames the taxpayer. On success it sends a bubbling, composed `venue-identity-changed`
 *  carrying the answered model, so the panel and the dashboard banner can show the new name. */
@customElement("dashboard-legal-name-dialog")
export class LegalNameDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .note {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;

  /** The name the dialog opened with; null while it is shut. */
  @state() private opened: string | null = null;
  @state() private value = "";
  @state() private busy = false;
  @state() private attempted = false;
  /** A refusal's sentence for the field, kept until the field changes or Save is pressed again. */
  @state() private refusal = "";
  @state() private bottom = "";

  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #opening = 0;

  show(legalName: string): void {
    if (this.opened !== null) return;
    this.#opening += 1;
    this.opened = legalName;
    this.value = legalName;
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
    scope.commit(legalName);
  }

  /** Closes without asking. For a page that hides this dialog's host: a native modal left open
   *  out of sight still blocks every click on the page. */
  dismiss(): void {
    if (this.opened !== null) this.#close();
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
    this.opened = null;
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
    return this.attempted && this.value.trim() === "" ? t("venue_details.required") : "";
  }

  #change(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.opened === null || this.busy) return;
    this.value = event.detail.value;
    this.refusal = "";
    this.bottom = "";
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    const expected = this.opened;
    if (expected === null || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusal = "";
    this.bottom = "";
    if (this.#ownError()) {
      await this.#focusField();
      return;
    }
    const legalName = this.value.trim();
    const opening = this.#opening;
    this.busy = true;
    try {
      const { model } = await this.api.renameTaxpayer({ legalName, expected });
      if (opening !== this.#opening) return;
      this.#scope?.commit(legalName);
      this.dispatchEvent(
        new CustomEvent<VenueIdentityChanged>("venue-identity-changed", {
          detail: { model },
          bubbles: true,
          composed: true,
        }),
      );
      this.#dialog()?.closeAfter("saved");
      this.#close();
    } catch (error) {
      if (opening !== this.#opening) return;
      this.busy = false;
      const code = codeOf(error);
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: Record<string, unknown> }).params
          : undefined;
      if (code === "venue.detail_invalid" && params?.field === "legalName") {
        this.refusal = t(REFUSALS[String(params.reason)] ?? "venue_details.invalid");
        await this.#focusField();
      } else {
        this.bottom =
          code === "venue.detail_changed"
            ? t("venue_details.legal_name_changed")
            : codeMessage(code);
      }
    }
  }

  async #focusField(): Promise<void> {
    await this.updateComplete;
    this.#dialog()?.querySelector<HTMLElement>("wt-input[name=legalName]")?.focus();
  }

  override render(): TemplateResult {
    const open = this.opened !== null;
    const fieldError = this.refusal || this.#ownError();
    const bottom = [this.bottom, fieldError ? t("form.fix_fields") : ""].filter(Boolean).join(" ");
    const action = saveActionState(this.#scope);
    return html`<wt-dialog
      data-test="legal-name-dialog"
      heading=${t("venue_details.change_legal_name")}
      .open=${open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${
        open
          ? html`<wt-input
                name="legalName"
                required
                label=${t("venue_details.legal_name")}
                .value=${this.value}
                .error=${fieldError}
                ?disabled=${this.busy}
                @keydown=${(event: KeyboardEvent) =>
                  submitOnEnter(
                    event,
                    this.renderRoot.querySelector<HTMLElement>("[data-test=save-legal-name]"),
                  )}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(event)}
              ></wt-input>
              <p class="note">${t("venue_details.legal_name_note")}</p>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-legal-name"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save-legal-name"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.busy || this.#ownError() !== ""}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-legal-name-dialog": LegalNameDialog;
  }
}
