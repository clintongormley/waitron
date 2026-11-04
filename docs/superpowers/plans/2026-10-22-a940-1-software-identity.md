# A940 slice 1 — the records name the software's producer: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"` (medium effort). An implementer past about 150 tool calls with its
> task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover —
> done, left, files, each check's state.

**Read this first — four things settled before any task.**

1. **The fingerprint does not change. Measured, not read.** A throwaway test (written beside
   `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, run, then deleted; not committed) filed
   the golden test's exact basket through the real `recordSale` → `appendToChain` path three times
   in one database, rolling each sale back, with `buildSistemaInformatico` replaced on the backend
   instance:

   ```
   cd packages/fiscal-verifactu && env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run src/zz-a940-probe.e2e.test.ts
   PROBE default     41CC8A6277A13E2D9A4023620B238DC4D5DCBB96451F6579DBFFB458799456DC recomputes: true emisor: 29999999H sistema: {"NombreRazon":"Waitron SL","NIF":"29999999H","NombreSistemaInformatico":"Waitron POS",…,"Version":"0.0.0",…,"TipoUsoPosibleSoloVerifactu":"S","TipoUsoPosibleMultiOT":"S","IndicadorMultiplesOT":"N"}
   PROBE producer    41CC8A6277A13E2D9A4023620B238DC4D5DCBB96451F6579DBFFB458799456DC recomputes: true emisor: 29999999H sistema: {"NombreRazon":"PRODUCER PERSON","NIF":"00000000T","NombreSistemaInformatico":"Waitron",…,"Version":"1.0.0",…,"TipoUsoPosibleSoloVerifactu":"N","TipoUsoPosibleMultiOT":"N","IndicadorMultiplesOT":"S"}
   PROBE control-vat 0D6371BC6C18C1FADD8068169F876774C4E27D14432010D30F119C2F2B4F718D recomputes: true …
         Tests  1 passed (1)
   ```

   `default` is today's block and reproduces the golden literal (`write-path.e2e.test.ts:613`).
   `producer` changes **all six** product fields of the block — name, NIF, system name, version and
   all three flags, deliberately past what this slice changes — and the huella is identical. The
   control moves one line's VAT rate and prints a different huella: the one the golden test's own
   comment records as its wrong answer (`write-path.e2e.test.ts:606`), so the probe could fail. The
   same held for a cancellation, at the library level (the script below, run against
   `@waitron/verifactu` 0.2.1, Node v26.11.1): the taxpayer's block and the producer's block both
   gave `D2E4D739…3D489A`; the control, another invoice number, gave `DD238BE3…4D2C06`. The
   script, for re-running (its one argument is the library's folder,
   `node_modules/.pnpm/@waitron+verifactu@0.2.1/node_modules/@waitron/verifactu`):

   ```js
   const { buildAnulacionRecord, computeHuella } = await import(process.argv[2] + "/dist/index.js");
   const base = { IDEmisorFacturaAnulada: "29999999H", NumSerieFacturaAnulada: "A/1",
     FechaExpedicionFacturaAnulada: new Date("2026-10-22T10:00:00Z"), offsetMinutes: 120,
     generadoEn: new Date("2026-10-22T10:05:00Z"), Encadenamiento: { PrimerRegistro: "S" } };
   const taxpayer = { NombreRazon: "Waitron SL", NIF: "29999999H", NombreSistemaInformatico: "Waitron POS",
     IdSistemaInformatico: "W1", Version: "0.0.0", NumeroInstalacion: "1", TipoUsoPosibleSoloVerifactu: "S",
     TipoUsoPosibleMultiOT: "S", IndicadorMultiplesOT: "N" };
   const producer = { ...taxpayer, NombreRazon: "PRODUCER PERSON", NIF: "00000000T",
     NombreSistemaInformatico: "Waitron", Version: "1.0.0", TipoUsoPosibleMultiOT: "N" };
   for (const [label, extra, block] of [["taxpayer", {}, taxpayer], ["producer", {}, producer],
     ["control", { NumSerieFacturaAnulada: "A/2" }, producer]])
     console.log(label, computeHuella(buildAnulacionRecord({ ...base, ...extra, SistemaInformatico: block })));
   ```

   The sale probe is reproduced by copying the golden test's basket into a new test file with the
   backend instance's `buildSistemaInformatico` replaced by one returning the producer's block. The
   library hashes eight named fields for a sale and five for a cancellation, none of them in the
   software block (`buildCadenaAlta` and `buildCadenaAnulacion`, `dist/huella.js` of 0.2.1). The
   issuer's NIF (`IDEmisorFactura`) **is** hashed, so it must stay the taxpayer's — every task
   below keeps it so. **So slice 1 does not touch `computeHuella`, the chain, invoice-number
   allocation or the immutable table's rows, and the golden huella test and the `inmutabilidad`
   suite must pass unedited** (Task 6 runs both).
2. **No migration.** Every change is in what new records carry and in code that reads them; no
   table or column changes.
3. **The producer's name and NIF are not supplied yet: a marked placeholder, built so it cannot
   reach production** (the most conservative option found; the alternatives and why they lose are
   under "The placeholder" below). While the placeholder is in place:
   - **no record anywhere carries placeholder text**: the producer fields keep today's values, the
     taxpayer's name and NIF, exactly what AEAT's test service accepts today;
   - **a production start on a published image refuses** with `sif.producer_unset`, at the point
     the trading start builds the fiscal backend (`apps/server/src/boot.ts:1638`), before it serves
     — the existing place a start refuses a wrong fiscal set-up (`module.fiscal_slot_mismatch`,
     `packages/module/src/fiscal-slot.ts:27`) — and the recovery page gives it a fixed title and
     action (Task 5);
   - "published" is read from the bundle's own build stamp **directly**, not through
     `readHourRelease()`, because 39 test files besides `hour-release.test.ts` name that function
     (`git grep -l readHourRelease -- apps packages`), most of them to hand the clock code a stamp
     of their own;
     routed through it, the refusal failed 10 server test files (fresh review, 2026-10-22). Measured
     for this revision on 2026-10-22, in a throwaway `git worktree add
     --detach` of this branch (head `31da3006c`, documentation only over `main` `556c01004`), with
     Tasks 1, 2 and 5 applied as a sketch (the stamp read directly; `SOFTWARE_IDENTITY` pending),
     beside a second throwaway of the same head without it as the control:
     - 35 server files: Task 5 Step 5's 34 (every `apps/server/src/*.test.ts` naming
       `readHourRelease`, the importers of its two helpers, and `boot.till-clock`) plus the seed
       golden test, run together:
       control 5 files failed, 10 of 616 tests; sketch 5 files failed, 5 of 616 tests. The sketch's
       failures are the seed golden test — its 62 differing lines are all `sistema_informatico`,
       the change Task 6 re-records — and four tests in `first-fiscal-hour-modes`,
       `first-fiscal-launch`, `first-setup-retired-assignments` and `first-setup-unused-pdf` that
       failed by name in the control too (not investigated; they fail without the sketch). The
       two sides do not fail the same set: the control's other six failing tests, one of its
       failing files among them, passed in the sketch's run. The sketch's log holds no
       `sif.producer_unset` and no `slice` crash.
     - The 12 package files naming it: `composition` 9 of 9 and `fiscal-verifactu` 138 of 138 in
       both; `provisioning` control 249 of 250 (`first-setup-command-import`, "the actual relocated
       command resumes a retained import and publishes it once"), sketch the same 249 of 250, the same test failing.
     - The control in the other direction, that the refusal can still fire: a throwaway test that
       stubbed the global stamp printed `sif.producer_unset` for production (version
       `0.0.0-dev+0123456789abcdef0123456789abcdef01234567`), `verifactu` for preproduction,
       `verifactu` with `0.0.0-dev` for a stamp with no commit, and `verifactu` for production with
       `readHourRelease` mocked to a stamp and no global — the last being the fresh review's case.
   - filling the two values (Task 8) is a two-line change that switches every new record to the
     producer and lifts the refusal.
4. **Test checks this slice changes** (the owner's 2026-10-05 rule: a check may change when the
   item's spec changes what it checks). Every one is listed in the pull request's description:
   - `apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json` — the
     `sistema_informatico` string of all 31 records: `"Waitron POS"` → `"Waitron"`, `"0.0.0"` →
     `"0.0.0-dev"`, `TipoUsoPosibleMultiOT` `"S"` → `"N"`. Re-recorded, and the diff must touch
     those 31 lines and nothing else — no `huella` line (Task 6).
   - `apps/server/src/taxpayer-rename.filing.test.ts:92-93` — **in Task 8, not before**: while the
     producer is pending, `producerFields` still answers the taxpayer's name at the moment of
     recording, so the lines stay true until the producer is filled. Task 8 deletes them; line 91,
     the issuer's name following the rename, stays.
   - `packages/fiscal-verifactu/src/backup-verification-chain.test.ts:39-43` — set-up only: its
     `append` helper also sets the record's issuer NIF to the SIF row's, because the check now
     compares the issuer (Task 4). Its "wrong taxpayer identity" case (`:270-271`) keeps its
     expectation and becomes the change's proof by deletion.
   - None other is expected. Any further changed expectation an implementer meets stops the task
     and goes to the driver with the reason; it is not edited to pass.

**Goal:** every invoice record says what the declaration will say about the software — its name
"Waitron", the build's version, "several taxpayers possible" = `N`, and (once the owner supplies
them) the producer's name and NIF instead of the taxpayer's — from one source file; while cancellations, the sending step and the backup
check keep using the taxpayer.

**Architecture:** a new `packages/fiscal-verifactu/src/software-identity.ts` holds the product's
own facts and the version; `VerifactuBackend.buildSistemaInformatico` reads it. The cancellation's
stored issuer name and the backup check's NIF comparison stop reading the software block. The
fiscal slot's `makeBackend` refuses a production start on a published image while the producer is
the placeholder.

**Tech stack:** TypeScript (tsc 7), Vitest 4.1 (node project in `packages/fiscal-verifactu`),
`node:sqlite` through `@waitron/db`, `@waitron/verifactu` 0.2.1.

**Spec:** [`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`](../specs/2026-10-21-a940-declaracion-responsable-design.md)
— §3 facts 1–4, §4 items a), e), f), h), i), §5.2, §8 ("Cancellations keep the taxpayer's name"),
§10 slice 1. Approved by the owner 2026-10-22, about 02:45.

**Path: FULL, and fiscal — the owner lands it.** The pull request is opened green and parked
`needs-owner-review`; nobody but the owner merges it.

## Global constraints

- `IDEmisorFactura` and `NombreRazonEmisor` stay the taxpayer's, from `currentSif`'s `nif` and the
  `tenants` row (`backend.ts:225,228,426,430,558,562`); a cancellation's `IDEmisorFacturaAnulada`
  stays the original sale's stored issuer (`original.id_emisor_factura`, `backend.ts:351`) —
  exactly as today.
- Values: `NombreSistemaInformatico` = `"Waitron"`; `TipoUsoPosibleSoloVerifactu` = `"S"`;
  `TipoUsoPosibleMultiOT` = `"N"`; `IndicadorMultiplesOT` = `"N"`; `IdSistemaInformatico` and
  `NumeroInstalacion` still from the SIF row (`backend.ts:651,653`), untouched — A993 changes them.
- `Version` = `0.0.0-dev+<the build's 40-character commit>` on a published build, else
  `0.0.0-dev` — design §5.1's form. The commit is the bundle stamp's `sourceCommit`, read by
  `software-identity.ts` itself (Task 1), and a stamp without a well-formed commit counts as none.
  The result is 50 characters, the field's limit (`checkXsdText("SistemaInformatico.Version", …,
  50)`, `@waitron/verifactu` 0.2.1 `dist/validate.js:459`); the fresh review's probe found `validate`
  reports no issue on it, and Task 1 pins that. Slice 4 swaps in the tag's version for a release.
- No Spanish outside `packages/fiscal-verifactu` and translation tables (CLAUDE.md §3); the recovery
  page's Spanish text is one of its existing tables (`apps/server/src/recovery-surface.ts`,
  `OPERATOR_TEXT`). Error code `sif.producer_unset`, beside its `sif.*` siblings
  (`packages/fiscal-verifactu/src/errors.ts:55-70`).
- **Rebase note:** pull request #1990 (A947 slice 4a, open) also changes
  `packages/fiscal-verifactu/src/errors.ts`. Whichever lands second resolves the overlap there and
  re-finds the line numbers this plan cites in that file.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1). Cut the "**Unverified**"
  paragraph at `backend.ts:52-63`; the flags are now the owner's answers, and the receipt is the
  design, §11, pointed at in one line.
- Every commit `git commit -s`. No `--no-verify`.

## The placeholder

`SOFTWARE_IDENTITY.producer` is `PRODUCER_PENDING`, a unique symbol exported from
`software-identity.ts`, with one comment line: `// PENDING: the owner's full name and NIF (A940
design §4 items h) and i), §11 Q1).` A symbol, not invented text, so nothing that looks like a
name or a NIF exists to be filed by mistake. Its two effects:

- `producerFields` answers the **taxpayer's** name and NIF while pending (today's values). Chosen
  over placeholder text, which AEAT's test service might reject — and the box's first production
  activation requires an accepted test submission (`activationReadiness`,
  `packages/fiscal/src/contribution.ts:115`), so a rejection would stop every preproduction setup.
- `refuseUnsetProducer` throws `sif.producer_unset` when the environment is `production`, the
  build is published (its bundle carries a stamp with a 40-character commit), and the producer is
  pending. It is called from the fiscal slot's `makeBackend`
  (`packages/fiscal-verifactu/src/slot.ts:54-61`), which the trading start calls once before it
  serves (`apps/server/src/till-backend.ts:38-49`, from `apps/server/src/boot.ts:1638`), so the box
  shows the recovery page instead of trading.

Why "published", and why read directly: every image a box can install carries the build stamp —
CI passes the commit (`.github/workflows/ci.yml:2787,2802`), `waitron.sh` builds a branch with it
(`deploy/waitron.sh:346`), and the Dockerfile writes the stamp unless the id is the literal
`development` (`deploy/Dockerfile:28-31`); the bundler puts it in as the global
`__WAITRON_HOUR_RELEASE__` (`scripts/bundle-node.mjs:45-47`). Unbundled source, which every test
suite runs, has no such global. `software-identity.ts` reads that global itself, with the same
`typeof` guard `hour-release.ts:11` uses, and does **not** call `readHourRelease()`: 39 test files
besides `hour-release.test.ts` name that function, most to hand the clock code a stamp (`git grep
-l readHourRelease -- apps packages`), and the fresh review measured what routing through it costs — 10 server
test files failing, 13 tests on `sif.producer_unset` at `boot.ts:1638` and 2 on a mocked stamp
with no commit. A refusal keyed on production alone was rejected for the same reason: 29 test files
set `WAITRON_ENV: "production"` (`git grep -ln 'WAITRON_ENV: "production"'` prints 31 paths, two of
them plans), and the trading start
builds the backend through `makeBackend` in each of them that reaches it. **Weaker than "cannot reach production", said plainly:** an unstamped
build run with `WAITRON_ENV=production` (source run by hand, or an image built with no build id, which the
Dockerfile treats as `development`, `deploy/Dockerfile:4,28-29`) is not refused — and it files today's taxpayer values, never placeholder text.
Slice 4's "production refuses an unreleased build" closes that gap; slice 2's `pnpm release
prepare` refuses while the producer is pending. Also disclosed: a box set up as "live" after this
lands and before the facts arrive cannot trade (the setup wizard's live choice writes
`WAITRON_ENV=production`, `deploy/Dockerfile:253`); the README says no box runs in production
(`README.md:9`) — I believe so; not checked on the owner's box.

Weighed and not taken: refusing in the backend's constructor or record builder in production (the
golden test builds `VerifactuBackend` directly with `deploymentEnvironment: "production"`,
`write-path.e2e.test.ts:71-76`, and would fail); having the host pass the build fact through
`FiscalBackendDeps` (a change to the cross-package fiscal contract and every `makeBackend` caller,
for the same answer the stamp already gives); a production refusal with a test-only way round it in those 29 files (large,
and a test bypass beside a fiscal guard); placeholder text in the records (the readiness risk
above); a check in the image build (it would stop CI publishing `:main` until the facts arrive).

## Review focus

1. **A cancellation recorded after the producer is set** must carry the taxpayer's name in its
   stored issuer-name column and its submission header, not the producer's — Task 3.
2. **A restore of a backup whose records name a producer** different from the taxpayer must
   verify; one whose issuer NIF differs from its SIF row must still be refused — Task 4.
3. **A preproduction box on a published image** with the producer pending must keep trading;
   only production refuses — Task 5's served cases.
4. **The version a published build files** — 50 characters — must pass the library's
   validation, and a stamp with no usable commit must give `0.0.0-dev`, not a crash — Task 1.
5. **Every record kind** — sale, corrective, substitute, cancellation — must carry the same block;
   the four call sites share `buildSistemaInformatico` (`backend.ts:238,360,450,570`) — Task 2's
   grep step and Task 3's cancellation case.

---

### Task 1: `software-identity.ts` — the facts, the version, the producer fields, the refusal

**Files:**
- Create: `packages/fiscal-verifactu/src/software-identity.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts:66-70` — add
  `"sif.producer_unset": { environment: string };` with a one-line doc comment
- Test: `packages/fiscal-verifactu/src/software-identity.test.ts`

**Interfaces — produces:**

```ts
export const PRODUCER_PENDING: unique symbol;
export interface SoftwareProducer { readonly name: string; readonly nif: string }
export interface SoftwareIdentity {
  readonly name: string;                 // "Waitron"
  readonly code: string;                 // WAITRON_ID_SISTEMA, imported from ./software.js (kept)
  readonly onlyVerifactu: SiNo;          // "S"
  readonly multipleTaxpayersPossible: SiNo; // "N"
  readonly multipleTaxpayersNow: SiNo;   // "N"
  readonly producer: SoftwareProducer | typeof PRODUCER_PENDING;
}
export const SOFTWARE_IDENTITY: SoftwareIdentity;
// The bundle stamp's 40-character `sourceCommit`, read from the global `__WAITRON_HOUR_RELEASE__`
// with hour-release.ts:11's `typeof` guard — never through readHourRelease(); null when absent,
// not an object, or its commit is not /^[a-f0-9]{40}$/.
export const BUILD_COMMIT: string | null;
export function softwareVersion(commit?: string | null): string; // default BUILD_COMMIT
export function producerFields(
  identity: SoftwareIdentity,
  taxpayer: { legalName: string; nif: string },
): { NombreRazon: string; NIF: string };
export function refuseUnsetProducer(
  environment: string,
  published?: boolean,          // default BUILD_COMMIT !== null
  identity?: SoftwareIdentity,  // default SOFTWARE_IDENTITY
): void;
```

The module starts with `import "./errors.js";`, as every file that throws a code does (CLAUDE.md
§3; e.g. `registro-sif.ts:2`), and imports `WAITRON_ID_SISTEMA` from `./software.js`, which stays.

- [ ] **Step 1: Write the failing tests** in `software-identity.test.ts`:
  - "holds the owner's answers": `SOFTWARE_IDENTITY` has `name: "Waitron"`, `code: "W1"`,
    `onlyVerifactu: "S"`, `multipleTaxpayersPossible: "N"`, `multipleTaxpayersNow: "N"`.
  - "names a published build by its commit": `softwareVersion("0123456789abcdef0123456789abcdef01234567")`
    is `"0.0.0-dev+0123456789abcdef0123456789abcdef01234567"` (50 characters);
    `softwareVersion(null)` is `"0.0.0-dev"`; `softwareVersion()` in this unbundled run is
    `"0.0.0-dev"`.
  - "reads the bundle's stamp itself": with `vi.stubGlobal("__WAITRON_HOUR_RELEASE__", { sourceCommit:
    <that commit> })`, `vi.resetModules()` and a dynamic `import("./software-identity.js")` (the
    pattern of `hour-release.test.ts:30-37`, with that file's `afterEach` at `:4-9` copied — it
    calls `vi.unstubAllGlobals()` and `vi.resetModules()`, so a stubbed stamp never reaches the
    file's other cases), `BUILD_COMMIT` is that commit; with `{}`, with
    `{ sourceCommit: "short" }` and with `null` it is `null` and `softwareVersion()` is
    `"0.0.0-dev"` — a stamp with no usable commit never throws.
  - "is not fooled by a mocked release reader": with `vi.doMock("./hour-release.js", () => ({
    readHourRelease: () => ({ sourceCommit: <that commit>, … }) }))` and no global, a fresh import
    has `BUILD_COMMIT` `null`. This is the case the fresh review's 10 failing server files needed.
  - "a published version passes AEAT's checks": a `buildAltaRecord` whose block carries the
    50-character version gives `validate(record, { now })` with no issue on
    `SistemaInformatico.Version` (copy the record shape from
    `packages/fiscal-verifactu/src/initial-paper-candidates.ts:44-77`).
  - "keeps the taxpayer while the producer is pending": `producerFields({ ...SOFTWARE_IDENTITY,
    producer: PRODUCER_PENDING }, { legalName: "Bar Lucía S.L.", nif: "B12345674" })` equals
    `{ NombreRazon: "Bar Lucía S.L.", NIF: "B12345674" }`.
  - "names the producer once supplied": with `producer: { name: "Producer Person", nif:
    "12345678Z" }` the answer is `{ NombreRazon: "Producer Person", NIF: "12345678Z" }` — three
    different strings from the taxpayer's, so a mix-up cannot pass.
  - "refuses a published production build while pending": `refuseUnsetProducer("production",
    true, pending)` throws an `AppError` with `code: "sif.producer_unset"` and `params:
    { environment: "production" }` (assert the code, CLAUDE.md §4).
  - The cases it must still serve, each its own `it`: `("preproduction", true, pending)`,
    `("production", false, pending)`, `("production", true, filled)` do not throw.
- [ ] **Step 2: Run, expect FAIL** (module missing):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/software-identity.test.ts`
- [ ] **Step 3: Implement** the module and the error code. `SOFTWARE_IDENTITY.producer` is
  `PRODUCER_PENDING` with the comment line given under "The placeholder".
- [ ] **Step 4: Run Step 2's command — PASS.** Prove the refusal by deletion: delete the
  `published` term, the refusing case still passes and the `("production", false, pending)` case
  fails; delete the pending test, the `filled` case fails. Restore. Write both results in the
  commit message.
- [ ] **Step 5: Run the guards** `pnpm exec vitest run scripts/errors-reachable.test.ts
  scripts/english-only.test.ts` — PASS. (`errors-reachable` checks that the package's `errors.ts`
  is reached from its front file, `scripts/errors-reachable.test.ts:1-11`; it does not check that a
  code is thrown.)
- [ ] **Step 6: Commit** — `fiscal: one file for what the records say about the software`.

### Task 2: the records' software block comes from the identity file

**Files:**
- Modify: `packages/fiscal-verifactu/src/backend.ts` — delete `SystemInfoDefaults` and
  `DEFAULT_SYSTEM_INFO` with their comment (`:52-78`); replace `systemInfo?` (`:104-106`) with
  `identity?: SoftwareIdentity` (doc: one line, "Tests only; production passes none (./slot.ts)");
  the field and constructor (`:173,180`); `buildSistemaInformatico` (`:646-658`) becomes
  `buildSistemaInformatico(sif: SifRegistration, taxpayer: { legalName: string; nif: string })`
  using `producerFields`, `identity.name`, `softwareVersion()`, and the three flags; its four
  callers (`:238,360,450,570`) pass `{ legalName: tenant.legalName, nif: sif.nif }`.
- Modify: `packages/fiscal-verifactu/src/initial-paper-candidates.ts:65-75` — the synthetic
  check's `NombreSistemaInformatico` and `TipoUsoPosibleMultiOT` read `SOFTWARE_IDENTITY` (it is
  never filed; this keeps the string "Waitron POS" out of the code).
- Test: `packages/fiscal-verifactu/src/backend.test.ts` (new `describe("the software block")`).

**Interfaces — consumes:** Task 1's `SOFTWARE_IDENTITY`, `PRODUCER_PENDING`, `producerFields`,
`softwareVersion`. **Produces:** `VerifactuBackendOptions.identity?: SoftwareIdentity`.

- [ ] **Step 1: Write the failing tests**, recording one sale each through `recordSale` with a
  seeded tenant (`seedTenantWithSif`, legal name "Waitron SL") and reading the stored
  `sistema_informatico`:
  - "files the owner's answers and the build's version": default backend → `NombreSistemaInformatico:
    "Waitron"`, `Version: "0.0.0-dev"`, `TipoUsoPosibleSoloVerifactu: "S"`, `TipoUsoPosibleMultiOT:
    "N"`, `IndicadorMultiplesOT: "N"`, and, the producer pending, `NombreRazon: "Waitron SL"`,
    `NIF` equal to the row's `id_emisor_factura`.
  - "names the producer, and only in the software block": backend with `identity: {
    ...SOFTWARE_IDENTITY, producer: { name: "Producer Person", nif: "12345678Z" } }` → block
    `NombreRazon: "Producer Person"`, `NIF: "12345678Z"`; the row's `id_emisor_factura` is still
    the SIF's NIF and `nombre_razon_emisor` is still "Waitron SL".
- [ ] **Step 2: Run, expect FAIL:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backend.test.ts`
- [ ] **Step 3: Implement** as listed under Files.
- [ ] **Step 4: Run Step 2's command — PASS.** Then, from the repository root,
  `git grep -nw "SistemaInformatico:" -- packages/fiscal-verifactu/src ':!*.test.ts' ':!packages/fiscal-verifactu/src/testing'`
  must print only `backend.ts`'s four call sites and `initial-paper-candidates.ts`, and
  `git grep -n "systemInfo\|Waitron POS" -- packages apps ':!*.json' ':!*.test.ts' ':!packages/fiscal-verifactu/src/testing'`
  nothing. `TEST_SISTEMA` in `packages/fiscal-verifactu/src/testing/seed.ts:16-26` keeps
  "Waitron POS": it is fixture input that the chain tests append directly, not what the backend
  builds, and changing it would move fixture rows other suites read for no gain.
- [ ] **Step 5: Run the golden and immutability suites, unedited:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  — PASS, with `git diff --stat main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts
  packages/fiscal-verifactu/src/inmutabilidad.test.ts` empty.
- [ ] **Step 6: Commit** — `fiscal: records name Waitron, the build's version and one taxpayer`.

### Task 3: a cancellation keeps the taxpayer's name

Today a cancellation's stored issuer name is read from the software block
(`packages/fiscal-verifactu/src/registro-row.ts:161`), and that column is what the sending step
groups by and puts in the submission header (`drain.ts:582-588`, `cabeceraFor` at `:1220-1225`).
Once the block names the producer, cancellations would go out under the producer's name.

**Files:**
- Modify: `packages/fiscal-verifactu/src/chain.ts:64-70` — the `anulacion` member of
  `PendingRegistro` gains `nombreRazonEmisor: string` (beside `entorno`, outside `input`, so it
  never reaches the hash); `:196-204` passes it on.
- Modify: `packages/fiscal-verifactu/src/registro-row.ts:24-53,161` — `RegistroRowContext` gains
  `nombreRazonEmisor?: string`, required for an anulación (throw a plain `Error` naming the field
  when absent: a programming error, not a domain refusal); line 161 reads it.
- Modify: `packages/fiscal-verifactu/src/backend.ts:365-369` — `recordVoid` passes
  `nombreRazonEmisor: tenant.legalName`.
- Modify: `packages/fiscal-verifactu/src/testing/seed.ts:270-290` — `anulacionFor` passes
  `nombreRazonEmisor: "Waitron SL"` (today's value from `TEST_SISTEMA.NombreRazon`, so stored rows
  are unchanged).
- Test: `packages/fiscal-verifactu/src/void-path.e2e.test.ts` (new `describe`).

- [ ] **Step 1: Write the failing tests:**
  - In `void-path.e2e.test.ts`, "a cancellation keeps the taxpayer's name when the software names
    a producer": the suite's set-up with the backend built with a filled producer (`identity: { …,
    producer: { name: "Producer Person", nif: "12345678Z" } }`); sell, void; the anulación row has
    `nombre_razon_emisor` "Waitron SL" and `sistema_informatico.NombreRazon` "Producer Person".
  - In `drain.test.ts`, beside "submits a voided sale's anulación through the same
    accept-and-persist path as an alta" (`drain.test.ts:110-157`, the template), "a cancellation
    goes out under the taxpayer's name when the software names a producer": the same set-up with
    the filled producer. Take **one** client, `const client = aeat.client()`, wrap its `submit`
    (`@waitron/verifactu` 0.2.1 `dist/client.d.ts:17`) in `vi.spyOn` to capture each call's
    `Cabecera`, and pass `staticResolver(client)` to the backend and to both drain passes: each
    `aeat.client()` call builds a new client (`dist/testing/fake-aeat.js:394`), and the template
    calls it afresh for each pass (`drain.test.ts:128,140,155`), so a spy on another instance
    records nothing. A cancellation is sent only after its
    original sale has an answer (`drain.ts:601-611`), so run the first pass, then the second at
    `first.nextDueAt`, as the template does; the second pass's captured `Cabecera.ObligadoEmision`
    is `{ NombreRazon: "Waitron SL", NIF: <the SIF's NIF> }`. This is design §8's "Cancellations
    keep the taxpayer's name".
- [ ] **Step 2: Run, expect FAIL** (the row stores "Producer Person"):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-path.e2e.test.ts src/drain.test.ts`
- [ ] **Step 3: Implement** as listed under Files.
- [ ] **Step 4: Run Step 2's command, then the drain and chain suites** —
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/void-path.e2e.test.ts src/drain.test.ts src/drain.names.test.ts src/chain.test.ts src/registro-row.roundtrip.test.ts src/reconcile.test.ts src/inmutabilidad.test.ts`
  — PASS, reading the `Tests` count (a misspelt file name matches nothing silently). Prove by
  deletion: point line 161 back at `record.SistemaInformatico.NombreRazon`; both new cases fail.
  Restore. The same stored name is also the header of the two lookups AEAT is asked
  (`reconcile.ts:273`, `drain.ts:1653`), so this one fix covers them; the duplicate-reply check at
  `drain.ts:1679-1687` compares AEAT's stored copy of a record with our own row of the same record,
  so it is unaffected.
- [ ] **Step 5: Commit** — `fiscal: a cancellation is filed under the taxpayer's name, not the producer's`.

### Task 4: the backup check compares the issuer's NIF, not the software block's

`backup-verification-chain.ts:104-110` refuses a record whose software-block `NIF` differs from its
SIF row's `nif`, the taxpayer's. Every record naming the producer would make every backup fail,
and a restore with it. The issuer's NIF (`id_emisor_factura`, hashed) is what binds a record to its
taxpayer.

**Files:**
- Modify: `packages/fiscal-verifactu/src/backup-verification-chain.ts:107` — compare
  `row.id_emisor_factura` with `sif.nif`; keep the `IdSistemaInformatico` and `NumeroInstalacion`
  comparisons.
- Modify: `packages/fiscal-verifactu/src/backup-verification-chain.test.ts:39-43` — the `append`
  helper also sets the issuer NIF (`IDEmisorFactura`, or `IDEmisorFacturaAnulada` for a void) to
  `sif!.nif`.
- Test: the same file.

- [ ] **Step 1: Write the failing test** "accepts records whose software block names a producer
  other than the taxpayer": append records whose block `NIF` is `"12345678Z"` (and `NombreRazon`
  "Producer Person"), back up, verify → accepted. No new tamper row: a changed
  `id_emisor_factura` is already refused by the fingerprint check (`verifyHuella`,
  `backup-verification-chain.ts:34`) before the NIF comparison is reached — the "old hashed
  content" row covers it.
- [ ] **Step 2: Run, expect FAIL** (the producer case is refused):
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/backup-verification-chain.test.ts`
- [ ] **Step 3: Implement** the comparison and the helper change.
- [ ] **Step 4: Run Step 2's command — PASS**, including the existing "wrong taxpayer identity"
  row (`:270-271`) unchanged. Prove by deletion: delete the issuer comparison; "wrong taxpayer
  identity" fails (the fresh review ran this: it fails, while a changed-issuer row still passes on
  the fingerprint). Restore. Then run the restore suites that read this check:
  `pnpm --filter @waitron/server exec vitest run src/restore-fiscal-e2e.test.ts src/restore-fiscal-receipt.test.ts src/restore-command.archive.test.ts src/backup-verification-compatibility.test.ts`
  — PASS; a failure there is reported, not edited around.
- [ ] **Step 5: Commit** — `fiscal: a backup's records are bound to their taxpayer by the issuer's NIF`.

### Task 5: a production start on a published image refuses while the producer is pending, and says why

**Files:**
- Modify: `packages/fiscal-verifactu/src/slot.ts:54-61` — export
  `makeVerifactuBackend(deps: FiscalBackendDeps, published: boolean): VerifactuBackend`, which calls
  `refuseUnsetProducer(deps.environment, published)` and then builds today's backend; the slot's
  `makeBackend: (deps) => makeVerifactuBackend(deps, BUILD_COMMIT !== null)`. Never
  `readHourRelease()` (see "The placeholder").
- Modify: `apps/server/src/recovery-surface.ts` — an `OPERATOR_TEXT` entry for `sif.producer_unset`
  beside `deployment.environment_mismatch` (`:316-329`). Today a code with no entry is shown with
  the generic text (`:464-467`). The wording, fixed:
  - `en-GB` title: "This version of Waitron does not yet name its producer, so it cannot be used
    for real sales." Action: "Ask whoever installed this box to install a version that names its
    producer."
  - `es-ES` title: «Esta versión de Waitron todavía no indica quién la produce, así que no puede
    usarse para ventas reales.» Action: «Pide a quien instaló este equipo que instale una versión
    que indique quién la produce.»
- Test: `packages/fiscal-verifactu/src/slot.test.ts` (exists; add a `describe`) and
  `apps/server/src/recovery-surface.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `slot.test.ts`, "refuses a published production build while the producer is pending":
    `makeVerifactuBackend({ db, clock, environment: "production" }, true)` throws
    `sif.producer_unset`. Served: `(…"preproduction"…, true)` and `(…"production"…, false)` return
    a backend whose `id` is `"verifactu"`; and the slot's own `makeBackend` with `"production"` in
    this unbundled run returns a backend (no stamp, so no refusal).
  - `recovery-surface.test.ts`, "names the missing producer, in each language": the page for
    `sif.producer_unset` contains the English title and action above for an English browser and
    the Spanish ones for a Spanish browser, built the way "the page's language" cases build theirs
    (`recovery-surface.test.ts:247-262`). The table-wide cases (`:327-365`: both languages present
    and different, never a word that suggests wiping) then cover the entry too.
- [ ] **Step 2: Run, expect FAIL:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/slot.test.ts` and
  `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run Step 2's commands — PASS**; delete the call to `refuseUnsetProducer`, the
  refusing case fails; restore. Then the guards:
  `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts scripts/english-only.test.ts`
  — PASS.
- [ ] **Step 5: Re-run every test file that names `readHourRelease`**, the two helpers' importers,
  and the boot suite that builds the backend — the files that broke in the fresh review's
  experiment (check free memory first, `memory_pressure | grep free`). Run the block under `bash`,
  which splits the file lists into separate arguments (the Bash tool's zsh does not split an
  unquoted variable):

  ```bash
  bash <<'EOF'
  git grep -l readHourRelease -- 'apps/server/src/*.test.ts' | sed 's|apps/server/||' > /tmp/a940-1-server.txt
  git grep -l "staged-hour-restore\|hour-recovery-host" -- 'apps/server/src/*.test.ts' | sed 's|apps/server/||' >> /tmp/a940-1-server.txt
  echo src/boot.till-clock.test.ts >> /tmp/a940-1-server.txt; sort -u -o /tmp/a940-1-server.txt /tmp/a940-1-server.txt
  (cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm exec vitest run $(cat /tmp/a940-1-server.txt))
  for pkg in composition fiscal-verifactu provisioning; do
    files=$(git grep -l readHourRelease -- "packages/$pkg/src/*.test.ts" | sed "s|packages/$pkg/||")
    (cd packages/$pkg && pnpm exec vitest run $files)
  done
  EOF
  ```

  That is 34 server files (the seed golden test is Task 6's). Pass condition: **no file fails
  that does not also fail on `main`** — run the same block on `main` as the control and report
  both — **and the log holds no `sif.producer_unset` and no `slice` crash**. Counts may differ
  between the two runs: in this plan's own measurement (item 3 at the top) the control failed
  tests the sketch passed. A file failing here and not on `main` stops the task.
- [ ] **Step 6: Commit** — `fiscal: a published production build will not trade until the producer is named`.

### Task 6: the checks whose expected values the design changes, and the wider runs

**Files:**
- Modify: `apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json` (re-recorded)

- [ ] **Step 1: Run the seed golden test, expect FAIL** on `sistema_informatico` only:
  `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-sales.golden.test.ts`
- [ ] **Step 2: Re-record:** `WAITRON_WRITE_GOLDEN=1 pnpm --filter @waitron/server exec vitest run
  scripts/demo-seed/seed-sales.golden.test.ts`. Then
  `git diff --numstat -- apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json`
  must print `31	31`, and `git diff -U0 -- <that file> | /usr/bin/grep '^[-+] ' | /usr/bin/grep -vc sistema_informatico`
  must print `0` — so no `huella`, amount or number line moved. If either differs, stop and report.
  Run Step 1's command again — PASS. Run
  `pnpm --filter @waitron/server exec vitest run src/taxpayer-rename.filing.test.ts` — PASS
  unedited (its lines 92-93 stay true while the producer is pending; Task 8 removes them).
- [ ] **Step 3: Run the whole fiscal package and the server's fiscal suites** for feedback (CI owns
  the package runs, CLAUDE.md §2):
  `pnpm --filter @waitron/fiscal-verifactu test:coverage` — PASS at `98/98/98/95`, reading the
  per-file table for `software-identity.ts`; and
  `pnpm --filter @waitron/server exec vitest run src/full-comp.fiscal-identity.test.ts src/served-at-huella.test.ts src/qr-link-range.test.ts`.
  Check free memory first (`memory_pressure | grep free`). Any other failing expectation: stop and
  report it with the reason.
- [ ] **Step 4: Commit** — `test: re-record the Spanish practice sales for the new software block`
  with the two `git diff` outputs of Step 2 in the message.

### Task 7: docs, and the pull request parked for the owner

**Files:**
- Modify: `docs/backlog.md` — the A940 entry: slice 1 built and parked for the owner; what stays
  open (the producer's facts — Task 8 — and slices 1b to 6). The backend citation moves to the
  new line numbers.
- Modify: `docs/compliance/action-plan.md` — Step 8's dated note: slice 1's pull request number,
  parked for the owner.
- CLAUDE.md: no rule changes. §5's "Never put our own metadata into a hash" is unchanged and this
  slice's probe is consistent with it.

- [ ] **Step 1: Write the doc changes.** `pnpm exec prettier --file-info docs/backlog.md` prints
  `"ignored": true`, so no format check applies to them.
- [ ] **Step 2: Commit** — `docs: A940 slice 1 is built and waits for the owner`.
- [ ] **Step 3: Run `/finish-branch`** with this plan named. Its review wave is the full one
  (fiscal is a risk trigger), and the Codex run-it seat runs as two reviews.
- [ ] **Step 4: The pull request's description** opens with "Fiscal — the owner lands this", then:
  the probe's three lines from the top of this plan and how to re-run it; that no migration is
  added; the placeholder and its stated limits; every changed test check from item 4 at the top;
  and that a box set up "live" before Task 8 cannot trade. Label it `needs-owner-review`. Do not
  merge.

### Task 8 (only when the owner supplies his name and NIF): fill the producer

> **Superseded 2026-11-03 by "Task 8, amended" below** (the owner, 2026-11-02: the two values
> never enter the repository or an image). Kept as written for the record.

- [ ] Replace `PRODUCER_PENDING` in `SOFTWARE_IDENTITY` with `{ name: "<as the owner writes it>",
  nif: "<his NIF>" }`; keep `PRODUCER_PENDING` exported for the tests.
- [ ] Add a case to `software-identity.test.ts`: `SOFTWARE_IDENTITY.producer` is not
  `PRODUCER_PENDING`, and its `nif` passes the library's NIF check (a `validate` run on a record
  carrying it shows no `SistemaInformatico.NIF` issue).
- [ ] Re-run Task 6 Steps 1–2: the seed golden's 31 `sistema_informatico` lines change again (the
  producer's name and NIF), and nothing else.
- [ ] Delete `apps/server/src/taxpayer-rename.filing.test.ts:92-93` (the comment and the assertion
  that the software block's `NombreRazon` follows the taxpayer's rename — false from this commit,
  since the block now names the producer); line 91, the issuer's name following the rename, stays.
  Run `pnpm --filter @waitron/server exec vitest run src/taxpayer-rename.filing.test.ts` — PASS.
  This is a changed test check under the owner's 2026-10-05 rule; list it in the pull request.
- [ ] Commit — `fiscal: the records name the owner as the software's producer`. In the same pull
  request if it is still open; otherwise its own fiscal pull request, which the owner lands.

### Task 8, amended (2026-11-03): the producer's name and tax number reach a box privately

> **2026-11-04: the owner did not take the question below as posed.** Their answer asks for the venue
> database, a mirror taking the values from the main box, and an official install with no manual step.
> "Task 8, proposal of 2026-11-04", below, answers it and, once approved, replaces this section's table
> and its "Disclosed" and "Later slices" paragraphs. `--producer-file` stays as "How they get there" defines
> it. Nothing here is built.

**Why it changed.** The owner gave the two values on 2026-11-02 and chose to keep them out of
everything public ("let's do b"): the repository is public, and so are the images
`ghcr.io/clintongormley/waitron` and `waitron-print-agent`, so writing the values into
`SOFTWARE_IDENTITY` or into the image at build time would publish them. They are held outside the
repository, in a private file on the owner's machine. **Neither value may appear in the repository,
a commit, a pull request, a CI log, a test fixture, the backlog, a plan or an image.** The tax number
is a Spanish NIE (a foreign resident's identity number, which serves as the tax number).

**Where the box reads them.** Two settings, `WAITRON_PRODUCER_NAME` and `WAITRON_PRODUCER_TAX_ID`, in
the box's own `.env` — the host file beside `compose.yml` that is never committed and that
`waitron.sh` keeps at mode 600 (`deploy/.env.example:1-2`, `deploy/waitron.sh:173-195`), where the
backup recovery key already lives. `deploy/compose.yml` passes both into the app container the way
it passes `WAITRON_BACKUP_RECOVERY_KEY` (`deploy/compose.yml:37-38`), and `software-identity.ts`
reads them from the process environment at start, as `allocation-configuration.ts:180` already reads
its settings. An empty value counts as unset (CLAUDE.md §3, "An empty value is a valid value"; compose
hands an unset `${…:-}` over as an empty string).

**How they get there on a real install.** `waitron.sh install --producer-file <path> [ref]` reads the
two `KEY=value` lines from the operator's private file, line by line — never by sourcing it, because
an unquoted value with a space in it breaks shell sourcing — and writes each into `.env` with
`env_set` (atomic, 600). Later installs and updates keep them: `env_set` rewrites only its own key,
and a reset leaves `.env` alone (`wipe_box` removes the volumes and the state folder only,
`deploy/waitron.sh:791-813`). The option is refused with a plain message if the file is missing,
unreadable, or lacks either line. Nothing prints either value: the install says only "producer
details recorded".

**What a start does with them.**

| Both settings | What new records carry | Production start, published image | Development and preproduction |
| --- | --- | --- | --- |
| Unset (or empty) | The taxpayer's name and tax number, exactly as today | Refuses: `sif.producer_unset` (kept) | Trade as today |
| Set and valid | The producer's name and tax number | Trades | Trade, filing the producer (so AEAT's test service sees the real values before go-live) |
| One set without the other, or either invalid | — | Refuses: new `sif.producer_invalid` | Refuses: `sif.producer_invalid` |

"Valid": the name, trimmed, has content and at most 120 characters (the library's limit for
`SistemaInformatico.NombreRazon`, `@waitron/verifactu` 0.2.1 `dist/validate.js:458`); the tax number
passes the library's `hasValidNifControl`. Refusing a bad value in every environment means a typo
shows on the first preproduction start, not as a wrong producer in every record of a live venue.
Both codes get a recovery-page title and action in English and Spanish
(`apps/server/src/i18n/recovery-page.ts`); `sif.producer_unset`'s words change, because the cause is
now this box's settings, not the version ("This box has not been given the name and tax number of
Waitron's producer, so it cannot be used for real sales."). The error carries no value in its
params, only which setting is missing or wrong.

**An NIE passes both checks — measured 2026-11-03 with made-up numbers.** The library's
`hasValidNifControl` (`@waitron/verifactu` 0.2.1 `dist/nif.js`) answered `true` for `X1234567L`,
`Y1234567X` and `Z1234567R` (made up, each with its correct check letter) and `false` for
`X1234567A`, the same number with a wrong letter — so the check can fail. The software's own
`validateSpanishNif` accepts an NIE as kind `foreigner` (`packages/country-es/src/spain.ts:51-57`;
its suite pins `X2482300W` as valid and `X2482300A` as a bad check letter,
`packages/country-es/src/spain.test.ts:19,35`). The owner's real value was checked the same way by a
script that printed only booleans: NIE shape, check letter passes.

**Which test checks change, against the original Task 8.**

- `apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json` — **unchanged**: the
  seed runs with neither setting, so its records keep the taxpayer's values.
- `apps/server/src/taxpayer-rename.filing.test.ts:92-93` — **stays** (that suite sets neither
  setting, so the block still follows the taxpayer); a new case with both settings set shows the
  block keeping the producer across a rename.
- `packages/fiscal-verifactu/src/software-identity.test.ts` — the `SOFTWARE_IDENTITY.producer`
  constant becomes a reader of the environment; new cases for each row of the table, and for an
  empty value counting as unset. The existing `producerFields` and `refuseUnsetProducer` cases keep
  their expectations.
- `packages/fiscal-verifactu/src/slot.test.ts:70,106` — keep their expectations.
- `apps/server/src/recovery-surface.test.ts:344,470` — follow the new words, and gain the new code.
- A guard that pins compose's environment list or `.env.example`'s lines (`scripts/deploy-image-env.test.ts`,
  `scripts/backup-compose-env.test.ts`) gains the two names, if it pins a list; no existing value changes.
- Test fixtures use made-up values only (`PRODUCER PERSON`, `X1234567L`).

**The no-leak check, before every push.** Load both real values from the private file into
variables and count matches in `git diff origin/main...HEAD` and in the branch's commit messages:
expect 0. Control in the other direction: the same command run over a scratch file holding one of
the values prints 1. Weaker than its name: it reads the diff and messages only, not CI logs or
what a box writes. I found no log line in `packages/fiscal-verifactu/src` that writes a record's
software block (a grep for log calls naming xml, sistema or body); not traced further.

**Disclosed: a box installed without the file cannot trade for real.** It refuses with the recovery
page at its first production start. That includes a replacement box restored from a backup and a
spare box taking over in a handover (A1018), if their install missed the file — the values are a
box setting, so a backup, the bucket stream and a handover do not carry them. The alternative that
would carry them (also keeping them in the venue database, so a restore or takeover brings them
back by itself) is the open owner question in `~/waitron-campaign/questions.md`, 2026-11-03.

**Later slices.** The in-app declaration screen and the outside copy (design §4, slices 3 onward)
read the producer from this same reader; the published declaration text holds placeholders filled at
run time, never the values. A venue Waitron Cloud hosts gets the same two settings from Cloud's own
private configuration.

- [ ] Build only after the owner's answer, with implementers, test-first; the table above is the
  case list.
- [ ] Commit — `fiscal: the records name the software's producer from the box's private settings`.
  Its own fiscal pull request, which the owner lands.

### Task 8, proposal of 2026-11-04: stored in the venue database, delivered on the owner's own stick

**Status: a proposal for the owner. Not approved, not built.** The owner's answer, 2026-11-04 about
05:50: "I'm unsure of the mechanism but these values need to be set during the install process from the
usb as well, whether it is on the usb or from the containers that the usb downloads. But if somebody
forks the code and builds their own version then they need to set these values independently. Also,
when somebody starts a mirror node then that node's values need to be the same as for the primary.
Either that is set but the installer usb or container, or by taking the value from the primary. I'm
leaning towards the value being stored in the dB and the mirror taking the value from the primary."

Installer facts below are read from the approved B3 design, which is not fully built, and code facts
are read from `main`. Nothing here was run except the measurements and downloads it names.

**Where the values live.** One new row in the venue database: a table in `fiscal-verifactu`'s own
migration set, one row at most, holding the name, the tax number and the origin of the build that wrote
it. It is classified `state`, the first such table in that set (the rest are `ledger` or `local`), with
no append-only trigger, because A993 and a fork's restore replace it. `fiscal-verifactu` is declared
`kind: "none"` for configuration transfer (`packages/composition/src/modules.ts:337`), so a
configuration copy does not carry it. The box's private `.env` settings and `--producer-file` from the
2026-11-03 amendment stay, as the way the values first enter a box.

**The rule: once the row exists, it decides, and a box's settings play no part.** That is the owner's
"taking the value from the primary", and it means a wrong setting can never stop a working venue.

| The row | The box's settings | What happens |
| --- | --- | --- |
| None, and no fiscal record yet | Valid | Written, and every later record names these values. Each path below writes it before it creates the box's filing identity |
| None, with fiscal records | Valid | In development or preproduction: not written, and records go on naming the taxpayer, so a chain never changes producer. In production: written on a restore, since it starts a new chain; otherwise refuses `sif.producer_unset` |
| None | Unset, on a published build, with production asked for or running | Refuses `sif.producer_unset`, at Live setup before anything is created (below) and at any start, as today |
| None | Unset, in development or preproduction | Records name the taxpayer, as today |
| None | Half-set or invalid | Refuses `sif.producer_invalid`, in every environment |
| Present, its own shape invalid | Anything | Refuses `sif.producer_invalid`, before anything is filed. This checks shape only, so a tightened rule in a later release does not stop every box |
| Present, written by a build of the same origin | Anything | The row is used. A setting that differs from it, or is invalid, raises an alert (new, with its English and Spanish wording), and sales go on |
| Present, another origin, on a restore in production | Valid | The row is replaced, because a restore starts a new chain anyway (CLAUDE.md §5) |
| Present, another origin, otherwise in production | Anything | Refuses `sif.producer_other_build`. Preproduction uses the row, since a preproduction database is never promoted |

Two consequences to state plainly:

- This corrects the 2026-11-03 question, which said the settings win and the database copy is updated.
  That would have put a new producer on an old chain, which A993's design forbids.
- The first value sticks. A misspelt name of a valid shape is filed until A993 exists to change it
  (or the venue is reset before go-live). The stick-making command checks the tax number and the name's
  length, but no check can catch a misspelling.

**When it is checked, so that a refusal never comes too late.** A takeover commits and only then restarts
(`apps/server/src/boot.ts:3373-3403`), so a check left to the next start would stop the venue with the old box
already stepped down. So the checks run before the point of no return:

- **Live setup:** at its start (`setup-first-fiscal-api.ts`'s claim route, `:404`) and again before
  `activateFirstFiscal` (`first-fiscal-activation.ts:99`) creates the filing identity. Prepare and a no-regime
  Live, before `provision` (`setup-api.ts:905`). `waitron-provision venue`, before `applyVenue`
  (`packages/provisioning/src/cli.ts:476`).
- **A restore:** on every route (file, cloud, bucket, `waitron-restore`), once the copy is decrypted into its
  scratch folder, beside the existing `refuseIfArchiveSourceLive` check, before anything is staged or placed.
- **A spare:** at the main box's joining route before it reserves anything (3b Task 5.3's refusals, opened for
  Veri\*Factu by 3b-F), comparing an origin the spare's existing request gains; Task 6.3's copy check is the
  backstop.
- **A promotion:** again before it writes anything.

A joining spare returns before today's refusal (`boot.ts:1699-1745`, then `boot.ts:2066`, reaching `slot.ts:39`),
and a placed copy holds the row, so a spare needs no exception there. Read, not run. A947 3b and A1018 each gain
the one origin step named here.

**The origin of a build.** The build stamp gains one field, read from a repository variable
(`vars.WAITRON_BUILD_ORIGIN`) that the owner sets once on the official repository. Its value is a chosen word, not
the repository's name, so a move only has to confirm the variable came along. The generator turns an empty value
into `unknown`, and the publish job stops on an empty one, so a fork that publishes images has to choose its own
word. Comparison is literal, `unknown` included. GitHub says a fork "has its own settings" but, in the pages read on
2026-11-04, never says a repository variable stays behind, so this is tested on one real fork before anyone relies on
it. This touches the generator (`scripts/generate-hour-release.mjs` refuses a new argument today), a new `ARG` in
`deploy/Dockerfile` and the four build steps (`ci.yml:4048,4063`, `image-smoke.yml:140,155`). `waitron.sh install
<ref>` needs no change: its on-box builds stamp `unknown`, so in production they are refused against an official row.

It protects against an accident, not a lie, and it misses two accidents. A box that keeps an official `.env`, swaps its
image for a fork's through `WAITRON_IMAGE` and starts with a new database writes the official values under the fork's
origin. And `unknown` matches `unknown`, so a fork built on the box takes the row from a backup written by any on-box
or unlabelled build, official values included. Only a fork that sets its own origin is protected.

**A mirror takes the values from the main box, with no new call between boxes.** A spare's first full copy
is the whole `venue.db` (3b plan, "The first full copy", Tasks 6.3 and 6.4, D10), and so is A1018's final
copy (`handover-capture.ts:109`), a restore, and the bucket stream. The owner's 3b answer (c), that switch-on
writes the dormant filing setup from the spare's copy, finds the row in that same copy. A spare needs no
values of its own. Read, not run; a control with `VACUUM INTO` showed a one-row table being carried.

**What is public, so what cannot carry the values.** The installer `waitron-installer-<n>.img`, the ready-made
disk and its images are all published files, for anyone to download (B3 design §4, §13). So neither of the
owner's two suggested places can hold them. Hiding them inside a public file does not work:

- Encrypting them inside it needs a key on the stick, which is then the private thing.
- Putting a fingerprint of the number in the image gives the number away. There are 30 million NIE forms (X, Y
  or Z and seven digits; the letter follows). 3,000,000 SHA-256 hashes took 1.1 seconds on this Mac on
  2026-11-04 (one thread), so all of them take about 11 seconds (a rerun: 12 to 13). A slow hash only delays it: at the 22.4 ms per
  scrypt measured the same day, about 7.8 days on one thread.
- A secret on the stick that unlocks a private server would expose less if a stick were lost, since it can be
  revoked. It costs a server every official install depends on, and the number is readable on every terminal
  anyway (below), so it is not recommended now.

**So: one private file on the owner's own stick.** A public stick image, plus one file `producer.env` that the
owner's stick-making command adds to the stick's `WAITRON` folder from the private file on their Mac. The person
at the box does nothing new. The installer carries the values into the new disk's private `.env`, and the first
Live setup copies them into the row. Until the installer is built, `--producer-file` stays the way for a box
installed by hand. A venue Waitron Cloud hosts gets the same two settings from Cloud's private configuration.

**What this asks of B3 (lane B owns it; its plan is not edited here).**

1. A stick-making command that writes the published image and adds `WAITRON/producer.env` from a file the owner
   names, after checking it. The stick's checksum list does not cover that file. It needs a writable partition with
   room, which slice 2 should measure.
2. The installer reads the file, if present, before it says «Ya puedes quitar el USB» (B3 §5, step 3), and keeps
   it in memory. No file is not a refusal: a spare or a restored box needs none. A badly shaped file stops the
   install before anything is erased, with a message on the screen and the status page.
3. After the disk is written and checked (§5.5, so the check does not trip on the change), it writes both values
   to the box's `.env` inside the encrypted container, mode 600. Neither value reaches a log, the status page or
   anything under `/boot`. Until first start finishes the container opens with an empty passphrase (§7.3).
4. B3 §4 ("the installer writes nothing to the stick") still holds; §4 and §1 goal 2's list of what differs per box
   each need a sentence naming this one owner-added file.
5. «Descarga uno nuevo» (§5.4, a too-old stick) points at a public download with no file. A box installed from it
   reaches the refusal below unless it restores or joins, so that message needs to say so.
6. The virtual-machine acceptance run (§13) uses made-up values and checks they reach the row.
7. §12.2's move from Prepare to a fresh Live, which isolates practice connection settings, keeps the two `.env`
   values.

**A box with no values, at setup.** A blank stick-installed box starts unprovisioned and preproduction (B3 §12.1), and
a setup request names its own environment (`setup-api.ts:595-596`), so the check reads the request. A box with no values
may use Prepare. Asking for Live on a published build is refused at its start, before it creates anything; today's check
would come only after the whole wizard. The page says what happened and offers what the person can do there: restore,
join as a spare, or reinstall from a stick holding the file. The two new refusal codes get English and Spanish recovery
wording the same way.

**A fork.** Nothing official is in the source, the image or a public stick, so a fork has only what it supplies: its
own file on its own stick, or `--producer-file`. A fork that stamps its build the way CI and `waitron.sh` do counts
as published (`BUILD_COMMIT !== null`, `packages/fiscal-verifactu/src/slot.ts:74`) and refuses without values. A
plain `docker build` is unstamped (`deploy/Dockerfile:4,29-30`): it does not refuse the producer, and production setup
should stop at the clock check instead, with a message that does not mention the producer (the clock result was run;
the stop at `hour-selection.ts:402` was read). A fork restoring an official backup hits the table's "another origin"
rows. AEAT's FAQ puts a modifier under their own certification: «no están cubiertas por la certificación del
productor del SIF original» (`docs/compliance/asesor-questions.md:2345`). A short note for forks goes in the operator
docs with the build.

**What stays private, and what cannot.** This limits what the whole mechanism buys.

| Where | Is the number there? |
| --- | --- |
| The repository, commits, pull requests, CI logs | No |
| The images, the published stick, the ready-made disk | No |
| A stick the owner made, including one left at a venue | Yes, readable on any computer |
| Backup archives | Yes, under the recovery key |
| The bucket stream | Yes. Waitron does not encrypt it; the design's floor is the provider's server-side encryption (topology design §0.3), which nothing here sets or checks |
| A box's own disk, and a spare's | Yes; encrypted on a stick-installed box, not on one installed by hand |
| Every record filed with AEAT | Yes, as the law's software block |
| **The declaration, on every till and dashboard** | **Yes. Orden HAC/1177/2024 art. 15.1 i) requires the number; art. 15.3 requires the declaration inside the system, and AEAT's FAQ says at every terminal. A940 §7.2 also serves it with no sign-in, over plain HTTP, on the box's landing page** |
| **The declaration published with each release** | **Yes as A940 is designed: §5.3 commits each version's text to the public repository and renders it into the public image; §7.1 attaches it to the GitHub Release. This is the owner's decision below** |

So anyone at a venue, or anyone who gets a box, can read the number. This mechanism keeps it from being collected off
the internet, and no further. The 2026-11-03 sentence that "the published declaration text holds placeholders filled
at run time" answered only part of this, and was never put to the owner.

**What the law asks of the outside copy.** Read in the BOE's and AEAT's own text, downloaded 2026-11-04:

- RD 1007/2023 art. 13.2: «así como para el cliente y el comercializador en el momento de la adquisición del producto».
- Orden art. 15.3: «deberá ponerse a disposición del comercializador y del cliente, tanto en el momento de su adquisición
  como posteriormente, en papel o electrónicamente».
- AEAT's FAQ goes further. It must also be reachable outside the product «para que el comercializador, y el usuario o
  potencial usuario del SIF puedan ver la misma en cualquier momento (por ejemplo, antes o en el momento de su adquisición)»,
  «en formato papel o electrónico, bien en soporte físico … o siendo accesible a través de Internet».
- Public copies are what it recommends: «se recomienda que, adicionalmente, todas las certificaciones sean accesibles
  públicamente y localizables fácilmente a través de Internet».

So a complete copy handed to each buyer fits the RD and the Orden, but may not fit the FAQ's "potential user", who has
bought nothing yet. Giving it on request may be an answer; a public copy with the number withheld may not count as the
declaration. This is not a lawyer's reading, the asesor has not been asked, and having no declaration costs €1,000 per
system (design §2). The first venue is the owner's own company, so nobody else is a buyer yet.

**The owner's decision.**

- **(a) Recommended: keep the number private as far as the law lets it, and ask the asesor first.** The private stick file
  above. The public declaration withholds the number and says how to get the complete one; each terminal shows the complete
  one and each buyer is handed it. If the asesor says the public copy must carry it, (b) is what is left. Cost: this section's
  work, B3's seven points, one command per stick, one repository variable, one asesor question, and a change to A940: rendering
  moves from the image build to the box, which undoes §5.3's "same bytes" and its opaque-file rule, and §5.2, §5.4, §5.6, §7.1,
  §7.2 and §8 follow. A box with no values shows the withheld copy before setup.
- **(b) Publish it.** The release job writes the values into the official image from a private CI secret, and the declaration is
  complete everywhere, as AEAT recommends. No stick file, no B3 work, no asesor question. The row stays for restores, and it still
  needs the origin stamp, or a fork restoring an official backup files under the official producer. A fork built `FROM` the official
  image inherits the values. Cost: the number is public for good in practice: AEAT recommends keeping old declarations public, and
  anything published may have been copied.

A company as producer would make (b) painless, because its tax number is not a person's. Moving the producer later costs every box
a new installation (§5.6), on our reading of design §2, which asesor question Q53(d) asks them to confirm.

**Which test checks change.** The golden hash test and the immutability suite run unedited, since with no row a record carries what
it carries today. New cases: one per row of the table, the four check points, and a configuration export carrying no row. The three
readers of the producer (`backend.ts:762`, `record-remedy-absent.ts:142`, `record-remedy-http.ts:129`) read the row. A grep of the
repository found no other reader that builds or compares it (`drain.ts:1809-1815` compares AEAT's copy with the stored block;
`backup-verification-chain.ts:107` skips it).

**Order.** It adds a migration on a fiscal table: its own fiscal pull request, which the owner lands, not started while another of lane
A's pull requests is parked (runbook H1). The row and `--producer-file` are common to (a) and (b). Building A947 3b and A1018 does not wait
for it. But until it lands, no box that files with Veri\*Factu, on a published build set to production, gets past `boot.ts:2066`
to trading, as main box or spare (the slot refusing was run; the route to that line was read). A no-regime venue is unaffected, and setup
still opens. The postal address (item j)
still has to come from the owner and follows the same decision.

- [ ] Wait for the owner's answer.
- [ ] Write the build tasks from the table, then build with implementers, test-first.
- [ ] Hand lane B the seven points above as a queue note, if (a) is chosen.
