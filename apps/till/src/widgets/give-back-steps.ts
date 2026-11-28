import { html, nothing, type TemplateResult } from "lit";
import { compareDecimal, decimal, formatMoney, sumDecimals } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, giveBackReasonMessage } from "../i18n/codes.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackRight,
  GiveBackSubmissionIds,
  GiveBackView,
  GiveBackWaitReason,
  GiveBackWay,
} from "../api/give-back-types.js";
import type { TenderRefundView } from "../api/tender-refund-types.js";
import {
  PROVES_NOTHING,
  sameIds,
  type GiveBackRest,
  type GiveBackSent,
  type RestCheck,
} from "../state/give-back.js";
import { recoveryLink, recoveryRefusalText, type RecoveryRefusal } from "./recovery-refusal.js";
import type { TillApi } from "../api/client.js";
import type { StaffMember } from "../api/device-session-api.js";
import type { HoldReloadDetail } from "../screens/till-station-screen.js";
import { limited, TABLE_REQUEST_LIMIT_MS } from "../state/draft-sync.js";
import { refusalOf } from "../state/bill-payment.js";
import {
  SIGN_IN_ENDED,
  TenderRefundAttemptError,
  type RefundAskedAgain,
  type TenderRefundSession,
} from "../state/tender-refund.js";

export type Override = OverrideConfirmDetail;
/** One send: the rights an approver must hold before it goes, the rights to ask for if the write
 * then wants an approver, and the payment the outcome names. A `check` is a Check again: with no
 * answer it is only pressed again, where a press is sent again under its ids. */
export interface Sending {
  send: (override?: Override) => Promise<Sent>;
  rights: GiveBackRight[];
  needs: GiveBackRight[];
  way: string;
  check?: true;
}
/** What the window shows once a send is answered, and a send that follows it. */
export interface Sent {
  step: Step | null;
  next?: Sending;
}
/** Who may approve, read under the till's request limit: a read that stalls is abandoned and
 * rejects, so the caller shows its refusal rather than waiting for ever. */
export async function readApprovers(
  api: Pick<TillApi, "listApprovers">,
  rights: GiveBackRight | readonly GiveBackRight[],
): Promise<StaffMember[]> {
  const limit = limited(TABLE_REQUEST_LIMIT_MS);
  try {
    return await api.listApprovers(rights, { signal: limit.signal });
  } finally {
    limit.done();
  }
}
/** Why a choice, a dish or a payment must wait, on a full invoice when `fullInvoice`. */
export const waitReasonText = (reason: GiveBackWaitReason, fullInvoice = false): string =>
  recoveryText(reason) ??
  giveBackReasonMessage(reason.code, currentLocale(), {
    ...reason.params,
    ...(fullInvoice && { fullInvoice }),
  });
/** A refusal's words, on a full invoice as Give money back words its waits when `fullInvoice`. */
export const refusalWords = (refusal: ReturnType<typeof refusalOf>, fullInvoice: boolean): string =>
  recoveryText(refusal) ??
  (fullInvoice
    ? giveBackReasonMessage(refusal.code, currentLocale(), { ...refusal, fullInvoice })
    : codeMessage(refusal.code, currentLocale(), refusal));
/** Runs `work`, keeping the till from reloading for a box update until it ends, also when the
 * device locks meanwhile and the window goes. */
export function holdingReload<T>(host: HTMLElement, work: () => Promise<T>): Promise<T> {
  const until = work();
  host.dispatchEvent(
    new CustomEvent<HoldReloadDetail>("hold-reload", {
      detail: { until },
      bubbles: true,
      composed: true,
    }),
  );
  return until;
}

/** Tells the till the server ended this person's sign-in, so it locks as any ended sign-in does;
 * true when `code` says so. */
export function signInEnded(host: HTMLElement, code: string): boolean {
  if (!SIGN_IN_ENDED.has(code)) return false;
  host.dispatchEvent(new CustomEvent("give-back-signed-out", { bubbles: true, composed: true }));
  return true;
}
export const APPROVER_PIN_REFUSALS = new Set(["pin.invalid", "pin.throttled"]);
export const NEEDS_APPROVER = new Set([
  "authorization.not_permitted",
  "tender.manual_refund_pin_required",
]);

