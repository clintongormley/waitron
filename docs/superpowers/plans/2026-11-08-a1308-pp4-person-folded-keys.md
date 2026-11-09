# A1308 pp4 — a person's folded name and address are required, and the unique indexes read them: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** `persons.display_name_folded` becomes required; CHECKs make `email_folded` set exactly
when `email` is, and `pending_email_folded` exactly when `pending_email` is; the four unique indexes
read the folded column directly instead of `case when folded is null then lower(raw) else folded
end`; and the four index names lose "tenant" (design U9).

**Words used here.** A *folded* value is the form two names or addresses are compared in when the
question is "has somebody already got this?": trimmed, Unicode-normalised and lower-cased
(`foldForUniqueness`, `packages/identity/src/fold.ts:21-23`). It is stored beside the raw value
because this database's `lower()` folds only A–Z.

**Architecture:** `foldForUniqueness` moves into `@waitron/db` so that every writer, test fixtures
included, can reach it; a helper `withFoldedPersonKeys(values)` fills the three folded columns of a
row from its raw columns. A committed, idempotent script wraps every direct `insert(persons).values(…)`
in that helper; the few raw-SQL person inserts are edited by hand. Then the schema tightens.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, Vitest, the root `typescript` package for the
script's parsing.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U9 ("index names such as
`persons_tenant_email_uq` drop the word"; "each other area renames its own");
[people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §1 `persons`
("CHECK `(email is null) = (email_folded is null)` and the same for display name and pending email,
so the unique indexes can read the folded column directly"), §5 (`persons` rows), §6 item 7.

**First line of the pull request:** "Every venue is reset: core; backups and exports from before
this cannot be restored or imported." (rules §2)

**Who lands:** the lane (rules §6). The script and the raw-SQL edits touch test files under
`packages/fiscal-verifactu/src/` only to add the folded name to a person insert; no fiscal code or
fiscal assertion changes (open question 2 in the area's return).

**Cites** read at `a086eedfb7`. A1002 cut 2 has removed `persons.role` and its CHECK before this
plan.

**Changed by design (named here, not stops under rules §5.3):**
`packages/identity/src/index.test.ts:19-20` expects the `persons_tenant_*` index names; it expects
the new names.

---

## What it builds

- `packages/db/src/schema/identity/fold.ts`: `foldForUniqueness` (moved, body unchanged, with its
  comment) and
  `withFoldedPersonKeys<T extends PersonInsertish | PersonInsertish[]>(values: T): T`, which sets
  `displayNameFolded`, `emailFolded`, `pendingEmailFolded` from `displayName`, `email`,
  `pendingEmail` wherever the raw value is a string and the folded key is not given, and sets the
  folded key to null where the raw value is explicitly null; and
  `withFoldedPersonChanges<T extends Partial<PersonInsertish>>(set: T): T`, the same rule for an
  update's `set` object, where any raw field may be absent (an absent raw field leaves its folded
  twin alone). A `displayName` update without it would leave a stale fold, which the unique index
  then reads. `@waitron/identity` re-exports
  `foldForUniqueness` from `@waitron/db`, so its callers do not change.
- `persons` schema (`packages/db/src/schema/identity/persons.ts`):
  - `displayNameFolded: label("display_name_folded").notNull()`.
  - `persons_email_folded_ck`: `(email is null) = (email_folded is null)`;
    `persons_pending_email_folded_ck`: `(pending_email is null) = (pending_email_folded is null)`.
  - `persons_email_uq` unique on `email_folded` where `email_folded is not null`;
    `persons_live_display_name_uq` unique on `display_name_folded` where `status <> 'suspended'`;
    `persons_google_subject_uq` unique on `google_subject` where `google_subject is not null`;
    `persons_pending_email_uq` unique on `pending_email_folded` where `pending_email_folded is not null`.
  - `foldedKey` (`:22-24`) and its comment go; `liveDisplayNameKey`, `loginEmailKey`,
    `pendingEmailKey` (`:113-121`) keep their names and return the folded column, so their callers
    do not change.
- `packages/identity/src/person-constraints.ts:14-18`: the three names the refusal translation
  matches become `persons_email_uq`, `persons_live_display_name_uq`, `persons_pending_email_uq`.
- `scripts/a1308/pp4-fold-person-inserts.mjs` and its test.
- Backlog: delete `docs/backlog/dashboard.md` "## A person row written from outside
  `packages/identity` still folds its key ASCII-only" and its line in
  `docs/backlog/architecture.md` "What A1308 retires"; in `docs/backlog/architecture.md` "## These
  index and key names still read `tenant`…" remove the four `persons_*` names and the sentences
  about them (the entry stays for the other areas' names).

## What it leaves out

| Left out | Owner |
| --- | --- |
| Folding in the database itself (an application-defined SQL function) | rejected already: a connection without it is refused an INSERT, `integrity_check` and `VACUUM` (`fold.ts:5-8`) |
| Any other table's "tenant" names | their areas (U9) |
| Person audit history | follow-up (README U11) |

## Files

- Create: `packages/db/src/schema/identity/fold.ts`, `fold.test.ts`;
  `scripts/a1308/pp4-fold-person-inserts.mjs`, `.test.mjs`.
- Modify: `packages/db/src/schema/identity/persons.ts`, `index.ts`, `packages/db/src/index.ts`,
  `packages/identity/src/fold.ts` (becomes a re-export), `packages/identity/src/person-constraints.ts`,
  `packages/identity/src/person-constraints.db.test.ts`, `packages/db/src/schema/identity/persons.test.ts`.
- Changed by the script (uncounted): every direct `insert(persons).values(` (453 calls in 330 files
  at `a086eedfb7`) and every `update(persons).set(` (240 lines with `update(persons)`) in
  `apps`, `packages`, `scripts`. That includes three product writers, which already fold and whose
  behaviour the wrap does not change: `packages/identity/src/staff.ts`,
  `packages/provisioning/src/venue-apply.ts`, `apps/server/scripts/demo-seed/seed-staff.ts`
  (`apps/server/src/mirror-session.ts` wrote the mirror viewer's person until #2592, A1113; it now
  writes no `persons` row).
- Hand edits (counted): raw-SQL `update persons set email…/pending_email…/display_name…` in tests
  (at `a086eedfb7` among them `apps/server/src/me-api.test.ts:437`,
  `packages/identity/src/account-action.test.ts:89`, `:288`, `:1064`; `git grep -n "update persons set"`
  is the list) each set the folded twin too; and raw-SQL person inserts, 15 at `a086eedfb7` in:
  `packages/fiscal-verifactu/src/drain.outage.integrity.test.ts`, `drain.test.ts`,
  `correction-amount.huella.test.ts`, `void-path.e2e.test.ts`, `reconcile.test.ts`;
  `packages/identity/src/backup-verification.test.ts`, `staff-lifecycle.test.ts`;
  `packages/workforce/src/migrations.test.ts`; `packages/provisioning/src/configuration-transfer.security.test.ts`
  (`git grep -n "into persons"` lists them).
- Generated (uncounted): core's starting migration, snapshot, epoch.
- Docs: `docs/backlog/dashboard.md`, `docs/backlog/architecture.md` (above);
  `docs/developers/conventions-data.md` only if it describes the `case when` fallback (grep
  `foldedKey\|lower(`).

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| `fold.ts` (moved function is uncounted; the helper) and re-export | 40 |
| Schema: column, two CHECKs, four indexes, key helpers | 40 |
| `person-constraints.ts` names | 6 |
| Script (inserts and updates) | 180 |
| Its test | 85 |
| Raw-SQL hand edits (inserts and the email/name updates) | 60 |
| Schema tests (CHECKs, indexes, accented names) | 140 |
| Helper tests (insert and update helpers) | 70 |
| Backlog | 15 |
| **Total** | **≈ 640** |

## Finish line

```bash
pnpm exec vitest run scripts/a1308/pp4-fold-person-inserts.test.mjs
pnpm --filter @waitron/db exec vitest run src/schema/identity
pnpm --filter @waitron/identity exec vitest run src/person-constraints.db.test.ts src/staff.test.ts \
  src/staff-lifecycle.test.ts src/staff-authority.test.ts src/account-action.test.ts src/profile.test.ts \
  src/google-oidc.test.ts src/backup-verification.test.ts src/index.test.ts
pnpm --filter @waitron/server exec vitest run src/email-settings-api.test.ts src/attendance-email-worker.test.ts src/me-api.test.ts
pnpm --filter @waitron/server exec vitest run src/boot.mirror.test.ts src/management-api.test.ts src/till-api.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts src/configuration-transfer.security.test.ts
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts src/drain.test.ts
pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/migration-upgrade.test.ts
node scripts/a1308/pp4-fold-person-inserts.mjs --write && git diff --exit-code
```

A pull request's CI tests only the packages the script and the hand edits change (most of them), not
unchanged dependents (#2619, A1461); run locally any package that writes `persons` but has no
changed file (rules §4). Read CI's result on the current head (CLAUDE.md §2).

## Expected protection-list difference

Under all six `database=venue` headers. `persons` is a change-feed source, but its column list does
not change, so `waitron_change_persons_update` does not change.

| Table | Lines | Design reason |
| --- | --- | --- |
| `persons` | `changed table persons.columns[display_name_folded].notNull` (`old: false`, `new: true`); `extra table persons.checks[persons_email_folded_ck]`; `extra table persons.checks[persons_pending_email_folded_ck]`; `missing index persons_tenant_email_uq`; `extra index persons_email_uq`; `missing index persons_tenant_live_display_name_uq`; `extra index persons_live_display_name_uq`; `missing index persons_tenant_google_subject_uq`; `extra index persons_google_subject_uq`; `missing index persons_tenant_pending_email_uq`; `extra index persons_pending_email_uq` | appendix §5: "four UNIQUE partial indexes — kept, reading the folded column directly"; §1: the new CHECKs; U9: names |

Any other line is a stop.

## Stop points (beyond rules §5)

1. A product path (not a test or seed) writes `persons` with a raw value and no folded value, found
   when the CHECK refuses it in a suite. Every product writer is in `@waitron/identity` or
   `packages/provisioning/src/venue-apply.ts` on `main` after #2592 (which removed
   `mirror-session.ts`'s viewer insert), and all fold already (backlog entry above); a third is a stop.
2. A uniqueness test changes its expected result (for example "José García" beside "JOSÉ GARCÍA"
   must still be refused, "Lopez" beside "López" still accepted).
3. The script finds an `insert(persons).values(` whose argument it cannot wrap (a spread of a
   variable typed elsewhere is fine; a call chain it cannot parse is not): it lists the file and
   exits 1; stop rather than edit by hand beyond the raw-SQL list.

## Needs

- pp1–pp3 (this area; pp3 last touched `persons` writers in `account-action.ts`).
- A1002 cut 2 (removes `role`); batch 1.

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- `foldForUniqueness`'s body does not change: the stored fold must be identical on every machine
  (`fold.ts:10-12`).
- Every commit `git commit -s`.

## Review Focus

1. **The CHECKs refuse a half-set pair** and accept both legitimate shapes (both null; both set).
2. **The refusal translation still fires** for each of the three named indexes
   (`person-constraints.db.test.ts` drives one real collision per index and reads the name back);
   a renamed index left out of `person-constraints.ts` silently stops a translation.
3. **The script only wraps**: its output changes no value a test inserts, only adds the folded keys.

---

### Task 1: The fold and the helper in `@waitron/db`

**Files:** create `packages/db/src/schema/identity/fold.ts`, `fold.test.ts`; modify `index.ts`,
`packages/db/src/index.ts`, `packages/identity/src/fold.ts`.

**Interfaces:**

```ts
export function foldForUniqueness(value: string): string;
type PersonInsertish = { displayName: string; displayNameFolded?: string; email?: string | null;
  emailFolded?: string | null; pendingEmail?: string | null; pendingEmailFolded?: string | null };
export function withFoldedPersonKeys<T extends PersonInsertish | readonly PersonInsertish[]>(values: T): T;
```

- [ ] **Step 1: Write the failing tests** (`fold.test.ts`): `"fills the three folded keys from the
  raw values"`, `"leaves a given folded key alone"`, `"sets a folded key to null when its raw value
  is null"`, `"leaves a folded key unset when its raw value is absent"`, `"folds each row of an
  array"`, `"folds José and JOSÉ to the same key and Lopez and López to different keys"`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**; make `packages/identity/src/fold.ts` re-export `foldForUniqueness` from
  `@waitron/db` (keep its comment in the new file).
- [ ] **Step 4: Run, see them pass;** run the identity suite's fold users.
- [ ] **Step 5: Commit** `git commit -s -m "Move the person fold into @waitron/db with a row helper"`.

### Task 2: The script

**Files:** create `scripts/a1308/pp4-fold-person-inserts.mjs`, `.test.mjs`.

**Interfaces:** `node scripts/a1308/pp4-fold-person-inserts.mjs [--write]`, over `git ls-files
'*.ts'` in `apps`, `packages`, `scripts` minus `**/drizzle/**`. For each call expression
`X.values(ARG)` whose receiver is a call `…insert(persons)` (the identifier `persons`, imported from
`@waitron/db`, `@waitron/identity` or a relative schema path), it replaces `ARG` with
`withFoldedPersonKeys(ARG)` unless `ARG` already is that call (one receiver spells it
`insert(schema.persons)`, `packages/identity/src/backup-verification.test.ts:88`; the script treats
a property access ending `.persons` on a namespace import of `@waitron/db` or
`@waitron/db/schema/identity.js` the same way, which is where that test's `schema` comes from), and adds
`withFoldedPersonKeys` to the file's import from `@waitron/db` (or a new import line). It skips
`packages/db/src/schema/identity/fold.ts` itself. Parse with the root `typescript` package; edit by
position, from the end.

The same script wraps the argument of `X.set(ARG)` whose receiver is `…update(persons)` in
`withFoldedPersonChanges(ARG)` (at `a086eedfb7` this covers, among others,
`apps/server/src/email-settings-api.test.ts:504`, `apps/server/src/attendance-email-worker.test.ts:485`,
`:526`, `:555`, `:585` and seven sites in `packages/identity/src/staff-authority.test.ts`, which set
`email` without its twin).

- [ ] **Step 1: Write the failing test** over temporary fixture files: `"wraps an object
  literal"`, `"wraps an array"`, `"wraps a variable"`, `"wraps an update's set"`, `"adds the import
  once"`, `"is idempotent"`, `"leaves an insert into another table alone"`, `"exits 1 naming a file
  it cannot parse"`.
- [ ] **Step 2: Run, see it fail. Step 3: Implement. Step 4: Run, see it pass.**
- [ ] **Step 5: Run it on the tree** with `--write`; typecheck the packages it changed.
- [ ] **Step 6: Edit the raw-SQL writes by hand** (Files list): each insert adds
  `display_name_folded` (and `email_folded` where it sets `email`), and each update that sets
  `email`, `pending_email` or `display_name` sets its folded twin, with the value
  `foldForUniqueness` gives for the literal (null for a null).
- [ ] **Step 7: Commit** script, test, output and hand edits as two commits: the script with its
  output (`git commit -s -m "Fold every person insert and update with a committed script (pp4)"`,
  whose body names the four product writers it wraps and says their folds were already set), then
  the hand edits (`git commit -s -m "Add folded names to the raw-SQL person writes"`).

### Task 3: The schema tightens, and the names lose "tenant"

**Files:** `packages/db/src/schema/identity/persons.ts`, `persons.test.ts`,
`packages/identity/src/person-constraints.ts`, `person-constraints.db.test.ts`.

- [ ] **Step 1: Write the failing tests** in `persons.test.ts`:
  - `"refuses a person with no folded display name"`;
  - `"refuses an email with no folded email"` and `"refuses a folded email with no email"`; the same
    two for the pending address;
  - `"accepts a person with neither email nor folded email"`;
  - `"refuses a second live person whose name folds the same (José García, JOSÉ GARCÍA)"`;
    `"accepts that name again once the first is suspended"`; `"accepts Lopez beside López"`;
  - the same accented pair for `email` and `pending_email`.
  Change `person-constraints.db.test.ts` to expect the new names read back off each refusal (it
  reads the name from the database, so this is the failing test for `person-constraints.ts`). Change `index.test.ts:19-20`'s two expected names (named above).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** the column, CHECKs, indexes, key helpers and the three names.
- [ ] **Step 4: Rebuild** core; run the finish line's db and identity runs.
- [ ] **Step 5: Commit** `git commit -s -m "Require folded person keys and index them directly"`.

### Task 4: Protection list, backlog, finish

- [ ] **Step 1:** Protection list before and after; paste and mark.
- [ ] **Step 2:** The backlog edits in "What it builds".
- [ ] **Step 3:** Run the finish line; `/finish-branch`.
