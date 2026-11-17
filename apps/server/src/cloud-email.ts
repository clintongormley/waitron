import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { SavedCloudState } from "./cloud-client.js";
import { machinePayload } from "./cloud-installation.js";
import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";

import { AppError } from "@waitron/shared";
import "./errors.js";

export interface CloudEmailGrant {
  id: string;
  revision: number;
  expiresAt: string;
  enabled: boolean;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function readCloudEmailGrant(value: unknown): CloudEmailGrant | null {
  const g = record(value) ? value.grant : undefined;
  if (
    !record(value) ||
    value.version !== 1 ||
    !record(g) ||
    typeof g.id !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(g.id) ||
    !Number.isSafeInteger(g.revision) ||
    Number(g.revision) < 1 ||
    typeof g.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(g.expiresAt)) ||
    Date.parse(g.expiresAt) <= Date.now() ||
    typeof g.enabled !== "boolean"
  )
    throw new AppError("cloud.unavailable", {});
  return g.enabled ? (g as unknown as CloudEmailGrant) : null;
}

async function emailExchange(
  state: SavedCloudState,
  action: "configuration" | "email-submit" | "email-status",
  operationId: string,
  body: string,
  signal?: AbortSignal,
) {
  const bytes = machinePayload(state, {
    action,
    operationId,
    lease: JSON.stringify(state.lifecycle!.lease),
    body,
  });
  const response = await fetch(
    state.origin +
      (action === "configuration"
        ? "/api/installations/configuration"
        : "/v1/installations/email/" + action.slice(6)),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: bytes.toString("base64url"),
        signature: signCloudPayload(bytes, state.privateKey),
      }),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    },
  );
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await readCloudResponseBytes(response, action === "configuration" ? 65536 : 4096),
    ),
  );
  return { response, value };
}
export async function fetchCloudEmailGrant(
  state: SavedCloudState,
  signal?: AbortSignal,
  managementOrigin?: string,
) {
  const { response, value } = await emailExchange(
    state,
    "configuration",
    randomUUID(),
    JSON.stringify({ servicesVersion: 2, ...(managementOrigin ? { managementOrigin } : {}) }),
    signal,
  );
  const registration = state.view!.registration!;
  if (
    !response.ok ||
    !record(value) ||
    value.environment !== state.environment ||
    Object.entries(registration).some(([key, expected]) => value[key] !== expected)
  )
    throw new AppError("cloud.unavailable", {});
  return readCloudEmailGrant(value.emailRelay);
}

export interface CloudAccountEmail {
  class: "invitation" | "password_reset" | "email_change";
  recipient: string;
  displayName: string;
  locale: string;
  timeZone: string;
  expiresAt: string;
  token?: string;
  code?: string;
  codeExpiresAt?: string;
}
export type CloudEmailOutcome =
  | { status: "sent" }
  | { status: "rejected"; failureCode: "mail.relay_refused"; serverRefused: true }
  | { status: "unknown"; failureCode: "mail.relay_unknown" };
const unknown = (): CloudEmailOutcome => ({ status: "unknown", failureCode: "mail.relay_unknown" });
const refused = (): CloudEmailOutcome => ({
  status: "rejected",
  failureCode: "mail.relay_refused",
  serverRefused: true,
});
const REFUSALS: Record<number, readonly string[]> = {
  400: ["invalid_message"],
  401: ["invalid_proof"],
  403: ["relay_disabled", "grant_unavailable"],
  409: ["message_conflict"],
  429: ["rate_limited", "allowance_exhausted"],
  503: ["relay_unavailable"],
};
export async function sendCloudEmail(
  state: SavedCloudState,
  grant: CloudEmailGrant,
  messageId: string,
  message: CloudAccountEmail,
  signal?: AbortSignal,
): Promise<CloudEmailOutcome> {
  if (
    !state.view?.registration ||
    state.environment !== "test" ||
    state.lifecycle?.revoked ||
    !state.lifecycle?.lease
  )
    return refused();
  const deadline = AbortSignal.timeout(30000);
  const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let revision = 0;
  for (let submit = true; ; submit = false) {
    try {
      const body = JSON.stringify(
        submit
          ? {
              version: 1,
              messageId,
              grantId: grant.id,
              grantRevision: grant.revision,
              ...message,
            }
          : { version: 1, messageId },
      );
      if (Buffer.byteLength(body) > 4096) return submit ? refused() : unknown();
      const { response, value } = await emailExchange(
        state,
        submit ? "email-submit" : "email-status",
        submit ? messageId : randomUUID(),
        body,
        stop,
      );
      if (!response.ok)
        return submit && record(value) && REFUSALS[response.status]?.includes(String(value.error))
          ? refused()
          : unknown();
      if (
        !record(value) ||
        value.version !== 1 ||
        value.messageId !== messageId ||
        !Number.isSafeInteger(value.statusRevision) ||
        Number(value.statusRevision) < Math.max(1, revision) ||
        typeof value.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt))
      )
        return unknown();
      revision = Number(value.statusRevision);
      if (value.state === "accepted") return { status: "sent" };
      if (["failed", "expired", "cancelled"].includes(String(value.state))) return refused();
      if (!["queued", "sending"].includes(String(value.state))) return unknown();
      {
        const retry = Number(response.headers.get("retry-after"));
        await sleep(
          Math.max(2000, Math.min(30000, Number.isFinite(retry) ? retry * 1000 : 2000)),
          undefined,
          { signal: stop },
        );
      }
    } catch {
      return unknown();
    }
  }
}
