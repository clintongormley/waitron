# Veri\*Factu developer FAQ — indexed receipts

**Source:** AEAT, *"Aclaraciones a dudas de los desarrolladores"*, **versión 1.3, 4 de diciembre de 2025**
(published on the Agencia Tributaria developer web). Pinned copy in this repo:
[sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf](sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf).

**Why this file exists.** The FAQ is 52 pages, it is cited across the codebase (e.g. the cross-SIF note
in `packages/core/src/record-correction.ts`), and it is **versioned** — v1.3 is the one that moved the
obligation dates to 2027. This is the curated, receipt-bearing index so a design decision can cite an
exact quote + page instead of re-reading the whole thing. It follows the house rule "quote the source,
then paraphrase" — the Spanish is verbatim; the English is a gloss, never a substitute.

**Verification.** Every quote below was read **against the pinned PDF page** (pages 6–15, 22–24,
37–43), not paraphrased from memory or from a summary. Sections of the FAQ not yet indexed here are
listed at the bottom; add them the same way (verbatim + page) when a task needs them.

**Companion:** [verifactu-findings.md](verifactu-findings.md) (findings on primary law/BOE),
[asesor-questions.md](asesor-questions.md) (open questions).

---

## 1. What identifies a SIF — three fields, and `Version` is **not** one of them

> Un SIF se identifica universalmente por la «concatenación» de tres campos: Id.OEF (NIF) + Id.SIF (\*)
> + NºInstalación(\*\*). Otro dato importante que caracteriza al SIF es su versión, pero un cambio en
> dicha versión (cuando se actualiza, por ejemplo) no significa que el SIF pase a ser otro SIF con Id.
> distinto, cosa que sí ocurre con los otros 3 campos mencionados.
>
> — **FAQ §4, p.9**

The SIF identity is **NIF + Id.SIF + NºInstalación**. A version change does **not** fork the identity;
the other three do. **Bears on:** `registro_sif` (`nif`, `id_sistema_informatico`, `numero_instalacion`)
in `packages/fiscal-verifactu/src/schema/sif.ts`, whose own doc comment says the same. `Version` rides
on each record's `SistemaInformatico` block but is not a registration/identity field — so a software
release must never mint a new installation or a new chain.

## 2. `Id.SIF` is a 2-character code the **manufacturer** assigns to its product

> (\*) Código de 2 posiciones dado por cada fabricante a su producto SIF, motivo por el cual, la
> unicidad «global» de dicho Id.SIF del producto SIF se consigue considerando también de forma
> vinculada a él (como si formara parte de él) la identificación de su fabricante: NIF o IdOtro de la
> agrupación/bloque 'SistemaInformatico'.
>
> — **FAQ §4, pp.9–10**

**Bears on:** `id_sistema_informatico` is a **Waitron product constant, ≤ 2 chars** — not venue-supplied.
Global uniqueness comes from binding it to Waitron's own NIF/IdOtro in the `SistemaInformatico` block.

## 3. `NºInstalación` must never repeat — even a reinstall gets a new one

> (\*\*) El Nº de instalación es una forma de completar una identificación unívoca de cada SIF -por si
> tuviera varios- de un mismo OEF, y así distinguirse de cualquier otro SIF de ese OEF en cualquier
> momento del tiempo (pasado, presente o futuro). Como dice su definición en el anexo de la Orden
> HAC/1177/2024, de 17 de octubre, y en el documento de diseños de registros que está publicado en la
> web de desarrolladores de la Agencia Tributaria, **no puede repetirse nunca**: por ejemplo, incluso
> si se formatea el ordenador donde estaba instalado un SIF y se reinstala el mismo software de nuevo
> en ese mismo ordenador, el nuevo SIF así constituido debe llevar otro nº de instalación diferente al
> anterior que tenía, y que no coincida con la de ningún otro SIF de ese OEF (pasado, presente o
> futuro).
>
> — **FAQ §4, p.10**

