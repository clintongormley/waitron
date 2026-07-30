# Handoff — `waitron-provision` is an executable, and five defects that only running it could find

**Date:** 2026-07-30
**Type:** *Backward-looking.* No live branch — the working tree is clean apart from one untracked
handoff (see §5), `main` is `86229c8`, and `origin` carries `main` plus the unrelated
`docs/deli-hardware-design`.

| PR | Squash | What |
| --- | --- | --- |
| #11 | `86229c8` | `waitron-provision`: `instance`, `status`, and a CLI that turns a blank cluster into a Waitron database |

29 files, +4917/−48. `main` also gained #9, #7 and #10 during this cycle, all documentation and
unrelated to the branch.

---

## 1. What actually changed

**Tasks 4–8 of the eight-task plan**
([`2026-07-29-provisioning-instance.md`](../superpowers/plans/2026-07-29-provisioning-instance.md)),
completing the groundwork that landed as Tasks 1–3 in #8. **`waitron-provision` is now an
executable** — which unblocks step 1 of
[`2026-07-28-first-aeat-submission.md`](../superpowers/plans/2026-07-28-first-aeat-submission.md), a
`[HUMAN]` step that has had nothing to run since it was written.

`instance` is **read state → plan actions → apply actions**:

- **`instance-state.ts`** — `readInstanceState`. Database existence, the three LOGIN roles'
  *attributes* (not merely their names), and — only when the database exists — which migration sets
  are present and what the deployment is stamped with.
- **`instance-plan.ts`** — `planInstance`, pure. Every refusal and every idempotency rule lives here,
  where a unit test reaches it without a container. Also `describeAction` (see §2).
- **`instance-apply.ts`** — `applyInstance`, plus `verifyGrants` (see §2) and `quoteLiteral`.
- **`status-command.ts`** — `formatStatus`, a pure formatter, so the whole report is testable and
  `runCli` owns the connections.
- **`cli.ts` / `bin.ts`** — every decision behind injected IO in `cli.ts`; `bin.ts` is the process
  boundary and is coverage-excluded on that basis.
- **`sql-state.ts`** — `sqlStateOf`, a cycle-safe walk extracting a validated five-character SQLSTATE
  from a nested error cause chain.
- **`scripts/copy-migrations.mjs`**, the `bin` entry, the esbuild `build` script, and `esbuild` —
  re-added alongside the code that needs them, having been deliberately stripped in #8.

**Eleven error codes** now live in `packages/provisioning/src/errors.ts`: the two that shipped in #8
(`provisioning.invalid_identifier`, `provisioning.key_generation_failed`), plus
`deployment.unknown_environment`, `provisioning.admin_uri_missing`,
`provisioning.admin_uri_not_a_url`, `provisioning.role_over_privileged`,
`provisioning.role_unusable`, `provisioning.role_creation_failed`,
`provisioning.membership_grant_failed`, `provisioning.state_unreadable` and
`provisioning.grant_ineffective`.

**`apps/server/README.md` stops admitting its grant recipe is untested.** It is now covered end to
end, including as a non-superuser admin. The SQL recipe stays as the documented manual fallback, as
`bootstrap-tenant.sql` does.

**`CLAUDE.md` gained three entries** — GRANT semantics, empty connection strings, and what
`toMatchObject` does not check. See §6; one of them was wrong in four ways before it was rewritten.

## 2. Decisions worth not relitigating

- **`migrate` runs immediately after `create-database`, before any LOGIN role is created.** This is a
  **deviation from committed plan text**, forced by reality: the plan emitted `create-role … IN ROLE
  app_user` first, but `app_user` (`0001_tenancy_rls.sql:18`) and `tenant_provisioner`
  (`0011_provisioner_role.sql:58`) are created *by* the `core` migration set. The tool failed on its
  first end-to-end run with `role "app_user" does not exist` (42704). If the plan doc is ever
  revised, revise this too.
