import { WAITRON_SUMUP_AFFILIATE } from "./affiliate.js";
import type { SumUpReader } from "./client.js";
import { AppError } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { RefundRefusalReason } from "@waitron/payments";
// Side-effect only: the registry for `reader.unpair_failed`.
import "@waitron/payments";
import {
  DOCUMENTED_REFUND_REFUSALS,
  fromMajorUnits,
  refundOutcomeOf,
  SUMUP_PROVIDER,
  toMinorUnits,
} from "./client.js";
import type {
  CreateCheckoutOutcome,
  SumUpClient,
  SumUpRefundEvent,
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
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per-request deadline. A hung SumUp call is aborted after this and rejects — the caller reads
   * that as pending/defer. Bounds the sale path and the fiscal pass loop against a SumUp outage
   * (CLAUDE.md §5: nothing external may freeze a sale). Default 20 s. */
  timeoutMs?: number;
}

/** An event as SumUp lists it: `transaction_events[]` names its kind `event_type`, `events[]`
 * names it `type`, and both carry the same numeric `id`. */
interface RawEvent {
  event_type?: string;
  type?: string;
  status?: string;
  id?: number | string;
  amount?: number;
  timestamp?: string;
}

/** SumUp's refund history of a transaction: "inspect `events` or `transaction_events` when you
 * need refund, payout, or chargeback history" (https://developer.sumup.com/api/transactions). */
function refundEventsOf(t: {
  transaction_events?: RawEvent[];
  events?: RawEvent[];
}): Pick<SumUpTransaction, "refundEvents" | "refundEvidenceInvalid"> {
  if (t.transaction_events === undefined && t.events === undefined) return {};
  const refundEvents: SumUpRefundEvent[] = [];
  let refundEvidenceInvalid = false;
  for (const events of [t.transaction_events, t.events]) {
    if (events === undefined) continue;
    if (!Array.isArray(events)) {
      refundEvidenceInvalid = true;
      continue;
    }
    for (const e of events) {
      if (e === null || typeof e !== "object") {
        refundEvidenceInvalid = true;
        continue;
      }
      const kind = e.event_type ?? e.type;
      if (typeof kind !== "string" || kind === "") {
        refundEvidenceInvalid = true;
        continue;
      }
      if (kind !== "REFUND") continue;
      if (
        (typeof e.id !== "number" && typeof e.id !== "string") ||
        String(e.id) === "" ||
        typeof e.amount !== "number" ||
        !Number.isFinite(e.amount) ||
        typeof e.timestamp !== "string" ||
        !Number.isFinite(Date.parse(e.timestamp))
      ) {
        refundEvidenceInvalid = true;
        continue;
      }
      const event = {
        id: String(e.id),
        status: e.status ?? "",
        amount: fromMajorUnits(e.amount),
        timestamp: e.timestamp,
      };
      if (
        !refundEvents.some(
          (prior) =>
            prior.id === event.id &&
            refundOutcomeOf(prior.status) === refundOutcomeOf(event.status) &&
            prior.amount === event.amount &&
            Date.parse(prior.timestamp) === Date.parse(event.timestamp),
        )
      )
        refundEvents.push(event);
    }
  }
  return { refundEvents, ...(refundEvidenceInvalid ? { refundEvidenceInvalid: true } : {}) };
}

const unpairFailed = (reason: string) =>
  new AppError("reader.unpair_failed", { providerId: SUMUP_PROVIDER }, { reason });

async function refundRefusalReason(
  response: Response,
  controller: AbortController,
): Promise<RefundRefusalReason | undefined> {
  const { signal } = controller;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    if (response.body === null) return undefined;
    reader = response.body.getReader();
    if (signal.aborted) return undefined;
    const stopped = new Promise<undefined>((resolve) => {
      abort = () => resolve(undefined);
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => controller.abort(), 2_000);
    });
    const owned = reader;
    const read = async (): Promise<RefundRefusalReason | undefined> => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let text = "";
      for (;;) {
        const chunk = await owned.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) return undefined;
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      const problem: unknown = JSON.parse(text);
      return problem !== null &&
        typeof problem === "object" &&
        !Array.isArray(problem) &&
        (problem as { detail?: unknown }).detail ===
          "Not enough available balance to perform the operation at the moment"
        ? "provider_balance_unavailable"
        : undefined;
    };
    return await Promise.race([read(), stopped]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    if (reader !== undefined) void reader.cancel().catch(() => undefined);
    else void response.body?.cancel().catch(() => undefined);
  }
}

/**
 * `SumUpClient` over SumUp's REST API (paths and shapes from SumUp's OpenAPI file —
 * docs/research/2026-09-10-sumup-solo-experiments.md, Provenance). Every request is
 * bearer-keyed. Error bodies are never included in a thrown message: they can echo request fields.
 */
