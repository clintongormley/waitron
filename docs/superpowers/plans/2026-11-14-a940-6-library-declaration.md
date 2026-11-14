# A940 slice 6 — `@waitron/verifactu`'s own declaración responsable

Status: decisions 1–4 answered by the owner (relayed by the watcher, `questions.md`, "WATCHER
2026-11-14 09:58"). The fresh-context plan read (`~/waitron-campaign/receipts/a940-6-plan-review.md`)
found that the library can do one thing the approved 1.e) says it cannot, so decision 5 below is
open and nothing is built until it is answered. Lane A, 2026-11-14.

**What someone can do when it lands.** Anyone who installs a release of `@waitron/verifactu` from
npm finds that release's declaración responsable (the producer's signed-off statement that the
software meets the Veri\*Factu rules) on the release's GitHub page and inside the npm package, before
and after installing it. Waitron's own declaration already says the library «cuenta con su propia
declaración responsable» (`packages/fiscal-verifactu/declarations/template.md`, item 1.d), so
Waitron's first release (`v1.0.0`) has to pin a library version that has one. Today none does: no
library release carries a declaration, and Waitron depends on `^0.2.1`
(`packages/fiscal-verifactu/package.json:35`).

**Why the library needs its own.** The A940 design (§4, "The `@waitron/verifactu` library gets its
own declaration", and §10 row 6) puts it in case (b) of `docs/compliance/verifactu-findings.md`
("Multi-component SIFs", 2026-07-27): a component by the same producer with its own release cycle,
published for others to use, needs a declaration of its own. AEAT's FAQ, read again on 2026-11-14
(page dated 21 October 2026), says the logical outcome is «tantos Certificaciones como componentes
afectan al cumplimiento del Reglamento RSIF», «Todas ellas deberán hallarse disponibles para el
usuario del sistema», and that every version is a distinct product. The one public precedent,
mdiago's VeriFactu library, publishes a declaration per release
(`github.com/mdiago/VeriFactu/.../Doc/Legal/Declaracion Responsable v1.0.69-release.pdf`, read on
2026-11-14).

## The draft text

The same AEAT headings as Waitron's own template, word for word, so the two read alike. Slots are
`‹…›`, filled at release time. Every factual sentence in 1.d) is checked against the code it
describes (receipts after the text).

> **DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN**
>
> **1.a) Nombre del sistema informático a que se refiere esta declaración responsable:**
> @waitron/verifactu
>
> **1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta
> declaración responsable:** WV
>
> **1.c) Identificador completo de la versión concreta del sistema informático a que se refiere
> esta declaración responsable:** ‹versión›
>
> **1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere
> esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema
> informático y de sus principales funcionalidades:**
>
> @waitron/verifactu es una biblioteca de software para Node.js, de código fuente abierto
> (licencia Apache 2.0) y publicada en npm, que los sistemas informáticos de facturación
> incorporan como componente. No es por sí sola un sistema informático de facturación completo: no
> numera las facturas, no conserva los registros ni tiene pantallas; esas funciones corresponden al
> sistema que la incorpora, que debe contar con su propia declaración responsable e indicar en ella
> la versión de esta biblioteca que utiliza.
>
> Hardware: la biblioteca no incluye hardware; funciona en cualquier equipo con Node.js.
>
> Software: la biblioteca, que construye los registros de facturación de alta y de anulación,
> calcula su huella y la encadena con la del registro anterior que le indica el sistema que la
> utiliza, comprueba los registros contra las especificaciones de la Agencia Tributaria, genera el
> contenido del código QR, remite los registros a la sede electrónica de la Agencia Tributaria y
> consulta los ya remitidos; un simulador de los servicios de la Agencia Tributaria, para las
> pruebas de quien la integra, que no remite nada; y el componente de terceros del que nos hacemos
> responsables: fast-xml-parser, que lee los mensajes XML. El código fuente y la documentación
> están disponibles en https://github.com/waitron-io/verifactu.
>
> Esta versión solo genera registros para la modalidad VERI\*FACTU.
>
> Principales funcionalidades: construcción de registros de alta y de anulación; cálculo de la
> huella y encadenamiento; validación de los registros; contenido del código QR; remisión de
> registros y consulta de los remitidos; comprobación de una cadena de registros.
>
> **1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se
> ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda
> funcionar exclusivamente como «VERI\*FACTU»:** S (only if decision 5 removes the requirement
> service; otherwise see decision 5)
>
> **1.f) Indicación de si el sistema informático a que se refiere la declaración responsable
> permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la
> facturación de varios obligados tributarios:** S
>
> **1.g)** — the same sentence as Waitron's template (only VERI\*FACTU, so no express signature).
>
> **1.h)–1.j)** ‹nombre y apellidos›, ‹NIF›, ‹dirección› — the same three producer facts as
> Waitron's (the owner personally).
>
> **1.k)** — the same paragraph as Waitron's template.
>
> **1.l)** ‹fecha›; ‹lugar› – España.
>
> **ANEXO** 2.a) Correo electrónico: info@waitron.io. 2.b) Histórico de declaraciones
> responsables de las versiones de este producto: https://github.com/waitron-io/verifactu/releases

