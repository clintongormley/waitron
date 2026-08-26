# Questions for the asesor laboral / graduado social

The labour-and-payroll counterpart to [asesor-questions.md](asesor-questions.md) (which is
Verifactu/SIF-scoped, for the *asesor fiscal*). **Labour, payroll and Seguridad Social compliance is a
different advisor's domain** — a *graduado social* or *asesor laboral*, distinct from the fiscal-SIF
asesor — so those questions do not belong in the fiscal list and were homeless until this document.

Sourced from the [workforce & time-record design](../superpowers/specs/2026-07-22-workforce-and-time-record-design.md)
(its §2 legal foundation, §10 carried risks, §11 deferrals) and the fiscal review that surfaced the
card-tip duty ([verifactu-findings.md](verifactu-findings.md) §11). Each item has English context (for
us) and a Spanish formulation (to hand over).

**Nothing here blocks the build.** The registro de jornada legal floor (D1) and full scheduling (D2)
are built; payroll (D3) is deliberately export-not-build and deferred until the gestoría's package is
known. These are **confirm-before-go-live** items and one export-format dependency — not gates.

Created **2026-08-26**. Question IDs are `L#`, stable identifiers, not reading order.

> **⚠ Re-verify before relying on the legal foundation.** The workforce spec's legal research is dated
> **2026-07-22**. The load-bearing moving part — the *registro horario digital* Real Decreto (L1) — was
> then still in tramitación, pending Consejo de Ministros (21/28 July 2026), **not yet in the BOE**.
> Weeks have passed; check its current status first. The convenio figures and LISOS/SS cuantías (L2,
> L7) are likewise time-varying.

---

## Who to ask

**A *graduado social* or *asesor laboral* with hospitality experience**, and in practice the same
**gestoría** that will run the nómina — they are the operational partner, not just an advisor. The
single most useful fact to extract early is **which payroll package they use and its import layout**
(L4): it fixes the D3 export format, and nothing else does.

The AEPD/biometrics point (L3) is a data-protection question (a DPO or a lawyer), not strictly labour;
it is kept here because it gates a clock-in design decision. The card-tip duty (L6) straddles fiscal
and labour — see its note.

---

## BEFORE GO-LIVE — load-bearing, confirm the legal foundation

### L1. Digital registro horario RD — is it law yet, and what does it require?

**Why it matters.** Our system already produces the art. 34.9 ET *registro de jornada* (start/end per
worker per day, 4-year retention, accessible to the worker, their representatives and the ITSS). We
built it toward the standalone **Real Decreto de registro horario digital** that was in tramitación in
2026 — digital, automatic, interoperable, remote real-time Inspección access, immutability, a
staggered pymes adaptation period. As of the 2026-07-22 research that RD was **not yet published**. If
it now is, it may prescribe specific data fields, an export/access format, or a compliance date that
changes what we must emit.

> Nuestro sistema genera el registro diario de jornada (art. 34.9 ET): hora de inicio y fin por
> trabajador y día, conservado cuatro años, accesible al trabajador, a sus representantes y a la ITSS.
> Lo hemos diseñado orientándolo al Real Decreto de registro horario digital que estaba en tramitación
> en 2026 (digital, automático, interoperable, con acceso remoto de la Inspección e inmutabilidad).
>
> **(a)** ¿Está ya aprobado y publicado en el BOE ese Real Decreto? En su caso, ¿qué campos de datos
> concretos exige y cuál es el calendario de adaptación para pymes?
>
> **(b)** ¿Impone un formato de exportación o un mecanismo de acceso remoto de la Inspección
> específicos que debamos implementar?
>
> **(c)** ¿Basta nuestro registro (inicio/fin diario, con las pausas registradas en el turno partido)
> o el nuevo texto obliga a registrar algún dato adicional?

### L2. Which provincial convenio de hostelería applies — and its overtime treatment?

**Why it matters.** Every numeric working-time rule is convenio-sourced and loaded into
`convenio_config` per centro, never hardcoded: max hours, rest, *plus de nocturnidad*, *plus de turno
partido*, the overtime cap and how overtime is compensated. The scheduling guardrails are only as
correct as those figures. Overtime is computed day-by-day as (worked − ordinary jornada) and totalised
per pay period (art. 35.5 ET), but whether a given hour is paid or compensated with rest, and how the
80h/year cap and the 4-month rest window apply, is the convenio's call.

> Las reglas numéricas de jornada las tomamos del convenio colectivo aplicable, nunca codificadas de
> forma fija (se cargan en una configuración por centro): límites de jornada, descansos, plus de
> nocturnidad, plus de turno partido, tope y compensación de horas extraordinarias.
>
> **(a)** ¿Qué convenio de hostelería provincial es aplicable a nuestro local, y cuáles son sus cifras
> vigentes (jornada máxima, descansos, plus de nocturnidad, plus de jornada partida)?
>
> **(b)** Horas extraordinarias: las calculamos día a día como (tiempo trabajado − jornada ordinaria) y
> las totalizamos por periodo de nómina (art. 35.5 ET). ¿Cómo trata este convenio su compensación
> —retribución o descanso dentro de cuatro meses (art. 35.2 ET)— y el tope anual de 80 horas?

### L3. Clock-in by biometrics — worth it, and what DPIA?

**Why it matters.** Clock-in defaults to PIN/card. We do not use biometrics, following the AEPD 2023
guidance (biometrics for presence control are special-category high-risk data; consent is not a valid
basis in an employment relationship; a less-intrusive alternative must be preferred, and a DPIA is
mandatory before processing). We want to confirm biometrics are simply disproportionate for a deli, and
know the process if a business need ever arose.

