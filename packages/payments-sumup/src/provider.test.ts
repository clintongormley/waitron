import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { decimal, isAppError, tenantId as brandTenantId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { setup } from "./testing/setup.js";
import { cardFromTransaction, mapEntryMode } from "./provider.js";

describe("SumUp card details mapping", () => {
  it("maps SumUp entry modes to the four normalised values", () => {
    expect(mapEntryMode("contactless")).toBe("contactless");
    expect(mapEntryMode("chip")).toBe("chip");
    expect(mapEntryMode("magstripe")).toBe("swipe");
    expect(mapEntryMode("swipe")).toBe("swipe");
    expect(mapEntryMode("something_new")).toBe("unknown");
    expect(mapEntryMode(undefined)).toBe("unknown");
  });

  it("builds CardDetails from a transaction that carries the fields", () => {
    expect(
      cardFromTransaction({
        id: "t1",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "5838", type: "VISA_ELECTRON" },
        entryMode: "contactless",
        authCode: "328600",
      }),
    ).toEqual({
      scheme: "VISA ELECTRON",
      last4: "5838",
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("returns undefined when the transaction carries no card object", () => {
    expect(
      cardFromTransaction({ id: "t2", status: "SUCCESSFUL", amount: decimal("1.00") }),
    ).toBeUndefined();
  });

  it("returns undefined for a malformed last4 (not exactly four digits) so it never reaches the store", () => {
    expect(
      cardFromTransaction({
        id: "t2b",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "58380", type: "VISA" },
      }),
    ).toBeUndefined();
  });

  it("still builds a block when auth_code is missing (null), never throwing", () => {
    expect(
      cardFromTransaction({
        id: "t3",
        status: "SUCCESSFUL",
        amount: decimal("1.00"),
        card: { last4: "6017", type: "VISA" },
        entryMode: "chip",
      }),
    ).toEqual({ scheme: "VISA", last4: "6017", entryMode: "chip", authCode: null });
  });
});

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

  it("a captured collect result carries the card block from the transaction", async () => {
    const { provider, params } = await setup(suite);
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toEqual({
      scheme: "VISA",
      last4: "5838",
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("captures without failing when the transaction has no card fields (card undefined, never throws)", async () => {
    const { provider, params } = await setup(suite, (f) => f.cardNext(null));
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toBeUndefined();
  });

  it("a SUCCESSFUL transaction with a malformed last4 still captures — the card block is dropped, never the charge", async () => {
    // The run-it reviewer's money-safety case: a 5-char last_4_digits passed the old truthy guard,
    // was built into the card block, then `payments_card_last4_ck` REJECTED the capture write
    // (23514) — a real charge stuck `attempting`. The adapter must drop malformed card facts so the
    // capture persists with card columns null (CLAUDE.md §5); the DB CHECK stays the backstop.
    const { provider, params, row } = await setup(suite, (f) =>
      f.cardNext({
        card: { last4: "58380", type: "VISA" },
        entryMode: "contactless",
        authCode: "328600",
      }),
    );
    const result = await provider.collect(params);
    expect(result.state).toBe("captured");
    expect(result.card).toBeUndefined();
    const r = await row(result.paymentRef);
    expect(r.state).toBe("captured");
    expect(r.cardLast4).toBeNull();
    expect(r.cardScheme).toBeNull();
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
