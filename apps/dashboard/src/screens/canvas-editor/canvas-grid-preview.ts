import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../../i18n/t.js";
import type { StringKey } from "../../i18n/strings.js";
import type { CardInstance, TabDef } from "./card-contracts.js";

/**
 * The shared placeholder-tile grid, drawn at the till renderer's geometry
 * (`grid-template-columns: repeat(columns, 1fr)`, each card `grid-column/row: span …` — mirrors
 * `apps/till/src/widgets/card-grid.ts:133,179`). One element, two consumers:
 *
 * - the list THUMBNAIL (`interactive=false`): a plain, inert grid marked `aria-hidden` — a preview,
 *   not a control, so nothing in it is keyboard-reachable and the screen reader skips it.
 * - the editor CANVAS (`interactive=true`): each tile is a `<button>`, so it is keyboard-reachable
 *   and click-selectable; a click emits `select-card` (bubbles, composed) carrying the card index,
 *   and the tile at `selectedIndex` gets a token-driven ring.
 *
 * Each cell is the card-host SEAM: v1 renders a placeholder (the localised card name + a `WxH` span
 * badge). The real card renderers slot in here later. Chrome is `--wt-*` tokens only.
 */
@customElement("canvas-grid-preview")
export class CanvasGridPreview extends LitElement {
  /** The tab to draw. `null` renders nothing (a caller between selections). */
  @property({ attribute: false }) tab: TabDef | null = null;
  /** Editor canvas when true (buttons, selection, events); inert thumbnail when false. */
  @property({ type: Boolean }) interactive = false;
  /** Index of the selected card, or −1 for none. Only marked when `interactive`. */
  @property({ type: Number }) selectedIndex = -1;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        gap: var(--wt-space-2);
        width: 100%;
      }
      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wt-space-5);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .tile {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        align-items: flex-start;
        justify-content: flex-start;
        padding: var(--wt-space-2);
        min-width: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        text-align: left;
      }
      button.tile {
        font-family: inherit;
        cursor: pointer;
      }
      button.tile.selected {
        outline: var(--wt-selected-ring);
        outline-offset: var(--wt-selected-ring-offset);
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .badge {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  override render(): TemplateResult | typeof nothing {
    const tab = this.tab;
    if (tab === null) return nothing;
    if (tab.cards.length === 0) {
      // `canvas_editor.empty_tab` is a plain string-literal key, present in both locales.
      return html`<div class="empty" data-test="empty-grid">${t("canvas_editor.empty_tab")}</div>`;
    }
    return html`<div
      class="grid"
      data-test="grid"
      style="grid-template-columns: repeat(${tab.columns}, 1fr)"
      aria-hidden=${this.interactive ? nothing : "true"}
    >
      ${tab.cards.map((card, index) => this.#tile(card, index))}
    </div>`;
  }

  #tile(card: CardInstance, index: number): TemplateResult {
    // The card-name key (`canvas_editor.card.<type>`) is present in both locales for every
    // `CardType`; the cast is still required because the template literal widens to `string`.
    const name = t(`canvas_editor.card.${card.type}` as StringKey);
    const badge = `${card.colSpan}×${card.rowSpan}`;
    const style = `grid-column: span ${card.colSpan}; grid-row: span ${card.rowSpan}`;
    const body = html`<span class="name">${name}</span><span class="badge">${badge}</span>`;
    if (!this.interactive) {
      return html`<div class="tile" data-test="tile-${index}" style=${style}>${body}</div>`;
    }
    const selected = this.selectedIndex === index;
    return html`<button
      type="button"
      class="tile ${selected ? "selected" : ""}"
      data-test="tile-${index}"
      style=${style}
      aria-pressed=${selected ? "true" : "false"}
      @click=${(event: MouseEvent) => this.#select(event, index)}
    >
      ${body}
    </button>`;
  }

  #select(event: MouseEvent, index: number): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent<{ index: number }>("select-card", {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "canvas-grid-preview": CanvasGridPreview;
  }
}
