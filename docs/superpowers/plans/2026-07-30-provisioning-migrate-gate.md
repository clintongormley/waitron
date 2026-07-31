# `instance` plans a migrate on every run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `planInstance` gating the `migrate` action on journal-table existence, so an
`instance` interrupted inside a migration set is repaired by re-running `instance` instead of being
reported as a provisioned deployment.

**Architecture:** One line moves in a pure planner: the `manifestSets().some(...)` gate goes and
`{ kind: "migrate" }` is pushed unconditionally, exactly where it already sat in the action order.
`InsideState.migratedSets` survives untouched as a field only `formatStatus` reads. Everything else
in this plan is the prose and printed output that justified the gate, plus the container test that
proves the repair actually happens.

**Tech Stack:** TypeScript, vitest, Drizzle ORM 0.45.2, Testcontainers + `postgres:18-alpine`,
pnpm workspaces.

**Spec:** [`2026-07-30-provisioning-migrate-gate-design.md`](../specs/2026-07-30-provisioning-migrate-gate-design.md)

## Global Constraints

- **Worktree:** `/Users/clintongormley/workspace/worktrees/waitron-fix-provisioning-migrate-gate`,
  branch `fix/provisioning-migrate-gate`. All paths below are relative to it.
- **Every commit needs `git commit -s`.** CI's `dco` job walks the whole PR range.
- **`TESTCONTAINERS_RYUK_DISABLED=true` is required locally** for any suite that starts a container,
  or it hangs until the 180s `hookTimeout`.
- **Run the package unfiltered before believing a pass:**
  `pnpm --filter @waitron/provisioning test:coverage`. A name-filtered run does not load the
  package's cross-cutting guard suites.
- **Coverage thresholds** for this package are `statements 98 / lines 98 / functions 98 /
  branches 95`.
- **Claims in comments need a receipt** — a command that was run or a cited `file:line`. This branch
  exists because a justification outlived the code it described; do not add another. In particular
  the phrase "pre-existing" or "not a regression" requires `git log`/`git blame` first.
- **Error codes are never renamed once shipped.** No task here adds or changes one.

---

### Task 1: The planner emits `migrate` unconditionally

**Files:**

- Modify: `packages/provisioning/src/instance-plan.ts:3` (import), `:123-133` (the gate)
- Test: `packages/provisioning/src/instance-plan.test.ts:100-158`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `planInstance(state, request, password?)` returns an `InstanceAction[]` that always
  contains exactly one `{ kind: "migrate" }`, positioned after any `create-database` and before the
  first `create-role`. Task 3 relies on that guarantee.

- [ ] **Step 1: Write the failing test**

Add to `instance-plan.test.ts`, inside the existing
`describe("planInstance against a provisioned deployment", ...)` block, immediately after the
`"still plans a missing membership on an existing role"` test:

```ts
  it("plans the same migrate whatever the journals say", () => {
    // The property this replaces a gate with. `migratedSets` is journal-TABLE existence, not "the
    // set finished": Drizzle creates the journal table at
    // `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` and only opens the transaction its migrations
    // run in at `:60`, so a run interrupted inside a set leaves the journal behind and the set
    // empty. Gating on journal presence read that leftover as "done" and planned no `migrate` —
    // so the one command that could repair it granted, stamped and exited 0 against a deployment
    // whose last set never ran.
    //
    // Asserting the two plans are IDENTICAL is the point, rather than asserting `migrate` appears
    // in each: it rules out a partial fix that emits migrate for one journal shape and not another.
    const everySet = planInstance(provisioned(), REQUEST, () => "pw");
    const partial = provisioned();
    partial.inside = { migratedSets: ["core"], stamp: "preproduction" };

    expect(everySet).toContainEqual({ kind: "migrate" });
    expect(planInstance(partial, REQUEST, () => "pw")).toEqual(everySet);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-fix-provisioning-migrate-gate
pnpm --filter @waitron/provisioning test instance-plan -- -t "whatever the journals say"
```

Expected: FAIL. `everySet` is `[grant-database-create, grant-schema-create]` with no `migrate`, so
`toContainEqual` fails first.

