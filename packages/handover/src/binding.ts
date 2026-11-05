import { canonicalize } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { sha256Hex } from "./envelope.js";
import "./errors.js";
import type { handoverScenario } from "./schema/activations.js";

export type HandoverScenario = (typeof handoverScenario.enumValues)[number];

/** What one operation is about, fixed when it starts. */
export interface HandoverBinding {
  readonly operationId: string;
  readonly scenario: HandoverScenario;
  readonly venue: {
    readonly country: string;
    readonly taxId: string;
    readonly environment: "production" | "preproduction";
  };
  readonly sourceNodeId: string;
  readonly destinationNodeId: string;
  readonly membership: { readonly term: number; readonly digest: string };
}

// Lower-case only: the operation id is inside the fingerprint, so one id has one spelling.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Whether `value` is an operation id `parseBinding` accepts. */
export function isOperationId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function refuse(field: string): never {
  throw new AppError("handover.request_invalid", { field });
}

function objectWith(raw: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) refuse(field);
  const record = raw as Record<string, unknown>;
  const prefix = field === "binding" ? "" : `${field}.`;
  for (const key of keys) if (!(key in record)) refuse(`${prefix}${key}`);
  for (const key of Object.keys(record)) if (!keys.includes(key)) refuse(`${prefix}${key}`);
  return record;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") refuse(field);
  return value;
}

function matching(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value)) refuse(field);
  return value;
}

export function parseBinding(raw: unknown): HandoverBinding {
  const top = objectWith(raw, "binding", [
    "operationId",
    "scenario",
    "venue",
    "sourceNodeId",
    "destinationNodeId",
    "membership",
  ]);
  const operationId = matching(top.operationId, UUID_V4, "operationId");
  const scenario = top.scenario;
  if (scenario !== "controlled" && scenario !== "emergency") refuse("scenario");

  const venue = objectWith(top.venue, "venue", ["country", "taxId", "environment"]);
  const country = nonEmptyString(venue.country, "venue.country");
  const taxId = nonEmptyString(venue.taxId, "venue.taxId");
  const environment = venue.environment;
  if (environment !== "production" && environment !== "preproduction") refuse("venue.environment");

  const sourceNodeId = nonEmptyString(top.sourceNodeId, "sourceNodeId");
  const destinationNodeId = nonEmptyString(top.destinationNodeId, "destinationNodeId");
  if (destinationNodeId === sourceNodeId) refuse("destinationNodeId");

  const membership = objectWith(top.membership, "membership", ["term", "digest"]);
  const term = membership.term;
  if (!Number.isSafeInteger(term) || (term as number) < 1) refuse("membership.term");
  const digest = matching(membership.digest, SHA256_HEX, "membership.digest");

  return {
    operationId,
    scenario,
    venue: { country, taxId, environment },
    sourceNodeId,
    destinationNodeId,
    membership: { term: term as number, digest },
  };
}

export function bindingFingerprint(binding: HandoverBinding): string {
  return sha256Hex(canonicalize(binding as unknown as CanonicalValue));
}
