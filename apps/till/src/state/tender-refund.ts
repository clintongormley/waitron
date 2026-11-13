import { MONEY_SCALE, compareDecimal, decimal, toScale } from "@waitron/shared";
import type { TillApi } from "../api/client.js";
import type {
  RefundableTender,
  TenderRefundRequest,
  TenderRefundView,
} from "../api/tender-refund-types.js";
import { parseDecimalInput } from "@waitron/ui";
import { REASON_MAX, moneyPlus } from "./bill-payment.js";

export interface TenderRefundScope {
  deviceId: string;
  personId: string;
}
export type TenderRefundAsk = Omit<TenderRefundRequest, "submissionId" | "override">;
export interface SavedTenderRefund {
  saleId: string;
  request: Omit<TenderRefundRequest, "override">;
  refundId: string | null;
}
type RefundApi = Pick<TillApi, "refundTransaction" | "getTenderRefund" | "retryTenderRefund">;

export class TenderRefundAttemptError extends Error {
  constructor(readonly kind: "storage" | "locked" | "mismatch" | "busy" | "missing" | "invalid") {
    super(`Tender refund ${kind}`);
  }
}

const PREFIX = "waitron.tender-refund:";
export const fail = (kind: TenderRefundAttemptError["kind"]): never => {
  throw new TenderRefundAttemptError(kind);
};
/** Every journal entry of `scope` starts with this, so `clear` wipes them all. */
export const scopePrefix = (scope: TenderRefundScope) =>
  `${PREFIX}${JSON.stringify([scope.deviceId, scope.personId])}:`;
const keyFor = (scope: TenderRefundScope, saleId: string) =>
  `${scopePrefix(scope)}${JSON.stringify(saleId)}`;

/** Whether a device with `capabilities` may give money back to this payment's method. */
export function refundMethodAllowed(
  row: Pick<RefundableTender, "method" | "manual">,
  capabilities: readonly string[],
): boolean {
  return (
    (row.method === "cash" || row.method === "card") &&
    capabilities.includes(
      row.method === "cash"
        ? "take-cash"
        : row.manual
          ? "hand-keyed-card-payment"
          : "integrated-card-payment",
    )
  );
}

export function tenderRefundAmount(value: string): string | null {
  const parsed = typeof value === "string" ? parseDecimalInput(value) : null;
  return parsed !== null && /^\d{1,12}(\.\d{1,2})?$/.test(parsed)
    ? toScale(decimal(parsed.replace(/^0+(?=\d)/, "")), MONEY_SCALE)
    : null;
}

export function withJournalStorage<T>(
  storage: Storage | undefined,
  work: (storage: Storage) => T,
): T {
  try {
    return work(storage ?? localStorage);
  } catch {
    return fail("storage");
  }
}

/** Refuses `storage` when the entry does not read back as written, so nothing is sent unsaved. */
export function writeVerified(storage: Storage, key: string, value: string): void {
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) fail("storage");
}

function normalized(ask: TenderRefundAsk): TenderRefundAsk {
  if (typeof ask.tenderId !== "string" || ask.tenderId === "") return fail("invalid");
  if (typeof ask.reason !== "string" || ask.reason.trim() === "" || ask.reason.length > REASON_MAX)
    return fail("invalid");
  if (ask.manualConfirmed !== undefined && typeof ask.manualConfirmed !== "boolean")
    return fail("invalid");
  const correctionId = ask.invoiceCorrectionId;
  if (correctionId !== undefined && (typeof correctionId !== "string" || correctionId === ""))
    return fail("invalid");
  const ids = ask.cancellationIds;
  if (
    ids !== undefined &&
    (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id === ""))
  )
    return fail("invalid");
  const appliedAmount = tenderRefundAmount(ask.appliedAmount) ?? fail("invalid");
  const tipAmount = tenderRefundAmount(ask.tipAmount) ?? fail("invalid");
  const total = moneyPlus(appliedAmount, tipAmount);
  if (
    compareDecimal(total, decimal("0")) <= 0 ||
    compareDecimal(total, decimal("999999999999.99")) > 0
  )
    return fail("invalid");
  return {
    tenderId: ask.tenderId.toLowerCase(),
    appliedAmount,
    tipAmount,
    reason: ask.reason.trim(),
    manualConfirmed: ask.manualConfirmed === true,
    ...(ids === undefined || ids.length === 0 ? {} : { cancellationIds: [...ids] }),
    ...(correctionId === undefined ? {} : { invoiceCorrectionId: correctionId.toLowerCase() }),
  };
}

function fingerprint(ask: TenderRefundAsk): string {
  const body = normalized(ask);
  return JSON.stringify({ ...body, cancellationIds: [...(body.cancellationIds ?? [])].sort() });
}

/** Unknown outcomes keep the original request; a PIN exists only on the outgoing call. */
export class TenderRefundAttempts {
  constructor(private readonly storage?: Storage) {}

