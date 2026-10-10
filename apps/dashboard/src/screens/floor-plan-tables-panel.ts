import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { placeTable, type DraftTable, type FloorPlanDraft } from "./floor-plan-draft.js";
import type { FloorPlanChange, FloorPlanSelect } from "./floor-plan-editor.js";

@customElement("floor-plan-tables-panel")
export class FloorPlanTablesPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      wt-button {
        display: block;
      }
      wt-button[data-placed]::part(button) {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-normal);
      }
    `,
  ];

  @property({ attribute: false }) draft!: FloorPlanDraft;
  @property() selected: string | null = null;
  /** Inside a `wt-sheet` the toggle names the list, so the panel drops its own heading. */
  @property({ type: Boolean }) inSheet = false;
  @property() zoneName = "";
  @property({ attribute: false }) takenElsewhere: ReadonlySet<string> = new Set();
  @property({ attribute: false }) nextKey!: () => string;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #collatorLocale: string | null = null;
  #collator!: Intl.Collator;

  #sorter(): Intl.Collator {
    const locale = currentLocale();
    if (locale !== this.#collatorLocale) {
      this.#collatorLocale = locale;
      this.#collator = new Intl.Collator(locale, { numeric: true });
    }
    return this.#collator;
  }

  #send<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #press(table: DraftTable): void {
    if (table.placement === null) {
      this.#send<FloorPlanChange>("floor-plan-change", {
        draft: placeTable(this.draft, table.key),
      });
    }
    this.#send<FloorPlanSelect>("floor-plan-select", { key: table.key });
  }

  override render() {
    const collator = this.#sorter();
    const tables = [...this.draft.tables].sort((a, b) => collator.compare(a.label, b.label));
    return html`
      ${this.inSheet ? nothing : html`<h2>${t("floor_plan_editor.tables")}</h2>`}
      <ul>
        ${tables.map(
          (table) =>
            html`<li>
              <wt-button
                variant="ghost"
                align="start"
                data-table=${table.key}
                ?data-placed=${table.placement !== null}
                @click=${() => this.#press(table)}
                >${table.label.trim() || t("floor_plan_editor.unnamed")}</wt-button
              >
            </li>`,
        )}
      </ul>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "floor-plan-tables-panel": FloorPlanTablesPanel;
  }
}
