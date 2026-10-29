import { AppError } from "@waitron/shared";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";
import "./errors.js";

type Kind = "sello" | "representante";
type Operation = "inspect" | "check";
type Source = "installed" | "candidate";
type Binding = { sourceGeneration: number; expectedRevision: string | null };

export type CertificateDiagnosisRequest = {
  schemaVersion: 1;
  operation: Operation;
} & Binding &
  (
    | { source: "installed" }
    | { source: "candidate"; pfxBase64: string; passphrase: string; certKind: Kind }
  );

const CATEGORIES = [
  "local-finding",
  "local-ready",
  "name-lookup-failed",
  "connection-refused",
  "deadline-elapsed",
  "connection-closed",
  "tls-protocol-failed",
  "http-response",
  "soap-fault",
  "reply-unparseable",
  "reply-too-large",
  "query-completed",
  "cancelled",
  "unknown",
] as const;
const FINDINGS = [
  "missing",
  "unusable",
  "too_large",
  "unreadable",
  "old_encryption",
  "no_private_key",
  "passphrase_wrong",
  "expired",
  "not_yet_valid",
  "other_taxpayer",
] as const;
const STAGES = ["local", "connect", "response", "parse", "complete"] as const;

export interface CertificateDiagnosisResult {
  schemaVersion: 1;
  attemptLabel: string;
  operation: Operation;
  source: Source;
  binding: Binding;
  environment: "production" | "preproduction";
  kind: Kind | null;
  endpointLabel:
    | "production-sello"
    | "production-representante"
    | "preproduction-sello"
    | "preproduction-representante"
    | null;
  saved: { kind: Kind; installedAt: string } | null;
  association: "verified" | "unverified" | "not-applicable";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stage: (typeof STAGES)[number];
  category: (typeof CATEGORIES)[number];
  httpStatus: number | null;
  localFinding: (typeof FINDINGS)[number] | null;
  cause: "not-established";
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === allowed.length && actual.every((key) => allowed.includes(key));
}

function member<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

function generation(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

function revision(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validKind(value: unknown): value is Kind {
  return value === "sello" || value === "representante";
}

function invalid(field: string): never {
  throw new AppError("fiscal.certificate_request_invalid", { field });
}

function validMaterial(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(CERTIFICATE_MAX_BYTES / 3)
  )
    return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = (value.length / 4) * 3 - padding;
  if (bytes > CERTIFICATE_MAX_BYTES) return false;
  // Nonzero pad bits give different text to the same decoded material.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  return (
    padding === 0 ||
    alphabet.indexOf(value[value.length - padding - 1]!) % (padding === 2 ? 16 : 4) === 0
  );
}

export function parseCertificateDiagnosisRequest(raw: unknown): CertificateDiagnosisRequest {
  if (!object(raw)) invalid("body");
  if (raw.schemaVersion !== 1) invalid("schemaVersion");
  if (!member(raw.operation, ["inspect", "check"])) invalid("operation");
  if (!member(raw.source, ["installed", "candidate"])) invalid("source");
  if (!generation(raw.sourceGeneration)) invalid("sourceGeneration");
  if (!revision(raw.expectedRevision)) invalid("expectedRevision");
  const common = {
    schemaVersion: 1 as const,
    operation: raw.operation,
    sourceGeneration: raw.sourceGeneration,
    expectedRevision: raw.expectedRevision,
  };
  const fields = ["schemaVersion", "operation", "source", "sourceGeneration", "expectedRevision"];
  if (raw.source === "installed") {
    if (!keys(raw, fields)) invalid("body");
    return { ...common, source: "installed" };
  }
  if (!validMaterial(raw.pfxBase64)) invalid("pfxBase64");
  if (typeof raw.passphrase !== "string" || raw.passphrase.length === 0) invalid("passphrase");
  if (!validKind(raw.certKind)) invalid("certKind");
  if (!keys(raw, [...fields, "pfxBase64", "passphrase", "certKind"])) invalid("body");
  return {
    ...common,
    source: "candidate",
    pfxBase64: raw.pfxBase64,
    passphrase: raw.passphrase,
    certKind: raw.certKind,
  };
}

function invalidResult(): never {
  throw new TypeError("Invalid certificate diagnosis result");
}

