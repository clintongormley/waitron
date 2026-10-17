import { renderRecoveryPdf } from "./recovery-pdf.js";
import {
  parseRecoveryDocument,
  recoveryDocumentPublic,
  type RecoveryDocument,
  type RecoveryDocumentPublic,
} from "./recovery-document.js";
export type RecoveryDeliveryBinding = {
  statement: RecoveryDocumentPublic;
  bindingDigest: string;
  documentDigest: string;
};
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
function publicBytes(value: RecoveryDocumentPublic): Uint8Array<ArrayBuffer> {
  function canonical(v: unknown): string {
    if (typeof v !== "object" || v === null) return JSON.stringify(v);
    const object = v as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(object[k])}`)
      .join(",")}}`;
  }
  return new TextEncoder().encode(canonical(value));
}
export function createRecoveryDelivery<T>(
  document: RecoveryDocument,
  locale: "en" | "es",
  confirmKept: (binding: RecoveryDeliveryBinding) => Promise<T>,
) {
  let disposed = false;
  let input: RecoveryDocument | undefined = structuredClone(document);
  let prepared: Promise<RecoveryDeliveryBinding> | undefined;
  let url: string | undefined;
  const active = () => {
    if (disposed) throw new Error("Recovery delivery disposed");
  };
  async function prepare(): Promise<RecoveryDeliveryBinding> {
    const parsed = await parseRecoveryDocument(input);
    input = undefined;
    active();
    const bytes = await renderRecoveryPdf(parsed, locale);
    active();
    const statement = recoveryDocumentPublic(parsed);
    const binding = {
      statement,
      bindingDigest: await digest(publicBytes(statement)),
      documentDigest: await digest(bytes),
    };
    active();
    url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    return binding;
  }
  const ready = async () => {
    active();
    prepared ??= prepare();
    const binding = await prepared;
    active();
    return structuredClone(binding);
  };
  const output = async () => {
    await ready();
    active();
    return url!;
  };
  return {
    ready,
    download: output,
    print: output,
    async kept(): Promise<T> {
      const binding = await ready();
      active();
      const grant = await confirmKept(binding);
      active();
      return grant;
    },
    dispose() {
      disposed = true;
      input = undefined;
      prepared = undefined;
      if (url) URL.revokeObjectURL(url);
      url = undefined;
    },
  };
}
