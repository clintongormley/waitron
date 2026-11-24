import { compareDecimal, decimal } from "@waitron/shared";
import type { BillBalance, HeldOrderSummary } from "../api/client.js";

/**
 * The bill balance of the Counter's retrieved order while the held list says it is paid over its
 * total. The overpaid notice shows, and Keep as tip sends, the balance's `overpaid`, the figure the
 * server compares Keep as tip's amount with, rather than one worked out from the held list. Read
 * once for each held-list row, so a refreshed list reads it again.
 */
export class CounterOverpaidRead {
  #row: HeldOrderSummary | undefined;
  #balance: BillBalance | null | undefined = null;

  constructor(
    private readonly read: (billId: string) => Promise<BillBalance>,
    private readonly answered: () => void,
  ) {}

  /** Null when the list says the order is not overpaid or the read failed; undefined while the
   * read is unanswered. */
  balanceFor(row: HeldOrderSummary | undefined): BillBalance | null | undefined {
    if (row === undefined || compareDecimal(decimal(row.outstanding), decimal("0")) >= 0) {
      this.#row = undefined;
      return null;
    }
    if (row !== this.#row) {
      this.#row = row;
      this.#balance = undefined;
      this.read(row.id).then(
        (balance) => this.#answer(row, balance),
        () => this.#answer(row, null),
      );
    }
    return this.#balance;
  }

  #answer(row: HeldOrderSummary, balance: BillBalance | null): void {
    if (row !== this.#row) return;
    this.#balance = balance;
    this.answered();
  }
}
