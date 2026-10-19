import type { BillPaymentView } from "../src/api/client.js";

/** A card payment on a bill still waiting at the reader. */
export const pendingCard: BillPaymentView = {
  id: "pay-9",
  submissionId: "sub-9",
  kind: "contribution",
  shareOf: null,
  method: "card",
  entry: "reader",
  applied: "20.00",
  tip: "0.00",
  tendered: null,
  change: null,
  state: "pending",
  createdAt: "2026-10-19T20:00:00.000Z",
  receivedAt: null,
  lines: [],
  refunds: [],
};
