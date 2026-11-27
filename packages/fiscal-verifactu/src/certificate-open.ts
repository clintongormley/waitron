import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RewrittenResult } from "./certificate-open-answer.js";
import type { CertificateDetails } from "./certificate-file.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

const unreadable = { ok: false, reason: "unreadable" } as const;
const unavailable = { ok: false, reason: "unavailable" } as const;

export function certificateSizeRefusal(
  pfx: Buffer,
  passphrase: string,
): { ok: false; reason: "too_large" | "unreadable" } | undefined {
  if (pfx.length > CERTIFICATE_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (Buffer.byteLength(openerInput(pfx, passphrase, false)) > 256 * 1024) return unreadable;
  return undefined;
}

function openerInput(pfx: Buffer, passphrase: string, rewriteOld: boolean): string {
  return JSON.stringify({ pfx: pfx.toString("base64"), passphrase, rewriteOld });
}

// The details, plus a rewritten file's base64.
const OUTPUT_MAX_BYTES = 8192 + Math.ceil(CERTIFICATE_MAX_BYTES / 3) * 4;

/**
 * With `rewriteOld`, a file Node cannot open but node-forge can (old encryption, or a file macOS's
 * `security` command exported under a passphrase outside ASCII) comes back rewritten with AES-256
 * under the same passphrase, as `rewritten`; store those bytes, not the original, so every later
 * reader opens it with plain Node.
 */
export async function openCertificate(
  pfx: Buffer,
  passphrase: string,
  options: { rewriteOld?: boolean } = {},
): Promise<RewrittenResult | { ok: false; reason: "too_large" | "unavailable" }> {
  const refused = certificateSizeRefusal(pfx, passphrase);
  if (refused !== undefined) return refused;
  const input = openerInput(pfx, passphrase, options.rewriteOld === true);
  const source = import.meta.url.endsWith(".ts");
  const entry = new URL(
    source ? "./certificate-open-entry.ts" : "./certificate-open.js",
    import.meta.url,
  );
  return new Promise<RewrittenResult | typeof unavailable>((resolve) => {
    const child = spawn(
      process.execPath,
      [...(source ? ["--import", import.meta.resolve("tsx")] : []), fileURLToPath(entry)],
      {
        stdio: ["pipe", "pipe", "ignore"],
        env: { PATH: process.env.PATH, LANG: process.env.LANG, TZ: process.env.TZ },
      },
    );
    let output = "";
    let refused = false;
    const stop = () => {
      refused = true;
      child.kill("SIGKILL");
    };
    const deadline = setTimeout(stop, 2_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > OUTPUT_MAX_BYTES) stop();
      else output += chunk;
    });
    child.stdin.on("error", stop);
    child.on("error", () => {
      refused = true;
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (refused || code !== 0) return resolve(unavailable);
      try {
        const result = JSON.parse(output) as
          | Exclude<RewrittenResult, { ok: true }>
          | { ok: true; details: CertificateDetails; rewritten?: string };
        if (!result.ok) return resolve(result);
        const { details, rewritten } = result;
        details.validFrom = new Date(details.validFrom);
        details.validUntil = new Date(details.validUntil);
        resolve(
          rewritten === undefined
            ? { ok: true, details }
            : { ok: true, details, rewritten: Buffer.from(rewritten, "base64") },
        );
      } catch {
        resolve(unavailable);
      }
    });
    child.stdin.end(input);
  }).catch(() => unavailable);
}
