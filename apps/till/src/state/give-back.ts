import { decimal, sumDecimals } from "@waitron/shared";
import type { TillApi } from "../api/client.js";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackRight,
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

export interface GiveBackSent extends GiveBackAsk {
  submissionIds: GiveBackSubmissionIds;
  /** The rights the preview said an approver must hold, asked for again on a resend. */
  needs: GiveBackRight[];
  /** Every send so far was a first send refused for a right or a PIN, so nothing was written. */
  firstSendRefused: boolean;
  /** The server's last refusal of this press, when it answered with one. */
  refusal: { code: string; params: Record<string, unknown> } | null;
}
/** A card refund waiting for the card company (`waitFor`), the part of the press still to send
 * (`request`), or both. */
export interface GiveBackRest {
  request: GiveBackRequest | null;
  reasonId: string;
  note: string | null;
  waitFor?: string;
  /** What waits for the card company, and the payment it goes back to. */
  amount: string;
  way: string;
}
export interface SavedGiveBack {
  saleId: string;
  /** The press whose outcome is not known yet; sent again under the same ids. */
  sent: GiveBackSent | null;
  rest: GiveBackRest | null;
}
export type RestCheck =
  { state: "pending" | "failed" } | { state: "completed"; preview: GiveBackPreview | null };

type GiveBackApi = Pick<TillApi, "giveBack" | "previewGiveBack"> & {
  getTenderRefund(refundId: string, options: object): Promise<{ state: string }>;
};

/**
 * Refusals that prove nothing was given back under the press's ids, so it is forgotten: the server
 * raises them only after it looked the ids up and found nothing (`giveBack` in
 * apps/server/src/give-back.ts plans only then; a resend's checks, `checkResend`, reach
 * `reserveTenderRefund` only for rows it finds, which answers them as replays first).
 * `venue.time_zone_not_ready` is in neither set: a card reader's first part commits its refund
 * before `requireEconomicWrite` can raise it (apps/server/src/tender-refund-sends.ts).
 */
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
]);
/** Refusals a resend can meet too; on a first send they prove nothing, as the PIN and rights are
 * checked before anything is written. */
