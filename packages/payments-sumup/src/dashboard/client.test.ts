import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, type FetchLike } from "@waitron/dashboard-kit";
import { ambiguousMerchants, SumUpPaymentsClient } from "./client.js";

describe("ambiguousMerchants", () => {
  it("reads the pickable merchants off a payment.provider_merchant_ambiguous rejection", () => {
    const merchants = [
      { code: "M1", name: "One" },
      { code: "M2", name: "Two" },
    ];
    expect(
      ambiguousMerchants({ code: "payment.provider_merchant_ambiguous", params: { merchants } }),
    ).toEqual(merchants);
  });

  it("returns an empty list when the rejection carries no merchant list", () => {
    expect(ambiguousMerchants(new Error("x"))).toEqual([]);
    expect(ambiguousMerchants({ params: {} })).toEqual([]);
  });
});

describe("SumUpPaymentsClient.readerStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for a status SumUp takes 45 seconds to give", async () => {
    const status = { online: true, pairingStatus: "paired" };
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                text: async () => JSON.stringify(status),
              } as Response),
            45_000,
          );
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const settled: { value?: unknown; error?: unknown }[] = [];
    new SumUpPaymentsClient(createRequest({ fetchImpl })).readerStatus("r-1").then(
      (value) => settled.push({ value }),
      (error: unknown) => settled.push({ error }),
    );

    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).toEqual([{ value: status }]);
  });
});
