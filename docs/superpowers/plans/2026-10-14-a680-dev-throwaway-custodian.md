# A680: a throwaway preproduction custodian for development and test setups

> **For the implementer:** run each task with `superpowers:test-driven-development` (failing test
> first, watch it fail, then the smallest change). Dispatch each task as `subagent_type:
> "implementer"`. Review path: FULL — this touches how a fiscal identity reaches a venue. Work only
> in `/Users/clintongormley/workspace/worktrees/waitron-fix-a680-dev-throwaway-custodian` (branch
> `fix/a680-dev-throwaway-custodian`).

**Goal:** on a laptop, the onboarding dev stack (`wa-wt onboarding <name>`) and the owner's local
scripts can again create a Veri\*Factu venue, for any taxpayer, in preproduction only.

**What "custodian" means here.** Since #1700 a node's fiscal identity (its installation number
and invoice series) must arrive as an allocation signed by an outside "custodian" — a person who
keeps the master register of numbers — and the box must be told which custodian key to trust.
This item builds a fake, development-only custodian: it makes a key, signs a preproduction
allocation for whatever taxpayer the setup names, and tells the dev server to trust that key.

**Out of scope (owner's instruction):** the real first-setup product route (lane E's A679), the
real custodian path, the allocation validation and every existing fiscal assertion. None of
these files change: `packages/fiscal-verifactu/src/**` (including `allocation-configuration.ts`,
`allocation-paper-source.ts`, `paper-evidence.ts`, `paper-custodian.ts`, `index.ts`),
`apps/server/src/setup-api.ts`, `apps/server/src/provision.ts`,
`docs/developers/paper-custodian.md`. Lane E's open branch `feat/w41s6-offline-recovery-pack`
edits `paper-evidence.ts`, `paper-custodian.ts`, `index.ts`, `setup-api.ts`, the setup app and
`paper-custodian.md`; this plan touches none of them, so the two branches should not conflict on
text. It does CALL four functions from `paper-evidence.ts` (`enrolPaperCustodian`,
`paperCustodianFingerprint`, `signPaperBlock`, `signPaperConsumptionForBlock`); if lane E lands
first and changes one of their signatures, the rebase breaks the typecheck here, not silently.

**Owner context.** The 2026-10-14 decision ("W41s-4 … host check and demo decision", answer A)
allowed signed developer allocations "restricted to preproduction and the built-in fictional
identity" and said "do not use a test helper as the release implementation". A680, which the owner
approved in the watcher session on 2026-10-14 (~19:45, `queue.md`), widens that for development
only: ANY taxpayer, still preproduction only. The demo seed keeps its own fictional-identity
refusal unchanged. The new code must not import `@waitron/fiscal-verifactu/test/allocation-fixture.js`
or anything under a `test/` or `testing/` directory.

## Reproduction (run 2026-10-14 on main `1cd3b14bf`)

**1. The provision path, in-process.** A scratch Vitest file (kept at
`~/waitron-campaign-b/a680-repro/a680-repro.test.ts`, not committed) ran against a real migrated
venue database with the real module list (`ALL_MODULES`, whose fiscal module uses the production
`FISCAL_OPERATIONS`), the three `WAITRON_FISCAL_*` settings unset, taxpayer `B12345674` /
"Real Restaurant S.L.". Command:
`env -u WAITRON_FISCAL_CUSTODIAN_FILE -u WAITRON_FISCAL_CONFIRMATION_FILE -u WAITRON_FISCAL_CUSTODIAN_FINGERPRINT -u WAITRON_ENV pnpm --filter @waitron/server exec vitest run scripts/a680-repro.test.ts`
→ `Tests 5 passed (5)`; each case recorded its outcome in `results.json`:

| Case | Call | Result |
| --- | --- | --- |
| 1 | `provisionVenue` (what the setup route calls), no `initialOperations` | `sif.allocation_invalid`, `reason: reauthentication_required` |
| 2 | `provisionVenue` with a signed `initialOperations`, custodian settings unset | `sif.allocation_invalid`, `reason: outside_confirmation_missing` |
| 3 | `applyVenue(planVenue(...))` — the shape `santet-setup.ts` uses | `sif.allocation_invalid`, `reason: reauthentication_required` |
| 4 | `applyDeveloperDemoVenue` with that non-demo taxpayer | `deployment.demo_data_refused`, `environment: preproduction` |
| 5 (control) | case 2 again, plus a throwaway key's custodian file, confirmation file and fingerprint in the three settings | **succeeded**: one `registro_sif` row `S000001`; `fiscal_allocations` `B12345674 / preproduction`; series `A-S000001`, `FF-S000001`, `R-S000001` |

Case 5 is the premise of the design: the real, unmodified host path accepts a throwaway-signed
allocation for a non-demo taxpayer once the box is told to trust that key.

