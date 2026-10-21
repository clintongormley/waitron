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

The owner, on 2026-10-21 at about 04:00, set the shape:

> It is needed only when a version is released. Each release that someone other than the owner
> will run gets its own declaration, published before that version is used, and kept with the
> release; the in-app screen shows the running version's one. The first one owed is for the
> version the first venue runs. Nothing continuous between releases.

(The queue's paraphrase of the owner's words, recorded in lane A's queue, A940.)

The first venue is the owner's own restaurant company. That company is a different legal person
from the owner, so its version is the first one owed a declaration.

## 1. Goals and non-goals

**Goals**

1. A declaration text, drafted from AEAT's worked example with Waitron's real facts, that the
   owner approves word for word (§4).
2. One declaration per released version, produced by the release step, frozen once published,
   and kept forever (§5).
3. On every terminal — counter till, handheld, tablet, kitchen screen and dashboard — a menu
   entry that opens the running version's declaration in two taps (§6).
4. Outside the software: the box serves the declaration before setup, and each release publishes
   it as a PDF and plain text (§7).
5. What the invoice records tell AEAT about the software agrees with what the declaration says,
   and cannot drift apart (§3, §8).

**Non-goals**

- Filing or registering the declaration. The law asks for neither (§2, source 4.5).
- An electronic signature. Not required (§2, source 4.2).
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
order, each value preceded by the Orden's own wording for it:

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

**Where it must be.** Orden art. 15.3: «disponible de manera legible e individualizada dentro
del propio sistema informático … y ser accesible por el usuario de forma rápida, fácil e
intuitiva». AEAT's FAQ makes "inside" concrete: the current version's declaration must be
reachable «desde cualquier punto de acceso o terminal conectado a dicho SIF a través del cual se
pueda facturar o administrar el SIF», and recommends «una opción específica dentro de algún menú,
como por ejemplo "Ayuda" … al lado de … "Acerca de"». Only the running version's has to be inside.
And "outside": readable «sin necesidad de tener que instalar y poner en funcionamiento el
producto», in «un formato de uso ampliamente extendido y gratuito, como el texto puro, PDF o
similar».

**It must match the records.** For item e), AEAT's FAQ: a Veri\*Factu-only system «deberá
indicar una "S" tanto en la Certificación (letra e) como en el campo correspondiente
("TipoUsoPosibleSolo VERI\*FACTU") dentro de los registros de facturación generados». The same
holds by construction for a), b), c), f), h) and i): each has a twin field in the
`SistemaInformatico` block of every invoice record (Orden, annex block 2.6).

**Language.** No rule found. The Orden fixes the title and the item wording in Spanish, so the
declaration is written in Spanish. Nothing found forbids a translation beside it; this design adds
none (§6.4).

**What it costs to have none.** AEAT's FAQ: «se sancionará con 1.000 euros por sistema
informático comercializado sin dicha certificación».

## 3. What exists today, and what is missing

There is no declaration, no About screen on any terminal, and no release. Four facts from the
code shape the design. Each was found by reading the source, not by running it; the citations are
the receipts.

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
   path (#12). One reader depends on it: a cancellation reads its issuer name back from that block
   (`packages/fiscal-verifactu/src/registro-row.ts:158-161`). Nothing has been filed in production
   yet, so no wrong record is on AEAT's side; the fix changes what future records carry.
3. **The two usage flags are marked unverified in the code itself** (`backend.ts:58-61`): records
   send "only Veri\*Factu" = `S` and "several taxpayers" = `S`. Waitron keeps exactly one taxpayer
   per installation (the `tenants` table is a single row, CLAUDE.md §3), so "several taxpayers" =
   `S` looks wrong (§4, item f). "Only Veri\*Factu" = `S` looks right: within Spain's common
   territory the box files under `fiscal-verifactu`, and the other fiscal module, `fiscal-none`,
   writes nothing at all and is chosen by the venue's territory
   (`packages/composition/src/modules.ts:120-124`). That a common-territory venue can never be
   provisioned with `fiscal-none` was not checked; slice 1 checks it (§10).
4. **The name sent is "Waitron POS"** (`backend.ts:72`), while the product is called "Waitron"
   everywhere it is distributed (`README.md:1`). Item a) is «la denominación genérica dada al
   mismo para su distribución o comercialización», and the record's twin field must say the same.

