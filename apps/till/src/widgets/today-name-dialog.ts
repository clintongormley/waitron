import { LitElement, css, html } from "lit";
import type { PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
  MAP_SEPARATOR,
} from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { PARTY_NAME_MAX } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { PlaceholderFit } from "./fit-placeholder.js";

export interface TodayNameDetail {
  /** Trimmed; null goes back to the normal name. */
  name: string | null;
}

export interface TodayNameRefusal {
  code: string;
  field?: string;
}

@customElement("till-today-name-dialog")
export class TillTodayNameDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
    `,
  ];

  @property() heading = "";
  /** Today's name, empty when the table or group has none. */
  @property() value = "";
  /** What the table or group is called with no name of its own today. */
  @property() normalName = "";
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal: TodayNameRefusal | null = null;

  @state() private attempted = false;
  readonly #placeholder = new PlaceholderFit(this, () => this.normalName, MAP_SEPARATOR);
  @state() private refusalDismissed = false;
  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #baseline?: string;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("refusal")) this.refusalDismissed = false;
    if (!this.isConnected || !this.active || this.#scope) return;
    this.#baseline ??= this.value;
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => a.trim() === b.trim(),
      restore: (value) => (this.value = value),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
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

  /** Marks the sent name saved, so the holder can close the window without the leave question. */
  commit(): void {
    if (!this.isConnected || !this.active) return;
    this.#baseline = this.value;
    this.#scope?.commit(this.#baseline);
  }

  #tooLong(): boolean {
    return this.value.trim().length > PARTY_NAME_MAX;
  }

  #refusalText(): string {
    if (this.refusal === null || this.refusalDismissed) return "";
    if (this.refusal.field === "name" && this.refusal.code === "management.request_invalid")
      return t("table.name_too_long");
    return codeMessage(this.refusal.code);
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy) return;
    this.value = event.detail.value;
    this.refusalDismissed = true;
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusalDismissed = true;
    if (this.#tooLong()) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const trimmed = this.value.trim();
    this.dispatchEvent(
      new CustomEvent<TodayNameDetail>("today-name-confirm", {
        detail: { name: trimmed === "" ? null : trimmed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("today-name-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const refusalText = this.#refusalText();
    const tooLong = this.attempted && this.#tooLong();
    const fieldError = tooLong
      ? t("table.name_too_long")
      : this.refusal?.field === "name"
        ? refusalText
        : "";
    const footError = fieldError !== "" ? t("form.fix_fields") : refusalText;
    const saveAction = saveActionState(this.#scope);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : () => Promise.resolve(!this.busy)}
      .heading=${this.heading}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-input
          name="todayName"
          autocomplete="off"
          .maxlength=${PARTY_NAME_MAX}
          .label=${t("floor.rename_label")}
          .placeholder=${this.#placeholder.placeholder}
          .value=${live(this.value)}
          .disabled=${this.busy}
          .error=${fieldError}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-rename-save]"))}
        ></wt-input>
        <wt-form-actions .error=${footError}>
          <wt-button
            slot="cancel"
            data-rename-cancel
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-rename-save
            variant=${saveAction.variant}
            ?disabled=${this.busy || saveAction.unchanged || tooLong}
            @click=${() => void this.#save()}
          >
            ${t("floor.rename_save")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-today-name-dialog": TillTodayNameDialog;
  }
}