export function sumupClient(opts: SumUpClientOptions): SumUpClient {
  const base = (opts.baseUrl ?? "https://api.sumup.com").replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const mc = encodeURIComponent(opts.merchantCode);
  const send = (
    method: "GET" | "POST" | "DELETE",
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<Response> =>
    doFetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      signal,
      redirect: "manual",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // The deadline must cover the BODY read, not just the headers: `res.text()` can wedge on its own
    // after the headers arrive, so the timer stays alive until the body is read (CLAUDE.md §5:
    // nothing external may freeze a sale).
    try {
      const res = await send(method, path, controller.signal, body);
      if ((res.status >= 300 && res.status < 400) || res.status >= 500) {
        res.body?.cancel().catch(() => undefined);
        throw new Error(`sumup ${method} ${path}: HTTP ${res.status}`);
      }
      const text = await res.text();
      return { status: res.status, json: text === "" ? null : (JSON.parse(text) as unknown) };
    } finally {
      clearTimeout(timer);
    }
  };
  const callForStatus = async (
    method: "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<number> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await send(method, path, controller.signal, body);
      res.body?.cancel().catch(() => undefined);
      return res.status;
    } finally {
      clearTimeout(timer);
    }
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
        ...(!p.omitAffiliate
          ? {
              affiliate: {
                app_id: WAITRON_SUMUP_AFFILIATE.appId,
                key: WAITRON_SUMUP_AFFILIATE.key,
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
      if (r.status >= 400) {
        const problem = r.json as { errors?: { type?: unknown }; type?: unknown } | null;
        const affiliateRejected =
          r.status === 400 &&
          (problem?.errors?.type === "INVALID_AFFILIATE_KEY" ||
            problem?.type === "https://developer.sumup.com/problem/invalid-affiliate-key");
        return {
          accepted: false,
          reason: problemTitle(r.json),
          ...(affiliateRejected ? { affiliateRejected: true } : {}),
        };
      }
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
        transaction_events?: RawEvent[];
        events?: RawEvent[];
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
        ...refundEventsOf(t),
      };
    },
    async refund(p: { transactionId: string; amount?: Decimal }) {
      const status = await callForStatus(
        "POST",
        `/v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds`,
        // Partial refunds use integer cents; see docs/research/2026-09-10-sumup-solo-experiments.md §10.3.
        p.amount === undefined ? {} : { amount: toMinorUnits(p.amount) },
      );
      if (status >= 200 && status < 300) return { status: "accepted" };
      if (DOCUMENTED_REFUND_REFUSALS.has(status)) return { status: "refused" };
      throw new Error(
        `sumup POST /v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds: HTTP ${status}`,
      );
    },
    async sendRefund(p: { transactionId: string; amount: Decimal }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await send(
          "POST",
          `/v1.0/merchants/${mc}/payments/${encodeURIComponent(p.transactionId)}/refunds`,
          controller.signal,
          { amount: toMinorUnits(p.amount) },
        );
        // Keep the known status if its optional explanation cannot be read.
        const reason =
          response.status === 409 ? await refundRefusalReason(response, controller) : undefined;
        if (response.status !== 409) void response.body?.cancel().catch(() => undefined);
        return { httpStatus: response.status, ...(reason === undefined ? {} : { reason }) };
      } finally {
        clearTimeout(timer);
      }
    },
    async listReaders() {
      const r = await call("GET", `/v0.1/merchants/${mc}/readers`);
      if (r.status >= 400) throw new Error(`sumup GET readers: HTTP ${r.status}`);
      return (r.json as { items: (SumUpReader & { name: string })[] }).items;
    },
    async pairReader(p: { pairingCode: string; name: string }) {
      const r = await call("POST", `/v0.1/merchants/${mc}/readers`, {
        pairing_code: p.pairingCode,
        name: p.name,
      });
      // A 4xx is a DEFINITE refusal (bad/expired/used pairing code). Throw so the route never inserts
      // a `card_readers` row with a null `provider_ref` (a NOT-NULL violation → opaque 500); the seat
      // maps this to the actionable `payment.pairing_refused`.
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
      return r.json as SumUpReader;
    },
    async readerStatus(readerId: string) {
      const r = await call(
        "GET",
        `/v0.1/merchants/${mc}/readers/${encodeURIComponent(readerId)}/status`,
      );
      if (r.status >= 400) throw new Error(`sumup GET reader status: HTTP ${r.status}`);
      const data = (
        r.json as {
          data: {
            status: string;
            connection_type?: string;
            state?: string;
            battery_level?: number | null;
            firmware_version?: string;
            last_activity?: string;
          };
        }
      ).data;
      return {
        online: data.status === "ONLINE",
        ...(data.battery_level != null
          ? { batteryPercent: Math.max(0, Math.min(100, Math.round(data.battery_level))) }
          : {}),
        ...(data.connection_type !== undefined ? { connection: data.connection_type } : {}),
        ...(data.state !== undefined ? { activity: data.state } : {}),
        ...(data.firmware_version !== undefined ? { firmwareVersion: data.firmware_version } : {}),
        ...(data.last_activity !== undefined ? { lastSeenAt: data.last_activity } : {}),
      };
    },
    async deleteReader(readerId: string): Promise<void> {
      let status: number;
      try {
        status = await callForStatus(
          "DELETE",
          `/v0.1/merchants/${mc}/readers/${encodeURIComponent(readerId)}`,
        );
      } catch {
        throw unpairFailed("unreachable");
      }
      // A retry may find the reader already removed; other refusals must not look like success.
      if ((status >= 200 && status < 300) || status === 404) return;
      throw unpairFailed(
        status === 401 || status === 403
          ? "credential_rejected"
          : status >= 500
            ? "provider_unavailable"
            : `http_${status}`,
      );
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
