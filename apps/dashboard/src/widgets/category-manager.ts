import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import type { CategorySummary, Station } from "../api/client.js";

/**
 * The management dashboard's CATEGORY MANAGER: it lists the existing categories and owns a single
 * create field (a `wt-input` + a "Crear" button). On submit it emits a bubbling, composed
 * `create-category { name }` (trimmed; an empty/whitespace-only name emits nothing), which the
 * catalogue screen turns into `DashboardApi.createCategory` then reloads.
 *
 * It owns ONLY its own input state (`#name`) — it holds no `api` and never talks to the server (like
 * the pure-display `staff-list`/`product-list`, unlike the login screen). It does NOT clear the field
 * on submit: the screen calls the API and a rejected create leaves the typed name in place for a
 * retry, exactly as `person-form` keeps its values on a failed create (the screen is the single owner
 * of success). Category names render raw; a later i18n task is not needed — they are operator DATA,
 * not UI chrome.
 */
@customElement("dashboard-category-manager")
export class CategoryManager extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-4);
      }

      .row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }

      .name {
        color: var(--wt-color-text);
      }

      .station {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
        min-width: 12rem;
      }

      .create {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }

      .field {
        flex: 1;
        min-width: 0;
      }
    `,
  ];

  /** The categories to list, straight from `DashboardApi.listCategories`. The screen owns and
   * refreshes it; defaults to empty so the widget renders safely before the screen assigns it. */
  @property({ attribute: false }) categories: CategorySummary[] = [];

  /** The venue's active kitchen stations (from `DashboardApi.listStations`), the options each row's
   * routing `<select>` offers. The screen owns and refreshes it; defaults to empty so a row renders
   * only the "— none —" choice before the screen assigns it. */
  @property({ attribute: false }) stations: Station[] = [];

  /** The create field's current text — the ONLY state this widget owns. */
  @state() private name = "";

  /**
   * Capture the create field's new value. `wt-change` is dispatched `bubbles`+`composed`, so
   * `stopPropagation` keeps it inside this widget's shadow boundary rather than leaking to the screen
   * — the house pattern the `person-form` field handlers follow.
   */
  #onNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.name = event.detail.value;
  }

  /**
   * Ask the screen to create a category. Trims the typed name and, if it is empty, does NOTHING (no
   * event) — an empty submit is a no-op, never a blank category. Otherwise `stopPropagation` keeps the
   * button's own composed `click` inside this boundary, then dispatch `create-category { name }`
   * `bubbles`+`composed` so it reaches the screen.
   */
  #create(event: Event): void {
    event.stopPropagation();
    const name = this.name.trim();
    if (name === "") return;
    this.dispatchEvent(
      new CustomEvent<{ name: string }>("create-category", {
        detail: { name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * A category's station-routing `<select>` changed. Native `change` is `composed: false`, so
   * `stopPropagation` is defensive consistency with the composed create handler (the product-form
   * pattern). The empty option maps to `null` (clear the route), any other value to the station id;
   * emit `set-category-station { categoryId, stationId }` bubbles+composed so it reaches the screen.
   */
  #onStation(categoryId: string, event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.dispatchEvent(
      new CustomEvent<{ categoryId: string; stationId: string | null }>("set-category-station", {
        detail: { categoryId, stationId: value === "" ? null : value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="list">
        ${this.categories.map(
          (category) => html`
            <wt-card data-test="category-row">
              <div class="row">
                <span class="name">${category.name}</span>
                <label class="station"
                  >${t("category.station")}
                  <select
                    data-test="category-station-${category.id}"
                    @change=${(e: Event) => this.#onStation(category.id, e)}
                  >
                    <option value="">${t("category.no_station")}</option>
                    ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
                  </select>
                </label>
              </div>
            </wt-card>
          `,
        )}
      </div>
      <div class="create">
        <wt-input
          class="field"
          data-test="category-name"
          label=${t("category.new")}
          .value=${this.name}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNameChange(e)}
        ></wt-input>
        <wt-button variant="primary" data-test="create" @click=${(e: Event) => this.#create(e)}>
          ${t("action.create")}
        </wt-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-manager": CategoryManager;
  }
}
