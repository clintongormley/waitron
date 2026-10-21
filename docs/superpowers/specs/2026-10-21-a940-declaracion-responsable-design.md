# A940 — The software's declaración responsable, inside the app and outside it

**Date:** 2026-10-21, revised the same day for the owner's answers. **Status:** design; all four
questions answered (§11); the revision awaits the owner's approval, and item d)'s wording awaits
the asesor (tax adviser) on Q53. Nothing in it is built. **Items:** A940, and A993 for the automatic
identity change (§5.6).

**Mock-ups:** [`docs/backlog/mockups/a940-declaracion-responsable/`](../../backlog/mockups/a940-declaracion-responsable/README.md).

> **Revision 2026-10-21 — owner's answers.** All four questions were answered through the campaign
> watcher between about 14:35 and 15:00. What changed, section by section:
>
> - **Q1, the producer: the owner personally, now.** His full name, NIF (Spanish tax number) and a
>   postal address he is content to publish are still to be supplied; §4 keeps ‹…› placeholders
>   and the revision's question file asks for them. Slice 1 needs the name and NIF; the first
>   release needs all three.
> - **The owner's follow-ups on the two-character code.** New paragraph in §2: who sets the code,
>   that it does not change with a version, which characters AEAT's validation rules allow (quoted;
>   stricter than the schema), and why a new producer alone already makes a different system.
> - **"Automate it."** New **§5.6** and backlog item **A993**: every chain stores the identity it
>   was opened under; every start compares it with the running release's; on a difference the box
>   opens a new installation and chain by itself; a guard refuses to add a record to a chain opened
>   under another identity. §5.6 says how it fits A679's installation-number rules and why it needs
>   no person's approval where W41s's promotion does — except one choice it cannot make alone, how
>   the new installation is named without A679's "anyone set up a box in the last hour?" question.
>   That is the revision's second question. A993 is its own fiscal slice, which the owner lands.
>   §3 gains fact 5 (what a chain stores today); §8 gains two guards; new picture 5.
> - **Q2 and Q3, items e) and f).** e) = «S» for this first version, which supports only
>   Veri\*Factu (this **replaces** the owner's first answer "No", which described the product's
>   design; the records keep `TipoUsoPosibleSoloVerifactu = S`). f) = «N» (`TipoUsoPosibleMultiOT`
>   changes from `S` to `N` in slice 1; `IndicadorMultiplesOT` is already `N`). One installation
>   only ever uses one fiscal policy, so a move between policies is a new installation (§5.6).
>   §3 fact 3, §4 and slice 1 are updated.
> - **Q3, the wording.** Item d) is now the draft the watcher sent to the asesor as Q53: the server
>   on the venue's own computer or in the cloud, an optional spare on site, no hardware of ours, one
>   installation for one taxpayer under one compliance mode set by the country pack, this version
>   Veri\*Factu only. It stays a draft until the asesor answers. Pictures 1, 2 and 4 are redrawn
>   with it (their item labels now read «1.a)» as §4's do); the optional-services slot is gone
>   from §4 and §5.4.
> - **Q4: production boxes run releases only**, as designed in §5.1. No change.
> - **§10 build order** gains A993; **§11** records the answers; **§12** gains new open points.
> - **Review fixes, same day:** §5.6 now names the new `identity-change` activation and its
>   person-less authority, the CLAUDE.md §5 sentence it amends, what happens to corrections of
>   invoices issued before the change (and the widening it asks of Q53(d)(2)), that only the filing
>   node runs the step, and A947's possible wait or refusal; the recovery key's sameness is traced;
>   six drifted code citations in §3, §4, §5.3 and §6 are re-found.

---

## 0. Why this exists

Spanish law requires the producer of invoicing software to state, in writing, that each version
of it meets the Veri\*Factu rules. That statement is the **declaración responsable** (in English,
"statement of responsibility"; AEAT's pages also call it the «Certificación»). It is never filed
anywhere. It is published: inside the software, where every till and the dashboard can open it,
and outside the software, where a buyer can read it before installing anything.

Waitron has never published one. The compliance plan says so
([action-plan.md](../../compliance/action-plan.md), "Step 8 — Write the declaración
responsable"): "Needed before anyone else uses the software; already overdue in principle, since
the producer deadline passed on 29 July 2025."

The owner set the shape on 2026-10-21 at about 04:00, as lane A's queue records it: the
declaration is needed only when a version is released; each release that someone other than the
owner will run gets its own, published before that version is used and kept with the release; the
in-app screen shows the running version's one; the first one owed is for the version the first
venue runs; nothing continuous between releases.

The first venue is the owner's own restaurant company. That company is a different legal person
from the owner, so its version is the first one owed a declaration.

## 1. Goals and non-goals

**Goals**

1. A declaration text, drafted from AEAT's worked example with Waitron's real facts, that the
   owner approves (§4).
2. One declaration per released version, produced by the release step, frozen once published,
   and kept forever (§5).
3. On every terminal — counter till, handheld, tablet, kitchen screen and dashboard, and the setup
   wizard — an entry that opens the running version's declaration in two taps (§6).
4. Outside the software: the box serves the declaration before setup and while stopped, and each
   release publishes it as a PDF and plain text (§7).
5. What the invoice records tell AEAT about the software agrees with what the declaration says,
   and cannot drift apart (§3, §8).
6. When the system's identity changes — a new producer, a new two-character code, or a move to
   another compliance mode — the box opens a new installation and chain by itself, and never adds
   a record to a chain opened under another identity (§5.6, item A993).

**Non-goals**

- Filing or registering the declaration. The law asks for neither (§2).
- An electronic signature. Not required (§2).
- A website for Waitron. The release archive lives on GitHub (§7); a website can link to it later.
- The licensing question still open with a lawyer (asesor question Q9(a): whether publishing the
  source counts as producing the software for whoever modifies it). It does not change who signs
  Waitron's own declaration: Waitron's producer does, as decided on 2026-07-27
  ([asesor-questions.md](../../compliance/asesor-questions.md), Q9) — today the owner personally
  (§11, Q1).

## 2. What the law asks

Every quote below was taken from a raw download on 2026-10-21 and is listed in the provenance
table at the end. Spanish first, then the plain-English meaning.

**Who, and for which versions.** Real Decreto 1007/2023, art. 13.2: «La declaración responsable
deberá constar por escrito y de modo visible en el propio sistema informático en cada una de sus
versiones». The producer writes it, and every version carries its own. AEAT's FAQ adds: «Cada
versión, por pequeña variación que introduzca, es un producto distinto de los anteriores» — any
change, however small, is a new version that needs a new declaration.

**Keep them all.** RD art. 13.3: the producer «deberá guardar y conservar las declaraciones
responsables de todas las versiones». AEAT recommends that all of them be «accesibles
públicamente y localizables fácilmente a través de Internet», even for versions no longer in use.
The venue also keeps the declarations of versions it upgrades away from (AEAT FAQ: «los usuarios
… cuando … actualicen las versiones, deben conservar los certificados de los sistemas que se
sustituyan o actualicen»).

**What it says, in order.** Orden HAC/1177/2024, art. 15.1: it opens with the exact title
«DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN», then items a) to l) in that
order, «Cada dato aportado deberá precederse del texto que lo describe, de acuerdo con lo redactado
en la letra con la cual se corresponde»:

| Item | What it holds |
| --- | --- |
| a) | The system's name |
| b) | Its two-character code (the same code the invoice records carry) |
| c) | The full version identifier |
| d) | Its hardware and software components, and a short description of what it does |
| e) | Whether it can only work as Veri\*Factu (S or N) |
| f) | Whether it can keep the invoicing of several taxpayers (S or N) |
| g) | The signature types used when not working as Veri\*Factu |
| h) | The producer's name |
| i) | The producer's Spanish tax number (NIF), or another identifier with its type and country |
| j) | The producer's full postal contact address |
| k) | A fixed statement that this version complies with the law, the Real Decreto and the Orden |
| l) | The date (day, month, year) and place (town, then country) of signing |

An annex is recommended, not required (art. 15.2): other contact details, web addresses, a
detailed explanation of how the system meets the Orden, anything else.