- [ ] **Step 3: Remove the gate**

In `instance-plan.ts`, delete the `manifestSets` import on line 3:

```ts
import { manifestSets } from "@waitron/migrations";
```

Then replace the gate (currently lines 132-133) so the block reads:

```ts
  // Migrate before any LOGIN role is created — not merely before the stamp. `app_user` and
  // `tenant_provisioner`, the two NOLOGIN roles every REQUIREMENTS entry below names in `memberOf`,
  // are themselves created by the "core" migration set (0001_tenancy_rls.sql line 18,
  // 0011_provisioner_role.sql line 58), not by this tool. Emitting `create-role … IN ROLE app_user`
  // before migrate runs is not a style choice: on a blank cluster `app_user` does not exist yet, and
  // Postgres refuses the grant outright. Verified directly against a real container with this
  // ordering reversed: `create role "waitron_migrator" ... in role "app_user"` raised
  // `error: role "app_user" does not exist` (SQLSTATE 42704, acl.c:get_rolespec_tuple) — the tool
  // failed on its very first end-to-end run against a blank database.
  //
  // UNCONDITIONAL, for the reason the two grants at the bottom of this function already are. This
  // was gated on `state.inside.migratedSets`, which is journal-TABLE existence and NOT "the set
  // finished": `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` creates the journal table, and `:60`
  // only then opens the transaction the set's migrations run in — so a run interrupted inside a set
  // rolls the migrations back and leaves the journal behind. The gate read that leftover as "done",
  // planned no `migrate`, and let `instance` grant, stamp and exit 0 against a deployment whose last
  // set never ran: the same "reported success having done nothing" shape `verifyGrants`
  // (instance-apply.ts) exists to catch, one file over. Re-running the migrator instead costs one
  // advisory lock and one journal read per set (packages/migrations/src/apply.ts), and cannot be
  // wrong — `dialect.js:62` applies a migration only when the journal's watermark is behind it.
  actions.push({ kind: "migrate" });
```

- [ ] **Step 4: Correct the function's own header comment**

`planInstance`'s doc comment (currently `:85-92`) explains why the result is never empty by naming
the two grants only. That was exhaustive when it was written and no longer is. Replace the first
sentence of that paragraph:

```
 * **The result is never empty.** `migrate` and `waitron_migrator`'s two grants are all pushed
 * unconditionally — see the `migrate` push below, and "Grants are re-issued on every run rather
 * than diffed" at the bottom — so a deployment that already has everything still yields exactly
 * those three, which `instance-plan.test.ts`'s "plans the idempotent grants and a migrate" pins
 * with an exhaustive `toEqual`.
```

Leave the rest of that paragraph (the note about an earlier version contradicting `cli.ts`) intact:
it is a record of a correction and still true.

- [ ] **Step 5: Run the test to verify it passes, and see which others now fail**

```bash
pnpm --filter @waitron/provisioning test instance-plan
```

Expected: the new test PASSES. Two existing tests now FAIL, both correctly — they assert the old
behaviour:

- `"plans only the idempotent grants — no create, no migrate, no stamp"` — its exhaustive `toEqual`
  is doing exactly the job it was written for.
- `"plans a migrate when any set's journal is missing"` — still passes, but no longer discriminates.

- [ ] **Step 6: Update the two tests that pinned the gate**

Replace the `"plans only the idempotent grants — no create, no migrate, no stamp"` test
(`instance-plan.test.ts:101-111`) with:

```ts
  it("plans the idempotent grants and a migrate — no create, no stamp", () => {
    // Spec §4: running any command twice is safe. What must NOT survive a second run is anything
    // that writes something NEW — a role, a stamp. `migrate` is not in that category: it is
    // re-issued on every run for the same reason the two grants are, because the migrator is
    // journal-tracked and re-running it cannot be wrong, while a check on whether it needs running
    // can be. See instance-plan.ts's comment on the `migrate` push.
    const actions = planInstance(provisioned(), REQUEST, () => "pw");
    expect(actions).toEqual([
      { kind: "migrate" },
      { kind: "grant-database-create", role: "waitron_migrator", database: "waitron" },
      { kind: "grant-schema-create", role: "waitron_migrator", withGrantOption: true },
    ]);
  });
```

