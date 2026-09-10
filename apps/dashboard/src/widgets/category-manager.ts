import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter, type DataTableColumn } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import type { CategorySummary } from "../api/client.js";

/** Lists reusable product categories and emits a request to create one. */
@customElement("dashboard-category-manager")
export class CategoryManager extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        margin: 0 0 var(--wt-space-3);
      }
      .create {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      .field {
        flex: 1;
        min-width: 0;
      }
    `,
  ];

  @property({ attribute: false }) categories: CategorySummary[] = [];
  @state() private name = "";

  #onNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.name = event.detail.value;
  }

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

  #columns(): DataTableColumn<CategorySummary>[] {
    return [
      {
        key: "name",
        label: t("category.title"),
        cell: (category) => category.name,
        sortValue: (category) => category.name,
      },
    ];
  }

  override render() {
    return html`
      <h2>${t("category.title")}</h2>
      <wt-data-table
        aria-label=${t("category.title")}
        .rows=${this.categories}
        .columns=${this.#columns()}
        .rowKey=${(category: CategorySummary) => category.id}
        .emptyMessage=${t("category.empty")}
      ></wt-data-table>
      <div class="create">
        <wt-input
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=create]"))}
          class="field"
          data-test="category-name"
          label=${t("category.new")}
          .value=${this.name}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onNameChange(event)}
        ></wt-input>
        <wt-button
          variant="primary"
          data-test="create"
          @click=${(event: Event) => this.#create(event)}
          >${t("action.create")}</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-category-manager": CategoryManager;
  }
}
