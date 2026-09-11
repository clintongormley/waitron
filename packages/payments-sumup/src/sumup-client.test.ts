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

// The one genuinely new mapping in `findTransaction` is SumUp's snake_case transaction JSON
// (`card.last_4_digits` / `card.type` / `entry_mode` / `auth_code`) onto our camelCase
// `SumUpTransaction`, plus the partial-card guard that omits a `card` block missing either
// sub-field. The fake stores already-mapped keys, so ONLY this real-fetch test exercises the key
// names — a typo (`last4_digits`, `auth-code`) would silently blank a receipt's card block
// otherwise (CLAUDE.md §1: reading is not verification; the body mirrors the live control run).
describe("sumupClient findTransaction card mapping", () => {
  const respondingWith =
    (body: unknown): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

  it("maps SumUp's snake_case card keys onto the camelCase SumUpTransaction", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({
        id: "txn_1",
        status: "SUCCESSFUL",
        amount: 12.5,
        card: { last_4_digits: "5838", type: "VISA" },
        entry_mode: "contactless",
        auth_code: "328600",
      }),
    });

    const t = await client.findTransaction({ id: "txn_1" });

    expect(t).toEqual({
      id: "txn_1",
      status: "SUCCESSFUL",
      amount: decimal("12.50"),
      card: { last4: "5838", type: "VISA" },
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("omits the card block when a card sub-field is missing", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      // last_4_digits present but no `type`: a partial card must not become a half-built block.
      fetch: respondingWith({
        id: "txn_2",
        status: "SUCCESSFUL",
        amount: 4.2,
        card: { last_4_digits: "6017" },
        entry_mode: "chip",
      }),
    });

    const t = await client.findTransaction({ id: "txn_2" });

    expect(t).toEqual({
      id: "txn_2",
      status: "SUCCESSFUL",
      amount: decimal("4.20"),
      entryMode: "chip",
    });
    expect(t?.card).toBeUndefined();
  });

  it("drops the card block when last_4_digits is malformed (not exactly four digits)", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      // A 5-char last_4_digits is truthy but would trip `payments_card_last4_ck` (length = 4) and
      // block the capture write for a SUCCESSFUL charge. Card facts are receipt decoration — the
      // adapter drops the block so the money still records (CLAUDE.md §5).
      fetch: respondingWith({
        id: "txn_bad",
        status: "SUCCESSFUL",
        amount: 9,
        card: { last_4_digits: "58380", type: "VISA" },
        entry_mode: "contactless",
        auth_code: "328600",
      }),
    });

    const t = await client.findTransaction({ id: "txn_bad" });

    expect(t?.card).toBeUndefined();
    expect(t).toEqual({
      id: "txn_bad",
      status: "SUCCESSFUL",
      amount: decimal("9.00"),
      entryMode: "contactless",
      authCode: "328600",
    });
  });

  it("carries no card fields at all when SumUp returns none", async () => {
    const client = sumupClient({
      apiKey: "k",
      merchantCode: "MC",
      fetch: respondingWith({ id: "txn_3", status: "SUCCESSFUL", amount: 1 }),
    });

    const t = await client.findTransaction({ id: "txn_3" });

    expect(t).toEqual({ id: "txn_3", status: "SUCCESSFUL", amount: decimal("1.00") });
  });
});