Then **delete** the `"plans a migrate when any set's journal is missing"` test
(`instance-plan.test.ts:138-158`) in full. Its remaining content — that a partially-journalled state
plans `migrate` — is now the second half of the Step 1 test, and asserted there as an equality
against the fully-journalled plan rather than on its own. A test that cannot distinguish the
behaviour it names is worse than no test.

- [ ] **Step 7: Run the whole package**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
```

Expected: PASS, coverage thresholds met. `cli.test.ts` is unaffected — no test there asserts the
action list `apply` was called with (checked: `cli.test.ts` has no `toHaveBeenCalledWith` against
`h.apply`), and its plan-summary assertions all use `toContain`.

- [ ] **Step 8: Prove the guard by deletion, in reverse**

Temporarily restore the gate (re-add the import and the `if`), run
`pnpm --filter @waitron/provisioning test instance-plan -- -t "whatever the journals say"`, and
confirm it FAILS. Then restore the unconditional push and confirm it passes again. Do not commit the
temporary state.

Expected: FAIL with the gate restored, PASS without it. If it passes with the gate restored, the
test is not testing the gate and must be fixed before proceeding.

- [ ] **Step 9: Commit**

```bash
git add packages/provisioning/src/instance-plan.ts packages/provisioning/src/instance-plan.test.ts
git commit -s -m "fix(provisioning): plan a migrate on every instance run

The gate read journal-TABLE existence as 'the set finished'. Drizzle
creates the journal table outside the transaction its migrations run in
(dialect.js:54-55 vs :60), so a run interrupted inside a set left the
journal behind and the set empty -- and the next run then granted,
stamped and exited 0 against a deployment whose last set never ran.

migrate is now emitted unconditionally, for the reason the two grants
already are: the migrator is journal-tracked and idempotent, and a check
that can be wrong is worse than a redo that cannot."
```

---

### Task 2: The prose and printed output that justified the gate

**Files:**

- Modify: `packages/provisioning/src/instance-plan.ts` (`describeAction`'s `migrate` case, ~`:245-246`)
- Modify: `packages/provisioning/src/instance-state.ts:36-38`
- Modify: `packages/provisioning/src/status-command.ts:40-66`
- Modify: `packages/provisioning/README.md:109-115`
- Modify: `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md` (§4)
- Test: `packages/provisioning/src/status-command.test.ts:78-92`,
  `packages/provisioning/src/cli.test.ts:30-40` and a new test beside `:272`

**Interfaces:**

- Consumes: Task 1's unconditional `{ kind: "migrate" }`.
- Produces: `describeAction({ kind: "migrate" })` returns the exact string
  `"apply any pending migrations, in every set"`. Task 3 does not depend on it.

- [ ] **Step 1: Write the failing tests**

In `status-command.test.ts`, replace the `"reports a journal's existence, never that a set finished"`
test (`:78-92`) with:

```ts
  it("reports a journal's existence, never that a set finished", () => {
    // `readInside` reads `to_regclass('public.<journal table>')` and nothing else
    // (instance-state.ts), and Drizzle creates that table BEFORE applying any of the set's
    // migrations, then applies them all inside ONE transaction —
    // `drizzle-orm@0.45.2/pg-core/dialect.js:54-60`, with `migrationsSchema: "public"` set at
    // `packages/db/src/migrate.ts:42`, which is the schema this probe looks in. So an `instance`
    // interrupted inside the LAST set leaves all five journals present and zero of that set's
    // migrations applied. That much has not changed, and a line reading "applied" would still claim
    // a certainty the read cannot support.
    //
    // What HAS changed is the remedy. `planInstance` no longer gates `migrate` on journal presence,
    // so re-running `instance` repairs exactly this state. The report used to send the operator to
    // the host's next boot instead, because it was the only thing that would fix it.
    const text = formatStatus(PROVISIONED).join("\n");
    expect(text).toContain("migration set core: journal present");
    expect(text).toContain("migration set scheduler: journal absent");
    expect(text).toContain("was started, not that it finished");
    // The remedy, and the retired claim. Asserting the OLD sentence is gone matters as much as
    // asserting the new one is present: this text is printed to an operator, and a stale
    // "instance plans a migrate only when a journal is MISSING" would send them somewhere else.
    expect(text).toContain("waitron-provision instance");
    expect(text).not.toMatch(/only when a journal is MISSING/i);
  });
