# Scoped CI — run the tests a change can actually break

**Date:** 2026-07-31
**Status:** design approved, not yet implemented

Today every push runs every check. A one-line correction to `CLAUDE.md` costs the same seven and a
half minutes as a migration to `packages/db`. This design cuts that to the work a change can
plausibly affect, and shortens the full run when one is warranted.

---

## 1. What it costs today

Measured on CI run `30638649820`, branch `docs/archive-conservation-regime` — a change that touched
**Markdown only**:

| Job                  | Duration  | Required check? |
| -------------------- | --------- | --------------- |
| `test`               | **7m10s** | yes             |
| `mutation-verifactu` | 3m12s     | yes             |
| `mutation-shared`    | 51s       | yes             |
| `typecheck`          | 48s       | yes             |
| `static-analysis`    | 33s       | yes             |

Wall clock 7m20s (14:27:09 → 14:34:29), all of it to confirm that prose is prose.

Inside `test`, the `pnpm test:coverage` step ran 387s (14:27:57 → 14:34:24), and it divides almost
exactly in half:

| Package             | Duration | Finished at |
| ------------------- | -------- | ----------- |
| `db`                | 189.04s  | 14:31:15    |
| `payments`          | 106.95s  | 14:33:24    |
| `fiscal-verifactu`  | 96.44s   | 14:33:14    |
| `payments-stripe`   | 28.73s   | 14:33:53    |
| `apps/server`       | 25.00s   | 14:34:24    |
| `scheduler`         | 19.93s   | 14:33:45    |
| `credentials`       | 14.90s   | 14:31:30    |
| `provisioning`      | 12.12s   | 14:34:11    |
| `ui`                | 6.58s    | 14:28:05    |
| `core`              | 6.54s    | 14:31:37    |
| `fiscal`            | 4.92s    | 14:31:20    |
| `verifactu`         | 4.58s    | 14:28:03    |
| `shared`            | 4.34s    | 14:28:03    |
| `migrations`        | 4.31s    | 14:33:58    |

`packages/db` finished 198s into the step, and nothing downstream of it started before that.

### 1.1 `pnpm -r` orders by dependency, and that ordering is pure cost here

`pnpm -r` runs scripts in topological order. Proven rather than inferred — this probe, at
`--workspace-concurrency=4`, with each package busy-looping for 1200ms:

```text
$ pnpm -r --workspace-concurrency=4 exec node -e \
    "const t=Date.now(); while(Date.now()-t<1200){}; \
     console.log('PROBE', process.cwd().split('/').slice(-2).join('/'), Date.now()%1000000)"
PROBE bench/pglite-throughput   315814   ┐
PROBE packages/ui               315814   │ wave 1
PROBE packages/verifactu        315815   │
PROBE packages/shared           315816   ┘
PROBE packages/db               317070     wave 2  (+1.25s)
PROBE packages/fiscal           318317   ┐ wave 3  (+1.25s)
PROBE packages/credentials      318320   ┘
PROBE packages/core             319566     wave 4
PROBE packages/fiscal-verifactu 320812   ┐ wave 5
PROBE packages/payments         320812   ┘
...
```

The waves are spaced by exactly one probe duration and follow the dependency graph, not the
concurrency limit. So `packages/db`'s 189s is a **barrier**: `fiscal`, `fiscal-verifactu`,
`payments`, `scheduler`, `payments-stripe`, `provisioning` and `apps/server` cannot start until it
finishes.

That ordering earns nothing for tests, because **no test consumes a build artefact**. Every one of
the fifteen workspace members resolves to TypeScript source:

```text
$ for d in packages/* apps/* bench/*; do [ -f "$d/package.json" ] || continue; node -e "
    const p=require('./$d/package.json');
    const vals=[p.main,p.module,...(p.exports?Object.values(p.exports).flatMap(
      v=>typeof v==='string'?[v]:Object.values(v)):[])].filter(Boolean);
    console.log((vals.some(v=>String(v).includes('dist'))?'DIST!  ':'src-ok ')+p.name);
  "; done
src-ok @waitron/core
src-ok @waitron/db
src-ok @waitron/server
…  (15/15 src-ok, 0 pointing at dist)
```

