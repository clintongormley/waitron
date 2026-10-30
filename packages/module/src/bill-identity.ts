/**
 * A bill's numbering party (the seated party that shows it; null at the counter), its number
 * there, and its name.
 */
export interface BillIdentity {
  partyId: string | null;
  number: number | null;
  name: string | null;
}
