# Handoff — the provisioning tool's groundwork landed, and four corrections went wrong on the way

**Date:** 2026-07-30
**Type:** *Backward-looking.* No live branch — the working tree is clean, `main` is `f5fac57`, and
`origin` carries `main` plus the unrelated `docs/deli-hardware-design`.

| PR | Squash | What |
| --- | --- | --- |
| #6 | `b9e27b2` | A `CLAUDE.md`, and the handoff for the deployment-environment cycle |
| #8 | `f5fac57` | Groundwork for the provisioning tool: a migrations package, a `tenant_provisioner` role, and `keyring` |

42 files, +4985/−183 in #8.

---

## 1. What actually changed

**Tasks 1–3 of an eight-task plan**
([`2026-07-29-provisioning-instance.md`](../superpowers/plans/2026-07-29-provisioning-instance.md)),
landed deliberately as groundwork rather than as a working tool.

**`@waitron/migrations` exists** because the migration manifest lived inside `apps/server` and a
package must not import from an app. `instance` has to run migrations, so the alternative was a
second manifest that could disagree with the first about journal table names — which is precisely
what `manifest.test.ts`'s first assertion exists to prevent. `manifestSets`, `migrationOptionsFor`
and `applyMigrations` moved with it; `apps/server` now consumes them.

**`tenant_provisioner`** (`packages/db/drizzle/0011_provisioner_role.sql`) is a NOLOGIN bucket
holding `INSERT` on `tenants` — the one grant `app_user` deliberately lacks, so the running POS
cannot create tenants. It is also granted `app_user`, so a login role given this bucket **alone**
inherits everything else by transitive membership.

**`@waitron/provisioning` exists but ships no executable.** It carries `identifiers.ts`
(`assertIdentifier`, `quoteIdent`, `generatePassword`) and `keyring`, which generates the credential
key ring, prints it once and clears the terminal only after the operator acknowledges. It has **no
`bin` entry and no `build` script** — both were removed rather than left pointing at files Task 8
creates — and its `@waitron/db` / `@waitron/migrations` / `drizzle-orm` / `pg` dependencies were
removed because nothing imported them.

**`server.migrations_missing` became `migrations.set_missing`.** Reasoning in
`packages/migrations/src/errors.ts`; see §2.

## 2. Decisions worth not relitigating

- **`instance` first, `tenant` second.** The privilege boundary is real: in the cloud deployment
  `tenant` runs for every customer forever while `instance` runs once, and whoever onboards customer
  #47 must not hold a connection string that can create roles.
- **Wizard *and* non-interactive flags**, not one or the other. Spec §3 wants a wizard; §5 wants the
  non-secret steps agent-runnable. Both, with the secrets tty-only.
- **`instance` generates role passwords and prints them once.** Spec §5 claims it "involve[s] no
  secrets at all" — not achievable, since a LOGIN role needs a password. Resolved in the direction
  §5 wanted: secrets are *output*, never *input*, and never in `argv`.
- **`tenant_provisioner` is created by a migration, not by the CLI.** Matches how `app_user` and the
  four other support roles come into being, so the grant exists on any migrated database whether or
  not `instance` ever runs — which is what makes the no-superuser claim a property of the schema
  rather than of our tooling.
- **The error code was renamed rather than deprecated-and-added.** The never-rename rule protects
  codes that are translation keys or sit in persisted records; this one is thrown by
  `migrationOptionsFor` before the host finishes booting, so it reaches no `incidents` row and no
  display layer. `server.*` is reserved for facts about the process, and "a migration set is not
  where it should be" is a fact about the set. Renaming was free now and a permanent
  deprecate-and-add later, because Task 6 makes `waitron-provision` a second thrower.
- **Grants in `planInstance` are re-issued, not diffed** (Task 5, unbuilt).
  `information_schema.role_table_grants` cannot see database- or schema-level `CREATE` at all, and
  `has_database_privilege` answers for the recursive closure — so a role holding `CREATE` only via a
  group reads as satisfied when the direct grant is absent.

