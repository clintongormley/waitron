import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { OpenResult } from "./certificate-file.js";
import { CERTIFICATE_MAX_BYTES } from "./certificate-limits.js";

const unreadable: OpenResult = { ok: false, reason: "unreadable" };

export async function openCertificate(
  pfx: Buffer,
  passphrase: string,
): Promise<OpenResult | { ok: false; reason: "too_large" }> {
  if (pfx.length > CERTIFICATE_MAX_BYTES) return { ok: false, reason: "too_large" };
  const input = JSON.stringify({ pfx: pfx.toString("base64"), passphrase });
  if (Buffer.byteLength(input) > 256 * 1024) return unreadable;
  const source = import.meta.url.endsWith(".ts");
  const entry = new URL(
    source ? "./certificate-open-entry.ts" : "./certificate-open.js",
    import.meta.url,
  );
  return new Promise((resolve) => {
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
      if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > 8192) stop();
      else output += chunk;
    });
    child.stdin.on("error", stop);
    child.on("error", () => {
      refused = true;
    });
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (refused || code !== 0) return resolve(unreadable);
      try {
        const result = JSON.parse(output) as OpenResult;
        if (result.ok) {
          result.details.validFrom = new Date(result.details.validFrom);
          result.details.validUntil = new Date(result.details.validUntil);
        }
        resolve(result);
      } catch {
        resolve(unreadable);
      }
    });
    child.stdin.end(input);
  });
}