- **`verifyGrants` verifies after the fact rather than the planner refusing up front.** A pre-flight
  refusal would have to reimplement PostgreSQL's grant-option semantics (ownership, `WITH GRANT
  OPTION`, membership closure) to predict what the server will accept-and-no-op — more fragile than
  reading the result, and TOCTOU besides. The planner is pure and cannot probe. It reads
  `pg_database.datacl`, `pg_namespace.nspacl` and `pg_auth_members` **directly**, because
  `has_database_privilege` answers for the recursive closure.
- **`provisioning.*` was kept, and the reasoning was corrected.** `provisioning.invalid_identifier`
  and `provisioning.key_generation_failed` shipped in #8, and codes are never renamed once shipped —
  that part always held. But the *first* ruling justified it partly by claiming a mixed-prefix
  registry would be worse, which is false: `apps/server/src/errors.ts` carries six prefixes. Every
  unshipped code was then re-decided on merit and still kept `provisioning.*`;
  `state_unreadable` stayed because `deployment.*` in this repo denotes the environment **stamp**
  alone, and its real sibling is `credentials.payload_unreadable`. The file now carries the in-file
  defence every sibling with a package-shaped prefix has, and it concedes the strongest objection
  (`provision-till.ts` uses "provisioning" for something else) rather than arguing past it.
- **A non-URL admin connection string is refused, not supported.** `pg` connects happily over
  `/var/run/postgresql`; `new URL` rejects it. Rather than add conninfo support, `resolveAdminUri`
  refuses with `provisioning.admin_uri_not_a_url`. The tool **re-points that string three times**
  (target database, migrations, each printed role URI), and a mis-composed target URI would stamp the
  wrong database — unrecoverable. Half-supporting a form we cannot re-point safely is worse than
  refusing it clearly. The socket-as-URL spelling that *does* work is documented, measured.
- **The plan summary prints `Cluster: <user>@<host>:<port>`.** A deliberate loosening of "print
  nothing from the admin URI", because the residual risk after refusing an empty URI is a *wrong*
  non-empty one, and a confirmation that cannot reveal the mistake it exists to catch is weak.
  Password and query string can never reach it — checked against a 19-case adversarial battery.
- **`describeAction` lives in the pure planner**, used by both the CLI summary and `verifyGrants`'s
  failure list, so the two strings cannot drift. A separate `describe-action.ts` would avoid putting
  operator-facing English in the planner; judged a tidy, not a defect.
- **No `connectAs` assertion in Task 6's suite.** The plan decided against it with a receipt:
  `packages/db`'s `provisioner-role.rls.test.ts` already proves the grant behaviour with known
  passwords. That suite proves the provisioning, not the policy — and its comment now says only that.

## 3. Five defects that only execution found

**Not one of these was visible to a reading pass.** This is the section to read if you are tempted to
approve something on inspection.

1. **The plan's own action order was wrong** — §2 above. Found by the first end-to-end run.
2. **A `string[]` that was never an array.** `pg_roles.rolname` is PostgreSQL's `name` type, so
   `name[]` (OID 1003) has no `node-postgres` parser and arrived as the wire literal `"{}"` through a
   field declared `string[]`. Surfaced only when a review finding forced a loose `toMatchObject` into
   an exact `toEqual`. **The failure was subtler than first written up**: `String.prototype.includes`
   agrees with the array method on every input the planner actually sees, and diverges in exactly one
   shape — substring collision between role names, where `"{app_user_probe}".includes("app_user")` is
   `true`. A false *positive* that silently skips a needed `grant-membership`, not the "reads false
   forever" the first `CLAUDE.md` draft claimed.
3. **A generated password reached a thrown error**, because Drizzle wraps a failure with the full
   statement text. Found in the implementer's own RED transcript.
4. **`keyring` never parsed its arguments**, so `--admin-url=postgres://admin:hunter2@…` was silently
   accepted and exited 0 — while the README and `USAGE` both promised any such flag was a parse
   error. Found by running the built bundle, not the library.
5. **A `GRANT` PostgreSQL accepts can do nothing.** `instance` could report success having granted
   nothing. Whether an ineffective object-privilege grant is loud or silent turns on what the
   *grantor* holds; `GRANT ALL PRIVILEGES` is silent entirely. Now closed by `verifyGrants`.