and no test file imports a sibling's `dist/` (`grep -rnE "from ['\"].*dist/" --include="*.test.ts"`
returns nothing). `--no-sort` is therefore safe for `test:coverage`. It is **not** safe for `build`,
which is why this design changes only the test invocation.

---

## 2. The constraint that shapes everything

All five job ids are **required status checks** in ruleset `19899160` (`main protection`, active,
`strict_required_status_checks_policy: true`):

```text
static-analysis · typecheck · test · mutation-verifactu · mutation-shared
LICENSE is unmodified Elastic License 2.0 · Every commit is signed off
```

`ci.yml`'s own header already warns that these ids are a public interface. Two consequences:

- **`paths-ignore:` on the workflow trigger is a trap.** The workflow would not run, the five checks
  would never report, and the pull request would sit at "Expected — waiting for status" forever.
  Skipping has to happen *inside* jobs that always report, or the required set has to change.
- **Any shard of `test` breaks the interface.** `test-heavy` and `test-light` reporting is not
  `test` reporting. Splitting means editing the ruleset in the same breath, every time.

So the required set is reduced to a single aggregate gate. After that, jobs can be added, renamed,
sharded or skipped without ever touching branch protection again.

---

## 3. Design

### 3.1 Job graph

```text
changes ─┬─> lint                  ALWAYS runs, never gated
         ├─> bundle-smoke          if code
         ├─> typecheck             if code
         ├─> test-heavy            if code AND db is in scope · packages/db alone
         ├─> test-light            if code · the scoped set minus db, --no-sort
         ├─> mutation-verifactu    if code AND verifactu is in scope
         └─> mutation-shared       if code AND shared is in scope
                    ↓
                   ci              always; the only required check
