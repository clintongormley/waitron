import { describe, expect, it } from "vitest";
import type { RefundAuditRow, RefundEvidence } from "@waitron/payments";
import { refundAudit } from "./refund-audit.js";
const period = { from: new Date("2026-07-01T22:00:00Z"), to: new Date("2026-07-02T22:00:00Z") };
const at = "2026-07-02T12:00:00.000Z";
const row = (id: string | null = "r1", amount = "2.35"): RefundAuditRow => ({
  provider: "sumup",
  paymentRef: "pay",
  workingOrderId: "order",
  externalRef: "charge",
  externalProvider: null,
  externalMachine: null,
  state: "partially_refunded",
  settledAt: "2026-06-01T12:00:00.000Z",
  updatedAt: at,
  refunds: [{ id: "local-r1", providerRefundRef: id, amount: amount as never, createdAt: at }],
});
const event = (id = "r1", amount = "2.35", time = at) => ({ id, amount, at: time });
const runs = (events = [event()]) =>
  ["2026-07-01", "2026-07-02"].map((day) => ({
    periodFrom: `${day}T00:00:00.000Z`,
    periodTo: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString(),
    generation: 0,
    summary: {
      backupMatches: [],
      backupUnmatched: [],
      refundEvidence: {
        complete: true,
        checkedAt: "2026-07-03T00:05:00.000Z",
        parents: [{ processorRef: "charge", events }],
      } as RefundEvidence,
    },
  }));
describe("refund comparison", () => {
  it("confirms identity and exact amount across dates before clipping, retaining both times on disagreements", () => {
    const old = "2026-06-30T12:00:00.000Z";
    const matched = refundAudit(period, runs([event("r1", "2.35", old)]), [row()]);
    expect(matched.matches).toEqual([]);
    expect(matched.exceptions).toEqual([]);
    const mismatch = refundAudit(period, runs([event("r1", "3.00", old)]), [row()]);
    expect(mismatch.exceptions).toMatchObject([
      {
        reason: "amount",
        providerAt: old,
        localAt: at,
        localAmount: "2.35",
        providerAmount: "3.00",
      },
    ]);
    expect(refundAudit(period, runs(), [row()]).matches).toMatchObject([
      { providerRefundRef: "r1", paymentRef: "pay", workingOrderId: "order" },
    ]);
  });
  it("keeps unique no-ID amount agreements unverified and refuses ambiguous or duplicate claims", () => {
    expect(refundAudit(period, runs(), [row(null)]).agreements).toHaveLength(1);
    const duplicate = row();
    duplicate.refunds.push({ ...duplicate.refunds[0]!, id: "local-r2" });
    expect(refundAudit(period, runs(), [duplicate]).matches).toEqual([]);
    expect(
      refundAudit(period, runs(), [duplicate]).exceptions.map((item) => item.reason),
    ).toContain("ambiguous");
    expect(refundAudit(period, runs([event("r1"), event("r2")]), [row(null)]).agreements).toEqual(
      [],
    );
  });
  it("pairs a backup refund only through its existing unique capture link, otherwise records it outside", () => {
    const manual = {
      ...row(null),
      provider: "manual",
      externalProvider: "connected_account",
      externalRef: "operation",
      externalMachine: "Second Solo",
    } as RefundAuditRow;
    const history = runs();
    const linked = {
      ...history[0]!,
      periodFrom: "2026-06-01T00:00:00.000Z",
      periodTo: "2026-06-02T00:00:00.000Z",
      summary: {
        ...history[0]!.summary,
        backupMatches: [
          {
            references: ["charge"],
            paymentRef: "pay",
            workingOrderId: "order",
            amount: "10.00",
            settledAt: manual.settledAt!,
            externalRef: "operation",
            externalMachine: "Second Solo",
          },
        ],
      },
    };
    expect(
      refundAudit(period, [...history, linked], [{ ...manual, refunds: [] }]).exceptions,
    ).toMatchObject([{ paymentRef: "pay" }]);
    expect(refundAudit(period, [...history, linked], [manual]).agreements).toMatchObject([
      { externalMachine: "Second Solo" },
    ]);
    expect(refundAudit(period, history, [manual]).outside).toMatchObject([{ paymentRef: "pay" }]);
  });
  it("shows missing sides, incomplete reasons and void context without inventing refund events", () => {
    const missing = refundAudit(period, runs(), []);
    expect(missing.exceptions).toMatchObject([{ reason: "missing_local", processorRef: "charge" }]);
    expect(refundAudit(period, runs([]), [row()]).exceptions).toMatchObject([
      { reason: "missing_provider" },
    ]);
    expect(
      refundAudit(period, runs(), [{ ...row(), state: "voided", refunds: [] }]).exceptions,
    ).toMatchObject([{ reason: "void" }]);
    const history = runs();
    history[1]!.summary.refundEvidence = {
      complete: false,
      checkedAt: "2026-07-04T00:05:00.000Z",
      parents: [{ processorRef: "charge", events: [], issue: "not_found" }],
    };
    for (const current of [row(), { ...row(), state: "voided" as const, refunds: [] }])
      expect(refundAudit(period, history, [current])).toMatchObject({
        complete: false,
        exceptions: expect.arrayContaining([expect.objectContaining({ reason: "not_found" })]),
      });
  });
  it("selects the latest generation and detects missing UTC coverage on the venue day", () => {
    const history = runs();
    expect(refundAudit(period, history, []).complete).toBe(true);
    expect(refundAudit(period, history.slice(1), []).complete).toBe(false);
    const newer = {
      ...history[1]!,
      generation: 1,
      summary: {
        ...history[1]!.summary,
        refundEvidence: { complete: true, checkedAt: "2026-07-04T00:05:00.000Z", parents: [] },
      },
    };
    expect(refundAudit(period, [...history, newer], []).checkedAt).toContain(
      "2026-07-04T00:05:00.000Z",
    );
  });
});

