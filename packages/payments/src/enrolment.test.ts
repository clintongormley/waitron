import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { paymentPolicy, paymentRefunds, payments } from "./schema/index.js";
import { PAYMENTS_ENROLMENT } from "./enrolment.js";

const byName = new Map(PAYMENTS_ENROLMENT.map((e) => [e.table, e]));

describe("PAYMENTS_ENROLMENT", () => {
  it("enrols payments, payment_refunds, payment_policy", () => {
    expect([...byName.keys()].sort()).toEqual(["payment_policy", "payment_refunds", "payments"]);
  });
  it("payments/payment_refunds ride the FAST lane; payment_policy keys on tenant_id", () => {
    expect(byName.get("payments")).toMatchObject({
      mode: "watermark-upsert",
      watermarkColumn: "updated_at",
      captureOps: ["insert", "update"],
      fkRank: 3,
      lane: "fast",
    });
    expect(byName.get("payment_refunds")).toMatchObject({
      mode: "insert-only",
      watermarkColumn: null,
      captureOps: ["insert"],
      fkRank: 4,
      lane: "fast",
    });
    expect(byName.get("payment_policy")).toMatchObject({
      mode: "watermark-upsert",
      conflictKey: ["tenant_id"],
      watermarkColumn: "updated_at",
      captureOps: ["insert", "update"],
      fkRank: 0,
      lane: "ordered",
    });
  });
  it("columns are derived from the schema", () => {
    expect(byName.get("payments")!.columns).toEqual(
      Object.values(getTableColumns(payments)).map((c) => c.name),
    );
    expect(byName.get("payment_refunds")!.columns).toEqual(
      Object.values(getTableColumns(paymentRefunds)).map((c) => c.name),
    );
    expect(byName.get("payment_policy")!.columns).toEqual(
      Object.values(getTableColumns(paymentPolicy)).map((c) => c.name),
    );
  });
});