Recommended values (p.10): a **timestamp** (at least date+hour+minute+second) of the install, **or** a
never-reused **sequential** number (`1, 2, 3… n`) within the OEF's organisation. **Bears on:**
`contadores_instalacion` (keyed `(nif, id_sistema_informatico)`) mints a sequential number; re-registering
a node mints a **new** one and starts a **new chain** — the fiscal invariant in `CLAUDE.md` §5. This is
why the provisioning idempotency guard around SIF registration is doing fiscal work, not just avoiding a
duplicate row.

## 4. Multiple shops under one NIF are **independent "SIF virtuales"**, each with its own NºInstalación

> Ha de tenerse en cuenta que si se utiliza un SIF que permite llevar distintas facturaciones, como
> contempla el artículo 7.a) del RRSIF, cada una de esas facturaciones distintas (sean de distintos OEF
> o del mismo OEF pero de distintos centros de facturación independientes, como tiendas) debe tener un
> nº de instalación propio y distinto al resto (pasado, presente o futuro) porque se consideran SIF
> independientes, como si fueran «SIF virtuales», dentro de un producto SIF más completo que los
> gestiona y administra.
>
> — **FAQ §4, p.10**

**Primary-source confirmation of Waitron's per-node/per-location SIF model.** One OEF (one NIF) can run
several shops, each treated as an independent SIF with its own `numero_instalacion` and its own chain.
**Bears on:** the Locations (sub-project 6) design — the unit of SIF is the node/location, and a tenant
can hold several. (See also §9 below: those shops may even fall under *different regimes*.)

## 5. There is **no registration of the SIF with AEAT** — compliance is the manufacturer's *Declaración Responsable*

The FAQ describes no *alta*/*censo*/inscription of the SIF, the software, or the producer with AEAT.
The compliance mechanism is the **producer/fabricante's Declaración Responsable (DR)**, and Veri\*Factu
operation is simply "generate QR + generate chained RF + (optionally) remit":

> la expedición de facturas con código QR tributario incluido (tal y como establece en el RD 1007/2023)
> y generando los correspondientes registros de facturación (RF) encadenados (bien sea en modalidad
> VERI\*FACTU o «NO VERI\*FACTU») es perfectamente válida.
>
> — **FAQ §2, p.7**

> la declaración responsable del productor/fabricante solo debe incorporarse a un producto SIF instalado
> que cumpla con el RD 1007/2023 (es decir, adaptado) y no a otros SIF que no lo cumplan […] ya que esto
> último (es decir, certificar un SIF como cumplidor del RD 1007/2023, mediante una declaración
> responsable, cuando no lo es) sería sancionable.
>
> — **FAQ §3, p.8**

**Bears on:** Waitron's "register the SIF" provisioning step is **purely internal** (mint
`numero_instalacion`, write `registro_sif`) — **not an AEAT call**. The DR is a legal/administrative task
for the *producer* (Waitron), tracked in [action-plan.md](action-plan.md), not something provisioning does.

## 6. A valid qualified e-certificate must be installed or the SIF cannot operate

> un SIF adaptado al RD 1007/2023 (tanto actuando en la modalidad VERI\*FACTU como en la NO VERI\*FACTU)
> SOLO puede usarse cumpliendo con todos los requisitos de dicho RD 1007/2023 que le aplican a él (para
> lo que, entre otras cosas, es necesario tener instalado un certificado electrónico cualificado válido).
>
> — **FAQ §3, p.7** (restated at §11, p.22)

**Bears on:** provisioning must wire the venue/node's qualified certificate (the credentials vault) before
the SIF is operable.

## 7. The **TPV-terminals + centralized-backoffice** architecture is explicitly admitted

> Una de esas arquitecturas, muy común, es aquella basada en un sistema en el que existen terminales que
> sirven de TPV, pero que están conectadas en tiempo real con un sistema o servidor de backoffice
> centralizado.
>
> — **FAQ §5, p.11**

The FAQ then blesses (§5.I, p.11) both flows: the backoffice generates the *Registro de alta de factura*
and returns it to the TPV to print with the QR; **or** the TPV generates the RF directly. **Bears on:**
Waitron's **till (TPV) + node/server (backoffice)** topology is exactly this "arquitectura admisible" — a
direct primary-source endorsement of the shape #33 chose.

