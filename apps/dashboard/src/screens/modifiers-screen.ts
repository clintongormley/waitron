import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  setContentLanguages,
  currentContentLanguages,
  type DataTableColumn,
} from "@waitron/ui";
import { resolveEnabledContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "../widgets/modifier-form.js";
import type { DashboardApi, Modifier, ModifierChoice, ModifierInput } from "../api/client.js";
import { DashboardQueries } from "../api/query-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName, vatClassName } from "../i18n/domain.js";
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
  @state() private open = false;
  @state() private value: Modifier | null = null;
  @state() private busy = false;
  @state() private fieldErrors: Record<string, string> = {};
  @state() private deleting: Modifier | null = null;
  // The modifier whose read-only details modal is open, or null when it is closed.
  @state() private detailing: Modifier | null = null;
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
  #openDetails(modifier: Modifier): void {
    this.detailing = modifier;
  }
  // Stub for Task 11 — the delete dialog gains a dependants preview there. For now it just arms the
  // existing confirmation, exactly as the old row delete button did.
  #openDelete(modifier: Modifier): void {
    this.deleting = modifier;
    this.error = null;
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
      this.fieldErrors = { [field]: message };
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
  #choiceName(choice: ModifierChoice): string {
    return resolveEnabledContentText(choice.name, currentLocale(), currentContentLanguages());
  }
  // The allergen and dietary effect lines for one choice, each shown only when the choice sets it —
  // the owner wants this information present only when a choice actually carries it.
  #choiceSummary(choice: ModifierChoice) {
    const adds = Object.keys(choice.addAllergens ?? {});
    const removes = choice.removeAllergens ?? [];
    const diet = choice.dietaryEffect?.invalidates ?? [];
    return html`${
      adds.length
        ? html`<div>
            ${t("modifiers.adds_allergens")}: ${adds.map((code) => allergenName(code)).join(", ")}
          </div>`
        : nothing
    }${
      removes.length
        ? html`<div>
            ${t("modifiers.removes_allergens")}:
            ${removes.map((code) => allergenName(code)).join(", ")}
          </div>`
        : nothing
    }${
      diet.length
        ? html`<div>
            ${t("modifiers.dietary_removed")}:
            ${diet.map((label) => t(`editor.diet.${label}`)).join(", ")}
          </div>`
        : nothing
    }`;
  }
  // The read-only names of a modifier across the enabled content languages: the resolved default name
  // as a heading, then any other enabled language that carries its own name.
  #detailsNames(modifier: Modifier) {
    const { defaultLanguage, languages } = currentContentLanguages();
    const others = languages.filter(
      (language) => language !== defaultLanguage && modifier.name[language],
    );
    return html`<p><strong>${this.#name(modifier)}</strong></p>
      ${others.map(
        (language) => html`<p>${language.toUpperCase()}: ${modifier.name[language]}</p>`,
      )}`;
  }
  #choicesTable(modifier: Modifier & { type: "extras" | "options" }) {
    const extras = modifier.type === "extras";
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t("modifiers.name")}</th>
          ${
            extras
              ? html`<th scope="col">${t("modifiers.price")}</th>
                  <th scope="col">${t("modifiers.vat")}</th>`
              : nothing
          }
          <th scope="col">${t("modifiers.available")}</th>
          <th scope="col">${extras ? t("modifiers.preselected") : t("modifiers.default")}</th>
        </tr>
      </thead>
      <tbody>
        ${modifier.choices.map((choice) => {
          const preset = extras
            ? "preselected" in choice && choice.preselected
            : modifier.defaultChoiceId === choice.id;
          return html`<tr data-test=${`choice-row-${choice.id}`}>
            <td>
              <div>${this.#choiceName(choice)}</div>
              <div data-test=${`summary-${choice.id}`}>${this.#choiceSummary(choice)}</div>
            </td>
            ${
              extras
                ? html`<td>${"priceDelta" in choice ? choice.priceDelta : ""}</td>
                    <td>
                      ${
                        "vatClass" in choice && choice.vatClass
                          ? vatClassName(choice.vatClass)
                          : t("modifiers.inherit_vat")
                      }
                    </td>`
                : nothing
            }
            <td>${choice.available ? t("modifiers.available") : t("modifiers.unavailable")}</td>
            <td>${preset ? t("modifiers.yes") : nothing}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }
  #detailsBody(modifier: Modifier) {
    return html`${this.#detailsNames(modifier)}
      <p>${t("modifiers.type")}: ${t(`modifiers.${modifier.type}`)}</p>
      ${modifier.type === "text" ? html`<p>${t("modifiers.text_help")}</p>` : nothing}
      ${
        modifier.type === "yes-no"
          ? html`<p>
                ${t("modifiers.default_value")}:
                ${modifier.defaultValue ? t("modifiers.yes") : t("modifiers.no")}
              </p>
              <p>
                ${t("modifiers.available")}:
                ${modifier.available ? t("modifiers.available") : t("modifiers.unavailable")}
              </p>`
          : nothing
      }
      ${
        modifier.type === "extras"
          ? html`<p>
                ${t("modifiers.required")}:
                ${modifier.required ? t("modifiers.yes") : t("modifiers.no")}
              </p>
              <p>
                ${t("modifiers.max_total")}:
                ${
                  modifier.maxTotalQuantity === null
                    ? t("modifiers.unlimited")
                    : String(modifier.maxTotalQuantity)
                }
              </p>
              ${this.#choicesTable(modifier)}`
          : nothing
      }
      ${
        modifier.type === "options"
          ? html`<p>
                ${t("modifiers.default_choice")}:
                ${(() => {
                  const chosen = modifier.choices.find(
                    (choice) => choice.id === modifier.defaultChoiceId,
                  );
                  return chosen ? this.#choiceName(chosen) : t("modifiers.no_default");
                })()}
              </p>
              ${this.#choicesTable(modifier)}`
          : nothing
      }`;
  }
  override render() {
    const columns: DataTableColumn<Modifier>[] = [
      {
        key: "name",
        label: t("modifiers.name"),
        searchValue: (modifier) => this.#name(modifier),
        sortValue: (modifier) => this.#name(modifier),
        cell: (modifier) =>
          html`<wt-button
            variant="ghost"
            data-test=${`open-${modifier.id}`}
            @click=${() => this.#openDetails(modifier)}
            >${this.#name(modifier)}</wt-button
          >`,
      },
      {
        key: "type",
        label: t("modifiers.type"),
        sortValue: (modifier) => t(`modifiers.${modifier.type}`),
        cell: (modifier) => t(`modifiers.${modifier.type}`),
        filter: {
          label: t("modifiers.type"),
          allLabel: t("modifiers.filter_type_all"),
          value: (modifier) => modifier.type,
          options: (["text", "extras", "options", "yes-no"] as const).map((type) => ({
            value: type,
            label: t(`modifiers.${type}`),
          })),
        },
      },
      {
        key: "choices",
        label: t("modifiers.choices"),
        sortValue: (modifier) =>
          modifier.type === "extras" || modifier.type === "options" ? modifier.choices.length : 0,
        cell: (modifier) =>
          modifier.type === "extras" || modifier.type === "options"
            ? String(modifier.choices.length)
            : "",
      },
      {
        key: "actions",
        label: t("action.edit"),
        cell: (modifier) =>
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
              @click=${() => this.#openDelete(modifier)}
              >${t("action.delete")}</wt-button
            ></wt-row-actions
          >`,
      },
    ];
    return html`<div class="heading">
        <h1>${t("modifiers.title")}</h1>
        <wt-button
          data-test="create-modifier"
          variant="primary"
          .disabled=${!this.locales}
          @click=${() => this.#edit(null)}
          >${t("modifiers.add")}</wt-button
        >
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
          ? html`<wt-data-table
              aria-label=${t("modifiers.title")}
              searchable
              searchLabel=${t("modifiers.search")}
              noMatchesMessage=${t("modifiers.no_matches")}
              viewKey="waitron.modifiers.table"
              sortKey="name"
              sortDirection="ascending"
              .rows=${this.modifiers}
              .columns=${columns}
              .rowKey=${(modifier: Modifier) => modifier.id}
              .emptyMessage=${t("modifiers.empty")}
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
      >
      <wt-modal
        data-test="details-modal"
        .open=${this.detailing !== null}
        heading=${t("modifiers.details")}
        @wt-close=${() => {
          this.detailing = null;
        }}
        >${this.detailing ? this.#detailsBody(this.detailing) : nothing}<wt-form-actions
          slot="footer"
          ><wt-button
            slot="cancel"
            data-test="details-close"
            variant="secondary"
            @click=${() => {
              this.detailing = null;
            }}
            >${t("action.close")}</wt-button
          ><wt-button
            data-test="details-edit"
            variant="primary"
            @click=${() => {
              const modifier = this.detailing;
              this.detailing = null;
              if (modifier) this.#edit(modifier);
            }}
            >${t("action.edit")}</wt-button
          ></wt-form-actions
        ></wt-modal
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-modifiers-screen": ModifiersScreen;
  }
}
