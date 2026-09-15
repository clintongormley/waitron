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
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import "../widgets/modifier-form.js";
import type {
  DashboardApi,
  Modifier,
  ModifierChoice,
  ModifierDependants,
  ModifierInput,
} from "../api/client.js";
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
  @state() private dependants: ModifierDependants | null = null;
  /** The preview fetch failed. Distinct from `dependants === null` (still loading) and from a
   * loaded object whose lists are empty and orders is 0 (genuinely nothing depends on this). */
  @state() private dependantsError = false;
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
      // A `?modifier=<id>` deep link opens that modifier's editor. An unknown id is ignored.
      // Clearing the param stops a refresh reopening the editor.
      const linked = new URL(location.href).searchParams.get("modifier");
      const target = linked ? this.modifiers.find((m) => m.id === linked) : undefined;
      if (target) {
        this.#edit(target);
        const url = new URL(location.href);
        url.searchParams.delete("modifier");
        history.replaceState(null, "", url);
      }
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
  #deleteGeneration = 0;
  #openDelete(modifier: Modifier): void {
    this.error = null;
    this.dependants = null;
    this.dependantsError = false;
    this.deleting = modifier;
    const generation = ++this.#deleteGeneration;
    void this.#loadDependants(modifier.id, generation);
  }
  #closeDelete(): void {
    this.deleting = null;
    this.dependants = null;
    this.dependantsError = false;
    this.error = null;
    this.#deleteGeneration++;
  }
  /** Feeds the delete confirmation's preview. The server refuses a delete only on an open order, so
   * every other consequence — the products and menu items that lose the modifier — cascades and
   * cannot be undone; a failed fetch therefore gets its own state rather than an empty stand-in,
   * which would read as "nothing depends on this" and have a manager confirm the cascade blind.
   * `generation` guards a reopened dialog against a stale response: comparing `this.deleting?.id`
   * alone cannot tell a superseded fetch from the current one when the SAME modifier is reopened,
   * so only a response whose generation still matches is applied. */
  async #loadDependants(id: string, generation: number): Promise<void> {
    try {
      const dependants = await this.api.getModifierDependants(id);
      if (generation === this.#deleteGeneration) this.dependants = dependants;
    } catch {
      if (generation === this.#deleteGeneration) this.dependantsError = true;
    }
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
    this.#closeDelete();
    this.busy = false;
    await this.#load();
  }
  #name(modifier: Modifier): string {
    return resolveEnabledContentText(modifier.name, currentLocale(), currentContentLanguages());
  }
  #choiceName(choice: ModifierChoice): string {
    return resolveEnabledContentText(choice.name, currentLocale(), currentContentLanguages());
  }
  #depName(entry: { name: Record<string, string> }): string {
    return resolveEnabledContentText(entry.name, currentLocale(), currentContentLanguages());
  }
  /** The single red warning at the top of the delete confirmation: one paragraph naming every
   * cascade consequence, space-joined from the sentences that apply. Only called when there IS
   * something to lose, so the "cannot be undone" opener always leads it. The open-order case is not
   * in here — it blocks the delete rather than warning about it, so it gets its own line. */
  #deleteWarning(dependants: ModifierDependants): string {
    const parts = [t("modifiers.delete_warning_intro")];
    if (dependants.products.length > 0)
      parts.push(
        t("modifiers.delete_warning_products").replace(
          "{count}",
          String(dependants.products.length),
        ),
      );
    if (dependants.menus.length > 0)
      parts.push(
        t("modifiers.delete_warning_menus").replace("{count}", String(dependants.menus.length)),
      );
    return parts.join(" ");
  }
  /** The delete confirmation's preview: a spinner until `#loadDependants` resolves, then the red
   * warning naming every cascade consequence above the affected-products and affected-menus lists
   * (each shown only when non-empty), and — when an open order still uses the modifier — a block
   * saying why the delete is refused. With nothing depending on the modifier there is no warning,
   * just the buttons. A failed fetch says so instead, because silence here would read as "nothing
   * to lose". */
  #renderDependants() {
    if (this.dependantsError)
      return html`<p class="error" data-test="dependants-error" role="alert">
        ${t("modifiers.delete_preview_error")}
      </p>`;
    const dependants = this.dependants;
    if (!dependants) return html`<wt-spinner></wt-spinner>`;
    const hasCascade = dependants.products.length > 0 || dependants.menus.length > 0;
    return html`${
      hasCascade
        ? html`<p class="error" data-test="delete-warning" role="alert">
            ${this.#deleteWarning(dependants)}
          </p>`
        : nothing
    }${
      dependants.products.length > 0
        ? html`<p id="affected-products-label">${t("modifiers.affected_products")}</p>
            <ul data-test="modifier-delete-products" aria-labelledby="affected-products-label">
              ${dependants.products.map((entry) => html`<li>${this.#depName(entry)}</li>`)}
            </ul>`
        : nothing
    }${
      dependants.menus.length > 0
        ? html`<p id="affected-menus-label">${t("modifiers.affected_menus")}</p>
            <ul data-test="modifier-delete-menus" aria-labelledby="affected-menus-label">
              ${dependants.menus.map((entry) => html`<li>${this.#depName(entry)}</li>`)}
            </ul>`
        : nothing
    }${
      dependants.orders > 0
        ? html`<p class="error" data-test="orders-block" role="alert">
            ${t("modifiers.delete_orders_block")}
          </p>`
        : nothing
    }`;
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
          options: (["text", "extras", "options"] as const).map((type) => ({
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
      <wt-modal
        data-test="delete-dialog"
        .open=${this.deleting !== null}
        heading=${t("modifiers.delete_named").replace(
          "{name}",
          this.deleting ? this.#name(this.deleting) : "",
        )}
        @keydown=${(event: KeyboardEvent) => {
          if (this.busy && event.key === "Escape") event.preventDefault();
        }}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeDelete();
        }}
      >
        ${this.deleting ? this.#renderDependants() : nothing}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${() => this.#closeDelete()}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="confirm-delete"
            variant="danger"
            .disabled=${this.busy || !this.dependants || this.dependants.orders > 0}
            @click=${() => void this.#delete()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        ></wt-modal
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
