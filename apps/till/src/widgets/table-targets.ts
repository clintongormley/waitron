import { css, html, nothing, type TemplateResult } from "lit";
import { partyTablesName } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { TableParty, TableState } from "../api/client.js";

/** The styles {@link tableTarget} needs. */
export const tableTargetStyles = css`
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

/** The party a picker showed seated at a table, which a move sends as what it read there; null for
 * a table it showed free. */
export type SeatedRead = Pick<TableParty, "id" | "revision"> | null;

export function seatedRead(table: TableState): SeatedRead {
  return table.party === null ? null : { id: table.party.id, revision: table.party.revision };
}

/** The labels of the party's tables that `tables` lists, "Mesa 4, 5". */
export function partyTablesLabel(party: TableParty, tables: readonly TableState[]): string {
  return partyTablesName(
    party.tableIds.flatMap((id) => tables.find((table) => table.id === id)?.label ?? []),
  );
}

/** The party's display name with its tables, "Ana (Mesa 4, 5)", or the tables alone for a party
 * with no name. */
export function partyScope(party: TableParty, tables: readonly TableState[]): string {
  const labels = partyTablesLabel(party, tables);
  return party.name === null
    ? labels
    : t("table.party_scope")
        .replace("{name}", () => party.name!)
        .replace("{tables}", () => labels);
}

export function moveBillScope(bill: string, into: string): string {
  return t("table.move_bill_scope")
    .replace("{bill}", () => bill)
    .replace("{into}", () => into);
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
