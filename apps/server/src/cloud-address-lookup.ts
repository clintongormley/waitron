import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { CloudAddressOperation, CloudAddressReply } from "@waitron/country-packs";
import type { CloudInstallationCredentials, SavedCloudState } from "./cloud-client.js";
import { cloudSignInId } from "./cloud-sign-in.js";
import { refusalOf, serviceExchange, type OnRefusal } from "./cloud-translation.js";
import "./errors.js";

export function readSetupAddressLookup(input: Record<string, unknown>) {
  const operation = { ...input };
  delete operation.tab;
  const lookup = readAddressLookup(operation);
  return lookup.kind === "available" ? undefined : lookup;
}

export function readAddressLookup(input: unknown): CloudAddressOperation {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError("cloud.request_invalid", {});
  const { kind, workflowId, query, language, selectedText } = input as Record<string, unknown>;
  const keys = Object.keys(input).length;
  if (kind === "available" && keys === 1) return { kind };
  if (cloudSignInId(workflowId)) {
    if (
      kind === "suggest" &&
      keys === 4 &&
      validText(query) &&
      (language === "en" || language === "es")
    )
      return { kind, workflowId, query, language };
    if (kind === "validate" && keys === 3 && validSelectedText(selectedText))
      return { kind, workflowId, selectedText };
  }
  throw new AppError("cloud.request_invalid", {});
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Buffer.byteLength(value) <= 512;
}

function validSelectedText(value: unknown): value is string {
  return validText(value) && Array.from(value).length <= 278;
}

export function fetchSetupAddress(
  state: CloudInstallationCredentials,
  input: Exclude<CloudAddressOperation, { kind: "available" }>,
  signal?: AbortSignal,
) {
  return exchangeAddress(state, input, signal, async (refusal, usedLease) => {
    const current = state.lifecycle;
    if (!current) return;
    if (refusal === "revoked") current.revoked = true;
    if (JSON.stringify(current.lease) === usedLease) delete current.lease;
  });
}

const addressRefusal = (status: number, value: unknown) =>
  status === 410 && (value as { error?: unknown } | null)?.error === "expired"
    ? new AppError("cloud.address_lookup_expired", {})
    : refusalOf(status, value);

export function registeredAddressLookup(deps: {
  read: () => Promise<SavedCloudState | undefined>;
  registrationOf: (state: SavedCloudState | undefined) => string | undefined;
  leaseState: (signal: AbortSignal) => Promise<SavedCloudState>;
  recordRefusal: OnRefusal;
}) {
  return async (
    input: CloudAddressOperation,
    authorize: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<CloudAddressReply> => {
    const registration = deps.registrationOf(await deps.read());
    if (!registration) {
      if (input.kind === "available") return { available: false };
      throw new AppError("cloud.not_configured", {});
    }
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    const current = async () => {
      await authorize();
      const state = await deps.read();
      if (deps.registrationOf(state) !== registration)
        throw new AppError("cloud.binding_conflict", {});
      if (deadline.aborted) throw new AppError("cloud.unavailable", {});
      return state!;
    };
    await deps.leaseState(deadline);
    const state = await current();
    if (input.kind === "available") {
      const reply = await exchange(state, input, deadline, deps.recordRefusal).catch(
        () => undefined,
      );
      if (reply === undefined) return { available: false };
      await current();
      return { available: true };
    }
    const reply = await exchangeAddress(state, input, deadline, deps.recordRefusal, addressRefusal);
    await current();
    return reply;
  };
}

function exchange(
  state: CloudInstallationCredentials,
  input: CloudAddressOperation,
  signal: AbortSignal | undefined,
  onRefusal: OnRefusal,
  refusal?: typeof refusalOf,
) {
  return serviceExchange(
    state,
    "address-lookup",
    randomUUID(),
    JSON.stringify({ version: 1, ...input }),
    {},
    signal,
    onRefusal,
    { requireVersion: false, refusal, successStatus: input.kind === "available" ? 200 : undefined },
  );
}

async function exchangeAddress(
  state: CloudInstallationCredentials,
  input: Exclude<CloudAddressOperation, { kind: "available" }>,
  signal: AbortSignal | undefined,
  onRefusal: OnRefusal,
  refusal?: typeof refusalOf,
): Promise<CloudAddressReply> {
  const reply = await exchange(state, input, signal, onRefusal, refusal);
  if (reply.workflowId !== input.workflowId || reply.provider !== "google")
    throw new AppError("cloud.unavailable", {});
  if (input.kind === "suggest" && Array.isArray(reply.candidates)) {
    const candidates: { text: string }[] = [];
    for (const candidate of reply.candidates)
      if (validSelectedText(candidate?.text)) candidates.push({ text: candidate.text });
    return { candidates };
  }
  if (input.kind === "validate" && reply.fields && typeof reply.fields === "object") {
    const { addressLine1, addressLine2, postalCode, city, province, countryCode } =
      reply.fields as Record<string, unknown>;
    if (
      countryCode === "ES" &&
      typeof addressLine1 === "string" &&
      (typeof addressLine2 === "string" || addressLine2 === null) &&
      typeof postalCode === "string" &&
      typeof city === "string" &&
      typeof province === "string"
    )
      return { fields: { addressLine1, addressLine2, postalCode, city, province, countryCode } };
  }
  throw new AppError("cloud.unavailable", {});
}
