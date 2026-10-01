import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { capitaliseFirst, type ContentLanguages } from "@waitron/shared";
import { baseStyles, formMessage, formMessageStyles, setContentLanguages } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import type { DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/add-content-language.js";

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
  @state() private loadFailed = false;
  @state() private adding = false;
  @state() private busy = false;
  @state() private saveError = "";
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadFailed = true;
    },
  );
  /** How many configurations the server has delivered, so a save can tell whether one arrived while
   * it was in flight. */
  #reads = 0;
  readonly #saveAdded = (config: ContentLanguages) => this.#write(config);

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loadFailed = false;
    try {
      await this.#queries.watch("getContentLanguages", [], (value) => {
        this.#reads += 1;
        this.config = value;
        this.loadFailed = false;
        setContentLanguages(value);
      });
    } catch {
      this.loadFailed = true;
    }
  }

  async #write(config: ContentLanguages): Promise<void> {
    const reads = this.#reads;
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

  #renderConfig(config: ContentLanguages) {
    const locale = currentLocale();
    const names = new Intl.DisplayNames([locale], { type: "language" });
    const name = (code: string) => capitaliseFirst(names.of(code)!, locale);
    const collator = new Intl.Collator(locale);
    const others = config.languages
      .filter((code) => code !== config.defaultLanguage)
      .map((code) => ({ code, name: name(code) }))
      .sort((a, b) => collator.compare(a.name, b.name));
    return html`<wt-card>
        <ul data-test="languages" aria-label=${t("content_languages.enabled")}>
          <li class="action-row">
            <div class="text">
              <span class="field-value">${name(config.defaultLanguage)}</span>
              <span class="field-meta">${t("content_languages.default")}</span>
            </div>
          </li>
          ${others.map(
            ({ code, name }) =>
              html`<li class="action-row">
                <span class="field-value">${name}</span>
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
                  <wt-button
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
                  >
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
        this.config
          ? this.#renderConfig(this.config)
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
