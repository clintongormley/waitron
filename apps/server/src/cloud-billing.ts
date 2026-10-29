import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import type { OnRefusal } from "./cloud-translation.js";
import "./errors.js";

// Cloud's contract, "Venue billing display, version 1" (docs/waitron-integration-contract.md in
// waitron-cloud). Version 1 is closed: any key or combination it does not list refuses the reply.
type Level = "registered" | "connected" | "hosted";
type PaidLevel = "connected" | "hosted";
export interface BillingPeriod {
  kind: "trial" | "paid";
  level: PaidLevel;
  from: string;
  until: string;
  coversAsOf: boolean;
}
export type BillingFacts =
  | {
      status: "ready";
      level: Level;
      state: "trial" | "active" | "payment_failing" | "lapsed";
      period: BillingPeriod | null;
    }
  | { status: "unavailable"; reason: "state_not_ready" };
export type BillingPrices =
  | {
      status: "published";
      revision: number;
      effectiveFrom: string;
      currency: "EUR";
      taxExclusive: true;
      vatRateBasisPoints: number;
      registeredMonthlyCents: 0;
      connectedMonthlyCents: number;
      hostedMonthlyCents: number;
      hostedDayDivisor: 30;
    }
  | { status: "unavailable"; reason: "not_published" };
export interface BillingDisplay {
  version: 1;
  installationId: string;
  venueId: string;
  countryCode: "ES";
  calendarTimeZone: string;
  asOf: string;
  billing: BillingFacts;
  prices: BillingPrices;
  accountUrl: string;
}
/** A refusal that carries Cloud's `Retry-After` hint, so the caller can wait that long. */
export type BillingRefusal = AppError & { retryAfterMs?: number };

const SIGNED_BODY = JSON.stringify({ version: 1 });
const REPLY_BYTES = 16_384;

