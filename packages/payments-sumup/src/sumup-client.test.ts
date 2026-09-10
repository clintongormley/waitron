import { describe, expect, it } from "vitest";
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
