# A1511: choose a workbook for your accountant

**Recommend one period download with two XLSX sheets: issued invoices and recorded purchases.** Keep invoice detail and VAT splits so the accountant can map the columns into their program. Define this small export now; a real import checks its mapping rather than being a prerequisite for choosing it. Nothing is built or authorised for implementation. The export remains wanted at go-live or soon after.

## Which programs to target

a3/Wolters Kluwer, Sage and DELSOL are candidates, not a national ranking. Adiss reports that 60–70% of its roughly 900 client firms use Wolters Kluwer or Sage tools [P1]; a nonrepresentative adviser-community poll names DELSOL [P2]. These sources do not establish accounting-edition prevalence or majority coverage. A workbook is the smallest broad-reach hypothesis because a3innuva and Sage Despachos document Excel imports [P3], [P5].

| Program | Documented import; limits |
| --- | --- |
| a3innuva Contabilidad / Importia [P3] | Configured Excel: issued/received invoices, journals, accounts. Mixed-rate mapping remains untested. |
| a3ASESOR eco/con [P4] | Fixed-width ASCII `SUENLACE.DAT`: invoices/credits, VAT detail, journals. The documented 256-byte variant needs its own writer. |
| Sage Despachos Connected [P5] | Excel invoices/bank movements through configured import guides; the support answer supplies no complete VAT schema. |
| Sage 50 [P6] | ContaPlus-compatible CSV/DBF/TXT: journals with VAT records, accounts and counterparties. Prescribed structures, not arbitrary CSV. |
| CONTASOL General Accounting [P7] | Spreadsheet journal import; separate IVR issued-VAT and IVS received-VAT books. A journal import does not create those books. Other accounting modes need separate layouts. |

AEAT also publishes a common XLSX invoice-book design [P8], already related to the [parked libro-registro export](../../backlog/fiscal.md#reporting--the-fiscal-remainder-parked). Use it as a field reference. The proposed workbook is not claimed to meet that tax-service specification or import automatically into these programs.

## What the first download holds

Include invoice identity/number, issue and operation/receipt dates, recorded counterparty identity, type, signed corrective amounts and original reference, VAT bases/rates/amounts and gross total once per invoice. Purchases retain regime, deductible proportion and ordinary/capital classification. Start with individual tickets; ask whether the accountant wants daily ticket grouping later, without assuming it is suitable.

**Source-checked, not executed:** reuse the existing [export permission, attachment and activity pattern](../../../apps/server/src/report-api.ts#L374), not the [deferred-transfer selection and flattened VAT](../../../apps/server/src/transfer-closed-export.ts#L30). The [purchase reader](../../../packages/purchasing/src/operations.ts#L254) already supplies headers and VAT lines; sales need a period reader from [core invoice facts](../../../packages/db/src/schema/sales.ts#L66). Select sales by stored-offset issue date and purchases by receipt date, with explicit boundaries. Keep ordinary sales and signed corrections in the first cut. Do not add void/replacement operations or use VeriFactu-only records to classify generic sales.

**Purchase caveat:** the [API accepts negative gross totals](../../../apps/server/src/purchasing-api.ts#L81), while [VAT lines must be non-negative](../../../packages/purchasing/src/operations.ts#L121). Export the entered gross total unchanged and flag negative or unreconciled rows for separate accountant handling; do not infer credit VAT from their positive lines. The [supplier-invoice design bundle](../../backlog/back-office.md#bundle-one-design-for-supplier-invoices-and-credit-notes) remains open. Purchases can also be edited/deleted without history, so repeating a download can change it. This is recorded data, not complete books.

## Your choice

**Choose the generic workbook first (recommended), or wait for the first accountant’s exact native format?** Confirm its mapping with sales/purchase examples, mixed VAT, simplified invoices and corrections before claiming importer support. Leave automatic sync, journal adapters, cash/card ledgers and AEAT-file qualification outside this cut.

## Provenance

All accessed **2026-11-11**. Quotations precede their English reading. Import support is documentary; no installed accounting program was tested.

| Source and date | Short quotation; supported reading |
| --- | --- |
| [P1], El Español, 2025-03-22 | “entre el 60% y el 70% de los clientes de Adiss”; one vendor’s clients, not national sampling. |
| [P2], Javier D., April 2024 | “Software DELSOL” … “han disminuido en su uso”; named among community respondents, with no representative denominator. |
| [P3], Wolters Kluwer, undated | “selecciona el fichero Excel”; “facturas expedidas, facturas recibidas, asientos y plan contable”; Excel categories include both invoice directions. |
| [P4], Wolters Kluwer, undated | “Longitud de los registros ..................256 Bytes”; this variant prescribes fixed records. |
| [P5], Sage verified support, date unavailable | “importar excel con información, ya sean movimientos bancarios o facturas”; invoices/bank data need configured guides. |
| [P6], Sage v50.7870.0, 2025-07-02 | “estructura compatible de ContaPlus en formato CSV, DBF o TXT”; extension alone does not establish compatibility. |
| [P7], TeamSystem, 2026-07-23 | “IVR (libro de IVA Repercutido) y el IVS (libro de IVA Soportado).”; VAT books need separate imports. |
| [P8], AEAT v18.02.2026, 2025–2026 | “Todos los Libros Registro del IVA (Facturas Expedidas y Recibidas) deberán estar en un solo fichero”; the specified tax-service workbook has additional requirements. |

[P1]: https://www.elespanol.com/invertia/disruptores/ecosistema-startup/startups/20250322/startup-integra-gigantes-innova-adiss-corazon-asesorias-profesionales/932907060_0.html
[P2]: https://es.linkedin.com/posts/javierdonosop_asesor%C3%ADas-fiscales-laborales-activity-7181262462657126400-tI9Y
[P3]: https://taasupportportal.wolterskluwer.com/es/es-es/articulo/como-subir-fich-3555452
[P4]: https://media.a3software.com/a3responde/files/5081-Enlace_contable_descripcion_registros_WEB.pdf
[P5]: https://communityhub.sage.com/es/sage-despachos-connected/f/discusion-general/209327/cargar-excel-asientos-a-sage-despachos-connected
[P6]: https://sage50c.sage.es/help50c/Guia_Importacion_y_Exportacion_asientos.pdf
[P7]: https://ayuda.teamsystem.es/hc/es/articles/47639493701905-C2919-Asistente-de-importaci%C3%B3n-del-fichero-diario-de-movimientos-en-contabilidad-general
[P8]: https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Fact_registro/Libros_registro/Formato_Electronico_Comun_Libros_Registro_IVA_IRPF.pdf
