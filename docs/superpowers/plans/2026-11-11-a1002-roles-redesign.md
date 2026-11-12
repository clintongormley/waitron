# A1002 access roles and job roles — implementation plan

**Status: APPROVED by the owner, 2026-11-11**, after the fresh-context plan-against-design read
and the Fable second read. The owner's words: "approve", typed at 21:46 Madrid time (20:46:54 UTC)
in the owner's main-checkout Claude session (`a914fa5c-626b-4ca9-a682-f12947d87788`), in answer to
this revision's PR list and 40–50 hour estimate. Queued to lane K.
**Revision 3, 2026-11-11 evening:** the fresh-context read's findings, the Fable read
(`~/waitron-campaign-m/reports/ra.md`) and the owner's answers to its proposals (recorded in the
design by `e69416d2cd`) are applied: eighteen pull requests, re-sized from source on `c00b1a6f39`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Replace the four fixed levels with access roles (ticked permissions, several per person,
Admin always everything) and core job roles (rota and device sign-in, no permissions), as the
owner-approved 11 November design states.

**Architecture:** Eighteen pull requests, each leaving `main` working. The first eight change what
needs no new storage for access roles: permission declarations without the ladder, comps by
permission and limit, job roles moved into core, device sign-in by job role (with the test, demo
and import fixtures that must change first). The next three move every permission check and every
reader of a level onto identity, then replace `persons.role` with stored roles. The last seven add
the two rules, the email-change safeguards, several roles per person, custom roles and their page.

**Tech Stack:** TypeScript, pnpm workspace, drizzle on `node:sqlite`, Hono routes, Lit `wt-*`
components, Vitest (node and browser mode).

**Spec:** [2026-11-11 roles redesign](../specs/2026-11-11-a1002-roles-redesign-design.md), which
replaces the [7 November design](../specs/2026-10-22-a1002-custom-roles-design.md) except where its
§9 says "kept". Cut 1 (#2578, the permission renames) has landed and is not re-planned.

## In plain English first

Today a person has one of four levels and each level holds everything below it. After this work:

- A person can hold any number of **access roles**. What they may do is everything those roles
  tick. Staff, Supervisor, Manager and Admin always exist; the first three can have their ticks
  changed, Admin always has everything. A venue can add its own access roles.
- A person can hold any number of **job roles** (Waiter, Chef…). Job roles put people on the rota
  and on the sign-in screen of the devices that take that job. They grant nothing.
- Comps stop naming roles: holding "apply comps" lets you comp up to the reason's limit; past it,
  someone holding "approve comps" enters their PIN. A limit of zero means "always needs approval".
- Two rules stop anyone handing out more than they hold: you can give or take an access role only
  if you hold every permission in it; you can change another person's sign-in only if you hold
  every permission they hold. Changing an existing person's email also needs its own permission
  (Admin only by default), is logged, and tells the old address.
- Any change to a person's access roles expires their outstanding invitation and reset links.

## Global constraints

- Pre-live: no data-migration or compatibility code. A schema change edits the TypeScript schema
  and runs `pnpm --filter @waitron/server migration-baseline rebuild --set <name>`; the PR's first
  line says "Existing test venues must be reset: this rebuilds the `core` (or named) starting
  migration."
- After any schema change run, and read the `Tests` count of:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/module-graph-honesty.test.ts scripts/write-path-tables.test.ts scripts/migration-upgrade.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- Any PR that changes an exported table's columns or which module's transfer carries it raises the
  configuration bundle version by one above main's at build time (today
  `packages/provisioning/src/configuration-transfer.ts:559`, `value.version !== 18`), and updates
  `packages/provisioning/src/configuration-transfer.boundaries.test.ts`'s future-version input.
- Import-into-a-venue tests live in `apps/server/src/configuration-transfer.test.ts` (it has a
  database); `packages/provisioning/src/configuration-import.test.ts` tests only the staged file.
- **The import keeps the importing administrator's memberships.** Import runs inside first setup,
  after the administrator exists, and empties every transferred table before inserting the
  bundle's (`configuration-transfer.ts:848-860`), skipping the exporting administrator's rows
  (`:872-881`). From PR 6 the importing administrator is given the job roles the exporting
  administrator held, or every imported job role if they held none; from PR 11 they keep their
  Admin membership.
- Built-in access role keys are exactly `staff`, `supervisor`, `manager`, `admin`. Their names are
  translated in code and never stored. Custom names are trimmed, nonempty, unique under
  `foldForUniqueness` (`packages/identity/src/fold.ts`), stored literally, never translated.
- Admin holds every **declared** permission, including ones declared later; it stores none. An
  undeclared permission ID authorizes nobody, Admin included. Saved and imported permission lists
  refuse an undeclared ID. Rule 1 compares **declared** permissions only, so a stored retired ID
  never locks a role.
- **A usable Admin** is a distinct person who holds the Admin access role, is `active`, and has a
  password hash, a Google subject or a WebAuthn credential. PIN-only, pending and suspended people
  do not count. (No email condition: a Google or passkey sign-in needs none.)
- **Links:** any change to a person's access roles expires their outstanding account actions with
  today's `invalidatePersonAccountActions` (`packages/identity/src/staff.ts:158`), which marks every
  unused action used (invitation, password reset, and a pending email-change proof); email or
  status changes keep `revokePersonAccess`. There is no sender column and no check of who sent a
  link (owner, option B).
- **PINs:** nobody sets another person's PIN; an administrator can only clear it (owner, option A).
  Adding a person needs an email, as today.
- One `withTransaction` per mutation; queries inside it are awaited in turn, never `Promise.all`.
  From PR 13, every mutation that can remove Admin from someone, suspend, reset to pending, remove
  a sign-in method, delete a role or import ends with the usable-Admin check before commit.
- Activity entries go through `recordActivity` (`packages/db/src/activity-log.ts`) with kinds
  declared in `packages/db/src/activity-kinds.ts`; `data` names people by id only and holds no
  email address. Mail goes through `enqueueMail` (`packages/db/src/outgoing-mail.ts`) in the same
  transaction. Job-role changes are never emailed. Setup and import log baseline memberships and
  email nothing.
- Every new error code is declared in its package's `errors.ts` and worded in English and Spanish
  where a screen shows it (`apps/dashboard/src/i18n/codes.ts`, `apps/till/src/i18n/strings.ts`).
  A refusal says what happened and what each choice does (CLAUDE.md §3).
- Forms follow design-system Forms: `draftScopeFor`, `saveActionState`, an unchanged-draft early
  return, inline errors, one localized message above the buttons. No screen draws a native field.
  Permission ticks and device job-role ticks are `wt-switch` rows; role tags on the staff editor
  are a `wt-combobox` with `multiple`.
- Every screen change updates `apps/server/src/guide/en/*.md` and `apps/server/src/guide/es/*.md`
  with shared `{#id}` headings; help bubbles are `wt-help-tooltip mode="help-mode"`, written from
  the code that does what they describe, and link to the guide.
- Each PR updates `docs/backlog.md` and its area files in the same change that makes an entry
  stale; the last PR deletes A1002's build entries.
- English-only code and fixtures; Spanish starter text only in a package's `src/starter-content.ts`.
- TDD: each behaviour step starts with a test that fails for the stated reason; run it and see it
  fail before writing code. Rewritten tests keep their behavioural assertions. Rejected writes
  assert the domain error code.
