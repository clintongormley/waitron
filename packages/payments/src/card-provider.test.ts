import { describe, expect, it } from "vitest";
import type { PaymentProvider } from "./provider.js";
import type { CardProviderContribution } from "./card-provider.js";
import { ProviderCallFailed, cardProviderById, selectCardProviders } from "./card-provider.js";

// These fakes only need `providerId`; the rest of the contract is exercised by the seats that
// implement it.
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

describe("ProviderCallFailed", () => {
  it("carries its reason and cause, with a message naming the reason unless one is given", () => {
    const cause = new TypeError("fetch failed");
    const plain = new ProviderCallFailed("unreachable", undefined, { cause });
    expect(plain).toBeInstanceOf(Error);
    expect(plain.name).toBe("ProviderCallFailed");
    expect(plain.reason).toBe("unreachable");
    expect(plain.message).toBe("provider call failed: unreachable");
    expect(plain.cause).toBe(cause);
    expect(new ProviderCallFailed("http_429", "sumup DELETE reader: HTTP 429").message).toBe(
      "sumup DELETE reader: HTTP 429",
    );
  });
});