```

In `cli.test.ts`, add beside the existing `"prints a plan summary and applies NOTHING when the
operator declines"` test (`:272`):

```ts
  it("shows a migrate in the plan for an already-provisioned deployment", async () => {
    // The operator-facing half of the gate removal. `PROVISIONED` has every manifest set journalled
    // and the stamp already correct, which is the state that used to plan nothing but two grants.
    // The wording is asserted verbatim because it is what an operator reads before typing `y`
    // against a live cluster: "apply every migration set" invited the reading that the tool was
    // about to re-run all of them.
    const h = harness({ answers: ["n"], state: PROVISIONED, env: { WAITRON_ADMIN_DATABASE_URL: ADMIN_URI } });
    await runCli(["instance", "--database", DATABASE, "--environment", "preproduction"], h.deps);
    expect(h.lines.join("\n")).toContain("apply any pending migrations, in every set");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @waitron/provisioning test status-command cli
```

Expected: FAIL. The `status-command` test fails on `toContain("waitron-provision instance")` and on
the `not.toMatch` — the retired sentence is still printed. The `cli` test fails because
`describeAction` still returns `"apply every migration set"`.

- [ ] **Step 3: Change `describeAction`**

In `instance-plan.ts`, the `migrate` case of `describeAction`:

```ts
    case "migrate":
      // Not "apply every migration set". Every set IS handed to the migrator, but Drizzle applies
      // only what its journal's watermark is behind (`dialect.js:62`), and this line is now printed
      // on EVERY run — including a fully-migrated no-op, since the planner stopped gating on
      // journal presence. A line that reads as "re-run all migrations" on a plan an operator is
      // confirming against a live production cluster claims more than the code does.
      return "apply any pending migrations, in every set";
```

- [ ] **Step 4: Rewrite `instance-state.ts`'s `migratedSets` doc comment**

Replace lines 36-38:

```ts
  /** Manifest set names whose journal table is present. Not "which migrations ran" — Drizzle creates
   * the journal table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` and only then opens the
   * transaction the set's migrations run in (`:60`), so a journal can outlive a rolled-back set.
   *
   * REPORT ONLY. `formatStatus` (status-command.ts) is the sole consumer. `planInstance` read this
   * to decide whether to emit `migrate` and no longer does — that gate is exactly what the sentence
   * above made unsound. */
  migratedSets: string[];