**Components.** AEAT's FAQ on software built from other code: the producer that writes or
integrates it «debe realizar la declaración responsable, incorporar los datos obligatorios e
indicar qué componentes utiliza» and «En el caso de que utilice código abierto, se hará responsable del funcionamiento del
mismo». A
component from the same producer with its own release cycle, usable by other systems, needs its
own declaration; the repository recorded that reading on 2026-07-27
([verifactu-findings.md](../../compliance/verifactu-findings.md), the table of cases (a)–(c)).

**Where it must be.** Orden art. 15.3: «disponible de manera legible e individualizada dentro
del propio sistema informático … y ser accesible por el usuario de forma rápida, fácil e
intuitiva». AEAT's FAQ makes "inside" concrete: the current version's declaration must be
reachable «desde cualquier punto de acceso o terminal conectado a dicho SIF a través del cual se
pueda facturar o administrar el SIF», and recommends «una opción específica dentro de algún menú,
como por ejemplo "Ayuda" … al lado de … "Acerca de"». Only the running version's has to be inside.
And "outside": readable «sin necesidad de tener que instalar y poner en funcionamiento el
producto», in «un formato de uso ampliamente extendido y gratuito, como el texto puro, PDF o
similar».

**It must match the records — for item e).** AEAT's FAQ: a Veri\*Factu-only system «deberá indicar
una "S" tanto en la Certificación (letra e) como en el campo correspondiente ("TipoUsoPosibleSolo
VERI\*FACTU") dentro de los registros de facturación generados». No source found says the same
for the other items. Items a), b), c), f), h) and i) describe the same facts as fields of the
records' `SistemaInformatico` block (Orden, annex block 2.6), so this design keeps each pair
identical by choice.

**The two-character code (item b).** The Orden, art. 15.1 b): «Se trata de una codificación a
establecer por la persona o entidad productora … Este código no podrá coincidir con el de otro
sistema informático distinto que pueda producir dicha persona o entidad». AEAT's FAQ: «Este código
no se podrá repetir en otro SIF distinto del mismo productor (aunque sí podría darse la coincidencia
de que dos productores distintos utilizarán el mismo código para referirse a sus respectivos SIF»
(SIF: *sistema informático de facturación*, the invoicing system). AEAT's developer FAQ (v1.3, §4,
pp. 9–10): «Un SIF se identifica universalmente por la "concatenación" de tres campos: Id.OEF (NIF)
+ Id.SIF (\*) + NºInstalación(\*\*). Otro dato importante que caracteriza al SIF es su versión,
pero un cambio en dicha versión (cuando se actualiza, por ejemplo) no significa que el SIF pase a
ser otro SIF con Id. distinto, cosa que sí ocurre con los otros 3 campos mencionados», and «(\*)
Código de 2 posiciones dado por cada fabricante a su producto SIF, motivo por el cual, la unicidad
"global" de dicho Id.SIF del producto SIF se consigue considerando también de forma vinculada a él
(como si formara parte de él) la identificación de su fabricante: NIF o IdOtro de la
agrupación/bloque 'SistemaInformatico'».

In plain English: the code is ours to choose; it tells one of our products from our others, so it
changes with a new product, never with a new version; a system is identified by the taxpayer's NIF
(Id.OEF, the *obligado a expedir factura*), the code and the installation number; and the code is
unique only together with its producer's NIF. So, on our reading, a new producer alone makes a
different system even if the two characters stay the same. Asesor question Q53(d) asks whether the
same characters may continue under a new producer and confirms what the switch costs; the box's
side of that switch is §5.6.

Which characters: AEAT's schema allows any string of up to two characters (`IdSistemaInformatico`
is `TextMax2Type`, a `maxLength` of 2 and no pattern: `schemas/SuministroInformacion.xsd:236` and
`:665-669` in the `verifactu` repository at `2dc7609`). AEAT's validation rules are stricter:
«El campo IdSistemaInformatico deberá tener rellenas siempre las dos posiciones, cada una de las
cuales deberá ser una letra mayúscula, excepto la Ñ, o un dígito numérico» (Validaciones v1.2.2,
§3.1.5, p. 17) — always exactly two characters, each a capital letter A–Z or a digit 0–9. The
Orden's annex points there for the restrictions («Se detallarán las posibles restricciones a sus
valores en la documentación correspondiente en la sede electrónica de la AEAT (documento de
validaciones...)», annex block 2.6, read by eye from the BOE's image). Waitron's code, `W1`
(`packages/fiscal-verifactu/src/software.ts:1`), meets the rule.

**Language.** No rule found. The Orden fixes the title and the item wording in Spanish, so the
declaration is written in Spanish. Nothing found forbids a translation beside it; this design adds
none (§6.5).

**What it costs to have none.** AEAT's FAQ: «se sancionará con 1.000 euros por sistema
informático comercializado sin dicha certificación».

## 3. What exists today, and what is missing

There is no declaration, no About screen on any terminal, and no release (`git ls-remote --tags
origin` lists only `pre-sqlite-migration`; `gh api repos/clintongormley/waitron/releases --jq
length` answers `0`). Five facts from the code shape the design. Each was found by reading the
source and following its callers, not by running it; the citations are the receipts.

1. **Every record a box files tells AEAT the version is `0.0.0`.** The `Version` field comes
   from `DEFAULT_SYSTEM_INFO` in `packages/fiscal-verifactu/src/backend.ts:71-77`, and the one
   production construction of the backend (`packages/fiscal-verifactu/src/slot.ts:54-61`) passes
   no override. The box does know its own build (`WAITRON_BUILD_ID`, a commit id, read by
   `applicationVersion` in `packages/db/src/venue-holder-identity.ts:30-33`), but the fiscal code
   never reads it. A declaration names one version, so the version the records carry has to come
   from the release.
2. **The producer fields of every record carry the restaurant's name and tax number.**
   `buildSistemaInformatico` (`backend.ts:641-653`) fills `NombreRazon` with the taxpayer's legal
   name and `NIF` with the taxpayer's NIF. The Orden's annex describes both as the producer's:
   «Nombre-razón social de la persona o entidad productora», «NIF de la persona o entidad
   productora». The repository's own notes on AEAT's FAQ say the same
   (`docs/compliance/verifactu-faq-notes.md:46-54`). It has been this way since the first write
   path (#12). A cancellation reads its issuer name back from that block
   (`packages/fiscal-verifactu/src/registro-row.ts:158-161`), and that stored name becomes the
   name in the submission's header and decides how the sending step groups records
   (`packages/fiscal-verifactu/src/drain.ts:580-640` and `:1219-1222`). So the fix must change
   that reader in the same pull request, or cancellations would go out under the producer's name.
   I believe nothing has been filed with AEAT's production service: the README says Waitron is
   "Not yet running in production anywhere" (`README.md:9`). If that holds, no wrong record sits
   at AEAT and the fix changes only what future records carry. The producer will be the owner
   personally (§11, Q1).
3. **The three usage flags are marked unverified in the code itself** (`backend.ts:58-61`).
   Records send "can only work as Veri\*Factu" (`TipoUsoPosibleSoloVerifactu`) = `S`, "can keep
   several taxpayers" (`TipoUsoPosibleMultiOT`) = `S`, and "keeps several taxpayers now"
   (`IndicadorMultiplesOT`) = `N` (`backend.ts:74-76`). The owner's answers settle them for this
   version (§11, Q2 and Q3). `TipoUsoPosibleSoloVerifactu` stays `S`: the first version supports
   only Veri\*Factu — Spain's common territory is mapped to `fiscal-verifactu`
   (`packages/country-es/src/spain.ts:300-310`), the other Spanish territories are refused, and
   `selectFiscalModule` forces the slot (`packages/module/src/fiscal-slot.ts:37-47`).
   `TipoUsoPosibleMultiOT` changes to `N`: Waitron keeps exactly one taxpayer per installation (the
   `tenants` table is a single row, CLAUDE.md §3). `IndicadorMultiplesOT` stays `N`: the annex
   says the system works it out from the taxpayers it holds, and with one row by construction the
   answer is always `N`. The same build also ships `fiscal-none`, which files nothing and is what a UK
   venue gets (`packages/country-gb/src/united-kingdom.ts:21`); §12 says why this design reads it
   as no bar to «S».
4. **The name sent is "Waitron POS"** (`backend.ts:72`), while the product is called "Waitron"
   everywhere it is distributed (`README.md:1`). Item a) is «la denominación genérica dada al
   mismo para su distribución o comercialización», and the records' field will say the same.

