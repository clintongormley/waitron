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

/**
 * Saves each request's submission id in the refund journal before sending, so an unknown answer is
 * replayed with it. The server checks the session, the device, authorization and trading before it
 * recognises a repeat, so only a refusal of a first send, or a correction refusal (which comes after
 * that recognition), proves the request did nothing and releases its id.
 */
export class InvoiceCorrectionSession {
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

  #forget(key: string): void {
    withJournalStorage(this.storage, (storage) => storage.removeItem(key));
  }

  async #send<T extends object, R>(
    key: string,
    ask: T,
    send: (request: Saved<T>) => Promise<R>,
  ): Promise<R> {
    let request = this.#read<T>(key);
    const fresh = request === null;
    if (request !== null) {
      const same = { ...ask, submissionId: request.submissionId };
      if (JSON.stringify(request) !== JSON.stringify(same)) return fail("locked");
    } else {
      request = { ...ask, submissionId: crypto.randomUUID() };
      const value = JSON.stringify({ version: 1, request });
      withJournalStorage(this.storage, (storage) => writeVerified(storage, key, value));
    }
    try {
      const result = await send(request);
      this.#forget(key);
      return result;
    } catch (error) {
      const code = codeOf(error);
      const refused = typeof statusOf(error) === "number" && (statusOf(error) as number) < 500;
      if (
        refused &&
        (fresh ||
          (typeof code === "string" &&
            (code.startsWith("invoice_correction.") || code.startsWith("sale.correction_"))))
      )
        this.#forget(key);
      throw error;
    }
  }

  savedOpen(saleId: string): Saved<InvoiceCorrectionAsk> | null {
    return this.#read(this.#key("open", saleId));
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
      const opened = await this.#send(this.#key("open", saleId), ask, (request) =>
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
    return this.#send(this.#key("cash", correctionId), ask, (request) =>
      this.api.giveInvoiceCorrectionCash(correctionId, {
        ...request,
        ...(override && { override }),
      }),
    );
  }
}
