import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { QueryController } from "@waitron/dashboard-kit";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import "./look-card.js";

@customElement("dashboard-appearance-screen")
export class AppearanceScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canEdit = false;
  @state() private list?: ThemeList;
  @state() private readError = "";
  #generation = 0;
  #writes = 0;
  #loadedBefore = false;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    const query = dashboardQuery(
      this.#loadedBefore ? (this.api.background ?? this.api) : this.api,
      "listThemes",
      [],
    );
    this.#loadedBefore = true;
    await this.#queries
      .watch(
        "listThemes",
        {
          ...query,
          key: `${query.key}:appearance-screen`,
          read: async () => {
            const writes = this.#writes;
            return { writes, value: await query.read() };
          },
        },
        ({ writes, value }) => {
          if (generation !== this.#generation || writes !== this.#writes) return;
          this.list = value;
          this.readError = "";
        },
      )
      .catch(() => {});
  }
  #saved(saved: ThemeView): void {
    this.#writes++;
    const list = this.list;
    if (list === undefined) return;
    this.list = {
      ...list,
      themes: list.themes.map((theme) => (theme.id === saved.id ? saved : theme)),
    };
  }
  override render() {
    return html`<h1>${t("appearance.title")}</h1>
      ${
        this.readError
          ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("location_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.list
          ? html`<dashboard-look-card
              .api=${this.api}
              .list=${this.list}
              .canEdit=${this.canEdit}
              @look-saved=${(event: CustomEvent<ThemeView>) => this.#saved(event.detail)}
            ></dashboard-look-card>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-appearance-screen": AppearanceScreen;
  }
}