5. **A chain does not remember which producer or compliance mode it was opened under.** A
   chain belongs to one SIF row (`registro_sif`), which stores the taxpayer's NIF, the
   two-character code and the installation number (`packages/fiscal-verifactu/src/schema/sif.ts:20-22`)
   and nothing else about the software. Activation takes the code from the box's live row, not
   from the running build (`softwareId: liveSif?.softwareId ?? WAITRON_ID_SISTEMA`,
   `packages/fiscal-verifactu/src/allocation.ts:77-88`). A start already refuses a node whose
   recorded filing module differs from the enabled one (`module.fiscal_slot_mismatch`,
   `packages/module/src/fiscal-slot.ts:26-28`, read at `apps/server/src/boot.ts:1602-1609`). §5.6
   builds on these.

Facts 1–4 are fiscal changes: they change what every invoice record tells AEAT. None of them
touches the record's fingerprint, the chain, the series or the numbering: the fingerprint string
is built from the issuer's NIF, the invoice number and date, the type, the tax and total amounts,
the previous fingerprint and the timestamp, and no field of this block (`buildCadenaAlta` and
`buildCadenaAnulacion` in `@waitron/verifactu` 0.2.1, `dist/huella.js`). By the owner's rule of
2026-10-21, a pull request that changes what AEAT receives is finished to green and left for the
owner to land. They come first, because the first declaration must match them.

What helps: the box already serves pages before anyone signs in. `/help/<language>/<page>` is
mounted ahead of every mode's gates (`apps/server/src/boot.ts:984-1003`), so it answers in setup
mode and in trading mode. The till has a sheet that shows a box page over the screen
(`apps/till/src/widgets/guide-sheet.ts`). `packages/fiscal-verifactu` already draws PDFs
(`pdfkit`, `pdf-lib`, its own font). CI already publishes an image tagged with the version when a
`v*` tag is pushed (`.github/workflows/ci.yml:37` triggers on `v*` tags; `:2772` adds the
version tag).

## 4. The declaration's text

Drafted from AEAT's worked example (V0.5.1, the only one AEAT publishes; its one example is
software sold for Veri\*Factu-only use by a Spanish company). **The item headings are the
example's, word for word**: the example is AEAT's own rendering of art. 15.1's items as headings
(«esta declaración responsable», «el apartado a)»), while the Orden's text describes each item
rather than giving a heading to copy, and adds explanatory sentences to several items that are
not headings. Three departures, each deliberate: the title is the Orden's exact wording (art. 15.1
fixes it); the person-producer wording of the example's footnote i, which the footnote applies to
items h)–l), is also applied to the annex headings, by our choice; and the annex leaves out the
example's item 2.c) (see the choices below). Items are labelled «1.a)» to «1.l)», as the example
labels them.

Values marked ‹…› are filled in later: the producer's facts by the owner (the owner personally,
§11, Q1; his name, NIF and publishable address are still to be supplied), and the version, the
library version, the hosting phrases, the functions list and the date by the release step (§5).
Where the producer is a person rather than a company, AEAT's example says to write «Nombre y
apellidos de la persona productora» in h) and «persona productora» for «entidad productora» in
i)–l). The draft below is written for a person, because that is the producer the owner chose.

Item d)'s body is the draft sent to the asesor as Q53
([asesor-questions.md](../../compliance/asesor-questions.md), Q53), as the owner directed; it stays
a draft until the asesor answers, and the first release waits for that answer.

> **DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN**
>
> **1.a) Nombre del sistema informático a que se refiere esta declaración responsable:**
> Waitron
>
> **1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta
> declaración responsable:** W1
>
> **1.c) Identificador completo de la versión concreta del sistema informático a que se refiere
> esta declaración responsable:** ‹1.0.0›
>
> **1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> Waitron es un software de punto de venta para restaurantes y bares. Se ejecuta en un servidor
> ‹—un equipo del propio establecimiento o un servidor en la nube—› con Linux y Docker, y los
> terminales del establecimiento (cajas, comanderos, pantallas de cocina y el panel de gestión) se
> conectan a él por la red mediante un navegador. ‹Opcionalmente, un segundo servidor de reserva en
> el establecimiento mantiene una copia continua de los datos y puede sustituir al principal si este
> falla.›
>
> Hardware: Waitron no incluye hardware propio; funciona en cualquier ordenador que cumpla lo
> anterior.
>
> Software: el servidor Waitron, que genera, encadena, conserva y remite los registros de
> facturación; la biblioteca @waitron/verifactu (versión ‹x.y.z›), que construye cada registro, su
> huella y el contenido del código QR, y lo remite, y que cuenta con su propia declaración
> responsable; las aplicaciones de los terminales, que no generan registros de facturación; el
> agente de impresión; y los componentes de terceros de los que nos hacemos responsables: Node.js,
> SQLite, Litestream, Linux y Docker (la lista completa se muestra en el propio sistema).
>
> Cada instalación lleva la facturación de un único obligado tributario y aplica una única modalidad
> de cumplimiento, determinada por el paquete de país instalado; esta versión solo funciona como
> VERI\*FACTU.
>
> Principales funcionalidades: ‹la lista de la versión, comprobada en cada publicación; en la rama
> principal el 21 de octubre de 2026: toma de pedidos por mesa o en barra, cobro en efectivo y con
> tarjeta, expedición de facturas simplificadas, facturas rectificativas, consulta de las facturas
> emitidas e informes de ventas›.
>
> **1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se
> ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda
> funcionar exclusivamente como «VERI\*FACTU»:** S - Sí
>
> **1.f) Indicación de si el sistema informático a que se refiere la declaración responsable
> permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la
> facturación de varios obligados tributarios:** N - No
>
> **1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso
> de que el sistema informático a que se refiere esta declaración responsable no sea utilizado
> como «VERI\*FACTU».** Dado que se trata de un producto de facturación que solo puede ser
> utilizado exclusivamente en la modalidad de «VERI\*FACTU», no se realiza una firma electrónica
> expresa de los registros de facturación generados, ya que la normativa considera que quedan
> firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia Tributaria
> con la debida autenticación mediante el adecuado certificado electrónico cualificado.
>
> **1.h) Nombre y apellidos de la persona productora del sistema informático a que se refiere
> esta declaración responsable:** ‹nombre y apellidos›
>
> **1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema
> informático a que se refiere esta declaración responsable:** ‹NIF›
>
> **1.j) Dirección postal completa de contacto de la persona productora del sistema informático a
> que se refiere esta declaración responsable:** ‹calle, número, código postal, localidad
> (provincia), España›
>
> **1.k)** La persona productora del sistema informático a que se refiere esta declaración
> responsable hace constar que dicho sistema informático, en la versión indicada en ella, cumple
> con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General
> Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y
> programas informáticos o electrónicos que soporten los procesos de facturación de empresarios
> y profesionales, y la estandarización de formatos de los registros de facturación, aprobado
> por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de octubre,
> y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello
> que complete las especificaciones de dicha orden.
>
> **1.l)**
> - Fecha en que la persona productora de este sistema informático suscribe esta declaración
>   responsable del mismo: ‹día› de ‹mes› de ‹año›.
> - Lugar en que la persona productora de este sistema informático suscribe esta declaración
>   responsable del mismo: ‹localidad› – España.
>
> **ANEXO**
>
> **2.a) Otras formas de contacto con la persona productora del sistema informático a que se
> refiere esta declaración responsable:** Correo electrónico: info@waitron.io
>
> **2.b) Direcciones de internet de la persona productora del sistema informático a que se
> refiere esta declaración responsable:**
> - Histórico de declaraciones responsables de las versiones de este producto:
>   https://github.com/clintongormley/waitron/releases