## 3. The dominant defect class, again — and it was corrections, every time

Sixteen review findings. **Almost none were bugs in code; almost all were claims in comments that
outran what the code did.** Four were written *while correcting an earlier false claim*, which is the
pattern `CLAUDE.md` §1 already names and which reproduced anyway:

1. **`bootstrap-tenant.sql` has now been corrected across four rounds.** I proved the `deployment`
   insert fails for a role holding `app_user` + `tenant_provisioner`, then wrote it as "no
   non-superuser role holds INSERT on `deployment`". A reviewer made a non-superuser the table
   **owner** and the whole script ran to completion — ownership confers it implicitly. The
   experiment was sound; the sentence generalised past it. The file now says there is **one** blocker
   (RLS on `tenants`, because the script lets `tenants.id` DEFAULT), established by running the
   script under three role shapes.
2. **The extraction turned a *true* comment false by correcting it.** The relative-migrations-root
   note said `apps/server`, which is what the bundle actually does (esbuild collapses
   `import.meta.url`). Task 1 "fixed" it to say `packages/migrations`. A fix round and a re-review
   both approved that. Caught by running the built `dist/server.js` with a relative
   `WAITRON_MIGRATIONS_DIR` and reading the resolved path out of the error.
3. **The rename justification cited a precedent that never happened** — that `tenant.not_found` had
   dropped a `server.` prefix. `git log -S` shows it was introduced under that name and never
   renamed. The same paragraph said "the one prior clean rename" where `packages/db/src/errors.ts`
   says "renamed twice".
4. **In the commit that added a carefully-hedged comment about *not* claiming persistence**, the
   `RAISE EXCEPTION` string three lines below claimed persistence ("half-provisioning it"). The
   observed experiment rolled back; nothing persisted.

**Two tests were passing for the wrong reason**, both guarding something expensive:

- The key-ring ordering test claimed to prove the screen clears only after acknowledgement. It
  stayed green with `await io.prompt(...)` changed to `void io.prompt(...)` — the exact
  fire-and-forget bug that would wipe an unrecoverable key off screen.
- Deleting `GRANT app_user TO tenant_provisioner` left its entire real-Postgres suite green, because
  the test granted that membership directly.

Both now fail under their own mutants. **Everything in §3 was found by running something.** No
reading pass caught any of it — three layers had already approved (2), and (1) survived four.

## 4. What the review layers caught, by layer

- **Four cleanup agents** (reuse / simplification / efficiency / altitude): 8 findings. Two mattered
  beyond tidiness — the unenforced `app_user` pairing, and the error-code prefix that was about to
  become permanent. Efficiency found nothing and said so.
- **Two whole-branch reviewers**: 15 findings. The altitude and correctness lenses each found things
  the other did not; the overlap was small.
- **A scoped re-review of the fix wave**: all 15 confirmed addressed, plus **one new overclaim
  introduced by the fix wave itself** (§3.4). This is the layer that would have been easiest to skip
  and the one that justified itself.
- **Copilot**: one comment, and it was worth having for the fourth consecutive PR — though its stated
  reason was wrong. It said `tsc --noEmit` would reject the JSON import in `packages/migrations`.
  Typecheck passes; `moduleResolution: "bundler"` enables `resolveJsonModule` by default. But the
  suggestion was still right, because **this same branch removed that flag from
  `apps/server/tsconfig.json`** (correctly — nothing there imports JSON any more), and a later
  cleanup pass reading the two side by side would remove this one too. Now explicit, with both
  mutation experiments recorded beside it.

## 5. What remains

**Tasks 4–8, immediately plannable — the plan is written and committed.** `readInstanceState`,
`planInstance` (pure, so every refusal is unit-testable), `applyInstance`, `status`, then the CLI +
`bin.ts` + build. Re-add `packages/provisioning`'s `bin` entry, `build` script and the four removed
dependencies alongside the code that needs them.

