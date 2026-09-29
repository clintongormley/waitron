import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, selectStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-price-input.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { regimeName, vatKindName } from "../i18n/domain.js";
import type {
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLineInput,
  PurchaseInvoicePatch,
  PurchaseRegime,
  PurchaseVatKind,
} from "../api/client.js";

const REGIMES: readonly PurchaseRegime[] = ["general", "equivalence_surcharge"];
const VAT_KINDS: readonly PurchaseVatKind[] = ["ordinary", "capital"];

export interface UpdatePurchaseDetail {
  id: string;
  patch: PurchaseInvoicePatch;
}

interface LineDraft {
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

function blankLine(): LineDraft {
  return { rate: "", base: "", tax: "", kind: "ordinary" };
}

type HeaderField =
  | "supplierTaxId"
  | "supplierName"
  | "supplierInvoiceNumber"
  | "issuedOn"
  | "receivedOn"
  | "total"
  | "deductibleProportion"
  | "note";

/** Each header field's key in this form's errors: the `data-test` of the field that shows it. */
const HEADER_KEYS: Record<HeaderField, string> = {
  supplierTaxId: "supplier-tax-id",
  supplierName: "supplier-name",
  supplierInvoiceNumber: "supplier-invoice-number",
  issuedOn: "issued-on",
  receivedOn: "received-on",
  total: "total",
  deductibleProportion: "deductible-proportion",
  note: "note",
};

/** Keyed like the form's own errors — a field's `data-test`, or `lines` for the VAT breakdown —
 * plus `_form`, which is shown in the bottom message alone. */
export type PurchaseFormErrors = Record<string, string>;

/** A refused purchase write, keyed by this form's fields. A line's refusal names no line, so it
 * goes to the form. */
export function purchaseRefusalErrors(error: unknown): PurchaseFormErrors {
  const code = codeOf(error);
  const message = codeMessage(code);
  const params = (error as { params?: { field?: unknown; reason?: unknown } }).params ?? {};
  if (code === "management.request_invalid" && typeof params.field === "string") {
    const key = (HEADER_KEYS as Record<string, string>)[params.field];
    if (key !== undefined) return { [key]: message };
  }
  if (code === "purchase.invalid" && params.reason === "proportion_out_of_range")
    return { "deductible-proportion": message };
  if (code === "purchase.invalid" && params.reason === "no_lines") return { lines: message };
  return { _form: message };
}

/**
 * Accepts the literals `@waitron/shared`'s `decimal()` accepts, apart from the SIGN: `decimal()` also
 * accepts a leading minus, and this pattern does not. The op checks the proportion and each line's
 * base, tax and rate, so the header's gross total is the one amount nothing on the server screens
 * for sign.
 */
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * The `DECIMAL` test runs BEFORE the range test so an empty, whitespace or comma-decimal amount is
 * rejected here (`Number("")` and `Number("  ")` are both `0`, which would otherwise pass the range).
 */
function inRange(value: string, min: number, max: number): boolean {
  if (!DECIMAL.test(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * The form does NOT call the API and does NOT close itself on confirm — the screen closes it on a
 * successful write, so a rejected write leaves the entered values in place.
 */
@customElement("dashboard-purchase-form")
export class PurchaseForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .lines-title {
        margin: var(--wt-space-4) 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
        padding-bottom: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
      }
      .line-field {
        flex: 1;
        min-width: 5rem;
      }
      /* A money field's amount box never shrinks below its amount and sign, and the VAT type never
         below its longest name, so a narrow line wraps them rather than overlapping or cutting. */
      wt-price-input.line-field {
        min-width: min-content;
      }
      label.line-field {
        min-width: max-content;
      }
      .error {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];

  @property({ type: Boolean, reflect: true }) open = false;

  @property({ attribute: false }) invoice: PurchaseInvoice | null = null;

  @property({ type: Boolean }) busy = false;

  @property({ attribute: false }) fieldErrors: PurchaseFormErrors = {};

  @state() private supplierTaxId = "";
  @state() private supplierName = "";
  @state() private supplierInvoiceNumber = "";
  @state() private issuedOn = "";
  @state() private receivedOn = "";
  @state() private total = "";
  @state() private regime: PurchaseRegime = "general";
  @state() private deductibleProportion = "100.00";
  @state() private note = "";
  @state() private lines: LineDraft[] = [blankLine()];
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();

  override willUpdate(changed: PropertyValues): void {
    const reopened = changed.has("invoice") || (changed.has("open") && this.open);
    if (changed.has("fieldErrors") || reopened) this.dismissed = new Set();
    if (!reopened) return;
    const inv = this.invoice;
    this.supplierTaxId = inv?.supplierTaxId ?? "";
    this.supplierName = inv?.supplierName ?? "";
    this.supplierInvoiceNumber = inv?.supplierInvoiceNumber ?? "";
    this.issuedOn = inv?.issuedOn ?? "";
    this.receivedOn = inv?.receivedOn ?? "";
    this.total = inv?.total ?? "";
    this.regime = inv?.regime ?? "general";
    this.deductibleProportion = inv?.deductibleProportion ?? "100.00";
    this.note = inv?.note ?? "";
    this.lines = inv
      ? inv.lines.map((l) => ({ rate: l.rate, base: l.base, tax: l.tax, kind: l.kind }))
      : [blankLine()];
    this.attempted = false;
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("fieldErrors") && this.#fieldKeys(this.fieldErrors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }

  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  #onFieldChange(event: CustomEvent<{ value: string }>, field: HeaderField): void {
    event.stopPropagation();
    this[field] = event.detail.value;
    this.#dismiss(HEADER_KEYS[field]);
  }

  #onRegimeChange(event: Event): void {
    event.stopPropagation();
    this.regime = (event.target as HTMLSelectElement).value as PurchaseRegime;
  }

  #onLineFieldChange(
    event: CustomEvent<{ value: string }>,
    index: number,
    field: "rate" | "base" | "tax",
  ): void {
    event.stopPropagation();
    this.lines = this.lines.map((line, i) =>
      i === index ? { ...line, [field]: event.detail.value } : line,
    );
  }

  #onLineKindChange(event: Event, index: number): void {
    event.stopPropagation();
    const kind = (event.target as HTMLSelectElement).value as PurchaseVatKind;
    this.lines = this.lines.map((line, i) => (i === index ? { ...line, kind } : line));
  }

