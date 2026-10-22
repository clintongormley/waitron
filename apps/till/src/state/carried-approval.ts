export interface CarriedApprover {
  personId: string;
  pin: string;
}

/**
 * The PIN of someone who may give refunds, given once for the refunds of one or more sales. It
 * lives in memory only and is handed out at most once per sale.
 */
export class CarriedApproval {
  #approver: CarriedApprover | null;
  readonly #waiting: Set<string>;

  constructor(approver: CarriedApprover, saleIds: Iterable<string>) {
    this.#approver = { personId: approver.personId, pin: approver.pin };
    this.#waiting = new Set(saleIds);
  }

  take(saleId: string): CarriedApprover | undefined {
    const approver = this.#approver;
    if (approver === null || !this.#waiting.delete(saleId)) return undefined;
    if (this.#waiting.size === 0) this.#approver = null;
    return { ...approver };
  }

  /** Counts a sale whose refund was sent without the carried PIN. */
  markSent(saleId: string): void {
    if (this.#waiting.delete(saleId) && this.#waiting.size === 0) this.#approver = null;
  }

  clear(): void {
    this.#approver = null;
    this.#waiting.clear();
  }
}
