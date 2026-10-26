import type { TableParty, TableState } from "../api/client.js";
import { groupTables } from "./table-signals.js";

export interface BarTable {
  tableId: string;
  name: string;
  unsent: boolean;
  current: boolean;
}

/** The bill whose draft this device holds or has just released (D4): how many lines its store
 * holds, and whether someone else now edits the bill (`edit.editorId` set and not this person). */
export interface LocalBill {
  partyId: string | null;
  tableId: string;
  billId: string | null;
  lines: number;
  takenByOther: boolean;
}

type Held = LocalBill & { onScreen: boolean };

/** D4: a local bill's lines count, never its store's lock. */
const localUnsent = (bill: LocalBill): boolean => bill.lines > 0 && !bill.takenByOther;

/**
 * The tables a handheld's bar gives a button (D3, D4, D13): each open party where `personId` has
 * something unsent, and the held party or free table while it is on screen, in `tables`' order.
 * Per bill the held answer wins, then a released one, then the floor read.
 */
export function barTables(
  tables: readonly TableState[],
  personId: string,
  local: { held: Held | null; released: readonly LocalBill[] },
): BarTable[] {
  if (personId === "") return [];
  const held = local.held;

  const unsentOf = (party: TableParty | null, mine: LocalBill | null): boolean => {
    const answers = new Map<string | null, boolean>();
    if (party !== null) {
      for (const draft of party.unsentDrafts) {
        answers.set(draft.billId, draft.ownerId === personId && draft.lineCount > 0);
      }
      for (const bill of local.released) {
        if (bill.partyId === party.id) answers.set(bill.billId, localUnsent(bill));
      }
    }
    if (mine !== null) answers.set(mine.billId, localUnsent(mine));
    return [...answers.values()].some(Boolean);
  };

  return groupTables<{ party: TableParty | null; mine: Held | null }>(tables, (table) => {
    const party = table.party;
    if (party?.state === "open") {
      return { key: party.id, value: { party, mine: held?.partyId === party.id ? held : null } };
    }
    if (held !== null && held.partyId === null && held.tableId === table.id) {
      return { key: `table:${table.id}`, value: { party: null, mine: held } };
    }
    return null;
  }).flatMap(({ value: { party, mine }, table, name }) => {
    const unsent = unsentOf(party, mine);
    const current = mine?.onScreen === true;
    return unsent || current ? [{ tableId: mine?.tableId ?? table.id, name, unsent, current }] : [];
  });
}
