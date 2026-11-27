import {
  openCertificateFile,
  type CertificateDetails,
  type OpenResult,
} from "./certificate-file.js";

export type RewrittenResult =
  { ok: true; details: CertificateDetails; rewritten?: Buffer } | Exclude<OpenResult, { ok: true }>;

/**
 * macOS's export derives every key from the passphrase's UTF-8 bytes taken one character each, as
 * OpenSSL 1.0 did, so Node calls a passphrase outside ASCII wrong; forge reads that spelling.
 */
function readSpelling(reason: string, passphrase: string): string | null {
  if (reason === "old_encryption") return passphrase;
  if (reason !== "passphrase_wrong") return null;
  const spelling = Buffer.from(passphrase, "utf8").toString("latin1");
  return spelling === passphrase ? null : spelling;
}

/**
 * Opens the file; one Node refuses as old encryption, or a macOS export under a passphrase outside
 * ASCII, is opened again once rewritten under the passphrase as typed. The converter is loaded
 * only then: loading node-forge costs every other open time inside the opener's deadline.
 */
export async function openOrRewrite(pfx: Buffer, passphrase: string): Promise<RewrittenResult> {
  const opened = openCertificateFile(pfx, passphrase);
  if (opened.ok) return opened;
  const readAs = readSpelling(opened.reason, passphrase);
  if (readAs === null) return opened;
  const { rewriteOldCertificate } = await import("./certificate-convert.js");
  const rewritten = rewriteOldCertificate(pfx, passphrase, { readAs });
  if (rewritten === null) return opened;
  const again = openCertificateFile(rewritten, passphrase);
  return again.ok ? { ...again, rewritten } : opened;
}

/** The opener child's JSON answer to its JSON input. */
export async function answerOpener(input: string): Promise<string> {
  const { pfx, passphrase, rewriteOld } = JSON.parse(input) as {
    pfx: string;
    passphrase: string;
    rewriteOld: boolean;
  };
  const file = Buffer.from(pfx, "base64");
  const result: RewrittenResult = rewriteOld
    ? await openOrRewrite(file, passphrase)
    : openCertificateFile(file, passphrase);
  return JSON.stringify(
    result.ok && result.rewritten !== undefined
      ? { ...result, rewritten: result.rewritten.toString("base64") }
      : result,
  );
}
