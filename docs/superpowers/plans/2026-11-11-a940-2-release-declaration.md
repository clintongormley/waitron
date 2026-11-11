# A940 slice 2 — the declaration's text, its renderer and `pnpm release`: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Spec:** [A940 design](../specs/2026-10-21-a940-declaracion-responsable-design.md) — §4
(the text), §5.1–5.4, §8 (the "agree" and "headings" guards), §10 slice 2, §12. Slice 1 and its
Task 8 have landed (#2000, #2584). Slice 1b (A993) is parked by the owner; nothing here
depends on it.

## One page

**What someone can read or run once it lands.**

- After **pull request 1**: the declaration's Spanish text lives in
  `packages/fiscal-verifactu/declarations/template.md`, with the version's functions in
  `declarations/functions.md`. A function turns them into one version's text, and a renderer turns
  that text, plus the producer's three settings, into plain text and an HTML page. Two guards hold
  it to the law and to the records: the headings are AEAT's, word for word, and items a), b), c),
  e), f), h) and i) say what a real sale record says.
- After **pull request 2a**: the same text as an A4 PDF, and the package's `declaration` command
  (`show`, `write`, `check`), which `show --draft` lets the owner use to read the whole draft.
- After **pull request 2b**: `pnpm release prepare 1.0.0 --place "…"` and `pnpm release tag 1.0.0`,
  and the runbook `docs/operations/release.md`. **Both commands refuse today, on purpose**: the
  template carries two "release blocker" lines, one for the asesor's unanswered Q53 (item d) is a
  draft) and one for slice 4 (a `v*` tag already publishes an image, `.github/workflows/ci.yml:29`
  and `:4389-4399`, but that image does not yet carry the release's version or its declaration).
  Whoever records the asesor's answer deletes the first line; slice 4 deletes the second. The
  runbook has the signer load the three producer settings from
  `~/waitron-campaign-shared/private/producer-identity.env` before either command.

**What it reuses.** `SOFTWARE_IDENTITY`, `softwareVersion()`, `runningProducer()` and
`refuseProducerSettings()` (`packages/fiscal-verifactu/src/software-identity.ts`); the shared
settings reader `readSoftwareProducer` (`packages/shared/src/software-producer.ts:18`); `pdfkit` and
the package's Noto Sans font through `loadRecoveryFont`
(`packages/fiscal-verifactu/src/recovery-pdf-node.ts:6`); the write-path test's sale set-up
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts:62-77`); Node's `Intl` for the Spanish date
and the «y»/«e» list join; `tsx`, as `apps/server/package.json:111` already uses it.

**What it leaves out.** The `/legal/declaration` route and every About screen (slice 3); building
the declaration into the image, the GitHub Release files, `waitron.sh install v…` and the "a
published declaration never changes" guard (slice 4); keeping old versions' texts on the box
(slice 5); A993. No migration, and nothing fiscal: no change to `computeHuella`, the chain,
numbering, `registros_facturacion` or the record builders.

**The seams slices 3 and 4 take.** A version's committed text is
`packages/fiscal-verifactu/declarations/v<version>.md`, with the producer's three facts left as
slots. `renderDeclaration(source, producer)` (`src/declaration/render.ts`) answers `{ text, html }`
and `renderDeclarationPdf(source, producer)` (`src/declaration/pdf.ts`) answers the PDF's bytes,
both reachable through the package's `"./src/*"` export
(`packages/fiscal-verifactu/package.json:72`). Slice 4 adds a `render` subcommand to the package's
`declaration` command, writing `/app/declaration/declaration.{html,pdf,txt}`, deletes the slice-4
blocker line, and must make CI on a `v*` tag refuse when that version's declaration file is
missing or carries a blocker (departure 3).

**Files.**

- Pull request 1 creates, in `packages/fiscal-verifactu/`: `declarations/template.md`,
  `declarations/functions.md`, `src/declaration/source.ts` and `render.ts` with a test beside each,
  `headings.test.ts` and `agree.e2e.test.ts`. It modifies `src/errors.ts` (four `declaration.*`
  codes), `test/fixtures.ts` (one option), the root `.prettierignore` and the two backlog files.
- Pull request 2a creates `src/declaration/pdf.ts` and `src/declaration/command.ts`, a test beside
  each, and `packages/fiscal-verifactu/scripts/declaration.ts`. It modifies the package's
  `package.json` (`tsx`) and `tsconfig.json` (`include`), `pnpm-lock.yaml` (generated) and the two
  backlog files.
  As built (2026-11-11): it also adds the error code `declaration.argument_invalid`, exports
  `SI_NO` from `source.ts` and `BREAK_OR_CONTROL` from `render.ts`, adds the package script
  `declaration` and the shared test helper `test/declaration.ts`; its argument refusals assert the
  whole stderr line, and a place also refuses any control character or line separator.
- Pull request 2b creates `scripts/release/waitron-release.mjs` and its test, and
  `docs/operations/release.md`. It modifies the root `package.json` (`"release"`) and the two backlog
  files.
  As built (2026-11-11): it calls the package's `declaration` script through `pnpm --filter
  @waitron/fiscal-verifactu declaration …`, not `exec tsx`; `prepareRelease` also takes `print`;
  `nodeRun`, `nodeAsk` and `declarationArgs` are exported for their tests; a failed command's error
  drops its cause, so a declaration command's output, which can hold the producer's settings, never
  reaches an error message; the clean check ignores untracked files (`--untracked-files=no`); `tag`
  reads no producer setting; a refused tag push deletes the local tag; `git push` and `gh pr create`
  print straight to the terminal. It also modifies `docs/operations/operator-procedures.md` and
  `planning-procedure-audit.md`. The script prints pnpm's banner line and the declaration whole, in
  Spanish with the producer's values filled in; its own messages are English and hold no producer
  value, and the output of `git push`, `gh pr create` and the pre-push hook passes through as those
  tools print it.

**The tests that matter.** Headings (Task 2), agree (Task 3), the slot refusals (Tasks 1–2), the
blocker refusal in the package command (Task 5), and the root script's refusals before anything is
written, committed or pushed (Tasks 6–7). Each layer is tested once: the root script tests only
that a failing `show` or `check` stops it, not the package command's own refusals. Each guard is
proven by deletion, as each task says.

**Size.** Pull request 1: about 245 lines of production code, 85 of declaration text and 6 of
backlog; about 330 lines of tests. Pull request 2a: about 190 lines of production code and a few
generated lines in `pnpm-lock.yaml`; about 210 lines of tests. Pull request 2b: about 205 lines of
production code and 90 of runbook and backlog; about 310 lines of tests. Per task in the table at
the end.

**Path: FULL** (design §10). None of the three pull requests touches a fiscal invariant; the
reviews run on the full path because the design says so. Every commit `git commit -s`; no `--no-verify`.

## Departures from the design, and open decisions

1. **Three pull requests, not one.** Design §10: "Each slice is one pull request." The watcher
   asked on 2026-11-11 for the text and renderer first (1), then the PDF and the package command
   (2a), then the release commands and runbook (2b). Awaits the watcher? No — this is the
   watcher's instruction.
2. **How "the first release waits for Q53" is enforced.** The design says the first release waits
   for the asesor (§4, §10's last row) but not how. The plan adds `<!-- release-blocker: … -->`
   lines to the template: `prepare` and `tag` refuse while any is present. Awaits the watcher? No.
3. **A second blocker, for slice 4** (not in the design). Today a pushed `v*` tag already publishes
   `ghcr.io/…/waitron:<version>` (`ci.yml:4389-4399`) whose records say `0.0.0-dev+<commit>`
   (`software-identity.ts`, `softwareVersion`) and which holds no declaration. Without this line,
   a tag cut after the asesor answers but before slice 4 lands would publish such an image as a
   release. **Disclosed:** a tag made and pushed by hand (`git tag v1.0.0 && git push origin
   v1.0.0`) bypasses both blocker lines, because only the two commands read them; slice 4 closes
   that by making the tag's CI refuse (named under "The seams"). Awaits the watcher? **Yes** — it
   makes slice 4 a precondition of the first release.
4. **`prepare` does not create the branch.** Design §5.4 step 4 has it make `release/<version>`.
   House rule (repo `CLAUDE.md` §6): feature work happens in a worktree made by `worktree.py`. So
   `prepare` refuses unless it runs on a clean branch named `release/<version>` whose tip is
   `origin/main`; the runbook's first step makes that worktree. Awaits the watcher? No.
5. **The Spanish month names come from `Intl`, not a list beside the template** (§5.3). Measured
   2026-11-11, Node v26.13.0: `es-ES` long dates print `1 de marzo de 2026`, and
   `Intl.ListFormat("es")` printed `toma de pedidos, cobro e informes de ventas` (the «e» before
   «i» the design's own list uses). Awaits the watcher? No.
6. **Item d)'s hosting phrases are plain text in the template, not filled per release** (§5.4 step
   2 lists them among the inputs). They change only when what the product can host changes; the
   runbook's checklist says to edit the template then. Awaits the watcher? No.
7. **`tag` re-checks the declaration** (no blocker; items a), b), e), f) still equal
   `SOFTWARE_IDENTITY`; c) equals the version), because other pull requests can land between
   `prepare` and `tag`. Not in §5.4. Awaits the watcher? No.
8. **Disclosed, not changed:** §5.4 step 5's "main's CI run on that commit is green" proves less
   than it reads. An ordinary push to `main` runs no package tests (repo `CLAUDE.md` §2). The tag's
   own run is the full one (`ci.yml:167`) and publication waits for it (`ci.yml:4281`).
9. **Where item b)'s `W1` comes from.** A record's `IdSistemaInformatico` is the node's SIF row's
   (`backend.ts:817`), and a real first setup writes `W1` into it from `WAITRON_ID_SISTEMA`
   (`packages/fiscal-verifactu/src/initial-setup.ts:128`; `software.ts:1`). The shared test
   fixture registers `WT` instead (`packages/fiscal-verifactu/test/fixtures.ts:309`), so the
   agree guard registers with `WAITRON_ID_SISTEMA` through a new fixture option. A box whose row
   holds another code is A993's territory.

`pnpm release` is free: the root `package.json` scripts (`:10-28`) have no `release`, and `pnpm
help` (9.15.0) lists no built-in of that name. `scripts/release/prepare-ui.mjs` belongs to the
shared UI packages' publication (`.github/workflows/publish-ui.yml`) and is untouched. The English
guard does not scan `scripts/` (`scripts/english-only.test.ts:250`), so it would not catch Spanish
there; the root script holds none by construction (Spanish stays in the package, design §5.3).

## Global constraints

- Spanish only under `packages/fiscal-verifactu/` (repo `CLAUDE.md` §3; `isHome` in
  `packages/db/src/english-only.ts:22-33` treats that package as a home). Comments, file names and
  the root script are English.
- **Prettier never touches `packages/fiscal-verifactu/declarations/`.** Without an ignore entry it
  formats them (`pnpm exec prettier --file-info packages/fiscal-verifactu/declarations/template.md`
  prints `"ignored": false`), and it rewrites `«VERI*FACTU»:**` as `«VERI\*FACTU»:**` (run
  2026-11-11 through `prettier --stdin-filepath` on that path). With the line
  `packages/fiscal-verifactu/declarations/` added to a copy of `.prettierignore`, `--file-info`
  printed `"ignored": true` for `template.md` and `v1.0.0.md`, and `false` for
  `src/declaration/source.ts` (the control).
- Slot syntax is `‹name›`. Filled by `prepare`: `‹nombre del sistema›`, `‹código del sistema›`,
  `‹versión›`, `‹versión de @waitron/verifactu›`, `‹solo VERI*FACTU›`, `‹varios obligados›`,
  `‹funcionalidades›`, `‹fecha›`, `‹lugar›`. Left in every committed `v<version>.md` and filled by
  the renderer: `‹nombre y apellidos›`, `‹NIF›`, `‹dirección›` (design §5.3, 2026-11-06).
- Error codes (in `packages/fiscal-verifactu/src/errors.ts`'s `ErrorParams`):
  `declaration.slot_unfilled: { slot: string }`, `declaration.release_blocked: { count: number }`,
  `declaration.disagrees: { item: string }`, `declaration.functions_malformed: { line: number }`,
  `declaration.date_invalid: { date: string }`, `declaration.producer_invalid: { field: "name" | "taxId" | "address" }`.
  Params never carry a producer's value.
- Test producer values (Task 8's): `PRODUCER PERSON`, `00000000T`,
  `1 Example Street, 00000 Nowhere (Province), Spain`. The real values never appear in a commit,
  a test or a log line.
- Coverage: the package holds `98/98/98/95` over `src/**/*.ts`
  (`packages/fiscal-verifactu/vitest.config.ts`), the root over `scripts/**/*.mjs`
  (`vitest.config.ts:119`). Real input and output code is covered by a test that runs it, not
  moved out of reach.
- Comments only for an invariant or a non-obvious why (repo `CLAUDE.md` §1).

## Review focus

1. **A producer value holding `&`, `<` or `‹`** (e.g. `Pérez & Hijos <SL>`) is escaped in the
   HTML, kept whole in text and PDF, and is not taken for a slot — Task 2.
2. **The signing date near midnight**: 23:30 UTC on 21 October is 22 October in Madrid, and the
   declaration says «22 de octubre de 2026» — Tasks 1 and 6.
3. **Version order is numeric**: with `v1.9.0` released, `1.10.0` is accepted and `1.8.9` refused;
   tags that are not `v<major>.<minor>.<patch>` are ignored — Task 6.
4. **A place with accents and an apostrophe** (`L'Alfàs del Pi`) passes whole; one with a line
   break, a `‹` or a `**` is refused before anything is written — Task 5.
5. **The PDF draws every character of the text.** The font has glyphs for «, », –, ñ and the
   accented vowels (measured 2026-11-11 with `fontkit`'s `hasGlyphForCodePoint` over
   `src/assets/register-noto-sans.ttf`: all `true`; the control `漢` printed `false`). The PDF
   refuses rather than substituting, unlike the recovery PDF's `[U+…]`
   (`recovery-pdf-content.ts:42-47`) — Task 4.

---

## Pull request 1 — the declaration's text and its renderer

First line of its description: "Adds the declaración responsable's text and its renderer (A940
slice 2, part 1 of 2)."

