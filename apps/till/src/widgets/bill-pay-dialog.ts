import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MONEY_SCALE,
  addDecimal,
  compareDecimal,
  decimal,
  formatMoney,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type { AllocationPreview, BillBalance } from "../api/client.js";
import type { CardEntry, PayChoice, PayMethod } from "../state/bill-payment.js";

export type PayWay = PayChoice["kind"];

/** A dish of the bill as the dialog offers it. */
export interface PayLine {
  lineNo: number;
  name: string;
  /** Its quantity as shown. */
  quantity: string;
  /** The dish with its extras. */
  total: string;
  /** One unit's price when the dish can be paid for a unit at a time; null when only whole. */
  unitTotal: string | null;
}

/** What the operator asks the server to allocate: the choice, how it is paid, and for a card how
 * it is charged. */
export interface PayRequest {
  choice: PayChoice;
  pay: PayMethod;
  card?: CardEntry;
}

/** A refusal's code, and the request field it names when it names one. The app's own two:
 * `network`, a payment that got no answer, and `unread`, a balance that could not be read again. */
export interface PayRefusal {
  code: string;
  field?: string;
}

/** The payment just taken: the change it handed back, null for a card. */
export interface PayTaken {
  change: string | null;
}

type Field = "lines" | "amount" | "people" | "tendered" | "cardTip" | "tipAmount";
type Allocated = Extract<AllocationPreview, { kind: "allocated" }>;
type CashPay = Extract<PayMethod, { method: "cash" }>;
type CashPreview = Allocated & { change: string };
/** A cash confirmation: the cash handed over, and the server's allocation of it. */
interface Cash {
  pay: CashPay;
  preview: CashPreview;
}
type TipMode = "none" | "all" | "part";

/** The field a refusal is about, or null when it names none the dialog shows. */
function refusalField(refusal: PayRefusal, method: PayMethod["method"]): Field | null {
  if (refusal.code !== "management.request_invalid") return null;
  switch (refusal.field) {
    case "amount":
      return "amount";
    case "shareOf":
      return "people";
    case "tendered":
      return method === "cash" ? "tendered" : null;
    // A refused cash tip comes back to the form, which does not show the tip it was left from.
    case "addedTip":
      return method === "card" ? "cardTip" : null;
    default:
      return null;
  }
}

/** What the dialog says of a refusal: a payment that got no answer, a balance that could not be
 * read again, or the server's code in its own words. */
function refusalText(code: string): string {
  if (code === "network") return t("bill_pay.unconfirmed");
  if (code === "unread") return t("bill_pay.read_failed");
  return codeMessage(code);
}

const TYPED_AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/;
const PEOPLE = /^[1-9]\d{0,2}$/;

/** A typed amount with a decimal comma read as a point, or null when it is not an amount. */
function typedAmount(value: string): string | null {
  const typed = value.trim();
  return TYPED_AMOUNT.test(typed) ? typed.replace(",", ".") : null;
}

const WAYS: { way: PayWay; label: StringKey }[] = [
  { way: "items", label: "bill_pay.way_items" },
  { way: "contribution", label: "bill_pay.way_contribution" },
  { way: "share", label: "bill_pay.way_share" },
];

/**
 * Takes part of a bill: chosen items, an amount, or an equal share among the people still to pay,
 * in cash or on a hand-keyed card. Each way shows what it covers before it acts; the confirmation
 * shows the server's allocation (what the bill takes, the change or the card's charge, the tip)
 * before anything is taken. It holds no request of its own: the app answers `bill-pay-preview`
 * with {@link asked} and {@link preview}, a refusal with {@link refusal}, and a payment taken with
 * {@link taken} and the bill's new {@link balance}.
 */
