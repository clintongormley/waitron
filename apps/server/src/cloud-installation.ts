import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { CloudRegistration, SavedCloudState } from "./cloud-client.js";
import "./errors.js";
type Action = "renew" | "configuration" | "report" | "revoke";
interface Envelope {
  payload: string;
  signature: string;
}
interface Pending {
  action: Action;
  operationId: string;
  lease: string;
  body: string;
}
type Service = "continuous_backup" | "remote_access" | "retained_snapshots";
export interface CloudObservation {
  service: Service;
  health: "unknown" | "healthy" | "degraded" | "failed";
  failure: "unavailable" | "authentication" | "configuration" | "storage" | "capacity" | null;
}
interface ServiceView extends CloudObservation {
  state: "unconfigured" | "provisioning" | "ready" | "failed";
  configuration: Record<string, unknown>;
  observedAt: string | null;
}
interface View extends CloudRegistration {
  environment: "test" | "production";
  revision: number;
  revokedAt: string | null;
  lastContactAt: string | null;
  leaseExpiresAt: string | null;
  services: ServiceView[];
}
export interface CloudInstallationState {
  view?: View;
  lease?: Envelope;
  pending?: Pending;
  unavailable: boolean;
  revoked: boolean;
}
export interface CloudInstallationStatus {
  state: "pending" | "active" | "unavailable" | "revoked";
  revision: number;
  lastContactAt: string | null;
  leaseExpiresAt: string | null;
  services: Omit<ServiceView, "configuration">[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const date = (v: unknown) =>
  v === null || (typeof v === "string" && Number.isFinite(Date.parse(v)));
function unavailable(): never {
  throw new AppError("cloud.unavailable", {});
}
function readView(value: unknown, state: SavedCloudState): View {
  const r = state.view?.registration;
  if (
    !r ||
    !object(value) ||
    Object.entries(r).some(([key, v]) => value[key] !== v) ||
    value.environment !== state.environment ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    Number(value.revision) < (state.lifecycle?.view?.revision ?? 0) ||
    !date(value.revokedAt) ||
    !date(value.lastContactAt) ||
    !date(value.leaseExpiresAt) ||
    !Array.isArray(value.services) ||
    value.services.length !== 3
  )
    unavailable();
  const services: ServiceView[] = [];
  for (const s of value.services) {
    if (
      !object(s) ||
      !["continuous_backup", "remote_access", "retained_snapshots"].includes(String(s.service)) ||
      services.some((v) => v.service === s.service) ||
      !["unconfigured", "provisioning", "ready", "failed"].includes(String(s.state)) ||
      !["unknown", "healthy", "degraded", "failed"].includes(String(s.health)) ||
      (s.failure !== null &&
        !["unavailable", "authentication", "configuration", "storage", "capacity"].includes(
          String(s.failure),
        )) ||
      !date(s.observedAt) ||
      !object(s.configuration) ||
      JSON.stringify(s.configuration).length > 4096
    )
      unavailable();
    services.push({
      service: s.service as Service,
      state: s.state as ServiceView["state"],
      health: s.health as CloudObservation["health"],
      failure: s.failure as CloudObservation["failure"],
      configuration: s.configuration,
      observedAt: s.observedAt as string | null,
    });
  }
  return {
    ...r,
    environment: state.environment,
    revision: value.revision as number,
    revokedAt: value.revokedAt as string | null,
    lastContactAt: value.lastContactAt as string | null,
    leaseExpiresAt: value.leaseExpiresAt as string | null,
    services,
  };
}
/** The pinned HTTPS origin authenticates this control response. It is not a gateway signature verifier. */
function readLease(value: unknown, state: SavedCloudState): Envelope {
  if (
    !object(value) ||
    Object.keys(value).sort().join(",") !== "payload,signature" ||
    typeof value.payload !== "string" ||
    value.payload.length > 4096 ||
    typeof value.signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/.test(value.signature)
  )
    unavailable();
  const bytes = Buffer.from(value.payload, "base64url");
  if (bytes.toString("base64url") !== value.payload) unavailable();
  const v: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    r = state.view?.registration;
  if (
    !Array.isArray(v) ||
    v.length !== 11 ||
    v[0] !== "waitron-cloud-access-v1" ||
    v[1] !== state.origin ||
    typeof v[2] !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(v[2]) ||
    !uuid(v[3]) ||
    v[4] !== r?.installationId ||
    v[5] !== r?.venueId ||
    v[6] !== state.environment ||
    v[7] !== state.publicKey ||
    !Number.isSafeInteger(v[8]) ||
    v[8] < 0 ||
    !Number.isSafeInteger(v[9]) ||
    v[9] <= v[8] ||
    v[9] - v[8] > 3600000 ||
    v[10] !== "control" ||
    !Buffer.from(JSON.stringify(v)).equals(bytes)
  )
    unavailable();
  return { payload: value.payload, signature: value.signature };
}
function leaseExpiry(lease?: Envelope): number {
  return lease
    ? (JSON.parse(Buffer.from(lease.payload, "base64url").toString()) as number[])[9]!
    : 0;
}
export function readCloudInstallation(
  value: unknown,
  state: SavedCloudState,
): CloudInstallationState {
  if (
    !object(value) ||
    typeof value.unavailable !== "boolean" ||
    typeof value.revoked !== "boolean" ||
    !state.view?.registration
  )
    unavailable();
  const result: CloudInstallationState = { unavailable: value.unavailable, revoked: value.revoked };
  if (value.view !== undefined) result.view = readView(value.view, state);
  if (value.lease !== undefined) result.lease = readLease(value.lease, state);
  if (value.pending !== undefined) {
    const p = value.pending;
    if (
      !object(p) ||
      !["renew", "configuration", "report", "revoke"].includes(String(p.action)) ||
      !uuid(p.operationId) ||
      typeof p.lease !== "string" ||
      p.lease.length > 4096 ||
      typeof p.body !== "string" ||
      p.body.length > 4096
    )
      unavailable();
    result.pending = {
      action: p.action as Action,
      operationId: p.operationId as string,
      lease: p.lease,
      body: p.body,
    };
  }
  return result;
}
export function projectCloudInstallation(
  state: SavedCloudState,
): CloudInstallationStatus | undefined {
  if (!state.view?.registration) return;
  const c = state.lifecycle,
    v = c?.view;
  return {
    state: c?.revoked
      ? "revoked"
      : c?.unavailable
        ? "unavailable"
        : !v
          ? "pending"
          : leaseExpiry(c?.lease) <= Date.now()
            ? "unavailable"
            : "active",
    revision: v?.revision ?? 0,
    lastContactAt: v?.lastContactAt ?? null,
    leaseExpiresAt: v?.leaseExpiresAt ?? null,
    services: (v?.services ?? []).map((s) => ({
      service: s.service,
      state: s.state,
      health: s.observedAt && Date.parse(s.observedAt) > Date.now() - 300000 ? s.health : "unknown",
      failure: s.observedAt && Date.parse(s.observedAt) > Date.now() - 300000 ? s.failure : null,
      observedAt: s.observedAt,
    })),
  };
}
export function machinePayload(
  state: Pick<SavedCloudState, "origin" | "view">,
  pending: Pending,
  now = Date.now(),
): Buffer {
  return Buffer.from(
    JSON.stringify([
      "waitron-cloud-machine-v1",
      state.origin,
      pending.action,
      state.view?.registration?.installationId,
      pending.operationId,
      now,
      pending.lease,
      pending.body,
    ]),
  );
}
export function installationClient(
  state: SavedCloudState,
  save: (state: SavedCloudState) => Promise<void>,
) {
  const c = (state.lifecycle ??= { unavailable: false, revoked: false });
  async function exchange(signal?: AbortSignal): Promise<void> {
    const p = c.pending;
    if (!p) return;
    try {
      const bytes = machinePayload(state, p),
        signature = sign(
          null,
          bytes,
          createPrivateKey({
            key: Buffer.from(state.privateKey, "base64url"),
            format: "der",
            type: "pkcs8",
          }),
        ).toString("base64url");
      const response = await fetch(`${state.origin}/api/installations/${p.action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: bytes.toString("base64url"), signature }),
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
      });
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) unavailable();
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 65536) unavailable();
        chunks.push(chunk);
      }
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (!response.ok) {
        if (response.status === 403 && object(value) && value.error === "revoked") {
          c.revoked = true;
          c.unavailable = false;
          delete c.pending;
          delete c.lease;
          await save(state);
          return;
        }
        if (
          (p.action === "configuration" || p.action === "report") &&
          object(value) &&
          ((response.status === 401 && value.error === "invalid_proof") ||
            (response.status === 400 && value.error === "conflict"))
        ) {
          delete c.pending;
          delete c.lease;
        }
        unavailable();
      }
      const view = readView(value, state),
        lease =
          p.action === "renew"
            ? readLease((value as Record<string, unknown>).lease, state)
            : undefined;
      if (lease && leaseExpiry(lease) !== Date.parse(view.leaseExpiresAt ?? "")) unavailable();
      c.view = view;
      if (lease) c.lease = lease;
      c.revoked = view.revokedAt !== null;
      c.unavailable = false;
      delete c.pending;
      if (c.revoked) delete c.lease;
      await save(state);
    } catch (error) {
      c.unavailable = true;
      await save(state);
      if (error instanceof AppError) throw error;
      throw new AppError("cloud.unavailable", {});
    }
  }
  async function prepare(action: Action, body = "{}") {
    c.pending = {
      action,
      operationId: randomUUID(),
      lease: action === "renew" || action === "revoke" ? "" : JSON.stringify(c.lease),
      body,
    };
    await save(state);
  }
  return {
    async refresh(signal?: AbortSignal) {
      if (c.revoked) return;
      if (c.pending) await exchange(signal);
      if (c.revoked) return;
      const needsRenew = leaseExpiry(c.lease) <= Date.now() + 600000;
      await prepare(needsRenew ? "renew" : "configuration");
      await exchange(signal);
    },
    async revoke(authorize: () => Promise<void>, signal?: AbortSignal) {
      if (c.revoked) return;
      await authorize();
      // Stopping access supersedes earlier work; persist that intent even while Cloud is offline.
      if (c.pending?.action !== "revoke") await prepare("revoke");
      await exchange(signal);
    },
    async report(services: CloudObservation[], observedAt = Date.now(), signal?: AbortSignal) {
      if (c.revoked) return;
      if (c.pending) await exchange(signal);
      if (c.revoked) return;
      if (!c.lease || leaseExpiry(c.lease) <= Date.now() + 600000) {
        await prepare("renew");
        await exchange(signal);
      }
      if (c.revoked) return;
      await prepare(
        "report",
        JSON.stringify({
          revision: c.view?.revision ?? 0,
          observedAt,
          services: services.map((s) => ({
            service: s.service,
            health: s.health,
            failure: s.failure,
          })),
        }),
      );
      await exchange(signal);
    },
  };
}
