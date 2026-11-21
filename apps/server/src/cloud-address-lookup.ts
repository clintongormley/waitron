import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { CloudInstallationCredentials } from "./cloud-client.js";
import { cloudSignInId } from "./cloud-sign-in.js";
import { serviceExchange } from "./cloud-translation.js";
import "./errors.js";

type Lookup =
  | { kind: "suggest"; workflowId: string; query: string; language: "en" | "es" }
  | { kind: "validate"; workflowId: string; selectedText: string };

export function readSetupAddressLookup(input: Record<string, unknown>): Lookup | undefined {
  const { kind, workflowId, query, language, selectedText } = input;
  const keys = Object.keys(input).length;
  if (kind === "available" && keys === 2) return;
  if (cloudSignInId(workflowId)) {
    if (
      kind === "suggest" &&
      keys === 5 &&
      validText(query) &&
      (language === "en" || language === "es")
    )
      return { kind, workflowId, query, language };
    if (kind === "validate" && keys === 4 && validSelectedText(selectedText))
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

export async function fetchSetupAddress(
  state: CloudInstallationCredentials,
  input: Lookup,
  signal?: AbortSignal,
) {
  const reply = await serviceExchange(
    state,
    "address-lookup",
    randomUUID(),
    JSON.stringify({ version: 1, ...input }),
    {},
    signal,
    async (refusal, usedLease) => {
      const current = state.lifecycle;
      if (!current) return;
      if (refusal === "revoked") current.revoked = true;
      if (JSON.stringify(current.lease) === usedLease) delete current.lease;
    },
    { requireVersion: false },
  );
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
