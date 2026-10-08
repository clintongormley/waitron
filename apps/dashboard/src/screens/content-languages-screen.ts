import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  capitaliseFirst,
  resolveContentText,
  type ContentLanguageRules,
  type ContentLanguages,
} from "@waitron/shared";
import {
  baseStyles,
  formMessage,
  formMessageStyles,
  setContentLanguages,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import type { DashboardApi, LanguageTranslationGaps } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/add-content-language.js";
import "../widgets/content-translations-dialog.js";
import { receiptLanguageWarning } from "../widgets/receipt-language.js";

@customElement("dashboard-content-languages-screen")
export class ContentLanguagesScreen extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      :host {
        display: block;
      }
      .help {
        max-width: 60ch;
        color: var(--wt-color-text-muted);
      }
      wt-card {
        display: block;
        max-width: 60ch;
        margin-top: var(--wt-space-4);
      }
      wt-data-table::part(language-name) {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      wt-data-table::part(language-meta) {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .note {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        margin: var(--wt-space-2) 0 var(--wt-space-3);
      }
      .warning {
        max-width: 60ch;
        margin: var(--wt-space-4) 0 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      .button-group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .card-footer {
        display: flex;
        justify-content: flex-end;
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }
      .card-action {
        min-width: 12ch;
      }
      .card-action.accent-primary::part(button):hover {
        border-color: var(--wt-color-primary);
        color: var(--wt-color-primary);
      }
      .card-action.accent-danger::part(button):hover {
        border-color: var(--wt-color-danger);
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private config: ContentLanguages | null = null;
  @state() private rules: ContentLanguageRules | null = null;
  @state() private loadFailed = false;
  @state() private adding = false;
  @state() private translating = false;
  @state() private translationLanguage = "";
  @state() private busy = false;
  @state() private saveError = "";
  @state() private gaps: LanguageTranslationGaps[] | null = null;
  @state() private gapsFailed = false;
  @state() private receiptLanguage: string | null = null;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadFailed = true;
    },
    () => {
      this.loadFailed = false;
      if (this.#loadStopped) void this.#load();
    },
  );
  #loadStopped = false;
  readonly #gapQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.gapsFailed = true;
    },
  );
  /** Only for the receipt-language warning, so a failed read hides the warning and nothing else. */
  readonly #receiptQueries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.receiptLanguage = null;
    },
  );
  /** How many configurations the server has delivered, so a save can tell whether one arrived while
   * it was in flight. */
  #reads = 0;
  readonly #saveAdded = (config: ContentLanguages) => this.#write(config);

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    void this.#loadGaps();
    void this.#loadReceiptLanguage();
  }

  async #loadReceiptLanguage(): Promise<void> {
    try {
      await this.#receiptQueries.watch("getReceiptLanguage", [], (value) => {
        this.receiptLanguage = value.language;
      });
    } catch {
      this.receiptLanguage = null;
    }
  }

  async #loadGaps(): Promise<void> {
    this.gapsFailed = false;
    try {
      await this.#gapQueries.watch("getContentTranslationGaps", [], (value) => {
        this.gaps = value;
        this.gapsFailed = false;
      });
    } catch {
      this.gapsFailed = true;
    }
  }

  async #load(): Promise<void> {
    this.loadFailed = false;
    this.#loadStopped = false;
    try {
      await this.#queries.watch("getContentLanguageRules", [], (rules) => {
        this.rules = rules;
      });
      await this.#queries.watch("getContentLanguages", [], (value) => {
        this.#reads += 1;
        this.config = value;
        this.loadFailed = false;
        setContentLanguages(value);
      });
    } catch {
      this.#loadStopped = true;
      this.loadFailed = true;
    }
  }

  async #write(requested: ContentLanguages): Promise<void> {
    const reads = this.#reads;
    // The server refuses a list lacking any required language, so a list missing two could never be
    // repaired one addition at a time.
    const missing = (this.rules?.required ?? []).filter(
      (code) => !requested.languages.includes(code),
    );
    const config = { ...requested, languages: [...requested.languages, ...missing] };
    await this.api.updateContentLanguages(config);
    this.saveError = "";
    if (this.#reads === reads) {
      this.config = config;
      setContentLanguages(config);
    } else {
      // A configuration read during the save may predate it or follow it; only a fresh read can say.
      this.api.liveData.invalidate([{ type: "content_languages" }]);
    }
  }

  async #save(defaultLanguage: string, languages: string[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.saveError = "";
    const config = {
      defaultLanguage,
      languages: [defaultLanguage, ...languages.filter((code) => code !== defaultLanguage)],
    };
    try {
      await this.#write(config);
    } catch (error) {
      this.saveError = codeMessage(codeOf(error));
    } finally {
      this.busy = false;
    }
  }

  #renderNotice(config: ContentLanguages, rules: ContentLanguageRules) {
    const notice = rules.foreignLanguageNotice;
    if (!notice) return nothing;
    const foreign = config.languages.filter((code) => !rules.official.includes(code)).length;
    if (foreign >= notice.minimumForeign) return nothing;
    const text = resolveContentText(notice.text, currentLocale(), "en");
    return text
      ? html`<p class="warning" role="note" data-test="foreign-language-notice">${text}</p>`
      : nothing;
  }

  #renderConfig(config: ContentLanguages, rules: ContentLanguageRules) {
    const locale = currentLocale();
    const names = new Intl.DisplayNames([locale], { type: "language" });
    const name = (code: string) => capitaliseFirst(names.of(code)!, locale);
    const collator = new Intl.Collator(locale);
    const others = config.languages
      .filter((code) => code !== config.defaultLanguage)
      .map((code) => ({ code, name: name(code) }))
      .sort((a, b) => collator.compare(a.name, b.name));
    return html`${this.#renderNotice(config, rules)}
      ${this.receiptLanguage === null ? nothing : receiptLanguageWarning(this.receiptLanguage, config)}
      <wt-card>
        <wt-data-table
          data-test="languages"
          aria-label=${t("content_languages.enabled")}
          .rows=${[config.defaultLanguage, ...others.map(({ code }) => code)]}
          .columns=${this.#languageColumns(config, rules)}
          .rowKey=${(code: string) => code}
        ></wt-data-table>
        <p class="note">${t("content_languages.preserve")}</p>
        ${
          this.gapsFailed
            ? html`<p role="alert" data-test="gaps-error">${t("content_gaps.load_error")}</p>
                <wt-button
                  data-test="gaps-retry"
                  variant="secondary"
                  @click=${() => void this.#loadGaps()}
                  >${t("content_languages.retry")}</wt-button
                >`
            : nothing
        }
        ${formMessage(this.saveError)}
        <div class="card-footer">
          <wt-button
            data-test="add-language"
            variant="secondary"
            class="card-action accent-primary"
            ?disabled=${this.busy}
            @click=${() => {
              this.adding = true;
            }}
            >${t("content_languages.add")}</wt-button
          >
        </div>
      </wt-card>
      <dashboard-add-content-language
        .open=${this.adding}
        .config=${config}
        .official=${rules.official}
        .save=${this.#saveAdded}
        @languages-closed=${() => {
          this.adding = false;
        }}
        @languages-saved=${(event: Event) => {
          event.stopPropagation();
          this.adding = false;
        }}
      ></dashboard-add-content-language>`;
  }

  #languageColumns(
    config: ContentLanguages,
    rules: ContentLanguageRules,
  ): DataTableColumn<string>[] {
    const name = (code: string) =>
      capitaliseFirst(
        new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code)!,
        currentLocale(),
      );
    return [
      {
        key: "language",
        label: t("content_languages.language"),
        cell: (code) => html`
          <span part="language-name" class="field-value">${name(code)}</span>
          ${code === config.defaultLanguage ? html`<span part="language-meta">${t("content_languages.default")}</span>` : nothing}
          ${rules.required.includes(code) ? html`<span part="language-meta">${t("content_languages.required")}</span>` : nothing}
        `,
      },
      {
        key: "completeness",
        label: t("content_languages.completeness"),
        cell: (code) => {
          if (this.gapsFailed) return t("content_gaps.load_error");
          const report = this.gaps?.find((entry) => entry.language === code);
          return !report
            ? t("content_gaps.loading")
            : report.gaps.length === 0
              ? t("content_gaps.none")
              : html`${t("content_gaps.count").replace("{count}", String(report.gaps.length))}
                ${rules.required.includes(code) ? html`<span part="language-meta" role="note" data-test=${`required-gaps-${code}`}>${(report.gaps.length === 1 ? t("content_gaps.required_warning_one") : t("content_gaps.required_warning").replace("{count}", String(report.gaps.length))).replace("{language}", new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code)!)}</span>` : nothing}`;
        },
      },
      {
        key: "actions",
        label: t("content_languages.actions"),
        pinned: "end",
        cell: (code) => html`
          <wt-row-actions label=${`${t("content_languages.actions")}: ${name(code)}`}>
            ${
              code === config.defaultLanguage
                ? nothing
                : html`
                    <wt-button
                      align="start"
                      data-test=${`set-default-${code}`}
                      variant="ghost"
                      ?disabled=${this.busy}
                      aria-label=${`${t("content_languages.set_default")}: ${name(code)}`}
                      @click=${() => void this.#save(code, config.languages)}
                      >${t("content_languages.set_default")}</wt-button
                    >
                    ${
                      rules.required.includes(code)
                        ? nothing
                        : html`
                            <wt-button
                              align="start"
                              data-test=${`remove-${code}`}
                              variant="ghost"
                              ?disabled=${this.busy}
                              aria-label=${`${t("content_languages.remove")}: ${name(code)}`}
                              @click=${() =>
                                void this.#save(
                                  config.defaultLanguage,
                                  config.languages.filter((language) => language !== code),
                                )}
                              >${t("content_languages.remove")}</wt-button
                            >
                          `
                    }
                  `
            }
            <wt-button
              align="start"
              data-test=${`edit-translations-${code}`}
              variant="ghost"
              ?disabled=${this.busy}
              @click=${() => {
                this.translationLanguage = code;
                this.translating = true;
              }}
              >${t("content_languages.edit_translations")}</wt-button
            >
          </wt-row-actions>
        `,
      },
    ];
  }

  override render() {
    return html`<h1>${t("content_languages.title")}</h1>
      <p class="help">${t("content_languages.help")}</p>
      ${
        this.loadFailed
          ? html`<p role="alert">${t("content_languages.load_error")}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("content_languages.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.config && this.rules
          ? html`${this.#renderConfig(this.config, this.rules)}
              <dashboard-content-translations-dialog
                .api=${this.api}
                .open=${this.translating}
                .language=${this.translationLanguage}
                @translations-closed=${(event: Event) => {
                  event.stopPropagation();
                  this.translating = false;
                }}
                @translations-saved=${(event: Event) => {
                  event.stopPropagation();
                  this.translating = false;
                  void this.#loadGaps();
                }}
              ></dashboard-content-translations-dialog>`
          : this.loadFailed
            ? nothing
            : html`<p role="status">${t("content_languages.loading")}</p>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-content-languages-screen": ContentLanguagesScreen;
  }
}