**In English, briefly.** a) Waitron. b) W1, the code the records already carry. c) The release's
version. d) What it is (a restaurant point of sale on a server that is either the venue's own
computer or a server in the cloud, with Linux and Docker, reached by the venue's tills, handhelds,
kitchen screens and dashboard through a browser; optionally a spare server on site that keeps a
continuous copy and can take over), no hardware of ours, its own parts and the third-party parts
it takes responsibility for (the full list is on the box), one taxpayer and one compliance mode
per installation, set by the country pack, Veri\*Factu only in this version, and its main
functions. e) Yes, only Veri\*Factu, for this version. f) No, one taxpayer.
g) Signs nothing itself, because a Veri\*Factu-only system's records count as signed when sent
with a qualified certificate — AEAT's example's words, unchanged. h)–j) Who the producer is and
where to write to them. k) The fixed compliance statement. l) Date and place of signing. Annex: an
email address and the archive of every version's declaration.

**Choices made in the draft.** The owner's answers (§11) settled e), f) and the producer, and
directed d); the revision asks him to approve the whole.

- **Item a) says "Waitron", not "Waitron POS".** The records' name field changes to match
  (§3, fact 4).
- **Item f) says N** (the owner, Q2). One installation holds one taxpayer by construction, and the
  records change from `S` to `N` to match (§3, fact 3). AEAT's annex wording for the twin field: «permite llevar
  independientemente la facturación de varios obligados tributarios (valor "S") o solo de uno
  (valor "N")». A future Waitron that hosts several taxpayers in one installation would be a new
  version with its own declaration saying S.
- **Item e) says S for this version** (the owner, Q3, replacing his first answer "No", which
  described the product's design — a fiscal policy per country pack, Spain one day offering both
  modes — rather than this version, which supports only Veri\*Factu). The records already say S.
  Q53(b) asks the asesor to confirm the reading: e) describes the version declared, so «S» now and
  «N», with its signature types in g), from the first version that ships a non-Veri\*Factu mode.
- **The functions list is filled in per release and checked route by route.** On main on
  2026-10-21: simplified invoices (F2) are issued; corrective invoices are reached through
  `apps/server/src/cancel-credit.ts`; every full-invoice request is refused
  (`apps/server/src/till-sale.ts:517`, `apps/server/src/working-order.ts:4050-4061`); and no
  route records a cancellation or a substitute invoice (`docs/backlog.md`, fiscal area: "No till screen or
  server route calls `recordVoid` yet", and "no route calls `recordSubstitution`"). So full and
  substitute invoices and cancellations are not listed. A release that turns one on lists it. A
  function is listed only when a screen can do it: the end-of-day till close is left out because
  no route records one (`recordDailyClose` is called only by a demo script,
  `apps/server/scripts/daily-close-z-demo.ts`); the read-only daily report is part of «informes de
  ventas».
- **Item d) is Q53's draft, word for word, with three slots besides its own functions placeholder** (the owner, Q3: "you're also
  limiting the hardware to on prem when it could be running in the cloud. Draft what you think
  works then add that sentence to the assessor doc"). The library's exact version stands where
  Q53 says «versión indicada en el sistema», because case (b) of the 2026-07-27 reading asks for
  it (the library bullet below). The cloud phrase and the spare-server sentence are checked per
  release, like the functions list: a release that cannot run in the cloud names only «un equipo
  del propio establecimiento», and one with no spare box yet (A947 is not built) leaves out the
  spare-server sentence, so d) never promises what the version cannot do. The draft says «nos hacemos responsables» although the producer is one person; that
  wording is settled with the asesor's answer.
- **The third-party parts are named, with the full list on the box:** Node.js, SQLite, Litestream,
  Linux and Docker, as Q53 lists them; `/app/third-party/` already ships with every image. The
  guarantee that a filed record is not changed comes from Waitron's own triggers (CLAUDE.md §5),
  so the draft does not credit the engine with it.
- **No hardware.** AEAT's FAQ: generic hardware is not certified, only hardware sold as part of
  «un "todo"» or hardware that itself meets a requirement. If Waitron later sells a box as part
  of the product, item c) must list the box's version too, software first («Se puede empezar por
  el software y continuar con el hardware»), and that is a new declaration.
- **The `@waitron/verifactu` library gets its own declaration.** It is published on its own
  (public repository `waitron-io/verifactu`, on npm, with its own release cycle), which is case
  (b) of the repository's 2026-07-27 reading: «productos separados, que pueden dar servicio a
  múltiples CPF, que incluso podrían comercializarse de forma independiente» — its own
  declaration. Waitron's item d) names the exact library version and how the server uses it, as
  case (b) requires. The library's own declaration is slice 6 (§10), in its own repository.
- **The recommended annex item 2.c) is left out.** It is a "detailed explanation of how the
  system meets the Orden". Every sentence in it is a claim about the code, re-checked at every
  release; leaving it out costs nothing legally. It can be added in a later version.

## 5. One declaration per release: where it lives and how a release makes it

### 5.1 What a release is

A **release** is a `v<major>.<minor>.<patch>` git tag on a commit of `main`, for example
`v1.0.0`. Its version, without the `v`, is item c) and the `Version` field of every record that
build files.

Every build a venue runs in production is a release. A build from `main` without a tag is not: it
carries the version `0.0.0-dev+<commit>` and no declaration. A box set to
`WAITRON_ENV=production` refuses to start on a build that is not a release, with the error code
`server.unreleased_build` (`server.*` is the prefix for facts about the process itself,
CLAUDE.md §3) shown on the recovery page with a fixed title and action: "This box is running a
test build. Install a release." Preproduction and development boxes run any build. The refusal
happens only at start, never during service, so it cannot stop a sale in progress. This is what
makes "each version a venue runs has its declaration" a check rather than a habit (question 4,
answered "Releases only").

### 5.2 One source for what the records say and what the declaration says

A new file, `packages/fiscal-verifactu/src/software-identity.ts`, holds the product's own facts:
the name, the two-character code, the usage flags and the producer's name and identifier.
`buildSistemaInformatico` reads it, and so does the declaration renderer. The version comes from
the build (§5.4). So items a), b), c), e), f), h) and i) and their twin record fields are written
from the same values. The producer's identifier and the code are also the running release's
half of the identity §5.6 compares at every start.

### 5.3 Where each version's text lives

Every Spanish word stays in `packages/fiscal-verifactu`, the one general package allowed Spanish
(CLAUDE.md §3, "General code is English only"); file names, paths and scripts outside it are
English.

- **The template:** `packages/fiscal-verifactu/declarations/template.md`, holding §4's fixed
  wording with slots for the facts from `software-identity.ts`, the versions, the functions list,
  the date and the place. The Spanish month names live beside it in the same package.
- **Each released version's text:** `packages/fiscal-verifactu/declarations/v1.0.0.md`, written by
  the release step and landed in a pull request before the tag exists (§5.4). Once its tag exists,
  the file is never edited again; git keeps every one, which meets the producer's duty to keep them
  all (RD art. 13.3). A guard (§8) fails if a file whose tag exists differs from the file at that
  tag. A file whose tag does not exist yet may still change.
- **The rendered copies** — HTML, PDF and plain text — are made once, in the image build, by a
  renderer in `fiscal-verifactu`, and land at a fixed path in the image, `/app/declaration/`,
  beside `/app/third-party/`. The box serves them as opaque files, so `apps/server` never imports
  `@waitron/fiscal-verifactu` (the composition rule at `packages/composition/src/modules.ts:121-127`).
  The release job copies the same files out of the published image onto the GitHub Release, so
  the box's PDF and the archive's PDF are the same bytes.

### 5.4 The release step

A release is cut by the owner, or by a lane on the owner's instruction, in two commands from an
up-to-date checkout of `main`. Each stops at its first failure.

```
pnpm release prepare 1.0.0 --place "‹localidad›"
```

1. Refuses if `v1.0.0` exists, or if `1.0.0` is not greater than the last release.
2. Writes `packages/fiscal-verifactu/declarations/v1.0.0.md` from the template, the identity
   file, the version, the bundled `@waitron/verifactu` version, the hosting phrases and the
   functions list from `declarations/functions.md`, and today's date in Europe/Madrid, in the
   Orden's order «día, mes y año».