Plus two found in review and one by Copilot: an **empty connection string is a valid one** (`pg`
defaults to `localhost:5432` as the OS user, so a misspelled `WAITRON_ADMIN_DATABASE_URL` plus
non-interactive stdin would have created, migrated and **stamped** a database on the local cluster);
`withDatabase` threw `TypeError` on a socket path `pg` accepts; and `CREATE ROLE … PASSWORD '…'`
interpolated the password without escaping — harmless for generated passwords but unsafe for a
library consumer, since `applyInstance` is exported and `password` is a plain `string`.

**The correction is still where false claims are born — six instances this cycle.** Three landed
during task fix rounds (a rewritten `applyMigrations` comment, a "`pg` authenticates lazily"
justification a container disproved in a minute, a teardown comment blaming a failed `DROP ROLE` on a
condition it never isolated). A fourth was caught by the wave that was *itself* narrowing overclaims.
A fifth and sixth were the two `CLAUDE.md` entries in §6. `CLAUDE.md` §1 now carries the count.

## 4. What the review layers caught, by layer

- **Per-task reviews (5).** Task 4's found the `memberOf` assertion that would have survived deleting
  the whole query — which is what uncovered defect 3.2. Task 5's came back clean and said so, having
  independently verified every `file:line` the planner's comments cite. Task 6's found the password
  leak and that the "granted" half of the suite asserted nothing.
- **Fix rounds (5 across two tasks).** Task 6 took one round of seven findings; Task 8 took three.
  **The Critical fix in Task 8's first round contained a bug of its own** — `aclHas` used `find`
  where a grantee holds one ACL entry *per grantor*, producing a spurious refusal of a working
  deployment, the exact failure the guard's justification calls worse than the gap it closes.
- **Whole-branch review.** Found the empty-admin-URI defect, and disproved a deferred item by running
  it (four failure modes inspected at depth 12 including every `cause` level — the connection string
  appears in none).
- **The re-review of the final fix wave.** Found that the wave's own corrections had introduced four
  new false claims, one in `CLAUDE.md`. **This is the layer that would have been easiest to skip and
  the one that justified itself**, for the second consecutive cycle.
- **Four cleanup agents.** Three duplicate implementations of one URI helper, a five-times-repeated
  fixture, a test that only re-verified `AppError`'s constructor, and two operator-facing messages
  that withheld information the code already had. The efficiency agent found one real thing (a second
  connection dialled to a database already open) and explicitly declined to pad the rest.
- **Copilot: three findings, all real, on its fifth consecutive PR.** One was a live bug no other
  layer caught (`withDatabase` vs a socket path — found by reading a *sibling file's* comment, which
  this branch had itself written days earlier). One was the sixth copy of a false claim the corrective
  pass had fixed in five places. One was the unescaped password literal, raised on the follow-up push.

## 5. What remains

**Five follow-ups deferred deliberately, in rough priority order:**

- **`migrate` is gated on journal-*table* existence, not on a set having finished.** An `instance`
  interrupted inside the last set leaves every journal present, so a re-run plans no `migrate`, grants,
  stamps and exits 0 — reporting a provisioned deployment where the last set's migrations never ran.
  **This is the same "reports success having done nothing" shape as defect 3.5, one file over.** The
  fix matching this package's own philosophy is to emit `migrate` unconditionally (`applyMigrations`
  is journal-tracked and idempotent) and keep `migratedSets` for the report only; the cost is an
  advisory lock per re-run. Deferred because it changes documented planner behaviour — **a product
  decision, not a cleanup.**
- **Password redaction is enforced by enumeration**, not structurally. Three statements are
  individually caught; `create-database`, both grants, `stamp` and `applyMigrations` are not. Safe
  today because only `create-role` carries a secret, but the next statement added is unsafe by
  default. One execution seam inside `applyInstance` would make the property structural.
- **`bin.ts`'s `ask()` is real logic on the coverage-excluded side** — a `Promise.race` against
  `close`, an `ABORT_ERR` mapping, a `terminal:` decision — and it has already shipped one bug with a
  severe symptom (an unsettled promise meant exit 0 for a command that never ran). Extracting
  `createTerminalIo(input, output)` would make it testable with `PassThrough`.
- **`ApplyDeps.database` and the action list are two sources of truth** for the target database. The
  types permit them to disagree, which would migrate and verify the wrong database. Moving `database`
  onto the `migrate` action removes the possibility.
