import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { languageDisplayName } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";

export interface ReprintLanguageDetail {
  language: string;
}

/**
 * Asks which receipt language a copy of an issued receipt prints in.
 * The dialog only reports the choice.
 */
@customElement("till-reprint-language-dialog")
export class TillReprintLanguageDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .choice {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }

      .choice legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .options {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }
    `,
  ];

  /** The receipt languages the venue's country offers. */
  @property({ attribute: false }) languages: string[] = [];
  /** The language the question starts on; the first of {@link languages} when it is not one of them. */
  @property() defaultLanguage = "";

  @state() private chosen = "";

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("languages") || changed.has("defaultLanguage")) {
      this.chosen = this.languages.includes(this.defaultLanguage)
        ? this.defaultLanguage
        : (this.languages[0] ?? "");
    }
  }

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>("input:checked")?.focus();
  }

  #confirm(): void {
    this.dispatchEvent(
      new CustomEvent<ReprintLanguageDetail>("reprint-language-confirm", {
        detail: { language: this.chosen },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    this.dispatchEvent(
      new CustomEvent("reprint-language-cancel", { bubbles: true, composed: true }),
    );
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("reprint_language.title")}
      @wt-close=${() => this.#cancel()}
    >
      <fieldset class="choice">
        <legend>${t("reprint_language.legend")}</legend>
        <div class="options">
          ${this.languages.map(
            (language) =>
              html`<label class="option">
                <input
                  type="radio"
                  name="language"
                  .value=${language}
                  .checked=${this.chosen === language}
                  @change=${() => (this.chosen = language)}
                />
                <span>${languageDisplayName(language, currentLocale())}</span>
              </label>`,
          )}
        </div>
      </fieldset>
      <wt-button
        slot="footer"
        data-reprint-cancel
        variant="secondary"
        @click=${() => this.#cancel()}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        data-reprint-confirm
        variant="primary"
        @click=${() => this.#confirm()}
      >
        ${t("action.reprint")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-reprint-language-dialog": TillReprintLanguageDialog;
  }
}
