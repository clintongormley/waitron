import { Agent, fetch as undiciFetch } from "undici";
import type { CertMaterial } from "./aeat-transport.js";
import type { CertificateDiagnosisResult } from "./certificate-diagnosis-contract.js";

export interface DiagnosticTransportObservation {
  httpStatus: number | null;
  stage: CertificateDiagnosisResult["stage"];
  category: CertificateDiagnosisResult["category"];
}

const REPLY_LIMIT = 1024 * 1024;

export function diagnosticTransport(
  material: CertMaterial,
  options: {
    endpoint: string;
    signal: AbortSignal;
    ca?: string;
    report: (observation: DiagnosticTransportObservation) => void;
  },
): {
  fetch: typeof globalThis.fetch;
  close(): Promise<void>;
  destroy(): Promise<void>;
  observation(): DiagnosticTransportObservation;
} {
  const dispatcher = new Agent({
    connect: {
      pfx: material.pfx,
      passphrase: material.passphrase,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    },
  });
  let observation: DiagnosticTransportObservation = {
    stage: "connect",
    category: "unknown",
    httpStatus: null,
  };
  function observe(value: DiagnosticTransportObservation): void {
    observation = { ...value };
    options.report({ ...value });
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const destination =
      typeof input === "string"
        ? new URL(input).href
        : input instanceof URL
          ? input.href
          : input.url;
    if (destination !== new URL(options.endpoint).href)
      throw new TypeError("Diagnostic destination mismatch");
    const signals = [options.signal];
    if (init?.signal) signals.push(init.signal);
    if (typeof input === "object" && "signal" in input) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    signal.throwIfAborted();
    const requestInit =
      typeof input === "object" && "method" in input
        ? {
            method: input.method,
            headers: input.headers,
            body: input.body,
            duplex: "half",
            ...init,
          }
        : init;
    observe({ stage: "connect", category: "unknown", httpStatus: null });
    const response = await undiciFetch(destination, {
      ...requestInit,
      signal,
      dispatcher,
      redirect: "manual",
    } as Parameters<typeof undiciFetch>[1]);
    observe({ stage: "response", category: "http-response", httpStatus: response.status });
    const tooLarge = () => {
      observe({ stage: "response", category: "reply-too-large", httpStatus: response.status });
      return new RangeError("Diagnostic reply exceeds limit");
    };
    const declared = response.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > REPLY_LIMIT) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > REPLY_LIMIT) throw tooLarge();
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
    signal.throwIfAborted();
    observe({ stage: "parse", category: "http-response", httpStatus: response.status });
    return new Response(
      response.body === null ? null : new Uint8Array(Buffer.concat(chunks, size)),
      {
        status: response.status,
        statusText: response.statusText,
      },
    );
  };
  return {
    fetch,
    close: () => dispatcher.close(),
    destroy: () => dispatcher.destroy(),
    observation: () => ({ ...observation }),
  };
}
