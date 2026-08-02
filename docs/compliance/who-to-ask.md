# Who to ask — verified routes and contacts

Researched **2026-07-18**. Companion to [asesor-questions.md](asesor-questions.md).

**Read this first: the advisory market for these questions is thin.** No Spanish advisory
firm with demonstrated technical depth on encadenamiento or RRSIF architecture was verified —
every candidate turned out to be a marketing page. Assume you will be educating whoever you
hire. Free routes below are likely to beat paid ones for the architecture questions.

---

## 0. Before contacting anyone

**Read AEAT's developer FAQ end to end.** `FAQs-Desarrolladores.pdf` v1.3 (4 Dec 2025), 52 pp,
from the [developer portal](https://www.agenciatributaria.es/AEAT.desarrolladores/Desarrolladores/_menu_/Documentacion/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU/Sistemas_Informaticos_de_Facturacion_y_Sistemas_VERI_FACTU.html).
It answers interpretive questions, not just plumbing, and it already resolved most of Q2.
Sections that matter here:

| § | Topic |
| --- | --- |
| 4 | How to identify a SIF |
| **5** | **Arquitecturas de los SIF** — answers Q2 |
| 8 | Certifying a SIF composed of introduction + sending functionality |
| **14** | **Responsabilidad del fabricante en la comercialización** — start here for Q9 |
| 15 | Automatic chaining check |

Note: normal fetching fails on this PDF (FlateDecode/font encoding). Download and extract
locally.

**Then search PETETE** — [petete.tributos.hacienda.gob.es/consultas](https://petete.tributos.hacienda.gob.es/consultas/) —
free-text over the full text of every DGT consulta since 1997. SIF rulings already exist:
**V0073-25** (03/02/2025, holds spreadsheets and databases can constitute SIFs), V2653-24,
V0058-25, V2045-25 (04/11/2025). Search `Orden HAC/1177/2024` via **TEXTO LIBRE** — the
NORMATIVA field uses the form `OM 1177/2024` and `/` is a separator outside dates.

**Re-check the FAQ version.** v1.3 is from Dec 2025 and AEAT maintains it actively. Confirm
there is no v1.4 before relying on it.

---

## 1. Free routes, in order of expected value

### AEAT developer FAQ + PETETE

Above. Costs an afternoon. Already answered more than the paid routes are likely to.

### Open-source Verifactu maintainers

**Not verified by research** — the sweep failed to identify maintainers or community forums.
That is a research failure, not evidence they are unreachable: the repos are named in the
architecture design and the maintainers are one GitHub issue away.

- `josemmo/Verifactu-PHP` — whose "a library is a tool for building SIFs, not a SIF" framing
  is our working position on Q9
- `inoguerols/verifactu`
- `doscientos-es/verifactu`
- `borjamrd/verifactu-conformance`

These people have shipped SIFs and hit these walls. Free, fast, and if they have already asked
AEAT they will say so. Worth doing before paying anyone.

### What does NOT exist

- **No AEAT developer support channel.** Documentation portal only; no interactive
  consultation route for implementers.
- `atenusu@correo.aeat.es` — scoped to *"PROBLEMAS INFORMÁTICOS"* only, will not answer
  interpretation. AEAT warns neither delivery nor response is guaranteed.
- `verifactu@correo.aeat.es` — **do not use.** Circulates on vendor blogs (nemon.io,
  invocash.es) with a claimed 2-day response time. Appears on no AEAT primary page; a regex
  scan of all 129,538 characters of the developer FAQ found no such address.
- `tributs@aedaf.es` as a technical channel — **refuted 0-3.** Do not cite.

---

## 2. Named individual lead

### Prof. Rafael Oliver Cuello

The only individual verified as publishing substantively in this area.

- Catedrático de Derecho Financiero y Tributario, ESERP Business & Law School (Barcelona)
- Dean of the Faculty of Law, Universitat Internacional de Catalunya
- Member of the Col·legi de l'Advocacia de Barcelona
- Director of the Research Observatory; 4 sexenios de investigación

**Evidence of relevance — publications on our exact Q9 axis:**

- *"Régimen tributario del software de facturación de empresarios y profesionales"*, IDP
  (UOC) nº 37, ISSN 1699-8154, March 2023 — covers the mandatory declaración responsable
  issued by the software producer, and the infracción for production, commercialisation, use
  and possession of manipulable invoicing software.
- *"Algunas consideraciones sobre los sistemas informáticos de facturación"*, IDP nº 44,
  March 2026, DOI 10.7238/idp.v0i44.9800374 — current, active line of work.

**Contact:** [rolivercuello.com/contacto](https://rolivercuello.com/contacto/) ·
[LinkedIn](https://www.linkedin.com/in/rafael-oliver-cuello) · ESERP and UIC institutional
routes.

**Fit:** a **Q9 lead, not a Q1/Q2 lead.** His depth is on the art. 201 bis / declaración
responsable / SIF-requirements axis; nothing found shows he has published on the architecture
questions. As an academic he may engage with a genuinely novel question (open-source DR
scoping) more readily than a commercial firm would. The specific match to "201 bis" is
high-confidence inference from the abstract — the article body could not be read.

---

## 3. Directory routes

### AEDAF Catalunya (Asociación Española de Asesores Fiscales)

- C/ Provença 281, baixos, 08037 Barcelona
- 933 176 878 · `dcatalunya@aedaf.es` · also `barcelona@aedaf.es`
- Territorial Delegate: Adrià Redondo Vives (`delegat@aedaf.es`)
- [Public member roster](https://www.aedaf.es/es/relacion-de-asociados) — 662 associates,
  filterable by province, city and qualifications, no login gate observed
- Verified active (events scheduled July 2026)

**This is an unfiltered routing mechanism, not a vetted referral service.** No published
referral procedure, no Verifactu/SIF technical screening, no cost data established. Do not
read AEDAF membership as evidence of relevant expertise — screen candidates yourself with the
question in [asesor-questions.md](asesor-questions.md): *have you advised on or certified a SIF?*

The English-language mirror of the site carries stale personnel names; use the Spanish or
Catalan pages.

---

## 4. The binding route — DGT consulta vinculante

The only way to get an answer AEAT is bound by. **LGT arts. 88–89.**

- **File at:** [www1.tributos.hacienda.gob.es/wlpl/TRIV-CVTR/ConsultaTributaria](https://www1.tributos.hacienda.gob.es/wlpl/TRIV-CVTR/ConsultaTributaria)
- **Supporting docs / requerimientos:** [www2.tributos.hacienda.gob.es/wlpl/REGD-JDIT/FGCSV](https://www2.tributos.hacienda.gob.es/wlpl/REGD-JDIT/FGCSV)
- **Requires** Spanish certificado electrónico, DNI-e or Cl@ve. Without Spanish electronic ID
  you need a representative — arrange this early, it may take longer than the consulta.
- **Timing:** statutory answer period six months; practitioners report 6–12.
- **Must be filed *before* the deadline** for the obligation in question to carry binding
  effect (art. 88.2, art. 89.1). Our obligations begin 2027, so a consulta filed now is
  timely. A late one is answered but merely informative.
- **Cost:** no fee information found on any primary source.

> Canonical entry is `sede.tributos.hacienda.gob.es`. The `sede.hacienda.gob.es/es-es/sedes/dgt/`
> path returned by search engines is now a 404.

**Standing is unresolved.** Whether we, as a software developer rather than the obligado
tributario, can file in our own name was not established. A claim that a favourable consulta
obtained by someone else does not bind AEAT in relation to us was itself **refuted 0-3** — so
treat the whole question as open. Worth resolving before drafting, since the answer may mean
filing through a friendly restaurant client instead.

**File Q9 here.** Q1 and Q2 are closed and moot: the developer FAQ v1.3 (§§4–5) answered them and #33
(server-as-SIF) retired them outright; do not file either. See
[asesor-questions.md](asesor-questions.md).

---

## 5. Not found

Stated plainly so nobody repeats the search assuming it was missed:

- **No advisory firm** with demonstrated published technical depth on encadenamiento or RRSIF.
- **No POS/hospitality industry association or vendor working group** engaging AEAT on
  Verifactu interpretation.
- **No open-source maintainer contacts or community forums** — see §1, pursue directly.
- **No cost data** for any advisory route.
