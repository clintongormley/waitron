import type { Decimal } from "@waitron/shared";
import { fromMajorUnits, toMinorUnits } from "./client.js";
import type {
  CreateCheckoutOutcome,
  SumUpClient,
  SumUpTransaction,
  TransactionQuery,
} from "./client.js";

/**
 * A DEFINITE reader-pairing refusal from SumUp — a 4xx on `pairReader` (an invalid, expired or
 * already-used pairing code, the common operator mistake). Distinct from the generic 5xx/transport
 * `Error` the client throws when the outcome is UNKNOWN, so the seat maps only this to the
 * operator-actionable `payment.pairing_refused` and lets a real fault stay a 500. Carries SumUp's
 * problem `title` for the installer's log only — never a secret (the title is a status phrase, not a
 * request echo), and never rendered to the box operator, who sees the fixed `codes.ts` copy. */
export class SumUpPairingRefused extends Error {
  constructor(readonly title: string) {
    super(`sumup pairReader refused: ${title}`);
    this.name = "SumUpPairingRefused";
  }
}

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
    method: "GET" | "POST" | "DELETE",
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
      const t = r.json as {
        id: string;
        status: string;
        amount: number;
        card?: { last_4_digits?: string; type?: string };
        entry_mode?: string;
        auth_code?: string | null;
      };
      // Card facts are best-effort receipt decoration: emit the `card` block only when it is
      // well-formed enough to PERSIST — `last_4_digits` exactly four digits (matching the
      // `payments_card_last4_ck` CHECK) plus a `type`. A malformed value drops the whole block so a
      // real capture still records; the DB CHECK stays the backstop (CLAUDE.md §5).
      const card =
        t.card?.last_4_digits !== undefined &&
        /^\d{4}$/.test(t.card.last_4_digits) &&
        t.card.type !== undefined
          ? { last4: t.card.last_4_digits, type: t.card.type }
          : undefined;
      return {
        id: t.id,
        status: t.status,
        amount: fromMajorUnits(t.amount),
        ...(card === undefined ? {} : { card }),
        ...(t.entry_mode === undefined ? {} : { entryMode: t.entry_mode }),
        ...(t.auth_code === undefined ? {} : { authCode: t.auth_code }),
      };
    },
    async refund(p: { transactionId: string; amount?: Decimal }) {
      const r = await call(
        "POST",
        `/v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds`,
        // `amount` is in MINOR units (integer cents), like the checkout `value` — NOT euros. Euros
        // truncate to 0 cents and SumUp silently refunds €0.00 with a 201 (runbook §4b). Omitting
        // `amount` (a full refund) refunds the whole transaction.
        p.amount === undefined ? {} : { amount: toMinorUnits(p.amount) },
      );
      return { status: r.status >= 400 ? "refused" : "accepted" } as const;
    },
    async listReaders() {
      const r = await call("GET", `/v0.1/merchants/${mc}/readers`);
      const items = (r.json as { items: { id: string; name: string; status: string }[] }).items;
      return items.map((i) => ({ id: i.id, name: i.name, status: i.status }));
    },
    async pairReader(p: { pairingCode: string; name: string }) {
      const r = await call("POST", `/v0.1/merchants/${mc}/readers`, {
        pairing_code: p.pairingCode,
        name: p.name,
      });
      // A 4xx is a DEFINITE refusal (bad/expired/used pairing code). Throw so the route never inserts
      // a `card_readers` row with a null `provider_ref` (a NOT-NULL violation → opaque 500); the seat
      // maps this to the actionable `payment.pairing_refused`. The old code returned the error body
      // here, so `{ id, status }` came back undefined and the null ref reached the insert.
      if (r.status >= 400) throw new SumUpPairingRefused(problemTitle(r.json));
      const data = r.json as { id?: unknown; status?: unknown };
      // A 2xx with a malformed body cannot yield a usable reader id either — refuse rather than seal
      // an undefined ref.
      if (typeof data.id !== "string" || typeof data.status !== "string")
        throw new SumUpPairingRefused("malformed reader response");
      return { id: data.id, status: data.status };
    },
    async getReader(readerId: string) {
      const r = await call("GET", `/v0.1/merchants/${mc}/readers/${encodeURIComponent(readerId)}`);
      // 404 (and any other 4xx: an unknown/removed reader) → null, never an object with undefined
      // fields — the seat treats null as "cannot confirm pairing" and leaves `pairingStatus` unset.
      if (r.status >= 400) return null;
      const data = r.json as { id?: unknown; status?: unknown };
      if (typeof data.id !== "string" || typeof data.status !== "string") return null;
      return { id: data.id, status: data.status };
    },
    async readerStatus(readerId: string) {
      const r = await call(
        "GET",
        `/v0.1/merchants/${mc}/readers/${encodeURIComponent(readerId)}/status`,
      );
      const data = (
        r.json as { data: { status: string; connection_type?: string; state?: string } }
      ).data;
      const parts = [data.connection_type, data.state].filter((v): v is string => v !== undefined);
      return {
        online: data.status === "ONLINE",
        ...(parts.length > 0 ? { detail: parts.join(" / ") } : {}),
      };
    },
    async deleteReader(readerId: string): Promise<void> {
      await call("DELETE", `/v0.1/merchants/${mc}/readers/${encodeURIComponent(readerId)}`);
    },
    async memberships() {
      const r = await call("GET", "/v0.1/memberships");
      // A 4xx (a bad key) has no `items` — throw a clear error rather than reading `.items` off an
      // error body (a confusing TypeError). `connect` catches this as a rejected credential.
      if (r.status >= 400) throw new Error(`sumup GET memberships: HTTP ${r.status}`);
      const items = (r.json as { items: { resource_id: string; resource: { name: string } }[] })
        .items;
      return items.map((i) => ({ merchantCode: i.resource_id, name: i.resource.name }));
    },
  };
}