## 8. Nothing may be left *huérfano*; the RF is generated **simultaneously** with the invoice

> no pueden quedar «huérfanos» ni facturas expedidas ni registros de facturación (RF) generados […] Y en
> el caso de SIF VERI\*FACTU, esto se amplía a los RF remitidos, o sea, no pueden quedar RF generados sin
> remitir a la AEAT.
>
> — **FAQ §5, p.12**

> debe asegurarse que la generación del RF se produzca de forma "simultánea" (entiéndase inmediata o sin
> demora apreciable) a la expedición de la factura para su instantáneo almacenamiento o remisión a la AEAT.
>
> — **FAQ §5, p.15**

**Bears on:** the invoice and its fiscal record are one atomic unit (`recordSale` writes both in one
transaction); remission is an outbox that must eventually drain (`envios`), never left un-sent.

## 9. Territorial scope: común vs foral are **not coincident**; Veri\*Factu is *común* only

> las normativas de régimen Común (es decir las que se aplican como consecuencia del reglamento de
> requisitos de los sistemas informáticos de facturación, RRSIF, aprobado por Real Decreto 1007/2023, de
> 5 de diciembre) y las vigentes en los territorios históricos forales NO son coincidentes, dado que se
> refieren a dos ámbitos territoriales diferentes dentro de España. Por lo tanto, la normativa Común en
> la regulación de los Sistemas Informáticos de Facturación (SIF) de su ámbito subjetivo se encuentra
> exclusivamente en el RD 1007/2023 y en la OMHAC 1177/2024.
>
> — **FAQ §21, p.41**

TicketBAI ↔ Veri\*Factu key equivalences (p.41): `«OT»`→`«N1»`; `«RL»`/`«IE»`→`«N2»`; `«VT»` does **not**
map to `«N1»`. And the peninsular-IVA default excludes the Basque Country and Navarra:

> Para empresarios residentes en territorio peninsular (excepto País Vasco y Navarra) y Baleares la
> obligación tributaria que les corresponde es el IVA por lo que toda su facturación debe venir referida
> al IVA.
>
> — **FAQ §23, p.43**

**Bears on:** the Locations (sub-project 6) regime-by-territory model — regime is a **per-location**
property; Veri\*Factu is wired for común, a Basque/Navarra address resolves to a different (unbuilt)
regime and must error cleanly, not mis-file under Veri\*Factu.

## 10. SII-registered businesses are **excluded** from RRSIF / Veri\*Factu

> Todos los empresarios (personas jurídicas o físicas) que se encuentren adscritos al SII, están
> excluidos del cumplimiento de la normativa del RD 1007/2023 (RRSIF).
>
> — **FAQ §12, p.42**

**Bears on:** another regime-selection input — an SII-registered obligado is outside Veri\*Factu entirely.

## 11. `ImporteTotal` is `Σ(base + cuota + recargo)` per desglose line; ±10€ is an *aviso*, not a *rechazo*

> El Importe Total Factura se calcula por el total de Base Imponible (deducidos los descuentos en factura)
> más cuota repercutida del Impuesto indirecto (normalmente IVA).
>
> ImporteTotal — Se validará que sea igual a Σ (BaseImponibleOimporteNoSujeto + CuotaRepercutida +
> CuotaRecargoEquivalencia) de todas las líneas de detalle de desglose. En caso contrario se devolverá un
> aviso de error (no generará rechazo), admitiéndose un margen de error de +/- 10,00 euros. Esta
> validación no se aplicará cuando ClaveRegimen sea «03», «05», «06» o «09».
>
> — **FAQ §20, p.39**

**Bears on:** the **reporting** VAT summary. Confirms base + cuota (+ recargo) sum per desglose line, and
that AEAT tolerates ±10€ as a warning — consistent with per-invoice rounding. Also confirms *recargo de
equivalencia* is a component of `ImporteTotal` when present (reporting defers it — it isn't on `sale_lines`).

## 12. Corrections may be generated/remitted from a **different SIF** than issued the original

> Sobre los casos 2.b) y 2.d): en principio, tanto un RF de alta de subsanación como un RF de anulación
> se podrían generar y conservar o remitir a la AEAT desde un SIF distinto al que expidió la factura
> original (aunque probablemente, lo más habitual es que todo se haga en el mismo SIF).
>
> — **FAQ §17, p.37**