Receipts for 1.d) (in `waitron-io/verifactu` at `63f3623`): alta and anulación records and their
huella, `buildAltaRecord`/`buildAnulacionRecord` (`src/records.ts:88,157`, which call
`computeHuella`); the chain link comes from the caller (`Encadenamiento: input.Encadenamiento`,
`src/records.ts:142,173`); checks, `validate` (`src/validate.ts`); QR, `buildQrPayload`
(`src/qr.ts:33`); sending and consulting, `createClient` (`src/client.ts:153`); chain check,
`checkChain` (`src/chain.ts:58`); the simulator, export `./testing` (`src/testing/fake-aeat.ts`);
the one runtime dependency, `fast-xml-parser` (`package.json` `dependencies`), which also reads
outgoing requests (`parseEnvio`, `parseConsulta`, `src/index.ts:30`); licence `Apache-2.0`
(`package.json`). NOT Veri\*Factu only as the code stands: see decision 5. There is no signing code
in `src/`.

## The four decisions (asked one at a time)

1. **Name and code (1.a, 1.b).** Recommended: name `@waitron/verifactu` (what people install) and
   code `WV`. The code must differ from Waitron's `W1` (`packages/fiscal-verifactu/src/software.ts:1`):
   AEAT, «Este código no se podrá repetir en otro SIF distinto del mismo productor». The code
   appears only in this declaration; the records the library builds carry the code of the system
   that uses it. Alternative: `V1`.
2. **1.f), several taxpayers.** Recommended `S`: the library holds no taxpayer of its own, every
   call names the taxpayer, so one program using it can file for many (mdiago's says «Varios
   obligados tributarios»). `N` would only fit if we read 1.f) as being about the library's own
   use, which has no taxpayer. Either way it goes to the asesor as a sub-question of Q53.
3. **Which version gets the first one.** Recommended: the next library release (`0.3.0`), with
   Waitron moving to it before `v1.0.0`.
   `0.2.1` is already on npm without one; a declaration added afterwards would be dated after
   people installed it.
4. **Approve the 1.d) wording** above (or change it). As with Waitron's, the asesor may still change
   it; until then it is the owner's draft. Answered "as drafted"; the plan read then found two
   omissions, now added for the owner to see with decision 5: the test simulator the package ships,
   and that fast-xml-parser reads requests as well as replies («que lee los mensajes XML»).
5. **OPEN — the library can send records "on AEAT's demand", which only a system outside
   Veri\*Factu does.** It exports the separate service's addresses (`SOAP_ENDPOINTS_REQUERIMIENTO`,
   `SOAP_ENDPOINTS_REQUERIMIENTO_SELLO`, `src/endpoints.ts:17-29`), writes and reads the
   `RemisionRequerimiento` header (`src/xml/serialize.ts`, `src/xml/parse-request.ts`), and its README
   explains how to use it ("This library does not determine the operating mode for you",
   `README.md:136-153`); its website says the opposite ("The library supports only VERI\*FACTU mode",
   `website/src/content/docs/en/index.md:60-62`). Nothing in Waitron uses it. Options: (a) remove the
   requirement service in 0.3.0, so 1.e) = S is true and the website is right (recommended: about 12
   library files, a breaking change a 0.x minor version allows; it adds one task below); (b) keep it
   and answer 1.e) = N, then work out what 1.g) says when the library signs nothing; (c) ask the
   asesor first. Example: a programmer using 0.2.1 can today point the library at AEAT's demand
   service and send a batch of records AEAT asked for; after (a) that call no longer exists.

## How a release produces it (the build, once approved)

