import { createHash } from "node:crypto";
import type { ReceiptTrust } from "./cloud-evidence.js";
import type { PaperCustodianTrust } from "./paper-evidence.js";

// Only release-reviewed public roots belong here; captured files cannot enrol their own signer.
export const FISCAL_BACKUP_PUBLIC_TRUST: {
  readonly cloud: ReceiptTrust | null;
  readonly paper: readonly PaperCustodianTrust[];
} = Object.freeze({ cloud: null, paper: Object.freeze([]) });

export function fiscalBackupPublicEvidenceDigest(trust = FISCAL_BACKUP_PUBLIC_TRUST): string {
  const { cloud, paper } = trust;
  const order = (a: readonly string[], b: readonly string[]) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  return createHash("sha256")
    .update(
      JSON.stringify([
        cloud === null ? null : [cloud.issuer, [...cloud.keys.entries()].sort(order)],
        paper.map((p) => [p.custodianId, p.publicKey, p.fingerprint]).sort(order),
      ]),
    )
    .digest("hex");
}
