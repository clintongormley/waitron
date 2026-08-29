import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";

/** When the served TLS leaf expires. `daysRemaining` is floored whole days and may be negative for an
 * already-expired cert — the caller decides the warn threshold. */
export type CertExpiry = { notAfter: string; daysRemaining: number };

const MS_PER_DAY = 86_400_000;

export async function readCertExpiry(pemPath: string, now: Date): Promise<CertExpiry> {
  const pem = await readFile(pemPath, "utf8");
  const cert = new X509Certificate(pem);
  const notAfter = new Date(cert.validTo); // X509 `validTo` is a parseable date string
  return {
    notAfter: notAfter.toISOString(),
    daysRemaining: Math.floor((notAfter.getTime() - now.getTime()) / MS_PER_DAY),
  };
}
