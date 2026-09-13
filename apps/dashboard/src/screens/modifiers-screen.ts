import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, setContentLanguages, currentContentLanguages } from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-icon.js";
import "../widgets/modifier-form.js";
import type { DashboardApi, Modifier, ModifierInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

@customElement("dashboard-modifiers-screen")
export class ModifiersScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0;
        font-size: var(--wt-font-size-xl);
      }
      .heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      wt-input {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private modifiers: Modifier[] = [];
  @state() private locales: ContentLanguages | null = null;
  @state() private loading = true;
  @state() private loadError = false;
  @state() private error: string | null = null;
  @state() private query = "";
  @state() private open = false;
  @state() private value: Modifier | null = null;
  @state() private busy = false;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private deleting: Modifier | null = null;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    () => {
      this.loadError = true;
    },
  );
  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }
  async #load(): Promise<void> {
    this.loadError = false;
    try {
      await Promise.all([
        this.#queries.watch("listModifiers", [], (value) => {
          this.modifiers = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.locales = value;
          setContentLanguages(value);
        }),
      ]);
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }
  #edit(value: Modifier | null): void {
    this.value = value;
    this.fieldErrors = {};
    this.open = true;
  }
  #message(error: unknown): string {
    const code = codeOf(error);
    if (
      code === "modifier.in_use" &&
      typeof error === "object" &&
      error !== null &&
      "params" in error
    ) {
      const params = error.params;
      if (params && typeof params === "object" && "dependency" in params) {
        const dependency = params.dependency;
        if (
          dependency === "product" ||
          dependency === "menu" ||
          dependency === "order" ||
          dependency === "choice"
        )
          return t(`modifiers.in_use.${dependency}`);
      }
    }
    return codeMessage(code);
  }
  async #save(event: CustomEvent<{ value: ModifierInput }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.fieldErrors = {};
    try {
      if (this.value) await this.api.updateModifier(this.value.id, event.detail.value);
      else await this.api.createModifier(event.detail.value);
    } catch (error) {
      const message = this.#message(error);
      const params =
        typeof error === "object" && error !== null && "params" in error ? error.params : null;
      const field =
        params &&
        typeof params === "object" &&
        "field" in params &&
        typeof params.field === "string"
          ? params.field
          : "_form";
      this.fieldErrors = { [field]: message, _form: message };
      this.busy = false;
      return;
    }
    this.open = false;
    this.busy = false;
    await this.#load();
  }
  async #delete(): Promise<void> {
    if (this.busy || !this.deleting) return;
    this.busy = true;
    this.error = null;
    try {
      await this.api.deleteModifier(this.deleting.id);
    } catch (error) {
      this.error = this.#message(error);
      this.busy = false;
      return;
    }
    this.deleting = null;
    this.busy = false;
    await this.#load();
  }
  #name(modifier: Modifier): string {
    return resolveEnabledContentText(modifier.name, currentLocale(), currentContentLanguages());
  }
  override render() {
    const columns = [
      {
        key: "name",
        label: t("modifiers.name"),
        cell: (modifier: Modifier) => this.#name(modifier),
        sortValue: (modifier: Modifier) => this.#name(modifier),
      },
      {
        key: "type",
        label: t("modifiers.type"),
        cell: (modifier: Modifier) => t(`modifiers.${modifier.type}`),
      },
      {
        key: "available",
        label: t("modifiers.available"),
        cell: (modifier: Modifier) =>
          t(modifier.available ? "modifiers.available" : "modifiers.unavailable"),
      },
      {
        key: "actions",
        label: t("action.edit"),
        cell: (modifier: Modifier) =>
          html`<wt-row-actions label=${`${t("action.edit")}: ${this.#name(modifier)}`}
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`edit-${modifier.id}`}
              @click=${() => this.#edit(modifier)}
              >${t("action.edit")}</wt-button
            ><wt-button
              align="start"
              variant="ghost"
              data-test=${`delete-${modifier.id}`}
              @click=${() => {
                this.deleting = modifier;
                this.error = null;
              }}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
    return html`<div class="heading">
        <h1>${t("modifiers.title")}</h1>
        <wt-button
          data-test="create"
          shape="round"
          variant="primary"
          aria-label=${t("modifiers.new")}
          .disabled=${!this.locales}
          @click=${() => this.#edit(null)}
          ><wt-icon name="plus"></wt-icon
        ></wt-button>
      </div>
      ${this.loading ? html`<p role="status">${t("modifiers.loading")}</p>` : nothing}
      ${
        this.loadError
          ? html`<p class="error" role="alert" data-test="load-error">
                ${t("modifiers.load_error")}
              </p>
              <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
                >${t("content_languages.retry")}</wt-button
              >`
          : nothing
      }
      ${
        !this.loading && !this.loadError
          ? html`<wt-input
                name="modifier-search"
                label=${t("modifiers.search")}
                .value=${this.query}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.query = event.detail.value;
                }}
              ></wt-input
              ><wt-data-table
                label=${t("modifiers.title")}
                .columns=${columns}
                .rows=${this.modifiers.filter((modifier) => this.#name(modifier).toLocaleLowerCase().includes(this.query.toLocaleLowerCase()))}
                emptyText=${t("modifiers.empty")}
              ></wt-data-table>`
          : nothing
      }
      <dashboard-modifier-form
        .open=${this.open}
        .value=${this.value}
        .busy=${this.busy}
        .locales=${this.locales?.languages ?? []}
        .fieldErrors=${this.fieldErrors}
        @wt-submit=${(event: CustomEvent<{ value: ModifierInput }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.open = false;
        }}
      ></dashboard-modifier-form>
      <wt-dialog
        .open=${this.deleting !== null}
        heading=${t("action.delete")}
        @wt-close=${() => {
          if (!this.busy) this.deleting = null;
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        ><p>${t("modifiers.delete_confirm")}</p>
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}<wt-form-actions
          slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => {
              this.deleting = null;
            }}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="confirm-delete"
            variant="danger"
            .disabled=${this.busy}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        ></wt-dialog
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-modifiers-screen": ModifiersScreen;
  }
}