- **A shared "order-tracking IO" test fixture** is built in full in both `keyring-command.test.ts` and
  `cli.test.ts`. Two copies today; a third secret-printing command makes it three. Left alone
  deliberately — those are the tests that were once found to pass for the wrong reason, so the risk of
  refactoring them exceeded the reward.

**Documented limitations, decided rather than overlooked:** a second database on one cluster prints
no connection strings (roles are cluster-global, so nothing is created and nothing can be printed); a
failed run can orphan a role holding a password that was never printed; `status` reports a journal
table's existence rather than that a set finished.

**Uncommitted, and the first thing to do next session:**
`docs/handoffs/2026-07-30-provisioning-groundwork-landed.md` is **still untracked** — it is the
handoff for the *previous* cycle, written after #8 merged and never committed. It should go in with
this one.

**Older, still open:** C3 the webhook endpoint; the unguarded `afterAll` pattern across the
`.rls.test.ts` / `.concurrency.test.ts` files; `payments.stripe` unprovisioned for the deli;
**certificate renewal before 2027-10-03** with no warning mechanism. `errors.reachability.test.ts`
still does not test reachability in any of the library packages — and `packages/provisioning` has no
copy at all, which given the above is arguably the correct state.

**The `tenant` command is still unplanned**, and the spec defect recorded in the last handoff is
unchanged: [`2026-07-29-provisioning-tool-design.md`](../superpowers/specs/2026-07-29-provisioning-tool-design.md)
§4 gives `tenant`'s idempotency check as "`tenants` by NIF", which **cannot work** —
`tenants_tenant_isolation` is `USING (id = current_tenant_id())`, so a provisioning connection with
`app.tenant_id` unset reads zero rows for a tenant that exists. A collision surfaces only on insert,
as `23505` on `tenants_nif_key`.

## 6. Environment notes new this session

- **A `GRANT` PostgreSQL accepts is not a `GRANT` that did anything**, and the entry recording that in
  `CLAUDE.md` §3 **was itself wrong in four ways** before being rewritten from a fresh container
  session: the hard-error case is harder to reach than it looks (`PUBLIC`'s default `CONNECT` counts
  as held), partial grants still land the grantable subset, a failed `GRANT` *does* change `datacl`
  (`NULL` → materialised default), and `has_*` functions **can** see the grant option via the
  `'<PRIV> WITH GRANT OPTION'` spelling. The real reason to read ACLs directly is the recursive
  closure. Role-membership grants always ERROR and are not in this family at all.
- **An empty connection string is a valid connection string.** `new Client({connectionString: ""})`
  resolves to `{host:"localhost",port:5432,user:"<OS user>"}` — the empty string is falsy, so `pg`
  parses nothing and every default applies. Anything reading a connection string from an env var or a
  prompt must refuse `""` explicitly.
- **`toMatchObject` checks only the keys you list.** Not type-blindness — a key you never list is
  never checked at all, which is how a `string` masquerading as a `string[]` survived.
- **Subagent dispatch died mid-task with a connection error once**, killing a task ~80% through. The
  mitigation from the last handoff worked exactly as recorded: **resuming the same agent recovered
  its full context**, and instructing implementers to **commit after each individual finding** meant
  the interruption cost nothing already done. Keep both habits.
- **The pre-push hook's `pnpm test` failed once and passed on retry**, with `EADDRINUSE` logged from
  `apps/server` — the Docker-contention flake `CLAUDE.md` §4 already records. Reproducing directly
  before believing the hook is the right move; `--no-verify` was not used.
- **The remote branch survived the merge for the fifth consecutive cycle.** `/land-branch`'s explicit
  delete-and-verify is still earning its place — `git ls-remote --heads origin <branch>` must print
  nothing, and this time it did only after the explicit `gh api -X DELETE`.
- **`/code-review` cannot be invoked by the model** (`disable-model-invocation`), so the
  `/finish-branch` step that calls for it was not run this cycle. The branch had per-task reviews, a
  whole-branch review, a scoped re-review of every fix wave, four cleanup agents and Copilot instead —
  but if that specific pass is wanted, a human has to type it.