Note the qualifiers: *"en principio"*, *"se podrían"*, *"lo más habitual es que todo se haga en el mismo
SIF"*. **Bears on:** the cross-SIF inference in `packages/core/src/record-correction.ts` — the FAQ names
only the *subsanación/anulación* records; extending it to a self-standing *rectificativa* is Waitron's
(sound) inference, asesor-pending.

## 13. "Test" invoices are **real** invoices — annul them, ideally in a `PRU` series

> las facturas de prueba o facturas de formación, elaboradas con un SIF adaptado, siempre que lleguen a
> ser facturas propiamente hablando (es decir que se generen de forma real, y que no sean simples
> borradores o prefacturas no confirmadas), deben ser tratadas como si de facturas reales se tratara a
> los efectos del RD 1007/23 y resto de normativa de desarrollo.
>
> — **FAQ §11, p.22**

They must then be annulled (with an *RF de anulación* remitted), ideally described and numbered in a
special series (p.23): *"numeración en una serie especial de tipo PRU 25 XXXX […] siempre serán
anuladas"*. **Bears on:** there is no throwaway test environment for Veri\*Factu records — reinforces
`CLAUDE.md` §5 "one database per environment"; any real invoice a test produces is a real fiscal record.

## 14. Conservation in Veri\*Factu is **not regulated** — AEAT keeps the records

> Cuando se utilicen sistemas VERI\*FACTU, las obligaciones de conservación de los registros NO aparecen
> reguladas en la normativa, por cuanto dichos registros serán conservados de forma inalterable y segura
> en Sede Electrónica por la AEAT, quedando a disposición de los empresarios que los hayan remitido.
>
> — **FAQ §13, p.24**

**Bears on:** the cloud-storage design (#19) — an archive/mirror is not a SIF and the RRSIF does not
govern it; conservation obligations fall away in Veri\*Factu mode because AEAT holds the records.

## 15. Rappels are rectificativas

> 1. Los rappels se documentan en facturas rectificativas. 2. No es necesario identificar en la factura
> rectificativa las facturas rectificadas, basta con indicar el periodo al que refieren.
>
> — **FAQ §19, p.38** (applying art. 15.4 ROF, RD 1619/2012)

**Bears on:** future rectificativa work — a volume rebate (rappel) is a rectificativa and, when the base
change is a *descuento por volumen*, need not identify each corrected invoice (period suffices).

## 16. Obligation dates (as of v1.3)

> Los sistemas adaptados a la normativa, son perfectamente válidos en la actualidad, si bien su uso
> obligatorio comenzará para quienes declaren el Impuesto de Sociedades el 1 de enero de 2027, y para el
> resto el 1 de julio de 2027.
>
> — **FAQ §2, p.7**

AEAT's Veri\*Factu services have been in production **since 23 April 2025** (§2, p.7). **Bears on:** the
compliance timeline in [action-plan.md](action-plan.md) — v1.3 pushed the mandatory dates from 2026 to
**2027** (per RDL 15/2025).

---

## Not yet indexed

The pinned PDF has more that no current task needs verbatim yet. Index these the same way (verbatim
quote + page, read against the page) when they become load-bearing:

- **§15 (pp.28–31)** — the art. 7.i chain-integrity check before each RF, and *modo Veri\*Factu* vs *NO
  Veri\*Factu* / SIF *DUAL* + the *registro de eventos*. (The chain-check is already in `CLAUDE.md` §5 and
  the code; the mode distinction bears on the "Veri\*Factu vs non-Veri\*Factu as separate modules" decision.)
- **§16 (pp.32–33)** — remitting RFs on behalf of clients requires *Convenio de colaboración social nº 17*
  (bears on the cloud/relocatable-submitter model).
- **§12 (pp.23–24)** vending machines; **§23–26** Canarias/IGIC and further SII detail; **§27 (pp.48–51)**
  worked F2/F3/R1–R5 rectificativa/substitution examples.
