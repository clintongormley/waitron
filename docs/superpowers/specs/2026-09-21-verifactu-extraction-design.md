# Extracting `@waitron/verifactu` into a standalone open-source library

**Date:** 2026-09-21
**Status:** design — awaiting owner review
**Type:** architectural (repository topology, publish/consume, CI gates)

## 1. What we are doing, and why

Today `packages/verifactu` is a package inside the Waitron monorepo. It is a self-contained
implementation of AEAT's Veri\*Factu / SIF specification: it builds the invoice record, computes the
`huella` (the hash that chains one record to the previous one), builds the QR payload, serialises and
parses the AEAT XML, validates records against the published rules, drives the SOAP client, and ships
a `fake-aeat` test double. It implements a government specification from AEAT's own published texts —
the discipline in `PROVENANCE.md` and `docs/compliance/implementation-provenance.md` (spec-first,
never reading the one copyleft reference library).

We are moving it out into its own public repository and publishing it to npm, so it becomes a library
anyone can use — the "a library is a tool for building SIFs, not a SIF" position. Waitron then depends
on it like any other third-party package.

**This is the right candidate for extraction** because it is already a clean leaf: its only runtime
dependency is `fast-xml-parser`, and nothing in its source imports another `@waitron/*` package (the
few `@waitron/*` mentions in its source are comments, one of which deliberately re-states a shape so
the package need not depend on `@waitron/shared`).

### Decisions taken (owner, 2026-09-21)

- **Goal:** open-source the library.
- **GitHub home:** `github.com/waitron-io/verifactu`, under the **`waitron-io` GitHub organisation**.
  (The owner renamed the earlier `waitron-io` user account to `waitron-dev`, freeing the name, and
  registered `waitron-io` as an organisation on 2026-09-21.) The org was created by `waitron-dev`, so
  a one-time step invites `clintongormley` — the working identity — into the org as an **Owner**; after
  that, repo creation and pushes happen as the normal identity with no further logins.
- **npm:** published as **`@waitron/verifactu`**, public, under the `waitron` npm **organisation**
  (the `@waitron` scope). `publishConfig.access` must be `public` or the first publish is rejected as
  private.
- **Licence:** **Apache-2.0** (permissive, explicit patent grant, consistent with the spec-first
  provenance posture). Waitron itself stays Elastic License 2.0 — the library's licence is
  deliberately different.
- **Git history:** **fresh** — a single clean initial commit, no monorepo history carried across.
- **Consumption:** Waitron depends on the **published npm package**. A local workspace override is used
  for fast iteration during development so a change need not be published to be tried.

## 2. The new repository

A single-package repository (not a pnpm workspace).

### 2.1 What moves in

Everything under `packages/verifactu` except build artefacts:

- `src/` (all source and its co-located `*.test.ts`), including `src/testing/fake-aeat.ts`.
- `schemas/` (the AEAT XSDs and their `README.md` SHA-256 manifest) — used only by tests, not at
  runtime, but kept for provenance and the schema-conformance test.