**2. The onboarding stack.** `wa-wt onboarding waitron-fix-a680-dev-throwaway-custodian` started
on slot 1 (process group 65367); `/setup-api/status` answered
`{"provisioned":false,"environment":"preproduction","developmentMode":true,"needs":["venue"]}`.
Two provision bodies in the shape `local/square/box-setup.mjs` sends were POSTed through the
wizard's own Vite proxy (`http://localhost:5192/setup-api/provision`, the path the browser uses):

```
mode=prepare taxId=B12345674 → HTTP 400 {"error":{"code":"sif.allocation_invalid","params":{"reason":"reauthentication_required"}}}
mode=demo    taxId=B00000000 → HTTP 400 {"error":{"code":"sif.allocation_invalid","params":{"reason":"reauthentication_required"}}}
```

So even the wizard's Demo choice with the built-in demo taxpayer cannot finish on a fresh
onboarding stack. Status still read `provisioned:false` afterwards. The stack was stopped with
`wa-wt down waitron-fix-a680-dev-throwaway-custodian` (the process group above). Bodies and output
are in `~/waitron-campaign-b/a680-repro/`.

## What was found (read, then the one bundle measurement)

- **The browser never sends `initialOperations`.** The server's setup route already accepts it
  (`apps/server/src/setup-api.ts:475-479`, passed on at `:524`), but no file under `apps/setup`
  names it (grep, exit 1), and the wizard's client posts the body it was given
  (`apps/setup/src/api/client.ts:223`). The wizard reaches the server through the Vite dev
  server's proxy (`apps/setup/vite.config.ts`, `/setup-api` → `devServerProxy()`).
- **The server reads the custodian settings from its own process environment, per attempt**
  (`packages/fiscal-verifactu/src/allocation-configuration.ts:8-10`), and the paper source rereads
  both files on every attempt (`allocation-paper-source.ts`). In the dev stack that environment is
  `apps/server/.env`, loaded by `apps/server/scripts/dev-server.mjs` with `--env-file`.
- **`wa-wt` gives every app process the box state directory:** `pnpm dev` runs with
  `WAITRON_STATE_DIR="$BOX_STATE/box"` (`~/workspace/tools/wa-wt:634-636`), and a target change
  deletes everything in that directory except `tls/` before `dev:reset:onboard`
  (`reset_target`, `wa-wt:207-224`).
- **A shipped box cannot be pointed at a custodian today.** `deploy/compose.yml`'s `environment:`
  list names no `WAITRON_FISCAL_*` setting, and nothing in `apps/server/src` or `packages/*/src`
  (tests aside) writes into `process.env` (grep for `process.env… =` and
  `Object.assign(process.env`: no match); the box's env files are merged into a separate object
  (`apps/server/src/box-env.ts`). This is read, not run. It is why `box-setup.mjs` against the
  real box is a STOP below.
- **"It lives under `apps/server/scripts/`" proves nothing about shipping.** Measured:
  `pnpm exec esbuild src/bin.ts --bundle --platform=node --format=esm --target=node24 --external:sharp --metafile=…`
  in `apps/server` (4 s) listed 2,893 inputs, 15 of them under `scripts/demo-seed/` (`seed.ts`,
  `seed-sales.ts`, `menu.ts` and others, pulled in by `src/demo-seed.ts` for the wizard's Demo
  mode). `scripts/demo-seed/allocation.ts` was not among them. So the new code needs a real
  bundle check, not a folder rule (Task 7).
- **Coverage does not measure `apps/server/scripts/`**: `apps/server/vitest.config.ts:31-36`
  includes `src/**/*.ts` and excludes `scripts/**`. Tests under `scripts/` still run in the
  package suite. New code here is therefore covered by tests but by no percentage table, like
  `dev-setup.ts` and the demo seed today. `apps/server/tsconfig.json` does include `scripts`, so
  it is typechecked.
- **`@waitron/fiscal-verifactu` has no `exports` map**, so the deep import
  `@waitron/fiscal-verifactu/src/paper-evidence.js` the demo seed already uses resolves and
  typechecks for a sibling file too. `scripts/module-seams.test.ts` checks only
  `packages/provisioning/src` and `apps/server/src` for fiscal imports (its header says so), so a
  file under `apps/server/scripts/` is outside it — the new code must stay out of `src/`.
- **The second lock already exists.** A preproduction allocation offered to a production-stamped
  database is refused `environment_mismatch`
  (`packages/fiscal-verifactu/src/allocation-envelope.ts:267`, tested at
  `allocation-envelope.test.ts:131`). Task 1 drives that through the real provision call as a
  test of its own, without editing either file.
- **No backlog entry exists for A680** (grep of `docs/backlog.md` and `docs/backlog/` for `A680`,
  `throwaway`, `custodian`: only the unrelated paper-custodian route entry at `docs/backlog.md:310`).

