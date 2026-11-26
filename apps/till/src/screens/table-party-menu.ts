import { css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type { PartyAllergyRead } from "@waitron/module";
import type { WtRowActions } from "@waitron/ui";
import "@waitron/ui/src/components/wt-switch.js";
import type { TableParty } from "../api/floor-api.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export type TablePartyAction = "allergy" | "guests" | "name" | "move" | "join" | "split-table";

interface TablePartyMenuOptions {
  heading: string;
  party: TableParty | null;
  allergy: PartyAllergyRead | null;
  requested: boolean;
  commandBusy: boolean;
  choose(event: Event, action: TablePartyAction): void;
  requestBill(requested: boolean): void;
  finish(): void;
}

export function tablePartyMenu(options: TablePartyMenuOptions) {
  const { heading, party, allergy, requested, commandBusy } = options;
  const snapshot = allergy?.snapshot;
  const allergySummary =
    snapshot?.answer === "allergies"
      ? [
          ...new Set(
            snapshot.guests.flatMap((guest) =>
              Object.entries(guest.allergens).map(([code, entry]) =>
                allergenLabel(code, entry, currentLocale()),
              ),
            ),
          ),
        ].join(", ") || t("allergy.banner")
      : snapshot?.answer === "none"
        ? t("allergy.none")
        : "";
  const row = (action: TablePartyAction, key: StringKey, value: string | number | null = null) =>
    html`<button
      type="button"
      class="party-menu-row"
      data-row-choice
      data-action=${action}
      @click=${(event: Event) => options.choose(event, action)}
    >
      ${t(key)}
      <span class="party-menu-value">${value}</span>
      <span aria-hidden="true">›</span>
    </button>`;
  return html`<wt-row-actions
    class="party-menu"
    data-party-menu
    data-move-split
    bottom-sheet
    panel
    label=${heading}
    @wt-row-actions-toggle=${(event: CustomEvent<{ open: boolean }>) => {
      if (!event.detail.open) return;
      const menu = event.currentTarget as WtRowActions;
      const control = menu.querySelector("wt-switch");
      if (control !== null) control.checked = requested;
      menu.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
    }}
  >
    <span slot="trigger">${heading} <span aria-hidden="true">▾</span></span>
    <div class="table-menu-heading" id="party-menu-heading">${heading}</div>
    <div role="group" aria-labelledby="party-menu-heading" data-table-menu-table>
      ${
        party === null
          ? nothing
          : html` ${row("allergy", "allergy.title", allergySummary)}
              ${row("guests", "table.action_guests", party.guestCount)}
              ${row("name", "table.action_name", party.name)}
              <wt-switch
                class="party-menu-row"
                data-bill-request
                label=${t("signal.bill_requested")}
                .checked=${live(requested)}
                .disabled=${commandBusy}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                  if (commandBusy) return;
                  (event.currentTarget as HTMLElement).closest("wt-row-actions")?.hide();
                  options.requestBill(event.detail.checked);
                }}
              ></wt-switch>`
      }
      ${row("move", "table.action_move_to_table")} ${row("join", "table.action_join")}
      ${party !== null && party.tableIds.length > 1 ? row("split-table", "table.action_split_table") : nothing}
    </div>
    ${
      party === null
        ? nothing
        : html`<hr />
            <wt-button data-finish-table @click=${options.finish}>${t("table.finish")}</wt-button>`
    }
  </wt-row-actions>`;
}

export const tablePartyMenuStyles = css`
  .party-menu {
    align-self: start;
    max-width: 100%;
  }
  .party-menu::part(trigger) {
    max-width: 100%;
    font-weight: var(--wt-font-weight-bold);
    padding-inline: var(--wt-space-2);
    overflow-wrap: anywhere;
  }
  .party-menu::part(trigger):is(:hover, [aria-expanded="true"]) {
    background: var(--wt-color-surface-lifted);
  }
  .party-menu .table-menu-heading {
    text-transform: uppercase;
    font-weight: var(--wt-font-weight-bold);
  }
  .party-menu .table-menu-heading::before {
    content: "";
    display: block;
    width: var(--wt-tap-min);
    height: var(--wt-space-1);
    margin: 0 auto var(--wt-space-2);
    border-radius: var(--wt-radius-full);
    background: var(--wt-color-border);
  }
  .party-menu .party-menu-row {
    border-radius: 0;
    border-block-end: var(--wt-field-line-width) solid var(--wt-color-border);
  }
  .party-menu-value {
    margin-inline-start: auto;
    color: var(--wt-color-text-muted);
    text-align: end;
  }
  wt-switch.party-menu-row {
    display: grid;
    max-width: none;
    padding-inline: var(--wt-space-3) var(--wt-space-4);
  }
  wt-switch.party-menu-row::part(label) {
    order: -1;
    margin-inline-end: auto;
  }
  .party-menu [data-finish-table] {
    margin: 0 var(--wt-space-3) var(--wt-space-3);
    width: auto;
  }
`;