3. Prints the whole declaration and asks for a typed `yes`. This is the producer signing.
4. On a branch `release/1.0.0`, commits it (`git commit -s`, "Release 1.0.0") and opens a pull
   request. It lands like any pull request, after its CI.

```
pnpm release tag 1.0.0
```

5. Refuses unless `main` holds `declarations/v1.0.0.md` and `main`'s CI run on that commit is
   green.
6. Tags that commit `v1.0.0` and pushes the tag.

CI, on the tag (§7.1), builds and publishes the image with the version baked in
(`WAITRON_VERSION`), renders the declaration into it, and attaches the PDF and the plain text to a
GitHub Release named `1.0.0`.

**What a person checks before `prepare`**, listed in the release runbook
(`docs/operations/release.md`, written in slice 2): `declarations/functions.md`, which names each
listed function beside the route that serves it, still matches the code — a function whose route
is gone or refused comes off, a new one goes on; item d)'s hosting phrases (the cloud server, the
spare box on site) are kept only when the release can do them; d) still describes every service of
ours the version can call in production (none today; a release that adds one changes d) and has
the wording checked again); AEAT's FAQ and worked example are re-read for changes; and the
repository is still public (§7.1). A release that changes the producer or the two-character code
says so in the runbook's first line: every filing box opens a new installation at its first start
on it (§5.6), the main boxes of one taxpayer's venues are upgraded one at a time, and each venue's
spare in the same visit as its main box.

### 5.5 How a box runs a release

Today `waitron.sh install <ref>` pulls images only for `main` and builds any other ref on the box
(`deploy/waitron.sh:324-353`). A release must run the image CI published for its tag, because that
is the build the declaration describes. So `waitron.sh install v1.0.0` pulls
`ghcr.io/clintongormley/waitron:1.0.0` (slice 4).

### 5.6 When the system's identity changes: a new installation, by itself (A993)

The owner, 2026-10-21: "Surely we should automate the new chain switch so that we never miss it
when changing the system identity in the future?" — and, with Q2, "a single installation will only
ever use one fiscal policy". This section is the design of that step. It is fiscal: it decides
which chain a record joins. It is built as its own slice, A993, which the owner lands.

**What counts as the identity.** §2: a system is the taxpayer's NIF, the two-character code and
the installation number, and the code is unique only with its producer's NIF. A new version is
not a new system (developer FAQ §4, p. 9). So the identity a chain is opened under is four facts:

| Fact | Where it comes from at a start | Changes when |
| --- | --- | --- |
| The producer's NIF (or foreign identifier, its type and country) | The running release's `software-identity.ts` (§5.2) | The producer changes, e.g. the owner to a future Waitron company |
| The two-character code | The same file | Waitron ships a different product |
| The compliance mode («VERI\*FACTU» today, the only one) | The enabled fiscal module | A venue moves between fiscal policies — a new installation by **Waitron's own conservative choice** (the owner, Q2), not by a source: the developer FAQ's «cuando se produce un cambio de la implementación de la forma de facturar del SIF, realmente se ha cambiado de SIF» (§3, p. 9) is about a change of regulation (its example: RD 1007/2023 to the SII), and §3 also calls an adapted system one system «tanto actuando en la modalidad VERI\*FACTU como en la NO VERI\*FACTU» (p. 7; `docs/compliance/verifactu-faq-notes.md` §6). §12 keeps it for the asesor |
| The taxpayer's NIF | The `tenants` row | Never, through the product (below) |

The version is deliberately not in the list.

**What each chain stores.** A993 adds the producer's identifier and the compliance mode to the
SIF row a chain belongs to, beside the taxpayer's NIF and the code it already stores (§3, fact 5).
Every activation writes them from the running release — first setup, restore, re-registration,
promotion and the change below — and the code comes from the running release too, not from the
box's previous row (`allocation.ts:77-88` today). That is a migration on a fiscal table; before
go-live no data is carried forward (CLAUDE.md §3, the no-backwards-compatibility rule), and a row
opened before A993, with nothing stored, counts as different from any running identity.

**What every start does**, before the box trades, inside the fiscal module — **only on the node
that files.** Today filing runs only while a node's role is primary: the drain runs behind
`singletonPass` (`apps/server/src/boot.ts:2518-2519`), which runs the pass only when
`node_roles.singleton_role` is `primary` and gives any other node an empty pass
(`apps/server/src/singleton-pass.ts:4-15`). The start-time step takes the same gate. A
following spare (A947) that starts on a new release opens nothing and changes nothing: the gate
keeps it out, it is held dormant with no series of its own until promotion (A947 §2,
`packages/fiscal-verifactu/src/hour-dormant-standby.ts`), and the main box's rows it follows are
not its to change. When it is promoted, its activation writes the running release's identity.

- **Same producer, code and mode:** nothing. A679's rule that an ordinary update allocates nothing
  ([A679 design](2026-10-16-a679-hour-coded-series-design.md), "Restore, restart and first Live")
  still holds for every update that keeps the identity.
- **A different producer or code, or nothing stored:** the box opens a new installation itself, in
  one transaction. The final writes are the ones every activation makes
  (`packages/fiscal-verifactu/src/allocation.ts:432-461`): the old SIF row is revoked; the node's
  chain head is emptied, so the next record is the first of a new chain («PrimerRegistro» = S); the
  old invoice series are retired and new ones start at 1. Getting there is new work (next
  paragraph). The old chain is closed, never
  rewritten: records already made on it keep the identity they were made under and are sent
  unchanged (W41s's rule, "Retry the original stored fiscal content",
  [W41s design](2026-10-04-fiscal-prevention-and-offline-recovery-design.md) §4), so a backlog the
  old release left reaches AEAT under the old producer. The activation's record names no person;
  its operator is "identity change at release ‹version›", a new kind beside the recovery-key kind
  of W41s's 2026-10-12 decision.
- **A different compliance mode:** today the start refuses a node whose recorded filing module
  differs from the enabled one (§3, fact 5), and Spain has no second mode. A993 stores and compares
  the mode within the Veri\*Factu module now, so the comparison exists from the first chain.
  Turning a move between fiscal modules into a new installation, rather than a refusal, is designed
  with the first non-Veri\*Factu mode — which also needs the old module's backlog to keep draining —
  and so is the asesor question about it. **Decision recorded here**, not built now.
- **A different taxpayer NIF:** no product path changes it — the one writer of `tenants` changes
  only the legal name (`packages/provisioning/src/taxpayer-name.ts:9-19`;
  `grep -rn "update(tenants)" apps packages` finds no other) — so a difference means the database
  was changed outside the product. The box opens nothing and refuses to trade, naming the cause on
  the recovery page (proposed code `sif.taxpayer_changed`). **Decision, the conservative one:** a
  person finds out why before anything is filed.

**A new activation action, and why it is the only door without a person.** Today an hour-named
activation is accepted only through an operation a signed-in person makes: the fiscal module's
admission refuses `reauthentication_required` unless the operation carries an operator and its
action is one of `setup`, `restore`, `re-register` or `promote`
(`packages/fiscal-verifactu/src/allocation-envelope.ts:299-304`), refuses again when the held
operation has no operator (`:432`), and requires the four-symbol hour form, the code being exactly
`encodeHourIdentity` of the issue time (`:448`). A993 therefore needs three things, all in its
slice:

1. **A new action, `identity-change`**, beside the four.
2. **An authority with no person in it**, which only the start-time step can create, and only when
   the live SIF row's stored identity differs from the running release's (or has nothing stored).
   It is made inside the step's own transaction, bound to the node, the old SIF row's id and the
   running release's version, and used once. No route, operation host, recovery path or tool can
   ask for one: every other caller that offers `identity-change` is refused, and so is the step
   itself when the identities match. Each refusing case is proven by deletion (delete the check that
   the identities differ, or the check that the caller is the start-time step, and its case must
   fail), beside the case that must still pass: a start under a changed identity activates.
3. **The new name form** (the naming choice below; with the recommended one, A947's slice 4a teaches
   the admission the hour-and-minute form).

CLAUDE.md §5 says, in its re-registration rule, "the box does not mint an installation number from
its clock or a counter". That sentence stops being true, so the same A993 change amends it, to read:
"…the box does not mint an installation number from its clock or a counter, except at a start on
the filing node that finds the chain's stored identity missing or different from the running
release's (A993); no route, tool or person can request it." Installing such a release is what
triggers it. That edit is part of the fiscal pull request the owner reviews.