Shortest path, in the library's own repository and flow (its own PR and CI; the owner or the watcher
cuts the tag, as for every library release).

**Task 0 — only if decision 5 is (a): remove the requirement service.** Delete the two exported
address sets, the `RemisionRequerimiento` header in serializing and parsing, its validation and tests,
and the README section; CHANGELOG lists it under a breaking change; the website keeps "only
VERI\*FACTU mode".

**Task 1 — template and renderer.** `declarations/template.md` holds the approved text with the six
slots, its headings copied from Waitron's `packages/fiscal-verifactu/declarations/template.md` at
main `6c42990074`. Its first line is a `release-blocker` comment, as Waitron's is, until the asesor
answers Q53 for the library: 0.3.0 waits for that answer, as Waitron's v1.0.0 already does, so the
first published text is the final one. `declarations/` goes in `.prettierignore` (Prettier rewrites
`«VERI*FACTU»` otherwise). `scripts/declaration.mjs` fills them: the version from `package.json`, refusing when it is
not the tag being released (`GITHUB_REF_NAME` without `v`); the date as the annotated tag's date
(`git for-each-ref --format='%(taggerdate:short)' refs/tags/<tag>`, readable after a depth-1 tag fetch;
it refuses a lightweight tag), so a re-run gives the same text; the three producer facts from
`WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID`, `WAITRON_PRODUCER_ADDRESS` (the names Waitron's
image build already uses, `.github/workflows/ci.yml`); the place from `DECLARATION_PLACE`. It
refuses a missing, empty or multi-line value, any `‹…›` left over, and any `release-blocker` line
still in the template, and its messages never print a producer value. It writes
`DECLARACION-RESPONSABLE.md` at the package root (gitignored, listed in `package.json` `files`).
Tests: `scripts/declaration.test.mjs` under `node --test`, added to `ci.yml` beside the other
script tests: every slot filled; each refusal; every heading of the template
(1.a to 1.l, ANEXO, 2.a, 2.b) is present, in order, word for word (so a later edit cannot drop one).

**Task 2 — the release workflow.** `release.yml` gains, before `npm publish`: render; check
`npm pack --dry-run --json` lists `DECLARACION-RESPONSABLE.md` (it silently drops a missing file and
still exits 0); then the GitHub Release (`contents: write`, `GH_TOKEN: ${{ github.token }}`): no
Release yet → create it with the file and the version's CHANGELOG section as notes; a Release made by
hand without the file (as v0.2.0's was) → upload the file to it; a Release that already holds the file
→ download it and stop unless it is byte-identical. So no version reaches npm without its declaration
already public, and a published declaration never changes.

**Task 2b — the producer reads it first.** The README's release steps: `node scripts/declaration.mjs
--preview` with the producer's settings loaded locally prints the filled-in text, and the producer
reads it before pushing the annotated tag (as Waitron's `prepare` shows the text before `tag`).

**Task 3 — words.** README and `PROVENANCE.md`: the library is a component, not a complete system;
each release has its own declaration on its Release page and in the package; the system that uses
it still owes its own, naming this version. The same in the website's English and Spanish getting
started pages. CHANGELOG: one Unreleased line.

**Waitron side — its own small pull request, after 0.3.0 is on npm.** Move
`packages/fiscal-verifactu` to `@waitron/verifactu` `^0.3.0` (`^0.2.1` does not accept 0.3.0), and
make `pnpm release prepare` refuse when the installed library package has no
`DECLARACION-RESPONSABLE.md` (it already reads that package's version,
`packages/fiscal-verifactu/src/declaration/command.ts:111-115`), so the check is code, not a runbook
line. Docs, in this slice's library PR's companion docs change: `docs/compliance/asesor-questions.md`
Q53 gains the library's 1.d), 1.e) (with decision 5), 1.f) and code; the A940 backlog entry says
slice 6 landed.

**Settings the owner adds to `waitron-io/verifactu` (the owner's, 2026-11-14: the builder never sets
them; it writes a WATCHER-NEEDED naming exactly what to set where):** the three `WAITRON_PRODUCER_*`
repository secrets and a `DECLARATION_PLACE` repository variable. The release refuses until they exist.

Size: about 80 lines of script, 35 of workflow, 60 of template, 120 of tests, plus the words; Task 0
adds about 12 files of removals; the Waitron pull request about 30 lines. 0.3.0 is 0.2.1 plus the
declaration (and Task 0): the CHANGELOG's Unreleased section is empty.
