import { LitElement, css, html, nothing } from "lit";
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
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AdjustmentReason, TillApi } from "../api/client.js";
import type {
  GiveBackLine,
  GiveBackPreview,
  GiveBackPurpose,
  GiveBackRequest,
  GiveBackView,
  GiveBackWaitReason,
  GiveBackWay,
} from "../api/give-back-types.js";
import { reasonPicker } from "./reason-picker.js";
import { lineName } from "../screens/till-ticket-view.js";
import { unservedDishText } from "./dish-format.js";
import { REASON_MAX, moneyPlus, refusalOf, typedMoney } from "../state/bill-payment.js";

type Refusal = ReturnType<typeof refusalOf>;

export type GiveBackApi = Pick<
  TillApi,
  "readGiveBack" | "previewGiveBack" | "listAdjustmentReasons"
>;

/** What `give-back-submit` carries: the request as previewed, its reason, and the parts the
 * preview answered, which the write refuses to change without saying so. */
export interface GiveBackAsk {
  request: GiveBackRequest;
  reasonId: string;
  note: string | null;
  expected: GiveBackPreview["parts"];
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
const positive = (value: string) => compareDecimal(decimal(value), decimal("0")) > 0;
/** What ticking `line` starts the amount at: a cancel's money still owed, otherwise what is left. */
const startOf = (line: GiveBackLine) =>
  line.cancelled !== null && positive(line.cancelled.owed) ? line.cancelled.owed : line.left;

@customElement("till-give-back-dialog")
export class TillGiveBackDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      p {
        overflow-wrap: anywhere;
        margin: 0;
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }
      legend,
      .heading {
        font-weight: var(--wt-font-weight-bold);
        margin-bottom: var(--wt-space-2);
      }
      .muted,
      .reason {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .apart {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      .unavailable {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
        color: var(--wt-color-text-muted);
      }
      .unavailable .title {
        font-weight: var(--wt-font-weight-bold);
      }
      .unavailable .hint {
        font-size: var(--wt-font-size-sm);
      }
      .lines {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-2);
      }
      .extra-of {
        padding-inline-start: var(--wt-space-6);
      }
      .free {
        display: flex;
        flex-direction: column;
      }
      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }
      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
      }
      .total {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];
  @property({ attribute: false }) api!: GiveBackApi;
  @property() saleId = "";
  @property() invoiceNumber = "";
  @property() namesLocale = "";
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
  #previewRequest = 0;
  #lastStep = "";
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
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
    return codeMessage(reason.code, currentLocale(), reason.params);
  }
  /** The payments this purpose can give back from: those holding money, or for the extra, an extra. */
  #offered(purpose: GiveBackPurpose): GiveBackWay[] {
    return this.view!.ways.filter((way) =>
      positive(purpose === "extra" ? way.extraLeft : way.moneyLeft),
    );
  }
  #way(): GiveBackWay | undefined {
    return this.view!.ways.find((way) => way.way === this.draft.way && way.reason === null);
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
  #choose(purpose: GiveBackPurpose): void {
    const way = this.#offered(purpose).find((row) => row.reason === null);
    this.purpose = purpose;
    this.amountTyped = false;
    this.attempted = false;
    this.changedWhileChecking = false;
    this.draft = {
      ...blank(),
      way: way?.way ?? "",
      amount: purpose === "extra" && way !== undefined ? way.extraLeft : "",
    };
    this.#scope?.commit(this.draft);
    void this.#preview();
  }
  #back(): void {
    this.purpose = null;
    this.draft = blank();
    this.preview = null;
    this.#previewRequest++;
    this.#scope?.commit(this.draft);
  }
  #set(change: Partial<Draft>): void {
    this.draft = { ...this.draft, ...change };
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
    };
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
  #refusalText(refusal: Refusal): string {
    if (refusal.code === "network") return t("give_back.read_failed");
    return codeMessage(refusal.code, currentLocale(), refusal);
  }
  async #confirm(): Promise<void> {
    this.attempted = true;
    this.changedWhileChecking = false;
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
    this.dispatchEvent(
      new CustomEvent("give-back-submit", { detail: ask, bubbles: true, composed: true }),
    );
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
      <wt-form-actions>${this.#cancelButton()}</wt-form-actions>`;
  }
  #dishText(line: GiveBackLine): string {
    const dishName = lineName(line.descriptions, this.namesLocale);
    return `${unservedDishText({ dishName, quantity: line.quantity })} · ${this.#money(line.gross)}`;
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
                </div>`
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
                  ${view.lines
                    .filter((extra) => extra.partOf === line.id)
                    .map(
                      (extra) =>
                        html`<p class="muted extra-of" data-extra-of=${line.id}>
                          ${this.#dishText(extra)}
                        </p>`,
                    )}`,
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
              .disabled=${way.reason !== null}
              @change=${(event: Event) => {
                event.stopPropagation();
                this.#chooseWay(way);
              }}
            /><span>${words}</span></label
          >${
            way.reason === null
              ? nothing
              : html`<p class="reason" data-way-reason=${way.way}>
                  ${this.#reasonText(way.reason)}
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
    if (refusal !== null && onAmount) errors.set("amount", this.#refusalText(refusal));
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
            : refusal !== null && !onAmount
              ? this.#refusalText(refusal)
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
          .loading=${this.confirming}
          .disabled=${this.confirming || !this.#chosen() || own.size > 0}
          @click=${() => void this.#confirm()}
          >${
            total === null
              ? t("give_back.submit_any")
              : t("give_back.submit").replace("{amount}", () => this.#money(total))
          }</wt-button
        >
      </wt-form-actions>`;
  }
  #body() {
    if (this.view !== null)
      return this.purpose === null ? this.#choices(this.view) : this.#form(this.view, this.purpose);
    if (this.loadRefusal === null)
      return html`<p class="muted" data-loading role="status">${t("give_back.loading")}</p>`;
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
      .heading=${t("give_back.title")}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div
        class="body"
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-submit]"))}
      >
        <p class="muted">${this.invoiceNumber}</p>
        ${this.#body()}
      </div>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-give-back-dialog": TillGiveBackDialog;
  }
}