```

> **Amended 2026-07-31, after the first scoped run.** The two mutation lines above read `if code`
> when this was written — the same gate as `bundle-smoke` and `typecheck`, on the reasoning in §1
> that a mutation run over a pure-Node package is cheap. Measured on run `30650089655`
> (`gh run view 30650089655 --json createdAt,updatedAt,jobs`, head `4926cf5`), it is not: the run
> spanned **4m8s**, `mutation-verifactu` was **3m26s** of it (17:10:35→17:14:01), and every other
> job had finished by 17:11:40 — 1m39s in, with `test-heavy` skipped outright. So one ungated job
> set the floor for every pull request in the repository, including the ones nowhere near
> `packages/verifactu`, which is most of what the scoping was for. Both now gate on membership of
> the resolved scope by the §3.6 mechanism.

### 3.2 What runs when

| Change                         | Jobs that do work                                                  |
| ------------------------------ | ------------------------------------------------------------------ |
| `docs/**` or a root `*.md`     | `lint` only                                                         |
| one package                    | `lint`, `typecheck`, `bundle-smoke`, that package + its dependents  |
| `packages/db`                  | as above, plus everything downstream of `db`                        |
| **any code, pushed to `main`** | `lint`, `typecheck`, `bundle-smoke`, **full unfiltered suite**      |

The docs rule and the package-scoping are **two independent decisions**. `main` re-runs the full
suite because that is what verifies the *scoping* was right; a docs-only change has nothing to
scope, so `main` skips it too. Without that separation every docs merge would still pay for a full
run.

Times for code changes are projections from §1's per-package figures. The docs-only figure is
measured: `lint` is `static-analysis` minus the build steps, and that job is 33s today.

### 3.3 `static-analysis` splits in two

`lint` — `pnpm lint` and `pnpm format:check`. **Never gated, on any path.** A docs change must still
be linted, and prettier is the only tool in the repo that reads prose.

Worth knowing precisely what that covers, because the obvious assumption is wrong.
`.prettierignore` lists `docs/`, so **`format:check` checks root-level Markdown and skips
everything under `docs/`**. Established by malforming a file rather than by reading the ignore file
— an explicitly-ignored path and a checked path produce *identical* output under `prettier --check`,
so the naive probe proves nothing:

```text
$ printf '# x\n\n\n\n*  badly    formatted   list\n' > docs/__probe.md
$ printf '# x\n\n\n\n*  badly    formatted   list\n' > __probe_root.md

$ pnpm exec prettier --check docs/__probe.md
All matched files use Prettier code style!          ← ignored

$ pnpm exec prettier --check __probe_root.md
[warn] __probe_root.md
[warn] Code style issues found in the above file.   ← checked
```

eslint does not process Markdown at all; `eslint.config.js` has no `files:` pattern that matches
`.md`.

`bundle-smoke` — the `@waitron/credentials` and `@waitron/server` builds and their five
smoke/assertion steps. Gated on `code`, since a Markdown edit cannot change an esbuild bundle.

### 3.4 "Docs-only" is a path allowlist, never a file extension

**A change is docs-only when every changed path is under `docs/` or is a root-level `*.md`.**
Anything under `packages/` or `apps/` is code, Markdown or not.

The extension rule would be wrong, and the counter-example is live in the tree.
`packages/verifactu/schemas/README.md` is a **test fixture**, not documentation —
`packages/verifactu/src/schemas.test.ts:40-48` hashes every AEAT schema file and asserts the digest
appears in it:

```typescript
it.each(ALL_FILES)("%s matches the checksum recorded in README.md", (file) => {
  // Distinguishes "AEAT published a revision" from "someone edited a primary source to make a
  // test pass". Both look identical in a diff.
  const readme = readFileSync(SCHEMA_DIR + "README.md", "utf8");
  const sha = createHash("sha256").update(readFileSync(SCHEMA_DIR + file)).digest("hex");
  expect(readme).toContain(sha);
});
```

Under a `**/*.md → skip tests` rule, editing that file would skip the only test that guards it —
defeating a check whose stated purpose is catching exactly that edit.

The rule **fails closed**: a path matching neither branch of the allowlist is code, so an unfamiliar
path shape runs everything. Same principle as the pre-push hook running the gate when no refs
arrive on stdin.

### 3.5 Package scoping uses pnpm's own dependency walk

On a pull request, `test-heavy` and `test-light` filter with `...[<base>]` — packages changed since
the base **and their dependents**. On `main`, no filter.

The direction of the ellipsis matters and is easy to get backwards. Measured in a clone with one
commit touching `packages/payments`:

```text
$ pnpm --filter "...[main]" ls --depth -1     # changed package AND ITS DEPENDENTS  ← what we want
payments, payments-stripe, migrations, provisioning, scheduler, server

