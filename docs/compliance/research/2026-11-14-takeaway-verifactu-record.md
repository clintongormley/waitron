# A takeaway sale needs no extra marker in the Veri\*Factu record

Checked on 14 November 2026 for A1522 Task 1
([plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1522-eat-in-takeaway-vat.md)). This is research, not legal
advice. It gates the plan's PR 2.

## Answer

No marker is needed. Food eaten here is a restaurant service; food taken away is a supply of goods
([takeaway research](2026-11-13-takeaway-food-and-drink-vat.md)). The Veri\*Factu record has no field
that says which. Each line of its VAT breakdown carries a regime key, a qualification, the rate, the
base and the tax, and nothing else that a sale like ours fills. A takeaway Coca-Cola is filed exactly
as today, with the rate 21 instead of 10, and AEAT accepts both rates under the codes Waitron already
sends.

The record's free-text description of the operation has no content rule in AEAT's validations, and
Waitron's default text, «Venta en establecimiento» ("sale at the premises"), fits goods and services
alike. A venue that has typed its own text, such as «Servicio de restaurante», would describe a
takeaway sale loosely; no AEAT check reads it. That text is per department, so a venue can word it
for both.

## What was checked

1. **The breakdown's fields.** AEAT's schema `SuministroInformacion.xsd` (SHA-256 `ee4c1655…c8aa1`,
   the copy `@waitron/verifactu` 0.2.1 bundles and checks by hash) defines each breakdown line,
   `DetalleType`, as exactly these elements, in order: `Impuesto`, `ClaveRegimen`, a choice of
   `CalificacionOperacion` or `OperacionExenta`, `TipoImpositivo`, `BaseImponibleOimporteNoSujeto`,
   `BaseImponibleACoste`, `CuotaRepercutida`, `TipoRecargoEquivalencia`,
   `CuotaRecargoEquivalencia`. None names goods or services.
2. **No goods-or-services wording anywhere in the record's schema.** A case-insensitive search of
   `SuministroInformacion.xsd` and `SuministroLR.xsd` for `entrega`, `prestaci`, `bienes` and
   `mercanc` finds nothing (0 lines in each). The same search for `Desglose` finds 6 lines, so the
   search reads the file.
3. **What Waitron sends.** Every breakdown line is `ClaveRegimen "01"`, `CalificacionOperacion "S1"`,
   the base, the rate and the tax (`packages/fiscal-verifactu/src/backend.ts:144-152`, `toDetalleDesglose`).
4. **Both rates are accepted under those codes.** AEAT's validations, §15.1, below.
5. **The regime key does not separate them.** Key 01 is "operación de régimen general". The other
   keys the validations name are special cases (02 export, 08 sales under IGIC or IPSI, 11 renting
   business premises, 19 exempt domestic sales, 20 the objective-estimate regime). AEAT's
   validations, §15.6 and §15.6.1, below.
6. **The description.** `DescripcionOperacion` is a required text of up to 500 characters
   (`SuministroInformacion.xsd`, `TextMax500Type`). The validations document has no section on its
   content. Waitron takes it from the sale's department (`apps/server/src/sale-operation-description.ts`),
   falling back to the fiscal module's default «Venta en establecimiento»
   (`packages/fiscal-verifactu/src/slot.ts:121`). For an order still open it reads the department of
   the order's zone as it is now (`resolveSalePolicy(tx, context.zoneId)`), not the department stored
   on the order. That matters only if two departments carry different texts; it is how today's sales
   already work and A1522 does not change it.

## Sources

| Source and provenance | Source's words | Our reading |
| --- | --- | --- |
| AEAT, `SuministroInformacion.xsd`, fetched 2026-07-21, bundled in `@waitron/verifactu` `schemas/` with the hash above | `<complexType name="DetalleType">` … `<element name="Impuesto" …/>` `<element name="ClaveRegimen" …/>` `<choice>` `<element name="CalificacionOperacion" …/>` `<element name="OperacionExenta" …/>` `</choice>` `<element name="TipoImpositivo" …/>` `<element name="BaseImponibleOimporteNoSujeto" …/>` `<element name="BaseImponibleACoste" …/>` `<element name="CuotaRepercutida" …/>` `<element name="TipoRecargoEquivalencia" …/>` `<element name="CuotaRecargoEquivalencia" …/>` | A breakdown line has no goods-or-services field. |
| [AEAT, `Validaciones_Errores_Veri-Factu.pdf`, version 1.2.2](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf), §15.1, p. 10; archived copy in the verifactu repository's `sources/archive/aeat-validation-rules/` | «Si Impuesto = “01” (IVA) o no se cumplimenta (considerándose “01” - IVA) y CalificacionOperacion = “S1”: […] Solo se permiten TipoImpositivo = 0; 2; 4; 5; 7,5; 10 y 21» | With the codes Waitron sends, 10 and 21 are both allowed; the date conditions that follow cover only 5, 2 and 7.5. |
| Same document, §15.6, p. 12 | «Si Impuesto = “01” (IVA) o no se cumplimenta (considerándose “01” - IVA), el valor de ClaveRegimen deberá estar cumplimentado y contenido en lista L8A.» … «01 Operación de régimen general.» | Key 01 is the general regime, and a takeaway sale is in it. The quoted list of keys is the one the section gives for IPSI; it names 01 the same way. |
