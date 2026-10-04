import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { tableNoMatches } from "@waitron/dashboard-kit";
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
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import type {
  DashboardApi,
  LanguageTranslationGaps,
  TranslationGap,
  TranslationGapKind,
  TranslationGapReason,
} from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/add-content-language.js";
import { receiptLanguageWarning } from "../widgets/receipt-language.js";

const GAP_KINDS: readonly TranslationGapKind[] = [
  "product",
  "variant",
  "option_list",
  "option_label",
  "extra_list",
  "menu",
  "section",
  "unit",
];
const GAP_REASONS: readonly TranslationGapReason[] = ["partial", "absent"];

/** A variant, an option and a section are named after what holds them, as their editors show them. */
function gapLabel(gap: TranslationGap): string {
  return gap.parent && gap.kind !== "menu" ? `${gap.parent.name} › ${gap.name}` : gap.name;
}

/** No address opens one option, one section or one unit, so each links to the screen that holds it. */
function gapHref(gap: TranslationGap): string {
  const id = encodeURIComponent(gap.id);
  const parent = encodeURIComponent(gap.parent?.id ?? "");
  switch (gap.kind) {
    case "product":
    case "variant":
      return `/manage/catalogue/product/${id}`;
    case "option_list":
      return `/manage/modifiers/view/options/list/${id}`;
    case "option_label":
      return `/manage/modifiers/view/options/list/${parent}`;
    case "extra_list":
      return `/manage/modifiers/view/extras/list/${id}`;
    case "menu":
    case "section":
      return `/manage/menus/menu/${parent}/view/structure`;
    case "unit":
      return "/manage/units";
  }
}

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
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .action-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding-block: var(--wt-space-3);
      }
      .action-row + .action-row {
        border-top: 1px solid var(--wt-color-border);
      }
      .text {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      .field-value {
        color: var(--wt-color-text);
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .field-meta,
      .note {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .note {
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
      .gaps {
        margin-top: var(--wt-space-6);
      }
      .gaps h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .gaps .warning {
        margin-bottom: var(--wt-space-3);
      }
      .gaps .error {
        color: var(--wt-color-danger);
      }
      .gaps wt-disclosure {
        margin-top: var(--wt-space-2);
      }
      .complete {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      wt-data-table::part(gap-link) {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
        color: var(--wt-color-primary);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private config: ContentLanguages | null = null;
  @state() private rules: ContentLanguageRules | null = null;
  @state() private loadFailed = false;
  @state() private adding = false;
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
    const required = (code: string) => rules.required.includes(code);
    const requiredMeta = (code: string) =>
      required(code)
        ? html`<span class="field-meta">${t("content_languages.required")}</span>`
        : nothing;
    return html`${this.#renderNotice(config, rules)}
      ${this.receiptLanguage === null ? nothing : receiptLanguageWarning(this.receiptLanguage, config)}
      <wt-card>
        <ul data-test="languages" aria-label=${t("content_languages.enabled")}>
          <li class="action-row">
            <div class="text">
              <span class="field-value">${name(config.defaultLanguage)}</span>
              <span class="field-meta">${t("content_languages.default")}</span>
              ${requiredMeta(config.defaultLanguage)}
            </div>
          </li>
          ${others.map(
            ({ code, name }) =>
              html`<li class="action-row">
                <div class="text">
                  <span class="field-value">${name}</span>
                  ${requiredMeta(code)}
                </div>
                <div class="button-group">
                  <wt-button
                    data-test=${`set-default-${code}`}
                    variant="secondary"
                    class="card-action accent-primary"
                    ?disabled=${this.busy}
                    aria-label=${`${t("content_languages.set_default")}: ${name}`}
                    @click=${() => void this.#save(code, config.languages)}
                    >${t("content_languages.set_default")}</wt-button
                  >
                  ${
                    required(code)
                      ? nothing
                      : html`<wt-button
                          data-test=${`remove-${code}`}
                          variant="secondary"
                          class="card-action accent-danger"
                          ?disabled=${this.busy}
                          aria-label=${`${t("content_languages.remove")}: ${name}`}
                          @click=${() =>
                            void this.#save(
                              config.defaultLanguage,
                              config.languages.filter((language) => language !== code),
                            )}
                          >${t("content_languages.remove")}</wt-button
                        >`
                  }
                </div>
              </li>`,
          )}
        </ul>
        <p class="note">${t("content_languages.preserve")}</p>
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

  #gapColumns(gaps: readonly TranslationGap[]): DataTableColumn<TranslationGap>[] {
    const kinds = GAP_KINDS.filter((kind) => gaps.some((gap) => gap.kind === kind));
    const reasons = GAP_REASONS.filter((reason) => gaps.some((gap) => gap.reason === reason));
    const kindText = (gap: TranslationGap) => t(`content_gaps.kind_${gap.kind}`);
    const reasonText = (gap: TranslationGap) => t(`content_gaps.${gap.reason}`);
    return [
      {
        key: "name",
        label: t("content_gaps.name"),
        searchValue: gapLabel,
        sortValue: gapLabel,
        cell: gapLabel,
      },
      {
        key: "kind",
        label: t("content_gaps.kind"),
        choosable: "shown",
        sortValue: kindText,
        cell: kindText,
        filter: {
          label: t("content_gaps.kind"),
          allLabel: t("content_gaps.kind_all"),
          value: (gap) => gap.kind,
          options: kinds.map((kind) => ({ value: kind, label: t(`content_gaps.kind_${kind}`) })),
        },
      },
      {
        key: "reason",
        label: t("content_gaps.reason"),
        choosable: "shown",
        sortValue: reasonText,
        cell: reasonText,
        filter: {
          label: t("content_gaps.reason"),
          allLabel: t("content_gaps.reason_all"),
          value: (gap) => gap.reason,
          options: reasons.map((reason) => ({ value: reason, label: t(`content_gaps.${reason}`) })),
        },
      },
      // A real link rather than `rowClick`, so a row can be opened in a new tab.
      {
        key: "open",
        label: t("content_gaps.open"),
        pinned: "end",
        cell: (gap) =>
          html`<a
            part="gap-link"
            href=${gapHref(gap)}
            aria-label=${t("content_gaps.open_named").replace("{name}", gapLabel(gap))}
            @click=${(event: MouseEvent) => this.#openGap(event, gap)}
            >${t("content_gaps.open")}</a
          >`,
      },
    ];
  }

  /** A product opens in the dashboard's own catalogue screen; a held modifier key keeps the
   * browser's own handling, such as opening a new tab. */
  #openGap(event: MouseEvent, gap: TranslationGap): void {
    if (gap.kind !== "product" && gap.kind !== "variant") return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId: gap.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #renderGaps(config: ContentLanguages, rules: ContentLanguageRules) {
    const locale = currentLocale();
    const names = new Intl.DisplayNames([locale], { type: "language" });
    const heading = (code: string) => capitaliseFirst(names.of(code)!, locale);
    const collator = new Intl.Collator(locale);
    const required = (code: string) => rules.required.includes(code);
    const rank = (code: string) => (required(code) ? 0 : code === config.defaultLanguage ? 1 : 2);
    const entries = (this.gaps ?? [])
      .filter((entry) => config.languages.includes(entry.language))
      .sort(
        (a, b) =>
          rank(a.language) - rank(b.language) ||
          collator.compare(heading(a.language), heading(b.language)),
      );
    const warnings = entries.filter((entry) => required(entry.language) && entry.gaps.length > 0);
    return html`<section class="gaps" data-test="missing-translations" aria-labelledby="gaps-title">
      <h2 id="gaps-title">${t("content_gaps.title")}</h2>
      <p class="help">${t("content_gaps.help")}</p>
      ${warnings.map(
        (entry) =>
          html`<p class="warning" role="note" data-test=${`required-gaps-${entry.language}`}>
            ${(entry.gaps.length === 1
              ? t("content_gaps.required_warning_one")
              : t("content_gaps.required_warning").replace("{count}", String(entry.gaps.length))
            ).replace("{language}", names.of(entry.language)!)}
          </p>`,
      )}
      ${
        this.gapsFailed
          ? html`<p class="error" role="alert" data-test="gaps-error">
                ${t("content_gaps.load_error")}
              </p>
              <wt-button
                data-test="gaps-retry"
                variant="secondary"
                @click=${() => void this.#loadGaps()}
                >${t("content_languages.retry")}</wt-button
              >`
          : this.gaps === null
            ? html`<p role="status" data-test="gaps-loading">${t("content_gaps.loading")}</p>`
            : nothing
      }
      ${entries.map(({ language, gaps }) => {
        const parts = [heading(language)];
        if (language === config.defaultLanguage) parts.push(t("content_languages.default"));
        if (required(language)) parts.push(t("content_languages.required"));
        return html`<wt-disclosure
          data-test=${`gaps-${language}`}
          heading=${parts.join(" · ")}
          summary=${
            gaps.length === 0
              ? t("content_gaps.none")
              : t("content_gaps.count").replace("{count}", String(gaps.length))
          }
          ?open=${required(language) && gaps.length > 0}
          >${
            gaps.length === 0
              ? html`<p class="complete">
                  ${t("content_gaps.complete").replace("{language}", names.of(language)!)}
                </p>`
              : html`<wt-data-table
                  noMatchesMessage=${tableNoMatches()}
                  filterSearchPlaceholder=${t("categories.combobox_search")}
                  filterNoResultsLabel=${t("categories.combobox_no_results")}
                  data-test=${`gaps-table-${language}`}
                  aria-label=${t("content_gaps.table").replace("{language}", names.of(language)!)}
                  searchable
                  searchLabel=${t("content_gaps.search")}
                  customiseColumnsLabel=${t("table.customise_columns")}
                  customiseLabel=${t("table.customise")}
                  restoreColumnsLabel=${t("table.restore_columns")}
                  doneLabel=${t("table.done")}
                  moveColumnLabel=${t("table.move_column")}
                  showColumnLabel=${t("table.show_column")}
                  hideColumnLabel=${t("table.hide_column")}
                  columnPositionLabel=${t("table.column_position")}
                  filtersLabel=${t("table.filters")}
                  filteredColumnLabel=${t("table.filtered_column")}
                  filtersClearAllLabel=${t("table.filters_clear_all")}
                  filtersCloseLabel=${t("table.filters_close")}
                  viewKey=${`waitron.content-languages.gaps.${language}`}
                  sortKey="name"
                  sortDirection="ascending"
                  .rows=${gaps}
                  .columns=${this.#gapColumns(gaps)}
                  .rowKey=${(gap: TranslationGap) => `${gap.kind}:${gap.id}`}
                ></wt-data-table>`
          }</wt-disclosure
        >`;
      })}
    </section>`;
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
            ${this.#renderGaps(this.config, this.rules)}`
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
