import type { BillSetMenuState } from "@waitron/shared";
import { rememberInvoiceEvidence } from "./invoice-evidence.js";
import type { RecipientIdentifierType } from "@waitron/country-packs";
import type { MadeHereItem } from "./made-here-types.js";
import type { Dining } from "@waitron/shared";
import { readEventStream } from "./transfer-events.js";
import { PERSON_HEADER, compareDecimal, decimal } from "@waitron/shared";
import type { TillRequest, ReadOptions } from "./till-request.js";
import type { SaleLine, BillEditExpected } from "./order-types.js";
import type { StationMoveBody, StationMoveAnswer } from "./kitchen-api.js";
import type {
  BillPaymentRequest,
  BillPaymentResult,
  BillBalance,
  TillSaleResult,
  Tender,
  PayOutcome,
} from "./payments-api.js";
import type { LateSend } from "./drafts-api.js";
import type { InvoiceDeliveryOptions } from "./invoice-delivery-api.js";
import type { HeldOrder } from "./orders-api.js";
import { FindBillApi } from "./find-bill-api.js";
export type {
  CancellationContext,
  CancellationRead,
  CancelItemRequest,
} from "./line-cancel-types.js";
export type { MadeHereExtra, MadeHereItem } from "./made-here-types.js";
export type {
  ElsewhereItem,
  KitchenNotice,
  KitchenNoticeKind,
  StationPrinterDown,
  StationQueue,
  StationQueueCourse,
  StationQueueGroup,
  StationQueueItem,
} from "./station-queue-types.js";

export type {
  AttendanceChange,
  AttendanceCommand,
  AttendanceCommandResult,
  AttendanceDayView,
  AttendanceInbox,
  AttendancePrompt,
  CorrectionItem,
  HoursSelection,
  HoursDay,
  HoursOpenShift,
  HoursClosure,
  PersonHours,
} from "@waitron/workforce/attendance-contract";

export type { JoinSide } from "@waitron/shared";

/** Re-exported, never re-declared, so a widget imports the offered-list shapes where it imports every
 * other wire type. */
export type {
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedModifier,
  OfferedOptionsList,
} from "@waitron/shared";

/** The subset of `fetch` this client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = typeof fetch;

export const SESSION_PERSON_REFUSAL = "session.person_not_signed_in";

/** One sign-in's person. A refusal hands back the very object its request named. */
export interface SessionPerson {
  personId: string;
}

/** A plain (non-array, non-null) object — the only parsed body shape an error envelope can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a rejected request got NO answer: `fetch` rejects with a TypeError when the connection fails
 * and with an AbortError on a timeout. Either way the outcome is UNKNOWN — the server may have received
 * and processed the request — which is why the caller shows `sale.unconfirmed` (check before retrying)
 * rather than `sale.error` (the server refused; retry freely). A server that DID answer rejects through
 * `#request` as a `{ code }`.
 */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError");
}

export type { ContainsTag, DietLabel, DietOverride, DietProfile } from "@waitron/shared";

export type { MenuState, MenuUnavailable } from "@waitron/shared";

type WholeBillTender = Omit<
  BillPaymentRequest,
  "kind" | "shareOf" | "amount" | "submissionId" | "applied" | "tip"
>;

type CounterPaymentEdit = { revision: number; label?: string };
type CounterPaymentBasket = Partial<CounterPaymentEdit> & {
  lines: SaleLine[];
  zoneId?: string;
  kitchenNote?: string | null;
  invoiceType?: "F1" | "F2";
  recipient?: unknown;
  lateSend?: LateSend;
};
type CounterPaymentRequest = WholeBillTender & {
  kind: "share";
  shareOf: 1;
  submissionId: string;
  basket: CounterPaymentBasket;
};

type WholeBillResult =
  BillPaymentResult | { outcome: "settled"; balance: BillBalance; invoice: TillSaleResult };

export class TillApi extends FindBillApi {
  #madeHereListener?: (items: MadeHereItem[], source: string | symbol) => void;
  #madeHereSource?: () => string | symbol | undefined;
  readonly #unansweredWholeBills = new Map<
    string,
    {
      person: SessionPerson | null;
      key: string;
      request: BillPaymentRequest | CounterPaymentRequest;
    }
  >();

