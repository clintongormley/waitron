import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, renderFloorChips } from "@waitron/ui";
import { decimal, formatMoney, isZeroDecimal } from "@waitron/shared";
import type { TableState, UnsentDraft } from "../api/client.js";
import { countText, currentLocale, named, t } from "../i18n/t.js";
import { readyText, seatsFor } from "../state/floor-map.js";
import { reminderDueAt } from "../state/release-reminder.js";
import { signalOf } from "../state/table-signals.js";
import { signalChipStyles, signalChips } from "./signal-chips.js";
import { trackDialog } from "./track-dialog.js";

export function unsentText({ ownerName, lineCount }: UnsentDraft): string {
  return named(
    ownerName,
    countText(lineCount, "floor.unsent_owner", "floor.unsent_owner_one"),
    countText(lineCount, "floor.unsent", "floor.unsent_one"),
  );
}

/** Nothing of the party is left to pay, and no tab is open that could still take a round. */
export function partyPaid(table: TableState): boolean {
  return (
    table.party !== null && !table.hasOpenTab && isZeroDecimal(decimal(table.party.outstanding))
  );
}

/** Each dish counted once: the server's to-serve count includes the ready dishes, and its ready
 * count the dishes en route (`apps/server/src/working-order.ts`). A station's ready chip stands in
 * for the ready count. */
function kitchenProgress(table: TableState): string {
  const ready =
    signalOf(table.signals, "ready") === undefined ? table.readyToServe - table.enRoute : 0;
  return [
    [
      table.pendingToServe - table.readyToServe,
      (n: number) => `${n} ${t("floor.to_serve")}`,
    ] as const,
    [ready, readyText] as const,
    [table.enRoute, (n: number) => `${n} ${t("floor.en_route")}`] as const,
  ]
    .filter(([count]) => count > 0)
    .map(([count, words]) => words(count))
    .join(" · ");
}

/**
 * Everything the floor knows about one table, in a dialog. It saves nothing.
 *
 * `details-close` (no detail) asks the holder to close it; it is sent on Close, on Escape and after
 * Mark cleared, never when the holder closed it by taking its table away.
 */
@customElement("till-table-details-sheet")
export class TillTableDetailsSheet extends LitElement {
  static override styles = [
    baseStyles,
    signalChipStyles,
    css`
      .lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .lines + .chips {
        margin-top: var(--wt-space-2);
      }

      .fire-due {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** `null` keeps the dialog closed. */
  @property({ attribute: false }) table: TableState | null = null;
  /** The name as drawn: "Terrace 4+5" on the floor, or the party's name on the order screen. */
  @property() heading = "";
  /** Injectable clock for Time to fire; unset reads `Date.now()` on each render. */
  @property({ attribute: false }) now?: number;

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (this.table !== null) this.#emit("details-close");
  }

  #markCleared(table: TableState): void {
    this.#emit("mark-cleared", { tableId: table.id });
    this.#emit("details-close");
  }

  #lines(table: TableState, chipCount: number): TemplateResult[] {
    const party = table.party;
    const lines: TemplateResult[] = [];
    if (party !== null) {
      if (party.name !== null && party.name !== this.heading)
        lines.push(html`<li data-party-name>${party.name}</li>`);
      if (party.guestCount !== null)
        lines.push(html`<li data-guests>${t("floor.guests")}: ${party.guestCount}</li>`);
      lines.push(
        partyPaid(table)
          ? html`<li data-paid>${t("floor.paid")}</li>`
          : html`<li data-owed>
              ${t("floor.details_owed").replace("{amount}", () =>
                formatMoney(party.outstanding, currentLocale()),
              )}
            </li>`,
      );
      if (party.billCount > 1)
        lines.push(html`<li data-bills>${t("floor.bills")}: ${party.billCount}</li>`);
    }
    const kitchen = kitchenProgress(table);
    if (kitchen !== "") lines.push(html`<li data-kitchen>${kitchen}</li>`);
    for (const draft of party?.unsentDrafts ?? [])
      lines.push(html`<li data-unsent>${unsentText(draft)}</li>`);
    if (reminderDueAt(party?.reminder) <= (this.now ?? Date.now()))
      lines.push(html`<li class="fire-due" data-fire-due>${t("floor.fire_due")}</li>`);
    if (table.nextReservation !== null)
      lines.push(html`<li data-reserved>${t("floor.reserved")} ${table.nextReservation.time}</li>`);
    if (table.pendingDeliveries > 0)
      lines.push(
        html`<li data-delivery>${table.pendingDeliveries} ${t("floor.pending_delivery")}</li>`,
      );
    if (table.condition === "needs_clearing")
      lines.push(html`<li data-needs-clearing>${t("floor.needs_clearing")}</li>`);
    if (lines.length === 0 && chipCount === 0)
      lines.push(html`<li data-free>${t("floor.free")}</li>`);
    return lines;
  }

  #body(table: TableState): TemplateResult {
    const seats = seatsFor(table);
    const chips = signalChips(table.signals);
    const lines = this.#lines(table, chips.length);
    if (seats !== null)
      lines.unshift(
        html`<li data-seats>${countText(seats, "floor.seats", "floor.seats_one")}</li>`,
      );
    return html`${
        lines.length === 0
          ? nothing
          : html`<ul class="lines">
              ${lines}
            </ul>`
      }
      ${chips.length === 0 ? nothing : html`<div class="chips">${renderFloorChips(chips)}</div>`}
      <wt-button
        slot="footer"
        data-details-close
        variant="secondary"
        @click=${() => this.#emit("details-close")}
      >
        ${t("floor.details_close")}
      </wt-button>
      ${
        table.condition === "needs_clearing"
          ? html`<wt-button
              slot="footer"
              data-mark-cleared
              variant="primary"
              @click=${() => this.#markCleared(table)}
            >
              ${t("floor.mark_cleared")}
            </wt-button>`
          : nothing
      }`;
  }

  override render() {
    const table = this.table;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${table !== null}
      .heading=${this.heading}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      ${table === null ? nothing : this.#body(table)}
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-table-details-sheet": TillTableDetailsSheet;
  }
}
