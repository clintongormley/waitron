import { billPayDialogStyles } from "./bill-pay-dialog-styles.js";
import type { TablePayQuote, TablePayQuoteRequest } from "../state/table-pay-quote.js";
import { paymentSlipButton, type PaymentSlipAction } from "./pay-equipment.js";
import {
  outsideCardFields,
  outsideCardValues,
  outsideCardStyles,
  outsideCardSummary,
} from "./outside-card.js";
import type { OutsideCardDetails } from "../api/payments-api.js";
import { choiceRowStyles } from "./choice-styles.js";
import {
  quietEquipmentButton,
  quietPay,
  quietPayStyles,
  quietTenderActions,
  quietTipBreakdown,
  quietWays,
} from "./quiet-pay.js";
import { helpAnchorStyles, helpBadge } from "./help-badge.js";
import { recoveryLink } from "./recovery-refusal.js";
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MONEY_SCALE,
  compareDecimal,
  decimal,
  equalShare,
  formatMoney,
  multiplyDecimal,
  sumDecimals,
  toScale,
  type Decimal,
} from "@waitron/shared";
import {
  baseStyles,
  FormFeedback,
  bottomMessage,
  formatDecimalInput,
  submitOnEnter,
  leaveCoordinatorFor,
  type WtButton,
  type WtDialog,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import {
  payNotice,
  payNoticeStyles,
  payScanView,
  readerButtonLabel,
  type SheetView,
} from "./pay-equipment.js";
import {
  cardWaitingView,
  readerStopControl,
  readerStopPending,
  sentCard,
  type BillReaderStopStatus,
  type SentCard,
} from "./card-waiting.js";
import type { PayEquipmentRole, PayNotice } from "./pay-equipment.js";
import { guestsStepper, guestsStepperStyles, guestsText, parseGuestCount } from "./guest-count.js";
import { trackDialog } from "./track-dialog.js";
import { nextShareLabel } from "./next-share-label.js";
import { splitEquallyScreen, splitOpening, type SplitOpening } from "./split-equally-pay.js";
import { currentLocale, fill, t, vatSplitText } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type {
  AdvanceTicket,
  AllocationPreview,
  BillBalance,
  BillPaymentView,
} from "../api/payments-api.js";
import type { DeviceEquipment, TillActiveReader } from "../api/device-session-api.js";
import {
  BILL_PAY_WAYS,
  PAYMENT_STATES,
  moneyPlus,
  refundOffered,
  refundableOf,
  typedAmount,
  typedMoney,
} from "../state/bill-payment.js";
import type { CardEntry, PayChoice, PayMethod } from "../state/bill-payment.js";
import type { DeferredOffer } from "../state/deferred-close.js";
import { portionGroups } from "../state/portion-groups.js";
import { overpaidOf } from "../state/bill-state.js";
import { ShareRun } from "../state/share-run.js";
import { itemsChoiceOf, paysOnNewBill } from "../state/pay-for-items.js";
import {
  heldForEquipment,
  payRowWantsOpen,
  readyPayReader,
  type FixedReader,
} from "../state/pay-equipment.js";
import type { CardProvider, ReceiptGuestsDetail } from "./tender-pay.js";
import { refusalText, type PayRefusal } from "./pay-refusal.js";

export type { PayRefusal } from "./pay-refusal.js";

export type PayWay = PayChoice["kind"];
/** `manual` is a card keyed on a terminal the till does not drive; it is sent as a card. */
type Method = "cash" | "card" | "manual";

/** A dish of the bill as the dialog offers it. */
export interface PayLine {
  lineNo: number;
  lineId: string;
  name: string;
  /** Its quantity as shown. */
  quantity: string;
  /** The dish with its extras. */
  total: string;
  /** One unit's price when the dish can be paid for a unit at a time; null when only whole. */
  unitTotal: string | null;
  portionKey?: string;
}

/** What the operator asks the server to allocate: the choice, how it is paid, and for a card how it
 * is charged. */
export interface PayRequest {
  choice: PayChoice;
  pay: PayMethod;
  card?: CardEntry;
}

/** `bill-pay-confirm`'s detail: on a handheld, a reader card names the reader to charge. */
export type BillPayConfirmDetail = ReceiptGuestsDetail & {
  readerId?: string;
  ownReceipt?: true;
  quote?: TablePayQuote;
};

/** The payment just taken: the change it handed back, null for a card; for a card still at the
 * reader, the amount it holds on the bill; on a handheld, for a card charged on a reader, the
 * reader it was sent to and what it charged. `settled` marks a card the payment form's balance
 * already includes. */
export interface PayTaken {
  change: string | null;
  slipPaymentId?: string;
  /** The bill holding `slipPaymentId` when it is not the dialog's: Pay for items' new bill. */
  slipBillId?: string;
  pending?: string;
  settled?: true;
  reader?: string;
  charged?: string;
}

/** What a refund just did: the amount given back, how, and whether it was keyed on a separate card
 * terminal; a card refund may still be waiting for its provider, or have failed. */
export interface RefundNotice {
  refusalReason?: "provider_balance_unavailable";
  state: "completed" | "pending" | "failed";
  amount: string;
  method: "cash" | "card";
  terminal: boolean;
}

type Field = "lines" | "amount" | "people" | "tendered" | "cardTip" | "tipAmount" | "guests";
type CashPay = Extract<PayMethod, { method: "cash" }>;
type CashPreview = AllocationPreview & { change: string };
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
  method: Method;
  tendered: string;
  cardTip: string;
  externalRef: string;
  outside: OutsideCardDetails;
  readerId: string | undefined;
  simulationOutcome: "captured" | "declined" | "attempting";
}
interface TipDraft {
  mode: TipMode;
  amount: string;
}
function amountKey(value: string): string | { invalid: string } {
  return typedMoney(value) ?? { invalid: value };
}

/** The field a refusal is about, or null when it names none the dialog shows. A tip the venue does
 * not take can only come from a card contribution larger than is left, so it is the amount's. */