**What happens to an invoice issued under the old identity.** Its records already made go out
unchanged, under the old installation and producer: each record stores its own software block
(`sistemaInformatico: record.SistemaInformatico`, `packages/fiscal-verifactu/src/registro-row.ts:115`)
and the drain groups and sends rows per SIF row (`partition by r.sif_id`,
`packages/fiscal-verifactu/src/drain.ts:590`). But anything **new** about such an invoice after the
change — a cancellation, a corrective invoice, or a record appended after AEAT rejected the
original — is a new record, and it joins the box's current chain, under the new installation and
the new producer. AEAT's developer FAQ (§10, «Importación de facturas desde otro sistema», p. 20 —
a passage about importing invoices from another system, not about a change of producer): «la
responsabilidad del fabricante de un SIF
alcanza a los RFs de las facturas emitidas por el SIF que haya certificado, pero no alcanza en modo
alguno a los RFs correspondientes a facturas emitidas con otro SIF». So after a producer change, the
new producer would be issuing records about invoices another system issued. Whether that is
acceptable belongs in the asesor's existing question on the switch; this design asks for Q53(d)(2)
to be widened, not for a new question, to read: "(2) we read the change of producer as making a new
system, so every installation then running starts a new installation number and a new chain —
confirm, and what else it costs (each venue needs its new declaration; anything to notify?), **and
whether the new system may then record cancellations, corrective invoices and corrections of
rejected records for invoices the old system issued, or how those should be made**." The watcher
carries that wording into `asesor-questions.md`; until the asesor answers, A993 builds the
behaviour above and the release notes of an identity-changing release say so.

**The guard.** Before a record is added to a chain, the record builder compares the chain's stored
producer, code and mode with the running release's, and refuses on any difference (proposed code
`sif.identity_mismatch`, beside the existing `sif.not_registered` at
`packages/fiscal-verifactu/src/registro-sif.ts:180`). Records already on a closed chain are not
being added, so sending them is untouched. It is built test-first and proven by deletion: with the
comparison deleted, a case that changes the running identity without the start-time step must
fail because a sale chains under the old identity; and the case it must not refuse — the same
identity, a sale recorded — stays green.

**How the new installation is named: the one choice the box cannot make alone.** A679 names every
new installation by the current UTC hour, strictly later than every hour the box knows of, and
before choosing asks a person "Has anyone set up a Waitron box for this business in the last
hour?" — waiting until the next hour on Yes or "I don't know" (A679 design, "What you see and
keep"). That question is about the taxpayer's other venues, which a box starting on its own cannot
know. The installation number must still differ from every earlier installation of the taxpayer,
of any producer: «Deberá distinguirlo de otros posibles SIF utilizados para realizar la facturación
del obligado a expedir facturas … incluso aunque en dichas instalaciones se emplee el mismo SIF de
un productor» (Orden, annex block 2.6, `NumeroInstalacion`, read by eye). Three ways, put to the
owner as the revision's second question:

1. **Recommended: A947's promotion name** — the hour, a hyphen and the minute (`06XV-40`), with
   A947's check against every code the box knows
   ([A947 design](2026-10-21-a947-two-box-failover-design.md) §6.5, its slice 4a). No question and
   no wait for the next hour: normally the box takes the current minute and invoices again as soon
   as it has started. Not always at once: A947's rules 3 and 4 make it wait, up to about three
   minutes, when a name it knows is a little later than its clock, and refuse — naming the minute
   from which it will be allowed — when a known name is more than three minutes ahead. **Decision:**
   after such a refusal the box keeps running without issuing invoices and tries the change again
   by itself at the minute it named (and on its next start, if it restarts first); the dashboard
   shows that minute. No person is needed unless the clock check fails (below). Disclosed limit, as A947 discloses for its switches: two of the same
   taxpayer's venues changing identity in the same UTC minute, with the same series prefixes,
   would take the same names. The runbook (§5.4) has the main boxes of one taxpayer's venues
   upgraded one at a time. It depends on the owner approving A947's revision; today the only venue
   is the owner's own.
2. A679's four-symbol hour, taking the "I don't know" path: the box invoices nothing until the next
   UTC hour — up to an hour without invoices after the upgrade — and two boxes of one taxpayer
   changing identity in the same hour still collide.
3. A manager answers A679's question on the dashboard after the upgrade; the box invoices nothing
   until one does.

**The clock.** A start has no browser to compare with, so the box compares its own clock with the
authenticated internet reading A679 already uses (an AEAT or configured Waitron address, a
five-second limit). Installing a release pulls its image from the internet (§5.5), so the box is
normally online then. If the readings disagree by more than A679's 120 seconds, or none can be
taken, the change waits and the dashboard asks a manager to confirm the time with A679's own
dialog; until then the box issues no invoice. Disclosed: an offline first start on an
identity-changing release stops invoicing until a manager confirms the clock.