```

- [ ] **Step 5: Rewrite `status-command.ts`'s comment and its printed caveat**

Replace the comment at `:40-53` and the printed lines at `:61-66`:

```ts
  // "journal present", not "applied". `InsideState.migratedSets` is the set names whose journal
  // TABLE exists (instance-state.ts says so at its own declaration), and that is strictly weaker
  // than "every migration in the set ran": `drizzle-orm@0.45.2/pg-core/dialect.js:54-60` creates
  // the journal table first and only then applies the set's migrations, all inside one
  // transaction, and `packages/db/src/migrate.ts:42` puts that table in `public`, which is where
  // `readInside`'s `to_regclass` probe looks. An `instance` interrupted inside the last set
  // therefore leaves every journal present and that set incomplete — on a first provision, with
  // none of its migrations applied at all, since they share the one transaction.
  //
  // This report still cannot distinguish that state from a complete deployment. What it can now do
  // is name a remedy that works: `planInstance` emits `migrate` unconditionally, so re-running
  // `instance` applies whatever is pending. The previous wording said the opposite — that
  // `instance` would NOT repair it, because it planned a migrate only when a journal was missing —
  // and sent the operator to wait for the host's next boot instead.
  const journalled = new Set(state.inside.migratedSets);
  lines.push("");
  for (const set of manifestSets()) {
    lines.push(
      `migration set ${set.name}: ${journalled.has(set.name) ? "journal present" : "journal absent"}`,
    );
  }
  lines.push(
    "",
    "A journal table is created before its set's migrations run, so `journal present` means",
    "the set was started, not that it finished. This report cannot tell the two apart.",
    "Re-running `waitron-provision instance` applies anything still pending; so does the",
    "host at its next boot.",
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @waitron/provisioning test status-command cli instance-plan
```

Expected: PASS.

- [ ] **Step 7: Correct `README.md:109-115`**

Replace that paragraph with:

```markdown
**`journal present` is not `applied`, and the report says so.** All this command can read is whether
each set's journal TABLE exists. Drizzle creates that table _before_ running the set's migrations
(`drizzle-orm@0.45.2/pg-core/dialect.js:54-60`), so an `instance` interrupted inside the last set
leaves every journal present and that set incomplete. `status` cannot tell that apart from a complete
deployment — but re-running `instance` repairs it, because the planner emits `migrate` on every run
rather than only when a journal is missing. The host does the same at its next boot
(`apps/server/src/boot.ts:116`). Nothing here is dangerous; it is simply less than "applied" would
claim.
```

Also correct the fixture comment at `cli.test.ts:30-31`, which now states the opposite of the
behaviour:

```ts
/** Everything exists and agrees. `migratedSets` is built from the manifest rather than spelled
 * out so it tracks a newly added migration package — but note the plan still carries a `migrate`
 * regardless, because `planInstance` no longer gates on journal presence. */
```

- [ ] **Step 8: Add the dated note to the design spec**

In `docs/superpowers/specs/2026-07-29-provisioning-tool-design.md`, immediately below §4's `instance`
table, add:

```markdown
> **Implementation note, 2026-07-30.** The Migrations row above delegates idempotency to "the
> migrator's existing advisory lock and journal", and the code shipped in #11 did not: `planInstance`
> added a second gate in front of it, on journal-TABLE existence, which is weaker than "the set
> finished" and let an interrupted provision be reported as complete. The gate was removed on
> `fix/provisioning-migrate-gate`; `migrate` is now emitted on every run, as this row always
> described. See [`2026-07-30-provisioning-migrate-gate-design.md`](2026-07-30-provisioning-migrate-gate-design.md).
```

- [ ] **Step 9: Run the full package and format**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
pnpm format:check
```

Expected: both PASS. If `format:check` fails, run `npx prettier --write` on the files listed above.

- [ ] **Step 10: Commit**

```bash
git add packages/provisioning/src packages/provisioning/README.md docs/superpowers/specs
git commit -s -m "docs(provisioning): retire the justification the migrate gate rested on

Three places said instance would not repair an interrupted set because
it planned a migrate only when a journal was missing. One of them is
printed to the operator. All three now name the re-run as the remedy.

describeAction says 'apply any pending migrations, in every set' rather
than 'apply every migration set': the line is printed on every run now,
including no-ops, and the old wording read as 're-run all migrations' on
a plan being confirmed against a live cluster."
```

---

### Task 3: The container test that proves the repair

**Files:**

- Modify: `packages/provisioning/src/instance-apply.rls.test.ts` (the `deps` helper at `:43-56`, and
  a new test appended to the `describe` block that ends at `:427`)

**Interfaces:**

- Consumes: Task 1's guarantee that `planInstance` always emits `migrate`.
- Produces: nothing later tasks use.

**Context an implementer needs:** this suite starts ONE `postgres:18-alpine` container in
`beforeAll` and shares it. `admin` is `prov_admin`, a non-superuser `login createdb createrole` role;
`adminUri` is its connection string. The existing tests all operate on the database named by the
module-level `DATABASE` constant (`waitron_instance_suite`). **The new test must use its own
database** so it cannot disturb them, and must drop it in a `finally` so the suite stays
order-independent rather than order-reliant.

The last manifest set is `credentials` (`packages/migrations/migrations.manifest.json`), its journal
table is `__drizzle_migrations_credentials`, and its migrations create `tenant_credentials`
(`packages/credentials/drizzle/0000_credentials.sql`). Read those from `manifestSets()` rather than
hardcoding the names, so adding a sixth set does not silently retarget the test.

- [ ] **Step 1: Let `deps` name a database**

The helper is hardcoded to `DATABASE`. Add an optional second parameter — every existing call site
keeps working unchanged:

```ts
  function deps(as: Database, database: string = DATABASE): ApplyDeps {
    return {
      admin: as,
      database,
      adminUri,
      migrationsRoot: null,
      // This suite OWNS every target connection it hands over, so `release` closes it — the
      // opposite end of the contract from `cli.ts`, which lends one `withState` closes.
      openTarget: async () => {
        const db = await createPostgresDb(withDatabase(adminUri, database));
        return { db, release: () => db.close() };
      },
    };
  }
```

- [ ] **Step 2: Write the failing test**

Add these imports at the top of the file:

```ts
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
```

Append this test to the `describe("applyInstance against a blank container", ...)` block:

```ts
  it("repairs a set whose journal survived a rolled-back migration", async () => {
    // The defect the migrate gate left open, end to end. `migratedSets` is journal-TABLE existence,
    // and Drizzle creates that table at `drizzle-orm@0.45.2/pg-core/dialect.js:54-55` — OUTSIDE the
    // transaction it opens at `:60` for the set's migrations. So an `instance` killed inside a set
    // rolls the migrations back and leaves the journal behind: every journal present, one set
    // empty. The old planner read that as "done", planned no `migrate`, and let this command grant,
    // stamp and exit 0 against a deployment whose last set had never run.
    //
    // Built FORWARDS rather than by damaging a migrated database. Damaging one would need each
    // set's table list and would have to respect the foreign keys `packages/migrations/src/apply.ts`
    // records (core carries `tenants`, which every other set references), and none of that is under
    // test. The simpler-looking variant — pre-create all five journals against an empty database —
    // does NOT reproduce this defect: `deployment` is itself created by a migration, and
    // `stampDeployment` INSERTs into it after `readDeploymentEnvironment` returns null for an absent
    // table (`packages/db/src/deployment.ts:39-41`), so the old tool would have FAILED on the stamp
    // rather than exiting 0. A test built that way would pass while demonstrating the wrong thing.
    const database = "waitron_interrupted_suite";
    const sets = manifestSets();
    const last = sets[sets.length - 1];
    if (last === undefined) throw new Error("the manifest is empty");

    await admin.execute(sql.raw(`create database ${quoteIdent(database)}`));
    try {
      // Every set but the last, applied for real by the real migrator.
      await applyMigrations(
        withDatabase(adminUri, database),
        migrationOptionsFor(sets.slice(0, -1), null),
      );

      const target = await createPostgresDb(withDatabase(adminUri, database));
      try {
        // The last set's journal, by hand, in Drizzle's own shape (`dialect.js:48-51`) and with no
        // rows — which is exactly what the rolled-back transaction leaves behind.
        await target.execute(
          sql.raw(
            `create table ${quoteIdent(last.table)} (
               id serial primary key, hash text not null, created_at bigint
             )`,
          ),
        );

        const state = await readInstanceState(admin, database, target);
        // The precondition, asserted rather than assumed: every journal reads as present, so the
        // OLD planner would have seen nothing to do here.
        expect(state.inside?.migratedSets).toEqual(sets.map((set) => set.name));
        // And the set really is empty — no table of its own yet.
        const before = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.tenant_credentials') is not null as present`,
        );
        expect(before.rows[0]?.present).toBe(false);

        const request = { database, environment: "preproduction" } as const;
        const actions = planInstance(state, request);
        expect(actions).toContainEqual({ kind: "migrate" });

        await applyInstance(actions, deps(admin, database));

        // Assert against the SCHEMA, not the journal: journal presence is the very signal being
        // shown to be insufficient, so re-reading it would prove nothing.
        const after = await target.execute<{ present: boolean }>(
          sql`select to_regclass('public.tenant_credentials') is not null as present`,
        );
        expect(after.rows[0]?.present).toBe(true);
      } finally {
        await target.close();
      }
    } finally {
      // In a `finally` so the suite stays order-independent. `admin` is connected to another
      // database in the same cluster, so it can drop this one.
      await admin.execute(sql.raw(`drop database if exists ${quoteIdent(database)} with (force)`));
    }
  });
