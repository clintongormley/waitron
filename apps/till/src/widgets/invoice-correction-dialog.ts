import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
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
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { AdjustmentReason, TillApi } from "../api/client.js";
import type { RefundableTender } from "../api/tender-refund-types.js";
import type {
  CorrectionSplitLine,
  InvoiceCorrectionLines,
  InvoiceCorrectionPreview,
} from "../api/invoice-correction-types.js";
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
>;

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
    `,
  ];
  @property({ attribute: false }) api!: InvoiceCorrectionApi;
  @property() saleId = "";
  @property() invoiceNumber = "";
  @property() namesLocale = "";
  @property({ type: Boolean }) busy = false;
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
      const [lines, tenders] = await Promise.all([
        this.api.readInvoiceCorrectionLines(this.saleId, {}),
        this.api.getRefundableTenders(this.saleId, {}),
      ]);
      this.loaded = { ...lines, tenders };
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
    if (!this.active || this.busy) return;
    this.attempted = true;
    if (this.#errors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const answer = this.#answer();
    if (answer === null) return;
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
              .replace("{rate}", () => String(Number(line.rate)))
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
        .error=${[
          own.size > 0 ? t("form.fix_fields") : "",
          refusal !== null && field === null ? this.#refusalText(refusal) : "",
        ]
          .filter(Boolean)
          .join(" ")}
        >${this.#cancelButton()}
        <wt-button
          .variant=${answer !== null && this.#reason() ? "primary" : "secondary"}
          data-confirm
          .loading=${this.busy}
          .disabled=${this.busy || own.size > 0}
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
  #body() {
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
      </div>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-invoice-correction-dialog": TillInvoiceCorrectionDialog;
  }
}