$ pnpm --filter "[main]..." ls --depth -1     # changed package and its DEPENDENCIES ← wrong way round
payments, core, db, shared, fiscal
```

Exclusions **subtract from** that set rather than being OR-ed with it, which is what lets
`test-light` be "the scoped set, minus `db`". Measured with one commit touching `packages/db`:

```text
$ pnpm --filter "...[main]"                          → …, db, fiscal, payments, server, (11 total)
$ pnpm --filter "...[main]" --filter "!@waitron/db"  → the same 11, minus db (10)
```

An empty match is safe: the filter **exits 0** when nothing matches (verified on a clean tree), so a
scoped run with nothing to do does not fail the job.

**This filter does not work in a `git worktree`, and fails silently.** All feature work in this repo
happens in a worktree (`CLAUDE.md` §6), so this is the first thing anyone testing the change locally
will hit. Measured on pnpm 9.15.0, same commit, both ref spellings:

| Checkout                | `git diff --name-only main...HEAD` | `pnpm --filter "...[main]"` |
| ----------------------- | ---------------------------------- | --------------------------- |
| normal clone            | the changed files                  | 11 packages                 |
| `git worktree` checkout | the changed files                  | **`No projects matched`**   |

`main` and `origin/main` behave identically, so it is not a ref-spelling problem. The likely
mechanism is that a worktree's `.git` is a *file* rather than a directory (confirmed with `file
.git`) and pnpm's change detection does not follow it — but the mechanism is inferred, whereas the
behaviour above is measured. What matters practically: **CI checks out a normal clone, so scoping
works there**, and a local worktree will report "nothing changed" no matter what you edit. Verify
this logic in a clone or on a real pull request, never in a worktree.

This walk is exactly right about package-graph coupling and blind to everything else — a root
config, a shared fixture, an environment variable. The unfiltered `main` run is what covers that
blind spot, and it is the reason §3.2 keeps it.

### 3.6 Sharding the test job

- `test-heavy` — `packages/db` alone, ~189s of genuine work.
- `test-light` — every other package, `--no-sort` so nothing waits on a dependency it does not
  consume. Carries the Playwright/Chromium install, because `@waitron/ui` lives here and nothing
  else needs a browser.

`test-light` composes cleanly: `--filter "<scope>" --filter "!@waitron/db"` is the scoped set minus
`db`, because exclusions subtract (measured above).

**`test-heavy` does not, and both obvious formulations are wrong.** Whether it needs to run is
decided in the `changes` job by resolving the scope and testing for membership, then passed down as
a boolean. Measured with one commit in each scenario:

| Formulation                                    | `db` changed | `payments` changed  | `shared` changed (a dependency of `db`) |
| ---------------------------------------------- | ------------ | ------------------- | --------------------------------------- |
| `--filter "...[main]" --filter "@waitron/db"`   | runs `db` ✓  | **runs `db`** ✗     | **runs `db`** ✗ (right answer, luck)    |
| `--filter "@waitron/db[main]"`                  | runs `db` ✓  | nothing ✓           | **nothing** ✗                            |
| membership of `--filter "...[main]"`            | runs `db` ✓  | nothing ✓           | runs `db` ✓                              |

The first fails because **two inclusion filters are OR-ed, not intersected** — so `db`'s 189s would
run on every code change, losing most of the benefit. The second fails in the dangerous direction:
it intersects with the *changed* set rather than the *changed-plus-dependents* set, so a change to
`packages/shared` selects nothing and `packages/db` ships untested. Only membership of the resolved
scope is right in all three columns.

The membership query needs no `pnpm install` — `pnpm ls --filter … --json` resolves from the
workspace manifests alone (verified in a clone with no `node_modules`).

> **Amended 2026-07-31, after the first scoped run.** This section described the mechanism as
> `test-heavy`'s alone. It is now shared by three jobs — `test-heavy`, `mutation-verifactu` and
> `mutation-shared` (see §3.1's amendment for the measurement that moved the last two) — so the
> `changes` job resolves the scope **once** and emits one boolean per gated job from that single
> `pnpm ls`. The gate list lives in `SCOPE_GATES` in `.github/scripts/changed-scope.mjs`, including
> for the unscoped `main` run, so adding a gated job does not need the list writing out a second
> time in `ci.yml` — forgetting that would leave the new job never running on `main`, the one
> direction nothing else in this design would notice.
>
> Note what membership does and does not buy the two mutation gates. The scope is
> changed-packages-**and-their-dependents**, so a gate fires when its own package changed or when
> its package depends on something that changed. The second half is inert for these two today —
> run in this workspace on 2026-07-31:
>
> ```text
> $ pnpm --filter "@waitron/shared..." ls --depth -1
> @waitron/shared@0.0.0 …/packages/shared (PRIVATE)
>
> $ pnpm --filter "@waitron/verifactu..." ls --depth -1
> @waitron/verifactu@0.0.0 …/packages/verifactu (PRIVATE)
> ```
>
> One line each: neither has a workspace dependency to inherit a change from. Nothing enforces that
> and it is one `package.json` edit from being false, which is why the gate resolves membership
> rather than matching a package name against the diff. The other direction is already populated —
> `pnpm --filter "...@waitron/shared" ls --depth -1 --json` returns **12** entries and
> `...@waitron/verifactu` returns **5**, each count including the named package itself — but that is
> what a change to either fans OUT to, and gating is about what fans IN.

Coverage thresholds are per-package, so no cross-shard aggregation is needed. A scoped pull request
only enforces the thresholds of packages that ran; the unfiltered `main` run enforces all of them.

### 3.7 The `ci` gate

```yaml
ci:
  if: always()
  needs: [changes, lint, bundle-smoke, typecheck, test-heavy, test-light,
          mutation-verifactu, mutation-shared]
  runs-on: ubuntu-latest
  steps:
    - name: Fail if any needed job did not succeed
      if: >-
        contains(needs.*.result, 'failure') ||
        contains(needs.*.result, 'cancelled')
      run: exit 1
