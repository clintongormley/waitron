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
   `wa-wt`), the server has no bundle stamp and the check lets it start. Reason: 26 server test
   files name a production environment, and 15 of them make 135 start calls
   (`git grep -l 'WAITRON_ENV: "production"\|WAITRON_ENV=production' -- 'apps/server/src/*.test.ts' 'apps/server/test'`,
   then `grep -c 'startServer\b\|startServerOrFirstSetupResolution'` over those files, 2026-11-12);
   each would otherwise need a stand-in release. A box runs only the image's bundles
   (`deploy/Dockerfile:231-240` copies `dist/*.js` and no source), and every image bundle is built
   by `scripts/bundle-node.mjs`'s command line (`apps/server/package.json:16`), which always passes
   a release value, `null` when not a release (Task 1 pins that). `bundle()` called directly by test
   support (`apps/server/src/testing/built-server.ts:35`, `zone-process-matrix.ts:87`) gives no
   value, so those bundles carry no stamp and count as source runs (`testing/certificate-diagnosis-snapshot.ts:67`
   runs the command line instead, so its bundle is stamped `null`; it bundles the diagnosis entry,
   not a server start, which Task 3 Step 4 confirms by running its users), as the hour stamp already works (`scripts/bundle-node.mjs:42`). The same shape
   decides `BUILD_COMMIT` (`packages/fiscal-verifactu/src/software-identity.ts:41-52`).
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
   not yet tagged). **Watcher, 2026-11-12 17:59, against design §8:** the guard also fails when
   the checkout holds no tags at all and any `declarations/v*.md` exists, because a tagless
   checkout cannot tell a prepared version from a released one. The repository's own checkout is
   never tagless: `git ls-remote --tags origin` lists `refs/tags/pre-sqlite-migration`
   (2026-11-12), which `root-guards` fetches once Task 8 sets `fetch-tags: true`.
7. **The tag must be on `main`.** §5.1 defines a release as a tag "on a commit of `main`"; only
   `pnpm release tag` enforced it. The publish job refuses a tag whose commit is not an ancestor of
   `origin/main`.