### Task 1: the template, the functions list, and one version's text

**Files:** create `packages/fiscal-verifactu/declarations/template.md`,
`declarations/functions.md`, `src/declaration/source.ts`, `src/declaration/source.test.ts`;
modify `src/errors.ts` (the four codes) and `.prettierignore` (the line
`packages/fiscal-verifactu/declarations/`, under the AEAT-artefact entries, with a one-line reason:
a legal text committed exactly as signed).

**Produces:**

```ts
export interface PrepareInput {
  template: string; functions: string; version: string; libraryVersion: string;
  date: string;   // "YYYY-MM-DD", already in Europe/Madrid
  place: string;
}
export function prepareDeclarationSource(input: PrepareInput): string;
export function parseFunctions(markdown: string): string[];
export function releaseBlockers(source: string): string[];
export function declarationItems(source: string): ReadonlyMap<string, string>; // "1.a" → value
export function spanishDate(isoDate: string): string; // "2026-10-22" → "22 de octubre de 2026"
// spanishDate refuses anything but a real calendar date as YYYY-MM-DD: declaration.date_invalid { date }
```

**The template.** Copy §4's text (design lines 449–540) with the `> ` prefixes removed and `\*`
written `*`. Substitutions: a) `Waitron` → `‹nombre del sistema›`; b) `W1` → `‹código del
sistema›`; c) `‹1.0.0›` → `‹versión›`; d) the hosting phrase and the spare-server sentence lose
their `‹›` (plain text, departure 6), `‹x.y.z›` → `‹versión de @waitron/verifactu›`, the functions
placeholder → `‹funcionalidades›`; e) `S - Sí` → `‹solo VERI*FACTU›`; f) `N - No` → `‹varios
obligados›`; h) → `‹nombre y apellidos›`; i) → `‹NIF›`; j) → `‹dirección›`; l) `‹día› de ‹mes› de
‹año›` → `‹fecha›`, `‹localidad›` → `‹lugar›`. A blank line before each bullet list (1.l) and 2.b)).
Its first two lines:

```
<!-- release-blocker: Item 1.d) is the draft sent to the asesor as Q53. Replace it with the answered wording, then delete this line. -->
<!-- release-blocker: A940 slice 4 has not landed: a v* tag would publish an image without this version or its declaration. Slice 4 deletes this line. -->
```

**`functions.md`.** One English comment line on the format, then one line per function:
`- <text as published> — <the route or file that serves it>`. Start from the design's list (§4
d), as of 2026-10-21) and find each one's route on current `main`; any you cannot find is left
out and named in the commit message. Corrective invoices: `apps/server/src/cancel-credit.ts`.

**Behaviour.** `prepareDeclarationSource` replaces the nine prepare slots in one pass (a filled
value is never read again as a slot), keeps comment lines, and throws
`declaration.slot_unfilled` naming the first slot it does not know other than the three producer
slots. `e)`/`f)` print `S - Sí` or `N - No` from `SOFTWARE_IDENTITY`. `‹funcionalidades›` is
`Intl.ListFormat("es", { type: "conjunction" })` over `parseFunctions`. `parseFunctions` throws
`declaration.functions_malformed` (1-based line) for a `- ` line with no ` — `.
`releaseBlockers` answers each `<!-- release-blocker: … -->` line's text. `declarationItems` reads
each paragraph opening `**<n>.<x>) …**` and answers the text after the closing `**`, with
whitespace collapsed.

