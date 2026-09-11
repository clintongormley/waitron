import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { sumupClient } from "./sumup-client.js";

// `sumup-client.ts` is COVERAGE-excluded (the real HTTP boundary), not import-excluded: this test
// still runs and pins the one behaviour a live SumUp outage makes fiscal-critical — a hung call must
// not hang forever. A fetch that never resolves models the outage; the client's own AbortController
// deadline is what turns it into a bounded rejection, which `collect`/`resolvePending` already treat
// as pending/defer (CLAUDE.md §5 — nothing external may freeze the sale or the pass loop).
describe("sumupClient request deadline", () => {
  it("aborts and rejects a hung request within the timeout rather than hanging forever", async () => {
    let abortSignal: AbortSignal | undefined;
    const neverResolving: typeof fetch = (_url, init) => {
      abortSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        abortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    };
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: neverResolving,
      timeoutMs: 50,
    });
    const started = Date.now();
    await expect(client.findTransaction({ id: "txn_1" })).rejects.toThrow();
    // Bounded well under vitest's testTimeout: the deadline fired, not the runner.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(abortSignal?.aborted).toBe(true);
  });
});

// The refund `amount` goes to SumUp's `/v1.0/.../refunds` endpoint, whose `amount` is in MINOR
// units (integer cents) — the same unit as the checkout `value`, NOT euros. Sending euros (`0.40`)
// truncates to `0` cents, so SumUp performs a silent €0.00 refund and still answers 201 (measured
// against the live reader 2026-09-11, docs/research/2026-09-10-sumup-solo-experiments.md §4b). These
// pin the unit and the documented route so a regression to euros — or to the undocumented, older
// `/v0.2/refund` route — fails here.
describe("sumupClient refund", () => {
  function capturing(): { fetch: typeof fetch; url(): string; body(): string | undefined } {
    let seenUrl = "";
    let seenBody: string | undefined;
    const f: typeof fetch = (url, init) => {
      seenUrl = String(url);
      const b = (init as RequestInit | undefined)?.body;
      seenBody = b === undefined || b === null ? undefined : String(b);
      return Promise.resolve(
        new Response("{}", { status: 201, headers: { "content-type": "application/json" } }),
      );
    };
    return { fetch: f, url: () => seenUrl, body: () => seenBody };
  }

  it("sends a partial refund amount in minor units (integer cents), not euros", async () => {
    const cap = capturing();
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: cap.fetch });

    const outcome = await client.refund({ transactionId: "txn_1", amount: decimal("0.40") });

    expect(outcome.status).toBe("accepted");
    expect(JSON.parse(cap.body() ?? "null")).toEqual({ amount: 40 });
    // The documented, current endpoint — never the undocumented /v0.2/refund route.
    expect(cap.url()).toContain("/v1.0/merchants/MC/payments/txn_1/refunds");
  });

  it("omits the amount for a full refund, so SumUp refunds the whole transaction", async () => {
    const cap = capturing();
    const client = sumupClient({ apiKey: "k", merchantCode: "MC", fetch: cap.fetch });

    await client.refund({ transactionId: "txn_1" });

    expect(cap.body()).toBe("{}");
  });
});
