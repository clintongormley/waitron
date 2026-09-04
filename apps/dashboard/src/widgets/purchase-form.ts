import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { regimeName, vatKindName } from "../i18n/domain.js";
import type {
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLineInput,
  PurchaseInvoicePatch,
  PurchaseRegime,
  PurchaseVatKind,
} from "../api/client.js";

/** The two regimes the form offers, in the `purchase_regime` enum order. */
const REGIMES: readonly PurchaseRegime[] = ["general", "equivalence_surcharge"];
/** The two VAT kinds the form offers, in the `purchase_vat_kind` enum order. */
const VAT_KINDS: readonly PurchaseVatKind[] = ["ordinary", "capital"];

/** The `update-purchase` event detail: the invoice id + a full header/lines patch. */
export interface UpdatePurchaseDetail {
  id: string;
  patch: PurchaseInvoicePatch;
}

/** One editable desglose row — a VAT line as the operator types it (all strings + a kind). */
interface LineDraft {
  rate: string;
  base: string;
  tax: string;
  kind: PurchaseVatKind;
}

/** A blank line row — a fresh `ordinary` line with empty amounts. */
function blankLine(): LineDraft {
  return { rate: "", base: "", tax: "", kind: "ordinary" };
}

/**
 * A well-formed non-negative decimal literal: one or more digits, an optional fractional part, and a
 * leading-dot form (`.5`) allowed. Browser-local by design — the dashboard never imports `@waitron/shared`
 * at runtime. Deliberately looser than the server's `decimal()` (it also accepts leading zeros): its only
 * job is to reject the inputs that would otherwise reach the `numeric` column as an opaque 500 — empty,
 * whitespace, a Spanish comma-decimal (`121,00`), or letters. Exact-format edge cases stay the server's.
 */
const DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * True when `value` is a well-formed non-negative decimal literal within [min, max] — the form's amount
 * check. The `DECIMAL` test runs BEFORE the range test so an empty, whitespace or comma-decimal amount is
 * rejected here (`Number("")` and `Number("  ")` are both `0`, which would otherwise pass the range).
 */
