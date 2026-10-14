# A680: a throwaway preproduction allocation for Demo, Preparation and development setups

> **Status:** Revision 2 (amended after its plan review), written 2026-10-14 after the owner's
> ruling below. It SUPERSEDES Revision 1, which is kept unchanged at the end of this file as the
> record of what was built in commits `4aec9f84e..4dd990b93`. Its reproduction section is still
> the reproduction for this item.
>
> **For the implementer:** run each task with `superpowers:test-driven-development` (failing test
> first, watch it fail, then the smallest change). Dispatch each task as `subagent_type:
> "implementer"`. Review path: FULL — this changes how a fiscal identity reaches a venue, and adds
> a seat to a cross-package contract. Work only in
> `/Users/clintongormley/workspace/worktrees/waitron-fix-a680-dev-throwaway-custodian` (branch
> `fix/a680-dev-throwaway-custodian`). Run straight through; the owner wants this landed before
> morning. **Every task ends with `pnpm --filter @waitron/server typecheck` green** (plus the
> typecheck of any package it touched); no task leaves the branch uncompilable.

**Goal:** a box installed from `main` and set up through the real wizard in **Demo** or
**Preparation** reaches a working Veri\*Factu venue with no custodian kit, by making its own
throwaway allocation. Every production path refuses it. The development scripts and the
onboarding dev stack use the same path.

## Owner decisions

The ruling, verbatim from `~/waitron-campaign-b/questions.md` (watcher entries of 2026-10-14):

> **~22:00 — OWNER RULING for A680: Demo and Preparation on a SHIPPED box need no kit; the
> throwaway signer ships, refused in production.** The owner, in the watcher session: "for demos
> we shouldn't need a kit at all. for preparation, maybe the same?" The watcher pointed out that
> Preparation is preproduction too (`apps/server/src/setup-api.ts:496`), and the owner confirmed:
> **"y"**.
> - **A680 widens:** the throwaway preproduction allocation is no longer development-only. A real
>   box set up from the wizard in **Demo or Preparation** makes its own throwaway allocation,
>   clearly marked as throwaway, and the box refuses it whenever the environment is `production`
>   (keep your production refusal and its deletion control; it becomes the main guard). The
>   development scripts and onboarding stack keep using the same path.
> - **Drop Task 7's "the signer never ships" bundle check.** Replace it with a check that the
>   shipped path refuses in production: `WAITRON_ENV=production`, and `live` mode on a non-dev
>   box. Update the plan (docs-only push), with this ruling in its owner-decisions section, and
>   note the changed task in the PR.
> - **Lane E's A679 builds on your seam** for Demo and Preparation, and covers only Live (the real
>   custodian kit or a signed file). […] Your plan's note that "the owner's box loader against a
>   shipped box waits for A679" — re-check it against this ruling.
> - Review path stays FULL.
>
> **~22:05 —** "i only need the demo to be fixed by morning". […]
>
> **~22:08 — OWNER: Preparation is needed by morning too — both, on the owner's own box.** The
> owner: "so i can continue testing the latest code on my demo/preparation box". […] **Demo AND
> Preparation must both work by morning**, on a shipped box installed from the latest `main`, set
> up through the real wizard, with no kit. Test both modes on a real box-shaped install in the PR:
> the image, or the closest you can run, with the commands and what you saw. In the PR, say exactly
> what the owner must do on the box to take the fix: install the landed commit, then run the
> wizard, or the box loader, in Demo or Preparation.

**Driver ruling on Live on a dev box (2026-10-14, plan review):** follow the owner's wording —
"refuses … `live` mode on a non-dev box" — so Live on a dev box IS allowed, provided the
environment it is stamped with is not `production`. Checked: on a dev box Live is stamped
`preproduction` (`apps/server/src/setup-api.ts:495-496`, `mode === "live" && !devMode ?
"production" : "preproduction"`), so the signer accepts it. D2 below marks it.

Earlier decisions this revision keeps: the demo seed keeps its own fictional-identity refusal
(2026-10-14 "W41s-4 … demo decision", answer A); the new code imports nothing from a `test/` or
`testing/` directory ("do not use a test helper as the release implementation").

**The PR must say:** Revision 1's Task 7 ("the signer never ships") was dropped by the owner's
ruling and replaced by Task R5's production refusals (route, real server start) and R10's
production walk; the onboarding stack's dev-server signer, the `dev:custodian` command and
`dev:onboard`'s custodian settings were removed (Task R0). The plan rides in the PR; the
coordinator handles the ruling's "docs-only push" of it.

## Decisions, with reasons

### D1. Where the shipped signer lives: in the regime package, behind a new seat

`apps/server/src` may not import `@waitron/fiscal-verifactu`: `scripts/module-seams.test.ts`
("apps/server imports the Spanish regime only from the deferred runtime pass") holds an EMPTY
allowlist that CLAUDE.md says to shrink, never grow. Generic code reaches a regime only through the
module descriptor's seats (CLAUDE.md §3). So:

- The signer moves (with `git mv`, to keep its history) from
  `apps/server/scripts/dev-custodian/sign.ts` to
  **`packages/fiscal-verifactu/src/throwaway-allocation.ts`**, a NEW file. No existing file of the
  real custodian path, the allocation validation or any fiscal assertion changes.
