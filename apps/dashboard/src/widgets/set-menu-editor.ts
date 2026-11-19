import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, currentContentLanguages } from "@waitron/ui";
import type { DashboardApi, SetMenuDetails } from "../api/client.js";
import type { SetMenuProblem } from "@waitron/shared";
import { fill, t } from "../i18n/t.js";
import "./set-menu-terms-form.js";
import "./set-menu-lines-form.js";

@customElement("dashboard-set-menu-editor")
export class SetMenuEditor extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      ul {
        padding-inline-start: var(--wt-space-5);
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @state() private details: SetMenuDetails | null = null;
  @state() private failed = false;
  // A fresh read of inclusion lines must not reset a separate edit to the terms.
  #terms: SetMenuDetails | null = null;
  #read = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    const generation = ++this.#read;
    const api = this.details ? (this.api.background ?? this.api) : this.api;
    this.failed = false;
    try {
      const details = await api.readSetMenu(this.menuId);
      if (generation !== this.#read) return;
      this.#terms ??= details;
      this.details = details;
    } catch {
      if (generation === this.#read) this.failed = true;
    }
  }

  #problem(problem: SetMenuProblem, details: SetMenuDetails) {
    switch (problem.kind) {
      case "no_dishes":
        return t("menus.set_menu_no_dishes");
      case "no_lines":
        return t("menus.set_menu_no_lines");
      case "line_without_course":
      case "line_unfillable": {
        const number = String(details.lines.findIndex(({ id }) => id === problem.lineId) + 1);
        return fill(
          problem.kind === "line_without_course"
            ? "menus.set_menu_line_without_course"
            : "menus.set_menu_line_unfillable",
          { number },
        );
      }
      case "dish_without_course":
      case "dish_not_included":
      case "dish_sold_by_measure": {
        const product = details.dishes.find(
          (dish) =>
            dish.productId === problem.productId ||
            dish.variants.some(({ id }) => id === problem.productId),
        );
        const name =
          "parentName" in problem && problem.parentName !== null
            ? `${problem.name} (${problem.parentName})`
            : problem.name;
        const message =
          problem.kind === "dish_not_included"
            ? fill("menus.set_menu_dish_not_included", {
                name,
                course: problem.courseName,
                variant: problem.name,
              })
            : fill(
                problem.kind === "dish_without_course"
                  ? "menus.set_menu_dish_without_course"
                  : "menus.set_menu_dish_by_measure",
                { name },
              );
        return html`${message}
        ${
          product
            ? html`<a href=${`/products/product/${encodeURIComponent(product.productId)}`}
                >${fill("menus.set_menu_edit_product", { name: product.name })}</a
              >`
            : nothing
        }`;
      }
    }
  }

  #renderFailure() {
    return html`<p role="alert">${t("menus.set_menu_load_error")}</p>
      <wt-button variant="secondary" @click=${() => void this.#load()}
        >${t("menus.retry")}</wt-button
      >`;
  }

  override render() {
    const details = this.details;
    if (details === null)
      return this.failed ? this.#renderFailure() : html`<p role="status">${t("menus.loading")}</p>`;
    return html`
      <h2>${t("menus.set_menu_terms")}</h2>
      ${
        details.heldBy.length
          ? html`<p>${t("menus.set_menu_published_by")}</p>
              <ul>
                ${details.heldBy.map(({ id, name }) => html`<li><a href=${`/menus/menu/${encodeURIComponent(id)}/view/preview`}>${name}</a></li>`)}
              </ul>`
          : html`<p>${t("menus.set_menu_place_to_sell")}</p>`
      }
      <dashboard-set-menu-terms-form
        .api=${this.api}
        .value=${this.#terms}
        .languages=${currentContentLanguages()}
      ></dashboard-set-menu-terms-form>
      <h2>${t("menus.set_menu_inclusions")}</h2>
      <dashboard-set-menu-lines-form
        .api=${this.api}
        .menuId=${this.menuId}
        .lines=${details.lines}
        .courses=${details.courses}
        @set-menu-lines-saved=${() => void this.#load()}
      ></dashboard-set-menu-lines-form>
      ${this.failed ? this.#renderFailure() : nothing}
      ${
        details.problems.length
          ? html` <h2>${t("menus.set_menu_fix_before_publishing")}</h2>
              <ul>
                ${details.problems.map((problem) => html`<li>${this.#problem(problem, details)}</li>`)}
              </ul>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-editor": SetMenuEditor;
  }
}
