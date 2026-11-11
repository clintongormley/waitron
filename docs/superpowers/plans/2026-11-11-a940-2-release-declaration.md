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
  that text, plus the producer's three settings, into plain text, an HTML page and an A4 PDF. Two
  guards hold it to the law and to the records: the headings are AEAT's, word for word, and items
  a), b), c), e), f), h) and i) say what a real sale record says.
- After **pull request 2**: `pnpm release prepare 1.0.0 --place "…"` and `pnpm release tag 1.0.0`
  exist, with the runbook `docs/operations/release.md`. **Both refuse today, on purpose**: the
  template carries two "release blocker" lines, one for the asesor's unanswered Q53 (item d) is a
  draft) and one for slice 4 (a `v*` tag already publishes an image, `.github/workflows/ci.yml:29`
  and `:4389-4399`, but that image does not yet carry the release's version or its declaration).
  Whoever records the asesor's answer deletes the first line; slice 4 deletes the second. Until
  then, `declaration show --draft` prints the full draft for the owner to read.

**What it reuses.** `SOFTWARE_IDENTITY`, `softwareVersion()`, `runningProducer()` and
`refuseProducerSettings()` (`packages/fiscal-verifactu/src/software-identity.ts`); the shared
settings reader `readSoftwareProducer` (`packages/shared/src/software-producer.ts:18`); `pdfkit`
and the package's Noto Sans font through `loadRecoveryFont`
(`packages/fiscal-verifactu/src/recovery-pdf-node.ts:6`); the write-path test's sale set-up
(`packages/fiscal-verifactu/src/write-path.e2e.test.ts:62-90`); Node's `Intl` for the Spanish
date and the «y»/«e» list join; `tsx`, as `apps/server/package.json:111` already uses it.

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
(`packages/fiscal-verifactu/package.json:72`).
Slice 4 adds a `render` subcommand to the package's `declaration` command, writing
`/app/declaration/declaration.{html,pdf,txt}`, and deletes the slice-4 blocker line.

**Files.**

- Pull request 1 creates, in `packages/fiscal-verifactu/`: `declarations/template.md`,
  `declarations/functions.md`, `src/declaration/source.ts`, `render.ts` and `pdf.ts`, a test
  beside each, `headings.test.ts` and `agree.e2e.test.ts`; it modifies `src/errors.ts` (four
  `declaration.*` codes) and the two backlog files.
- Pull request 2 creates `src/declaration/command.ts` and its test,
  `packages/fiscal-verifactu/scripts/declaration.ts`, `scripts/release/waitron-release.mjs` and
  its test, and `docs/operations/release.md`; it modifies the package's `package.json` (`tsx`) and
  `tsconfig.json` (`include`), the root `package.json` (`"release"`), the two backlog files and
  the design (one dated pointer).

**The tests that matter.** Headings (Task 2), agree (Task 3), the slot refusals (Tasks 1–2), the
blocker refusal at every entry (Tasks 4–6), and the root script's refusals before anything is
written, committed or pushed (Tasks 5–6). Each guard is proven by deletion, as each task says.

**Size.** Production code about 625 lines, plus about 85 lines of declaration text and about 90
lines of runbook and backlog prose; tests about 920 lines. Per task in the table at the end.

**Path: FULL** (design §10). Neither pull request touches a fiscal invariant; the reviews run on
the full path because the design says so. Every commit `git commit -s`; no `--no-verify`.

## Departures from the design, and open decisions

1. **Two pull requests, not one.** Design §10: "Each slice is one pull request." The watcher
   asked on 2026-11-11 for the text and renderer first, the release commands second. Awaits the
   watcher? No — this is the watcher's instruction.
2. **How "the first release waits for Q53" is enforced.** The design says the first release waits
   for the asesor (§4, §10's last row) but not how. The plan adds `<!-- release-blocker: … -->`
   lines to the template: `prepare` and `tag` refuse while any is present. Awaits the watcher? No.
3. **A second blocker, for slice 4** (not in the design). Today a pushed `v*` tag already publishes
   `ghcr.io/…/waitron:<version>` (`ci.yml:4389-4399`) whose records say `0.0.0-dev+<commit>`
   (`software-identity.ts`, `softwareVersion`) and which holds no declaration. Without this line,
   a tag cut after the asesor answers but before slice 4 lands would publish such an image as a
   release. Awaits the watcher? **Yes** — it makes slice 4 a precondition of the first release.
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
9. **Disclosed limit of the agree guard:** a record's `IdSistemaInformatico` comes from the node's
   SIF row, not from `SOFTWARE_IDENTITY` (the comment in `software-identity.ts`, and
   `backend.ts:817`). The guard's sale is on a freshly activated row, which holds `W1`; a box whose
   row holds another code is A993's territory.

`pnpm release` is free: the root `package.json` scripts (`:10-28`) have no `release`, and `pnpm
help` (9.15.0) lists no built-in of that name. `scripts/release/prepare-ui.mjs` belongs to the
shared UI packages' publication (`.github/workflows/publish-ui.yml`) and is untouched. The English
guard does not scan `scripts/` (`scripts/english-only.test.ts:250`), so it would not catch Spanish
there; the root script holds none by construction (Spanish stays in the package, design §5.3).

## Global constraints

- Spanish only under `packages/fiscal-verifactu/` (repo `CLAUDE.md` §3; `isHome` in
  `packages/db/src/english-only.ts:22-33` treats that package as a home). Comments, file names and
  the root script are English.
- Slot syntax is `‹name›`. Filled by `prepare`: `‹nombre del sistema›`, `‹código del sistema›`,
  `‹versión›`, `‹versión de @waitron/verifactu›`, `‹solo VERI*FACTU›`, `‹varios obligados›`,
  `‹funcionalidades›`, `‹fecha›`, `‹lugar›`. Left in every committed `v<version>.md` and filled by
  the renderer: `‹nombre y apellidos›`, `‹NIF›`, `‹dirección›` (design §5.3, 2026-11-06).
- Error codes (in `packages/fiscal-verifactu/src/errors.ts`'s `ErrorParams`):
  `declaration.slot_unfilled: { slot: string }`, `declaration.release_blocked: { count: number }`,
  `declaration.disagrees: { item: string }`, `declaration.functions_malformed: { line: number }`.
  Params never carry a producer's value.
- Test producer values (Task 8's): `PRODUCER PERSON`, `00000000T`,
  `1 Example Street, 00000 Nowhere (Province), Spain`. The real values never appear in a commit.
- Comments only for an invariant or a non-obvious why (repo `CLAUDE.md` §1).

## Review focus

1. **A producer value holding `&`, `<` or `‹`** (e.g. `Pérez & Hijos <SL>`) is escaped in the
   HTML, kept whole in text and PDF, and is not taken for a slot — Task 2.
2. **The signing date near midnight**: 23:30 UTC on 21 October is 22 October in Madrid, and the
   declaration says «22 de octubre de 2026» — Tasks 1 and 5.
3. **Version order is numeric**: with `v1.9.0` released, `1.10.0` is accepted and `1.8.9` refused;
   tags that are not `v<major>.<minor>.<patch>` are ignored — Task 5.
4. **A place with accents and an apostrophe** (`L'Alfàs del Pi`) passes whole; one with a line
   break or a `‹` is refused before anything is written — Tasks 4 and 5.
5. **The PDF draws every character of the text.** The font has glyphs for «, », –, ñ and the
   accented vowels (measured 2026-11-11 with `fontkit`'s `hasGlyphForCodePoint` over
   `src/assets/register-noto-sans.ttf`: all `true`; the control `漢` printed `false`). The PDF
   refuses rather than substituting, unlike the recovery PDF's `[U+…]`
   (`recovery-pdf-content.ts:42-47`) — Task 3.

---

## Pull request 1 — the declaration and its renderer

First line of its description: "Adds the declaración responsable's text and renderer (A940 slice
2, part 1 of 2)."

### Task 1: the template, the functions list, and one version's text

**Files:** create `packages/fiscal-verifactu/declarations/template.md`,
`declarations/functions.md`, `src/declaration/source.ts`, `src/declaration/source.test.ts`;
modify `src/errors.ts` (the four codes).

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
- [ ] **Step 3: implement.** The module starts `import "../errors.js";`.
- [ ] **Step 4: PASS**, then `pnpm exec vitest run scripts/errors-reachable.test.ts
  scripts/english-only.test.ts scripts/personal-log-params.test.ts` — PASS. Deletion control:
  make the fill loop re-scan its output; the one-pass case fails. Restore.
- [ ] **Step 5: commit** — `fiscal-verifactu: the declaration's template, functions list and
  one version's text`.

Size: production ~130 code + ~85 template and list; tests ~160.

### Task 2: the renderer, and the headings guard

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
export function declarationBlocks(filled: string): DeclarationBlock[];
export function renderDeclaration(
  source: string, producer: DeclarationProducer,
): { text: string; html: string };
```

The format is our own subset, nothing more: blank lines separate blocks; a block whose lines all
start `- ` (continuations indented two spaces) is a list; `<!-- … -->` lines are dropped; the
first block is the title; `**` toggles bold; nothing else is markup. `fillProducer` refuses
(`declaration.slot_unfilled`) when any slot other than the three is present, then fills the three
in one pass. Text: bold markers removed, a paragraph on one line, a list item on one line starting
`- `, blocks separated by one blank line. HTML: a whole document, `lang="es"`, UTF-8, the title in
`<h1>`, paragraphs in `<p>` with `<strong>`, lists in `<ul><li>`, every text run escaped (`&`,
`<`, `>`, `"`, `'`); no styles, scripts or links outside the text.

- [ ] **Step 1: failing tests.**
  - `render.test.ts`: the real template prepared (Task 1's inputs) and rendered with the test
    producer: text and HTML both hold `PRODUCER PERSON`, `00000000T` and the address; neither holds
    `‹`, `release-blocker` or `**`. A separate case: a producer named `Pérez & Hijos <SL>` with
    address `‹NIF›`
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
  fails. Restore both; name both in the commit message.
- [ ] **Step 5: commit** — `fiscal-verifactu: render a version's declaration as text and HTML`.

Size: production ~110; tests ~150.

### Task 3: the PDF, the agree guard, and pull request 1's docs

**Files:** create `src/declaration/pdf.ts`, `pdf.test.ts`, `agree.e2e.test.ts`; modify
`docs/backlog.md`, `docs/backlog/fiscal.md` (A940: "slice 2, part 1 landed: the text and its
renderer; part 2, the release commands, next").

**Produces:** `renderDeclarationPdf(source: string, producer: DeclarationProducer, loadFont?:
() => Promise<Uint8Array>): Promise<Uint8Array>` — default `loadRecoveryFont`. Plain A4, the
title centred, one block per paragraph, bold runs in the same font (no logo; design §12). A
character the font lacks throws a plain `Error` naming its code point, never a substitute glyph.

- [ ] **Step 1: failing tests.**
  - `pdf.test.ts`: the real template rendered with the test producer; pdf.js text extraction (as
    `recovery-pdf-node.test.ts:8,42` does) holds the title, `00000000T` and `España`; page size is
    A4; a producer name holding `漢` rejects.
  - `agree.e2e.test.ts` (design §8, "Records and declaration agree"): with the three test values
    stubbed (`vi.stubEnv`), build the backend as `write-path.e2e.test.ts:62-90` does, passing
    `identity: runningIdentity("preproduction")`; record one sale; read its stored
    `sistema_informatico`. Prepare the real template with `version: softwareVersion()` and fill
    it with the same producer (`fillProducer`). `declarationItems` of that text must give: 1.a =
    `NombreSistemaInformatico`, 1.b = `IdSistemaInformatico`, 1.c = `Version`, 1.e and 1.f =
    `S - Sí` / `N - No` for `TipoUsoPosibleSoloVerifactu` / `TipoUsoPosibleMultiOT`,
    1.h = `NombreRazon`, 1.i = `NIF`.
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/pdf.test.ts src/declaration/agree.e2e.test.ts`
- [ ] **Step 3: implement. Step 4: PASS.** Deletion control for agree: make
  `prepareDeclarationSource` fill `‹nombre del sistema›` with the literal `Waitron POS` → the
  guard fails on 1.a; restore. Then, unedited, `pnpm --filter @waitron/fiscal-verifactu exec
  vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` — PASS (nothing fiscal moved).
- [ ] **Step 5: docs and commit** — the two backlog lines; commit `fiscal-verifactu: the
  declaration as a PDF, and a guard that it says what the records say`. Then `/finish-branch`.

Size: production ~55 + ~6 docs; tests ~140.

---

## Pull request 2 — `pnpm release prepare` and `tag`, and the runbook

First line of its description: "Adds `pnpm release prepare` and `pnpm release tag`, which refuse
until the asesor answers Q53 and slice 4 lands (A940 slice 2, part 2 of 2)."

### Task 4: the package's `declaration` command

**Files:** create `src/declaration/command.ts`, `command.test.ts`, `scripts/declaration.ts` (three
lines: call `runDeclarationCommand(process.argv.slice(2), realIo)` and set the exit code); modify
`packages/fiscal-verifactu/package.json` (devDependency `tsx` at `apps/server`'s `^4.23.15`) and
`tsconfig.json` (`include` gains `scripts/declaration.ts`).

**Produces:**

```ts
export interface DeclarationIo { root: string; env: Readonly<Record<string, string | undefined>>;
  stdout(text: string): void; stderr(text: string): void }
export function runDeclarationCommand(argv: string[], io: DeclarationIo): Promise<number>;
```

`root` is the package folder; files are `<root>/declarations/…`. Subcommands:

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
`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`, a place that is empty, holds a line break or a
`‹`/`›`, and a date not `YYYY-MM-DD`. The library version is read from the `package.json` beside
the resolved `@waitron/verifactu` entry (its `exports` has no `./package.json`). An `AppError`
prints its code and params to stderr and answers 1.

- [ ] **Step 1: failing tests** in `command.test.ts`, each with a temporary `root` holding a copy
  of the real `declarations/` (and a variant whose template has no blocker lines):
  `show` on the real template refuses `declaration.release_blocked`; `show --draft` prints the text
  and both blockers; `show --draft` with no producer → `sif.producer_unset`; `write` then `check`
  on the blocker-free variant → 0 and the file keeps `‹NIF›`; `check` after editing 1.a in the file →
  `declaration.disagrees` `{ item: "1.a" }`; place `L'Alfàs del Pi` accepted, `A\nB` and `‹x›`
  refused; the library version equals the `version` read from
  `node_modules/@waitron/verifactu/package.json` by path.
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/declaration/command.test.ts`
- [ ] **Step 3: implement**; `pnpm install`. **Step 4: PASS**, and the real entry once:
  `pnpm --filter @waitron/fiscal-verifactu exec tsx scripts/declaration.ts show --version 1.0.0
  --place Elche --date 2026-10-22` with no producer set — expect exit 1 and
  `declaration.release_blocked` (the failing case would print a text). Deletion control: remove
  the blocker test from `write` → the refusing case fails; restore.
- [ ] **Step 5: commit** — `fiscal-verifactu: a command that shows, writes and checks a version's
  declaration`.

Size: production ~120; tests ~150.

### Task 5: `pnpm release prepare`

**Files:** create `scripts/release/waitron-release.mjs`, `scripts/release/waitron-release.test.mjs`;
modify root `package.json` (`"release": "node scripts/release/waitron-release.mjs"`). Root
coverage already includes `scripts/**/*.mjs` (`vitest.config.ts:119`).

**Produces** (Task 6 adds `tagRelease` to the same file):

```js
export function parseVersion(text)                       // → [major, minor, patch] or throws
export function releasedVersions(lsRemoteOutput)         // "v1.2.3" refs only, sorted numerically
export function madridDate(now)                          // Date → "YYYY-MM-DD" in Europe/Madrid
export async function prepareRelease({ version, place, run, ask, now })
export async function main(argv, deps)
```

`run(file, args)` is an `execFileSync` wrapper answering stdout (UTF-8, a `timeout`, environment
passed through so the producer settings reach the package command); `ask(prompt)` reads one line.
Everything the script prints is English.

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
  `push`; `YES`, `y` and an empty answer issue no `write`; a non-zero `show` stops before `ask`;
  `releasedVersions` of `v1.9.0`, `v1.10.0`, `vfoo`, `pre-sqlite-migration` → `1.9.0`, `1.10.0`;
  with `v1.9.0` released `1.10.0` passes and `1.8.9` refuses; `madridDate(2026-10-21T22:30Z)` =
  `2026-10-22`.
- [ ] **Step 2: run, expect FAIL:** `pnpm exec vitest run scripts/release/waitron-release.test.mjs`
- [ ] **Step 3: implement. Step 4: PASS**, and the real refusal once, in this worktree:
  `pnpm release prepare 1.0.0 --place Elche` — expect it to stop at step 1 (the branch is not
  `release/1.0.0`), having written nothing (`git status --porcelain` empty). Deletion control:
  drop the `yes` comparison → the `YES` case fails; restore.
- [ ] **Step 5: commit** — `release: pnpm release prepare writes and signs a version's
  declaration`.

Size: production ~150; tests ~200.

### Task 6: `pnpm release tag`

**Files:** modify `scripts/release/waitron-release.mjs` and its test.

**Produces:** `export async function tagRelease({ version, run })`. In order, stopping at the first
failure: the version parses; on `main`, clean, and after `git fetch origin main` `HEAD` equals
`origin/main`; `git cat-file -e HEAD:packages/fiscal-verifactu/declarations/v<V>.md`; the package
command's `check --version V` exits 0; the tag is absent and the version greater than the highest
released (Task 5's functions); `gh run list --workflow ci.yml --branch main --event push --commit
<HEAD sha> --json status,conclusion --limit 1` answers one run, `completed` and `success`; then
`git tag -a v<V> -m "Waitron <V>"` and `git push origin v<V>`. The pre-push hook runs on that push;
what it does with a tag's range was read, not run (`.husky/pre-push:24-40`), so Step 4 below does
not push.

- [ ] **Step 1: failing tests:** the happy path's commands in order; a missing file, a failing
  `check`, an existing tag, a run `in_progress`, a run `failure` and no run at all each stop with
  no `git tag` and no `push`.
- [ ] **Step 2: run, expect FAIL:** `pnpm exec vitest run scripts/release/waitron-release.test.mjs`
- [ ] **Step 3: implement. Step 4: PASS**, and `pnpm release tag 1.0.0` once in this worktree:
  expect a stop before any `git tag` (not on `main`); `git tag -l "v*"` still empty. Deletion
  control: drop the `conclusion` test → the `failure` case fails; restore.
- [ ] **Step 5: commit** — `release: pnpm release tag tags a version whose declaration has
  landed`.

Size: production ~60; tests ~120.

### Task 7: the runbook, the backlog, and pull request 2

**Files:** create `docs/operations/release.md`; modify `docs/backlog.md` and
`docs/backlog/fiscal.md` (A940's entries: slice 2 landed; both release commands refuse until the
Q53 and slice-4 blocker lines are deleted; slices 3–6 remain), and the design (one dated line
under its banner notes pointing at this plan's "Departures from the design").

**The runbook**, in plain English, in order: make the worktree (`python3
~/workspace/tools/worktree.py new waitron release/<version> --headless`); the checks before
`prepare`, each one line — `functions.md` against the routes, item d)'s hosting phrases and
services against what the release can do, AEAT's FAQ and worked example re-read, the repository
still public (design §5.4, §7.1); set the three producer settings in the shell without printing
them; `pnpm release prepare <version> --place "<town>"`; land the pull request; from an
up-to-date `main` checkout, `pnpm release tag <version>`; watch the tag's full CI run. How to read
the draft before the blockers go: `show --draft`. A release that changes the producer or the code
says so in its first line, and is not cut while A993 is parked (`sif.producer_changed`, design
§5.6). Going back to an older release across an identity change is not done (§5.6).

- [ ] **Step 1: write the runbook and the doc lines.** `docs/` is prettier-ignored
  (`pnpm exec prettier --file-info docs/operations/release.md` prints `"ignored": true`).
- [ ] **Step 2: read every sentence of the runbook against the code it describes** (repo
  `CLAUDE.md` §1): each command copied from a run in Tasks 4–6, never retyped.
- [ ] **Step 3: commit** — `docs: the release runbook, and A940 slice 2 has landed`.
- [ ] **Step 4: `/finish-branch`** with this plan named. The description opens with the first line
  above, then says plainly that no release can be cut yet and which two lines lift that.

Size: production 0 code; ~85 lines of runbook and backlog prose; tests 0.

---

## Totals

| Task | Production code | Text and prose | Tests |
| --- | ---: | ---: | ---: |
| 1 | 130 | 85 | 160 |
| 2 | 110 | — | 150 |
| 3 | 55 | 6 | 140 |
| 4 | 120 | — | 150 |
| 5 | 150 | — | 200 |
| 6 | 60 | — | 120 |
| 7 | — | 85 | — |
| **Total** | **~625** | **~175** | **~920** |
