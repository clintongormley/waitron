import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney, sumDecimals } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  formatDecimalInput,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import "./supervisor-override-dialog.js";
import type { OverrideConfirmDetail } from "./supervisor-override-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AdjustmentReason, StaffMember, TillApi } from "../api/client.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type {
  CorrectionSplitLine,
  InvoiceCorrectionLines,
  InvoiceCorrectionPreview,
  InvoiceCorrectionView,
} from "../api/invoice-correction-types.js";
import type { InvoiceCorrectionSession } from "../state/invoice-correction.js";
import { reasonPicker, voidReasons } from "./reason-picker.js";
import { lineName } from "../screens/till-ticket-view.js";
import { REASON_MAX, refusalOf, typedMoney } from "../state/bill-payment.js";

type PayRefusal = ReturnType<typeof refusalOf>;

export type InvoiceCorrectionApi = Pick<
  TillApi,
  | "readInvoiceCorrectionLines"
  | "getRefundableTenders"
  | "listAdjustmentReasons"
  | "previewInvoiceCorrection"
  | "getInvoiceCorrection"
  | "fileInvoiceCorrection"
  | "closeInvoiceCorrection"
  | "listApprovers"
>;

/** What `invoice-correction-card` carries: the correction a card refund joins, the most it may give
 * back, and the reason the correction was opened with when it is still offered. */
export interface InvoiceCorrectionCardLeg {
  correctionId: string;
  target: string;
  startReasonId: string;
}

type Override = { personId: string; pin: string };
const PIN_REFUSALS = new Set(["pin.invalid", "pin.throttled", "authorization.not_permitted"]);
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;
const least = (a: string, b: string) => (compareDecimal(decimal(a), decimal(b)) < 0 ? a : b);
const openCorrectionOf = (error: unknown): string | null => {
  const refused = error as { code?: unknown; correctionId?: unknown } | null;
  return refused?.code === "invoice_correction.already_open" &&
    typeof refused.correctionId === "string"
    ? refused.correctionId
    : null;
};

/** What `invoice-correction-confirm` carries: the amount and dishes as previewed, and the split
 * the preview answered for them. */
export interface InvoiceCorrectionAsk {
  gross: string;
  lineIds?: string[];
  reasonId: string;
  note: string | null;
  expectedSplit: CorrectionSplitLine[];
}

type Draft = { gross: string; lineIds: string[]; reasonId: string; note: string };
type Field = "gross" | "lines" | "reason" | "note";
const blank = (): Draft => ({ gross: "", lineIds: [], reasonId: "", note: "" });
const AMOUNT_REFUSALS = new Set([
  "sale.correction_amount_invalid",
  "invoice_correction.money_short",
]);

