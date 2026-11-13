import type { TillApi } from "../api/client.js";
import type {
  InvoiceCorrectionCashGiven,
  InvoiceCorrectionCashRequest,
  InvoiceCorrectionOpened,
  InvoiceCorrectionRequest,
} from "../api/invoice-correction-types.js";
import {
  fail,
  scopePrefix,
  tenderRefundAmount,
  withJournalStorage,
  writeVerified,
  type TenderRefundScope,
} from "./tender-refund.js";

type Override = InvoiceCorrectionRequest["override"];
export type InvoiceCorrectionAsk = Omit<InvoiceCorrectionRequest, "submissionId" | "override">;
type CorrectionApi = Pick<TillApi, "openInvoiceCorrection" | "giveInvoiceCorrectionCash">;
type Saved<T> = T & { submissionId: string };

export interface InvoiceCorrectionOpening {
  correctionId: string;
  /** Null when the invoice already had an open correction, which the till resumes instead. */
  opened: InvoiceCorrectionOpened | null;
}

const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? error.code : undefined;
const statusOf = (error: unknown) =>
  error && typeof error === "object" && "status" in error ? error.status : undefined;

const money = (value: string) => tenderRefundAmount(value) ?? value;
const id = (value: string) => value.toLowerCase();

/** The request's values in a fixed order, so a retry built in another order is the same request. */
function openFingerprint(ask: InvoiceCorrectionAsk): string {
  return JSON.stringify([
    money(ask.gross),
    ask.lineIds === undefined ? null : ask.lineIds.map(id).sort(),
    id(ask.reasonId),
    typeof ask.note === "string" && ask.note.trim() !== "" ? ask.note.trim() : null,
    ask.expectedSplit
      .map(({ rate, base, tax }) => JSON.stringify([rate, base, tax].map(money)))
      .sort(),
  ]);
}

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

  #key(kind: "open" | "cash", id: string): string {
    return `${scopePrefix(this.scope)}${JSON.stringify([`invoice-correction-${kind}`, id])}`;
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

  /**
   * Removes the entry at `key` only while it still holds `submissionId`'s request. An unreadable
   * entry is left: keeping it costs a replay under the same id, never a second payment.
   */
  #forget(key: string, submissionId: string): void {
    let held: string | undefined;
    try {
      held = this.#read(key)?.submissionId;
    } catch {
      return;
    }
    if (held === submissionId)
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
      let saved: string;
      try {
        saved = fingerprint(request);
      } catch {
        return fail("storage");
      }
      if (saved !== fingerprint(ask)) return fail("locked");
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
        // `invoice_correction.*` as in the card leg, and `sale.correction_*`, which Open and the cash
        // route raise only after their submission lookup.
        (typeof code === "string" &&
          (code.startsWith("invoice_correction.") || code.startsWith("sale.correction_"))) ||
        (fresh && typeof status === "number" && status < 500)
      )
        this.#forget(key, request.submissionId);
      throw error;
    }
  }

  savedOpen(saleId: string): Saved<InvoiceCorrectionAsk> | null {
    return this.#read(this.#key("open", saleId));
  }

  /** Drops the saved Open of `saleId` once the correction it may have opened has been found; never
   * while a request is on its way, whose own answer removes its id. */
  forgetOpen(saleId: string): void {
    if (this.#busy) return;
    const key = this.#key("open", saleId);
    let held: string | undefined;
    try {
      held = this.#read(key)?.submissionId;
    } catch {
      return;
    }
    if (held !== undefined) this.#forget(key, held);
  }

  savedCash(correctionId: string): Saved<{ amount: string }> | null {
    return this.#read(this.#key("cash", correctionId));
  }

  async open(
    saleId: string,
    ask: InvoiceCorrectionAsk,
    override?: Override,
  ): Promise<InvoiceCorrectionOpening> {
    try {
      const opened = await this.#send(this.#key("open", saleId), ask, openFingerprint, (request) =>
        this.api.openInvoiceCorrection(saleId, { ...request, ...(override && { override }) }),
      );
      return { correctionId: opened.correction.id, opened };
    } catch (error) {
      if (codeOf(error) !== "invoice_correction.already_open") throw error;
      return { correctionId: (error as { correctionId: string }).correctionId, opened: null };
    }
  }

  giveCash(
    correctionId: string,
    ask: Omit<InvoiceCorrectionCashRequest, "submissionId" | "override">,
    override?: Override,
  ): Promise<InvoiceCorrectionCashGiven> {
    return this.#send(this.#key("cash", correctionId), ask, cashFingerprint, (request) =>
      this.api.giveInvoiceCorrectionCash(correctionId, {
        ...request,
        ...(override && { override }),
      }),
    );
  }
}