- [ ] **Step 1: failing tests** in `source.test.ts`:
  - The real template filled with version `1.2.3`, library `0.2.1`, date `2026-10-22`, place
    `Elche`: `declarationItems` gives `1.a` = `Waitron`, `1.b` = `W1`, `1.c` = `1.2.3`, `1.e` =
    `S - Sí`, `1.f` = `N - No`; the text holds `22 de octubre de 2026` and `Elche – España`; the
    only `‹…›` left are the three producer slots.
  - A template with `‹nada›` → `declaration.slot_unfilled` with `{ slot: "‹nada›" }`.
  - A place of `‹versión›` is written literally (one pass).
  - `parseFunctions` of three lines, the last starting with «informes» → the list joins as
    `a, b e informes …`; a line without ` — ` → `declaration.functions_malformed`, `{ line: 3 }`.
  - `releaseBlockers` of the real template → two entries; of a text with none → `[]`.
  - `spanishDate("2026-03-01")` = `1 de marzo de 2026`.
- [ ] **Step 2: run, expect FAIL:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration/source.test.ts`
- [ ] **Step 3: implement.** The module starts `import "../errors.js";`. Add the
  `.prettierignore` line.
- [ ] **Step 4: PASS**, then `pnpm exec vitest run scripts/errors-reachable.test.ts
  scripts/english-only.test.ts scripts/personal-log-params.test.ts` — PASS; and
  `pnpm exec prettier --file-info packages/fiscal-verifactu/declarations/template.md` prints
  `"ignored": true` (it printed `false` before the line). Deletion control: make the fill loop
  re-scan its output; the one-pass case fails. Restore.
- [ ] **Step 5: commit** — `fiscal-verifactu: the declaration's template, functions list and
  one version's text`.

Size: production ~130 code + ~85 template and list + 3 ignore lines; tests ~110.

### Task 2: the text and HTML renderer, and the headings guard

**Files:** create `src/declaration/render.ts`, `render.test.ts`, `headings.test.ts`.

**Consumes:** Task 1's `releaseBlockers` format (comment lines). **Produces:**

```ts
export interface DeclarationProducer {
  readonly name: string; readonly taxId: string; readonly address: string;
}
export interface DeclarationBlock {
  kind: "title" | "paragraph" | "list";
  lines: { bold: boolean; text: string }[][]; // a line (or list item) is a run of bold/plain parts
}
export function fillProducer(source: string, producer: DeclarationProducer): string;
export function declarationBlocks(source: string, producer: DeclarationProducer): DeclarationBlock[];
export function renderDeclaration(
  source: string, producer: DeclarationProducer,
): { text: string; html: string };
```