```

- [ ] **Step 3: Run the test against the OLD planner to confirm it catches the defect**

This is the deletion proof, and it is the whole reason this test exists. Temporarily restore the gate
in `instance-plan.ts` (re-add the `manifestSets` import and the `if`), then:

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-fix-provisioning-migrate-gate
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls -- -t "rolled-back migration"
```

Expected: FAIL at `expect(actions).toContainEqual({ kind: "migrate" })`. If it fails somewhere
earlier — for instance at the `migratedSets` precondition — the fixture is not reproducing the state
it claims to, and must be fixed before proceeding. Restore the unconditional push afterwards.

- [ ] **Step 4: Run it against the new planner**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls -- -t "rolled-back migration"
```

Expected: PASS.

- [ ] **Step 5: Run the whole package unfiltered**

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
```

Expected: PASS, thresholds met. Confirm the pre-existing tests on `waitron_instance_suite` still
pass — the new database name must not collide.

- [ ] **Step 6: Commit**

```bash
git add packages/provisioning/src/instance-apply.rls.test.ts
git commit -s -m "test(provisioning): prove instance repairs a set with an orphaned journal

Builds the post-rollback state forwards: every set but the last applied
by the real migrator, then the last set's journal created by hand in
Drizzle's shape with no rows. Every journal reads as present and one set
is empty -- the state the old planner reported as provisioned.

Confirmed to fail with the gate restored, at the assertion that the plan
contains a migrate."
```