  onMadeHere(
    listener: (items: MadeHereItem[], source: string | symbol) => void,
    source: () => string | symbol | undefined,
  ): void {
    this.#madeHereListener = listener;
    this.#madeHereSource = source;
  }
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;
  #serviceZoneId?: string;
  #localesPromise?: Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
  }>;

  /**
   * @param baseUrl prefixed to every path (default `""`: same-origin).
   * @param fetchImpl the `fetch` to use (default the global; a test injects a stub).
   */
  constructor(baseUrl = "", fetchImpl: FetchLike = fetch) {
    super(<T>(...args: Parameters<TillRequest>) => this.#request<T>(...args));
    this.#baseUrl = baseUrl;
    this.#fetchImpl = fetchImpl;
  }

  #personSource?: () => SessionPerson | null;
  #personRefused?: (person: SessionPerson) => void;

  namePersonFrom(
    source: () => SessionPerson | null,
    onRefused: (person: SessionPerson) => void,
  ): void {
    this.#personSource = source;
    this.#personRefused = onRefused;
  }

  /**
   * `fetchImpl` is read into a local so it is invoked as a free function, not as a method of `this`
   * (which would rebind a native `fetch`).
   */
  #fetchFor(person: SessionPerson | null): FetchLike {
    const fetchImpl = this.#fetchImpl;
    if (person === null) return fetchImpl;
    return (input, init) =>
      fetchImpl(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          [PERSON_HEADER]: person.personId,
        },
      });
  }

  #noticeRefusal(code: string, person: SessionPerson | null): void {
    if (person === null || code !== SESSION_PERSON_REFUSAL) return;
    try {
      this.#personRefused?.(person);
    } catch {
      // The caller still sees the server's refusal, not the listener's failure.
    }
  }

  readLiveEvents(
    types: readonly string[],
    onEvent: (event: string, data: string) => void,
    options: ReadOptions = {},
  ): Promise<void> {
    const resources = encodeURIComponent(JSON.stringify(types.map((type) => ({ type }))));
    return readEventStream(
      this.#baseUrl + `/api/live/events?resources=${resources}`,
      this.#fetchImpl,
      onEvent,
      options.signal,
    );
  }

  /** `GET /api/locales` — public language choices and the browser's login default. */
  getLocales(): Promise<{
    locales: Array<{ code: string; label: string }>;
    venueDefault: string;
    loginDefault: string;
  }> {
    // Fetched once and shared; a rejection clears the cache so a transient failure retries.
    this.#localesPromise ??= this.#request<{
      locales: Array<{ code: string; label: string }>;
      venueDefault: string;
      loginDefault: string;
    }>("/api/locales", "GET").catch((err) => {
      this.#localesPromise = undefined;
      throw err;
    });
    return this.#localesPromise;
  }

  /** Set the service zone used for newly created counter orders after the app accepts an offer load. */
  setServiceZone(zoneId: string): void {
    this.#serviceZoneId = zoneId;
  }

  /**
   * Ring one sale over a persisted working order. `workingOrderId` is the pay-idempotency key: the till
   * holds it stable across a lost-response retry, so a re-sent pay REPLAYS against the same row rather
   * than filing a second chained fiscal record (unrepairable — an invoice number is never reused). To
   * pay a PARKED order the till sends that order's own id.
   */
  recordSale(
    lines: SaleLine[],
    tender: Tender,
    workingOrderId: string,
    zoneId: string | undefined,
    invoice:
      | {
          invoiceType: "F1" | "F2";
          recipient: {
            identifierType?: RecipientIdentifierType;
            identifierCountryCode?: string;
            taxId: string;
            legalName: string;
            address: string;
            countryCode: string;
          } | null;
        }
      | undefined,
    receiptLanguage: string | undefined,
    kitchenNote: string | null | undefined,
    guestCount: number | null | undefined,
    expectedEdit: BillEditExpected | null,
    dining: Dining,
    lateSend?: LateSend,
    edit?: CounterPaymentEdit,
  ): Promise<TillSaleResult> {
    const basket =
      lines.length === 0 && expectedEdit !== null
        ? undefined
        : {
            lines,
            zoneId: zoneId ?? this.#serviceZoneId,
            ...invoice,
            kitchenNote,
            lateSend,
            ...edit,
          };
    return this.#collectWholeBill(
      workingOrderId,
      "open",
      tender,
      {
        expectedEdit,
        dining,
        receiptLanguage,
        guestCount,
      },
      basket,
    );
  }

  /** Pay by reader. A placed order pays for the stored bill. A decline is an outcome. */
  pay(
    req: {
      expectedEdit: BillEditExpected | null;
      id: string;
      lines: SaleLine[];
      /** The way the screen showed the order; refused `working_order.out_of_date` when it differs. */
      dining: Dining;
      invoiceType?: "F1" | "F2";
      recipient?: {
        taxId: string;
        legalName: string;
        address: string;
        countryCode: string;
        identifierType?: RecipientIdentifierType;
        identifierCountryCode?: string;
      } | null;
      zoneId?: string;
      tip?: string;
      simulationOutcome?: "captured" | "declined" | "attempting";
      readerId?: string;
      receiptLanguage?: string;
      kitchenNote?: string | null;
      guestCount?: number | null;
      lateSend?: LateSend;
      edit?: CounterPaymentEdit;
    },
    options: { onSubmission?: (id: string) => void } = {},
  ): Promise<PayOutcome> {
    const {
      id,
      lines,
      zoneId,
      kitchenNote,
      invoiceType,
      recipient,
      lateSend,
      edit,
      tip,
      ...payment
    } = req;
    const basket =
      lines.length === 0
        ? undefined
        : {
            lines,
            zoneId: zoneId ?? this.#serviceZoneId,
            kitchenNote,
            invoiceType,
            recipient,
            lateSend,
            ...edit,
          };
    return this.#payWholeBill(
      id,
      basket === undefined ? "placed" : "open",
      {
        ...payment,
        method: "card",
        entry: "reader",
        addedTip: tip,
      },
      undefined,
      basket,
      options.onSubmission,
    ).then((result): PayOutcome => {
      const captureWarning = result.balance.captureWarning;
      const facts = captureWarning === undefined ? {} : { captureWarning };
      if (result.outcome === "settled")
        return { ...facts, outcome: "captured", ticket: result.invoice };
      const print = result.slipPrintFailed === true ? { slipPrintFailed: true as const } : {};
      const slipPaymentId = result.payment?.state === "received" ? result.payment.id : undefined;
      const slip = slipPaymentId === undefined ? {} : { slipPaymentId };
      if (result.invoice !== undefined)
        return { ...facts, ...print, outcome: "captured", ticket: { ...result.invoice, ...slip } };
      if (result.outcome === "received")
        return { ...facts, ...print, ...slip, outcome: "partial", balance: result.balance };
      if (result.outcome === "pending" || result.outcome === "timeout")
        return { ...facts, outcome: "timeout" };
      if (result.outcome === "network_unavailable")
        return { ...facts, outcome: "network_unavailable" };
      return {
        ...facts,
        outcome: "declined",
        ...(result.failureReason === undefined ? {} : { failureReason: result.failureReason }),
      };
    });
  }

  /** `GET /api/invoice-delivery-options`. `orderId` names the bill; Email is offered when mail is
   * set up and the bill's department receipt, or the default department's, has a contact email.
   * The till's service zone decides the department of a bill not saved yet; without one, the server
   * uses the zone saving the bill would open it in. */
  getInvoiceDeliveryOptions(
    orderId: string,
    options: ReadOptions = {},
  ): Promise<InvoiceDeliveryOptions> {
    const zone =
      this.#serviceZoneId === undefined ? "" : `&zoneId=${encodeURIComponent(this.#serviceZoneId)}`;
    return this.#request<InvoiceDeliveryOptions>(
      `/api/invoice-delivery-options?orderId=${encodeURIComponent(orderId)}${zone}`,
      "GET",
      undefined,
      options.signal,
    );
  }

  /**
   * Park a working order to pay later → `POST /api/working-orders`. `id` is client-minted so a
   * lost-response retry is idempotent against the primary key; `lines` carry no price.
   */
  parkOrder(req: {
    id: string;
    lines: SaleLine[];
    dining: Dining;
    zoneId?: string;
    label?: string;
    kitchenNote?: string | null;
    lateSend?: LateSend;
    firstSetMenuId?: string;
  }): Promise<{
    id: string;
    orderNumber: number;
    serviceMode: HeldOrder["serviceMode"];
    revision?: number;
    setMenus?: BillSetMenuState;
  }> {
    return this.#request("/api/working-orders", "POST", {
      ...req,
      zoneId: req.zoneId ?? this.#serviceZoneId,
    });
  }

  /** Collect the remaining balance of a placed order and return its ticket. */
  collectOrder(
    id: string,
    tender: Tender,
    receiptLanguage: string | undefined,
    guestCount: number | null | undefined,
    expectedEdit: BillEditExpected | null,
  ): Promise<TillSaleResult> {
    return this.#collectWholeBill(id, "placed", tender, {
      expectedEdit,
      receiptLanguage,
      guestCount,
    });
  }

  async #collectWholeBill(
    id: string,
    status: "open" | "placed",
    tender: Tender,
    bill: Pick<WholeBillTender, "expectedEdit" | "receiptLanguage" | "guestCount" | "dining">,
    basket?: CounterPaymentBasket,
  ): Promise<TillSaleResult> {
    const { amount, ...details } = tender;
    const ask: WholeBillTender =
      details.method === "cash"
        ? { ...bill, method: "cash", tendered: amount }
        : { ...bill, ...details, entry: "manual" };
    const result = await this.#payWholeBill(
      id,
      status,
      ask,
      tender.method === "card" && basket === undefined ? amount : undefined,
      basket,
    );
    if (result.invoice === undefined) throw { code: "bill.payments_received", workingOrderId: id };
    if (result.outcome === "settled") return result.invoice;
    return {
      ...result.invoice,
      ...(result.slipPrintFailed === true ? { slipPrintFailed: true } : {}),
      ...(result.payment?.state === "received" ? { slipPaymentId: result.payment.id } : {}),
    };
  }

  async #payWholeBill(
    id: string,
    status: "open" | "placed",
    tender: WholeBillTender,
    manualAmount?: string,
    basket?: CounterPaymentBasket,
    onSubmission?: (id: string) => void,
  ): Promise<WholeBillResult> {
    const person = this.#personSource?.() ?? null;
    const { lateSend, ...basketFields } = basket ?? {};
    const key = JSON.stringify([
      status,
      tender.method,
      tender.entry,
      tender.tendered,
      manualAmount,
      tender.addedTip,
      tender.externalRef,
      tender.externalProvider,
      tender.externalMachine,
      tender.readerId,
      tender.simulationOutcome,
      tender.dining,
      tender.receiptLanguage,
      basket === undefined ? null : [basketFields, lateSend?.menuIds],
    ]);
    const pending = this.#unansweredWholeBills.get(id);
    const earlier = pending?.person === person && pending.key === key ? pending.request : undefined;
    let request = earlier;
    if (request === undefined && basket !== undefined) {
      request = structuredClone({
        ...tender,
        kind: "share",
        shareOf: 1,
        submissionId: crypto.randomUUID(),
        basket,
      });
    }
    if (request === undefined) {
      const balance = await this.getBillBalance(id);
      if (person !== (this.#personSource?.() ?? null)) throw { code: SESSION_PERSON_REFUSAL };
      if (balance.status === "settled")
        return { outcome: "settled", balance, invoice: await this.getFiledTicket(id) };
      if (balance.status !== status)
        throw {
          code: status === "placed" ? "working_order.not_placed" : "working_order.not_open",
          workingOrderId: id,
        };
      if (balance.payments.some((payment) => payment.state === "pending"))
        throw { code: "order.payment_in_flight", workingOrderId: id };
      if (
        tender.tendered !== undefined &&
        compareDecimal(decimal(tender.tendered), decimal(balance.outstanding)) < 0
      )
        throw { code: "sale.tender_shortfall", workingOrderId: id };
      const zero = compareDecimal(decimal(balance.total), decimal("0")) === 0;
      request = {
        ...tender,
        ...(zero ? { kind: "contribution", amount: "0.00" } : { kind: "share", shareOf: 1 }),
        applied: manualAmount ?? balance.outstanding,
        tip: tender.addedTip ?? "0.00",
        submissionId: crypto.randomUUID(),
      };
    }

    const sent = { person, key, request };
    onSubmission?.(request.submissionId);
    try {
      const result = await this.#request<WholeBillResult>(
        `/api/working-orders/${id}/payments`,
        "POST",
        request,
      );
      if (result.outcome === "pending" || result.outcome === "timeout")
        this.#unansweredWholeBills.set(id, sent);
      else this.#unansweredWholeBills.delete(id);
      return result;
    } catch (error) {
      if (error instanceof SyntaxError) {
        this.#unansweredWholeBills.set(id, sent);
        throw new TypeError("The payment response could not be read", { cause: error });
      }
      const refusal = error as { code?: string; status?: number; field?: string };
      // The payment route raises `menu.reset_required` only after its submission lookup found no
      // payment, inside a transaction it undoes, so this 500 recorded nothing.
      if (
        isNetworkFailure(error) ||
        ((refusal.status ?? 0) >= 500 && refusal.code !== "menu.reset_required")
      )
        this.#unansweredWholeBills.set(id, sent);
      else if (refusal.code !== "handover.stepping_down" || earlier === undefined)
        this.#unansweredWholeBills.delete(id);
      if (
        basket !== undefined &&
        refusal.code === "management.request_invalid" &&
        refusal.field === "tendered"
      )
        throw { code: "sale.tender_shortfall", workingOrderId: id };
      throw error;
    }
  }

  /** `moveDishStation` for a kitchen display's station screen → its device route. */
  async deviceMoveDishStation(
    orderId: string,
    body: StationMoveBody,
    options: ReadOptions = {},
  ): Promise<StationMoveAnswer> {
    const person = this.#personSource?.() ?? null;
    const answer = await this.#request<StationMoveAnswer>(
      `/api/device/working-orders/${orderId}/lines/move-station`,
      "POST",
      body,
      options.signal,
    );
    if (answer.personNotSignedIn === true) this.#noticeRefusal(SESSION_PERSON_REFUSAL, person);
    return answer;
  }

  async #request<T>(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
    {
      headers,
      namesPerson = true,
    }: { headers?: Record<string, string>; namesPerson?: boolean } = {},
  ): Promise<T> {
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : {
            method,
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const person = namesPerson ? (this.#personSource?.() ?? null) : null;
    if (headers !== undefined)
      init.headers = { ...(init.headers as Record<string, string> | undefined), ...headers };
    if (signal !== undefined) init.signal = signal;
    const madeHereSource = this.#madeHereSource?.();
    const res = await this.#fetchFor(person)(this.#baseUrl + path, init);
    if (!res.ok) {
      // The body is untrusted: it may not be JSON, and the literal `null` is valid JSON, so the parsed
      // value is checked for being an object before `.error` is read off it.
      const parsed: unknown = await res.json().catch(() => undefined);
      const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
      const rawCode = envelope?.code;
      const code = typeof rawCode === "string" ? rawCode : "server.internal";
      const rawParams = envelope?.params;
      const params = isRecord(rawParams) ? rawParams : undefined;
      this.#noticeRefusal(code, person);
      // `params` first, so a `code` or `status` key inside it cannot overwrite the validated ones.
      throw { ...params, code, status: res.status };
    }
    const text = await res.text();
    const answer: unknown = text === "" ? undefined : JSON.parse(text);
    if (
      madeHereSource !== undefined &&
      isRecord(answer) &&
      Array.isArray(answer.madeHere) &&
      answer.madeHere.length > 0
    )
      this.#madeHereListener?.(answer.madeHere as MadeHereItem[], madeHereSource);
    rememberInvoiceEvidence(answer);
    return answer as T;
  }
}
