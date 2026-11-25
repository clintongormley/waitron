import { vi } from "vitest";
import type { AdjustmentReason, StaffMember, TillApi } from "../api/client.js";
import type {
  GiveBackLine,
  GiveBackOutcome,
  GiveBackPreview,
  GiveBackWrite,
  GiveBackRequest,
  GiveBackView,
  GiveBackWay,
} from "../api/give-back-types.js";
import type { InvoiceCorrectionView } from "../api/invoice-correction-types.js";
import type { RefundableTender } from "../api/tender-refund-types.js";

const reason = (id: string, name: string, noteRequired = false) =>
  ({
    id,
    name,
    kind: "void",
    actions: ["cancel"],
    noteRequired,
    maxPercentBp: null,
    maxAmount: null,
  }) as AdjustmentReason;
export const REASONS = [reason("complaint", "Complaint"), reason("other", "Other", true)];

const line = (over: Partial<GiveBackLine> & { id: string; name: string }): GiveBackLine => {
  const { name, ...rest } = over;
  return {
    descriptions: { en: name, es: name },
    quantity: "1.000",
    gross: "10.00",
    left: "10.00",
    cancelled: null,
    cancelIds: [],
    partOf: null,
    givenFree: false,
    available: true,
    reason: null,
    ...rest,
  };
};

/** Croquetas served, a paella cancelled and still owed with a priced extra, a salad whose cancel
 * was paid back, and a cake given free. */
export const LINES: GiveBackLine[] = [
  line({ id: "croquetas", name: "Croquetas", quantity: "2.000", gross: "8.00", left: "8.00" }),
  line({
    id: "paella",
    name: "Paella",
    gross: "18.50",
    left: "20.00",
    cancelled: { quantity: "1.000", owed: "20.00", back: "0.00", waiting: "0.00" },
    cancelIds: ["cancel-1"],
  }),
  line({
    id: "aioli",
    name: "Aioli",
    gross: "1.50",
    left: "0.00",
    partOf: "paella",
    available: false,
  }),
  line({
    id: "salad",
    name: "Salad",
    gross: "9.50",
    left: "0.00",
    cancelled: { quantity: "1.000", owed: "0.00", back: "9.50", waiting: "0.00" },
    available: false,
  }),
  line({
    id: "cake",
    name: "Cake",
    gross: "0.00",
    left: "0.00",
    givenFree: true,
    available: false,
  }),
];

export const CASH: GiveBackWay = {
  way: "cash",
  last4: null,
  manual: false,
  moneyLeft: "30.00",
  extraLeft: "0.00",
  pending: false,
  allowedHere: true,
  reason: null,
};
export const CARD: GiveBackWay = {
  way: "card-1",
  last4: "4242",
  manual: false,
  moneyLeft: "17.00",
  extraLeft: "3.00",
  pending: false,
  allowedHere: true,
  reason: null,
};

export const VIEW: GiveBackView = {
  lines: LINES,
  ways: [CASH, CARD],
  underWay: null,
  choices: {
    dishes: { available: true, reason: null },
    goodwill: { available: true, reason: null },
    extra: { available: true, reason: null },
  },
};

export const previewFor = (request: GiveBackRequest): GiveBackPreview => ({
  parts: [{ kind: "refund", amount: request.amount, way: request.way }],
  leftUnderWay: "0.00",
  needs: [],
  manual: false,
});

/** A correction a give-back left open, with €2.00 of €6.00 back and filing offered. */
export const UNDER_WAY: InvoiceCorrectionView = {
  id: "correction-1",
  saleId: "sale-1",
  state: "open",
  gross: "6.00",
  moneyBack: "2.00",
  pending: "0.00",
  left: "4.00",
  reason: "Complaint",
  openedAt: "2026-11-13T10:00:00.000Z",
  correctiveSaleId: null,
  legs: [],
  fileNow: { gross: "2.00", vatBreakdown: [{ rate: "10.00", base: "1.82", tax: "0.18" }] },
};

export const APPROVERS: StaffMember[] = [{ personId: "boss", displayName: "Boss" }];
export const SCOPE = { deviceId: "device-1", personId: "person-1" };

/** Every part of `body` given back. */
export const completedFor = (body: GiveBackWrite): GiveBackOutcome => ({
  parts: body.expected.map((part) => ({
    kind: part.kind,
    amount: part.amount,
    state: "completed",
  })),
  refusal: null,
  underWay: null,
  rest: null,
});

/** An API answering every read at once, each preview with one part for its whole amount, and
 * each give-back with every part given back. */
export function fakeGiveBackApi(view: GiveBackView = VIEW) {
  return {
    readGiveBack: vi.fn(async (): Promise<GiveBackView> => view),
    previewGiveBack: vi.fn(
      async (_saleId: string, request: GiveBackRequest): Promise<GiveBackPreview> =>
        previewFor(request),
    ),
    listAdjustmentReasons: vi.fn(async () => REASONS),
    listApprovers: vi.fn<TillApi["listApprovers"]>(async () => APPROVERS),
    giveBack: vi.fn(async (_saleId: string, body: GiveBackWrite): Promise<GiveBackOutcome> =>
      completedFor(body),
    ),
    getTenderRefund: vi.fn<(refundId: string, options: object) => Promise<{ state: string }>>(
      async () => ({ state: "completed" }),
    ),
    ...underWayStubs(),
  };
}

/** The reads and writes the under-way view sends, each answering an open correction. */
export function underWayStubs(correction: InvoiceCorrectionView = UNDER_WAY) {
  return {
    getInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => correction),
    getRefundableTenders: vi.fn(async (): Promise<RefundableTender[]> => [
      {
        tenderId: "cash-1",
        method: "cash",
        last4: null,
        appliedRemaining: "30.00",
        tipRemaining: "0.00",
        pendingRefundId: null,
        manual: false,
      },
    ]),
    fileInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => ({
      ...correction,
      state: "filed",
    })),
    closeInvoiceCorrection: vi.fn(async (): Promise<InvoiceCorrectionView> => ({
      ...correction,
      state: "discarded",
    })),
    giveInvoiceCorrectionCash: vi.fn<TillApi["giveInvoiceCorrectionCash"]>(),
    refundTransaction: vi.fn<TillApi["refundTransaction"]>(),
    retryTenderRefund: vi.fn<TillApi["retryTenderRefund"]>(),
  };
}
