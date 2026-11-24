import type { TillApi } from "../api/client.js";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackSubmissionIds,
  GiveBackWrite,
} from "../api/give-back-types.js";
import {
  TenderRefundAttemptError,
  fail,
  scopePrefix,
  withJournalStorage,
  writeVerified,
  type TenderRefundScope,
} from "./tender-refund.js";

export type GiveBackSent = GiveBackAsk & { submissionIds: GiveBackSubmissionIds };
/** The part of a two-step card give-back not sent yet, and the card refund it waits for. */
export interface GiveBackRest {
  request: GiveBackRequest;
  reasonId: string;
  note: string | null;
  waitFor: string | null;
}
export interface SavedGiveBack {
  saleId: string;
  /** The press whose answer is not known yet; sent again under the same ids. */
  sent: GiveBackSent | null;
  rest: GiveBackRest | null;
}
export type RestCheck =
  { state: "pending" | "failed" } | { state: "completed"; preview: GiveBackPreview };

type GiveBackApi = Pick<TillApi, "giveBack" | "previewGiveBack"> & {
  getTenderRefund(refundId: string, options: object): Promise<{ state: string }>;
};

/** Refusals the server makes only once it has found nothing under the press's ids, so they prove
 * nothing was given back: `give_back.changed` and the waits of plan section 4 that the plan finds. */
const PROVES_NOTHING = new Set([
  "give_back.changed",
  "sale.correction_not_admitted",
  "invoice_correction.already_open",
  "invoice_correction.refund_pending",
  "tender.refund_in_progress",
  "tender.refund_of_advance",
  "advance.taken_off_final_invoice",
  "clock.unconfirmed",
  "sif.allocation_invalid",
  "venue.time_zone_not_ready",
]);
/** Refusals a first send can meet as well as a resend; on a first send they too prove nothing. */
const PIN_REFUSALS = new Set([
  "authorization.not_permitted",
  "tender.manual_refund_pin_required",
  "pin.invalid",
  "pin.throttled",
]);

function fingerprint(ask: GiveBackAsk): string {
  const { request } = ask;
  return JSON.stringify([
    { ...request, lineIds: request.lineIds === undefined ? null : [...request.lineIds].sort() },
    ask.reasonId,
    ask.note,
    ask.expected,
    ask.manualConfirmed === true,
  ]);
}
const freshIds = (): GiveBackSubmissionIds => ({
  refund: crypto.randomUUID(),
  extra: crypto.randomUUID(),
  correction: crypto.randomUUID(),
  leg: crypto.randomUUID(),
});
const codeOf = (error: unknown) =>
  error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

/**
 * Give money back's saved attempt, in the refund journal so signing out clears it with the rest:
 * each press is saved with its ids before it is sent, so a lost answer is sent again under them and
 * the server answers it from what it stored. A rest is saved without ids; it gets its own when
 * first sent. One send at a time.
 */
export class GiveBackSession {
  #busy = false;
  /** Ids whose every send so far was a first send the server refused. */
  readonly #refused = new Set<string>();
  constructor(
    private readonly scope: TenderRefundScope,
    private readonly api: GiveBackApi,
    private readonly storage?: Storage,
  ) {}