> El fichaje es por defecto por PIN o tarjeta. No usamos biometría salvo necesidad expresa; conocemos
> la guía de la AEPD (2023): la biometría para control de presencia es dato de categoría especial y
> alto riesgo, el consentimiento no es base válida en la relación laboral, y debe preferirse la
> alternativa menos intrusiva.
>
> **(a)** Para un local de hostelería con fichaje por PIN/tarjeta, ¿hay algún motivo para plantear
> biometría, o es directamente desproporcionada?
>
> **(b)** Si en el futuro se quisiera, ¿qué evaluación de impacto (DPIA) sería obligatoria antes de
> activarla?

---

## BEFORE D3 (payroll export) — the one build dependency

### L4. Which payroll package does the gestoría use, and its import layout?

**Why it matters.** Payroll, cotizaciones and filings (RNT/RLC via SILTRA / Sistema RED, modelos 111
and 190) are the gestoría's, not ours. Our system is the authoritative source of hours / shifts /
overtime / absences and **exports** to them; it computes no cotización and files nothing. **This single
fact fixes the D3 export format**, and D3 is deliberately deferred until we have it — building an
export against a guessed layout is wasted work.

> La nómina, las cotizaciones a la Seguridad Social y las presentaciones (RNT/RLC por SILTRA/Sistema
> RED, modelos 111 y 190) las lleva la gestoría / el graduado social, no nuestro sistema. Nuestro
> sistema es la fuente de horas, turnos, horas extra y ausencias, y se las EXPORTA.
>
> **(a)** ¿Qué paquete de nómina utiliza la gestoría (a3nom, Sage, ContaPlus u otro), y cuál es su
> formato de importación preferido (CSV/Excel, o un layout concreto)?
>
> **(b)** ¿Qué datos, y con qué periodicidad, necesita recibir de nosotros por periodo de nómina para
> procesar las nóminas sin recaptura manual?

### L5. Finiquito — what data does the gestoría need at termination?

**Why it matters.** At the end of a labour relationship we want to hand the gestoría the finiquito data
(art. 49.2 ET): accrued-and-untaken vacaciones, the proportional part of pagas extraordinarias, and any
pending hours. We hold the hours and absences; we need to know exactly what fields, in what shape.

> Al finalizar una relación laboral queremos entregar a la gestoría los datos para el finiquito (art.
> 49.2 ET): vacaciones devengadas y no disfrutadas, parte proporcional de las pagas extraordinarias y
> horas pendientes.
>
> ¿Qué datos exactos necesita la gestoría para calcular el finiquito, y en qué formato?

---

## FISCAL–LABORAL BOUNDARY

### L6. Card-collected tips — booked income, and *retención* on the nómina?

**Why it matters.** The IVA side is closed on primary source (a voluntary tip is outside the base
imponible del IVA and off the factura — DGT V3095-17, [verifactu-findings.md](verifactu-findings.md)
§11). But a tip taken through the **card terminal** (unlike cash handed straight to a waiter) passes
through the business's bank account, and V3095-17's own reasoning is that when the house collects tips
into a *tronco* and redistributes them, they are an *ingreso contable* that integrates into the base of
the Impuesto sobre Sociedades, and for the employees the amounts are *rendimientos del trabajo* subject
to IRPF *retención*. This does **not** touch the factura or the huella — it is an accounting/payroll
duty. It straddles the two advisors: the IS/booking side is the *asesor fiscal*'s, the nómina/retención
side is here.

> Las propinas voluntarias quedan fuera de la base imponible del IVA y no figuran en la factura (ya
> resuelto por vía fiscal — DGT V3095-17). Ahora bien, cuando la propina se cobra por datáfono —a
> diferencia del efectivo entregado directamente al camarero— pasa por la cuenta bancaria del negocio.
> La propia V3095-17 razona que, cuando la casa recauda las propinas en un tronco y las redistribuye,
> constituyen un ingreso contable que se integra en la base del Impuesto sobre Sociedades, y para los
> empleados son rendimientos del trabajo sujetos a retención de IRPF.
>
> **(a)** ¿Debemos contabilizar como ingreso las propinas cobradas por datáfono y hacerlas pasar por la
> nómina de los empleados con su retención, mientras que las entregadas en efectivo directamente al
> trabajador no?
>
> **(b)** ¿Cómo se articula, a efectos de nómina y retención, la redistribución del tronco de propinas?

---

## REFERENCE — gestoría territory, confirm current figures

### L7. LISOS cuantías and Seguridad Social rates

**Why it matters.** Not build-gating, but two figures worth pinning: the penalty band we surface in
warnings, and any hospitality-sector cotización specifics we should be aware of even though the
gestoría computes them.

> **(a)** ¿Cuáles son las cuantías vigentes de la sanción por incumplimiento del registro de jornada
> (infracción grave, art. 7.5 LISOS, banda 751–7.500 €)?
>
> **(b)** ¿Hay tipos, tramos o bonificaciones de cotización a la Seguridad Social del sector hostelería
> que convenga tener presentes, aunque el cálculo lo realice la gestoría?

---

## Notes for the conversation

- **Nothing here blocks the build.** D1 (registro floor) and D2 (scheduling) are live; D3 (payroll
  export) is deliberately deferred until **L4** answers. Build anyway if the engagement slips.
- **L1 and L4 are the two that matter most** — L1 because the legal target may have moved since
  2026-07-22, L4 because it is the only genuine build dependency here.
- **We build to the digital / interoperable / immutable target already** (workforce spec §2.3), so if
  the RD published close to that shape, L1 is a confirmation rather than rework.
- **We do not compute cotizaciones or file anything** — say so, so the advisor scopes their answer to
  what we export rather than what they file.
- **Ask what they will put in writing.** As with the fiscal list: a view they won't commit to in an
  email is one we should not build a payroll export against.
