import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";
import { encodeMachine } from "@waitron/contract";
import { AppError } from "@waitron/shared";
import type { SavedCloudState } from "./cloud-client.js";
import "./errors.js";
export interface CloudCaptureMetadata {
  digest: string;
  size: number;
  capturedAt: string;
  retention: "daily" | "monthly";
  sourceNodeId: string;
  modules: Record<string, number>;
}
type CaptureCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken: string };
type CloudCaptureGrantDetails = {
  id: string;
  installationId: string;
  venueId: string;
  keyVersion: number;
  location: { endpoint: string; bucket: string; region: string };
  incomingKey: string;
  recoveryKey: string;
  expiresAt: string;
};
export type CloudCaptureGrant = CloudCaptureGrantDetails &
  (
    | { uploadUrl: string; credentials?: never }
    | { credentials: CaptureCredentials; uploadUrl?: never }
  );
export interface CloudCapturePoint extends CloudCaptureMetadata {
  id: string;
  installationId: string;
  venueId: string;
  keyVersion: number;
  verification: "pending" | "verified" | "failed";
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}
export function signedUploadAddress(
  address: unknown,
  endpoint: URL,
  bucket: string,
  incomingKey: string,
): URL {
  if (!text(address, 16 * 1024)) unavailable();
  const url = URL.parse(address);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.origin !== endpoint.origin ||
    url.pathname !== `/${bucket}/${incomingKey}` ||
    !url.search ||
    url.username ||
    url.password ||
    address.includes("#")
  )
    unavailable();
  return url;
}
async function readReply(response: Response): Promise<unknown> {
  const bytes = await readCloudResponseBytes(response, 65536);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function exchange(
  state: SavedCloudState,
  action: "backup-reserve" | "backup-publish",
  id: string,
  body: object,
  signal?: AbortSignal,
) {
  try {
    const registration = state.view?.registration;
    if (
      !registration ||
      state.environment !== "test" ||
      state.lifecycle?.revoked ||
      !state.lifecycle?.lease
    )
      throw new AppError("cloud.binding_conflict", {});
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) unavailable();
    const { installationId } = registration;
    const lease = JSON.stringify(state.lifecycle.lease);
    // Reserve shares its deadline across both requests, including the older Cloud's credential grant.
    const timeout = AbortSignal.timeout(action === "backup-publish" ? 50_000 : 15_000);
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const send = (body: object) => {
      const encoded = JSON.stringify(body);
      if (encoded.length > 4096) unavailable();
      const payload = encodeMachine({
        origin: state.origin,
        action,
        installationId,
        operationId: id,
        issuedAt: Date.now(),
        lease,
        body: encoded,
      });
      return fetch(state.origin + "/api/installations/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: payload.toString("base64url"),
          signature: signCloudPayload(payload, state.privateKey),
        }),
        redirect: "error",
        signal: deadline,
      });
    };
    let response = await send(body);
    let legacy = false;
    if (action === "backup-reserve" && response.status === 400) {
      const refusal = await readReply(response);
      if (!record(refusal) || refusal.error !== "invalid_metadata") unavailable();
      legacy = true;
      response = await send({});
    }
    if (!response.ok) {
      await response.body?.cancel();
      unavailable();
    }
    const value = await readReply(response);
    if (
      !record(value) ||
      value.id !== id ||
      value.installationId !== registration.installationId ||
      value.venueId !== registration.venueId ||
      !Number.isSafeInteger(value.keyVersion) ||
      Number(value.keyVersion) < 1
    )
      unavailable();
    return { value, legacy };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return unavailable();
  }
}
export async function reserveCloudCapture(
  state: SavedCloudState,
  id: string,
  signal?: AbortSignal,
): Promise<CloudCaptureGrant> {
  const { value: v, legacy } = await exchange(
    state,
    "backup-reserve",
    id,
    { upload: "presigned-put-v1" },
    signal,
  );
  const l = v.location;
  if (
    !record(l) ||
    !text(l.endpoint, 2048) ||
    !text(l.bucket, 63) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(l.bucket) ||
    !text(l.region, 128) ||
    v.incomingKey !== "incoming/" + id ||
    !text(v.recoveryKey, 43) ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.recoveryKey) ||
    !text(v.expiresAt, 40) ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 901000
  )
    unavailable();
  const endpoint = URL.parse(l.endpoint);
  if (
    !endpoint ||
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    unavailable();
  const common: CloudCaptureGrantDetails = {
    id,
    installationId: v.installationId as string,
    venueId: v.venueId as string,
    keyVersion: v.keyVersion as number,
    location: { endpoint: l.endpoint, bucket: l.bucket, region: l.region },
    incomingKey: v.incomingKey,
    recoveryKey: v.recoveryKey,
    expiresAt: v.expiresAt,
  };
  if (legacy) {
    const c = v.credentials;
    if (
      "uploadUrl" in v ||
      !record(c) ||
      !text(c.accessKeyId) ||
      !text(c.secretAccessKey) ||
      !text(c.sessionToken)
    )
      unavailable();
    const { accessKeyId, secretAccessKey, sessionToken } = c;
    return { ...common, credentials: { accessKeyId, secretAccessKey, sessionToken } };
  }
  if ("credentials" in v || typeof v.uploadUrl !== "string") unavailable();
  signedUploadAddress(v.uploadUrl, endpoint, l.bucket, v.incomingKey);
  return { ...common, uploadUrl: v.uploadUrl };
}
export async function publishCloudCapture(
  state: SavedCloudState,
  id: string,
  metadata: CloudCaptureMetadata,
  signal?: AbortSignal,
): Promise<CloudCapturePoint> {
  const { value: v } = await exchange(state, "backup-publish", id, metadata, signal);
  for (const k of ["digest", "size", "capturedAt", "retention", "sourceNodeId"] as const)
    if (v[k] !== metadata[k]) unavailable();
  if (
    !record(v.modules) ||
    JSON.stringify(Object.entries(v.modules).sort()) !==
      JSON.stringify(Object.entries(metadata.modules).sort()) ||
    !["pending", "verified", "failed"].includes(v.verification as string)
  )
    unavailable();
  return {
    ...metadata,
    id,
    installationId: v.installationId as string,
    venueId: v.venueId as string,
    keyVersion: v.keyVersion as number,
    verification: v.verification as CloudCapturePoint["verification"],
  };
}
