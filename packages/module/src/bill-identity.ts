/**
 * A bill's numbering party (the party whose bill list shows it; null at the counter), its number
 * there, and its name.
 */
export interface BillIdentity {
  partyId: string | null;
  number: number | null;
  name: string | null;
}
