import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { contentLanguageChoices, type ContentLanguages } from "@waitron/shared";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

@customElement("dashboard-content-languages")
export class ContentLanguageEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      label,
      .error {
        max-width: var(--wt-field-max-width);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-4);
      }
      select {
        font: inherit;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        min-height: var(--wt-tap-min);
      }
      ul {
        list-style: none;
        padding: 0;
      }
      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) config!: ContentLanguages;
  @property({ attribute: false }) api!: {
    updateContentLanguages(config: ContentLanguages): Promise<void>;
  };
  @state() private languages: string[] = [];
  @state() private defaultLanguage = "";
  @state() private additionalLanguage = "";
  @state() private busy = false;
  @state() private error: string | null = null;
  /** A refused save's reason when it is about the chosen default language. */
  @state() private defaultError = "";
  @state() private addError = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) {
      this.languages = [...this.config.languages];
      this.defaultLanguage = this.config.defaultLanguage;
      this.additionalLanguage = "";
      this.error = null;
      this.defaultError = "";
      this.addError = false;
    }
  }

  #close(): void {
    if (this.busy || !this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("languages-closed", { bubbles: true, composed: true }));
  }

  #add(): void {
    if (this.busy) return;
    this.addError = this.additionalLanguage === "";
    if (this.addError) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.languages = [...this.languages, this.additionalLanguage];
    this.additionalLanguage = "";
  }

  async #save(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.defaultError = "";
    const config = {
      defaultLanguage: this.defaultLanguage,
      languages: [
        this.defaultLanguage,
        ...this.languages.filter((code) => code !== this.defaultLanguage),
      ],
    };
    try {
      await this.api.updateContentLanguages(config);
      this.open = false;
      this.dispatchEvent(
        new CustomEvent("languages-saved", { detail: config, bubbles: true, composed: true }),
      );
    } catch (error) {
      const code = codeOf(error);
      if (code === "content.default_missing") {
        this.defaultError = codeMessage(code);
        void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      } else this.error = code;
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const choices = contentLanguageChoices(currentLocale());
    const names = new Intl.DisplayNames([currentLocale()], { type: "language" });
    return html`<wt-modal
      .open=${this.open}
      heading=${t("content_languages.title")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
    >
      <p>${t("content_languages.help")}</p>
      <label
        >${t("content_languages.default")} *
        <select
          name="default-language"
          required
          ?disabled=${this.busy}
          aria-invalid=${this.defaultError ? "true" : "false"}
          aria-describedby=${this.defaultError ? "default-language-error" : nothing}
          @change=${(event: Event) => {
            this.defaultLanguage = (event.target as HTMLSelectElement).value;
            this.defaultError = "";
          }}
        >
          ${this.languages.map((code) => html`<option value=${code} ?selected=${code === this.defaultLanguage}>${names.of(code)}</option>`)}
        </select>
      </label>
      ${this.defaultError ? html`<p class="error" id="default-language-error">${this.defaultError}</p>` : nothing}
      <ul aria-label=${t("content_languages.enabled")}>
        ${this.languages.map(
          (code) =>
            html`<li>
              <span>${names.of(code)}</span
              ><wt-button
                data-test=${`remove-${code}`}
                variant="secondary"
                ?disabled=${this.busy || code === this.defaultLanguage}
                aria-label=${`${t("content_languages.remove")}: ${names.of(code)}`}
                @click=${() => {
                  this.languages = this.languages.filter((language) => language !== code);
                }}
                >${t("content_languages.remove")}</wt-button
              >
            </li>`,
        )}
      </ul>
      <p>${t("content_languages.preserve")}</p>
      <label
        >${t("content_languages.add")}
        <select
          name="additional-language"
          ?disabled=${this.busy}
          aria-invalid=${this.addError}
          aria-describedby=${this.addError ? "language-error" : nothing}
          @change=${(event: Event) => {
            this.additionalLanguage = (event.target as HTMLSelectElement).value;
            this.addError = false;
          }}
        >
          <option value="" ?selected=${this.additionalLanguage === ""}>
            ${t("content_languages.choose")}
          </option>
          ${choices.filter(({ code }) => !this.languages.includes(code)).map(({ code, name }) => html`<option value=${code} ?selected=${code === this.additionalLanguage}>${name}</option>`)}
        </select>
      </label>
      ${this.addError ? html`<p class="error" id="language-error">${t("content_languages.choose")}</p>` : nothing}
      <wt-button
        data-test="add-language"
        variant="secondary"
        ?disabled=${this.busy || this.addError}
        @click=${() => this.#add()}
        >${t("content_languages.add")}</wt-button
      >
      <wt-form-actions
        slot="footer"
        .error=${this.error ? codeMessage(this.error) : this.defaultError ? t("form.fix_fields") : ""}
      >
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save-languages"
          variant="primary"
          ?disabled=${this.busy}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-languages": ContentLanguageEditor;
  }
}