/** Where the window is once Give back is pressed. */
export type Step =
  | {
      kind: "terminal";
      ask: GiveBackAsk;
      needs: GiveBackRight[];
      confirmed: boolean;
      attempted: boolean;
    }
  | {
      kind: "lost";
      way: string;
      needs: GiveBackRight[];
      /** What the server answered last, when it answered. */
      refusal: { code: string; params: Record<string, unknown> } | null;
      /** The press's ids, so Send again takes only that press's answer; null when unread. */
      ids: GiveBackSubmissionIds | null;
      /** Why Send again sent nothing or was refused, in place of `refusal`'s words. */
      said?: string;
    }
  | { kind: "done"; outcome: GiveBackOutcome; way: string; notice: string | null };

const money = (value: string) => formatMoney(value, currentLocale());
const sumOf = (amounts: readonly string[]) => sumDecimals(amounts.map((amount) => decimal(amount)));
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;

type Refused = { code: string; params?: object | null } | null;
/** The recovery a refusal or a wait reason points to, read from the answer or from its params. */
export function recoveryOf(refused: Refused): RecoveryRefusal | null {
  if (refused === null) return null;
  const recovery = { ...refused.params, ...refused } as RecoveryRefusal;
  return recoveryRefusalText(recovery) === null ? null : recovery;
}
/** The recovery's sentence, which every refund window says first, or null when there is none. */
export const recoveryText = (refused: Refused): string | null => {
  const recovery = recoveryOf(refused);
  return recovery === null ? null : recoveryRefusalText(recovery);
};
export const recoveryLinkOf = (refused: Refused) => recoveryLink(recoveryOf(refused));

/** The separate terminal's step (picture g): staff give the money back there, then confirm. */
export function terminalStep(
  ask: Pick<GiveBackAsk, "expected">,
  state: { confirmed: boolean; attempted: boolean; sending: boolean },
  on: { confirm: (checked: boolean) => void; back: () => void; record: () => void },
) {
  const total = money(sumOf(ask.expected.map((part) => part.amount)));
  const missing = state.attempted && !state.confirmed;
  return html`<div class="body-step" data-terminal>
      <p class="heading">${t("give_back.terminal_heading")}</p>
      <p class="total">${total}</p>
      <p>${t("give_back.terminal_explain").replace("{amount}", () => total)}</p>
      <wt-switch
        name="terminal-done"
        .label=${`${t("give_back.terminal_done").replace("{amount}", () => total)} *`}
        .checked=${state.confirmed}
        .disabled=${state.sending}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          on.confirm(event.detail.checked);
        }}
      ></wt-switch>
      ${
        missing
          ? html`<p class="error" data-terminal-error role="alert">
              ${t("give_back.terminal_required")}
            </p>`
          : nothing
      }
      <p class="muted">${t("give_back.terminal_pin")}</p>
    </div>
    <wt-form-actions .error=${missing ? t("form.fix_fields") : ""}
      ><wt-button slot="cancel" variant="secondary" data-terminal-back @click=${on.back}
        >${t("action.back")}</wt-button
      >
      <wt-button
        variant="primary"
        data-record
        .loading=${state.sending}
        .disabled=${state.sending || missing}
        @click=${on.record}
        >${t("give_back.terminal_record")}</wt-button
      >
    </wt-form-actions>`;
}

const cardBack = (amount: string, card: string) =>
  card === ""
    ? t("give_back.done_card_any").replace("{amount}", () => amount)
    : t("give_back.done_card")
        .replace("{amount}", () => amount)
        .replace("{card}", () => card);

/** What went back, what waits, and why anything did not, from the write's answer. A cash
 * correction prints its own receipt; any other says where to print it (D14), unless the box is
 * already sending its corrective invoice. */
