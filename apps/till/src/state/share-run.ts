/** What the run reads from a payment just taken: a card still at the reader holds `pending`;
 * `settled` marks a card the balance already included. */
export interface ShareTaken {
  pending?: string;
  settled?: true;
}

export interface PaidShare {
  /** What the share applied to the bill, tip left out. */
  readonly amount: string;
  readonly state: "received" | "card";
}

/** On a handheld, the equal shares paid in a row in one opening of Pay: `of` is the count the
 * first was split among. A card still in progress counts as paid; one later declined ends the run,
 * since it may leave its share owing. */
export class ShareRun {
  #of: number | null = null;
  #paid: { amount: string; state: PaidShare["state"] }[] = [];
  #cards = new Map<ShareTaken, { state: PaidShare["state"] }>();
  #sending: { of: number; applied: string } | null = null;

  get of(): number | null {
    return this.#of;
  }

  get paidCount(): number {
    return this.#paid.length;
  }

  /** The guests still to pay in the run, 0 outside one. */
  get left(): number {
    return this.#of === null ? 0 : this.#of - this.#paid.length;
  }

  get paid(): readonly PaidShare[] {
    return this.#paid.map((share) => ({ ...share }));
  }

  get cardInProgress(): boolean {
    return this.#cards.size > 0;
  }

  /** Whether `taken` is a card the run counted while it was still in progress. */
  counts(taken: ShareTaken): boolean {
    return this.#cards.has(taken);
  }

  /** The payment about to be sent: a share split among `shareOf`, or null for any other. */
  sending(shareOf: number | null, applied: string): void {
    this.#sending = shareOf === null ? null : { of: shareOf, applied };
  }

  /** Only the payment answered after `sending` counts, so an earlier answer counts nothing. */
  taken(taken: ShareTaken): void {
    const sent = this.#sending;
    this.#sending = null;
    if (taken.settled === true) return;
    if (sent === null) return this.end();
    if (this.#of === null || this.left !== sent.of) {
      this.end();
      this.#of = sent.of;
    }
    const entry: { amount: string; state: PaidShare["state"] } = {
      amount: sent.applied,
      state: taken.pending === undefined ? "received" : "card",
    };
    this.#paid.push(entry);
    if (taken.pending !== undefined) this.#cards.set(taken, entry);
  }

  /** A card the run counted while in progress was charged. */
  received(taken: ShareTaken): void {
    const entry = this.#cards.get(taken);
    if (entry === undefined) return;
    entry.state = "received";
    this.#cards.delete(taken);
  }

  end(): void {
    this.#of = null;
    this.#paid = [];
    this.#cards.clear();
  }
}
