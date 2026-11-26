import { css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type { PartyAllergyRead } from "@waitron/module";
import "@waitron/ui/src/components/wt-menu-row.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { TableParty } from "../api/floor-api.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { countText, currentLocale, t } from "../i18n/t.js";
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
  const subtitle = [
    party?.guestCount == null
      ? null
      : countText(party.guestCount, "table.menu_guests", "table.menu_guest"),
    party?.name === heading ? null : party?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasSplit = party !== null && party.tableIds.length > 1;
  const row = (action: TablePartyAction, key: StringKey, value: string | number | null = null) =>
    html`<button
      type="button"
      data-row-choice
      data-action=${action}
      @click=${(event: Event) => options.choose(event, action)}
    >
      <wt-menu-row
        label=${t(key)}
        .value=${value ?? ""}
        chevron
        ?divider=${party !== null || action !== "join"}
      ></wt-menu-row>
    </button>`;
  return html`<div class="party-menu-header">
    <wt-row-actions
      class="party-menu"
      data-party-menu
      data-move-split
      bottom-sheet
      sheet-variant="menu"
      panel
      label=${heading}
      sheet-heading=${heading}
      @wt-row-actions-toggle=${(event: CustomEvent<{ open: boolean }>) => {
        const menu = event.currentTarget as HTMLElement;
        menu.toggleAttribute("data-open", event.detail.open);
        if (!event.detail.open) return;
        const control = menu.querySelector("wt-switch");
        if (control !== null) control.checked = requested;
      }}
    >
      <span slot="trigger">${heading}<wt-icon name="chevron-down" size="lg"></wt-icon></span>
      <div data-table-menu-table>
        ${
          party === null
            ? nothing
            : html` ${row("allergy", "allergy.title", allergySummary)}
                ${row("guests", "table.action_guests", party.guestCount)}
                ${row("name", "table.action_name", party.name)}
                <wt-menu-row label=${t("signal.bill_requested")} divider>
                  <wt-switch
                    data-bill-request
                    hide-label
                    label=${t("signal.bill_requested")}
                    .checked=${live(requested)}
                    .disabled=${commandBusy}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      if (commandBusy) return;
                      (event.currentTarget as HTMLElement)
                        .closest("wt-row-actions")
                        ?.hide({ restoreFocus: true });
                      options.requestBill(event.detail.checked);
                    }}
                  ></wt-switch>
                </wt-menu-row>`
        }
        ${row("move", "table.action_move_to_table")} ${row("join", "table.action_join")}
        ${hasSplit ? row("split-table", "table.action_split_table") : nothing}
      </div>
      ${
        party === null
          ? nothing
          : html`<wt-button variant="secondary" data-finish-table @click=${options.finish}
              >${t("table.finish")}</wt-button
            >`
      }
    </wt-row-actions>
    ${subtitle ? html`<p class="party-menu-subtitle">${subtitle}</p>` : nothing}
  </div>`;
}

export const tablePartyMenuStyles = css`
  .party-menu-header {
    align-self: start;
    max-width: 100%;
  }
  .party-menu {
    max-width: 100%;
  }
  .party-menu::part(trigger) {
    max-width: 100%;
    font-size: var(--wt-menu-row-label-size);
    font-weight: var(--wt-font-weight-bold);
    padding-inline: var(--wt-space-2);
    overflow-wrap: anywhere;
  }
  .party-menu[data-open]::part(trigger),
  .party-menu::part(trigger):hover {
    background: var(--wt-color-surface-lifted);
  }
  .party-menu [slot="trigger"] {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
  }
  .party-menu [slot="trigger"] wt-icon {
    flex: none;
    color: var(--wt-color-text-muted);
  }
  .party-menu-subtitle {
    margin: 0 var(--wt-space-2);
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
    overflow-wrap: anywhere;
  }
  .party-menu [data-finish-table] {
    margin: var(--wt-space-2) var(--wt-space-4) var(--wt-space-5);
    width: auto;
  }
  .party-menu [data-finish-table]::part(button) {
    min-height: var(--wt-menu-row-height);
    font-size: var(--wt-menu-row-label-size);
  }
  @media (forced-colors: none) {
    .party-menu wt-switch::part(track) {
      width: var(--wt-tap-min);
      height: calc(var(--wt-space-5) + 2 * var(--wt-field-line-width));
      border-radius: var(--wt-radius-full);
    }
    .party-menu wt-switch:not([checked])::part(track) {
      background: var(--wt-color-surface-sunken);
    }
    .party-menu wt-switch::part(thumb) {
      width: calc(var(--wt-space-4) + var(--wt-space-1));
      height: calc(var(--wt-space-4) + var(--wt-space-1));
      margin-inline-start: calc(var(--wt-space-1) - var(--wt-field-line-width));
      border-radius: var(--wt-radius-full);
      background: var(--wt-color-paper);
    }
    .party-menu wt-switch[checked]::part(thumb) {
      transform: translateX(calc(var(--wt-space-4) + 2 * var(--wt-field-line-width)));
    }
  }
`;