Facts 1–4 are fiscal changes: they change what every invoice record tells AEAT. None of them
touches the record's fingerprint, the chain, the series or the numbering: the fingerprint string
is built from the issuer's NIF, the invoice number and date, the type, the tax and total amounts,
the previous fingerprint and the timestamp, and no field of this block (`buildCadenaAlta` and
`buildCadenaAnulacion` in `@waitron/verifactu` 0.2.1, `dist/huella.js`). By
the owner's rule of 2026-10-21, a pull request that changes what AEAT receives is finished to green
and left for the owner to land. They come first, because the first declaration must match them.

What helps: the box already serves pages before anyone signs in. `/help/<language>/<page>` is
mounted ahead of every mode's gates (`apps/server/src/boot.ts:984-1003`), so it answers in setup
mode and in trading mode. The till already has a sheet that shows a box page over any screen
(`apps/till/src/widgets/guide-sheet.ts`). `packages/fiscal-verifactu` already draws PDFs
(`pdfkit`, `pdf-lib`, its own font). CI already publishes an image tagged with the version when a
`v*` tag is pushed (`.github/workflows/ci.yml:2758-2760`), and no such tag exists yet.

## 4. The declaration's text

Drafted from AEAT's worked example (V0.5.1, the only one AEAT publishes; its one example is
software sold for Veri\*Factu-only use by a Spanish company). The headings are the Orden's own
words, as art. 15.1 requires. Values marked ‹…› are facts only the owner can give (question 1,
§11). Values for the first release are shown; the release step fills in c) and l).

Where the producer is a person rather than a company, AEAT's example says to write «Nombre y
apellidos de la persona productora» in h) and «persona productora» for «entidad productora» in
i)–l). The draft below is written for a person, because that is the producer today
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
> esta declaración responsable:** 1.0.0
>
> **d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> Waitron es un software de punto de venta para restaurantes y bares. Se instala en un equipo
> servidor del propio usuario, situado en su establecimiento, y los terminales del
> establecimiento se conectan a él por la red local.
>
> Componentes software, todos de esta versión:
> - El servidor de Waitron, que guarda los datos del establecimiento, genera y encadena los
>   registros de facturación, calcula su huella, los conserva y los remite automáticamente a la
>   Agencia Tributaria. Incluye la biblioteca @waitron/verifactu, del mismo productor, en la
>   versión ‹x.y.z›.
> - Las aplicaciones de caja, terminal de mano, pantalla de cocina y panel de gestión, que el
>   servidor sirve a un navegador web. Los terminales no generan registros de facturación.
> - El agente de impresión, que envía tickets y facturas a las impresoras.
>
> Componentes hardware: ninguno forma parte del producto. El servidor funciona en cualquier
> equipo que cumpla los requisitos mínimos de este software, con Linux y Docker.
>
> Funcionalidades principales: toma de pedidos por mesa o en barra, cobro en efectivo y con
> tarjeta, expedición de facturas simplificadas y completas, facturas rectificativas y
> sustitutivas, anulación de registros de facturación, consulta de facturas y del estado de su
> envío a la Agencia Tributaria, e informes de ventas.
>
> Cada instalación lleva la facturación de un único obligado tributario.
>
> **e) Indicación de si el sistema informático a que se refiere esta declaración responsable se
> ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda
> funcionar exclusivamente como «VERI\*FACTU»:** S - Sí
>
> **f) Indicación de si el sistema informático a que se refiere esta declaración responsable
> permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la
> facturación de varios obligados tributarios:** N - No
>
> **g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso
> de que el sistema informático a que se refiere esta declaración responsable no sea utilizado
> como «VERI\*FACTU»:** Dado que se trata de un sistema que solo puede funcionar como
> «VERI\*FACTU», no realiza una firma electrónica expresa de los registros de facturación, que
> quedan firmados al ser remitidos correctamente a los servicios electrónicos de la Agencia
> Tributaria con el certificado electrónico cualificado del obligado tributario.
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
> **2.d) Otra información:** La lista de componentes de terceros que incluye esta versión, con
> sus licencias, se encuentra en el propio sistema, en la carpeta /app/third-party/.

**In English, briefly.** a) Waitron. b) W1, the code the records already carry. c) The release's
version. d) What it is (a restaurant point of sale installed on the venue's own server, reached by
the venue's tills over the local network), its software parts, no hardware of its own, its main
functions, and one taxpayer per installation. e) Yes, only Veri\*Factu. f) No, one taxpayer.
g) Signs nothing itself, because a Veri\*Factu-only system's records count as signed when sent
with the taxpayer's certificate. h)–j) Who the producer is and where to write to them. k) The
fixed compliance statement. l) Date and place of signing. Annex: an email address, the archive of
every version's declaration, and where the third-party component list lives.

**Choices made in the draft, each for the owner's approval in question 3:**

