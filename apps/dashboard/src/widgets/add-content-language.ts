import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { contentLanguageChoices, type ContentLanguages } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

@customElement("dashboard-add-content-language")
export class AddContentLanguageDialog extends LitElement {
  static override styles = [baseStyles];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) config!: ContentLanguages;
  @property({ attribute: false }) save!: (config: ContentLanguages) => Promise<void>;
  /** Offered first, in a group of their own, when any is not yet enabled. */
  @property({ attribute: false }) official: readonly string[] = [];
  @state() private language = "";
  @state() private busy = false;
  @state() private error: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") && this.open) {
      this.language = "";
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
    this.error = null;
    if (this.config.languages.includes(this.language)) this.language = "";
    if (this.language === "") return;
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
    const choices = contentLanguageChoices(currentLocale()).filter(
      ({ code }) => !this.config.languages.includes(code),
    );
    const official = choices.filter(({ code }) => this.official.includes(code));
    const grouped = official.length > 0;
    const options = [
      ...official.map(({ code, name }) => ({
        value: code,
        label: name,
        group: t("content_languages.official_group"),
      })),
      ...choices
        .filter(({ code }) => !grouped || !this.official.includes(code))
        .map(({ code, name }) => ({
          value: code,
          label: name,
          ...(grouped ? { group: t("content_languages.other_group") } : {}),
        })),
    ];
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
      <wt-combobox
        name="language"
        label=${t("content_languages.language")}
        required
        search="auto"
        placeholder=${t("content_languages.choose")}
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${options}
        .value=${this.language}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.language = event.detail.value;
          if (this.language) void this.#add();
        }}
      ></wt-combobox>
      <wt-form-actions slot="footer" .error=${this.error ? codeMessage(this.error) : ""}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#close()}
          >${t("action.cancel")}</wt-button
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
