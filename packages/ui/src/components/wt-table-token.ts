import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import type { FloorTable } from "../floor.js";

/**
 * The optional locale-dependent suffix words the token renders next to its DATA. Copy travels as props
 * (the `@waitron/ui` convention — see wt-switch's `label`), never as hardcoded locale strings, so a
 * consumer app threads its own i18n through: `covers` follows the cover count ("plazas"/"covers"),
 * `toServe` follows the pending-to-serve count ("por servir"/"to serve"). Absent ⇒ just the number.
 */
export interface TableTokenLabels {
  covers?: string;
  toServe?: string;
}

/**
 * The shared occupancy TOKEN: FP-1's live-floor card visual, extracted verbatim so the till's list card
 * (FP-2 Task 6) and the floor map (`<wt-floor-canvas>`) render the SAME markup, class names and
 * state-accent colours and can never drift apart. Purely presentational — it owns no interaction; the
 * consumer wraps it in whatever tappable/draggable element it needs and reads the placement itself.
 *
 * State accent (a coloured left edge) is DATA-driven from {@link FloorTable.state}, using the exact FP-1
 * tokens: `free → --wt-color-success`, `open-tab → --wt-color-primary`, `delivery-pending →
 * --wt-color-danger`. The manual status badge's arbitrary colour rides on an inline style (never chrome
 * CSS), exactly as FP-1's card, so an unreviewed status colour can never fail the no-hardcoded-chrome
 * guard.
 */
@customElement("wt-table-token")
export class WtTableToken extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* Mirrors till-floor-screen's .card body: the occupancy accent is the left edge, coloured by
         state via the tokens below — identical to FP-1 so the map token and the list card match. */
      .card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        text-align: left;
      }

      .card.state-free {
        border-left-color: var(--wt-color-success);
      }

      .card.state-open-tab {
        border-left-color: var(--wt-color-primary);
      }

      .card.state-delivery-pending {
        border-left-color: var(--wt-color-danger);
      }

      /* The stored table SHAPE renders distinctly through the corner radius — a round table reads as a
         circular/stadium token, a square one as sharp corners, a rect one as the default rounded rect —
         so the shape control is a live visual, not a dead enum. Token-driven (never a literal px/%) so
         a deployment can retheme the radii. The base card rule above sets the rect default; these
         shape classes override it. */
      .card.shape-round {
        border-radius: var(--wt-radius-full);
      }

      .card.shape-square {
        border-radius: var(--wt-radius-sm);
      }

      .card.shape-rect {
        border-radius: var(--wt-radius-md);
      }

      .card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
      }

      .label {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .capacity {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .occupancy {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .total {
        font-weight: var(--wt-font-weight-bold);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .badge.to-serve {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }

      /* The manual-status chip: text in the theme colour on a neutral chip, with the DATA-driven status
         colour as a border + a small swatch — never as a text background, so contrast stays token-fixed
         and the arbitrary colour cannot fail a11y. Verbatim from FP-1's .badge.status. */
      .badge.status {
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
      }
    `,
  ];

  /** The table this token renders. */
  @property({ attribute: false }) table!: FloorTable;

  /** Optional localisable suffix words (see {@link TableTokenLabels}). */
  @property({ attribute: false }) labels: TableTokenLabels = {};

  override render(): TemplateResult | typeof nothing {
    const t = this.table;
    // Nothing to draw until a table is assigned (a bare element mounted before its `.table` prop set).
    if (t == null) return nothing;
    // The stored shape drives a distinct corner radius (see the `.shape-*` rules). An unplaced tray
    // token carries no shape (`null`) and falls back to `rect` — the default rounded rect it drew
    // before, so the tray is visually unchanged.
    return html`
      <div class="card state-${t.state} shape-${t.shape ?? "rect"}">
        <span class="card-head">
          <span class="label">${t.label}</span>
          ${
            t.capacity != null
              ? html`<span class="capacity"
                  >${t.capacity}${this.labels.covers ? ` ${this.labels.covers}` : nothing}</span
                >`
              : nothing
          }
        </span>
        ${this.#occupancy(t)}
        <span class="badges">
          ${
            t.pendingToServe > 0
              ? html`<span class="badge to-serve" data-to-serve
                  >${t.pendingToServe}${this.labels.toServe ? ` ${this.labels.toServe}` : nothing}</span
                >`
              : nothing
          }
          ${
            t.status != null
              ? html`<span class="badge status" data-status style="border-color: ${t.status.color}">
                  <span class="dot" style="background: ${t.status.color}"></span>${t.status.label}
                </span>`
              : nothing
          }
        </span>
      </div>
    `;
  }

  /** The state-specific occupancy body — only the open tab's running total is DATA the token can show
   * without a locale word; the free / delivery lines are the consumer's to add via its own copy. */
  #occupancy(t: FloorTable): TemplateResult | typeof nothing {
    if (t.state === "open-tab" && t.tabTotal != null) {
      return html`<span class="occupancy tab-open"
        ><span class="total">${t.tabTotal} €</span></span
      >`;
    }
    return nothing;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-table-token": WtTableToken;
  }
}
