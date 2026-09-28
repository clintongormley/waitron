import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import { baseStyles, setContentLanguages } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import type { DashboardApi } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/content-languages.js";

@customElement("dashboard-content-languages-screen")
export class ContentLanguagesScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .help {
        max-width: 60ch;
        color: var(--wt-color-text-muted);
      }
      wt-card {
        max-width: 60ch;
        margin-top: var(--wt-space-4);
      }
      dl {
        margin: 0;
      }
      dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
      }
      dd {
        margin: var(--wt-space-1) 0 var(--wt-space-3);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }
      dd:last-of-type {
        margin-bottom: 0;
      }
      .card-footer {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--wt-space-3);
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
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-1);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private config: ContentLanguages | null = null;
  @state() private loadFailed = false;
  @state() private editing = false;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadFailed = true;
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.loadFailed = false;
    try {
      await this.#queries.watch("getContentLanguages", [], (value) => {
        this.config = value;
        this.loadFailed = false;
      });
    } catch {
      this.loadFailed = true;
    }
  }

  #renderConfig(config: ContentLanguages) {
    const names = new Intl.DisplayNames([currentLocale()], { type: "language" });
    return html`<wt-card>
        <dl>
          <dt>${t("content_languages.default")}</dt>
          <dd data-test="default-language">${names.of(config.defaultLanguage)}</dd>
          <dt>${t("content_languages.enabled")}</dt>
          <dd>
            <ul data-test="enabled-languages">
              ${config.languages.map((code) => html`<li>${names.of(code)}</li>`)}
            </ul>
          </dd>
        </dl>
        <div class="card-footer">
          <wt-button
            data-test="edit-languages"
            variant="secondary"
            class="card-action accent-primary"
            @click=${() => {
              this.editing = true;
            }}
            >${t("action.edit")}</wt-button
          >
        </div>
      </wt-card>
      <dashboard-content-languages
        .open=${this.editing}
        .config=${config}
        .api=${this.api}
        @languages-closed=${() => {
          this.editing = false;
        }}
        @languages-saved=${(event: CustomEvent<ContentLanguages>) => {
          event.stopPropagation();
          this.editing = false;
          this.config = event.detail;
          setContentLanguages(event.detail);
        }}
      ></dashboard-content-languages>`;
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
