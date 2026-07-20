import { parseRespuestaConsulta, type RespuestaConsulta } from "./xml/parse-consulta.js";
import { parseRespuestaSuministro, type RespuestaSuministro } from "./xml/parse-suministro.js";
import {
  serializeConsulta,
  serializeEnvio,
  type Cabecera,
  type ConsultaFiltro,
  type EnvioRegistro,
} from "./xml/serialize.js";

export interface ClientOptions {
  endpoint: string;
  /**
   * Injected so the library is runtime-agnostic and testable without a
   * network. Client-certificate material is supplied by the caller's fetch
   * implementation — in Node that means an Agent/Dispatcher configured with
   * the cert and key. Keeping mTLS configuration outside this library is
   * deliberate: certificate handling is a deployment concern, and the spec
   * requires the submitter to be an interface rather than a location.
   */
  fetch: typeof globalThis.fetch;
}

export interface VerifactuClient {
  submit(cabecera: Cabecera, registros: EnvioRegistro[]): Promise<RespuestaSuministro>;
  consultar(cabecera: Cabecera, filtro: ConsultaFiltro): Promise<RespuestaConsulta>;
}

async function post(options: ClientOptions, xml: string): Promise<string> {
  const response = await options.fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      // The WSDL declares soapAction="" on every operation; dispatch is by
      // message body, not by this header.
      SOAPAction: '""',
    },
    body: xml,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AEAT request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

export function createClient(options: ClientOptions): VerifactuClient {
  return {
    async submit(cabecera, registros) {
      return parseRespuestaSuministro(await post(options, serializeEnvio(cabecera, registros)));
    },
    async consultar(cabecera, filtro) {
      return parseRespuestaConsulta(await post(options, serializeConsulta(cabecera, filtro)));
    },
  };
}