The format is our own subset, nothing more: blank lines separate blocks; a block whose lines all
start `- ` (continuations indented two spaces) is a list; `<!-- … -->` lines are dropped; the
first block is the title; `**` toggles bold; nothing else is markup, and a `\` is an ordinary
character. `fillProducer` refuses (`declaration.slot_unfilled`) when any slot other than the three
is present, then fills the three in one pass. (Changed in review, 2026-11-11: `declarationBlocks`
takes the producer and reads the structure before writing the values into its runs as plain text,
so a value holding `**` is never read as markup; `fillProducer`'s string serves `declarationItems`
only. Both refuse a value holding a line break or control character with
`declaration.producer_invalid { field }`.) Text: bold markers removed, a paragraph on one line,
a list item on one line starting `- `, blocks separated by one blank line. HTML: a whole document,
`lang="es"`, UTF-8, the title in `<h1>`, paragraphs in `<p>` with `<strong>`, lists in
`<ul><li>`, every text run escaped (`&`, `<`, `>`, `"`, `'`); no styles, scripts or links outside
the text.

- [ ] **Step 1: failing tests.**
  - `render.test.ts`: the real template prepared (Task 1's inputs) and rendered with the test
    producer: text and HTML both hold `PRODUCER PERSON`, `00000000T` and the address; neither holds
    `‹`, `\`, `release-blocker` or `**` (the `\` case catches a formatter's escape reaching the
    committed text). A separate case: a producer named `Pérez & Hijos <SL>` with address `‹NIF›`
    gives `Pérez &amp; Hijos &lt;SL&gt;` in HTML, the raw name in text, and the literal `‹NIF›`
    in the 1.j) value. A source still holding `‹versión›` → `declaration.slot_unfilled`.
  - `headings.test.ts` (design §8, "The headings"): the bold runs of the rendered HTML, in order,
    equal a list typed once into the test by hand from §4 (design lines 449–540): the title, 1.a)
    to 1.l) as bolded there (1.k) and 1.l) are the label alone), «ANEXO», 2.a) and 2.b). Its
    header says it is weaker than its name: it checks headings, not the values beside them.
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/render.test.ts src/declaration/headings.test.ts`
- [ ] **Step 3: implement. Step 4: PASS.** Deletion controls: change one word of item 1.d)'s
  heading in `template.md` → the headings guard fails; drop the `&` escape → the escaping case
  fails; write `VERI\*FACTU` in one heading of `template.md` → the `\` case fails. Restore all
  three; name them in the commit message.
- [ ] **Step 5: check the typed list against AEAT's own example, once.** The worked example is not
  in the repository; fetch it into a new empty folder from the design's provenance address (`curl
  -fsSL -o "$d/v051.pdf"
  'https://sede.agenciatributaria.gob.es/static_files/Sede/Tema/IVA/Verifactu/EjemplosDeclaracionResponsable(V0.5.1).pdf'`
  with `d=$(mktemp -d)`), run `pdftotext -layout "$d/v051.pdf" -` and compare each heading of the
  test's list with the PDF's, allowing only §4's three stated departures (the title, the
  person-producer wording, no 2.c)). Write the command, the file's `shasum -a 256` and each
  difference found (or "none") in the commit message. (The address answered `200 application/pdf` to
  a `curl -sSI` on 2026-11-11.) If it no longer answers, say so in the commit message and leave the
  list as typed from §4.
- [ ] **Step 6: commit** — `fiscal-verifactu: render a version's declaration as text and HTML`.

Size: production ~110; tests ~130.

### Task 3: the agree guard, and pull request 1's docs

