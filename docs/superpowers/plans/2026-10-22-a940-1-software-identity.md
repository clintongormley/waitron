# A940 slice 1 — the records name the software's producer: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"` (medium effort). An implementer past about 150 tool calls with its
> task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover —
> done, left, files, each check's state.

> **2026-11-06: Tasks 1–7 landed as #2000 (`main` 9032ba1c28); Task 8 is rewritten.** The owner
> made the producer's name, tax number and postal address public settings that travel with the
> release, set from repository secrets and never committed. Task 8 below replaces the earlier
> Task 8 texts and removes the "published build" gate this page describes in item 3 and "The
> placeholder": after it, a production start with no producer refuses whether or not the build is
> stamped. Those two passages are kept as the record of slice 1.

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
     producer and lifts the refusal. (Superseded 2026-11-06: Task 8 below reads them from settings.)
4. **Test checks this slice changes** (the owner's 2026-10-05 rule: a check may change when the
   item's spec changes what it checks). Every one is listed in the pull request's description:
   - `apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json` — the
     `sistema_informatico` string of all 31 records: `"Waitron POS"` → `"Waitron"`, `"0.0.0"` →
     `"0.0.0-dev"`, `TipoUsoPosibleMultiOT` `"S"` → `"N"`. Re-recorded, and the diff must touch
     those 31 lines and nothing else — no `huella` line (Task 6).
   - `apps/server/src/taxpayer-rename.filing.test.ts:92-93` — **in Task 8, not before**: while the
     producer is pending, `producerFields` still answers the taxpayer's name at the moment of
     recording, so the lines stay true until the producer is filled. Task 8 deletes them (superseded
     2026-11-06: the rewritten Task 8 keeps them, now `:91-92`, since the suite sets no producer); line 91,
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

### Task 8: the producer's name, tax number and address travel with the release (rewritten 2026-11-06)

> **2026-11-08: built** on branch `feat/a940-task8-producer-settings`, parked for the owner, in the
> order 8a, 8b, 8d, 8c, 8e, 8f, 8g, 8h (8c's rename case needs 8d's test helper). What the build
> changed from the text below:
> - 8c's rename case needed an optional `identity` on the bill and order venue test helpers
>   (`provisionBillVenue` and `provisionOrderVenue`, `apps/server/src/testing/`), which build the
>   backend directly and so do not read the settings; the default is unchanged.
> - 8f's re-run of the server suite after the chain check existed found seven production test
>   starts in `boot.test.ts` and `boot.promote.test.ts` refusing `sif.producer_changed`: their
>   records came from `seedPendingEnvios` (`packages/fiscal-verifactu/test/drain-fixtures.ts`),
>   which now takes an optional `producerNif`, and those callers pass the test producer's.
> - 8g added `scripts/published-image-env.sh`, the one registry read of `:main`'s settings, so a
>   `v*` tag publish compares the tax number with `:main`'s too (without it, a tag publish would
>   always have failed the guard).
> - 8g's Step 5, the real-fork test, waits for the owner to set the three secrets.
> - Steps 3 and 4 of "How they reach a node", the secrets paragraph and 8g's "push again" assumed
>   the publish job runs on a push to `main`. It does not: since A1427 (#2557) it runs only on a
>   full run — the nightly schedule, a manual run on `main` or a `v*` tag (`ci.yml`'s publish `if:`
>   reads `needs.changes.outputs.full`). So the nightly republishes `:main`, a changed name or
>   address reaches boxes as they update, and only a changed tax number is held, by 8g's guard.
>   Each is corrected in place.
> - The owner answered the A993 question on 2026-11-06; "What A993 inherits" now records it.

> **This replaces every earlier Task 8.** The original (fill two constants), the 2026-11-03 amendment
> (a box's private `.env` and `--producer-file`) and the 2026-11-04 proposal (a venue-database row,
> a build-origin stamp, a file on the owner's own stick) were all withdrawn by the owner on 2026-11-04.
> The withdrawn text is in git: commit `303b8cdd3a` holds it as it was. Revised the same day for a
> fresh-context review's seventeen findings (the commit message lists them).

**What the owner decided** (the campaign questions file, 2026-11-04 about 10:05 and 10:10, and
2026-11-06 about 14:19; recorded on `main` at `1072f1cbd6` in
`docs/compliance/2026-11-06-adviser-questions.md`, item 4). In their words: "my name and tax number
are not private, they will be public"; the values "should be named generically then verifactu should
pull those values into where it needs them"; "these values should only be used for our prepackaged
installs, if somebody else builds the code then they should pass in their own name and tax id"; they
must be changeable ("start with my personal details first, then switch to a company's details
later"), so they are "settings that are passed in to each node, rather than being stored in the DB";
and "we update the mirror then the primary, which means that the values on each node may differ
during upgrades". The postal address is the third value of the same kind. On 2026-11-06 the owner
chose a repository **secret**, not a repository variable, to carry them to the release. The values
are public, but they are **never committed**: a fork inherits nothing.

"Secret" here is only GitHub's storage for a value that is not in the source; it hides nothing. The
values end up readable in every official image — `docker inspect`, the image's history, and
`docker buildx imagetools inspect` (which read the image's settings off the registry on 2026-11-06,
printing only a count of `WAITRON_` names: 12, none of them `WAITRON_PRODUCER_`). That fits "public".

**This plan never holds the real values**, and neither does any commit, test or log line a task
writes. Test fixtures use made-up values: name `PRODUCER PERSON`, tax number `00000000T` (eight
zeros take the check letter `T`, since 0 mod 23 is 0; the slice-1 probe at the top of this plan
filed it), address `1 Example Street, 00000 Nowhere (Province), Spain`.

**Path: FULL, and fiscal — the owner lands it.** One pull request for 8a–8h, opened green and
parked `needs-owner-review`. **No table, column or migration is added** (the A1308 hold): every part
below reads what is stored today.

#### The design in one page

**Three settings, named for the software's producer.** `WAITRON_PRODUCER_NAME`,
`WAITRON_PRODUCER_TAX_ID` and `WAITRON_PRODUCER_ADDRESS` — the names the owner's values file
already uses (its key names were listed on 2026-11-06 without printing a value). No `nif`,
`NombreRazon` or other Veri\*Factu word appears in them or in the generic code that reads them
(CLAUDE.md §3, "General code is English only", and the module-seams rule).

- **The address is one line**, written as it is to appear in the declaration (street, number,
  postcode, town, province, country, separated by commas). A line break in the value is refused,
  because CI hands build arguments to `docker/build-push-action` as one newline-separated list:
  its README for the `v7` ref says «`List` type is a newline-delimited string» (README line 214),
  and its `src/context.ts:59` reads the list as
  `Util.getInputList('build-args', {ignoreComma: true})`, so commas stay inside a value and a line
  break would split it into two arguments (both fetched with `curl` on 2026-11-06; read, not run).
  The declaration's item 1.j) prints the address as one run of text anyway (design §4).
- **Room for a foreign identifier.** The generic reader returns the tax number as a plain string
  and says nothing about its country. `fiscal-verifactu` treats it as a Spanish identifier. A
  foreign identifier (design §5.6's table: "The producer's NIF (or foreign identifier, its type and
  country)") later adds a fourth setting naming the issuing country. The Veri\*Factu library already
  carries the choice: its `SistemaInformatico` type is `NIF` or `IDOtro`, never both
  (`@waitron/verifactu` 0.2.1 `dist/types.d.ts:53-60`), and its `validate` checks `IDOtro`'s shape
  (`dist/validate.js:473-482`). Read, not run. Two readers would then need widening, because they
  compare only `NIF`: the drain's AEAT comparison (`packages/fiscal-verifactu/src/drain.ts:1794`)
  and reconciliation (`reconcile.ts:443`).

**Where they are read.** A generic, browser-safe parser in `@waitron/shared`
(`packages/shared/src/software-producer.ts`, new): `readSoftwareProducer(env)` takes an environment
object, never touches `process` itself, and returns `{ name, taxId, address }`, or `null` when all
three are unset. "Unset" follows the house rule: an empty value counts as unset (CLAUDE.md §3, "An
empty value is a valid value"; `apps/server/src/env-value.ts`). **This is the shape check for any
module that has none:** each value trimmed and non-empty, at most 200 characters, no line break; all
three set or none. Anything else throws `software_producer.invalid` with `{ setting, reason }` — the
setting's NAME and a reason word, never the value (the personal-data logging rule, CLAUDE.md §3).

`fiscal-verifactu` pulls them from the process's own environment and maps them to its own fields:
name → `NombreRazon`, tax number → `NIF`. Reading `process.env` inside the package has a precedent:
`FISCAL_OPERATIONS.prepare` falls back to `configuredOperations(process.env)`
(`packages/fiscal-verifactu/src/allocation-configuration.ts:180`), though its configured path
(`:177`) takes `host.environment` from the host instead. Veri\*Factu adds its own rules — the name
at most 120 characters, the tax number passing the library's NIF check — by running the library's
exported `validate` over a block carrying them and reading only the
`SistemaInformatico.NombreRazon` and `SistemaInformatico.NIF` issues (`dist/validate.js:458,478`;
the library's `dist/index.d.ts` does not export its `hasValidNifControl`, read on 2026-11-06). A
failure there throws `sif.producer_invalid` with `{ setting, reason }`.

**When they are read.** Never at import. `makeVerifactuBackend` reads them **once** and hands the
result to `VerifactuBackend` through its existing `identity` option (`backend.ts:180`), so every
record that backend builds, and the start check (8e) that the same backend runs, see one reading.
The two remedy files that build a software block without a backend
(`record-remedy-absent.ts:142`, `record-remedy-http.ts:129`) read at call time; the corrective
remedy builds a backend through `makeVerifactuBackend` (`record-remedy-corrective-http.ts:100-103`)
and so reads when it is called. A running box's environment does not change, so these agree on a
box; a test sets the values before the server or backend it tests is built (8d).

**Why the process environment, and not the box's own settings files.** On a box, the app's settings
come from three places: the image's own `ENV` lines, the `environment:` block of
`deploy/compose.yml`, and the box's state files (`secrets.env`, `trading.env`, `backup.env`), which
`loadBoxEnv` merges *under* the process environment (`apps/server/src/box-env.ts:6-34`). Reading
`process.env` only, and keeping the three names out of `compose.yml`, means a box's state files and
its `.env` cannot set or change them: the image is their one source on an official install. That is
"nobody edits them on a box", made true by where they are read rather than by a rule. A person with
a terminal can still override them deliberately (a compose override file, or `docker run -e`), which
is why the start check under "The catch" exists.

**How they reach a node.** Through the image, as settings the release carries:

1. `deploy/Dockerfile`'s runtime stage declares `ARG WAITRON_PRODUCER_NAME`,
   `ARG WAITRON_PRODUCER_TAX_ID` and `ARG WAITRON_PRODUCER_ADDRESS` and adds the three to its `ENV`
   block (today's block: `deploy/Dockerfile:266-278`). The print-agent target does not take them.
   A build argument is visible only in a stage that declares it, which is why the Dockerfile
   declares `WAITRON_BUILD_ID` once before the first `FROM` (`:4`, before `:11`), which gives its
   default, and again in each stage that reads it: the build stage (`:26`), the print-agent stage
   (`:128`) and the runtime stage (`:264`); slice 2's renderer, which runs in the build stage, needs its own three declarations
   there. **Measured 2026-11-06** with a throwaway image, built, run and removed:
   ```
   printf 'FROM alpine:3.23\nARG P_NAME\nARG P_ADDR\nENV A=1 \\\n  P_NAME=${P_NAME} \\\n  P_ADDR=${P_ADDR} \\\n  B=2\n' > Dockerfile
   docker build -q --pull=false -t a940-env-probe --build-arg 'P_NAME=Made Up Person' --build-arg 'P_ADDR=1 Example Street, 00000 Nowhere (Province), Spain' .
   docker run --rm a940-env-probe sh -c 'printf "[%s]\n[%s]\n[%s]\n" "$P_NAME" "$P_ADDR" "$B"'
   ```
   printed `[Made Up Person]`, `[1 Example Street, 00000 Nowhere (Province), Spain]`, `[2]`; the
   same image built with no build arguments printed the variable as set and empty, which `isUnset`
   reads as unset. That measured `docker build --build-arg`, not `build-push-action`'s list; 8g
   checks the action's result in CI.
2. `.github/workflows/ci.yml`'s publish job passes them from three repository secrets of the same
   names as build arguments to the app image only. Today that job builds and pushes in one step,
   `push: true`, with the `:main` tag among its tags (`ci.yml:4054-4066`, `push: true` at `:4060`), so a check after it would
   run after `:main` had moved. 8g reorders it: build with `load: true`; then check, in the shell
   and without printing, that each of the three values inside the built image equals its secret;
   then push, with a second build step served from the builder's cache and today's tags (8g). A step before the build fails when any secret is
   empty, printing lengths only. The image-smoke workflow (`image-smoke.yml:133-155`) passes none:
   its box starts blank and preproduction (`image-smoke.yml:195-198`).
3. Every image published from the official repository then carries them — `:main` and `sha-…`
   from a full run on `main` (the nightly schedule or a manual run), and each release tag when
   slice 4 adds them. `:main` must carry them because
   boxes install it today (`deploy/compose.yml:11`) and no release exists yet (§5.1).
4. **Changing the values: blocked in production until A993.** A changed secret reaches the next
   image the publish job builds, and that job runs on every full run — the nightly schedule, a
   manual run on `main`, or a `v*` tag (its `if:` reads `needs.changes.outputs.full`; corrected
   2026-11-08, since this step first said it ran only on a push that changed code, which stopped
   being true with A1427, #2557). So the nightly republishes `:main`, and a changed name or address
   reaches boxes as they update; only a changed tax number is held, by the guard below. Once a new
   tax number is published,
   every production box upgraded to it **refuses to start** (`sif.producer_changed`, "The catch"):
   its chain's last record names the old number, and nothing before A993 can open the new
   installation a new producer needs. Upgrading the spare first leaves the main box refusing when
   it is upgraded in turn; a one-box venue has no way through. So:
   - **Do not change the three secrets' tax number until A993 has landed.** A change of name or
     address alone is not a new system (§5.6 compares the tax number only) and goes through.
   - 8g adds a guard to the publish job: it reads the tax number in the image `:main` points at
     now, from the registry (the read `main-tag-guard.sh` already makes; run by hand on 2026-11-06
     against the live image, printing only a count: today's `:main` carries 12 `WAITRON_` settings
     and no `WAITRON_PRODUCER_` one), and fails when the new secret's differs, unless the repository
     variable `WAITRON_PRODUCER_CHANGE_ALLOWED` holds that new tax number — a deliberate act that
     allows a change to that one number. The nightly run has no person to give a workflow input, so a
     variable stands in for one. An image with no tax number yet (today's `:main`) is no difference, so the first
     publish passes. The read runs under an outer timeout and fails the job on an error or a
     timeout.
5. **Someone building their own passes their own**: `docker build --build-arg
   WAITRON_PRODUCER_NAME=… --build-arg WAITRON_PRODUCER_TAX_ID=… --build-arg
   WAITRON_PRODUCER_ADDRESS=…`, or the three variables in the environment when running from source.
   A fork's publish job stops until the fork sets its own three secrets. `waitron.sh install <ref>`
   builds a non-`main` ref on the box with none (`deploy/waitron.sh:430-436`), so such a box trades
   only in preproduction.

**What GitHub says about a fork and a repository's secrets.** From
<https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets>,
fetched with `curl` on 2026-11-06 and searched for "fork": «With the exception of `GITHUB_TOKEN`,
secrets are not passed to the runner when a workflow is triggered from a forked repository.» The
same sentence is on
<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>.
So a pull request from a fork builds without the values. **Not verified from a source sentence:**
that forking a repository copies none of its secrets into the fork. The pages above, the secrets
reference and concepts pages and "About forks" were searched for it on 2026-11-06 and say nothing
either way. 8g's fork test settles it by running it.

**Setting the secrets — a step for the owner or the watcher, done once before this pull request
lands** (after it lands, the next full run on `main` — the nightly or a manual one — fails its
publish job by design while the secrets are missing):

```
gh secret set --env-file ~/waitron-campaign-shared/private/producer-identity.env --app actions --repo clintongormley/waitron
gh secret list --app actions --repo clintongormley/waitron
```

`gh` 2.103.3's help says `-f, --env-file file  Load secret names and values from a dotenv-formatted
file`; the file's three key names are already the setting names. Never `cat` or `echo` the file.
Not run: whether `gh`'s dotenv reading keeps an unquoted value with spaces whole; 8g's in-image
comparison is against the secrets as stored, so it would not catch a value cut short on the way in.
Compare the first publish's lengths line with the file's own lengths, computed without printing a
value (`awk -F= '{print $1, length(substr($0, index($0,"=")+1))}'` over the file). **After that, do
not change the tax number until A993 lands** (step 4 above).

**What a start does** (every environment counts an empty value as unset):

| The three settings | Production start | Preproduction and development start |
| --- | --- | --- |
| None set | Refuses `sif.producer_unset` — **stamped or not** (today an unstamped build does not refuse: `slot.ts:75` passes `BUILD_COMMIT !== null`) | Trades; records name the taxpayer, exactly as today |
| All set, valid | Trades; records name the producer | Trades; records name the producer, so AEAT's test service sees the real values before go-live |
| Partly set, or failing a shape or Veri\*Factu check | Refuses `software_producer.invalid` or `sif.producer_invalid` | Refuses the same, so a typo shows on the first preproduction start |
| All set, valid, and this node's open chain was made under another tax number | Refuses `sif.producer_changed` ("The catch", below) | Trades; disclosed below |

**The catch: a value that differs from the chain's.** Design §5.6 counts the producer's tax number
as part of a chain's identity: a different producer means a new installation, which closes the
chain and restarts the series, and cannot be undone. A993, which makes that change by itself, is not
built (`git grep -n 'identity_mismatch\|identity-change' -- packages apps` finds only the
dashboard's unrelated `venue-identity-changed` event). So today a box given a different value — a
hand override, or a release whose secrets changed — would put the new producer on new records of
the **same** chain, silently. With settings rather than a database row there is no stored copy to
absorb a mistake. But one stored record already exists: every record keeps the software block it was
filed with (`registros_facturacion.sistema_informatico`,
`packages/fiscal-verifactu/src/schema/registros.ts:98`), and the node's chain head points at its
latest record (`cadenas.ultimo_registro_id`, `schema/cadenas.ts:29`). The head is written in
four places: `chain.ts:117` creates the row if missing and `chain.ts:257` advances it on every
append; `registro-sif.ts:59-66` (`resetChainHead`) empties it, reached only through `registerSif`
and `writeReservedSif`, neither of which has a caller outside tests (`git grep` on 2026-11-06); and
the private `activate` empties it (`allocation.ts:448-455`), the path every setup, restore and
promotion takes (`activateAllocation` and its siblings, `allocation.ts:129-256`). So a start can
compare the running tax number with the one the chain's latest record carries, with no new column:

- **Production, different:** the start refuses, `sif.producer_changed`, with the recovery page's
  fixed title and action. Nothing is filed and no installation is opened. This is the safe answer
  for both causes: a hand override is caught at its first start, and a genuine change of producer
  waits for A993, whose upgrade step is the one moment design §5.6 ("When the change is made")
  lets a change take effect. 8g's publish guard keeps the genuine case from reaching `:main`
  unacknowledged.
- **No record yet on the chain** (a fresh setup, restore or promotion): nothing to compare; the
  first record names the running producer.
- **Preproduction, different:** trades, the new producer on the same chain. Disclosed rather than
  refused: AEAT's test service only, and the first official image to carry the values would
  otherwise stop every preproduction box that ran without them. The design's "Order" paragraph
  (§5.6) already accepts a preproduction chain changing producer part-way.
- **A production chain whose last record names the taxpayer** — filed before slice 1, or by an
  unstamped production build while the producer was unset — refuses with no way out until A993. I
  believe no such box exists: the README says Waitron is "Not yet running in production anywhere"
  (`README.md:9`); not checked on the owner's box.
- **Only the tax number is compared**, as §5.6's identity table lists it; a change of name or
  address alone is not a new system.
- **Where it runs: on every node that can add a record** — every trading start that is neither a
  mirror nor fenced (`fencedOrMirror`, `apps/server/src/boot.ts:1989`). Not only the singleton
  primary: the sale routes are not gated on the role. `isSingletonPrimary` (`boot.ts:2021`) gates
  role-specific duties and, joined with `!fencedOrMirror`, two answers: `acceptingSales` for
  `GET /api/node`, the role probe tills poll (`boot.ts:2345`, `node-api.ts:36-40`), and `isPrimary`,
  node enrolment's gate, which refuses with `node.enrol_unavailable` (`boot.ts:2359`,
  `node-enrol-api.ts:50`); the read-only gate, which refuses writes, is mounted for
  `fencedOrMirror` alone (`boot.ts:2042-2051`). The only thing that sets a mode-primary node's role
  to secondary at boot is the fence (`boot.ts:1972-1979`). A restricted box returns before this
  point (`return restrictedStart()`, `boot.ts:1832,1931`). Why it must not run on a mirror is under
  "The fifth point".

**What the catch does not cover, said plainly.** At first setup, a restore and a promotion — each
done with a person present — the running values are taken as they are, and nothing checks them
against anything: a wrong image or a hand override there opens the new chain under the wrong
producer. On an official install the image is the only source, so this needs a wrong release or a
deliberate override.

**What A993 inherits** (its plan is not written yet; this is a constraint on it, not a change to
§5.6's approved behaviour). §5.6's start fallback ("Under A, what a start does") opens a new
installation when a start finds the identities differ. With the producer a node setting, that
fallback would let a stray value open a new installation at an unattended start, which is exactly
the case Task 8 refuses. **Decided by the owner on 2026-11-06** (about 18:13, relayed by the
watcher in the campaign questions file, heading "A940 Task 8: the owner says yes to question 1,
both parts"): (1) a change of producer stays blocked in production until A993 exists; (2) once A993
exists, a start opens a new installation for a **producer** difference only when the upgrade's own
marker names that same new producer (§5.6 already has the upgrade write a marker in the box's folder
before it stops the old release); otherwise it keeps refusing, as Task 8 does. A993's plan is bound
by both. The owner also settled, about 18:10 the same day, that what a preproduction box does
before A993 stays as written (it trades, the new producer on the same chain): such a box can always
be reset.

**The fifth point: the mirror is upgraded first, so the two boxes may hold different values.**
Traced on `main` at `5558d26e89`; read, not run, except where a command is named.

- **A mirror runs the trading start too**: boot reaches `makeFiscalBackend` on a mirror
  (`apps/server/src/boot.ts:2063-2084`, after the mirror-link read). So the unset and invalid
  refusals apply to a mirror's own values, as they do today to `sif.producer_unset`. That is
  intended: a mirror runs the same official image.
- **The chain check must not run on a mirror.** A mirror's database is a copy of the primary's, so
  it holds `cadenas` rows for other nodes and, for a box that was once the main box, a row for its
  own node still pointing at its old chain: of the head's writers above, only an activation empties
  it, and handing over does not activate the box that hands over. A box handed over from, now a
  mirror upgraded first, would compare its new value with its own old chain and refuse. The
  `!fencedOrMirror` gate keeps it out.
- **Controlled handover (A1018) and emergency takeover** both promote the receiving box through the
  fiscal module's `promote` operation (`apps/server/src/promote.ts:277-297`), which is an
  activation: a new SIF row, the node's chain head emptied, new series (`allocation.ts:436-461`).
  The new main box's first record names **its** running producer, and §5.6 already says "When it is
  promoted, its activation writes the running release's identity". The old chain's records keep the
  block they were filed with and are sent unchanged, grouped by `sif_id` (`partition by r.sif_id`,
  `drain.ts:645`). So a spare taking over from a main box on another value is a new installation
  under the spare's producer. With a changed tax number that happens only after 8g's
  acknowledgment, and it is the legitimate path §5.6 already allows.
- **Nothing compares one box's producer with the other's.** The handover's copy check compares
  migration hashes and module names (`apps/server/src/handover-compare.ts:236-285`), and its chain
  summary reads installation codes, not producers (`packages/fiscal-verifactu/src/handover-summary.ts:44-50`).
  The drain (`drain.ts:1787-1815`), reconciliation (`reconcile.ts:429-447`) and the backup check
  (`backup-verification-chain.ts:107-110`, which compares the installation, not the producer, since
  Task 4) each compare a record with **its own** stored block. A grep of non-test code under
  `apps` and `packages` for reads of a stored block's `NIF` or `NombreRazon` finds only
  `drain.ts:1794,1811-1812` and `reconcile.ts:443`, both per record. (`initial-paper-candidates.ts:66-76`
  builds a fixed check block of its own and reads no producer.)
- **Not about the producer, but met on the same path:** a controlled handover between two
  different releases is refused when their migrations differ — `handover.modules_differ` when the
  receiving image has migrations the copy lacks, `provisioning.database_ahead` the other way
  (`handover-compare.ts:236-275`). A950's "upgrade the spare first"
  ([A950 design](../specs/2026-10-27-a950-automatic-upgrades-design.md), line 557) meets that, not
  this task. Read, not run.

**The declaration's rendered copy** (design §5.3, built in slice 2 and later; nothing here builds
it). Each version's committed text, `packages/fiscal-verifactu/declarations/v<version>.md`, keeps
the producer's three facts as slots (‹nombre y apellidos›, ‹NIF›, ‹dirección›), never values, so a
fork inherits none. The image build fills them from the same three build arguments that build gives
its `ENV` (declared again in the renderer's stage, step 1 above), so the official image's PDF
carries the official values and a fork's carries its own. A build with none renders no declaration,
and its production start refuses anyway. The GitHub Release copies the files out of the official
image (§5.3), so the public archive carries the public values. `pnpm release prepare` (§5.4,
step 3) shows the text filled from the same three variables in the environment of whoever runs it,
and refuses when they are unset. The design says so.

**`apps/server/src/taxpayer-rename.filing.test.ts` — rechecked on `main` at `5558d26e89`.** The
lines the original Task 8 would have deleted are now `:91-92` (the comment, then the assertion that
the software block's `NombreRazon` follows the rename). They **stay**: the suite sets no producer
settings and names no production start (`grep -n 'WAITRON_ENV\|production\|PRODUCER'` over it
prints nothing), so its records keep the taxpayer fallback and the lines remain true — provided the
developer's own shell cannot supply the values, which 8d makes sure of. 8c adds a case beside them
with the settings set, showing the block keeping the producer across a rename.

**Changed test checks** (the owner's 2026-10-05 rule; each listed in the pull request):

- `packages/fiscal-verifactu/src/software-identity.test.ts:27-35` — `SOFTWARE_IDENTITY` no longer
  holds `producer: PRODUCER_PENDING`; and `:145-170` — the refusal no longer takes a "published"
  flag.
- `packages/fiscal-verifactu/src/slot.test.ts` — the "served in production" cases `:81-84`
  (unpublished build) and `:86-89` (no stamp, through the slot) become refusals; the stamped
  `describe` at `:91-116` loses its reason to exist and is removed.
- `apps/server/src/recovery-surface.test.ts:344,470` — `sif.producer_unset`'s new words, and the
  three new codes.
- The test files 8d finds failing gain the made-up values; each file is listed.
- **Unchanged and run unedited:** the golden huella test
  (`packages/fiscal-verifactu/src/write-path.e2e.test.ts:613`), the `inmutabilidad` suite
  (`packages/fiscal-verifactu/src/inmutabilidad.test.ts`), the seed golden
  (`apps/server/scripts/demo-seed/testing/spanish-practice-sales.golden.json`) and
  `taxpayer-rename.filing.test.ts`. Any other changed expectation stops the sub-task and goes to the
  driver with the reason.

#### 8a. The generic reader

**Files:** create `packages/shared/src/software-producer.ts` and `software-producer.test.ts`;
modify `packages/shared/src/errors.ts` (`software_producer.invalid`: `{ setting: string; reason:
"missing" | "too_long" | "line_break" | "partial" }`) and the package's exports.

- [ ] **Step 1: failing tests**, one per row: all three unset (and all three `""`) → `null`; all set
  → `{ name, taxId, address }`, trimmed, with no country; one or two unset → `partial` naming the
  first missing setting; a 201-character value → `too_long`; a value with `\n` → `line_break`; a
  whitespace-only value counts as missing. Assert the thrown error's `code`, and that its params
  hold no value (serialise the error and check the made-up value is absent).
- [ ] **Step 2: run, expect FAIL:** `pnpm --filter @waitron/shared exec vitest run src/software-producer.test.ts`
- [ ] **Step 3: implement.** Pure; takes `env: Readonly<Record<string, string | undefined>>`.
- [ ] **Step 4: PASS**, then `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts`.
- [ ] **Step 5: commit** — `shared: read the software producer's name, tax number and address from settings`.

#### 8b. Veri\*Factu takes its producer from the settings, and refuses without them in production

**Files:** modify `packages/fiscal-verifactu/src/software-identity.ts`, `slot.ts:36-47,75`,
`record-remedy-absent.ts:142`, `record-remedy-http.ts:129`, `record-remedy-corrective-http.ts:100-103`,
`backend.ts:180`, `errors.ts:75-76` (`sif.producer_invalid`). Tests: `software-identity.test.ts`,
`slot.test.ts`, the remedy test files as they exist.

- `software-identity.ts`: `SOFTWARE_IDENTITY` keeps the product's facts only. A new
  `runningProducer(env = process.env)` calls `readSoftwareProducer`, applies Spain and the
  Veri\*Factu checks above, and answers the producer, `PRODUCER_PENDING` (unset), or an invalid
  result carrying the error to throw. `producerFields` throws the invalid result's error if ever
  reached. `refuseUnsetProducer(environment, published)` becomes `refuseProducerSettings(environment,
  identity)`: invalid → throw in every environment; pending and production → `sif.producer_unset`.
  `BUILD_COMMIT` stays, for the version only.
- `makeVerifactuBackend(deps)` (no `published` argument) reads `runningProducer()` once, refuses,
  and passes the identity through `identity`. The two remedy files call `runningProducer()` when
  they build their block.
- [ ] **Step 1: failing tests:**
  - `software-identity.test.ts`: each row of the start table above except the last, through
    `vi.stubEnv`; a made-up NIE-shaped tax number with a wrong check letter (`X1234567A`) →
    `sif.producer_invalid`, the correct one (`X1234567L`) accepted (the library answered so on
    2026-11-03; the measurement is in commit `6a52e7189c`'s text of this plan); a 121-character
    name → `sif.producer_invalid`; `producerFields` names the producer when set and the taxpayer
    when unset; reading twice with the environment changed between shows the backend keeps its
    first reading.
  - `slot.test.ts`: `makeVerifactuBackend({…, environment: "production" })` with no settings throws
    `sif.producer_unset` **with no stamp**; with the made-up values it returns a backend;
    preproduction with none returns a backend.
  - A record built by each remedy path with the values set carries `NombreRazon`/`NIF` = the made-up
    producer, and the cancellation's issuer name stays the taxpayer's (Review focus 1).
- [ ] **Step 2: run, expect FAIL:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/software-identity.test.ts src/slot.test.ts`
  and the remedy test files by name.
- [ ] **Step 3: implement.**
- [ ] **Step 4: PASS.** Prove by deletion: delete the production branch of `refuseProducerSettings`;
  the unset-production case fails; restore. Delete the call to the library check; the wrong-letter
  case fails; restore. Then, unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
  — PASS; and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/module-seams.test.ts scripts/english-only.test.ts scripts/personal-log-params.test.ts`.
- [ ] **Step 5: commit** — `fiscal: the records name the producer from the release's settings; production refuses without them`.

#### 8c. The recovery page's words, and the rename case

**Files:** `apps/server/src/i18n/recovery-page.ts:243-255`, `apps/server/src/recovery-surface.test.ts`,
`apps/server/src/taxpayer-rename.filing.test.ts` (one added case).

Words (a refusal says what happened and what each choice does, and sends nobody elsewhere —
CLAUDE.md §3; check the final words against
[conventions-ui.md](../../developers/conventions-ui.md#refusals-name-a-self-service-next-step)):

- `sif.producer_unset` — en-GB title "This copy of Waitron was built without the name, tax number
  and address of its producer, so it cannot be used for real sales." Action "Install an official
  Waitron update on this box. If you build Waitron yourself, build it with your own producer's
  details." es-ES «Esta copia de Waitron se creó sin el nombre, el NIF y la dirección de quien la
  produce, así que no puede usarse para ventas reales.» / «Instala en este equipo una actualización
  oficial de Waitron. Si creas Waitron tú mismo, créalo con los datos de tu propio productor.»
- `software_producer.invalid` and `sif.producer_invalid` — en-GB "This copy of Waitron was built
  with its producer's details incomplete or in the wrong form, so it cannot be used." Same action.
  es-ES «Esta copia de Waitron se creó con los datos de quien la produce incompletos o mal
  escritos, así que no puede usarse.» Same action.

- [ ] **Step 1: failing tests:** `recovery-surface.test.ts`, the words above for each code in each
  language; `taxpayer-rename.filing.test.ts`, a new case with the values set (8d's helper): across
  the rename the block keeps `PRODUCER PERSON` while `nombre_razon_emisor` follows the rename. Lines
  `:91-92` are not touched.
- [ ] **Step 2: run, expect FAIL:**
  `pnpm --filter @waitron/server exec vitest run src/recovery-surface.test.ts src/taxpayer-rename.filing.test.ts`
- [ ] **Step 3: implement. Step 4: PASS.**
- [ ] **Step 5: commit** — `server: the recovery page names a missing or malformed producer`.

#### 8d. Tests start from unset, and production starts supply made-up values

Removing the stamp gate makes every unbundled test that starts trading in production refuse
`sif.producer_unset` — the reason slice 1 gated on the stamp ("The placeholder", above). Production
is set in tests in more ways than one literal: `WAITRON_ENV: "production"` in an env object (28
files under `apps` and `packages` on `5558d26e89`), a `trading.env` file the test writes
(`apps/server/src/testing/backup-verification-fixture.ts:289`,
`backup-verification-compatibility.test.ts:584`), `vi.stubEnv("WAITRON_ENV", "production")`
(`apps/server/scripts/demo-seed/seed.test.ts:263`, `seed-sales.test.ts:192`), an assignment
(`packages/provisioning/src/cli-first-setup.test.ts:265,628,853`), a constant
(`PRODUCTION_BOX`, `apps/server/src/setup-api.throwaway.test.ts:38`), and the literal
`environment: "production"` in 90 `packages/fiscal-verifactu` test files (most of them options for
the submission pass or the AEAT client, a few of them backends). So the selection is by outcome, not
by text.

**Files:** create `apps/server/src/testing/test-producer.ts` (`useTestProducer()`: stubs the three
made-up values in `beforeAll` — before any server or backend the file starts there — and restores
them in `afterAll`); a copy or export of it for `packages/fiscal-verifactu` and
`packages/provisioning` if their failing files need it; the `vitest` configs of `apps/server`,
`packages/fiscal-verifactu` and `packages/provisioning` set the three to `""` under `test.env`, so a
developer's shell can never supply them to a test that assumes they are unset (the rename suite and
the seed golden among them). A test that starts the server in a child process passes the three
values in that child's environment if it builds one by hand.

- [ ] **Step 1: the measurement.** On 8b's commit, run the whole `apps/server`,
  `packages/provisioning` and `packages/fiscal-verifactu` suites; beside them, the control: the same
  three suites in a throwaway `git worktree add --detach <dir> main` (with `pnpm install` in it,
  removed after). Check free memory first (`memory_pressure | grep free`) and scale concurrency to
  it. Save each run's output to a file and select the test files whose output on 8b contains
  `sif.producer_unset` and whose control run passed.
- [ ] **Step 2:** add `useTestProducer()` to exactly those files, and the `test.env` lines; nothing
  else changes in them.
- [ ] **Step 3:** Step 1's runs again: no file fails that does not also fail on `main`, and no output
  holds `sif.producer_unset` outside the cases that test it. Then, with the three exported in the
  shell running vitest (made-up values), run
  `pnpm --filter @waitron/server exec vitest run src/taxpayer-rename.filing.test.ts scripts/demo-seed/seed-sales.golden.test.ts`
  — PASS unedited, which shows `test.env` wins over the shell. (The claim check measured this on
  Vitest 4.1.12 on 2026-11-06 in throwaway projects: `test.env` with `""` beat a shell export, for
  the test and for a child process it started; the control without the line saw the shell's
  value.)
- [ ] **Step 4: commit** — `test: tests start with no producer, and production starts name a made-up one`,
  the file list in the message.

#### 8e. The chain check and its entry point

**Files:** `packages/fiscal/src/backend.ts` (the `FiscalBackend` interface, `:374`, gains an optional
`checkFilingIdentity?(tx: Transaction, nodeId: NodeId): Promise<void>` — "throws when this node's
open chain was made under a different software producer from the one this backend files under".
It reads only, and takes the same arguments as the interface's existing read
`checkIntegrity(tx: Transaction, nodeId: NodeId)` (`:531`); the file imports only `Transaction`
from `@waitron/db` (`:4`). Boot runs it in one read transaction); `packages/fiscal-verifactu/src/backend.ts` implements it from a new
`packages/fiscal-verifactu/src/producer-change.ts`, using the identity the backend captured (so the
check and the records agree); `errors.ts` gains `sif.producer_changed` (no params). A cross-package
contract change, which is a risk trigger: the full review wave runs on this pull request anyway.

- The check: read `cadenas` for `nodeId`; no row, or `ultimo_registro_id` null → return. Otherwise
  read that record's `sistema_informatico` and compare its `NIF` with the backend's tax number;
  equal → return; different and production → throw; different and preproduction → return. With the
  producer unset (preproduction fallback) there is nothing to compare → return.
- [ ] **Step 1: failing tests** in `producer-change.test.ts` (`useVenueDb`, chains built with
  `appendToChain` as `backup-verification-chain.test.ts:11-17` does): production, head record's
  `NIF` ≠ the backend's → `sif.producer_changed`; equal → passes; no `cadenas` row → passes; head
  emptied by an activation → passes; preproduction, different → passes; a different **name** with
  the same tax number → passes.
- [ ] **Step 2: run, expect FAIL:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/producer-change.test.ts`
- [ ] **Step 3: implement. Step 4: PASS**; prove by deletion: delete the comparison → the refusing
  case fails; restore. Then unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5: commit** — `fiscal: a backend can tell when its node's chain was made under another producer`.

#### 8f. The start runs the check, and the recovery page explains it

**Files:** `apps/server/src/boot.ts` (after `makeFiscalBackend`, `:2084`, when `!fencedOrMirror`
(`:1989`): `nodeBackend.checkFilingIdentity` inside one `withTransaction` that only reads, with the node's id);
`apps/server/src/i18n/recovery-page.ts` (the code's words); a new
`apps/server/src/boot.producer-change.test.ts`; `recovery-surface.test.ts`.

Words, true in both the mistaken and the legitimate case (8g's guard means the legitimate case
arrives only after a deliberate acknowledgment): en-GB title "This box has been given a different
software producer from the one its invoices were recorded under. A new producer needs a new fiscal
installation, and this version of Waitron cannot open one, so the box will not sell." Action "Install
a Waitron version that names the same producer as this box's invoices. Changing the producer needs a
Waitron version that can open a new fiscal installation, which does not exist yet." es-ES «Este
equipo tiene un productor del software distinto del de sus facturas registradas. Un productor nuevo
necesita una nueva instalación fiscal, y esta versión de Waitron no puede abrirla, así que el equipo
no venderá.» / «Instala una versión de Waitron que indique el mismo productor que las facturas de este
equipo. Cambiar de productor necesita una versión de Waitron capaz de abrir una nueva instalación
fiscal, que todavía no existe.» (A993 rewrites the action when it lands.)

- [ ] **Step 1: failing tests:**
  - `boot.producer-change.test.ts`, built like the trading boot case at `boot.test.ts:798`: a
    production node whose chain's last record names another tax number does not trade and its
    failure carries `sif.producer_changed`; the matching value trades; and **the same node id,
    with the same chain head naming the other tax number**, started as a mirror, trades — so
    deleting the gate makes that case fail.
  - `recovery-surface.test.ts`: the code's words in each language.
- [ ] **Step 2: run, expect FAIL:**
  `pnpm --filter @waitron/server exec vitest run src/boot.producer-change.test.ts src/recovery-surface.test.ts`
- [ ] **Step 3: implement. Step 4: PASS.** Prove by deletion: delete the call → the refusing case
  fails; delete the `!fencedOrMirror` condition → the mirror case fails; restore both. Then:
  `pnpm --filter @waitron/server exec vitest run src/boot.failed-start.test.ts src/handover-controlled.e2e.test.ts src/handover-two-boxes.test.ts src/promote.test.ts src/boot.promote.test.ts`
  — PASS, or failing exactly as on `main` (`boot.failed-start.test.ts` guards that each duty boot
  starts registers its stop before the next throwing step; a new throwing step must not break it).
- [ ] **Step 5: commit** — `server: a box will not sell on a chain made under another producer`.

#### 8g. The image carries the values; the publish job requires and guards them

**Files:** `deploy/Dockerfile` (runtime stage: three `ARG`s, three `ENV` entries),
`.github/workflows/ci.yml` (publish job), `scripts/deploy-image-env.test.ts` (a case: the
Dockerfile's runtime `ENV` names the three, and `deploy/compose.yml` names none of them — so `.env`
cannot reach them), `scripts/ci-workflow.test.mjs` (cases: the publish job's app build passes the
three secrets, builds with `load: true` and pushes only after the in-image comparison, runs the
`:main` guard before pushing, and the print-agent build and image-smoke pass none),
`deploy/README.md` (two sentences for someone building their own: pass the three build arguments; a
fork's publish job needs its own three secrets).

The publish job, in order:

1. Fail if any secret is empty, printing lengths only.
2. Compare the new tax number with `:main`'s. `scripts/main-tag-guard.sh` already reads `:main`'s
   environment off the registry (`docker buildx imagetools inspect "$IMAGE" --format
   '{{range .Image.Config.Env}}{{println .}}{{end}}'`, `:56-57`); the guard reuses that one read
   (the script hands back the line, or the step that calls it does the reading once for both)
   rather than adding a second. A difference fails the job unless the repository variable
   `WAITRON_PRODUCER_CHANGE_ALLOWED` holds **the new tax number itself** (public), so it lets
   through only a change to that number, and a value left set lets a later change to the same
   number through too. Whether a re-run of a
   failed job reads a variable set after its first attempt is unverified; the step says "set the
   variable, then start a new run" (corrected 2026-11-08 from "push again": a push to `main` does
   not publish). That read runs under an outer `timeout` and
   fails the job on an error or a timeout. Today's registry read and the two build-and-push steps
   (`ci.yml:4054`, `:4068`) have no timeout or retry of their own beyond the job's
   `timeout-minutes: 10`; CLAUDE.md §2's bounded-step rules name checkout, node and pnpm setup,
   apt-get and artifacts, not registry steps.
3. Build the app image with `load: true`, tagged locally. Loading works because the job builds one
   platform, `linux/amd64` (`ci.yml:4059`; the reason is the comment at `:4042`); a second
   platform would need this rechecked.
4. Compare each of the three values inside the loaded image with its secret in the shell, without
   printing either.
5. Push with a second `build-push-action` step given the same inputs and `push: true`, served from
   the builder's cache, with the tags as today: `sha-…`, plus `:main` when `main-tag-guard.sh`
   answers `move`, in one `tags:` list (`ci.yml:4061`). Rebuilt from cache, the pushed image is not
   byte-for-byte the compared one, but it is built from the same build arguments. `docker push` of
   the loaded image is not used: I believe, not run, that it would drop the provenance attestation
   the published index carries (`main-tag-guard.sh:48`).

(2026-11-08: a step between 4 and 5 now runs the server's own producer check,
`/app/producer-check.js`, inside the loaded image; `docs/developers/ci-and-gates.md` lists the job
as built. 2026-11-08, later: the owner replaced the separate program with `node /app/server.js check-producer`.)

- [ ] **Step 1: failing guard cases** in the two script tests; run
  `pnpm exec vitest run scripts/deploy-image-env.test.ts scripts/ci-workflow.test.mjs` — FAIL.
- [ ] **Step 2: implement**; the same command — PASS. Prove by deletion: drop one name from the
  `ENV` block → the image case fails; add `WAITRON_PRODUCER_NAME: ${WAITRON_PRODUCER_NAME:-}` to
  `compose.yml` → the compose case fails; move the push before the comparison → the order case
  fails; restore all three.
- [ ] **Step 3: a local image build with the made-up values** (`docker build -f deploy/Dockerfile
  --build-arg WAITRON_BUILD_ID=development --build-arg WAITRON_PRODUCER_NAME='PRODUCER PERSON' …`),
  then `docker run --rm --entrypoint node <tag> -e 'console.log(process.env.WAITRON_PRODUCER_ADDRESS)'`
  prints the made-up address whole; remove the image you built, by its tag.
- [ ] **Step 4: commit** — `deploy: the release image carries its producer's settings from repository secrets`.
- [ ] **Step 5: the one real-fork test — only once the owner has set the secrets.** If they are not
  set (`gh secret list` showed none on 2026-11-06), stop here and hand back to the driver; the
  steps above do not depend on it. Fork the repository to a scratch account or organisation and
  enable Actions on the fork first (I believe they are off on a new fork until its owner turns them
  on; not checked), then push, to a scratch branch there, a one-step
  workflow triggered by `push` that prints `${#WAITRON_PRODUCER_TAX_ID}` from
  `secrets.WAITRON_PRODUCER_TAX_ID`: expect `0`. The control: the same workflow pushed to a scratch
  branch of the official repository: expect the real length. A `push` trigger, not
  `workflow_dispatch`: GitHub's events page says of `workflow_dispatch` «This event will only
  trigger a workflow run if the workflow file exists on the default branch» (fetched 2026-11-06).
  Delete both scratch branches and the fork. Report both numbers.

#### 8h. Docs and the pull request

- [ ] `docs/backlog.md` and `docs/backlog/fiscal.md`: A940 — Task 8 built and parked; the address is
  supplied. A993 — the inherited constraint above, and the owner's answer once given.
- [ ] Dated pointers where the old behaviour is described: `docs/backlog/fiscal.md`'s A940 detail
  ("a published build set to production refuses to trade") and `docs/compliance/action-plan.md`
  Step 8's 2026-10-23 note ("a published production build will not trade"): after Task 8, a
  production start with no producer refuses whether or not the build is published.
- [ ] Design §5.2/§5.3/§5.4/§5.6 already say where the values come from (updated with this plan);
  re-read them against what was built.
- [ ] `/finish-branch` with this plan named; the full wave (fiscal), the Codex run-it seat as two
  reviews. The description opens "Fiscal — the owner lands this", says that no migration is added,
  lists every changed test check, the fork test's two numbers (or that it waits for the secrets),
  that the secrets must be set before it lands, and that the tax number must not change until A993
  lands. Label `needs-owner-review`. Do not merge.