@customElement("till-invoice-correction-dialog")
export class TillInvoiceCorrectionDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      p,
      ul {
        overflow-wrap: anywhere;
        margin: 0;
      }
      ul {
        padding-inline-start: var(--wt-space-4);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }
      legend {
        font-weight: var(--wt-font-weight-bold);
        margin-bottom: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .choice {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
    `,
  ];
  @property({ attribute: false }) api!: InvoiceCorrectionApi;
  @property() saleId = "";
  @property() invoiceNumber = "";
  @property() namesLocale = "";
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) session?: InvoiceCorrectionSession;
  /** An open correction to carry on with, instead of starting one. */
  @property() correctionId = "";
  /** Raised by the app when a card refund this window started has ended, to read the correction
   * again. */
  @property({ type: Number }) legsRevision = 0;
  @state() private correction: InvoiceCorrectionView | null = null;
  @state() private tenders: RefundableTender[] = [];
  @state() private sendRefusal: PayRefusal | null = null;
  @state() private cashGiven: string | null = null;
  @state() private approvers: StaffMember[] | null = null;
  @state() private pinError: string | null = null;
  #override?: Override;
  #retry?: () => Promise<void>;
  @state() private loaded: (InvoiceCorrectionLines & { tenders: RefundableTender[] }) | null = null;
  @state() private loadRefusal: PayRefusal | null = null;
  @state() private reasons: AdjustmentReason[] | null = null;
  @state() private reasonsLoading = false;
  @state() private draft: Draft = blank();
  @state() private preview:
    | { key: string; answer: InvoiceCorrectionPreview }
    | { key: string; refusal: PayRefusal }
    | null = null;
  @state() private active = true;
  @state() private attempted = false;
  @state() private confirming = false;
  #previewRequest = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.loaded === null) void this.#load();
    if (this.reasons === null) void this.#loadReasons();
    if (this.#scope) return;
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
    scope.commit(blank());
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  async #load(): Promise<void> {
    this.loadRefusal = null;
    try {
      if (this.correctionId !== "") {
        await this.#loadCorrection(this.correctionId);
        return;
      }
      const [lines, tenders] = await Promise.all([
        this.api.readInvoiceCorrectionLines(this.saleId, {}),
        this.api.getRefundableTenders(this.saleId, {}),
      ]);
      this.loaded = { ...lines, tenders };
    } catch (error) {
      const open = openCorrectionOf(error);
      if (open === null) this.loadRefusal = refusalOf(error);
      else {
        this.correctionId = open;
        await this.#load();
      }
    }
  }
  async #loadCorrection(correctionId: string): Promise<void> {
    const [correction, tenders] = await Promise.all([
      this.api.getInvoiceCorrection(correctionId, {}),
      this.api.getRefundableTenders(this.saleId, {}),
    ]);
    this.tenders = tenders;
    this.#show(correction);
  }
  #show(correction: InvoiceCorrectionView): void {
    this.correction = correction;
    this.correctionId = correction.id;
    this.#scope?.commit(this.draft);
  }
  override updated(changed: PropertyValues<this>): void {
    if (changed.has("legsRevision") && this.correction?.state === "open" && !this.busy)
      void this.#run(() => this.#loadCorrection(this.correction!.id));
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
      gross: typedMoney(value.gross) ?? value.gross,
      lineIds: [...value.lineIds].sort(),
      reasonId: value.reasonId,
      note: value.note.trim(),
    };
  }
  #key(): string | null {
    const gross = typedMoney(this.draft.gross);
    if (gross === null || compareDecimal(gross, decimal("0")) <= 0) return null;
    return JSON.stringify({ gross, lineIds: [...this.draft.lineIds].sort() });
  }
  #set(change: Partial<Draft>): void {
    if (!this.active || this.busy) return;
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
    if ("gross" in change || "lineIds" in change) void this.#preview();
  }
  async #preview(): Promise<void> {
    const key = this.#key();
    const request = ++this.#previewRequest;
    if (key === null) {
      this.preview = null;
      return;
    }
    const { gross, lineIds } = JSON.parse(key) as { gross: string; lineIds: string[] };
    let next: NonNullable<typeof this.preview>;
    try {
      const answer = await this.api.previewInvoiceCorrection(this.saleId, {
        gross,
        ...(lineIds.length === 0 ? {} : { lineIds }),
      });
      next = { key, answer };
    } catch (error) {
      next = { key, refusal: refusalOf(error) };
    }
    if (request === this.#previewRequest) this.preview = next;
  }
  #answer(): InvoiceCorrectionPreview | null {
    const shown = this.preview;
    return shown !== null && "answer" in shown && shown.key === this.#key() ? shown.answer : null;
  }
  #refusal(): PayRefusal | null {
    const shown = this.preview;
    return shown !== null && "refusal" in shown && shown.key === this.#key() ? shown.refusal : null;
  }
  #reason(): AdjustmentReason | undefined {
    return voidReasons(this.reasons).find((reason) => reason.id === this.draft.reasonId);
  }
  #money(value: string): string {
    return formatMoney(value, currentLocale());
  }
  #errors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    if (this.#key() === null) errors.set("gross", t("invoice_correction.gross_invalid"));
    const reason = this.#reason();
    if (!reason) errors.set("reason", t("adjust.reason_required"));
    else if (reason.noteRequired && this.draft.note.trim() === "")
      errors.set("note", t("adjust.note_required"));
    else if (reason.noteRequired && this.draft.note.trim().length > REASON_MAX)
      errors.set("note", t("bill_refund.reason_long"));
    return errors;
  }
  #refusalText(refusal: PayRefusal): string {
    if (refusal.code === "network") return t("invoice_correction.read_failed");
    return codeMessage(refusal.code, currentLocale(), refusal);
  }
  async #confirm(): Promise<void> {
    if (!this.active || this.busy || this.confirming) return;
    this.attempted = true;
    if (this.#errors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (this.#answer() === null) {
      this.confirming = true;
      await this.#preview();
      this.confirming = false;
      if (!this.isConnected || !this.active || this.busy) return;
    }
    const answer = this.#answer();
    if (answer === null || this.#errors().size > 0) return;
    const reason = this.#reason()!;
    const ask: InvoiceCorrectionAsk = {
      gross: answer.gross,
      ...(this.draft.lineIds.length === 0 ? {} : { lineIds: [...this.draft.lineIds] }),
      reasonId: reason.id,
      note: reason.noteRequired ? this.draft.note.trim() : null,
      expectedSplit: answer.vatBreakdown,
    };
    this.dispatchEvent(
      new CustomEvent("invoice-correction-confirm", { detail: ask, bubbles: true, composed: true }),
    );
    if (this.session) void this.#run(() => this.#open(ask));
  }
  /** Opens the correction, resending the saved request when an earlier answer was lost; on a bill
   * paid all in cash, gives the whole amount back in cash with the same PIN. */
  async #open(ask: InvoiceCorrectionAsk): Promise<void> {
    if (this.correction === null) {
      // The journal recognises its own saved request, submission id included, as the same ask.
      const resend = this.session!.savedOpen(this.saleId) ?? ask;
      const opening = await this.session!.open(this.saleId, resend, this.#override);
      this.tenders = this.loaded?.tenders ?? [];
      if (opening.opened === null) {
        await this.#loadCorrection(opening.correctionId);
        return;
      }
      this.#show(opening.opened.correction);
    }
    const correction = this.correction!;
    if (correction.state === "open" && this.#paying().every((row) => row.method === "cash"))
      await this.#giveCash(correction.left);
  }
  async #giveCash(amount: string): Promise<void> {
    const given = await this.session!.giveCash(this.correction!.id, { amount }, this.#override);
    this.cashGiven = amount;
    this.#show(given.correction);
    if (given.correction.state === "open")
      this.tenders = await this.api.getRefundableTenders(this.saleId, {}).catch(() => this.tenders);
  }
  async #end(kind: "file" | "close"): Promise<void> {
    const correction = this.correction!;
    const override = this.#override === undefined ? {} : { override: this.#override };
    this.#show(
      kind === "close"
        ? await this.api.closeInvoiceCorrection(correction.id, override)
        : await this.api.fileInvoiceCorrection(correction.id, {
            expectedSplit:
              correction.fileNow !== null && "vatBreakdown" in correction.fileNow
                ? correction.fileNow.vatBreakdown
                : [],
            ...override,
          }),
    );
  }
  /** Runs `step`, asking for a PIN when the person signed in may not, and running it again with
   * that PIN; the PIN lasts for that one step. */
  async #run(step: () => Promise<void>): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    this.busy = true;
    this.sendRefusal = null;
    try {
      await step();
      this.approvers = null;
      this.#override = undefined;
    } catch (error) {
      const refusal = refusalOf(error);
      if (this.approvers !== null && PIN_REFUSALS.has(refusal.code)) {
        this.pinError = refusal.code;
      } else if (refusal.code === "authorization.not_permitted") {
        this.#retry = step;
        this.#override = undefined;
        try {
          this.approvers = await this.api.listApprovers(
            refusal.permission === "sale.refund" ? "sale.refund" : "sale.rectify",
          );
          this.pinError = null;
        } catch (failure) {
          this.sendRefusal = refusalOf(failure);
        }
      } else {
        this.approvers = null;
        this.#override = undefined;
        this.sendRefusal = refusal;
        if (refusal.code === "invoice_correction.split_changed") {
          if (this.correction === null) void this.#preview();
          else
            await this.#loadCorrection(this.correction.id).catch(() => {
              // The refusal stays shown; Check again reads the correction once more.
            });
        }
      }
    } finally {
      this.busy = false;
    }
  }
  #signedIn(event: CustomEvent<OverrideConfirmDetail>): void {
    event.stopPropagation();
    if (this.approvers === null || this.busy || this.#retry === undefined) return;
    this.#override = { personId: event.detail.personId, pin: event.detail.pin };
    void this.#run(this.#retry);
  }
  /** The payments with money still to give back. */
  #paying(): RefundableTender[] {
    return this.tenders.filter((row) => positive(row.appliedRemaining));
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(
      new CustomEvent("invoice-correction-close", { bubbles: true, composed: true }),
    );
  }
  #lines(loaded: InvoiceCorrectionLines, error: string) {
    const picked = loaded.lines.find((line) => this.draft.lineIds.includes(line.id));
    return html`<fieldset>
      <legend>${t("invoice_correction.dishes")}</legend>
      ${loaded.lines.map(
        (line) =>
          html`<wt-switch
            name="dish"
            data-line=${line.id}
            .label=${[
              lineName(line.descriptions, this.namesLocale),
              this.#money(line.gross),
              t("invoice_correction.left").replace("{amount}", () => this.#money(line.left)),
            ].join(" · ")}
            .checked=${this.draft.lineIds.includes(line.id)}
            .disabled=${
              this.busy ||
              compareDecimal(decimal(line.left), decimal("0")) <= 0 ||
              (picked !== undefined && picked.rate !== line.rate)
            }
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              const others = this.draft.lineIds.filter((id) => id !== line.id);
              this.#set({ lineIds: event.detail.checked ? [...others, line.id] : others });
            }}
          ></wt-switch>`,
      )}
      ${error ? html`<p class="error" data-lines-error role="alert">${error}</p>` : nothing}
    </fieldset>`;
  }
  #form(loaded: NonNullable<typeof this.loaded>) {
    const own = this.attempted ? this.#errors() : new Map<Field, string>();
    const errors = new Map(own);
    const refusal = this.#refusal();
    const field: Field | null =
      refusal === null
        ? null
        : AMOUNT_REFUSALS.has(refusal.code)
          ? "gross"
          : refusal.code === "sale.correction_scope_invalid"
            ? "lines"
            : null;
    if (refusal !== null && field !== null) errors.set(field, this.#refusalText(refusal));
    const answer = this.#answer();
    const gross = typedMoney(this.draft.gross);
    return html`${this.#lines(loaded, errors.get("lines") ?? "")}
      <wt-price-input
        name="gross"
        decimal-locale=${currentLocale()}
        unit="€"
        .fixedUnit=${true}
        .label=${t("invoice_correction.gross")}
        .required=${true}
        .value=${live(this.draft.gross)}
        .disabled=${this.busy}
        .error=${errors.get("gross") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.#set({ gross: event.detail.value });
        }}
      ></wt-price-input>
      ${answer?.vatBreakdown.map(
        (line) =>
          html`<p data-split>
            ${t("invoice_correction.split")
              .replace("{rate}", () =>
                formatDecimalInput(String(Number(line.rate)), currentLocale()),
              )
              .replace("{base}", () => this.#money(line.base))
              .replace("{tax}", () => this.#money(line.tax))}
          </p>`,
      )}
      <p data-refundable>
        ${t("invoice_correction.refundable").replace("{amount}", () =>
          this.#money(loaded.moneyRefundable),
        )}
      </p>
      <ul>
        ${loaded.tenders
          .filter((row) => compareDecimal(decimal(row.appliedRemaining), decimal("0")) > 0)
          .map(
            (row) =>
              html`<li data-payment>
                ${t(row.method === "cash" ? "tender.cash" : "tender.card")}${
                  row.last4 ? ` · ${row.last4}` : ""
                }
                · ${this.#money(row.appliedRemaining)}
              </li>`,
          )}
      </ul>
      ${reasonPicker({
        reasons: this.reasons,
        reasonsLoading: this.reasonsLoading,
        reasonId: this.draft.reasonId,
        note: this.draft.note,
        disabled: this.busy,
        reasonError: errors.get("reason") ?? "",
        noteError: errors.get("note") ?? "",
        onReason: (reasonId) => this.#set({ reasonId, note: "" }),
        onNote: (note) => this.#set({ note }),
        onRetry: () => {
          if (this.active && !this.busy) void this.#loadReasons();
        },
      })}
      <wt-form-actions
        .error=${
          own.size > 0
            ? t("form.fix_fields")
            : refusal !== null && field === null
              ? this.#refusalText(refusal)
              : this.sendRefusal !== null
                ? this.#sendText(this.sendRefusal)
                : ""
        }
        >${this.#cancelButton()}
        <wt-button
          .variant=${answer !== null && this.#reason() ? "primary" : "secondary"}
          data-confirm
          .loading=${this.busy || this.confirming}
          .disabled=${this.busy || this.confirming || own.size > 0}
          @click=${() => void this.#confirm()}
          >${
            gross !== null && this.#key() !== null
              ? t("invoice_correction.confirm").replace("{amount}", () => this.#money(gross))
              : t("invoice_correction.confirm_any")
          }</wt-button
        >
      </wt-form-actions>`;
  }
  #cancelButton() {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-close
      .disabled=${this.busy}
      @click=${() => {
        if (this.active && !this.busy)
          void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      }}
      >${t("action.cancel")}</wt-button
    >`;
  }
  #choice(name: string, label: string, hint: string, run: () => void, variant = "secondary") {
    return html`<div class="choice">
      <wt-button
        variant=${variant}
        data-choice=${name}
        .disabled=${this.busy}
        @click=${() => {
          if (this.active && !this.busy) run();
        }}
        >${label}</wt-button
      >
      ${hint ? html`<p class="muted" data-hint=${name}>${hint}</p>` : nothing}
    </div>`;
  }
  #ended(correction: InvoiceCorrectionView) {
    const back = this.#money(correction.moneyBack);
    const said = t(
      `invoice_correction.${correction.state as "filed" | "closed" | "discarded"}`,
    ).replace("{amount}", () => back);
    const cash =
      this.cashGiven === null
        ? ""
        : ` ${t("invoice_correction.cash_given").replace("{amount}", () => this.#money(this.cashGiven!))}`;
    return html`<p data-outcome role="status">${said}${cash}</p>
      <wt-form-actions
        ><wt-button
          variant="primary"
          data-done
          @click=${() =>
            void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
          >${t("invoice_correction.close")}</wt-button
        ></wt-form-actions
      >`;
  }
  #view(correction: InvoiceCorrectionView) {
    if (correction.state !== "open") return this.#ended(correction);
    const left = correction.left;
    const cashLeft = sumDecimals(
      this.#paying()
        .filter((row) => row.method === "cash")
        .map((row) => decimal(row.appliedRemaining)),
    );
    const cards = this.#paying().filter(
      (row) => row.method === "card" && row.pendingRefundId === null,
    );
    const back = this.#money(correction.moneyBack);
    const fileNow = correction.fileNow;
    const startReasonId =
      voidReasons(this.reasons).find((reason) => reason.name === correction.reason)?.id ?? "";
    const nothingBack = !positive(correction.moneyBack) && !positive(correction.pending);
    return html`<p data-back>
        ${t("invoice_correction.back")
          .replace("{back}", () => back)
          .replace("{gross}", () => this.#money(correction.gross))}
      </p>
      <p data-left>
        ${t("invoice_correction.left_back").replace("{amount}", () => this.#money(left))}
      </p>
      ${
        this.cashGiven === null
          ? nothing
          : html`<p data-cash-given role="status">
              ${t("invoice_correction.cash_given").replace("{amount}", () =>
                this.#money(this.cashGiven!),
              )}
            </p>`
      }
      ${
        positive(correction.pending)
          ? html`<p data-pending>
                ${t("invoice_correction.pending").replace("{amount}", () =>
                  this.#money(correction.pending),
                )}
              </p>
              ${this.#choice("check", t("invoice_correction.check_again"), "", () => {
                void this.#run(() => this.#loadCorrection(correction.id));
              })}`
          : nothing
      }
      ${
        positive(left) && positive(cashLeft)
          ? this.#choice(
              "cash",
              t("invoice_correction.give_cash").replace("{amount}", () =>
                this.#money(least(left, cashLeft)),
              ),
              t("invoice_correction.give_cash_hint"),
              () => void this.#run(() => this.#giveCash(least(left, cashLeft))),
            )
          : nothing
      }
      ${
        positive(left)
          ? cards.map((row) =>
              this.#choice(
                "card",
                `${t("invoice_correction.refund_card")}${row.last4 ? ` · ${row.last4}` : ""}`,
                t("invoice_correction.refund_card_hint"),
                () =>
                  this.dispatchEvent(
                    new CustomEvent<InvoiceCorrectionCardLeg>("invoice-correction-card", {
                      detail: {
                        correctionId: correction.id,
                        target: least(left, row.appliedRemaining),
                        startReasonId,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  ),
              ),
            )
          : nothing
      }
      ${
        fileNow !== null && "vatBreakdown" in fileNow
          ? this.#choice(
              "file",
              t(positive(left) ? "invoice_correction.finish_now" : "invoice_correction.record"),
              t(
                positive(left)
                  ? "invoice_correction.finish_now_hint"
                  : "invoice_correction.record_hint",
              ).replace("{amount}", () => back),
              () => void this.#run(() => this.#end("file")),
              "primary",
            )
          : nothing
      }
      ${
        fileNow !== null && "refusal" in fileNow
          ? html`<p data-file-refusal>${codeMessage(fileNow.refusal)}</p>
              ${
                fileNow.closable
                  ? this.#choice(
                      "close-keeping",
                      t("invoice_correction.close_keeping"),
                      t("invoice_correction.close_keeping_hint"),
                      () => void this.#run(() => this.#end("close")),
                    )
                  : nothing
              }`
          : nothing
      }
      ${
        nothingBack
          ? this.#choice(
              "discard",
              t("invoice_correction.discard"),
              t("invoice_correction.discard_hint"),
              () => void this.#run(() => this.#end("close")),
            )
          : nothing
      }
      <wt-form-actions .error=${this.sendRefusal === null ? "" : this.#sendText(this.sendRefusal)}
        >${this.#cancelButton()}</wt-form-actions
      >`;
  }
  #sendText(refusal: PayRefusal): string {
    return refusal.code === "network"
      ? t("invoice_correction.unknown")
      : codeMessage(refusal.code, currentLocale(), refusal);
  }
  #body() {
    if (this.correction !== null) return this.#view(this.correction);
    if (this.loaded !== null) return this.#form(this.loaded);
    if (this.loadRefusal === null)
      return html`<p class="muted" data-loading role="status">
        ${t("invoice_correction.loading")}
      </p>`;
    return html`<wt-form-actions .error=${this.#refusalText(this.loadRefusal)}
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
        .heading=${t("invoice_correction.title")}
        .dismissible=${!this.busy}
        .beforeClose=${this.#scope ? this.#beforeClose : undefined}
        @wt-close=${(event: Event) => this.#closed(event)}
      >
        <div
          class="body"
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-confirm]"))}
        >
          <p>${this.invoiceNumber}</p>
          <p class="muted">${t("invoice_correction.explain")}</p>
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
                if (this.busy) return;
                this.approvers = null;
                this.#retry = undefined;
              }}
              @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) =>
                this.#signedIn(event)}
            ></till-supervisor-override-dialog>`
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-invoice-correction-dialog": TillInvoiceCorrectionDialog;
  }
}