function inRange(value: string, min: number, max: number): boolean {
  if (!DECIMAL.test(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * The management dashboard's PURCHASE FORM: a `wt-dialog` (create + edit) that captures a received
 * supplier invoice (factura recibida) — the scalar header (supplier identity, the two civil dates, the
 * gross total, the VAT regime, the deductible proportion, an optional note) plus an embedded DESGLOSE
 * SUB-EDITOR that manages a variable number of per-rate VAT lines (rate/base/tax + kind), each with an
 * add/remove control (the add/remove-rows mechanic over a `@state() lines`).
 *
 * The purchases screen drives it by setting `.open` and (for an edit) `.invoice`, and hears one of two
 * events: `create-purchase` (a `PurchaseInvoiceInput`) or `update-purchase { id, patch }` (a full
 * header + full desglose replacement — the op's "lines present ⇒ full replace" contract). Like
 * `product-form`, the form does NOT call the API and does NOT close itself on confirm — the screen
 * closes it on a successful write, so a rejected write leaves the entered values in place.
 *
 * SEEDING mirrors `product-form`: `willUpdate` reseeds every field from `invoice` whenever it changes
 * or the dialog opens — a create (`invoice` null) starts blank with one empty line, an edit fills every
 * field and one row per stored VAT line.
 *
 * CLIENT VALIDATION mirrors the op's checks for UX (the server stays authoritative): the required
 * header fields must be non-empty (`purchase.fields_required`), at least one VAT line must remain
 * (`purchase.lines_required`), and every amount — each line's base/tax, its rate, the gross total and
 * the deductible proportion — must be a well-formed non-negative decimal (base/tax ≥ 0, rate 0–100,
 * proportion 0–100), rejecting a blank, whitespace or comma-decimal value (`purchase.amounts_invalid`).
 * That last check is what keeps a blank desglose line or a Spanish `121,00` from reaching the `numeric`
 * column as a `22P02` → opaque 500; the server's exact-format check (`decimal()`) stays authoritative
 * for the edge cases the browser-local `DECIMAL` pattern leaves through. A failing check blocks confirm
 * and shows a `role="alert"`. A single-flight `busy` property (set by the screen while a write
 * round-trips) makes confirm a no-op — the create/update are not server-idempotent.
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
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** Whether the dialog is showing. The screen sets this to open the form; it clears on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The invoice being edited, or null for a create. Setting it pre-fills every field on the next open. */
  @property({ attribute: false }) invoice: PurchaseInvoice | null = null;

  /** Single-flight gate: the screen sets it true while a create/update is in flight; confirm is a no-op. */
  @property({ type: Boolean }) busy = false;

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
  @state() private validationError: string | null = null;

  /**
   * Reseed every field from `invoice` on an open or an invoice change. A create (`invoice` null) resets
   * to blanks + defaults with a single empty line; an edit fills from the loaded invoice, one row per
   * stored VAT line (cloned so edits never mutate the passed object).
   */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("invoice") && !(changed.has("open") && this.open)) return;
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
    this.validationError = null;
  }

  #onFieldChange(
    event: CustomEvent<{ value: string }>,
    field:
      | "supplierTaxId"
      | "supplierName"
      | "supplierInvoiceNumber"
      | "issuedOn"
      | "receivedOn"
      | "total"
      | "deductibleProportion"
      | "note",
  ): void {
    event.stopPropagation();
    this[field] = event.detail.value;
    if (this.validationError) this.validationError = null;
  }

  // Native `change` is `composed: false`; `stopPropagation` is defensive consistency with the composed
  // handlers (the person-form/product-form pattern).
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
    if (this.validationError) this.validationError = null;
  }

  #onLineKindChange(event: Event, index: number): void {
    event.stopPropagation();
    const kind = (event.target as HTMLSelectElement).value as PurchaseVatKind;
    this.lines = this.lines.map((line, i) => (i === index ? { ...line, kind } : line));
  }

  #addLine(): void {
    this.lines = [...this.lines, blankLine()];
  }

  #removeLine(index: number): void {
    this.lines = this.lines.filter((_, i) => i !== index);
  }

  /** Validate the entered values against the op's checks; returns a code to show, or null when valid. */
  #validate(): string | null {
    const required = [
      this.supplierTaxId,
      this.supplierName,
      this.supplierInvoiceNumber,
      this.issuedOn,
      this.receivedOn,
      this.total,
    ];
    if (required.some((v) => v.trim() === "")) return "purchase.fields_required";
    if (this.lines.length === 0) return "purchase.lines_required";
    for (const line of this.lines) {
      if (!inRange(line.base, 0, Infinity)) return "purchase.amounts_invalid";
      if (!inRange(line.tax, 0, Infinity)) return "purchase.amounts_invalid";
      if (!inRange(line.rate, 0, 100)) return "purchase.amounts_invalid";
    }
    if (!inRange(this.total, 0, Infinity)) return "purchase.amounts_invalid";
    if (!inRange(this.deductibleProportion, 0, 100)) return "purchase.amounts_invalid";
    return null;
  }

  /**
   * Assemble and emit the create/update event. `stopPropagation` keeps the confirm button's own
   * composed `click` inside this shadow boundary. Blocks (no event) on a `busy` gate and on a failed
   * validation (a `role="alert"` is shown instead). For an edit, emits `update-purchase { id, patch }`
   * carrying the full header + full desglose (a full replace); for a create, emits `create-purchase`.
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
    const error = this.#validate();
    if (error !== null) {
      this.validationError = error;
      return;
    }
    this.validationError = null;

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

  /** The dialog closed. Drop `open`; like `product-form`, do NOT `stopPropagation` — the composed
   * `wt-close` must bubble on to the screen (the owner of the open state). */
  #onClose(): void {
    this.open = false;
  }

  #renderLine(line: LineDraft, index: number) {
    return html`<div class="line" data-test=${`line-${index}`}>
      <wt-input
        class="line-field"
        data-test=${`line-rate-${index}`}
        label=${t("purchase.line_rate")}
        .value=${line.rate}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "rate")}
      ></wt-input>
      <wt-input
        class="line-field"
        data-test=${`line-base-${index}`}
        label=${t("purchase.line_base")}
        .value=${line.base}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "base")}
      ></wt-input>
      <wt-input
        class="line-field"
        data-test=${`line-tax-${index}`}
        label=${t("purchase.line_tax")}
        .value=${line.tax}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLineFieldChange(e, index, "tax")}
      ></wt-input>
      <label class="line-field"
        >${t("purchase.line_kind")}
        <select
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
    return html`
      <wt-dialog
        heading=${this.invoice ? t("purchase.edit") : t("purchase.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        <wt-input
          class="field"
          data-test="supplier-tax-id"
          label=${t("purchase.supplier_tax_id")}
          .value=${this.supplierTaxId}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "supplierTaxId")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="supplier-name"
          label=${t("purchase.supplier_name")}
          .value=${this.supplierName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "supplierName")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="supplier-invoice-number"
          label=${t("purchase.supplier_invoice_number")}
          .value=${this.supplierInvoiceNumber}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "supplierInvoiceNumber")}
        ></wt-input>
        <wt-input
          class="field"
          type="date"
          data-test="issued-on"
          label=${t("purchase.issued_on")}
          .value=${this.issuedOn}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "issuedOn")}
        ></wt-input>
        <wt-input
          class="field"
          type="date"
          data-test="received-on"
          label=${t("purchase.received_on")}
          .value=${this.receivedOn}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "receivedOn")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="total"
          label=${t("purchase.total")}
          .value=${this.total}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "total")}
        ></wt-input>
        <label class="field"
          >${t("purchase.regime")}
          <select data-test="regime" @change=${(e: Event) => this.#onRegimeChange(e)}>
            ${REGIMES.map(
              (r) =>
                html`<option value=${r} .selected=${r === this.regime}>${regimeName(r)}</option>`,
            )}
          </select>
        </label>
        <wt-input
          class="field"
          data-test="deductible-proportion"
          label=${t("purchase.deductible_proportion")}
          .value=${this.deductibleProportion}
          @wt-change=${(e: CustomEvent<{ value: string }>) =>
            this.#onFieldChange(e, "deductibleProportion")}
        ></wt-input>
        <wt-input
          class="field"
          data-test="note"
          label=${t("purchase.note")}
          .value=${this.note}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onFieldChange(e, "note")}
        ></wt-input>

        <h3 class="lines-title">${t("purchase.lines")}</h3>
        ${this.lines.map((line, i) => this.#renderLine(line, i))}
        <wt-button
          size="sm"
          variant="secondary"
          data-test="add-line"
          @click=${() => this.#addLine()}
          >${t("purchase.add_line")}</wt-button
        >

        ${
          this.validationError
            ? html`<p class="error" role="alert" data-test="error">
                ${codeMessage(this.validationError)}
              </p>`
            : nothing
        }
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          ?disabled=${this.busy}
          @click=${(e: Event) => this.#confirm(e)}
          >${this.invoice ? t("action.save") : t("action.create")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-purchase-form": PurchaseForm;
  }
}