- **Item a) says "Waitron", not "Waitron POS".** The records' name field changes to match
  (§3, fact 4).
- **Item f) says N.** One installation holds one taxpayer by construction, and the records change
  from `S` to `N` to match (§3, fact 3). AEAT's annex wording for the twin field: «permite llevar
  independientemente la facturación de varios obligados tributarios (valor "S") o solo de uno
  (valor "N")». A future Waitron that hosts several taxpayers in one installation would be a new
  version with its own declaration saying S.
- **Item e) says S**, as the records already do. This rests on fact 3's unchecked half; slice 1
  checks it before the first release.
- **No hardware.** AEAT's FAQ: generic hardware is not certified, only hardware sold as part of
  «un "todo"» or hardware that itself meets a requirement. If Waitron later sells a box as part
  of the product, item c) must list the box's version too, software first («Se puede empezar por
  el software y continuar con el hardware»), and that is a new declaration.
- **The `@waitron/verifactu` library is listed as a component, with no declaration of its own.**
  It is the same producer's work, built into this version. The Orden's art. 15.4 asks for separate
  declarations only from other producers. Anyone else who builds the library into their own
  software is that software's producer and declares it (AEAT's FAQ on open-source code: «La
  empresa que efectúe la programación del código o integre partes de otro software … debe realizar
  la declaración responsable»).
- **The recommended annex item 2.c) is left out.** It is a "detailed explanation of how the
  system meets the Orden". Every sentence in it is a claim about the code, re-checked at every
  release; leaving it out costs nothing legally. It can be added in a later version.
- **The features listed in d) are the ones on main on 2026-10-21.** The release step re-reads
  this list against the release (§5).

## 5. One declaration per release: where it lives and how a release makes it

### 5.1 What a release is

A **release** is a `v<major>.<minor>.<patch>` git tag on `main`, for example `v1.0.0`. Its
version, without the `v`, is item c) and the `Version` field of every record that build files.

Every build a venue runs in production is a release. A build from `main` without a tag is not:
it carries the version `0.0.0-dev+<commit>` and no declaration. A box set to
`WAITRON_ENV=production` refuses to start trading on a build that is not a release, with the
recovery page's code `provisioning.unreleased_build` and its fixed title and action ("This box is
running a test build. Install a release."). Preproduction and development boxes run any build.
This is what makes "each version a venue runs has its declaration" a check rather than a habit.

### 5.2 One source for what the records say and what the declaration says

A new file, `packages/fiscal-verifactu/src/software-identity.ts`, holds the product's own facts:
the name, the two-character code, the two usage flags and the producer's name and identifier.
`buildSistemaInformatico` reads it, and so does the declaration generator. The version comes from
the build (§5.4). So items a), b), c), e), f), h) and i) and their twin record fields are written
from the same values, and cannot disagree.

### 5.3 Where each version's text lives

- **The template:** `packages/fiscal-verifactu/declaracion/plantilla.md`, Spanish, in the fiscal
  package where Spanish is allowed (CLAUDE.md §3, "General code is English only"). It holds the
  fixed wording of §4, with slots for the facts from `software-identity.ts`, the version, the
  library version, the date and the place.
- **Each released version's text:** `packages/fiscal-verifactu/declaracion/v1.0.0.md`, one file
  per release, written by the release step and committed in the release commit. Once its tag is
  pushed, a file is never edited again. Git keeps every one, which is the producer's duty to keep
  them all (RD art. 13.3). A guard (§8) fails if a published file changes.
- **The released PDF and plain text** are made from that file and attached to the GitHub Release
  (§7.1).

### 5.4 The release step

A release is cut by hand, by the owner or a lane on the owner's instruction, with one command
from a clean checkout of `main`:

```
pnpm release 1.0.0 --place "‹localidad›"
```

`scripts/release.mjs` does, in order, and stops at the first failure:

1. Refuses unless `main` is clean, up to date, and its last CI run is green.
2. Refuses if `v1.0.0` already exists, or if `1.0.0` is not greater than the last release.
3. Writes `declaracion/v1.0.0.md` from the template, the identity file, the version, the bundled
   `@waitron/verifactu` version and today's date in the box's time zone, in the Orden's order
   «día, mes y año».
4. Prints the whole declaration and asks for a typed `yes`. This is the producer signing.
5. Commits it (`git commit -s`, "Release 1.0.0") and tags `v1.0.0`.
6. Pushes the commit and the tag.

CI, on the tag (§7.1), builds and publishes the image with the version baked in, makes the PDF
and the plain text, and attaches both to a GitHub Release named `1.0.0`.

