import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Duplex } from "node:stream";
import type { FiscalCertificateJson } from "@waitron/fiscal";

export const DIAGNOSIS_INPUT_BYTES = 200_000;
export const DIAGNOSIS_ENVELOPE_BYTES = 208_192;
export const DIAGNOSIS_OUTPUT_BYTES = 16 * 1024;
export const DIAGNOSIS_PROGRESS_BYTES = 1024;

export function certificateDiagnosisRuntime(): { entry: URL; execArgv: readonly string[] } {
  const built = new URL("./fiscal-certificate-diagnosis.js", import.meta.url);
  if (existsSync(built)) return { entry: built, execArgv: [] };
  return {
    entry: new URL("./fiscal-certificate-diagnosis-entry.ts", import.meta.url),
    execArgv: ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href],
  };
}

export function diagnosisRecord(
  value: unknown,
): value is { readonly [key: string]: FiscalCertificateJson } {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && diagnosisJson(value)
  );
}

export function diagnosisJson(value: unknown, depth = 0): value is FiscalCertificateJson {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => diagnosisJson(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (field) => "value" in field && diagnosisJson(field.value, depth + 1),
  );
}

export function diagnosisFrame(value: unknown, limit: number): string | null {
  if (!diagnosisJson(value)) return null;
  const frame = JSON.stringify(value) + "\n";
  return Buffer.byteLength(frame) <= limit ? frame : null;
}

export function readDiagnosisFrames(
  stream: Duplex,
  limit: number,
  receive: (message: unknown, bytes: number) => void,
  invalid: () => void,
): () => void {
  let pending = Buffer.alloc(0);
  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    pending = Buffer.alloc(0);
    invalid();
  };
  const data = (chunk: Buffer) => {
    if (failed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const next = end === -1 ? chunk.length : end + 1;
      if (pending.length + next - offset > limit) return fail();
      pending = Buffer.concat([pending, chunk.subarray(offset, next)]);
      offset = next;
      if (end !== -1) {
        let message: unknown;
        try {
          message = JSON.parse(pending.toString("utf8"));
        } catch {
          return fail();
        }
        const bytes = pending.length;
        pending = Buffer.alloc(0);
        receive(message, bytes);
        if (failed) return;
      }
    }
  };
  stream.on("data", data);
  stream.on("error", fail);
  return () => {
    pending = Buffer.alloc(0);
    stream.removeListener("data", data);
    stream.removeListener("error", fail);
  };
}
