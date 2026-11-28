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
import { giveBackDialogStyles } from "./give-back-styles.js";
import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import { currentLocale, t } from "../i18n/t.js";
import type { TillApi } from "../api/client.js";
import type { AdjustmentReason } from "../api/payments-api.js";
import type { StaffMember } from "../api/device-session-api.js";
import type {
  GiveBackAsk,
  GiveBackLine,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackPurpose,
  GiveBackRequest,
  GiveBackRight,
  GiveBackView,
  GiveBackWaitReason,
  GiveBackWay,
} from "../api/give-back-types.js";
import { reasonPicker } from "./reason-picker.js";
import { choiceRow, dishLines, focusFirstControl, wayLines } from "./give-back-lines.js";
import {
  AMOUNT_REFUSALS,
  PURPOSES,
  blank,
  comparable,
  positive,
  startOf,
  usable,
  type Draft,
  type Field,
  type GiveBackFill,
} from "./give-back-draft.js";
import type { StringKey } from "../i18n/strings.js";
import { REASON_MAX, moneyPlus, refusalOf, typedMoney } from "../state/bill-payment.js";
import type { GiveBackSession } from "../state/give-back.js";
import type { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import type { InvoiceCorrectionView } from "../api/invoice-correction-types.js";
import type { TenderRefundSession } from "../state/tender-refund.js";
import {
  chosenDelivery,
  correctiveLine,
  correctiveRefusal,
  withCorrective,
} from "./corrective-choice.js";
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
  checkReceipt,
  checkRefusalText,
  doneStep,
  holdingReload,
  lostAfter,
  lostFor,
  lostStep,
  readApprovers,
  recoveryLinkOf,
  recoveryText,
  refusalWords,
  resendRefused,
  restOutcome,
  sendRefusalOf,
  signInEnded,
  stillStarting,
  summaryOf,
  terminalStep,
  waitReasonText,
  waitsForCard,
  type Override,
  type Sending,
  type Step,
} from "./give-back-steps.js";

type Refusal = ReturnType<typeof refusalOf>;
export type GiveBackApi = GiveBackUnderWayApi &
  Pick<TillApi, "readGiveBack" | "previewGiveBack" | "listAdjustmentReasons" | "listApprovers">;
export type { GiveBackAsk, GiveBackFill };