function outcomeLines(
  outcome: GiveBackOutcome,
  way: GiveBackWay | undefined,
  notice: string | null,
  underWay: boolean,
  fullInvoice: boolean,
) {
  const amounts = (state: string, kinds: readonly string[]) =>
    sumOf(
      outcome.parts
        .filter((part) => part.state === state && kinds.includes(part.kind))
        .map((part) => part.amount),
    );
  const back = amounts("completed", ["refund", "extra", "correction"]);
  // An open correction's money is not with the card company: only refunds wait for it.
  const pending = amounts("pending", ["refund", "extra"]);
  const card = way?.last4 ? `···${way.last4}` : "";
  const lines: string[] = [];
  if (positive(back))
    lines.push(
      way?.way === "cash"
        ? t("give_back.done_cash").replace("{amount}", () => money(back))
        : way?.manual
          ? t("give_back.done_terminal").replace("{amount}", () => money(back))
          : cardBack(money(back), card),
    );
  const corrected = outcome.parts.filter(
    (part) => part.kind === "correction" && part.state === "completed",
  );
  if (
    way?.way !== "cash" &&
    corrected.length > 0 &&
    !corrected.some((part) => (part.corrective?.delivery ?? null) !== null)
  )
    lines.push(t(fullInvoice ? "give_back.print_later_invoice" : "give_back.print_later"));
  if (corrected.some((part) => part.corrective?.printedOnReceiptNotA4 === true))
    lines.push(t("give_back.printed_on_receipt_not_a4"));
  if (positive(pending))
    lines.push(t("give_back.pending").replace("{amount}", () => money(pending)));
  if (outcome.rest !== null && outcome.refusal === null)
    lines.push(
      t(restReady(outcome) ? "give_back.rest_ready" : "give_back.rest").replace("{amount}", () =>
        money(sumOf([outcome.rest!.amount, outcome.rest!.extra])),
      ),
    );
  if (outcome.refusal !== null) {
    const said =
      recoveryText(outcome.refusal) ??
      codeMessage(outcome.refusal.code, currentLocale(), outcome.refusal.params);
    lines.push(
      outcome.refusalReason === "provider_balance_unavailable"
        ? `${said} ${t("refund.provider_balance_unavailable")}`
        : said,
    );
  }
  if (notice !== null) lines.push(notice);
  return html`<div class="body-step" data-outcome role="status">
    ${
      outcome.underWay === null || underWay
        ? nothing
        : html`<p class="heading" data-under-way>${t("give_back.under_way")}</p>`
    }
    ${lines.map((line) => html`<p>${line}</p>`)}
  </div>`;
}

/** A press whose answer was lost: sending it again reuses its ids, so nothing goes back twice. */
export function lostStep(
  step: Extract<Step, { kind: "lost" }>,
  sending: boolean,
  on: { close: () => void; resend: () => void },
) {
  const said =
    step.said ??
    (step.refusal === null
      ? t("give_back.lost")
      : (recoveryText(step.refusal) ??
        codeMessage(step.refusal.code, currentLocale(), step.refusal.params)));
  return html`<p data-lost role="status">${said}</p>
    <wt-form-actions
      >${recoveryLinkOf(step.refusal)}<wt-button
        slot="cancel"
        variant="secondary"
        data-close
        @click=${on.close}
        >${t("action.cancel")}</wt-button
      ><wt-button
        variant="primary"
        data-send-again
        .loading=${sending}
        .disabled=${sending}
        @click=${on.resend}
        >${t("give_back.send_again")}</wt-button
      ></wt-form-actions
    >`;
}

/** A rest no card refund waits for any more: it goes when staff press for it. */
const restReady = (outcome: GiveBackOutcome) =>
  outcome.rest !== null &&
  !outcome.parts.some((part) => part.state === "pending" && part.kind !== "correction");

/** Whether a card refund in `outcome` still waits for the card company. */
export const waitsForCard = (outcome: GiveBackOutcome) =>
  outcome.refusal === null &&
  (outcome.rest !== null ||
    outcome.parts.some((part) => part.state === "pending" && part.kind !== "correction"));

/** The outcome, with Check again while a card refund waits for the card company, or followed by
 * the under-way view, which brings its own steps. */
export function doneStep(
  step: Extract<Step, { kind: "done" }>,
  way: GiveBackWay | undefined,
  sending: boolean,
  on: { close: () => void; checkAgain: () => void },
  underWay?: TemplateResult,
  fullInvoice = false,
) {
  if (underWay !== undefined)
    return html`${outcomeLines(step.outcome, way, step.notice, true, fullInvoice)}${underWay}`;
  const waits = waitsForCard(step.outcome);
  return html`${outcomeLines(step.outcome, way, step.notice, false, fullInvoice)}
    <wt-form-actions
      >${recoveryLinkOf(step.outcome.refusal)}<wt-button
        slot="cancel"
        variant=${waits ? "secondary" : "primary"}
        data-close
        @click=${on.close}
        >${t("give_back.done")}</wt-button
      >${
        waits
          ? html`<wt-button
              variant="primary"
              data-check-again
              .loading=${sending}
              .disabled=${sending}
              @click=${on.checkAgain}
              >${t(restReady(step.outcome) ? "give_back.send_rest" : "give_back.check_again")}</wt-button
            >`
          : nothing
      }</wt-form-actions
    >`;
}