**Why no person has to approve it, when W41s asks one for a promotion.** W41s asks for a person
where another machine may still hold the identity being replaced. A declared restore needs the
administrator's statements that the old machine is offline and no other recovery is running, then
re-authentication (W41s §2 and §9.3). A promotion needs the manager's proof and the old main box
fenced (A947 §6.2). W41s allows an automatic switch only with an outside grant of sole selling
authority and the previous seller's acknowledged fencing (§9.3). None of that is in question at an
identity change: the same box, holding its venue folder's lock (one process owns a venue folder,
CLAUDE.md §3, `openVenueStore` in `packages/store/src/index.ts`), retires the identity only it
issued on and opens the next in the same transaction; no data is rewound (a start on an image
older than the database's migrations is refused, `assertNotAhead`, CLAUDE.md §3); and no other
machine's right to sell changes. The one case none of these paths can see — a cloned disk still
selling — is A679's own disclosed limit ("Old box returns or disk is cloned"). What W41s and A679
asked a person for that still applies is the naming question and the clock, handled above.

**How it fits A679.** The new installation is a new activation: the release floor, the
strictly-later rule, recording the name as spent before activating, and keeping production and
preproduction apart all apply unchanged. The one row of A679's table it changes is "Ordinary
reboot, update or exact publication Finish | Keep the existing activation": an update that changes
the identity is not ordinary.

**After the change.**

- The dashboard shows managers a notice, «Nueva instalación fiscal», with the old and new
  installation codes and the reason ("new producer in version 1.4.0"), and asks for the box's
  recovery sheet to be printed again: the sheet prints "only this node's current installation
  code", which the recovery form asks for (A679 design, "Owner PDF decisions, 2026-10-19").
  Reprinting allocates nothing (A679's table: "PDF download, print or key reissue | Allocate
  nothing"). **Requirement on A993: the step must not make a new recovery key.** Activation today
  writes none: the key's verifier is kept per node (`readBreakGlassVerifier(db, nodeId)`,
  `packages/db/src/deployment.ts:196`), `grep -rln setBreakGlassVerifier apps/server/src
  packages/*/src | grep -v '\.test\.'` lists only `packages/db` (which defines it),
  `apps/server/src/break-glass.ts`, `apps/server/src/recovery-document-api.ts` and
  `packages/provisioning/src/first-setup-node-key.ts`, and `grep -ci verifier
  packages/fiscal-verifactu/src/allocation*.ts` answers 0 for every file. But other paths do make
  one — adoption mints a key (`mintBreakGlassKey`, `apps/server/src/adopt.ts:152`) — so A993 must
  not reach any of them, and a case checks that the verifier is unchanged after the step.
  Whether an old sheet's printed code still lets a recovery through was not traced; the notice asks
  for a new sheet either way.
  (Picture 5.)
- The box keeps the old version's declaration (§7.3).
- A spare box (A947) follows the new rows and, not filing, opens nothing (above). Upgrade it in the
  same visit as its own venue's main box, before or after: a spare promoted while still on the old
  release would open under the old identity, and its next start on the new release would change it
  again. The "one at a time" rule is about the main boxes of different venues, which each file.
- Going back to an older release across an identity change would open yet another installation;
  the runbook says not to.

**Order.** A993 lands after slice 1, which gives the records the producer, and before the first
production venue goes live, so every production chain stores its identity from its first record.
Slice 1 itself changes the producer the records name (from the taxpayer to the owner); any
preproduction chain open then changes producer part-way through, in AEAT's test service only, and
opens a new chain at its first start on A993 because its row has nothing stored.

## 6. Inside the app, on every terminal

The box serves the running version's declaration at **`/legal/declaration`**, plus
`/legal/declaration.pdf` and `/legal/declaration.txt`, read from `/app/declaration/`. It needs no
sign-in and is mounted ahead of every mode's gates, like the guide pages, and also on the
plain-HTTP landing listener and the recovery listener (§7.2). Every terminal opens that page.

### 6.1 Dashboard

- **Signed in:** the account menu (the person icon) gains **About Waitron** between Language and
  Log out. It opens an About page: the version, the date it was released, the licence, and the
  declaration in full beneath, with "Download PDF" and "Plain text" links. (Picture 1.)
- **Signed out:** the sign-in screen's foot gains one quiet line, **Waitron 1.0.0 · Declaración
  responsable**, the link opening the same page. AEAT's FAQ asks for every terminal through which
  one can invoice or administer; the sign-in screen is the one place a dashboard user reaches
  without an account. (Picture 1.)

### 6.2 Counter till

The **More** menu (≡), which holds Log out on a counter till, gains **About Waitron**, last before
Log out. It opens the till's guide sheet over the screen with the same page, so idle sign-out keeps
working while it is open. The sheet gains a title property, so it reads "About Waitron · 1.0.0"
instead of its fixed guide title (`apps/till/src/widgets/guide-sheet.ts:89`). (Picture 2.)

### 6.3 Handheld and tablet

The More menu (≡) is always drawn on these, because Find bill always lives in it
(`apps/till/src/till-app.ts:17244-17253` always adds `find-bill`, `apps/till/src/widgets/till-shell.ts:501`). On a tablet
or wide handheld Log out sits in the operator menu, opened from the signed-in person's name; at
phone width the operator's items, Log out included, are laid out inside More
(`till-shell.ts:495`, `:868`). So **About Waitron** goes in More, as its very last entry (after the
language chooser when a narrow bar moves that into More), and is found in the same place at every
width. It opens the same sheet. (Picture 3.)

### 6.4 Kitchen screen, and a till before sign-in

A kitchen screen shows no menu, only a corner holding the theme and language choosers
(`till-shell.ts:990-993`). The corner gains a small **ⓘ** button. The lock (PIN) and pairing screens are drawn outside the
till shell (`apps/till/src/till-app.ts:18226-18232` for the chooser and pairing (enrol) screens,
`:18377` for the lock screen), so they get their own copy of the sheet
for their ⓘ. A kitchen screen cannot invoice, but the queue item asks for every terminal, and a PIN
screen is where a till sits most of the day. (Picture 3.)

### 6.5 The setup wizard

The wizard is where a box is first administered. Its header, which holds the language chooser
(`apps/setup/src/setup-app.ts:2064-2074`), gains the same **ⓘ**.

### 6.6 Language

The declaration is Spanish only, on every screen and in every interface language, because it is a
legal text with fixed Spanish wording (§2). The menu entry is translated like any other ("About
Waitron" / «Acerca de Waitron»). In English, the About page puts one line above the Spanish text:
"Waitron's statement of compliance with Spain's invoicing-software rules, in Spanish as the law
requires." No English translation of the declaration is published, so there is only one text to
approve and keep per version.

## 7. Outside the app

### 7.1 The release archive on GitHub

Each tag's GitHub Release carries `waitron-1.0.0-declaration.pdf` and
`waitron-1.0.0-declaration.txt`. The releases page is the public archive AEAT recommends
(«accesibles públicamente y localizables fácilmente a través de Internet»), and annex item 2.b)
links it. The repository is public (`gh repo view` on 2026-10-21: `"visibility":"PUBLIC"`). A
Release is kept when a version is withdrawn: it is marked "not recommended", never deleted.

A799 (upgrade testing) already chose GitHub Releases for its frozen fixture files, each on "that
release's own GitHub release"
([A799 design](2026-10-19-a799-real-database-upgrade-testing-design.md), 2026-10-19 addendum). The
declaration files sit beside them on the same Release.

The same addendum asks A799 to "design for the repository and releases becoming private". A
private repository's Releases are not public, so the archive would stop meeting AEAT's
recommendation. If the repository is ever made private, the declarations move to a public place
first (a small public repository or a web page), and the next version's annex item 2.b) names the
new address. The release runbook carries that as a check.

### 7.2 The box, before setup and while stopped

`/legal/declaration` answers on a box that has never been set up, so whoever unpacks it can read
it before entering any data. The plain-HTTP landing page that new devices reach first
(`http://waitron.local/`, `apps/server/src/landing-app.ts`) serves it too and links to it at its
foot — over plain HTTP, so a device that does not yet trust the box's certificate can read it
without a warning. The recovery listener serves it as well, so a box stopped by §5.1's refusal, or
by any failed start, still shows its declaration. B3's USB installer, when it is designed, copies
the PDF onto the stick beside the installer (a note for B3, not part of this build).

### 7.3 What the venue keeps

The venue must keep the declarations of the versions it upgrades away from (§2). The box keeps
them for it: when a box first starts a release it has not run before, it stores that version's
declaration text in the venue database, in a new append-only table owned by `fiscal-verifactu`
(`declaraciones_responsables`: version, text, first started at). The About page lists the earlier
versions this box has run, each opening its own text. Because the table lives in the venue
database, it travels with the backups and the bucket copy. This is the one part that adds a
migration (slice 5).

## 8. Guards

- **Records and declaration agree.** A test builds a sale record and the declaration for the same
  build, and compares items a), b), c), e), f), h) and i) with the record's fields. With §5.2's one
  source it fails only when someone bypasses the source; the test is what notices the bypass.
- **A published declaration never changes.** A root guard checks each
  `declarations/v*.md` whose tag exists against the file at that tag. CI's checkout must fetch the
  tags for it (a shallow checkout has none; the guard fails, not passes, when a released version's
  tag is missing).
- **The headings.** A test reads the title and every item heading from a rendered declaration and
  compares them with a fixed list typed once into the test: AEAT's worked example V0.5.1's
  headings with §4's three departures. Weaker than its name: it checks headings, not the values beside them.
- **Production refuses an unreleased build** (§5.1), with a refusing case and the case that must
  still start: a production box on a release.
- **Cancellations keep the taxpayer's name** (§3, fact 2): a case that records a cancellation
  after slice 1 and checks the submission header names the taxpayer, not the producer.
- **No record joins a chain opened under another identity** (§5.6, A993): proven by deleting the
  comparison, with the same-identity sale as the case it must still allow.
- **Only the start-time step activates without a person** (§5.6): every other caller offering
  `identity-change` is refused, and so is the step when the identities match, each proven by
  deletion; a following spare's start opens nothing.
- **A start on a changed identity opens a new installation** (§5.6): a case that starts the box
  under a release with a different producer and checks that the old SIF row is revoked, the old
  series retired, the next record is the first of a new chain and the old chain's unsent record is
  still sent with its old producer; and a case that starts under the same identity and checks that
  nothing is allocated.

## 9. What is NOT a release

So that "nothing continuous between releases" holds (the owner, §0):

- A push to `main`, a `:main` image, a branch built on a box. None carries a declaration, and a
  production box will not start on one.
- A change to documentation only. It changes no build, so it needs no new version.
- A hotfix is a release: `v1.0.1`, with its own declaration, however small (§2, «por pequeña
  variación que introduzca»).

## 10. Build order

Each slice is one pull request.