---

### Task 4: Settle the one consequence the spec left unverified

**Files:**

- Modify: `packages/provisioning/src/instance-apply.rls.test.ts` (only if the reproduction succeeds)
- Modify: `docs/superpowers/specs/2026-07-30-provisioning-migrate-gate-design.md` §4

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: nothing.

**The question.** After this change, an admin that can READ inside the target database but cannot
CREATE objects in it now attempts migrations where a fully-journalled re-run previously planned none
and exited 0. `cli.ts:283-287` records that an admin which did not create the target fails the stamp
READ with 42501 and never reaches the planner — but that receipt covers a different, fully
unprivileged admin. **Whether a partially-privileged one exists in practice is not known, and §1 of
`CLAUDE.md` forbids settling it by reading.** This task runs it.

- [ ] **Step 1: Build the probe**

Write a scratch test in the existing container suite (do not commit it yet). It needs a role that can
connect to the target database and select from `deployment`, but cannot create objects in `public`:

```ts
  it("SCRATCH: partially-privileged admin", async () => {
    // `partial_admin` can reach the target database and read `deployment`, but holds no CREATE on
    // its `public` schema and does not own it. That is the shape the spec could not settle by
    // reading: enough privilege to get past `withState`'s state read, not enough to migrate.
    await admin.execute(sql.raw(`drop role if exists partial_admin`));
    await admin.execute(sql.raw(`create role partial_admin login createdb createrole password 'p'`));
    await admin.execute(
      sql.raw(`grant connect on database ${quoteIdent(DATABASE)} to partial_admin`),
    );

    const owner = await createPostgresDb(withDatabase(adminUri, DATABASE));
    try {
      await owner.execute(sql.raw(`grant select on deployment to partial_admin`));
      // Deliberately NO `grant create on schema public to partial_admin`.
    } finally {
      await owner.close();
    }

    const probeUri = roleUrl(withDatabase(pg.uri, DATABASE), "partial_admin", "p");
    // TWO handles: `readInstanceState` takes an admin connection AND a target connection, and both
    // must be this role for the probe to mean anything. Closed in a `finally` each.
    const probeAdmin = await createPostgresDb(probeUri);
    try {
      const probeTarget = await createPostgresDb(probeUri);
      try {
        const state = await readInstanceState(probeAdmin, DATABASE, probeTarget);
        console.log("STATE READ SUCCEEDED:", JSON.stringify(state.inside));
        const request = { database: DATABASE, environment: "preproduction" } as const;
        await applyInstance(planInstance(state, request), deps(probeAdmin));
        console.log("APPLY SUCCEEDED");
      } catch (error) {
        console.log("FAILED:", error);
      } finally {
        await probeTarget.close();
      }
    } finally {
      await probeAdmin.close();
      await admin.execute(sql.raw(`drop role if exists partial_admin`));
    }
  });
```

