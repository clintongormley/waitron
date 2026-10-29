import { createClient, VerifactuTransportError } from "@waitron/verifactu";
import { firstCodeInCauseChain } from "@waitron/shared";
import type { DeploymentEnvironment } from "@waitron/db";
import type { FiscalCertificateJson, FiscalCertificateSeat } from "@waitron/fiscal";
import { aeatEndpointFor, isCertKind, type CertKind } from "./aeat-transport.js";
import type { CheckTransport } from "./certificate-check.js";
import { localDate } from "./certificate-dates.js";
import { normaliseTaxId, openCertificateFile } from "./certificate-file.js";
import type { CertificateDiagnosisResult } from "./certificate-diagnosis-contract.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";
import {
  diagnosticTransport,
  type DiagnosticTransportObservation,
} from "./certificate-diagnosis-transport.js";

export interface CertificateDiagnosisChildInput {
  operation: "inspect" | "check";
  material: { pfxBase64: string; passphrase: string; certKind: CertKind };
  taxpayer: { legalName: string; taxId: string };
  timeZone: string;
  environment: DeploymentEnvironment;
  startedAt: string;
}

export interface CertificateDiagnosisChildOutput {
  openedFingerprint: string | null;
  kind: CertKind | null;
  completedAt: string;
  stage: CertificateDiagnosisResult["stage"];
  category: CertificateDiagnosisResult["category"];
  httpStatus: number | null;
  localFinding: CertificateDiagnosisResult["localFinding"];
}

export interface CertificateDiagnosisChildOverrides {
  open?: typeof openCertificateFile;
  endpointFor?: CheckTransport["endpointFor"];
  transport?: typeof diagnosticTransport;
}

const TLS_CODES = new Set([
  "EPROTO",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const NAME_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);
const CLOSED_CODES = new Set(["UND_ERR_SOCKET", "ECONNRESET"]);

function categoryFor(
  error: unknown,
  signal: AbortSignal,
  observed: DiagnosticTransportObservation,
): CertificateDiagnosisResult["category"] {
  if (signal.aborted) return signal.reason === "deadline" ? "deadline-elapsed" : "cancelled";
  if (observed.category === "reply-too-large") return "reply-too-large";
  if (error instanceof VerifactuTransportError) {
    if (error.kind === "soap") {
      return error.cause !== undefined || (!error.faultCode && !error.faultReason)
        ? "reply-unparseable"
        : "soap-fault";
    }
    if (error.kind === "http") return "http-response";
  }
  const code = firstCodeInCauseChain(
    error,
    (value) =>
      TLS_CODES.has(value) ||
      NAME_CODES.has(value) ||
      CLOSED_CODES.has(value) ||
      value === "ECONNREFUSED",
  );
  if (code !== null) {
    if (TLS_CODES.has(code)) return "tls-protocol-failed";
    if (NAME_CODES.has(code)) return "name-lookup-failed";
    if (CLOSED_CODES.has(code)) return "connection-closed";
    return "connection-refused";
  }
  return observed.stage === "parse" ? "reply-unparseable" : "unknown";
}

export async function runCertificateDiagnosisChild(
  input: CertificateDiagnosisChildInput,
  signal: AbortSignal,
  report: (progress: FiscalCertificateJson) => void,
  overrides: CertificateDiagnosisChildOverrides = {},
): Promise<CertificateDiagnosisChildOutput> {
  let openedFingerprint: string | null = null;
  let kind: CertKind | null = null;
  let observed: DiagnosticTransportObservation = {
    stage: "local",
    category: "unknown",
    httpStatus: null,
  };
  function observe(value: DiagnosticTransportObservation): void {
    observed = { ...value };
    report({ stage: value.stage, category: value.category, httpStatus: value.httpStatus });
  }
  const answer = (
    category: CertificateDiagnosisResult["category"],
    localFinding: CertificateDiagnosisResult["localFinding"] = null,
  ): CertificateDiagnosisChildOutput => ({
    openedFingerprint,
    kind,
    completedAt: new Date().toISOString(),
    stage: observed.stage,
    category,
    httpStatus: observed.httpStatus,
    localFinding,
  });
  observe(observed);
  if (signal.aborted) return answer(categoryFor(null, signal, observed));
  const pfx = Buffer.from(input.material.pfxBase64, "base64");
  let transport: ReturnType<typeof diagnosticTransport> | undefined;
  try {
    const opened = (overrides.open ?? openCertificateFile)(pfx, input.material.passphrase);
    if (!opened.ok) return answer("local-finding", opened.reason);
    openedFingerprint = opened.details.fingerprint;
    kind = input.material.certKind;
    const now = Date.parse(input.startedAt);
    if (now >= opened.details.validUntil.getTime()) return answer("local-finding", "expired");
    if (now < opened.details.validFrom.getTime()) return answer("local-finding", "not_yet_valid");
    if (
      opened.details.taxId !== null &&
      opened.details.taxId !== normaliseTaxId(input.taxpayer.taxId)
    )
      return answer("local-finding", "other_taxpayer");
    signal.throwIfAborted();
    if (input.operation === "inspect") {
      observe({ stage: "complete", category: "local-ready", httpStatus: null });
      return answer("local-ready");
    }
    const endpoint = (overrides.endpointFor ?? aeatEndpointFor(input.environment))(kind);
    transport = (overrides.transport ?? diagnosticTransport)(
      { pfx, passphrase: input.material.passphrase, certKind: kind },
      { endpoint, signal, report: observe },
    );
    const [year, month] = localDate(new Date(input.startedAt), input.timeZone).split("-");
    await createClient({ endpoint, fetch: transport.fetch }).consultar(
      { ObligadoEmision: { NombreRazon: input.taxpayer.legalName, NIF: input.taxpayer.taxId } },
      { Ejercicio: year!, Periodo: month! },
    );
    observe({
      stage: "complete",
      category: "query-completed",
      httpStatus: transport.observation().httpStatus,
    });
    return answer("query-completed");
  } catch (error) {
    if (transport) observed = transport.observation();
    return answer(categoryFor(error, signal, observed));
  } finally {
    try {
      if (transport) {
        if (signal.aborted) await transport.destroy();
        else await transport.close();
      }
    } finally {
      pfx.fill(0);
    }
  }
}

function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === names.length &&
    Object.keys(value).every((name) => names.includes(name))
  );
}

