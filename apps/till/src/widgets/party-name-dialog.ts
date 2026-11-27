import { LitElement, css, html, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { styleMap } from "lit/directives/style-map.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
} from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { formMessage, formMessageStyles } from "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import "@waitron/ui/src/components/wt-input.js";
import { PARTY_NAME_MAX, TABLE_SEPARATOR } from "@waitron/shared";
import { PlaceholderFit } from "./fit-placeholder.js";
import { t } from "../i18n/t.js";

export interface PartyNameDetail {
  /** Trimmed; null clears the name. */
  name: string | null;
}

const sameName = (a: string, b: string): boolean => a.trim() === b.trim();

@customElement("till-party-name-dialog")
export class TillPartyNameDialog extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      .fields {
        margin: var(--wt-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: calc(100% - 2 * var(--wt-space-4));
      }

      .form-message {
        padding-inline: var(--wt-space-4);
      }
    `,
  ];

  /** The party's tables, as the heading names them. */
  @property() tables = "";
  @property() backLabel = "";
  @property({ attribute: false }) panelInset = 0;
  @property() value = "";
  @property({ attribute: false }) savedValue: string | undefined;
  @property() refusal = "";

  @state() private attempted = false;
  readonly #placeholder = new PlaceholderFit(this, () => this.tables, TABLE_SEPARATOR);

  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #baseline?: string;
  #storedChanged = false;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("savedValue")) this.#storedChanged = true;
    if (!this.isConnected || !this.active) return;
    if (!this.#scope) this.#track();
    if (this.#storedChanged) this.#followStored();
  }

  #track(): void {
    this.#baseline ??= this.savedValue ?? this.value;
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: sameName,
      restore: (value) => (this.value = value),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
  }

  /** A name stored elsewhere while the window is open becomes what Save compares against, and
   * replaces the field only while the field still reads the previous stored name. */
  #followStored(): void {
    this.#storedChanged = false;
    const stored = this.savedValue;
    if (stored === undefined || sameName(stored, this.#baseline!)) return;
    if (sameName(this.value, this.#baseline!)) this.value = stored;
    this.#baseline = stored;
    this.#scope!.commit(stored);
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
    if (saveActionState(this.#scope).unchanged) return;
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
    const saveAction = saveActionState(this.#scope);
    const title = t("table.name_title").replace("{tables}", () => this.tables);
    return html`<wt-dialog
      ${trackDialog()}
      full-screen
      style=${styleMap({ "--wt-dialog-inset-inline-start": `${this.panelInset}px` })}
      aria-label=${title}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <wt-full-screen-panel body-label=${title}>
        <wt-top-bar
          slot="header"
          .heading=${t("table.name_panel_title")}
          .backLabel=${this.backLabel || t("action.back")}
          @wt-back=${() => void this.renderRoot.querySelector("wt-dialog")!.requestClose("navigation")}
        ></wt-top-bar>
        <div class="fields">
          <wt-input
            name="partyName"
            autocomplete="off"
            .maxlength=${PARTY_NAME_MAX}
            .label=${t("table.name_label")}
            .inherited=${{ value: this.#placeholder.placeholder, suffix: t("inherit.suffix") }}
            .value=${live(this.value)}
            .error=${error}
            @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
            @keydown=${(event: KeyboardEvent) =>
              submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-name-save]"))}
          ></wt-input>
        </div>
        <div slot="footer">
          ${formMessage(error === "" ? "" : t("form.fix_fields"))}
          <wt-foot-button-bar>
            <wt-button
              data-name-save
              variant=${saveAction.variant}
              ?disabled=${saveAction.unchanged || (this.attempted && this.#tooLong())}
              @click=${() => void this.#save()}
            >
              ${t("table.name_save")}
            </wt-button>
          </wt-foot-button-bar>
        </div>
      </wt-full-screen-panel>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-party-name-dialog": TillPartyNameDialog;
  }
}
