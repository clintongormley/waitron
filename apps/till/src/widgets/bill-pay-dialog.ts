import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MONEY_SCALE,
  compareDecimal,
  decimal,
  formatMoney,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  leaveCoordinatorFor,
  type WtDialog,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type {
  AllocationChoice,
  AllocationPreview,
  BillBalance,
  BillPaymentView,
  TillActiveReader,
} from "../api/client.js";
import {
  PAY_WAYS,
  isTakePaymentRefusal,
  moneyPlus,
  paidQuantities,
  refundOffered,
  refundableOf,
  typedAmount,
} from "../state/bill-payment.js";
import type { CardEntry, PayChoice, PayMethod } from "../state/bill-payment.js";
import type { CardProvider } from "./tender-pay.js";

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

/** What the operator asks the server to allocate: the choice, how it is paid, for a card how it is
 * charged, and which of the server's two ways items that cost more than is left are paid. */
export interface PayRequest {
  choice: PayChoice;
  pay: PayMethod;
  card?: CardEntry;
  allocation?: AllocationChoice;
}

/** A refusal's code, the request field it names when it names one, for a tip the venue does not
 * take the most the card can be charged, and the permission an `authorization.not_permitted`
 * names. The app's own codes: `network`, a payment that got no answer; `unread`, a balance that
 * could not be read again; `declined` and `card_network`, a card the reader did not charge. */
export interface PayRefusal {
  code: string;
  field?: string;
  chargeable?: string;
  permission?: string;
  /** A `device.forbidden_action`'s action: `pay` is the reader's. */
  action?: string;
}

/** The payment just taken: the change it handed back, null for a card; for a card still at the
 * reader, the amount it holds on the bill. */
export interface PayTaken {
  change: string | null;
  pending?: string;
}

/** What a refund just did: the amount given back, how, and whether it was keyed on a separate card
 * terminal; a card refund may still be waiting for its provider, or have failed. */
export interface RefundNotice {
  state: "completed" | "pending" | "failed";
  amount: string;
  method: "cash" | "card";
  terminal: boolean;
}

type Field = "lines" | "amount" | "people" | "tendered" | "cardTip" | "tipAmount";
type Allocated = Extract<AllocationPreview, { kind: "allocated" }>;
type Choices = Extract<AllocationPreview, { kind: "choose" }>;
type CashPay = Extract<PayMethod, { method: "cash" }>;
type CashPreview = Allocated & { change: string };
/** A cash confirmation: the cash handed over, and the server's allocation of it. */
interface Cash {
  pay: CashPay;
  preview: CashPreview;
}
type TipMode = "none" | "all" | "part";
interface PaymentDraft {
  way: PayWay;
  picks: [number, number][];
  amount: string;
  people: string;
  method: "cash" | "card";
  tendered: string;
  cardTip: string;
  externalRef: string;
  readerId: string | undefined;
  simulationOutcome: "captured" | "declined";
}
interface TipDraft {
  mode: TipMode;
  amount: string;
}
function amountKey(value: string): string | { invalid: string } {
  const amount = typedAmount(value);
  if (amount === null) return { invalid: value };
  try {
    return toScale(decimal(amount), MONEY_SCALE);
  } catch {
    return { invalid: value };
  }
}

/** The field a refusal is about, or null when it names none the dialog shows. A tip the venue does
 * not take can only come from a card contribution larger than is left, so it is the amount's. */
