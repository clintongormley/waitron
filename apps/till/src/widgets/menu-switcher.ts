import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { orderableMenus } from "../menu-filter.js";
import { LocaleChangeController } from "../state/locale-controller.js";

interface SwitcherMenu {
  id: string;
  name: string;
  isDefault: boolean;
  orderable: boolean;
  audience: "customer" | "staff";
}

@customElement("till-menu-switcher")
export class TillMenuSwitcher extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
    `,
  ];

  @property({ attribute: false }) menus: readonly SwitcherMenu[] = [];

  @property() selectedId = "";

  #pick(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const picker = event.currentTarget as HTMLElementTagNameMap["wt-combobox"];
    const id = event.detail.value;
    picker.value = this.selectedId;
    this.dispatchEvent(
      new CustomEvent<{ id: string }>("menu-selected", {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const menus = orderableMenus(this.menus);
    if (menus.length <= 1) return nothing;
    const label = t("menu.switcher");
    return html`<wt-combobox
      name="menu"
      .label=${label}
      .placeholder=${label}
      .options=${menus.map(({ id, name }) => ({ value: id, label: name }))}
      .value=${this.selectedId}
      preserve-order
      search="never"
      @wt-change=${this.#pick}
    ></wt-combobox>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-menu-switcher": TillMenuSwitcher;
  }
}