function utc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z")
  );
}

const RESULT_FIELDS = [
  "schemaVersion",
  "attemptLabel",
  "operation",
  "source",
  "binding",
  "environment",
  "kind",
  "endpointLabel",
  "saved",
  "association",
  "startedAt",
  "completedAt",
  "durationMs",
  "stage",
  "category",
  "httpStatus",
  "localFinding",
  "cause",
];

export function parseCertificateDiagnosisResult(raw: unknown): CertificateDiagnosisResult {
  if (!object(raw) || !keys(raw, RESULT_FIELDS)) invalidResult();
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.attemptLabel !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(raw.attemptLabel)
  )
    invalidResult();
  if (
    !member(raw.operation, ["inspect", "check"]) ||
    !member(raw.source, ["installed", "candidate"]) ||
    !member(raw.environment, ["production", "preproduction"])
  )
    invalidResult();
  if (
    !object(raw.binding) ||
    !keys(raw.binding, ["sourceGeneration", "expectedRevision"]) ||
    !generation(raw.binding.sourceGeneration) ||
    !revision(raw.binding.expectedRevision)
  )
    invalidResult();
  if (raw.kind !== null && !validKind(raw.kind)) invalidResult();
  if (
    raw.endpointLabel !== null &&
    (raw.kind === null || raw.endpointLabel !== `${raw.environment}-${raw.kind}`)
  )
    invalidResult();
  let saved: CertificateDiagnosisResult["saved"] = null;
  if (raw.saved !== null) {
    if (
      !object(raw.saved) ||
      !keys(raw.saved, ["kind", "installedAt"]) ||
      !validKind(raw.saved.kind) ||
      !utc(raw.saved.installedAt)
    )
      invalidResult();
    saved = { kind: raw.saved.kind, installedAt: raw.saved.installedAt };
  }
  if (
    !member(raw.association, ["verified", "unverified", "not-applicable"]) ||
    (raw.source === "candidate"
      ? raw.association !== "not-applicable"
      : raw.association === "not-applicable") ||
    (raw.association === "verified" && (saved === null || raw.kind !== saved.kind))
  )
    invalidResult();
  if (
    !utc(raw.startedAt) ||
    !utc(raw.completedAt) ||
    typeof raw.durationMs !== "number" ||
    !Number.isFinite(raw.durationMs) ||
    raw.durationMs < 0
  )
    invalidResult();
  if (!member(raw.stage, STAGES) || raw.cause !== "not-established") invalidResult();
  if (
    raw.httpStatus !== null &&
    (typeof raw.httpStatus !== "number" ||
      !Number.isInteger(raw.httpStatus) ||
      raw.httpStatus < 100 ||
      raw.httpStatus > 599)
  )
    invalidResult();
  const knownFinding = raw.localFinding === null || member(raw.localFinding, FINDINGS);
  return {
    schemaVersion: 1,
    attemptLabel: raw.attemptLabel,
    operation: raw.operation,
    source: raw.source,
    binding: {
      sourceGeneration: raw.binding.sourceGeneration,
      expectedRevision: raw.binding.expectedRevision,
    },
    environment: raw.environment,
    kind: raw.kind,
    endpointLabel: raw.endpointLabel as CertificateDiagnosisResult["endpointLabel"],
    saved,
    association: raw.association,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationMs: raw.durationMs,
    stage: raw.stage,
    category: knownFinding && member(raw.category, CATEGORIES) ? raw.category : "unknown",
    httpStatus: raw.httpStatus,
    localFinding: member(raw.localFinding, FINDINGS) ? raw.localFinding : null,
    cause: "not-established",
  };
}

export function copyCertificateDiagnosis(result: unknown): string {
  if (!object(result)) invalidResult();
  const selected = Object.fromEntries(RESULT_FIELDS.map((field) => [field, result[field]]));
  if (object(selected.saved))
    selected.saved = { kind: selected.saved.kind, installedAt: selected.saved.installedAt };
  const parsed = parseCertificateDiagnosisResult(selected);
  return JSON.stringify(
    Object.fromEntries(Object.entries(parsed).filter(([field]) => field !== "binding")),
    null,
    2,
  );
}
