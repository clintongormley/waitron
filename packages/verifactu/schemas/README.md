# AEAT primary sources

These are **AEAT's own published artefacts**, reproduced verbatim. They are public
administrative publications of the Spanish tax authority, not third-party code, and they are
committed here rather than fetched at build time for two reasons: a build that reaches the
network is not reproducible, and this material has already been lost twice to worktree teardown.

**Never edit a file in this directory.** If one disagrees with our implementation, our
implementation is what changes. `src/schemas.test.ts` asserts each file's SHA-256 against the
table below, so an edit made to turn a test green fails a different test instead.

| File | Fetched | SHA-256 | Source |
| --- | --- | --- | --- |
| `SuministroInformacion.xsd` | 2026-07-21 | `ee4c1655175644de44c4c25055ffeb8e5f4bb4bc3834ce8254d4222ef18c8aa1` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd` |
| `SuministroLR.xsd` | 2026-07-21 | `cbdac8d427cc5ab5d77ca48974cab0f35d6bb819c4c66db361681e3710aeba36` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd` |
| `ConsultaLR.xsd` | 2026-07-21 | `bf2cdb8fc4b95b291757a72b76d8fffca06a6d30d9329122ca2fd6b2d5f8f1b1` | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/ConsultaLR.xsd` |
| `RespuestaSuministro.xsd` | 2026-07-21 | `82acf80f785643caac13087aae66808ed721a13f08ca5218cf8ae81b695549ef` | `https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaSuministro.xsd` |
| `RespuestaConsultaLR.xsd` | 2026-07-21 | `de35063acb8d9ba0d6ae51acc6b595de9c2b12333250e95e13108ef5f2670d45` | `https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaConsultaLR.xsd` |
| `SistemaFacturacion.wsdl` | 2026-07-21 | `05919120708ff7650612fa6683c9336eaf919335d9a4db10e86759190af48602` | `https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl` |

The authoritative index for all of them is AEAT's developer portal:
<https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU.html>

## Why two different hosts

The first three were already recoverable without guessing: their URLs are the exact
`targetNamespace` constants committed in `packages/verifactu/src/xml/serialize.ts`
(`NS_SF`/`NS_LR`/`NS_LRC`), served from AEAT's production static-files host (`www2.
agenciatributaria.gob.es`), and AEAT publishes each schema at its own namespace URI.

The other three had no URL anywhere in this repository — `PROVENANCE.md` named them under
"Implemented from" with no link. They were located by following AEAT's own developer portal
(the URL above) to its "Esquemas de los servicios web" and "WSDL de los servicios web" pages,
which link all six artefacts; the three not already known link out to AEAT's **preproduction**
static-files host (`prewww2.aeat.es`, path segment `tikeV1.0`) rather than the production one.
This is not a guess and not a different revision: the three files also served from that same
portal that overlap with the production fetch (`SuministroInformacion.xsd`, `SuministroLR.xsd`,
`ConsultaLR.xsd`) are **byte-identical** to the production copies above (diffed directly at fetch
time), and `SistemaFacturacion.wsdl`'s own `xmlns:sf` namespace and internal `schemaLocation`
references match the production `targetNamespace` values and filenames exactly. AEAT simply
serves its published schema set from both hosts; the portal's own links are the authoritative
answer to "which URL" for the three that had none.

## Why the checksums are here

They let a future reader tell "AEAT published a new revision" apart from "someone edited a
primary source to make a test pass". Those two look identical in a diff and have opposite
consequences. When AEAT does publish a revision, update the file, the date and the checksum in
one commit whose message says what changed.
