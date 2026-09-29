import { css, html, nothing, type TemplateResult } from "lit";
import { partyTablesName } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TableParty, TableState } from "../api/client.js";

/** The styles {@link tableTarget} needs, for a host that lists targets in `.action-options`. */
export const tableTargetStyles = css`
  .action-options {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
  }

  .table-target {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-1);
  }

  .target-state,
  .target-reason {
    color: var(--wt-color-text-muted);
    font-size: var(--wt-font-size-sm);
  }

  .target-state {
    margin-inline-start: var(--wt-space-2);
  }

  .target-reason {
    margin: 0;
  }
`;

/** The party's display name with its tables, "Ana (Mesa 4, 5)", or the tables alone for a party
 * with no name. */
export function partyScope(party: TableParty, tables: readonly TableState[]): string {
  const labels = partyTablesName(
    party.tableIds.flatMap((id) => tables.find((table) => table.id === id)?.label ?? []),
  );
  return party.name === null
    ? labels
    : t("table.party_scope")
        .replace("{name}", () => party.name!)
        .replace("{tables}", () => labels);
}

/** One table a person may name, with its condition. A table that needs clearing is listed but
 * cannot be chosen, and says why. `ownPartyId` names the acting party, whose tables read as theirs. */
export function tableTarget(
  table: TableState,
  ownPartyId: string | undefined,
  pick: (table: TableState) => void,
): TemplateResult {
  const clearing = table.condition === "needs_clearing";
  const held = table.party;
  const state = clearing
    ? t("floor.needs_clearing")
    : held === null
      ? t("floor.free")
      : held.id === ownPartyId
        ? t("table.this_party")
        : t("table.held_by").replace("{party}", () => held.displayName);
  return html`<div class="table-target">
    <wt-button
      class="target"
      data-target=${table.id}
      variant="secondary"
      ?disabled=${clearing}
      @click=${() => {
        if (!clearing) pick(table);
      }}
    >
      <span class="target-label">${table.label}</span>
      <span class="target-state">${state}</span>
    </wt-button>
    ${
      clearing
        ? html`<p class="target-reason" data-target-reason=${table.id}>
            ${codeMessage("table.needs_clearing")}
          </p>`
        : nothing
    }
  </div>`;
}