**A spec defect the second plan must design around.**
[`2026-07-29-provisioning-tool-design.md`](../superpowers/specs/2026-07-29-provisioning-tool-design.md)
§4 gives `tenant`'s idempotency check as "`tenants` by NIF — unique, and the natural key". **It
cannot work.** `tenants_tenant_isolation` is `USING (id = current_tenant_id())`, so a provisioning
connection with `app.tenant_id` unset reads **zero rows for a tenant that exists** — verified live.
A collision surfaces only on insert, as `23505` on `tenants_nif_key`. The spec carries a dated
pointer; the mechanism still needs replacing. Note this also undercuts §4's "provisioning creates;
it never reconciles" rule, which depends on detecting an existing tenant before acting.

**Deferred, repo-wide, needs its own task:** `errors.reachability.test.ts` **does not test
reachability**. Proven by deletion — remove `import "./errors.js"` from the barrel *and* from every
other file, and it still passes, because tsconfig `include: ["src"]` makes every file a compilation
root and `vitest run` does not typecheck at all. `packages/credentials`' original, already merged,
has the identical hole; all seven library packages carry a copy.

**Smaller, recorded during #8:**

- `0011`'s header reasoning assumed the login role always holds both bucket memberships. Now enforced
  by `GRANT app_user TO tenant_provisioner`, but nothing prevents an operator creating a role with
  only one — the DO block refuses SUPERUSER / BYPASSRLS / LOGIN / NOINHERIT, not that.
- `apps/server` function coverage sits at **98.21% against a 98 threshold**. Moving a 100%-covered
  file out of a package below 100% consumed the margin. The next uncovered function added there
  breaches CI.
- The managed-Postgres claim in `bootstrap-tenant.sql` (Neon/Supabase/RDS grant
  `CREATEDB`/`CREATEROLE` but never true superuser) is **still unverified by experiment** and is
  unverifiable from here. Recorded as unverified rather than passed.

**Older, still open:** C3 the webhook endpoint; the unguarded `afterAll` pattern across the
`.rls.test.ts` / `.concurrency.test.ts` files; `payments.stripe` unprovisioned for the deli;
**certificate renewal before 2027-10-03** with no warning mechanism. The 8 `[HUMAN]` steps in
`2026-07-28-first-aeat-submission.md` are unchanged — `keyring` now exists to do step 1, but it has
no executable until Task 8.

## 6. Environment notes new this session

- **A name-filtered test run does not load a package's guard suites.** Added to `CLAUDE.md` §2 as the
  third instance of the same false-green shape. `pnpm --filter @waitron/db test provisioner-role` was
  green while `test:coverage` failed on the same tree, because the filter never loaded
  `english-only.test.ts`, which rejected `'Venta en establecimiento'` (`venta` is in
  `SPANISH_WORDS`).
- **Renaming a branch after creating its worktree breaks `/land-branch`'s teardown.** It derives the
  worktree path from the branch name, so it looked for `waitron-feat-provisioning-cli` while the
  directory was still `waitron-provisioning-instance`. It printed `No such file or directory` and
  reported "commits: , files: 0" — which reads as an empty branch. Passing the *original* branch name
  to `worktree.py rm` found it. **Not yet in `CLAUDE.md`** — it needs its own branch.
- **The pre-push hook's log file can be days stale.** A rejected push pointed at
  `/tmp/waitron-root-test-run.log`, which was two days old and referenced
  `apps/server/src/migrations.test.ts` — a file this branch deletes. Reproducing directly showed
  `EADDRINUSE` and a green tree on two consecutive runs; the retry passed in 98s. Trusting the log
  would have meant debugging a test that no longer exists.
- **An untracked file in the main checkout can block the post-merge fast-forward.** A scratch copy of
  the plan doc, made while planning, stopped `git pull --ff-only` once the merge added the tracked
  version. Diff before deleting: the scratch copy was 2304 lines against the committed 2417.
- **Subagent dispatch failed with API 529 seven times**, killing three reviews and two fix waves
  mid-run. Two mitigations worked: resuming the same agent (its context survives), and telling it to
  **commit after each individual finding** rather than each group, so an interruption costs one
  finding instead of a batch. Task 2's verification was ultimately run inline for this reason.
