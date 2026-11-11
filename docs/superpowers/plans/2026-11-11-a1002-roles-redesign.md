# A1002 access roles and job roles — implementation plan

**Status: DRAFT, under review** (fresh-context plan-against-design read, then a Fable second
read). Build nothing until the owner approves it and it is queued to a lane.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Replace the four fixed levels with access roles (ticked permissions, several per person,
Admin always everything) and core job roles (rota and device sign-in, no permissions), as the
owner-approved 11 November design states.

**Architecture:** Eleven pull requests, each leaving `main` working. The first four change what
needs no new storage for access roles: permission declarations without the ladder, comps by
permission and limit, job roles moved into core, device sign-in by job role. The next two move
every test and every permission check onto one "person's authority" reading while `persons.role`
still exists, so the storage change that follows is small. The last four add the rules, several
roles per person, custom roles and their page.

**Tech Stack:** TypeScript, pnpm workspace, drizzle on `node:sqlite`, Hono routes, Lit `wt-*`
components, Vitest (node and browser mode).

**Spec:** [2026-11-11 roles redesign](../specs/2026-11-11-a1002-roles-redesign-design.md), which
replaces the [7 November design](../specs/2026-10-22-a1002-custom-roles-design.md) except where its
§9 says "kept". Read both §-references a task cites. Cut 1 (#2578, the permission renames) has
landed and is not re-planned.

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
  every permission they hold.

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
- Built-in access role keys are exactly `staff`, `supervisor`, `manager`, `admin`. Their names are
  translated in code and never stored. Custom names are trimmed, nonempty, unique under
  `foldForUniqueness` (`packages/identity/src/fold.ts`), stored literally, never translated.
- Admin holds every **declared** permission, including ones declared later; it stores none. An
  undeclared permission ID authorizes nobody, Admin included. A saved permission list refuses an
  undeclared ID.
- One `withTransaction` per mutation; queries inside it are awaited in turn, never `Promise.all`.
  Every mutation that can remove Admin from someone, suspend, reset to pending, remove a sign-in
  method, delete a role or import ends with the usable-Admin check before commit.
- Activity entries go through `recordActivity` (`packages/db/src/activity-log.ts`) with kinds
  declared in `packages/db/src/activity-kinds.ts`; `data` names people by id only. Access-role
  membership mail goes through `enqueueMail` (`packages/db/src/outgoing-mail.ts`) with kind
  `role_membership_changed` in the same transaction. Job-role changes are never emailed. Setup and
  import log baseline memberships and email nothing.
- Every new error code is declared in its package's `errors.ts` and worded in English and Spanish
  where a screen shows it (`apps/dashboard/src/i18n/codes.ts`, `apps/till/src/i18n/strings.ts`).
  A refusal says what happened and what each choice does (CLAUDE.md §3).
- Forms follow design-system Forms: `draftScopeFor`, `saveActionState`, an unchanged-draft early
  return, inline errors, one localized message above the buttons. No screen draws a native field.
  Permission ticks and device job-role ticks are `wt-switch` rows (as the device profile's role
  ticks are today); role tags on the staff editor are a `wt-combobox` with `multiple`.
- Every screen change updates `apps/server/src/guide/en/*.md` and `apps/server/src/guide/es/*.md`
  with shared `{#id}` headings; help bubbles are `wt-help-tooltip mode="help-mode"`, written from
  the code that does what they describe.
- English-only code and fixtures; Spanish starter text only in a package's `src/starter-content.ts`.
- TDD: each behaviour step starts with a test that fails for the stated reason; run it and see it
  fail before writing code. Rewritten tests keep their behavioural assertions. Rejected writes
  assert the domain error code.
- Focused tests locally; CI runs the package suites. Do not hand-run the pre-push hook's checks.
- Implementers stop at about 150 tool calls with a commit and a handover (done, left, files, each
  check's state).

## Review focus

The inputs most likely to bite a person that no task's main tests would otherwise exercise. Each
has a test in the task named after it.

1. **A zero limit with a rounding allowance.** A reason with a 0% item limit on a dish whose
   rounding allowance is 2 cents must still need approval for a 1-cent reduction; today's
   `belowFloor` (`packages/adjustments/src/policy.ts:255-266`) would let it through. Task 2.1.
2. **The last usable Admin, by every path.** Deleting a role, removing a membership, suspending,
   resetting to pending, removing the last password/passkey/Google link, and import must each
   refuse leaving no active Admin holder with an email and a dashboard sign-in method. Tasks 7.1,
   8.1, 9.1.
3. **A hidden job role still used by future shifts.** The rota must still show its name and warn
   about the person; no device lists anyone through it; it cannot be picked again; its name is free.
   Task 3.3.
4. **A link redeemed after the sender lost authority.** An invitation sent by a Manager, redeemed
   after the target gained a permission the Manager lacks, is refused; one sent before an unrelated
   role change still works. Task 7.2.
5. **A person with no access role signing in to the dashboard.** They reach their own pages, never
   a refusal loop, and see no management screen; the till lock screen does not list them unless a
   job role does. Tasks 5b.3 and 8.3.

## Sizing

Counted on `0740fbf6b3` with `git grep` (zsh `grep` avoided; `/usr/bin/grep` for counts):

- The brief's identifier set (`persons.role`, `PersonRoleValue`, `personRole`, `roleHasPermission`,
  `ROLE_LADDER`, `grantedFrom`, `registerModulePermissions`, `sessionRole`, `"person.admin"`, staff
  role tables, admission tables, comp role lists, `policySnapshot`, `role-parity`) touches **326
  files: 97 production, 229 test or helper** (`files.txt` of the planning session; drizzle and
  migration SQL excluded).
- Tests that create people: **490 `insert(persons)` sites in 356 files**, **97 `update … set role`
  sites in 57 files**, **72 `persons.role` reads in 43 files**, **860 `role: "<level>"` literals in
  382 files** (some are clock-source literals, not person roles). This, not product code, is the
  biggest single cost; PR 5a moves it behind two helpers mechanically.
- Per area, production/test files: permission registrations 8/52; `mirror.create|node.promote`
  15/20; staff-role tables 41/58; device admission 18/40; comp role lists 26/77; permission-check
  call sites 89/31.
- Files read in full: the two designs; `packages/identity/src/{permissions,staff,profile-admission,authorize,management-session,credential}.ts`
  (staff.ts 330–684 in part); `packages/staffing/src/staff-roles.ts`; `packages/adjustments/src/{policy,settings,provisioning}.ts`;
  `packages/db/src/schema/{identity/persons,identity/profile-admission,identity/management-account-actions,adjustments/reasons}.ts`;
  `packages/workforce/src/schema/staffing/staffing.ts`; `packages/db/src/{activity-log,activity-kinds,outgoing-mail}.ts`;
  `apps/server/src/{mail-sender,box-alert-mail}.ts` (heads). Read in part: `management-api.ts`
  1060–1260, `venue-apply.ts`, `account-action.ts`, `dashboard-app.ts` navigation, `box-health-api.ts`,
  `till-box-clock-api.ts`, `adjustments-api.ts`, `configuration-transfer.ts` import loop,
  `composition/src/modules.ts`.
- Hours are implementer-active time per PR, from the lanes' measured medium-effort dispatches
  (7–23 minutes, 43–87 turns each, `~/waitron-campaign-shared/effort-trial.md`) at 5–8 tasks per
  PR, plus one CI fix round. Line counts are estimates from the files above, not a diff.

| PR | Outcome | Prod files | Prod lines +/− | Test files | Test lines +/− | Generated | Hours |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Permissions declared without the ladder | ~30 | +170 / −130 | ~65 | +180 / −150 | none | 2 |
| 2 | Comps by permission and limit | ~25 | +250 / −450 | ~45 | +300 / −420 | core baseline ~60 | 3 |
| 3 | Job roles in core, staffing always on | ~50 | +300 / −180 | ~60 | +300 / −200 | core + workforce baselines ~150 | 3 |
| 4 | Device sign-in by job role | ~20 | +420 / −380 | ~40 | +420 / −420 | core baseline ~40; demo JSON ~30 | 3 |
| 5a | Test people behind two helpers | 0 | 0 | ~400 | +950 / −900 | none | 2 |
| 5b | One authority reading for every check | ~35 | +260 / −220 | ~30 | +220 / −160 | none | 2.5 |
| 6 | Access-role storage, `persons.role` removed | ~30 | +460 / −260 | ~30 | +320 / −220 | core baseline ~120 | 2.5 |
| 7 | Rule 2, usable Admin, links checked when used | ~8 | +360 / −120 | ~10 | +600 / −100 | core baseline ~10 | 3 |
| 8 | Several access roles per person | ~22 | +700 / −320 | ~30 | +700 / −320 | none | 3 |
| 9 | Custom access roles (server) | ~7 | +460 / −20 | ~5 | +620 / −0 | none | 2.5 |
| 10 | Access roles page and help bubbles | ~9 | +1,300 / −30 | ~5 | +700 / −0 | none | 3 |
| **Total** | | | **≈ +4,700 / −2,100** | | **≈ +5,300 / −2,900** | **≈ 410 lines** | **≈ 29.5** |

The uncertainty is concentrated in two places: how many test files the 5a codemod cannot rewrite
(estimated 20–40 by hand; each extra 20 is about half an hour), and browser-test CI rounds on the
three screen PRs (4, 8, 10). Everything else is sized from code read, not padded. A reasonable
range is 26–33 hours. No PR is expected to exceed three hours; PR 2 and PR 3 are the fullest.

## Landing order and dependencies

```text
1 ─┬─► 2 ─────────► 5b ─┐
   └─► 3 ──► 4 ─────────┼─► 6 ──► 7 ──► 8 ──► 9 ──► 10
5a (any time) ──────────┘
```

PR 2 and PR 3 may run in parallel after PR 1. PR 5a may run at any time before 6. PR 5b needs 1
(and should follow 2, whose policy already takes a permission set). PR 6 needs 4 (device sign-in no
longer reads `persons.role`) and 5a and 5b.

Coordination, not prerequisites: `origin/refactor/a1308-5d-venue-clock` (284 files, venue clock
stores) overlaps PR 1's clock routes; rebase whichever lands second. A1308's people slice waits for
PR 6.

---

## PR 1 — Permissions declared without the ladder (A1002 cut 2)

**Outcome:** every permission states which of Staff, Supervisor and Manager hold it by default and
Admin holds all; the §3 inventory changes that need no new rule land with their consumers.
Observable change: Supervisors and Managers lose the unused `sale.discount`; Managers can restart
the box. **Depends on:** nothing. **Risk trigger:** auth and permissions (full review path).

### Task 1.1: Declarations replace the ladder

**Files:**
- Modify: `packages/identity/src/permissions.ts`, `packages/identity/src/index.ts`,
  `packages/module/src/module.ts:110-122`, `packages/module/src/index.ts`,
  `packages/composition/src/role-parity.ts`, `packages/{workforce,adjustments,bookings,staffing,venue-service,fiscal-verifactu}/src/permissions.ts`
- Test: `packages/identity/src/permissions.test.ts`, every test calling `registerModulePermissions`
  (52 files; `git grep -l registerModulePermissions -- '*.test.ts'`).

**Interfaces:**
- Produces (module): `export type ModuleDefaultHolder = "staff" | "supervisor" | "manager";`
  `export type ModulePermission = { readonly permission: string; readonly defaultHolders: readonly ModuleDefaultHolder[] };`
  `ModuleRole` is deleted.
- Produces (identity): `export type BuiltInRoleKey = "staff" | "supervisor" | "manager" | "admin";`
  `export type DefaultHolder = Exclude<BuiltInRoleKey, "admin">;`
  `export interface PermissionDeclaration { readonly permission: string; readonly defaultHolders: readonly DefaultHolder[] }`
  `export const CORE_PERMISSIONS` (`as const satisfies readonly PermissionDeclaration[]`);
  `export type Permission = (typeof CORE_PERMISSIONS)[number]["permission"];`
  `export function registerModulePermissions(perms: readonly ModulePermission[]): void` — overwrites
  a re-registered module ID, throws `Error("permission declared twice: <id>")` for a core ID;
  `export function declaredPermissions(): string[]`;
  `export function defaultPermissionsFor(holder: DefaultHolder): string[]`;
  `export function isDeclaredPermission(id: string): boolean`;
  `roleHasPermission(role, p)` and `permissionsForRole(role)` keep their signatures: Admin →
  `isDeclaredPermission(p)`; others → `p` declared with `role` in `defaultHolders`.
- `PersonRoleValue` (`packages/shared/src/person-role.ts`) stays until PR 6.
- `role-parity.ts` asserts `DefaultHolder` and `ModuleDefaultHolder` are the same union both ways.

- [ ] **Step 1: Write the failing tests** in `permissions.test.ts`, keeping every existing holder
  assertion that is still true:
  - `it("declares each core permission's default holders")` — a literal table:
    `payment.take` → `["staff","supervisor","manager"]`;
    `sale.void`, `sale.refund`, `sale.rectify`, `cash.drawer`, `report.view`, `venue.view` →
    `["supervisor","manager"]`;
    `person.manage`, `catalogue.manage`, `venue.configure`, `system.manage`, `schedule.manage`,
    `purchase.manage`, `report.export`, `hardware.manage`, `fiscal.view` → `["manager"]`;
    `person.admin`, `personal_data.export`, `node.manage`, `system.box_admin` → `[]`.
  - `it("Admin holds a permission registered after start")` — register
    `{ permission: "synthetic.later", defaultHolders: [] }`; `roleHasPermission("admin", "synthetic.later")`
    is `true`, `("manager", …)` is `false`.
  - `it("an undeclared permission authorizes nobody, Admin included")` —
    `roleHasPermission("admin", "nope.never") === false`.
  - `it("refuses a module redeclaring a core permission")` — registering `payment.take` throws
    `/declared twice/`.
  - `it("no longer declares retired permissions")` — `declaredPermissions()` contains none of
    `sale.discount`, `mirror.create`, `node.promote`.
- [ ] **Step 2:** `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts` — fails
  on the missing exports.
- [ ] **Step 3:** Implement the interfaces above. Module declarations:
  `workforce.correct` `["supervisor","manager"]`; new `workforce.self_approve` `[]` (in
  `packages/workforce/src/permissions.ts`); `adjustment.manage` `["manager"]`; `booking.manage`
  `["manager"]`; `fiscal.remedy` `[]`. Rewrite each test registration from `grantedFrom: "<x>"` to
  the holders list it meant (`supervisor` → `["supervisor","manager"]`, `manager` → `["manager"]`,
  `admin` → `[]`). Delete the ladder and its `arrayOfAll` helper. Cut the two stale comments at
  `permissions.ts:11` and `:22` (they describe the ladder).
- [ ] **Step 4:** run Step 2's command, `pnpm --filter @waitron/composition typecheck`, and the
  module tests that register permissions:
  `pnpm --filter @waitron/adjustments --filter @waitron/bookings --filter @waitron/media exec vitest run src/permissions.test.ts src/routes.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "Declare who holds each permission by default, without a ladder (A1002)"`.

### Task 1.2: Merge `mirror.create` and `node.promote` into `node.manage`; retire `sale.discount`

**Files:** the 15 production files `git grep -lE 'mirror\.create|node\.promote' -- apps packages ':!*.test.ts'`
lists (`apps/server/src/{carry-on,handover-compare,handover-emergency-api,handover-source-start-api,management-api,membership-removal-api,mirror-bundle-api,node-operation-https,node-operation-preparation,operation-authentication,promote-api,promotion-operation}.ts`,
`apps/dashboard/src/dashboard-app.ts`) and their 20 test files.

**Interfaces:** consumes `Permission` from 1.1 (`"node.manage"` is a member, the two old IDs are not).

- [ ] **Step 1:** In `apps/server/src/promote-api.test.ts` and `membership-removal-api.test.ts`
  (or the existing test that proves a non-Admin is refused), change the asserted permission to
  `node.manage` and add `it("a Manager given nothing extra is refused node.manage")` asserting
  `authorization.not_permitted` with `params.permission === "node.manage"`.
- [ ] **Step 2:** run them; they fail on the old permission name.
- [ ] **Step 3:** Replace every `mirror.create` and `node.promote` with `node.manage`; dashboard nav
  `servers` item `requiresPermission: "node.manage"`. Remove `sale.discount` from the catalogue
  (no call site).
- [ ] **Step 4:** run the changed tests; `git grep -nE 'mirror\.create|node\.promote|sale\.discount' -- apps packages scripts docs/developers docs/operations docs/backlog docs/backlog.md README.md CLAUDE.md`
  prints nothing (exit 1).
- [ ] **Step 5: Commit.**

### Task 1.3: Attendance self-approval needs `workforce.self_approve`

**Files:** `packages/workforce/src/corrections.ts:34-50,341-354`, `apps/server/src/management-attendance-api.ts:177`,
`apps/server/src/till-attendance-api.ts:218-226`. Tests: `packages/workforce/src/corrections.test.ts`
(or the file holding self-approval cases), `apps/server/src/management-attendance-api.test.ts`,
`apps/server/src/till-attendance-api.test.ts`.

**Interfaces:** consumes `roleHasPermission` (until PR 5b replaces it).
`authorKindFor` answers `"manager"` when the recorder holds `workforce.correct`; self-approval
needs both `workforce.self_approve` and `workforce.correct`. `MANAGER_ROLES` is deleted.

- [ ] **Step 1:** Add `it("self-approval follows workforce.self_approve, not the Admin name")`:
  register `{ permission: "workforce.self_approve", defaultHolders: ["manager"] }` for the test,
  and a Manager approving their own worker request is permitted; with the default `[]` the same
  call throws `correction.not_permitted`. Keep the existing Admin-approves-own case passing.
- [ ] **Step 2:** run; the first half fails (code checks `role === "admin"`).
- [ ] **Step 3:** Replace the role reads with permission checks; `canSelfApprove` in both APIs is
  `roleHasPermission(r, "workforce.self_approve") && roleHasPermission(r, "workforce.correct")`.
- [ ] **Step 4:** run the three test files. **Step 5: Commit.**

### Task 1.4: Box administration and restart

**Files:** `apps/server/src/box-health-api.ts:86-100,155-165,265-290`, `apps/server/src/email-settings-api.ts:57,90,102`,
`apps/server/src/till-box-clock-api.ts:137-145,213-226`, `apps/dashboard/src/dashboard-app.ts:3040-3041`,
`docs/developers/conventions-data.md:4513,4683`, `docs/developers/design-system.md:6360,6417`,
`apps/server/src/guide/{en,es}/box-status.md` (who restarts), `apps/server/src/guide/{en,es}/email.md`
if it says who edits. Tests: `box-health-api.test.ts`, `email-settings-api.test.ts`,
`till-box-clock-api.test.ts`, the dashboard box-status screen test that asserts `canRestart`.

**Interfaces:** new core permission `system.box_admin` (label "Box administration"), defaults `[]`.
`POST /api/box/restart` → `system.manage`. `POST /api/box/clock-challenge`, `/clock-confirm`,
`/clock-set`, the till clock confirm's `holdsAdmin`/`authorize`, email-settings `canEdit` and its
two write routes → `system.box_admin`. The demo email inbox keeps `person.admin` (design §3).

- [ ] **Step 1:** Tests: `it("a Manager may restart the box")` → 202 for a Manager session;
  `it("clock confirmation needs Box administration")` → a session whose role holds
  `system.box_admin` through a test registration is accepted and one holding only `person.admin`
  is refused `authorization.not_permitted` with `permission: "system.box_admin"`;
  `it("email settings edit needs Box administration")` likewise.
- [ ] **Step 2:** run; they fail. **Step 3:** change the gates; dashboard `.canRestart` reads
  `system.manage`, `.canConfirmClock` reads `system.box_admin`. Update the four doc lines and the
  guides' who-can sentences in both languages.
- [ ] **Step 4:** run the tests and `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`.
- [ ] **Step 5: Commit.** Then `/finish-branch`.

---

## PR 2 — Comps by permission and limit (A1002 cut 3)

**Outcome:** comp reasons carry no role lists; `adjustment.apply` lets a person comp within a
reason's limits and the bill's comp limit, `adjustment.approve` approves past them by PIN, and a
zero limit always needs approval. **Depends on:** PR 1. **Risk trigger:** money path, migration,
cross-package contract. **First PR line:** core starting migration rebuilt, venue reset.

### Task 2.1: Policy evaluates permissions and limits

**Files:** `packages/adjustments/src/policy.ts`, `packages/adjustments/src/permissions.ts`,
`packages/shared/src/adjustment-policy-types.ts`. Test: `packages/adjustments/src/policy.test.ts`.

**Interfaces:**
- `ADJUSTMENTS_PERMISSIONS` adds `{ permission: "adjustment.apply", defaultHolders: ["staff","supervisor","manager"] }`
  and `{ permission: "adjustment.approve", defaultHolders: ["supervisor","manager"] }`.
- `AdjustmentReason` loses `applyRoles`, `approverRoles`. `ReasonShape` loses them;
  `ReasonShapeField` = `"actions" | "maxPercentBp" | "maxAmount"`. `isRoleList` is deleted.
- `isPercentBp(v)` accepts 0..10000. `maxAmount` may be `0`.
- `CompRequest.actorPermissions: ReadonlySet<string>` replaces `actorRole`;
  `CompRequest.billLimit: { maxAmount: Decimal | null }`. `CancelRequest.actorPermissions` likewise.
- `export type Approval = { by: "limit"; permission: "adjustment.approve"; limit: { kind: "reason" | "bill"; amount: Decimal | null; percentBp: number | null } } | { by: "refund"; permission: "sale.refund" }`.
- Verdict codes lose `adjustment.no_common_approver`.
- `approves(approval: Approval, permissions: ReadonlySet<string>): boolean`.
- `AdjustmentPolicySnapshot` = `{ kind, actions, maxPercentBp, maxAmount, maxBillComp: Decimal | null, noteRequired }`.

- [ ] **Step 1: failing tests** (rewrite the role-list cases into permission cases, keeping each
  amount and percentage they assert):
  - `it("a holder of adjustment.apply comps within the reason's limit")` — Staff meal, 50% item
    limit, actor holds `adjustment.apply`, 40% off → `{ kind: "allowed" }`.
  - `it("past the reason's limit needs someone who can approve")` — 60% off →
    `needs_approval` with `approval.by === "limit"`, `permission === "adjustment.approve"`,
    `limit.kind === "reason"`.
  - `it("a holder of adjustment.approve passes their own limits")` — actor holds both, 60% → allowed.
  - `it("without adjustment.apply every comp needs approval")` — actor holds neither, 1% → needs approval.
  - `it("a zero amount limit always needs approval")` — `maxAmount: decimal("0")`, €0.01 off →
    needs approval.
  - `it("a zero percent limit needs approval even within the rounding allowance")` — dish
    `{ list: 10.00, after: 9.99, allowance: 2 }`, `maxPercentBp: 0` → `belowFloor` true → needs
    approval (Review focus 1).
  - `it("the bill's comp limit applies with the same approvers")` — reason within limit, bill limit
    €20 with €15 comped, €10 more → needs approval, `limit.kind === "bill"`.
  - `it("a zero bill limit makes every comp need approval")`.
  - Keep `evaluateCancel`'s fired/served cases: now `actorPermissions` without `sale.refund` →
    `{ by: "refund" }`.
  - `it("the snapshot records limits, not roles")` — `policySnapshotOf(reason, { maxBillComp })`
    has no `applyRoles`/`approverRoles` keys and carries `maxBillComp`.
- [ ] **Step 2:** `pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts` fails.
- [ ] **Step 3:** Implement. `belowFloor(dishes, maxPercentBp)` treats `maxPercentBp === 0` as
  "any dish with `after < list`". `policySnapshotOf(reason: AdjustmentReason, bill: { maxBillComp: Decimal | null })`.
- [ ] **Step 4:** run Step 2. **Step 5: Commit.**

### Task 2.2: Storage, settings and starters

**Files:** `packages/db/src/schema/adjustments/reasons.ts`, `packages/db/src/schema/adjustments/adjustments.ts`
(snapshot type only), `packages/adjustments/src/{settings,provisioning,operations,routes,record,configuration-transfer}.ts`,
`packages/country-es/src/demo/reasons.ts`, `packages/country/src/demo.ts`,
`apps/server/scripts/demo-seed/{data-set,seed-adjustments}.ts`, `packages/db/drizzle/*` (generated),
the bundle version. Tests: `packages/db/src/schema/adjustments/{reasons,migrations}.test.ts`,
`packages/adjustments/src/{settings,operations,routes,provisioning,configuration-transfer,record}.test.ts`,
`packages/adjustments/test/seed.ts`, `apps/server/src/testing/{adjustment-venue,cancel-line}.ts`.

**Interfaces:**
- `adjustment_reasons` drops `apply_roles`, `approver_roles`. CHECKs:
  `adjustment_reasons_max_percent_ck`: `max_percent is null or max_percent between 0 and 10000`;
  `adjustment_reasons_max_amount_ck`: `max_amount is null or max_amount >= 0`;
  `adjustment_reasons_kind_fields_ck`: `(kind = 'void' and max_percent is null and max_amount is null) or kind = 'comp'`.
- `AdjustmentsDocument` = `{ maxBillComp: number | null }`; parse accepts `0`; the document's
  `version` stays 1 (pre-live shape change on read, CLAUDE.md §3).
- `AdjustmentSettings` = `{ maxBillComp: Decimal | null }`.
- Starters (`provisioning.ts`): Complaint `maxAmount 0`; On the house `maxAmount 0`; Staff meal
  `maxPercentBp 5000`, discount actions only; Discount `maxAmount 0`; void reasons unchanged.

- [ ] **Step 1:** `reasons.test.ts`: `it("accepts a zero amount and zero percent limit")` inserts
  `max_amount 0`, `max_percent 0` without error; `it("still refuses a negative limit")` expects the
  CHECK refusal. `settings.test.ts`: `it("saves a zero bill limit")` round-trips `decimal("0")`;
  `it("refuses a document still naming billApproverRoles")` → parse `{ ok: false, field: "billApproverRoles" }`.
  `provisioning.test.ts`: the four starter limits above.
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** Implement; remove role lists from operations, routes (request parsing),
  transfer and demo data. Rebuild: `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
  Raise the bundle version.
- [ ] **Step 4:** run the package tests listed under Files and the schema guards in Global
  constraints. **Step 5: Commit.**

### Task 2.3: Server apply path and the approvers list

**Files:** `apps/server/src/adjustments-apply.ts:150-240,985-1110,1210-1235,1365-1375`,
`apps/server/src/adjustments-api.ts:100-110,325-335`, `packages/identity/src/staff.ts:600-628`.
Tests: `apps/server/src/adjustments-apply.test.ts`, `adjustments-api.test.ts`, `line-cancel.test.ts`,
`default-cancel-reason.test.ts`, `draft-discard.test.ts`.

**Interfaces:**
- `planAdjustment` reads the actor's set with `new Set(permissionsForRole(role))` (PR 5b swaps
  this for the authority reading) and passes `actorPermissions`.
- Approver check: `approves(approval, new Set(permissionsForRole(cred.role)))`.
- `GET /api/adjustment-approvers?permission=<p>` replaces `?roles=`; `p` must be one of
  `adjustment.approve`, `sale.refund`, `system.box_admin`, else `adjustment.request_invalid`
  `{ field: "permission" }` (use the route's existing invalid helper and code). Answers
  `listActivePersonsWithPermission(tx, p)`.
- `listActivePersonsWithRoles` is deleted.
- Wire approval: `{ by: "limit", permission, limit: { kind, amount: string | null, percentBp } } | { by: "refund", permission: "sale.refund" }`.

- [ ] **Step 1:** In `adjustments-api.test.ts`: `it("lists approvers by permission")` — a
  Supervisor and a Manager are listed for `adjustment.approve`, a Staff member is not; `?permission=person.admin`
  → 400 with the field. In `adjustments-apply.test.ts`: rewrite the role-list approval cases so a
  waiter's €12 staff-meal comp under a €15 limit applies alone and any Complaint comp (limit €0)
  returns `needsApproval.by === "limit"`, then succeeds with a Supervisor's PIN and records
  `approved_by` = the Supervisor (design §6 example). Keep every existing amount assertion.
- [ ] **Step 2:** run; they fail. **Step 3:** Implement. **Step 4:** run the five test files.
- [ ] **Step 5: Commit.**

### Task 2.4: Dashboard reasons screen

**Files:** `packages/adjustments/src/dashboard/{reasons-screen,strings,client}.ts`. Tests:
`reasons-screen.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`, `.save-state.test.ts`, `client.test.ts`.

**Interfaces:** reason form has no role fields; the limits panel has `maxBillComp` only, and
accepts `0`. The table's two role columns are removed. A one-line hint under each limit:
EN "0 means every comp with this reason needs approval." / ES "0 significa que cada invitación con
este motivo necesita aprobación." (bill limit: "…every comp on a bill needs approval." /
"…cada invitación de una cuenta necesita aprobación.").

- [ ] **Step 1:** Rewrite the role-list tests to: `it("saves a reason with a zero amount limit")`,
  `it("shows no role fields")` (no `[name=applyRoles]`/`[name=approverRoles]`/`[name=billApproverRoles]`),
  `it("a zero bill limit is valid")`; keep draft/unsaved/save-state assertions for the remaining fields.
- [ ] **Step 2:** run `pnpm --filter @waitron/adjustments exec vitest run src/dashboard` — fails.
- [ ] **Step 3:** Implement. **Step 4:** run again; axe passes in both themes. **Step 5: Commit.**

### Task 2.5: Till approval prompts name no role

**Files:** `apps/till/src/api/client.ts:895-920,4470-4476`, `apps/till/src/widgets/{adjustment-dialog,supervisor-override-dialog,box-time-dialog,keep-open,station-today}.ts`,
`apps/till/src/till-app.ts:15140-15150,17992,21834`, `apps/till/src/i18n/strings.ts:530-545,2507-2522`.
Tests: `adjustment-dialog*.test.ts`, `till-app-adjustments.test.ts`, `till-app-counter-adjustments.test.ts`,
`box-time-dialog.test.ts`, `supervisor-override-dialog.test.ts`.

**Interfaces:**
- `listApprovers(permission: "adjustment.approve" | "sale.refund" | "system.box_admin"): Promise<StaffMember[]>`
  replaces `listAdjustmentApprovers(roles)`.
- `supervisor-override-dialog`'s `approverRole` property is deleted; its four texts are always:
  EN "Approval needed" / "Choose who approves" / "Enter their PIN" / "Nobody here can approve this";
  ES "Hace falta aprobación" / "Elige quién aprueba" / "Introduce su PIN" / "Aquí nadie puede aprobarlo".
  The `approval.*_{staff,supervisor,manager,admin}` keys are deleted.
- The adjustment dialog's reason line names limits, not roles.
- `box-time-dialog` lists `listApprovers("system.box_admin")`.

- [ ] **Step 1:** Tests: `it("asks for an approver without naming a role")` on the override
  dialog; `it("lists Box administration holders for the clock")` on box-time-dialog (API stub
  called with `"system.box_admin"`). **Step 2:** run, fail. **Step 3:** implement.
- [ ] **Step 4:** `pnpm --filter @waitron/till exec vitest run src/widgets src/till-app-adjustments.test.ts src/till-app-counter-adjustments.test.ts`.
- [ ] **Step 5:** Update the comps guide sections (`apps/server/src/guide/{en,es}/table-service.md`
  or wherever `git grep -n "approver" apps/server/src/guide` finds comp approval) to say: holders of
  "Apply comps" comp up to the reason's limit, anyone with "Approve comps" approves past it, 0
  means always ask. **Commit**, then `/finish-branch`.

---

## PR 3 — Job roles in core; staffing always on (A1002 cut 4)

**Outcome:** job roles and who holds them live in core's migration set; staffing and the
workforce module it is built on can no longer be switched off; deleting a job role a shift has
used hides it instead of refusing; job-role changes are logged. **Depends on:** PR 1.
**Risk trigger:** migration, cross-package contract. **First PR line:** core and workforce
starting migrations rebuilt, venue reset.

### Task 3.0: Update A1308's people drawing

**Files:** `docs/superpowers/specs/2026-11-02-rationalisation/tables-people.md:96-118,252-303`.
Replace the superseded `roles` merge drawing with: `roles` (access: id, `built_in_key`, `name`,
`name_folded`, `permissions`), `person_roles`, and `staff_roles` kept as the job-role list in core
with `hidden_at`, `person_staff_roles` in core. Docs only; commit `-s` with the code PR.

### Task 3.1: Move the two tables

**Files:**
- Create: `packages/db/src/schema/identity/staff-roles.ts` (moved from
  `packages/workforce/src/schema/staffing/staffing.ts:22-55`), export from
  `packages/db/src/schema/identity/index.ts` and `packages/db/src/index.ts`.
- Modify: `packages/workforce/src/schema/staffing/staffing.ts` (import `staffRoles` from
  `@waitron/db` for the two FKs), `packages/workforce/src/classification.ts:46-47` → move both
  `classify(...)` lines to `packages/db/src/classification.ts`, `packages/staffing/src/classification.ts`
  (drop the two from `STAFFING_TABLES`), `packages/identity/src/classification.ts` (add both to
  `IDENTITY_TABLES` and `IDENTITY_CHANGE_SOURCES`, `person_staff_roles` related to `persons`),
  `packages/staffing/src/configuration-transfer.ts` → move both to `IDENTITY_CONFIGURATION_TRANSFER`
  after `persons`, every `import { staffRoles, personStaffRoles } from "@waitron/workforce"`
  (`git grep -l "personStaffRoles\|staffRoles" -- packages apps`), `scripts/schema-constraints.test.ts:355-362,509,863-864`,
  `docs/operations/a760-migration-squash-inventory.md:386-387`, generated drizzle for both sets.
- Test: `packages/composition/src/composition.test.ts` (eight-sets cases), `packages/staffing/src/classification.test.ts`,
  `packages/identity/src/classification.test.ts`.

**Interfaces:** `staffRoles` gains `hiddenAt: tsString("hidden_at")` (nullable). Unique index
`staff_roles_name_key` becomes partial: `.on(t.name).where(sql\`${t.hiddenAt} is null\`)`.
Exported from `@waitron/db` as `staffRoles`, `personStaffRoles`. TS and SQL names unchanged.

- [ ] **Step 1:** Tests: `composition.test.ts` pins `staff_roles` and `person_staff_roles` in
  core's set and not in workforce's; `identity/classification.test.ts` lists them in
  `IDENTITY_TABLES`. **Step 2:** run — fail.
- [ ] **Step 3:** Move; rebuild both sets (`--set core`, `--set workforce`). Before rebuilding,
  list foreign keys pointing at `staff_roles` (`shift_assignments` restrict, `staffing_blocks`
  cascade, `person_staff_roles` cascade) in the commit message.
- [ ] **Step 4:** schema guards from Global constraints; `pnpm --filter @waitron/staffing --filter @waitron/workforce --filter @waitron/composition exec vitest run`
  (package-local, read the `Tests` count). **Step 5: Commit.**

### Task 3.2: Staffing and workforce become mandatory

**Files:** `packages/composition/src/modules.ts:229,372`. Test: `composition.test.ts`,
`packages/module/src/config.test.ts` (or the file asserting `module.mandatory_not_disableable`).

- [ ] **Step 1:** `it("staffing and workforce cannot be switched off")` —
  `parseModuleOverrides({ staffing: false }, ALL_MODULES)` and `({ workforce: false }, …)` each
  throw `module.mandatory_not_disableable`. Update any test that disables either module (grep
  `staffing: false`, `workforce: false`) to disable `workforce-es` or `bookings` instead, keeping
  what it asserted about disabled modules.
- [ ] **Step 2:** run, fail. **Step 3:** set both `tier: "mandatory"`. The `workforceEnabled`
  reads in `apps/server/src/boot.ts:2414-2443` stay correct (always true) and are left alone.
- [ ] **Step 4:** run. **Step 5: Commit.**

### Task 3.3: Delete hides a used job role

**Files:** `packages/staffing/src/staff-roles.ts`, `packages/staffing/src/rota.ts:55-90,188-200`,
`packages/staffing/src/paint.ts:215-230`, `packages/staffing/src/dashboard/{staff-roles-screen,staff-role-delete-copy,strings,rota-model,slot-picker,shift-edit-dialog}.ts`,
`packages/staffing/src/errors.ts`. Tests: `staff-roles.test.ts`, `rota.test.ts`, `paint.test.ts`,
`staff-roles-screen.test.ts`.

**Interfaces:**
- `deleteStaffRole(tx, id): Promise<DeleteImpact & { outcome: "deleted" | "hidden" }>`: no shift
  names it → row deleted (cascades remove holders and blocks); otherwise in one transaction delete
  its `person_staff_roles` rows and `staffing_blocks` rows, set `hidden_at`, keep the row.
  `staff_role.in_use` is removed from the error registry and strings.
- `listStaffRoles(tx)` and `listStaffRolesWithHolderNames` exclude hidden roles;
  `readRotaWeek` adds every role the week's shifts name, hidden included, with `hidden: true`.
- `assignmentTargets`, `setStaffRoleHolders`, `paint` refuse a hidden role with
  `staff_role.not_found` (it can never be picked again).
- `createStaffRole`/`updateStaffRole` name checks ignore hidden roles.
- `reorderStaffRoles` takes exactly the visible roles.

- [ ] **Step 1:** Tests: `it("deletes a role no shift has used")` (row gone);
  `it("hides a role a shift has used")` — row kept with `hidden_at`, holders 0, blocks 0, a past
  shift still reads its name in `readRotaWeek`; `it("a hidden role's name can be used again")`;
  `it("a hidden role cannot be assigned, held or painted")` → `staff_role.not_found` each;
  `it("a future shift in a hidden role still shows it and warns")` — the week's role list includes
  it and the shift's person is outside every visible holder list, so the rota card shows the
  existing outside-role warning (Review focus 3). Rewrite the `staff_role.in_use` refusal test into
  the hide case.
- [ ] **Step 2:** run, fail. **Step 3:** implement; the delete dialog's copy says one line with the
  holder count (design §7, "my call"): EN "{count} people hold this role. Deleting it removes it
  from them, from every device and from the staffing plan. Shifts that used it keep its name." /
  ES "{count} personas tienen este puesto. Al eliminarlo se quita de ellas, de todos los
  dispositivos y del plan de personal. Los turnos que lo usaron conservan su nombre."
- [ ] **Step 4:** run the four test files. **Step 5: Commit.**

### Task 3.4: Per-person job roles, logged

**Files:** `packages/staffing/src/staff-roles.ts`, `packages/staffing/src/routes.ts`,
`packages/db/src/activity-kinds.ts`. Tests: `staff-roles.test.ts`, `routes.test.ts`,
`packages/db/src/activity-log.test.ts` (kind table).

**Interfaces:**
- Activity kinds (subject in parentheses): `job_role.created` (`job_role`) `{ name: string }`;
  `job_role.renamed` (`job_role`) `{ from: string; to: string }`; `job_role.deleted` (`job_role`)
  `{ name: string }`; `job_role.hidden` (`job_role`) `{ name: string }`; `job_role.member_added`
  (`person`) `{ staffRoleId: string; name: string }`; `job_role.member_removed` (`person`) same.
- `createStaffRole`, `updateStaffRole`, `setStaffRoleHolders`, `deleteStaffRole` take
  `actor: { personId: string | null }` and record the entries above (one per membership change;
  a no-op save records nothing).
- `setPersonStaffRoles(tx, input: { personId: string; staffRoleIds: readonly string[]; expectedStaffRoleIds: readonly string[]; actorId: string }): Promise<string[]>`
  — compares `expectedStaffRoleIds` with the stored set as sets; a difference throws
  `person.job_roles_changed` `{}`; unknown or hidden ID → `staff_role.not_found`.
- Route `PUT /management-api/staffing/people/:personId/staff-roles`, body
  `{ staffRoleIds: string[], expectedStaffRoleIds: string[] }`, gate `schedule.manage`, answers
  `{ staffRoleIds }`.
- Configuration import (`packages/provisioning/src/configuration-transfer.ts` import loop) logs
  each imported `person_staff_roles` row as `job_role.member_added` with `personId: null`
  (design §8 baseline).

- [ ] **Step 1:** Tests: `it("logs each holder added and removed, by id")` (two entries for one
  add + one removal, `data` has no name of a person); `it("refuses a stale per-person save")` →
  `person.job_roles_changed`; `it("reordered sets are no change")` (no entries). Route test: a
  session without `schedule.manage` → `authorization.not_permitted`.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5: Commit**, then `/finish-branch`.

---

## PR 4 — Device sign-in by job role (A1002 cut 5)

**Outcome:** a device profile's "Who can sign in" ticks job roles only; its sign-in screen lists
everyone holding a ticked job role; per-person allow/deny is gone; a new venue starts with a
"Team" job role on every device and held by the first admin; the staff editor shows job-role tags.
**Depends on:** PR 3. **Risk trigger:** auth (sign-in admission), migration.
**First PR line:** core starting migration rebuilt, venue reset.

### Task 4.1: Admission storage and rule

**Files:** `packages/db/src/schema/identity/profile-admission.ts`, `packages/identity/src/profile-admission.ts`,
`packages/identity/src/{classification,configuration-transfer,personal-data,errors,index}.ts`,
`packages/db/src/{classification,index}.ts`, `packages/db/src/schema/identity/index.ts`,
`scripts/schema-constraints.test.ts`, generated drizzle. Tests: `packages/identity/src/profile-admission.test.ts`,
`apps/server/src/till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`.

**Interfaces:**
- `deviceProfileAdmissionRoles` = `{ deviceProfileId (FK cascade), staffRoleId (FK → staff_roles, cascade) }`,
  PK both. `deviceProfileAdmissionPersons` is deleted with its change source, transfer entry and
  personal-data reader.
- `canUseDeviceProfile(tx, profileId, personId): Promise<boolean>` — active person holding a
  visible job role ticked on the profile. No rows = nobody.
- `listStaffAdmittedTo(tx, profileId)`, `profilesAdmitting(tx, personId, profileIds)` follow the
  same rule; shapes unchanged.
- `interface ProfileAdmission { admittedStaffRoleIds: string[] }`;
  `readProfileAdmissions(tx, ids)`; `setProfileAdmission(tx, profileId, input: ProfileAdmission)`
  refuses an unknown or hidden ID with `device_profile.admission_invalid` `{ field: "admittedStaffRoleIds", reason: "not_found", staffRoleId }`;
  an empty list is valid and admits nobody.
- `createDeviceProfile` (`packages/layouts/src/device-profile.ts`) ticks every visible job role
  (design §5 "my call"); `createStaffRole` ticks none.
- `deleteStaffRole`'s hide branch (PR 3) also deletes the role's `device_profile_admission_roles`
  rows, so a hidden role is on no device list (design §7); the delete branch relies on the cascade.

- [ ] **Step 1:** Tests: `it("admits an active holder of a ticked job role")`;
  `it("admits nobody when no job role is ticked")`; `it("an access level alone admits nobody")` —
  an Admin with no job role is refused on every profile; `it("a suspended holder is not admitted")`;
  `it("a new profile ticks every current job role and a new job role is ticked nowhere")`;
  `it("a hidden job role admits nobody")`. Keep `till-api.profile-*` inventory rows passing by
  giving their fixtures' people a ticked job role.
- [ ] **Step 2–4:** fail, implement (rebuild `--set core`, raise bundle version), pass the three
  files plus schema guards. **Step 5: Commit.**

### Task 4.2: Setup's "Team" job role

**Files:** `packages/provisioning/src/venue-apply.ts:93-105,212-245,540-576`,
`packages/provisioning/src/starter-content.ts`, `packages/staffing/src/staff-roles.ts`
(an unchecked `createStarterStaffRole(tx, name): Promise<string>` that skips activity).
Tests: `packages/provisioning/src/venue-apply.test.ts`, `starter-content.test.ts`.

**Interfaces:** `STARTER_JOB_ROLE_NAMES = { Team: { es: "Equipo" } } as const satisfies StaffNames`.
`seed-admin` creates the person, then the "Team" job role named in the staff language, then the
first admin's `person_staff_roles` row, and records `job_role.member_added` with `personId: null`
(setup baseline, no mail). `seed-device-profiles` then creates profiles, which tick Team.

- [ ] **Step 1:** `it("setup's admin can sign in on every starter profile")` —
  `canUseDeviceProfile` true for the admin on Counter, Kitchen and Handheld;
  `it("names the starter job role in the staff language")` → "Equipo" for `es`.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5: Commit.**

### Task 4.3: Profile and staff-editor screens

**Files:** `apps/server/src/management-api.ts:575-650`, `apps/dashboard/src/screens/device-profiles-screen.ts`
(admission section near `:330-365`, `:1190-1200`, `:1480-1500`, `:1690-1700`),
`apps/dashboard/src/api/{client,live-queries}.ts`, `apps/till/src/api/live-connection.ts`,
`apps/dashboard/src/widgets/person-edit.ts`, `apps/dashboard/src/i18n/strings.ts`,
`packages/country-es/test-fixtures/demo/madrid-before-move.{en,es,manifest}.json`,
`apps/server/src/testing/clear-provision-fixture.ts`,
`apps/server/src/guide/{en,es}/staff.md` and the device-profile guide section.
Tests: `device-profiles-screen.test.ts` (+ `.unsaved`, `.a11y`), `person-edit.test.ts`,
`management-api.*profile*.test.ts`.

**Interfaces:**
- Profile body field `admittedStaffRoleIds: string[]` replaces `admittedRoles` and
  `personExceptions`; duplicates → `management.request_invalid` `{ field: "admittedStaffRoleIds" }`.
- The profile form's "Who can sign in" is one `wt-switch` per visible job role, in rota order;
  no people rows. Copying a profile copies its ticks.
- Staff editor (`person-edit.ts`) gains a "Job roles" `wt-combobox multiple` labelled EN
  "Job roles — puts them on the rota and on the devices that take that job" / ES "Puestos — los
  pone en el cuadrante y en los dispositivos de ese puesto", shown only with `schedule.manage`,
  saved through PR 3's per-person route with its own draft scope and expected set.

- [ ] **Step 1:** Browser tests: `it("ticks job roles, not levels, and shows no people")`;
  `it("a copied profile keeps its job-role ticks")`; `it("an empty selection saves and says nobody can sign in")`
  with hint EN "Nobody can sign in on devices with this profile." / ES "Nadie puede iniciar sesión
  en los dispositivos con este perfil."; staff editor `it("saves job roles with the set it read")`
  and `it("keeps the draft when someone changed them meanwhile")` (server answers
  `person.job_roles_changed`; message EN "Someone changed this person's job roles while you were
  editing. Reload to see them; your changes are kept until you do." / ES "Alguien cambió los
  puestos de esta persona mientras editabas. Recarga para verlos; tus cambios se conservan hasta
  entonces.").
- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen src/widgets/person-edit`),
  check light/dark and phone width by eye. Update guides EN/ES. **Step 5: Commit**, `/finish-branch`.

---

## PR 5a — Test people behind two helpers (A1002 cut 6)

**Outcome:** every test creates, changes and reads a person's level through
`seedPersons`, `setBuiltInRoleForTest` and `builtInRoleForTest`, which today write and read
`persons.role`; no product code changes. **Depends on:** nothing (land before PR 6).
**Risk trigger:** none (light path).

### Task 5a.1: The helpers

**Files:** Create `packages/identity/test/person-rows.ts`. Test: `packages/identity/src/person-rows.test.ts`.

**Interfaces:**
```ts
export type PersonSeed = Omit<typeof persons.$inferInsert, "role"> & { role?: BuiltInRoleKey };
export function seedPersons(db: Database | Transaction, values: PersonSeed | readonly PersonSeed[]): Promise<(typeof persons.$inferSelect)[]>;
export function setBuiltInRoleForTest(db: Database | Transaction, personId: string, role: BuiltInRoleKey): Promise<void>;
export function builtInRoleForTest(db: Database | Transaction, personId: string): Promise<BuiltInRoleKey | null>;
```
`role` defaults to `"staff"` (today's column default). Imported as `@waitron/identity/test/person-rows.js`.

- [ ] **Step 1:** tests: inserts one and many and returns full rows; default role is staff;
  `setBuiltInRoleForTest` then `builtInRoleForTest` round-trips `"manager"`.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5: Commit.**

### Task 5a.2: Codemod `apps/server` and `apps/dashboard`

**Files:** test and `src/testing/` files under `apps/` matching `insert(persons)`,
`update(persons).set({ role`, `set role`, or `persons.role`.

The codemod is a throwaway script in the implementer's scratch folder, not committed, using the
root `typescript` package's parser:
```text
for each file: parse with ts.createSourceFile
  find CallExpression C where C.expression is PropertyAccess ".values"
    and C.expression.expression is a CallExpression ".insert(persons)"
  outer = C; if outer.parent is PropertyAccess ".returning" and its parent a Call, outer = that call
  receiver = text of the ".insert" call's object expression
  replace text span of outer with `seedPersons(${receiver}, ${text of C.arguments[0]})`
  same for `R.update(persons).set({ role: X }).where(eq(persons.id, ID))` → `setBuiltInRoleForTest(R, ID, X)`
  add the import if any replacement was made; apply edits from the end of the file backwards
```
Anything else (`.onConflictDoNothing()`, raw `sql\`update persons set role…\``, reads of
`persons.role` in selects) is rewritten by hand with the same helpers.

- [ ] **Step 1:** run the codemod; `pnpm --filter @waitron/server --filter @waitron/dashboard typecheck`.
- [ ] **Step 2:** fix by hand what typecheck flags; then
  `git grep -nE 'insert\(persons\)|set\(\{ ?role|set role\b|persons\.role' -- apps ':!*.ts'` is empty
  for test files (production files untouched: `git diff --stat -- apps | /usr/bin/grep -vE 'test|testing'` empty).
- [ ] **Step 3:** run the touched test files in groups of about 40 (`vitest run <files>`), reading
  each `Tests` count. **Step 4: Commit** in one or more commits.

### Task 5a.3: Codemod `packages/`

Same as 5a.2 for packages that depend on `@waitron/identity` (core, fiscal-verifactu, workforce,
workforce-es, staffing, venue-service, layouts, media, bookings, adjustments, provisioning,
identity). `db`, `fiscal`, `catalogue` and `country-es` do not depend on identity
(`fiscal` cannot: identity → module → fiscal) and keep `role:` until PR 6 removes it by hand.
Run each touched package's tests. **Commit**, then `/finish-branch` (light path).

---

## PR 5b — One authority reading for every check (A1002 cut 7)

**Outcome:** nothing outside identity decides from a level name: every permission check reads a
person's authority, and the dashboard shows screens by permission, not by "is Staff". Behaviour is
unchanged for the four levels. **Depends on:** PR 1, PR 2. **Risk trigger:** auth.

### Task 5b.1: `PersonAuthority`

**Files:** Create `packages/identity/src/authority.ts`; modify `packages/identity/src/{authorize,credential,management-session,manager-login,login,staff,index}.ts`.
Tests: `authority.test.ts`, `authorize.test.ts`, `credential.test.ts`, `manager-login.test.ts`.

**Interfaces:**
```ts
export interface PersonAuthority {
  readonly personId: string;
  readonly admin: boolean;               // holds the Admin access role
  readonly permissions: ReadonlySet<string>; // admin: every declared permission
}
export function readPersonAuthority(tx: Database | Transaction, personId: string): Promise<PersonAuthority>;
export function holds(authority: PersonAuthority, permission: Permission | (string & {})): boolean;
```
`listActivePersonsWithPermission` (`staff.ts`) keeps its signature and filters with `holds`.
In this PR `readPersonAuthority` derives from `persons.role` through `permissionsForRole`.
`verifyPersonCredential` returns `{ role, authority, locale }`; `resolveManagementSession` and
`authorizeManager` add `authority`. `roleHasPermission` and `permissionsForRole` stop being
exported from `index.ts`.

- [ ] **Step 1:** `authority.test.ts`: `it("a Supervisor holds sale.refund and not report.export")`;
  `it("Admin holds a permission registered later")`; `it("an unknown person holds nothing")` →
  `permissions.size === 0`, `admin === false`. **Step 2–4.** **Step 5: Commit.**

### Task 5b.2: Server consumers

**Files:** the call sites `git grep -nE 'roleHasPermission|permissionsForRole' -- apps packages ':!*.test.ts'`
lists outside identity (`apps/server/src/{alerts-api,attendance-export-api,bill-refunds,disk-stop-api,document-printer-offers,email-inbox-api,email-settings-api,handover-compare,manager-email-recipients,me-api,orders-api,pin-check-ahead,tender-refund-authorization,till-api,till-box-clock-api,adjustments-apply,management-attendance-api,till-attendance-api}.ts`,
`packages/adjustments/src/policy.ts` (none left after PR 2), `packages/venue-service/src/routes.ts:703`,
`packages/workforce/src/corrections.ts` (its raw `select role from persons` becomes `readPersonAuthority`)).
`handover-compare.ts:390-397` reads the offered copy by raw SQL and keeps reading `role` there
until PR 6. Tests: each file's suite.

- [ ] **Step 1:** For each consumer the change is `holds(x.authority, p)` or
  `x.authority.permissions`; the existing suites are the failing-first check once the old exports
  are removed (typecheck), and `manager-email-recipients.test.ts` gains
  `it("lists each eligible person once")`.
- [ ] **Step 2–4:** `pnpm --filter @waitron/server typecheck`, then each touched suite.
  **Step 5: Commit.**

### Task 5b.3: Dashboard screens by permission

**Files:** `apps/dashboard/src/dashboard-app.ts:203-310,955,1415,2320-2330,2355-2365,2498-2545,2725-2735,2787,2864`.
Tests: `apps/dashboard/src/dashboard-app.test.ts` (navigation cases).

**Interfaces:** `AccessRule` loses `requiresManager`. Each core item without a permission
requires `venue.view`; the former `requiresManager` items require: `menus`, `modifiers` →
`catalogue.manage`; `payments`, `demo-printer` → `hardware.manage`; `email`, `diagnostics`,
`backup`, `cloud` → `system.manage` (each the gate of that screen's first GET route; check with
`git grep` and use the route's gate if it differs). `my-schedule` and `orders` stay open to every
signed-in person. "Own pages only" = holds no permission any other nav item requires; it replaces
every `sessionRole === "staff"` branch (alerts watch, nav, search strip, permitted screen).

- [ ] **Step 1:** `it("a person holding only payment.take sees My schedule and Orders")`;
  `it("a person holding venue.view sees the venue screens")`;
  `it("a person holding nothing signs in to their own pages without a refusal")` (Review focus 5);
  keep the existing Staff/Manager/Admin navigation assertions.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5: Commit**, `/finish-branch`.

---

## PR 6 — Access-role storage; `persons.role` removed (A1002 cut 8)

**Outcome:** the four built-in access roles are rows, people hold them through memberships,
authority reads memberships, and `persons.role` is gone. Each person still holds exactly one
built-in role, set through the existing staff form (a transitional `role` field that PR 8
replaces). **Depends on:** PR 4, PR 5a, PR 5b. **Risk trigger:** migration, auth.
**First PR line:** core starting migration rebuilt, venue reset.

### Task 6.1: Tables and built-ins

**Files:** Create `packages/db/src/schema/identity/roles.ts`, `packages/identity/src/roles.ts`;
modify `packages/db/src/schema/identity/persons.ts` (drop `role`, `personRole`, `persons_role_ck`),
`packages/db/src/schema/identity/index.ts`, `packages/db/src/{classification,index}.ts`,
`packages/identity/src/{classification,authority,index}.ts`, `packages/shared/src/{person-role,index}.ts`
(delete `PersonRoleValue`), `scripts/write-path-tables.json`, `scripts/schema-constraints.test.ts`.
Tests: `packages/identity/src/roles.test.ts`, `authority.test.ts`, `packages/db/src/schema/identity/roles.test.ts`.

**Interfaces:**
- `roles`: `id` (newId), `builtInKey` enum `staff|supervisor|manager|admin` nullable,
  `name` label nullable, `nameFolded` label nullable, `permissions: json<string[]>` not null
  default `[]`, `createdAt`. Unique `roles_built_in_key_uq` on `builtInKey` where not null;
  unique `roles_name_folded_uq` on `nameFolded` where not null; CHECK `roles_name_ck`
  `(built_in_key is null) = (name is not null)`; CHECK `roles_admin_permissions_ck`
  `built_in_key is not 'admin' or json_array_length(permissions) = 0`. Classified `state`.
- `person_roles`: `personId` FK → persons cascade, `roleId` FK → roles restrict, PK both.
  Classified `state`.
- `scripts/write-path-tables.json`: `"roles": ["packages/identity/src/roles.ts"]`,
  `"person_roles": ["packages/identity/src/roles.ts"]`.
- `packages/identity/src/roles.ts`:
  `export const BUILT_IN_ROLE_KEYS = ["staff","supervisor","manager","admin"] as const;`
  `export function ensureBuiltInRoles(tx: Transaction): Promise<Record<BuiltInRoleKey, string>>` —
  inserts missing built-ins with `defaultPermissionsFor(key)` (Admin `[]`), returns their ids;
  `export function setBuiltInMembership(tx: Transaction, personId: string, key: BuiltInRoleKey): Promise<void>` —
  transitional: replaces the person's memberships with that one role (deleted in PR 8);
  `export function heldBuiltInKey(tx, personId): Promise<BuiltInRoleKey | null>` (transitional).
- `readPersonAuthority` now: memberships ⋈ roles; `admin` = holds the `admin` key; `permissions`
  = Admin ? `declaredPermissions()` : union of each held role's stored list filtered by
  `isDeclaredPermission`.
- Add `roleIds: readonly string[]` to `PersonAuthority`.

- [ ] **Step 1:** Tests: `it("creates the four built-ins once with their defaults")` — Supervisor
  row's permissions equal `defaultPermissionsFor("supervisor")`, Admin's `[]`, second call inserts
  nothing; `it("authority is the union of held roles")` — a person with Staff and a hand-inserted
  custom row `{ name: "Accountant", permissions: ["report.view"] }` holds both sets;
  `it("a stored undeclared permission authorizes nobody")`; `it("a person with no role holds nothing")`;
  db CHECK tests for the two CHECKs and the folded-name index ("Café" then "CAFE" refused).
- [ ] **Step 2–4:** fail, implement, rebuild `--set core`, pass with the schema guards.
  **Step 5: Commit.**

### Task 6.2: Identity writers and readers

**Files:** `packages/identity/src/{staff,credential,management-session,manager-login,login,authorize,personal-data,profile-admission}.ts`.
Tests: `staff*.test.ts`, `personal-data.test.ts`, `login.test.ts`, `management-session.test.ts`.

**Interfaces:**
- `updatePersonDetails`, `invitePerson`, `createPerson`, `setRole` keep their `role: BuiltInRoleKey`
  input and write it through `setBuiltInMembership`; their existing rules (who may change a role,
  last admin) read `heldBuiltInKey` and the Admin membership instead of the column.
- Every "active admins" query becomes "active persons holding the Admin role".
- `listActivePersonsWithPermission` (`staff.ts:604`) reads every active person's memberships and
  roles in one query and filters in JavaScript, never one authority read per person.
- `PersonSummary.role` is `heldBuiltInKey(...)`; `login.ts`'s client `role` field is deleted.
- `verifyPersonCredential`, `resolveManagementSession`, `authorizeManager` lose `role`.
- Personal-data export lists `accessRoles: string[]` (built-in keys or custom names).

- [ ] **Step 1:** the existing staff/lifecycle/authority suites are the failing check once the
  column is gone; add `it("the last admin is counted by membership")` — two Admin holders, one
  suspended, suspending the other → `person.last_admin`.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 6.3: Setup, recovery, handover, transfer, demo

**Files:** `packages/provisioning/src/venue-apply.ts:93-105,212-245,385-395,515-520,555-565`,
`packages/provisioning/src/recover-provisioned-venue.ts`, `apps/server/src/break-glass-command.ts:94-135`,
`apps/server/src/handover-compare.ts:388-400`, `packages/identity/src/configuration-transfer.ts`,
`packages/provisioning/src/configuration-transfer.ts:870-910`, `packages/country-es/src/demo/{staff,casa-delgado-*}.ts`,
`apps/server/scripts/demo-seed/{seed-staff,staff}.ts`, `apps/server/scripts/bench/bench-venue.ts`,
`packages/db/src/activity-kinds.ts`. Tests: `venue-apply.test.ts`, `break-glass-command.test.ts`,
`handover-compare.test.ts`, `configuration-import.test.ts`, `configuration-transfer.security.test.ts`,
`apps/server/src/first-fiscal-setup.e2e.test.ts`.

**Interfaces:**
- Setup's `seed-admin` calls `ensureBuiltInRoles`, then adds the admin's Admin membership and
  records `access_role.member_added` (`person`, `{ roleId, builtInKey: "admin", name: null }`)
  with `personId: null`. Setup's "is there an admin" checks read the Admin membership.
- Break-glass picks persons holding Admin.
- Handover compare reads the copy's `person_roles`/`roles` by raw SQL: the authorizer holds
  `node.manage` if they hold Admin or a role whose `permissions` JSON contains it.
- `IDENTITY_CONFIGURATION_TRANSFER` adds `{ name: "roles" }` and `{ name: "person_roles" }`
  (after persons). Import: a bundle row with a `built_in_key` maps its id onto the target's
  built-in of that key (`idMap.set(bundleId, targetId)`), updates that row's `permissions` (not
  Admin's), and is not inserted; each imported membership is logged as
  `access_role.member_added` with `personId: null`, no mail. Raise the bundle version.
- Activity kind `access_role.member_added` and `access_role.member_removed` (`person`,
  `{ roleId: string; builtInKey: BuiltInRoleKey | null; name: string | null }`).
- Remove `role:` by hand from tests in `db`, `fiscal`, `catalogue`, `country-es` (PR 5a skipped them);
  rewrite `packages/identity/test/person-rows.ts` to call `ensureBuiltInRoles` and insert memberships.

- [ ] **Step 1:** `it("import keeps the target's built-ins and carries an edited Supervisor")`;
  `it("imported memberships are logged, not mailed")` (`outgoing_mail` empty);
  `it("break-glass refuses a box with no Admin holder")`; handover-compare
  `it("an offered copy's custom role holding node.manage authorizes")`.
- [ ] **Step 2–4.** Run the schema guards and `apps/server/src/first-fiscal-setup.e2e.test.ts`.
  **Step 5: Commit**, `/finish-branch`.

---

## PR 7 — Rule 2, the usable Admin, and links checked when used (A1002 cut 9)

**Outcome:** you can change another person's email, PIN, status or sign-in methods, or send them a
reset or invitation, only if you hold every permission they hold; a change that would leave no
active Admin holder with a dashboard sign-in is refused; role changes no longer cancel links, and a
link an administrator sent is re-checked against the sender when used. **Depends on:** PR 6.
**Risk trigger:** auth, migration. **First PR line:** core starting migration rebuilt, venue reset.

### Task 7.1: Rule 2 and the usable-Admin check

**Files:** Create `packages/identity/src/admin-anchor.ts`; modify `packages/identity/src/{staff,profile,passkey,google-oidc,errors}.ts`,
`apps/server/src/management-api.ts` (staff routes), `apps/dashboard/src/i18n/codes.ts`.
Tests: `packages/identity/src/staff-authority.test.ts`, `staff-lifecycle.test.ts`, `admin-anchor.test.ts`.

**Interfaces:**
- `export function assertUsableAdminRemains(tx: Transaction): Promise<void>` — throws
  `person.last_admin` unless at least one distinct person holds Admin, is `active`, has an email,
  and has a password hash, a Google subject, or a WebAuthn credential.
- `export function assertActorCovers(actor: PersonAuthority, target: PersonAuthority): void` —
  throws `person.holds_more` `{ personId }` unless `actor.admin || !target.admin` and every target
  permission is in the actor's.
- `authorizePersonLoginChange(tx, input)` = `person.admin` + `assertActorCovers` for another person.
  Applies to: `setEmail`, `resetPin`, `clearPersonPin`, `setPassword`, `deactivatePerson`,
  reactivation, `resetPersonLogin`, invitations (`queueInvitation`, the invitation and reset-login
  routes), and every other-person sign-in method removal.
- `assertUsableAdminRemains` runs last in: `updatePersonDetails`, `deactivatePerson`,
  `resetPersonLogin`, own and administrator removal of a password, passkey or Google link, and the
  configuration import's transaction (`packages/provisioning/src/configuration-transfer.ts`).
- Wording `person.holds_more`: EN "This person can do things you can't, so only someone who can do
  everything they can may change their sign-in." / ES "Esta persona puede hacer cosas que tú no,
  así que solo alguien que pueda hacer todo lo que ella hace puede cambiar su acceso."
  `person.last_admin` (existing) gains: EN "Keep at least one active Admin who can sign in to the
  dashboard." / ES "Mantén al menos un administrador activo que pueda entrar al panel."

- [ ] **Step 1:** Tests, each with its refusal code: a Manager changing a waiter's email succeeds;
  a Manager changing an Admin's email → `person.holds_more`; a Manager setting a waiter's PIN
  succeeds (no email needed); a Manager suspending a person whose custom role grants
  `system.box_admin` → `person.holds_more`; the only usable Admin removing their last passkey
  when they have no password → `person.last_admin`; a PIN-only Admin does not count, so suspending
  the only other Admin → `person.last_admin`; a pending Admin does not count. Self-service changes
  of one's own email and password still pass. (Review focus 2.)
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 7.2: Links: sender recorded, checked when used, not cancelled by role changes

**Files:** `packages/db/src/schema/identity/management-account-actions.ts`,
`packages/identity/src/{account-action,staff}.ts`, `apps/server/src/account-mail.ts`, generated
drizzle. Tests: `account-action.test.ts`, `account-action.concurrency.test.ts`, `staff-lifecycle.test.ts`.

**Interfaces:**
- `management_account_actions.issued_by` `id` nullable, FK → persons restrict. The table is not
  in any configuration transfer, so no transfer change.
- `issueAccountAction(tx, input & { issuedBy: string | null })`; `issueQueuedAccountAction` passes
  `mail.requestedBy ?? null`. Self-service recovery passes `null`.
- `inspectAccountAction` and `completeAccountAction` additionally refuse
  `account_action.invalid` when `issued_by` is set and the issuer is not active, lacks
  `person.admin`, or fails `assertActorCovers(issuer, target)` — all read at redemption.
- `invalidatePersonAccountActions` is no longer called on a role change (`staff.ts:298-299,452-453`);
  `revokePersonAccess` on email or status change stays.

- [ ] **Step 1:** Tests: `it("a role change leaves an outstanding invitation usable")`;
  `it("an invitation sent by a Manager is refused once the person holds more than the Manager")`
  (Review focus 4); `it("an invitation from a since-suspended sender is refused")`;
  `it("self-service reset links have no sender")` (`issued_by` null);
  keep expiry, single-use and reissue assertions.
- [ ] **Step 2–4:** fail, implement, rebuild `--set core`, pass with the schema guards.
  **Step 5: Commit**, `/finish-branch`.

---

## PR 8 — Several access roles per person (A1002 cut 10)

**Outcome:** the staff editor shows access-role tags; a person can hold several roles or none;
giving or taking a role needs `person.admin` and every permission that role carries (Rule 1);
Managers hold `person.admin` by default; each change is logged and emailed. **Depends on:** PR 7.
**Risk trigger:** auth.

### Task 8.1: Membership command (Rule 1)

**Files:** `packages/identity/src/roles.ts`, `packages/identity/src/{staff,errors,permissions}.ts`.
Tests: `packages/identity/src/roles.memberships.test.ts`.

**Interfaces:**
```ts
export function setPersonAccessRoles(tx: Transaction, input: {
  managementSessionId: string; personId: string;
  roleIds: readonly string[]; expectedRoleIds: readonly string[];
}): Promise<{ roleIds: string[] }>;
```
- Needs `person.admin`. Compares `expectedRoleIds` with the stored set as sets → else
  `person.roles_changed` `{}`. Unknown ID → `role.not_found` `{ roleId }`; duplicate →
  `management.request_invalid` `{ field: "roleIds" }`.
- For each added or removed role: Admin needs `actor.admin`; any other needs every permission in
  that role's stored list within the actor's → else `role.not_permitted` `{ roleId }`. The check is
  on the role, not the person's total (design §4 Luis example).
- Writes memberships, `recordActivity` per change, `queueRoleMembershipMail` per change (Task 8.2),
  then `assertUsableAdminRemains`.
- `person.admin` default holders become `["manager"]`.
- `setBuiltInMembership`, `heldBuiltInKey`, `setRole` and every `role` input of
  `updatePersonDetails`/`invitePerson`/`createPerson` are deleted; invite/create take
  `roleIds: string[]` checked by the same Rule 1.

- [ ] **Step 1:** Tests (design §4 examples): a Manager adds Waiter-like custom role within their
  permissions to Luis who holds Accountant → ok; the Manager removing Accountant from Luis →
  `role.not_permitted`; a Manager adding or removing Admin → `role.not_permitted`; a custom role
  holding every current permission cannot stand in for Admin; a stale `expectedRoleIds` →
  `person.roles_changed`; reordered sets are no change and log nothing; removing the last usable
  Admin's Admin → `person.last_admin`; a person may end with no roles.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 8.2: Membership mail

**Files:** Create `apps/server/src/role-membership-mail.ts`, `apps/server/src/i18n/role-membership-email.ts`,
`packages/identity/src/role-mail.ts`; modify `apps/server/src/boot.ts:2610-2635`.
Tests: `apps/server/src/role-membership-mail.test.ts`, `packages/identity/src/role-mail.test.ts`.

**Interfaces:**
- `queueRoleMembershipMail(tx, input: { activityId: string; personId: string; actorId: string | null; change: "added" | "removed"; roleId: string; builtInKey: BuiltInRoleKey | null; roleName: string | null; editorName: string; at: Date }): Promise<void>`
  — only when the person has an email now; `enqueueMail` with `kind: "role_membership_changed"`,
  `dedupeKey: \`role-membership:${activityId}\``, `subjectId: activityId`, `personId`,
  `requestedBy: actorId`, `params: { change, builtInKey, roleName, editorName, at: at.toISOString() }`,
  `notAfter: at + MAIL_LIFETIME_MS.role_membership_changed`.
- `roleMembershipMail(deps: { venueLocale: string; readTimeZone(): Promise<string> }): MailKindOwner<RoleMembershipWords>`
  — claim reads the recipient's current email and locale (null email → `null`); compose renders
  `ROLE_MEMBERSHIP_EMAIL_WORDS`: added — EN subject "Role added: {role}", text "{actor} added you to
  {role} on {when}." / ES "Rol añadido: {role}", "{actor} te añadió al rol {role} el {when}.";
  removed — EN "Role removed: {role}", "{actor} removed you from {role} on {when}." / ES "Rol
  quitado: {role}", "{actor} te quitó del rol {role} el {when}." Built-in names translate, custom
  names stay literal; `{when}` in the recipient's language and the venue's time zone.
- Registered in boot's owners list beside `accountActionMail`.

- [ ] **Step 1:** Tests: rollback of the membership change leaves no mail row; no email → no row,
  activity entry still written; a pending or suspended person with an email gets one; a
  permission edit queues nothing (asserted in PR 9); compose in `es` with a custom role name
  keeps the name literal.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 8.3: API and staff editor

**Files:** `apps/server/src/{management-api,me-api}.ts`, `apps/dashboard/src/api/client.ts`,
`apps/dashboard/src/widgets/{person-form,person-edit,staff-list}.ts`, `apps/dashboard/src/screens/staff-screen.ts`,
`apps/dashboard/src/i18n/{domain,strings,codes}.ts`, `apps/server/src/guide/{en,es}/staff.md`.
Tests: `management-api.*staff*.test.ts`, `me-api.test.ts`, `person-form.test.ts`, `person-edit.test.ts`
(+ `.unsaved`), `staff-screen.test.ts`.

**Interfaces:**
- `GET /management-api/access-roles` (gate `person.manage` or `person.admin`) →
  `{ id, builtInKey, name, permissions, holderCount }[]`, built-ins first in key order, custom by
  localized name.
- `PUT /management-api/staff/:id/access-roles` body `{ roleIds, expectedRoleIds }` → `{ roleIds }`.
- Staff list/summary carry `roleIds: string[]`; `role` is removed from every staff body and
  answer. `/me` answers `roleIds`. Invite body takes `roleIds`.
- Editor: "Access roles — what they may do" / ES "Roles de acceso — lo que puede hacer", a
  `wt-combobox multiple`; a role the viewer cannot give (Rule 1, computed from `/me` permissions
  and the role's list) shows without its remove control and is not offered. No roles shows EN
  "No access role" / ES "Sin rol de acceso". Staff list role column shows every role; its filter
  matches any selected role, each person once.
- Refusals: `role.not_permitted` EN "You can only give or take away a role whose permissions you
  all have." / ES "Solo puedes dar o quitar un rol cuyos permisos tengas todos.";
  `person.roles_changed` EN "Someone changed this person's access roles while you were editing.
  Reload to see them; your changes are kept until you do." / ES "Alguien cambió los roles de acceso
  de esta persona mientras editabas. Recarga para verlos; tus cambios se conservan hasta entonces."

- [ ] **Step 1:** Browser tests: two tags save with the set read; a role the viewer cannot give has
  no remove control; stale save keeps the draft with the message above; no roles shows "No access
  role" (Review focus 5); filter by two roles lists a two-role person once.
- [ ] **Step 2–4.** Guides: `staff.md` `{#account-access}` rewritten for roles and the two rules,
  EN and ES. **Step 5: Commit**, `/finish-branch`.

---

## PR 9 — Custom access roles, server (A1002 cut 11)

**Outcome:** holders of `person.admin` can create, copy, rename, edit the permissions of and
delete access roles, within Rule 1; built-ins keep fixed names and Admin's list is locked; every
change is logged, and deletion emails each person who loses the role. **Depends on:** PR 8.
**Risk trigger:** auth.

### Task 9.1: Lifecycle

**Files:** `packages/identity/src/roles.ts`, `packages/identity/src/errors.ts`,
`packages/db/src/activity-kinds.ts`. Tests: `packages/identity/src/roles.lifecycle.test.ts`.

**Interfaces:**
```ts
export function createAccessRole(tx, input: { managementSessionId: string; name: string; permissions: readonly string[]; copiedFrom?: string }): Promise<{ id: string }>;
export function renameAccessRole(tx, input: { managementSessionId: string; roleId: string; name: string; expectedName: string }): Promise<void>;
export function setAccessRolePermissions(tx, input: { managementSessionId: string; roleId: string; permissions: readonly string[]; expectedPermissions: readonly string[] }): Promise<void>;
export function deleteAccessRole(tx, input: { managementSessionId: string; roleId: string }): Promise<{ removedFrom: number }>;
```
- All need `person.admin`, and the actor must hold every permission the role carries before and
  after (Rule 1); on create/edit each ticked permission must be held → `role.not_permitted`.
  Undeclared ID → `role.permission_unknown` `{ permission }`. Name: trimmed, nonempty
  (`role.name_required`), unique folded among custom roles (`role.name_taken` `{ name }`).
- Built-ins: rename/delete → `role.built_in` `{ roleId }`; Admin's permissions → `role.built_in`.
  Staff/Supervisor/Manager permissions editable.
- Copy reads the source's current effective permissions (Admin: `declaredPermissions()`), takes no
  people, and is an ordinary custom role.
- Delete removes every membership (each logged `access_role.member_removed` and mailed through
  `queueRoleMembershipMail`), deletes the row, logs `access_role.deleted`, then
  `assertUsableAdminRemains`.
- Activity kinds (`access_role` subject): `access_role.created` `{ name: string; permissions: string[]; copiedFromRoleId: string | null }`;
  `access_role.renamed` `{ from: string; to: string }`; `access_role.deleted` `{ name: string; permissions: string[] }`;
  `access_role.permission_added` / `access_role.permission_removed` `{ permission: string }`, one per
  permission changed. A permission edit queues no mail.

- [ ] **Step 1:** Tests: Manager creates "Accountant" with `report.view`, `report.export`,
  `fiscal.view` → ok; ticking `node.manage` → `role.not_permitted`; "Café" then "CAFE" →
  `role.name_taken`; copying Admin gives today's declared list and no people; renaming Manager →
  `role.built_in`; editing Admin → `role.built_in`; removing `payment.take` from Staff is allowed
  and the Staff holder can no longer take payment; a stale `expectedPermissions` →
  `role.changed` `{}`; deleting a role held by three people removes it from all, logs three
  removals and queues three mails for those with email; deleting the only route to a usable Admin
  is impossible (built-in), and deleting a custom role cannot leave none; a permission edit queues
  no mail.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 9.2: Routes and transfer

**Files:** `apps/server/src/management-api.ts` (or a new `apps/server/src/access-roles-api.ts`
mounted from it), `packages/provisioning/src/configuration-transfer.ts` (custom roles already travel
from PR 6; check unknown permissions in an imported role's list are dropped with the import's
existing refusal path → `setup.request_invalid` `{ field: "roles.permissions" }`).
Tests: `apps/server/src/access-roles-api.test.ts`, `apps/server/src/configuration-import.test.ts`.

**Interfaces:** `POST /management-api/access-roles` `{ name, permissions, copiedFrom? }` → 201
`{ id }`; `PUT /management-api/access-roles/:id/name` `{ name, expectedName }`;
`PUT /management-api/access-roles/:id/permissions` `{ permissions, expectedPermissions }`;
`DELETE /management-api/access-roles/:id` → `{ removedFrom }`. Each one `withTransaction` and
`requireFreshManagementSignIn`, like the other person-administration routes.

- [ ] **Step 1–4:** route tests for each verb's success and one refusal; import of a bundle whose
  custom role names an undeclared permission → `setup.request_invalid`. **Step 5: Commit**,
  `/finish-branch`.

---

## PR 10 — Access roles page and help bubbles (A1002 cut 12)

**Outcome:** People → Access roles lists the roles; each role's page shows its permissions as ticks
grouped by area with a plain label and a help bubble saying what each covers; Admin's page shows
every tick locked; Copy and Delete work with one confirmation naming how many people hold it; the
Job roles page and this one link to each other. **Depends on:** PR 9. **Risk trigger:** none beyond
UI (light path, but the help text is checked against the code).

### Task 10.1: Permission labels and help text, from the code

**Files:** Create `apps/dashboard/src/i18n/permissions.ts`. Test: `apps/dashboard/src/i18n/permissions.test.ts`.

**Interfaces:**
```ts
export type PermissionArea = "sales" | "reports" | "people" | "venue";
export interface PermissionText { area: PermissionArea; label: StringKey; help: StringKey }
export const PERMISSION_TEXT: Readonly<Record<string, PermissionText>>;
```
Areas (design §10): Sales — `payment.take`, `sale.void`, `sale.refund`, `sale.rectify`,
`cash.drawer`, `adjustment.apply`, `adjustment.approve`; Reports and tax — `report.view`,
`report.export`, `fiscal.view`, `fiscal.remedy`, `personal_data.export`; People and rota —
`person.manage`, `person.admin`, `schedule.manage`, `workforce.correct`, `workforce.self_approve`;
Venue and system — `catalogue.manage`, `venue.view`, `venue.configure`, `hardware.manage`,
`purchase.manage`, `adjustment.manage`, `booking.manage`, `system.manage`, `system.box_admin`,
`node.manage`. A module permission absent from the map is shown under Venue and system with its ID.

For each permission, the implementer runs `git grep -n '"<id>"' -- apps packages ':!*.test.ts'`,
reads each gate, and writes the help bubble as two or three sentences naming the screens and
actions it opens (CLAUDE.md "a help bubble orients"), in English and Spanish. The commit message
lists, per permission, the files read.

- [ ] **Step 1:** test: every ID in `declaredPermissions()` after registering `ALL_MODULE_PERMISSIONS`
  has an entry; every key exists in both languages. **Step 2–4.** **Step 5: Commit.**

### Task 10.2: The page

**Files:** Create `apps/dashboard/src/screens/access-roles-screen.ts`; modify
`apps/dashboard/src/dashboard-app.ts` (team group item `{ screen: "access-roles", labelKey: "nav.access_roles", requiresPermission: "person.admin" }`),
`apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`,
`packages/staffing/src/dashboard/staff-roles-screen.ts` (link line),
`apps/server/src/guide/{en,es}/staff.md` (new `{#access-roles}` section), `apps/dashboard/src/help-guide.ts`.
Tests: `access-roles-screen.test.ts`, `.unsaved.test.ts`, `.a11y.test.ts`.

**Interfaces:**
- List: `wt-data-table` (name, people, actions column keyed `actions`, `pinned: "end"`).
- Role page: name field (custom only; built-ins show their translated name, fixed), one
  `wt-switch` per permission grouped by area with its `wt-help-tooltip mode="help-mode"`; a
  permission the viewer lacks is shown and disabled. Admin: every switch on and disabled, line EN
  "Admin always has every permission." / ES "Admin siempre tiene todos los permisos."
- Copy asks for a new name; Delete confirms once: EN "{count} people hold {role}. Deleting it
  takes it away from them." / ES "{count} personas tienen {role}. Al eliminarlo se les quita."
- Link lines: on Access roles, EN "Job roles put people on the rota and on devices; they grant no
  permissions." / ES "Los puestos ponen a las personas en el cuadrante y en los dispositivos; no
  dan permisos." On Job roles, EN "Access roles decide what people may do." / ES "Los roles de
  acceso deciden lo que puede hacer cada persona."

- [ ] **Step 1:** Browser tests: create with two ticks; a permission the viewer lacks is disabled;
  Admin's page all locked; copy of Admin has today's ticks and a new name; delete confirmation
  names the holder count; stale save keeps the draft (`role.changed` message); unsaved-leave
  protection; axe in light and dark; phone width with no horizontal scroll.
- [ ] **Step 2–4.** Look at it in both themes, EN/ES, phone/desktop (screenshots stay
  uncommitted). `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`. **Step 5: Commit**, `/finish-branch`.

---

## After the last PR

Delete A1002's build entries from `docs/backlog.md` and the area file that holds them, in PR 10.
Living docs that name the old model: `git grep -nE 'PersonRoleValue|grantedFrom|persons\.role|admittedRoles|applyRoles|approverRoles|billApproverRoles' -- docs/developers docs/operations docs/backlog docs/backlog.md README.md CLAUDE.md`
must print nothing; finished plans and specs stay as written.