it("attaches a provider-only refund to its existing unmatched charge", () => {
  const history = runs();
  const charge = {
    kind: "charge" as const,
    references: ["charge"],
    amount: "10.00",
    settledAt: "2026-07-02T10:00:00.000Z",
    reason: "unmatched" as const,
  };
  expect(
    refundAudit(
      period,
      history.map((run) => ({ ...run, summary: { ...run.summary, backupUnmatched: [charge] } })),
      [],
    ).exceptions,
  ).toMatchObject([{ charge: { amount: "10.00", settledAt: charge.settledAt } }]);
});

it("does not call an unexamined refund missing at SumUp", () => {
  for (const history of [
    [],
    runs().map((run) => ({ ...run, summary: {} })),
    runs().map((run) => ({
      ...run,
      summary: { ...run.summary, refundEvidence: { ...run.summary.refundEvidence, parents: [] } },
    })),
  ]) {
    for (const current of [row(), { ...row(), state: "voided" as const, refunds: [] }])
      expect(refundAudit(period, history, [current])).toMatchObject({
        complete: false,
        exceptions: [{ reason: "not_checked" }],
      });
  }
});

it("clips a failed lookup to its known local refund day", () => {
  const history = runs().map((run) => ({
    ...run,
    summary: {
      ...run.summary,
      refundEvidence: {
        complete: false,
        checkedAt: at,
        parents: [{ processorRef: "charge", events: [], issue: "not_found" as const }],
      },
    },
  }));
  expect(
    refundAudit(period, history, [
      { ...row(), refunds: [{ ...row().refunds[0]!, createdAt: "2026-07-01T03:00:00.000Z" }] },
    ]),
  ).toMatchObject({ complete: true, exceptions: [] });
  expect(refundAudit(period, history, [])).toMatchObject({
    complete: false,
    exceptions: [{ reason: "not_found", providerAt: null }],
  });
  expect(
    refundAudit(
      period,
      history.map((run) => ({
        ...run,
        summary: {
          ...run.summary,
          refundEvidence: {
            ...run.summary.refundEvidence,
            parents: [{ ...run.summary.refundEvidence.parents[0]!, observedAt: [at] }],
          },
        },
      })),
      [],
    ).exceptions,
  ).toMatchObject([{ providerAt: at }]);
});
it("shows a recorded void even when the provider has no refund event", () => {
  expect(
    refundAudit(period, runs([]), [{ ...row(), state: "voided", refunds: [] }]).exceptions,
  ).toMatchObject([{ reason: "void", paymentRef: "pay", localAt: null }]);
});
it("shows each side of ambiguous amount matching once", () => {
  const result = refundAudit(period, runs([event("a"), event("b")]), [row(null)]);
  expect(
    result.exceptions.map((row) => [row.providerRefundRef, row.localAmount, row.providerAmount]),
  ).toEqual([
    ["a", null, "2.35"],
    ["b", null, "2.35"],
    [null, "2.35", null],
  ]);
});

it("keeps two unidentified equal refunds distinct without repeating a padded UTC entry", () => {
  const unknown = {
    processorRef: "",
    events: [],
    issue: "missing_reference" as const,
    unidentified: { amount: "2.35", at },
  };
  const history = runs().map((run) => ({
    ...run,
    summary: {
      ...run.summary,
      refundEvidence: { complete: false, checkedAt: at, parents: [unknown, unknown] },
    },
  }));
  const older = {
    ...history[0]!,
    periodFrom: "2026-06-01T00:00:00.000Z",
    periodTo: "2026-06-02T00:00:00.000Z",
    summary: {
      refundEvidence: {
        complete: false,
        checkedAt: at,
        parents: [{ ...unknown, unidentified: { amount: "3.00", at: null } }],
      },
    },
  };
  expect(refundAudit(period, [...history, older], []).exceptions).toHaveLength(2);
});
