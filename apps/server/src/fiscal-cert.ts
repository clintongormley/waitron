// The generic cert-distribution core: store the AEAT certificate DORMANT (wrapped under a
// break-glass secret so a disk/dump/snapshot alone never opens it), unwrap it, seal the live copy a
// promoted primary files with, delete a corrupt dormant copy, and read the cert status. The
// break-glass envelope keeps the standby's cert unreadable at rest; only a human-held secret unwraps
// it at promotion (secret-envelope.ts, `fiscal.aeat.dormant`).
import { and, eq } from "drizzle-orm";
import { tenantId as brandTenantId } from "@waitron/shared";
import {
  deleteCredential,
  putCredential,
  tenantCredentials,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import type { Transaction } from "@waitron/db";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "./secret-envelope.js";

export interface AeatCertMaterial {
  pfxBase64: string;
  passphrase: string;
  certKind: string;
}

/** Wraps the cert under `breakGlass` and seals it as the dormant vault row. */
export async function storeDormantCert(
  tx: Transaction,
  ring: KeyRing,
  tenantId: string,
  cert: AeatCertMaterial,
  breakGlass: string,
): Promise<void> {
  const envelope = encryptSecretEnvelope(JSON.stringify(cert), breakGlass);
  await putCredential(tx, ring, {
    tenantId: brandTenantId(tenantId),
    purpose: "fiscal.aeat.dormant",
    value: { envelope },
  });
}

/**
 * Reads the dormant row and opens it with `breakGlass`. `"absent"` when there is no row; `"corrupt"`
 * when the envelope will not open (wrong secret or tampered) or the plaintext is not an
 * `AeatCertMaterial` — never a throw, so a caller distinguishes "no standby cert" from "held one that
 * this secret cannot open" and reports both rather than crashing.
 */
export async function unwrapDormantCert(
  tx: Transaction,
  ring: KeyRing,
  tenantId: string,
  breakGlass: string,
): Promise<AeatCertMaterial | "absent" | "corrupt"> {
  const row = await tryGetCredential(tx, ring, {
    tenantId: brandTenantId(tenantId),
    purpose: "fiscal.aeat.dormant",
  });
  if (row === null) return "absent";
  let plaintext: string;
  try {
    plaintext = decryptSecretEnvelope(row.envelope, breakGlass);
  } catch {
    return "corrupt";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return "corrupt";
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as AeatCertMaterial).pfxBase64 !== "string" ||
    typeof (parsed as AeatCertMaterial).passphrase !== "string" ||
    typeof (parsed as AeatCertMaterial).certKind !== "string"
  ) {
    return "corrupt";
  }
  const c = parsed as AeatCertMaterial;
  return { pfxBase64: c.pfxBase64, passphrase: c.passphrase, certKind: c.certKind };
}

/** Seals the live `fiscal.aeat` cert the drain files with. The value round-trips from a validated
 * cert, so `putCredential`'s field check is sufficient. */
export async function sealLiveCertTx(
  tx: Transaction,
  ring: KeyRing,
  tenantId: string,
  cert: AeatCertMaterial,
): Promise<void> {
  await putCredential(tx, ring, {
    tenantId: brandTenantId(tenantId),
    purpose: "fiscal.aeat",
    value: { ...cert },
  });
}

/** Removes the dormant row — after sealing the live copy, or to clear a corrupt one. */
export async function deleteDormantCert(tx: Transaction, tenantId: string): Promise<void> {
  await deleteCredential(tx, {
    tenantId: brandTenantId(tenantId),
    purpose: "fiscal.aeat.dormant",
  });
}

/**
 * An EXISTENCE check on the two purposes — never `getCredential`/`tryGetCredential`, which decrypt
 * and throw on an undecryptable row (a dormant row NEVER opens under the credentials ring; it opens
 * only under the break-glass secret). Selects just the `purpose` column: a live row wins over a
 * dormant one, else `"none"`.
 */
export async function readCertStatus(
  tx: Transaction,
  tenantId: string,
): Promise<"live" | "dormant" | "none"> {
  const rows = await tx
    .select({ purpose: tenantCredentials.purpose })
    .from(tenantCredentials)
    .where(and(eq(tenantCredentials.tenantId, brandTenantId(tenantId))));
  const purposes = new Set(rows.map((r) => r.purpose));
  if (purposes.has("fiscal.aeat")) return "live";
  if (purposes.has("fiscal.aeat.dormant")) return "dormant";
  return "none";
}
