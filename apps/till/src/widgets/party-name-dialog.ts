import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { PARTY_NAME_MAX } from "@waitron/shared";
import { t } from "../i18n/t.js";

export interface PartyNameDetail {
  /** Trimmed; null clears the name. */
  name: string | null;
}

/**
 * Names the party, or clears its name. The field is optional; the dialog checks the length the server
 * allows before reporting the name, and shows `refusal`, a server's refusal of the field, under it.
 */
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
  @property() refusal = "";

  @state() private attempted = false;

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

  #onInput(value: string): void {
    this.value = value;
    this.refusal = "";
  }

  async #save(): Promise<void> {
    this.attempted = true;
    this.refusal = "";
    if (this.#tooLong()) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
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
    this.dispatchEvent(new CustomEvent("party-name-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const error = this.#fieldError();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("table.name_title").replace("{tables}", () => this.tables)}
      @wt-close=${() => this.#cancel()}
    >
      <div class="fields">
        <wt-input
          name="partyName"
          autocomplete="off"
          .maxlength=${PARTY_NAME_MAX}
          .label=${t("table.name_label")}
          .hint=${t("table.name_hint")}
          .value=${this.value}
          .error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event.detail.value)}
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
