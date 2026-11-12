# A940 slice 4 — a release carries its version and its declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a `v1.2.3` tag publishes an image whose records say `1.2.3`, which holds that version's
declaración responsable in `/app/declaration/`, whose PDF and text are attached to a GitHub Release
named `1.2.3`, which `waitron.sh install v1.2.3` pulls, and on which a production box will start;
a production box on any other build refuses to start.

**Architecture:** the bundler stamps every server bundle with the release version (or `null`) from
a build setting; one reader in `@waitron/shared` answers it to the fiscal records and to the
server's start check. The image build renders the four declaration files once, from the committed
`v<version>.md`, with the package's new `declaration render` command; the server already serves
whatever that folder holds (slice 3). CI on a `v*` tag passes the version in, checks the result
inside the built image, and copies the files out of the published image onto the GitHub Release.

**Tech Stack:** esbuild `--define`, Docker build stages, GitHub Actions, `gh release`, bash
(`deploy/waitron.sh`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md`](../specs/2026-10-21-a940-declaracion-responsable-design.md)
§5.1, §5.3, §5.4 (the CI paragraph), §5.5, §7.1, §8 ("never changes", "production refuses"), §10
slice 4; slice 3's plan
[decision 1](2026-11-11-a940-3-in-app-declaration.md#decisions-made-in-this-plan) (the folder's four
files); slice 2's plan, departure 3 and "The seams slices 3 and 4 take"; the slice-4 duties in
`docs/backlog/fiscal.md`'s A940 entry.

## What a person can do once each pull request lands

- **After PR 1:** nothing visible. A bundle built with `WAITRON_RELEASE_VERSION=1.2.3` files
  records whose software version is `1.2.3`; `pnpm --filter @waitron/fiscal-verifactu declaration
  render --version 1.2.3 --out <dir>` writes the four files of a committed `v1.2.3.md`.
- **After PR 2:** an image built with `--build-arg WAITRON_RELEASE_VERSION=1.2.3` (and the
  producer's three settings) shows that version's declaration on every terminal and says
  "About Waitron · 1.2.3"; `node /app/server.js check-release 1.2.3` inside it says whether it is
  that release. A box set to `WAITRON_ENV=production` on a build without a release version stops on
  the recovery page: "This box is running a test build." / "Install a release." Preproduction and
  development boxes are unchanged.
- **After PR 3:** the owner can cut a release with `pnpm release prepare` and `pnpm release tag`
  (still blocked by the Q53 line until the asesor answers); CI on the tag refuses a version whose
  declaration is missing, blocked or disagrees, or a tag not on `main`, publishes
  `ghcr.io/clintongormley/waitron:1.2.3`, and creates the GitHub Release with
  `waitron-1.2.3-declaration.pdf` and `.txt`; `waitron.sh install v1.2.3` runs that image; a root
  guard fails when a released version's file changes or its tag is missing.

**Consequence the owner should know (not new — design §5.1, question 4):** from PR 2, no box can
start in production until `v1.0.0` exists, and `v1.0.0` waits for the asesor's answer to Q53. No
box has started in production yet (CLAUDE.md §5, the 2026-11-08 producer exception).

## Departures from the approved design and decisions needing the watcher's approval

1. **Three pull requests, not one** (design §10: "Each slice is one pull request"), as slices 2
   and 3 were split: the version and the render command (PR 1); the image and the production
   refusal (PR 2); CI on the tag, the install command, the guard and the docs (PR 3).
2. **The setting is `WAITRON_RELEASE_VERSION`, not `WAITRON_VERSION`** (§5.4's CI paragraph): it
   is a build setting, never a box setting, and "release" says what it marks. The bundle carries
   it; the running box's environment never sets it.
3. **The production refusal applies only to a bundled build.** Run from source (Vitest, `tsx`,
   `wa-wt`), the server has no bundle stamp and the check lets it start. Reason: about 140 start
   calls in 15 `apps/server` test files boot in production from source
   (`git grep -l 'WAITRON_ENV: "production"' -- 'apps/server/src/*.test.ts'`, counted 2026-11-12);
   each would otherwise need a stand-in release. A box runs only the image's bundles
   (`deploy/Dockerfile:231-240` copies `dist/*.js` and no source), and `scripts/bundle-node.mjs`
   gives every bundle the stamp, `null` when not a release (Task 1 pins that). The same shape
   already decides `BUILD_COMMIT` (`packages/fiscal-verifactu/src/software-identity.ts:41-52`).
4. **The refusal checks the version stamp only, not the folder.** A release build without a sound
   declaration folder cannot be made: the image build renders the folder in the same step that
   stamps the version and fails if the render fails (Task 4), and the tag's publish runs
   `check-release` inside the built image (Task 5). A start check of the folder would be a second
   refusal with wording that is false for its cause ("test build").
5. **`check-release`, a second server command** beside `check-producer`, so CI checks the release
   with the image's own code (the folder reader the routes use and the stamp the records use), not
   with a shell copy of them.
6. **The "never changes" guard's rule for a missing tag** (§8: "the guard fails, not passes, when
   a released version's tag is missing"). Nothing in a checkout says which versions were released
   except the tags, so the rule is: every `declarations/v*.md` except the highest version must have
   its tag, and every `v*` tag must have its file, unchanged. The highest may lack a tag (prepared,
   not yet tagged). A checkout without tags therefore fails as soon as a second version is
   prepared, which is when the guard first has something to protect.
7. **The tag must be on `main`.** §5.1 defines a release as a tag "on a commit of `main`"; only
   `pnpm release tag` enforced it. The publish job refuses a tag whose commit is not an ancestor of
   `origin/main`.
8. **The GitHub Release is made by its own job** (`release`), the only one given
   `contents: write`, after `publish`. It pulls the published image by its tag and copies the two
   files out of it, so the archive's PDF is the box's PDF byte for byte (§5.3). A re-run replaces
   the two files from the image the tag names then (`gh release upload --clobber`).
9. **What `releasedOn` is read from.** `release.json`'s `releasedOn` is the day in item 1.l)'s
   "Fecha" line of the committed `v<version>.md`, read back from its Spanish words
   (`3 de diciembre de 2026` → `2026-12-03`) and accepted only when `spanishDate` of the result
   gives the same words back. No new field in the committed file.

## Global Constraints

- English only outside `packages/fiscal-verifactu` (CLAUDE.md §3); the declaration's Spanish stays
  in that package. Error codes name the concept; `server.*` is for facts about the process.
- New error codes: `server.unreleased_build` (apps/server, `Record<string, never>`),
  `declaration.date_unreadable` (fiscal-verifactu, `{ line: string }`). Each throwing file imports
  its registry; `scripts/errors-reachable.test.ts` must pass.
- The recovery page's title and action are fixed strings chosen by the code (CLAUDE.md §3):
  `server.unreleased_build` → EN title "This box is running a test build.", action "Install a
  release."; ES title «Este equipo ejecuta una versión de prueba.», action «Instala una versión
  publicada.» No word suggests removing anything.
- The release version's form: `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$` (the package command's
  `VERSION`, `src/declaration/command.ts`). Anything else refuses the bundle build.
- The four files and their names are slice 3's decision 1: `declaration.html` (exactly
  `renderDeclaration(source, producer).html`), `declaration.pdf`, `declaration.txt`, and
  `release.json` = `{"version":"1.2.3","releasedOn":"2026-12-03"}` plus a newline, all from one
  source. The GitHub Release's files are `waitron-<version>-declaration.pdf` and `.txt` (§7.1).
- Every workflow job carries `timeout-minutes`; every `actions/checkout` keeps the bounded
  two-attempt shape; every apt-get/curl rule of CLAUDE.md §2 applies to any new step.
- Producer values are secrets in CI: never printed; compared and counted only.
- Every commit `git commit -s`; no `--no-verify`. Coverage `98/98/98/95` in every package touched.

## Review Focus

1. **A tag pushed by hand on a commit whose declaration still has a blocker** → the publish fails
   before anything is pushed to GHCR (Task 4's render refuses; Task 5's ordering keeps the build
   before the push).
2. **A tag like `v1.2.3-rc1` or `v01.2.3`** → refused before publishing (bundle refuses the form;
   Task 1 case), never published as `:1.2.3-rc1`.
3. **A re-run of a tag's workflow after the Release exists** → the Release's two files are
   replaced from the image the tag names, no duplicate Release, no failure (Task 6 case).
4. **`waitron.sh install v1.2` or `install some-branch`** → unchanged: built from source as
   today; only a full `vX.Y.Z` pulls (Task 7 cases).
5. **A checkout with no tags at all, one prepared version** → the guard passes; **two prepared
   versions, the lower untagged** → it fails naming the missing tag (Task 8 cases).

---

## Pull request 1 — the version in the bundle, and the render command

Branch `feat/a940-4-release-version`. Path: FULL (design §10; the records' version field).

### Task 1: The bundle carries the release version, and the records file it

**Files:**
- Create: `packages/shared/src/built-release.ts`, `packages/shared/src/built-release.test.ts`
- Modify: `packages/shared/src/index.ts` (export), `scripts/bundle-node.mjs` (define),
  `scripts/bundle-node.test.mjs`,
  `packages/fiscal-verifactu/src/software-identity.ts:54-56` (`softwareVersion`),
  `packages/fiscal-verifactu/src/software-identity.test.ts`,
  `packages/fiscal-verifactu/src/declaration/agree.e2e.test.ts` (header comment and one case)

**Interfaces:**
- Produces: `type BuiltRelease = { bundled: false } | { bundled: true; version: string | null }`;
  `builtRelease(): BuiltRelease` reading the global `__WAITRON_RELEASE__` (undefined → not bundled;
  `null` → bundled, no release; `{ version }` with a valid version → that version; any other shape →
  bundled, no release).
- Produces: `releaseDefine(env: Record<string, string | undefined>): string` in `bundle-node.mjs`,
  answering the JSON literal (`null` or `{"version":"1.2.3"}`) from `env.WAITRON_RELEASE_VERSION`
  (unset or `""` → `null`, per `isUnset`'s rule), throwing `Not a release version: <value>` for a
  malformed one; `bundle()` takes `releaseVersion` and always adds
  `--define:__WAITRON_RELEASE__=__waitronRelease` with the frozen literal in the banner, as the hour
  stamp is added.
- Produces: `softwareVersion(commit = BUILD_COMMIT, release = builtRelease())`: a release's version
  when `release.bundled && release.version !== null`, otherwise today's `0.0.0-dev[+commit]`.

- [ ] **Step 1: Failing tests.** `built-release.test.ts`: with `__WAITRON_RELEASE__` undefined →
  `{ bundled: false }`; `null` → `{ bundled: true, version: null }`; `{ version: "1.2.3" }` →
  version `"1.2.3"`; `{ version: "1.2" }` and `"1.2.3"` (a string) → version `null` (use
  `vi.stubGlobal`). Bundler test: `releaseDefine({})` and `({ WAITRON_RELEASE_VERSION: "" })` →
  `"null"`; `"1.2.3"` → `'{"version":"1.2.3"}'`; `"1.2.3-rc1"`, `"v1.2.3"`, `"01.2.3"` throw; the
  esbuild arguments `bundle()` passes contain `--define:__WAITRON_RELEASE__=__waitronRelease` both
  with and without a version (the stub `run` records them). `software-identity.test.ts`:
  `softwareVersion(null, { bundled: true, version: "1.2.3" })` → `"1.2.3"`; with a commit and a
  version → `"1.2.3"`; `{ bundled: true, version: null }` with a commit → `0.0.0-dev+<commit>`.
  Agree guard: a second case that mocks `builtRelease` to `1.2.3` and checks the recorded sale's
  `Version` equals the declaration's item 1.c) prepared for `1.2.3`; rewrite the header comment's
  1.c) sentence to say what it now checks.
- [ ] **Step 2: Run them; each fails for the missing function or define.**
  `pnpm --filter @waitron/shared exec vitest run src/built-release.test.ts`,
  `pnpm exec vitest run scripts/bundle-node.test.mjs`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/software-identity.test.ts src/declaration/agree.e2e.test.ts`.
- [ ] **Step 3: Implement** as the Interfaces say; the CLI block passes
  `releaseDefine(process.env)`'s answer.
- [ ] **Step 4: Run the same commands, all pass; then the golden huella and immutability gates,
  unedited:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts inmutabilidad`.
  Deletion control: make `softwareVersion` ignore the release; the agree case fails. Record it.
- [ ] **Step 5: Measure the bundle.** `WAITRON_RELEASE_VERSION=1.2.3 pnpm --filter @waitron/server build`
  then `grep -c '__waitronRelease = Object.freeze({"version":"1.2.3"})' apps/server/dist/server.js`
  prints 1; unset, the same grep for `Object.freeze(null)` prints 1. (A failing case would print 0.)
- [ ] **Step 6: Commit** (`git commit -s`).

### Task 2: `declaration render` writes the four files

**Files:**
- Modify: `packages/fiscal-verifactu/src/declaration/source.ts` (add `declarationDate`),
  `source.test.ts`, `command.ts` (`render` subcommand), `command.test.ts`,
  `packages/fiscal-verifactu/src/errors.ts` (`declaration.date_unreadable`)
- Create: `packages/fiscal-verifactu/src/declaration/folder.ts`, `folder.test.ts`
- Modify: `apps/server/src/testing/declaration-folder.ts` (call `writeReleaseFolder`, then overwrite
  `release.json` only when its caller passes a release unlike the rendered one)

**Interfaces:**
- Produces: `declarationDate(source: string): string` — the `YYYY-MM-DD` of item 1.l)'s "Fecha"
  line; throws `declaration.date_unreadable { line }` when the words are not a date `spanishDate`
  writes back identically.
- Produces: `writeReleaseFolder(dir: string, source: string, producer: DeclarationProducer): Promise<{ version: string; releasedOn: string }>`
  in `folder.ts`: refuses blockers (`declaration.release_blocked`), takes `version` from item 1.c),
  writes the four files of the Global Constraints (creating `dir`), answers what it wrote to
  `release.json`.
- Produces: `declaration render --version <v> --out <dir>`: reads `declarations/v<v>.md`, runs the
  same agreement check as `check` (refactor `check`'s comparison into one function both call), takes
  the producer as `show` does (refusing in production terms when unset), calls `writeReleaseFolder`,
  prints `wrote <dir>`. Missing file → the read's error, exit non-zero.

- [ ] **Step 1: Failing tests.** `source.test.ts`: a source prepared with date `2026-12-03` →
  `declarationDate` answers `"2026-12-03"`; `2026-03-01` (`1 de marzo de 2026`) → `"2026-03-01"`;
  a source whose line reads `31 de febrero de 2026` and one with `‹fecha›` unfilled → throw
  `declaration.date_unreadable`. `folder.test.ts` (the test pins slice 3's decision 1): for
  `declarationSourceFor("1.2.3")` prepared on `2026-12-03`, the folder holds exactly the four
  names; `release.json` parses to `{ version: "1.2.3", releasedOn: "2026-12-03" }` and ends in a
  newline; `declaration.html` equals `renderDeclaration(source, producer).html`;
  `declaration.txt` equals `.text` and has one `1.c) ` line ending `: 1.2.3`; the PDF starts
  `%PDF-`; a source with a blocker writes nothing (the directory is absent afterwards).
  `command.test.ts`: `render --version 1.2.3 --out <tmp>` exits 0 and the server's
  `readDeclarationFolder(<tmp>)` answers `kind: "release"` with version `1.2.3` (import it from
  `apps/server`? No — the package may not; assert the four files instead, and leave the reader's
  acceptance to the server test below); a missing `v9.9.9.md` exits non-zero; producer unset exits 1
  with `sif.producer_unset`; a disagreeing 1.a) exits 1 with `declaration.disagrees`.
  `apps/server/src/declaration-pages.test.ts` keeps passing unchanged through the rewritten helper,
  which is the reader's acceptance of the render's output.
- [ ] **Step 2: Run; each fails.**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration`.
- [ ] **Step 3: Implement.** Month words come from the same `Intl.DateTimeFormat("es-ES")` the
  writer uses, for months 1–12, never a typed list.
- [ ] **Step 4: Run** the package's `src/declaration` tests and
  `pnpm --filter @waitron/server exec vitest run src/declaration-pages.test.ts`; then
  `pnpm --filter @waitron/fiscal-verifactu test:coverage` holds 98/98/98/95. Deletion control:
  make `writeReleaseFolder` take `releasedOn` from today's date; the folder case fails.
- [ ] **Step 5: Commit.** Then `/finish-branch` for PR 1.

## Pull request 2 — the declaration in the image, and production refuses a test build

Branch `feat/a940-4-release-image`. Path: FULL (the box's start path).

### Task 3: Production refuses an unreleased build

**Files:**
- Create: `apps/server/src/release-check.ts`, `apps/server/src/release-check.test.ts`
- Modify: `apps/server/src/errors.ts` (`server.unreleased_build`), `apps/server/src/boot.ts`
  (`StartServerSeams.builtRelease?: BuiltRelease`; call right after `loadConfig` at `:1107`),
  `apps/server/src/i18n/recovery-page.ts` (the entry), `apps/server/src/recovery-surface.test.ts`
  (one case), `apps/server/src/boot.test.ts` (two cases)

**Interfaces:**
- Consumes: `builtRelease()` (Task 1).
- Produces: `refuseUnreleasedBuild(environment: DeploymentEnvironment, release: BuiltRelease): void`
  — throws `AppError("server.unreleased_build", {})` only when `environment === "production"`,
  `release.bundled` and `release.version === null`.

- [ ] **Step 1: Failing tests.** `release-check.test.ts`: production + bundled + `null` throws the
  code; production + bundled + `"1.2.3"` passes; production + not bundled passes; preproduction and
  `dev` + bundled + `null` pass. `boot.test.ts`: an existing production start case copied once with
  `seams.builtRelease = { bundled: true, version: null }` rejects with `server.unreleased_build`
  before opening the venue (no `venue.db` created in its fresh state dir); the same case with
  `version: "1.2.3"` starts (the case that must still start). `recovery-surface.test.ts`: a recovery
  state with `lastErrorCode: "server.unreleased_build"` renders the EN and ES title and action of the
  Global Constraints.
- [ ] **Step 2: Run; each fails.**
  `pnpm --filter @waitron/server exec vitest run src/release-check.test.ts src/recovery-surface.test.ts`
  and `-t "unreleased"` on `src/boot.test.ts`.
- [ ] **Step 3: Implement.** The failure reaches the recovery page by the path
  `server.config_missing` already takes from `bootServer` (`node-entry.test.ts:1097-1112` shows it).
- [ ] **Step 4: Run** the three files whole, `scripts/errors-reachable.test.ts` and the
  recovery-surface never-delete cases. Deletion controls: remove the `bundled` test → the
  not-bundled case fails; remove the call in `bootServer` → the boot refusal case fails.
- [ ] **Step 5: Commit.**

### Task 4: The image renders the folder; `check-release`; image-smoke reads it

**Files:**
- Modify: `deploy/Dockerfile` (build stage: `ARG WAITRON_RELEASE_VERSION`, the producer's three
  `ARG`s; after the app builds, render; runtime stage: copy), `apps/server/src/server-command.ts`,
  `apps/server/src/bin.commands.test.ts`, `.github/workflows/image-smoke.yml` (two checks after
  "The image serves the Spanish Products guide"), `scripts/deploy-image-env.test.ts` (pins), and
  `apps/server/README.md` (beside `check-producer` at `:921`)
- Create: `apps/server/src/release-command.ts`, `release-command.test.ts`

**Interfaces:**
- Consumes: `builtRelease()`, `readDeclarationFolder(declarationRoot())`
  (`apps/server/src/declaration-pages.ts:92`).
- Produces: `checkRelease(version: string, release: BuiltRelease, folder: DeclarationFolder, out: CheckOutput): 0 | 1`
  — 0 only when `release.bundled`, `release.version === version`, `folder.kind === "release"` and
  `folder.version === version`; each failure prints one line naming which (`bundle version <v|none>`,
  `declaration folder none|damaged <file>|version <v>`), never a producer value.
  `runServerCommand` accepts `check-release <version>`; usage line becomes
  `usage: waitron-server [check-producer | check-release <version>]`.

- [ ] **Step 1: Failing tests.** `release-command.test.ts`: the passing case and one case per
  failure line, using `writeDeclarationFolder` for real folders. `bin.commands.test.ts`: the USAGE
  pin gains the new form (a whole-shape pin gaining a key: allowed, named in the PR);
  `check-release 1.2.3` from source exits 1 with `bundle version none` (not bundled).
  `deploy-image-env.test.ts`: the Dockerfile's build stage declares `WAITRON_RELEASE_VERSION` and the
  three producer `ARG`s; the render runs only when the version is non-empty; the runtime stage copies
  the folder to `/app/declaration/` from a parent that holds it only on a release (below).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement.** Dockerfile: the build stage writes into `/release-root/`, creating
  `/release-root/declaration/` only when `WAITRON_RELEASE_VERSION` is non-empty, by
  `pnpm --filter @waitron/fiscal-verifactu declaration render --version "$WAITRON_RELEASE_VERSION" --out /release-root/declaration`
  (the producer `ARG`s are in its environment; it fails the build on any refusal); the runtime stage
  `COPY --from=build --chown=waitron:waitron /release-root/ /app/`, so a test build has no
  `/app/declaration/` at all (slice 3's "none", not "damaged"). The bundles must be built with the
  same `WAITRON_RELEASE_VERSION` in their environment (an `ARG` is in every later `RUN`'s
  environment; declare it before the build `RUN`). image-smoke (a test build): `/legal/declaration`
  answers 404 and `/legal/about` answers JSON with `"release":null`; and
  `docker run … node /app/server.js check-release 0.0.0` exits 1 printing `bundle version none`.
- [ ] **Step 4: Measure the release path locally, once.** Build the image with
  `--build-arg WAITRON_RELEASE_VERSION=1.2.3`, the three `TEST_PRODUCER` values, on a scratch branch
  that adds a `declarations/v1.2.3.md` written by `declaration write` with the blocker lines removed
  from a scratch copy of the template (never committed); then `docker run` it with
  `check-release 1.2.3` → exit 0, and serve it and fetch `/legal/about` → `"version":"1.2.3"`. The
  failing case it must also show: the same build with `v1.2.3.md` absent fails at the render step.
  Record both in the PR. If the Mac's Docker cannot build the image, say so and leave the release
  path to Task 5's first tag, stating that it is unmeasured.
- [ ] **Step 5: Run** `pnpm exec vitest run scripts/deploy-image-env.test.ts scripts/ci-workflow.test.mjs`,
  the server files above; commit. Then `/finish-branch` for PR 2.

## Pull request 3 — CI on the tag, the install command, the guard, the docs

Branch `feat/a940-4-release-publish`. Path: FULL.

### Task 5: The publish job on a tag

**Files:**
- Modify: `.github/workflows/ci.yml` (`publish`, `:4315-4600`), `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Failing guard cases** in `scripts/ci-workflow.test.mjs`: the "Work out the tags"
  step outputs `release_version` (the tag without `v`, empty on `main`); both app-image builds pass
  `WAITRON_RELEASE_VERSION=${{ steps.tags.outputs.release_version }}`; the print-agent build does
  not; a step "Refuse a release tag that is not on main", which runs only for `refs/tags/v*`, fetches
  `main` (bounded, as the checkout steps are) and runs `git merge-base --is-ancestor "$GITHUB_SHA"
  origin/main`, comes before the first build; a step "Check the release inside the built image",
  only for tags, runs `timeout 120 docker run --rm --pull never --network none --entrypoint node
  "$CHECK_IMAGE" /app/server.js check-release "$RELEASE_VERSION"` after the build for checking and
  before "Publish to GHCR".
- [ ] **Step 2: Run; they fail.** `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
- [ ] **Step 3: Implement.** `release_version` is set in the existing `refs/tags/v*` branch of the
  case statement; a tag whose rest is not `X.Y.Z` is refused there (`exit 1`, naming it), before the
  build that would also refuse it.
- [ ] **Step 4: Run; pass.** Deletion control: drop the ancestor step → its case fails.
- [ ] **Step 5: Commit.**

### Task 6: The GitHub Release job

**Files:**
- Modify: `.github/workflows/ci.yml` (new job `release`), `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Failing guard cases:** a job `release` with `needs: [publish]`, `if:` a `v*` tag and
  `needs.publish.result == 'success'`, `timeout-minutes` set, `permissions: { contents: write,
  packages: read }` and no other job granted `contents: write`; it logs in to GHCR, pulls
  `ghcr.io/<owner lowercased>/waitron:<version>` (bounded, two attempts), `docker create`s it, copies
  `/app/declaration/declaration.pdf` and `.txt` out as `waitron-<version>-declaration.pdf` and `.txt`,
  then `gh release view v<version>` → absent: `gh release create v<version> --title <version>
  --verify-tag <both files>`; present: `gh release upload v<version> --clobber <both files>`.
- [ ] **Step 2–4:** run, implement, run; the step's script is written so a test can run it under a
  stand-in `gh` and `docker` (put it in `scripts/release/github-release.sh`, tested by
  `scripts/release/github-release.test.mjs`: absent → `create` with both files; present →
  `upload --clobber`; a `docker cp` failure → exit non-zero and no `gh` call).
- [ ] **Step 5: Commit.**

### Task 7: `waitron.sh install v1.2.3` pulls the published image

**Files:**
- Modify: `deploy/waitron.sh` (`select_image`, `:404-448`), `scripts/waitron-sh.test.mjs`

- [ ] **Step 1: Failing cases** (stubbed `docker`, as the file's other install cases):
  `install v1.2.3` sets `.env`'s `WAITRON_IMAGE=ghcr.io/clintongormley/waitron:1.2.3` and
  `WAITRON_PRINT_AGENT_IMAGE=ghcr.io/clintongormley/waitron-print-agent:1.2.3`, runs `docker compose
  pull`, and runs no `docker build` and no GitHub API read; `install v1.2` and `install
  feat/x` still build from source as today; `install main` unchanged.
- [ ] **Step 2–4:** run (fail), implement (a `vX.Y.Z` branch between `main` and the build branch;
  the pull's failure message names the release and suggests checking that it was published), run.
- [ ] **Step 5: Commit.**

### Task 8: The "never changes" guard

**Files:**
- Create: `scripts/released-declarations.test.ts` (root project), and its logic in
  `scripts/released-declarations.mjs`
- Modify: `.github/workflows/ci.yml` (`root-guards`' two checkout attempts: `fetch-tags: true`),
  `scripts/ci-workflow.test.mjs` (pin it)

**Interfaces:**
- Produces: `releasedDeclarationProblems(repo: string): string[]` — each problem one line: a `v*`
  tag (form `vX.Y.Z`) whose `declarations/v<v>.md` is absent at `HEAD` or differs from
  `git show v<v>:packages/fiscal-verifactu/declarations/v<v>.md`; a `v<v>.md` below the highest
  version with no tag `v<v>`. Git runs with `GIT_*` cleared.

- [ ] **Step 1: Failing tests** in a scratch repository per case (`mktemp -d`, `git init`): no
  files, no tags → `[]`; one file, no tag → `[]`; `v1.0.0` and `v1.0.1` files, no tags → one problem
  naming `v1.0.0`; tag `v1.0.0` and its file unchanged → `[]`; the file edited after the tag → one
  problem; the file deleted after the tag → one problem; a tag `pre-sqlite-migration` → ignored. One
  case runs against the real repository and expects `[]`. Run the file once with `GIT_DIR` set to
  another repository; it still reads the scratch one.
- [ ] **Step 2–4:** run (fail), implement, run. **Measure the CI checkout before relying on it:** in
  a scratch bare repository with a tagged commit behind its tip, run the fetch `actions/checkout`
  runs with `fetch-depth: 1` and `fetch-tags: true` (read the action's log on this PR's own run for
  the exact command) and check `git show v1.0.0:<file>` answers. The failing case it must also show:
  the same fetch without the tags answers "unknown revision". Record both.
- [ ] **Step 5: Commit.**

### Task 9: Delete the slice-4 blocker; the runbook, the backlog, CLAUDE.md

**Files:**
- Modify: `packages/fiscal-verifactu/declarations/template.md` (delete line 2),
  `src/declaration/source.test.ts:94-97` and `command.test.ts:73-76` (two blockers → one; the spec
  makes the change — design §10 slice 4, slice 2's departure 3; named in the PR's "Changed test
  checks"), `scripts/release/waitron-release.test.mjs` if it counts them, `docs/operations/release.md`
  (the two-blocker paragraph becomes one; "Never push a `v*` tag by hand" now says CI refuses it; a
  section on what the tag's run does and how to check the Release; `waitron.sh install v<version>`),
  `docs/backlog/fiscal.md` (A940: slice 4 landed; slices 5 and 6 remain), the design's dated pointer
  for departures 2–9, `CLAUDE.md` §5 (one line: a production start on a build that is not a release
  refuses `server.unreleased_build`; guard `apps/server/src/release-check.test.ts`, weaker than the
  rule: it never runs a bundle — image-smoke's `check-release` step does)

- [ ] **Step 1:** edit; run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declaration`
  and `pnpm exec vitest run scripts/release scripts/claude-md-pointers.test.ts`; all pass.
- [ ] **Step 2:** `pnpm release prepare 9.9.9 --place Test` on a scratch branch, with the producer
  settings set, still refuses with `declaration.release_blocked {"count":1}` (Q53's line). Record it.
- [ ] **Step 3: Commit.** Then `/finish-branch` for PR 3.

## Root guards and sweeps

PR 1: `scripts/errors-reachable.test.ts`, `scripts/english-only.test.ts`, the fiscal gates
(golden huella, `inmutabilidad`) unedited. PR 2: `scripts/deploy-image-env.test.ts`,
`scripts/errors-reachable.test.ts`, `scripts/module-seams.test.ts` (`apps/server` still imports no
`@waitron/fiscal-verifactu` outside `src/testing/`), the recovery-surface never-delete cases.
PR 3: `scripts/ci-workflow.test.mjs`, `scripts/waitron-sh.test.mjs`, `scripts/claude-md-pointers.test.ts`.

## Size, per task (estimates, production + tests)

| Task | Production | Tests |
| --- | --- | --- |
| 1 version stamp | 45 | 90 |
| 2 render command | 90 | 130 |
| 3 production refusal | 35 | 80 |
| 4 image + check-release + smoke | 70 | 90 |
| 5 publish on a tag | 40 | 50 |
| 6 GitHub Release job | 55 | 70 |
| 7 install a release | 20 | 50 |
| 8 never-changes guard | 50 | 90 |
| 9 blocker, docs | 10 + docs | 4 changed |
