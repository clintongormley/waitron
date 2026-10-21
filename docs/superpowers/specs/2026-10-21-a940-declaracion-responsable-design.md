# A940 — The software's declaración responsable, inside the app and outside it

**Date:** 2026-10-21. **Status:** design, awaiting the owner's answers to four questions (§11).
Nothing in it is built. **Item:** A940.

**Mock-ups:** [`docs/backlog/mockups/a940-declaracion-responsable/`](../../backlog/mockups/a940-declaracion-responsable/README.md).

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

**Non-goals**

- Filing or registering the declaration. The law asks for neither (§2).
- An electronic signature. Not required (§2).
- A website for Waitron. The release archive lives on GitHub (§7); a website can link to it later.
- The licensing question still open with a lawyer (asesor question Q9(a): whether publishing the
  source counts as producing the software for whoever modifies it). It does not change who signs
  Waitron's own declaration: Waitron does, as decided on 2026-07-27
  ([asesor-questions.md](../../compliance/asesor-questions.md), Q9).

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
indicar qué componentes utiliza» and «se hará responsable del funcionamiento del mismo». A
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

**Language.** No rule found. The Orden fixes the title and the item wording in Spanish, so the
declaration is written in Spanish. Nothing found forbids a translation beside it; this design adds
none (§6.5).

**What it costs to have none.** AEAT's FAQ: «se sancionará con 1.000 euros por sistema
informático comercializado sin dicha certificación».

## 3. What exists today, and what is missing

There is no declaration, no About screen on any terminal, and no release (`git ls-remote --tags
origin` lists only `pre-sqlite-migration`; `gh api repos/clintongormley/waitron/releases --jq
length` answers `0`). Four facts from the code shape the design. Each was found by reading the
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
   at AEAT and the fix changes only what future records carry.
3. **The two usage flags are marked unverified in the code itself** (`backend.ts:58-61`): records
   send "only Veri\*Factu" = `S` and "several taxpayers" = `S`. Waitron keeps exactly one taxpayer
   per installation (the `tenants` table is a single row, CLAUDE.md §3), so "several taxpayers" =
   `S` looks wrong (§4, item f). "Only Veri\*Factu" = `S` looks right for a Spanish venue: Spain's
   common territory is mapped to `fiscal-verifactu` (`packages/country-es/src/spain.ts:300-310`),
   the other Spanish territories are refused, and `selectFiscalModule` forces the slot
   (`packages/module/src/fiscal-slot.ts:37-47`). The same build also ships `fiscal-none`, which
   files nothing and is what a UK venue gets (`packages/country-gb/src/united-kingdom.ts:21`).
   Whether shipping that mode for other countries makes the product one that "can also work as NO
   VERI\*FACTU" is a legal reading, not a code fact; question 2 asks it.
4. **The name sent is "Waitron POS"** (`backend.ts:72`), while the product is called "Waitron"
   everywhere it is distributed (`README.md:1`). Item a) is «la denominación genérica dada al
   mismo para su distribución o comercialización», and the records' field will say the same.

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
`v*` tag is pushed (`.github/workflows/ci.yml:2758-2760`).

## 4. The declaration's text

Drafted from AEAT's worked example (V0.5.1, the only one AEAT publishes; its one example is
software sold for Veri\*Factu-only use by a Spanish company). **The headings are the example's,
word for word**: the example is AEAT's own rendering of art. 15.1's items as headings («esta
declaración responsable», «el apartado a)»), and the Orden's text describes each item rather than
giving a heading to copy. The explanatory sentences the Orden adds to items a), b) and l) are
not headings and are left out, as the example leaves them out.

Values marked ‹…› are filled in later: the producer's facts by the owner (question 1, §11), and
the version, the library version, the functions list and the date by the release step (§5). Where
the producer is a person rather than a company, AEAT's example says to write «Nombre y apellidos
de la persona productora» in h) and «persona productora» for «entidad productora» in i)–l). The
draft below is written for a person, because that is the producer today
([action-plan.md](../../compliance/action-plan.md), Step 6).