## Design

1. **One signer, `apps/server/scripts/dev-custodian/sign.ts`.** It refuses
   `WAITRON_ENV=production` (new error code `deployment.development_custodian_refused`), makes or
   loads an ed25519 key, and signs a preproduction-only allocation (installation `S000001`, series
   `<code>-S000001`) for any taxpayer and series bases, returning the setup input, the matching
   confirmation-file contents and the in-memory evidence. The environment value `"preproduction"`
   is a constant in this file; no caller can ask for production.
2. **In-process scripts** (`dev-setup.ts`, the owner's `santet-setup.ts`) use
   `applyDevelopmentVenue` (`dev-custodian/apply.ts`), the demo seed's current approach without the
   demo-identity check: sign in memory and swap the fiscal module's evidence source for that one
   call. `applyDeveloperDemoVenue` becomes "demo-identity check, then `applyDevelopmentVenue`",
   with its tests unedited.
3. **A running dev server** gets trust through the REAL host path: a command,
   `pnpm --filter @waitron/server dev:custodian`, with `init` (write the key, the public custodian
   file, and print the three `WAITRON_FISCAL_*` lines) and `sign` (read a setup request on stdin,
   write the confirmation file, print the request with `initialOperations` added). Nothing in the
   product changes; the server simply finds its three settings filled in.
4. **`dev:onboard` runs `init`** into `<stateDir>/dev-custodian/` and writes the three lines into
   the `.env` it already writes, so every fresh onboarding stack trusts its own throwaway key.
5. **The wizard's Vite dev server adds the allocation.** A small middleware in the setup app's
   Vite config (serve only, never in a build) catches `POST /setup-api/provision`, runs
   `dev:custodian sign` on the body when it carries no `initialOperations` and the custodian
   directory exists, and forwards the result to the server. The browser and every shipped route
   stay as they are. Without this the browser path cannot carry an allocation without a product
   change, which the item forbids.
6. **Production is refused three times:** the signer's own check (`WAITRON_ENV=production` in the
   calling process), the constant preproduction environment in what it signs, and the existing
   `environment_mismatch` refusal on a production-stamped database. Tests prove the first and the
   third; a deletion control proves the first is what refuses.
7. **Not shipped:** a test bundles every entry the image copies, exactly as the build does, and
   fails if any input comes from `scripts/dev-custodian/` or `scripts/demo-seed/allocation.ts`.

### Known limits (become backlog entries in Task 9)

- Each wizard submission gets fresh node, administrator and event ids, so a retry of a
  submission whose answer was lost does not replay as the same operation. On a dev stack the cure
  is `wa-wt reset onboarding <name>`.
- `box-setup.mjs` against a shipped box is not served (STOP 1).

## STOP points (owner decisions)

- **STOP 1 — the owner's box loader against the real box.** `local/square/box-setup.mjs` POSTs to
  `https://waitron.local`, a shipped image. That box cannot be told to trust any custodian today
  (see "A shipped box cannot be pointed at a custodian" above), and making it possible is a
  product change: lane E's A679. **Recommended default:** A680 does not cover it; the box loader
  waits for A679. Meanwhile the owner can load Santet into a laptop onboarding stack by running
  the same script against the wizard's port (Task 10 gives the command). The alternative — a
  hand-written compose override on the owner's preproduction box adding the three settings and
  the two files — is an untested operator procedure and belongs in its own item if wanted.
- No other point needs an owner answer. The new error code is not a STOP: before go-live a code
  may be added freely (owner decision 2026-09-26).

## Files

| File | Change |
| --- | --- |
| `apps/server/src/errors.ts` | add `"deployment.development_custodian_refused": { environment: string }` beside `deployment.demo_data_refused` (type registry only) |
| `apps/server/scripts/dev-custodian/sign.ts` (+ `sign.test.ts`) | new: environment check, key, signing |
| `apps/server/scripts/dev-custodian/apply.ts` (+ `apply.test.ts`) | new: `applyDevelopmentVenue` |
| `apps/server/scripts/demo-seed/allocation.ts` | refactor onto `applyDevelopmentVenue`; `allocation.test.ts` UNEDITED |
| `apps/server/scripts/dev-custodian/files.ts`, `cli.ts` (+ `cli.test.ts`) | new: `init` and `sign` |
| `apps/server/package.json` | add script `"dev:custodian": "tsx scripts/dev-custodian/cli.ts"` |
| `apps/server/scripts/dev-onboard.ts` (+ `dev-onboard.test.ts`) | run `init`, write three more `.env` lines, refuse production |
| `apps/server/scripts/dev-custodian/setup-proxy.ts` (+ `setup-proxy.test.ts`) | new: the Vite middleware; imports no fiscal code |
| `apps/setup/vite.config.ts` | register the middleware |
| `apps/server/scripts/dev-custodian/not-shipped.test.ts` | new: bundle-input guard |
| `docs/developers/workflow-guide.md` | new subsection under "The development stack from a worktree" |
| `docs/backlog.md`, `docs/backlog/fiscal.md` | entries for the open points |

