import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pairingV4Payload, type PairingV4Claims } from "@waitron/contract";
import { AppError } from "@waitron/shared";
import { readCloudResponseBytes, signCloudPayload } from "./cloud-signed-request.js";
import type { CloudRegistration } from "./cloud-client.js";
import "./errors.js";

export const CLOUD_SIGN_IN_CALLBACK = "/cloud/pairing/callback";

type Operation = PairingV4Claims;
export type CloudSignInProfile = Extract<Operation, { action: "complete" }>["args"];
export interface CloudSignInBinding {
  tab: string;
  session: string;
}
export type CloudSignInReturn = { requestId: string; state: string } & (
  { code: string } | { error: "access_denied" | "expired" }
);
type Attempt = CloudSignInBinding & {
  requestId: string;
  state: string;
  verifier: string;
  expiresAt: string;
  phase: "awaiting_cloud" | "redeeming" | "account_bound";
  profile?: CloudSignInProfile;
};
export interface CloudSignInState {
  version: 4;
  origin: string;
  privateKey: string;
  publicKey: string;
  attempt?: Attempt;
}

export const cloudSignInId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[\w-]{42}[AEIMQUYcgkosw048]$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function readCloudSignInReturn(value: Record<string, unknown>): CloudSignInReturn {
  const { requestId, state, code, error } = value;
  if (Object.keys(value).length === 4 && cloudSignInId(requestId) && token(state)) {
    if (token(code) && !Object.hasOwn(value, "error")) return { requestId, state, code };
    if ((error === "access_denied" || error === "expired") && !Object.hasOwn(value, "code"))
      return { requestId, state, error };
  }
  throw new AppError("cloud.request_invalid", {});
}

export function readCloudSignInAttempt(value: unknown): Attempt | undefined {
  if (value === undefined) return;
  if (
    !record(value) ||
    !cloudSignInId(value.requestId) ||
    !cloudSignInId(value.tab) ||
    typeof value.session !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.session) ||
    !token(value.state) ||
    !token(value.verifier) ||
    !instant(value.expiresAt) ||
    !["awaiting_cloud", "redeeming", "account_bound"].includes(value.phase as string) ||
    (value.profile !== undefined &&
      (!Array.isArray(value.profile) ||
        value.profile.length !== 5 ||
        !Array.isArray(value.profile[2]) ||
        value.profile[2].length !== 5 ||
        !value.profile.flat().every((field) => typeof field === "string")))
  )
    throw new AppError("cloud.state_invalid", {});
  return value as unknown as Attempt;
}

export function newCloudSignInAttempt(binding: CloudSignInBinding): Attempt {
  return {
    ...binding,
    requestId: randomUUID(),
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    phase: "awaiting_cloud",
  };
}

type Reply =
  | { state: "awaiting_cloud" | "account_bound"; expiresAt: string }
  | { state: "complete"; expiresAt: string; registration: CloudRegistration };

export async function exchangeCloudSignIn(
  state: CloudSignInState,
  attempt: Attempt,
  operation: {
    [Action in Operation["action"]]: Pick<
      Extract<Operation, { action: Action }>,
      "action" | "args"
    >;
  }[Operation["action"]],
): Promise<Reply & { authorizationUrl?: string }> {
  const { requestId } = attempt;
  const { action, args } = operation;
  const bytes = pairingV4Payload({
    ...operation,
    origin: state.origin,
    requestId,
    publicKey: state.publicKey,
    issuedAt: Date.now(),
  });
  const signature = signCloudPayload(bytes, state.privateKey);
  try {
    const response = await fetch(`${state.origin}/api/pairing/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: bytes.toString("base64url"), signature }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    const result: unknown = JSON.parse((await readCloudResponseBytes(response, 16384)).toString());
    if (!response.ok) {
      if (record(result) && result.error === "pairing_unavailable")
        throw new AppError("cloud.request_unavailable", {});
      if (
        record(result) &&
        ["business_match_ambiguous", "binding_conflict"].includes(result.error as string)
      )
        throw new AppError("cloud.binding_conflict", {});
      throw new Error();
    }
    if (!record(result) || result.requestId !== requestId || !instant(result.expiresAt))
      throw new Error();
    const { expiresAt, registration } = result;
    if (action === "start") {
      if (result.state !== "awaiting_cloud" || typeof result.authorizationUrl !== "string")
        throw new Error();
      const url = new URL(result.authorizationUrl);
      const query = url.searchParams;
      if (
        url.origin !== state.origin ||
        url.pathname !== "/login" ||
        url.username ||
        url.password ||
        url.hash ||
        query.size !== 4 ||
        query.get("request_id") !== requestId ||
        query.get("state") !== attempt.state ||
        query.get("code_challenge") !== args[2] ||
        query.get("code_challenge_method") !== "S256"
      )
        throw new Error();
      return { state: "awaiting_cloud", expiresAt, authorizationUrl: url.href };
    }
    if (
      (action === "status" && result.state === "awaiting_cloud") ||
      ((action === "redeem" || action === "status") && result.state === "account_bound")
    ) {
      if (Object.hasOwn(result, "registration")) throw new Error();
      return { state: result.state, expiresAt };
    }
    if (
      (action === "complete" || action === "status") &&
      result.state === "complete" &&
      record(registration) &&
      cloudSignInId(registration.venueId) &&
      cloudSignInId(registration.installationId) &&
      cloudSignInId(registration.organisationId) &&
      cloudSignInId(registration.legalBusinessId)
    )
      return {
        state: "complete",
        expiresAt,
        registration: {
          venueId: registration.venueId,
          installationId: registration.installationId,
          organisationId: registration.organisationId,
          legalBusinessId: registration.legalBusinessId,
        },
      };
    throw new Error();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("cloud.unavailable", {});
  }
}

export const cloudSignInChallenge = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");
