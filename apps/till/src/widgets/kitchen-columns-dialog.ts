import { LitElement, type PropertyValues, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles, registerIcons, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { ColumnKey, ColumnState } from "../state/kitchen-columns.js";
import { trackDialog } from "./track-dialog.js";

registerIcons({
  "column-up": "M8 2 13 7 11.6 8.4 9 5.8V14H7V5.8L4.4 8.4 3 7Z",
  "column-down": "M8 14 3 9 4.4 7.6 7 10.2V2H9V10.2L11.6 7.6 13 9Z",
});

type Direction = "up" | "down";

/**
 * A kitchen board's columns: their order and which are shown. A pure view: each tap asks through
 * `column-move` or `column-show` and the screen applies it at once, so nothing waits for Done.
 */
@customElement("till-kitchen-columns-dialog")
export class KitchenColumnsDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      .columns {
        display: grid;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto auto auto;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .number {
        min-width: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }

      .name {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .kept {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) layout!: ColumnState;
  @property({ attribute: false }) names: ReadonlyMap<ColumnKey, string> = new Map();
  @property() boardName = "";
  @property({ attribute: false }) opener: HTMLElement | null = null;

  /** The arrow last pressed: Lit reuses rows by position, so the focus is put back by key. */
  #moved?: { key: ColumnKey; direction: Direction };

  #move(key: ColumnKey, direction: Direction): void {
    this.#moved = { key, direction };
    this.dispatchEvent(
      new CustomEvent("column-move", {
        detail: { key, direction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #show(event: Event, key: ColumnKey): void {
    event.stopPropagation();
    const { checked } = (event as CustomEvent<{ checked: boolean }>).detail;
    this.dispatchEvent(
      new CustomEvent("column-show", {
        detail: { key, visible: checked },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #close(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("layout") || this.#moved === undefined) return;
    const { key, direction } = this.#moved;
    this.#moved = undefined;
    const arrow = (way: Direction) =>
      this.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        `[data-column-${way}="${key}"]`,
      );
    const same = arrow(direction);
    (same?.disabled ? arrow(direction === "up" ? "down" : "up") : same)?.focus();
  }

  override render() {
    const keys = this.layout.order.filter((key) => this.names.has(key));
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("station.columns")}
      .description=${this.boardName}
      .opener=${this.opener}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <ol class="columns">
        ${keys.map((key, index) => {
          const name = this.names.get(key)!;
          return html`<li class="row" data-column-row=${key}>
            <span class="number" data-column-number aria-hidden="true">${index + 1}</span>
            <span class="name" data-column-name>${name}</span>
            <wt-button
              variant="secondary"
              data-column-up=${key}
              aria-label=${`${t("station.columns_move_up")} ${name}`}
              ?disabled=${index === 0}
              @click=${() => this.#move(key, "up")}
              ><wt-icon name="column-up" aria-hidden="true"></wt-icon
            ></wt-button>
            <wt-button
              variant="secondary"
              data-column-down=${key}
              aria-label=${`${t("station.columns_move_down")} ${name}`}
              ?disabled=${index === keys.length - 1}
              @click=${() => this.#move(key, "down")}
              ><wt-icon name="column-down" aria-hidden="true"></wt-icon
            ></wt-button>
            <wt-switch
              data-column-show=${key}
              label=${t("station.columns_show")}
              accessible-name=${`${t("station.columns_show")} ${name}`}
              .checked=${live(!this.layout.hidden.includes(key))}
              @wt-change=${(event: Event) => this.#show(event, key)}
            ></wt-switch>
          </li>`;
        })}
      </ol>
      <p class="kept" data-columns-kept>${t("station.columns_kept")}</p>
      <wt-form-actions slot="footer">
        <wt-button
          data-columns-done
          variant="primary"
          @click=${() => this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved")}
          >${t("station.columns_done")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-kitchen-columns-dialog": KitchenColumnsDialog;
  }
}