What the release step does NOT check: whether item d)'s feature list still describes the
software. That is a reading task, listed in the release runbook (`docs/operations/release.md`,
written in slice 2) as the step before running the command.

### 5.5 How a box runs a release

Today `waitron.sh install <ref>` pulls images only for `main` and builds any other ref on the box
(`deploy/waitron.sh:324-353`). A release must run the image CI published for its tag, because that
is the build the declaration describes. So `waitron.sh install v1.0.0` pulls
`ghcr.io/clintongormley/waitron:1.0.0` (slice 4). The image carries the version
(`WAITRON_VERSION`) and its declaration file, next to the existing commit stamp.

## 6. Inside the app, on every terminal

The box serves the running version's declaration as a page of its own,
`/legal/declaracion-responsable`, plus `.pdf` and `.txt` versions of the same text. Like the
guide pages, it is mounted ahead of every mode's gates, needs no sign-in, and has a strict content
policy. Every terminal opens that page. Picture by picture:

### 6.1 Dashboard

- **Signed in:** the account menu (the person icon) gains **About Waitron** between Language and
  Log out. It opens an About page: the version, the date it was released, the licence, and the
  declaration in full beneath, with "Download PDF" and "Plain text" links. (Picture 1.)
- **Signed out:** the sign-in screen's foot gains one quiet line, **Waitron 1.0.0 · Declaración
  responsable**, the link opening the same page. AEAT's FAQ asks for every terminal through which
  one can invoice or administer; the sign-in screen is the one place a dashboard user reaches
  without an account. (Picture 1.)

### 6.2 Counter till, handheld and tablet

The **More** menu (≡) gains **About Waitron**, last before Log out. It opens the till's existing
guide sheet over the screen with the same page, so idle sign-out keeps working while it is open.
(Picture 2.)

### 6.3 Kitchen screen, and a till before sign-in

These show no menu, only a corner holding the theme and language choosers
(`apps/till/src/widgets/till-shell.ts:990-993`; the lock and pairing screens have the same corner).
That corner gains a small **ⓘ** button that opens the same sheet. A kitchen screen cannot
invoice, but the queue item asks for every terminal, and a PIN screen is where a till sits most of
the day. (Picture 3.)

### 6.4 Language

The declaration is Spanish only, on every screen and in every language the interface is set to,
because it is a legal text with fixed Spanish wording (§2). The menu entry is translated like any
other ("About Waitron" / «Acerca de Waitron»). In English, the About page puts one line above the
Spanish text: "Waitron's statement of compliance with Spain's invoicing-software rules, in
Spanish as the law requires." No English translation of the declaration is published, so there is
only one text to approve and keep per version.

## 7. Outside the app

### 7.1 The release archive on GitHub

Each tag's GitHub Release carries `declaracion-responsable-waitron-1.0.0.pdf` and
`declaracion-responsable-waitron-1.0.0.txt`. The releases page is the public archive AEAT
recommends («accesibles públicamente y localizables fácilmente a través de Internet»), and annex
item 2.b) links it. The repository is public (checked with `gh repo view` on 2026-10-21:
`"visibility":"PUBLIC"`). A Release is kept when a version is withdrawn: it is marked "not
recommended", never deleted.

A799 (upgrade testing) already chose GitHub Releases for its frozen fixture files, each on
"that release's own GitHub release"
([A799 design](2026-10-19-a799-real-database-upgrade-testing-design.md), 2026-10-19 addendum).
The declaration files sit beside them on the same Release.

The same addendum asks A799 to "design for the repository and releases becoming private". A
private repository's Releases are not public, so the archive would stop meeting AEAT's
recommendation. If the repository is ever made private, the declarations move to a public place
first (a small public repository or a web page), and the next version's annex item 2.b) names the
new address. The release runbook (slice 2) carries that as a check: "Is the repository still
public?"

### 7.2 The box, before setup

