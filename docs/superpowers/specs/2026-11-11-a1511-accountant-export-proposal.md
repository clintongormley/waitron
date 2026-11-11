# Give the accountant both invoice lists

**Recommendation: choose an accountant-led pilot before an implementation plan.** The smallest useful result is one period download with separate sales and recorded-purchase tables, preserving invoice identity and VAT detail, then one layout accepted by the first venue’s accountant. Prefer a spreadsheet candidate because a3innuva and Sage Despachos document Excel imports ([P3], [P5]); this is a reach hypothesis, not evidence of majority coverage. A1511 remains wanted at go-live or soon after. Nothing is built or authorised for implementation.

## Choose by installed product, not brand

a3/Wolters Kluwer, Sage and DELSOL are credible candidates, not a national ranking. Adiss reports 60–70% of its roughly 900 client firms use Wolters Kluwer or Sage tools [P1]. An adviser-community poll also names DELSOL [P2]. Neither establishes Spanish market share, accounting-edition prevalence or Waitron’s likely coverage. The first accountant’s exact product, version and accounting mode remain unknown.

| Program | Documented format and records | Boundary |
| --- | --- | --- |
| a3innuva Contabilidad / Importia [P3] | Configured Excel uploads: issued/received invoices, journals, accounts | Required fields and mixed-rate grouping need confirmation. |
| a3ASESOR eco/con [P4] | Fixed-width ASCII `SUENLACE.DAT`, documented 256-byte variant: invoices/credits, VAT detail, journals | Separate writer; not renamed CSV. |
| Sage Despachos Connected [P5] | Excel invoices and bank movements through configured import guides | Support answer, not a complete invoice/VAT schema. |
| Sage 50 [P6] | ContaPlus-compatible CSV/DBF/TXT: journals with VAT records, accounts, customer/supplier data | Prescribed structures, not arbitrary CSV. |
| CONTASOL General Accounting [P7] | Fixed XLS/ODS layouts: APU journals; IVR issued-VAT and IVS received-VAT registers | Separate record layouts; other accounting modes need separate confirmation. |

These are **documentary compatibility routes**, not successful imports. Journal acceptance alone does not establish complete VAT books.

## Reuse delivery; preserve the missing facts

**Source-checked, not executed:** reuse the manager-authorised `report.export` attachment/activity pattern in [report-api.ts:374](../../../apps/server/src/report-api.ts#L374). Its existing deferred-transfer CSV selects closure business days and sums away VAT rates ([transfer-closed-export.ts:30](../../../apps/server/src/transfer-closed-export.ts#L30)); it does not cover all sales. Modelo 303 contains aggregates ([vat-return.ts:29](../../../packages/reporting/src/vat-return.ts#L29)). Neither supplies the proposed invoice handoff.

Proposed minimum: issuer identity/currency; invoice ID and number/series; issue and operation/receipt dates; customer/supplier name and tax identifier where recorded; invoice type; taxable base, VAT rate and VAT amount per tax group; gross invoice total once per invoice; signed correction amounts and original-invoice references; replacement/void facts without counting revenue twice. Retain purchase regime, deductible proportion and ordinary/capital classification. Use exact two-decimal money, numeric spreadsheet cells, explicit percentage rates and civil dates. Select sales by stored-offset issue date and purchases by receipt date, with clearly stated period boundaries.

Sales already store identity, dates, counterparties, correction links and VAT breakdown ([sales.ts:66](../../../packages/db/src/schema/sales.ts#L66)). Purchasing supplies headers and VAT lines through `listPurchaseInvoices`, with inclusive-start/exclusive-end receipt-date filtering ([operations.ts:254](../../../packages/purchasing/src/operations.ts#L254), [types.ts:16](../../../packages/purchasing/src/types.ts#L16)). Reuse exact Decimal/cents conversion and existing text/numeric CSV helpers if CSV is selected; negative money must bypass text formula protection ([amountCell:46](../../../apps/server/src/misdated-sales-csv.ts#L46)). Spreadsheet bytes and importer mapping still need work.

Feasibility: ordinary recorded purchases are reusable; sales need a dedicated period reader and correct type/reference extraction. The current F1/F2 inference does not classify corrections or replacements; fiscal records retain those facts ([registros.ts:69](../../../packages/fiscal-verifactu/src/schema/registros.ts#L69)). Purchase writes reject negative base/tax ([operations.ts:121](../../../packages/purchasing/src/operations.ts#L121)); supplier-credit links remain deferred ([fiscal backlog:227](../../backlog/fiscal.md#L227)). **First-cut supplier credits therefore require a separate accountant handoff.** Recorded purchases are not proof of complete books.

## One choice for the owner

**Approve the pilot first:** obtain the accountant’s accepted layout and verify a representative sales-and-purchases sample, including mixed VAT, simplified invoices, corrections, replacements/voids and repeat import, before an implementation plan. Explicitly confirm the separate supplier-credit handoff. Leave automatic sync, journal adapters, cash/card ledgers, settlement reconciliation and unchosen vendor formats outside this cut. No live importer was used here.

## Provenance

All accessed **2026-11-11**. Quotation precedes English paraphrase; unknown dates remain unknown. Source details and document-access limits are retained in Lane I’s research receipts.

| Source and date | Short quotation; supported reading |
| --- | --- |
| [P1], El Español, 2025-03-22 | “entre el 60% y el 70% de los clientes de Adiss”; Vendor-client adoption evidence, not national sampling. |
| [P2], Javier D., April 2024 | “los asesores que han respondido en una y otra ocasión pueden ser diferentes”; Community respondents can differ; no representative national denominator. |
| [P3], Wolters Kluwer, undated | “facturas expedidas, facturas recibidas, asientos y plan contable”; Excel categories cover both invoice directions and accounting data. |
| [P4], Wolters Kluwer, undated | “Longitud de los registros ..................256 Bytes”; This a3 variant prescribes fixed records. |
| [P5], Sage verified support, date unavailable | “configuradas y personalizadas con los campos que vas a importas, las guías de importación”; Excel requires configured import guides. |
| [P6], Sage guide v50.7870.0, 2025-07-02 | “estructura compatible de ContaPlus en formato CSV, DBF o TXT”; File extension alone does not establish compatibility. |
| [P7], Software DELSOL, undated | “El archivo ha de llamarse”; Named spreadsheet layouts distinguish journal and VAT registers. |

[P1]: https://www.elespanol.com/invertia/disruptores/ecosistema-startup/startups/20250322/startup-integra-gigantes-innova-adiss-corazon-asesorias-profesionales/932907060_0.html
[P2]: https://es.linkedin.com/posts/javierdonosop_asesor%C3%ADas-fiscales-laborales-activity-7181262462657126400-tI9Y
[P3]: https://taasupportportal.wolterskluwer.com/es/es-es/articulo/como-subir-fich-3555452
[P4]: https://media.a3software.com/a3responde/files/5081-Enlace_contable_descripcion_registros_WEB.pdf
[P5]: https://communityhub.sage.com/es/sage-despachos-connected/f/discusion-general/209327/cargar-excel-asientos-a-sage-despachos-connected
[P6]: https://sage50c.sage.es/help50c/Guia_Importacion_y_Exportacion_asientos.pdf
[P7]: https://sdelsol2.com/Atencion_al_cliente/CONTABILIDAD/DOCUMENTOS/IMPORTACIONES/CONTASOL_Importaci%C3%B3n%20Excel_Calc.pdf