- Focused tests locally; CI runs the package suites. Do not hand-run the pre-push hook's checks.
- Every task is sized for well under 100 implementer tool calls. Implementers stop at about 150
  with a commit and a handover (done, left, files, each check's state).

## Review focus

The inputs most likely to bite a person that no task's main tests would otherwise exercise. Each
has a test in the task named after it.

1. **A Manager pointing someone's email at an address they read.** From PR 15 Managers hold
   `person.admin`. Changing an existing person's email needs `person.email` (Admin-only) as well as
   Rule 2, and each change is logged and the old address told. Tasks 12.1, 13.2, 15.1.
2. **The last usable Admin, by every path.** Removing a membership (through the staff form's role
   field before PR 14, through the new command after), deleting a role, suspending, resetting to
   pending, removing the last passkey, unlinking one's own Google sign-in, and import. Tasks 13.1,
   14.1, 16.1.
3. **Every till still signs in after the admission rule flips**: test fixtures, the demo, the bench,
   a box set up from an export. Today a profile with no admission rows admits everyone; afterwards
   nobody. Tasks 5.x, 6.x, 7.2.
4. **A zero limit with a rounding allowance.** A 0% item limit on a dish whose allowance is 2 cents
   must still need approval for a 1-cent reduction (`belowFloor`,
   `packages/adjustments/src/policy.ts:255-266`, would let it through). Task 2.1.
5. **A person with no access role signing in to the dashboard.** They reach their own pages, never a
   refusal loop or a signed-out shell. Tasks 10.2 and 15.3.

## Sizing

### What was counted, and how

Counted on `0740fbf6b3` (first draft) and rechecked on `ed1ef72ef4` and `c00b1a6f39` with
`git grep` (`/usr/bin/grep` for counts); the Fable read recounted five of these and they match.

- The brief's identifier set touches **326 files: 97 production, 229 test or helper**.
- Tests that create people: **490 `insert(persons)` sites in 356 files**, **97 `update … set role`
  sites in 57 files**, **72 `persons.role` reads in 43 files**.
- Tests that create device profiles: **205 `insert(deviceProfiles)` sites in 121 test or helper
  files**, plus **344 `seedDevice(` calls in 134 files** through one helper
  (`packages/db/src/testing/seed.ts:148`).
- Raw SQL that reads a level outside identity: `apps/server/src/recovery-environment.ts:133`,
  `packages/provisioning/src/recover-provisioned-venue.ts:49`, `packages/provisioning/src/configuration-transfer.ts:853`,
  `apps/server/src/handover-compare.ts:390`, `packages/workforce/src/corrections.ts:35`,
  `apps/server/src/testing/bill-venue.ts:324`.
- Dashboard tests with a `role: "<level>"` literal (mostly `/me` and staff-list mocks): **52 files**.
- Per area, production/test files: permission registrations 8/52; `mirror.create|node.promote`
  15/20; staff-role tables 41/58; device admission 18/40; comp role lists 26/77; permission-check
  call sites 89/31.
- Generated files, from two earlier rebuilds: adding one table rewrote 266 generated lines
  (`417612a422`); dropping workforce columns about 580 (`8cc7a2680a`).
- Files read in full or in large part: the two designs; `packages/identity/src/{permissions,staff,profile-admission,authorize,management-session,credential,account-action,profile}.ts`;
  `packages/staffing/src/{staff-roles,routes,classification,backup-verification}.ts`;
  `packages/adjustments/src/{policy,settings,provisioning}.ts`;
  `packages/db/src/schema/{identity/*,adjustments/reasons,outgoing-mail}.ts`; `packages/workforce/src/schema/staffing/staffing.ts`;
  `packages/workforce/src/{corrections,attendance-response-commands}.ts` (parts);
  `packages/db/src/{activity-log,activity-kinds,outgoing-mail}.ts`, `packages/db/src/testing/seed.ts`;
  `apps/server/src/{mail-sender,box-alert-mail,me-api,box-health-api,till-box-clock-api,adjustments-api,device,recovery-environment}.ts` (parts);
  `apps/server/src/management-api.ts:570-660,1060-1430`; `apps/server/src/testing/{signed-in-till,bill-venue}.ts`;
  `apps/dashboard/src/dashboard-app.ts` navigation and session handling; `apps/till/src/api/live-connection.ts`;
  `packages/provisioning/src/{venue-apply,venue-plan,configuration-transfer,recover-provisioned-venue}.ts` (parts);
  `apps/server/scripts/{demo-seed/seed,bench/bench-venue}.ts` (parts); `packages/composition/src/modules.ts`.

### What the hours mean

Hours are **implementer-active time plus one CI fix round**, from the lanes' measured
medium-effort dispatches (7–23 minutes, 43–87 turns each, `~/waitron-campaign-shared/effort-trial.md`).
They leave out the review work: twelve of the eighteen PRs touch a risk trigger (auth, migrations,
the money path or a cross-package contract) and take the full path — per-task reviews,
`/finish-branch`'s two Codex run-it reviews and its convention seat, and their fix rounds. The
light-path PRs (4, 5, 6, 8, 17, 18) skip per-task reviews.

| PR | Outcome | Prod files | Prod lines +/− | Test files | Test lines +/− | Generated | Path | Hours |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Permissions declared without the ladder | ~34 | +190 / −140 | ~72 | +210 / −170 | — | full | 2.5 |
| 2 | Comps by permission and limit | ~25 | +250 / −450 | ~45 | +300 / −420 | ~80 | full | 3 |
| 3 | Job roles in core; staffing and workforce permanent | ~50 | +300 / −190 | ~62 | +330 / −220 | ~550 | full | 2.5 |
| 4 | A used job role is hidden; job roles per person | ~14 | +330 / −260 | ~10 | +360 / −160 | — | light | 3 |
| 5 | Test people and test devices behind helpers | 0 | 0 | ~480 | +1,300 / −1,250 | — | light | 3 |
| 6 | Everyone set up or imported holds a job role | ~9 | +160 / −10 | ~5 | +170 / −10 | demo ~30 | light | 2 |
| 7 | Device sign-in by job role | ~18 | +360 / −340 | ~42 | +440 / −400 | ~200 + demo ~70 | full | 3 |
| 8 | Till's live sign-in list; job-role delete names devices left empty | ~6 | +120 / −20 | ~3 | +150 / −0 | — | light | 1.5 |
| 9 | One authority reading for every permission check | ~24 | +200 / −170 | ~20 | +180 / −120 | — | full | 2 |
| 10 | Every level reader through identity; dashboard by permission | ~12 | +200 / −120 | ~10 | +160 / −110 | — | full | 2.5 |
| 11 | Access-role storage; `persons.role` removed | ~26 | +420 / −240 | ~30 | +330 / −230 | ~350 + demo ~40 | full | 2.5 |
| 12 | Rule 2 on every route; the email-change permission | ~7 | +240 / −220 | ~8 | +560 / −300 | — | full | 2.5 |
| 13 | The usable Admin; email changes logged and the old address told | ~9 | +330 / −20 | ~6 | +420 / −0 | ~10 | full | 2.5 |
| 14 | Membership changes with Rule 1, logged, mailed, links expired | ~6 | +300 / −20 | ~3 | +420 / −0 | — | full | 2 |
| 15 | Access-role tags on the staff editor; Managers hold `person.admin` | ~18 | +450 / −320 | ~65 | +600 / −420 | — | full | 3 |
| 16 | Custom access roles (server) | ~7 | +460 / −20 | ~5 | +700 / −0 | — | full | 2.5 |
| 17 | Access roles page | ~8 | +900 / −20 | ~4 | +550 / −0 | — | light | 3 |
| 18 | Permission help bubbles and guides | ~6 | +450 / −10 | ~2 | +150 / −0 | — | light | 2 |
| **Total** | | | **≈ +5,660 / −2,570** | | **≈ +7,330 / −3,810** | **≈ 1,330** | | **≈ 45** |

**Range: 40–50 hours.** The first draft said 29.5 and the second 40.5. This revision's +4.5 hours
is work the reads found, net of what the owner's answers removed: dropping the link-sender check
(−1.5); the email-change permission (+0.5) and its log and old-address notice with a new mail kind
(+1); the import keeping the administrator's memberships (+0.5); the demo and bench ticking their
job roles, with a Madrid assertion (+0.5); the job-role delete warning about devices left with
nobody (+1); moving six raw level readers behind identity so the storage PR fits three hours
(+0.5 for the extra PR's setup and CI); the added rule tests (+0.75); one self-approval function
(+0.25); and the extra PR splits (+1). Remaining uncertainty: how many test files the PR 5
codemods cannot rewrite (each extra 20 by hand is about half an hour) and browser-test CI rounds
on PRs 7, 15 and 17.

### The transitional `role` field (PRs 11–15)

From PR 11 to PR 15 the staff form still sends one `role`, written through
`setBuiltInMembership` and read through `heldBuiltInKey`; PR 15 deletes both. It stays. Avoiding
it needs either the staff editor's tags and the `roleIds` answers in the storage PR (about 6 hours,
two PRs' worth that cannot be split, because removing `persons.role` breaks every reader at once),
or memberships added while `persons.role` still decides (two stores of one fact for four PRs,
which the no-compatibility rule forbids). The layer is two small functions with one writer each.

## Landing order and dependencies

```text
1 ──► 2 ──► 9 ──► 10 ───────────────┐
1 ──► 3 ──► 4 ──┐                   │
3 + 5 ──► 6 ────┴─► 7 ──► 8         │
                    7 ──────────────┴─► 11 ──► 12 ──► 13 ──► 14 ──► 15 ──► 16 ──► 17 ──► 18
```

- 2 and 3 may run in parallel after 1. 4 follows 3. 5 has no dependency and should start first.
- 6 needs 3 and 5. **7 needs 4** (it edits the hide branch 4 creates) and 6. 8 needs 7.
- 9 needs 1 and 2; 10 needs 9.
- 11 needs 5, 7 and 10.
- 12 → 13 → 14 → 15 in order: Managers get `person.admin` (15) only once Rule 2, the email
  safeguards and Rule 1 exist. 16 → 17 → 18.

Coordination: `#2809` (A1308 5d, the venue clock out of locations) has landed; PR 1's clock-route
references are rechecked against it below. A1308's people slice waits for PR 11.

---

## PR 1 — Permissions declared without the ladder (A1002 cut 2)

**Outcome:** every permission states which of Staff, Supervisor and Manager hold it by default and
Admin holds all; the §3 inventory changes that need no new rule land with their consumers.
Observable change: Supervisors and Managers lose the unused `sale.discount`; Managers can restart
the box. **Depends on:** nothing. **Risk trigger:** auth and permissions.

### Task 1.1: Declarations in identity and the module contract

**Files:** `packages/identity/src/{permissions,index}.ts`, `packages/module/src/{module,index}.ts`
(`:110-122`), `packages/composition/src/role-parity.ts`. Test: `packages/identity/src/permissions.test.ts`.

**Interfaces:**
- Module: `export type ModuleDefaultHolder = "staff" | "supervisor" | "manager";`
  `export type ModulePermission = { readonly permission: string; readonly defaultHolders: readonly ModuleDefaultHolder[] };`
  `ModuleRole` is deleted.
- Identity: `export type BuiltInRoleKey = "staff" | "supervisor" | "manager" | "admin";`
  `export type DefaultHolder = Exclude<BuiltInRoleKey, "admin">;`
  `export interface PermissionDeclaration { readonly permission: string; readonly defaultHolders: readonly DefaultHolder[] }`
  `export const CORE_PERMISSIONS` (`as const satisfies readonly PermissionDeclaration[]`);
  `export type Permission = (typeof CORE_PERMISSIONS)[number]["permission"];`
  `registerModulePermissions(perms: readonly ModulePermission[]): void` overwrites a re-registered
  module ID and throws `Error("permission declared twice: <id>")` for a core ID;
  `declaredPermissions(): string[]`; `defaultPermissionsFor(holder: DefaultHolder): string[]`;
  `isDeclaredPermission(id: string): boolean`. `roleHasPermission(role, p)` and
  `permissionsForRole(role)` keep their signatures: Admin → `isDeclaredPermission(p)`; others →
  `p` declared with `role` in `defaultHolders`.
- `PersonRoleValue` (`packages/shared/src/person-role.ts`) stays until PR 11.
- `role-parity.ts` asserts `DefaultHolder` and `ModuleDefaultHolder` are the same union both ways.

- [ ] **Step 1: failing tests** in `permissions.test.ts`, keeping every holder assertion still true:
  - `it("declares each core permission's default holders")` — literal table:
    `payment.take` → `["staff","supervisor","manager"]`;
    `sale.void`, `sale.refund`, `sale.rectify`, `cash.drawer`, `report.view`, `venue.view` →
    `["supervisor","manager"]`;
    `person.manage`, `catalogue.manage`, `venue.configure`, `system.manage`, `schedule.manage`,
    `purchase.manage`, `report.export`, `hardware.manage`, `fiscal.view` → `["manager"]`;
    `person.admin`, `personal_data.export`, `node.manage`, `system.box_admin` → `[]`.
  - `it("Admin holds a permission registered after start")` — register
    `{ permission: "synthetic.later", defaultHolders: [] }`; Admin `true`, Manager `false`.
  - `it("an undeclared permission authorizes nobody, Admin included")`.
  - `it("refuses a module redeclaring a core permission")` — `payment.take` throws `/declared twice/`.
  - `it("no longer declares retired permissions")` — none of `sale.discount`, `mirror.create`,
    `node.promote` in `declaredPermissions()`.
- [ ] **Step 2:** `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts` fails.
- [ ] **Step 3:** implement; delete the ladder and `arrayOfAll`; cut the stale comments at
  `permissions.ts:11` and `:22`. Remove `sale.discount`; replace `mirror.create` and
  `node.promote` with `node.manage`; add `system.box_admin` (consumers follow in 1.3 and 1.4).
- [ ] **Step 4:** Step 2's command and `pnpm --filter @waitron/composition --filter @waitron/module typecheck`.
- [ ] **Step 5: Commit** `git commit -s -m "Declare who holds each permission by default, without a ladder (A1002)"`.

### Task 1.2: Module declarations and test registrations

**Files:** `packages/{workforce,adjustments,bookings,staffing,venue-service,fiscal-verifactu}/src/permissions.ts`;
the 52 test files `git grep -l registerModulePermissions -- '*.test.ts'` lists.

**Interfaces:** `workforce.correct` `["supervisor","manager"]`; new `workforce.self_approve` `[]`;
`adjustment.manage` `["manager"]`; `booking.manage` `["manager"]`; `fiscal.remedy` `[]`.

- [ ] **Step 1:** rewrite each test registration from `grantedFrom: "<x>"` to the holders it meant
  (`supervisor` → `["supervisor","manager"]`, `manager` → `["manager"]`, `admin` → `[]`). In
  `packages/media/src/{routes,routes-edit,routes-authorization}.test.ts` **delete** the
  registration of `catalogue.manage`: it is a core permission now refused as declared twice.
- [ ] **Step 2:** `pnpm --filter @waitron/workforce --filter @waitron/adjustments --filter @waitron/bookings --filter @waitron/media --filter @waitron/fiscal-verifactu typecheck`
  fails until the declarations change; change them.
- [ ] **Step 3:** run `pnpm --filter @waitron/adjustments exec vitest run src/permissions.test.ts`,
  `pnpm --filter @waitron/bookings exec vitest run src/permissions.test.ts`,
  `pnpm --filter @waitron/media exec vitest run src/routes.test.ts src/routes-edit.test.ts src/routes-authorization.test.ts`.
- [ ] **Step 4: Commit.**

### Task 1.3: `node.manage` consumers and one self-approval rule

**Files:** the 15 production files `git grep -lE 'mirror\.create|node\.promote' -- apps packages ':!*.test.ts'`
lists and their 20 tests; `packages/workforce/src/corrections.ts:34-50,341-354`,
`packages/workforce/src/attendance-response-commands.ts:137,144`,
`apps/server/src/management-attendance-api.ts:177`, `apps/server/src/till-attendance-api.ts:218-226`.

**Interfaces:**
- One function in workforce, called from all four sites:
  `export function maySelfApproveAttendance(tx: Transaction, personId: string): Promise<boolean>`
  — true when the person holds `workforce.self_approve` and `workforce.correct` (this PR reads the
  level through `roleHasPermission`; PR 9 swaps it for the authority reading).
- "Acts as a manager" (`authorKindFor`, and the `MANAGER_ROLES` check at
  `attendance-response-commands.ts:137`) = holds `workforce.correct`. `MANAGER_ROLES` is deleted.
- Dashboard nav `servers` item requires `node.manage`.

- [ ] **Step 1:** `promote-api.test.ts`: `it("a Manager is refused node.manage")` asserting
  `authorization.not_permitted` with `params.permission === "node.manage"`. Workforce:
  `it("self-approval follows workforce.self_approve, not the Admin name")` — register
  `{ permission: "workforce.self_approve", defaultHolders: ["manager"] }` (a module ID, so allowed)
  and a Manager approving their own worker request passes through `corrections.ts` and through
  `attendance-response-commands.ts`; with `[]` both refuse. Keep the Admin-approves-own cases.
- [ ] **Step 2–4:** fail, implement, pass; then `git grep -nE 'mirror\.create|node\.promote|sale\.discount' -- apps packages scripts docs/developers docs/operations docs/backlog docs/backlog.md README.md CLAUDE.md`
  prints nothing (exit 1), and `git grep -n 'role === "admin"' -- packages/workforce apps/server/src/*attendance*`
  prints nothing. **Step 5: Commit.**

### Task 1.4: Box administration and restart

**Files (rechecked on `c00b1a6f39`, after #2809):** `apps/server/src/box-health-api.ts:82-100`
(`authorizeOnAnyDisk`), `:155-165` (restart, `:160`), `:265-290` (`authorizeAdmin`, `:278`);
`apps/server/src/email-settings-api.ts:57,90,102`; `apps/server/src/till-box-clock-api.ts:137-145`
(`holdsAdmin`), `:209-229` (`asAdmin` and the approver's `authorize`);
`apps/dashboard/src/dashboard-app.ts:3040-3041`; `CLAUDE.md` §5 (the clock rule's "an
administrator's at any time) or an administrator's own device" → holders of Box administration);
`docs/developers/conventions-data.md:4513,4683`; `docs/developers/design-system.md:6363,6420`;
`apps/server/src/guide/{en,es}/box-status.md`, `apps/server/src/guide/{en,es}/email.md`.
Tests: `box-health-api.test.ts`, `email-settings-api.test.ts`, `till-box-clock-api.test.ts`, the
box-status screen test for `canRestart`.

**Interfaces:** `POST /api/box/restart` → `system.manage`. `POST /api/box/clock-challenge`,
`/clock-confirm`, `/clock-set`, the till's `holdsAdmin` and its approver `authorize`, email-settings
`canEdit` and its two write routes → `system.box_admin`. The demo email inbox keeps `person.admin`
(design §3).

- [ ] **Step 1:** Tests: `it("a Manager may restart the box")` → 202. Box administration and
  `person.admin` are both Admin-only in this PR, so the gate change is proven by the refusal's
  parameter: a Manager session calling clock-challenge, clock-confirm, clock-set and the two
  email-settings writes is refused `authorization.not_permitted` with
  `params.permission === "system.box_admin"`. On the till: `it("a Manager's PIN offered as the
  approver is refused naming system.box_admin")`, and `it("a Manager with no approver still
  confirms as a staff member during start-up")` — the staff witness path at
  `till-box-clock-api.ts:209-213,282-289` that CLAUDE.md §5 requires keeps working.
- [ ] **Step 2–4:** fail, implement, pass; update the doc lines, CLAUDE.md §5 and both guides'
  who-can sentences; `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.
- [ ] **Step 5: Commit**, then `/finish-branch`.

---

## PR 2 — Comps by permission and limit (A1002 cut 3)

**Outcome:** comp reasons carry no role lists; `adjustment.apply` lets a person comp within a
reason's limits and the bill's comp limit, `adjustment.approve` approves past them by PIN, and a
zero limit always needs approval. The till's approval prompts stop naming a role. **Depends on:**
PR 1. **Risk trigger:** money path, migration, cross-package contract. **First PR line:** core
starting migration rebuilt, venue reset.

**Consequence the PR description states** (owner, 2026-11-11, option A): Supervisors hold
`adjustment.approve` by default, so a Supervisor alone may now give "On the house", "Discount", a
Staff meal over 50% and anything over the bill limit, each of which needs a Manager today
(`packages/adjustments/src/provisioning.ts:66-72`, `settings.ts:19`). No test changes for it.

### Task 2.1: Policy evaluates permissions and limits

**Files:** `packages/adjustments/src/{policy,permissions}.ts`, `packages/shared/src/adjustment-policy-types.ts`.
Test: `packages/adjustments/src/policy.test.ts`.

**Interfaces:**
- `ADJUSTMENTS_PERMISSIONS` adds `{ permission: "adjustment.apply", defaultHolders: ["staff","supervisor","manager"] }`
  and `{ permission: "adjustment.approve", defaultHolders: ["supervisor","manager"] }`.
- `AdjustmentReason` and `ReasonShape` lose `applyRoles`, `approverRoles`;
  `ReasonShapeField` = `"actions" | "maxPercentBp" | "maxAmount"`. `isRoleList` is deleted.
- `isPercentBp(v)` accepts 0..10000. `maxAmount` may be `0`.
- `CompRequest.actorPermissions: ReadonlySet<string>` replaces `actorRole`;
  `CompRequest.billLimit: { maxAmount: Decimal | null }`. `CancelRequest.actorPermissions` likewise.
- `export type Approval = { by: "limit"; permission: "adjustment.approve"; limit: { kind: "reason" | "bill"; amount: Decimal | null; percentBp: number | null } } | { by: "refund"; permission: "sale.refund" }`.
- Verdict codes lose `adjustment.no_common_approver`.
- `approves(approval: Approval, permissions: ReadonlySet<string>): boolean`.
- `AdjustmentPolicySnapshot` = `{ kind, actions, maxPercentBp, maxAmount, maxBillComp: Decimal | null, noteRequired }`;
  `policySnapshotOf(reason, bill: { maxBillComp: Decimal | null })`.

- [ ] **Step 1: failing tests** (rewrite the role-list cases into permission cases, keeping each
  amount and percentage):
  - `it("a holder of adjustment.apply comps within the reason's limit")` — Staff meal, 50%, 40% off → allowed.
  - `it("past the reason's limit needs someone who can approve")` — 60% → `by: "limit"`,
    `permission: "adjustment.approve"`, `limit.kind: "reason"`.
  - `it("a holder of adjustment.approve passes their own limits")`.
  - `it("without adjustment.apply every comp needs approval")`.
  - `it("a zero amount limit always needs approval")` — €0.01 off.
  - `it("a zero percent limit needs approval even within the rounding allowance")` — dish
    `{ list: 10.00, after: 9.99, allowance: 2 }`, `maxPercentBp: 0` (Review focus 4).
  - `it("the bill's comp limit applies with the same approvers")` — €20 limit, €15 comped, €10 more
    → `limit.kind: "bill"`; `it("a zero bill limit makes every comp need approval")`.
  - `evaluateCancel` fired/served without `sale.refund` → `{ by: "refund" }`.
  - `it("the snapshot records limits, not roles")`.
- [ ] **Step 2:** `pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts` fails.
- [ ] **Step 3:** implement; `belowFloor` treats `maxPercentBp === 0` as "any dish with `after < list`".
- [ ] **Step 4:** pass. **Step 5: Commit.**

### Task 2.2: Storage, settings and starters

**Files:** `packages/db/src/schema/adjustments/{reasons,adjustments}.ts`,
`packages/adjustments/src/{settings,provisioning,operations,routes,record,configuration-transfer}.ts`,
`packages/country-es/src/demo/reasons.ts`, `packages/country/src/demo.ts`,
`apps/server/scripts/demo-seed/{data-set,seed-adjustments}.ts`, generated drizzle, bundle version.
Tests: `packages/db/src/schema/adjustments/{reasons,migrations}.test.ts`,
`packages/adjustments/src/{settings,operations,routes,provisioning,configuration-transfer,record}.test.ts`,
`packages/adjustments/test/seed.ts`, `apps/server/src/testing/{adjustment-venue,cancel-line}.ts`.

**Interfaces:**
- `adjustment_reasons` drops `apply_roles`, `approver_roles`. CHECKs:
  `adjustment_reasons_max_percent_ck` `max_percent is null or max_percent between 0 and 10000`;
  `adjustment_reasons_max_amount_ck` `max_amount is null or max_amount >= 0`;
  `adjustment_reasons_kind_fields_ck` `(kind = 'void' and max_percent is null and max_amount is null) or kind = 'comp'`.
- `AdjustmentsDocument` = `{ maxBillComp: number | null }`, parse accepts `0`, `version` stays 1
  (pre-live shape change on read). `AdjustmentSettings` = `{ maxBillComp: Decimal | null }`.
- Starters: Complaint `maxAmount 0`; On the house `maxAmount 0`; Staff meal `maxPercentBp 5000`,
  discount actions only; Discount `maxAmount 0`; void reasons unchanged.

- [ ] **Step 1:** `reasons.test.ts`: zero amount and zero percent accepted; negative refused.
  `settings.test.ts`: zero bill limit round-trips; a document naming `billApproverRoles` →
  `{ ok: false, field: "billApproverRoles" }`. `provisioning.test.ts`: the four starter limits.
- [ ] **Step 2–4:** fail; implement; `migration-baseline rebuild --set core`; raise the bundle
  version; pass the listed tests and the schema guards. **Step 5: Commit.**

### Task 2.3: Server apply path and the approvers list

**Files:** `apps/server/src/adjustments-apply.ts:150-240,985-1110,1210-1235,1365-1375`,
`apps/server/src/adjustments-api.ts:100-110,325-335`, `packages/identity/src/staff.ts`
(`listActivePersonsWithRoles`). Tests: `apps/server/src/{adjustments-apply,adjustments-api,line-cancel,default-cancel-reason,draft-discard}.test.ts`.

**Interfaces:**
- `planAdjustment` passes `actorPermissions: new Set(permissionsForRole(role))` (PR 9 swaps it).
- Approver check: `approves(approval, new Set(permissionsForRole(cred.role)))`.
- `GET /api/adjustment-approvers?permission=<p>` replaces `?roles=`; `p` ∈ `adjustment.approve`,
  `sale.refund`, `system.box_admin`, else `management.request_invalid` `{ field: "permission" }`.
  Answers `listActivePersonsWithPermission(tx, p)`. `listActivePersonsWithRoles` is deleted.
- Wire approval: `{ by: "limit", permission, limit: { kind, amount: string | null, percentBp } } | { by: "refund", permission: "sale.refund" }`.

- [ ] **Step 1:** `it("lists approvers by permission")` (Supervisor and Manager listed for
  `adjustment.approve`, Staff not; `?permission=person.admin` → 400 naming the field). In
  `adjustments-apply.test.ts`, a waiter's €12 staff meal under a €15 limit applies alone; any
  Complaint comp (limit €0) answers `needsApproval.by === "limit"`, then succeeds with a
  Supervisor's PIN and records `approved_by` = the Supervisor (design §6). Keep every amount assertion.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 2.4: Dashboard reasons screen

**Files:** `packages/adjustments/src/dashboard/{reasons-screen,strings,client}.ts`. Tests:
`reasons-screen.test.ts` (+ `.unsaved`, `.a11y`, `.save-state`), `client.test.ts`.

**Interfaces:** no role fields; limits panel has `maxBillComp` only and accepts `0`; the table's
two role columns are removed. Hints: EN "0 means every comp with this reason needs approval." /
ES "0 significa que cada invitación con este motivo necesita aprobación."; bill limit EN "0 means
every comp on a bill needs approval." / ES "0 significa que cada invitación de una cuenta necesita
aprobación."

- [ ] **Step 1:** `it("saves a reason with a zero amount limit")`, `it("shows no role fields")`,
  `it("a zero bill limit is valid")`; keep the draft/unsaved/save-state assertions.
- [ ] **Step 2–4:** `pnpm --filter @waitron/adjustments exec vitest run src/dashboard`; axe in both
  themes. **Step 5: Commit.**

### Task 2.5: Till approval prompts name no role

**Files:** `apps/till/src/api/client.ts:895-920,4470-4476`, `apps/till/src/widgets/{adjustment-dialog,supervisor-override-dialog,box-time-dialog,keep-open,station-today}.ts`,
`apps/till/src/till-app.ts` (approval list and `.approverRole` bindings), `apps/till/src/i18n/strings.ts`,
the comps guide section (`git grep -n "approver" apps/server/src/guide`). Tests: the dialogs' and
`till-app-*adjustments.test.ts` suites.

**Interfaces:**
- `listApprovers(permission: "adjustment.approve" | "sale.refund" | "system.box_admin"): Promise<StaffMember[]>`
  replaces `listAdjustmentApprovers(roles)`.
- `supervisor-override-dialog` loses `approverRole`; its texts are EN "Approval needed" / "Choose
  who approves" / "Enter their PIN" / "Nobody here can approve this"; ES "Hace falta aprobación" /
  "Elige quién aprueba" / "Introduce su PIN" / "Aquí nadie puede aprobarlo". The
  `approval.*_{staff,supervisor,manager,admin}` keys are deleted.
- `box-time-dialog` lists `listApprovers("system.box_admin")`.

- [ ] **Step 1:** `it("asks for an approver without naming a role")`; `it("lists Box
  administration holders for the clock")`. **Step 2–4:**
  `pnpm --filter @waitron/till exec vitest run src/widgets src/till-app-adjustments.test.ts src/till-app-counter-adjustments.test.ts`.
- [ ] **Step 5:** guide EN/ES: "Apply comps" comps up to the reason's limit, "Approve comps"
  approves past it, 0 means always ask. **Commit**, `/finish-branch`.

---

## PR 3 — Job roles in core; staffing and workforce permanent (A1002 cut 4)

**Outcome:** job roles and who holds them live in core's migration set and identity's transfer;
staffing and the workforce module it is built on can no longer be switched off (owner confirmed
2026-11-11). Behaviour is otherwise unchanged. **Depends on:** PR 1. **Risk trigger:** migration,
cross-package contract. **First PR line:** core and workforce starting migrations rebuilt, venue
reset.

### Task 3.1: Move the two tables

**Files:**
- Create `packages/db/src/schema/identity/staff-roles.ts` (moved from
  `packages/workforce/src/schema/staffing/staffing.ts:22-55`); export from
  `packages/db/src/schema/identity/index.ts` and `packages/db/src/index.ts`.
- Modify `packages/workforce/src/schema/staffing/staffing.ts` (import `staffRoles` from
  `@waitron/db`), `packages/workforce/src/classification.ts:46-47` → `packages/db/src/classification.ts`,
  `packages/staffing/src/classification.ts` (drop both from `STAFFING_TABLES`),
  `packages/identity/src/classification.ts` (add to `IDENTITY_TABLES` and `IDENTITY_CHANGE_SOURCES`,
  `person_staff_roles` related to `persons`), every `staffRoles`/`personStaffRoles` import from
  `@waitron/workforce` (`git grep -l "personStaffRoles\|staffRoles" -- packages apps`),
  `scripts/schema-constraints.test.ts:355-362,509,863-864`, `docs/operations/a760-migration-squash-inventory.md:386-387`,
  generated drizzle for both sets.
- Tests: `packages/composition/src/composition.test.ts` ("the eight sets", `:145`, and `:182`),
  `packages/{staffing,identity}/src/classification.test.ts`.

**Interfaces:** `staffRoles` gains `hiddenAt: tsString("hidden_at")` (nullable, used by PR 4);
`staff_roles_name_key` becomes partial `where hidden_at is null`. TS and SQL names unchanged;
exported from `@waitron/db`.

- [ ] **Step 1:** tests pin both tables in core's set and in `IDENTITY_TABLES`, not in workforce's.
- [ ] **Step 2–4:** fail; list the foreign keys pointing at `staff_roles` (`shift_assignments`
  restrict, `staffing_blocks` cascade, `person_staff_roles` cascade) in the commit message; move;
  rebuild `--set core` and `--set workforce`; pass with the schema guards and
  `pnpm --filter @waitron/staffing --filter @waitron/workforce --filter @waitron/composition exec vitest run`.
- [ ] **Step 5: Commit.**

### Task 3.2: Transfer and backup check follow the move

**Files:** `packages/staffing/src/configuration-transfer.ts` → both tables into
`IDENTITY_CONFIGURATION_TRANSFER` (`packages/identity/src/configuration-transfer.ts`) after
`persons`; `packages/staffing/src/backup-verification.ts:96` (its `staff_roles` row check moves to
identity's `IDENTITY_BACKUP_VERIFICATION`, keeping the same row rule and adding `hidden_at`);
the bundle version. Tests: `apps/server/src/configuration-transfer.test.ts` (a job role and its
holder round-trip), the two backup-verification suites.

- [ ] **Step 1–4:** a job role and its holder round-trip through export and import under identity;
  identity's backup verification refuses a `staff_roles` row with an empty name. **Step 5: Commit.**

### Task 3.3: Staffing and workforce become mandatory

**Files:** `packages/composition/src/modules.ts:229,372`, `CLAUDE.md` §3 ("A module that can be
switched off or swapped…" — the stated exception becomes "staffing, permanent since A1002, with its
tables in workforce's set"). Tests: `composition.test.ts:421-429` (tier), `packages/module/src/config.test.ts`.

- [ ] **Step 1:** `it("staffing and workforce cannot be switched off")` — `parseModuleOverrides`
  with `{ staffing: false }` and `{ workforce: false }` each throw `module.mandatory_not_disableable`;
  `composition.test.ts:423` expects `"mandatory"`. Tests that disable either module switch to
  `workforce-es` or `bookings`, keeping what they asserted.
- [ ] **Step 2–4:** fail, set both tiers, pass. The `workforceEnabled` reads in
  `apps/server/src/boot.ts` stay correct (always true) and are left alone. The commit message
  names the two modules whose tier changed and the sets that stay their own.
- [ ] **Step 5: Commit**, `/finish-branch`.

---

## PR 4 — A used job role is hidden; job roles per person (A1002 cut 5)

**Outcome:** deleting a job role a shift has used hides it; deletion confirms once with the holder
count; job roles can be set per person from the staff editor; every job-role change is logged.
**Depends on:** PR 3. **Risk trigger:** none of the list (no migration; staffing-internal
contract) — light path unless its reviewer judges otherwise.

### Task 4.1: Delete or hide

**Files:** `packages/staffing/src/{staff-roles,rota,paint,errors,routes}.ts`,
`packages/staffing/src/dashboard/{staff-roles-screen,staff-role-delete-copy,strings,client,rota-model,slot-picker,shift-edit-dialog}.ts`.
Tests: `staff-roles.test.ts`, `rota.test.ts`, `paint.test.ts`, `staff-roles-screen.test.ts`.

**Interfaces:**
- `deleteStaffRole(tx, id, actor: { personId: string | null }): Promise<{ outcome: "deleted" | "hidden"; removedFrom: number }>`:
  no shift names it → row deleted; otherwise, in one transaction, its `person_staff_roles` and
  `staffing_blocks` rows are deleted and `hidden_at` set. `staff_role.in_use` is removed.
- The deletion preview goes: `readStaffRoleDeleteImpact`, `GET …/staff-roles/:id/delete-impact`,
  `watchStaffRoleDeleteImpact` (`packages/staffing/src/dashboard/client.ts`) and the impact list
  in `staff-role-delete-copy.ts` are replaced by one confirmation using the holder count the list
  already has: EN "{count} people hold this role. Deleting it removes it from them, from every
  device and from the staffing plan. Shifts that used it keep its name." / ES "{count} personas
  tienen este puesto. Al eliminarlo se quita de ellas, de todos los dispositivos y del plan de
  personal. Los turnos que lo usaron conservan su nombre." (PR 8 adds the devices left with nobody.)
- Visible-only reads: `listStaffRoles`, `listStaffRolesWithHolderNames`, name checks,
  `reorderStaffRoles`. `readRotaWeek` adds every role the week's shifts name, hidden included,
  with `hidden: true`. `assignmentTargets`, `setStaffRoleHolders`, `paint` refuse a hidden role
  with `staff_role.not_found`.

- [ ] **Step 1:** `it("deletes a role no shift has used")`; `it("hides a role a shift has used")`
  (row kept with `hidden_at`, holders 0, blocks 0, a past shift reads its name);
  `it("a hidden role's name can be used again")`; `it("a hidden role cannot be assigned, held or
  painted")`; `it("a future shift in a hidden role still shows it and warns")` (the shift's person
  is outside every visible holder list, so the card shows the existing outside-role warning);
  screen: `it("confirms once with the holder count")`. Rewrite the `staff_role.in_use` test into
  the hide case.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 4.2: Logging and the per-person route

**Files:** `packages/staffing/src/{staff-roles,routes}.ts`, `packages/db/src/activity-kinds.ts`,
`packages/provisioning/src/configuration-transfer.ts` (import loop). Tests: `staff-roles.test.ts`,
`routes.test.ts`, `apps/server/src/configuration-transfer.test.ts`.

**Interfaces:**
- Kinds (subject): `job_role.created` (`job_role`) `{ name }`; `job_role.renamed` (`job_role`)
  `{ from, to }`; `job_role.deleted` and `job_role.hidden` (`job_role`) `{ name }`;
  `job_role.member_added` and `job_role.member_removed` (`person`) `{ staffRoleId, name }`.
- `createStaffRole`, `updateStaffRole`, `setStaffRoleHolders` take `actor: { personId: string | null }`.
  Deleting or hiding logs one `job_role.member_removed` per holder before the lifecycle entry. A
  no-op save logs nothing.
- `setPersonStaffRoles(tx, input: { personId: string; staffRoleIds: readonly string[]; expectedStaffRoleIds: readonly string[]; actorId: string }): Promise<string[]>`
  — sets compared without order; a difference → `person.job_roles_changed` `{}`; unknown or
  hidden ID → `staff_role.not_found`.
- Route `PUT /management-api/staffing/people/:personId/staff-roles`, body
  `{ staffRoleIds, expectedStaffRoleIds }`, gate `schedule.manage`, answers `{ staffRoleIds }`.
- Import logs each imported `person_staff_roles` row as `job_role.member_added` with `personId: null`.

- [ ] **Step 1:** `it("logs each holder added and removed, by id")`; `it("hiding a role logs a
  removal for each holder")` (three holders → three entries); `it("refuses a stale per-person
  save")`; `it("reordered sets are no change")`; route refuses a session without `schedule.manage`;
  import logs baseline memberships and queues no mail.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 4.3: Job-role tags on the staff editor

**Files:** `apps/dashboard/src/widgets/person-edit.ts`, `apps/dashboard/src/api/client.ts`,
`apps/dashboard/src/i18n/{strings,codes}.ts`, `apps/server/src/guide/{en,es}/staff.md`
(`{#delete-staff-role}` reworded for hiding; new `{#job-roles}` line). Tests: `person-edit.test.ts`
(+ `.unsaved`).

**Interfaces:** a "Job roles" `wt-combobox multiple`, EN "Job roles — puts them on the rota and on
the devices that take that job" / ES "Puestos — los pone en el cuadrante y en los dispositivos de
ese puesto", shown with `schedule.manage`, with its own draft scope and expected set. Stale-save
message EN "Someone changed this person's job roles while you were editing. Reload to see them;
your changes are kept until you do." / ES "Alguien cambió los puestos de esta persona mientras
editabas. Recarga para verlos; tus cambios se conservan hasta entonces."

- [ ] **Step 1–4:** `it("saves job roles with the set it read")`, `it("keeps the draft when someone
  changed them meanwhile")`; light/dark and phone width by eye. **Step 5: Commit**, `/finish-branch`.

---

## PR 5 — Test people and test devices behind helpers (A1002 cut 6)

> 2026-11-12, watcher 07:07: split into PR 5a (Tasks 5.1–5.2) and PR 5b (Tasks 5.3–5.5), both before PR 1. PR 5a keeps its 2,550-line forecast; at 3,825 lines, ask for an outside opinion. Review the tool rules and handwritten changes, and sample tool output; each PR records reproducible commands and separate tool/hand counts.

**Outcome:** every test creates and changes people through `seedPersons` and
`setBuiltInRoleForTest`, and creates device profiles through `seedDeviceProfiles`; today the
helpers write exactly what the tests wrote. No product code changes. **Depends on:** nothing.
**Risk trigger:** none (light path).

### Task 5.1: The helpers

**Files:** Create `packages/identity/test/person-rows.ts` (imported as
`@waitron/identity/test/person-rows.js`); modify `packages/db/src/testing/seed.ts`.
Tests: `packages/identity/src/person-rows.test.ts`, `packages/db/src/testing/seed.test.ts`.

**Interfaces:**
```ts
// packages/identity/test/person-rows.ts
export type PersonSeed = Omit<typeof persons.$inferInsert, "role"> & { role?: BuiltInRoleKey };
export function seedPersons(db: Database | Transaction, values: PersonSeed | readonly PersonSeed[]): Promise<(typeof persons.$inferSelect)[]>;
export function setBuiltInRoleForTest(db: Database | Transaction, personId: string, role: BuiltInRoleKey): Promise<void>;
export function builtInRoleForTest(db: Database | Transaction, personId: string): Promise<BuiltInRoleKey | null>;
// packages/db/src/testing/seed.ts
export function seedDeviceProfiles(db: Database | Transaction, values: DeviceProfileInsert | readonly DeviceProfileInsert[]): Promise<(typeof deviceProfiles.$inferSelect)[]>;
```
`role` defaults to `"staff"` (today's column default). `seedDevice` (`seed.ts:148`) creates its
profile through `seedDeviceProfiles`. `packages/db/src/testing/` is under coverage and mutation,
so the helper has its own test.

- [x] **Step 1–4:** one and many rows, full rows returned, default staff, role round-trip.
  **Step 5: Commit.**

### Task 5.2–5.4: People codemod (three tasks)

**5.2:** `apps/server/src/[a-l]*` tests. **5.3:** `apps/server/src/[m-z]*` tests and
`apps/server/src/testing/`. **5.4:** packages that depend on `@waitron/identity` (core,
fiscal-verifactu, workforce, workforce-es, staffing, venue-service, layouts, media, bookings,
adjustments, provisioning, identity). `db`, `fiscal`, `catalogue`, `country-es` do not depend on
identity (`fiscal` cannot: identity → module → fiscal) and keep `role:` until PR 11.

The codemod is a throwaway script in the implementer's scratch folder, using the root
`typescript` parser, run per task over that task's file set:
```text
parse each file with ts.createSourceFile
find CallExpression C: C.expression is PropertyAccess ".values" on Call ".insert(persons)"
  outer = C; if outer.parent is PropertyAccess ".returning" whose parent is a Call, outer = that call
  replace outer's text with `seedPersons(<receiver of .insert>, <text of C's argument>)`
`R.update(persons).set({ role: X }).where(eq(persons.id, ID))` → `setBuiltInRoleForTest(R, ID, X)`
add the import when anything changed; apply edits from the end of the file backwards
```
Other shapes (`.onConflictDoNothing()`, raw `sql\`update persons set role…\``, selects of
`persons.role`) are rewritten by hand with the helpers.

- [ ] **Each task:** run the script; typecheck the package; fix what it flags; then
  `git grep -nE 'insert\(persons\)|set\(\{ ?role|set role|persons\.role' -- '<the task's paths>/**/*.test.ts' '<the task's paths>/**/testing/**'`
  prints nothing, and `git diff --stat` shows no production file. Run the touched tests in groups
  of about 40, reading each `Tests` count. **Commit.**

> 2026-11-12, watcher 07:23: the “person who authorised the handover, according to the copy” corruption group in handover-compare.test.ts keeps its deliberate copied-file role mutations until PR 11. Keep every refusal assertion; add no helper solely for injecting invalid copied data.

### Task 5.5: Device-profile codemod

Same script shape for `X.insert(deviceProfiles).values(V)[.returning(…)]` →
`seedDeviceProfiles(X, V)` over every test and testing file (`git grep -l 'insert(deviceProfiles)'`,
121 files). Check: the grep over `'apps/**/*.test.ts' 'apps/**/testing/**' 'packages/**/*.test.ts' 'packages/**/testing/**' 'packages/**/test/**'`
prints nothing outside `packages/db/src/testing/seed.ts`. **Commit**, `/finish-branch`.

---

## PR 6 — Everyone set up or imported holds a job role (A1002 cut 7)

**Outcome:** a new venue has a "Team" job role held by the first admin; a venue set up from an
export gives its administrator job roles too; the demo's staff hold job roles; every person a test
seeds holds a shared fixture job role. Nothing reads these for sign-in yet; PR 7 does.
**Depends on:** PR 3, PR 5. **Risk trigger:** none (light path).

### Task 6.1: Setup's "Team", the import, and the demo

**Files:** `packages/provisioning/src/{venue-apply,starter-content,configuration-transfer}.ts`,
`packages/staffing/src/staff-roles.ts` (`createStarterStaffRole(tx, name): Promise<string>`, no
activity), `apps/server/scripts/demo-seed/{seed-staff,data-set}.ts`, `packages/country-es/src/demo/staff.ts`,
`packages/country-es/test-fixtures/demo/madrid-before-move.{en,es,manifest}.json` (regenerated by
the demo's existing snapshot command; today `staff_roles: 0`). Tests: `venue-apply.test.ts`,
`starter-content.test.ts`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`,
`apps/server/src/configuration-transfer.test.ts`.

**Interfaces:**
- `STARTER_JOB_ROLE_NAMES = { Team: { es: "Equipo" } } as const satisfies StaffNames`.
  `seed-admin` creates the person, then "Team" in the staff language, then the admin's
  `person_staff_roles` row, logging `job_role.member_added` with `personId: null`.
- Import: after inserting the bundle's rows, the importing administrator is given the job roles
  the exporting administrator held (their `person_staff_roles` rows, which the loop skips at
  `:881`), mapped to the new ids; if those are none, every imported visible job role. Logged as
  baseline entries.
- Demo: job roles "Waiter", "Kitchen", "Manager on duty" (`es`: "Camarero", "Cocina", "Encargado
  de turno"); each demo person holds one, the managers also "Manager on duty".

- [ ] **Step 1:** `it("setup's admin holds the starter job role")`; `it("names it in the staff
  language")` → "Equipo"; in `configuration-transfer.test.ts`
  `it("after an import the administrator holds the job roles the exporting administrator held")`
  and `it("after an import of a bundle whose administrator held none, the administrator holds every
  imported job role")`; the Madrid baseline test counts the demo's job roles and memberships.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 6.2: Fixture people hold the fixture job role

**Files:** `packages/identity/test/person-rows.ts`, `packages/db/src/testing/seed.ts`.
Test: `person-rows.test.ts`.

**Interfaces:** `export const FIXTURE_JOB_ROLE = "Fixture team";`
`ensureFixtureJobRole(db): Promise<string>` (in `packages/db/src/testing/seed.ts`). `seedPersons`
gives each seeded person that job role unless `jobRoles: []` is passed (`PersonSeed` gains
`jobRoles?: readonly string[]`).

- [ ] **Step 1–4:** a seeded person holds the fixture role; `jobRoles: []` gives none; the staffing
  suites that count holders still pass (pass `jobRoles: []` where a test counts holders).
  **Step 5: Commit**, `/finish-branch`.

---

## PR 7 — Device sign-in by job role (A1002 cut 8)

**Outcome:** a device profile's "Who can sign in" ticks job roles only; its sign-in screen lists
everyone holding a ticked job role; per-person allow/deny is gone; a new profile ticks every job
role; fixtures, setup, the demo, the bench and an imported venue all still sign in. **Depends on:**
PR 4, PR 6. **Risk trigger:** auth (sign-in admission), migration. **First PR line:** core starting
migration rebuilt, venue reset.

### Task 7.1: Admission storage and rule

**Files:** `packages/db/src/schema/identity/profile-admission.ts`, `packages/identity/src/profile-admission.ts`,
`packages/identity/src/{classification,configuration-transfer,personal-data,errors,index}.ts`,
`packages/db/src/{classification,index}.ts`, `packages/db/src/schema/identity/index.ts`,
`packages/layouts/src/device-profile.ts`, `packages/staffing/src/staff-roles.ts` (PR 4's hide branch),
`scripts/schema-constraints.test.ts`, generated drizzle, bundle version.
Tests: `packages/identity/src/profile-admission.test.ts`.

**Interfaces:**
- `deviceProfileAdmissionRoles` = `{ deviceProfileId (FK cascade), staffRoleId (FK → staff_roles cascade) }`,
  PK both. `deviceProfileAdmissionPersons` is deleted with its change source, transfer entry and
  personal-data reader.
- `canUseDeviceProfile`, `listStaffAdmittedTo`, `profilesAdmitting` keep their signatures: an
  active person holding a visible job role ticked on the profile. No rows = nobody.
- `interface ProfileAdmission { admittedStaffRoleIds: string[] }`; `readProfileAdmissions`;
  `setProfileAdmission(tx, profileId, input)` refuses an unknown or hidden ID with
  `device_profile.admission_invalid` `{ field: "admittedStaffRoleIds", reason: "not_found", staffRoleId }`;
  empty is valid.
- `createDeviceProfile` ticks every visible job role; `createStaffRole` ticks none.
- Hiding a job role also deletes its admission rows.

- [ ] **Step 1:** `it("admits an active holder of a ticked job role")`; `it("admits nobody when no
  job role is ticked")`; `it("an access level alone admits nobody")` (an Admin with no job role);
  `it("a suspended holder is not admitted")`; `it("a new profile ticks every current job role and a
  new job role is ticked nowhere")`; `it("a hidden job role admits nobody")`.
- [ ] **Step 2–4:** fail; implement; rebuild `--set core`; raise the bundle version; pass with the
  schema guards. **Step 5: Commit.**

### Task 7.2: Fixtures, setup, demo, bench and import still sign in

**Files:** `packages/db/src/testing/seed.ts` (`seedDeviceProfiles` ticks `ensureFixtureJobRole`
unless `admitted: []`), `apps/server/src/testing/*` that build profiles, setup's
`seed-device-profiles` (ticks "Team" through `createDeviceProfile`), `apps/server/scripts/demo-seed/seed.ts`
(ticks "Waiter" and "Manager on duty" on Counter and Handheld, "Kitchen" on Kitchen),
`apps/server/scripts/bench/bench-venue.ts:397-427` (a "Bench team" job role held by its waiters and
manager and ticked on its tills), the Madrid demo JSON.
Tests: `apps/server/src/till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`,
`packages/provisioning/src/venue-apply.test.ts`, `seed.madrid-baseline.test.ts`,
`apps/server/src/configuration-transfer.test.ts`, then the packages' suites.

- [ ] **Step 1:** `it("setup's admin can sign in on every starter profile")` (Counter, Kitchen,
  Handheld); the Madrid baseline asserts **every demo person is on at least one profile's sign-in
  list**; `it("after an import the administrator can sign in on every imported profile that ticks
  a job role they hold")`; the bench's own check finds its waiters on its tills.
- [ ] **Step 2–4:** run `pnpm --filter @waitron/server exec vitest run src/till-api` and the
  device, login and till-session suites first, then each package's suite in turn, fixing any test
  that builds a profile or person outside the helpers. **Step 5: Commit.**

### Task 7.3: Profile screen and API

**Files:** `apps/server/src/management-api.ts:570-660` (`ProfileBody`, `parseProfileAdmission`,
`withProfileAccess`) and its device-profile routes `:1294-1430`;
`apps/dashboard/src/screens/device-profiles-screen.ts` (admission around `:330-365`, `:1190-1200`,
`:1480-1500`, `:1690-1700`); `apps/dashboard/src/api/{client,live-queries}.ts`;
`apps/server/src/testing/clear-provision-fixture.ts`; the device-profile guide section EN/ES.
Tests: `device-profiles-screen.test.ts` (+ `.unsaved`, `.a11y`), `management-api.*profile*.test.ts`.

**Interfaces:**
- Profile body `admittedStaffRoleIds: string[]` replaces `admittedRoles` and `personExceptions`;
  duplicates → `management.request_invalid` `{ field: "admittedStaffRoleIds" }`.
- "Who can sign in": one `wt-switch` per visible job role, in rota order; no people rows; a copied
  profile copies its ticks. Empty hint: EN "Nobody can sign in on devices with this profile." / ES
  "Nadie puede iniciar sesión en los dispositivos con este perfil."

- [ ] **Step 1:** `it("ticks job roles, not levels, and shows no people")`; `it("a copied profile
  keeps its job-role ticks")`; `it("an empty selection saves and says nobody can sign in")`.
- [ ] **Step 2–4:** pass; light/dark and phone width by eye. **Step 5: Commit**, `/finish-branch`.

---

## PR 8 — The till's live sign-in list; job-role delete names empty devices (A1002 cut 9)

**Outcome:** a newly added waiter appears on a till's lock screen without a reload; deleting a job
role names the devices that would be left with nobody. **Depends on:** PR 7. **Risk trigger:**
none (light path).

### Task 8.1: The till's live list

**Files:** `apps/till/src/api/live-connection.ts:9-16`. Test: `apps/till/src/api/live-connection.test.ts`.

**Interfaces:** `DEVICE_TYPES` drops `device_profile_admission_persons` and adds `staff_roles` and
`person_staff_roles`.

- [ ] **Step 1–4:** `it("a new holder of a ticked job role reaches the lock screen without
  reload")`. **Step 5: Commit.**

### Task 8.2: Devices left with nobody

**Files:** `packages/staffing/src/{staff-roles,routes}.ts`, `packages/staffing/src/dashboard/{staff-roles-screen,staff-role-delete-copy,client,strings}.ts`.
Tests: `staff-roles.test.ts`, `staff-roles-screen.test.ts`.

**Interfaces:** `profilesLeftEmptyBy(tx, staffRoleId): Promise<{ id: string; name: string }[]>` —
profiles whose only visible ticked job role is this one; `GET /management-api/staffing/staff-roles/:id/empty-devices`
(gate `schedule.manage`) → `{ profiles }`. The confirmation adds, when not empty: EN "Deleting it
leaves nobody able to sign in on: {profiles}." / ES "Al eliminarlo nadie podrá iniciar sesión en:
{profiles}."

- [ ] **Step 1–4:** a fresh venue's "Team" names all three starter profiles; a role ticked beside
  another names none. **Step 5: Commit**, `/finish-branch`.

---

## PR 9 — One authority reading for every permission check (A1002 cut 10)

**Outcome:** every permission check reads a person's authority instead of a level. Behaviour
unchanged for the four levels. **Depends on:** PR 1, PR 2. **Risk trigger:** auth.

### Task 9.1: `PersonAuthority`

**Files:** Create `packages/identity/src/authority.ts`; modify `packages/identity/src/{authorize,credential,management-session,manager-login,login,staff,index}.ts`.
Tests: `authority.test.ts`, `authorize.test.ts`, `credential.test.ts`, `manager-login.test.ts`.

**Interfaces:**
```ts
export interface PersonAuthority {
  readonly personId: string;
  readonly admin: boolean;                   // holds the Admin access role
  readonly permissions: ReadonlySet<string>; // Admin: every declared permission
}
export function readPersonAuthority(tx: Database | Transaction, personId: string): Promise<PersonAuthority>;
export function holds(authority: PersonAuthority, permission: Permission | (string & {})): boolean;
```
Derived from `persons.role` in this PR. `verifyPersonCredential` returns `{ role, authority, locale }`;
`resolveManagementSession` and `authorizeManager` add `authority`. `listActivePersonsWithPermission`
keeps its signature and filters with `holds`. `roleHasPermission` and `permissionsForRole` stop
being exported from `index.ts`.

- [ ] **Step 1–4:** Supervisor holds `sale.refund`, not `report.export`; Admin holds a permission
  registered later; an unknown person holds nothing. **Step 5: Commit.**

### Task 9.2: Server consumers

**Files:** the call sites `git grep -nE 'roleHasPermission|permissionsForRole' -- apps packages ':!*.test.ts'`
lists outside identity (`apps/server/src/{alerts-api,attendance-export-api,bill-refunds,disk-stop-api,document-printer-offers,email-inbox-api,email-settings-api,manager-email-recipients,me-api,orders-api,pin-check-ahead,tender-refund-authorization,till-api,till-box-clock-api,adjustments-apply}.ts`,
`packages/venue-service/src/routes.ts:703`, and workforce's `maySelfApproveAttendance` from PR 1).

- [ ] **Step 1–4:** each becomes `holds(x.authority, p)`; removing the old exports makes the
  existing suites the failing check (typecheck first); `manager-email-recipients.test.ts` gains
  `it("lists each eligible person once")`. Run `pnpm --filter @waitron/server typecheck` and each
  touched suite. **Step 5: Commit**, `/finish-branch`.

---

## PR 10 — Every level reader through identity; dashboard by permission (A1002 cut 11)

**Outcome:** nothing outside identity reads a level, by drizzle or raw SQL; the dashboard shows
screens by permission and knows a person is signed in from their id. Behaviour unchanged.
**Depends on:** PR 9. **Risk trigger:** auth.

### Task 10.1: Level readers behind identity

**Files:** `packages/identity/src/authority.ts` (new readers); `apps/server/src/recovery-environment.ts:133`,
`packages/provisioning/src/recover-provisioned-venue.ts:49`, `packages/provisioning/src/venue-apply.ts`
(`:99-101`, `:215-217`, `:390-392`, `:516-518`, `:558-560`), `apps/server/src/break-glass-command.ts:94-130`,
`apps/server/src/handover-compare.ts:388-400`, `packages/workforce/src/corrections.ts:35-40`
(its raw `select role from persons`), `apps/server/src/testing/bill-venue.ts:324`.
Tests: `recovery-environment.boot.test.ts`, `break-glass-command.test.ts`, `handover-compare.test.ts`,
`venue-apply.test.ts`, `recover-provisioned-venue.test.ts`.

**Interfaces:**
- `listAdminHolders(tx: Database | Transaction, options?: { status?: "active" }): Promise<{ id: string; passwordHash: string | null }[]>`.
- `isAdminHolder(tx, personId): Promise<boolean>`.
- `holdsInCopy(query: CopyQuery, personId: string, permission: string): Promise<boolean>` — the
  handover compare's reading of the offered copy (the type of `query` is the one
  `handover-compare.ts` already uses).
- `configuration-transfer.ts:853`'s raw `where role <> 'admin'` becomes "not an Admin holder",
  through `listAdminHolders`.
All read `persons.role` in this PR; PR 11 changes only their bodies.

- [ ] **Step 1–4:** each caller's suite is the failing check once its raw SQL is replaced; add
  `it("the recovery page refuses an active manager's password")` if `recovery-environment.boot.test.ts`
  lacks it (the file's "refuses active manager" case pins it today). Then
  `git grep -nE "role (<>|=) ?'(admin|manager|supervisor|staff)'|persons\.role|\.role as PersonRoleValue" -- apps packages ':!*.test.ts' ':!packages/identity/**' ':!**/drizzle/**'`
  prints only `packages/catalogue` section-role matches. **Step 5: Commit.**

### Task 10.2: Dashboard screens by permission; signed-in by person id

**Files:** `apps/dashboard/src/dashboard-app.ts` (`:203-310` nav rules; `sessionRole` at `:955`
and its uses at `:1020, :1046, :1075, :1111, :1118, :1218, :1265, :1317, :1327, :1340, :1415,
:1502, :1591, :1731, :1732, :1844, :2325, :2358, :2485, :2503, :2537, :2730, :2787, :2864`).
Tests: `apps/dashboard/src/dashboard-app.test.ts`.

**Interfaces:**
- `@state() private sessionPersonId?: string` from `/me`'s `personId` is the signed-in test
  everywhere `sessionRole !== undefined` / `=== undefined` is today. The identity-change check at
  `:1317` compares `personId` and `permissions`.
- `AccessRule` loses `requiresManager`. Items with no permission require `venue.view`; former
  `requiresManager` items: `menus`, `modifiers` → `catalogue.manage`; `payments`, `demo-printer` →
  `hardware.manage`; `email`, `diagnostics`, `backup`, `cloud` → `system.manage` (each the gate of
  that screen's first GET route; use the route's gate if `git grep` shows another). `my-schedule`
  and `orders` stay open to every signed-in person. "Own pages only" = holds no permission another
  nav item requires; it replaces every `sessionRole === "staff"` branch.

- [ ] **Step 1:** `it("a person holding only payment.take sees My schedule and Orders")`;
  `it("a person holding venue.view sees the venue screens")`; `it("a person holding nothing signs
  in to their own pages")` — `/me` mock with `permissions: []` leaves the shell signed in, no
  refusal, no sign-in screen (Review focus 5); keep the existing Staff/Manager/Admin navigation
  assertions.
- [ ] **Step 2–4.** **Step 5: Commit**, `/finish-branch`.

---

## PR 11 — Access-role storage; `persons.role` removed (A1002 cut 12)

**Outcome:** the four built-in access roles are rows, people hold them through memberships,
authority reads memberships, and `persons.role` is gone. Each person still holds exactly one
built-in role, set through the existing staff form's `role` field (transitional; PR 15 replaces
it). Any change of that role expires the person's outstanding links. **Depends on:** PR 5, PR 7,
PR 10. **Risk trigger:** migration, auth. **First PR line:** core starting migration rebuilt, venue
reset.

### Task 11.1: Tables, built-ins, authority

**Files:** Create `packages/db/src/schema/identity/roles.ts`, `packages/identity/src/roles.ts`;
modify `packages/db/src/schema/identity/persons.ts` (drop `role`, `personRole`, `persons_role_ck`),
`packages/db/src/schema/identity/index.ts`, `packages/db/src/{classification,index}.ts`,
`packages/identity/src/{classification,authority,index}.ts` (PR 10's readers now read memberships),
`scripts/write-path-tables.json`, `scripts/schema-constraints.test.ts`, generated drizzle.
Tests: `packages/identity/src/roles.test.ts`, `authority.test.ts`, `packages/db/src/schema/identity/roles.test.ts`.

**Interfaces:**
- `roles`: `id`, `builtInKey` enum `staff|supervisor|manager|admin` nullable, `name` nullable,
  `nameFolded` nullable, `permissions: json<string[]>` not null default `[]`, `createdAt`. Unique
  `roles_built_in_key_uq` (where not null), `roles_name_folded_uq` (where not null); CHECK
  `roles_name_ck` `(built_in_key is null) = (name is not null)`; CHECK
  `roles_admin_permissions_ck` `built_in_key is not 'admin' or json_array_length(permissions) = 0`. `state`.
- `person_roles`: `personId` FK cascade, `roleId` FK restrict, PK both. `state`.
- `scripts/write-path-tables.json`: `"roles"` and `"person_roles"` → `["packages/identity/src/roles.ts"]`.
- `roles.ts`: `BUILT_IN_ROLE_KEYS`; `ensureBuiltInRoles(tx): Promise<Record<BuiltInRoleKey, string>>`
  (inserts missing ones with `defaultPermissionsFor(key)`, Admin `[]`);
  `setBuiltInMembership(tx, personId, key)` and `heldBuiltInKey(tx, personId): Promise<BuiltInRoleKey | null>`
  (transitional, deleted in PR 15).
- `readPersonAuthority`: memberships ⋈ roles; Admin → `declaredPermissions()`; else the union of
  held lists filtered by `isDeclaredPermission`. `PersonAuthority` adds `roleIds: readonly string[]`.

- [ ] **Step 1–4:** built-ins created once with their defaults; authority is the union of held
  roles (Staff plus a hand-inserted `{ name: "Accountant", permissions: ["report.view"] }`); a
  stored undeclared permission authorizes nobody; no role holds nothing; the two CHECKs; "Café"
  then "CAFE" refused by the folded index. Rebuild `--set core`; schema guards. **Step 5: Commit.**

### Task 11.2: Identity writers and readers

**Files:** `packages/identity/src/{staff,credential,management-session,manager-login,login,authorize,personal-data}.ts`,
`packages/shared/src/{person-role,index}.ts` (delete `PersonRoleValue`). Tests: identity's staff,
lifecycle, authority, personal-data, login and session suites.

**Interfaces:**
- `updatePersonDetails` and `invitePerson` keep `role: BuiltInRoleKey` input and write it through
  `setBuiltInMembership`. **Only an Admin holder sets `admin` or changes an Admin holder's role**
  (`actor.admin`, else `authorization.not_permitted` `{ permission: "person.admin" }`), replacing
  today's "any `person.admin` holder" at `staff.ts:234-241`. Every "active admins" query becomes
  "active persons holding Admin".
- **Any change of the role expires the person's outstanding links** with
  `invalidatePersonAccountActions` (today only on Admin gain or loss, `staff.ts:290`, `:522`).
- `listActivePersonsWithPermission` reads all active people's memberships and roles in one query,
  never one authority read per person.
- `PersonSummary.role` = `heldBuiltInKey`; `login.ts`'s client `role` field goes;
  `verifyPersonCredential`, `resolveManagementSession`, `authorizeManager` lose `role`.
- Personal-data export lists `accessRoles: string[]` (built-in keys or custom names).

- [ ] **Step 1:** `it("the last admin is counted by membership")`; `it("only an Admin holder makes
  someone Admin")` (a person given `person.admin` through the Manager row's stored permissions is
  refused); `it("changing a person's role from Staff to Supervisor expires their invitation")`.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 11.3: Setup, transfer and import

**Files:** `packages/provisioning/src/venue-apply.ts` (seed-admin), `packages/identity/src/configuration-transfer.ts`,
`packages/provisioning/src/configuration-transfer.ts:848-910`, `packages/db/src/activity-kinds.ts`,
bundle version. Tests: `venue-apply.test.ts`, `apps/server/src/configuration-transfer.test.ts`,
`configuration-transfer.security.test.ts`, `apps/server/src/first-fiscal-setup.e2e.test.ts`.

**Interfaces:**
- `seed-admin` calls `ensureBuiltInRoles`, adds the Admin membership and logs
  `access_role.member_added` (`person`, `{ roleId, builtInKey, name: string | null }`) with
  `personId: null`; `access_role.member_removed` is declared with the same data.
- `IDENTITY_CONFIGURATION_TRANSFER` adds `{ name: "roles" }`, `{ name: "person_roles" }` after
  persons. The import deletes `person_roles` except the importing administrator's Admin membership
  (they keep Admin). A bundle row with a `built_in_key` maps onto the target's built-in of that
  key (`idMap.set(bundleId, targetId)`), updates its `permissions` (never Admin's), and is not
  inserted. **Any role row's `permissions` naming an undeclared ID refuses the import**
  `setup.request_invalid` `{ field: "roles.permissions" }`. Each imported membership is logged
  with `personId: null`; no mail.

- [ ] **Step 1:** in `configuration-transfer.test.ts`: `it("after an import the administrator still
  holds Admin")`; `it("import keeps the target's built-ins and carries an edited Supervisor")`;
  `it("an imported role naming an undeclared permission is refused")`; `it("imported memberships
  are logged, not mailed")`.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 11.4: Demo, bench and the remaining fixtures

**Files:** `packages/country-es/src/demo/{staff,casa-delgado-*}.ts`, `apps/server/scripts/demo-seed/{seed-staff,data-set}.ts`,
`apps/server/scripts/bench/bench-venue.ts`, the Madrid demo JSON, `packages/identity/test/person-rows.ts`
(now `ensureBuiltInRoles` plus memberships), and by hand the `role:` fields left in `db`, `fiscal`,
`catalogue`, `country-es` tests.

- [ ] **Step 1–4:** the Madrid baseline test counts memberships per built-in; each touched suite
  passes. **Step 5: Commit**, `/finish-branch`.

---

## PR 12 — Rule 2 on every route; the email-change permission (A1002 cut 13)

**Outcome:** you can change another person's email or status, clear their PIN, suspend or
reactivate them, or send them an invitation or reset, only if you hold every permission they hold;
changing an existing person's email also needs "Change other people's email addresses"
(`person.email`, Admin only by default). **Depends on:** PR 11. **Risk trigger:** auth.

### Task 12.1: Rule 2 and `person.email` on the routes

**Files:** Create `packages/identity/src/admin-anchor.ts` (the cover check, extended in PR 13);
modify `packages/identity/src/{staff,account-action,permissions,errors}.ts`,
`apps/dashboard/src/i18n/codes.ts`. Tests: `apps/server/src/management-api.staff-rule2.test.ts`
(new), `packages/identity/src/staff-authority.test.ts`.

**Interfaces:**
- `export function assertActorCovers(actor: PersonAuthority, target: PersonAuthority): void` —
  throws `person.holds_more` `{ personId }` unless `(actor.admin || !target.admin)` and every target
  permission is in the actor's.
- New core permission `person.email`, label "Change other people's email addresses", defaults `[]`.
- Applied to another person in: `updatePersonDetails` **whenever the email or the status changes**
  (an email change also needs `person.email`, else `authorization.not_permitted`
  `{ permission: "person.email" }`); `clearPersonPin`; `deactivatePerson`; `resetPersonLogin`;
  `reactivatePersonForInvitation`; `queueInvitation` and the invitation route. Setting the email
  when inviting someone new stays under `person.admin`.
- The unused exports `setEmail`, `resetPin`, `setPassword`, `setRole` and `createPerson`
  (`staff.ts`; `git grep -nE '\b(setEmail|resetPin|setPassword|setRole|createPerson)\(' -- apps packages ':!*.test.ts'`
  prints nothing) are deleted with their tests. Nobody sets another person's PIN.
- Wording `person.holds_more`: EN "This person can do things you can't, so only someone who can do
  everything they can may change their sign-in." / ES "Esta persona puede hacer cosas que tú no,
  así que solo alguien que pueda hacer todo lo que ella hace puede cambiar su acceso."
- Test actor: Managers hold `person.admin` only from PR 15, so each test gives the Manager built-in
  row `person.admin` (and, where a test needs it, `person.email`) by updating its stored
  `permissions` in the test database before signing in. A "more" target is a person holding a
  hand-inserted custom role `{ name: "Accountant", permissions: ["report.view", "fiscal.remedy"] }`.

- [ ] **Step 1:** HTTP tests, each with its refusal code. Through **each** of
  `PUT /management-api/staff/:id` (email, then status), `POST …/reset-pin`, `…/reset-login`,
  `…/reactivate`, `…/invitation`, `…/deactivate`: the Manager succeeds on a waiter, and is refused
  `person.holds_more` on the Accountant **and** on an Admin. Email specifically: a Manager holding
  `person.admin` but not `person.email` changing a waiter's email → `authorization.not_permitted`
  naming `person.email`; holding both, still refused for the Accountant (Rule 2 on top). Inviting a
  new person with an email still works with `person.admin` alone. Self-service changes of one's own
  email and password still pass.
- [ ] **Step 2–4.** **Step 5: Commit**, `/finish-branch`.

---

## PR 13 — The usable Admin; email changes logged and the old address told (A1002 cut 14)

**Outcome:** a change that would leave no usable Admin is refused on every path; every email change
made by someone other than the person is logged with who made it and a notice goes to the old
address. **Depends on:** PR 12. **Risk trigger:** auth, migration (mail kind). **First PR line:**
core starting migration rebuilt, venue reset.

### Task 13.1: The usable-Admin check on every path

**Files:** `packages/identity/src/{admin-anchor,staff,profile,passkey}.ts`,
`packages/provisioning/src/configuration-transfer.ts` (end of the import transaction),
`apps/dashboard/src/i18n/codes.ts`. Tests: `packages/identity/src/admin-anchor.test.ts`,
`staff-lifecycle.test.ts`, `profile.test.ts`, `apps/server/src/configuration-transfer.test.ts`,
`apps/server/src/management-api.staff-rule2.test.ts`.

**Interfaces:** `export function assertUsableAdminRemains(tx: Transaction): Promise<void>` throws
`person.last_admin` unless a usable Admin (Global constraints) remains. Runs last in
`updatePersonDetails` (including its transitional `role` field), `deactivatePerson`,
`resetPersonLogin`, own passkey removal (`profile.ts:402`), `unlinkOwnGoogle` (`profile.ts:229`),
and the configuration import. Wording adds: EN "Keep at least one active Admin who can sign in to
the dashboard." / ES "Mantén al menos un administrador activo que pueda entrar al panel."

- [ ] **Step 1:** each refused with `person.last_admin` when it would leave none (another Admin is
  PIN-only): changing the last usable Admin to Manager through `PUT /management-api/staff/:id`'s
  `role` field; suspending them; resetting them to pending; removing their last passkey with no
  password or Google; unlinking their Google when it is their only method; an import whose result
  has no usable Admin. Each passes when a second usable Admin exists (Review focus 2).
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 13.2: Email-change log and the old-address notice

**Files:** `packages/db/src/schema/outgoing-mail.ts` (kind), `packages/db/src/outgoing-mail.ts`
(`MAIL_LIFETIME_MS`), `packages/db/src/activity-kinds.ts`, `packages/identity/src/{staff,email-change-mail}.ts`,
create `apps/server/src/email-changed-mail.ts` and `apps/server/src/i18n/email-changed-email.ts`,
`apps/server/src/boot.ts` (owners list), generated drizzle. Tests: `packages/identity/src/staff.email.test.ts`,
`apps/server/src/email-changed-mail.test.ts`.

**Interfaces:**
- Mail kind `email_changed` added to `outgoingMailKinds`; `MAIL_LIFETIME_MS.email_changed = 86400000`.
- Activity kind `person.email_changed` (`person`) `{}` — the actor is `personId`; no address in
  `data`.
- `updatePersonDetails`, when someone other than the person changes the email, records the entry
  and calls `queueEmailChangedNotice(tx, { activityId, personId, actorId, oldEmail, editorName, at })`:
  `enqueueMail` with `kind: "email_changed"`, `dedupeKey: email-changed:<activityId>`,
  `subjectId: activityId`, `personId`, `requestedBy: actorId`,
  `params: { oldEmail, editorName, at }` (the old address cannot be read at claim, so it travels in
  the row, which expires after a day).
- `emailChangedMail(deps: { venueLocale: string; readTimeZone(): Promise<string> }): MailKindOwner<EmailChangedWords>`
  sends to `params.oldEmail` in the person's language: EN subject "Your sign-in email was changed",
  text "{actor} changed the email address you sign in with at {venue} on {when}. Messages for your
  account now go to the new address." / ES "Se cambió tu correo de acceso", "{actor} cambió el
  correo con el que entras en {venue} el {when}. Los mensajes de tu cuenta ahora van a la nueva
  dirección."

- [ ] **Step 1:** an administrator changing a waiter's email writes one `person.email_changed`
  entry naming the administrator and queues one `email_changed` mail to the old address; the person
  changing their own email writes neither; rollback leaves neither; the Spanish notice for a
  Spanish-speaking person.
- [ ] **Step 2–4:** rebuild `--set core`; schema guards. **Step 5: Commit**, `/finish-branch`.

---

## PR 14 — Membership changes with Rule 1, logged, mailed, links expired (A1002 cut 15)

**Outcome:** identity can change a person's access roles under Rule 1 with the changed-while-editing
check, expiring their outstanding links, logging each change and emailing the person. No route uses
it until PR 15. **Depends on:** PR 13. **Risk trigger:** auth.

### Task 14.1: Membership command

**Files:** `packages/identity/src/{roles,errors}.ts`. Tests: `packages/identity/src/roles.memberships.test.ts`.

**Interfaces:**
```ts
export function setPersonAccessRoles(tx: Transaction, input: {
  managementSessionId: string; personId: string;
  roleIds: readonly string[]; expectedRoleIds: readonly string[];
}): Promise<{ roleIds: string[] }>;
```
- Needs `person.admin` and a fresh sign-in (`requireFreshManagementSignIn`, as role changes need
  today, `staff.ts:261-262`). Sets compared without order, else `person.roles_changed` `{}`.
  Unknown ID → `role.not_found` `{ roleId }`; duplicate → `management.request_invalid` `{ field: "roleIds" }`.
- Each added or removed role: Admin needs `actor.admin`; any other needs every **declared**
  permission in the role's stored list within the actor's, else `role.not_permitted` `{ roleId }`.
  The check is on the role, not the person's total.
- When the set changes: `invalidatePersonAccountActions` for the person, one `recordActivity` and
  one `queueRoleMembershipMail` (14.2) per change, then `assertUsableAdminRemains`.

- [ ] **Step 1:** (actors given `person.admin` as in 12.1) adding a custom role within the actor's
  permissions to a person who holds Accountant → ok; removing Accountant → `role.not_permitted`;
  adding or removing Admin → `role.not_permitted`; a custom role holding every current permission
  cannot stand in for Admin; a role storing a retired ID (`sale.discount`) can still be given by an
  Admin and by an actor holding its declared permissions; stale `expectedRoleIds` →
  `person.roles_changed`; past the fresh sign-in → the existing fresh-sign-in code; the person's
  outstanding invitation is expired after any change and kept after a no-op; reordered sets log
  nothing; removing the last usable Admin's Admin → `person.last_admin`; a person may end with no
  roles.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 14.2: Membership mail

**Files:** Create `packages/identity/src/role-mail.ts`, `apps/server/src/role-membership-mail.ts`,
`apps/server/src/i18n/role-membership-email.ts`; modify `apps/server/src/boot.ts` (owners list).
Tests: `packages/identity/src/role-mail.test.ts`, `apps/server/src/role-membership-mail.test.ts`.

**Interfaces:**
- `queueRoleMembershipMail(tx, input: { activityId: string; personId: string; actorId: string | null; change: "added" | "removed"; roleId: string; builtInKey: BuiltInRoleKey | null; roleName: string | null; editorName: string; at: Date }): Promise<void>`
  — only when the person has an email now; `enqueueMail` with `kind: "role_membership_changed"`,
  `dedupeKey: role-membership:<activityId>`, `subjectId: activityId`, `personId`,
  `requestedBy: actorId`, `params: { change, builtInKey, roleName, editorName, at }`,
  `notAfter: at + MAIL_LIFETIME_MS.role_membership_changed`.
- `roleMembershipMail(deps: { venueLocale: string; readTimeZone(): Promise<string> }): MailKindOwner<RoleMembershipWords>`
  — claim reads the current email and locale (no email → `null`); `ROLE_MEMBERSHIP_EMAIL_WORDS`:
  added EN "Role added: {role}" / "{actor} added you to {role} on {when}."; ES "Rol añadido: {role}"
  / "{actor} te añadió al rol {role} el {when}."; removed EN "Role removed: {role}" / "{actor}
  removed you from {role} on {when}."; ES "Rol quitado: {role}" / "{actor} te quitó del rol {role}
  el {when}." Built-in names translate; custom names stay literal; `{when}` in the recipient's
  language and the venue's time zone.

- [ ] **Step 1–4:** rollback leaves no mail row; no email → no row, activity still written; a
  pending or suspended person with an email gets one; Spanish compose keeps a custom name literal.
  **Step 5: Commit**, `/finish-branch`.

---

## PR 15 — Access-role tags on the staff editor; Managers hold `person.admin` (A1002 cut 16)

**Outcome:** the staff editor shows access-role tags and saves them; staff answers carry `roleIds`
instead of `role`; Managers hold `person.admin` by default (not `person.email`). **Depends on:**
PR 14. **Risk trigger:** auth.

### Task 15.1: Routes and answers

**Files:** `apps/server/src/{management-api,me-api}.ts`, `packages/identity/src/{staff,roles,permissions}.ts`.
Tests: `management-api.*staff*.test.ts`, `management-api.staff-rule2.test.ts`, `me-api.test.ts`.

**Interfaces:**
- `GET /management-api/access-roles` (gate `person.manage` or `person.admin`) →
  `{ id, builtInKey, name, permissions, holderCount }[]`, built-ins first in key order, then
  custom by localized name.
- `PUT /management-api/staff/:id/access-roles` `{ roleIds, expectedRoleIds }` → `{ roleIds }`.
- Staff list, summary and `/me` carry `roleIds: string[]`; `role` leaves every staff body and
  answer; invite takes `roleIds` (Rule 1 applies). `setBuiltInMembership` and `heldBuiltInKey`
  are deleted.
- `person.admin` defaults become `["manager"]`.

- [ ] **Step 1:** `PUT …/access-roles` without a fresh sign-in → the existing fresh-sign-in code;
  a default Manager changing a waiter's email through `PUT /management-api/staff/:id` →
  `authorization.not_permitted` naming `person.email`; a default Manager changing an Admin's status
  → `person.holds_more` (Review focus 1); `/me` answers `roleIds` and no `role`.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 15.2: Box administration stays Admin's

**Files:** tests only: `box-health-api.test.ts`, `till-box-clock-api.test.ts`, `email-settings-api.test.ts`.

- [ ] **Step 1–4:** a default Manager (now holding `person.admin`) is refused
  `authorization.not_permitted` `{ permission: "system.box_admin" }` at clock-challenge,
  clock-confirm, clock-set and both email-settings writes; on the till, a default Manager's PIN
  offered as the clock approver is refused naming `system.box_admin`, and a default Manager with no
  approver still confirms as a staff member during start-up. A default Manager can open the demo
  test inbox, which keeps `person.admin` (design §3, demo only) — assert it so the change is
  visible. **Step 5: Commit.**

### Task 15.3: Staff editor and app shell

**Files:** `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/widgets/{person-form,person-edit,staff-list}.ts`,
`apps/dashboard/src/screens/staff-screen.ts`, `apps/dashboard/src/i18n/{domain,strings,codes}.ts`,
`apps/dashboard/src/dashboard-app.ts`, the 52 dashboard test files with `role: "<level>"` mocks,
`apps/server/src/guide/{en,es}/staff.md` (`{#account-access}`). Tests: `person-form.test.ts`,
`person-edit.test.ts` (+ `.unsaved`), `staff-screen.test.ts`, `dashboard-app.test.ts`.

**Interfaces:**
- Editor row "Access roles — what they may do" / ES "Roles de acceso — lo que puede hacer", a
  `wt-combobox multiple`; a role the viewer cannot give (Rule 1 from `/me` permissions and the
  role's declared list) has no remove control and is not offered. No roles: EN "No access role" /
  ES "Sin rol de acceso". The email field is read-only unless the viewer holds `person.email` or is
  editing themselves. The staff list shows every role; its filter matches any selected role, each
  person once.
- Refusals: `role.not_permitted` EN "You can only give or take away a role whose permissions you
  all have." / ES "Solo puedes dar o quitar un rol cuyos permisos tengas todos.";
  `person.roles_changed` EN "Someone changed this person's access roles while you were editing.
  Reload to see them; your changes are kept until you do." / ES "Alguien cambió los roles de acceso
  de esta persona mientras editabas. Recarga para verlos; tus cambios se conservan hasta entonces."
- Mocks change `role` to `roleIds` mechanically (one commit, no assertion changed).

- [ ] **Step 1:** two tags save with the set read; a role the viewer cannot give has no remove
  control; stale save keeps the draft; filter by two roles lists a two-role person once; the email
  field is read-only for a default Manager editing a waiter; the app shell, given a real `/me`
  answer from the server for a person with `roleIds: []` (captured from `me-api.test.ts`), stays
  signed in on My schedule (Review focus 5).
- [ ] **Step 2–4.** Guides EN/ES for roles, the two rules and the email permission. **Step 5:
  Commit**, `/finish-branch`.

---

## PR 16 — Custom access roles, server (A1002 cut 17)

**Outcome:** holders of `person.admin` can create, copy, rename, edit the permissions of and delete
access roles within Rule 1; built-ins keep fixed names and Admin's list is locked; every change is
logged, and deletion expires each holder's links and emails each person who loses the role.
**Depends on:** PR 15. **Risk trigger:** auth.

### Task 16.1: Lifecycle

**Files:** `packages/identity/src/{roles,errors}.ts`, `packages/db/src/activity-kinds.ts`.
Tests: `packages/identity/src/roles.lifecycle.test.ts`.

**Interfaces:**
```ts
export function createAccessRole(tx, input: { managementSessionId: string; name: string; permissions: readonly string[]; copiedFrom?: string }): Promise<{ id: string }>;
export function renameAccessRole(tx, input: { managementSessionId: string; roleId: string; name: string; expectedName: string }): Promise<void>;
export function setAccessRolePermissions(tx, input: { managementSessionId: string; roleId: string; permissions: readonly string[]; expectedPermissions: readonly string[] }): Promise<void>;
export function deleteAccessRole(tx, input: { managementSessionId: string; roleId: string }): Promise<{ removedFrom: number }>;
```
- All need `person.admin` and the actor holding every declared permission the role carries before
  and after (Rule 1); each ticked permission must be held → `role.not_permitted`. Undeclared →
  `role.permission_unknown` `{ permission }`. Names: trimmed, nonempty (`role.name_required`),
  unique folded among custom roles (`role.name_taken` `{ name }`). Stale → `role.changed` `{}`.
- Built-ins: rename/delete → `role.built_in` `{ roleId }`; Admin's permissions → `role.built_in`.
- Copy reads the source's current effective permissions (Admin: `declaredPermissions()`), takes no
  people, and is an ordinary custom role; Rule 1 applies to the copy's list.
- Delete removes each membership (`invalidatePersonAccountActions` for each holder, logged
  `access_role.member_removed`, mailed through `queueRoleMembershipMail`), deletes the row and logs
  `access_role.deleted`.
- Kinds (`access_role` subject): `access_role.created` `{ name, permissions, copiedFromRoleId: string | null }`;
  `access_role.renamed` `{ from, to }`; `access_role.deleted` `{ name, permissions }`;
  `access_role.permission_added` / `access_role.permission_removed` `{ permission }`, one per
  permission. A permission edit queues no mail.

- [ ] **Step 1:** a Manager creates "Accountant" with `report.view`, `report.export`, `fiscal.view`;
  ticking `node.manage` → `role.not_permitted`; a Manager copying Admin → `role.not_permitted`; an
  Admin copying Admin gets today's declared list and no people. Rule 1's "before" half: on a role
  carrying `fiscal.remedy`, a Manager removing one of its permissions, renaming it and deleting it
  are each `role.not_permitted`. "Café" then "CAFE" → `role.name_taken`; renaming Manager or
  editing Admin → `role.built_in`; removing `payment.take` from Staff stops a Staff holder taking
  payment; stale `expectedPermissions` → `role.changed`; deleting a role held by three people logs
  three removals, expires their links and queues mail for those with email; a permission edit
  queues no mail.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 16.2: Routes

**Files:** Create `apps/server/src/access-roles-api.ts` (mounted from `management-api.ts`).
Tests: `apps/server/src/access-roles-api.test.ts`.

**Interfaces:** `POST /management-api/access-roles` `{ name, permissions, copiedFrom? }` → 201
`{ id }`; `PUT …/:id/name` `{ name, expectedName }`; `PUT …/:id/permissions`
`{ permissions, expectedPermissions }`; `DELETE …/:id` → `{ removedFrom }`. Each one
`withTransaction` with `requireFreshManagementSignIn`.

- [ ] **Step 1–4:** each verb's success and one refusal. **Step 5: Commit**, `/finish-branch`.

---

## PR 17 — Access roles page (A1002 cut 18)

**Outcome:** People → Access roles lists the roles; each role's page shows its permissions as
labelled ticks grouped by area; Admin's page is locked; Copy and Delete confirm once. **Depends
on:** PR 16. **Risk trigger:** none (light path).

### Task 17.1: Permission labels

**Files:** Create `apps/dashboard/src/i18n/permissions.ts`. Test: `permissions.test.ts` beside it.

**Interfaces:**
```ts
export type PermissionArea = "sales" | "reports" | "people" | "venue";
export interface PermissionText { area: PermissionArea; label: StringKey; help?: StringKey }
export const PERMISSION_TEXT: Readonly<Record<string, PermissionText>>;
```
Areas (design §10): Sales — `payment.take`, `sale.void`, `sale.refund`, `sale.rectify`,
`cash.drawer`, `adjustment.apply`, `adjustment.approve`; Reports and tax — `report.view`,
`report.export`, `fiscal.view`, `fiscal.remedy`, `personal_data.export`; People and rota —
`person.manage`, `person.admin`, `person.email`, `schedule.manage`, `workforce.correct`,
`workforce.self_approve`; Venue and system — `catalogue.manage`, `venue.view`, `venue.configure`,
`hardware.manage`, `purchase.manage`, `adjustment.manage`, `booking.manage`, `system.manage`,
`system.box_admin`, `node.manage`. Short EN/ES labels; `help` arrives in PR 18. A module
permission absent from the map shows under Venue and system with its ID.

- [ ] **Step 1–4:** every declared ID (after `ALL_MODULE_PERMISSIONS` is registered) has an entry
  and both languages have each label. **Step 5: Commit.**

### Task 17.2: The page

**Files:** Create `apps/dashboard/src/screens/access-roles-screen.ts`; modify `apps/dashboard/src/dashboard-app.ts`
(team group `{ screen: "access-roles", labelKey: "nav.access_roles", requiresPermission: "person.admin" }`),
`apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`. Tests:
`access-roles-screen.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.

**Interfaces:** list `wt-data-table` (name, people, `actions` column `pinned: "end"`); role page:
name (custom only; built-ins show their fixed translated name), one `wt-switch` per permission by
area; a permission the viewer lacks is shown, disabled. Admin: all on and disabled, EN "Admin always
has every permission." / ES "Admin siempre tiene todos los permisos." Copy asks for a new name.
Delete confirms once: EN "{count} people hold {role}. Deleting it takes it away from them." / ES
"{count} personas tienen {role}. Al eliminarlo se les quita."

- [ ] **Step 1–4:** create with two ticks; a lacking permission is disabled; Admin all locked;
  copy keeps ticks with a new name; delete names the count; stale save keeps the draft; unsaved
  leave protection; axe in both themes; phone width without horizontal scroll; look at it in both
  themes, EN/ES (screenshots uncommitted). **Step 5: Commit**, `/finish-branch`.

---

## PR 18 — Permission help bubbles and guides (A1002 cut 19)

**Outcome:** each permission on a role's page has a help bubble saying what it covers, written
from the code that checks it and linking to the guide; the Access roles and Job roles pages link
to each other; the guide gains an Access roles section. **Depends on:** PR 17. **Risk trigger:**
none (light path; the text is checked against the code).

### Task 18.1 and 18.2: Help text from the code (two tasks)

**18.1:** Sales and Reports-and-tax permissions. **18.2:** People-and-rota and Venue-and-system.

For each permission the implementer runs `git grep -n '"<id>"' -- apps packages ':!*.test.ts'`,
reads each gate, and writes two or three sentences naming the screens and actions it opens, EN and
ES, as `help` keys in `PERMISSION_TEXT`; each bubble (`wt-help-tooltip mode="help-mode"`) links to
`{#access-roles}`. The commit message lists, per permission, the files read.

- [ ] **Each task:** test that every permission in its areas has a `help` key in both languages and
  the bubble renders with the guide link; then write the text. **Commit.**

### Task 18.3: Guide and cross-links

**Files:** `apps/server/src/guide/{en,es}/staff.md` (new `{#access-roles}`), `apps/dashboard/src/help-guide.ts`,
`apps/dashboard/src/screens/access-roles-screen.ts`, `packages/staffing/src/dashboard/staff-roles-screen.ts`.
Link lines: Access roles EN "Job roles put people on the rota and on devices; they grant no
permissions." / ES "Los puestos ponen a las personas en el cuadrante y en los dispositivos; no dan
permisos."; Job roles EN "Access roles decide what people may do." / ES "Los roles de acceso
deciden lo que puede hacer cada persona."

- [ ] **Step 1–4:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`. Delete A1002's build entries from
  `docs/backlog.md` and its area files; `git grep -nE 'PersonRoleValue|grantedFrom|persons\.role|admittedRoles|applyRoles|approverRoles|billApproverRoles' -- docs/developers docs/operations docs/backlog docs/backlog.md README.md CLAUDE.md`
  prints nothing. **Step 5: Commit**, `/finish-branch`.
