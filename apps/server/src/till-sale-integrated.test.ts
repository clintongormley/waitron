import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import type { PaymentResult } from "@waitron/payments";
import { toPayOutcome } from "./till-sale.js";
import type { TillSaleResult } from "./till-sale.js";

// The orchestrator calls `toPayOutcome` only for non-captured states, so this is the one place its
// `captured`/`accepted_offline` arms run.

const TICKET: TillSaleResult = {
  orderLabel: null,
  orderNumber: 1,
  invoiceNumber: "A/1",
  issuedAt: "2026-08-06T10:00:00.000Z",
  total: "1.50",
  vatBreakdown: [{ rate: "21.00", base: "1.24", tax: "0.26" }],
  lines: [{ descriptions: { "es-ES": "Café" }, quantity: "1", gross: "1.50" }],
  tender: { method: "cash", change: "0.00" },
  qr: "https://example.test/verify",
};

function result(state: PaymentResult["state"]): PaymentResult {
  return {
    provider: "stripe",
    paymentRef: "ref-1",
    state,
    amount: decimal("1.50"),
    settledAt: state === "captured" || state === "accepted_offline" ? new Date() : null,
  };
}

describe("toPayOutcome", () => {
  it("captured → { outcome: 'captured', ticket }", () => {
    expect(toPayOutcome(result("captured"), TICKET)).toEqual({
      outcome: "captured",
      ticket: TICKET,
    });
  });

  it("accepted_offline → { outcome: 'captured', ticket } (the offline card chained a sale immediately)", () => {
    expect(toPayOutcome(result("accepted_offline"), TICKET)).toEqual({
      outcome: "captured",
      ticket: TICKET,
    });
  });

  it("network_unavailable → { outcome: 'network_unavailable' } (nothing filed, retryable)", () => {
    expect(toPayOutcome(result("network_unavailable"), null)).toEqual({
      outcome: "network_unavailable",
    });
  });

  it("failed → { outcome: 'declined' } (a decline OR a poll-window stall — the provider collapses both)", () => {
    expect(toPayOutcome(result("failed"), null)).toEqual({ outcome: "declined" });
  });

  it("maps an attempting result (SumUp poll timeout) to the timeout arm", () => {
    expect(toPayOutcome(result("attempting"), null)).toEqual({ outcome: "timeout" });
  });
});