const FIRST_SEND_REFUSALS = new Set([
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
const refusalOf = (error: unknown) => {
  if (error === null || typeof error !== "object" || !("code" in error)) return null;
  const { code, ...params } = error as Record<string, unknown>;
  delete params.status;
  return typeof code === "string" ? { code, params } : null;
};
const waitingKinds = new Set(["refund", "extra"]);

/**
 * Give money back's saved attempt, in the refund journal so signing out clears it with the rest:
 * each press is saved with its ids before it is sent, so a lost answer is sent again under them and
 * the server answers it from what it stored. A rest, the part of a card reader's press not yet
 * sent, is saved whether or not a card refund still waits, and gets ids of its own when first sent.
 * One send at a time.
 */
export class GiveBackSession {
  #busy = false;
  /** How the last press of each sale ended once it is no longer saved, so a window opened on its
   * Send again before the answer came shows that answer instead of sending again. */
  readonly #settled = new Map<string, { answer: GiveBackOutcome } | { error: unknown }>();
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
    const firstSend = fresh || sent.firstSendRefused;
    const { request, reasonId, note, expected, manualConfirmed, submissionIds } = sent;
    let answer: GiveBackOutcome;
    try {
      answer = await this.api.giveBack(saleId, {
        request,
        reasonId,
        note,
        expected,
        ...(manualConfirmed === undefined ? {} : { manualConfirmed }),
        submissionIds,
        ...(override === undefined ? {} : { override }),
      });
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal !== null && PROVES_NOTHING.has(refusal.code)) {
        this.#write(saved.rest === null ? null : { ...saved, sent: null }, saleId);
        this.#settled.set(saleId, { error });
      } else if (refusal !== null) {
        const proves = firstSend && FIRST_SEND_REFUSALS.has(refusal.code);
        this.#write({ ...saved, sent: { ...sent, firstSendRefused: proves, refusal } }, saleId);
      } else if (sent.firstSendRefused || sent.refusal !== null)
        this.#write(
          { ...saved, sent: { ...sent, firstSendRefused: false, refusal: null } },
          saleId,
        );
      throw error;
    }
    this.#settled.set(saleId, { answer });
    try {
      this.#keep(saleId, sent, answer);
    } catch (error) {
      // The money's outcome is what staff must see; the press stays saved and is sent again.
      if (!(error instanceof TenderRefundAttemptError && error.kind === "storage")) throw error;
    }
    return answer;
  }

  /** What to keep once the server answered: a card refund still waiting, a rest, or a press whose
   * first send is still writing on the card reader (every part not started). */
  #keep(saleId: string, sent: GiveBackSent, answer: GiveBackOutcome): void {
    if (
      answer.rest === null &&
      answer.refusal === null &&
      answer.parts.every((part) => part.state === "not_started")
    )
      return;
    const waiting = answer.parts.filter(
      (part) => part.state === "pending" && waitingKinds.has(part.kind),
    );
    const waitFor = waiting.find((part) => part.refundId !== undefined)?.refundId;
    this.#write(
      answer.refusal !== null || (waitFor === undefined && answer.rest === null)
        ? null
        : {
            saleId,
            sent: null,
            rest: {
              request: answer.rest,
              reasonId: sent.reasonId,
              note: sent.note,
              ...(waitFor === undefined ? {} : { waitFor }),
              amount: sumDecimals(waiting.map((part) => decimal(part.amount))),
              way: sent.request.way,
            },
          },
      saleId,
    );
  }

  /** Sends `ask`, or, while an earlier press of the same `ask` got no answer, sends that again. */
  submit(
    saleId: string,
    ask: GiveBackAsk,
    override?: GiveBackWrite["override"],
    needs: GiveBackRight[] = [],
  ): Promise<GiveBackOutcome> {
    return this.#run(() => {
      const saved = this.read(saleId);
      if (saved?.sent) {
        if (fingerprint(saved.sent) === fingerprint(ask))
          return this.#send(saleId, saved, override, false);
        if (!saved.sent.firstSendRefused) return fail("locked");
      }
      const next: SavedGiveBack = {
        saleId,
        sent: { ...ask, submissionIds: freshIds(), needs, firstSendRefused: false, refusal: null },
        rest: saved?.rest ?? null,
      };
      this.#write(next, saleId);
      this.#settled.delete(saleId);
      return this.#send(saleId, next, override, true);
    });
  }

  /** Sends the press whose answer was lost again, under its ids; once its answer has come and it is
   * no longer saved, answers as that answer did, sending nothing. */
  resend(saleId: string, override?: GiveBackWrite["override"]): Promise<GiveBackOutcome> {
    return this.#run(async () => {
      const saved = this.read(saleId);
      if (!saved?.sent) {
        const settled = this.#settled.get(saleId) ?? fail("missing");
        if ("error" in settled) throw settled.error;
        return settled.answer;
      }
      return this.#send(saleId, saved, override, false);
    });
  }

  /** Forgets a press only a first send's refusal for a right or a PIN answered, which wrote
   * nothing; any other saved press is kept. */
  abandon(saleId: string): void {
    const saved = this.read(saleId);
    if (saved?.sent?.firstSendRefused)
      this.#write(saved.rest === null ? null : { ...saved, sent: null }, saleId);
  }

  /** Whether the waiting card refund, if any, is done and, once it is, what any rest would do. A
   * settled refund with nothing to follow is forgotten. */
  checkRest(saleId: string): Promise<RestCheck> {
    return this.#run(async () => {
      const rest = this.read(saleId)?.rest ?? fail("missing");
      const { state } =
        rest.waitFor === undefined
          ? { state: "completed" }
          : await this.api.getTenderRefund(rest.waitFor, {});
      if (state === "pending") return { state };
      if (state === "failed" || rest.request === null) this.#write(null, saleId);
      if (state === "failed") return { state };
      return {
        state: "completed",
        preview:
          rest.request === null ? null : await this.api.previewGiveBack(saleId, rest.request),
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
    if (!rest?.request) return Promise.reject(new TenderRefundAttemptError("missing"));
    // Only a card reader's press leaves a rest: a hand-keyed or cash press writes every part at once.
    const { request, reasonId, note } = rest;
    return this.submit(
      saleId,
      { request, reasonId, note, expected: preview.parts },
      override,
      preview.needs,
    );
  }
}