> **DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN**
>
> **a) Nombre del sistema informático a que se refiere esta declaración responsable:**
> Waitron
>
> **b) Código identificador del sistema informático a que se refiere el apartado a) de esta
> declaración responsable:** W1
>
> **c) Identificador completo de la versión concreta del sistema informático a que se refiere
> esta declaración responsable:** ‹1.0.0›
>
> **d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> Waitron es un software de punto de venta para restaurantes y bares. Se instala en un equipo
> servidor del propio usuario, situado en su establecimiento, y los terminales del
> establecimiento se conectan a él por la red local.
>
> Componentes software de esta versión, todos del mismo productor salvo que se indique:
> - El servidor de Waitron, que guarda los datos del establecimiento, genera y encadena los
>   registros de facturación, calcula su huella, los conserva y los remite automáticamente a la
>   Agencia Tributaria.
> - La biblioteca @waitron/verifactu, versión ‹x.y.z›, del mismo productor y con su propia
>   declaración responsable. El servidor la usa en cada registro de facturación para formar el
>   registro, calcular su huella y preparar su envío.
> - Las aplicaciones de caja, terminal de mano, pantalla de cocina y panel de gestión, que el
>   servidor sirve a un navegador web. Los terminales no generan registros de facturación.
> - El agente de impresión, que envía tickets y facturas a las impresoras.
> - Componentes de terceros de los que el productor se hace responsable: Node.js ‹versión›, con
>   su motor de base de datos SQLite, que guarda los registros y bloquea su modificación;
>   Litestream ‹versión›, que mantiene la copia de seguridad cuando el usuario la configura; y el
>   sistema operativo Linux con Docker sobre el que se instala.
>
> Servicios opcionales del mismo productor que esta versión puede usar: ‹ninguno, o la lista que
> compruebe el paso de publicación›.
>
> Componentes hardware: ninguno forma parte del producto. El servidor funciona en cualquier
> equipo que cumpla los requisitos mínimos de este software.
>
> Funcionalidades principales: ‹la lista que compruebe el paso de publicación; en la rama
> principal el 21 de octubre de 2026: toma de pedidos por mesa o en barra, cobro en efectivo y con
> tarjeta, expedición de facturas simplificadas, facturas rectificativas, consulta de las facturas
> emitidas, cierre de caja e informes de ventas›.
>
> Cada instalación lleva la facturación de un único obligado tributario.
>
> **e) Indicación de si el sistema informático a que se refiere esta declaración responsable se
> ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda
> funcionar exclusivamente como «VERI\*FACTU»:** S - Sí
>
> **f) Indicación de si el sistema informático a que se refiere la declaración responsable
> permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la
> facturación de varios obligados tributarios:** N - No
>
> **g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso
> de que el sistema informático a que se refiere esta declaración responsable no sea utilizado
> como «VERI\*FACTU».** Dado que se trata de un producto de facturación que solo puede ser
> utilizado exclusivamente en la modalidad de «VERI\*FACTU», no se realiza una firma electrónica
> expresa de los registros de facturación generados, ya que la normativa considera que quedan
> firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia Tributaria
> con la debida autenticación mediante el adecuado certificado electrónico cualificado.
>
> **h) Nombre y apellidos de la persona productora del sistema informático a que se refiere
> esta declaración responsable:** ‹nombre y apellidos›
>
> **i) Número de identificación fiscal (NIF) español de la persona productora del sistema
> informático a que se refiere esta declaración responsable:** ‹NIF›
>
> **j) Dirección postal completa de contacto de la persona productora del sistema informático a
> que se refiere esta declaración responsable:** ‹calle, número, código postal, localidad
> (provincia), España›
>
> **k)** La persona productora del sistema informático a que se refiere esta declaración
> responsable hace constar que dicho sistema informático, en la versión indicada en ella, cumple
> con lo dispuesto en el artículo 29.2.j) de la Ley 58/2003, de 17 de diciembre, General
> Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y
> programas informáticos o electrónicos que soporten los procesos de facturación de empresarios
> y profesionales, y la estandarización de formatos de los registros de facturación, aprobado
> por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, de 17 de octubre,
> y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello
> que complete las especificaciones de dicha orden.
>
> **l)**
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
>
> **2.d) Otra información:** La lista completa de componentes de terceros que incluye esta
> versión, con sus licencias, se encuentra en el propio sistema, en la carpeta /app/third-party/.

