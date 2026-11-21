import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isPairingV4Profile, type PairingV4Operation } from "@waitron/contract";
import { AppError } from "@waitron/shared";
import type { CloudRegistration } from "./cloud-client.js";
import "./errors.js";

export const CLOUD_SIGN_IN_CALLBACK = "/cloud/pairing/callback";

export type CloudSignInProfile = Extract<PairingV4Operation, { action: "complete" }>["args"];
export interface CloudSignInBinding {
  tab: string;
  session: string;
  kind?: "setup";
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
  publishedNodeId?: string;
  provisionalRegistration?: CloudRegistration;
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

function readRegistration(value: unknown): CloudRegistration | undefined {
  if (
    !record(value) ||
    !cloudSignInId(value.venueId) ||
    !cloudSignInId(value.installationId) ||
    !cloudSignInId(value.organisationId) ||
    !cloudSignInId(value.legalBusinessId)
  )
    return;
  const { venueId, installationId, organisationId, legalBusinessId } = value;
  return { venueId, installationId, organisationId, legalBusinessId };
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
    (value.profile !== undefined && !isPairingV4Profile(value.profile)) ||
    (value.kind !== undefined && value.kind !== "setup") ||
    (value.publishedNodeId !== undefined &&
      (value.kind !== "setup" ||
        value.phase !== "account_bound" ||
        !cloudSignInId(value.publishedNodeId))) ||
    (value.provisionalRegistration !== undefined && value.kind !== "setup")
  )
    throw new AppError("cloud.state_invalid", {});
  const attempt = value as unknown as Attempt;
  if (attempt.provisionalRegistration !== undefined) {
    const registration = readRegistration(attempt.provisionalRegistration);
    if (!registration) throw new AppError("cloud.state_invalid", {});
    attempt.provisionalRegistration = registration;
  }
  return attempt;
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
  | { state: "awaiting_cloud"; expiresAt: string }
  | { state: "account_bound"; expiresAt: string; provisionalRegistration?: CloudRegistration }
  | { state: "complete"; expiresAt: string; registration: CloudRegistration };

export function readCloudSignInReply(
  result: unknown,
  origin: string,
  attempt: Attempt,
  { action, args }: PairingV4Operation,
): Reply & { authorizationUrl?: string } {
  const { requestId } = attempt;
  if (!record(result) || result.requestId !== requestId || !instant(result.expiresAt))
    throw new Error();
  const { expiresAt, registration } = result;
  if (action === "start") {
    if (result.state !== "awaiting_cloud" || typeof result.authorizationUrl !== "string")
      throw new Error();
    const url = new URL(result.authorizationUrl);
    const query = url.searchParams;
    if (
      url.origin !== origin ||
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
  if ((action === "redeem" || action === "status") && result.state === "account_bound") {
    if (Object.hasOwn(result, "registration")) throw new Error();
    const provisionalRegistration = result.provisionalRegistration;
    if (provisionalRegistration !== undefined) {
      const provisional = readRegistration(provisionalRegistration);
      if (attempt.kind !== "setup" || !provisional) throw new Error();
      return { state: "account_bound", expiresAt, provisionalRegistration: provisional };
    }
    return { state: "account_bound", expiresAt };
  }
  if (
    action === "status" &&
    result.state === "awaiting_cloud" &&
    !Object.hasOwn(result, "registration") &&
    !Object.hasOwn(result, "provisionalRegistration")
  )
    return { state: "awaiting_cloud", expiresAt };
  if ((action === "complete" || action === "status") && result.state === "complete") {
    const final = readRegistration(registration);
    if (
      !final ||
      (attempt.provisionalRegistration &&
        Object.entries(attempt.provisionalRegistration).some(
          ([key, id]) => final[key as keyof CloudRegistration] !== id,
        ))
    )
      throw new Error();
    return { state: "complete", expiresAt, registration: final };
  }
  throw new Error();
}

export const cloudSignInChallenge = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");
