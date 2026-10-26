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

/** The bill this device holds, and whether the order screen shows it. */
export type HeldBill = LocalBill & { onScreen: boolean };

/** D4: a local bill's lines count, never its store's lock. */
const localUnsent = (bill: LocalBill): boolean => bill.lines > 0 && !bill.takenByOther;

/** The party whose button stands for the held table: its own while the read lists it, else an open
 * party the read seats at the held table since. */
function heldPartyOf(held: HeldBill | null, tables: readonly TableState[]): string | null {
  if (held === null) return null;
  if (held.partyId !== null && tables.some((table) => table.party?.id === held.partyId))
    return held.partyId;
  const there = tables.find((table) => table.id === held.tableId)?.party;
  return there?.state === "open" ? there.id : null;
}

/**
 * The tables a handheld's bar gives a button (D3, D4, D13): each open party where `personId` has
 * something unsent, and the held party, or a held table whose party the read does not list, while it
 * is on screen, in `tables`' order.
 * Per bill the held answer wins, then a released one, then the floor read. A button opens the held
 * table only while the read seats its party there, so it never opens a table it does not name.
 */
export function barTables(
  tables: readonly TableState[],
  personId: string,
  /** Later records of one bill win over earlier ones. */
  local: { held: HeldBill | null; released: readonly LocalBill[] },
): BarTable[] {
  if (personId === "") return [];
  const held = local.held;
  const heldPartyId = heldPartyOf(held, tables);
  // D13: a held party the read does not list yet still has its table on screen.
  const unlisted = held !== null && heldPartyId === null ? held : null;

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

  return groupTables<{ party: TableParty | null; here: HeldBill | null }>(tables, (table) => {
    if (unlisted?.tableId === table.id) {
      return { key: `table:${table.id}`, value: { party: null, here: unlisted } };
    }
    const party = table.party;
    if (party?.state === "open") {
      return { key: party.id, value: { party, here: heldPartyId === party.id ? held : null } };
    }
    return null;
  }).flatMap(({ value: { party, here }, table, name }) => {
    // A party seated at the held table since shares its place on screen, never its lines.
    const mine = party === null || here?.partyId === party.id ? here : null;
    const unsent = unsentOf(party, mine);
    const current = here?.onScreen === true;
    const seatsHeld =
      here !== null &&
      (party === null ||
        tables.some((each) => each.id === here.tableId && each.party?.id === party.id));
    const tableId = seatsHeld ? here.tableId : table.id;
    return unsent || current ? [{ tableId, name, unsent, current }] : [];
  });
}
