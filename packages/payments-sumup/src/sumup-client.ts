import type { Decimal } from "@waitron/shared";
import { fromMajorUnits, toMajorUnits, toMinorUnits } from "./client.js";
import type {
  CreateCheckoutOutcome,
  SumUpClient,
  SumUpTransaction,
  TransactionQuery,
} from "./client.js";

export interface SumUpClientOptions {
  apiKey: string;
  merchantCode: string;
  /** The merchant's affiliate key (developer portal → Affiliate Keys). Absent → the `affiliate`
   * block is omitted and our `payment_ref` is NOT sent; the sweep then relies on the stamped
   * `client_transaction_id` alone. */
  affiliate?: { appId: string; key: string };
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per-request deadline. A hung SumUp call is aborted after this and rejects — the caller reads
   * that as pending/defer. Bounds the sale path and the fiscal pass loop against a SumUp outage
   * (CLAUDE.md §5: nothing external may freeze a sale). Default 20 s. */
  timeoutMs?: number;
}

/**
 * `SumUpClient` over SumUp's REST API (paths and shapes from SumUp's OpenAPI file, read
 * 2026-09-10 — docs/research/2026-09-10-sumup-solo-experiments.md, Provenance). Every request is
 * a bearer-keyed JSON call; a 5xx or a transport failure THROWS (the caller does not know whether
 * the operation happened), a 4xx is a definite refusal and is returned as data. Error bodies are
 * never included in a thrown message: they can echo request fields.
 */
export function sumupClient(opts: SumUpClientOptions): SumUpClient {
  const base = (opts.baseUrl ?? "https://api.sumup.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const mc = encodeURIComponent(opts.merchantCode);
  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500) throw new Error(`sumup ${method} ${path}: HTTP ${res.status}`);
    const text = await res.text();
    return { status: res.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
  };
  const problemTitle = (json: unknown): string =>
    typeof json === "object" &&
    json !== null &&
    typeof (json as { title?: unknown }).title === "string"
      ? (json as { title: string }).title
      : "refused";

  return {
    async createCheckout(p): Promise<CreateCheckoutOutcome> {
      const body = {
        total_amount: { currency: p.currency, minor_unit: 2, value: toMinorUnits(p.amount) },
        description: p.description,
        ...(opts.affiliate
          ? {
              affiliate: {
                app_id: opts.affiliate.appId,
                key: opts.affiliate.key,
                foreign_transaction_id: p.foreignTransactionId,
              },
            }
          : {}),
      };
      const r = await call(
        "POST",
        `/v0.1/merchants/${mc}/readers/${encodeURIComponent(p.readerId)}/checkout`,
        body,
      );
      if (r.status >= 400) return { accepted: false, reason: problemTitle(r.json) };
      const data = (r.json as { data: { checkout_id: string; client_transaction_id: string } })
        .data;
      return {
        accepted: true,
        checkoutId: data.checkout_id,
        clientTransactionId: data.client_transaction_id,
      };
    },
    async findTransaction(q: TransactionQuery): Promise<SumUpTransaction | null> {
      const param =
        "clientTransactionId" in q
          ? `client_transaction_id=${encodeURIComponent(q.clientTransactionId)}`
          : "foreignTransactionId" in q
            ? `foreign_transaction_id=${encodeURIComponent(q.foreignTransactionId)}`
            : `id=${encodeURIComponent(q.id)}`;
      const r = await call("GET", `/v2.1/merchants/${mc}/transactions?${param}`);
      if (r.status === 404) return null;
      if (r.status >= 400) throw new Error(`sumup GET transactions: HTTP ${r.status}`);
      const t = r.json as { id: string; status: string; amount: number };
      return { id: t.id, status: t.status, amount: fromMajorUnits(t.amount) };
    },
    async refund(p: { transactionId: string; amount?: Decimal }) {
      const r = await call(
        "POST",
        `/v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds`,
        p.amount === undefined ? {} : { amount: toMajorUnits(p.amount) },
      );
      return { status: r.status >= 400 ? "refused" : "accepted" } as const;
    },
  };
}