## Task 1: the signer and its production refusal

**Files:** `apps/server/src/errors.ts`, `apps/server/scripts/dev-custodian/sign.ts`, `sign.test.ts`.

- [ ] Write `sign.test.ts` first, against a real database
  (`useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) })`, as
  `demo-seed/allocation.test.ts` does):
  - **"signs a preproduction allocation any taxpayer can activate":** taxpayer `B12345674` /
    "Real Restaurant S.L.", series `A`/`FF`/`R`. Build the evidence source in memory with
    `createAllocationPreparation` from `@waitron/fiscal-verifactu` over the signer's returned
    evidence, swap it in for the fiscal module, stamp `preproduction`, call `applyVenue`. Assert
    exactly: `registro_sif` `[{numero_instalacion: "S000001", node_id: <result nodeId>}]`;
    `fiscal_allocations` `[{taxpayer_nif: "B12345674", environment: "preproduction"}]`;
    `invoice_series` codes and purposes `A-S000001 standard`, `FF-S000001 full`,
    `R-S000001 rectificative`.
  - **"refuses production before signing":** `signDevelopmentAllocation(..., { WAITRON_ENV:
    "production" })` and `createDevelopmentKey({ WAITRON_ENV: "production" })` each reject
    `{ code: "deployment.development_custodian_refused", params: { environment: "production" } }`.
  - **"accepts unset, dev and preproduction":** `it.each([{}, {WAITRON_ENV: "dev"},
    {WAITRON_ENV: "preproduction"}])`, each returns an allocation whose `environment` is
    `"preproduction"`.
  - **"a misspelt environment is a configuration error":** `{ WAITRON_ENV: "prod" }` rejects
    `server.config_invalid` (it reuses `deploymentEnvironment`, `apps/server/src/config.ts:340`).
  - **"a production-stamped database refuses what it signs":** stamp `production`, offer the
    signed allocation as above, expect `{ code: "sif.allocation_invalid", params: { reason:
    "environment_mismatch" } }` and no `registro_sif` row. If the refusal arrives with another
    reason, record it verbatim and stop — do not loosen the assertion.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/sign.test.ts`.
  **Expected RED:** the import of `./sign.js` fails to resolve. Then add a bare `sign.ts` exporting
  stubs that throw `new Error("unimplemented")`, run again, and confirm the failures are the
  assertions (not the import).
- [ ] Implement. `sign.ts` exports:
  - `assertDevelopmentEnvironment(env: NodeJS.ProcessEnv): void` — `deploymentEnvironment(env)`;
    `"production"` throws `deployment.development_custodian_refused`.
  - `createDevelopmentKey(env)` → `{ custodianId: "developer-custodian", publicPem, privatePem,
    fingerprint }` (ed25519, `paperCustodianFingerprint`), calling the check first.
  - `signDevelopmentAllocation(request, env)` with `request = { key, taxpayerNif, bases, nodeId,
    administratorId, eventId, sourceId, now }`, calling the check first, and returning
    `{ input: { allocation /* with reservationEvidence: { block, consumption } */, approval },
    confirmation, evidence }`. Build them exactly as `demo-seed/allocation.ts:45-112` does today
    (`signPaperBlock`, `signPaperConsumptionForBlock`, approval with `oldMachineAbsent: true`,
    `oldMachineOffline: false`, `noParallelRecovery: true`). `confirmation` has the exact key set
    `createPaperAllocationSource` accepts (`allocation-paper-source.ts:65-82`) with `binding:
    { module: "fiscal-verifactu", action: "setup", eventId, sourceId, targetNodeId: nodeId }` and
    `operatorId: administratorId`. `environment: "preproduction"` is a literal, not a parameter.
  - Add the error code to `apps/server/src/errors.ts` with a two-line doc comment in the style of
    its neighbour.
- [ ] Run the same command → GREEN. Read the `Tests` count.
- [ ] **Deletion control:** delete the `"production"` throw in `assertDevelopmentEnvironment`, run
  again, record which cases fail and with what message (expected: the two production cases,
  because signing then succeeds), restore the line, run GREEN again. Write the control's command
  and result in the task's commit message.
- [ ] `pnpm --filter @waitron/server typecheck`. Commit (`git commit -s`).

## Task 2: `applyDevelopmentVenue`, and the demo seed on top of it

**Files:** `apps/server/scripts/dev-custodian/apply.ts`, `apply.test.ts`,
`apps/server/scripts/demo-seed/allocation.ts`.

- [ ] Write `apply.test.ts` first:
  - **"provisions any taxpayer in preproduction":** `it.each` over (a) `B12345674` / "Real
    Restaurant S.L." and (b) the demo NIF with legal name "SANTET DELI CO S.L." (the shape
    `santet-setup.ts` sends), calling `applyDevelopmentVenue(planVenue(request, ALL_MODULES), {
    db, modules: ALL_MODULES }, { WAITRON_ENV: "dev" })`. Assert the same three table facts as
    Task 1, the tenant row's `tax_id` and `legal_name`, and the `deployment` stamp
    `preproduction`.
  - **"refuses production before writing anything":** take the `facts()` snapshot exactly as
    `demo-seed/allocation.test.ts:43-51` does, call with `{ WAITRON_ENV: "production" }`, expect
    `deployment.development_custodian_refused`, and `facts()` unchanged.
  - **"leaves the shipped module list untouched":** after a call, `ALL_MODULES`' fiscal module's
    `operations` is still the same object as before (`toBe`), so the swap is local to the call.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/apply.test.ts` →
  RED on the missing module, then on assertions after a stub.
