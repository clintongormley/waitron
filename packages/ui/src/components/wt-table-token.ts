import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import type { FloorTable } from "../floor.js";
import { floorChipStyles, renderFloorChips } from "../floor-chips.js";
import { type FloorRing, floorRingStyles, renderFloorRing } from "../floor-ring.js";
import { formatMoney } from "@waitron/shared";

/** Localised words the token puts beside its data; this package carries no copy of its own. */
export interface TableTokenLabels {
  covers?: string;
  toServe?: string;
  /** A prefix, unlike the suffixes above: "Reserved 20:30". */
  reserved?: string;
  /** The forgotten marker's accessible name; without one the marker is `aria-hidden`. */
  forgotten?: string;
  /** The unsent-order mark's text; its accessible name adds the names: "Unsent: Alex, Sam". */
  unsent?: string;
  /** The fire-due chip's text; without one the chip is an unworded, `aria-hidden` mark. */
  fireDue?: string;
}

/**
 * Presentational only: the consumer wraps it in whatever tappable or draggable element it needs. The
 * status chip's colour comes from the consumer, so it rides on an inline style rather than in the
 * stylesheet.
 */
@customElement("wt-table-token")
export class WtTableToken extends LitElement {
  static override styles = [
    baseStyles,
    floorChipStyles,
    floorRingStyles,
    css`
      :host {
        display: block;
      }

      /* Mirrors till-floor-screen's .card body: the occupancy accent is the left edge, coloured by
         state via the tokens below. */
      .card {
        position: relative;
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

      /* Under reduced motion nothing pulses, so a forgotten table also widens its left edge. */
      .card.edge-forgotten {
        border-left-color: var(--wt-color-danger);
        border-left-width: var(--wt-space-3);
      }

      /* The forgotten MARKER (design §7.3) — a non-colour tell shown UNCONDITIONALLY for a forgotten
         table (not just under reduced motion, exactly like till-floor-screen's .badge.forgotten text
         chip: it never animates itself, so an operator who cannot distinguish the accent's colour still
         sees the escalation). A small CSS-only TRIANGLE — never text, since
         this package carries no inline copy and a spatial token has no room for a text chip like the
         list card's — and deliberately a DIFFERENT silhouette from the round .dot/.badge.status
         swatch, so it cannot be mistaken for a status marker. Positioned over the card's
         corner via the position: relative on .card above; every dimension is token-driven, never a
         literal length (this package's no-hardcoded-chrome guard bans it). */
      .forgotten-marker {
        position: absolute;
        top: calc(var(--wt-space-1) * -1);
        right: calc(var(--wt-space-1) * -1);
        width: 0;
        height: 0;
        border-left: var(--wt-space-2) solid transparent;
        border-right: var(--wt-space-2) solid transparent;
        border-bottom: var(--wt-space-3) solid var(--wt-color-danger);
      }

      .unsent-mark {
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translate(-50%, 50%);
        width: max-content;
        padding: 0 var(--wt-space-1);
        border: 1px dashed var(--wt-color-warning);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
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
      /* nowrap comes from text-wrap because no-hardcoded-chrome.test.ts's keyword-colour scan
         rejects the older shorthand, whose property name begins with a colour keyword. */
      .party-name {
        max-width: 100%;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        overflow: hidden;
        text-overflow: ellipsis;
        text-wrap: nowrap;
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

      .badge.reserved {
        background: var(--wt-color-table-reserved);
        color: var(--wt-color-on-table-reserved);
        border: 1px solid var(--wt-color-table-reserved);
      }

      .badge.fire-due wt-icon {
        flex: none;
        color: inherit;
      }

      .badge.fire-due {
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        border: 1px solid var(--wt-color-warning);
      }

      /* The status chip: text in the theme colour on a neutral chip, with the DATA-driven status
         colour as a border + a small swatch — never as a text background, so contrast stays token-fixed
         and the arbitrary colour cannot fail a11y. */
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

  @property({ attribute: false }) table!: FloorTable;

  @property({ attribute: false }) labels: TableTokenLabels = {};

  /** Writes the tab total as this locale writes euros; empty writes the amount and " €". */
  @property() locale = "";

  /** Overrides the `prefers-reduced-motion` query, which is read on every render when unset. */
  @property({ attribute: false }) reducedMotion?: boolean;

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #ring(t: FloorTable): FloorRing | null {
    if (t.timingBand === "forgotten") return "forgotten";
    if (t.timingBand === "overdue") return "overdue";
    if (t.fireDue === true) return "fire";
    if (t.timingBand === "warm") return "waiting";
    return null;
  }

  /** A non-colour tell, shown whatever the motion preference. */
  #forgottenMarker(t: FloorTable): TemplateResult | typeof nothing {
    if (t.timingBand !== "forgotten") return nothing;
    const label = this.labels.forgotten;
    return label
      ? html`<span class="forgotten-marker" data-forgotten role="img" aria-label=${label}></span>`
      : html`<span class="forgotten-marker" data-forgotten aria-hidden="true"></span>`;
  }

  override render(): TemplateResult | typeof nothing {
    const t = this.table;
    if (t == null) return nothing;
    const ring = this.#ring(t);
    const moving = !this.#prefersReducedMotion();
    const edge = ring === "forgotten" && !moving ? " edge-forgotten" : "";
    return html`
      <div class="card state-${t.state}${edge}">
        ${renderFloorRing(ring, moving)} ${this.#forgottenMarker(t)} ${this.#unsentMark(t)}
        <span class="card-head">
          <span class="label">${t.label}</span>
          ${
            t.seats != null
              ? html`<span class="capacity"
                  >${t.seats}${this.labels.covers ? ` ${this.labels.covers}` : nothing}</span
                >`
              : nothing
          }
        </span>
        ${
          t.partyName === undefined
            ? nothing
            : html`<span class="party-name" data-party-name>${t.partyName}</span>`
        }
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
            t.reservedTime != null
              ? html`<span class="badge reserved" data-reserved
                  >${this.labels.reserved ? html`${this.labels.reserved} ` : nothing}${t.reservedTime}</span
                >`
              : nothing
          }
          ${this.#fireDueChip(t)} ${renderFloorChips(t.chips ?? [])}
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

  #fireDueChip(t: FloorTable): TemplateResult | typeof nothing {
    if (t.fireDue !== true) return nothing;
    const label = this.labels.fireDue;
    return label
      ? html`<span class="badge fire-due" data-fire-due
          ><wt-icon name="floor-fire" size="sm"></wt-icon>${label}</span
        >`
      : html`<span class="badge fire-due" data-fire-due aria-hidden="true"
          ><wt-icon name="floor-fire" size="sm"></wt-icon
        ></span>`;
  }

  #unsentMark(t: FloorTable): TemplateResult | typeof nothing {
    const owners = t.unsentDrafts ?? [];
    if (owners.length === 0) return nothing;
    const label = this.labels.unsent;
    const names = owners.filter((name) => name !== "").join(", ");
    const name = [label, names].filter((part) => part).join(": ");
    return name
      ? html`<span class="unsent-mark" data-unsent role="img" aria-label=${name}
          >${label || names}</span
        >`
      : html`<span class="unsent-mark" data-unsent aria-hidden="true"></span>`;
  }

  #occupancy(t: FloorTable): TemplateResult | typeof nothing {
    if (t.state === "open-tab" && t.tabTotal != null) {
      return html`<span class="occupancy tab-open"
        ><span class="total"
          >${this.locale ? formatMoney(t.tabTotal, this.locale) : `${t.tabTotal} €`}</span
        ></span
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
