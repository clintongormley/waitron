import { isOperationId, isSha256Hex } from "@waitron/handover";
import { AppError, isUuid } from "@waitron/shared";
import { isKeySegment, parseGenerationName } from "@waitron/stream";
import "./errors.js";

/** Which copy of a venue Cloud started, as Cloud hands it to the launcher. */
export interface EmergencyCopyBinding {
  readonly copyOperationId: string;
  readonly venueId: string;
  readonly environment: "production" | "preproduction";
  readonly sourceNodeId: string;
  readonly sourceInstallationId: string;
  readonly copyNodeId: string;
  readonly installationId: string;
  readonly selectedStream: {
    readonly streamId: string;
    readonly generation: string;
    readonly databaseSha256: string;
  };
  readonly startedAt: string;
  readonly expiresAt: string;
}

const BINDING_KEYS = [
  "copyOperationId",
  "venueId",
  "environment",
  "sourceNodeId",
  "sourceInstallationId",
  "copyNodeId",
  "installationId",
  "selectedStream",
  "startedAt",
  "expiresAt",
] as const;
const STREAM_KEYS = ["streamId", "generation", "databaseSha256"] as const;
const LIFETIME_MS = 30 * 60 * 1000;

function refuse(field: string): never {
  throw new AppError("emergency_copy.binding_invalid", { field });
}

function exactObject(
  raw: unknown,
  field: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) refuse(field);
  const record = raw as Record<string, unknown>;
  const prefix = field === "binding" ? "" : `${field}.`;
  for (const key of keys) if (!(key in record)) refuse(`${prefix}${key}`);
  for (const key of Object.keys(record)) if (!keys.includes(key)) refuse(`${prefix}${key}`);
  return record;
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") refuse(field);
  return value;
}

function uuidV4(value: unknown, field: string): string {
  if (!isOperationId(value)) refuse(field);
  return value;
}

function instant(value: unknown, field: string): number {
  if (typeof value !== "string") refuse(field);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) refuse(field);
  return time;
}

export function parseEmergencyCopyBinding(input: unknown, now: Date): EmergencyCopyBinding {
  const top = exactObject(input, "binding", BINDING_KEYS);
  const copyOperationId = uuidV4(top.copyOperationId, "copyOperationId");
  const venueId = nonEmpty(top.venueId, "venueId");
  if (!isUuid(venueId)) refuse("venueId");
  const environment = top.environment;
  if (environment !== "production" && environment !== "preproduction") refuse("environment");
  const sourceNodeId = uuidV4(top.sourceNodeId, "sourceNodeId");
  const sourceInstallationId = nonEmpty(top.sourceInstallationId, "sourceInstallationId");
  const copyNodeId = uuidV4(top.copyNodeId, "copyNodeId");
  if (copyNodeId === sourceNodeId) refuse("copyNodeId");
  if (copyOperationId === sourceNodeId || copyOperationId === copyNodeId) refuse("copyOperationId");
  const installationId = nonEmpty(top.installationId, "installationId");

  const stream = exactObject(top.selectedStream, "selectedStream", STREAM_KEYS);
  const streamId = nonEmpty(stream.streamId, "selectedStream.streamId");
  if (!isKeySegment(streamId)) refuse("selectedStream.streamId");
  const generation = nonEmpty(stream.generation, "selectedStream.generation");
  if (parseGenerationName(generation) === null) refuse("selectedStream.generation");
  const databaseSha256 = stream.databaseSha256;
  if (!isSha256Hex(databaseSha256)) refuse("selectedStream.databaseSha256");

  const started = instant(top.startedAt, "startedAt");
  const expires = instant(top.expiresAt, "expiresAt");
  if (expires - started !== LIFETIME_MS) refuse("expiresAt");
  const expiresAt = top.expiresAt as string;
  if (now.getTime() >= expires) throw new AppError("emergency_copy.binding_expired", { expiresAt });

  return {
    copyOperationId,
    venueId,
    environment,
    sourceNodeId,
    sourceInstallationId,
    copyNodeId,
    installationId,
    selectedStream: { streamId, generation, databaseSha256 },
    startedAt: top.startedAt as string,
    expiresAt,
  };
}
