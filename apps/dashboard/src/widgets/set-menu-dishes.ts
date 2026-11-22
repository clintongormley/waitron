import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  belongsToComposition,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type DataTableColumn,
  type DraftScope,
} from "@waitron/ui";
import { stringToCents } from "@waitron/shared";
import { validSurcharge } from "./set-menu-dish-choices.js";
import "./set-menu-copy-dishes.js";
import type { DashboardApi, SetMenuDetails, SetMenuLine } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { ListWriteQueue } from "./section-writes.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type Dish = SetMenuDetails["dishes"][number];
export type SetMenuDishesSaved = {
  details: SetMenuDetails;
  addedLines?: SetMenuLine[];
  removedLines?: SetMenuLine[];
};

type PriceRefusal = { message: string; namesField: boolean };

const rowKey = (dish: Dish) => dish.menuItemId;
const surchargeFields = new Set(["grossPrice", "price", "surcharge"]);
const sameSurcharge = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : stringToCents(a) === stringToCents(b);

@customElement("dashboard-set-menu-dishes")
export class SetMenuDishes extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .add-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
      }
      wt-data-table {
        isolation: isolate;
      }
      wt-data-table::part(dish-course) {
        min-inline-size: calc(var(--wt-space-6) * 5);
      }
      wt-data-table::part(dish-surcharge) {
        inline-size: calc(var(--wt-space-6) * 4);
      }
      wt-data-table::part(dish-link) {
        display: block;
        color: var(--wt-color-primary-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) details!: SetMenuDetails;
  @state() private prices = new Map<string, string>();
  @state() private refusals = new Map<string, PriceRefusal>();
  @state() private hiddenErrors = new Set<string>();
  @state() private savingPrices = false;
  @state() private courseErrors = new Map<string, string>();
  @state() private changingCourse = new Set<string>();
  @state() private actionError = "";
  @state() private loadError = false;
  @state() private dialog: "add" | "copy" | Dish | null = null;

  showVariants(dish: Dish): void {
    if (dish.variants.length) this.dialog = dish;
  }

  readonly #writes = new ListWriteQueue();
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<boolean>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => !this.savingPrices && this.#changes().length > 0,
      snapshot: (dirty) => dirty,
      equal: (before, after) => before === after,
      restore: () => this.#cancelPrices(),
    }).scope;
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has("details")) return;
    const ids = new Set(this.details.dishes.map(rowKey));
    this.prices = new Map([...this.prices].filter(([id]) => ids.has(id)));
    this.refusals = new Map([...this.refusals].filter(([id]) => ids.has(id)));
    this.#scope?.changed();
    if (this.prices.size) void this.#showPriceErrors();
  }

  #changes() {
    return (this.details?.dishes ?? []).flatMap((dish) => {
      const text = this.prices.get(dish.menuItemId);
      if (text === undefined) return [];
      const price = text.trim() || null;
      return this.#invalidPrice(price) || !sameSurcharge(price, dish.surcharge)
        ? [{ dish, price }]
        : [];
    });
  }

  #invalidPrice(price: string | null): boolean {
    return !validSurcharge(price ?? "");
  }

  #priceError(id: string): string {
    if (this.#feedback.attempted && this.#invalidPrice(this.prices.get(id)?.trim() ?? null))
      return codeMessage("set_menu.invalid", undefined, { field: "surcharge" });
    const refusal = this.refusals.get(id);
    return refusal?.namesField ? refusal.message : "";
  }

  #updatePrice(id: string, text?: string): void {
    const prices = new Map(this.prices);
    if (text === undefined) prices.delete(id);
    else prices.set(id, text);
    this.prices = prices;
    this.refusals = new Map(this.refusals);
    this.refusals.delete(id);
    if (!this.#changes().length) this.#feedback.reset();
    this.#scope?.changed();
  }

  #cancelPrices(): void {
    this.prices = new Map();
    this.refusals = new Map();
    this.#feedback.reset();
    this.#scope?.changed();
  }

  async #showPriceErrors(focus = false): Promise<void> {
    await this.updateComplete;
    const tables = [...this.renderRoot.querySelectorAll("wt-data-table")];
    await Promise.all(tables.map(({ updateComplete }) => updateComplete));
    const fields = new Map(
      tables.flatMap((table) =>
        [
          ...table.renderRoot.querySelectorAll<HTMLElementTagNameMap["wt-price-input"]>(
            "wt-price-input[data-item]",
          ),
        ].map((field) => [field.dataset.item!, field] as const),
      ),
    );
    const ids = this.#changes()
      .map(({ dish }) => dish.menuItemId)
      .filter((id) => this.#priceError(id));
    const hidden = ids.filter((id) => !fields.has(id));
    if (hidden.length !== this.hiddenErrors.size || hidden.some((id) => !this.hiddenErrors.has(id)))
      this.hiddenErrors = new Set(hidden);
    if (focus) fields.get(ids.find((id) => fields.has(id)) ?? "")?.focus();
  }

  #savePrices(): void {
    if (this.savingPrices || saveActionState(this.#scope).unchanged) return;
    const changes = this.#changes();
    this.#feedback.press();
    this.refusals = new Map();
    if (changes.some(({ price }) => this.#invalidPrice(price))) {
      void this.#showPriceErrors(true);
      return;
    }

    this.savingPrices = true;
    this.#scope?.changed();
    this.#writes.run(this.details.id, async () => {
      const saved = new Map<string, string | null>();
      const refusals = new Map<string, PriceRefusal>();
      for (const { dish, price } of changes) {
        const id = dish.menuItemId;
        if (
          !this.prices.has(id) ||
          !this.details.dishes.some(({ menuItemId }) => menuItemId === id)
        )
          continue;
        try {
          await this.api.updateMenuItem(this.details.id, id, { grossPrice: price });
          saved.set(id, price);
        } catch (error) {
          const field = fieldOf(error);
          refusals.set(id, {
            message: codeMessage(codeOf(error), undefined, { field }),
            namesField: surchargeFields.has(field),
          });
        }
      }
      if (saved.size) {
        this.details = {
          ...this.details,
          dishes: this.details.dishes.map((dish) =>
            saved.has(dish.menuItemId) ? { ...dish, surcharge: saved.get(dish.menuItemId)! } : dish,
          ),
        };
        this.prices = new Map([...this.prices].filter(([id]) => !saved.has(id)));
        await this.#refresh();
      }
      this.refusals = refusals;
      this.savingPrices = false;
      if (!refusals.size) this.#feedback.reset();
      this.#scope?.commit(false);
      if (refusals.size && this.isConnected) await this.#showPriceErrors(true);
    });
  }

  #priceMessage(): string {
    const errors: Record<string, string> = {};
    const fields = new Set<string>();
    for (const {
      dish: { menuItemId: id, name },
    } of this.#changes()) {
      const error = this.#priceError(id);
      if (error && !this.hiddenErrors.has(id)) fields.add(id);
      else {
        const reason = error || this.refusals.get(id)?.message;
        if (reason) errors[id] = fill("menus.change_not_saved", { name, reason });
      }
    }
    return this.#feedback.message(errors, fields, t("form.fix_fields"));
  }

  async #refresh(): Promise<void> {
    try {
      const api = this.api.background ?? this.api;
      this.#saved({ details: await api.readSetMenu(this.details.id) });
    } catch {
      this.loadError = true;
    }
  }

  #saved(result: SetMenuDishesSaved): void {
    this.loadError = false;
    this.details = result.details;
    this.dispatchEvent(
      new CustomEvent("set-menu-dishes-saved", { detail: result, bubbles: true, composed: true }),
    );
  }

  #changeCourse(event: CustomEvent<{ value: string }>, dish: Dish): void {
    event.stopPropagation();
    const control = event.currentTarget as HTMLElement;
    const id = dish.menuItemId;
    const courseId = event.detail.value || null;
    if (this.changingCourse.has(id) || courseId === dish.courseOverrideId) return;
    // An open native popover keeps focus in the combobox's shadow root.
    const focused = Boolean(control.shadowRoot?.activeElement);
    this.changingCourse = new Set(this.changingCourse).add(id);
    this.courseErrors = new Map(this.courseErrors);
    this.courseErrors.delete(id);
    this.#writes.run(this.details.id, async () => {
      this.actionError = "";
      let restoreFocus = false;
      try {
        const result = await this.api.saveSetMenuDishCourse(this.details.id, id, courseId);
        const moved = result.details.dishes.find(({ menuItemId }) => menuItemId === id);
        restoreFocus =
          moved !== undefined &&
          moved.courseId !== dish.courseId &&
          focused &&
          (Boolean(control.shadowRoot?.activeElement) ||
            this.ownerDocument.activeElement === this.ownerDocument.body);
        this.#saved(result);
      } catch (error) {
        const field = fieldOf(error);
        const message = codeMessage(codeOf(error), undefined, { field });
        if (field === "courseId") this.courseErrors = new Map(this.courseErrors).set(id, message);
        else this.actionError = message;
      } finally {
        this.changingCourse = new Set(this.changingCourse);
        this.changingCourse.delete(id);
      }
      if (restoreFocus) await this.#focusMovedCourse(id);
    });
  }

  async #focusMovedCourse(id: string): Promise<void> {
    await this.updateComplete;
    for (const table of this.renderRoot.querySelectorAll("wt-data-table")) {
      await table.updateComplete;
      const course = table.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        `wt-combobox[data-item="${CSS.escape(id)}"]`,
      );
      if (!course) continue;
      if (this.ownerDocument.activeElement === this.ownerDocument.body) course.focus();
      return;
    }
  }

  #remove(dish: Dish): void {
    this.#writes.run(this.details.id, async () => {
      this.actionError = "";
      const id = this.details.id;
      try {
        const { rootSectionId, root } = await (this.api.background ?? this.api).getMenuStructure(
          id,
        );
        const member = root.members.find(
          ({ ref }) => ref.kind === "product" && ref.productId === dish.productId,
        );
        if (member) await this.api.removeSectionMember(rootSectionId, member.id);
      } catch (error) {
        this.actionError = codeMessage(codeOf(error));
        return;
      }
      this.#updatePrice(dish.menuItemId);
      await this.#refresh();
    });
  }

  #course(dish: Dish) {
    const source = this.details.courses.find(({ id }) => id === dish.productCourseId);
    const options = [
      {
        value: "",
        label: fill("menus.set_menu_product_course", {
          course: source?.name ?? t("menus.set_menu_no_course"),
        }),
      },
      ...this.details.courses.map(({ id, name }) => ({ value: id, label: name })),
    ];
    return html`<wt-combobox
      part="dish-course"
      name="course"
      data-item=${dish.menuItemId}
      show-empty-option
      hide-label
      label=${fill("menus.set_menu_course_for", { name: dish.name })}
      .options=${options}
      .value=${live(dish.courseOverrideId ?? "")}
      .disabled=${this.changingCourse.has(dish.menuItemId)}
      .error=${this.courseErrors.get(dish.menuItemId) ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeCourse(event, dish)}
    ></wt-combobox>`;
  }

  #surcharge(dish: Dish) {
    const id = dish.menuItemId;
    return html`<wt-price-input
      part="dish-surcharge"
      name="surcharge"
      data-item=${id}
      hide-label
      fixed-unit
      locale=${currentLocale()}
      label=${fill("menus.set_menu_surcharge_for", { name: dish.name })}
      placeholder=${t("menus.set_menu_included")}
      .value=${live(this.prices.get(id) ?? dish.surcharge ?? "")}
      .error=${this.#priceError(id)}
      ?readonly=${this.savingPrices}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (!this.savingPrices) this.#updatePrice(id, event.detail.value);
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.savingPrices) return;
        if (event.key === "Escape" && !belongsToComposition(event)) {
          event.preventDefault();
          event.stopPropagation();
          this.#updatePrice(id);
        } else submitOnEnter(event, this.renderRoot.querySelector("[data-surcharge-save]"));
      }}
    ></wt-price-input>`;
  }

  #columns(): DataTableColumn<Dish>[] {
    return [
      {
        key: "dish",
        label: t("menus.set_menu_dish"),
        cell: (dish) =>
          html`${dish.name}${
            dish.courseId === null
              ? html`<a
                  part="dish-link"
                  href=${`/products/product/${encodeURIComponent(dish.productId)}`}
                  >${fill("menus.set_menu_edit_product", { name: dish.name })}</a
                >`
              : nothing
          }`,
      },
      {
        key: "course",
        label: t("menus.set_menu_course"),
        choosable: "shown",
        cell: (dish) => this.#course(dish),
      },
      {
        key: "surcharge",
        label: t("menus.set_menu_surcharge"),
        choosable: "shown",
        cell: (dish) => this.#surcharge(dish),
      },
      {
        key: "actions",
        label: t("members.actions"),
        pinned: "end",
        cell: (dish) =>
          html`<wt-row-actions
            align="end"
            label=${fill("menus.set_menu_dish_actions", { name: dish.name })}
          >
            ${
              dish.variants.length
                ? html`<wt-button variant="secondary" @click=${() => this.showVariants(dish)}
                    >${t("menus.set_menu_variants")}</wt-button
                  >`
                : nothing
            }
            <wt-button variant="secondary" @click=${() => this.#remove(dish)}
              >${t("action.remove")}</wt-button
            >
          </wt-row-actions>`,
      },
    ];
  }

  #dialog() {
    if (!this.dialog) return nothing;
    const close = () => {
      this.dialog = null;
    };
    const saved = (event: CustomEvent<SetMenuDishesSaved>) => {
      event.stopPropagation();
      this.#saved(event.detail);
    };
    return this.dialog === "copy"
      ? html`<dashboard-set-menu-copy-dishes
          .api=${this.api}
          .menuId=${this.details.id}
          @set-menu-dishes-saved=${saved}
          @set-menu-dish-dialog-closed=${close}
        ></dashboard-set-menu-copy-dishes>`
      : html`<dashboard-set-menu-dish-choices
          .api=${this.api}
          .details=${this.details}
          .dish=${this.dialog === "add" ? null : this.dialog}
          @set-menu-dishes-saved=${saved}
          @set-menu-dish-dialog-closed=${close}
        ></dashboard-set-menu-dish-choices>`;
  }

  override render() {
    const groups = new Map<string | null, Dish[]>();
    for (const dish of this.details.dishes) {
      const dishes = groups.get(dish.courseId);
      if (dishes) dishes.push(dish);
      else groups.set(dish.courseId, [dish]);
    }
    const courses = [...this.details.courses, { id: null, name: t("menus.set_menu_no_course") }];
    const columns = this.#columns();
    const action = saveActionState(this.#scope);
    const invalid =
      this.#feedback.attempted && this.#changes().some(({ price }) => this.#invalidPrice(price));
    return html`
      <h2>${t("menus.set_menu_dishes")}</h2>
      <div class="add-actions">
        <wt-button
          variant="secondary"
          @click=${() => {
            this.dialog = "add";
          }}
          >${t("sections.add_products")}</wt-button
        >
        <wt-button
          variant="secondary"
          @click=${() => {
            this.dialog = "copy";
          }}
          >${t("menus.set_menu_copy_dishes")}</wt-button
        >
      </div>
      ${this.#dialog()}
      ${repeat(
        courses.filter(({ id }) => groups.has(id)),
        ({ id }) => id,
        ({ id, name }) => html`
          <h3>${name}</h3>
          ${id === null ? html`<p>${t("menus.set_menu_no_course_help")}</p>` : nothing}
          <wt-data-table
            aria-label=${name}
            viewKey=${`waitron.menus.set-menu.dishes.${id ?? "no-course"}`}
            customiseColumnsLabel=${t("table.customise_columns")}
            customiseLabel=${t("table.customise")}
            restoreColumnsLabel=${t("table.restore_columns")}
            doneLabel=${t("table.done")}
            moveColumnLabel=${t("table.move_column")}
            showColumnLabel=${t("table.show_column")}
            hideColumnLabel=${t("table.hide_column")}
            alwaysShownColumnLabel=${t("table.column_always_shown")}
            lastShownColumnLabel=${t("table.column_last_shown")}
            columnPositionLabel=${t("table.column_position")}
            .rows=${groups.get(id)!}
            .columns=${columns}
            .rowKey=${rowKey}
            @wt-columns-change=${() => void this.#showPriceErrors()}
          ></wt-data-table>
        `,
      )}
      ${this.actionError ? html`<p role="alert">${this.actionError}</p>` : nothing}
      ${
        this.loadError
          ? html`<p role="alert">${t("menus.set_menu_load_error")}</p>
              <wt-button
                variant="secondary"
                @click=${() => this.#writes.run(this.details.id, () => this.#refresh())}
                >${t("menus.retry")}</wt-button
              >`
          : nothing
      }
      <wt-form-actions .error=${this.#priceMessage()}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.savingPrices || action.unchanged}
          @click=${() => this.#cancelPrices()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          variant=${this.savingPrices ? "primary" : action.variant}
          data-surcharge-save
          ?disabled=${this.savingPrices || action.unchanged || invalid}
          @click=${() => this.#savePrices()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-dishes": SetMenuDishes;
  }
}