- [ ] Implement `applyDevelopmentVenue(actions, deps, environment = process.env)`: check the
  environment first; take the `ensure-tenant` action's `taxId` and the `create-series` bases;
  fresh UUIDs for node, administrator and event; `sourceId: "developer-custodian"`; key from
  `createDevelopmentKey`; sign; `stampDeployment(deps.db, "preproduction")`; `applyVenue` with
  `initialNodeId`, `initialAdministratorId`, `moduleInputs` and the fiscal module's `operations`
  replaced by `createAllocationPreparation(async (scope) => ({ ...scope, evidence }))` — the
  pattern at `demo-seed/allocation.ts:93-133`.
- [ ] Rewrite `applyDeveloperDemoVenue` as: `demoSeedEnvironment(environment)`; the existing
  demo-identity check throwing `deployment.demo_data_refused`; then
  `return applyDevelopmentVenue(actions, deps, environment)`. Keep `sourceId` behaviour irrelevant
  to its tests. **Do not edit `demo-seed/allocation.test.ts`.**
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/apply.test.ts scripts/demo-seed/allocation.test.ts scripts/dev-setup.test.ts`
  → all GREEN, with `allocation.test.ts`'s case count unchanged from main (count it on main first:
  same command with only `scripts/demo-seed/allocation.test.ts`).
- [ ] `git diff main -- apps/server/scripts/demo-seed/allocation.test.ts` prints nothing.
  Typecheck, commit.

## Task 3: the key directory and `dev:custodian init`

**Files:** `apps/server/scripts/dev-custodian/files.ts`, `cli.ts`, `cli.test.ts`,
`apps/server/package.json`.

- [ ] Write `cli.test.ts` cases for `init` first. Drive an exported
  `runDevCustodian(argv, { env, stdin, stdout, stderr }): Promise<number>` in-process, with a
  `mkdtemp` directory:
  - **"init writes a private key, a public custodian file and three settings":** exit 0; `key.pem`
    mode `0o600`; `custodian.json` has exactly `custodianId`, `publicKey`, `fingerprint` (the
    shape `allocation-paper-source.ts` requires); stdout is exactly three lines
    `WAITRON_FISCAL_CUSTODIAN_FILE=<dir>/custodian.json`,
    `WAITRON_FISCAL_CONFIRMATION_FILE=<dir>/confirmation.json`,
    `WAITRON_FISCAL_CUSTODIAN_FINGERPRINT=<fingerprint>`.
  - **"init reuses an existing key":** run twice; the fingerprint is identical and `key.pem`'s
    bytes did not change.
  - **"init refuses production and writes nothing":** `{ WAITRON_ENV: "production" }` → non-zero
    exit, stderr names `deployment.development_custodian_refused`, directory still empty.
  - **"unknown subcommand prints usage":** non-zero, usage on stderr.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/cli.test.ts` → RED.
- [ ] Implement `files.ts` (`initCustodianDir(dir, env)`: `mkdir -p` with mode `0o700`, create the
  key with `writeFile(..., { mode: 0o600, flag: "wx" })` only when absent, rewrite `custodian.json`
  through a temporary file and `rename`) and the `init` branch of `cli.ts` (`--dir <path>`,
  required; parse with `node:util` `parseArgs`, `strict: true`). The run-when-invoked block
  follows `dev-setup.ts`'s last lines. Add the `dev:custodian` script to `apps/server/package.json`
  (`scripts`, not `waitron.commands`: it must never become a shipped command).
- [ ] GREEN; then one real process: `pnpm --filter @waitron/server --silent dev:custodian init --dir "$(mktemp -d)"`
  prints three lines, and the same with `WAITRON_ENV=production` exits non-zero. Record both in
  the commit message. Typecheck, commit.

## Task 4: `dev:custodian sign`, end to end through the real host path