8. **The GitHub Release is made by its own job** (`release`), the only one given
   `contents: write`, after `publish`. It pulls the published image by its tag and copies the two
   files out of it, so the archive's PDF is the box's PDF byte for byte (§5.3). A re-run replaces
   the two files from the image the tag names then (`gh release upload --clobber`). **Watcher,
   2026-11-12 17:59:** the publish step refuses when `:X.Y.Z` already exists on the registry, so a
   re-run never replaces a published image (Task 5's case). Re-running the whole workflow therefore
   stops at Publish; re-running only the failed `release` job (`gh run rerun <run> --failed`)
   redoes the Release upload.
9. **What `releasedOn` is read from.** `release.json`'s `releasedOn` is the day in item 1.l)'s
   "Fecha" line of the committed `v<version>.md`, read back from its Spanish words
   (`3 de diciembre de 2026` → `2026-12-03`) and accepted only when `spanishDate` of the result
   gives the same words back. No new field in the committed file.
10. **A release build given no producer fails, rather than rendering nothing** (§5.3: "a build
    given none renders no declaration (its production start refuses anyway)"). With a release
    version set, the render runs and refuses without the producer's settings, failing the build: an
    image stamped `1.2.3` without its declaration would be a release that breaks §5.1's promise.
    A build with no release version renders nothing, as §5.3 says.
11. **The render has its own build stage** (`FROM build AS declaration`). Measured by the plan
    review with a throwaway two-target Dockerfile: a build setting declared in the shared build
    stage and passed to one target but not the other made the second re-run that stage. With the
    render in its own stage, both targets get the same settings and the print-agent build reuses the
    cache on a tag.

## Global Constraints

- English only outside `packages/fiscal-verifactu` (CLAUDE.md §3); the declaration's Spanish stays
  in that package. Error codes name the concept; `server.*` is for facts about the process.
- New error codes: `server.unreleased_build` (apps/server, `Record<string, never>`),
  `declaration.date_unreadable` (fiscal-verifactu, `{ line: string }`), `declaration.folder_exists`
  (fiscal-verifactu, `{ folder: string }`). Each throwing file imports
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
3. **A re-run of only the `release` job after the Release exists** → the Release's two files are
   replaced from the image the tag names, no duplicate Release (Task 6 case); **a re-run of the
   whole workflow** → Publish refuses the existing `:X.Y.Z` and pushes nothing (Task 5 case).
4. **`waitron.sh install v1.2` or `install some-branch`** → unchanged: built from source as
   today; only a full `vX.Y.Z` pulls (Task 7 cases).
5. **A checkout with no tags at all and any prepared version** → the guard fails (departure 6);
   **one prepared version and some other tag** → it passes; **two prepared versions, the lower
   untagged** → it fails naming the missing tag (Task 8 cases).

---

## Pull request 1 — the version in the bundle, and the render command

Branch `feat/a940-4-release-version`. Path: FULL (design §10; the records' version field).

### Task 1: The bundle carries the release version, and the records file it

**Files:**
- Create: `packages/shared/src/built-release.ts`, `packages/shared/src/built-release.test.ts`
- Modify: `packages/shared/src/index.ts` (export), `scripts/bundle-node.mjs` (define),
  `scripts/bundle-node.test.mjs`,
  `packages/fiscal-verifactu/src/software-identity.ts` (`softwareVersion`),
  `packages/fiscal-verifactu/src/software-identity.test.ts`,
  `packages/fiscal-verifactu/src/declaration/agree.e2e.test.ts` (header comment and one case)

**Interfaces:**
- Produces: `isReleaseVersion(value: string): boolean` in `packages/shared/src/built-release.ts`:
  plain `major.minor.patch` with no leading zeros, at most 50 characters (the record's
  `SistemaInformatico.Version` bound, `@waitron/verifactu` 0.2.1 `dist/validate.js:459`). The
  declaration command's `--version` uses it; `bundle-node.mjs` keeps a copy, held to the same
  answers by a case in `bundle-node.test.mjs`.
- Produces: `type BuiltRelease = { bundled: false } | { bundled: true; version: string | null }`;
  `builtRelease(): BuiltRelease` reading the global `__WAITRON_RELEASE_VERSION__` (undefined → not
  bundled; `null` → bundled, no release; `{ version }` with a valid version → that version; any
  other shape → bundled, no release).
- Produces: `releaseDefine(env: Record<string, string | undefined>): string` in `bundle-node.mjs`,
  answering the JSON literal (`null` or `{"version":"1.2.3"}`) from `env.WAITRON_RELEASE_VERSION`
  (unset or `""` → `null`, per `isUnset`'s rule), throwing `Not a release version: <value>` for a
  malformed one; `bundle()` takes `releaseVersion` and, when it is given (`null` included), adds
  `--define:__WAITRON_RELEASE_VERSION__=__waitronReleaseVersion` with the frozen literal in the
  banner, as the hour stamp is added (`bundle()` in `bundle-node.mjs`); the command-line block always gives
  it, so every image bundle is stamped and a test's direct `bundle()` call is not (departure 3).
- Produces: `softwareVersion(commit = BUILD_COMMIT, release = BUILD_RELEASE)`, where
  `BUILD_RELEASE = builtRelease()` is read once when the module loads, as `BUILD_COMMIT` is: a
  release's version when `release.bundled && release.version !== null`, otherwise today's
  `0.0.0-dev[+commit]`.

- [ ] **Step 1: Failing tests.** `built-release.test.ts`: with `__WAITRON_RELEASE_VERSION__`
  undefined →
  `{ bundled: false }`; `null` → `{ bundled: true, version: null }`; `{ version: "1.2.3" }` →
  version `"1.2.3"`; `{ version: "1.2" }` and `"1.2.3"` (a string) → version `null` (use
  `vi.stubGlobal`). Bundler test: `releaseDefine({})` and `({ WAITRON_RELEASE_VERSION: "" })` →
  `"null"`; `"1.2.3"` → `'{"version":"1.2.3"}'`; `"1.2.3-rc1"`, `"v1.2.3"`, `"01.2.3"` throw; the
  esbuild arguments `bundle()` passes contain
  `--define:__WAITRON_RELEASE_VERSION__=__waitronReleaseVersion` when given `releaseVersion`
  `null` and `"1.2.3"`, and not when given none (the stub `run` records them);
  the command-line block passes `releaseDefine(process.env)` (a case that runs the script with the
  stub, as the file's other CLI cases do). `software-identity.test.ts`:
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
  then `grep -c '__waitronReleaseVersion = Object.freeze({"version":"1.2.3"})' apps/server/dist/server.js`
  prints 1; unset, the same grep for `Object.freeze(null)` prints 1. (A failing case would print 0.)
- [ ] **Step 6: Commit** (`git commit -s`).

**As built (PR 1):** the command-line block passes the raw setting as `releaseVersion` and
`bundle()` checks it through `releaseDefine`, rather than passing `releaseDefine(process.env)`'s
answer; the agree case stubs the bundle stamp and loads the record's modules afresh, rather than
mocking `builtRelease`.

### Task 2: `declaration render` writes the four files

**Files:**
- Modify: `packages/fiscal-verifactu/src/declaration/source.ts` (add `declarationDate`),
  `source.test.ts`, `command.ts` (`render` subcommand), `command.test.ts`,
  `packages/fiscal-verifactu/src/errors.ts` (`declaration.date_unreadable`)
- Create: `packages/fiscal-verifactu/src/declaration/folder.ts`, `folder.test.ts`
- Modify: `packages/fiscal-verifactu/test/declaration.ts` (`declarationSourceFor(version, { date?, releasable? })`:
  `date` defaults to today's value there; `releasable: true` drops the `release-blocker` lines, which
  the real template keeps for Q53 even after Task 9), `apps/server/src/testing/declaration-folder.ts`
  (render with `releasable: true` and the `releasedOn` it is given, call `writeReleaseFolder`, then
  overwrite `release.json` only when its caller passes a release unlike the rendered one; its five
  callers keep passing unchanged). The blocker refusal stays in `writeReleaseFolder`.

**Interfaces:**
- Produces: `declarationDate(source: string): string` — the `YYYY-MM-DD` of item 1.l)'s first
  bullet, whose words wrap so the date sits on the template's next line (`template.md:78-79`, "…
  suscribe esta declaración / responsable del mismo: ‹fecha›."): read the bullet joined into one
  line and take the text after its last `: ` (the whole bullet when it has none) up to the final
  `.`; throws
  `declaration.date_unreadable { line }` (`line` = that text) when the words are not a date
  `spanishDate` writes back identically.
- Produces: `writeReleaseFolder(dir: string, source: string, producer: DeclarationProducer): Promise<{ version: string; releasedOn: string }>`
  in `folder.ts`: refuses blockers (`declaration.release_blocked`), takes `version` from item 1.c),
  writes the four files of the Global Constraints into a new folder beside `dir` and moves it to
  `dir` in one rename, so a failed write leaves `dir` as it was; refuses a `dir` that already holds
  files (`declaration.folder_exists`); answers what it wrote to `release.json`.
- Produces: `declaration render --version <v> --out <dir>`: reads `declarations/v<v>.md`, runs the
  same agreement check as `check` (refactor `check`'s comparison into one function both call), takes
  the producer as `show` does (refusing in production terms when unset), calls `writeReleaseFolder`,
  prints `wrote <dir>`. A relative `--out` is refused (`declaration.argument_invalid`): under
  `pnpm --filter` it would be read from the package's folder. Missing file → the read's error, exit
  non-zero.

- [ ] **Step 1: Failing tests.** `source.test.ts`: a source prepared with date `2026-12-03` →
  `declarationDate` answers `"2026-12-03"`; `2026-03-01` (`1 de marzo de 2026`) → `"2026-03-01"`;
  a source whose line reads `31 de febrero de 2026` and one with `‹fecha›` unfilled → throw
  `declaration.date_unreadable`. `folder.test.ts` (the test pins slice 3's decision 1): for
  `declarationSourceFor("1.2.3", { date: "2026-12-03", releasable: true })`, the folder holds exactly the four
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
  (one case), `apps/server/src/boot.test.ts` (two cases), `apps/server/src/testing/built-server.ts`
  (`useBuiltServer` takes an optional release version, passed to `bundle()` as `releaseVersion`, and
  an optional declaration folder written beside the bundle), and one built-server case (below)

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
  Global Constraints. A built-server case (beside the existing `useBuiltServer` users): a bundle
  stamped `null` started with `WAITRON_ENV: "production"` and a fresh state folder fails its start
  with `server.unreleased_build` (read from its recovery state or its output, whichever the existing
  built-server cases read), and one stamped `1.2.3` gets past that check (the case that must still
  start: it fails later or serves, but never with that code). **The setup wizard's "live" choice
  (watcher, 2026-11-12 17:59):** choosing live makes first setup write `WAITRON_ENV=production` into
  `trading.env` (`apps/server/src/trading-config.ts:35`), so on a test build the start after setup
  refuses. One case shows it: a first setup that saves live on a bundle stamped `null`, then the
  next start reaches the recovery page with `server.unreleased_build`'s EN words.
- [ ] **Step 2: Run; each fails.**
  `pnpm --filter @waitron/server exec vitest run src/release-check.test.ts src/recovery-surface.test.ts`
  and `-t "unreleased"` on `src/boot.test.ts`.
- [ ] **Step 3: Implement.** The failure reaches the recovery page by the path
  `server.config_missing` already takes from `bootServer` (`node-entry.test.ts:1097-1112` shows it).
- [ ] **Step 4: Run** the three files whole, `scripts/errors-reachable.test.ts`, the
  recovery-surface never-delete cases, and every file that bundles through `bundle()` directly:
  `first-fiscal-hour-boot.e2e.test.ts` (it starts a built bundle in production at `:30`; it must
  stay green, which shows test bundles are unstamped), `bin.commands.test.ts`, the
  `zone-process-matrix` users, and the three `certificate-diagnosis` test files that use
  `testing/certificate-diagnosis-snapshot.ts` (stamped `null`, so they must not start a production
  server; if one does, stop and report). Deletion controls: remove the `bundled` test → the
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
  (pure; the caller reads the folder). `runServerCommand` becomes `async` (the folder read is
  async), and `apps/server/src/bin.ts` awaits it.
  — 0 only when `release.bundled`, `release.version === version`, `folder.kind === "release"` and
  `folder.version === version`; each failure prints one line naming which (`bundle version <v|none>`,
  `declaration folder none|damaged <file>|version <v>`), never a producer value.
  `runServerCommand` accepts `check-release <version>`; usage line becomes
  `usage: waitron-server [check-producer | check-release <version>]`.

- [ ] **Step 1: Failing tests.** `release-command.test.ts`: the passing case and one case per
  failure line, using `writeDeclarationFolder` for real folders. `bin.commands.test.ts`: the USAGE
  pin gains the new form (a whole-shape pin gaining a key: allowed, named in the PR); the file runs
  a test bundle, which is unstamped (departure 3), so `check-release 1.2.3` exits 1 with
  `bundle version none`; with Task 3's `useBuiltServer` release option (a bundle stamped `1.2.3` and
  a folder from `writeDeclarationFolder` beside it), `check-release 1.2.3` exits 0 and
  `check-release 1.2.4` exits 1 — the automated passing case.
  `deploy-image-env.test.ts`: the Dockerfile's build stage declares `WAITRON_RELEASE_VERSION` and the
  three producer `ARG`s; the render runs only when the version is non-empty; the runtime stage copies
  the folder to `/app/declaration/` from a parent that holds it only on a release (below).
- [ ] **Step 2: Run; each fails.**
- [ ] **Step 3: Implement.** Dockerfile: the build stage declares `ARG WAITRON_RELEASE_VERSION`
  before the app-build `RUN`, so the bundles see it. A new stage `FROM build AS declaration`
  declares the producer's three `ARG`s and `WAITRON_RELEASE_VERSION`, makes `/release-root/`, and
  only when the version is non-empty runs
  `pnpm --filter @waitron/fiscal-verifactu declaration render --version "$WAITRON_RELEASE_VERSION" --out /release-root/declaration`
  (it fails the build on any refusal; departure 10). The runtime stage
  `COPY --from=declaration --chown=waitron:waitron /release-root/ /app/`, so a test build has no
  `/app/declaration/` at all (slice 3's "none", not "damaged"; the plan review measured an empty
  `/release-root/` copying nothing and leaving `/app` root-owned). The print-agent target never
  reads the declaration stage. image-smoke (a test build): `/legal/declaration`
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
  `WAITRON_RELEASE_VERSION=${{ steps.tags.outputs.release_version }}`, and so does the print-agent
  build (departure 11: the same settings keep its cache); a step "Refuse a release tag that is not
  on main", which runs only for `refs/tags/v*`, fetches `main` with no `--depth` (the plan review
  measured a depth-1 fetch answering "not an ancestor" for a tag behind main's tip; the guard case
  refuses `--depth` in that step), bounded as the checkout steps are, and runs
  `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`, comes before the first build; a step "Check the release inside the built image",
  only for tags, runs `timeout 120 docker run --rm --pull never --network none --entrypoint node
  "$CHECK_IMAGE" /app/server.js check-release "$RELEASE_VERSION"` after the build for checking and
  before "Publish to GHCR"; and "Publish to GHCR", on a tag, first asks the registry for
  `:<release_version>` (`docker manifest inspect`, bounded) and refuses when it exists (departure 8,
  watcher 17:59), one guard case pinning that the check precedes the push.
- [ ] **Step 2: Run; they fail.** `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
- [ ] **Step 3: Implement.** `release_version` is set in the existing `refs/tags/v*` branch of the
  case statement; a tag whose rest is not `X.Y.Z` is refused there (`exit 1`, naming it), before the
  build that would also refuse it.
- [ ] **Step 4: Run; pass.** Deletion control: drop the ancestor step → its case fails.
- [ ] **Step 5: Commit.**

### Task 6: The GitHub Release job

**Files:**
- Modify: `.github/workflows/ci.yml` (new job `release`), `scripts/ci-workflow.test.mjs`

- [ ] **Step 1: Failing guard cases:** a job `release` with `needs: [publish]`,
  `if: always() && !cancelled() && needs.publish.result == 'success' && startsWith(github.ref, 'refs/tags/v')`
  (as `publish` does, `ci.yml:4317`, so an intended upstream skip cannot drop it), `timeout-minutes` set,
  the bounded two-attempt checkout (it runs a script from the repository), `GH_TOKEN` from
  `secrets.GITHUB_TOKEN` on the step that calls `gh`, `permissions: { contents: write,
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
  version with no tag `v<v>`; any `v<v>.md` when the checkout holds no tags at all. Git runs with
  `GIT_*` cleared.

- [ ] **Step 1: Failing tests** in a scratch repository per case (`mktemp -d`, `git init`): no
  files, no tags → `[]`; one file, no tags at all → one problem (departure 6, watcher 17:59);
  one file, no tag of its own but another tag such as `pre-sqlite-migration` → `[]`; `v1.0.0` and `v1.0.1` files and only the tag
  `pre-sqlite-migration` → one problem naming `v1.0.0`; tag `v1.0.0` and its file unchanged → `[]`; the file edited after the tag → one
  problem; the file deleted after the tag → one problem; a tag `pre-sqlite-migration` → ignored. One
  case runs against the real repository and expects `[]`. Run the file once with `GIT_DIR` set to
  another repository; it still reads the scratch one.
- [ ] **Step 2–4:** run (fail), implement, run. **Measure the CI checkout before relying on it:** in
  a scratch bare repository with a tagged commit behind its tip, run the fetch `actions/checkout`
  runs with `fetch-depth: 1` and `fetch-tags: true` (read the action's log on this PR's own run for
  the exact command) and check `git show v1.0.0:<file>` answers. The failing case it must also show:
  the same fetch without the tags fails (assert its exit status, not its words: git prints "invalid
  object name"). Record both. Add `scripts/released-declarations.mjs` to the root project's
  `coverage.include`.
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
- [ ] **Step 2:** `pnpm --filter @waitron/fiscal-verifactu declaration show --version 9.9.9 --place Test --date 2026-12-03`,
  with the producer settings set, still refuses with `declaration.release_blocked {"count":1}`
  (Q53's line). (`pnpm release prepare` would stop earlier, off a clean `release/9.9.9` branch.)
  Record it.
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