const balanceReason = (reason: TenderRefundView["refusalReason"]) =>
  reason === undefined ? [] : [t(`refund.${reason}`)];

/** The outcome once Check again asked about the card refund it waits for: still waiting, failed (the
 * rest is dropped), or through. */
export function afterCheck(
  step: Extract<Step, { kind: "done" }>,
  check: RestCheck,
): Extract<Step, { kind: "done" }> {
  const { outcome } = step;
  const { state } = check;
  if (state === "pending") return { ...step, notice: t("give_back.still_waiting") };
  const parts = outcome.parts.map((part) =>
    part.state === "pending" && part.kind !== "correction"
      ? { ...part, state: state === "failed" ? ("failed" as const) : ("completed" as const) }
      : part,
  );
  if (state === "completed") return { ...step, notice: null, outcome: { ...outcome, parts } };
  return {
    ...step,
    notice: [
      outcome.rest === null
        ? codeMessage("give_back.refund_failed", currentLocale())
        : t("give_back.rest_failed"),
      ...balanceReason(check.refusalReason),
    ].join(" "),
    outcome: { ...outcome, parts, rest: null },
  };
}

/** What is said when a Check again was refused or got no answer: asking again is always safe, and
 * the money it asks about may already be back. */
export function checkRefusalText(refusal: ReturnType<typeof refusalOf>): string {
  if (refusal.code === "approvers") return t("give_back.uw_approvers_failed");
  if (refusal.code === "busy") return t("give_back.busy");
  if (refusal.code === "network" || refusal.code === "storage") return t("give_back.uw_unknown");
  return recoveryText(refusal) ?? codeMessage(refusal.code, currentLocale(), refusal);
}

/** What the card company answered about a refund asked about again. */
export function askedAgainText(refund: RefundAskedAgain): string {
  if (refund.state === "failed")
    return [t("tender_refund.failed"), ...balanceReason(refund.refusalReason)].join(" ");
  const back = money(sumOf([refund.appliedAmount, refund.tipAmount]));
  return cardBack(back, refund.last4 === null ? "" : `···${refund.last4}`);
}

/** Check again on the choices: reads the receipt and, while a card refund on it waits and the window
 * is still `open`, has the box ask the card company again. Answers what to say, and the receipt as
 * last read. */
export async function checkReceipt(
  from: {
    api: Pick<TillApi, "readGiveBack" | "getRefundableTenders">;
    refunds: TenderRefundSession;
    saleId: string;
    capabilities: readonly string[];
  },
  open: () => boolean,
  override?: Override,
): Promise<{ view: GiveBackView | null; status: string }> {
  const read = () => from.api.readGiveBack(from.saleId, {});
  let view: GiveBackView;
  try {
    view = await read();
  } catch (error) {
    if (refusalOf(error).code !== "network") throw error;
    return { view: null, status: t("give_back.read_failed") };
  }
  if (!view.ways.some((way) => way.pending)) return { view, status: "" };
  const tenders = await from.api.getRefundableTenders(from.saleId, {});
  const answers = await from.refunds.askAgain(tenders, from.capabilities, override, open);
  const said = answers.filter((refund) => refund.state !== "pending").map(askedAgainText);
  if (said.length > 0)
    try {
      view = await read();
    } catch {
      return { view, status: [...said, t("tender_refund.read_failed")].join(" ") };
    }
  if (view.ways.some((way) => way.pending)) said.push(t("give_back.pending_unanswered"));
  return { view, status: said.join(" ") };
}

/** The lost step for a press saved earlier, with what the server answered it last. */
export const lostFor = (sent: GiveBackSent): Extract<Step, { kind: "lost" }> => ({
  kind: "lost",
  way: sent.request.way,
  needs: sent.needs,
  refusal: sent.refusal,
  ids: sent.submissionIds,
});

/** `saved`, unless it is another press than the one `ids` name. */
const ownPress = (saved: GiveBackSent | null | undefined, ids: GiveBackSubmissionIds | null) =>
  saved && (ids === null || sameIds(saved.submissionIds, ids)) ? saved : null;