function refusalField(refusal: PayRefusal, method: PayMethod["method"], way: PayWay): Field | null {
  if (refusal.code === "bill.tip_not_allowed")
    return refusal.chargeable !== undefined && method === "card" && way === "contribution"
      ? "amount"
      : null;
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

function chargeableText(amount: string): string {
  return t("bill_pay.chargeable").replace("{amount}", () => formatMoney(amount, currentLocale()));
}

/** What the dialog says of a refusal: one of the app's own, the most a card can be charged when
 * the venue takes no tips, the till's own sentence for a device not set up for the card reader or
 * for a person who may not take payments, or the server's code in its own words. */
function refusalText(refusal: PayRefusal): string {
  if (isTakePaymentRefusal(refusal)) return t("take_payment.not_permitted");
  switch (refusal.code) {
    case "network":
      return t("bill_pay.unconfirmed");
    case "unread":
      return t("bill_pay.read_failed");
    case "declined":
      return t("bill_pay.card_declined");
    case "card_network":
      return t("bill_pay.card_unreachable");
  }
  if (refusal.code === "device.forbidden_action" && refusal.action === "pay")
    return t("card_reader.not_set_up");
  if (refusal.code === "bill.tip_not_allowed" && refusal.chargeable !== undefined)
    return chargeableText(refusal.chargeable);
  return codeMessage(refusal.code);
}

const PEOPLE = /^[1-9]\d{0,2}$/;

/**
 * Takes part of a bill: chosen items, an amount, or an equal share among the people still to pay,
 * in cash, or by card on the device's reader or keyed by hand. Each way shows what it covers
 * before it acts; the confirmation shows the server's allocation (what the bill takes, the change
 * or the card's charge, the tip) before anything is taken. It holds no request of its own: the app answers `bill-pay-preview`
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

      .choices {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .choices .legend {
        font-weight: var(--wt-font-weight-bold);
      }

      .payments {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      .payments h3 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }

      .payments ol {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .payment {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2) var(--wt-space-4);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .payment-text {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .payment-head {
        font-weight: var(--wt-font-weight-bold);
      }

      .payment-text p {
        font-size: var(--wt-font-size-sm);
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
  /** Set after each refund made from the bill's payments list. */
  @property({ attribute: false }) refunded: RefundNotice | null = null;
  @property({ type: Boolean }) busy = false;
  /** Whether the venue takes tips; without them the dialog asks for and offers none. The app sets
   * it from the till's setup. */
  @property({ type: Boolean }) tipsEnabled = true;
  /** The provider of this device's card reader, which a card is charged on; `none` takes a card on
   * a separate terminal, keyed by hand. */
  @property() cardReader: CardProvider = "none";
  /** False on a device whose profile does not take cash: card is the only method, with a line
   * saying where to take cash. */
  @property({ type: Boolean }) takesCash = true;
  /** The venue's readers a card can be sent to; offered only when there is more than one. */
  @property({ attribute: false }) readers: TillActiveReader[] = [];
  /** The device's own reader, shown chosen until another is picked; it is never sent. */
  @property() defaultReaderId?: string;

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
  /** Unset, the server uses the device's own reader. */
  @state() private chosenReaderId?: string;
  @state() private simulationOutcome: "captured" | "declined" = "captured";
  /** The refusal still shown: it goes when the field it names changes, or at the next request. */
  @state() private shownRefusal: PayRefusal | null = null;

  #leave?: LeaveCoordinator;
  #entry?: DraftScope<PaymentDraft>;
  #entryBaseline?: PaymentDraft;
  readonly #tipId = {};
  #tip?: DraftScope<TipDraft>;
  #tipBaseline?: TipDraft;
  #active = true;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    this.isConnected &&
    this.#active &&
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#entry?.dispose();
    this.#tip?.dispose();
    this.#entry = undefined;
    this.#tip = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #draft(): PaymentDraft {
    return {
      way: this.chosenWay,
      picks: [...this.picks],
      amount: this.typedAmountValue,
      people: this.people,
      method: this.method,
      tendered: this.tendered,
      cardTip: this.cardTip,
      externalRef: this.externalRef,
      readerId: this.chosenReaderId,
      simulationOutcome: this.simulationOutcome,
    };
  }

  #comparable(value: PaymentDraft): string {
    const choice =
      value.way === "items"
        ? [...value.picks].sort((a, b) => a[0] - b[0])
        : value.way === "contribution"
          ? amountKey(value.amount)
          : PEOPLE.test(value.people.trim())
            ? Number(value.people.trim())
            : { invalid: value.people };
    const pay =
      value.method === "cash"
        ? { tendered: amountKey(value.tendered) }
        : {
            tip: this.tipsEnabled ? amountKey(value.cardTip) : null,
            card:
              this.cardReader === "none"
                ? value.externalRef.trim()
                : {
                    readerId: value.readerId,
                    simulation:
                      this.cardReader === "simulator" && value.readerId === undefined
                        ? value.simulationOutcome
                        : null,
                  },
          };
    return JSON.stringify({ way: value.way, choice, method: value.method, pay });
  }

  #restore(value: PaymentDraft): void {
    this.chosenWay = value.way;
    this.picks = new Map(value.picks);
    this.typedAmountValue = value.amount;
    this.people = value.people;
    this.method = value.method;
    this.tendered = value.tendered;
    this.cardTip = value.cardTip;
    this.externalRef = value.externalRef;
    this.chosenReaderId = value.readerId;
    this.simulationOutcome = value.simulationOutcome;
    this.attempted = false;
  }

  #syncDrafts(): void {
    if (!this.isConnected || !this.#active) return;
    this.#leave ??= leaveCoordinatorFor(this);
    if (!this.#entry) {
      this.#entryBaseline ??= this.#draft();
      this.#entry = this.#leave?.register<PaymentDraft>({
        id: this,
        current: () => this.#draft(),
        snapshot: (value) => ({
          ...value,
          picks: value.picks.map(([line, units]) => [line, units]),
        }),
        equal: (a, b) => this.#comparable(a) === this.#comparable(b),
        restore: (value) => this.#restore(value),
      });
      this.#entry?.commit(this.#entryBaseline);
    }
    if (this.asked && this.preview?.kind === "allocated" && this.asked.pay.method === "cash") {
      if (!this.#tip) {
        this.#tipBaseline ??= { mode: this.tipMode, amount: this.tipAmount };
        this.#tip = this.#leave?.register<TipDraft>({
          id: this.#tipId,
          parent: this,
          current: () => ({ mode: this.tipMode, amount: this.tipAmount }),
          snapshot: (value) => ({ ...value }),
          equal: (a, b) =>
            a.mode === b.mode &&
            (a.mode !== "part" ||
              JSON.stringify(amountKey(a.amount)) === JSON.stringify(amountKey(b.amount))),
          restore: (value) => {
            this.tipMode = value.mode;
            this.tipAmount = value.amount;
            this.tipAttempted = false;
          },
        });
        this.#tip?.commit(this.#tipBaseline);
      }
    } else {
      this.#tip?.dispose();
      this.#tip = undefined;
      this.#tipBaseline = undefined;
    }
  }

  #changedDraft(): void {
    this.#entry?.changed();
    this.#tip?.changed();
  }

  #close(event?: Event): void {
    event?.stopPropagation();
    if (event && event.target !== event.currentTarget) return;
    if (!this.isConnected || !this.#active || this.busy) return;
    this.#active = false;
    this.#entry?.dispose();
    this.#tip?.dispose();
    this.#entry = undefined;
    this.#tip = undefined;
    this.#emit("bill-pay-close");
  }

  #requestClose(): void {
    if (!this.isConnected || !this.#active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #back(): void {
    if (!this.isConnected || !this.#active || this.busy) return;
    const proceed = () => {
      this.#tip?.dispose();
      this.#tip = undefined;
      this.#tipBaseline = undefined;
      this.#noTip();
      this.shownRefusal = null;
      this.#emit("bill-pay-edit");
    };
    if (this.#tip) void this.#leave!.request({ scopes: [this.#tipId], reason: "cancel", proceed });
    else proceed();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("way")) this.chosenWay = this.way;
    if (changed.has("takesCash")) this.method = this.takesCash ? "cash" : "card";
    if (changed.has("amount")) this.typedAmountValue = this.amount;
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (changed.has("taken") && this.taken !== null) this.paymentAccepted();
    if (changed.has("busy") && this.busy) {
      if (this.#entryBaseline) this.#entry?.commit(this.#entryBaseline);
      if (this.#tipBaseline) this.#tip?.commit(this.#tipBaseline);
    }
    this.#syncDrafts();
  }

  paymentAccepted(): void {
    this.#startAgain();
    this.#entryBaseline = this.#draft();
    this.#entry?.commit(this.#entryBaseline);
    this.#tip?.dispose();
    this.#tip = undefined;
    this.#tipBaseline = undefined;
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
    const paid = this.balance === null ? undefined : paidQuantities(this.balance).get(lineNo);
    return decimal(paid ?? "0");
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
    const tip = this.tipsEnabled ? typedAmount(this.cardTip) : null;
    const pay: PayMethod = tip === null ? { method: "card" } : { method: "card", addedTip: tip };
    if (this.cardReader !== "none") return { choice, pay, card: this.#readerEntry() };
    const ref = this.externalRef.trim();
    return {
      choice,
      pay,
      card: ref === "" ? { entry: "manual" } : { entry: "manual", externalRef: ref },
    };
  }

  #readerEntry(): CardEntry {
    if (this.cardReader === "simulator" && this.chosenReaderId === undefined)
      return { entry: "reader", simulationOutcome: this.simulationOutcome };
    return this.chosenReaderId === undefined
      ? { entry: "reader" }
      : { entry: "reader", readerId: this.chosenReaderId };
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
    } else if (
      this.tipsEnabled &&
      this.cardTip.trim() !== "" &&
      typedAmount(this.cardTip) === null
    ) {
      errors.set("cardTip", t("bill_pay.tip_invalid"));
    }
    return errors;
  }

  #refusalField(): Field | null {
    return this.shownRefusal === null
      ? null
      : refusalField(this.shownRefusal, this.method, this.chosenWay);
  }

  #refusalMessage(field: Field): string {
    return field === "tendered" ? t("bill_pay.tendered_short") : refusalText(this.shownRefusal!);
  }

  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, this.#refusalMessage(field));
    return errors;
  }

  /** The one message above the action: the generic one while a field is marked, then a refusal
   * that names no field, in its own words. */
  #bottomMessage(fieldErrors: ReadonlyMap<Field, string>, extra?: string): string {
    const parts: string[] = [];
    if (fieldErrors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(refusalText(this.shownRefusal));
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
    if (!this.isConnected || !this.#active || this.busy) return;
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
      .open=${this.#active}
      .heading=${t("bill_pay.title")}
      .dismissible=${!this.busy}
      .beforeClose=${this.#entry ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <div class="body">
        ${this.#balance()}
        ${
          this.taken === null
            ? nothing
            : html`<p class="taken" role="status" data-pay-taken>${this.#takenText(this.taken)}</p>`
        }
        ${
          this.refunded === null
            ? nothing
            : html`<p class="taken" role="status" data-pay-refunded>
                ${this.#refundedText(this.refunded)}
              </p>`
        }
        ${this.#payments()} ${this.#step()}
      </div>
    </wt-dialog>`;
  }

  #takenText(taken: PayTaken): string {
    if (taken.pending !== undefined)
      return t("bill_pay.card_pending").replace("{amount}", () => this.#money(taken.pending!));
    return taken.change === null || compareDecimal(decimal(taken.change), decimal("0")) === 0
      ? t("bill_pay.taken")
      : t("bill_pay.taken_change").replace("{amount}", () => this.#money(taken.change!));
  }

  #refundedText(refunded: RefundNotice): string {
    const key: StringKey =
      refunded.state === "failed"
        ? "bill_refund.failed"
        : refunded.state === "pending"
          ? "bill_refund.pending"
          : refunded.method === "cash"
            ? "bill_refund.done_cash"
            : refunded.terminal
              ? "bill_refund.done_terminal"
              : "bill_refund.done_card";
    return t(key).replace("{amount}", () => this.#money(refunded.amount));
  }

  /** The bill's payments, oldest first, each with a Refund while it has money to give back. */
  #payments(): TemplateResult | typeof nothing {
    const balance = this.balance;
    if (balance === null || balance.payments.length === 0) return nothing;
    return html`<section class="payments" data-pay-payments aria-labelledby="payments-heading">
      <h3 id="payments-heading">${t("bill_pay.payments")}</h3>
      <ol>
        ${balance.payments.map((payment, index) =>
          this.#paymentRow(payment, index + 1, balance.status),
        )}
      </ol>
    </section>`;
  }

  #paymentRow(payment: BillPaymentView, n: number, status: BillBalance["status"]): TemplateResult {
    const STATES: Record<BillPaymentView["state"], StringKey> = {
      received: "bill_pay.state_received",
      pending: "bill_pay.state_pending",
      failed: "bill_pay.state_failed",
      declined: "bill_pay.state_declined",
    };
    const REFUNDS: Record<BillPaymentView["refunds"][number]["state"], StringKey> = {
      completed: "bill_pay.refunded",
      pending: "bill_pay.refund_waiting",
      failed: "bill_pay.refund_failed_row",
    };
    const method = t(payment.method === "cash" ? "tender.cash" : "tender.card");
    const left = refundableOf(payment);
    const leftTotal = moneyPlus(left.applied, left.tip);
    return html`<li class="payment" data-payment=${payment.id}>
      <div class="payment-text">
        <span class="payment-head">
          ${t("bill_pay.payment")
            .replace("{n}", String(n))
            .replace("{method}", () => method)}
          · ${t(STATES[payment.state])}
        </span>
        <p>
          ${t("bill_pay.applied")} ${this.#money(payment.applied)} · ${t("bill_pay.tip")}
          ${this.#money(payment.tip)}
        </p>
        ${payment.refunds.map(
          (refund) =>
            html`<p class="muted" data-payment-refunded>
              ${t(REFUNDS[refund.state]).replace("{amount}", () =>
                this.#money(moneyPlus(refund.appliedAmount, refund.tipAmount)),
              )}
            </p>`,
        )}
        ${
          payment.state === "pending"
            ? html`<p class="muted" data-payment-pending>${t("bill_pay.pending_where")}</p>`
            : nothing
        }
      </div>
      ${
        refundOffered(payment, status)
          ? html`<wt-button
              variant="secondary"
              size="sm"
              data-payment-refund=${payment.id}
              aria-label=${t("bill_pay.refund_label")
                .replace("{n}", String(n))
                .replace("{amount}", () => this.#money(leftTotal))}
              .disabled=${this.busy}
              @click=${() => this.#emit("bill-refund", { paymentId: payment.id })}
            >
              ${t("bill_pay.refund")}
            </wt-button>`
          : nothing
      }
    </li>`;
  }

  /** The form; the server's two ways to pay for items that cost more than is left; or the
   * confirmation of what the server allocated. */
  #step(): TemplateResult {
    if (this.asked === null || this.preview === null) return this.#form();
    return this.preview.kind === "allocated"
      ? this.#confirmStep(this.asked, this.preview)
      : this.#chooseStep(this.asked, this.preview);
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

  #picked(): PayLine[] {
    return this.#offered().filter((line) => this.picks.has(line.lineNo));
  }

  /** What the chosen items come to. */
  #pickedAmount(): Decimal {
    return toScale(
      sumDecimals(
        this.#picked().map((line) => this.#pickAmount(line, this.picks.get(line.lineNo)!)),
      ),
      MONEY_SCALE,
    );
  }

  /** What the way covers, as far as the dialog knows before the server allocates it. */
  #scope(): string {
    switch (this.chosenWay) {
      case "items": {
        const picked = this.#picked();
        if (picked.length === 0) return t("bill_pay.scope_items_none");
        const names = picked
          .map((line) => {
            const shown = this.#shownQuantity(line, this.picks.get(line.lineNo)!);
            return shown === "1" ? line.name : `${line.name} ×${shown}`;
          })
          .join(", ");
        return t("bill_pay.scope_items")
          .replace("{items}", () => names)
          .replace("{amount}", () => this.#money(this.#pickedAmount()));
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
          if (!this.isConnected || !this.#active || this.busy) return;
          pick();
          this.#changedDraft();
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
        if (!this.isConnected || !this.#active || this.busy) return;
        set(event.detail.value);
        this.#changedDraft();
        if (name !== "externalRef") this.#changed(name);
      }}
      @keydown=${(event: KeyboardEvent) => this.#enter(event, opts.submit)}
    ></wt-input>`;
  }

  #form(): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const bottom = this.#bottomMessage(errors);
    return html`<fieldset class="choice" data-pay-way ?disabled=${this.busy}>
        <legend>${t("bill_pay.way")}</legend>
        <div class="options">
          ${PAY_WAYS.map(({ way, label }) =>
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
          @click=${() => this.#requestClose()}
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
      if (!this.isConnected || !this.#active || this.busy) return;
      const next = new Map(this.picks);
      if (next.has(line.lineNo)) next.delete(line.lineNo);
      else next.set(line.lineNo, remaining);
      this.picks = next;
      this.#changedDraft();
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
      if (!this.isConnected || !this.#active || this.busy) return;
      const next = new Map(this.picks);
      next.set(line.lineNo, units + delta);
      this.picks = next;
      this.#changedDraft();
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
          ${
            this.takesCash
              ? this.#radio("method", "cash", t("tender.cash"), this.method === "cash", () => {
                  this.method = "cash";
                })
              : nothing
          }
          ${this.#radio("method", "card", t("tender.card"), this.method === "card", () => {
            this.method = "card";
          })}
        </div>
        ${this.takesCash ? nothing : html`<p class="muted cash-at-till">${t("tender.cash_at_till")}</p>`}
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
          : html`${
              this.tipsEnabled
                ? this.#input(
                    "cardTip",
                    t("bill_pay.card_tip"),
                    this.cardTip,
                    (value) => (this.cardTip = value),
                    { error: errors.get("cardTip"), submit: "[data-pay-continue]" },
                  )
                : nothing
            }
            ${this.cardReader === "none" ? this.#manualCardFields() : this.#readerFields()}`
      }`;
  }

  #manualCardFields(): TemplateResult {
    return this.#input(
      "externalRef",
      t("tender.card_ref"),
      this.externalRef,
      (value) => (this.externalRef = value),
      { submit: "[data-pay-continue]" },
    );
  }

  /** The practice simulator's result, or the reader when the venue has more than one. */
  #readerFields(): TemplateResult | typeof nothing {
    if (this.cardReader === "simulator") {
      const demoReaders = this.readers.filter((reader) => reader.provider === "simulator");
      return html`${
        demoReaders.length === 0
          ? nothing
          : html`<fieldset class="choice" data-pay-reader ?disabled=${this.busy}>
              <legend>${t("bill_pay.reader")}</legend>
              <div class="options">
                ${this.#radio(
                  "reader",
                  "instant",
                  t("card.instant_simulator"),
                  this.chosenReaderId === undefined,
                  () => (this.chosenReaderId = undefined),
                )}
                ${demoReaders.map((reader) =>
                  this.#radio(
                    "reader",
                    reader.id,
                    t("card.demo_reader"),
                    this.chosenReaderId === reader.id,
                    () => (this.chosenReaderId = reader.id),
                  ),
                )}
              </div>
            </fieldset>`
      }
      ${this.chosenReaderId === undefined ? this.#simulationFields() : nothing}`;
    }
    if (this.readers.length < 2) return nothing;
    const shown = this.chosenReaderId ?? this.defaultReaderId;
    return html`<fieldset class="choice" data-pay-reader ?disabled=${this.busy}>
      <legend>${t("bill_pay.reader")}</legend>
      <div class="options">
        ${this.readers.map((reader) =>
          this.#radio(
            "reader",
            reader.id,
            reader.name,
            shown === reader.id,
            () => (this.chosenReaderId = reader.id),
          ),
        )}
      </div>
    </fieldset>`;
  }

  #simulationFields(): TemplateResult {
    return html`<fieldset class="choice" data-pay-simulation ?disabled=${this.busy}>
      <legend>${t("card.simulation_result")}</legend>
      <p class="muted">${t("card.simulation_help")}</p>
      <div class="options">
        ${(["captured", "declined"] as const).map((outcome) =>
          this.#radio(
            "simulation",
            outcome,
            t(outcome === "captured" ? "card.simulation_captured" : "card.simulation_declined"),
            this.simulationOutcome === outcome,
            () => (this.simulationOutcome = outcome),
          ),
        )}
      </div>
    </fieldset>`;
  }

  /** The change and tip together: what "all of the change" leaves as a tip. */
  #changeAndTip(preview: CashPreview): Decimal {
    return moneyPlus(preview.change, preview.tip);
  }

  /** The tip the payment carries before any change is left: the tip of the full price with a
   * tip, which the server adds to whatever is left from the change. */
  #ownTip(cash: Cash): Decimal {
    return subtractDecimal(decimal(cash.preview.tip), decimal(cash.pay.addedTip ?? "0"));
  }

  /** `addedTip` for a whole tip of `tip`, beyond the payment's own tip. */
  #addedTipFor(cash: Cash, tip: string): string {
    const own = this.#ownTip(cash);
    return compareDecimal(own, decimal("0")) === 0
      ? tip
      : toScale(subtractDecimal(decimal(tip), own), MONEY_SCALE);
  }

  #tipErrors(cash: Cash): Map<Field, string> {
    const errors = new Map<Field, string>();
    const most = this.#changeAndTip(cash.preview);
    const least = this.#ownTip(cash);
    const tip = typedAmount(this.tipAmount);
    if (
      tip === null ||
      compareDecimal(decimal(tip), least) <= 0 ||
      compareDecimal(decimal(tip), most) > 0
    )
      errors.set(
        "tipAmount",
        compareDecimal(least, decimal("0")) === 0
          ? t("bill_pay.tip_amount_invalid").replace("{amount}", () => this.#money(most))
          : t("bill_pay.tip_amount_between")
              .replace("{min}", () => this.#money(least))
              .replace("{amount}", () => this.#money(most)),
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

  #pickTip(mode: TipMode, asked: PayRequest, cash: Cash): void {
    this.tipMode = mode;
    this.tipAttempted = false;
    if (mode === "none") this.#askWithTip(asked, cash.pay, undefined);
    if (mode === "all")
      this.#askWithTip(asked, cash.pay, this.#addedTipFor(cash, this.#changeAndTip(cash.preview)));
  }

  /** Takes the payment shown; with part of the change typed as a tip, first checks it and, when
   * it is not the tip shown, asks the server for the allocation with it. */
  async #take(asked: PayRequest, cash: Cash | null): Promise<void> {
    if (!this.isConnected || !this.#active || this.busy) return;
    if (cash !== null && this.tipMode === "part") {
      this.tipAttempted = true;
      if (this.#tipErrors(cash).size > 0) {
        await this.updateComplete;
        await focusFirstInvalid(this.shadowRoot!);
        return;
      }
      const tip = typedAmount(this.tipAmount)!;
      if (compareDecimal(decimal(tip), decimal(cash.preview.tip)) !== 0) {
        this.#askWithTip(asked, cash.pay, this.#addedTipFor(cash, tip));
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
        ? this.#tipErrors(cash)
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
        ${
          this.tipsEnabled
            ? html`<div data-pay-tip>
                <dt>${t("bill_pay.tip")}</dt>
                ${amount(preview.tip)}
              </div>`
            : nothing
        }
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
        this.tipsEnabled &&
        cash !== null &&
        compareDecimal(this.#changeAndTip(cash.preview), decimal("0")) > 0
          ? this.#tipChoice(asked, cash, errors.get("tipAmount"))
          : nothing
      }
      ${
        this.busy && asked.card?.entry === "reader"
          ? html`<p class="muted" role="status" data-pay-collecting>${t("card.collecting")}</p>`
          : nothing
      }
      <wt-form-actions .error=${bottom}>
        ${this.#backButton()}
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

  #backButton(): TemplateResult {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-pay-back
      .disabled=${this.busy}
      @click=${() => this.#back()}
    >
      ${t("action.back")}
    </wt-button>`;
  }

  /**
   * The server's ways to pay for items that cost more than is left (design §3.3), each a button
   * with its amounts; pressing one asks for its allocation. A venue that takes no tips is never
   * offered the full price with a tip; the server offers only that one while a card is at the
   * reader, so when it is all there is, the card in progress is what holds the items.
   */
  #chooseStep(asked: PayRequest, preview: Choices): TemplateResult {
    const options = preview.options.filter(
      (option) => this.tipsEnabled || option.choice !== "full_with_tip",
    );
    const bottom = this.#bottomMessage(
      new Map(),
      options.length === 0 ? codeMessage("order.payment_in_flight") : undefined,
    );
    return html`<p class="scope" data-pay-scope>${this.#scope()}</p>
      ${
        options.length === 0
          ? nothing
          : html`<div class="choices" role="group" aria-labelledby="choices" data-pay-choices>
                <p class="legend" id="choices">${t("bill_pay.choice_legend")}</p>
                ${options.map(
                  (option) =>
                    html`<wt-button
                      variant="secondary"
                      data-pay-choice=${option.choice}
                      .disabled=${this.busy}
                      @click=${() => this.#choose(asked, option.choice)}
                    >
                      ${this.#choiceLabel(option)}
                    </wt-button>`,
                )}
              </div>
              <p class="muted" data-pay-choose-note>${t("bill_pay.choose_later")}</p>`
      }
      <wt-form-actions .error=${bottom}>${this.#backButton()}</wt-form-actions>`;
  }

  #choiceLabel(option: Choices["options"][number]): string {
    const amount = this.#money(moneyPlus(option.applied, option.tip));
    if (option.choice === "full_with_tip")
      return t("bill_pay.choice_tip")
        .replace("{amount}", () => amount)
        .replace("{tip}", () => this.#money(option.tip));
    const pool = toScale(
      subtractDecimal(this.#pickedAmount(), decimal(option.applied)),
      MONEY_SCALE,
    );
    return t("bill_pay.choice_pool")
      .replace("{amount}", () => amount)
      .replace("{pool}", () => this.#money(pool));
  }

  #choose(asked: PayRequest, allocation: AllocationChoice): void {
    if (!this.isConnected || !this.#active || this.busy) return;
    this.shownRefusal = null;
    this.#noTip();
    this.#emit("bill-pay-preview", { ...asked, allocation } satisfies PayRequest);
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
              this.#pickTip(mode, asked, cash),
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
