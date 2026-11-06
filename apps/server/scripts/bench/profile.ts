/** How a bill is paid: the route the till sends it through. */
export type PaymentRoute = "pay" | "payments-reader" | "payments-cash" | "collect";

export const PAYMENT_ROUTES: readonly PaymentRoute[] = [
  "pay",
  "payments-reader",
  "payments-cash",
  "collect",
];

/** The year the bench builds (A1308 slice 0's Global Constraints). */
export const BENCH_PROFILE = {
  startDate: "2025-11-03",
  days: 360,
  billsPerDay: 250,
  /** The mean; each pair of bills holds exactly twice this between them. */
  linesPerBill: 4,
  roundsPerBill: { min: 2, max: 3 },
  /** The chance a round after a bill's first is sent ahead, held, and fired when it is due. */
  heldRoundShare: 1 / 3,
  /**
   * The share of all bills that ask for a full invoice, which the receipt printed at payment
   * carries. Only bills paid through `/payments` do: `/api/pay` refuses one
   * (`sale.full_invoice_unavailable`).
   */
  invoiceShare: 1 / 25,
  tills: 4,
  kitchenScreens: 2,
  thermalPrinters: 3,
  dishes: 150,
  zones: 6,
  departments: 2,
  tablesPerZone: 12,
  waiters: 8,
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  /**
   * The share of bills paid through each route. About two thirds are card: every `pay` (reader
   * card) and every `payments-reader`; `payments-cash` and `collect` are cash.
   */
  paymentMix: {
    pay: 0.45,
    "payments-reader": 0.225,
    "payments-cash": 0.225,
    collect: 0.1,
  } satisfies Record<PaymentRoute, number>,
} as const;

/**
 * The routes a day's bills are paid through, in order. Each prefix holds each route's share to
 * within one bill, so even a ten-bill day uses all four.
 */
export function paymentRoutesFor(bills: number): PaymentRoute[] {
  const used: Record<PaymentRoute, number> = {
    pay: 0,
    "payments-reader": 0,
    "payments-cash": 0,
    collect: 0,
  };
  const routes: PaymentRoute[] = [];
  for (let k = 0; k < bills; k++) {
    let chosen: PaymentRoute = "pay";
    let best = -Infinity;
    for (const route of PAYMENT_ROUTES) {
      const owed = BENCH_PROFILE.paymentMix[route] * (k + 1) - used[route];
      if (owed > best) {
        best = owed;
        chosen = route;
      }
    }
    used[chosen] += 1;
    routes.push(chosen);
  }
  return routes;
}