/** A press whose answer is not known: `saved`, the press this device holds, else the one sent
 * with `ids`. */
export const lostAfter = (
  sending: Pick<Sending, "way" | "needs">,
  saved: GiveBackSent | null | undefined,
  ids: GiveBackSubmissionIds | null = null,
): Extract<Step, { kind: "lost" }> => {
  const own = ownPress(saved, ids);
  return own === null
    ? { kind: "lost", way: sending.way, needs: sending.needs, refusal: null, ids }
    : lostFor(own);
};

/** A Send again refused where neither the form nor the choice is drawn to say so. While the press
 * may be written (it is still saved, or the refusal does not prove that nothing went back) it stays
 * the only thing to send, under its ids; otherwise nothing went back under it, and it ends.
 * `give_back.changed` is worded for the form, which is not drawn, so only its result is said. */
export function resendRefused(
  step: Extract<Step, { kind: "lost" }>,
  refusal: ReturnType<typeof refusalOf>,
  saved: GiveBackSent | null | undefined,
): Step {
  const { code } = refusal;
  if (ownPress(saved, step.ids) !== null || !PROVES_NOTHING.has(code))
    return { ...lostAfter(step, saved, step.ids), said: checkRefusalText(refusal) };
  const changed = code === "give_back.changed";
  return {
    kind: "done",
    way: step.way,
    notice: changed || code === "sif.allocation_invalid" ? t("give_back.nothing_given") : null,
    outcome: {
      parts: [],
      refusal: changed ? null : { code, params: { ...refusal } },
      underWay: null,
      rest: null,
    },
  };
}

/** A send's refusal: this device's own when its saved attempt stopped it (storage that cannot be
 * used, or a send already out on the receipt), otherwise the server's. */
export const sendRefusalOf = (error: unknown) =>
  error instanceof TenderRefundAttemptError
    ? { code: error.kind === "storage" || error.kind === "busy" ? error.kind : "network" }
    : refusalOf(error);

/** The outcome a saved rest reopens on: the card refund it waits for, if any, and the rest. */
export const restOutcome = (rest: GiveBackRest): GiveBackOutcome => ({
  parts:
    rest.waitFor === undefined
      ? []
      : [{ kind: "refund", amount: rest.amount, state: "pending", refundId: rest.waitFor }],
  refusal: null,
  underWay: null,
  rest: rest.request,
});

/** An answer whose every part is still to start: the press's first send is still writing, so
 * nothing is known yet. */
export const stillStarting = (outcome: GiveBackOutcome) =>
  outcome.rest === null &&
  outcome.refusal === null &&
  outcome.parts.every((part) => part.state === "not_started");

/** The rights an approver must hold for a send refused for one: those the preview named, and the
 * one the refusal names. */
export function approverRights(
  needs: readonly GiveBackRight[],
  permission: unknown,
): GiveBackRight[] {
  const named: GiveBackRight[] =
    permission === "sale.refund" || permission === "sale.rectify" ? [permission] : [];
  const rights = [...new Set([...needs, ...named])];
  return rights.length > 0 ? rights : ["sale.refund"];
}

/** What Give back will do, from the preview's answer: the total, how it goes back, any rest left
 * under way, and whether a PIN is asked. */
export function summaryOf(answer: GiveBackPreview, way: GiveBackWay, total: string) {
  const now = money(sumOf(answer.parts.map((part) => part.amount)));
  const card = way.last4 === null ? "" : `···${way.last4}`;
  const said =
    way.way === "cash"
      ? t("give_back.summary_cash")
      : t(answer.manual ? "give_back.summary_terminal" : "give_back.summary_card");
  return html`<div class="summary" data-summary>
    <p class="total" data-summary-total>${money(total)}</p>
    <p data-summary-way>
      ${said
        .replace("{amount}", () => now)
        .replace("{card}", () => card)
        .replace(/\s+/g, " ")}
    </p>
    ${
      positive(answer.leftUnderWay)
        ? html`<p data-summary-rest>
            ${t("give_back.summary_rest").replace("{amount}", () => money(answer.leftUnderWay))}
          </p>`
        : nothing
    }
    ${answer.needs.length > 0 ? html`<p class="muted" data-pin>${t("give_back.pin")}</p>` : nothing}
  </div>`;
}