  #storage<T>(work: (storage: Storage) => T): T {
    return withJournalStorage(this.storage, work);
  }

  read(scope: TenderRefundScope, saleId: string): SavedTenderRefund | null {
    return this.#storage((storage) => {
      const raw = storage.getItem(keyFor(scope, saleId));
      if (raw === null) return null;
      const saved = JSON.parse(raw) as {
        version: unknown;
        saleId: unknown;
        request: TenderRefundRequest;
        refundId: unknown;
      };
      if (
        saved.version !== 1 ||
        saved.saleId !== saleId ||
        typeof saved.request.submissionId !== "string" ||
        saved.request.submissionId === "" ||
        !(saved.refundId === null || (typeof saved.refundId === "string" && saved.refundId !== ""))
      )
        return fail("storage");
      return {
        saleId,
        request: { ...normalized(saved.request), submissionId: saved.request.submissionId },
        refundId: saved.refundId,
      };
    });
  }

  #write(scope: TenderRefundScope, sent: SavedTenderRefund): void {
    this.#storage((storage) =>
      writeVerified(storage, keyFor(scope, sent.saleId), JSON.stringify({ version: 1, ...sent })),
    );
  }

  prepare(
    scope: TenderRefundScope,
    saleId: string,
    ask: TenderRefundAsk,
    onCreated?: () => void,
  ): SavedTenderRefund {
    const body = normalized(ask);
    const saved = this.read(scope, saleId);
    if (saved !== null) {
      if (fingerprint(saved.request) !== fingerprint(body)) return fail("locked");
      return saved;
    }
    const sent = {
      saleId,
      request: { ...body, submissionId: crypto.randomUUID() },
      refundId: null,
    };
    this.#write(scope, sent);
    onCreated?.();
    return sent;
  }

  answer(scope: TenderRefundScope, sent: SavedTenderRefund, result: TenderRefundView): void {
    const current = this.read(scope, sent.saleId);
    if (current === null || current.request.submissionId !== sent.request.submissionId) return;
    if (
      result.saleId !== sent.saleId ||
      result.tenderId !== sent.request.tenderId ||
      result.appliedAmount !== sent.request.appliedAmount ||
      result.tipAmount !== sent.request.tipAmount ||
      !result.id ||
      (current.refundId !== null && current.refundId !== result.id) ||
      !["pending", "completed", "failed"].includes(result.state)
    )
      return fail("mismatch");
    if (result.state === "pending") this.#write(scope, { ...current, refundId: result.id });
    else this.#storage((storage) => storage.removeItem(keyFor(scope, sent.saleId)));
  }

  refused(scope: TenderRefundScope, sent: SavedTenderRefund): void {
    const current = this.read(scope, sent.saleId);
    if (current?.request.submissionId === sent.request.submissionId && current.refundId === null)
      this.#storage((storage) => storage.removeItem(keyFor(scope, sent.saleId)));
  }

  clear(scope: TenderRefundScope): void {
    this.#storage((storage) => {
      const prefix = scopePrefix(scope);
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
    });
  }
}

export class TenderRefundSession {
  #busy = false;
  readonly #settled = new Map<string, TenderRefundView>();
  readonly #refused = new Set<string>();
  constructor(
    private readonly scope: TenderRefundScope,
    private readonly api: RefundApi,
    private readonly attempts = new TenderRefundAttempts(),
  ) {}

  read(saleId: string): SavedTenderRefund | null {
    return this.attempts.read(this.scope, saleId);
  }

  async #run(work: () => Promise<TenderRefundView>): Promise<TenderRefundView> {
    if (this.#busy) return fail("busy");
    this.#busy = true;
    try {
      return await work();
    } finally {
      this.#busy = false;
    }
  }

  async #send(
    sent: SavedTenderRefund,
    override?: TenderRefundRequest["override"],
    fresh = false,
  ): Promise<TenderRefundView> {
    const id = sent.request.submissionId;
    const knownRefused = fresh || this.#refused.has(id);
    let result: TenderRefundView;
    try {
      result = await this.api.refundTransaction(sent.saleId, {
        ...sent.request,
        ...(override === undefined ? {} : { override }),
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      this.#refused.delete(id);
      // The server refuses for a correction only after it looks for this submission id, so such a
      // refusal proves no refund was made under it.
      if (typeof code === "string" && code.startsWith("invoice_correction."))
        this.attempts.refused(this.scope, sent);
      // A later refusal cannot establish what an earlier unknown call returned.
      else if (knownRefused) {
        if (code === "tender.refund_exceeds_payment") this.attempts.refused(this.scope, sent);
        else if (
          code === "authorization.not_permitted" ||
          code === "tender.refund_exceeds_cancelled" ||
          code === "tender.manual_refund_pin_required" ||
          code === "pin.invalid"
        )
          this.#refused.add(id);
      }
      throw error;
    }
    this.#refused.delete(id);
    this.#answer(sent, result);
    return result;
  }

  #answer(sent: SavedTenderRefund, result: TenderRefundView): void {
    const retained = this.read(sent.saleId)?.request.submissionId === sent.request.submissionId;
    this.attempts.answer(this.scope, sent, result);
    if (!retained) return;
    if (result.state === "pending") this.#settled.delete(sent.saleId);
    else this.#settled.set(sent.saleId, result);
  }

  submit(
    saleId: string,
    ask: TenderRefundAsk,
    override?: TenderRefundRequest["override"],
  ): Promise<TenderRefundView> {
    return this.#run(() => {
      let fresh = false;
      const sent = this.attempts.prepare(this.scope, saleId, ask, () => {
        fresh = true;
      });
      return this.#send(sent, override, fresh);
    });
  }

  resume(saleId: string): Promise<TenderRefundView> {
    return this.#run(async () => {
      const sent = this.read(saleId);
      if (sent === null) return this.#settled.get(saleId) ?? fail("missing");
      if (sent.refundId === null) return this.#send(sent);
      const result = await this.api.getTenderRefund(sent.refundId);
      this.#answer(sent, result);
      return result;
    });
  }

  retry(saleId: string, override?: TenderRefundRequest["override"]): Promise<TenderRefundView> {
    return this.#run(async () => {
      const sent = this.read(saleId);
      if (sent === null) return this.#settled.get(saleId) ?? fail("missing");
      if (sent.refundId === null) return this.#send(sent, override);
      const result = await this.api.retryTenderRefund(sent.refundId, override);
      this.#answer(sent, result);
      return result;
    });
  }
}
