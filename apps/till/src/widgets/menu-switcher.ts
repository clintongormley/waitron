import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";

/** One accessible menu offered to the switcher — the `menus[]` shape `GET /api/products` returns. */
interface SwitcherMenu {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * The till's MENU SWITCHER: a segmented control listing the location's accessible menus (catalogues),
 * rendered above the product grid. Tapping one asks the parent to show that menu; the widget holds NO
 * state — the parent (`till-app`) owns `selectedCatalogueId` and re-filters the grid, then feeds the
 * new `selectedId` back down. Props in, event out, mirroring `till-language-chooser`.
 *
 * It renders NOTHING when there is one menu or none (`menus.length <= 1`), so a single-menu venue — the
 * common case — looks exactly as it did before multi-menu: no switcher chrome above the grid at all.
 *
 * Accessibility: the options are NATIVE `<button>` elements — the real focusable nodes — inside a
 * `role="group"` labelled by the `menu.switcher` string, each carrying `aria-pressed` for its
 * selected state. This mirrors `till-language-chooser`'s own choice of native buttons over `wt-button`
 * for its menu options: a `wt-button` forwards only `disabled`/`aria-label` to its inner button, so a
 * role or `aria-pressed` set on a `wt-button` host would land on the non-interactive host and be lost
 * to the screen reader. Keeping the state on the native button puts it on the element the AT reaches.
 * (`aria-pressed` is the valid selection attribute for a button; `aria-selected` is only valid on
 * `tab`/`option` roles.) The `min-height: var(--wt-tap-min)` preserves the POS tap target `wt-button`
 * would otherwise give for free.
 */
@customElement("till-menu-switcher")
export class TillMenuSwitcher extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .switcher {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        /* On the inner container, not the host: with one menu render() returns nothing and the host
           stays empty (zero height, no margin), so a single-menu location adds no space above the grid. */
        margin-bottom: var(--wt-space-3);
      }

      .option {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      .option:hover {
        background: var(--wt-color-surface-raised);
      }

      .option[aria-pressed="true"] {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        border-color: var(--wt-color-primary);
      }
    `,
  ];

  /** The location's accessible menus (default first), straight from `GET /api/products` `menus`. */
  @property({ attribute: false }) menus: SwitcherMenu[] = [];

  /** The currently-shown menu's catalogue id — owned by the parent, echoed here to mark the active option. */
  @property() selectedId = "";

  /** Ask the parent to switch to `id`. The widget does not change its own selection — see the class doc. */
  #pick(id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("menu-selected", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    // A single menu (or none) needs no switcher — render nothing so the grid looks exactly as before.
    if (this.menus.length <= 1) return nothing;
    return html`
      <div class="switcher" role="group" aria-label=${t("menu.switcher")}>
        ${this.menus.map(
          (menu) =>
            html`<button
              type="button"
              class="option"
              data-test=${`menu-${menu.id}`}
              aria-pressed=${menu.id === this.selectedId}
              @click=${() => this.#pick(menu.id)}
            >
              ${menu.name}
            </button>`,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-menu-switcher": TillMenuSwitcher;
  }
}
