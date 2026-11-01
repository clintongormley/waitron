import { randomUUID } from "node:crypto";
import { credentialRevision, tryGetCredential } from "@waitron/credentials";
import { readTenant } from "@waitron/db";
import type {
  FiscalCertificateDiagnosisDeps,
  FiscalCertificateDiagnosisChildResult,
  FiscalCertificateJson,
} from "@waitron/fiscal";
import "@waitron/identity";
import { AppError } from "@waitron/shared";
import { isCertKind } from "./aeat-transport.js";
import {
  parseCertificateDiagnosisRequest,
  parseCertificateDiagnosisResult,
  type CertificateDiagnosisRequest,
  type CertificateDiagnosisResult,
} from "./certificate-diagnosis-contract.js";
import { venueTimeZone } from "./certificate-install.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";
import { latestInstall } from "./certificate-record.js";
import "./errors.js";

function materialFrom(value: Record<string, unknown>) {
  if (
    typeof value.pfxBase64 !== "string" ||
    value.pfxBase64.length === 0 ||
    value.pfxBase64.length > 4 * Math.ceil(CERTIFICATE_MAX_BYTES / 3) ||
    typeof value.passphrase !== "string" ||
    typeof value.certKind !== "string" ||
    !isCertKind(value.certKind)
  )
    return null;
  const pfx = Buffer.from(value.pfxBase64, "base64");
  try {
    if (
      pfx.length === 0 ||
      pfx.length > CERTIFICATE_MAX_BYTES ||
      pfx.toString("base64") !== value.pfxBase64
    )
      return null;
  } finally {
    pfx.fill(0);
  }
  return { pfxBase64: value.pfxBase64, passphrase: value.passphrase, certKind: value.certKind };
}

