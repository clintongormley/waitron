import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import type {
  SuggestionResult,
  SuggestionResults,
} from "@waitron/catalogue/src/content-suggestion-types.js";
import "@waitron/catalogue/src/errors.js";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import "./errors.js";

export type TranslationAction =
  "translation-submit" | "translation-status" | "translation-collect" | "translation-release";

export function jobFingerprint(body: string): { jobSha256: string; jobBytes: number } {
  const bytes = Buffer.from(body, "utf8");
  return { jobSha256: createHash("sha256").update(bytes).digest("hex"), jobBytes: bytes.length };
}

/** The shared vectors pin this key order. */
export function submitSignedBody(body: string): string {
  const { jobSha256, jobBytes } = jobFingerprint(body);
  return JSON.stringify({ version: 1, jobSha256, jobBytes });
}

export function translationEnvelope(
  state: Pick<SavedCloudState, "origin" | "view" | "privateKey">,
  action: TranslationAction,
  input: { operationId: string; lease: string; signedBody: string },
  now = Date.now(),
): { payload: string; signature: string } {
  const bytes = machinePayload(
    state,
    { action, operationId: input.operationId, lease: input.lease, body: input.signedBody },
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

export type CloudJobState =
  "queued" | "running" | "done" | "partly_done" | "failed" | "collected" | "expired";
export type CloudReason =
  "limit_reached" | "provider_failed" | "provider_unavailable" | "consent_required";
export interface TranslationStatus {
  jobId: string;
  state: CloudJobState;
  total: number;
  done: number;
  failed: number;
  reason?: CloudReason;
}

const JOB_STATES: readonly string[] = [
  "queued",
  "running",
  "done",
  "partly_done",
  "failed",
  "collected",
  "expired",
];
// The contract's reasons table: which reasons each finished state may carry.
const REASONS: Partial<Record<CloudJobState, readonly CloudReason[]>> = {
  partly_done: ["limit_reached", "provider_failed"],
  failed: ["provider_unavailable", "consent_required", "limit_reached"],
};
// Contract "Translate all, version 1", "Submit" and "Status, collect and release": at most
// 1,000 items, each with a ref of up to 128 characters, names in up to 20 languages and up to 10
// corrections of two texts, every text up to 500 characters. A character JSON can only send as
// `\uXXXX` costs 6 bytes: (128 + 20 × 500 + 10 × 2 × 500) × 6 = 120,768 bytes an item, plus 1 KiB
// an item for keys, language tags and punctuation, plus 1 KiB for the reply's own fields. A failed
// item costs only its ref, less than a result. Assumes Cloud writes compact JSON, as
// `JSON.stringify` does: no whitespace between tokens, and keys and language tags not escaped. The
// contract does not say so.
export const COLLECT_REPLY_BYTES = 1000 * ((128 + 20 * 500 + 10 * 2 * 500) * 6 + 1024) + 1024;
const LIMITS: Record<TranslationAction, { reply: number; ms: number }> = {
  "translation-submit": { reply: 65536, ms: 60000 },
  "translation-status": { reply: 65536, ms: 8000 },
  "translation-collect": { reply: COLLECT_REPLY_BYTES, ms: 30000 },
  "translation-release": { reply: 65536, ms: 8000 },
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}

/** The contract's refusals table, "Waitron's code" column. */
export function refusalOf(status: number, value: unknown): AppError {
  const code = object(value) && typeof value.error === "string" ? value.error : "";
  if (status === 403 && code === "translation_consent_required")
    return new AppError("content.suggestion_consent_required", {});
  if (status === 409 && code === "translation_job_running")
    return new AppError("content.suggestion_job_running", {});
  if (status === 409 && code === "translation_limit_reached" && object(value) && whole(value.fits))
    return new AppError("content.suggestion_limit_reached", { fits: value.fits });
  if (
    (status === 410 && code === "translation_expired") ||
    (status === 404 && code === "translation_job_not_found")
  )
    return new AppError("content.suggestion_expired", {});
  if (status === 400 || status === 413 || status === 415 || (status === 409 && code === "conflict"))
    return new AppError("cloud.request_invalid", {});
  return new AppError("cloud.unavailable", {});
}

async function exchange(
  state: SavedCloudState,
  action: TranslationAction,
  operationId: string,
  signedBody: string,
  extra: { body?: string },
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const lease = state.lifecycle?.lease;
  if (!state.view?.registration || state.lifecycle?.revoked || !lease)
    throw new AppError("cloud.not_configured", {});
  if (signedBody.length > 4096) throw new AppError("cloud.request_invalid", {});
  const limits = LIMITS[action];
  try {
    const envelope = translationEnvelope(state, action, {
      operationId,
      lease: JSON.stringify(lease),
      signedBody,
    });
    const response = await fetch(`${state.origin}/api/installations/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...envelope, ...extra }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(limits.ms)])
        : AbortSignal.timeout(limits.ms),
    });
    if (!response.body) unavailable();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limits.reply) unavailable();
      chunks.push(chunk);
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      if (response.ok) unavailable();
    }
    if (!response.ok) throw refusalOf(response.status, value);
    if (!object(value) || value.version !== 1) unavailable();
    return value;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return unavailable();
  }
}

const jobBody = (jobId: string) => JSON.stringify({ version: 1, jobId });

export async function submitTranslation(
  state: SavedCloudState,
  operationId: string,
  body: string,
  signal?: AbortSignal,
): Promise<{ jobId: string; state: CloudJobState; total: number }> {
  const v = await exchange(
    state,
    "translation-submit",
    operationId,
    submitSignedBody(body),
    { body },
    signal,
  );
  if (!uuid(v.jobId) || !JOB_STATES.includes(String(v.state)) || !whole(v.total)) unavailable();
  return { jobId: v.jobId, state: v.state as CloudJobState, total: v.total };
}

export async function translationStatus(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<TranslationStatus> {
  const v = await exchange(state, "translation-status", randomUUID(), jobBody(jobId), {}, signal);
  if (
    v.jobId !== jobId ||
    !JOB_STATES.includes(String(v.state)) ||
    !whole(v.total) ||
    !whole(v.done) ||
    !whole(v.failed)
  )
    unavailable();
  const jobState = v.state as CloudJobState;
  const allowed = REASONS[jobState];
  if (allowed ? !allowed.includes(v.reason as CloudReason) : Object.hasOwn(v, "reason"))
    unavailable();
  return {
    jobId,
    state: jobState,
    total: v.total,
    done: v.done,
    failed: v.failed,
    ...(allowed ? { reason: v.reason as CloudReason } : {}),
  };
}

function readResult(value: unknown): SuggestionResult {
  if (
    !object(value) ||
    typeof value.ref !== "string" ||
    !object(value.names) ||
    typeof value.placeholder !== "boolean" ||
    !Array.isArray(value.corrections)
  )
    unavailable();
  const names: Record<string, string> = {};
  for (const [language, text] of Object.entries(value.names)) {
    if (typeof text !== "string") unavailable();
    names[language] = text;
  }
  const corrections = value.corrections.map((c: unknown) => {
    if (
      !object(c) ||
      typeof c.field !== "string" ||
      typeof c.wrong !== "string" ||
      typeof c.right !== "string"
    )
      unavailable();
    return { field: c.field, wrong: c.wrong, right: c.right };
  });
  return { ref: value.ref, names, placeholder: value.placeholder, corrections };
}

export async function collectTranslation(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<SuggestionResults> {
  const v = await exchange(state, "translation-collect", randomUUID(), jobBody(jobId), {}, signal);
  if (
    v.jobId !== jobId ||
    (v.state !== "done" && v.state !== "partly_done") ||
    !Array.isArray(v.results) ||
    !Array.isArray(v.failed) ||
    !v.failed.every((ref: unknown) => typeof ref === "string")
  )
    unavailable();
  return { state: v.state, results: v.results.map(readResult), failed: v.failed as string[] };
}

export async function releaseTranslation(
  state: SavedCloudState,
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  const v = await exchange(state, "translation-release", randomUUID(), jobBody(jobId), {}, signal);
  if (v.jobId !== jobId || v.state !== "collected") unavailable();
}
