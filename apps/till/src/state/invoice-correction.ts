import type { TillApi } from "../api/client.js";
import type {
  InvoiceCorrectionCashGiven,
  InvoiceCorrectionCashRequest,
} from "../api/invoice-correction-types.js";
import {
  fail,
  scopePrefix,
  stillSaved,
  tenderRefundAmount,
  withJournalStorage,
  writeVerified,
  type TenderRefundScope,
} from "./tender-refund.js";

type Override = InvoiceCorrectionCashRequest["override"];
type CorrectionApi = Pick<TillApi, "giveInvoiceCorrectionCash">;
type Saved<T> = T & { submissionId: string };

const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? error.code : undefined;
const statusOf = (error: unknown) =>
  error && typeof error === "object" && "status" in error ? error.status : undefined;

const money = (value: string) => tenderRefundAmount(value) ?? value;
const cashFingerprint = (ask: { amount: string }) => JSON.stringify([money(ask.amount)]);

/**
 * Saves each request's submission id in the refund journal before sending, so an unknown answer is
 * replayed with it. The server checks the session, the device, authorization and trading before it
 * recognises a repeat, so only a refusal of a first send, or a correction refusal (which comes after
 * that recognition, or names a correction that does not exist), proves the request did nothing and
 * releases its id. One send at a time, as in `TenderRefundSession`.
 */
export class InvoiceCorrectionSession {
  #busy = false;
  constructor(
    private readonly scope: TenderRefundScope,
    private readonly api: CorrectionApi,
    private readonly storage?: Storage,
  ) {}

  #key(correctionId: string): string {
    return `${scopePrefix(this.scope)}${JSON.stringify(["invoice-correction-cash", correctionId])}`;
  }

  #read<T>(key: string): Saved<T> | null {
    return withJournalStorage(this.storage, (storage) => {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const saved = JSON.parse(raw) as { version: unknown; request: Saved<T> };
      if (saved.version !== 1 || typeof saved.request.submissionId !== "string")
        return fail("storage");
      return saved.request;
    });
  }

  #forget(key: string, submissionId: string): void {
    if (stillSaved(() => this.#read(key)?.submissionId, submissionId))
      withJournalStorage(this.storage, (storage) => storage.removeItem(key));
  }

  async #send<T extends object, R>(
    key: string,
    ask: T,
    fingerprint: (ask: T) => string,
    send: (request: Saved<T>) => Promise<R>,
  ): Promise<R> {
    if (this.#busy) return fail("busy");
    this.#busy = true;
    try {
      return await this.#sendOnce(key, ask, fingerprint, send);
    } finally {
      this.#busy = false;
    }
  }

  async #sendOnce<T extends object, R>(
    key: string,
    ask: T,
    fingerprint: (ask: T) => string,
    send: (request: Saved<T>) => Promise<R>,
  ): Promise<R> {
    let request = this.#read<T>(key);
    const fresh = request === null;
    if (request !== null) {
      if (fingerprint(request) !== fingerprint(ask)) return fail("locked");
    } else {
      request = { ...ask, submissionId: crypto.randomUUID() };
      const value = JSON.stringify({ version: 1, request });
      withJournalStorage(this.storage, (storage) => writeVerified(storage, key, value));
    }
    try {
      const result = await send(request);
      this.#forget(key, request.submissionId);
      return result;
    } catch (error) {
      const code = codeOf(error);
      const status = statusOf(error);
      if (
        // `invoice_correction.*` as in the card leg, and `sale.correction_*`, which the cash route
        // raises only after its submission lookup.
        (typeof code === "string" &&
          (code.startsWith("invoice_correction.") || code.startsWith("sale.correction_"))) ||
        (fresh && typeof status === "number" && status < 500)
      )
        this.#forget(key, request.submissionId);
      throw error;
    }
  }

  savedCash(correctionId: string): Saved<{ amount: string }> | null {
    return this.#read(this.#key(correctionId));
  }

  giveCash(
    correctionId: string,
    ask: Omit<InvoiceCorrectionCashRequest, "submissionId" | "override">,
    override?: Override,
  ): Promise<InvoiceCorrectionCashGiven> {
    return this.#send(this.#key(correctionId), ask, cashFingerprint, (request) =>
      this.api.giveInvoiceCorrectionCash(correctionId, {
        ...request,
        ...(override && { override }),
      }),
    );
  }
}
