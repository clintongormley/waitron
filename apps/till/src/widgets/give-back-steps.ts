import { html, nothing } from "lit";
import { compareDecimal, decimal, formatMoney, sumDecimals } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";
import type {
  GiveBackAsk,
  GiveBackOutcome,
  GiveBackRight,
  GiveBackWay,
} from "../api/give-back-types.js";

export type Override = OverrideConfirmDetail;
/** One send: the rights an approver must hold for it, and the payment the outcome names. */
export interface Sending {
  send: (override?: Override) => Promise<GiveBackOutcome>;
  rights: GiveBackRight[];
  way: string;
}
export const PIN_REFUSALS = new Set(["pin.invalid", "pin.throttled"]);
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
  | { kind: "lost"; way: string }
  | { kind: "done"; outcome: GiveBackOutcome; way: string; notice: string | null };

const money = (value: string) => formatMoney(value, currentLocale());
const sumOf = (amounts: readonly string[]) => sumDecimals(amounts.map((amount) => decimal(amount)));
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;

/** The separate terminal's step (picture g): staff give the money back there, then confirm. */
export function terminalStep(
  ask: GiveBackAsk,
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

/** What went back, what waits, and why anything did not, from the write's answer. A cash
 * correction prints its own receipt; any other says where to print it (D14). */
function outcomeLines(
  outcome: GiveBackOutcome,
  way: GiveBackWay | undefined,
  notice: string | null,
) {
  const amounts = (state: string) =>
    sumOf(outcome.parts.filter((part) => part.state === state).map((part) => part.amount));
  const back = amounts("completed");
  const pending = amounts("pending");
  const card = way?.last4 ? `···${way.last4}` : "";
  const lines: string[] = [];
  if (positive(back))
    lines.push(
      way?.way === "cash"
        ? t("give_back.done_cash").replace("{amount}", () => money(back))
        : way?.manual
          ? t("give_back.done_terminal").replace("{amount}", () => money(back))
          : t("give_back.done_card")
              .replace("{amount}", () => money(back))
              .replace("{card}", () => card)
              .replace(/\s+\./, "."),
    );
  if (
    way?.way !== "cash" &&
    outcome.parts.some((part) => part.kind === "correction" && part.state === "completed")
  )
    lines.push(t("give_back.print_later"));
  if (positive(pending))
    lines.push(t("give_back.pending").replace("{amount}", () => money(pending)));
  if (outcome.rest !== null && outcome.refusal === null)
    lines.push(
      t("give_back.rest").replace("{amount}", () =>
        money(sumOf([outcome.rest!.amount, outcome.rest!.extra])),
      ),
    );
  if (outcome.refusal !== null)
    lines.push(codeMessage(outcome.refusal.code, currentLocale(), outcome.refusal.params));
  if (notice !== null) lines.push(notice);
  return html`<div class="body-step" data-outcome role="status">
    ${
      outcome.underWay === null
        ? nothing
        : html`<p class="heading" data-under-way>${t("give_back.under_way")}</p>`
    }
    ${lines.map((line) => html`<p>${line}</p>`)}
  </div>`;
}

/** A press whose answer was lost: sending it again reuses its ids, so nothing goes back twice. */
export function lostStep(sending: boolean, on: { close: () => void; resend: () => void }) {
  return html`<p data-lost role="status">${t("give_back.lost")}</p>
    <wt-form-actions
      ><wt-button slot="cancel" variant="secondary" data-close @click=${on.close}
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

/** The outcome, with Check again while a rest waits for the card company. */
export function doneStep(
  step: Extract<Step, { kind: "done" }>,
  way: GiveBackWay | undefined,
  sending: boolean,
  on: { close: () => void; checkAgain: () => void },
) {
  const waits = step.outcome.rest !== null && step.outcome.refusal === null;
  return html`${outcomeLines(step.outcome, way, step.notice)}
    <wt-form-actions
      ><wt-button
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
              >${t("give_back.check_again")}</wt-button
            >`
          : nothing
      }</wt-form-actions
    >`;
}
