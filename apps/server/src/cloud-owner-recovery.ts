import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import { serviceExchange, type OnRefusal } from "./cloud-translation.js";
import "./errors.js";

const KEYS = [
  "requestId",
  "accountId",
  "email",
  "organisationId",
  "legalBusinessId",
  "venueId",
  "installationId",
  "publicKey",
  "environment",
  "countryCode",
  "expiresAt",
] as const;
export type OwnerRecoveryRequest = Record<(typeof KEYS)[number], string>;
const uuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

export function readOwnerRecoveryRequest(value: unknown): OwnerRecoveryRequest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== KEYS.length
  )
    throw new AppError("cloud.request_invalid", {});
  const data = value as Record<string, unknown>;
  if (
    KEYS.some((k) => typeof data[k] !== "string" || !data[k]) ||
    [
      "requestId",
      "accountId",
      "organisationId",
      "legalBusinessId",
      "venueId",
      "installationId",
    ].some((k) => !uuid(String(data[k]))) ||
    !["test", "production"].includes(String(data.environment)) ||
    data.countryCode !== "ES" ||
    !Number.isFinite(Date.parse(String(data.expiresAt)))
  )
    throw new AppError("cloud.request_invalid", {});
  return Object.fromEntries(KEYS.map((k) => [k, data[k]])) as OwnerRecoveryRequest;
}

export function ownerRecoveryBinding(state: SavedCloudState | undefined): string {
  const registration = state?.view?.registration;
  if (
    !registration ||
    state.view?.state !== "complete" ||
    state.lifecycle?.revoked ||
    state.lifecycle?.pending?.action === "revoke"
  )
    throw new AppError("cloud.not_configured", {});
  return JSON.stringify([
    state.origin,
    state.publicKey,
    state.environment,
    registration.organisationId,
    registration.legalBusinessId,
    registration.venueId,
    registration.installationId,
  ]);
}
function bind(request: OwnerRecoveryRequest, state: SavedCloudState) {
  if (
    Object.entries(state.view!.registration!).some(
      ([k, v]) => request[k as keyof OwnerRecoveryRequest] !== v,
    ) ||
    request.publicKey !== state.publicKey ||
    request.environment !== state.environment
  )
    throw new AppError("cloud.binding_conflict", {});
}
function refusal(status: number, value: unknown): AppError {
  const error = value && typeof value === "object" && "error" in value ? value.error : undefined;
  return new AppError(
    status === 400 || status === 413 || status === 415
      ? "cloud.request_invalid"
      : status === 409 && error === "conflict"
        ? "cloud.request_unavailable"
        : status === 404 && error === "not_found"
          ? "cloud.owner_recovery_not_available"
          : "cloud.unavailable",
    {},
  );
}
export async function fetchOwnerRecovery(
  state: SavedCloudState,
  authorizeBy: string,
  decision: { action: "approve" | "refuse"; request: unknown } | undefined,
  signal?: AbortSignal,
  onRefusal?: OnRefusal,
) {
  ownerRecoveryBinding(state);
  const request = decision ? readOwnerRecoveryRequest(decision.request) : undefined;
  if (request) bind(request, state);
  const action = decision ? (`owner-recovery-${decision.action}` as const) : "owner-recovery-read";
  const body = decision
    ? JSON.stringify({
        request,
        [decision.action === "approve" ? "approvedBy" : "refusedBy"]: authorizeBy,
      })
    : "{}";
  const value = await serviceExchange(
    state,
    action,
    request?.requestId ?? randomUUID(),
    body,
    {},
    signal,
    onRefusal,
    { requireVersion: false, refusal },
  );
  if (decision) {
    const expected = decision.action === "approve" ? "approved" : "refused";
    if (value.requestId !== request!.requestId || value.state !== expected)
      throw new AppError("cloud.unavailable", {});
    return { requestId: request!.requestId, state: expected };
  }
  if (!Array.isArray(value.requests)) throw new AppError("cloud.unavailable", {});
  const requests = value.requests.map((v) => {
    let r: OwnerRecoveryRequest;
    try {
      r = readOwnerRecoveryRequest(v);
    } catch {
      throw new AppError("cloud.unavailable", {});
    }
    bind(r, state);
    return r;
  });
  return { requests };
}
