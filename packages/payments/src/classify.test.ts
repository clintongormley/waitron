import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { classify } from "./reconcile.js";
import type { SettlementRecord } from "./reconcile.js";
import type { ReconcilableRow } from "./store.js";

const NOW = new Date("2026-07-25T12:00:00Z");
const LAG = 7 * 24 * 60 * 60 * 1000;
/** Comfortably older than NOW - LAG, so the tolerance has expired. */
const OLD = "2026-07-01T12:00:00Z";
/** Inside the tolerance window (yesterday). */
const RECENT = "2026-07-24T12:00:00Z";

function row(over: Partial<ReconcilableRow> = {}): ReconcilableRow {
  return {
    paymentRef: "ref-1",
    state: "captured",
    amount: "10.00",
    externalRef: "ext-1",
    saleId: "sale-1",
    settledAt: OLD,
    createdAt: OLD,
    auditedAt: OLD,
    workingOrderId: "wo-1",
    workingOrderStatus: "settled",
    tillId: "till-1",
    reconcileRemediatedAt: null,
    ...over,
  };
}

function record(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return { references: ["ext-1"], amount: decimal("10.00"), settledAt: NOW, ...over };
}

describe("classify", () => {
  it("reports a clean match as no mismatch at all", () => {
    const out = classify([row()], [record()], NOW, LAG);
    expect(out.rows).toEqual([]);
    expect(out.unmatched).toEqual([]);
    expect(out.checked).toBe(1);
  });

  it("classifies an unreported payment past the tolerance as unsettled", () => {
    const out = classify([row()], [], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["unsettled"]);
  });

  it("does NOT classify an unreported payment inside the tolerance", () => {
    const out = classify([row({ settledAt: RECENT, auditedAt: RECENT })], [], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("treats the tolerance boundary as exclusive on the in-flight side", () => {
    const exactly = new Date(NOW.getTime() - LAG).toISOString();
    expect(classify([row({ auditedAt: exactly })], [], NOW, LAG).rows).toEqual([]);
    const oneMsOlder = new Date(NOW.getTime() - LAG - 1).toISOString();
    expect(
      classify([row({ auditedAt: oneMsOlder })], [], NOW, LAG).rows.map((r) => r.klass),
    ).toEqual(["unsettled"]);
  });

  it("classifies a differing settled amount as drift and keeps the settlement", () => {
    const settled = record({ amount: decimal("9.50") });
    const out = classify([row()], [settled], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["drift"]);
    expect(out.rows[0].settled).toBe(settled);
  });

  it("treats a different decimal spelling of the same amount as agreement, not drift", () => {
    const out = classify(
      [row({ amount: "10.00" })],
      [record({ amount: decimal("10.0") })],
      NOW,
      LAG,
    );
    expect(out.rows).toEqual([]);
  });

  it("classifies a captured payment with no sale on a settled order as an orphan, keeping the matched settlement", () => {
    const settled = record();
    const out = classify([row({ saleId: null })], [settled], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["orphan"]);
    expect(out.rows[0].settled).toBe(settled);
  });

  it("does not treat a captured payment on an OPEN order as an orphan", () => {
    const out = classify([row({ saleId: null, workingOrderStatus: "open" })], [record()], NOW, LAG);
    expect(out.rows).toEqual([]);
  });

  it("reports a row that is both an orphan and unsettled under both classes", () => {
    const out = classify([row({ saleId: null, workingOrderStatus: "abandoned" })], [], NOW, LAG);
    expect(out.rows.map((r) => r.klass).sort()).toEqual(["orphan", "unsettled"]);
  });

  it("reports a row that is both an orphan and drift under both classes", () => {
    const settled = record({ amount: decimal("9.50") });
    const out = classify([row({ saleId: null })], [settled], NOW, LAG);
    expect(out.rows.map((r) => r.klass).sort()).toEqual(["drift", "orphan"]);
    expect(out.rows.every((r) => r.settled === settled)).toBe(true);
  });

  it("classifies an initiated row the report says settled as lostSettlement", () => {
    const out = classify(
      [row({ state: "initiated", saleId: null, settledAt: null })],
      [record()],
      NOW,
      LAG,
    );
    expect(out.rows.map((r) => r.klass)).toEqual(["lostSettlement"]);
  });

  it("leaves an initiated row with no settlement alone, however old", () => {
    const out = classify(
      [row({ state: "initiated", saleId: null, settledAt: null })],
      [],
      NOW,
      LAG,
    );
    expect(out.rows).toEqual([]);
  });

  it("reports a settlement matching no local row as unmatched", () => {
    const stray = record({ references: ["ext-stray"] });
    const out = classify([row()], [record(), stray], NOW, LAG);
    expect(out.unmatched).toEqual([stray]);
  });

  it("matches on ANY of a settlement's references, so a hosted session id matches too", () => {
    const multi = record({ references: ["pi-x", "ch-x", "ext-1"] });
    const out = classify([row()], [multi], NOW, LAG);
    expect(out.rows).toEqual([]);
    expect(out.unmatched).toEqual([]);
  });

  it("never matches a row whose external_ref is null", () => {
    const out = classify([row({ externalRef: null, saleId: "s" })], [record()], NOW, LAG);
    expect(out.rows.map((r) => r.klass)).toEqual(["unsettled"]);
    expect(out.unmatched).toHaveLength(1);
  });

  it("counts every local row it examined, mismatch or not", () => {
    expect(classify([row(), row({ paymentRef: "ref-2" })], [record()], NOW, LAG).checked).toBe(2);
  });

  it("handles an empty sweep", () => {
    expect(classify([], [], NOW, LAG)).toEqual({ checked: 0, rows: [], unmatched: [] });
  });
});