function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function exactKeys(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).sort().join() !== [...keys].sort().join()) unavailable();
}
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function civilDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function zoneName(v: unknown): v is string {
  if (typeof v !== "string" || /[+-]\d/.test(v)) return false;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: v }).resolvedOptions().timeZone === v;
  } catch {
    return false;
  }
}
function dayIn(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function readPeriod(v: unknown, today: string): BillingPeriod | null {
  if (v === null) return null;
  exactKeys(v, ["kind", "level", "from", "until", "coversAsOf"]);
  if (
    (v.kind !== "trial" && v.kind !== "paid") ||
    (v.level !== "connected" && v.level !== "hosted") ||
    !civilDate(v.from) ||
    !civilDate(v.until) ||
    v.from >= v.until ||
    // No rule ever selects an interval that starts after today.
    v.from > today ||
    v.coversAsOf !== today < v.until
  )
    unavailable();
  return v as unknown as BillingPeriod;
}

function readBilling(v: unknown, today: string): BillingFacts {
  if (object(v) && v.status === "unavailable") {
    exactKeys(v, ["status", "reason"]);
    if (v.reason !== "state_not_ready") unavailable();
    return { status: "unavailable", reason: "state_not_ready" };
  }
  exactKeys(v, ["status", "level", "state", "period"]);
  const { level, state } = v;
  if (
    v.status !== "ready" ||
    (level !== "registered" && level !== "connected" && level !== "hosted") ||
    (state !== "trial" && state !== "active" && state !== "payment_failing" && state !== "lapsed")
  )
    unavailable();
  const p = readPeriod(v.period, today);
  // The contract's table of allowed level, state and period combinations.
  const sameLevel = !!p && (level === "registered" || p.level === level);
  const allowed =
    state === "trial"
      ? level !== "registered" && p?.kind === "trial" && p.level === level && p.coversAsOf
      : level === "registered" && state !== "lapsed"
        ? p === null
        : state !== "lapsed"
          ? p === null || (p.kind === "paid" && sameLevel)
          : p === null ||
            (p.kind === "paid" && sameLevel) ||
            (p.kind === "trial" && sameLevel && !p.coversAsOf);
  if (!allowed) unavailable();
  return { status: "ready", level, state, period: p };
}

function readPrices(v: unknown): BillingPrices {
  if (object(v) && v.status === "unavailable") {
    exactKeys(v, ["status", "reason"]);
    if (v.reason !== "not_published") unavailable();
    return { status: "unavailable", reason: "not_published" };
  }
  exactKeys(v, [
    "status",
    "revision",
    "effectiveFrom",
    "currency",
    "taxExclusive",
    "vatRateBasisPoints",
    "registeredMonthlyCents",
    "connectedMonthlyCents",
    "hostedMonthlyCents",
    "hostedDayDivisor",
  ]);
  if (
    v.status !== "published" ||
    !whole(v.revision) ||
    !civilDate(v.effectiveFrom) ||
    v.currency !== "EUR" ||
    v.taxExclusive !== true ||
    !whole(v.vatRateBasisPoints) ||
    v.registeredMonthlyCents !== 0 ||
    !whole(v.connectedMonthlyCents) ||
    !whole(v.hostedMonthlyCents) ||
    v.hostedDayDivisor !== 30
  )
    unavailable();
  return v as unknown as BillingPrices;
}

/** Checks a reply against the closed version-1 shape and the saved registration it must name. */
export function readBillingDisplay(
  value: unknown,
  expected: { installationId: string; venueId: string; accountUrl: string },
): BillingDisplay {
  exactKeys(value, [
    "version",
    "installationId",
    "venueId",
    "countryCode",
    "calendarTimeZone",
    "asOf",
    "billing",
    "prices",
    "accountUrl",
  ]);
  const { asOf, calendarTimeZone } = value;
  if (
    value.version !== 1 ||
    value.installationId !== expected.installationId ||
    value.venueId !== expected.venueId ||
    value.countryCode !== "ES" ||
    !zoneName(calendarTimeZone) ||
    typeof asOf !== "string" ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString() !== asOf ||
    value.accountUrl !== expected.accountUrl
  )
    unavailable();
  const today = dayIn(asOf, calendarTimeZone);
  return {
    version: 1,
    installationId: expected.installationId,
    venueId: expected.venueId,
    countryCode: "ES",
    calendarTimeZone,
    asOf,
    billing: readBilling(value.billing, today),
    prices: readPrices(value.prices),
    accountUrl: expected.accountUrl,
  };
}

export function billingEnvelope(
  state: Pick<SavedCloudState, "origin" | "view" | "privateKey">,
  operationId: string,
  lease: string,
  now = Date.now(),
): { payload: string; signature: string } {
  const bytes = machinePayload(
    state,
    { action: "billing-display", operationId, lease, body: SIGNED_BODY },
    now,
  );
  const key = createPrivateKey({
    key: Buffer.from(state.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return {
    payload: bytes.toString("base64url"),
    signature: sign(null, bytes, key).toString("base64url"),
  };
}

function refusal(status: number, value: unknown, retryAfter: string | null): BillingRefusal {
  if (status === 400 || status === 405 || status === 413 || status === 415)
    return new AppError("cloud.request_invalid", {});
  const error: BillingRefusal = new AppError("cloud.unavailable", {});
  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
  if (status === 429 && object(value) && Number.isSafeInteger(seconds))
    error.retryAfterMs = seconds * 1000;
  return error;
}

/** One signed read. It saves nothing: the caller decides what a refusal means for the connection. */
export async function fetchBillingDisplay(
  state: SavedCloudState,
  options: { signal?: AbortSignal; onRefusal?: OnRefusal; timeoutMs?: number } = {},
): Promise<BillingDisplay> {
  const registration = state.view?.registration;
  const lease = state.lifecycle?.lease;
  if (!registration || state.lifecycle?.revoked || !lease)
    throw new AppError("cloud.not_configured", {});
  const used = JSON.stringify(lease);
  const bound = AbortSignal.timeout(options.timeoutMs ?? 8000);
  try {
    const response = await fetch(`${state.origin}/api/installations/billing-display`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(billingEnvelope(state, randomUUID(), used)),
      redirect: "error",
      signal: options.signal ? AbortSignal.any([options.signal, bound]) : bound,
    });
    if (!response.body) unavailable();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > REPLY_BYTES) unavailable();
      chunks.push(chunk);
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)),
      );
    } catch {
      unavailable();
    }
    if (!response.ok) {
      const code = object(value) ? value.error : undefined;
      if (response.status === 403 && code === "revoked")
        await options.onRefusal?.("revoked", used, state.publicKey);
      if (response.status === 401 && code === "invalid_proof")
        await options.onRefusal?.("invalid_proof", used, state.publicKey);
      throw refusal(response.status, value, response.headers.get("retry-after"));
    }
    return readBillingDisplay(value, {
      installationId: registration.installationId,
      venueId: registration.venueId,
      accountUrl: `${state.origin}/account`,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    return unavailable();
  }
}
