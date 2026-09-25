import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { segmentedOptionStyles } from "./segmented-control-styles.js";

interface SwitcherMenu {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * The options are NATIVE `<button>`s carrying `aria-pressed`, not `wt-button`s: `wt-button` does not
 * forward `aria-pressed` to its inner button, so the state would stay on the non-interactive host.
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
    `,
    segmentedOptionStyles,
  ];

  @property({ attribute: false }) menus: SwitcherMenu[] = [];

  @property() selectedId = "";

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