| Slice | What | Path |
| --- | --- | --- |
| 1 | `software-identity.ts`; the records carry the producer — the owner personally, his name and NIF, which he still has to supply — not the taxpayer; the name "Waitron"; the release's version; `TipoUsoPosibleSoloVerifactu` = S (unchanged), `TipoUsoPosibleMultiOT` = N (was S), `IndicadorMultiplesOT` = N (unchanged); the cancellation reader and the drain's grouping keep the taxpayer's name | FULL, **fiscal: the owner lands it** |
| 1b | **A993**, the automatic identity change (§5.6): each chain stores its producer and mode; every start compares; a difference opens a new installation; the guard; the dashboard notice | FULL, **fiscal: the owner lands it** |
| 2 | The template, `functions.md`, the renderer, the "agree" and "headings" guards, `pnpm release prepare` and `tag`, and the release runbook | FULL |
| 3 | `/legal/declaration` (HTML, PDF, plain text) in every mode and on the landing and recovery listeners; About Waitron on the dashboard, the till's More menu, the ⓘ corners and the setup wizard; guides in English and Spanish | LIGHT |
| 4 | CI on a `v*` tag: the version and the rendered declaration in the image, the PDF and text on the GitHub Release; `waitron.sh install v<version>` pulls the published image; production refuses an unreleased build; the "never changes" guard | FULL (the box's start path) |
| 5 | The box keeps every version's declaration it has run, and the About page lists them | FULL (adds a migration) |
| 6 | `@waitron/verifactu`'s own declaration, one per library release, in `waitron-io/verifactu` | That repository's own flow |
| — | Cut `v1.0.0` with `pnpm release`, once the owner approves the revision, the asesor has answered Q53 and the producer's three facts are in | The owner |

Slices 1, 2 and 6 can be built side by side. Slice 1b needs slice 1 and the owner's naming choice
(with the recommended choice, A947's slice 4a first), and lands before the first production venue
goes live. Slice 3 needs 2's renderer; slice 4 needs 2 and 3; slice 5 needs 3.

## 11. Questions for the owner — all four answered 2026-10-21

Asked one at a time through the campaign watcher; the original text is in the mock-ups folder's
`question.txt`, with the revision's own questions at its end.

1. **Who is the producer on the first declaration? Answered: A, the owner personally, now.** His
   full name, NIF and a postal address to publish are still to be supplied, by him or through the
   questions file; §4 keeps placeholders. His follow-ups: "when we switch to waitron sl, we bump
   the 2 character code (we control that, do we?), and does that automatically trigger a new
   chain? What restrictions are there on the 2 characters? Do we need to bump them every version or
   when?" — answered in §2 (ours to set; not per version; two characters, each A–Z or 0–9; the
   producer change alone makes a different system). Then: "Surely we should automate the new chain
   switch so that we never miss it when changing the system identity in the future?" — §5.6 and
   A993. The asesor questions these raise are already in Q53(d); none is added.
2. **The two yes/no answers. Answered: e) No, f) No — then e) revised to «S» at question 3.** On
   e) the owner first wrote: "The fiscal policy should be embedded in the country pack … But we can
   say that Waitron is designed so that a single installation will only ever use one fiscal
   policy." At question 3 he added "We don't support non verifactu yet", and the watcher recorded
   e) = «S» for this version as replacing the "No". f): "only one tax payer". So the records keep
   `TipoUsoPosibleSoloVerifactu = S` and change to `TipoUsoPosibleMultiOT = N`, with
   `IndicadorMultiplesOT = N` as today (slice 1). Consequence designed in §5.6: a move between
   fiscal policies is a new installation. The asesor confirms both in Q53(b) and (c).
3. **The wording. Answered: draft d) for hosting in the cloud too, and have the asesor check it.**
   "We don't support non verifactu yet. But you're also limiting the hardware to on prem when it
   could be running in the cloud. Draft what you think works then add that sentence to the
   assessor doc to be checked with them." The watcher's draft is Q53; §4's d) now uses it, and it
   stays a draft until the asesor answers. The rest of §4 stands. His further question, whether
   failing over from on site to the cloud needs a different code, is Q53(e).
4. **Production boxes run releases only. Answered: A**, "Releases only." §5.1 stands.

**The revision's questions** (in `question.txt`): approve the revised design; and how the
automatic identity change names its new installation (§5.6).

## 12. What this design does not settle, for the builder

- The release's PDF layout: plain A4, the fiscal package's font, the title centred, one item per
  paragraph. No logo.
- Whether `pnpm release` also writes release notes. Not required by law; left out.
- Whether a declaration is owed for a release only the owner runs. The owner's rule (§0) says no;
  the release step makes one anyway, because every tag gets one and the cost is a command.
- **The UK's no-filing mode and item e).** The same build ships `fiscal-none`, which setup does not
  offer yet (`availableForVenueSetup: false`, `packages/country-gb/src/united-kingdom.ts:13`). This
  design reads e) as being about the Reglamento's purposes — «a los efectos de cumplir con el
  Reglamento» — which a UK venue is outside, so that mode does not make e) «N». That is a reading,
  not a source; Q53(b) does not mention it. A release whose setup offers the UK re-reads it.
- **A move between fiscal modules** (Veri\*Factu to a future non-Veri\*Factu mode) as a new
  installation rather than a refused start: designed with that first mode (§5.6).
- **A move between compliance modes as a new installation** is Waitron's own conservative choice
  (the owner, Q2), not something a source requires: the developer FAQ calls an adapted system one
  system in either mode (§3, p. 7). For the asesor with the first non-Veri\*Factu mode, together
  with the design of that move (§5.6); not added to `asesor-questions.md` now.
- **«nos hacemos responsables»** in Q53's draft of d), for a producer who is one person: settled
  with the asesor's answer.
- **B3's note for A940** ([B3 design](2026-10-21-b3-usb-installer-design.md), "A note for
  A940") still applies to the new d): once the USB stick ships the operating system, d)'s «Linux y
  Docker» and its no-hardware sentence change with it. B3 cites this file's line numbers as they
  were before this revision; the sentences it points at are now in §4's item d) and §7.2.

## Provenance

| Source | Address | Used for |
| --- | --- | --- |
| AEAT, worked example V0.5.1 | https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf | §4's headings, item g)'s and k)'s wording, the person-producer substitutions |
| AEAT, page listing the example (one file listed on 2026-10-21) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html | That V0.5.1 is the current one |
| AEAT FAQ, «Certificación de los sistemas informáticos: declaración responsable», labelled «Actualizadas a 21 de octubre de 2026» | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html | Every version; no signature; inside and outside; keep all; item e); hardware; components; the two-character code (its «no se podrá repetir en otro SIF distinto del mismo productor» sentence re-fetched and found word for word on 2026-10-21, revision) |
| AEAT FAQ, general (sanction) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html | €1,000 per system without a declaration |
| Orden HAC/1177/2024, art. 15 and annex block 2.6 (consolidated text, last updated 28/10/2024; the annex is published as images and was read by eye) | https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138 | Title, items a)–l), annex 2.a)–d), where it must be, the records' twin fields; the code's restrictions pointer and `NumeroInstalacion`'s wording (§2, §5.6) |
| AEAT developer FAQ v1.3 §4, pp. 9–10, pinned copy | `docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf`, indexed in `docs/compliance/verifactu-faq-notes.md` §1–3; pages 9–10 re-read with `pdftotext` on 2026-10-21 | What identifies a system; a version is not a new system; the code unique only with the producer's NIF (§2, §5.6) |
| AEAT, «Validaciones» v1.2.2 (PDF dated 8 April 2026; SHA-256 `426eb926…3513440`) | https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf | §3.1.5, p. 17: the characters `IdSistemaInformatico` may hold (§2) |
| AEAT schema `SuministroInformacion.xsd`, the `verifactu` repository's copy at `2dc7609` | `schemas/SuministroInformacion.xsd:236`, `:665-669` | `IdSistemaInformatico` is `TextMax2Type`, no pattern (§2) |
| Real Decreto 1007/2023, art. 13 (consolidated text, last updated 03/12/2025) | https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840 | Who, every version, keep them all |

The raw quotes, with every heading of the worked example verbatim, were gathered on 2026-10-21
by downloading each source with `curl` and searching the text. The FAQ was relabelled the same
day; re-read it before cutting `v1.0.0`. For the revision, the «Validaciones» PDF was downloaded
with `curl` and its text extracted with `pdftotext`; the quote in §2 is from that text. The annex
2.6 wording quoted in §2 and §5.6 comes from the first draft's by-eye reading of the BOE's images,
not re-read for the revision.
