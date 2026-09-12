import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "./provider.js";
import type { CardProviderContribution } from "./card-provider.js";
import { cardProviderById, selectCardProviders } from "./card-provider.js";

// These fakes only need to satisfy the shape `selectCardProviders`/`cardProviderById` care about
// (`providerId`); the rest of the contract (connect/build/readers) is exercised by the seats that
// implement it (Task 7 SumUp, Task 8 Stripe), not by the selector itself.
const fake = (providerId: string): CardProviderContribution =>
  ({
    providerId,
    credentialPurpose: `payments.${providerId}`,
    credentialFields: [],
    readerAdd: { kind: "reference", refLabelKey: "x" },
    connect: async () => ({ merchantName: "x", sealedPayload: {} }),
    build: () => ({}) as unknown as PaymentProvider,
    readers: {
      canUnpair: false,
      list: async () => [],
      add: async () => ({ providerRef: "x", status: "paired" }),
      status: async () => ({ online: true }),
      remove: async () => {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("selectCardProviders", () => {
  it("keys the returned map by providerId", () => {
    const sumup = fake("sumup");
    const stripe = fake("stripe");
    const byId = selectCardProviders([sumup, stripe]);
    expect(byId.get("sumup")).toBe(sumup);
    expect(byId.get("stripe")).toBe(stripe);
    expect(byId.size).toBe(2);
  });

  it("throws payment.provider_duplicate when two contributions share a providerId", () => {
    expect(() => selectCardProviders([fake("sumup"), fake("sumup")])).toThrow(
      expect.objectContaining({ code: "payment.provider_duplicate" }),
    );
  });
});

describe("cardProviderById", () => {
  it("returns the matching contribution", () => {
    const sumup = fake("sumup");
    expect(cardProviderById([sumup, fake("stripe")], "sumup")).toBe(sumup);
  });

  it("throws payment.provider_unknown for an id no contribution declares", () => {
    expect(() => cardProviderById([fake("sumup")], "stripe")).toThrow(
      expect.objectContaining({ code: "payment.provider_unknown" }),
    );
  });
});
