import { LitElement, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney, sumDecimals } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-choice-row.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { giveBackStyles } from "./give-back-styles.js";
import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, giveBackReasonMessage } from "../i18n/codes.js";
import type { AdjustmentReason, StaffMember, TillApi } from "../api/client.js";
import type {
  GiveBackAsk,
  GiveBackLine,
  GiveBackPreview,
  GiveBackPurpose,
  GiveBackRequest,
  GiveBackRight,
  GiveBackView,
  GiveBackWaitReason,
  GiveBackWay,
} from "../api/give-back-types.js";
import { reasonPicker } from "./reason-picker.js";
import { lineName } from "../screens/till-ticket-view.js";
import { unservedDishText } from "./dish-format.js";
import type { StringKey } from "../i18n/strings.js";
import { REASON_MAX, moneyPlus, refusalOf, typedMoney } from "../state/bill-payment.js";
import type { GiveBackSession } from "../state/give-back.js";
import type { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import type { InvoiceCorrectionView } from "../api/invoice-correction-types.js";
import { TenderRefundAttemptError, type TenderRefundSession } from "../state/tender-refund.js";
import "./give-back-under-way.js";
import type { GiveBackUnderWayApi } from "./give-back-under-way.js";
import "./supervisor-override-dialog.js";
import {
  approverRefusal,
  type ApproverRefusal,
  type OverrideConfirmDetail,
} from "./supervisor-override-dialog.js";
import {
  NEEDS_APPROVER,
  APPROVER_PIN_REFUSALS,
  afterCheck,
  approverRights,
  doneStep,
  lostFor,
  lostStep,
  restOutcome,
  stillStarting,
  terminalStep,
  waitsForCard,
  type Override,
  type Sending,
  type Step,
} from "./give-back-steps.js";

type Refusal = ReturnType<typeof refusalOf>;

export type GiveBackApi = GiveBackUnderWayApi &
  Pick<TillApi, "readGiveBack" | "previewGiveBack" | "listAdjustmentReasons" | "listApprovers">;
export type { GiveBackAsk };

/** What Cancel and refund or Finish table hands on: the window opens on A dish with the dishes
 * still owed on a cancel ticked, and sends the cancel ids so the cancel's approval covers them
 * (D9). */
export interface GiveBackFill {
  cancellationIds: string[];
  reasonId: string;
}

type Draft = {
  lineIds: string[];
  amount: string;
  extraOn: boolean;
  way: string;
  reasonId: string;
  note: string;
};
type Field = "amount" | "reason" | "note";
const blank = (): Draft => ({
  lineIds: [],
  amount: "",
  extraOn: false,
  way: "",
  reasonId: "",
  note: "",
});
const PURPOSES: readonly GiveBackPurpose[] = ["dishes", "goodwill", "extra"];
const AMOUNT_REFUSALS = new Set([
  "sale.correction_amount_invalid",
  "invoice_correction.money_short",
  "tender.refund_exceeds_payment",
  "tender.refund_exceeds_cancelled",
]);
/** A payment this device's profile does not take is held, as the preview refuses it. */
const usable = (way: GiveBackWay) => way.reason === null && way.allowedHere;
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;
/** What ticking `line` starts the amount at: a cancel's money still owed, otherwise what is left. */
const startOf = (line: GiveBackLine) =>
  line.cancelled !== null && positive(line.cancelled.owed) ? line.cancelled.owed : line.left;

@customElement("till-give-back-dialog")
export class TillGiveBackDialog extends LitElement {
  static override styles = [baseStyles, giveBackStyles, helpAnchorStyles];
  @property({ attribute: false }) api!: GiveBackApi;
  /** Saves each press before sending it. */
  @property({ attribute: false }) session!: GiveBackSession;
  /** The under-way view's cash and card parts, each saved before it is sent. */
  @property({ attribute: false }) corrections!: InvoiceCorrectionSession;
  @property({ attribute: false }) refunds!: TenderRefundSession;
  @property({ attribute: false }) capabilities: readonly string[] = [];
  @property() saleId = "";
  @property() invoiceNumber = "";
  @property() namesLocale = "";
  @property({ attribute: false }) fill: GiveBackFill | null = null;
  @state() private view: GiveBackView | null = null;
  @state() private loadRefusal: Refusal | null = null;
  @state() private reasons: AdjustmentReason[] | null = null;
  @state() private reasonsLoading = false;
  @state() private purpose: GiveBackPurpose | null = null;
  @state() private draft: Draft = blank();
  /** Once the amount is typed, ticking a dish or choosing a payment leaves it alone. */
  @state() private amountTyped = false;
  @state() private preview:
    { key: string; answer: GiveBackPreview } | { key: string; refusal: Refusal } | null = null;
  @state() private active = true;
  @state() private attempted = false;
  @state() private confirming = false;
  @state() private changedWhileChecking = false;
  @state() private step: Step | null = null;
  @state() private sending = false;
  @state() private sendRefusal: Refusal | null = null;
  @state() private approvers: StaffMember[] | null = null;
  @state() private pinError: ApproverRefusal | null = null;
  #approval?: Sending;
  #previewRequest = 0;
  #lastStep = "";
  #filled = false;
  /** The dishes the window opened ticked; the cancel's ids go only with exactly these. */
  #filledLines: string[] = [];
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.#restore();
    void this.#load();
    void this.#loadReasons();
    const { scope, coordinator } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value, lineIds: [...value.lineIds] }),
      equal: (a, b) => JSON.stringify(this.#comparable(a)) === JSON.stringify(this.#comparable(b)),
      restore: (value) => {
        this.draft = { ...value, lineIds: [...value.lineIds] };
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.draft);
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  override updated(): void {
    const step = this.view === null ? "" : (this.purpose ?? "choice");
    if (step === this.#lastStep) return;
    this.#lastStep = step;
    void this.#focusFirstControl();
  }
  /** A step replaces the control that was pressed, so the new step's first control takes focus. */
  async #focusFirstControl(): Promise<void> {
    await this.shadowRoot!.querySelector<WtDialog>("wt-dialog")?.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>(
      ".body :is(wt-choice-row, wt-switch, wt-price-input, wt-button):not([disabled])",
    )?.focus();
  }
  async #load(): Promise<void> {
    this.loadRefusal = null;
    try {
      this.view = await this.api.readGiveBack(this.saleId, {});
      this.#fillIn(this.view);
    } catch (error) {
      this.loadRefusal = refusalOf(error);
    }
  }
  async #loadReasons(): Promise<void> {
    this.reasonsLoading = true;
    try {
      this.reasons = await this.api.listAdjustmentReasons();
    } catch {
      // The picker offers Retry while the reasons are unread.
    }
    this.reasonsLoading = false;
  }
  #comparable(value: Draft) {
    return {
      lineIds: [...value.lineIds].sort(),
      amount: typedMoney(value.amount) ?? value.amount,
      extraOn: value.extraOn,
      way: value.way,
      reasonId: value.reasonId,
      note: value.note.trim(),
    };
  }
  #money(value: string): string {
    return formatMoney(value, currentLocale());
  }
  #reasonText(reason: GiveBackWaitReason): string {
    return giveBackReasonMessage(reason.code, currentLocale(), reason.params);
  }
  /** The payments this purpose can give back from: those holding money, or for the extra, an extra. */
  #offered(purpose: GiveBackPurpose): GiveBackWay[] {
    return this.view!.ways.filter((way) =>
      positive(purpose === "extra" ? way.extraLeft : way.moneyLeft),
    );
  }
  #way(): GiveBackWay | undefined {
    return this.view!.ways.find((way) => way.way === this.draft.way && usable(way));
  }
  #extraPaid(): string {
    return sumDecimals(this.view!.ways.map((way) => decimal(way.extraLeft)));
  }
  #limit(): string {
    if (this.purpose === "extra") return this.#way()?.extraLeft ?? "0.00";
    return sumDecimals(this.view!.ways.map((way) => decimal(way.moneyLeft)));
  }
  #extra(): string {
    const way = this.#way();
    return this.purpose !== "extra" && this.draft.extraOn && way !== undefined
      ? way.extraLeft
      : "0.00";
  }
  /** Once, on the first read, unless a saved press opened the window elsewhere. */
  #fillIn(view: GiveBackView): void {
    const fill = this.fill;
    if (fill === null || this.#filled || this.step !== null || !view.choices.dishes.available)
      return;
    this.#filled = true;
    const owed = view.lines.filter(
      (line) =>
        line.partOf === null &&
        line.available &&
        line.cancelled !== null &&
        positive(line.cancelled.owed) &&
        line.cancelIds.length > 0 &&
        line.cancelIds.every((id) => fill.cancellationIds.includes(id)),
    );
    this.#filledLines = owed.map((line) => line.id);
    this.#choose("dishes", {
      lineIds: owed.map((line) => line.id),
      amount:
        owed.length === 0 ? "" : sumDecimals(owed.map((line) => decimal(line.cancelled!.owed))),
      reasonId: fill.reasonId,
    });
  }
  #choose(purpose: GiveBackPurpose, filled: Partial<Draft> = {}): void {
    const way = this.#offered(purpose).find(usable);
    this.purpose = purpose;
    this.amountTyped = false;
    this.attempted = false;
    this.changedWhileChecking = false;
    this.draft = {
      ...blank(),
      way: way?.way ?? "",
      amount: purpose === "extra" && way !== undefined ? way.extraLeft : "",
      ...filled,
    };
    this.#scope?.commit(this.draft);
    void this.#preview();
  }
  /** Back leaves the form, so staged input asks first, as closing does. */
  #back(): void {
    if (!this.#scope!.isDirty()) {
      this.#toChoice();
      return;
    }
    void this.#leave!.request({
      scopes: [this],
      reason: "navigation",
      proceed: () => this.#toChoice(),
    });
  }
  #toChoice(): void {
    this.purpose = null;
    this.draft = blank();
    this.preview = null;
    this.#previewRequest++;
    this.#scope?.commit(this.draft);
  }
  #set(change: Partial<Draft>): void {
    this.draft = { ...this.draft, ...change };
    this.sendRefusal = null;
    this.#scope?.changed();
    if (!("reasonId" in change) && !("note" in change)) void this.#preview();
  }
  #tick(line: GiveBackLine, checked: boolean): void {
    const others = this.draft.lineIds.filter((id) => id !== line.id);
    const lineIds = checked ? [...others, line.id] : others;
    if (this.amountTyped) {
      this.#set({ lineIds });
      return;
    }
    const ticked = this.view!.lines.filter((row) => lineIds.includes(row.id));
    this.#set({
      lineIds,
      amount: ticked.length === 0 ? "" : sumDecimals(ticked.map((row) => decimal(startOf(row)))),
    });
  }
  #chooseWay(way: GiveBackWay): void {
    const change: Partial<Draft> = { way: way.way };
    if (this.purpose === "extra" && !this.amountTyped) change.amount = way.extraLeft;
    if (!positive(way.extraLeft)) change.extraOn = false;
    this.#set(change);
  }
  #errors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    const amount = typedMoney(this.draft.amount);
    const limit = this.#limit();
    if (amount === null || !positive(amount) || compareDecimal(decimal(amount), decimal(limit)) > 0)
      errors.set(
        "amount",
        t("give_back.amount_invalid").replace("{amount}", () => this.#money(limit)),
      );
    const reason = this.reasons?.find((row) => row.id === this.draft.reasonId);
    if (!reason) errors.set("reason", t("adjust.reason_required"));
    else if (reason.noteRequired && this.draft.note.trim() === "")
      errors.set("note", t("adjust.note_required"));
    else if (reason.noteRequired && this.draft.note.trim().length > REASON_MAX)
      errors.set("note", t("bill_refund.reason_long"));
    return errors;
  }
  /** Whether everything Give back needs chosen is chosen: a payment, and for A dish, a dish. */
  #chosen(): boolean {
    return (
      this.#way() !== undefined && (this.purpose !== "dishes" || this.draft.lineIds.length > 0)
    );
  }
  #request(): GiveBackRequest | null {
    if (this.purpose === null || !this.#chosen() || this.#errors().has("amount")) return null;
    return {
      purpose: this.purpose,
      ...(this.purpose === "dishes" ? { lineIds: [...this.draft.lineIds] } : {}),
      amount: typedMoney(this.draft.amount)!,
      extra: this.#extra(),
      way: this.draft.way,
      ...(this.#fromFill() ? { fromCancel: [...this.fill!.cancellationIds] } : {}),
    };
  }
  #fromFill(): boolean {
    const ticked = this.draft.lineIds;
    return (
      this.purpose === "dishes" &&
      this.fill !== null &&
      this.fill.cancellationIds.length > 0 &&
      this.#filledLines.length > 0 &&
      ticked.length === this.#filledLines.length &&
      ticked.every((id) => this.#filledLines.includes(id))
    );
  }
  async #preview(): Promise<void> {
    const request = this.#request();
    const asked = ++this.#previewRequest;
    if (request === null) {
      this.preview = null;
      return;
    }
    const key = JSON.stringify(request);
    let next: NonNullable<typeof this.preview>;
    try {
      next = { key, answer: await this.api.previewGiveBack(this.saleId, request) };
    } catch (error) {
      next = { key, refusal: refusalOf(error) };
    }
    if (asked === this.#previewRequest) this.preview = next;
  }
  #key(): string | null {
    const request = this.#request();
    return request === null ? null : JSON.stringify(request);
  }
  #answer(): GiveBackPreview | null {
    const shown = this.preview;
    return shown !== null && "answer" in shown && shown.key === this.#key() ? shown.answer : null;
  }
  #refusal(): Refusal | null {
    const shown = this.preview;
    return shown !== null && "refusal" in shown && shown.key === this.#key() ? shown.refusal : null;
  }
  #refusalText(refusal: Refusal, lost: StringKey): string {
    if (refusal.code === "network") return t(lost);
    return codeMessage(refusal.code, currentLocale(), refusal);
  }
  async #confirm(): Promise<void> {
    this.attempted = true;
    this.changedWhileChecking = false;
    this.sendRefusal = null;
    if (this.#errors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (this.#answer() === null) {
      // What is handed on must be what was on screen at the press, so an edit made while the
      // preview is asked again needs a press of its own.
      const pressed = JSON.stringify(this.#comparable(this.draft));
      this.confirming = true;
      await this.#preview();
      this.confirming = false;
      if (JSON.stringify(this.#comparable(this.draft)) !== pressed) {
        this.changedWhileChecking = true;
        return;
      }
    }
    const answer = this.#answer();
    if (answer === null) return;
    const request = this.#request()!;
    const reason = this.reasons!.find((row) => row.id === this.draft.reasonId)!;
    const ask: GiveBackAsk = {
      request,
      reasonId: reason.id,
      note: reason.noteRequired ? this.draft.note.trim() : null,
      expected: answer.parts,
    };
    if (answer.manual) {
      this.step = {
        kind: "terminal",
        ask,
        needs: answer.needs,
        confirmed: false,
        attempted: false,
      };
      return;
    }
    await this.#authorized(this.#submitting(ask, answer.needs));
  }
  #submitting(ask: GiveBackAsk, needs: GiveBackRight[]): Sending {
    return {
      send: (override) => this.session.submit(this.saleId, ask, override, needs),
      rights: needs,
      needs,
      way: ask.request.way,
    };
  }
  /** A press saved earlier whose answer was lost, or a rest still to follow, opens where it was. */
  #restore(): void {
    const { sent, rest } = this.#saved(true) ?? { sent: null, rest: null };
    if (sent) this.step = lostFor(sent);
    else if (rest)
      this.step = { kind: "done", outcome: restOutcome(rest), way: rest.way, notice: null };
  }
  async #record(step: Extract<Step, { kind: "terminal" }>): Promise<void> {
    if (!step.confirmed) {
      this.step = { ...step, attempted: true };
      return;
    }
    const ask = { ...step.ask, manualConfirmed: true };
    // The separate terminal's refund is always confirmed with a PIN (plan 5.4).
    const rights = [...new Set<GiveBackRight>([...step.needs, "sale.refund"])];
    await this.#askApprover(this.#submitting(ask, rights));
  }
  async #authorized(sending: Sending): Promise<void> {
    if (sending.rights.length === 0) await this.#send(sending);
    else await this.#askApprover(sending);
  }
  async #askApprover(sending: Sending): Promise<void> {
    this.#approval = sending;
    try {
      this.approvers = await this.api.listApprovers(sending.rights);
      this.pinError = null;
    } catch {
      this.#refused({ code: "approvers" });
    }
  }
  async #send(sending: Sending, override?: Override): Promise<void> {
    this.sending = true;
    this.pinError = null;
    try {
      const outcome = await sending.send(override);
      this.approvers = null;
      this.#approval = undefined;
      this.#scope?.commit(this.draft);
      this.step = stillStarting(outcome)
        ? { kind: "lost", way: sending.way, needs: sending.needs, refusal: null }
        : { kind: "done", outcome, way: sending.way, notice: null };
    } catch (error) {
      this.#sendFailed(sending, error, override);
    } finally {
      this.sending = false;
    }
  }
  #sendFailed(sending: Sending, error: unknown, override?: Override): void {
    const refusal =
      error instanceof TenderRefundAttemptError
        ? { code: error.kind === "storage" ? "storage" : "network" }
        : refusalOf(error);
    if (refusal.code === "network") {
      this.approvers = null;
      this.#approval = undefined;
      const kept = error instanceof TenderRefundAttemptError && error.kind === "locked";
      const sent = kept ? (this.#saved()?.sent ?? null) : null;
      this.step = sent
        ? lostFor(sent)
        : { kind: "lost", way: sending.way, needs: sending.needs, refusal: null };
    } else if (override !== undefined && APPROVER_PIN_REFUSALS.has(refusal.code))
      this.pinError = approverRefusal(error, override.personId);
    else if (override === undefined && NEEDS_APPROVER.has(refusal.code))
      void this.#askApprover({
        ...sending,
        rights: approverRights(sending.needs, refusal.permission),
      });
    else this.#refused(refusal);
  }
  /** What an earlier send saved, first forgetting a first press refused for its PIN when asked;
   * null when the storage cannot be read, which the next press then says. */
  #saved(abandon = false) {
    try {
      if (abandon) this.session.abandon(this.saleId);
      return this.session.read(this.saleId);
    } catch {
      return null;
    }
  }
  /** A rest's refusal stays on its outcome; any other goes back to the form, or to the choice when
   * the window opened on a saved press, with the refusal at the bottom. Whether the press stays
   * saved is the session's: while it does, a changed press is refused as locked. */
  #refused(refusal: Refusal): void {
    this.approvers = null;
    this.#approval = undefined;
    const step = this.step;
    if (step?.kind === "done") {
      this.step = { ...step, notice: this.#sendRefusalText(refusal) };
      return;
    }
    this.step = null;
    this.sendRefusal = refusal;
    if (refusal.code === "give_back.changed") void this.#preview();
  }
  #sendRefusalText(refusal: Refusal): string {
    if (refusal.code === "approvers") return t("give_back.approvers_failed");
    if (refusal.code === "storage") return t("give_back.storage");
    return this.#refusalText(refusal, "give_back.preview_failed");
  }
  async #checkAgain(step: Extract<Step, { kind: "done" }>): Promise<void> {
    this.sending = true;
    let check: Awaited<ReturnType<GiveBackSession["checkRest"]>>;
    try {
      check = await this.session.checkRest(this.saleId);
    } catch (error) {
      this.step = { ...step, notice: this.#sendRefusalText(refusalOf(error)) };
      return;
    } finally {
      this.sending = false;
    }
    this.step = afterCheck(step, check.state);
    if (check.state !== "completed" || check.preview === null) return;
    const { preview } = check;
    await this.#authorized({
      send: (override) => this.session.sendRest(this.saleId, preview, override),
      rights: preview.needs,
      needs: preview.needs,
      way: step.way,
    });
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("give-back-close", { bubbles: true, composed: true }));
  }
  #cancelButton() {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-close
      @click=${() =>
        void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
      >${t("action.cancel")}</wt-button
    >`;
  }
  #choiceRow(purpose: GiveBackPurpose) {
    const heading = t(`give_back.${purpose}`);
    const hint =
      purpose === "extra"
        ? t("give_back.extra_hint").replace("{amount}", () => this.#money(this.#extraPaid()))
        : t(`give_back.${purpose}_hint`);
    const { available, reason } = this.view!.choices[purpose];
    if (available)
      return html`<wt-choice-row
        data-choice=${purpose}
        heading=${heading}
        @click=${() => this.#choose(purpose)}
        >${hint}</wt-choice-row
      >`;
    return html`<div class="unavailable" data-choice=${purpose} aria-disabled="true">
      <span class="title">${heading}</span>
      <span class="hint">${hint}</span>
      ${
        reason === null
          ? nothing
          : html`<span data-choice-reason=${purpose}>${this.#reasonText(reason)}</span>`
      }
    </div>`;
  }
  #choices(view: GiveBackView) {
    const shown = PURPOSES.filter((purpose) => purpose !== "extra" || positive(this.#extraPaid()));
    const apart = shown.some((purpose) => !view.choices[purpose].available);
    return html`<p class="heading" data-what-for>${t("give_back.what_for")}</p>
      ${
        apart
          ? html`<div class="apart">
              ${shown.map((purpose) => html`<div>${this.#choiceRow(purpose)}</div>`)}
            </div>`
          : html`<div>${shown.map((purpose) => this.#choiceRow(purpose))}</div>`
      }
      <wt-form-actions
        .error=${this.sendRefusal === null ? "" : this.#sendRefusalText(this.sendRefusal)}
        >${this.#cancelButton()}</wt-form-actions
      >`;
  }
  #dishText(line: GiveBackLine): string {
    const dishName = lineName(line.descriptions, this.namesLocale);
    return `${unservedDishText({ dishName, quantity: line.quantity })} · ${this.#money(line.gross)}`;
  }
  #extrasOf(view: GiveBackView, dish: GiveBackLine) {
    return view.lines
      .filter((extra) => extra.partOf === dish.id)
      .map(
        (extra) =>
          html`<p class="muted extra-of" data-extra-of=${dish.id}>${this.#dishText(extra)}</p>`,
      );
  }
  #lines(view: GiveBackView) {
    const label = (line: GiveBackLine) =>
      line.cancelled === null
        ? ""
        : t(
            positive(line.cancelled.owed) ? "give_back.cancelled_owed" : "give_back.cancelled_back",
          );
    return html`<fieldset>
      <legend data-which>${t("give_back.which")}</legend>
      <div class="lines">
        ${view.lines
          .filter((line) => line.partOf === null)
          .map((line) =>
            line.givenFree
              ? html`<div class="free" data-free=${line.id}>
                    <span>${this.#dishText(line)}</span>
                    <span class="muted">${t("give_back.given_free")}</span>
                  </div>
                  ${this.#extrasOf(view, line)}`
              : html`<wt-switch
                    name="dish"
                    data-line=${line.id}
                    .label=${this.#dishText(line)}
                    .description=${label(line)}
                    .checked=${this.draft.lineIds.includes(line.id)}
                    .disabled=${!line.available}
                    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                      event.stopPropagation();
                      this.#tick(line, event.detail.checked);
                    }}
                  ></wt-switch>
                  ${
                    !line.available && line.reason !== null
                      ? html`<p class="reason" data-line-reason=${line.id}>
                          ${this.#reasonText(line.reason)}
                        </p>`
                      : nothing
                  }
                  ${this.#extrasOf(view, line)}`,
          )}
      </div>
    </fieldset>`;
  }
  #ways(purpose: GiveBackPurpose) {
    return html`<fieldset data-how>
      <legend>${t("give_back.how")}</legend>
      ${this.#offered(purpose).map((way) => {
        const upTo = this.#money(purpose === "extra" ? way.extraLeft : way.moneyLeft);
        const words =
          way.way === "cash"
            ? t("give_back.way_cash").replace("{amount}", () => upTo)
            : t("give_back.way_card")
                .replace("{card}", () => (way.last4 === null ? "" : `···${way.last4}`))
                .replace("{amount}", () => upTo)
                .replace(/\s+/g, " ");
        return html`<label class="option"
            ><input
              type="radio"
              name="way"
              .value=${way.way}
              .checked=${way.way === this.draft.way}
              .disabled=${!usable(way)}
              @change=${(event: Event) => {
                event.stopPropagation();
                this.#chooseWay(way);
              }}
            /><span>${words}</span></label
          >${
            usable(way)
              ? nothing
              : html`<p class="reason" data-way-reason=${way.way}>
                  ${way.reason === null ? t("give_back.way_not_here") : this.#reasonText(way.reason)}
                </p>`
          }`;
      })}
    </fieldset>`;
  }
  #summary(answer: GiveBackPreview) {
    const way = this.#way()!;
    const total = moneyPlus(typedMoney(this.draft.amount)!, this.#extra());
    const now = this.#money(sumDecimals(answer.parts.map((part) => decimal(part.amount))));
    const card = way.last4 === null ? "" : `···${way.last4}`;
    const said =
      way.way === "cash"
        ? t("give_back.summary_cash")
        : t(answer.manual ? "give_back.summary_terminal" : "give_back.summary_card");
    return html`<div class="summary" data-summary>
      <p class="total" data-summary-total>${this.#money(total)}</p>
      <p data-summary-way>
        ${said
          .replace("{amount}", () => now)
          .replace("{card}", () => card)
          .replace(/\s+/g, " ")}
      </p>
      ${
        positive(answer.leftUnderWay)
          ? html`<p data-summary-rest>
              ${t("give_back.summary_rest").replace("{amount}", () =>
                this.#money(answer.leftUnderWay),
              )}
            </p>`
          : nothing
      }
      ${answer.needs.length > 0 ? html`<p class="muted" data-pin>${t("give_back.pin")}</p>` : nothing}
    </div>`;
  }
  #form(view: GiveBackView, purpose: GiveBackPurpose) {
    const own = this.attempted ? this.#errors() : new Map<Field, string>();
    const errors = new Map(own);
    const refusal = this.#refusal();
    const onAmount = refusal !== null && AMOUNT_REFUSALS.has(refusal.code);
    if (refusal !== null && onAmount)
      errors.set("amount", this.#refusalText(refusal, "give_back.preview_failed"));
    const answer = this.#answer();
    const way = this.#way();
    const amount = typedMoney(this.draft.amount);
    const total =
      amount !== null && !this.#errors().has("amount") ? moneyPlus(amount, this.#extra()) : null;
    return html`<p class="heading" data-purpose>${t(`give_back.${purpose}`)}</p>
      ${purpose === "dishes" ? this.#lines(view) : nothing}
      <wt-price-input
        name="amount"
        fixed-unit
        .locale=${currentLocale()}
        .label=${t(purpose === "extra" ? "give_back.extra_amount" : "give_back.amount")}
        .required=${true}
        .value=${live(this.draft.amount)}
        .error=${errors.get("amount") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.amountTyped = true;
          this.#set({ amount: event.detail.value });
        }}
      ></wt-price-input>
      ${
        purpose === "dishes"
          ? html`<p class="muted" data-amount-change>${t("give_back.amount_change")}</p>`
          : html`<p class="muted" data-up-to>
              ${t("give_back.up_to").replace("{amount}", () => this.#money(this.#limit()))}
            </p>`
      }
      ${
        purpose !== "extra" && way !== undefined && positive(way.extraLeft)
          ? html`<wt-switch
              name="extra"
              .label=${t("give_back.extra_too").replace("{amount}", () =>
                this.#money(way.extraLeft),
              )}
              .checked=${this.draft.extraOn}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
                event.stopPropagation();
                this.#set({ extraOn: event.detail.checked });
              }}
            ></wt-switch>`
          : nothing
      }
      ${reasonPicker({
        every: true,
        reasons: this.reasons,
        reasonsLoading: this.reasonsLoading,
        reasonId: this.draft.reasonId,
        note: this.draft.note,
        disabled: false,
        reasonError: errors.get("reason") ?? "",
        noteError: errors.get("note") ?? "",
        onReason: (reasonId) => this.#set({ reasonId, note: "" }),
        onNote: (note) => this.#set({ note }),
        onRetry: () => {
          void this.#loadReasons();
        },
      })}
      ${this.#ways(purpose)} ${answer === null ? nothing : this.#summary(answer)}
      <wt-form-actions
        .error=${
          own.size > 0
            ? t("form.fix_fields")
            : this.sendRefusal !== null
              ? this.#sendRefusalText(this.sendRefusal)
              : refusal !== null && !onAmount
                ? this.#refusalText(refusal, "give_back.preview_failed")
                : this.changedWhileChecking
                  ? t("give_back.changed_while_checking")
                  : ""
        }
        ><wt-button slot="cancel" variant="secondary" data-back @click=${() => this.#back()}
          >${t("action.back")}</wt-button
        >
        <wt-button
          .variant=${answer !== null && own.size === 0 && this.draft.reasonId !== "" ? "primary" : "secondary"}
          data-submit
          .loading=${this.confirming || this.sending}
          .disabled=${this.confirming || this.sending || !this.#chosen() || own.size > 0}
          @click=${() => void this.#confirm()}
          >${
            total === null
              ? t("give_back.submit_any")
              : t("give_back.submit").replace("{amount}", () => this.#money(total))
          }</wt-button
        >
      </wt-form-actions>`;
  }
  #stepBody(step: Step) {
    const close = () =>
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
    if (step.kind === "lost")
      return lostStep(step, this.sending, {
        close,
        resend: () =>
          void this.#send({
            send: (override) => this.session.resend(this.saleId, override),
            rights: [],
            needs: step.needs,
            way: step.way,
          }),
      });
    if (step.kind === "terminal")
      return terminalStep(
        step.ask,
        { ...step, sending: this.sending },
        {
          confirm: (confirmed) => {
            this.step = { ...step, confirmed };
          },
          back: () => {
            this.step = null;
          },
          record: () => void this.#record(step),
        },
      );
    const way = this.view!.ways.find((row) => row.way === step.way);
    const underWay = this.#underWayOf(step);
    return doneStep(
      step,
      way,
      this.sending,
      { close, checkAgain: () => void this.#checkAgain(step) },
      underWay === null ? undefined : this.#underWay(underWay),
    );
  }
  /** The correction a give-back left open, unless a card refund it waits for comes first. */
  #underWayOf(step: Step | null): InvoiceCorrectionView | null {
    if (step === null) return this.view?.underWay ?? null;
    return step.kind === "done" && !waitsForCard(step.outcome) ? step.outcome.underWay : null;
  }
  #underWay(correction: InvoiceCorrectionView) {
    return html`<till-give-back-under-way
      .api=${this.api}
      .saleId=${this.saleId}
      .correction=${correction}
      .corrections=${this.corrections}
      .refunds=${this.refunds}
      .capabilities=${this.capabilities}
      .close=${() => void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
    ></till-give-back-under-way>`;
  }
  #body() {
    if (this.step !== null && (this.view !== null || this.step.kind === "lost"))
      return this.#stepBody(this.step);
    const underWay = this.#underWayOf(null);
    if (underWay !== null) return this.#underWay(underWay);
    if (this.view !== null)
      return this.purpose === null ? this.#choices(this.view) : this.#form(this.view, this.purpose);
    if (this.loadRefusal === null)
      return html`<p class="muted" data-loading role="status">${t("give_back.loading")}</p>`;
    return html`<wt-form-actions
      .error=${this.#refusalText(this.loadRefusal, "give_back.read_failed")}
      >${this.#cancelButton()}${
        this.loadRefusal.code === "network"
          ? html`<wt-button variant="primary" data-reload @click=${() => void this.#load()}
              >${t("find_page.retry")}</wt-button
            >`
          : nothing
      }</wt-form-actions
    >`;
  }
  override render() {
    return html`<wt-dialog
        ${trackDialog()}
        .open=${this.active}
        .heading=${t(this.#underWayOf(this.step) === null ? "give_back.title" : "give_back.under_way")}
        .beforeClose=${this.#scope ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => this.#closed(event)}
      >
        <div
          class="body"
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-submit]"))}
        >
          <p class="muted help-anchor">
            ${this.invoiceNumber}${helpBadge("help.give_money_back", t("give_back.title"), {
              guide: "table-service.correct-invoice",
            })}
          </p>
          ${this.#body()}
        </div> </wt-dialog
      >${
        this.approvers === null
          ? nothing
          : html`<till-supervisor-override-dialog
              .authorizers=${this.approvers}
              .error=${this.pinError}
              @override-cancel=${(event: Event) => {
                event.stopPropagation();
                if (this.sending) return;
                this.approvers = null;
                this.#approval = undefined;
                // A first send refused for its PIN wrote nothing, so cancelling forgets it.
                try {
                  this.session.abandon(this.saleId);
                } catch {
                  // The next press reads the storage again and says if it cannot.
                }
              }}
              @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) => {
                event.stopPropagation();
                const approval = this.#approval;
                if (approval !== undefined && !this.sending)
                  void this.#send(approval, event.detail);
              }}
            ></till-supervisor-override-dialog>`
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-give-back-dialog": TillGiveBackDialog;
  }
}
