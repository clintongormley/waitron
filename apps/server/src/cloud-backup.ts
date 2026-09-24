import { createPrivateKey, sign } from "node:crypto";
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
export interface CloudCaptureGrant {
  id: string;
  installationId: string;
  venueId: string;
  keyVersion: number;
  location: { endpoint: string; bucket: string; region: string };
  incomingKey: string;
  recoveryKey: string;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
  expiresAt: string;
}
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
    const encoded = JSON.stringify(body);
    if (encoded.length > 4096) unavailable();
    const payload = Buffer.from(
      JSON.stringify([
        "waitron-cloud-machine-v1",
        state.origin,
        action,
        registration.installationId,
        id,
        Date.now(),
        JSON.stringify(state.lifecycle.lease),
        encoded,
      ]),
    );
    const key = createPrivateKey({
      key: Buffer.from(state.privateKey, "base64url"),
      type: "pkcs8",
      format: "der",
    });
    const response = await fetch(state.origin + "/api/installations/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: payload.toString("base64url"),
        signature: sign(null, payload, key).toString("base64url"),
      }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      unavailable();
    }
    if (!response.body) unavailable();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) unavailable();
      chunks.push(chunk);
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (
      !record(value) ||
      value.id !== id ||
      value.installationId !== registration.installationId ||
      value.venueId !== registration.venueId ||
      !Number.isSafeInteger(value.keyVersion) ||
      Number(value.keyVersion) < 1
    )
      unavailable();
    return value;
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
  const v = await exchange(state, "backup-reserve", id, {}, signal),
    l = v.location,
    c = v.credentials;
  if (
    !record(l) ||
    !text(l.endpoint, 2048) ||
    !text(l.bucket, 63) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(l.bucket) ||
    !text(l.region, 128) ||
    !record(c) ||
    ![c.accessKeyId, c.secretAccessKey, c.sessionToken].every((x) => text(x)) ||
    v.incomingKey !== "incoming/" + id ||
    !text(v.recoveryKey, 43) ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.recoveryKey) ||
    !text(v.expiresAt, 40) ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 901000
  )
    unavailable();
  try {
    const u = new URL(l.endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash
    )
      unavailable();
  } catch {
    return unavailable();
  }
  return {
    id,
    installationId: v.installationId as string,
    venueId: v.venueId as string,
    keyVersion: v.keyVersion as number,
    location: { endpoint: l.endpoint, bucket: l.bucket, region: l.region },
    incomingKey: v.incomingKey,
    recoveryKey: v.recoveryKey,
    credentials: {
      accessKeyId: c.accessKeyId as string,
      secretAccessKey: c.secretAccessKey as string,
      sessionToken: c.sessionToken as string,
    },
    expiresAt: v.expiresAt,
  };
}
export async function publishCloudCapture(
  state: SavedCloudState,
  id: string,
  metadata: CloudCaptureMetadata,
  signal?: AbortSignal,
): Promise<CloudCapturePoint> {
  const v = await exchange(state, "backup-publish", id, metadata, signal);
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
