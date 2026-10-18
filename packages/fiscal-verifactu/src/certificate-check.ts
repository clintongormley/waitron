import { createClient, VerifactuTransportError } from "@waitron/verifactu";
import { firstCodeInCauseChain } from "@waitron/shared";
import type { CertKind, CertMaterial, TenantTransport } from "./aeat-transport.js";
import { localDate } from "./certificate-dates.js";

export type CheckRefusal =
  | { reason: "unreachable" }
  | { reason: "closed" }
  | { reason: "aeat_fault"; details: { faultCode: string; faultReason: string } }
  | { reason: "aeat_http"; details: { status: number } }
  | { reason: "check_failed" };

export interface CheckTransport {
  endpointFor(kind: CertKind): string;
  fetchFor(material: CertMaterial): TenantTransport;
}

export type CheckResult = { ok: true; endpoint: string } | ({ ok: false } & CheckRefusal);

const UNREACHABLE_CODES = new Set(["ENOTFOUND", "ECONNREFUSED"]);
// Measured in the A795 design (P3b): a refused client certificate surfaces as `UND_ERR_SOCKET`
// over TLS 1.3 and `ECONNRESET` over TLS 1.2.
const CLOSED_CODES = new Set(["UND_ERR_SOCKET", "ECONNRESET"]);

function classify(error: unknown, timedOut: boolean): CheckRefusal {
  if (!(error instanceof VerifactuTransportError)) return { reason: "check_failed" };
  if (error.kind === "soap") {
    return {
      reason: "aeat_fault",
      details: { faultCode: error.faultCode ?? "", faultReason: error.faultReason ?? "" },
    };
  }
  if (error.kind === "http") return { reason: "aeat_http", details: { status: error.status! } };
  if (timedOut) return { reason: "unreachable" };
  const code = firstCodeInCauseChain(
    error,
    (candidate) => UNREACHABLE_CODES.has(candidate) || CLOSED_CODES.has(candidate),
  );
  if (code !== null && UNREACHABLE_CODES.has(code)) return { reason: "unreachable" };
  if (code !== null) return { reason: "closed" };
  return { reason: "check_failed" };
}

/** A read-only question to AEAT with a certificate that has not been installed. */
export async function checkWithAuthority(input: {
  material: CertMaterial;
  taxpayer: { legalName: string; taxId: string };
  timeZone: string;
  now: Date;
  transport: CheckTransport;
  timeoutMs?: number;
}): Promise<CheckResult> {
  const endpoint = input.transport.endpointFor(input.material.certKind);
  const transport = input.transport.fetchFor(input.material);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs ?? 30_000);
  const fetch = ((request, init) =>
    transport.fetch(request, { ...init, signal: controller.signal })) as typeof globalThis.fetch;
  const [year, month] = localDate(input.now, input.timeZone).split("-");
  try {
    await createClient({ endpoint, fetch }).consultar(
      { ObligadoEmision: { NombreRazon: input.taxpayer.legalName, NIF: input.taxpayer.taxId } },
      { Ejercicio: year!, Periodo: month! },
    );
    return { ok: true, endpoint };
  } catch (error) {
    return { ok: false, ...classify(error, timedOut) };
  } finally {
    clearTimeout(timer);
    await transport.close().catch(() => undefined);
  }
}