**In English, briefly.** a) Waitron. b) W1, the code the records already carry. c) The release's
version. d) What it is (a restaurant point of sale on the venue's own server, reached by the
venue's tills over the local network), its own parts, the third-party parts it takes
responsibility for, any optional services of ours it uses, no hardware of its own, its main
functions, and one taxpayer per installation. e) Yes, only Veri\*Factu. f) No, one taxpayer.
g) Signs nothing itself, because a Veri\*Factu-only system's records count as signed when sent
with a qualified certificate — AEAT's example's words, unchanged. h)–j) Who the producer is and
where to write to them. k) The fixed compliance statement. l) Date and place of signing. Annex: an
email address, the archive of every version's declaration, and where the full third-party list
lives.

**Choices made in the draft, each for the owner's approval in question 3:**

- **Item a) says "Waitron", not "Waitron POS".** The records' name field changes to match
  (§3, fact 4).
- **Item f) says N.** One installation holds one taxpayer by construction, and the records change
  from `S` to `N` to match (§3, fact 3). AEAT's annex wording for the twin field: «permite llevar
  independientemente la facturación de varios obligados tributarios (valor "S") o solo de uno
  (valor "N")». A future Waitron that hosts several taxpayers in one installation would be a new
  version with its own declaration saying S.
- **Item e) says S**, as the records already do, subject to question 2.
- **The functions list is filled in per release and checked route by route.** On main on
  2026-10-21: simplified invoices (F2) are issued; corrective invoices are reached through
  `apps/server/src/cancel-credit.ts`; every full-invoice request is refused
  (`apps/server/src/till-sale.ts:516`, `apps/server/src/working-order.ts:4180-4191`); and no
  route records a cancellation or a substitute invoice (`docs/backlog.md`, fiscal area: \"No till screen or
  server route calls `recordVoid` yet", and "no route calls `recordSubstitution`"). So full and
  substitute invoices and cancellations are not listed. A release that turns one on lists it.
- **The third-party parts that do legal work are named:** Node.js and its SQLite engine (the
  triggers that refuse a change to a filed record, CLAUDE.md §5) and Litestream (the backup
  stream). The full list stays in `/app/third-party/`, which already ships with every image.
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
makes "each version a venue runs has its declaration" a check rather than a habit (question 4).

### 5.2 One source for what the records say and what the declaration says

A new file, `packages/fiscal-verifactu/src/software-identity.ts`, holds the product's own facts:
the name, the two-character code, the two usage flags and the producer's name and identifier.
`buildSistemaInformatico` reads it, and so does the declaration renderer. The version comes from
the build (§5.4). So items a), b), c), e), f), h) and i) and their twin record fields are written
from the same values.

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
  `@waitron/fiscal-verifactu` (the composition rule at `packages/composition/src/modules.ts:107-112`).
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
   file, the version, the bundled `@waitron/verifactu`, Node.js and Litestream versions, the
   functions and optional-services lists from `declarations/functions.md`, and today's date in
   Europe/Madrid, in the Orden's order «día, mes y año».
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
is gone or refused comes off, a new one goes on; the optional-services list names every service of
ours the version can call in production; AEAT's FAQ and worked example are re-read for changes;
and the repository is still public (§7.1).

### 5.5 How a box runs a release

Today `waitron.sh install <ref>` pulls images only for `main` and builds any other ref on the box
(`deploy/waitron.sh:324-353`). A release must run the image CI published for its tag, because that
is the build the declaration describes. So `waitron.sh install v1.0.0` pulls
`ghcr.io/clintongormley/waitron:1.0.0` (slice 4).

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

On these the More menu appears only when bar items overflow
(`apps/till/src/widgets/till-shell.ts:493-503`, `:1008`), and Log out lives in the operator menu,
opened from the signed-in person's name (`till-shell.ts:735-842`). So **About Waitron** goes in the
operator menu, last before Log out, and opens the same sheet. (Picture 3.)

### 6.4 Kitchen screen, and a till before sign-in

A kitchen screen shows no menu, only a corner holding the theme and language choosers, and draws
that corner only when a language list is wired in (`till-shell.ts:990-993`). The corner gains a
small **ⓘ** button and is drawn always. The lock (PIN) and pairing screens are drawn outside the
till shell (`apps/till/src/till-app.ts:18226`, `:18371`), so they get their own copy of the sheet
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
  compares them with AEAT's worked example V0.5.1, typed once into the test from the provenance
  source. Weaker than its name: it checks headings, not the values beside them.
