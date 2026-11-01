import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { QueryController } from "@waitron/dashboard-kit";
import { themeNameKey } from "@waitron/ui-core/theme";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import "./look-card.js";
import "./themes-card.js";
import type { LookCard } from "./look-card.js";
import type { ThemeEdit, ThemesChanged } from "./themes-card.js";

/** Placed by name key, as the server orders the list, until the next read. */
function placed(themes: readonly ThemeView[], view: ThemeView): ThemeView[] {
  const rest = themes.filter((theme) => theme.id !== view.id);
  const key = themeNameKey(view.name);
  const at = rest.findIndex((theme) => themeNameKey(theme.name) > key);
  return at === -1 ? [...rest, view] : [...rest.slice(0, at), view, ...rest.slice(at)];
}

function applied(list: ThemeList, change: ThemesChanged): ThemeList {
  switch (change.kind) {
    case "saved":
    case "renamed":
      return { ...list, themes: placed(list.themes, change.theme) };
    case "created":
      return {
        themes: placed(list.themes, change.theme),
        inUse: change.inUse ? change.theme.id : list.inUse,
      };
    case "deleted":
      return { themes: list.themes.filter((theme) => theme.id !== change.id), inUse: change.inUse };
    case "switched":
      return { ...list, inUse: change.inUse };
  }
}

@customElement("dashboard-appearance-screen")
export class AppearanceScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .cards {
        display: grid;
        gap: var(--wt-space-5);
        min-width: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) canEdit = false;
  @property({ attribute: false }) legalName = "";
  @state() private list?: ThemeList;
  @state() private readError = "";
  @state() private editingId: string | null = null;
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
  #changed(change: ThemesChanged): void {
    this.#writes++;
    if (this.list !== undefined) this.list = applied(this.list, change);
  }
  override render() {
    return html`<h1>${t("appearance.title")}</h1>
      ${
        this.readError
          ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("venue_settings.retry")}</wt-button
              >`
          : nothing
      }
      ${
        this.list
          ? html`<div class="cards">
              <dashboard-look-card
                .api=${this.api}
                .list=${this.list}
                .canEdit=${this.canEdit}
                .legalName=${this.legalName}
                @themes-changed=${(event: CustomEvent<ThemesChanged>) => this.#changed(event.detail)}
                @look-editing=${(event: CustomEvent<{ id: string | null }>) => {
                  this.editingId = event.detail.id;
                }}
              ></dashboard-look-card>
              <dashboard-themes-card
                .api=${this.api}
                .list=${this.list}
                .canEdit=${this.canEdit}
                .editingId=${this.editingId}
                @theme-edit=${(event: CustomEvent<ThemeEdit>) =>
                  this.renderRoot
                    .querySelector<LookCard>("dashboard-look-card")
                    ?.edit(event.detail)}
                @themes-changed=${(event: CustomEvent<ThemesChanged>) => this.#changed(event.detail)}
              ></dashboard-themes-card>
            </div>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-appearance-screen": AppearanceScreen;
  }
}