**Files:** create `src/declaration/agree.e2e.test.ts`; modify
`packages/fiscal-verifactu/test/fixtures.ts` (`seedTenantWithSif` gains an optional
`idSistemaInformatico`, default `"WT"`, so no other caller moves), `docs/backlog.md` and
`docs/backlog/fiscal.md` (A940: "slice 2, part 1 landed: the text and its renderer; next, the PDF
and the package command (2a), then the release commands (2b)").

- [ ] **Step 1: failing test** `agree.e2e.test.ts` (design §8, "Records and declaration agree"):
  with the three test values stubbed (`vi.stubEnv`), seed with
  `seedTenantWithSif(pg.db, { idSistemaInformatico: WAITRON_ID_SISTEMA })` — the code a real first
  setup writes (`initial-setup.ts:128`) — and build the backend as `write-path.e2e.test.ts:62-77`
  does, passing `identity: runningIdentity("preproduction")`; record one sale; read its stored
  `sistema_informatico`. Prepare the real template with `version: softwareVersion()` and fill it
  with the same producer (`fillProducer`). `declarationItems` of that text must give: 1.a =
  `NombreSistemaInformatico`, 1.b = `IdSistemaInformatico`, 1.c = `Version`, 1.e and 1.f =
  `S - Sí` / `N - No` for `TipoUsoPosibleSoloVerifactu` / `TipoUsoPosibleMultiOT`,
  1.h = `NombreRazon`, 1.i = `NIF`. The file's header says it is weaker than its name for 1.c):
  both sides come from `softwareVersion()`, so that pair cannot disagree until slice 4 gives the
  build a release version.
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/agree.e2e.test.ts`
- [ ] **Step 3: implement** the fixture option. **Step 4: PASS.** Controls, each restored:
  make `prepareDeclarationSource` fill `‹nombre del sistema›` with the literal `Waitron POS` → the
  guard fails on 1.a; seed without the option (`WT`) → it fails on 1.b; record the sale with the
  producer settings unstubbed — the bypass the design names, where the record falls back to the
  taxpayer (`producerFields` in `software-identity.ts`) — → it fails on 1.h and 1.i. Then,
  unedited, `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
  src/inmutabilidad.test.ts` — PASS (nothing fiscal moved).
- [ ] **Step 5: docs and commit** — the two backlog lines; commit `fiscal-verifactu: a guard
  that the declaration says what the records say`. Then `/finish-branch`.

Size: production ~3 (the fixture option) + ~6 docs; tests ~90.

---

## Pull request 2a — the PDF and the package's `declaration` command

First line of its description: "Adds the declaration's PDF and a command that shows, writes and
checks a version's declaration (A940 slice 2, part 2a of 3)." Its last step updates the two
backlog files' A940 lines (part 2a landed; 2b next) and runs `/finish-branch`.

### Task 4: the PDF

**Files:** create `src/declaration/pdf.ts`, `pdf.test.ts`.

**Produces:** `renderDeclarationPdf(source: string, producer: DeclarationProducer, loadFont?:
() => Promise<Uint8Array>): Promise<Uint8Array>` — default `loadRecoveryFont`; it draws
`declarationBlocks(source, producer)`. Plain A4, the title centred, one block per
paragraph, no logo (design §12). **Disclosed:** the package has one font file, so the item
headings are drawn in the same face as the text beside them and look like body text; only the
title stands apart, by being centred. A bold face would need a second font file and its licence
notice (repo `CLAUDE.md` §3); slice 3, which first shows the PDF to people, decides whether it is
worth it. A character the font lacks throws a plain `Error` naming its code point, never a
substitute glyph.

- [ ] **Step 1: failing tests** in `pdf.test.ts`: the real template rendered with the test
  producer; pdf.js text extraction (as `recovery-pdf-node.test.ts:8,42` does) holds the title,
  `00000000T` and `España`; the page is A4; a producer name holding `漢` rejects.
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/pdf.test.ts`
- [ ] **Step 3: implement. Step 4: PASS.** Deletion control: remove the glyph check → the `漢`
  case fails; restore.
- [ ] **Step 5: commit** — `fiscal-verifactu: the declaration as an A4 PDF`.

Size: production ~60; tests ~70.

### Task 5: the package's `declaration` command

**Files:** create `src/declaration/command.ts`, `command.test.ts`, `scripts/declaration.ts` (three
lines: `process.exitCode = await runDeclarationCommand(process.argv.slice(2), nodeIo())`); modify
`packages/fiscal-verifactu/package.json` (devDependency `tsx` at `apps/server`'s `^4.23.15`),
`tsconfig.json` (`include` gains `scripts/declaration.ts`) and `pnpm-lock.yaml` (generated by
`pnpm install`).

**Produces:**

```ts
export interface DeclarationIo { root: string; env: Readonly<Record<string, string | undefined>>;
  stdout(text: string): void; stderr(text: string): void }
export function nodeIo(): DeclarationIo; // the package folder, process.env, process.stdout/stderr
export function runDeclarationCommand(argv: string[], io: DeclarationIo): Promise<number>;
```

`nodeIo` lives in `command.ts`, under the package's coverage, and is tested; only the three-line
entry is outside it, and Step 4 runs that. Files are `<root>/declarations/…`. Subcommands:

- `show [--draft] --version V --place P --date YYYY-MM-DD` — prepares the source and prints it
  rendered as text with the producer from `io.env`. The producer must pass both
  `readSoftwareProducer` (for the address) and `refuseProducerSettings("production", …)` over
  `runningProducer(io.env)`, so unset or malformed settings refuse with Task 8's codes. Without
  `--draft`, a blocker refuses `declaration.release_blocked`; with it, each blocker is printed to
  stderr first.
- `write --version V --place P --date D` — refuses on a blocker; writes `declarations/v<V>.md`
  (overwriting an untagged version's file is allowed, design §5.3).
- `check --version V` — reads `declarations/v<V>.md`; refuses on a blocker, and
  `declaration.disagrees` when 1.a, 1.b, 1.e or 1.f differ from `SOFTWARE_IDENTITY` or 1.c from V.

Checks run in this order, each stopping the command: the arguments, then the blockers (unless
`--draft`), then the producer. All three refuse a version not matching
`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`, a place that is empty, holds a line break, a
`‹`/`›` or `**` (the place is written into the source before its markup is read), and a date not `YYYY-MM-DD`. The library version is read from the `package.json` beside
the resolved `@waitron/verifactu` entry (its `exports` has no `./package.json`). An `AppError`
prints its code and params to stderr and answers 1.

- [ ] **Step 1: failing tests** in `command.test.ts`, each with a temporary `root` holding a copy of
  the real `declarations/` (and a variant whose template has no blocker lines): `show` on the real
  template writes `declaration.release_blocked` to stderr and answers 1 — the one case that shows an
  error's code being printed and the answer 1; the other refusals below assert only the code. The
  producer settings' own refusals (`sif.producer_unset` and the rest) are slice 1's and are not
  tested again here. `show --draft` prints the text and both blockers; `write` then `check` on the
  blocker-free variant → 0 and the file keeps `‹NIF›`; `check` after editing 1.a in the file →
  `declaration.disagrees` `{ item: "1.a" }`; place `L'Alfàs del Pi` accepted, `A\nB`, `‹x›` and `A**B`
  refused; the library version equals the `version` read from
  `node_modules/@waitron/verifactu/package.json` by path; `nodeIo()` names the package folder, and
  its `stdout` and `stderr` reach `process.stdout.write` and `process.stderr.write` (spied).
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/command.test.ts`
- [ ] **Step 3: implement**; `pnpm install`. **Step 4: PASS**, and the real entry once:
  `pnpm --filter @waitron/fiscal-verifactu exec tsx scripts/declaration.ts show --version 1.0.0
  --place Elche --date 2026-10-22` with no producer set — expect exit 1 and
  `declaration.release_blocked` (the failing case would print a text). Deletion control: remove
  the blocker test from `write` → the refusing case fails; restore.
- [ ] **Step 5: commit** — `fiscal-verifactu: a command that shows, writes and checks a version's
  declaration`.

Size: production ~130; pnpm-lock.yaml a few generated lines; tests ~140.

---

## Pull request 2b — `pnpm release prepare` and `tag`, and the runbook

First line of its description: "Adds `pnpm release prepare` and `pnpm release tag`, which refuse
until the asesor answers Q53 and slice 4 lands (A940 slice 2, part 2b of 3)."

### Task 6: `pnpm release prepare`

**Files:** create `scripts/release/waitron-release.mjs`, `scripts/release/waitron-release.test.mjs`;
modify root `package.json` (`"release": "node scripts/release/waitron-release.mjs"`).

**Produces** (Task 7 adds `tagRelease` to the same file):

```js
export function parseVersion(text)                       // → [major, minor, patch] or throws
export function releasedVersions(lsRemoteOutput)         // "v1.2.3" refs only, sorted numerically
export function madridDate(now)                          // Date → "YYYY-MM-DD" in Europe/Madrid
export async function prepareRelease({ version, place, run, ask, now })
export async function main(argv, deps)                   // deps default to the real ones below
```

The real `run(file, args)` wraps `execFileSync` (UTF-8, a `timeout`, environment passed through so
the producer settings reach the package command); the real `ask(prompt)` reads one line with
`node:readline`. Everything the script prints is English, and no producer value is ever printed.

`prepareRelease`, stopping at the first failure, before anything is written:
1. The version parses; `git rev-parse --abbrev-ref HEAD` is `release/<version>`; `git status
   --porcelain` is empty; after `git fetch origin main`, `HEAD` equals `origin/main`.
2. `git ls-remote --tags origin "refs/tags/v*"`: refuse if `v<version>` exists or the version is
   not greater than the highest released one.
3. `pnpm --filter @waitron/fiscal-verifactu exec tsx scripts/declaration.ts show --version V
   --place P --date <madridDate(now)>` — print its output whole.
4. `ask`: anything but exactly `yes` (after trimming) stops, with nothing written.
5. The same command with `write`; `git add` the one file; `git commit -s -m "Release <version>"`;
   `git push -u origin release/<version>`; `gh pr create --base main --title "Release <version>"`
   with a short English body naming the file and that the producer signed it with `prepare`.

- [ ] **Step 1: failing tests**, with a recording fake `run`: the happy path issues exactly the
  commands above in order; each refusal in steps 1–2 issues no `show`, `write`, `git commit` or
  `push`; `YES`, `y` and an empty answer issue no `write`; a non-zero `show` stops before `ask` — the
  package command's own refusals are Task 5's and are not
  tested again here; `releasedVersions` of `v1.9.0`, `v1.10.0`, `vfoo`, `pre-sqlite-migration` →
  `1.9.0`, `1.10.0`; with `v1.9.0` released `1.10.0` passes and `1.8.9` refuses;
  `madridDate(2026-10-21T22:30Z)` = `2026-10-22`. **And one test of the real wrappers and the entry
  point:** run `node scripts/release/waitron-release.mjs prepare 1.0.0 --place Elche` as a child
  process, with `PATH` starting at a temporary folder holding stand-in `git`, `gh` and `pnpm`
  scripts that record their arguments and answer the happy path, and `yes` on its standard input; it
  exits 0 and the recorded calls match the fake-`run` happy path. Build the stand-ins once per file
  (repo `CLAUDE.md` §4), and clear `GIT_DIR` and its family in the child's environment.
- [ ] **Step 2: run, expect FAIL:** `pnpm exec vitest run scripts/release/waitron-release.test.mjs`
- [ ] **Step 3: implement. Step 4: PASS**, and read the root coverage table for
  `scripts/release/waitron-release.mjs` (`pnpm exec vitest run --coverage
  scripts/release/waitron-release.test.mjs`): at or above `98/98/98/95`. Then the real refusal
  once, in this worktree: `pnpm release prepare 1.0.0 --place Elche` — expect it to stop at step 1
  (the branch is not `release/1.0.0`), having written nothing (`git status --porcelain` empty).
  Deletion control: drop the `yes` comparison → the `YES` case fails; restore.
- [ ] **Step 5: commit** — `release: pnpm release prepare writes and signs a version's
  declaration`.

Size: production ~150; tests ~190.

### Task 7: `pnpm release tag`

**Files:** modify `scripts/release/waitron-release.mjs` and its test.

**Produces:** `export async function tagRelease({ version, run })`. In order, stopping at the
first failure: the version parses; on `main`, clean, and after `git fetch origin main` `HEAD`
equals `origin/main`; `git cat-file -e HEAD:packages/fiscal-verifactu/declarations/v<V>.md`; the
package command's `check --version V` exits 0; the tag is absent and the version greater than the
highest released (Task 6's functions); `gh run list --workflow ci.yml
--branch main --event push --commit <HEAD sha> --json status,conclusion --limit 1` answers one run,
`completed` and `success`; then `git tag -a v<V> -m "Waitron <V>"` and `git push origin v<V>`.
The pre-push hook runs on that push; what it does with an annotated tag's object id was read, not
run (`.husky/pre-push:24-40`), so Step 4 below does not push.

- [ ] **Step 1: failing tests:** the happy path's commands in order; a missing file, a non-zero
  `check` (one case; what `check` refuses is Task 5's), an existing tag, a run `in_progress`, a run
  `failure` and no run at all each stop with no `git tag` and no `push`; and the child-process test
  of Task 6 gains a `tag` run through the same stand-ins.
- [ ] **Step 2: run, expect FAIL:** `pnpm exec vitest run scripts/release/waitron-release.test.mjs`
- [ ] **Step 3: implement. Step 4: PASS**, the coverage table as in Task 6, and `pnpm release tag
  1.0.0` once in this worktree: expect a stop before any `git tag` (not on `main`); `git tag -l
  "v*"` still empty. Deletion control: drop the `conclusion` test → the `failure` case fails;
  restore.
- [ ] **Step 5: commit** — `release: pnpm release tag tags a version whose declaration has
  landed`.

Size: production ~55; tests ~120.

### Task 8: the runbook, the backlog, and pull request 2b

**Files:** create `docs/operations/release.md`; modify `docs/backlog.md` and
`docs/backlog/fiscal.md` (A940's entries: slice 2 landed; both release commands refuse until the
Q53 and slice-4 blocker lines are deleted; slices 3–6 remain, slice 4 with the tag-CI refusal of
departure 3). Pull request 1 already added the design's dated line pointing at this plan's
"Departures from the design".

**The runbook**, in plain English, in order: make the worktree (`python3
~/workspace/tools/worktree.py new waitron release/<version> --headless`); the checks before
`prepare`, each one line — `functions.md` against the routes, item d)'s hosting phrases and
services against what the release can do, AEAT's FAQ and worked example re-read, the repository
still public (design §5.4, §7.1); **load the three producer settings** from
`~/waitron-campaign-shared/private/producer-identity.env` into the shell that runs `prepare` and
`tag`, never printing a value, with `while IFS= read -r line; do export "$line"; done <
~/waitron-campaign-shared/private/producer-identity.env` — the file's values are unquoted and two
hold spaces (its shape read 2026-11-11 without printing a value), and on a stand-in file of the
same shape that loop exported both whole in `zsh` and `bash` while `set -a; . <file>` failed with
`Up: command not found`; `pnpm release prepare
<version> --place "<town>"`; land the pull request; from an up-to-date `main` checkout, `pnpm
release tag <version>`; watch the tag's full CI run. Never push a `v*` tag by hand (departure 3).
How to read the draft before the blockers go: `show --draft`. A release that changes the producer
or the code says so in its first line, and is not cut while A993 is parked
(`sif.producer_changed`, design §5.6). Going back to an older release across an identity change is
not done (§5.6). It keeps the disclosure that the pre-push hook's handling of an annotated tag's
object id was read, not run (`.husky/pre-push:24-40`).

- [ ] **Step 1: write the runbook and the doc lines.** `docs/` is prettier-ignored
  (`pnpm exec prettier --file-info docs/operations/release.md` prints `"ignored": true`).
- [ ] **Step 2: read every sentence of the runbook against the code it describes** (repo
  `CLAUDE.md` §1): each command copied from a run in Tasks 5–7, never retyped.
- [ ] **Step 3: commit** — `docs: the release runbook, and A940 slice 2 has landed`.
- [ ] **Step 4: `/finish-branch`** with this plan named. The description opens with the first line
  above, then says plainly that no release can be cut yet and which two lines lift that.

Size: production 0 code; ~90 lines of runbook and backlog prose; tests 0.

---

## Totals

| Pull request | Task | Production code | Text and prose | Tests |
| --- | --- | ---: | ---: | ---: |
| 1 | 1 | 130 | 85 + 3 | 110 |
| 1 | 2 | 110 | — | 130 |
| 1 | 3 | 3 | 6 | 90 |
| **1** | | **~245** | **~95** | **~330** |
| 2a | 4 | 60 | — | 70 |
| 2a | 5 | 130 | — | 140 |
| **2a** | | **~190** | — | **~210** |
| 2b | 6 | 150 | — | 190 |
| 2b | 7 | 55 | — | 120 |
| 2b | 8 | — | 90 | — |
| **2b** | | **~205** | **~90** | **~310** |
| **All** | | **~640** | **~185** | **~850** |

Not counted: the few generated lines `pnpm install` writes to `pnpm-lock.yaml` in Task 5.