function object(
  value: FiscalCertificateJson,
): value is { readonly [key: string]: FiscalCertificateJson } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function diagnoseCertificate(
  deps: FiscalCertificateDiagnosisDeps,
  raw: unknown,
  now: Date,
): Promise<CertificateDiagnosisResult> {
  try {
    const parsed = parseCertificateDiagnosisRequest(raw);
    return diagnoseBoundCertificate(
      deps,
      {
        source: parsed.source,
        operation: parsed.operation,
        sourceGeneration: parsed.sourceGeneration,
        expectedRevision: parsed.expectedRevision,
      },
      parsed.source === "candidate" ? materialFrom(parsed) : null,
      now,
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

async function diagnoseBoundCertificate(
  deps: FiscalCertificateDiagnosisDeps,
  request: Pick<
    CertificateDiagnosisRequest,
    "source" | "operation" | "sourceGeneration" | "expectedRevision"
  >,
  candidate: ReturnType<typeof materialFrom>,
  now: Date,
): Promise<CertificateDiagnosisResult> {
  const started = performance.now();
  // These no-drain turns preserve unrelated change-log rows and release the write queue before
  // native/network work. Both authorize and bind one committed snapshot; neither writes.
  const read = await deps.db.withWriteLock(async () => {
    const authorization = await deps.authorize(deps.db);
    const revision = await credentialRevision(deps.db, { purpose: "fiscal.aeat" });
    if (revision !== request.expectedRevision) throw new AppError("fiscal.certificate_changed", {});
    const tenant = await readTenant(deps.db);
    if (tenant === null)
      throw new AppError("fiscal.certificate_request_invalid", { field: "body" });
    const timeZone = await venueTimeZone(deps.db);
    const latest = await latestInstall(deps.db, deps.nodeId);
    let material = candidate;
    candidate = null;
    let finding: "missing" | "unusable" | null = null;
    if (request.source === "installed") {
      try {
        const payload = await tryGetCredential(deps.db, deps.ring, { purpose: "fiscal.aeat" });
        if (payload === null) finding = "missing";
        else {
          material = materialFrom(payload);
          if (material === null) finding = "unusable";
        }
      } catch {
        finding = "unusable";
      }
    }
    return { authorization, revision, tenant, timeZone, latest, material, finding };
  });
  const selectedKind = read.material?.certKind ?? null;

  const expiry = new AbortController();
  const signal = AbortSignal.any([deps.signal, expiry.signal]);
  const expires = Date.parse(read.authorization.expiresAt);
  const remaining = expires - deps.clock().getTime();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!Number.isFinite(remaining) || remaining <= 0) expiry.abort("session-expired");
  else timer = setTimeout(() => expiry.abort("session-expired"), Math.min(remaining, 2147483647));
  let output: FiscalCertificateDiagnosisChildResult | null = null;
  try {
    if (read.material !== null && !signal.aborted) {
      try {
        let input: FiscalCertificateJson = {
          operation: request.operation,
          material: read.material,
          taxpayer: { legalName: read.tenant.legalName, taxId: read.tenant.taxId },
          timeZone: read.timeZone,
          environment: deps.environment,
          startedAt: now.toISOString(),
        };
        const pending = deps.runChild(input, signal);
        input = null;
        read.material = null;
        output = await pending;
      } catch {
        output = { outcome: "interrupted", reason: "unavailable", lastProgress: null };
      }
    }

    return await deps.db.withWriteLock(async () => {
      const final = await deps.authorize(deps.db);
      const finalRemaining = Date.parse(final.expiresAt) - deps.clock().getTime();
      if (expiry.signal.aborted || !Number.isFinite(finalRemaining) || finalRemaining <= 0) {
        throw new AppError("management_session.expired", {});
      }
      if (final.personId !== read.authorization.personId)
        throw new AppError("management_session.required", {});
      const revision = await credentialRevision(deps.db, { purpose: "fiscal.aeat" });
      const latest = await latestInstall(deps.db, deps.nodeId);
      if (revision !== read.revision || JSON.stringify(latest) !== JSON.stringify(read.latest)) {
        throw new AppError("fiscal.certificate_changed", {});
      }

      const fallback: CertificateDiagnosisResult = {
        schemaVersion: 1,
        attemptLabel: randomUUID(),
        operation: request.operation,
        source: request.source,
        binding: {
          sourceGeneration: request.sourceGeneration,
          expectedRevision: request.expectedRevision,
        },
        environment: deps.environment,
        kind: null,
        endpointLabel: null,
        saved:
          read.latest === null
            ? null
            : { kind: read.latest.kind, installedAt: read.latest.installedAt.toISOString() },
        association: request.source === "candidate" ? "not-applicable" : "unverified",
        startedAt: now.toISOString(),
        completedAt: deps.clock().toISOString(),
        durationMs: Math.max(0, performance.now() - started),
        stage: "local",
        category: read.finding === null ? "unknown" : "local-finding",
        httpStatus: null,
        localFinding: read.finding,
        cause: "not-established",
      };
      if (deps.signal.aborted && deps.signal.reason !== "deadline")
        return { ...fallback, category: "cancelled", localFinding: null };
      if (output === null)
        return deps.signal.aborted
          ? { ...fallback, category: "deadline-elapsed", localFinding: null }
          : fallback;
      const value = output.outcome === "completed" ? output.value : output.lastProgress;
      if (value !== null && object(value)) {
        try {
          const result = parseCertificateDiagnosisResult({
            ...fallback,
            stage: value.stage,
            category: value.category,
            httpStatus: value.httpStatus,
            localFinding: output.outcome === "completed" ? value.localFinding : null,
          });
          if (output.outcome === "completed") {
            const kind = value.kind;
            if (kind !== null && kind !== selectedKind) return fallback;
            result.kind = kind;
            result.endpointLabel = kind === null ? null : `${deps.environment}-${kind}`;
            if (
              request.source === "installed" &&
              read.latest !== null &&
              value.openedFingerprint === read.latest.fingerprint &&
              kind === read.latest.kind
            )
              result.association = "verified";
            return result;
          }
          return {
            ...result,
            category:
              output.reason === "deadline"
                ? "deadline-elapsed"
                : output.reason === "cancelled"
                  ? "cancelled"
                  : result.category,
          };
        } catch {
          /* Malformed child data is unavailable, never copied into public evidence. */
        }
      }
      return {
        ...fallback,
        category:
          output.outcome === "interrupted" && output.reason === "deadline"
            ? "deadline-elapsed"
            : output.outcome === "interrupted" && output.reason === "cancelled"
              ? "cancelled"
              : fallback.category,
      };
    });
  } finally {
    clearTimeout(timer);
    read.material = null;
  }
}
