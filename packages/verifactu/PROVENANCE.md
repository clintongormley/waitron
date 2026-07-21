# Provenance

This library implements Spain's Veri\*Factu specification (RD 1007/2023, Orden HAC/1177/2024)
from AEAT's published technical documentation. Two independent implementations of a published
government specification are not derivative of each other.

## Implemented from

| Document                                                                                             | Version           |
| ---------------------------------------------------------------------------------------------------- | ----------------- |
| AEAT, especificaciones técnicas huella/hash de los registros de facturación                          | 0.1.2, 27/08/2024 |
| AEAT, especificaciones técnicas del código QR y URL de cotejo                                        | 0.5.0             |
| AEAT, Descripción del servicio web                                                                   | 1.0.3             |
| AEAT, Validaciones y errores                                                                         | 1.2.2             |
| AEAT, FAQs Desarrolladores                                                                           | 04/12/2025        |
| AEAT XSDs: SuministroInformacion, SuministroLR, RespuestaSuministro, ConsultaLR, RespuestaConsultaLR | v1.0              |
| AEAT `SistemaFacturacion.wsdl`                                                                       | —                 |
| Orden HAC/1177/2024 (BOE-A-2024-22138), arts. 7, 13, 16                                              | consolidated      |

## Primary sources on disk

The XSDs and the WSDL listed above are committed verbatim in [`schemas/`](schemas/), with fetch
dates, source URLs and SHA-256 checksums in [`schemas/README.md`](schemas/README.md).

They were **lost once**, on 2026-07-20, along with a gitignored `.claude/worktrees/` checkout — the
second time material had been destroyed that way. Committing them makes the loss unrepeatable and
`src/schemas.test.ts` makes it loud: the suite fails if a file is missing, if its `targetNamespace`
stops matching the constant the serialiser emits, or if its content no longer matches the recorded
checksum.

## References consulted

- `borjamrd/verifactu-conformance` (MIT) — official AEAT test vectors packaged for CI.
- `inoguerols/verifactu` (MIT) — consulted as a reference implementation.

## Not consulted

`mdiago/VeriFactu` is AGPL-3.0. **Its source was not read.** It may be used only as a black-box
differential oracle — executing the binary and comparing output is comparing behaviour, not
copying expression.

## Disclaimer

This library is a tool for building SIFs. **It is not itself a SIF.** A _sistema informático de
facturación_ is a deployed system, and its obligations — conservation, inalterability,
accessibility of records — are properties of a deployment, not of source code. Each deploying
business issues its own declaración responsable for its own installation.
