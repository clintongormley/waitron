import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { FakeSumUp } from "./fake-sumup.js";

const createParams = {
  readerId: "reader_1",
  amount: decimal("12.10"),
  currency: "EUR",
  description: "order 1",
  foreignTransactionId: "pay_1",
};

describe("FakeSumUp", () => {
  it("createCheckout accepts by default; the transaction is found as SUCCESSFUL", async () => {
    const fake = new FakeSumUp();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    const txn = await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId });
    expect(txn?.status).toBe("SUCCESSFUL");
    expect(txn?.amount).toBe(decimal("12.10"));
  });

  it("declineNext and cancelNext set the next checkout's resolved status", async () => {
    const fake = new FakeSumUp();
    fake.declineNext();
    const declined = await fake.createCheckout(createParams);
    if (!declined.accepted) throw new Error("expected accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: declined.clientTransactionId }))?.status,
    ).toBe("FAILED");

    fake.cancelNext();
    const cancelled = await fake.createCheckout(createParams);
    if (!cancelled.accepted) throw new Error("expected accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: cancelled.clientTransactionId }))?.status,
    ).toBe("CANCELLED");

    // The control is one-shot: the checkout after a decline/cancel goes back to SUCCESSFUL.
    const next = await fake.createCheckout(createParams);
    if (!next.accepted) throw new Error("expected accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: next.clientTransactionId }))?.status,
    ).toBe("SUCCESSFUL");
  });

  it("stallNext holds the checkout PENDING until settle resolves it", async () => {
    const fake = new FakeSumUp();
    fake.stallNext();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("PENDING");
    fake.settle(outcome.clientTransactionId);
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("SUCCESSFUL");
  });

  it("decline resolves a stalled checkout to FAILED", async () => {
    const fake = new FakeSumUp();
    fake.stallNext();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    fake.decline(outcome.clientTransactionId);
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("FAILED");
  });

  it("invisibleUntilSettled hides a PENDING transaction until settle", async () => {
    const fake = new FakeSumUp();
    fake.invisibleUntilSettled();
    fake.stallNext();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    expect(
      await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }),
    ).toBeNull();
    fake.settle(outcome.clientTransactionId);
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("SUCCESSFUL");
  });

  it("refuseNext makes createCheckout come back not-accepted, with no transaction held", async () => {
    const fake = new FakeSumUp();
    fake.refuseNext();
    const outcome = await fake.createCheckout(createParams);
    expect(outcome).toEqual({ accepted: false, reason: "Unprocessable Entity" });

    // One-shot: the following checkout is accepted again.
    const next = await fake.createCheckout(createParams);
    expect(next.accepted).toBe(true);
  });

  it("throwOnCreateNext makes createCheckout reject", async () => {
    const fake = new FakeSumUp();
    fake.throwOnCreateNext();
    await expect(fake.createCheckout(createParams)).rejects.toThrow("sumup unreachable");
    // One-shot: the following checkout succeeds normally.
    await expect(fake.createCheckout(createParams)).resolves.toMatchObject({ accepted: true });
  });

  it("throwOnFindNext makes findTransaction reject, once", async () => {
    const fake = new FakeSumUp();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    fake.throwOnFindNext();
    await expect(
      fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }),
    ).rejects.toThrow("sumup unreachable");
    await expect(
      fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }),
    ).resolves.toMatchObject({ status: "SUCCESSFUL" });
  });

  it("findTransaction looks up by clientTransactionId, foreignTransactionId, or id", async () => {
    const fake = new FakeSumUp();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    const byClientId = await fake.findTransaction({
      clientTransactionId: outcome.clientTransactionId,
    });
    const byForeignId = await fake.findTransaction({
      foreignTransactionId: createParams.foreignTransactionId,
    });
    const byId = await fake.findTransaction({ id: byClientId!.id });
    expect(byForeignId).toEqual(byClientId);
    expect(byId).toEqual(byClientId);
  });

  it("hold registers a transaction the fake never created via createCheckout, findable by foreignTransactionId", async () => {
    const fake = new FakeSumUp();
    const clientTransactionId = fake.hold({
      foreignTransactionId: "pay_orphan",
      status: "SUCCESSFUL",
      amount: decimal("4.20"),
    });
    const found = await fake.findTransaction({ foreignTransactionId: "pay_orphan" });
    expect(found?.status).toBe("SUCCESSFUL");
    expect(found?.amount).toBe(decimal("4.20"));
    expect((await fake.findTransaction({ clientTransactionId }))?.status).toBe("SUCCESSFUL");
  });

  it("setStatus writes any status, including REFUNDED or one SumUp has not documented", async () => {
    const fake = new FakeSumUp();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    fake.setStatus(outcome.clientTransactionId, "REFUNDED");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("REFUNDED");
    fake.setStatus(outcome.clientTransactionId, "SOME_FUTURE_STATUS");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("SOME_FUTURE_STATUS");
  });

  it("resolveOnFirstFind gives the next checkout its status the first time it is looked up", async () => {
    const fake = new FakeSumUp();
    fake.resolveOnFirstFind("REFUNDED");
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    // First look-up rewrites the status; it stays rewritten on subsequent look-ups.
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("REFUNDED");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("REFUNDED");
    // One-shot: the following checkout is unaffected and resolves SUCCESSFUL as usual.
    const next = await fake.createCheckout(createParams);
    if (!next.accepted) throw new Error("expected accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: next.clientTransactionId }))?.status,
    ).toBe("SUCCESSFUL");
  });

  it("setStatus throws for an unknown clientTransactionId", () => {
    const fake = new FakeSumUp();
    expect(() => fake.setStatus("ctx_missing", "SUCCESSFUL")).toThrow(
      "FakeSumUp: no checkout ctx_missing",
    );
  });

  it("refund without an amount flips the transaction to REFUNDED; a partial refund does not", async () => {
    const fake = new FakeSumUp();
    const outcome = await fake.createCheckout(createParams);
    if (!outcome.accepted) throw new Error("expected accepted");
    const txn = await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId });

    const partial = await fake.refund({ transactionId: txn!.id, amount: decimal("1.00") });
    expect(partial.status).toBe("accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("SUCCESSFUL");

    const full = await fake.refund({ transactionId: txn!.id });
    expect(full.status).toBe("accepted");
    expect(
      (await fake.findTransaction({ clientTransactionId: outcome.clientTransactionId }))?.status,
    ).toBe("REFUNDED");
  });

  it("refundRefusesNext makes the next refund come back refused, once", async () => {
    const fake = new FakeSumUp();
    fake.refundRefusesNext();
    const refused = await fake.refund({ transactionId: "txn_x" });
    expect(refused.status).toBe("refused");
    const next = await fake.refund({ transactionId: "txn_x" });
    expect(next.status).toBe("accepted");
  });

  it("records the last createCheckout and refund params, and nothing before the first call", async () => {
    const fake = new FakeSumUp();
    expect(fake.lastCreate).toBeUndefined();
    expect(fake.lastRefund).toBeUndefined();
    await fake.createCheckout(createParams);
    expect(fake.lastCreate).toEqual(createParams);
    await fake.refund({ transactionId: "txn_y", amount: decimal("2.00") });
    expect(fake.lastRefund).toEqual({ transactionId: "txn_y", amount: decimal("2.00") });
  });
});
