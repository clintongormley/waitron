import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney, sumDecimals } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./supervisor-override-dialog.js";
import {
  approverRefusal,
  type ApproverRefusal,
  type OverrideConfirmDetail,
} from "./supervisor-override-dialog.js";
import { giveBackStyles } from "./give-back-styles.js";
import { NEEDS_APPROVER, terminalStep } from "./give-back-steps.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type { StaffMember, TillApi } from "../api/client.js";
import type { GiveBackRight } from "../api/give-back-types.js";
import type {
  CorrectionSplitLine,
  InvoiceCorrectionView,
} from "../api/invoice-correction-types.js";
import type { RefundableTender, TenderRefundView } from "../api/tender-refund-types.js";
import type { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import {
  TenderRefundAttemptError,
  refundMethodAllowed,
  type SavedTenderRefund,
  type TenderRefundSession,
} from "../state/tender-refund.js";
import { refusalOf } from "../state/bill-payment.js";
import { limited, TABLE_REQUEST_LIMIT_MS } from "../state/draft-sync.js";

export type GiveBackUnderWayApi = Pick<
  TillApi,
  | "getInvoiceCorrection"
  | "getRefundableTenders"
  | "fileInvoiceCorrection"
  | "closeInvoiceCorrection"
  | "listApprovers"
>;

type Override = { personId: string; pin: string };
type Step = () => Promise<void>;
interface Retry {
  step: Step;
  lost: StringKey;
}
interface Terminal {
  row: RefundableTender;
  target: string;
  confirmed: boolean;
  attempted: boolean;
}
const PIN_REFUSALS = new Set(["pin.invalid", "pin.throttled", "authorization.not_permitted"]);
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;
const least = (a: string, b: string) => (compareDecimal(decimal(a), decimal(b)) < 0 ? a : b);

/** A give-back still under way (D12): what is back, what is left, and the steps that finish it.
 * Closing the window it sits in ends nothing. */
@customElement("till-give-back-under-way")
export class TillGiveBackUnderWay extends LitElement {
  static override styles = [baseStyles, giveBackStyles];
  @property({ attribute: false }) api!: GiveBackUnderWayApi;
  @property() saleId = "";
  @property({ attribute: false }) correction!: InvoiceCorrectionView;
  @property({ attribute: false }) corrections!: InvoiceCorrectionSession;
  @property({ attribute: false }) refunds!: TenderRefundSession;
  @property({ attribute: false }) capabilities: readonly string[] = [];
  @property({ attribute: false }) close!: () => void;
  @state() private tenders: RefundableTender[] = [];
  @state() private busy = false;
  @state() private message = "";
  @state() private cashGiven: string | null = null;
  @state() private approvers: StaffMember[] | null = null;
  @state() private pinError: ApproverRefusal | null = null;
  @state() private terminal: Terminal | null = null;
  /** A card's part whose answer never arrived; while it exists only it is sent again. */
  @state() private lostCard: SavedTenderRefund | null = null;
  #override?: Override;
  #retry?: Retry;
  #focused = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.lostCard = this.#lostCard();
    void this.#readTenders();
  }
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#abandonCard();
  }
  override updated(): void {
    if (this.#focused) return;
    const first = this.shadowRoot!.querySelector<LitElement>("[data-choice]");
    if (first === null) return;
    this.#focused = true;
    void first.updateComplete.then(() => first.focus());
  }
  #money(value: string): string {
    return formatMoney(value, currentLocale());
  }
  async #readTenders(): Promise<boolean> {
    try {
      this.tenders = await this.api.getRefundableTenders(this.saleId, {});
      return true;
    } catch {
      return false;
    }
  }
  /** The card refund this till saved for this correction, if one is still unsettled. */
  #savedCard(): SavedTenderRefund | null {
    try {
      const saved = this.refunds.read(this.saleId);
      return saved?.request.invoiceCorrectionId === this.correction.id.toLowerCase() ? saved : null;
    } catch {
      return null;
    }
  }
  /** A card's part refused for a right whose sign-in is dropped moved nothing: forget it. */
  #abandonCard(): void {
    if (this.#savedCard() === null) return;
    try {
      this.refunds.abandon(this.saleId);
    } catch {
      // Unreadable storage: Check again or the next press says so.
    }
  }
  /** A card refund Refund a payment saved on this receipt whose answer was lost, which Check
   * again here does not ask about. */
  #elsewhereLost(): boolean {
    try {
      const saved = this.refunds.read(this.saleId);
      return saved !== null && saved.refundId === null && this.#savedCard() === null;
    } catch {
      return false;
    }
  }
  #lostCard(): SavedTenderRefund | null {
    const saved = this.#savedCard();
    return saved?.refundId === null ? saved : null;
  }
  async #refresh(): Promise<void> {
    const [correction] = await Promise.all([
      this.api.getInvoiceCorrection(this.correction.id, {}),
      this.#readTenders(),
    ]);
    this.correction = correction;
  }
  /** After a step went through: what is back now, or on the next Check again if unread. */
  #refreshAfter(): Promise<void> {
    return this.#refresh().catch(() => undefined);
  }
  /** Check again: a card part waiting for the card company is asked first, so its saved request
   * is settled before the correction is read. */
  async #checkAgain(): Promise<void> {
    if (this.#savedCard()?.refundId) this.#cardDone(await this.refunds.resume(this.saleId));
    await this.#refresh();
  }
  /** Runs `step`, asking for an approver when the person signed in may not, and running it again
   * with their PIN; the PIN lasts for that one step. */
  async #run(step: Step, lost: StringKey): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message = "";
    const approverId = this.#override?.personId;
    try {
      await step();
      this.#settle();
    } catch (error) {
      await this.#failed(error, { step, lost }, approverId);
    } finally {
      this.busy = false;
    }
  }
  #settle(): void {
    this.approvers = null;
    this.#override = undefined;
    this.#retry = undefined;
  }
  async #failed(error: unknown, retry: Retry, approverId: string | undefined): Promise<void> {
    if (error instanceof TenderRefundAttemptError) {
      this.#settle();
      this.terminal = null;
      this.lostCard = this.#lostCard();
      if (error.kind === "storage" || error.kind === "invalid")
        this.message = t("give_back.storage");
      else if (error.kind === "mismatch") this.message = t("give_back.uw_unknown");
      else if (this.lostCard === null)
        this.message = t(
          this.#elsewhereLost() ? "give_back.uw_card_elsewhere" : "give_back.uw_card_waiting",
        );
      return;
    }
    const refusal = refusalOf(error);
    if (this.approvers !== null && approverId !== undefined && PIN_REFUSALS.has(refusal.code)) {
      this.pinError = approverRefusal(error, approverId);
      return;
    }
    if (approverId === undefined && NEEDS_APPROVER.has(refusal.code)) {
      this.#retry = retry;
      await this.#askApprover(
        refusal.permission === "sale.rectify" ? "sale.rectify" : "sale.refund",
      );
      return;
    }
    this.#settle();
    this.terminal = null;
    if (refusal.code === "network") {
      this.lostCard = this.#lostCard();
      if (this.lostCard === null) this.message = t(retry.lost);
      return;
    }
    this.message = codeMessage(refusal.code, currentLocale(), refusal);
    if (refusal.code === "invoice_correction.split_changed") await this.#refreshAfter();
  }
  async #askApprover(right: GiveBackRight): Promise<void> {
    this.#override = undefined;
    const limit = limited(TABLE_REQUEST_LIMIT_MS);
    try {
      this.approvers = await this.api.listApprovers(right, { signal: limit.signal });
      this.pinError = null;
    } catch (error) {
      const read = refusalOf(error);
      this.#settle();
      this.terminal = null;
      this.message =
        read.code === "network"
          ? t("give_back.uw_approvers_failed")
          : codeMessage(read.code, currentLocale(), read);
    } finally {
      limit.done();
    }
  }
  #signedIn(event: CustomEvent<OverrideConfirmDetail>): void {
    event.stopPropagation();
    const retry = this.#retry;
    if (this.approvers === null || this.busy || retry === undefined) return;
    this.#override = { personId: event.detail.personId, pin: event.detail.pin };
    void this.#run(retry.step, retry.lost);
  }
  /** What a lost cash answer was sent with, which the next cash press sends again. */
  #savedCash(): string | null {
    try {
      return this.corrections.savedCash(this.correction.id)?.amount ?? null;
    } catch {
      return null;
    }
  }
  #giveCash(amount: string): Step {
    return async () => {
      const given = await this.corrections.giveCash(this.correction.id, { amount }, this.#override);
      this.cashGiven = amount;
      this.correction = given.correction;
      if (given.correction.state === "open") await this.#readTenders();
    };
  }
  /** Finish, Stop here and Cancel this money back: `/file` with the split the read offers, or
   * `/close` without one. */
  #end(split: CorrectionSplitLine[] | null): Step {
    return async () => {
      const { id } = this.correction;
      const override = this.#override === undefined ? {} : { override: this.#override };
      this.correction =
        split === null
          ? await this.api.closeInvoiceCorrection(id, override)
          : await this.api.fileInvoiceCorrection(id, { expectedSplit: split, ...override });
    };
  }
  /** The card's payment is read again first: it may have changed since the window read it. */
  async #card(row: RefundableTender): Promise<void> {
    this.busy = true;
    this.message = "";
    const read = await this.#readTenders();
    this.busy = false;
    if (!read) {
      this.message = t("give_back.uw_card_unread");
      return;
    }
    const fresh = this.#cards().find((card) => card.tenderId === row.tenderId);
    if (fresh === undefined || fresh.manual !== row.manual) {
      this.message = t("give_back.uw_card_changed");
      return;
    }
    const target = least(this.correction.left, fresh.appliedRemaining);
    if (fresh.manual) this.terminal = { row: fresh, target, confirmed: false, attempted: false };
    else await this.#run(this.#sendCard(fresh, target, false), "give_back.uw_unknown");
  }
  #sendCard(row: RefundableTender, target: string, manualConfirmed: boolean): Step {
    return async () => {
      const result = await this.refunds.submit(
        this.saleId,
        {
          tenderId: row.tenderId,
          appliedAmount: target,
          tipAmount: "0.00",
          reason: this.correction.reason,
          manualConfirmed,
          invoiceCorrectionId: this.correction.id,
        },
        this.#override,
      );
      this.#cardDone(result);
      await this.#refreshAfter();
    };
  }
  #cardDone(result: TenderRefundView): void {
    this.lostCard = null;
    this.terminal = null;
    if (result.state === "failed") this.message = t("give_back.uw_card_failed");
  }
  /** The separate terminal's refund is always confirmed with a PIN (plan 5.4). */
  async #record(step: Terminal): Promise<void> {
    if (!step.confirmed) {
      this.terminal = { ...step, attempted: true };
      return;
    }
    this.#retry = {
      step: this.#sendCard(step.row, step.target, true),
      lost: "give_back.uw_unknown",
    };
    await this.#askApprover("sale.refund");
  }
  #resendCard(): void {
    void this.#run(async () => {
      this.#cardDone(await this.refunds.retry(this.saleId, this.#override));
      await this.#refreshAfter();
    }, "give_back.uw_unknown");
  }
  /** The card payments with money left that this device may give back to, none waiting. */
  #cards(): RefundableTender[] {
    return this.tenders.filter(
      (row) =>
        row.method === "card" &&
        positive(row.appliedRemaining) &&
        row.pendingRefundId === null &&
        refundMethodAllowed(row, this.capabilities),
    );
  }
  #choice(name: string, label: string, hint: string, run: () => void, variant = "secondary") {
    return html`<div class="choice">
      <wt-button
        variant=${variant}
        data-choice=${name}
        .disabled=${this.busy}
        @click=${() => {
          if (!this.busy) run();
        }}
        >${label}</wt-button
      >
      ${hint ? html`<p class="muted" data-hint=${name}>${hint}</p>` : nothing}
    </div>`;
  }
  #cashChoice(left: string) {
    const cashLeft: string = sumDecimals(
      this.tenders
        .filter((row) => row.method === "cash" && positive(row.appliedRemaining))
        .map((row) => decimal(row.appliedRemaining)),
    );
    const allowed = refundMethodAllowed({ method: "cash", manual: false }, this.capabilities);
    const amount =
      this.#savedCash() ??
      (positive(left) && positive(cashLeft) && allowed ? least(left, cashLeft) : null);
    if (amount !== null)
      return this.#choice(
        "cash",
        t("give_back.uw_cash").replace("{amount}", () => this.#money(amount)),
        t("give_back.uw_cash_hint"),
        () => void this.#run(this.#giveCash(amount), "give_back.uw_unknown"),
      );
    return positive(left) && positive(cashLeft)
      ? html`<p data-no-cash>${t("give_back.uw_no_cash")}</p>`
      : nothing;
  }
  #cardChoice(row: RefundableTender, left: string) {
    const amount = this.#money(least(left, row.appliedRemaining));
    return this.#choice(
      "card",
      row.last4
        ? t("give_back.uw_card")
            .replace("{amount}", () => amount)
            .replace("{card}", () => `···${row.last4}`)
        : t("give_back.uw_card_any").replace("{amount}", () => amount),
      t(row.manual ? "give_back.uw_terminal_hint" : "give_back.uw_card_hint"),
      () => void this.#card(row),
    );
  }
  #endChoices(correction: InvoiceCorrectionView) {
    const { fileNow, left } = correction;
    const back = this.#money(correction.moneyBack);
    const nothingBack = !positive(correction.moneyBack) && !positive(correction.pending);
    const split = fileNow !== null && "vatBreakdown" in fileNow ? fileNow.vatBreakdown : null;
    const closes = fileNow !== null && "refusal" in fileNow && fileNow.closable;
    const stop = split !== null && positive(left);
    const end = (filed: CorrectionSplitLine[] | null) => () =>
      void this.#run(this.#end(filed), "give_back.uw_unknown_end");
    return html`${
      fileNow !== null && "refusal" in fileNow
        ? html`<p data-file-refusal>${codeMessage(fileNow.refusal, currentLocale(), fileNow)}</p>`
        : nothing
    }
    ${
      !nothingBack && (split !== null || closes)
        ? this.#choice(
            stop ? "stop" : "finish",
            t(stop ? "give_back.uw_stop" : "give_back.uw_finish"),
            t(stop ? "give_back.uw_stop_hint" : "give_back.uw_finish_hint").replace(
              "{amount}",
              () => back,
            ),
            end(split),
            "primary",
          )
        : nothing
    }
    ${
      nothingBack && this.lostCard === null && this.#savedCash() === null
        ? this.#choice("cancel", t("give_back.uw_cancel"), t("give_back.uw_cancel_hint"), end(null))
        : nothing
    }`;
  }
  #ended(correction: InvoiceCorrectionView) {
    const said =
      correction.state === "discarded"
        ? t("give_back.uw_cancelled")
        : t("give_back.uw_finished").replace("{amount}", () => this.#money(correction.moneyBack));
    const cash =
      this.cashGiven === null
        ? ""
        : ` ${t("give_back.uw_cash_given").replace("{amount}", () => this.#money(this.cashGiven!))}`;
    return html`<p data-outcome role="status">${said}${cash}</p>
      <wt-form-actions
        ><wt-button variant="primary" data-done @click=${() => this.close()}
          >${t("give_back.done")}</wt-button
        ></wt-form-actions
      >`;
  }
  #open(correction: InvoiceCorrectionView) {
    const { left } = correction;
    return html`<p data-back>
        ${t("give_back.uw_back")
          .replace("{back}", () => this.#money(correction.moneyBack))
          .replace("{gross}", () => this.#money(correction.gross))}
      </p>
      <p data-left>${t("give_back.uw_left").replace("{amount}", () => this.#money(left))}</p>
      ${
        this.cashGiven === null
          ? nothing
          : html`<p data-cash-given role="status">
              ${t("give_back.uw_cash_given").replace("{amount}", () =>
                this.#money(this.cashGiven!),
              )}
            </p>`
      }
      ${
        positive(correction.pending)
          ? html`<p data-pending>
              ${t("give_back.pending").replace("{amount}", () => this.#money(correction.pending))}
            </p>`
          : nothing
      }
      ${this.#choice("check", t("give_back.check_again"), "", () => void this.#run(() => this.#checkAgain(), "give_back.read_failed"))}
      ${this.#cashChoice(left)}
      ${
        this.lostCard !== null
          ? html`<p data-lost role="status">${t("give_back.lost")}</p>
              <wt-button
                variant="primary"
                data-send-again
                .loading=${this.busy}
                .disabled=${this.busy}
                @click=${() => this.#resendCard()}
                >${t("give_back.send_again")}</wt-button
              >`
          : positive(left)
            ? this.#cards().map((row) => this.#cardChoice(row, left))
            : nothing
      }
      ${this.#endChoices(correction)}
      <wt-form-actions .error=${this.message}
        ><wt-button
          slot="cancel"
          variant="secondary"
          data-close
          .disabled=${this.busy}
          @click=${() => this.close()}
          >${t("give_back.uw_close")}</wt-button
        ></wt-form-actions
      >`;
  }
  #body() {
    const step = this.terminal;
    if (step !== null)
      return terminalStep(
        { expected: [{ kind: "refund", amount: step.target, way: step.row.tenderId }] },
        { ...step, sending: this.busy },
        {
          confirm: (confirmed) => {
            this.terminal = { ...step, confirmed };
          },
          back: () => {
            this.terminal = null;
          },
          record: () => void this.#record(step),
        },
      );
    return this.correction.state === "open"
      ? this.#open(this.correction)
      : this.#ended(this.correction);
  }
  override render() {
    return html`<div class="body-step" data-under-way>${this.#body()}</div>
      ${
        this.approvers === null
          ? nothing
          : html`<till-supervisor-override-dialog
              .authorizers=${this.approvers}
              .error=${this.pinError}
              @override-cancel=${(event: Event) => {
                event.stopPropagation();
                if (this.busy) return;
                this.#settle();
                this.#abandonCard();
              }}
              @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) =>
                this.#signedIn(event)}
            ></till-supervisor-override-dialog>`
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-give-back-under-way": TillGiveBackUnderWay;
  }
}