  #key(saleId: string): string {
    return `${scopePrefix(this.scope)}${JSON.stringify(["give-back", saleId])}`;
  }

  read(saleId: string): SavedGiveBack | null {
    return withJournalStorage(this.storage, (storage) => {
      const raw = storage.getItem(this.#key(saleId));
      if (raw === null) return null;
      const saved = JSON.parse(raw) as { version: unknown } & SavedGiveBack;
      if (saved.version !== 1 || saved.saleId !== saleId) return fail("storage");
      return { saleId, sent: saved.sent, rest: saved.rest };
    });
  }

  #write(saved: SavedGiveBack | null, saleId: string): void {
    withJournalStorage(this.storage, (storage) => {
      if (saved === null) storage.removeItem(this.#key(saleId));
      else writeVerified(storage, this.#key(saleId), JSON.stringify({ version: 1, ...saved }));
    });
  }

  async #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#busy) return fail("busy");
    this.#busy = true;
    try {
      return await work();
    } finally {
      this.#busy = false;
    }
  }

  async #send(
    saleId: string,
    saved: SavedGiveBack,
    override: GiveBackWrite["override"],
    fresh: boolean,
  ): Promise<GiveBackOutcome> {
    const sent = saved.sent!;
    const id = sent.submissionIds.refund;
    const firstSend = fresh || this.#refused.has(id);
    let answer: GiveBackOutcome;
    try {
      answer = await this.api.giveBack(saleId, {
        ...sent,
        ...(override === undefined ? {} : { override }),
      });
    } catch (error) {
      const code = codeOf(error);
      this.#refused.delete(id);
      if (code !== undefined && PROVES_NOTHING.has(code))
        this.#write(saved.rest === null ? null : { ...saved, sent: null }, saleId);
      else if (code !== undefined && firstSend && PIN_REFUSALS.has(code)) this.#refused.add(id);
      throw error;
    }
    this.#refused.delete(id);
    const pending = answer.parts.find((part) => part.state === "pending");
    this.#write(
      answer.rest === null || answer.refusal !== null
        ? null
        : {
            saleId,
            sent: null,
            rest: {
              request: answer.rest,
              reasonId: sent.reasonId,
              note: sent.note,
              waitFor: pending?.refundId ?? null,
            },
          },
      saleId,
    );
    return answer;
  }

  /** Sends `ask`, or, while an earlier press of the same `ask` got no answer, sends that again. */
  submit(
    saleId: string,
    ask: GiveBackAsk,
    override?: GiveBackWrite["override"],
  ): Promise<GiveBackOutcome> {
    return this.#run(() => {
      const saved = this.read(saleId);
      if (saved?.sent) {
        if (fingerprint(saved.sent) === fingerprint(ask))
          return this.#send(saleId, saved, override, false);
        if (!this.#refused.has(saved.sent.submissionIds.refund)) return fail("locked");
      }
      const next: SavedGiveBack = {
        saleId,
        sent: { ...ask, submissionIds: freshIds() },
        rest: saved?.rest ?? null,
      };
      this.#write(next, saleId);
      return this.#send(saleId, next, override, true);
    });
  }

  /** Sends the press whose answer was lost again, under its ids. */
  resend(saleId: string, override?: GiveBackWrite["override"]): Promise<GiveBackOutcome> {
    return this.#run(() => {
      const saved = this.read(saleId);
      if (!saved?.sent) return fail("missing");
      return this.#send(saleId, saved, override, false);
    });
  }

  /** Whether the card refund a rest waits for is done and, once it is, what the rest would do. */
  checkRest(saleId: string): Promise<RestCheck> {
    return this.#run(async () => {
      const rest = this.read(saleId)?.rest ?? fail("missing");
      if (rest.waitFor !== null) {
        const { state } = await this.api.getTenderRefund(rest.waitFor, {});
        if (state === "failed") this.#write(null, saleId);
        if (state === "pending" || state === "failed") return { state };
      }
      return {
        state: "completed",
        preview: await this.api.previewGiveBack(saleId, rest.request),
      };
    });
  }

  /** Sends the rest as `preview` showed it, under ids of its own. */
  sendRest(
    saleId: string,
    preview: GiveBackPreview,
    override?: GiveBackWrite["override"],
  ): Promise<GiveBackOutcome> {
    const rest = this.read(saleId)?.rest;
    if (!rest) return Promise.reject(new TenderRefundAttemptError("missing"));
    // A rest follows a card reader's pending refund; a separate terminal's never waits.
    const { request, reasonId, note } = rest;
    return this.submit(saleId, { request, reasonId, note, expected: preview.parts }, override);
  }
}