function parseInput(raw: FiscalCertificateJson): CertificateDiagnosisChildInput {
  const invalid = () => {
    throw new TypeError("Invalid certificate diagnosis child input");
  };
  if (!fields(raw, ["operation", "material", "taxpayer", "timeZone", "environment", "startedAt"]))
    return invalid();
  if (
    (raw.operation !== "inspect" && raw.operation !== "check") ||
    !fields(raw.material, ["pfxBase64", "passphrase", "certKind"]) ||
    !fields(raw.taxpayer, ["legalName", "taxId"])
  )
    return invalid();
  if (
    typeof raw.taxpayer.legalName !== "string" ||
    raw.taxpayer.legalName.length === 0 ||
    typeof raw.taxpayer.taxId !== "string" ||
    raw.taxpayer.taxId.length === 0 ||
    (raw.environment !== "production" && raw.environment !== "preproduction") ||
    typeof raw.timeZone !== "string" ||
    typeof raw.startedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.startedAt) ||
    !Number.isFinite(Date.parse(raw.startedAt))
  )
    return invalid();
  if (new Date(raw.startedAt).toISOString() !== raw.startedAt) return invalid();
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: raw.timeZone });
  } catch {
    return invalid();
  }
  const material = raw.material;
  if (
    typeof material.pfxBase64 !== "string" ||
    material.pfxBase64.length === 0 ||
    material.pfxBase64.length > 4 * Math.ceil(CERTIFICATE_MAX_BYTES / 3) ||
    typeof material.passphrase !== "string" ||
    typeof material.certKind !== "string" ||
    !isCertKind(material.certKind)
  )
    return invalid();
  const decoded = Buffer.from(material.pfxBase64, "base64");
  try {
    if (decoded.length > CERTIFICATE_MAX_BYTES || decoded.toString("base64") !== material.pfxBase64)
      return invalid();
  } finally {
    decoded.fill(0);
  }
  return {
    operation: raw.operation,
    material: {
      pfxBase64: material.pfxBase64,
      passphrase: material.passphrase,
      certKind: material.certKind,
    },
    taxpayer: { legalName: raw.taxpayer.legalName, taxId: raw.taxpayer.taxId },
    environment: raw.environment,
    timeZone: raw.timeZone,
    startedAt: raw.startedAt,
  };
}

export function makeCertificateDiagnosisChild(
  overrides: CertificateDiagnosisChildOverrides = {},
): NonNullable<FiscalCertificateSeat["diagnoseInChild"]> {
  return async (raw, signal, report) => {
    try {
      return {
        ...(await runCertificateDiagnosisChild(parseInput(raw), signal, report, overrides)),
      };
    } catch {
      throw new TypeError("Certificate diagnosis child unavailable");
    }
  };
}