@customElement("till-give-back-dialog")
export class TillGiveBackDialog extends LitElement {
  static override styles = [baseStyles, giveBackDialogStyles, helpAnchorStyles];
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
  @property({ type: Boolean }) fullInvoice = false;
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
  @state() private underWayBusy = false;
  @state() private underWayHeld = false;
  @state() private sendRefusal: Refusal | null = null;
  /** What the last Check again on the choices found. */
  @state() private pendingStatus = "";
  @state() private approvers: StaffMember[] | null = null;
  @state() private pinError: ApproverRefusal | null = null;
  /** The press waiting for an approver, from the read of who may approve. */
  @state() private approval?: Sending;
  #previewRequest = 0;
  #lastStep = "";
  #lastHeld = false;
  #filled = false;
  /** The dishes the window opened ticked; the cancel's ids go only with exactly these. */
  #filledLines: string[] = [];
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.#writing() &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  /** Whether the window is still on the page and not closed: once it is not, it sends no further
   * write. A write already sent still reaches its outcome. */
  #open(): boolean {
    return this.isConnected && this.active;
  }
  #lost() {
    return this.step?.kind === "lost" ? this.step : null;
  }
  /** A write in flight keeps the window open until its answer can be shown. */
  #writing(): boolean {
    return this.sending || this.underWayBusy;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#restore();
    void this.#load();
    void this.#loadReasons();
    const { scope, coordinator } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value, lineIds: [...value.lineIds] }),
      equal: (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b)),
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
  /** Whether the window holds something staff must read or finish, so a full-disk screen waits:
   * a press out or waiting for its approver, its refusal, lost answer or outcome, or the same of
   * a step of the under-way view or of Check again. */
  #held(): boolean {
    return (
      this.sending ||
      this.pendingStatus !== "" ||
      this.sendRefusal !== null ||
      this.approval !== undefined ||
      this.step?.kind === "lost" ||
      this.step?.kind === "done" ||
      this.underWayHeld
    );
  }
  override updated(): void {
    const held = this.#held();
    if (held !== this.#lastHeld) {
      this.#lastHeld = held;
      this.dispatchEvent(
        new CustomEvent("give-back-held", { detail: { held }, bubbles: true, composed: true }),
      );
    }
    const step =
      this.step?.kind === "lost" ? "lost" : this.view === null ? "" : (this.purpose ?? "choice");
    if (step === this.#lastStep) return;
    this.#lastStep = step;
    void focusFirstControl(this.shadowRoot!);
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
  #money(value: string): string {
    return formatMoney(value, currentLocale());
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
    this.pendingStatus = "";
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
    if (!("reasonId" in change) && !("note" in change) && !("corrective" in change))
      void this.#preview();
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
    return refusalWords(refusal, this.fullInvoice);
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
      const pressed = JSON.stringify(comparable(this.draft));
      this.confirming = true;
      await this.#preview();
      this.confirming = false;
      if (!this.#open()) return;
      if (JSON.stringify(comparable(this.draft)) !== pressed) {
        this.changedWhileChecking = true;
        return;
      }
    }
    const answer = this.#answer();
    if (answer === null) return;
    const request = this.#request()!;
    const reason = this.reasons!.find((row) => row.id === this.draft.reasonId)!;
    const ask: GiveBackAsk = {
      request: withCorrective(request, answer.corrective, this.draft.corrective),
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
  #pressing(
    send: (override?: Override) => Promise<GiveBackOutcome>,
    way: string,
    needs: GiveBackRight[],
    rights = needs,
  ): Sending {
    return {
      send: async (override) => {
        const outcome = await send(override);
        this.#scope?.commit(this.draft);
        return {
          step: stillStarting(outcome)
            ? lostAfter({ way, needs }, this.#saved()?.sent, this.#lost()?.ids)
            : { kind: "done", outcome, way, notice: null },
        };
      },
      rights,
      needs,
      way,
    };
  }
  #submitting(ask: GiveBackAsk, needs: GiveBackRight[]): Sending {
    return this.#pressing(
      (override) => this.session.submit(this.saleId, ask, override, needs),
      ask.request.way,
      needs,
    );
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
    this.approval = sending;
    try {
      const approvers = await readApprovers(this.api, sending.rights);
      if (!this.#open()) return;
      this.approvers = approvers;
      this.pinError = null;
    } catch {
      this.#refused({ code: "approvers" }, sending.check);
    }
  }
  async #send(sending: Sending, override?: Override): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    this.pinError = null;
    let next: Sending | undefined;
    try {
      const sent = await holdingReload(this, () => sending.send(override));
      this.approvers = null;
      this.approval = undefined;
      this.step = sent.step;
      next = sent.next;
    } catch (error) {
      this.#sendFailed(sending, error, override);
    } finally {
      this.sending = false;
    }
    if (next !== undefined && this.#open()) await this.#authorized(next);
  }
  #sendFailed(sending: Sending, error: unknown, override?: Override): void {
    const refusal = sendRefusalOf(error);
    if (signInEnded(this, refusal.code)) return;
    if (
      !sending.check &&
      (refusal.code === "network" || (refusal.code === "busy" && this.#lost() !== null))
    ) {
      this.approvers = null;
      this.approval = undefined;
      this.step =
        refusal.code === "busy"
          ? { ...this.#lost()!, said: t("give_back.busy") }
          : lostAfter(sending, this.#saved()?.sent, this.#lost()?.ids);
    } else if (override !== undefined && APPROVER_PIN_REFUSALS.has(refusal.code))
      this.pinError = approverRefusal(error, override.personId);
    else if (override === undefined && NEEDS_APPROVER.has(refusal.code))
      void this.#askApprover({
        ...sending,
        rights: approverRights(sending.needs, refusal.permission),
      });
    else this.#refused(refusal, sending.check);
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
   * saved is the session's: while it does, a changed press is refused as locked. Where neither form
   * nor choice is drawn, a Send again's refusal stays on its own step. */
  #refused(refusal: Refusal, check = false): void {
    this.approvers = null;
    this.approval = undefined;
    const step = this.step;
    if (step?.kind === "done") {
      const notice = check ? checkRefusalText(refusal) : this.#sendRefusalText(refusal, true);
      this.step = { ...step, notice };
      return;
    }
    if (check) {
      this.pendingStatus = checkRefusalText(refusal);
      return;
    }
    if (step?.kind === "lost" && this.view?.underWay !== null) {
      this.step = resendRefused(step, refusal, this.#saved()?.sent);
      return;
    }
    this.step = null;
    this.sendRefusal = refusal;
    if (refusal.code === "give_back.changed") void this.#preview();
  }
  /** A fiscal conflict thrown at a press proves nothing went back (the server checks it before
   * writing, and a reader's later part answers it instead); after a part went back, `moved`, not. */
  #sendRefusalText(refusal: Refusal, moved = false): string {
    if (refusal.code === "approvers") return t("give_back.approvers_failed");
    if (refusal.code === "storage" || refusal.code === "busy")
      return t(`give_back.${refusal.code}`);
    const text = this.#refusalText(refusal, "give_back.preview_failed");
    return !moved && refusal.code === "sif.allocation_invalid" && recoveryText(refusal) !== null
      ? `${text} ${t("give_back.nothing_given")}`
      : text;
  }
  /** Check again on an outcome: asks about the card refund it waits for and, once that is through,
   * sends the rest. */
  #checkAgain(step: Extract<Step, { kind: "done" }>): Promise<void> {
    const { saleId, session } = this;
    return this.#send({
      send: async (override) => {
        const check = await session.checkRest(saleId, override, () => this.#open());
        const preview = check.state === "completed" ? check.preview : null;
        return {
          step: afterCheck(step, check),
          ...(preview !== null && {
            next: this.#pressing(
              (approver) => session.sendRest(saleId, preview, approver),
              step.way,
              preview.needs,
            ),
          }),
        };
      },
      rights: [],
      needs: [],
      way: step.way,
      check: true,
    });
  }
  /** Check again on the choices, while a card refund the box knows of waits. */
  #checkPending(): Promise<void> {
    this.pendingStatus = "";
    this.sendRefusal = null;
    return this.#send({
      send: async (override) => {
        const { view, status } = await checkReceipt(this, () => this.#open(), override);
        this.view = view ?? this.view;
        this.pendingStatus = status;
        return { step: null };
      },
      rights: [],
      needs: [],
      way: "",
      check: true,
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
    const hint =
      purpose === "extra"
        ? t("give_back.extra_hint").replace("{amount}", () => this.#money(this.#extraPaid()))
        : t(`give_back.${purpose}_hint`);
    return choiceRow(
      purpose,
      hint,
      this.view!.choices[purpose],
      () => this.#choose(purpose),
      this.#waitText,
    );
  }
  #choices(view: GiveBackView) {
    const shown = PURPOSES.filter((purpose) => purpose !== "extra" || positive(this.#extraPaid()));
    const apart = shown.some((purpose) => !view.choices[purpose].available);
    const waits = view.ways.some((way) => way.pending);
    return html`<p class="heading" data-what-for>${t("give_back.what_for")}</p>
      ${
        apart
          ? html`<div class="apart">
              ${shown.map((purpose) => html`<div>${this.#choiceRow(purpose)}</div>`)}
            </div>`
          : html`<div>${shown.map((purpose) => this.#choiceRow(purpose))}</div>`
      }
      ${this.pendingStatus ? html`<p data-pending-status role="status">${this.pendingStatus}</p>` : nothing}
      <wt-form-actions
        .error=${this.sendRefusal === null ? "" : this.#sendRefusalText(this.sendRefusal)}
        >${recoveryLinkOf(
          this.sendRefusal ??
            shown
              .map((purpose) => view.choices[purpose].reason)
              .find((r) => recoveryText(r ?? null)) ??
            null,
        )}${this.#cancelButton()}${
          waits
            ? html`<wt-button
                variant="primary"
                data-check-pending
                .loading=${this.sending}
                .disabled=${this.sending}
                @click=${() => void this.#checkPending()}
                >${t("give_back.check_again")}</wt-button
              >`
            : nothing
        }</wt-form-actions
      >`;
  }
  #form(view: GiveBackView, purpose: GiveBackPurpose) {
    const own = this.attempted ? this.#errors() : new Map<Field, string>();
    const errors = new Map(own);
    const refusal = this.#refusal();
    const sent = this.sendRefusal;
    const onAmount = (shown: Refusal | null) => shown !== null && AMOUNT_REFUSALS.has(shown.code);
    const onCorrective = correctiveRefusal(sent);
    if (onAmount(sent)) errors.set("amount", this.#sendRefusalText(sent!));
    else if (onAmount(refusal))
      errors.set("amount", this.#refusalText(refusal!, "give_back.preview_failed"));
    const answer = this.#answer();
    const way = this.#way();
    const amount = typedMoney(this.draft.amount);
    const total =
      amount !== null && !this.#errors().has("amount") ? moneyPlus(amount, this.#extra()) : null;
    return html`<p class="heading" data-purpose>${t(`give_back.${purpose}`)}</p>
      ${
        purpose === "dishes"
          ? dishLines(view, {
              namesLocale: this.namesLocale,
              ticked: this.draft.lineIds,
              onTick: (line, checked) => this.#tick(line, checked),
              reasonText: this.#waitText,
            })
          : nothing
      }
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
      ${wayLines(this.#offered(purpose), {
        purpose,
        chosen: this.draft.way,
        onChoose: (way) => this.#chooseWay(way),
        reasonText: this.#waitText,
      })}
      ${
        answer === null
          ? nothing
          : summaryOf(answer, way!, moneyPlus(typedMoney(this.draft.amount)!, this.#extra()))
      }${correctiveLine(answer?.corrective, this.draft.corrective, onCorrective, (delivery) =>
        this.#set({ corrective: chosenDelivery(answer?.corrective, delivery) ?? null }),
      )}
      <wt-form-actions
        .error=${[
          errors.size > 0 || onCorrective !== "" ? t("form.fix_fields") : "",
          sent !== null
            ? onAmount(sent) || onCorrective !== ""
              ? ""
              : this.#sendRefusalText(sent)
            : refusal !== null && !onAmount(refusal)
              ? this.#refusalText(refusal, "give_back.preview_failed")
              : this.changedWhileChecking
                ? t("give_back.changed_while_checking")
                : "",
        ]
          .filter(Boolean)
          .join(" ")}
        >${recoveryLinkOf(sent ?? refusal)}<wt-button
          slot="cancel"
          variant="secondary"
          data-back
          @click=${() => this.#back()}
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
          void this.#send(
            this.#pressing(
              (override) => this.session.resend(this.saleId, override, step.ids),
              step.way,
              step.needs,
              [],
            ),
          ),
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
    const way = this.view?.ways.find((row) => row.way === step.way);
    const underWay = this.#underWayOf(step);
    return doneStep(
      step,
      way,
      this.sending,
      { close, checkAgain: () => void this.#checkAgain(step) },
      underWay === null ? undefined : this.#underWay(underWay),
      this.fullInvoice,
    );
  }
  /** The correction a give-back left open, unless a card refund it waits for comes first. */
  #underWayOf(step: Step | null): InvoiceCorrectionView | null {
    if (step === null) return this.view?.underWay ?? null;
    return step.kind === "done" && !waitsForCard(step.outcome) ? step.outcome.underWay : null;
  }
  readonly #waitText = (reason: GiveBackWaitReason) => waitReasonText(reason, this.fullInvoice);
  #underWay(correction: InvoiceCorrectionView) {
    return html`<till-give-back-under-way
      .api=${this.api}
      .saleId=${this.saleId}
      .fullInvoice=${this.fullInvoice}
      .correction=${correction}
      .corrections=${this.corrections}
      .refunds=${this.refunds}
      .capabilities=${this.capabilities}
      .close=${() => void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
      @give-back-busy=${(event: CustomEvent<{ busy: boolean; held: boolean }>) => {
        event.stopPropagation();
        this.underWayBusy = event.detail.busy;
        this.underWayHeld = event.detail.held;
      }}
    ></till-give-back-under-way>`;
  }
  #body() {
    // A saved step needs no read: the read only names the card it went back to.
    if (this.step !== null) return this.#stepBody(this.step);
    const underWay = this.#underWayOf(null);
    if (underWay !== null) return this.#underWay(underWay);
    if (this.view !== null)
      return this.purpose === null ? this.#choices(this.view) : this.#form(this.view, this.purpose);
    if (this.loadRefusal === null)
      return html`<p class="muted" data-loading role="status">${t("give_back.loading")}</p>`;
    return html`<wt-form-actions
      .error=${this.#refusalText(this.loadRefusal, "give_back.read_failed")}
      >${recoveryLinkOf(this.loadRefusal)}${this.#cancelButton()}${
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
        .dismissible=${!this.#writing()}
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
              guide: "table-service.give-money-back",
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
                this.approval = undefined;
                // A first send refused for its PIN wrote nothing, so cancelling forgets it.
                try {
                  this.session.abandon(this.saleId);
                } catch {
                  // The next press reads the storage again and says if it cannot.
                }
              }}
              @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) => {
                event.stopPropagation();
                const approval = this.approval;
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