`/legal/declaracion-responsable` answers on a box that has never been set up, so whoever unpacks
it can read it before entering any data. The plain-HTTP landing page that new devices reach first
(`http://waitron.local/`, `apps/server/src/landing-app.ts`) gains a link to it at the foot. B3's
USB installer, when it is designed, copies the PDF onto the stick beside the installer (a note for
B3, not part of this design's build).

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
  source this cannot fail unless someone bypasses the source; the test is what notices the bypass.
- **A published declaration never changes.** A root guard lists `declaracion/v*.md` and checks
  each file against the blob at its tag; it fails if a released file was edited.
- **The template's fixed wording.** A test reads the title and every item heading from a rendered
  declaration and compares them with the Orden's words, typed once into the test from §2's
  sources. Weaker than its name: it checks headings, not the values beside them.
- **Production refuses an unreleased build** (§5.1), with a refusing case and the case that must
  still start: a production box on a release.

## 9. What is NOT a release

So that "nothing continuous between releases" holds (the owner, §0):

- A push to `main`, a `:main` image, a branch built on a box. None carries a declaration, and a
  production box will not trade on one.
- A change to documentation only. It changes no build, so it needs no new version.
- A hotfix is a release: `v1.0.1`, with its own declaration, however small (§2, «por pequeña
  variación que introduzca»).

## 10. Build order

Each slice is one pull request.

| Slice | What | Path |
| --- | --- | --- |
| 1 | `software-identity.ts`; the records carry the producer (not the taxpayer), the name "Waitron", the release's version, and "several taxpayers" = N; the cancellation reader stops reading its issuer from that block; a check that a common-territory venue is never provisioned with `fiscal-none` | FULL, **fiscal: the owner lands it** |
| 2 | The template, the generator, the "agree" and "fixed wording" guards, `pnpm release` and the release runbook | FULL |
| 3 | `/legal/declaracion-responsable` (HTML, PDF, plain text) in every mode; About Waitron on the dashboard, the till's More menu and the ⓘ corner; the landing page's link; guides in English and Spanish | LIGHT |
| 4 | CI on a `v*` tag: the version baked into the image, the PDF and text on the GitHub Release; `waitron.sh install v<version>` pulls the published image; production refuses an unreleased build | FULL (the box's start path) |
| 5 | The box keeps every version's declaration it has run, and the About page lists them | FULL (adds a migration) |
| — | Cut `v1.0.0` with `pnpm release`, after the owner approves the wording | The owner |

Slices 1 and 2 can be built side by side. Slice 3 needs 2's generator; slice 4 needs 2 and 3;
slice 5 needs 3.

## 11. Questions for the owner

One at a time, each with a worked example; the full text is in the mock-ups folder's
`question.txt`.

1. **Who is the producer on the first declaration, and what tax number and address does it
   publish?** It goes on every box and on the public GitHub page. Recommended: you personally,
   with your NIF and a postal address you are content to publish, now; a company's declaration
   comes with the first release after the company exists. (The alternative is to form the company
   first, compliance plan Step 6, and wait for it.)
2. **The two yes/no answers:** "only Veri\*Factu" = S (as the records say today) and "several
   taxpayers" = N (the records change from S). Recommended: as drafted, and ask the asesor to
   confirm both in the next batch.
3. **The wording.** Approve §4's text, or change it. Recommended: approve as drafted, with the
   facts from question 1 filled in.
4. **Production runs releases only.** Recommended: a production box refuses to trade on a build
   that is not a tagged release, and `waitron.sh install v1.0.0` pulls the published image.
   (The alternative: allow any build and rely on the release habit, which leaves a venue able to
   run a version with no declaration.)

## 12. What this design does not settle, for the builder

- The release's PDF layout: plain A4, the fiscal package's font, the title centred, one item per
  paragraph. No logo.
- Whether `pnpm release` also writes release notes. Not required by law; left out.
- Whether a declaration is owed for a release only the owner runs. The owner's rule (§0) says no;
  the release step makes one anyway, because every tag gets one and the cost is a command.

## Provenance

| Source | Address | Used for |
| --- | --- | --- |
| AEAT, worked example V0.5.1 | https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf | §4's structure, item g)'s and k)'s wording, the person-producer substitutions |
| AEAT, page listing the example (one file listed on 2026-10-21) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica/ejemplo-declaracion-responsable.html | That V0.5.1 is the current one |
| AEAT FAQ, «Certificación de los sistemas informáticos: declaración responsable», labelled «Actualizadas a 21 de octubre de 2026» | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html | Every version; no signature; inside and outside; keep all; items e) and f); hardware; open-source parts; the two-character code |
| AEAT FAQ, general (sanction) | https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html | €1,000 per system without a declaration |
| Orden HAC/1177/2024, art. 15 and annex block 2.6 (consolidated text, last updated 28/10/2024; the annex is published as images and was read by eye) | https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138 | Title, items a)–l), annex 2.a)–d), where it must be, the records' twin fields |
| Real Decreto 1007/2023, art. 13 (consolidated text, last updated 03/12/2025) | https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840 | Who, every version, keep them all |

The raw quotes, with every heading of the worked example verbatim, were gathered on 2026-10-21
by downloading each source with `curl` and searching the text. The FAQ was relabelled the same
day; re-read it before cutting `v1.0.0`.
