# @waitron/verifactu

TypeScript implementation of Spain's Veri\*Factu invoicing records: construction, hashing,
chaining, validation, QR payloads, SOAP submission and consulta.

> **This library is a tool for building SIFs. It is not itself a SIF.**
> A _sistema informático de facturación_ is a deployed system, and its obligations —
> conservation, inalterability and accessibility of records — are properties of a deployment,
> not of source code. Each deploying business issues its own declaración responsable for its own
> installation. See [`PROVENANCE.md`](./PROVENANCE.md).

## Design

Pure and stateless. Every export is a function over plain data. There is no database, no
persistence, no ambient state and no I/O except through an injected `fetch`. Chain state,
ordering, retries and storage belong to the caller — chain append has to join the host's
transaction, which a stateful library could not do.

Types mirror AEAT's schema names exactly (`RegistroAlta`, `Encadenamiento`, `DetalleDesglose`);
functions are named in English.

## Usage

```ts
import {
  buildAltaRecord,
  buildQrPayload,
  validate,
  type SistemaInformatico,
} from "@waitron/verifactu";

const sistema: SistemaInformatico = {
  NombreRazon: "Example SL",
  NIF: "B12345678",
  NombreSistemaInformatico: "Example POS",
  IdSistemaInformatico: "01",
  Version: "1.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "N",
  IndicadorMultiplesOT: "N",
};

const record = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "T01/000123",
  FechaExpedicionFactura: new Date(),
  NombreRazonEmisor: "Example SL",
  TipoFactura: "F2",
  DescripcionOperacion: "Venta en establecimiento",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: 10,
      CuotaRepercutida: 2.1,
      TipoImpositivo: 21,
    },
  ],
  CuotaTotal: 2.1,
  ImporteTotal: 12.1,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date(),
  // The offset of the zone the invoice is ISSUED in, at the moment of issue —
  // not a fixed constant, and not the server's own zone. 120 is Spain's
  // summer (CEST) offset; during winter (CET) it is 60. Derive this from the
  // issuing location's calendar, never from the runtime environment's zone.
  offsetMinutes: 120,
});

const issues = validate(record);
const qr = buildQrPayload(record, "production");
```

A rectificativa (`R1`-`R5`) is built the same way, with `TipoRectificativa` set to say whether it
substitutes (`S`) or adjusts (`I`) the original invoice. AEAT rule 1114 makes `TipoRectificativa`
mandatory whenever `TipoFactura` is `R1`-`R5` (and rule 1115 forbids it otherwise); `FacturasRectificadas`
identifies the invoice(s) being rectified; and — because this example substitutes (`S`) rather than
adjusts — rule 1118 makes `ImporteRectificacion` (the replaced base/cuota) mandatory too:

```ts
const rectificativa = buildAltaRecord({
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "T01/000124",
  FechaExpedicionFactura: new Date(),
  NombreRazonEmisor: "Example SL",
  TipoFactura: "R1",
  TipoRectificativa: "S",
  FacturasRectificadas: [
    {
      IDEmisorFactura: "89890001K",
      NumSerieFactura: "T01/000123",
      FechaExpedicionFactura: new Date("2024-01-01"),
    },
  ],
  ImporteRectificacion: { BaseRectificada: 10, CuotaRectificada: 2.1 },
  DescripcionOperacion: "Rectificación de T01/000123",
  Desglose: [
    {
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: 10,
      CuotaRepercutida: 2.1,
      TipoImpositivo: 21,
    },
  ],
  CuotaTotal: 2.1,
  ImporteTotal: 12.1,
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: sistema,
  generadoEn: new Date(),
  offsetMinutes: 120, // the issuing zone's offset at issue time — see note above, not a constant
});
```

Submission and consulta go through an injected `fetch`, so certificate handling (mTLS with the
sello de entidad or representative certificate) stays a deployment concern rather than something
this library configures:

```ts
import { createClient, SOAP_ENDPOINTS } from "@waitron/verifactu";

const client = createClient({ endpoint: SOAP_ENDPOINTS.production, fetch });

const respuesta = await client.submit(
  { ObligadoEmision: { NombreRazon: sistema.NombreRazon, NIF: "B12345678" } },
  [{ RegistroAlta: record }],
);
```

## The rule that matters most

**Serialise once, hash that exact literal.** AEAT recomputes the huella from the literal it
received, so `123.1` and `123.10` are both valid and hash differently. Records carry
pre-formatted strings for exactly this reason — never reformat a value between building a record
and serialising it.

## Known limitations

**This package is not yet npm-publishable.** `package.json` has `private: true` and `version
0.0.0`, `main` points at TypeScript source rather than a build artifact, and there is no
`exports` map, `files` allowlist or build step. That is intentional for now — this package is
consumed from within this monorepo, not published — but it means the usual `npm install
@waitron/verifactu` consumption path does not work yet.

## Licence

Source-available under the Elastic License 2.0, with additional permissions. See `LICENSE` and
`LICENSE-GRANTS.md` at the repository root.