  #addLine(): void {
    this.lines = [...this.lines, blankLine()];
    this.#dismiss("lines");
  }

  #removeLine(index: number): void {
    this.lines = this.lines.filter((_, i) => i !== index);
  }

  /** Every invalid field's message, keyed by the field's `data-test`; `lines` is the breakdown. */
  #validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const required = [
      ["supplier-tax-id", this.supplierTaxId, "purchase.supplier_tax_id_required"],
      ["supplier-name", this.supplierName, "purchase.supplier_name_required"],
      [
        "supplier-invoice-number",
        this.supplierInvoiceNumber,
        "purchase.supplier_invoice_number_required",
      ],
      ["issued-on", this.issuedOn, "purchase.issued_on_required"],
      ["received-on", this.receivedOn, "purchase.received_on_required"],
    ] as const;
    for (const [field, value, message] of required)
      if (value.trim() === "") errors[field] = t(message);
    const amount = t("purchase.amount_invalid");
    const percentage = t("purchase.percentage_invalid");
    if (!inRange(this.total, 0, Infinity)) errors.total = amount;
    if (!inRange(this.deductibleProportion, 0, 100)) errors["deductible-proportion"] = percentage;
    if (this.lines.length === 0) errors.lines = codeMessage("purchase.lines_required");
    this.lines.forEach((line, index) => {
      if (!inRange(line.rate, 0, 100)) errors[`line-rate-${index}`] = percentage;
      if (!inRange(line.base, 0, Infinity)) errors[`line-base-${index}`] = amount;
      if (!inRange(line.tax, 0, Infinity)) errors[`line-tax-${index}`] = amount;
    });
    return errors;
  }

  /** The keys of `errors` held by a field; every other key belongs to the bottom message. */
  #fieldKeys(errors: PurchaseFormErrors): string[] {
    return Object.keys(errors).filter((key) => key !== "_form" && errors[key]);
  }

  #errors(invalid: PurchaseFormErrors): PurchaseFormErrors {
    const refused = Object.fromEntries(
      Object.entries(this.fieldErrors).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...invalid };
  }

  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.attempted = true;
    this.#dismiss(...Object.keys(this.fieldErrors));
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }

    const header = {
      supplierTaxId: this.supplierTaxId,
      supplierName: this.supplierName,
      supplierInvoiceNumber: this.supplierInvoiceNumber,
      issuedOn: this.issuedOn,
      receivedOn: this.receivedOn,
      total: this.total,
      regime: this.regime,
      deductibleProportion: this.deductibleProportion,
      note: this.note.trim() === "" ? null : this.note,
    };
    const lines: PurchaseInvoiceLineInput[] = this.lines.map((l) => ({
      rate: l.rate,
      base: l.base,
      tax: l.tax,
      kind: l.kind,
    }));

    if (this.invoice) {
      this.dispatchEvent(
        new CustomEvent<UpdatePurchaseDetail>("update-purchase", {
          detail: { id: this.invoice.id, patch: { header, lines } },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    this.dispatchEvent(
      new CustomEvent<PurchaseInvoiceInput>("create-purchase", {
        detail: { header, lines },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Deliberately does not `stopPropagation`: the composed `wt-close` must bubble on to the screen
   * (the owner of the open state). */
  #onClose(): void {
    this.open = false;
  }

  #renderLine(line: LineDraft, index: number, errors: Record<string, string>) {
    return html`<div class="line" data-test=${`line-${index}`}>
      <wt-input
        class="line-field"
        name=${`line-${index}-rate`}
        data-test=${`line-rate-${index}`}
        label=${t("purchase.line_rate")}
        required
        error=${errors[`line-rate-${index}`] ?? ""}
        .value=${line.rate}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "rate")}
      ></wt-input>
      <wt-price-input
        class="line-field"
        fixed-unit
        locale=${currentLocale()}
        name=${`line-${index}-base`}
        data-test=${`line-base-${index}`}
        label=${t("purchase.line_base")}
        required
        error=${errors[`line-base-${index}`] ?? ""}
        .value=${line.base}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "base")}
      ></wt-price-input>
      <wt-price-input
        class="line-field"
        fixed-unit
        locale=${currentLocale()}
        name=${`line-${index}-tax`}
        data-test=${`line-tax-${index}`}
        label=${t("purchase.line_tax")}
        required
        error=${errors[`line-tax-${index}`] ?? ""}
        .value=${line.tax}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "tax")}
      ></wt-price-input>
      <label class="line-field"
        >${t("purchase.line_kind")}
        <select
          name=${`line-${index}-kind`}
          data-test=${`line-kind-${index}`}
          @change=${(e: Event) => this.#onLineKindChange(e, index)}
        >
          ${VAT_KINDS.map(
            (k) => html`<option value=${k} .selected=${k === line.kind}>${vatKindName(k)}</option>`,
          )}
        </select>
      </label>
      <wt-button
        size="sm"
        variant="danger"
        data-test=${`remove-line-${index}`}
        aria-label=${`${t("purchase.remove_line")} ${index + 1}`}
        @click=${() => this.#removeLine(index)}
        >${t("purchase.remove_line")}</wt-button
      >
    </div>`;
  }

  override render() {
    const validation = this.attempted ? this.#validate() : {};
    const errors = this.#errors(validation);
    const marked = this.#fieldKeys(errors).length > 0;
    const bottom = [errors._form ?? "", marked ? t("form.fix_fields") : ""]
      .filter((message) => message !== "")
      .join(" ");
    return html`
      <wt-dialog
        @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]"))}
        heading=${this.invoice ? t("purchase.edit") : t("purchase.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        <wt-input
          class="field"
          name="supplier-tax-id"
          data-test="supplier-tax-id"
          required
          error=${errors["supplier-tax-id"] ?? ""}
          label=${t("purchase.supplier_tax_id")}
          .value=${this.supplierTaxId}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "supplierTaxId")}
        ></wt-input>
        <wt-input
          class="field"
          name="supplier-name"
          data-test="supplier-name"
          required
          error=${errors["supplier-name"] ?? ""}
          label=${t("purchase.supplier_name")}
          .value=${this.supplierName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "supplierName")}
        ></wt-input>
        <wt-input
          class="field"
          name="supplier-invoice-number"
          data-test="supplier-invoice-number"
          required
          error=${errors["supplier-invoice-number"] ?? ""}
          label=${t("purchase.supplier_invoice_number")}
          .value=${this.supplierInvoiceNumber}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "supplierInvoiceNumber")}
        ></wt-input>
        <wt-input
          class="field"
          type="date"
          name="issued-on"
          data-test="issued-on"
          required
          error=${errors["issued-on"] ?? ""}
          label=${t("purchase.issued_on")}
          .value=${this.issuedOn}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "issuedOn")}
        ></wt-input>
        <wt-input
          class="field"
          type="date"
          name="received-on"
          data-test="received-on"
          required
          error=${errors["received-on"] ?? ""}
          label=${t("purchase.received_on")}
          .value=${this.receivedOn}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "receivedOn")}
        ></wt-input>
        <wt-price-input
          class="field"
          fixed-unit
          locale=${currentLocale()}
          name="total"
          data-test="total"
          required
          error=${errors["total"] ?? ""}
          label=${t("purchase.total")}
          .value=${this.total}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "total")}
        ></wt-price-input>
        <label class="field"
          >${t("purchase.regime")}
          <select name="regime" data-test="regime" @change=${(e: Event) => this.#onRegimeChange(e)}>
            ${REGIMES.map(
              (r) =>
                html`<option value=${r} .selected=${r === this.regime}>${regimeName(r)}</option>`,
            )}
          </select>
        </label>
        <wt-input
          class="field"
          name="deductible-proportion"
          data-test="deductible-proportion"
          required
          error=${errors["deductible-proportion"] ?? ""}
          label=${t("purchase.deductible_proportion")}
          .value=${this.deductibleProportion}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "deductibleProportion")}
        ></wt-input>
        <wt-input
          class="field"
          name="note"
          data-test="note"
          error=${errors["note"] ?? ""}
          label=${t("purchase.note")}
          .value=${this.note}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "note")}
        ></wt-input>

        <h3 class="lines-title">${t("purchase.lines")}</h3>
        ${
          errors.lines
            ? html`<p class="error" data-test="lines-error">${errors.lines}</p>`
            : nothing
        }
        ${this.lines.map((line, i) => this.#renderLine(line, i, errors))}
        <wt-button
          size="sm"
          variant="secondary"
          data-test="add-line"
          @click=${() => this.#addLine()}
          >${t("purchase.add_line")}</wt-button
        >

        <wt-form-actions slot="footer" .error=${bottom}>
          <wt-button
            variant="primary"
            data-test="confirm"
            ?disabled=${this.busy || Object.keys(validation).length > 0}
            @click=${(e: Event) => this.#confirm(e)}
            >${this.invoice ? t("action.save") : t("action.create")}</wt-button
          >
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-purchase-form": PurchaseForm;
  }
}
