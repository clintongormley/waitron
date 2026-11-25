import type { HeldOrder } from "../api/client.js";
import { limited, TABLE_REQUEST_LIMIT_MS } from "./draft-sync.js";

export function isOrderGone(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === "working_order.not_found";
}

/**
 * Reads an open counter order's recorded set-menu copies again: they hold the allergens published
 * when the order was read. Only the newest read's answer counts, and only while its order is open.
 */
export class CounterCopiesRead {
  #request = 0;
  #failed?: () => boolean;

  async read(
    open: () => boolean,
    send: (signal: AbortSignal) => Promise<HeldOrder>,
    take: (read: HeldOrder) => void,
  ): Promise<void> {
    const request = ++this.#request;
    const current = () => request === this.#request && open();
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    try {
      const read = await send(limit.signal);
      if (current()) take(read);
    } catch (error) {
      if (!isOrderGone(error)) this.#failed = current;
    } finally {
      limit.done();
    }
  }

  /** Whether the newest read failed and its order is still open. */
  get due(): boolean {
    return this.#failed?.() === true;
  }
}