```

`skipped` counts as pass — that is the whole point, since scoping works by skipping. `cancelled`
counts as **fail**: `ci.yml` sets `cancel-in-progress: true`, and a cancelled run reporting green
would let a superseded run satisfy branch protection.

Getting that pair backwards is the failure mode that turns the gate into a rubber stamp, so it gets
its own test rather than being reasoned about.

---

## 4. Traps to build in deliberately

- **`actions/checkout` defaults to `fetch-depth: 1`.** `origin/main` does not exist in that clone,
  so both the path diff and the pnpm filter would silently see nothing and skip everything. Needs
  `fetch-depth: 0`.
- **`github.event.before` is all-zeros** for a new branch or a force-push. Fail closed to a full run.
- **The `ci` gate's skipped/cancelled polarity** — §3.7.
- **`--no-sort` applies to `test:coverage` only.** `build` genuinely needs topological order; §1.1's
  receipt is about tests, and does not transfer.
- **The scoping filter is untestable in a worktree** (§3.5). It reports "no projects matched"
  whatever you edit, which reads as "the filter is broken" rather than "you are in the wrong kind of
  checkout". Verify in a clone or on a real pull request.

---

## 5. Rollout — two pull requests, because of a chicken-and-egg

A single pull request cannot do this. The moment `test` is renamed, the required check `test` stops
reporting, and the pull request making that change can never merge.

1. **PR 1** — add the `ci` gate job, `needs:` the existing five, and this spec. No other change; all
   five old checks still report, so it merges normally. Ruleset is then edited to require
   `ci` + `LICENSE is unmodified Elastic License 2.0` + `Every commit is signed off`, dropping the
   five.
2. **PR 2** — the `changes` job, the `static-analysis` split, the test shards, the scoping. Only
   `ci` is required by then, so renames are free.

The ruleset edit is a repo-admin action between the two, and there is no window where `main` is
unprotected: PR 1 leaves all five checks in place, and PR 2 cannot merge without `ci`.

---

## 6. Explicitly out of scope

**`packages/db`'s 189s is mostly Testcontainers Postgres startup, one container per suite.** Sharing
a container across suites would beat everything in this design combined. It is excluded because it
means changing `useRealPostgres` / `describeEachTarget` — the harness guaranteeing that RLS and lock
contention are observed under a **non-superuser** role, which PGlite cannot show. That is a
test-correctness change wearing a performance change's clothes, and it belongs on its own branch
with its own review. Recorded in `docs/backlog.md` instead.

Also out of scope: `mutation.yml` and `stripe-sandbox.yml`, which are already scheduled rather than
per-pull-request, and larger runners, which trade money for the same result more crudely than
sharding does.
