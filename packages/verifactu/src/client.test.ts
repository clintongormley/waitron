import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { buildAltaRecord } from "./records.js";
import { ALTA_INPUT, CABECERA } from "../test/fixtures.js";
import type { EnvioRegistro } from "./xml/serialize.js";

// serializeEnvio throws on an empty batch (a deliberate check pinned by its
// own tests), so the transport tests below exercise submit() with a single
// real record rather than an empty array.
const record = buildAltaRecord(ALTA_INPUT);

const REGISTROS: EnvioRegistro[] = [{ RegistroAlta: record }];

const OK = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <RespuestaRegFactuSistemaFacturacion>
      <EstadoEnvio>Correcto</EstadoEnvio><TiempoEsperaEnvio>60</TiempoEsperaEnvio>
    </RespuestaRegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

const CONSULTA_OK = `<?xml version="1.0"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
    <RespuestaConsultaFactuSistemaFacturacion>
      <ResultadoConsulta>SinDatos</ResultadoConsulta>
      <IndicadorPaginacion>N</IndicadorPaginacion>
    </RespuestaConsultaFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

function fakeFetch(body: string, init: { status?: number } = {}) {
  return vi.fn<typeof globalThis.fetch>(
    async () => new Response(body, { status: init.status ?? 200 }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createClient", () => {
  it("posts to the configured endpoint", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
  });

  it("sends an empty SOAPAction header", async () => {
    // The WSDL declares soapAction="" for every operation; dispatch is by
    // message body. Sending an operation name here is a guess, not a contract.
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["SOAPAction"]).toBe('""');
  });

  it("sends the XML as the request body with a SOAP content type", async () => {
    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("text/xml");
    expect(String(init.body)).toContain("RegFactuSistemaFacturacion");
    // Pins that the body is the *serialised registros*, not a hardcoded
    // stub: the record's own huella can only be present here if the array
    // passed to submit() was actually threaded through to serializeEnvio.
    expect(String(init.body)).toContain(record.Huella);
  });

  it("returns the parsed response", async () => {
    const client = createClient({ endpoint: "https://example.test/soap", fetch: fakeFetch(OK) });
    const response = await client.submit(CABECERA, REGISTROS);
    expect(response.EstadoEnvio).toBe("Correcto");
    expect(response.TiempoEsperaEnvio).toBe(60);
  });

  it("throws with the status code and a slice of the response body on a transport failure", async () => {
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch("upstream exploded", { status: 503 }),
    });
    await expect(client.submit(CABECERA, REGISTROS)).rejects.toThrow(/503/);
    // A second, independent assertion for the body slice: rejects.toThrow
    // only needs to match somewhere in the message, so a single combined
    // regex could pass on the status code alone and never prove the body
    // text made it into the error at all.
    await expect(client.submit(CABECERA, REGISTROS)).rejects.toThrow(/upstream exploded/);
  });

  it("truncates a long error body to 500 characters rather than embedding it whole", async () => {
    // A short body (as above) can't distinguish `text.slice(0, 500)` from
    // plain `text` — both produce the same error message. An upstream 5xx
    // page can be arbitrarily large (an HTML error page, a stack trace), and
    // embedding it whole in an Error's message risks flooding logs/telemetry
    // with megabytes of unrelated markup. `toThrow(string)` only checks
    // containment, and the untruncated mutant's message still CONTAINS the
    // 500-character prefix — so this reads the thrown message directly and
    // compares its exact length instead.
    const longBody = "x".repeat(600);
    const client = createClient({
      endpoint: "https://example.test/soap",
      fetch: fakeFetch(longBody, { status: 500 }),
    });
    const failure = await client.submit(CABECERA, REGISTROS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `AEAT request failed with HTTP 500: ${"x".repeat(500)}`,
    );
  });

  it("uses the injected fetch rather than a global", async () => {
    // Injection is what makes the client runtime-agnostic and testable
    // without a network. Asserting only that the injected mock "was called"
    // would still pass if the implementation additionally (or instead)
    // reached for globalThis.fetch and that call happened to resolve — so
    // this stubs the global with a spy that fails identifiably and asserts
    // it is never touched, which a fallback-to-global implementation would
    // trip.
    const globalFetch = vi.fn(async () => {
      throw new Error("must not call globalThis.fetch");
    });
    vi.stubGlobal("fetch", globalFetch);

    const fetch = fakeFetch(OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const response = await client.submit(CABECERA, REGISTROS);

    expect(fetch).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(response.EstadoEnvio).toBe("Correcto");
  });

  it("posts a consulta to the same endpoint", async () => {
    const fetch = fakeFetch(CONSULTA_OK);
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    const response = await client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(response.ResultadoConsulta).toBe("SinDatos");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
    // Confirms the filtro was actually serialised into the request, not a
    // hardcoded body.
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("<sf:Ejercicio>2024</sf:Ejercicio>");
  });

  it("posts both submit and consultar to the same configured endpoint", async () => {
    // Submission and query are two operations on one URL, not two services —
    // this exercises both operations on a single client and compares the
    // URLs each call actually used, rather than checking each in isolation
    // against the option it was configured with.
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = String(init?.body);
      const responseBody = body.includes("ConsultaFactuSistemaFacturacion") ? CONSULTA_OK : OK;
      return new Response(responseBody, { status: 200 });
    });
    const client = createClient({ endpoint: "https://example.test/soap", fetch });
    await client.submit(CABECERA, REGISTROS);
    await client.consultar(CABECERA, { Ejercicio: "2024", Periodo: "01" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/soap");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://example.test/soap");
  });
});
