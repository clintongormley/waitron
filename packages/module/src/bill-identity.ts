/** A bill's number within the seated party that shows it (null at the counter), and its name. */
export interface BillIdentity {
  number: number | null;
  name: string | null;
}
