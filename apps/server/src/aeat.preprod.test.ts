import { describe, expect, it } from "vitest";
import { SOAP_ENDPOINTS, createClient } from "@waitron/verifactu";
import { mtlsFetch } from "./aeat-transport.js";

// Supplied by the operator at run time, never committed and never defaulted. Absent means the
// suite has nothing to prove, so it skips rather than inventing material.
const pfxBase64 = process.env.WAITRON_PREPROD_PFX_BASE64;
const passphrase = process.env.WAITRON_PREPROD_PFX_PASSPHRASE;
const nif = process.env.WAITRON_PREPROD_NIF;
const nombre = process.env.WAITRON_PREPROD_NOMBRE;

const configured =
  pfxBase64 !== undefined && passphrase !== undefined && nif !== undefined && nombre !== undefined;

describe.runIf(configured)("AEAT pre-production, real certificate", () => {
  it("completes an mTLS handshake and answers a consulta", async () => {
    const transport = mtlsFetch({
      pfx: Buffer.from(pfxBase64!, "base64"),
      passphrase: passphrase!,
      certKind: "representante",
    });
    const client = createClient({
      endpoint: SOAP_ENDPOINTS.preproduction,
      fetch: transport.fetch,
    });

    // `consultar`, never `submit`: a query files nothing. This proves the certificate, the TLS
    // chain, the endpoint, the SOAP envelope and the response parser — everything except the act
    // of filing — and it is safe to run repeatedly.
    const respuesta = await client.consultar(
      { ObligadoEmision: { NombreRazon: nombre!, NIF: nif! } },
      { Ejercicio: "2026", Periodo: "07" },
    );

    // Deliberately weak: ANY parsed response means the whole chain worked. An empty result is a
    // success — this obligado has filed nothing yet, which is exactly the expected state.
    expect(respuesta).toBeDefined();
    console.log("AEAT consulta response:", JSON.stringify(respuesta, null, 2));
  });
});
