import { credentialRevision, putCredential, type KeyRing } from "@waitron/credentials";
import {
  locations,
  readTenant,
  withTransaction,
  type Database,
  type DeploymentEnvironment,
  type Transaction,
} from "@waitron/db";
import type { FiscalDutyLog } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { aeatEndpointFor, isCertKind, mtlsFetch, type CertKind } from "./aeat-transport.js";
import { checkWithAuthority, type CheckTransport } from "./certificate-check.js";
import { localDate } from "./certificate-dates.js";
import {
  CERTIFICATE_MAX_BYTES,
  normaliseTaxId,
  openCertificateFile,
  type CertificateDetails,
} from "./certificate-file.js";
import { latestInstall, recordInstall } from "./certificate-record.js";
import { isBase64 } from "./provisioning-secret.js";
import "./errors.js";

export const CERTIFICATE_REFUSAL_REASONS = [
  "too_large",
  "unreadable",
  "old_encryption",
  "no_private_key",
  "passphrase_wrong",
  "expired",
  "not_yet_valid",
  "same",
  "other_taxpayer",
  "unreachable",
  "closed",
  "aeat_fault",
  "aeat_http",
  "check_failed",
] as const;

type RefusalReason = (typeof CERTIFICATE_REFUSAL_REASONS)[number];

export interface InstallAnswer {
  outcome: "installed" | "refused";
  reason: "installed" | RefusalReason;
  field?: "file" | "passphrase";
  details?: Record<string, string | number>;
}

export interface InstallDeps {
  db: Database;
  ring: KeyRing;
  nodeId: string;
  locationId: string;
  environment: DeploymentEnvironment;
  authorize(tx: Transaction): Promise<{ personId: string }>;
  log?: FiscalDutyLog;
  transport?: CheckTransport;
  checkTimeoutMs?: number;
}

interface InstallBody {
  pfxBase64: string;
  passphrase: string;
  certKind: CertKind;
  expectedRevision: string | null;
}

function invalid(field: string): AppError {
  return new AppError("fiscal.certificate_request_invalid", { field });
}

function parseBody(raw: unknown): InstallBody {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalid("body");
  const body = raw as Record<string, unknown>;
  const { pfxBase64, passphrase, certKind, expectedRevision } = body;
  if (typeof pfxBase64 !== "string" || !isBase64(pfxBase64)) throw invalid("pfxBase64");
  if (typeof passphrase !== "string" || passphrase.length === 0) throw invalid("passphrase");
  if (typeof certKind !== "string" || !isCertKind(certKind)) throw invalid("certKind");
  if (expectedRevision !== null && typeof expectedRevision !== "string") {
    throw invalid("expectedRevision");
  }
  return { pfxBase64, passphrase, certKind, expectedRevision };
}

/** The location's IANA zone, or "UTC" when the location is missing or its zone is unknown. */
export async function venueTimeZone(tx: Transaction, locationId: string): Promise<string> {
  const [location] = await tx
    .select({ timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, locationId));
  if (location === undefined) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: location.timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return "UTC";
  }
}

type Local = { ok: true; details: CertificateDetails } | { ok: false; answer: InstallAnswer };

function refused(
  reason: RefusalReason,
  field?: "file" | "passphrase",
  details?: Record<string, string | number>,
): { ok: false; answer: InstallAnswer } {
  return {
    ok: false,
    answer: {
      outcome: "refused",
      reason,
      ...(field === undefined ? {} : { field }),
      ...(details === undefined ? {} : { details }),
    },
  };
}

function checkLocally(
  body: InstallBody,
  read: { taxId: string; timeZone: string; installedFingerprint: string | null },
  now: Date,
): Local {
  const pfx = Buffer.from(body.pfxBase64, "base64");
  if (pfx.length > CERTIFICATE_MAX_BYTES) return refused("too_large", "file");
  const opened = openCertificateFile(pfx, body.passphrase);
  if (!opened.ok) {
    return refused(opened.reason, opened.reason === "passphrase_wrong" ? "passphrase" : "file");
  }
  const { details } = opened;
  // The same boundary as `certificateStage`: expired at the exact end instant.
  if (now.getTime() >= details.validUntil.getTime()) {
    return refused("expired", "file", { date: localDate(details.validUntil, read.timeZone) });
  }
  if (now.getTime() < details.validFrom.getTime()) {
    return refused("not_yet_valid", "file", { date: localDate(details.validFrom, read.timeZone) });
  }
  if (details.fingerprint === read.installedFingerprint) return refused("same", "file");
  const taxpayerNif = normaliseTaxId(read.taxId);
  if (details.taxId !== null && details.taxId !== taxpayerNif) {
    return refused("other_taxpayer", "file", { nif: details.taxId, taxpayerNif });
  }
  return { ok: true, details };
}