- A new optional seat, **`ModuleProvisioning.throwawayAllocation`**, is declared in
  `packages/module/src/provisioning.ts` (a file lane E's branch does not edit). The fiscal module
  fills it INSIDE `FISCAL_PROVISIONING` itself, one line in
  `packages/fiscal-verifactu/src/provisioning.ts:7-10` (`throwawayAllocation:
  FISCAL_THROWAWAY_ALLOCATION`). `packages/composition/src/modules.ts` is NOT edited: the existing
  assertion `packages/composition/src/composition.test.ts:223`
  (`expect(fiscal?.provisioning).toBe(FISCAL_PROVISIONING)`) stays green unedited, and lane E's
  edit two lines away in `modules.ts` cannot conflict. `FISCAL_PROVISIONING` is already exported,
  so `packages/fiscal-verifactu/src/index.ts` is not edited either. Existing fiscal-verifactu
  files touched: `errors.ts` (one code) and `provisioning.ts` (one line).
- The generic step that turns a venue plan into apply inputs lives in
  **`packages/provisioning/src/throwaway-allocation.ts`** (new), naming no regime: it finds the one
  enabled module offering the seat. `provisionVenue` and the development scripts both call it.
- Coverage: `packages/fiscal-verifactu` and `packages/provisioning` measure `src/**/*.ts` at
  98/98/98/95 (`packages/fiscal-verifactu/vitest.config.ts:19,27`); both new files must be covered
  by their own package's tests, with no exclude. No Stryker config exists for either package
  (`ls packages/fiscal-verifactu/stryker*`: no match), so no mutation floor applies.

### D2. Where the server decides, and why Live with a kit is not weakened

**The seam, by name and shape** (the text to give lane E):

```ts
// packages/module/src/provisioning.ts
export interface ThrowawayAllocation {
  /** Refuses (sif.throwaway_allocation_refused) when `environments` is empty or names "production". */
  prepare(request: {
    readonly environments: readonly ("production" | "preproduction")[];
    readonly taxpayerNif: string;
    readonly bases: readonly { readonly code: string; readonly purpose: string }[];
    readonly nodeId: string;
    readonly administratorId: string;
  }): {
    readonly eventId: string;
    readonly sourceId: string;
    readonly input: unknown;
    readonly operations: ModuleOperationPreparation;
  };
}
export interface ModuleProvisioning { /* … */ readonly throwawayAllocation?: ThrowawayAllocation; }

// apps/server/src/provision.ts
export interface ProvisionRequest {
  /* … */
  /** Set ONLY by the setup route; see D2 step 1. */
  initialAllocation?: { readonly kind: "throwaway"; readonly hostEnvironment: DeploymentEnvironment };
}
```

How it flows:

1. **The setup route decides.** `parseProvisionPayload` (`apps/server/src/setup-api.ts:459`,
   called from the fiscal-test route at `:634` and the provision route at `:694`) gains the box's
   environment as an argument and sets
   `request.initialAllocation = { kind: "throwaway", hostEnvironment: deps.environment }` exactly
   when the body carries no `initialOperations` AND either `mode` is `"demo"` or `"prepare"`, or
   `mode` is `"live"` and the box is a dev box (`deps.devMode`). Nothing else marks a request: the
   route builds the request from named fields, so a body field called `initialAllocation` is never
   read (R4 tests a forged one). Where the inputs come from: `deps.environment` is the box's
   `config.environment` and `deps.devMode` its `config.devMode` (`apps/server/src/boot.ts:928-929`);
   `config.devMode` is `isDevMode(env)` (`apps/server/src/config.ts:515`), true only for
   `WAITRON_ENV=dev` exactly, read from the server's own process environment at start — nothing
   on the LAN can set it. (The fiscal-test caller never marks in practice: it accepts only a Live
   request stamped `production`, `setup-api.ts:639-641`, and a production-stamped Live is never on
   a dev box.)
2. **`provisionVenue` acts** (`apps/server/src/provision.ts`). If the request carries both
   `initialAllocation` and `initialOperations` it refuses `setup.request_invalid`
   (`field: "initialOperations"`). After the foreign-taxpayer and already-provisioned checks and
   BEFORE `stampDeployment` (so a refusal writes nothing), it calls the provisioning helper with
   `environments: [hostEnvironment, request.environment]`. The helper returns
   `initialNodeId`, `initialAdministratorId`, `moduleInputs` and the module list with that one
   module's `operations` replaced by the seat's in-memory evidence source, for this call only.
   If no enabled module offers the seat (a territory whose fiscal slot is `fiscal-none`), the
   helper returns nothing and the venue is provisioned as today.
3. **The seat signs** (`FISCAL_THROWAWAY_ALLOCATION.prepare`): its first statement refuses an
   empty list or any `"production"`; then it makes a fresh ed25519 key in memory, signs a
   preproduction allocation for that taxpayer and those bases, and returns the input plus a
   `createAllocationPreparation` over that evidence — the swap the demo seed already uses
   (`apps/server/scripts/demo-seed/allocation.ts:93-133` on main). The key is never written
   anywhere.
4. **The route logs it.** After a marked request's `provision` succeeds, the provision route writes
   `log("info", "setup.throwaway_allocation", { mode })` with the route's own logger (the one that
   writes `setup.mode_active`, `setup-api.ts:556`). `provisionVenue` has no logger and its result
   carries no allocation id, so the log names the mode, not the id; the id is in
   `fiscal_allocations` (D3).

**Why Live with a kit, and Live on a production box, are not weakened.** A request carrying
`initialOperations` is never marked, so a supplied allocation always goes through
`FISCAL_OPERATIONS` and `allocation-paper-source.ts` exactly as they are. A Live request on a
non-dev box is never marked, and is stamped `production` anyway, which the seat refuses. The swap
replaces the fiscal module's `operations` in a COPY of the module list built inside one
`provisionVenue` call, the way the demo seed and the test helpers already do; `ALL_MODULES` itself
is never mutated (R3 asserts `toBe` identity after a call). Everything after the evidence source —
`createAllocationPreparation`, the envelope validation, the signature checks, the
environment-against-stamp check (`packages/fiscal-verifactu/src/allocation-envelope.ts:267`) —
runs unchanged for the throwaway allocation too.

