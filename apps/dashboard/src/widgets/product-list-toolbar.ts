import { css, html, nothing, type LitElement } from "lit";
import "@waitron/ui/src/components/wt-segmented-control.js";
import { t } from "../i18n/t.js";
import { countOf } from "./count-text.js";
import type { ProductsView } from "./product-list.js";
import { PRODUCTS_PHONE_WIDTH } from "./product-list-category.js";

const VIEW_KEY = "waitron.products.view";

export function rememberedProductsView(): ProductsView {
  try {
    return localStorage.getItem(VIEW_KEY) === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

export function rememberProductsView(view: ProductsView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // The view still changes for this visit if storage is disabled.
  }
}

export function observeProductsWidth(host: LitElement, update: (phone: boolean) => void): void {
  let frame = 0;
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => update(host.clientWidth <= PRODUCTS_PHONE_WIDTH));
  });
  host.addController({
    hostConnected: () => resize.observe(host),
    hostDisconnected: () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
    },
  });
}

export const productsToolbarStyles = css`
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--wt-space-2);
    padding: var(--wt-space-3) 0;
  }
  .empty-tree-action {
    text-align: center;
    margin-block-start: var(--wt-space-3);
  }
  wt-input[name="menu-search"] {
    flex: 1 1 calc(var(--wt-tap-min) * 7);
    min-width: 0;
  }
  wt-input[data-compact-search]::part(field) {
    outline: var(--wt-field-line-width) solid var(--wt-color-border);
    outline-offset: calc(-1 * var(--wt-field-line-width));
    border-radius: var(--wt-radius-md);
  }
  wt-segmented-control {
    flex: none;
    inline-size: max-content;
    max-inline-size: 100%;
  }
  wt-segmented-control[slot="above-table"] {
    margin-block-end: var(--wt-space-3);
  }
`;

export function productViewSwitch(
  view: ProductsView,
  above: boolean,
  change: (view: ProductsView) => void,
) {
  return html`<wt-segmented-control
    slot=${above ? "above-table" : "toolbar-search"}
    name="products-view"
    hide-label
    label=${t("products.view")}
    .value=${view}
    .options=${[
      { value: "list", label: t("products.view_list") },
      { value: "tree", label: t("products.view_tree") },
    ]}
    @wt-change=${(event: CustomEvent<{ value: ProductsView }>) => {
      event.stopPropagation();
      change(event.detail.value);
    }}
  ></wt-segmented-control>`;
}

export function productSearchAndSelect(
  search: string,
  setSearch: (search: string) => void,
  selecting: boolean,
  select: () => void,
  view: ProductsView,
  noRows: boolean,
  phone: boolean,
) {
  return html`<wt-icon-button
      slot="toolbar-start"
      data-test="select"
      label=${t("folders.select")}
      icon="select-rows"
      .pressed=${selecting}
      .disabled=${noRows}
      @click=${select}
    ></wt-icon-button>
    <wt-input
      slot="toolbar-search"
      name="menu-search"
      type="search"
      ?data-compact-search=${phone}
      ?hide-label=${phone}
      placeholder=${phone ? t("products.search_short") : ""}
      label=${t(phone ? "products.search_short" : view === "list" ? "product.search" : "folders.search")}
      .disabled=${noRows && search === ""}
      .value=${search}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        setSearch(event.detail.value);
      }}
    ></wt-input>`;
}

export function productSelectionBar(options: {
  selecting: boolean;
  busy: boolean;
  showSpinner: boolean;
  count: number;
  deleteWaiting: boolean;
  move: () => void;
  remove: () => void;
  done: () => void;
}) {
  if (!options.selecting && !options.busy) return nothing;
  return html`<div
    slot="toolbar-bottom"
    class="actions"
    data-test="selection-bar"
    role="group"
    aria-label=${t("folders.select")}
  >
    ${options.showSpinner && options.busy ? html`<wt-spinner></wt-spinner>` : nothing}
    ${
      options.selecting
        ? html`<span data-test="selected-count" aria-live="polite"
              >${countOf("folders.selected", options.count)}</span
            >
            <wt-button
              data-test="move"
              variant="secondary"
              .disabled=${!options.count || options.busy}
              @click=${options.move}
              >${t("folders.move")}</wt-button
            >
            <wt-button
              data-test="delete"
              variant=${options.deleteWaiting ? "secondary" : "danger"}
              .disabled=${options.deleteWaiting || options.busy}
              @click=${options.remove}
              >${t("action.delete")}</wt-button
            >
            <wt-button data-test="cancel-selection" variant="secondary" @click=${options.done}
              >${t("action.done")}</wt-button
            >`
        : nothing
    }
  </div>`;
}