Run it and **read the actual output**. `console.log` rather than assertions is deliberate: the point
is to discover which of three things happens, and an assertion would presuppose the answer.

```bash
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test instance-apply.rls -- -t "SCRATCH"
```

- [ ] **Step 2: Decide from what the container actually printed**

Exactly one of these, chosen by the output and not by expectation:

- **The state read fails** (`provisioning.state_unreadable`, or a raw 42501 before the planner
  runs) → the consequence is unreachable: such an admin never gets far enough to attempt a migrate.
  Delete the scratch test. Record the finding in the spec.
- **The state read succeeds and the apply fails** → the consequence is real. Keep the probe, turn it
  into a proper named test asserting the observed error, and record the finding.
- **Both succeed** → the premise was wrong and the migration ran under a role that could not create
  objects, which itself needs explaining before anything is written down.

- [ ] **Step 3: Replace §4's placeholder in the spec with what was measured**

In `docs/superpowers/specs/2026-07-30-provisioning-migrate-gate-design.md`, replace the paragraph
beginning **"Implementation must therefore do one of two things and say which"** with the finding —
the exact SQLSTATE, the exact error, and the command that produced it. If the reproduction was
inconclusive, say that plainly and leave the consequence marked unverified rather than upgrading a
guess.

Do not write "as expected" or "confirmed" unless the transcript shows it.

- [ ] **Step 4: Run the full gate**

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-fix-provisioning-migrate-gate
pnpm install
TESTCONTAINERS_RYUK_DISABLED=true pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

Expected: PASS. `EADDRINUSE` from `apps/server` is the known Docker-contention flake — reproduce the
failing command directly before believing it, and retry once.

- [ ] **Step 5: Commit**

Use the message matching Step 2's outcome. Do not blend them.

**If the state read failed first (consequence unreachable):**

```bash
git add docs/superpowers/specs
git commit -s -m "docs(provisioning): the partially-privileged admin never reaches migrate

Measured on postgres:18-alpine: a role holding CONNECT and SELECT on
deployment but no CREATE on public failed at the state read with
<SQLSTATE>, so it is refused before planInstance is called. The spec's
open consequence is closed as unreachable rather than as unverified."
```

**If the state read succeeded and the apply failed (consequence real):**

```bash
git add packages/provisioning/src/instance-apply.rls.test.ts docs/superpowers/specs
git commit -s -m "test(provisioning): pin the partially-privileged admin's migrate failure

Measured on postgres:18-alpine: a role holding CONNECT and SELECT on
deployment but no CREATE on public reads state successfully and then
fails the migrate with <SQLSTATE> <message>. Before this branch such a
re-run planned no migrate and exited 0, so this is a behaviour change
and is now pinned rather than described."
```

**If the reproduction was inconclusive:**

```bash
git add docs/superpowers/specs
git commit -s -m "docs(provisioning): partially-privileged admin remains unverified

The probe did not isolate the shape the spec describes: <what happened>.
Recording it as still unverified rather than upgrading a guess. The
consequence stands as written in the design's section 4."
```

---

## Done when

- `planInstance` emits `migrate` on every run, proven by a test that fails when the gate is restored.
- No comment, README paragraph or printed line still says `instance` repairs only a missing journal.
- A container test reproduces the orphaned-journal state and shows `instance` repairing it, and is
  confirmed to fail against the old planner.
- The spec's unverified consequence is either reproduced or explicitly recorded as still unverified.
- `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test` passes from the repo root, and
  `pnpm --filter @waitron/provisioning test:coverage` passes unfiltered.
