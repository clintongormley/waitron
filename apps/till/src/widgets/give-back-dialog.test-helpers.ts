import { vi } from "vitest";
import type { AdjustmentReason } from "../api/client.js";
import type {
  GiveBackLine,
  GiveBackPreview,
  GiveBackRequest,
  GiveBackView,
  GiveBackWay,
} from "../api/give-back-types.js";

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
    cancelled: { quantity: "1.000", owed: "20.00", back: "0.00" },
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
    cancelled: { quantity: "1.000", owed: "0.00", back: "9.50" },
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

/** An API answering every read at once, and each preview with one part for its whole amount. */
export function fakeGiveBackApi(view: GiveBackView = VIEW) {
  return {
    readGiveBack: vi.fn(async (): Promise<GiveBackView> => view),
    previewGiveBack: vi.fn(
      async (_saleId: string, request: GiveBackRequest): Promise<GiveBackPreview> =>
        previewFor(request),
    ),
    listAdjustmentReasons: vi.fn(async () => REASONS),
  };
}
