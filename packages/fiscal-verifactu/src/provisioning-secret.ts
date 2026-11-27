import { putCredential, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { isCertKind, type CertKind } from "./aeat-transport.js";
import { normaliseTaxId } from "./certificate-file.js";
import { openCertificate } from "./certificate-open.js";
import { installsOf } from "./certificate-record.js";
import "./errors.js";

export interface AeatCert {
  /** The PFX/PKCS#12 certificate bundle, base64-encoded. Opaque to the vault. */
  pfxBase64: string;
  /** The passphrase protecting the PFX. */
  passphrase: string;
  certKind: CertKind;
}

// Canonical, padded base64. `Buffer.from(x, "base64")` cannot stand in for this: it silently drops
// non-alphabet bytes, so a bogus blob would seal cleanly and fail only at AEAT-submit time. The
// pattern also matches the empty string, hence the length check beside it.
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function isBase64(value: string): boolean {
  return value.length > 0 && BASE64_RE.test(value);
}

/** Throws `setup.request_invalid` naming the offending field, NEVER its value. */
export function validateAeatCert(cert: { pfxBase64: string; passphrase: string }): void {
  if (!isBase64(cert.pfxBase64)) {
    throw new AppError("setup.request_invalid", { field: "pfxBase64" });
  }
  if (cert.passphrase.length === 0) {
    throw new AppError("setup.request_invalid", { field: "passphrase" });
  }
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("setup.request_invalid", { field });
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("setup.request_invalid", { field });
  }
  return value;
}

/** The file and passphrase a request carries; any other key, a type included, is ignored. */
function parseAeatCertRequest(raw: unknown): Omit<AeatCert, "certKind"> {
  const cert = asObject(raw, "aeatCert");
  const parsed = {
    pfxBase64: asString(cert.pfxBase64, "pfxBase64"),
    passphrase: asString(cert.passphrase, "passphrase"),
  };
  validateAeatCert(parsed);
  return parsed;
}

/** The checked secret `validateSetupAeatCert` answers, read back where the host hands it on. */
export function parseAeatCert(raw: unknown): AeatCert {
  const parsed = parseAeatCertRequest(raw);
  const certKind = asObject(raw, "aeatCert").certKind;
  if (typeof certKind !== "string" || !isCertKind(certKind)) {
    throw new AppError("setup.request_invalid", { field: "certKind" });
  }
  return { ...parsed, certKind };
}

async function openSetupAeatCert(raw: unknown) {
  const cert = parseAeatCertRequest(raw);
  const opened = await openCertificate(Buffer.from(cert.pfxBase64, "base64"), cert.passphrase, {
    rewriteOld: true,
  });
  const refuse = (reason: string, field = "pfxBase64"): never => {
    throw new AppError("setup.certificate_refused", { field, reason });
  };
  if (!opened.ok) {
    return refuse(
      opened.reason,
      opened.reason === "unavailable"
        ? "body"
        : opened.reason === "passphrase_wrong"
          ? "passphrase"
          : "pfxBase64",
    );
  }
  const now = Date.now();
  if (now >= opened.details.validUntil.getTime()) refuse("expired");
  if (now < opened.details.validFrom.getTime()) refuse("not_yet_valid");
  return { cert, details: opened.details };
}

export async function inspectSetupAeatCert(raw: unknown) {
  const { details } = await openSetupAeatCert(raw);
  return { taxId: details.taxId, legalName: details.organisation };
}

/**
 * The provision doors' check, run before anything is minted. Answers the secret the host carries
 * on to the readiness test and `sealAeatSecret`: the request's file and passphrase, and the type
 * the file's policies name.
 */
export async function validateSetupAeatCert(
  raw: unknown,
  venue: { taxId: string },
): Promise<AeatCert> {
  const { cert, details } = await openSetupAeatCert(raw);
  const certificateTaxId = details.taxId;
  if (certificateTaxId !== null && certificateTaxId !== normaliseTaxId(venue.taxId)) {
    throw new AppError("setup.certificate_refused", {
      field: "pfxBase64",
      reason: "other_taxpayer",
      certificateTaxId,
      taxId: venue.taxId,
    });
  }
  return { ...cert, certKind: details.kind };
}

/**
 * Seal a venue's AEAT certificate into the `fiscal.aeat` vault purpose. `raw` is the checked
 * secret `validateSetupAeatCert` answered; a file that opens is sealed with the type its policies
 * name. Re-checks the blob's shape, because `putCredential` accepts any non-empty `certKind` and
 * `pfxBase64`. A file the opener rewrites (old encryption, or a file macOS's `security` command
 * exported under a passphrase outside ASCII) is sealed rewritten, because the backup verifier and
 * filing open the vault copy with plain Node.
 */
export async function sealAeatSecret(
  deps: { db: Database; ring: KeyRing; nodeId: string; now?: () => Date },
  raw: unknown,
): Promise<void> {
  const cert = parseAeatCert(raw);
  const opened = await openCertificate(Buffer.from(cert.pfxBase64, "base64"), cert.passphrase, {
    rewriteOld: true,
  });
  if (!opened.ok && opened.reason === "unavailable")
    throw new AppError("setup.certificate_refused", { field: "body", reason: "setup_stopped" });
  const certKind = opened.ok ? opened.details.kind : cert.certKind;

  await withTransaction(deps.db, async (tx) => {
    await putCredential(tx, deps.ring, {
      personId: null,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: (opened.ok && opened.rewritten?.toString("base64")) || cert.pfxBase64,
        passphrase: cert.passphrase,
        certKind,
      },
    });
    if (!opened.ok) return;
    const { details } = opened;
    const installs = await installsOf(tx, deps.nodeId);
    if (installs.latest?.fingerprint === details.fingerprint) return;
    await installs.record({
      installedAt: (deps.now ?? (() => new Date()))(),
      source: "setup",
      personId: null,
      kind: certKind,
      fingerprint: details.fingerprint,
      organisation: details.organisation,
      taxId: details.taxId,
      issuer: details.issuer,
      validFrom: details.validFrom,
      validUntil: details.validUntil,
    });
  });
}