- `test/fixtures.ts` (reproduces AEAT's vector-1 hash — valuable conformance evidence for consumers).
- `stryker.config.json`, `vitest.config.ts`, `tsconfig.json`.
- `PROVENANCE.md` and `README.md` (rewritten for a public audience — see §2.5).

**Left behind** (do not copy): `coverage/`, `reports/`, `node_modules/`.

**Also moves:** `scripts/schema-equivalence.sh` and `scripts/schema-equivalence.md` — the
`fast-xml-parser` version-equivalence harness. It exists to test verifactu's XML parsing, so it belongs
with the library, not in Waitron.

### 2.2 The build (new — the monorepo never needed one)

The monorepo consumes verifactu as raw TypeScript (`main` → `./src/index.ts`). A published package
cannot do that, so the repo gains a build step: `tsc` emitting `dist/` with `.js` **and** `.d.ts`. The
package is ESM (`"type": "module"`). No bundler is needed — it is a pure library with one runtime
dependency.

### 2.3 `package.json` for publishing

Rewritten from the monorepo manifest:

- Drop `"private": true`; set `"version": "0.1.0"` (honest pre-1.0, and Waitron is not yet in
  production).
- `"license": "Apache-2.0"`, `"repository"`, `"homepage"`, `"bugs"`.
- `"publishConfig": { "access": "public" }`.
- `"files"`: the published tarball ships `dist/`, `README.md`, `LICENSE`, `PROVENANCE.md`. Decision:
  **also include `schemas/`** — small, and useful provenance for consumers. Exclude `src/` tests and
  `test/`.
- **`exports` map** — the root plus one subpath:
  - `"."` → `dist/index.js` (+ `types` → `dist/index.d.ts`).
  - `"./testing"` → `dist/testing/fake-aeat.js` (+ types). This promotes the `fake-aeat` double from a
    deep `src/` reach into a supported public entry point. It is the only extra export the extraction
    requires — every other consumer import is already the root surface.
- Runtime dependency `fast-xml-parser` unchanged; dev dependencies (vitest, stryker, coverage, fast-
  check, typescript, @types/node) unchanged.

### 2.4 The public API

Unchanged root re-export surface (huella, records, validate, qr, endpoints, xml serialise/parse,
client, and the types), **plus** the new `@waitron/verifactu/testing` entry exposing `createFakeAeat`.

### 2.5 Licence and provenance for a public audience

- Add a top-level `LICENSE` (Apache-2.0 text) and the SPDX header convention if desired.
- `README.md` rewritten for external readers: what the library does, install, a minimal usage example,
  the conformance evidence (vector-1), and a provenance note.
- `PROVENANCE.md` carried over and made public-facing: it now matters more, because it is the public
  record that this is a spec-first implementation, independent of the copyleft reference library.

### 2.6 The library repo's own CI

The library owns its gates now (they leave Waitron — see §4):

- Test + coverage at the same bars it holds today: **98/98/98/95** statements/branches/functions/lines.
- Mutation at the **90** floor (`stryker`), as a real gate in the library's CI.
- Lint, typecheck, `prettier --check`, and a **build smoke test**: pack the tarball, install it in a
  throwaway project, import the root and `./testing`, and confirm the `exports` resolve against the
  built `dist/` (this is the check the monorepo never had to do).
- A **release workflow**: on a version tag, `npm publish --access public` with **npm provenance**
  (GitHub Actions OIDC / an org-scoped automation token). Provenance is a strong trust signal for a
  fiscal library and needs the `repository` field to match.

### 2.7 No internal or AI-workflow artifacts in the public repo

The repository is public, so it must carry **none** of Waitron's internal or AI-workflow material, and
no references to it. This complements the fresh-history decision (§1) — no internal commit messages
travel either.

- **No files:** no `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, no `docs/superpowers/` specs or
  plans, no `docs/handoffs/` ledgers, no `docs/compliance/` material. (The scan confirms none exist
  inside `packages/verifactu` today; the point is that none are added.) The repo's `.gitignore` is a
  plain public one (node, `dist/`, `coverage/`, reports), not a copy of internal ignore patterns.
- **Scrub the in-source references** (the full set, found 2026-09-21): reword each to state the
  invariant or rule directly, citing the AEAT primary source (XSD line, developer FAQ, BOE) where a
  citation helps, never an internal file:
  - `src/huella.test.ts:169` and `:197` — drop the "CLAUDE.md §5 / §1" pointers.
  - `src/records.test.ts:417` — drop the "CLAUDE.md §5" pointer.
  - `src/validate.ts:34` — replace the `docs/compliance/verifactu-findings.md:621` pointer with the
    underlying AEAT source or a plain statement of the rule.
- **Rewrite `PROVENANCE.md` for a public audience** (§2.5), removing the `.claude/worktrees/` loss
  narrative at line 25 and anything else that describes the internal process rather than the
  implementation's provenance.
- **A CI guard in the library repo** greps the tree and fails if any of `claude`, `codex`,
  `superpower`, `CLAUDE.md`, or `docs/(superpowers|compliance|handoffs)` reappears (case-insensitive),
  so a future contribution cannot reintroduce an internal reference. Run the same grep once before the
  first publish.

### 2.8 Differential conformance tests against `inoguerols/verifactu`

A test suite in the library repo runs our implementation and `inoguerols/verifactu` on the same inputs
across the **overlapping surface** (the `huella`/cadena string, the QR payload, and record/XML
serialisation), asserts agreement where they agree, and — where they diverge — pins the case with the
AEAT source that shows which side is correct. This is a real bug-finder, not documentation: if a
divergence ever shows **ours** is wrong, that is a defect to fix.

- **Allowed by provenance.** `inoguerols/verifactu` is MIT, so it may be a **test-only devDependency**
  and its code executed and read (this is the "prefer `inoguerols` where they overlap" reference,
  [implementation-provenance.md](../../compliance/implementation-provenance.md)). This is unlike the
  AGPL `mdiago/VeriFactu`, which stays black-box-only and is never added.
- **AEAT is the tiebreaker, never inoguerols-equality.** Two implementations of a published standard
  can share a bug (agreement is not proof of correctness) and a divergence is not proof ours is wrong.
  So every divergence is resolved by citing the AEAT vector/spec and pinning which side is right — the
  suite must not assert "equal to inoguerols" as the definition of correct. It augments, never
  replaces, the authoritative-vector tests already in `conformance.test.ts`.
- **Input selection follows the §1 discipline.** Each compared class is represented by a value the two
  sides could plausibly treat *differently* — numeric XML entities, boundary amounts and quantities,
  foreign-recipient id types, empty/optional fields — chosen from what the format allows, not the first
  value to mind. Property-based generation over the record shape (`fast-check`, already a devDependency)
  is a good fit for surfacing divergences.
- **Deterministic against a pinned version.** `inoguerols/verifactu` is young and actively maintained,
  so it is pinned to an **exact version**; the suite is then deterministic and can be an ordinary gate
  in the library CI. Bumping the pin is a deliberate, reviewed action, and any new divergence a bump
  surfaces is investigated (they may have regressed, fixed a case, or exposed one of ours) — the suite
  never gates on their churn because the version is fixed.
- **Adapter.** A thin per-operation adapter maps one logical input into each library's API, since the
  shapes differ. The first plan task here is a small spike to identify inoguerols's published package
  name and its comparable exports, and to confirm the overlapping surface (operations one library has
  and the other lacks — their compliance lint, our SOAP client and validation rules — are out of the
  differential surface and stay covered by our own vector tests).

## 3. How Waitron consumes it

### 3.1 Dependency wiring

Add `@waitron/verifactu@^0.1.0` (registry) to the three consumers, and remove the workspace package:

- `apps/server`: currently `dependencies: workspace:*`, but production never imports it — the only
  imports are in `qr-link-range.test.ts` and `aeat.preprod.test.ts`. Move it to **`devDependencies`**.
- `packages/fiscal-verifactu`: **`dependencies`** (production uses it — this is the regime module).
- `packages/provisioning`: already **`devDependencies`** (only `venue-apply.e2e.test.ts` uses it).
- Update `pnpm-lock.yaml`.

Deleting `packages/verifactu/` removes it from the `packages/*` workspace glob.

### 3.2 The one code change in consumers: the deep import

Every real deep import is `createFakeAeat` from `@waitron/verifactu/src/testing/fake-aeat.js`. Rewrite
each to the public `@waitron/verifactu/testing`:

- `packages/fiscal-verifactu/src/acks.test.ts`
- `packages/fiscal-verifactu/src/drain.concurrency.test.ts`
- `packages/fiscal-verifactu/src/drain.test.ts`
- `packages/fiscal-verifactu/src/reconcile.test.ts`
- `packages/fiscal-verifactu/test/write-path-fixtures.ts`
- `packages/provisioning/src/venue-apply.e2e.test.ts`

Every root import (`apps/server`, and the rest of `fiscal-verifactu`) stays byte-identical.

Optional, non-blocking: doc-comment cross-references that cite `@waitron/verifactu/src/...` file paths
(in `packages/fiscal-verifactu/src/drain.ts` and `packages/workforce/src/projection.ts`) become stale
pointers into a repo that no longer holds those files. Thin them to name the package, not the old path,
when those files are next touched — do not sweep.

### 3.3 Local iteration without publishing

Document a local override (pnpm `link`, or a `file:`/`overrides` entry pointing at a local checkout of
the library repo) so a change to the library can be tried in Waitron without a publish. This goes in
`docs/developers/workflow-guide.md`. The committed state always references the published version.

## 4. The Waitron-side gate cleanup

This is the bulk of the work. Each item is enumerated because the house rule is to trace gating logic
before changing it (CLAUDE.md §2, §3).

### 4.1 `ci.yml`

- Remove the **`mutation-verifactu`** job and its entry in the `ci` job's `needs` list.
- Remove the **`verifactu`** change-gate output and its detection in the `changes`/`gates` step.
- Remove the **`!@waitron/verifactu`** filter from the coverage-run exclusion.
- After editing, **run `scripts/ci-workflow.test.mjs` and `scripts/main-tag-guard.test.mjs`** — they
  read `ci.yml` as text. Neither names the verifactu job by string today, but they may assert on job
  structure; confirm green.

### 4.2 Guards to update

- **`scripts/coverage-thresholds.test.ts`** — remove `@waitron/verifactu` from the 98-bar set.
- **`scripts/changed-packages.mjs` / `scripts/changed-scope.mjs`** (and their `*.test.mjs`) — remove
  the verifactu enumeration, and the stale `changed-scope.mjs` comment about
  `packages/verifactu/schemas/README.md` SHA pinning (that file leaves the repo).
- **`scripts/english-only.test.ts`** — prune the now-dead `verifactu` entry from the negative-check
  list at ~line 141 (leaving `country-es`, `country-gb`, `reporting`). No consumer's production source
  carries verifactu's Spanish identifiers, so nothing else changes.

### 4.3 Guards that need **no** change (verified)

- **`scripts/module-seams.test.ts`** — keys on the package name `@waitron/verifactu`, which is
  unchanged, and the boundary it enforces (a generic host must not import the AEAT protocol library in
  production) is independent of where the package is hosted. The apps/server and provisioning imports
  it forbids are all in test files, which the guard already skips. **No change.**
- `scripts/alert-codes.test.ts`, `scripts/ongoing-alert-codes.test.ts`,
  `scripts/setup-wizard-fiscal-fields.test.ts`, `scripts/write-path-tables.test.ts`,
  `scripts/guarded-teardowns.test.ts`, `scripts/classification-complete.test.ts`,
  `scripts/module-graph-honesty.test.ts`, `scripts/fiscal-test-budget.test.ts` — all reference
  **`fiscal-verifactu`**, not `verifactu`. Untouched.

### 4.4 Documentation sweep

A behaviour change retires every receipt about the old behaviour (CLAUDE.md §1). Statements that become
false once verifactu is an external dependency must be updated **in the same change**:

- `CLAUDE.md` — §1 uses verifactu as an example in several places; §2 describes the `mutation-verifactu`
  membership and the 98-bar coverage set; §4 (testing) references it. Update the ones the extraction
  makes false; leave the ones that are still true. Do not sweep unrelated lines.
- `docs/developers/ci-and-gates.md`, `docs/developers/testing-guide.md` — the topic files behind those
  rules.
- Provenance: decide whether `docs/compliance/implementation-provenance.md`'s rationale is duplicated
  into the public repo's `PROVENANCE.md`/README, or pointed at. The Waitron doc stays; the public repo
  needs a self-contained provenance statement.

## 5. Testing strategy

- **Library repo:** the existing suite (including the vector-1 / exact-XML conformance tests) stays
  green at 98/90. Add the §2.6 build smoke test. Prove the `./testing` export resolves from the built
  package, not just from source. Add the §2.8 differential suite against `inoguerols/verifactu`.
- **Waitron:** after repointing, run the three consumers' suites and the full guard suite. The changed
  code (the six deep-import rewrites, the manifest moves, the guard edits) is behaviour-preserving, so
  the existing behavioural assertions must still pass unchanged — do not rewrite a test to match.
- **TDD** applies to the one genuinely new behaviour, the `./testing` export: a failing build-smoke
  assertion that `@waitron/verifactu/testing` resolves `createFakeAeat`, then the `exports` entry that
  satisfies it.

## 6. Sequencing

1. **Stand up the library repo.** Ensure `clintongormley` is an Owner of the `waitron-io` org, then
   create `github.com/waitron-io/verifactu` under it, fresh initial commit, add build + Apache-2.0 +
   exports + CI. Get CI green.
2. **Publish `0.1.0`** to npm (`@waitron/verifactu`, public, with provenance).
3. **Waitron branch (worktree).** Swap the three manifests to the registry version, rewrite the six
   deep imports, delete `packages/verifactu/`, apply the §4 `ci.yml` and guard edits, run the local
   iteration override doc. Verify the consumer suites and guards, then the pre-push gate and CI.
4. **Land.**

Steps 1–2 and step 3 are independent enough that the library repo can be published before the Waitron
branch is opened; the Waitron branch cannot go green until the package is published (or a local
override is in place).

## 7. The cost we are accepting

A change that spans the protocol and the product — for example a new AEAT field that touches both the
library and `fiscal-verifactu` — now needs **two coordinated PRs across two repositories**, with a
publish in between, instead of one atomic change. This is inherent to the split. The local-override
workflow (§3.3) softens day-to-day iteration but does not remove the two-PR reality for anything that
lands.

## 8. Out of scope

- No behavioural change to any verifactu code. This is a move, a build, and a rewire — not a rewrite.
- No change to `fiscal-verifactu`'s logic beyond the import-path rewrites.
- Extracting any other package. Verifactu is the clean leaf; nothing here generalises to packages with
  workspace dependencies.

## 9. Parallelism with the SQLite flip

This work can proceed **in parallel** with the pending PGlite→SQLite database migration, because
`verifactu` is entirely database-free — its only runtime dependency is `fast-xml-parser`, it declares
no schema, imports no `@waitron/db`, `columns.ts`, or DB test helper, and its tests touch no database.
The SQLite flip lives in the database layer (`packages/db`, `columns.ts`, the `usePgliteDb` →
`useVenueDb` helper); the two efforts touch disjoint code.

The only overlap is a handful of shared workspace files both branches may edit — `ci.yml`,
`scripts/coverage-thresholds.test.ts`, `scripts/changed-packages.mjs` / `scripts/changed-scope.mjs`,
and `scripts/english-only.test.ts`. These are ordinary rebase conflicts, resolved at rebase time
(§4). To minimise them, land whichever branch is ready first and rebase the other. The extraction does
**not** depend on the SQLite flip and is not blocked by its parked state.