- **Production refuses an unreleased build** (§5.1), with a refusing case and the case that must
  still start: a production box on a release.
- **Cancellations keep the taxpayer's name** (§3, fact 2): a case that records a cancellation
  after slice 1 and checks the submission header names the taxpayer, not the producer.

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
| 1 | `software-identity.ts`; the records carry the producer (not the taxpayer), the name "Waitron", the release's version, and the flags question 2 settles; the cancellation reader and the drain's grouping keep the taxpayer's name | FULL, **fiscal: the owner lands it** |
| 2 | The template, `functions.md`, the renderer, the "agree" and "headings" guards, `pnpm release prepare` and `tag`, and the release runbook | FULL |
| 3 | `/legal/declaration` (HTML, PDF, plain text) in every mode and on the landing and recovery listeners; About Waitron on the dashboard, the till's More and operator menus, the ⓘ corners and the setup wizard; guides in English and Spanish | LIGHT |
| 4 | CI on a `v*` tag: the version and the rendered declaration in the image, the PDF and text on the GitHub Release; `waitron.sh install v<version>` pulls the published image; production refuses an unreleased build; the "never changes" guard | FULL (the box's start path) |
| 5 | The box keeps every version's declaration it has run, and the About page lists them | FULL (adds a migration) |
| 6 | `@waitron/verifactu`'s own declaration, one per library release, in `waitron-io/verifactu` | That repository's own flow |
| — | Cut `v1.0.0` with `pnpm release`, after the owner approves the wording | The owner |

Slices 1, 2 and 6 can be built side by side. Slice 3 needs 2's renderer; slice 4 needs 2 and 3;
slice 5 needs 3.

## 11. Questions for the owner

One at a time, each with a worked example; the full text is in the mock-ups folder's
`question.txt`.

1. **Who is the producer on the first declaration, and what tax number and address does it
   publish?** It goes on every box and on the public GitHub page, and the name and tax number go
   into every invoice record AEAT receives. Recommended: you personally, now; a company's
   declaration comes with the first release after the company exists — and at that release every
   new record names the company instead, part-way through a running chain, which the asesor
   should confirm is fine.
2. **The two yes/no answers:** "only Veri\*Factu" = S and "several taxpayers" = N. Recommended:
   as drafted, and ask the asesor to confirm both in the next batch, including whether the UK's
   no-filing mode in the same build changes "only Veri\*Factu".
3. **The wording.** Approve §4's text, or change it. Recommended: approve as drafted, with the
   facts from question 1 filled in.
4. **Production runs releases only.** Recommended: a production box refuses to start on a build
   that is not a tagged release, and `waitron.sh install v1.0.0` pulls the published image.

## 12. What this design does not settle, for the builder

- The release's PDF layout: plain A4, the fiscal package's font, the title centred, one item per
  paragraph. No logo.
- Whether `pnpm release` also writes release notes. Not required by law; left out.
- Whether a declaration is owed for a release only the owner runs. The owner's rule (§0) says no;
  the release step makes one anyway, because every tag gets one and the cost is a command.

## Provenance

| Source | Address | Used for |
| --- | --- | --- |
| AEAT, worked example V0.5.1 | https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf | §4's headings, item g)'s and k)'s wording, the person-producer substitutions |
| AEAT, page listing the example (one file listed on 2026-10-21) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html | That V0.5.1 is the current one |
| AEAT FAQ, «Certificación de los sistemas informáticos: declaración responsable», labelled «Actualizadas a 21 de octubre de 2026» | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html | Every version; no signature; inside and outside; keep all; item e); hardware; components; the two-character code |
| AEAT FAQ, general (sanction) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html | €1,000 per system without a declaration |
| Orden HAC/1177/2024, art. 15 and annex block 2.6 (consolidated text, last updated 28/10/2024; the annex is published as images and was read by eye) | https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138 | Title, items a)–l), annex 2.a)–d), where it must be, the records' twin fields |
| Real Decreto 1007/2023, art. 13 (consolidated text, last updated 03/12/2025) | https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840 | Who, every version, keep them all |

The raw quotes, with every heading of the worked example verbatim, were gathered on 2026-10-21
by downloading each source with `curl` and searching the text. The FAQ was relabelled the same
day; re-read it before cutting `v1.0.0`.
