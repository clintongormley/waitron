import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { contentLanguageChoices, type ContentLanguages } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

@customElement("dashboard-add-content-language")
export class AddContentLanguageDialog extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      select {
        min-height: var(--wt-tap-min);
      }
      .error {
        max-width: var(--wt-field-max-width);
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) config!: ContentLanguages;
  @property({ attribute: false }) save!: (config: ContentLanguages) => Promise<void>;
  /** Offered first, in a group of their own, when any is not yet enabled. */
  @property({ attribute: false }) official: readonly string[] = [];
  @state() private language = "";
  @state() private busy = false;
  @state() private attempted = false;
  @state() private error: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) {
      this.language = "";
      this.attempted = false;
      this.error = null;
    }
    if (changed.has("config") && this.config.languages.includes(this.language)) {
      this.language = "";
    }
  }

  #close(): void {
    if (this.busy || !this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("languages-closed", { bubbles: true, composed: true }));
  }

  async #add(): Promise<void> {
    if (this.busy) return;
    this.attempted = true;
    this.error = null;
    if (this.config.languages.includes(this.language)) this.language = "";
    if (this.language === "") {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.busy = true;
    const config = {
      defaultLanguage: this.config.defaultLanguage,
      languages: [...this.config.languages, this.language],
    };
    try {
      await this.save(config);
      this.open = false;
      this.dispatchEvent(new CustomEvent("languages-saved", { bubbles: true, composed: true }));
    } catch (error) {
      this.error = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const missing = this.attempted && this.language === "";
    const choices = contentLanguageChoices(currentLocale()).filter(
      ({ code }) => !this.config.languages.includes(code),
    );
    const official = choices.filter(({ code }) => this.official.includes(code));
    const option = ({ code, name }: { code: string; name: string }) =>
      html`<option value=${code} .selected=${code === this.language}>${name}</option>`;
    return html`<wt-modal
      .open=${this.open}
      heading=${t("content_languages.add")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
    >
      <label
        >${t("content_languages.language")} *
        <select
          name="language"
          required
          ?disabled=${this.busy}
          aria-invalid=${missing ? "true" : "false"}
          aria-describedby=${missing ? "language-error" : nothing}
          @change=${(event: Event) => {
            this.language = (event.target as HTMLSelectElement).value;
          }}
        >
          <option value="" .selected=${this.language === ""}>
            ${t("content_languages.choose")}
          </option>
          ${
            official.length === 0
              ? choices.map(option)
              : html`<optgroup label=${t("content_languages.official_group")}>
                    ${official.map(option)}
                  </optgroup>
                  <optgroup label=${t("content_languages.other_group")}>
                    ${choices.filter(({ code }) => !this.official.includes(code)).map(option)}
                  </optgroup>`
          }
        </select>
      </label>
      ${missing ? html`<p class="error" id="language-error">${t("content_languages.choose")}</p>` : nothing}
      <wt-form-actions
        slot="footer"
        .error=${this.error ? codeMessage(this.error) : missing ? t("form.fix_fields") : ""}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save-language"
          variant="primary"
          ?disabled=${this.busy || missing}
          @click=${() => void this.#add()}
          >${t("action.add")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-add-content-language": AddContentLanguageDialog;
  }
}