**Files:** `cli.ts`, `files.ts`, `cli.test.ts`.

- [ ] Write first, in `cli.test.ts`:
  - **"sign makes a setup request the real host path accepts":** `init` into a temporary
    directory; parse its three lines and `vi.stubEnv` each; feed `sign --dir <dir>` a provision
    body in the wizard's shape (`{ mode: "prepare", venue: { country: "ES", taxId: "b12345674",
    … seriesCode: "A", fullSeriesCode: "FF", rectificativeSeriesCode: "R", … } }` — the lower-case
    NIF is deliberate); parse stdout; call the real `provisionVenue` from `src/provision.ts` with
    `venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "ES-common")` and
    `{ environment: "preproduction", venue: <planVenue-ready request built from the body with the
    NIF normalised>, initialOperations: <stdout's initialOperations> }`. Assert the same three
    table facts as Task 1 with `taxpayer_nif` `B12345674`. This is the same path as reproduction
    case 5, but with the command's output instead of a test fixture.
  - **"the output keeps the rest of the body byte-for-byte":** every key but
    `initialOperations` is `toEqual` the input.
  - **"a missing full-series code signs FF":** body without `fullSeriesCode` → the signed series
    include `FF-S000001 full` (the planner's default, `packages/provisioning/src/venue-plan.ts:203`).
  - **"refuses a body that already carries initialOperations":** non-zero exit, confirmation file
    not written.
  - **"refuses production":** as in Task 3, and no confirmation file.
  - **"refuses a directory init never prepared":** non-zero, message says to run `init`.
- [ ] Run the file → RED, then implement: read stdin fully; normalise the NIF with
  `getVenueSetupCountryPack(country).taxIdentifier.validate` exactly as `parseVenue` does
  (`apps/server/src/setup-api.ts:370` and `:414`); bases
  `[seriesCode standard, fullSeriesCode ?? "FF" full, rectificativeSeriesCode rectificative]`;
  load the key; sign with fresh UUIDs; write `confirmation.json` through temporary file and
  `rename`; print the body with `initialOperations: { nodeId, administratorId, inputs: [{ module:
  "fiscal-verifactu", eventId, sourceId, input }] }`.
- [ ] GREEN. Run Tasks 1–3's files too. Typecheck, commit.

## Task 5: `dev:onboard` prepares the custodian

**Files:** `apps/server/scripts/dev-onboard.ts`, `dev-onboard.test.ts`.

- [ ] Tests first:
  - Extend the existing expected `.env` line list (`dev-onboard.test.ts:27-31`) with the three
    `WAITRON_FISCAL_*` lines after `WAITRON_HTTP_PORT`. This is a deliberate behaviour change of
    the written file, not a rewritten assertion: the three existing lines and their order stay.
  - **"the first line is unchanged":** the header still reads
    ``# Generated by `pnpm dev:onboard` (setup mode — no venue bound) — do not edit by hand.``
    — `wa-wt` picks the onboarding target by that text (`wa-wt:185`).
  - **"dev:onboard writes a custodian the settings point at":** after `devOnboard`, the custodian
    file named in `.env` exists and its fingerprint equals the `.env` fingerprint.
  - **"dev:onboard refuses production before migrating":** with `WAITRON_ENV=production` in the
    passed environment, rejects `deployment.development_custodian_refused`; no `.env`, no
    `venue.db`, no custodian directory.
- [ ] RED, then implement: `DevOnboardOptions` gains `stateDir` and `environment`
  (default `process.env`); check the environment before `inspectVenues`; call
  `initCustodianDir(join(stateDir, "dev-custodian"), environment)` after migrating; add the three
  keys to `SetupEnv` and `SETUP_ENV_KEYS`. `main()` passes the `stateDir` it already resolves.
  Print one line saying which custodian directory the box trusts.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-onboard.test.ts scripts/dev-setup.test.ts`
  → GREEN. Typecheck, commit.

## Task 6: the wizard's dev server adds the allocation

**Files:** `apps/server/scripts/dev-custodian/setup-proxy.ts`, `setup-proxy.test.ts`,
`apps/setup/vite.config.ts`.

- [ ] Tests first, in Node (this package's Vitest, not the setup app's browser mode). Start a fake
  upstream `node:http` server on `127.0.0.1:0` that records method, path, headers and body and
  answers a canned status and JSON. Call the exported middleware
  `devCustodianProvision({ target, stateDir, sign })` with `node:http` request/response pairs from
  a second local server; `sign` is injected (a fake that records its input and returns a body
  with `initialOperations`):
  - **adds the allocation:** `POST /setup-api/provision` without `initialOperations`, custodian
    directory present → `sign` received the body; upstream received the signed body with a
    correct `content-length`; the `accept-language` and `content-type` headers passed through;
    the client got upstream's status and body unchanged (try 200 and 400).
  - **leaves a body that has one:** `initialOperations` present → `sign` not called, upstream got
    the bytes unchanged.
  - **stands aside when there is no custodian:** directory absent → `next()` called, nothing
    forwarded.
  - **only that route:** `GET /setup-api/status`, `POST /setup-api/fiscal-test` → `next()`.
  - **a signer refusal is visible:** `sign` throws → 500 with
    `{ error: { code: "dev_custodian.sign_failed", params: {} } }` and the signer's message
    written to the dev server's log; nothing forwarded. (This JSON is a dev-tool answer, not a
    registered product code; say so in one comment.)
  - **serve only:** the exported Vite plugin object has `apply: "serve"`.
- [ ] RED, then implement. The default `sign` spawns
  `pnpm --silent --filter @waitron/server dev:custodian sign --dir <stateDir>/dev-custodian`
  from the repository root with the body on stdin. Forward with `node:http`/`node:https` to
  `target` (from `devServerProxy()`; `rejectUnauthorized: false` exactly when `secure: false`,
  mirroring the proxy). Import nothing from `@waitron/fiscal-verifactu` in this file.
- [ ] Register in `apps/setup/vite.config.ts`: `plugins: [viteNpmNotices(),
  devCustodianPlugin({ target: devServerProxy().target … })]`, importing
  `../server/scripts/dev-custodian/setup-proxy.js` (the same relative-import shape as the existing
  `../../scripts/dev-server-proxy.js`). The middleware must run before Vite's proxy: register it
  directly in `configureServer` (not in a returned post-hook). The LOOK in Task 10 is what proves
  the order; a unit test cannot.
- [ ] GREEN; `pnpm --filter @waitron/setup build` still succeeds; `pnpm lint` clean. Commit.

## Task 7: the throwaway custodian is not in anything the image ships

**File:** `apps/server/scripts/dev-custodian/not-shipped.test.ts`.

- [ ] Write the test:
  - Read `deploy/Dockerfile` and collect every `/src/apps/server/dist/<name>.js` the image copies
    (today `server.js`, `node-entry.js`, `bin-restore.js`, `bin-rejoin.js`, `bin-break-glass.js`,
    `bin-recovery.js`). Read `apps/server/package.json`'s `build` script and map each copied
    outfile back to its entry (`src/bin.ts=dist/server.js` and so on). Assert at least
    `dist/server.js` and `dist/node-entry.js` were found, and every copied outfile has an entry.
  - Bundle all those entries in ONE `esbuild.build` call with the same options as
    `scripts/bundle-node.mjs` `esbuildArgs` (`bundle`, `platform: "node"`, `format: "esm"`,
    `target: "node24"`, `external: BUNDLE_EXTERNALS` imported from that file), plus
    `write: false`, `metafile: true`, `outdir` in a temporary directory.
  - **Control in the other direction:** assert `scripts/demo-seed/seed.ts` IS an input of the
    server bundle — the scan can see a `scripts/` file when one is shipped.
  - Assert no input of any output starts with `scripts/dev-custodian/` or equals
    `scripts/demo-seed/allocation.ts`.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/not-shipped.test.ts`;
  record its duration (the 2026-10-14 single-entry CLI build took 4 s; if the test takes more than
  about 15 s, say so in the PR so the shard budget can be checked).
- [ ] **Deletion control:** add `import "../scripts/dev-custodian/sign.js";` to
  `apps/server/src/demo-seed.ts`, run → must FAIL naming `scripts/dev-custodian/sign.ts`; remove
  the line, run → GREEN. Record both in the commit message.
- [ ] The guard is weaker than its name in two ways; write them as the file's header comment and
  nowhere else: it reads the Dockerfile's copy list as text, and it covers only `apps/server`'s
  bundles (the browser bundles never include a Vite config). Commit.

## Task 8: run the guards

None of these files may be edited by this branch. Each must print a `Tests` count and pass.

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
pnpm --filter @waitron/server exec vitest run scripts/ src/provision.test.ts src/boot.setup-routes.test.ts src/provision-allocation-input.test.ts src/demo-seed.test.ts src/demo-seed.db.test.ts
pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/deploy-image-env.test.ts scripts/manifest-commands.test.ts scripts/apply-migrations-callers.test.ts scripts/english-only.test.ts scripts/claude-md-pointers.test.ts
pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/setup typecheck && pnpm lint && pnpm format:check
git diff --stat main -- packages/fiscal-verifactu apps/server/src/setup-api.ts apps/server/src/provision.ts docs/developers/paper-custodian.md apps/server/scripts/demo-seed/allocation.test.ts
```

The last command must print nothing. Coverage: this branch adds no file to any coverage table
(`apps/server/scripts/**` is excluded at `apps/server/vitest.config.ts:36`; `errors.ts` gains a
type only), so `pnpm --filter @waitron/server test:coverage` is not needed locally; CI runs it.

## Task 9: docs and backlog

- [ ] `docs/developers/workflow-guide.md`, new subsection after the dev-stack paragraphs, titled
  "A Veri\*Factu venue on a development stack". Plain English, in the house style
  (`~/.claude/docs-writing-style.md`): what `dev:onboard` now does (its own throwaway key under
  `<state dir>/dev-custodian/`, three settings in `.env`); that the wizard's dev server signs each
  setup automatically, for any taxpayer, preproduction only; the commands
  `pnpm --filter @waitron/server dev:custodian init --dir <dir>` and
  `… sign --dir <dir> < body.json > signed.json`; `applyDevelopmentVenue` for in-process scripts;
  that every one of them refuses `WAITRON_ENV=production`; that a shipped box cannot use any of
  this (point at A679); the retry limit. Do not edit `paper-custodian.md` (lane E's branch).
  `docs/` is ignored by prettier; check with `pnpm exec prettier --file-info docs/developers/workflow-guide.md`.
- [ ] Backlog: there is no A680 entry to delete. Add short entries in the fiscal area of
  `docs/backlog.md` (detail in `docs/backlog/fiscal.md`) for: (a) the owner's box loader against a
  shipped box waits for A679 (STOP 1's answer); (b) a retried wizard submission on a dev stack
  mints new ids and does not replay. Commit both docs in the branch (not the docs-only shortcut:
  the branch carries code).

## Task 10: LOOK, the owner note, then finish

- [ ] Check headroom (`memory_pressure | grep free`, `wa-wt ls`). Start
  `wa-wt onboarding waitron-fix-a680-dev-throwaway-custodian`; record the process group it prints;
  stop only that instance at the end with `wa-wt down waitron-fix-a680-dev-throwaway-custodian`.
- [ ] Confirm `apps/server/.env` has the three settings and the files exist.
- [ ] In the workspace's Playwright Chromium, open the wizard (`http://localhost:5192`) and walk
  **Prepare** with taxpayer `B12345674` / "Real Restaurant S.L." to the end. Screenshot each
  screen and the first trading screen into `~/waitron-campaign-b/a680-shots/`, light theme and
  phone width at least for the final screens. Then `wa-wt reset onboarding <name>` and walk
  **Demo** the same way. After each: `/setup-api/status` no longer answers (trading mode) and the
  venue database holds one `registro_sif` row `S000001`, `fiscal_allocations` with the typed NIF
  and `preproduction`, and the three `-S000001` series (read with `sqlite3` on
  `$HOME/workspace/.waitron-dev/box/venue/venue.db`, read-only).
- [ ] Also re-run the reproduction's two POSTs (`~/waitron-campaign-b/a680-repro/body-*.json`
  through `http://localhost:5192/setup-api/provision`, after a reset each) and record the 200s.
- [ ] Append to `~/waitron-campaign-b/questions.md` a dated note for the owner with the exact
  changes for the untracked Santet scripts (below) and STOP 1 with its recommended default.
- [ ] Update the ledger, then `/finish-branch` (FULL path: Codex run-it seat twice).

## What the owner's local Santet scripts should call

Both scripts live untracked in `~/workspace/worktrees/waitron-local-santet-data`, which is at
`fbadd1578`, before #1700 — they still work there today and break once that worktree is rebased
onto a main that has #1700.

- **`apps/server/scripts/santet-setup.ts`** (provisions on the laptop, in-process): add
  `import { applyDevelopmentVenue } from "./dev-custodian/apply.js";` and change the call at its
  line 53 from `await applyVenue(planVenue({...}, ALL_MODULES), { db, modules: ALL_MODULES })` to
  `await applyDevelopmentVenue(planVenue({...}, ALL_MODULES), { db, modules: ALL_MODULES })`.
  Nothing else changes; it refuses `WAITRON_ENV=production`.
- **`local/square/box-setup.mjs`** against a LAPTOP onboarding stack: no edit. Point it at the
  wizard's dev server instead of the server, so the dev server signs the request:
  `node local/square/box-setup.mjs --base http://localhost:<setup port>` (5192 on slot 1, 5292 on
  slot 2, as `wa-wt ls` shows). Its readiness poll then calls `/management-api/session` on the same
  base, which the setup app's dev server does not proxy — so for that poll the script needs the
  server's base instead; the owner session updating the script splits `--base` into a setup base
  and a server base. If the owner prefers to POST to the server directly, pipe the body through
  `pnpm --silent --filter @waitron/server dev:custodian sign --dir <state dir>/dev-custodian` first
  (state dir `$HOME/workspace/.waitron-dev/box` on slot 1,
  `$HOME/workspace/.waitron-dev/instances/<name>/box` on any other slot).
- **`box-setup.mjs` against the real box (`https://waitron.local`)**: not possible with this item
  (STOP 1).