function refusalField(
  refusal: PayRefusal,
  method: Method,
  way: PayWay,
  guestsShown: boolean,
): Field | null {
  if (refusal.code === "bill.tip_not_allowed")
    return refusal.chargeable !== undefined && method !== "cash" && way === "contribution"
      ? "amount"
      : null;
  if (refusal.code !== "management.request_invalid") return null;
  switch (refusal.field) {
    case "amount":
      return way === "contribution" ? "amount" : null;
    case "shareOf":
      return "people";
    case "guestCount":
      return guestsShown ? "guests" : null;
    case "tendered":
      return method === "cash" ? "tendered" : null;
    // A refused cash tip comes back to the form, which does not show the tip it was left from.
    case "addedTip":
      return method !== "cash" ? "cardTip" : null;
    default:
      return null;
  }
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
    choiceRowStyles,
    quietPayStyles,
    outsideCardStyles,
    helpAnchorStyles,
    guestsStepperStyles,
    payNoticeStyles,
    billPayDialogStyles,
  ];

  /** The bill's total, received, reserved and outstanding; null while it is being read. */
  @property({ attribute: false }) balance: BillBalance | null = null;
  /** The box offers this till "Check the time": a clock refusal points at it. */
  @property({ attribute: false }) checkTimeOffered = false;
  /** The bill's dishes. */
  @property({ attribute: false }) lines: PayLine[] = [];
  /** The way the dialog opens on; unset, Whole bill. */
  @property() way?: PayWay;
  /** A contribution's starting amount. */
  @property() amount = "";
  /** What the last `bill-pay-preview` asked; with {@link preview}, the dialog asks for
   * confirmation. */
  @property({ attribute: false }) asked: PayRequest | null = null;
  @property({ attribute: false }) preview: AllocationPreview | null = null;
  @property() quoteContext = "";
  @property({ attribute: false }) checkedQuote: TablePayQuote | null = null;
  @property({ attribute: false }) refusal: PayRefusal | null = null;
  /** Set after each payment taken: the dialog says so and starts its form again. */
  @property({ attribute: false }) taken: PayTaken | null = null;
  /** Set after each refund made from the bill's payments list. */
  @property({ attribute: false }) refunded: RefundNotice | null = null;
  @property({ type: Boolean }) showsRefundAcknowledgment = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) sumUpConnected = false;
  @property({ attribute: false }) readerStop: BillReaderStopStatus | null = null;
  @property({ attribute: false }) readerStopRefusal: PayRefusal | null = null;
  @property({ attribute: false }) paymentSlip?: PaymentSlipAction;
  /** The bill has no invoice and is set for a simplified one, so a part payment may have its own. */
  @property({ type: Boolean }) ownReceiptOffered = false;
  /** The answer to the own-receipt question; null while unanswered. */
  @state() private ownReceipt: boolean | null = null;
  @property({ type: Boolean }) confirmationLocked = false;
  /** Why Items is shown disabled, under the choices; null while it is offered. */
  @property({ attribute: false }) itemsBarred: StringKey | null = null;
  /** A Counter bill with no receipt; read with a `placed` balance. */
  @property({ type: Boolean }) sentWithoutReceipt = false;
  /** A Counter order: an equal share asks for the people still to pay as a typed count, where a
   * table's Pay opens Split equally. */
  @property({ type: Boolean }) counter = false;
  /** The printed bill this window paid from was credited, as the till words it; null if not. */
  @property({ attribute: false }) credited: string | null = null;
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
  @property({ type: Boolean }) asksGuests = false;
  /** The count the guests field starts on; null starts it empty. */
  @property({ attribute: false }) receiptGuests: number | null = null;
  /** A handheld offers Whole bill, and a card on a separate terminal as a method of its own. */
  @property({ type: Boolean }) handheld = false;
  /** On a handheld, what a sticker's tap or scan did while the sheet is open. */
  @property({ attribute: false }) notice: PayNotice | null = null;
  /** On a handheld, whether the profile takes a card on a reader, whether or not one is held. */
  @property({ type: Boolean }) takesReaderCard = false;
  /** On a handheld, whether the profile takes a card keyed on a separate terminal. */
  @property({ type: Boolean }) takesManualCard = false;
  /** On a handheld, the table the title names. */
  @property() tableName = "";
  @property({ attribute: false }) openingBack = "";
  @property({ type: Boolean }) quiet = false;
  @property() billName = "";
  /** On a handheld, the reader and printer row's inputs, passed straight to it. */
  @property({ attribute: false }) equipment: DeviceEquipment | null = null;
  @property({ attribute: false }) equipmentSaving: { role: PayEquipmentRole; id: string } | null =
    null;
  @property({ attribute: false }) equipmentErrors: Partial<Record<PayEquipmentRole, string>> = {};
  @property({ attribute: false }) readerReason: string | null = null;
  @property({ attribute: false }) readerHint: string | null = null;
  @property({ type: Boolean }) canScan = false;
  @property({ type: Boolean }) askNfc = false;
  /** An equipment change is out: nothing is taken until it is answered. */
  @property({ type: Boolean }) equipmentBusy = false;
  @property({ attribute: false }) fixedReader: FixedReader | null = null;
  /** The phone is picking up a reader by itself; the row does not open for the missing reader
   * until that pick has answered. */
  @property({ type: Boolean }) autoPicking = false;
  @property({ attribute: false }) deferredOffered: DeferredOffer = { state: "hidden" };

  @state() private chosenWay: PayWay = "whole";
  @state() private picks = new Map<number, number>();
  @state() private typedAmountValue = "";
  @state() private people = "";
  @state() private method: Method = "cash";
  @state() private tendered = "";
  @state() private cardTip = "";
  @state() private externalRef = "";
  @state() private outside: OutsideCardDetails = {};
  @state() private tipMode: TipMode = "none";
  @state() private tipAmount = "";
  readonly #feedback = new FormFeedback(this);
  @state() private tipAttempted = false;
  /** Unset, the server uses the device's own reader. */
  @state() private chosenReaderId?: string;
  @state() private simulationOutcome: "captured" | "declined" | "attempting" = "captured";
  get #shownRefusal(): PayRefusal | null {
    return this.#feedback.shows("refusal")
      ? (this.refusal ??
          (this.#opening && !this.quietEntry ? (this.#openingQuote()?.refusal ?? null) : null))
      : null;
  }
  /** The waiter's own guests value; undefined follows {@link receiptGuests}. */
  @state() private guestsEntry?: string;
  @state() private guestsAttempted = false;
  @state() private askingSecondCard = false;
  @state() private rowOpen = false;
  @state() private quietEntry = false;
  @state() private quietTip = false;
  #quoteKey = "";
  #quotedRequest: TablePayQuoteRequest | null = null;
  #quoteTimer?: ReturnType<typeof setTimeout>;
  /** The row's QR has put the camera in place of the body. */
  @state() private scanning = false;
  /** On a handheld, after a payment that leaves money owing: the sheet offers the next guest in
   * place of the form. */
  @state() private nextOffered = false;
  /** Split equally is open over the form. */
  @state() private splitShown: SplitOpening | null = null;
  #rowWanted = false;
  #run = new ShareRun();
  /** Take the next was pressed since the payment last taken. */
  #leftTaken = false;
  /** The payment last taken paid for items, which wait for its card on a bill of their own. */
  #takenForItems = false;

  #leave?: LeaveCoordinator;
  #entry?: DraftScope<PaymentDraft>;
  #entryBaseline?: PaymentDraft;
  readonly #tipId = {};
  #tip?: DraftScope<TipDraft>;
  #tipBaseline?: TipDraft;
  #active = true;
  /** On a handheld, the card payment out on a reader. */
  #sent: SentCard | null = null;
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
    clearTimeout(this.#quoteTimer);
    this.#quoteKey = "";
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
      outside: this.outside,
      readerId: this.chosenReaderId,
      simulationOutcome: this.simulationOutcome,
    };
  }

  #comparable(value: PaymentDraft): string {
    const choice =
      value.way === "whole"
        ? null
        : value.way === "items"
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
            card: this.#keyed(value.method)
              ? {
                  reference: value.externalRef.trim(),
                  ...outsideCardValues(value.outside, this.sumUpConnected),
                }
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
    this.outside = value.outside;
    this.chosenReaderId = value.readerId;
    this.simulationOutcome = value.simulationOutcome;
    this.#feedback.attempted = false;
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
    if (this.asked && this.preview && this.asked.pay.method === "cash") {
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
    this.askingSecondCard = false;
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
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("navigation");
  }

  #back(): void {
    if (!this.isConnected || !this.#active || this.busy || this.confirmationLocked) return;
    const proceed = () => {
      this.#tip?.dispose();
      this.#tip = undefined;
      this.#tipBaseline = undefined;
      this.#noTip();
      this.guestsAttempted = false;
      this.ownReceipt = null;
      this.#feedback.dismiss("refusal");
      this.#emit("bill-pay-edit");
    };
    if (this.#tip)
      void this.#leave!.request({ scopes: [this.#tipId], reason: "navigation", proceed });
    else proceed();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("way") || changed.has("handheld")) this.chosenWay = this.way ?? "whole";
    if (this.handheld) {
      const offered = this.#methods();
      if (changed.has("handheld") || !offered.includes(this.method))
        this.method = offered[0] ?? "card";
    } else if (changed.has("takesCash")) this.method = this.takesCash ? "cash" : "card";
    if (changed.has("amount")) this.typedAmountValue = this.amount;
    if (!this.quiet && changed.has("asked") && this.asked === null) this.ownReceipt = null;
    const billBefore = (changed.get("balance") as BillBalance | null | undefined)?.workingOrderId;
    if (
      billBefore !== undefined &&
      this.balance !== null &&
      billBefore !== this.balance.workingOrderId
    ) {
      // Another bill's dishes carry other ids and numbers, so a choice from the bill left is not
      // carried across, and nothing chosen there is marked missing here.
      this.picks = new Map();
      this.ownReceipt = null;
      this.#feedback.reset();
    }
    if (!this.busy && this.asked === null && !this.confirmationLocked) {
      // A line moved back from a failed Pay for items keeps its id but takes a new line number.
      const before = (changed.get("lines") as PayLine[] | undefined) ?? this.lines;
      const known = new Set(before.map((line) => line.lineNo));
      const unitsById = new Map(
        before.flatMap((line) => {
          const units = this.picks.get(line.lineNo);
          return units === undefined ? [] : [[line.lineId, units] as const];
        }),
      );
      const picks = new Map<number, number>();
      for (const line of this.lines) {
        const units = known.has(line.lineNo)
          ? this.picks.get(line.lineNo)
          : unitsById.get(line.lineId);
        if (units !== undefined) picks.set(line.lineNo, Math.min(units, this.#units(line)));
      }
      this.picks = picks;
    }
    if (changed.has("refusal")) {
      this.#feedback.newRefusal();
      const shownPending = (changed.get("taken") as PayTaken | null | undefined)?.pending;
      if (
        (this.#run.cardInProgress || shownPending !== undefined) &&
        (this.refusal?.code === "declined" || this.refusal?.code === "payment_failed")
      )
        this.#endRun();
    }
    if (changed.has("taken") && this.taken?.settled === true)
      this.#run.received(changed.get("taken") as PayTaken);
    if (changed.has("taken") && this.taken !== null) {
      const asked = (changed.has("asked") ? changed.get("asked") : this.asked) as PayRequest | null;
      this.#takenForItems = asked?.choice.kind === "items";
      this.#accept(this.taken);
    }
    if (changed.has("refunded") && this.refunded !== null) this.#endRun();
    if (changed.has("balance") && !this.#owing()) this.nextOffered = false;
    const wanted = this.#rowWantsOpen();
    if (wanted && !this.#rowWanted) this.rowOpen = true;
    this.#rowWanted = wanted;
    if (changed.has("busy") && !this.busy) this.#sent = null;
    if (changed.has("busy") && this.busy) {
      if (this.#entryBaseline) this.#entry?.commit(this.#entryBaseline);
      if (this.#tipBaseline) this.#tip?.commit(this.#tipBaseline);
    }
    this.#syncDrafts();
  }

  /** The app has put a refusal under one of the row's fields: the row opens so it shows. */
  openEquipmentRow(): void {
    this.rowOpen = true;
  }

  paymentAccepted(): void {
    this.ownReceipt = null;
    this.#accept(null);
  }

  /** Whether the sheet still shows the payment last taken as it was answered: Take the next not
   * pressed, and nothing changed in the form since. */
  get showsTaken(): boolean {
    return (
      this.taken !== null &&
      !this.#leftTaken &&
      (this.#entryBaseline === undefined ||
        this.#comparable(this.#draft()) === this.#comparable(this.#entryBaseline))
    );
  }

  /** A card in progress, shown as `taken`, ended after the sheet moved on. Charged, the run no
   * longer waits on it; not charged, a run that counted it ends, and the count it lowered goes
   * only while the form is off screen. */
  cardEnded(taken: PayTaken, charged: boolean): void {
    if (!this.#run.counts(taken)) return;
    if (charged) return this.#run.received(taken);
    if (this.nextOffered && this.#dropLoweredCount()) {
      this.#entryBaseline = this.#draft();
      this.#entry?.commit(this.#entryBaseline);
    }
    this.#run.end();
  }

  /** Only the `taken` that arrives counts toward the run of shares, so the app's own earlier call
   * counts nothing. */
  #accept(taken: PayTaken | null): void {
    this.#leftTaken = false;
    this.#startAgain();
    if (this.handheld && taken !== null) this.#offerNext(taken);
    this.#entryBaseline = this.#draft();
    this.#entry?.commit(this.#entryBaseline);
    this.#tip?.dispose();
    this.#tip = undefined;
    this.#tipBaseline = undefined;
  }

  /** The run of shares counts the one just paid, a card still in progress included, the form
   * holds one fewer, and the next guest is offered while money is owing. A card in progress that
   * is then received was counted already. */
  #offerNext(taken: PayTaken): void {
    this.#run.taken(taken);
    const left = this.#sharesLeft();
    if (left > 0) this.people = String(left);
    this.nextOffered = this.#owing();
  }

  #owing(): boolean {
    return (
      this.balance !== null && compareDecimal(decimal(this.balance.outstanding), decimal("0")) > 0
    );
  }

  /** A refund gives a share back, so the count the run lowered no longer holds. */
  #endRun(): void {
    this.#dropLoweredCount();
    this.#run.end();
    this.nextOffered = false;
  }

  /** Clears the count the run lowered, if the form still holds it. */
  #dropLoweredCount(): boolean {
    const left = this.#sharesLeft();
    if (left === 0 || this.people !== String(left)) return false;
    this.people = "";
    return true;
  }

  #sharesLeft(): number {
    return this.chosenWay === "share" ? this.#run.left : 0;
  }

  #startAgain(): void {
    this.splitShown = null;
    this.ownReceipt = null;
    this.picks = new Map();
    this.typedAmountValue = "";
    this.people = "";
    this.tendered = "";
    this.cardTip = "";
    this.externalRef = "";
    this.outside = {};
    const refusalDismissed = this.#shownRefusal === null;
    this.#feedback.reset();
    if (refusalDismissed) this.#feedback.dismiss("refusal");
    this.guestsEntry = undefined;
    this.guestsAttempted = false;
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

  /** The units of `line` that can be picked: one when it is paid only whole. */
  #units(line: PayLine): number {
    return line.unitTotal === null ? 1 : Number(line.quantity);
  }

  #pickAmount(line: PayLine, units: number): Decimal {
    return line.unitTotal === null
      ? decimal(line.total)
      : toScale(multiplyDecimal(decimal(line.unitTotal), decimal(String(units))), MONEY_SCALE);
  }

  #shownQuantity(line: PayLine, units: number): string {
    return line.unitTotal === null
      ? formatDecimalInput(line.quantity, currentLocale())
      : String(units);
  }

  #choice(): PayChoice {
    switch (this.chosenWay) {
      case "whole":
        return { kind: "whole" };
      case "items":
        return itemsChoiceOf(this.lines, this.picks);
      case "contribution":
        return { kind: "contribution", amount: typedAmount(this.typedAmountValue)! };
      case "share":
        return { kind: "share", shareOf: Number(this.people.trim()) };
    }
  }

  #request(method = this.method): PayRequest {
    const choice = this.#choice();
    if (method === "cash")
      return { choice, pay: { method: "cash", tendered: typedAmount(this.tendered)! } };
    const tip = this.tipsEnabled ? typedAmount(this.cardTip) : null;
    const pay: PayMethod = tip === null ? { method: "card" } : { method: "card", addedTip: tip };
    if (!this.#keyed(method)) return { choice, pay, card: this.#readerEntry() };
    const ref = this.externalRef.trim();
    return {
      choice,
      pay,
      card: {
        entry: "manual",
        ...(ref === "" ? {} : { externalRef: ref }),
        ...outsideCardValues(this.outside, this.sumUpConnected),
      },
    };
  }

  /** Whether a card method is keyed on a separate terminal: Other card machine on a handheld, and
   * a till's card when the till has no reader. */
  #keyed(method: Method): boolean {
    return method === "manual" || (!this.handheld && this.cardReader === "none");
  }

  /** The methods a handheld offers, in the order shown. */
  #methods(): Method[] {
    return [
      ...(this.takesReaderCard ? (["card"] as const) : []),
      ...(this.takesCash ? (["cash"] as const) : []),
      ...(this.takesManualCard ? (["manual"] as const) : []),
    ];
  }

  #canAsk(): boolean {
    if (this.chosenWay === "whole" && !this.#owing()) return false;
    if (this.chosenWay === "share" && this.#splitsOnScreen && !PEOPLE.test(this.people.trim()))
      return false;
    return !this.handheld || this.#methods().length > 0;
  }

  #readyReader(): FixedReader | null {
    return readyPayReader(this.equipment, this.fixedReader);
  }

  /** A locked confirmation resends the original request, its reader included, so no equipment
   * holds it. */
  #heldForEquipment(method: Method): boolean {
    return this.handheld && !this.confirmationLocked && heldForEquipment(method === "card", this);
  }

  #rowWantsOpen(): boolean {
    return this.handheld && !this.autoPicking && payRowWantsOpen(this.equipment, this.fixedReader);
  }

  #readerEntry(): CardEntry {
    if (this.cardReader === "simulator")
      return { entry: "reader", simulationOutcome: this.simulationOutcome };
    // A handheld names its reader when the payment is taken (`bill-pay-confirm`), not here.
    if (this.handheld) return { entry: "reader" };
    return this.chosenReaderId === undefined
      ? { entry: "reader" }
      : { entry: "reader", readerId: this.chosenReaderId };
  }

  #ownErrors(method = this.method): Map<Field, string> {
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
    if (method === "cash") {
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
    const field =
      this.#shownRefusal === null
        ? null
        : refusalField(
            this.#shownRefusal,
            this.method,
            this.chosenWay,
            this.#receiptQuote() !== null && this.#guestsShown(this.#receiptQuote()!),
          );
    return field === "people" && this.#splitsOnScreen ? null : field;
  }

  #refusalMessage(field: Field): string {
    return field === "tendered"
      ? t("bill_pay.tendered_short")
      : refusalText(this.#shownRefusal!, { checkTime: this.checkTimeOffered, billPayment: true });
  }

  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, this.#refusalMessage(field));
    return errors;
  }

  /** The one message above the action: the generic one while a field is marked, then a refusal
   * that names no field, in its own words. */
  #bottomMessage(fieldErrors: ReadonlyMap<Field, string>): string {
    const refusal = this.#shownRefusal;
    return bottomMessage(
      this.#feedback.message({}, new Set(fieldErrors.keys()), t("form.fix_fields")),
      this.#feedback.message(
        {
          refusal:
            refusal !== null && this.#refusalField() === null
              ? refusalText(refusal, { checkTime: this.checkTimeOffered, billPayment: true })
              : undefined,
        },
        new Set(),
        t("form.fix_fields"),
      ),
    );
  }

  #changed(field: Field): void {
    if (field === "amount" || field === "people" || field === "lines") this.ownReceipt = null;
    if (this.#refusalField() === field) this.#feedback.dismiss("refusal");
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    if (!this.isConnected || !this.#active || this.busy || !this.#canAsk()) return;
    if (this.#heldForEquipment(this.method)) return;
    this.#feedback.press("refusal");
    if (this.#ownErrors().size > 0) {
      await this.#feedback.focus(this.shadowRoot!);
      return;
    }
    if (this.method !== "cash" && !this.confirmationLocked && this.#cardInProgress()) {
      this.askingSecondCard = true;
      await this.#focusButton("[data-pay-card-ask-take]");
      return;
    }
    this.#send();
  }

  async #focusButton(selector: string): Promise<void> {
    await this.updateComplete;
    const host = this.shadowRoot!.querySelector<WtButton>(selector)!;
    await host.updateComplete;
    host.shadowRoot!.querySelector("button")!.focus();
  }

  async #backFromSecondCard(): Promise<void> {
    this.askingSecondCard = false;
    await this.#focusButton("[data-quiet-pay-card], [data-pay-continue]");
  }

  #cardInProgress(): boolean {
    return (this.balance?.payments ?? []).some(
      (payment) => payment.method === "card" && payment.state === "pending",
    );
  }

  #send(): void {
    this.askingSecondCard = false;
    this.#noTip();
    if (this.#opening && !this.quietEntry) {
      const quote = this.#openingQuote();
      if (quote?.preview != null) void this.#take(quote.request.asked, quote.preview, null, quote);
      return;
    }
    this.#emit("bill-pay-preview", this.#request());
  }

  #takeSecondCard(): void {
    if (!this.isConnected || !this.#active || this.busy || !this.askingSecondCard) return;
    this.#send();
  }

  #secondCardAsk(): TemplateResult {
    return html`<div class="tone" role="alert" data-pay-card-ask>
      <p class="tone-body">${t("bill_pay.card_in_progress_ask")}</p>
      <div class="ask-actions">
        <wt-button
          variant="secondary"
          data-pay-card-ask-back
          .disabled=${this.busy}
          @click=${() => void this.#backFromSecondCard()}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button
          variant="primary"
          data-pay-card-ask-take
          .disabled=${this.busy}
          @click=${() => this.#takeSecondCard()}
        >
          ${t("bill_pay.card_in_progress_take")}
        </wt-button>
      </div>
    </div>`;
  }

  get #opening(): boolean {
    return (
      this.quiet &&
      overpaidOf(this.balance) === null &&
      !this.showsRefundAcknowledgment &&
      !this.scanning &&
      !this.nextOffered &&
      !this.confirmationLocked &&
      this.taken === null &&
      this.preview === null &&
      !this.askingSecondCard
    );
  }

  #quoteRequest(): TablePayQuoteRequest | null {
    const errors = this.#ownErrors("card");
    const invalidTip = errors.delete("cardTip");
    const card = !invalidTip && (this.handheld ? this.takesReaderCard : this.cardReader !== "none");
    if (
      !this.quoteContext ||
      !this.#owing() ||
      errors.size > 0 ||
      (!card && !this.takesCash) ||
      (this.chosenWay === "items" && this.itemsBarred !== null)
    )
      return null;
    return { context: this.quoteContext, asked: this.#request("card"), card, cash: this.takesCash };
  }

  #openingQuote(): TablePayQuote | null {
    const quote = this.checkedQuote;
    const request = this.#quoteRequest();
    return quote !== null &&
      request !== null &&
      quote.request === this.#quotedRequest &&
      this.#quoteKey === JSON.stringify(request)
      ? quote
      : null;
  }

  #receiptQuote(): AllocationPreview | null {
    if (this.preview !== null || this.quietEntry) return this.preview;
    const quote = this.checkedQuote;
    return quote?.request.context === this.quoteContext &&
      JSON.stringify(quote.request.asked.choice) === JSON.stringify(this.#choice())
      ? (quote.preview ?? quote.cash)
      : null;
  }

  override updated(): void {
    if (this.busy || !this.#opening || this.quietEntry) return;
    const request = this.#quoteRequest();
    const key = request === null ? "" : JSON.stringify(request);
    if (this.#quoteKey === key) return;
    clearTimeout(this.#quoteTimer);
    const wait = this.#quoteKey === "" ? 0 : 150;
    this.#quoteKey = key;
    this.#quotedRequest = request;
    if (request !== null)
      this.#quoteTimer = setTimeout(() => {
        if (this.busy) this.#quoteKey = "";
        else this.#emit("bill-pay-quote", request);
      }, wait);
  }

  override render() {
    const split = this.#splitScreen();
    const opening = this.#opening || split !== null;
    const view = opening
      ? undefined
      : this.showsRefundAcknowledgment
        ? { body: html`<slot name="refund-acknowledgment"></slot>`, actions: nothing }
        : this.scanning
          ? payScanView(this, () => (this.scanning = false), this.handheld ? this.notice : null)
          : (this.#cardWaiting() ?? this.#body());
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.#active}
      .fullScreen=${opening}
      .heading=${opening ? "" : this.#heading()}
      .ariaLabel=${opening ? t("action.pay") : ""}
      .dismissible=${!this.busy}
      .beforeClose=${this.#entry ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      ${
        split !== null
          ? split
          : view === undefined
            ? this.#quietPay()
            : html` <div class="body">
                  ${this.credited === null ? nothing : html`<p class="credited" role="status" data-pay-credited>${this.credited}</p>`}
                  ${view.body} ${this.#readerStopControl()}
                </div>
                ${view.actions}`
      }
    </wt-dialog>`;
  }

  #quietPay(): TemplateResult {
    const quote = this.#openingQuote();
    const checked = this.quietEntry ? null : quote?.preview;
    const cashChecked = this.quietEntry ? null : quote?.cash;
    const receipt = this.#receiptQuote();
    const guests = receipt !== null && this.#guestsShown(receipt);
    const ownReceipt = receipt !== null && this.#ownReceiptAsked(receipt);
    const receiptIncomplete =
      (ownReceipt && this.ownReceipt === null) || (guests && this.#guestsInvalid());
    const base = checked?.applied ?? cashChecked?.applied ?? this.#quietAmount();
    const card = this.handheld ? this.takesReaderCard : this.cardReader !== "none";
    const acceptsTip = this.quietEntry ? this.method !== "cash" : card;
    const tip =
      this.tipsEnabled && acceptsTip
        ? checked && compareDecimal(decimal(checked.tip), decimal("0")) > 0
          ? checked.tip
          : typedMoney(this.cardTip)
        : null;
    const includingTip = (value: string) =>
      this.#money(tip === null ? value : moneyPlus(value, tip));
    const amount =
      checked?.charged != null
        ? this.#money(checked.charged)
        : base === null
          ? ""
          : includingTip(base);
    const reserved = this.balance?.reserved;
    const own = this.#feedback.attempted ? this.#ownErrors() : new Map<Field, string>();
    if (guests && this.guestsAttempted && this.#guestsInvalid())
      own.set("guests", t("seat.guest_count_invalid"));
    const errors = this.#fieldErrors(own);
    const manual = this.takesManualCard || (!this.handheld && this.cardReader === "none");
    const splitBack = this.#splitsOnScreen && this.chosenWay === "share" && this.#canAsk();
    return quietPay({
      title: t("action.pay"),
      subtitle: this.billName,
      back: splitBack
        ? t("bill_pay.way_share")
        : this.openingBack || this.tableName || t("action.back"),
      wrapBack: !splitBack && this.openingBack !== "",
      close: () => (splitBack ? this.#openSplit() : this.#requestClose()),
      equipment: quietEquipmentButton(
        this.rowOpen,
        this.busy,
        () => (this.rowOpen = !this.rowOpen),
      ),
      amount,
      breakdown:
        this.quietEntry || !this.tipsEnabled || !card || base === null
          ? undefined
          : quietTipBreakdown({
              bill: this.#money(base),
              tip: tip === null ? undefined : this.#money(tip),
              busy: this.busy,
              expanded: this.quietTip,
              edit: () => (this.quietTip = !this.quietTip),
            }),
      body: html` ${this.credited === null ? nothing : html`<p class="credited" role="status" data-pay-credited>${this.credited}</p>`}
      ${this.#captureWarning()} ${this.#refundNotice()}
      ${
        reserved === undefined || compareDecimal(decimal(reserved), decimal("0")) === 0
          ? nothing
          : html`<p class="muted" data-pay-reserved>
              ${t("bill_pay.reserved")} · ${this.#money(reserved)}
            </p>`
      }
      ${
        !this.handheld && this.cardReader === "simulator"
          ? this.#simulationFields()
          : this.rowOpen
            ? this.handheld
              ? this.#equipmentRow(card)
              : this.#readerFields()
            : this.#notice()
      }
      ${
        this.quietEntry
          ? html`${this.#wayFields(errors)} ${this.#entryFields(errors)}`
          : html` ${this.quietTip ? this.#quietTipEditor(errors) : nothing}
            ${this.balance === null ? html`<p role="status" data-pay-balance>${t("bill_pay.reading")}</p>` : nothing}
            ${quietWays(
              this.chosenWay,
              this.itemsBarred,
              this.busy,
              this.balance === null ? undefined : includingTip(this.balance.outstanding),
              (way) => {
                if (way !== this.chosenWay) this.#run.end();
                if (way === "share" && this.#splitsOnScreen) return this.#openSplit();
                this.chosenWay = way;
                this.ownReceipt = null;
                this.#changedDraft();
              },
            )}
            ${this.#wayFields(errors)}
            ${receipt === null ? nothing : this.#itemsReceiptWarning(receipt)}
            ${ownReceipt ? this.#ownReceiptChoice() : nothing}
            ${guests ? this.#guests(errors.get("guests")) : nothing} ${this.#deferred()}
            ${this.#payments()}
            ${!this.takesCash && (card || manual) ? html`<p class="muted cash-at-till">${t("tender.cash_at_till")}</p>` : nothing}
            ${card || manual || this.takesCash ? nothing : html`<p role="status">${t("bill_pay.no_method")}</p>`}`
      }`,
      actions: this.quietEntry
        ? html`<wt-form-actions .error=${this.#bottomMessage(errors)}>
            ${recoveryLink(this.#shownRefusal)}
            <wt-button
              slot="cancel"
              variant="secondary"
              .disabled=${this.busy}
              @click=${() => (this.quietEntry = false)}
              >${t("action.back")}</wt-button
            >
            <wt-button
              variant="primary"
              data-pay-continue
              .loading=${this.busy}
              .disabled=${this.busy || own.size > 0 || !this.#canAsk()}
              @click=${() => void this.#continue()}
              >${t("bill_pay.continue")}</wt-button
            >
          </wt-form-actions>`
        : html`<wt-form-actions .error=${this.#bottomMessage(errors)}
              >${recoveryLink(this.#shownRefusal)}</wt-form-actions
            >
            ${quietTenderActions(amount, this.busy, {
              card: !card
                ? undefined
                : {
                    disabled:
                      checked == null || receiptIncomplete || this.#heldForEquipment("card"),
                    run: () => {
                      this.method = "card";
                      void this.#continue();
                    },
                  },
              cash: !this.takesCash
                ? undefined
                : {
                    disabled: cashChecked == null || receiptIncomplete,
                    run: () => this.#quietMethod("cash"),
                  },
              manual: !manual
                ? undefined
                : { disabled: !this.#canAsk(), run: () => this.#quietMethod("manual") },
            })}`,
    });
  }

  #quietAmount(): Decimal | null {
    const outstanding = this.balance?.outstanding;
    if (this.chosenWay === "contribution") return typedMoney(this.typedAmountValue);
    if (this.chosenWay === "items") return this.#pickedAmount();
    if (outstanding === undefined) return null;
    const available = decimal(outstanding);
    if (this.chosenWay !== "share" || !PEOPLE.test(this.people.trim())) return available;
    return equalShare(available, Number(this.people.trim()));
  }

  get #splitsOnScreen(): boolean {
    return this.quiet && !this.counter;
  }

  #openSplit(): void {
    const people = this.people.trim();
    this.splitShown = splitOpening(
      this.balance,
      this.receiptGuests,
      this.#run,
      PEOPLE.test(people) ? Number(people) : null,
    );
  }

  /** `guests` counts the guests the record has paid, so the share is among the rest. */
  #startSplit(guests: number): void {
    this.#run.regroup(guests);
    this.people = String(guests - this.#run.paidCount);
    this.chosenWay = "share";
    this.splitShown = null;
    this.ownReceipt = null;
    if (this.#shownRefusal?.field === "shareOf") this.#feedback.dismiss("refusal");
    this.#changedDraft();
  }

  #splitScreen(): TemplateResult | null {
    const opening = this.splitShown;
    if (
      opening === null ||
      this.busy ||
      this.preview !== null ||
      this.nextOffered ||
      this.confirmationLocked ||
      this.showsRefundAcknowledgment ||
      this.scanning ||
      this.askingSecondCard
    )
      return null;
    return splitEquallyScreen(
      opening,
      this.billName,
      this.balance?.outstanding ?? "0.00",
      () => (this.splitShown = null),
      ({ guests }) => this.#startSplit(guests),
    );
  }

  #quietMethod(method: "cash" | "manual"): void {
    this.method = method;
    this.quietEntry = true;
    this.#changedDraft();
  }

  #readerStopControl(): TemplateResult | typeof nothing {
    return readerStopControl(
      this.readerStop === null
        ? undefined
        : {
            status: this.readerStop,
            refusal: this.readerStopRefusal ?? undefined,
            request: () => this.dispatchEvent(new CustomEvent("bill-pay-stop")),
          },
    );
  }

  #heading(): string {
    if (!this.handheld) return t("bill_pay.title");
    return this.tableName === ""
      ? t("action.pay")
      : t("bill_pay.title_table").replace("{table}", () => this.tableName);
  }

  /** On a handheld, while a card it sent is at the reader, the sheet is this panel alone. */
  #cardWaiting(): SheetView | null {
    if (!this.handheld || !this.busy || this.confirmationLocked || this.#sent === null) return null;
    return {
      body: cardWaitingView(this.#sent, this.notice, !readerStopPending(this.readerStop)),
      actions: nothing,
    };
  }

  #body(): SheetView {
    const step = this.nextOffered ? this.#nextActions() : this.#step();
    const body = html`${this.#balance()} ${this.#captureWarning()} ${this.#taken()}
    ${this.#refundNotice()} ${this.#payments()} ${step.body}`;
    return { body, actions: step.actions };
  }

  #captureWarning(): TemplateResult | typeof nothing {
    const warning = this.balance?.captureWarning;
    return warning === undefined
      ? nothing
      : html`<p role="alert" data-capture-warning>
          ${t("card.capture_warning")
            .replace("{requested}", () => this.#money(warning.requestedAmount))
            .replace("{actual}", () => this.#money(warning.reportedAmount))}
        </p>`;
  }

  #refundNotice(): TemplateResult | typeof nothing {
    return this.refunded === null
      ? nothing
      : html`<p class="taken" role="status" data-pay-refunded>
          ${this.#refundedText(this.refunded)}
        </p>`;
  }

  /** On a handheld, a payment taken shows as a block, naming the reader a card was charged on. */
  #taken(): TemplateResult | typeof nothing {
    const taken = this.taken;
    if (taken === null) return nothing;
    if (this.handheld && taken.pending !== undefined) return this.#uncertain(taken.pending);
    const line = html`<p class="taken" role="status" data-pay-taken>${this.#takenText(taken)}</p>`;
    const slip = this.showsTaken ? paymentSlipButton(this.paymentSlip) : nothing;
    if (!this.handheld) return html`${line} ${slip}`;
    return html`<div class="taken-block">
      ${line}
      ${
        taken.reader === undefined || taken.charged === undefined
          ? nothing
          : html`<p data-pay-taken-reader>
              ${t("bill_pay.taken_on_reader")
                .replace("{amount}", () => this.#money(taken.charged!))
                .replace("{reader}", () => taken.reader!)}
            </p>`
      }
      ${slip}
    </div>`;
  }

  #uncertain(pending: string): TemplateResult {
    return html`<div class="tone" role="status" data-pay-uncertain>
        <p class="tone-title" data-pay-uncertain-title>${t("bill_pay.uncertain_title")}</p>
        <p class="tone-body" data-pay-taken>
          ${t("bill_pay.uncertain").replace("{amount}", () => this.#money(pending))}
        </p>
      </div>
      <p class="muted" data-pay-pending-manager>${t("bill_pay.pending_where")}</p>`;
  }

  #nextActions(): SheetView {
    const left = this.taken?.pending === undefined ? this.#sharesLeft() : 0;
    const label =
      left > 0 ? nextShareLabel(this.#run.paidCount + 1, this.#run.of!) : t("bill_pay.next");
    const actions = html`<wt-form-actions slot="footer" .error=${this.#bottomMessage(new Map())}
      >${recoveryLink(this.#shownRefusal)}
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
        data-pay-next
        .disabled=${this.busy}
        @click=${() => {
          if (!this.isConnected || !this.#active || this.busy) return;
          this.nextOffered = false;
          this.#leftTaken = true;
          if (this.refusal?.code === "payment_slip.capture_failed")
            this.#feedback.dismiss("refusal");
        }}
      >
        ${label}
      </wt-button>
    </wt-form-actions>`;
    return { body: this.#notice(), actions };
  }

  async #focusInvalid(): Promise<void> {
    await this.#feedback.focus(this.shadowRoot!);
  }

  #guestsDetail(shown: boolean): ReceiptGuestsDetail {
    return shown ? { guestCount: parseGuestCount(this.#guestsText())?.guestCount ?? null } : {};
  }

  #takenText(taken: PayTaken): string {
    if (taken.pending !== undefined && this.#takenForItems && this.balance?.beingPaidOn)
      return fill(t("bill_pay.card_pending_items"), { amount: this.#money(taken.pending) });
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
    const message = t(key).replace("{amount}", () => this.#money(refunded.amount));
    return refunded.state === "failed" && refunded.refusalReason === "provider_balance_unavailable"
      ? `${message} ${t("refund.provider_balance_unavailable")}`
      : message;
  }

  /** A part payment's own ticket as printed: number, issue day, total and each VAT rate's split. */
  #advanceTicket(ticket: AdvanceTicket): string {
    const [year, month, day] = ticket.issuedOn.split("-").map(Number);
    const date = new Intl.DateTimeFormat(currentLocale(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(Date.UTC(year!, month! - 1, day!));
    return [
      fill(t("bill_pay.payment_ticket"), {
        number: ticket.invoiceNumber,
        date,
        total: this.#money(ticket.total),
      }),
      ...ticket.vatBreakdown.map(vatSplitText),
    ].join(" · ");
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
        ${outsideCardSummary(payment)}
        ${payment.externalRef ? html`<p>${t("tender.operation_number")} ${payment.externalRef}</p>` : nothing}
        <span class="payment-head">
          ${t("bill_pay.payment")
            .replace("{n}", String(n))
            .replace("{method}", () => method)}
          · ${t(PAYMENT_STATES[payment.state])}
        </span>
        ${payment.ticket === undefined ? nothing : html`<p data-payment-ticket>${this.#advanceTicket(payment.ticket)}</p>`}
        ${
          payment.takenOffBy === undefined
            ? nothing
            : html`<p data-payment-taken-off>
                ${t("bill_pay.taken_off_on").replace("{number}", () => payment.takenOffBy!.invoiceNumber)}
              </p>`
        }
        <p>
          ${t("bill_pay.applied")} ${this.#money(payment.left ?? payment.applied)} ·
          ${t("bill_pay.tip")} ${this.#money(payment.tipLeft ?? payment.tip)}
        </p>
        ${
          payment.givenBack !== undefined &&
          compareDecimal(decimal(payment.givenBack), decimal("0")) > 0
            ? html`<p class="muted" data-payment-given-back>
                ${t("bill_pay.given_back").replace("{amount}", () => this.#money(payment.givenBack!))}
              </p>`
            : nothing
        }
        ${payment.refunds.map(
          (refund) =>
            html`<p class="muted" data-payment-refunded>
                ${t(REFUNDS[refund.state]).replace("{amount}", () =>
                  this.#money(moneyPlus(refund.appliedAmount, refund.tipAmount)),
                )}
              </p>
              ${
                refund.state === "completed"
                  ? html`<wt-button
                      variant="secondary"
                      size="sm"
                      data-payment-refund-ack=${refund.id}
                      .disabled=${this.busy}
                      @click=${() => this.#emit("bill-refund-acknowledgment", { refundId: refund.id })}
                      >${t("refund_ack.open")}</wt-button
                    >`
                  : nothing
              }`,
        )}
        ${
          payment.state === "pending" && !(this.handheld && this.taken?.pending !== undefined)
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

  /** The form, or the confirmation of what the server allocated. */
  #step(): SheetView {
    const step =
      this.asked === null || this.preview === null
        ? this.#form()
        : this.#confirmStep(this.asked, this.preview);
    return { body: html`${this.#unanswered()}${step.body}`, actions: step.actions };
  }

  /** A locked confirmation's title; its message is the step's own, under the form. */
  #unanswered(): TemplateResult | typeof nothing {
    if (!this.confirmationLocked) return nothing;
    const title =
      this.refusal?.code === "sending"
        ? t("bill_pay.sending_title")
        : t("bill_pay.unanswered_title");
    return html`<div class="tone" role="status" data-pay-unanswered>
      <p class="tone-title" data-pay-unanswered-title>${title}</p>
    </div>`;
  }

  #balance(): TemplateResult {
    const balance = this.balance;
    if (balance === null)
      return html`<p class="muted" data-pay-balance>${t("bill_pay.reading")}</p>`;
    const amount = (value: string) => html`<dd>${this.#money(value)}</dd>`;
    const over = overpaidOf(balance);
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
      ${
        over === null
          ? html`<div data-pay-outstanding>
              <dt>${t("bill_pay.outstanding")}</dt>
              ${amount(balance.outstanding)}
            </div>`
          : html`<div data-pay-overpaid>
              <dt>${t("bill_pay.overpaid")}</dt>
              ${amount(over)}
            </div>`
      }
    </dl>`;
  }

  #picked(): PayLine[] {
    return this.lines.filter((line) => this.picks.has(line.lineNo));
  }

  /** The chosen lines' amounts on this bill. Set-menu dishes can come to another amount on a bill of
   * their own, which the preview answers. */
  #pickedAmount(): Decimal {
    return toScale(
      sumDecimals(
        this.#picked().map((line) => this.#pickAmount(line, this.picks.get(line.lineNo)!)),
      ),
      MONEY_SCALE,
    );
  }

  #ownBill(): this is { preview: AllocationPreview & { total: string } } {
    return paysOnNewBill(this.preview);
  }

  /** What the way covers, as far as the dialog knows before the server allocates it. */
  #scope(): string {
    switch (this.chosenWay) {
      case "whole":
        return this.balance === null
          ? ""
          : t("table.bill_to_pay").replace("{amount}", () =>
              this.#money(
                this.asked?.choice.kind === "whole" && this.preview !== null
                  ? this.preview.applied
                  : this.balance!.outstanding,
              ),
            );
      case "items": {
        const picked = this.#picked();
        if (picked.length === 0) return t("bill_pay.scope_items_none");
        const names = portionGroups(
          picked,
          (line) => line.portionKey ?? null,
          (line) => line.lineNo,
        )
          .map((group) => {
            const line = group[0]!;
            const shown =
              group.length > 1
                ? String(group.length)
                : this.#shownQuantity(line, this.picks.get(line.lineNo)!);
            return shown === "1" ? line.name : `${line.name} ×${shown}`;
          })
          .join(", ");
        const total = this.#ownBill() ? this.preview.total : undefined;
        return fill(t("bill_pay.scope_items"), {
          items: names,
          amount: this.#money(total ?? this.#pickedAmount()),
        });
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
    disabled = false,
    describedBy?: string,
  ): TemplateResult {
    return html`<label class="option">
      <input
        type="radio"
        name=${name}
        .value=${value}
        .checked=${checked}
        ?disabled=${disabled}
        aria-describedby=${describedBy ?? nothing}
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
    if (selector === "[data-pay-continue]" && this.#opening && !this.quietEntry) return;
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
      decimal-locale=${name !== "externalRef" && name !== "people" ? currentLocale() : nothing}
      autocomplete="off"
      .disabled=${this.busy || this.confirmationLocked}
      .label=${label}
      .value=${value}
      .required=${opts.required === true}
      .error=${opts.error ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (!this.isConnected || !this.#active || this.busy || this.confirmationLocked) return;
        set(event.detail.value);
        this.#changedDraft();
        if (name !== "externalRef") this.#changed(name);
      }}
      @keydown=${(event: KeyboardEvent) => this.#enter(event, opts.submit)}
    ></wt-input>`;
  }

  #form(): SheetView {
    const own = this.#feedback.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const bottom = this.#bottomMessage(errors);
    const body = html`<fieldset
        class="choice"
        data-pay-way
        ?disabled=${this.busy}
        @click=${(event: Event) => {
          if (
            this.#splitsOnScreen &&
            this.chosenWay === "share" &&
            (event.target as Element).matches('input[name="way"][value="share"]')
          )
            this.#openSplit();
        }}
      >
        <legend class="help-anchor">
          ${t("bill_pay.way")}${helpBadge("help.payment", t("action.pay"), { guide: "table-service.pay-window" })}
        </legend>
        <div class="options">
          ${BILL_PAY_WAYS.map(({ way, label }) =>
            this.#radio(
              "way",
              way,
              t(label),
              this.chosenWay === way,
              () => {
                if (way !== this.chosenWay) this.#run.end();
                if (way === "share" && this.#splitsOnScreen) return this.#openSplit();
                this.chosenWay = way;
              },
              (way === "whole" && this.balance === null) ||
                (way === "items" && this.itemsBarred !== null),
              way === "items" && this.itemsBarred !== null ? "items-reason" : undefined,
            ),
          )}
        </div>
        ${this.itemsBarred === null ? nothing : html`<p class="way-reason" id="items-reason" data-pay-items-reason>${t(this.itemsBarred)}</p>`}
      </fieldset>
      <p class="scope" data-pay-scope>${this.#scope()}</p>
      ${this.#deferred()} ${this.#wayFields(errors)} ${this.#methodFields(errors)}
      ${this.askingSecondCard ? this.#secondCardAsk() : nothing}
      ${this.#methods().length === 0 ? this.#notice() : nothing}`;
    const actions = html`<wt-form-actions slot="footer" .error=${bottom}
      >${recoveryLink(this.#shownRefusal)}
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
        .disabled=${
          this.busy ||
          own.size > 0 ||
          this.askingSecondCard ||
          !this.#canAsk() ||
          this.#heldForEquipment(this.method)
        }
        @click=${() => void this.#continue()}
      >
        ${t("bill_pay.continue")}
      </wt-button>
    </wt-form-actions>`;
    return { body, actions };
  }

  #deferred(): TemplateResult | typeof nothing {
    const offer = this.deferredOffered;
    if (this.chosenWay !== "whole" || offer.state === "hidden") return nothing;
    const reason = offer.state === "off" ? t(offer.reason) : null;
    return html`<div class="deferred">
      <wt-button
        variant="secondary"
        data-pay-deferred
        aria-description=${reason ?? nothing}
        .disabled=${this.busy || reason !== null}
        @click=${() => {
          if (this.isConnected && this.#active && !this.busy && reason === null)
            this.#emit("bill-pay-deferred");
        }}
      >
        ${t("deferred_close.title")}
      </wt-button>
      ${reason === null ? nothing : html`<p data-pay-deferred-reason>${reason}</p>`}
    </div>`;
  }

  #wayFields(errors: ReadonlyMap<Field, string>): TemplateResult | typeof nothing {
    switch (this.chosenWay) {
      case "whole":
        return nothing;
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
        if (this.#splitsOnScreen) return nothing;
        return this.#input(
          "people",
          t("bill_pay.people"),
          this.people,
          (value) => {
            this.people = value;
            this.#run.end();
          },
          { required: true, error: errors.get("people"), submit: "[data-pay-continue]" },
        );
    }
  }

  #itemsField(error: string | undefined): TemplateResult {
    if (this.lines.length === 0)
      return html`<p class="muted" data-items-none>${t("bill_pay.items_none")}</p>`;
    return html`<fieldset class="choice" data-pay-lines ?disabled=${this.busy}>
      <legend>${t("bill_pay.items")}<span class="required" aria-hidden="true">*</span></legend>
      <div class="lines">
        ${portionGroups(
          this.lines,
          (line) => line.portionKey ?? null,
          (line) => line.lineNo,
        ).map((group) => this.#lineRow(group, error !== undefined))}
      </div>
      ${
        error === undefined
          ? nothing
          : html`<p class="field-error" id="lines-error" data-error-for="lines">${error}</p>`
      }
    </fieldset>`;
  }

  #lineRow(group: PayLine[], invalid: boolean): TemplateResult {
    const line = group[0]!;
    const grouped = group.length > 1;
    const remaining = grouped ? group.length : this.#units(line);
    const selected = group.filter((member) => this.picks.has(member.lineNo));
    const units = grouped ? selected.length || undefined : this.picks.get(line.lineNo);
    const quantity = grouped ? String(remaining) : this.#shownQuantity(line, remaining);
    const total = grouped
      ? sumDecimals(group.map((member) => decimal(member.total)))
      : this.#pickAmount(line, remaining);
    const label = `${line.name} ×${quantity} · ${this.#money(total)}`;
    const setCount = (count: number) => {
      const next = new Map(this.picks);
      for (const member of group) next.delete(member.lineNo);
      const chosen = [...selected, ...group.filter((member) => !this.picks.has(member.lineNo))];
      for (const member of chosen.slice(0, count)) next.set(member.lineNo, 1);
      this.picks = next;
      this.#changedDraft();
      this.#changed("lines");
    };
    const toggle = () => {
      if (!this.isConnected || !this.#active || this.busy) return;
      if (grouped) {
        setCount(units === undefined ? 1 : 0);
        return;
      }
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
        units === undefined || (!grouped && line.unitTotal === null) || remaining <= 1
          ? nothing
          : this.#unitsStepper(line, units, remaining, grouped ? setCount : undefined)
      }
    </div>`;
  }

  #unitsStepper(
    line: PayLine,
    units: number,
    remaining: number,
    setCount?: (count: number) => void,
  ): TemplateResult {
    const step = (delta: -1 | 1) => {
      if (!this.isConnected || !this.#active || this.busy) return;
      if (setCount !== undefined) {
        setCount(units + delta);
        return;
      }
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

  #methodRadio(method: Method): TemplateResult {
    const label = {
      cash: "tender.cash",
      card: "tender.card",
      manual: "bill_pay.method_other_terminal",
    } as const;
    return this.#radio("method", method, t(label[method]), this.method === method, () => {
      this.method = method;
    });
  }

  #methodChoices(): TemplateResult {
    if (this.handheld) {
      const methods = this.#methods();
      return methods.length === 0
        ? html`<p class="muted" data-pay-no-method>${t("bill_pay.no_method")}</p>`
        : html`<div class="options">${methods.map((method) => this.#methodRadio(method))}</div>`;
    }
    return html`<div class="options">
        ${this.takesCash ? this.#methodRadio("cash") : nothing} ${this.#methodRadio("card")}
        ${this.takesManualCard && this.cardReader !== "none" ? this.#methodRadio("manual") : nothing}
      </div>
      ${this.takesCash ? nothing : html`<p class="muted cash-at-till">${t("tender.cash_at_till")}</p>`}`;
  }

  #methodFields(errors: ReadonlyMap<Field, string>): TemplateResult {
    const offered = !this.handheld || this.#methods().length > 0;
    return html`<fieldset class="choice" data-pay-method ?disabled=${this.busy}>
        <legend>${t("bill_pay.method")}</legend>
        ${this.#methodChoices()}
      </fieldset>
      ${offered ? this.#entryFields(errors) : nothing}
      ${offered ? this.#equipmentRow(this.method === "card") : nothing}`;
  }

  #entryFields(errors: ReadonlyMap<Field, string>): TemplateResult {
    return this.method === "cash"
      ? this.#input(
          "tendered",
          t("bill_pay.tendered"),
          this.tendered,
          (value) => (this.tendered = value),
          {
            required: true,
            error: errors.get("tendered"),
            submit: "[data-pay-continue]",
          },
        )
      : html`${this.tipsEnabled ? this.#cardTipField(errors) : nothing}
        ${this.#keyed(this.method) ? this.#manualCardFields() : this.#readerFields()}`;
  }

  #quietTipEditor(errors: ReadonlyMap<Field, string>): TemplateResult {
    return html`${this.#cardTipField(errors)}
      <wt-button
        size="sm"
        variant="secondary"
        data-clear-card-tip
        .disabled=${this.busy || this.cardTip === ""}
        @click=${() => {
          this.cardTip = "";
          this.quietTip = false;
          this.#changedDraft();
          this.renderRoot.querySelector<HTMLElement>("[data-quiet-pay-tip]")?.focus();
        }}
        >${t("bill_pay.remove_tip")}</wt-button
      >`;
  }

  #cardTipField(errors: ReadonlyMap<Field, string>): TemplateResult {
    return this.#input(
      "cardTip",
      t("bill_pay.card_tip"),
      this.cardTip,
      (value) => (this.cardTip = value),
      {
        error: errors.get("cardTip"),
        submit: "[data-pay-continue]",
      },
    );
  }

  /** A handheld's reader and printer row; its events bubble out to the app unchanged. */
  #equipmentRow(cardRequired: boolean): TemplateResult | typeof nothing {
    if (!this.handheld) return nothing;
    return html`${this.#notice()}<till-pay-equipment
        .equipment=${this.equipment}
        .cardRequired=${cardRequired}
        .open=${this.rowOpen}
        .saving=${this.equipmentSaving}
        .fieldErrors=${this.equipmentErrors}
        .readerReason=${this.readerReason}
        .readerHint=${this.readerHint}
        .canScan=${this.canScan}
        .askNfc=${this.askNfc}
        .disabled=${this.busy || this.confirmationLocked}
        .fixedReader=${this.fixedReader}
        @pay-equipment-toggle=${(event: CustomEvent<{ open: boolean }>) =>
          (this.rowOpen = event.detail.open)}
        @pay-equipment-qr=${() => (this.scanning = true)}
      ></till-pay-equipment>`;
  }

  #notice(): TemplateResult | typeof nothing {
    return this.handheld ? payNotice(this.notice) : nothing;
  }

  #manualCardFields(): TemplateResult {
    return html`${this.#input(
      "externalRef",
      t("tender.card_ref"),
      this.externalRef,
      (value) => (this.externalRef = value),
      { submit: "[data-pay-continue]" },
    )}${outsideCardFields(
      this.outside,
      (value) => {
        this.outside = value;
        this.#changedDraft();
      },
      this.sumUpConnected,
      this.busy || this.confirmationLocked,
    )}`;
  }

  /** The practice simulator's result, or the reader when the venue has more than one. */
  #readerFields(): TemplateResult | typeof nothing {
    if (this.cardReader === "simulator") return this.#simulationFields();
    if (this.handheld) return nothing;
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
        ${(["captured", "declined", "attempting"] as const).map((outcome) =>
          this.#radio(
            "simulation",
            outcome,
            t(`card.simulation_${outcome}`),
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

  #tipErrors(cash: Cash): Map<Field, string> {
    const errors = new Map<Field, string>();
    const most = this.#changeAndTip(cash.preview);
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
    this.#feedback.dismiss("refusal");
    this.#emit("bill-pay-preview", {
      ...asked,
      pay: addedTip === undefined ? pay : { ...pay, addedTip },
    } satisfies PayRequest);
  }

  #pickTip(mode: TipMode, asked: PayRequest, cash: Cash): void {
    if (this.confirmationLocked) return;
    this.tipMode = mode;
    this.tipAttempted = false;
    if (mode === "none") this.#askWithTip(asked, cash.pay, undefined);
    if (mode === "all") this.#askWithTip(asked, cash.pay, this.#changeAndTip(cash.preview));
  }

  /** Takes the payment shown; with part of the change typed as a tip, first checks it and, when
   * it is not the tip shown, asks the server for the allocation with it. */
  async #take(
    asked: PayRequest,
    preview: AllocationPreview,
    cash: Cash | null,
    quote?: TablePayQuote,
  ): Promise<void> {
    if (!this.isConnected || !this.#active || this.busy) return;
    const onReader = asked.card?.entry === "reader";
    if (this.#heldForEquipment(onReader ? "card" : "cash")) return;
    if (this.#ownReceiptAsked(preview) && this.ownReceipt === null) return;
    const tipChecked = cash !== null && this.tipMode === "part";
    const guestsShown = this.#guestsShown(preview);
    if (tipChecked) this.tipAttempted = true;
    if (guestsShown) this.guestsAttempted = true;
    if ((tipChecked && this.#tipErrors(cash).size > 0) || (guestsShown && this.#guestsInvalid())) {
      await this.#focusInvalid();
      return;
    }
    if (tipChecked) {
      const tip = typedAmount(this.tipAmount)!;
      if (compareDecimal(decimal(tip), decimal(cash.preview.tip)) !== 0) {
        this.#askWithTip(asked, cash.pay, tip);
        return;
      }
    }
    this.#feedback.dismiss("refusal");
    const reader =
      this.handheld && onReader && !this.confirmationLocked ? this.#readyReader() : null;
    this.#sent = reader === null ? null : sentCard(reader, preview.charged!);
    this.#run.sending(asked.choice.kind === "share" ? asked.choice.shareOf : null, preview.applied);
    this.#emit("bill-pay-confirm", {
      ...(quote === undefined ? {} : { quote }),
      ...this.#guestsDetail(guestsShown),
      ...(reader?.id === undefined ? {} : { readerId: reader.id }),
      ...(this.#ownReceiptAsked(preview) && this.ownReceipt === true
        ? { ownReceipt: true as const }
        : {}),
    } satisfies BillPayConfirmDetail);
  }

  /** Only the payment that pays what is left records the sale; `outstanding` leaves out what a
   * card in progress holds. */
  #guestsShown(preview: AllocationPreview): boolean {
    return (
      this.asksGuests &&
      !paysOnNewBill(preview) &&
      this.balance !== null &&
      ((this.asked?.choice.kind ?? this.#choice().kind) === "whole" ||
        compareDecimal(decimal(preview.applied), decimal(this.balance.outstanding)) === 0)
    );
  }

  /** Asked of a part payment that leaves something owed; a resend keeps what was sent. */
  #ownReceiptAsked(preview: AllocationPreview): boolean {
    return (
      this.ownReceiptOffered &&
      !paysOnNewBill(preview) &&
      !this.confirmationLocked &&
      this.balance !== null &&
      (this.asked?.choice.kind ?? this.#choice().kind) !== "whole" &&
      compareDecimal(decimal(preview.applied), decimal(this.balance.outstanding)) < 0
    );
  }

  #ownReceiptChoice(): TemplateResult {
    const answers = [
      { value: "yes", answer: true, label: t("bill_pay.own_receipt_yes") },
      { value: "no", answer: false, label: t("bill_pay.own_receipt_no") },
    ];
    return html`<fieldset class="choice" data-pay-own-receipt ?disabled=${this.busy}>
      <legend>
        ${t("bill_pay.own_receipt")}<span class="required" aria-hidden="true">&#8288;*</span>
      </legend>
      <div class="options">
        ${answers.map(({ value, answer, label }) =>
          this.#radio("ownReceipt", value, label, this.ownReceipt === answer, () => {
            this.ownReceipt = answer;
          }),
        )}
      </div>
    </fieldset>`;
  }

  #guestsText(): string {
    return guestsText(this.guestsEntry, this.receiptGuests);
  }

  #guestsInvalid(): boolean {
    return parseGuestCount(this.#guestsText()) === undefined;
  }

  #onGuestsChange(event: Event): void {
    event.stopPropagation();
    if (
      !this.isConnected ||
      !(event.currentTarget as HTMLElement).isConnected ||
      this.busy ||
      this.confirmationLocked
    )
      return;
    this.guestsEntry = (event as CustomEvent<{ value: string }>).detail.value;
    this.#changed("guests");
  }

  /** No draft scope tracks this field (A663 Part 3b plan). */
  #guests(error: string | undefined): TemplateResult {
    return guestsStepper({
      text: this.#guestsText(),
      disabled: this.busy || this.confirmationLocked,
      error: error ?? "",
      onChange: (event) => this.#onGuestsChange(event),
    });
  }

  #itemsReceiptWarning(preview: AllocationPreview): TemplateResult | typeof nothing {
    if (!paysOnNewBill(preview) || this.balance?.status !== "placed" || this.sentWithoutReceipt)
      return nothing;
    return html`<p class="own-bill" data-pay-own-bill>${t("bill_pay.items_own_bill_printed")}</p>`;
  }

  #confirmStep(asked: PayRequest, preview: AllocationPreview): SheetView {
    // A cash preview always carries its change, and a card's its charge.
    const cash: Cash | null =
      asked.pay.method === "cash"
        ? { pay: asked.pay, preview: { ...preview, change: preview.change! } }
        : null;
    const stepErrors =
      cash !== null && this.tipAttempted && this.tipMode === "part"
        ? this.#tipErrors(cash)
        : new Map<Field, string>();
    const guestsShown = this.#guestsShown(preview);
    const ownReceiptAsked = this.#ownReceiptAsked(preview);
    const unanswered = ownReceiptAsked && this.ownReceipt === null;
    if (guestsShown && this.guestsAttempted && this.#guestsInvalid())
      stepErrors.set("guests", t("seat.guest_count_invalid"));
    const errors = this.#fieldErrors(stepErrors);
    const bottom = this.#bottomMessage(errors);
    const onReader = asked.card?.entry === "reader";
    const reader = this.handheld && onReader ? this.#readyReader() : null;
    const amount = (value: string) => html`<dd>${this.#money(value)}</dd>`;
    const body = html`${outsideCardSummary(asked.card?.entry === "manual" ? asked.card : {})}
      <p class="scope" data-pay-scope>${this.#scope()}</p>
      ${this.#itemsReceiptWarning(preview)}
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
      ${this.#equipmentRow(onReader)}
      ${
        this.tipsEnabled &&
        cash !== null &&
        compareDecimal(this.#changeAndTip(cash.preview), decimal("0")) > 0
          ? this.#tipChoice(asked, cash, errors.get("tipAmount"))
          : nothing
      }
      ${ownReceiptAsked ? this.#ownReceiptChoice() : nothing}
      ${
        this.busy && asked.card?.entry === "reader" && !readerStopPending(this.readerStop)
          ? html`<p class="muted" role="status" data-pay-collecting>${t("card.collecting")}</p>`
          : nothing
      }
      ${guestsShown ? this.#guests(errors.get("guests")) : nothing}`;
    const actions = html`<wt-form-actions slot="footer" .error=${bottom}
      >${recoveryLink(this.#shownRefusal)} ${this.#backButton()}
      <wt-button
        variant=${unanswered ? "secondary" : "primary"}
        data-pay-confirm
        .loading=${this.busy}
        .disabled=${
          this.busy ||
          unanswered ||
          stepErrors.size > 0 ||
          this.#heldForEquipment(onReader ? "card" : "cash")
        }
        @click=${() => void this.#take(asked, preview, cash)}
      >
        ${
          this.confirmationLocked
            ? t("bill_pay.recheck")
            : reader === null
              ? t("bill_pay.take")
              : readerButtonLabel(
                  reader.name,
                  this.#money(preview.charged!),
                  this.#shownRefusal?.code === "declined",
                )
        }
      </wt-button>
    </wt-form-actions>`;
    return { body, actions };
  }

  #backButton(): TemplateResult {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      data-pay-back
      .disabled=${this.busy || this.confirmationLocked}
      @click=${() => this.#back()}
    >
      ${t("action.back")}
    </wt-button>`;
  }

  #tipChoice(asked: PayRequest, cash: Cash, error: string | undefined): TemplateResult {
    const options: { mode: TipMode; label: StringKey }[] = [
      { mode: "none", label: "bill_pay.tip_none" },
      { mode: "all", label: "bill_pay.tip_all" },
      { mode: "part", label: "bill_pay.tip_part" },
    ];
    return html`<fieldset
        class="choice"
        data-leave-tip
        ?disabled=${this.busy || this.confirmationLocked}
      >
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
