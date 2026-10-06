import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { PARTY_NAME_MAX } from "@waitron/shared";
import { t } from "../i18n/t.js";

export interface PartyNameDetail {
  /** Trimmed; null clears the name. */
  name: string | null;
}

@customElement("till-party-name-dialog")
export class TillPartyNameDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
    `,
  ];

  /** The party's tables, as the heading names them. */
  @property() tables = "";
  @property() value = "";
  @property({ attribute: false }) savedValue: string | undefined;
  @property() refusal = "";

  @state() private attempted = false;

  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #baseline?: string;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.active || this.#scope) return;
    this.#baseline ??= this.savedValue ?? this.value;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<string>({
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => a.trim() === b.trim(),
      restore: (value) => (this.value = value),
    });
    this.#scope?.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("wt-input")!.focus();
  }

  #tooLong(): boolean {
    return this.value.trim().length > PARTY_NAME_MAX;
  }

  #fieldError(): string {
    if (this.attempted && this.#tooLong()) return t("table.name_too_long");
    return this.refusal;
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.value = event.detail.value;
    this.#scope?.changed();
    this.refusal = "";
  }

  async #save(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    this.attempted = true;
    this.refusal = "";
    if (this.#tooLong()) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#baseline = this.value;
    this.#scope?.commit(this.value);
    const trimmed = this.value.trim();
    this.dispatchEvent(
      new CustomEvent<PartyNameDetail>("party-name-confirm", {
        detail: { name: trimmed === "" ? null : trimmed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#reportClose();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportClose();
  }

  #reportClose(): void {
    this.dispatchEvent(new CustomEvent("party-name-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const error = this.#fieldError();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t("table.name_title").replace("{tables}", () => this.tables)}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-input
          name="partyName"
          autocomplete="off"
          .maxlength=${PARTY_NAME_MAX}
          .label=${t("table.name_label")}
          .hint=${t("table.name_hint")}
          .value=${live(this.value)}
          .error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-name-save]"))}
        ></wt-input>
        <wt-form-actions .error=${error === "" ? "" : t("form.fix_fields")}>
          <wt-button
            slot="cancel"
            data-name-cancel
            variant="secondary"
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-name-save
            variant="primary"
            ?disabled=${this.attempted && this.#tooLong()}
            @click=${() => void this.#save()}
          >
            ${t("table.name_save")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-party-name-dialog": TillPartyNameDialog;
  }
}
