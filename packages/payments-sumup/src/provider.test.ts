import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { setup } from "./testing/setup.js";

// PGlite: this file proves the adapter's LOGIC (T1/T1.5/T2 sequencing, outcome mapping, the poll
// window). Whether the same writes land as a non-superuser app_user member is sumup.test.ts's
// question, which needs real Postgres (CLAUDE.md §4). Nothing here depends on the role or on
// concurrency. `setup` is shared with `reverse.test.ts` (`./testing/setup.ts`).
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});

describe("SumUpCloudProvider.collect", () => {
  it("captures: T1 attempting → checkout keyed by our payment_ref → poll → T2 captured with SumUp's transaction id", async () => {
    const { fake, provider, params, row } = await setup(suite);
    const result = await provider.collect(params);
    expect(result).toMatchObject({
      provider: "sumup",
      state: "captured",
      amount: decimal("12.50"),
    });
    expect(result.settledAt).toBeInstanceOf(Date);
    expect(fake.lastCreate).toMatchObject({
      readerId: "rdr_1",
      currency: "EUR",
      amount: decimal("12.50"),
      foreignTransactionId: result.paymentRef,
    });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("captured");
    expect(r.externalRef).toMatch(/^txn_/); // the REFUNDABLE id, not the ctx_ poll key
  });

  it("a declined card resolves failed with settledAt null", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.declineNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "failed", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a cancelled checkout resolves failed", async () => {
    const { provider, params } = await setup(suite, (f) => f.cancelNext());
    expect((await provider.collect(params)).state).toBe("failed");
  });

  it("a definite 4xx refusal of the create resolves failed (the reader never woke)", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.refuseNext());
    const result = await provider.collect(params);
    expect(result.state).toBe("failed");
    expect((await row(result.paymentRef)).state).toBe("failed");
  });

  it("a network error on the create leaves the row attempting (we do not know whether SumUp accepted it)", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.throwOnCreateNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("a poll timeout leaves the row attempting with the ctx poll key stamped, and never calls terminate", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.stallNext());
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    const r = await row(result.paymentRef);
    expect(r.state).toBe("attempting");
    expect(r.externalRef).toMatch(/^ctx_/);
  });

  it("a transaction SumUp cannot find yet is still pending, not an error", async () => {
    const { provider, params } = await setup(suite, (f) => {
      f.stallNext();
      f.invisibleUntilSettled();
    });
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("a network error mid-poll leaves the row attempting", async () => {
    const { provider, params } = await setup(suite, (f) => f.throwOnFindNext());
    expect((await provider.collect(params)).state).toBe("attempting");
  });

  it("REFUNDED during collect is not a basis for T2: the row stays attempting for the sweep", async () => {
    const { provider, params, row } = await setup(suite, (f) => f.resolveOnFirstFind("REFUNDED"));
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state: "attempting", settledAt: null });
    expect((await row(result.paymentRef)).state).toBe("attempting");
  });

  it("refuses a collect for another tenant before any network call (sumup.tenant_mismatch)", async () => {
    const { fake, provider, params } = await setup(suite);
    const other = brandTenantId("22222222-2222-4222-8222-222222222222");
    await expect(provider.collect({ ...params, tenantId: other })).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "sumup.tenant_mismatch",
    );
    expect(fake.lastCreate).toBeUndefined();
  });
});

describe("SumUpCloudProvider.forward", () => {
  it("forward is a no-op for the server-driven cloud provider (no device-local offline queue)", async () => {
    // All-zeros without touching the database — the cloud reader has no store-and-forward queue.
    const { provider } = await setup(suite);
    expect(await provider.forward(new Date("2026-07-24T10:00:00Z"))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});