**No other setup path can get a throwaway.** Only `provision.ts` and the development scripts'
`throwaway-venue.ts` call the helper (R8 greps for it). The other paths that make a fiscal
identity — the cold restore (`waitron-restore` and the setup route's restore), the standby join
(adopt), the provisioning command with `WAITRON_INITIAL_VENUE_INPUT`, `register-till`, and the
fiscal-readiness runner — call none of it and keep requiring a supplied allocation. And a
throwaway allocation can never become a production identity later: it is always signed
`preproduction`, the validation refuses it against a `production` stamp
(`allocation-envelope.ts:267`), and a database's stamp never changes once written
(`stampDeployment` throws `deployment.already_stamped` for a different value,
`packages/db/src/deployment.ts:79`).

### D3. What "clearly marked as throwaway" means

Every identifier the signer chooses says so; nothing that enters a hash, the chain or AEAT's
fields changes (CLAUDE.md §5: never put our own metadata into a hash):

| Field | Value | Where an operator can see it |
| --- | --- | --- |
| custodian id (block, trust) | `waitron-throwaway-preproduction` | `fiscal_allocations.allocation` JSON (the signed block) |
| allocation id | `throwaway-<uuid>` | `fiscal_allocations.allocation_key` and the JSON |
| recipient venue, generation, block ids | `throwaway-preproduction`, `throwaway-<uuid>`, `throwaway-<uuid>` | the JSON |
| setup source id (binding, approval, consumption) | `throwaway-preproduction` | `fiscal_allocations.approval` JSON |
| incident evidence | `throwaway-preproduction-allocation` | approval and consumption JSON |
| log line at setup | `setup.throwaway_allocation` (info), params `{ mode }` | the box log / recovery page tail |

Unchanged on purpose: the installation number stays `S000001` and the series stay `<code>-S000001`
(they reach AEAT as `NumeroInstalacion` and `NumSerieFactura`, and are what the demo seed and the
test fixtures already use); the allocation's `source` stays `"initial-paper"` and its `environment`
`"preproduction"` (both are checked by the unchanged validation). No registro, `computeHuella`
input, chain or `registros_facturacion` row carries any marker. If server log event names turn out
to be registered anywhere (grep for `"setup.mode_active"` outside `setup-api.ts`), register the new
one there too.

### D4. The refusal matrix — one test per cell

| # | Box | Mode / request | Expected | Test |
| --- | --- | --- | --- | --- |
| 1 | `WAITRON_ENV=production` | demo | `sif.throwaway_allocation_refused` `{environment:"production"}`, HTTP 400 through the route (the error boundary's default; the code is not in `PROVISION_STATUS`, `setup-api.ts:186-188` — pinned); nothing written, deployment unstamped | R3 (provisionVenue), R4 (route), **R5 (real server start)**, R10 (image) |
| 2 | `WAITRON_ENV=production` | prepare | same as 1 | R3, R4 |
| 3 | `WAITRON_ENV=production` | live, no initialOperations | not marked (`devMode` is false); refused as on main (`setup.fiscal_test_required` or the existing allocation refusal — record which) | R4 |
| 4 | not dev (`preproduction`) | live, no initialOperations | not marked; stamped `production`; refused as on main | R4 |
| 5 | dev (`WAITRON_ENV=dev`) | live, no initialOperations | **marked; succeeds** with cell 12's facts (stamped `preproduction`) | R4 |
| 6 | any non-production | any mode WITH initialOperations | not marked; the supplied allocation goes through the real custodian path (existing `provision-allocation-input.test.ts:324` stays green, unedited) | R4 |
| 7 | (direct call) | `provisionVenue` with BOTH marker and initialOperations | `setup.request_invalid` `{field:"initialOperations"}`, nothing written | R3 |
| 8 | (direct call) | marker with `request.environment: "production"` | `sif.throwaway_allocation_refused`, nothing written | R3 |
| 9 | (seat) | `environments` empty, or naming `"production"` in any position | refused before any key is made | R1 |
| 10 | (third lock) | throwaway-signed input against a PRODUCTION-stamped database | `sif.allocation_invalid` `environment_mismatch` | R1 |
| 11 | any non-production | demo or prepare, no initialOperations, territory whose slot is `fiscal-none` | venue provisioned, no allocation row | R3 |
| 12 | non-production | demo / prepare, no initialOperations | **succeeds**: one `registro_sif` `S000001`, `fiscal_allocations` with the typed NIF and `preproduction`, three `-S000001` series | R3, R4, R5, R10, R11 |
| 13 | non-production | demo, committed venue, first response lost, same body re-sent | replays to 200 through `recoverProvisionedVenue` (which ignores the marker) | R4 |
| 14 | non-dev, non-production | live with a forged body field `initialAllocation: { kind: "throwaway", … }` | ignored: not marked, refused as cell 4 | R4 |

**Deletion controls.** (a) Delete the production throw in the seat: cells 1, 2, 8 and 9 must fail
— including cell 1 through the real server start (R5); cell 10 must still pass (it is the
independent lock). (b) Make the route mark Live on every box, ignoring `devMode`: cells 3, 4 and
14 must fail (the route-level tests see a marker where none belongs). Restore after each.

### D5. What Revision 1 code goes, and what it costs

| Removed | Why it is dead | Cost |
| --- | --- | --- |
| `apps/server/scripts/dev-custodian/setup-proxy.ts` (+ test) and its registration in `apps/setup/vite.config.ts` | the server now signs Demo, Preparation and dev-box Live itself | none; `git diff main...HEAD -- apps/setup/vite.config.ts` becomes empty |
| `dev:custodian` command: `cli.ts`, `files.ts`, `cli.test.ts`, the `apps/server/package.json` script | nothing calls it once the dev-server signer is gone; the box loader no longer needs it (D7) | no way left to exercise `allocation-paper-source.ts` on a dev stack with a throwaway key file until A679; the package tests still do through fixtures |
| `dev:onboard`'s custodian: the key directory, the three `WAITRON_FISCAL_*` `.env` lines | the server no longer needs them | none. `dev-onboard.test.ts`'s `.env` line list and its test name go back to main's three keys |
| `apps/server/scripts/dev-custodian/not-shipped.test.ts` | asserts the opposite of the ruling | none |
| `apps/server/scripts/dev-custodian/sign.ts` (+ test) | moved into the package (D1) | none |

Kept: `applyDevelopmentVenue`, moved to `apps/server/scripts/throwaway-venue.ts` (+ test) and
rebuilt on the provisioning helper, because `santet-setup.ts` and `dev-setup.ts` (through
`applyDeveloperDemoVenue`) provision in-process with no server. `dev:onboard`'s and
`dev:reset:onboard`'s production refusal (Revision 1 Task 5 review fix, `fe4b82c0d`) stays — it
stops `--reset` deleting a venue folder under `WAITRON_ENV=production` — but throws a plain
`Error` naming `WAITRON_ENV=production`, as `dev-setup.ts`'s own refusals do.

**A stray `.env` to remove first.** The Revision 1 "run as a command" test
(`apps/server/scripts/dev-onboard.test.ts:200-221`) spawns the real script, whose settings file is
fixed beside it, so whenever the refusal is missing it writes the REAL `apps/server/.env`. It has
already happened: this worktree's `apps/server/.env` (written 21:32) names a deleted
`/var/folders/…/waitron-dev-onboard-main-k57n5b/venue`, and `wa-wt`'s `newest_env` copies the
newest `.env` into fresh worktrees. R0 deletes it and makes the path overridable.

### D6. The error code is renamed

`deployment.development_custodian_refused` is no longer development-only. It becomes
**`sif.throwaway_allocation_refused`** with params `{ environment: string }` (`"production"`, or
`"none"` for an empty list), beside `sif.allocation_invalid` in
`packages/fiscal-verifactu/src/errors.ts` (the package that throws it), and leaves
`apps/server/src/errors.ts`. Error codes name the domain concept, and before go-live a rename is
free (owner decision 2026-09-26). Every copy moves in the same change:
`grep -rn development_custodian_refused apps packages docs scripts` must be empty afterwards.

The setup wizard gets no text for it in this branch. On a box started with `WAITRON_ENV=production`
the wizard still offers Demo and Preparation (`apps/setup/src/screens/mode-screen.ts` shows only a
production warning there, `:170`), so an operator can reach it and will see the wizard's generic
failure. R4 pins the HTTP 400; R9 adds a backlog entry for the wizard text.

### D7. The owner's box loader: same path, no edit

`local/square/box-setup.mjs` POSTs `mode: "prepare"` with no `initialOperations` to
`/setup-api/provision` — exactly the request the wizard's Preparation sends. Under D2 the route
marks it throwaway, so on a box running this commit it needs **no edit**:
`node local/square/box-setup.mjs --base https://waitron.local` for the owner's box, or
`--base https://localhost:<server port>` for a laptop onboarding stack (the server's port, not the
wizard's, so its readiness poll reaches `/management-api/session`). Revision 1's two-line
`--server` edit and the `sign` pipe are withdrawn. R11 runs the unedited script against the
box-shaped install. `santet-setup.ts`'s change is still needed (it calls `applyVenue`
in-process): import `applyDevelopmentVenue` from `./throwaway-venue.js` and use it in place of
`applyVenue` at its line 53.

## Existing checks this changes

Searched on the branch base (`1cd3b14bf`): no test on main pins a refusal for a Demo or
Preparation setup without an allocation. `grep -rn "sif.allocation_invalid" apps/server/src`
outside the fiscal operation suites finds only `reserved-identity.test.ts:198` and `:235`
(reservations); the setup-route harness in `boot.setup-routes.test.ts:414-431` and
`boot.test.ts:1460,1621,1640` SUPPLY `initialOperations` for every first provision, so under cell
6 they keep taking the real custodian path, unchanged. `composition.test.ts:223` stays green
because the seat goes inside `FISCAL_PROVISIONING` (D1). This is a read, not a run: R5 runs every
setup and provision suite and lists in the PR's "Changed test checks" any assertion on main that
had to change, with `file:line`. If one is a fiscal assertion, STOP and ask. R5's new
`withSetupBoot` option adds a parameter to a test harness on main without changing any of its
existing assertions.

Checks of this branch's own Revision 1 that change (not on main): `dev-onboard.test.ts` returns to
main's three-key list, and its "run as a command" case gains an overridable settings path (R0);
the Revision 1 tests that named `deployment.development_custodian_refused` move with their code
(R1, R6) or are deleted (R0).

## Unsure points (each also goes in the PR)

1. **What "the environment is production" means on a fresh shipped box.** `deploy/compose.yml`
   does not set `WAITRON_ENV` (`deploy/README.md`: "`WAITRON_ENV` is deliberately NOT in this
   file"), so a box in setup mode is preproduction, and production enters through Live's request
   environment. The seat refuses both; a box started with `WAITRON_ENV=production` is refused in
   every mode (R5, R10).
2. **Demo reopens the pre-#1700 setup race.** Anyone on the setup network can set up an
   unconfigured box in Demo or Preparation before its owner does, as they could before #1700. It
   is preproduction only (no production identity can come of it, D2), but it is a real exposure
   on a shared network.
3. **Whether a Preparation box sends anything to AEAT.** `box-setup.mjs`'s header says Preparation
   sends nothing; this branch does not change what a box submits and has not checked it.
4. **Lane E overlap.** Lane E's `feat/w41s6-offline-recovery-pack` edits fiscal-verifactu files
   this branch only reads (`allocation-paper-source.ts`, `allocation-configuration.ts`,
   `paper-evidence.ts`, `paper-custodian.ts`) and `apps/setup/src`; both branches edit
   `docs/backlog.md` and `docs/backlog/fiscal.md`. Expect a small rebase for whichever lands
   second. That is also why every "unchanged" check below uses `git diff main...HEAD` (three
   dots: this branch's own changes, not main's movement).
5. **Docker Desktop and the box compose.** Measured by the reviewer: the dev mailpit
   (`waitron-mailpit-1`) holds 1025 and 8025, so the box compose's mailpit must take other ports;
   email from the box will not work in the Mac's bridge shape. Whether everything else starts
   cleanly is R10's first finding.
6. **No wizard text for the new refusal** (D6); a backlog entry instead.

## Tasks

### R0: remove what Revision 1 no longer needs (first, so later moves compile)

- [ ] Delete this worktree's stray `apps/server/.env` (D5) before anything else, and check
  `ls -la apps/server/.env` reports it gone. Do not touch any other worktree's `.env`.
- [ ] Delete `apps/server/scripts/dev-custodian/setup-proxy.ts`, `setup-proxy.test.ts`,
  `cli.ts`, `cli.test.ts`, `files.ts`, `not-shipped.test.ts`; the `dev:custodian` script in
  `apps/server/package.json`; the plugin registration in `apps/setup/vite.config.ts`
  (`git diff main...HEAD -- apps/setup` must print nothing).
- [ ] `dev-onboard.ts`: remove the custodian directory and the three `.env` keys; keep the
  production refusal before `--reset`, now a plain `Error` naming `WAITRON_ENV=production`; make
  the settings-file path overridable for tests (an exported option, and in `main()` an environment
  variable read only there, e.g. `WAITRON_DEV_ENV_FILE`, defaulting to the file beside the script).
  `dev-onboard.test.ts`: main's three-key list and test name come back; the refusal cases assert
  the new message; the "run as a command" case (`:200-221`) sets the override to a path in its
  own temporary folder and asserts that file was NOT written. Run it once with the refusal deleted
  to see it fail on the override path, not the real one; restore.
- [ ] `sign.ts` and `apply.ts` stay for now (R1 and R6 move them). `pnpm --filter @waitron/server
  exec vitest run scripts/` GREEN; `pnpm --filter @waitron/setup build` succeeds; server and setup
  typecheck; lint. Commit.

### R1: the seat and the shipped signer

**Files:** `packages/module/src/provisioning.ts`;
`packages/fiscal-verifactu/src/throwaway-allocation.ts` (`git mv` from
`apps/server/scripts/dev-custodian/sign.ts`), `throwaway-allocation.test.ts` (`git mv` from
`sign.test.ts`), `errors.ts`, `provisioning.ts`; `apps/server/src/errors.ts` (remove the old code);
`apps/server/scripts/dev-custodian/apply.ts` (repointed so the server still compiles).

- [ ] Tests first, in `throwaway-allocation.test.ts`, reached through the seat
  (`FISCAL_PROVISIONING.throwawayAllocation.prepare`), never through `test/allocation-fixture.ts`:
  - **signs for any taxpayer:** `B12345674`, bases A/FF/R. Run the returned `operations.prepare`
    around `FISCAL_PROVISIONING.seed.run` inside `withOperationAuthority` on a real
    `useVenueDb` database with the tenant, node and series rows the seed expects (follow
    `default-lifecycle.test.ts:54-64`), stamped `preproduction`. Assert the `registro_sif` row
    (`S000001`), the `fiscal_allocations` row (`B12345674`, `preproduction`), and that the series
    resolve to `A-S000001`, `FF-S000001`, `R-S000001`. (No `@waitron/provisioning` import:
    provisioning depends on composition, which depends on this package, so a test-only edge would
    close a loop — `scripts/workspace-cycles.test.ts`.)
  - **is marked throwaway (D3):** every value in D3's table except the log line, exactly; and the
    `registro_sif` row's columns contain no `throwaway` text.
  - **refuses production and an empty list:** `it.each` over `["production"]`,
    `["preproduction","production"]`, `["production","preproduction"]` → `{ code:
    "sif.throwaway_allocation_refused", params: { environment: "production" } }`; `[]` →
    `{ environment: "none" }`; and in every case no key was made. Count keys through an injected
    key maker — export a factory `createThrowawayAllocation({ generateKey })` whose default is
    `generateKeyPairSync("ed25519")`, and have `FISCAL_THROWAWAY_ALLOCATION` be its default
    instance — not by spying on `node:crypto` from ESM, which may not take.
  - **accepts preproduction:** `["preproduction"]`, `["preproduction","preproduction"]`.
  - **third lock (cell 10):** a `production`-stamped database refuses the signed input
    `environment_mismatch`; no `registro_sif` row.
  - **each call makes a new key and new ids.**
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/throwaway-allocation.test.ts`
  → RED (missing export), then on assertions after a stub.
- [ ] Implement: the seat type in `packages/module/src/provisioning.ts` (D2's shape, one-line doc
  per member); the moved file starts `import "./errors.js";` (as `allocation-operation.ts:1` does)
  and is rebuilt from the Revision 1 signer with D3's values, the environment check FIRST, the key
  in memory only; the code in `packages/fiscal-verifactu/src/errors.ts`; the one line in
  `FISCAL_PROVISIONING`. Remove `deployment.development_custodian_refused` from
  `apps/server/src/errors.ts`. Repoint `apps/server/scripts/dev-custodian/apply.ts` to call
  `FISCAL_PROVISIONING.throwawayAllocation.prepare` (deep import of
  `@waitron/fiscal-verifactu/src/provisioning.js` is allowed in `scripts/`) so it, `dev-setup.ts`
  and `demo-seed/allocation.ts` still compile and `apply.test.ts` passes with the new code name.
  The `git mv` and the fixes go in ONE commit: a move-only commit would not compile.
- [ ] GREEN. `pnpm --filter @waitron/fiscal-verifactu test:coverage` — read the per-file row for
  `throwaway-allocation.ts` (100% expected; the package bar must hold).
  `pnpm --filter @waitron/composition exec vitest run` (proves `composition.test.ts:223` unedited
  and green). Typecheck module, fiscal-verifactu, composition, server. **Deletion control (a)** for
  this file's cases. Commit.

### R2: the generic step in `@waitron/provisioning`

**Files:** `packages/provisioning/src/throwaway-allocation.ts`, `.test.ts`, `index.ts`.

- [ ] Tests first: `throwawayApplyInput(plan, modules, environments)` with `ALL_MODULES` from
  `@waitron/composition`:
  - returns `initialNodeId`, `initialAdministratorId`, a `moduleInputs` entry for the seat's module
    and a module list in which only that module's `operations` differs — and `ALL_MODULES`' own
    entry is unchanged (`toBe`);
  - end to end: `applyVenue(plan, { db, ...result })` on a `useVenueDb` database stamped
    preproduction gives cell 12's facts for `B12345674` and for the demo NIF with legal name
    "SANTET DELI CO S.L.";
  - takes the taxpayer from the plan's `ensure-tenant` and the bases from `create-series`;
  - a module list with no seat (fiscal-none selected) → `undefined`;
  - production in `environments` → `sif.throwaway_allocation_refused` (the seat's refusal passes
    through);
  - a plan with no `ensure-tenant` → `setup.request_invalid` (not a `TypeError`; Revision 1's
    deferred minor).
- [ ] RED → implement → GREEN with
  `pnpm --filter @waitron/provisioning exec vitest run src/throwaway-allocation.test.ts`; the
  package's coverage row for the file at 100%. `pnpm exec vitest run scripts/module-seams.test.ts`
  (the file names no regime). Typecheck provisioning and server. Commit.

### R3: `provisionVenue` uses it

**Files:** `apps/server/src/provision.ts`, new `apps/server/src/provision-throwaway.test.ts`.

- [ ] Tests first, calling the real `provisionVenue` with `venueModuleConfig(parseModuleConfig({},
  ALL_MODULES), "ES-common")` on a `useVenueDb` database: cells 1, 2 (as `hostEnvironment:
  "production"`), 7, 8, 11 (no country pack offers a `fiscal-none` territory today — only
  `packages/provisioning/src/venue-fiscal.test.ts` and `cli.test.ts` select it — so build that
  module config by hand the way those tests do, and say so), 12 (cell 12's facts plus the
  deployment stamp `preproduction`). For every refusal: the `facts()` snapshot
  (`demo-seed/allocation.test.ts:43-51`'s shape plus `deployment`) is unchanged. Also: after a
  call, `ALL_MODULES`' fiscal entry's `operations` is the same object (`toBe`).
- [ ] RED → implement D2 step 2 → GREEN:
  `pnpm --filter @waitron/server exec vitest run src/provision-throwaway.test.ts src/provision.test.ts src/provision-allocation-input.test.ts`.
  Deletion control (a) over this file. Server typecheck. Commit.

### R4: the setup route marks the request (route level)

**Files:** `apps/server/src/setup-api.ts` (`parseProvisionPayload`, both callers, and the log line
of D2 step 4), new `apps/server/src/setup-throwaway.route.test.ts`.

- [ ] Tests first, with a recording fake `provision` (the `makeDeps` pattern of
  `setup-api.test.ts:2890`), asserting the exact `initialAllocation` the fake received — present
  with the right `hostEnvironment`, or absent: cells 1–6 and 14, each with its box settings
  (`environment`, `devMode`) and mode. Plus: cell 1 and 2's refusal reaches the client as HTTP 400
  with the code (feed the fake a thrower of `sif.throwaway_allocation_refused`), and the
  `setup.throwaway_allocation` log line appears after a marked success and not after an unmarked
  one.
- [ ] RED → implement D2 steps 1 and 4 → GREEN with
  `pnpm --filter @waitron/server exec vitest run src/setup-throwaway.route.test.ts src/setup-api.test.ts`.
  **Deletion control (b).** Server typecheck. Commit.

### R5: end to end through the route and the real server start

**Files:** `apps/server/src/setup-throwaway.route.test.ts` (end-to-end cases),
`apps/server/src/boot.setup-routes.test.ts` (one harness option and new cases only).

- [ ] With the real `provisionVenue` mounted as `provision-allocation-input.test.ts:324` mounts it:
  Demo and Prepare without `initialOperations` → 200 and cell 12's facts; dev-box Live (cell 5) →
  200; cells 3/4 refusals with their exact codes; cell 13 (follow
  `provision-allocation-input.test.ts:399`).
- [ ] **Through the real server start:** give `withSetupBoot` (`boot.setup-routes.test.ts:386`)
  an option that turns off its automatic `initialOperations` (`:414-431`), default unchanged so
  every existing case runs as before. New cases with it off: `WAITRON_ENV: "preproduction"` +
  Demo → 200 and the box restarts into trading with cell 12's facts; `WAITRON_ENV: "production"` +
  Demo → HTTP 400 `sif.throwaway_allocation_refused`, status still unprovisioned, nothing written.
  This is the one test that exercises `boot.ts:928-929` feeding the box's environment and dev flag
  to the route. **Deletion control (a)** against the production case: it must fail.
- [ ] Run every setup and provision suite and record counts:
  `pnpm --filter @waitron/server exec vitest run src/setup-api src/setup-email-provision src/boot.setup-routes src/boot.test.ts src/provision src/fiscal-readiness src/demo-seed src/setup-throwaway`.
  Any assertion on MAIN that had to change goes in the PR's "Changed test checks" with
  `file:line`; a fiscal assertion is a STOP. Server typecheck. Commit.

### R6: the development scripts on the same path

**Files:** `apps/server/scripts/throwaway-venue.ts` (+ test; `git mv` from
`dev-custodian/apply.ts` and `apply.test.ts`), `apps/server/scripts/demo-seed/allocation.ts`,
`apps/server/scripts/dev-setup.ts` (import path only).

- [ ] Rebuild `applyDevelopmentVenue(actions, deps, environment = process.env)` on
  `throwawayApplyInput(actions, deps.modules, [deploymentEnvironment(environment)])` plus
  `stampDeployment(deps.db, "preproduction")` and `applyVenue`. Its tests keep their cases, with
  the refusal code `sif.throwaway_allocation_refused`. `applyDeveloperDemoVenue` keeps
  `demoSeedEnvironment` and the demo-identity check first; **`demo-seed/allocation.test.ts` stays
  unedited** (`git diff main...HEAD -- apps/server/scripts/demo-seed/allocation.test.ts` empty).
  `apps/server/scripts/dev-custodian/` is now empty; remove it.
- [ ] `pnpm --filter @waitron/server exec vitest run scripts/throwaway-venue.test.ts scripts/demo-seed/allocation.test.ts scripts/dev-setup.test.ts`
  GREEN; server typecheck. Commit.

### R7: guards and the branch-wide controls

Each must print a `Tests` count and pass; none of the first two files may be edited.

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad
pnpm --filter @waitron/fiscal-verifactu test:coverage
pnpm --filter @waitron/provisioning test:coverage
pnpm --filter @waitron/composition exec vitest run
pnpm exec vitest run scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/workspace-cycles.test.ts scripts/english-only.test.ts scripts/deploy-image-env.test.ts scripts/manifest-commands.test.ts scripts/claude-md-pointers.test.ts scripts/apply-migrations-callers.test.ts
pnpm -r --filter @waitron/module --filter @waitron/fiscal-verifactu --filter @waitron/composition --filter @waitron/provisioning --filter @waitron/server --filter @waitron/setup typecheck && pnpm lint && pnpm format:check
git diff --stat main...HEAD -- packages/fiscal-verifactu/src/allocation-configuration.ts packages/fiscal-verifactu/src/allocation-paper-source.ts packages/fiscal-verifactu/src/allocation.ts packages/fiscal-verifactu/src/allocation-envelope.ts packages/fiscal-verifactu/src/allocation-preparation.ts packages/fiscal-verifactu/src/paper-evidence.ts packages/fiscal-verifactu/src/paper-custodian.ts packages/fiscal-verifactu/src/index.ts packages/composition/src/modules.ts docs/developers/paper-custodian.md apps/server/scripts/demo-seed/allocation.test.ts apps/setup
grep -rln "throwawayApplyInput" apps packages | grep -v "\.test\.ts$"
grep -rn "development_custodian_refused\|dev:custodian" apps packages docs scripts
```

The `git diff` must print nothing; the first `grep` must list only
`packages/provisioning/src/throwaway-allocation.ts`, its `index.ts` export,
`apps/server/src/provision.ts` and `apps/server/scripts/throwaway-venue.ts` (D2's "no other setup
path"); the last must print nothing outside this plan. Then run **both deletion controls once more
on the finished branch** (D4) and record which cases failed. `apps/server`'s whole-package coverage
is CI's; to read `provision.ts`'s and `setup-api.ts`'s rows locally, run
`pnpm --filter @waitron/server exec vitest run --coverage src/provision-throwaway.test.ts src/setup-throwaway.route.test.ts`
and read only those two rows (a partial run's totals are not the package's).

### R8: docs and backlog (folds in the Task 9 docs review)

- [ ] Rewrite the workflow-guide section Revision 1 added ("A Veri\*Factu venue on a development
  stack") for Revision 2, in plain English: Demo and Preparation make their own throwaway
  allocation on any box, development or shipped, and so does Live on a development box; it is
  refused on a box running `WAITRON_ENV=production` and never used for Live on any other box; how
  to recognise it (D3's markers); local scripts use `applyDevelopmentVenue`
  (`apps/server/scripts/throwaway-venue.ts`); Live on a real box needs a supplied allocation
  (A679). Remove every sentence about the dev-server signer, `dev:custodian`, `confirmation.json`
  rewrites and "a shipped box cannot be pointed at a custodian" (the review found the last an
  overclaim, and it is now moot). Apply the review's wording fixes in
  `.superpowers/sdd/2026-10-14-a680-dev-throwaway-custodian/` to whatever text survives. Say that
  an onboarding stack whose `.env` still has the three `WAITRON_FISCAL_*` lines is harmless (only
  a supplied allocation reads them).
- [ ] Backlog: delete Revision 1's entries (a) "the owner's box loader cannot set up a Veri\*Factu
  venue on a shipped box" (false under D7), (b) "a retried wizard submission … is a new setup"
  (cell 13 replays it; delete only once R5's cell-13 test passes) and (d) "a relative
  `WAITRON_STATE_DIR` means two different folders" (its code is gone), with their detail sections
  in `docs/backlog/fiscal.md`. Keep (c) (`pnpm dev:reset` deletes before refusing; unrelated). Add
  two entries: "The setup wizard has no text for `sif.throwaway_allocation_refused`, which a box
  started with `WAITRON_ENV=production` reaches from Demo or Preparation (A680 D6)", and "Demo and
  Preparation can be set up by anyone on the setup network first, as before #1700 (A680 unsure
  point 2)". Commit.

### R9: build and start the box-shaped install

Docker is available here (`docker info`: 29.3.0, Docker Desktop, 18 CPUs, 32 GB, checked
2026-10-14). Record every command and what it printed, for the PR.

- [ ] Check headroom (`memory_pressure | grep free`). Build the image from this branch, in the
  background, recording the time: `docker build -f deploy/Dockerfile -t waitron:a680 .` (this
  branch's own tag; never `waitron:dev`, which other lanes use).
- [ ] In a scratch directory OUTSIDE the repo (e.g. `~/waitron-campaign-b/a680-box/`): copy
  `deploy/compose.yml`; write `.env` with `WAITRON_IMAGE=waitron:a680` (compose reads it at
  file-read time, so it must be in `.env` beside the file, not in the override),
  `WAITRON_BOX_ADDRESSES=<the Mac's LAN address>`, `WAITRON_MANAGEMENT_RP_ID=localhost`,
  `WAITRON_MANAGEMENT_ORIGIN=https://localhost:8443`; write `compose.a680.yml` setting
  `app.network_mode: bridge`, `app.ports: ["8443:443"]`, and moving the box mailpit off the dev
  mailpit's ports — `ports: !override ["127.0.0.1:11025:1025", "127.0.0.1:18025:8025"]` (the
  reviewer measured 1025 "already allocated" by `waitron-mailpit-1`, and 11025 free). Email from
  the box is expected NOT to work in this shape; say so in the PR.
- [ ] `docker compose -p a680box -f compose.yml -f compose.a680.yml up -d app mailpit`; wait
  until `https://localhost:8443/setup-api/status` answers `provisioned:false`. Stop only this
  project, ever: `docker compose -p a680box -f compose.yml -f compose.a680.yml down -v`.
- [ ] **Fallback if the image cannot build or run here** (record why): build the shipped pieces
  and run the server bundle as the image does —
  `pnpm --filter @waitron/server build && pnpm --filter @waitron/setup build && pnpm --filter @waitron/till build && pnpm --filter @waitron/dashboard build`,
  then `node apps/server/dist/server.js` with the image's settings
  (`deploy/Dockerfile:250-262`) pointed at the build: `WAITRON_STATE_DIR=<scratch>`,
  `WAITRON_MIGRATIONS_DIR=apps/server/dist/drizzle`, `WAITRON_SETUP_APP_DIR=apps/setup/dist`,
  `WAITRON_TILL_APP_DIR=apps/till/dist`, `WAITRON_DASHBOARD_APP_DIR=apps/dashboard/dist`,
  `WAITRON_DEMO_MEDIA_SOURCE=apps/server/scripts/demo-seed/media`, `WAITRON_HTTP_PORT=<free>`,
  `NODE_ENV=production`. Record its process id and stop only that.
- [ ] Commit nothing (the scratch directory is outside the repo); report the state for R10.

### R10: Demo and the production refusal on the box-shaped install

- [ ] **Demo:** open `https://localhost:8443` in the workspace's Playwright Chromium
  (`ignoreHTTPSErrors`), walk the wizard's Demo to the end, screenshot each screen and the first
  trading screen into `~/waitron-campaign-b/a680-shots/box-demo-*`. Check `/setup-api/status` stops
  answering, the container restarts into trading, and (via `docker compose -p a680box … exec app`)
  the venue database has cell 12's facts and D3's markers in `fiscal_allocations`; the box log has
  `setup.throwaway_allocation`.
- [ ] **Production refuses:** `down -v`; add `environment: { WAITRON_ENV: production }` to `app` in
  the scratch override; `up`; walk Demo → the wizard shows its failure; the POST answered HTTP 400
  `sif.throwaway_allocation_refused`; status still `provisioned:false`. Screenshot
  `box-production-*`. Remove that line from the override afterwards.

### R11: Preparation and the owner's loader on the box-shaped install

- [ ] **Preparation:** `down -v`, `up` (a fresh box), walk Preparation with taxpayer `B12345674`,
  same checks as Demo, `box-prep-*` screenshots.
- [ ] **The owner's loader, unedited:** `down -v`, `up`, then
  `node ~/workspace/worktrees/waitron-local-santet-data/local/square/box-setup.mjs --base https://localhost:8443`
  → it prints `ready: dashboard login … works`. (Read-only use of that worktree; edit nothing
  there.)
- [ ] `down -v` at the end; `docker compose ls` shows no `a680box`.

### R12: owner note, lane E, finish

- [ ] Append to `~/waitron-campaign-b/questions.md`: (1) for lane E, D2's seam block and the rule
  "the route marks a request only when it carries no `initialOperations` and is Demo, Preparation,
  or Live on a dev box; a request with `initialOperations` is never marked"; (2) for the owner, the
  Santet change (D7) and the box steps below.
- [ ] The PR body says, plainly: what changed for a box; Revision 1's Task 7 dropped by the
  owner's ruling and what replaced it; the removed Revision 1 pieces; "Changed test checks" from
  R5; the unsure points above; R9–R11's commands and results; and **what the owner does on the
  box**, after this PR lands and `main`'s image is published:
  `sudo bash waitron.sh --reset --yes install` — `deploy/waitron.sh`'s usage (lines 32-34):
  "`waitron.sh --reset [--all] [--yes] [--force-production] install [ref]` — build or pull ref's
  images, then wipe the box as reset does and start it on them" (no ref means `main`). Then open
  `https://waitron.local` and run the wizard in Demo or Preparation, or run
  `node local/square/box-setup.mjs --base https://waitron.local` for the Santet Preparation box.
- [ ] Update the ledger, then `/finish-branch` (FULL: the Codex run-it seat twice).

---

# Revision 1 (superseded by Revision 2 above; built as commits `4aec9f84e..4dd990b93`)



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
edits `paper-evidence.ts`, `paper-custodian.ts`, `index.ts`, `setup-api.ts`, files under
`apps/setup/src/` and `paper-custodian.md`; this plan touches none of those (it edits
`apps/setup/vite.config.ts`, which lane E's branch does not). Both branches DO edit
`docs/backlog.md` and `docs/backlog/fiscal.md` (Task 9), so whichever lands second may need a
small rebase there. This plan also CALLS four functions from `paper-evidence.ts` (`enrolPaperCustodian`,
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
  the same script against the wizard's port, after a two-line edit to it (the last section of
  this plan gives the edit and the command). The alternative — a
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
  - **"accepts unset, empty, dev and preproduction":** `it.each([{}, {WAITRON_ENV: ""},
    {WAITRON_ENV: "dev"}, {WAITRON_ENV: "preproduction"}])`, each returns an allocation whose
    `environment` is `"preproduction"` (an empty value already means preproduction,
    `packages/db/src/deployment.ts:23`).
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
    its neighbour. `sign.ts` imports that registry for its side effect,
    `import "../../src/errors.js";`, as `demo-seed/seed-sales.ts:47` does (house rule: every file
    that throws a code imports its registry).
- [ ] Run the same command → GREEN. Read the `Tests` count.
- [ ] **Deletion control:** delete the `"production"` throw in `assertDevelopmentEnvironment`, run
  again, record which cases fail and with what message (expected: the two production cases,
  because signing then succeeds), restore the line, run GREEN again. Write the control's command
  and result in the task's commit message. This is only the first run of the control; Task 5
  repeats it across every production case the branch adds.
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
  - **"init refuses production when a key already exists, and changes nothing":** run `init`
    under `{ WAITRON_ENV: "dev" }`, record the bytes and modification times of `key.pem` and
    `custodian.json`, then run `init` under `{ WAITRON_ENV: "production" }` → non-zero exit,
    stderr names `deployment.development_custodian_refused`, stdout is EMPTY (no trust settings
    printed), and both files' bytes and modification times are unchanged. Without this case a
    check that sits only in `createDevelopmentKey` would pass every other test: with a key
    already present, `init` never calls it.
  - **"init accepts an empty WAITRON_ENV":** `{ WAITRON_ENV: "" }` → exit 0, three lines.
  - **"unknown subcommand prints usage":** non-zero, usage on stderr.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/cli.test.ts` → RED.
- [ ] Implement `files.ts` (`initCustodianDir(dir, env)`: call `assertDevelopmentEnvironment(env)`
  as its FIRST statement, before any file is read or written; then `mkdir -p` with mode `0o700`,
  create the key with `writeFile(..., { mode: 0o600, flag: "wx" })` only when absent, rewrite
  `custodian.json` through a temporary file and `rename`) and `cli.ts`. The CLI dispatcher also
  calls `assertDevelopmentEnvironment(env)` first, before it looks at the subcommand, so every
  subcommand present and future is refused in production. `init` takes `--dir <path>`,
  required; parse with `node:util` `parseArgs`, `strict: true`. The run-when-invoked block
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
    case 5, but with the command's output instead of a test fixture. The file's `afterEach` calls
    `vi.unstubAllEnvs()`: `apps/server/vitest.config.ts` does not set `unstubEnvs`, so a stub
    would otherwise leak into later cases.
  - **"the output keeps the rest of the body byte-for-byte":** every key but
    `initialOperations` is `toEqual` the input.
  - **"a missing full-series code signs FF":** body without `fullSeriesCode` → the signed series
    include `FF-S000001 full` (the planner's default, `packages/provisioning/src/venue-plan.ts:203`).
    Say in the test's name or one comment that the setup route itself refuses such a body
    (`asString(v.fullSeriesCode, …)`, `apps/server/src/setup-api.ts:435`), so this case serves
    callers that build the request themselves, not the wizard.
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
    Rename that test (`dev-onboard.test.ts:24`, "emits exactly the three setup keys in order, and
    NONE of the trading-only keys") to say six keys, since it then checks six.
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
  Print one line saying which custodian directory the box trusts. Cut the comment above
  `DevOnboardOptions` (`dev-onboard.ts:41`, "No `stateDir`: a setup-mode box never resolves the
  fiscal slot…"): the type now takes a `stateDir`, so the comment becomes false.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-onboard.test.ts scripts/dev-setup.test.ts`
  → GREEN.
- [ ] **Deletion control, across the whole branch.** Every production refusal the branch adds
  rests on the one check in `assertDevelopmentEnvironment`. Delete its `"production"` throw and run
  `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/sign.test.ts scripts/dev-custodian/apply.test.ts scripts/dev-custodian/cli.test.ts scripts/dev-onboard.test.ts`.
  EVERY production case in all four files must fail (list them by name in the commit message,
  with the failure each printed); a production case that still passes is testing something
  other than the check, and must be fixed before going on. Restore the line, run the same command
  GREEN. Typecheck, commit. Task 8 repeats this run once more on the finished branch.

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
    forwarded, and the handler `next()` hands over to still reads the FULL request body (assert
    its bytes). The middleware must check the directory before it reads anything, or Vite's proxy
    after it receives an empty body.
  - **forwards the original path:** with the middleware mounted under a prefix, upstream receives
    `req.originalUrl` (path and query), not the shortened `req.url`.
  - **only that route:** `GET /setup-api/status`, `POST /setup-api/fiscal-test` → `next()`.
  - **a signer refusal is visible:** `sign` throws → 500 with
    `{ error: { code: "dev_custodian.sign_failed", params: {} } }` and the signer's message
    written to the dev server's log; nothing forwarded. (This JSON is a dev-tool answer, not a
    registered product code; say so in one comment.)
  - **serve only:** the exported Vite plugin object has `apply: "serve"`. Optional, stronger: load
    the setup app's config for a build (`resolveConfig({ configFile: "apps/setup/vite.config.ts"
    }, "build")`) and assert no plugin with this plugin's name is in the resolved list.
- [ ] RED, then implement. Order inside the middleware: match method and path; check the key
  directory exists (stand aside with `next()` if not, body untouched); only then read the body.
  The default `sign` spawns
  `pnpm --silent --filter @waitron/server dev:custodian sign --dir <stateDir>/dev-custodian`
  from the repository root with the body on stdin. Forward `req.originalUrl ?? req.url` with
  `node:http`/`node:https` to `target` (from `devServerProxy()`; `rejectUnauthorized: false`
  exactly when `secure: false`, mirroring the proxy).
- [ ] **What this file may import.** Vite bundles `apps/setup/vite.config.ts` and everything it
  imports when it loads the config, and the image's `vite build` of the setup app loads that
  config too. So `setup-proxy.ts` has runtime imports of `node:` built-ins ONLY, plus type-only
  imports (`import type`). No runtime import of `files.ts`, `sign.ts`, `@waitron/*` or any other
  workspace file. Take the `Plugin` type from `vitest/config` (`import type { Plugin } from
  "vitest/config"`), not `vite`, which does not resolve from `apps/server`; checked 2026-10-14
  with a scratch file in `apps/server/scripts/` under `pnpm exec tsc --noEmit -p tsconfig.json`:
  the only error was the scratch file's deliberate control line.
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
    `target: "node24"`, `external: BUNDLE_EXTERNALS`), plus `write: false`, `metafile: true`,
    `outdir` in a temporary directory. Load `BUNDLE_EXTERNALS` with a dynamic import of a
    non-literal path and a cast — `(await import(pathToFileURL(bundleNodePath).href)) as {
    BUNDLE_EXTERNALS: readonly string[] }` — not a static `import … from
    "../../../../scripts/bundle-node.mjs"`, which the reviewer measured failing `tsc` 7.0.2 with
    TS7016 (no declaration file). No `@ts-expect-error`.
  - Read `metafile.inputs` — the full list of every file esbuild LOADED — never the per-output
    `metafile.outputs[...].inputs`. The reviewer measured that a bare
    `import "../scripts/demo-seed/allocation.js"` added to `src/demo-seed.ts` (and also a named
    import, and a re-export) appeared in `metafile.inputs` but in NO output's inputs, because
    esbuild dropped the unused code; a check on the per-output lists would pass with the import
    present.
  - **Control in the other direction:** assert `scripts/demo-seed/seed.ts` IS in that same
    `metafile.inputs` list — the scan can see a `scripts/` file when one is loaded.
  - Assert no key of `metafile.inputs` starts with `scripts/dev-custodian/` or equals
    `scripts/demo-seed/allocation.ts`.
- [ ] Run `pnpm --filter @waitron/server exec vitest run scripts/dev-custodian/not-shipped.test.ts`;
  record its duration (the 2026-10-14 single-entry CLI build took 4 s; if the test takes more than
  about 15 s, say so in the PR so the shard budget can be checked).
- [ ] **Deletion control:** add the BARE import `import "../scripts/dev-custodian/sign.js";` to
  `apps/server/src/demo-seed.ts` (the shape a per-output check misses), run → must FAIL naming
  `scripts/dev-custodian/sign.ts`; repeat with `import "../scripts/demo-seed/allocation.js";`
  → must FAIL naming that file; remove the line, run → GREEN. Record all three runs in the
  commit message.
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

The last command must print nothing. Then repeat Task 5's branch-wide deletion control once on
the finished branch (delete the `"production"` throw in `assertDevelopmentEnvironment`, run the
four files, every production case fails, restore, GREEN), in case a later task added a
production case that passes for another reason. Coverage: this branch adds no file to any coverage table
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
  this (point at A679); the retry limit; and that an onboarding stack created before this
  change keeps its old `.env` (`wa-wt`'s `ensure_env` reuses an existing one, `wa-wt:142-149`),
  so it has no key and the wizard still refuses until you run `wa-wt reset onboarding <name>`.
  Do not edit `paper-custodian.md` (lane E's branch).
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
- **`local/square/box-setup.mjs`** against a LAPTOP onboarding stack NEEDS A SCRIPT CHANGE,
  whichever route is used. Pointed unchanged at the wizard's dev server
  (`--base http://localhost:5192`), its setup POST is signed and succeeds, but its readiness poll
  (`box-setup.mjs:68`, `POST ${BASE}/management-api/session`) then goes to the Vite dev server,
  which forwards only `/setup-api` — so the script waits its full three minutes and exits 1.
  The exact edit, which keeps the real-box use unchanged when `--server` is not given:
  1. After `const BASE = arg("base", "https://waitron.local");` add
     `const SERVER = arg("server", BASE);`
  2. In the readiness loop, change `` `${BASE}/management-api/session` `` to
     `` `${SERVER}/management-api/session` ``.

  Then run it with the wizard's dev-server port as `--base` and the server as `--server`, both as
  `wa-wt ls` shows them for the instance. On slot 1:
  `node local/square/box-setup.mjs --base http://localhost:5192 --server https://localhost:8080`;
  on slot 2: `--base http://localhost:5292 --server https://localhost:8180`. (`https`, because an
  onboarding stack's first boot mints the box certificate; the script already accepts its
  self-signed certificate.) The other route — POSTing to the server directly after piping the
  body through `pnpm --silent --filter @waitron/server dev:custodian sign --dir <state dir>/dev-custodian`
  (state dir `$HOME/workspace/.waitron-dev/box` on slot 1,
  `$HOME/workspace/.waitron-dev/instances/<name>/box` on any other) — also needs an edit to the
  script, to run that command and post its output; the two-line edit above is the smaller one.
- **`box-setup.mjs` against the real box (`https://waitron.local`)**: not possible with this item
  (STOP 1).
