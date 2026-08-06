import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { PrepQueueEntry, PrepState } from "../api/client.js";
import type { StringKey } from "../i18n/strings.js";

/** The state each prep state advances TO next. `collected` has no successor — an entry in that state
 * never appears here anyway (see the class doc), so it needs no advance control. */
const NEXT: Record<PrepState, PrepState | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: "collected",
  collected: undefined,
};

/**
 * The node-scoped PREP-QUEUE list (7c prepare & collect, design §5): one row per order still active
 * in the kitchen — queued, preparing or ready — each with an Advance control that steps it to the
 * next prep state. A `collected` entry never appears: `GET /api/prep-queue` (mirrored by
 * `listPrepQueue`) excludes it, so an order drops off the till's queue the moment its LAST advance
 * (ready → collected) lands — that is why the `ready` row's Advance control is the final one shown,
 * with no successor row ever rendered for it.
 *
 * It is a PURE VIEW, the same shape `till-held-orders` (park & retrieve, 7b) established: it holds no
 * state and never talks to the store or the API. The app owns the list (refreshed on entering the
 * counter and after every advance) and hands it down; the Advance control emits a composed, bubbling
 * `advance-prep` carrying `{ id, to }`, which the app turns into an `advancePrep` call. The widget
 * names no sibling and reaches for no store (spec §3).
 */
@customElement("till-prep-queue")
export class TillPrepQueue extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .title {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .state {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  /** This node's active prep entries (queued/preparing/ready) to list. The app owns and refreshes
   * this; the widget only renders it. */
  @property({ attribute: false }) entries: PrepQueueEntry[] = [];

  /** Ask the app to advance entry `id` to prep state `to`. */
  #advance(id: string, to: PrepState): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string; to: PrepState }>("advance-prep", {
        detail: { id, to },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <h2 class="title">${t("prep.title")}</h2>
      ${
        this.entries.length === 0
          ? html`<p class="empty">${t("prep.empty")}</p>`
          : this.entries.map((entry) => {
              const next = NEXT[entry.state];
              return html`
                <div class="row">
                  <div class="summary">
                    <span class="number">#${entry.orderNumber}</span>
                    ${entry.label ? html`<span class="label">${entry.label}</span>` : nothing}
                  </div>
                  <span class="state">${t(`prep.state.${entry.state}` as StringKey)}</span>
                  ${
                    next === undefined
                      ? nothing
                      : html`
                          <wt-button
                            class="advance"
                            variant="primary"
                            aria-label=${`${t("prep.advance")} #${entry.orderNumber}`}
                            @click=${() => this.#advance(entry.id, next)}
                          >
                            ${t("prep.advance")}
                          </wt-button>
                        `
                  }
                </div>
              `;
            })
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-prep-queue": TillPrepQueue;
  }
}