@customElement("till-bill-pay-dialog")
export class TillBillPayDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      p {
        margin: 0;
      }

      .balance {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--wt-space-2) var(--wt-space-4);
        margin: 0;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .balance div {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .balance dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .balance dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .scope,
      .taken {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .choice {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }

      .choice legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1) var(--wt-space-4);
      }

      .lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-4);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }

      .units {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .units-count {
        min-width: var(--wt-space-6);
        text-align: center;
        font-weight: var(--wt-font-weight-bold);
      }

      .required,
      .field-error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .field-error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }

      .muted {
        color: var(--wt-color-text-muted);
      }

      .allocation {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
      }

      .allocation div {
        display: flex;
        justify-content: space-between;
        gap: var(--wt-space-4);
      }

      .allocation dd {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }

      .allocation .headline {
        font-size: var(--wt-font-size-lg);
      }
    `,
  ];

  /** The bill's total, received, reserved and outstanding, and the quantity of each line paid;
   * null while it is being read. */
  @property({ attribute: false }) balance: BillBalance | null = null;
  /** The bill's dishes; those already paid for in full are not offered. */
  @property({ attribute: false }) lines: PayLine[] = [];
  /** The way the dialog opens on. */
  @property() way: PayWay = "items";
  /** A contribution's starting amount. */
  @property() amount = "";
  /** What the last `bill-pay-preview` asked; with {@link preview}, the dialog asks for
   * confirmation. */
  @property({ attribute: false }) asked: PayRequest | null = null;
  @property({ attribute: false }) preview: AllocationPreview | null = null;
  @property({ attribute: false }) refusal: PayRefusal | null = null;
  /** Set after each payment taken: the dialog says so and starts its form again. */
  @property({ attribute: false }) taken: PayTaken | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private chosenWay: PayWay = "items";
  @state() private picks = new Map<number, number>();
  @state() private typedAmountValue = "";
  @state() private people = "";
  @state() private method: PayMethod["method"] = "cash";
  @state() private tendered = "";
  @state() private cardTip = "";
  @state() private externalRef = "";
  @state() private tipMode: TipMode = "none";
  @state() private tipAmount = "";
  @state() private attempted = false;
  @state() private tipAttempted = false;
  /** The refusal still shown: it goes when the field it names changes, or at the next request. */
  @state() private shownRefusal: PayRefusal | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("way")) this.chosenWay = this.way;
    if (changed.has("amount")) this.typedAmountValue = this.amount;
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (changed.has("taken") && this.taken !== null) this.#startAgain();
  }

  #startAgain(): void {
    this.picks = new Map();
    this.typedAmountValue = "";
    this.people = "";
    this.tendered = "";
    this.cardTip = "";
    this.externalRef = "";
    this.attempted = false;
    this.#noTip();
  }

  /** A confirmation starts giving all the change back. */
  #noTip(): void {
    this.tipMode = "none";
    this.tipAmount = "";
    this.tipAttempted = false;
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  #paidUnits(lineNo: number): Decimal {
    const paid = this.balance?.paidLines.find((line) => line.lineNo === lineNo);
    return decimal(paid?.paidQuantity ?? "0");
  }

  /** The units of `line` still to pay: all of a line paid only whole, or none once any is paid. */
  #remaining(line: PayLine): number {
    const paid = this.#paidUnits(line.lineNo);
    if (line.unitTotal === null) return compareDecimal(paid, decimal("0")) > 0 ? 0 : 1;
    return Number(subtractDecimal(decimal(line.quantity), paid));
  }

  #offered(): PayLine[] {
    return this.lines.filter((line) => this.#remaining(line) > 0);
  }

  #pickAmount(line: PayLine, units: number): Decimal {
    return line.unitTotal === null
      ? decimal(line.total)
      : toScale(multiplyDecimal(decimal(line.unitTotal), decimal(String(units))), MONEY_SCALE);
  }

  #shownQuantity(line: PayLine, units: number): string {
    return line.unitTotal === null ? line.quantity : String(units);
  }

  #choice(): PayChoice {
    switch (this.chosenWay) {
      case "items":
        return {
          kind: "items",
          picks: this.#offered().flatMap((line) => {
            const units = this.picks.get(line.lineNo);
            if (units === undefined) return [];
            // Once any of a line is paid, fewer units than its quantity are left to pick.
            const whole = line.unitTotal === null || units === Number(line.quantity);
            return [whole ? { lineNo: line.lineNo } : { lineNo: line.lineNo, units }];
          }),
        };
      case "contribution":
        return { kind: "contribution", amount: typedAmount(this.typedAmountValue)! };
      case "share":
        return { kind: "share", shareOf: Number(this.people.trim()) };
    }
  }

  #request(): PayRequest {
    const choice = this.#choice();
    if (this.method === "cash")
      return { choice, pay: { method: "cash", tendered: typedAmount(this.tendered)! } };
    const tip = typedAmount(this.cardTip);
    const ref = this.externalRef.trim();
    return {
      choice,
      pay: tip === null ? { method: "card" } : { method: "card", addedTip: tip },
      card: ref === "" ? { entry: "manual" } : { entry: "manual", externalRef: ref },
    };
  }

  #ownErrors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    if (this.chosenWay === "items" && this.picks.size === 0)
      errors.set("lines", t("bill_pay.items_required"));
    if (this.chosenWay === "contribution") {
      const amount = typedAmount(this.typedAmountValue);
      if (amount === null || compareDecimal(decimal(amount), decimal("0")) <= 0)
        errors.set("amount", t("bill_pay.amount_invalid"));
    }
    if (this.chosenWay === "share" && !PEOPLE.test(this.people.trim()))
      errors.set("people", t("bill_pay.people_invalid"));
    if (this.method === "cash") {
      const tendered = typedAmount(this.tendered);
      if (tendered === null || compareDecimal(decimal(tendered), decimal("0")) <= 0)
        errors.set("tendered", t("bill_pay.tendered_invalid"));
    } else if (this.cardTip.trim() !== "" && typedAmount(this.cardTip) === null) {
      errors.set("cardTip", t("bill_pay.tip_invalid"));
    }
    return errors;
  }

  #refusalField(): Field | null {
    return this.shownRefusal === null ? null : refusalField(this.shownRefusal, this.method);
  }

  #refusalMessage(field: Field): string {
    return field === "tendered"
      ? t("bill_pay.tendered_short")
      : codeMessage(this.shownRefusal!.code);
  }

  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, this.#refusalMessage(field));
    return errors;
  }

  /** The one message beside the action: the generic one while a field is marked, then a refusal
   * that names no field, in its own words. */
  #bottomMessage(fieldErrors: ReadonlyMap<Field, string>, extra?: string): string {
    const parts: string[] = [];
    if (fieldErrors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(refusalText(this.shownRefusal.code));
    if (extra !== undefined) parts.push(extra);
    return parts.join(" ");
  }

  #changed(field: Field): void {
    if (this.#refusalField() === field) this.shownRefusal = null;
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownErrors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#noTip();
    this.#emit("bill-pay-preview", this.#request());
  }

  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("bill_pay.title")}
      .dismissible=${!this.busy}
      @wt-close=${() => this.#emit("bill-pay-close")}
    >
      <div class="body">
        ${this.#balance()}
        ${
          this.taken === null
            ? nothing
            : html`<p class="taken" role="status" data-pay-taken>
                ${
                  this.taken.change === null ||
                  compareDecimal(decimal(this.taken.change), decimal("0")) === 0
                    ? t("bill_pay.taken")
                    : t("bill_pay.taken_change").replace("{amount}", () =>
                        this.#money(this.taken!.change!),
                      )
                }
              </p>`
        }
        ${
          this.asked !== null && this.preview?.kind === "allocated"
            ? this.#confirmStep(this.asked, this.preview)
            : this.#form()
        }
      </div>
    </wt-dialog>`;
  }

  #balance(): TemplateResult {
    const balance = this.balance;
    if (balance === null)
      return html`<p class="muted" data-pay-balance>${t("bill_pay.reading")}</p>`;
    const amount = (value: string) => html`<dd>${this.#money(value)}</dd>`;
    return html`<dl class="balance" data-pay-balance aria-label=${t("bill_pay.balance")}>
      <div data-pay-total>
        <dt>${t("bill_pay.total")}</dt>
        ${amount(balance.total)}
      </div>
      <div data-pay-received>
        <dt>${t("bill_pay.received")}</dt>
        ${amount(balance.received)}
      </div>
      <div data-pay-reserved>
        <dt>${t("bill_pay.reserved")}</dt>
        ${amount(balance.reserved)}
      </div>
      <div data-pay-outstanding>
        <dt>${t("bill_pay.outstanding")}</dt>
        ${amount(balance.outstanding)}
      </div>
    </dl>`;
  }

  /** What the way covers, as far as the dialog knows before the server allocates it. */
  #scope(): string {
    switch (this.chosenWay) {
      case "items": {
        const picked = this.#offered().filter((line) => this.picks.has(line.lineNo));
        if (picked.length === 0) return t("bill_pay.scope_items_none");
        const names = picked
          .map((line) => {
            const shown = this.#shownQuantity(line, this.picks.get(line.lineNo)!);
            return shown === "1" ? line.name : `${line.name} ×${shown}`;
          })
          .join(", ");
        const amount = toScale(
          sumDecimals(picked.map((line) => this.#pickAmount(line, this.picks.get(line.lineNo)!))),
          MONEY_SCALE,
        );
        return t("bill_pay.scope_items")
          .replace("{items}", () => names)
          .replace("{amount}", () => this.#money(amount));
      }
      case "contribution": {
        const amount = typedAmount(this.typedAmountValue);
        return amount === null
          ? t("bill_pay.scope_contribution_empty")
          : t("bill_pay.scope_contribution").replace("{amount}", () => this.#money(amount));
      }
      case "share": {
        const outstanding = this.#money(this.balance?.outstanding ?? "0");
        const people = this.people.trim();
        return PEOPLE.test(people)
          ? t("bill_pay.scope_share")
              .replace("{amount}", () => outstanding)
              .replace("{n}", people)
          : t("bill_pay.scope_share_empty").replace("{amount}", () => outstanding);
      }
    }
  }

  #radio(
    name: string,
    value: string,
    label: string,
    checked: boolean,
    pick: () => void,
  ): TemplateResult {
    return html`<label class="option">
      <input
        type="radio"
        name=${name}
        .value=${value}
        .checked=${checked}
        @change=${(event: Event) => {
          event.stopPropagation();
          pick();
        }}
      />
      <span>${label}</span>
    </label>`;
  }

  #enter(event: KeyboardEvent, selector: string): void {
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>(selector));
  }

  #input(
    name: Field | "externalRef",
    label: string,
    value: string,
    set: (value: string) => void,
    opts: { required?: boolean; error?: string; submit: string },
  ): TemplateResult {
    return html`<wt-input
      name=${name}
      autocomplete="off"
      .disabled=${this.busy}
      .label=${label}
      .value=${value}
      .required=${opts.required === true}
      .error=${opts.error ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        set(event.detail.value);
        if (name !== "externalRef") this.#changed(name);
      }}
      @keydown=${(event: KeyboardEvent) => this.#enter(event, opts.submit)}
    ></wt-input>`;
  }

  #form(): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const choose =
      this.preview?.kind === "choose" && this.asked !== null
        ? t("bill_pay.choose_later")
        : undefined;
    const bottom = this.#bottomMessage(errors, choose);
    return html`<fieldset class="choice" data-pay-way ?disabled=${this.busy}>
        <legend>${t("bill_pay.way")}</legend>
        <div class="options">
          ${WAYS.map(({ way, label }) =>
            this.#radio("way", way, t(label), this.chosenWay === way, () => {
              this.chosenWay = way;
            }),
          )}
        </div>
      </fieldset>
      <p class="scope" data-pay-scope>${this.#scope()}</p>
      ${this.#wayFields(errors)} ${this.#methodFields(errors)}
      <wt-form-actions .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-pay-close
          .disabled=${this.busy}
          @click=${() => this.#emit("bill-pay-close")}
        >
          ${t("bill_pay.close")}
        </wt-button>
        <wt-button
          variant="primary"
          data-pay-continue
          .loading=${this.busy}
          .disabled=${this.busy || own.size > 0}
          @click=${() => void this.#continue()}
        >
          ${t("bill_pay.continue")}
        </wt-button>
      </wt-form-actions>`;
  }

  #wayFields(errors: ReadonlyMap<Field, string>): TemplateResult {
    switch (this.chosenWay) {
      case "items":
        return this.#itemsField(errors.get("lines"));
      case "contribution":
        return this.#input(
          "amount",
          t("bill_pay.amount"),
          this.typedAmountValue,
          (value) => (this.typedAmountValue = value),
          { required: true, error: errors.get("amount"), submit: "[data-pay-continue]" },
        );
      case "share":
        return this.#input(
          "people",
          t("bill_pay.people"),
          this.people,
          (value) => (this.people = value),
          { required: true, error: errors.get("people"), submit: "[data-pay-continue]" },
        );
    }
  }

  #itemsField(error: string | undefined): TemplateResult {
    const offered = this.#offered();
    if (offered.length === 0)
      return html`<p class="muted" data-items-none>${t("bill_pay.items_none")}</p>`;
    return html`<fieldset class="choice" data-pay-lines ?disabled=${this.busy}>
      <legend>${t("bill_pay.items")}<span class="required" aria-hidden="true">*</span></legend>
      <div class="lines">${offered.map((line) => this.#lineRow(line, error !== undefined))}</div>
      ${
        error === undefined
          ? nothing
          : html`<p class="field-error" id="lines-error" data-error-for="lines">${error}</p>`
      }
    </fieldset>`;
  }

  #lineRow(line: PayLine, invalid: boolean): TemplateResult {
    const remaining = this.#remaining(line);
    const units = this.picks.get(line.lineNo);
    const quantity = this.#shownQuantity(line, remaining);
    const label = `${line.name} ×${quantity} · ${this.#money(this.#pickAmount(line, remaining))}`;
    const toggle = () => {
      const next = new Map(this.picks);
      if (next.has(line.lineNo)) next.delete(line.lineNo);
      else next.set(line.lineNo, remaining);
      this.picks = next;
      this.#changed("lines");
    };
    return html`<div class="line">
      <label class="option">
        <input
          type="checkbox"
          name="line"
          .value=${String(line.lineNo)}
          .checked=${units !== undefined}
          aria-invalid=${invalid ? "true" : nothing}
          aria-describedby=${invalid ? "lines-error" : nothing}
          @change=${(event: Event) => {
            event.stopPropagation();
            toggle();
          }}
        />
        <span>${label}</span>
      </label>
      ${
        units === undefined || line.unitTotal === null || remaining <= 1
          ? nothing
          : this.#unitsStepper(line, units, remaining)
      }
    </div>`;
  }

  #unitsStepper(line: PayLine, units: number, remaining: number): TemplateResult {
    const step = (delta: -1 | 1) => {
      const next = new Map(this.picks);
      next.set(line.lineNo, units + delta);
      this.picks = next;
    };
    return html`<span class="units">
      <span>${t("bill_pay.units")}</span>
      <wt-button
        variant="ghost"
        size="sm"
        data-units-less=${line.lineNo}
        aria-label=${`${t("basket.decrease")} ${line.name}`}
        ?disabled=${this.busy || units <= 1}
        @click=${() => step(-1)}
      >
        <span aria-hidden="true">−</span>
      </wt-button>
      <span class="units-count" data-units=${line.lineNo}>${units}</span>
      <wt-button
        variant="ghost"
        size="sm"
        data-units-more=${line.lineNo}
        aria-label=${`${t("basket.increase")} ${line.name}`}
        ?disabled=${this.busy || units >= remaining}
        @click=${() => step(1)}
      >
        <span aria-hidden="true">+</span>
      </wt-button>
    </span>`;
  }

  #methodFields(errors: ReadonlyMap<Field, string>): TemplateResult {
    return html`<fieldset class="choice" data-pay-method ?disabled=${this.busy}>
        <legend>${t("bill_pay.method")}</legend>
        <div class="options">
          ${this.#radio("method", "cash", t("tender.cash"), this.method === "cash", () => {
            this.method = "cash";
          })}
          ${this.#radio("method", "card", t("tender.card"), this.method === "card", () => {
            this.method = "card";
          })}
        </div>
      </fieldset>
      ${
        this.method === "cash"
          ? this.#input(
              "tendered",
              t("bill_pay.tendered"),
              this.tendered,
              (value) => (this.tendered = value),
              { required: true, error: errors.get("tendered"), submit: "[data-pay-continue]" },
            )
          : html`${this.#input(
              "cardTip",
              t("bill_pay.card_tip"),
              this.cardTip,
              (value) => (this.cardTip = value),
              { error: errors.get("cardTip"), submit: "[data-pay-continue]" },
            )}
            ${this.#input(
              "externalRef",
              t("tender.card_ref"),
              this.externalRef,
              (value) => (this.externalRef = value),
              { submit: "[data-pay-continue]" },
            )}`
      }`;
  }

  /** The change and tip together: what "all of the change" leaves as a tip. */
  #changeAndTip(preview: CashPreview): Decimal {
    return toScale(addDecimal(decimal(preview.change), decimal(preview.tip)), MONEY_SCALE);
  }

  #tipErrors(preview: CashPreview): Map<Field, string> {
    const errors = new Map<Field, string>();
    const most = this.#changeAndTip(preview);
    const tip = typedAmount(this.tipAmount);
    if (
      tip === null ||
      compareDecimal(decimal(tip), decimal("0")) <= 0 ||
      compareDecimal(decimal(tip), most) > 0
    )
      errors.set(
        "tipAmount",
        t("bill_pay.tip_amount_invalid").replace("{amount}", () => this.#money(most)),
      );
    return errors;
  }

  /** Asks the server again with `addedTip` as the tip left from the change. */
  #askWithTip(asked: PayRequest, cash: CashPay, addedTip: string | undefined): void {
    const pay: CashPay = { method: "cash", tendered: cash.tendered };
    this.shownRefusal = null;
    this.#emit("bill-pay-preview", {
      ...asked,
      pay: addedTip === undefined ? pay : { ...pay, addedTip },
    } satisfies PayRequest);
  }

  #pickTip(mode: TipMode, asked: PayRequest, cash: CashPay, preview: CashPreview): void {
    this.tipMode = mode;
    this.tipAttempted = false;
    if (mode === "none") this.#askWithTip(asked, cash, undefined);
    if (mode === "all") this.#askWithTip(asked, cash, this.#changeAndTip(preview));
  }

  /** Takes the payment shown; with part of the change typed as a tip, first checks it and, when
   * it is not the tip shown, asks the server for the allocation with it. */
  async #take(asked: PayRequest, cash: Cash | null): Promise<void> {
    if (cash !== null && this.tipMode === "part") {
      this.tipAttempted = true;
      if (this.#tipErrors(cash.preview).size > 0) {
        await this.updateComplete;
        await focusFirstInvalid(this.shadowRoot!);
        return;
      }
      const tip = typedAmount(this.tipAmount)!;
      if (compareDecimal(decimal(tip), decimal(cash.preview.tip)) !== 0) {
        this.#askWithTip(asked, cash.pay, tip);
        return;
      }
    }
    this.shownRefusal = null;
    this.#emit("bill-pay-confirm");
  }

  #confirmStep(asked: PayRequest, preview: Allocated): TemplateResult {
    // A cash preview always carries its change, and a card's its charge.
    const cash: Cash | null =
      asked.pay.method === "cash"
        ? { pay: asked.pay, preview: { ...preview, change: preview.change! } }
        : null;
    const tipErrors =
      cash !== null && this.tipAttempted && this.tipMode === "part"
        ? this.#tipErrors(cash.preview)
        : new Map<Field, string>();
    const errors = this.#fieldErrors(tipErrors);
    const bottom = this.#bottomMessage(errors);
    const amount = (value: string) => html`<dd>${this.#money(value)}</dd>`;
    return html`<p class="scope" data-pay-scope>${this.#scope()}</p>
      <dl class="allocation">
        <div class=${cash === null ? "headline" : ""} data-pay-applied>
          <dt>${t("bill_pay.applied")}</dt>
          ${amount(preview.applied)}
        </div>
        ${
          cash === null
            ? nothing
            : html`<div data-pay-tendered>
                  <dt>${t("bill_pay.tendered")}</dt>
                  ${amount(cash.pay.tendered)}
                </div>
                <div class="headline" data-pay-change>
                  <dt>${t("bill_pay.change")}</dt>
                  ${amount(cash.preview.change)}
                </div>`
        }
        <div data-pay-tip>
          <dt>${t("bill_pay.tip")}</dt>
          ${amount(preview.tip)}
        </div>
        ${
          cash === null
            ? html`<div class="headline" data-pay-charged>
                <dt>${t("bill_pay.charged")}</dt>
                ${amount(preview.charged!)}
              </div>`
            : nothing
        }
      </dl>
      ${
        cash !== null && compareDecimal(this.#changeAndTip(cash.preview), decimal("0")) > 0
          ? this.#tipChoice(asked, cash, errors.get("tipAmount"))
          : nothing
      }
      <wt-form-actions .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-pay-back
          .disabled=${this.busy}
          @click=${() => {
            this.shownRefusal = null;
            this.#emit("bill-pay-edit");
          }}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button
          variant="primary"
          data-pay-confirm
          .loading=${this.busy}
          .disabled=${this.busy || tipErrors.size > 0}
          @click=${() => void this.#take(asked, cash)}
        >
          ${t("bill_pay.take")}
        </wt-button>
      </wt-form-actions>`;
  }

  #tipChoice(asked: PayRequest, cash: Cash, error: string | undefined): TemplateResult {
    const options: { mode: TipMode; label: StringKey }[] = [
      { mode: "none", label: "bill_pay.tip_none" },
      { mode: "all", label: "bill_pay.tip_all" },
      { mode: "part", label: "bill_pay.tip_part" },
    ];
    return html`<fieldset class="choice" data-leave-tip ?disabled=${this.busy}>
        <legend>${t("bill_pay.leave_tip")}</legend>
        <div class="options">
          ${options.map(({ mode, label }) =>
            this.#radio("leaveTip", mode, t(label), this.tipMode === mode, () =>
              this.#pickTip(mode, asked, cash.pay, cash.preview),
            ),
          )}
        </div>
      </fieldset>
      ${
        this.tipMode === "part"
          ? this.#input(
              "tipAmount",
              t("bill_pay.tip_amount"),
              this.tipAmount,
              (value) => (this.tipAmount = value),
              { required: true, error: error, submit: "[data-pay-confirm]" },
            )
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-bill-pay-dialog": TillBillPayDialog;
  }
}