/**
 * Installs a replacement AEAT certificate once every local check and AEAT's own answer pass. The
 * answer is the request's normal result; only a malformed body, a refused authorisation or a vault
 * changed since the card was read throw.
 */
export async function installCertificate(
  deps: InstallDeps,
  rawBody: unknown,
  now: Date,
): Promise<InstallAnswer> {
  const body = parseBody(rawBody);
  const refuse = (answer: InstallAnswer): InstallAnswer => {
    deps.log?.("info", "fiscal.certificate_refused", {
      reason: answer.reason,
      ...(answer.field === undefined ? {} : { field: answer.field }),
    });
    return answer;
  };

  // Decision 18 (A795 plan): one logical change split across two transactions on purpose, so no
  // transaction is open while AEAT answers (up to 30 seconds) and sales go on meanwhile
  // (./certificate-install.concurrency.test.ts records one). One read transaction authorises and
  // reads what the checks need; the checks and the live check run with none; one short write
  // transaction authorises again, since a session may have ended meanwhile, and refuses if the
  // vault changed after the card was read.
  const read = await withTransaction(deps.db, async (tx) => {
    await deps.authorize(tx);
    const tenant = await readTenant(tx);
    if (tenant === null) {
      throw new Error("tenants is empty: there is no taxpayer to check a certificate against");
    }
    const timeZone = await venueTimeZone(tx, deps.locationId);
    const latest = await latestInstall(tx, deps.nodeId);
    return { tenant, timeZone, installedFingerprint: latest?.fingerprint ?? null };
  });

  const local = checkLocally(
    body,
    {
      taxId: read.tenant.taxId,
      timeZone: read.timeZone,
      installedFingerprint: read.installedFingerprint,
    },
    now,
  );
  if (!local.ok) return refuse(local.answer);
  const { details } = local;

  const checked = await checkWithAuthority({
    material: {
      pfx: Buffer.from(body.pfxBase64, "base64"),
      passphrase: body.passphrase,
      certKind: body.certKind,
    },
    taxpayer: { legalName: read.tenant.legalName, taxId: read.tenant.taxId },
    timeZone: read.timeZone,
    now,
    transport: deps.transport ?? {
      endpointFor: aeatEndpointFor(deps.environment),
      fetchFor: mtlsFetch,
    },
    ...(deps.checkTimeoutMs === undefined ? {} : { timeoutMs: deps.checkTimeoutMs }),
  });
  if (!checked.ok) {
    return refuse({
      outcome: "refused",
      reason: checked.reason,
      ...("details" in checked ? { details: checked.details } : {}),
    });
  }

  await withTransaction(deps.db, async (tx) => {
    const { personId } = await deps.authorize(tx);
    const current = await credentialRevision(tx, { purpose: "fiscal.aeat" });
    if (current !== body.expectedRevision) throw new AppError("fiscal.certificate_changed", {});
    await putCredential(tx, deps.ring, {
      purpose: "fiscal.aeat",
      value: { pfxBase64: body.pfxBase64, passphrase: body.passphrase, certKind: body.certKind },
    });
    // `latestInstall` orders by `installed_at` alone, so a clock stepped back must not sort this
    // install below the one it replaces.
    const latest = await latestInstall(tx, deps.nodeId);
    const floor = latest === null ? now.getTime() : latest.installedAt.getTime() + 1;
    await recordInstall(tx, {
      nodeId: deps.nodeId,
      installedAt: new Date(Math.max(now.getTime(), floor)),
      source: "dashboard",
      personId,
      kind: body.certKind,
      fingerprint: details.fingerprint,
      organisation: details.organisation,
      taxId: details.taxId,
      issuer: details.issuer,
      validFrom: details.validFrom,
      validUntil: details.validUntil,
      checkedEndpoint: checked.endpoint,
      checkedAt: now,
    });
  });

  deps.log?.("info", "fiscal.certificate_installed", {
    fingerprint: details.fingerprint,
    validFrom: details.validFrom.toISOString(),
    validUntil: details.validUntil.toISOString(),
    endpoint: checked.endpoint,
  });
  return { outcome: "installed", reason: "installed", details: { checkedAt: now.toISOString() } };
}
