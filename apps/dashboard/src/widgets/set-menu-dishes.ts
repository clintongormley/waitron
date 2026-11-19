import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, belongsToComposition, type DataTableColumn } from "@waitron/ui";
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
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type Dish = SetMenuDetails["dishes"][number];
export type SetMenuDishesSaved = {
  details: SetMenuDetails;
  addedLines?: SetMenuLine[];
  removedLines?: SetMenuLine[];
};

type PriceDraft = {
  text: string;
  error?: string;
  refused?: boolean;
};

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
  @state() private prices = new Map<string, PriceDraft>();
  @state() private courseErrors = new Map<string, string>();
  @state() private changingCourse = new Set<string>();
  @state() private actionError = "";
  @state() private loadError = false;
  @state() private dialog: "add" | "copy" | Dish | null = null;

  showVariants(dish: Dish): void {
    if (dish.variants.length) this.dialog = dish;
  }

  readonly #writes = new ListWriteQueue();
  readonly #pendingPrices = new Map<string, { price: string | null }>();

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #updatePrice(itemId: string, draft?: PriceDraft): void {
    const prices = new Map(this.prices);
    if (draft === undefined) prices.delete(itemId);
    else prices.set(itemId, draft);
    this.prices = prices;
  }

  #save(dish: Dish, via: "enter" | "leave"): void {
    const id = dish.menuItemId;
    const draft = this.prices.get(id);
    if (draft === undefined || (via === "leave" && draft.refused)) return;
    const text = draft.text.trim();
    if (!validSurcharge(text)) {
      this.#updatePrice(id, {
        text: draft.text,
        error: codeMessage("set_menu.invalid", undefined, { field: "surcharge" }),
      });
      return;
    }
    const price = text || null;
    const waiting = this.#pendingPrices.get(id);
    const baseline = waiting ? waiting.price : dish.surcharge;
    if (sameSurcharge(price, baseline)) {
      if (!waiting) this.#updatePrice(id);
      return;
    }
    const sent = { text: draft.text };
    this.#updatePrice(id, sent);
    const queued = { price };
    this.#pendingPrices.set(id, queued);
    this.#writes.run(this.details.id, async () => {
      this.actionError = "";
      try {
        try {
          await this.api.updateMenuItem(this.details.id, id, { grossPrice: price });
        } catch (error) {
          const field = fieldOf(error);
          const message = codeMessage(codeOf(error), undefined, { field });
          this.actionError = message;
          if (this.prices.get(id) === sent) {
            this.#updatePrice(id, {
              ...sent,
              refused: true,
              ...(surchargeFields.has(field) ? { error: message } : {}),
            });
            if (surchargeFields.has(field)) {
              this.renderRoot
                .querySelectorAll("wt-data-table")
                .forEach((table) =>
                  table.shadowRoot
                    ?.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
                      `wt-price-input[data-item="${CSS.escape(id)}"]`,
                    )
                    ?.focus(),
                );
            }
          }
          return;
        }
        await this.#refresh();
        if (this.prices.get(id) === sent) this.#updatePrice(id);
      } finally {
        if (this.#pendingPrices.get(id) === queued) this.#pendingPrices.delete(id);
      }
    });
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
    const id = dish.menuItemId;
    const courseId = event.detail.value || null;
    if (this.changingCourse.has(id) || courseId === dish.courseOverrideId) return;
    this.changingCourse = new Set(this.changingCourse).add(id);
    this.courseErrors = new Map(this.courseErrors);
    this.courseErrors.delete(id);
    this.#writes.run(this.details.id, async () => {
      this.actionError = "";
      try {
        this.#saved(await this.api.saveSetMenuDishCourse(this.details.id, id, courseId));
      } catch (error) {
        const field = fieldOf(error);
        const message = codeMessage(codeOf(error), undefined, { field });
        if (field === "courseId") this.courseErrors = new Map(this.courseErrors).set(id, message);
        else this.actionError = message;
      } finally {
        this.changingCourse = new Set(this.changingCourse);
        this.changingCourse.delete(id);
      }
    });
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
    const draft = this.prices.get(id);
    return html`<wt-price-input
      part="dish-surcharge"
      name="surcharge"
      data-item=${id}
      hide-label
      fixed-unit
      locale=${currentLocale()}
      label=${fill("menus.set_menu_surcharge_for", { name: dish.name })}
      placeholder=${t("menus.set_menu_included")}
      .value=${live(draft?.text ?? dish.surcharge ?? "")}
      .error=${draft?.error ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.#updatePrice(id, { text: event.detail.value });
      }}
      @keydown=${(event: KeyboardEvent) => {
        if ((event.key !== "Enter" && event.key !== "Escape") || belongsToComposition(event))
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Enter") this.#save(dish, "enter");
        else this.#updatePrice(id);
      }}
      @focusout=${() => this.#save(dish, "leave")}
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
      { key: "course", label: t("menus.set_menu_course"), cell: (dish) => this.#course(dish) },
      {
        key: "surcharge",
        label: t("menus.set_menu_surcharge"),
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
            .rows=${groups.get(id)!}
            .columns=${columns}
            .rowKey=${rowKey}
          ></wt-data-table>
        `,
      )}
      ${this.actionError ? html`<p role="alert">${this.actionError}</p>` : nothing}
      ${
        this.loadError
          ? html`<p role="alert">${t("menus.set_menu_load_error")}</p>
              <wt-button variant="secondary" @click=${() => void this.#refresh()}
                >${t("menus.retry")}</wt-button
              >`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-dishes": SetMenuDishes;
  }
}
