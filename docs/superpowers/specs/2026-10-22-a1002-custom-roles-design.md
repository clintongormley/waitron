# A1002: roles you can define, privileges you can trust

**Status: PROPOSED. Awaiting the owner's approval of the complete design.**
Design only, 2026-10-22. This is a description to approve before a plan or build.
Source references describe checkout `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`.
They are reading receipts, not successful runtime experiments. All future behavior below is proposed
unless explicitly listed as an accepted decision. No schema is specified as executable SQL here.

## 1. The problem, through one shift

You want a “Service lead” who can refund a payment and correct attendance without changing people's
sign-in details. Today you choose among four fixed roles. Giving someone the label “Admin” also
controls exceptions elsewhere, including approving their own attendance correction. Renaming that
label cannot solve the authority problem: privileges must decide what the person can do.

Proposed example: copy Supervisor into Service lead, retain its operational privileges including
`workforce.correct`, and leave `person.admin` off. Ana can approve Luis's attendance correction;
she cannot change his email. Removing refunds from Service lead makes Ana's next refund request
fail, including from an already signed-in till. Her previous refunds keep their recorded authorizer.

### Accepted owner decisions

- Customer-defined roles, with the four built-ins as editable defaults: 2026-09-12/09-28,
  `docs/backlog/dashboard.md:409`. Privileges, never a built-in role name, determine authority:
  owner 2026-10-22 in the watcher session.
- **ONE `person.admin` privilege** covers other people's sign-in details and deciding who holds
  privileges, including when assigned to a custom role: owner 2026-10-22 ~06:35 in the watcher session.
  This decision is settled; do not ask whether to split it again.
- Review every permission AND its default assignments before building editable roles:
  owner 2026-09-26/10-02, `docs/backlog/dashboard.md:375`, `docs/backlog.md:4661`.
- A980 O5, owner ~03:45 on 2026-10-22: staff download their own personal data themselves; another
  person's or any customer's personal-data request needs a new privilege seeded only to Admin.
  Owner's words in the watcher session: “staff should be able to download their own data, otherwise admins”.

The owner has not approved this document's merges, default grants, deletion policy, attendance
self-approval replacement, or interface. Those are recommendations, not decisions already made.

## 2. One permission review, before role storage

“Privilege” is the product wording; “permission” remains the code's word for its stable identifier.
The table is the single inventory for this design, including A980's proposed identifier. Reconcile
that identifier with Lane B before either build; do not create a second privacy/export privilege.
Its source design still presents O5 alternatives at
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md:601`; the later owner answer above
supersedes those alternatives. Staff self-download is an authenticated own-person route, not a grant
of the privilege for other people's data. This design makes no legal findings.

Current grants: **T** = Staff, Supervisor, Manager, Admin; **S** = Supervisor, Manager, Admin;
**M** = Manager, Admin; **A** = Admin. These abbreviate present seed sets, never proposed hierarchy.
After seeding, each role has its own explicit grants; changing Supervisor changes no other role.

Inventory sources: **C** = `packages/identity/src/permissions.ts:5` (catalog), `:45` (Staff),
`:46` (Supervisor), `:57` (Manager), `:78` (Admin); module sources are given in their rows.
“Keep” means recommend keeping both name and current default set. Every proposed grant is explicit.

| Current identifier                      | Current grants/source                            | Recommended identifier and default grants    | Reason / boundary                                                                         |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `sale.take_payment`                     | T, C                                             | `payment.take`, T                            | Shorter domain/action name; keep payment ability on all four defaults.                    |
| `sale.void`                             | S, C                                             | `sale.correct`, S, **fiscal gate**           | Merge privileged sale corrections only after the separate authorization below.            |
| `sale.refund`                           | S, C                                             | `sale.correct`, S, **fiscal gate**           | Same proposed group; retain refund, device and payment-state conditions.                  |
| `sale.discount`                         | S, C; comment says no call site                  | Retire; explicit adjustment privileges below | Do not turn an unused grant into new power without approval.                              |
| `sale.rectify`                          | S, C                                             | `sale.correct`, S, **fiscal gate**           | Same proposed group; never merge issuance rules or rewrite past records.                  |
| `person.manage`                         | M, C                                             | Keep                                         | Employment and ordinary staff details, not another person's sign-in or privileges.        |
| `catalogue.manage`                      | M, C                                             | Keep                                         | Includes the proposed image-management merge.                                             |
| `person.admin`                          | A, C                                             | Keep, A                                      | Accepted single privilege; no implicit grant of every other permission.                   |
| `layout.configure`                      | M, C                                             | `venue.configure`, M                         | Combine configuration of themes, receipts and device profiles with venue settings.        |
| `venue.view`                            | S, C                                             | Keep                                         | Read-only venue access remains separable from configuration.                              |
| `venue.configure`                       | M, C                                             | Keep                                         | Includes layout and venue-service configuration.                                          |
| `system.manage`                         | M, C                                             | Keep                                         | Includes diagnostics; backups, recovery and Cloud controls stay sensitive.                |
| `schedule.manage`                       | M, C                                             | Keep                                         | One scheduling privilege for rota, swaps, absences and staffing configuration.            |
| `swap.approve`                          | M, C                                             | `schedule.manage`, M                         | Same default holders; combine related scheduling decisions.                               |
| `absence.decide`                        | M, C                                             | `schedule.manage`, M                         | Same group; retain subject and state restrictions.                                        |
| `purchase.manage`                       | M, C                                             | Keep                                         | Buying and receiving are distinct from catalogue editing.                                 |
| `recipe.manage`                         | M, C                                             | Keep                                         | Costed recipes need not confer buying or catalogue authority.                             |
| `report.export`                         | M, C                                             | Keep                                         | Report exports, including current attendance exports; not A980 personal-data requests.    |
| `report.view`                           | S, C                                             | Keep                                         | Wider Orders/report visibility; preserve the narrower ordinary staff view.                |
| `device.manage`                         | M, C                                             | `hardware.manage`, M                         | Group device, printer and connected payment equipment administration.                     |
| `printer.manage`                        | M, C                                             | `hardware.manage`, M                         | Same equipment group.                                                                     |
| `payments.manage`                       | M, C                                             | `hardware.manage`, M                         | Includes payment provider/reader configuration; explain that breadth in the label's help. |
| `print.resend`                          | M, C                                             | `hardware.manage`, M                         | Retry administration; retain all resend eligibility restrictions.                         |
| `cash.drawer`                           | S, C                                             | Keep                                         | Opening a drawer remains separate from printing and taking payment.                       |
| `mirror.create`                         | A, C                                             | `node.manage`, A                             | Owner prefers `node.*`; combine membership actions.                                       |
| `node.promote`                          | A, C                                             | `node.manage`, A                             | Promotion still needs its recovery operation and other existing conditions.               |
| `diagnostics.view`                      | M, C                                             | `system.manage`, M                           | Operational diagnostics join system administration.                                       |
| `fiscal.view`                           | M, C                                             | Keep                                         | Read fiscal status independently from sales or system changes.                            |
| `venue_service.manage`                  | M, `packages/venue-service/src/permissions.ts:3` | `venue.configure`, M                         | Remove the duplicate module grant; use the core permission at its consumers.              |
| `workforce.correct`                     | S, `packages/workforce/src/permissions.ts:1`     | Keep                                         | Attendance decisions about others; not account administration.                            |
| `staffing.manage`                       | M, `packages/staffing/src/permissions.ts:3`      | `schedule.manage`, M                         | Retire module identifier; staffing's job roles remain domain data.                        |
| `booking.manage`                        | M, `packages/bookings/src/permissions.ts:4`      | Keep                                         | Reservations remain an independent domain.                                                |
| `adjustment.manage`                     | M, `packages/adjustments/src/permissions.ts:3`   | Keep                                         | Configure reasons and limits, separately from using or approving one.                     |
| `image.manage`                          | M, `packages/media/src/module.ts:26`             | `catalogue.manage`, M                        | Shared catalogue images follow catalogue editing.                                         |
| A980 O5, not in this checkout's catalog | Owner: A for others                              | New `personal_data.export`, A                | One name coordinated with Lane B; own staff download needs no such grant.                 |
| Attendance's named Admin exception      | `packages/workforce/src/corrections.ts:361`      | New `workforce.self_approve`, A              | Require this AND `workforce.correct`; keep the exception confined to attendance.          |
| Adjustment application role lists       | `packages/adjustments/src/policy.ts:142`         | New `adjustment.apply`, T                    | Necessary for direct comps/discounts, additionally restricted by each reason.             |
| Adjustment approval role lists          | `packages/adjustments/src/policy.ts:185`         | New `adjustment.approve`, S                  | Necessary for reason/bill-limit approval, additionally restricted by that policy.         |

These merges reduce duplicated action grants without joining identity, personnel, reporting and
sales into a single manager switch. Do not merge `person.admin` into `person.manage`, or privacy
exports into `report.export`. Do not conflate printer-job retries with receipt copies: current retry
gating is `apps/server/src/print-api.ts:1505`; the Orders copy enters through
`apps/server/src/orders-api.ts:281`. The builder must trace both final paths before changing either.

**Fiscal gate:** `sale.correct` is a review proposal, not permission to change fiscal issuance,
refund/rectification behavior, protected tests, invoice numbering or filing. The owner's first
catalog decision may retain the three existing identifiers instead. If the owner chooses the merge,
park that slice for the required explicit fiscal authorization; do not ship half-renamed consumers.
Editable roles wait for an approved, completed catalog, including either the explicitly retained
three identifiers or the separately authorized merge. No runtime alias or compatibility layer.

## 3. Explicit roles and a catalog without a ladder

Recommended: one role per human person. Several roles would add unions, confusing removal and
assignment checks, without a requirement here. No person-specific privilege overrides. A role has
a stable opaque ID, a name, revision and an explicit set of permission IDs. Neither its name, its
seed origin nor the ID's spelling participates in authorization. An empty grant set is valid.

Seed Staff, Supervisor, Manager and Admin as independent rows using the approved table. A built-in
keeps an optional preset key only for its translated display name while unrenamed. Renaming it
stores a literal customer name and removes that translation behavior. Custom and copied names
are literal in every language. Names are trimmed, nonempty and unique using identity's existing
Unicode folding convention (`packages/identity/src/staff.ts:236`). No reserved name grants power.
Deleting or editing a preset does not cause boot to recreate it; seed completion is stored separately.

Replace `ModulePermission.grantedFrom` (`packages/module/src/module.ts:110`) with a permission
declaration plus **explicit default preset keys**, e.g. workforce correction names Supervisor,
Manager and Admin individually. The contract owns the finite preset-key vocabulary; identity
consumes it only when creating defaults. Runtime `RoleId` is a different type, never that union.
Replace composition's two-way role-union tie (`packages/composition/src/role-parity.ts:5`) with
two-way type assertions for the preset seed contract and permission-declaration input that identity
actually accepts. Keep module-to-identity dependencies in the existing direction. Reject duplicate
permission ownership, unknown default keys and undeclared grants; no `indexOf` or implied ordering.

Catalog registration describes available permissions and seed suggestions; it grants nothing.
Today boot spreads module permissions over the ladder (`apps/server/src/boot.ts:885`,
`packages/identity/src/permissions.ts:104`), using all module contributions
(`apps/server/src/modules.ts:32`). Proposed boot validates the catalog before accepting requests,
but reads effective grants from the database, never a process-global role map.

On a new venue, provision the approved permission catalog, default roles and first active human
administrator atomically before ordinary authority checks apply. The initial Admin grant set is
an explicit snapshot of the approved catalog for that release, not “all permissions forever”.
Provisioning is the sole first-authority exception; no authenticated endpoint bootstraps an admin.

New module or permission after provisioning: install its catalog entries **ungranted everywhere**,
including untouched presets. Show ungranted entries and release seed suggestions for review, but
never let that screen grant something its actor lacks. Keep all release-known module permissions
in the initial catalog, including disabled modules, as the current composition does. Enabling one
activates its routes against existing saved grants; it does not add grants to any role.
Example: enabling Bookings gives Service lead nothing. An administrator already holding
`booking.manage` can explicitly grant it to selected roles; an edited Admin lacking it cannot.
For a genuinely new permission ID with no holder, recommend **reset and reprovision while pre-live**
to establish its first grants. Until then the permission remains unavailable. The same applies if
all holders deliberately remove a permission. This is the explicit cost of strict no-widening;
there is no self-adoption endpoint, implicit Admin grant or boot-time seed repair. A future live
upgrade bootstrap would need its own owner-approved authority design before this assumption expires.
Disabled modules keep saved grants but expose no actions; re-enabling restores only those grants.

## 4. Storage and references, with schema deferred

Proposed owner: IDENTITY migration set. Role rows, permission catalog, grants, seed-completion state
and membership revisions are `state`, declared in `IDENTITY_CLASSIFICATION`, with matching change
sources. Each human's `persons.role_id` is a required role reference; one row owns their membership.
No tenant column. Internal principals are explicitly distinguished from human staff and excluded
from last-human-authority counts. Their separate session/principal kind resolves restricted service
grants, without human role membership. Tokens remain hashed; key custody and cryptographic algorithms
are unchanged. Current classification and hash conventions: `packages/identity/src/classification.ts:13`.

Declare role/grant uniqueness and references in TypeScript and generated migrations. Membership
and live domain references restrict deletion. Never cascade-delete people, authenticators or
history when deleting a role. Device-admission and adjustment-policy role references must be
enumerated before schema design, including JSON lists today. Prefer relational policy membership
rows so import remapping and deletion can see them. Keep recorded historical snapshots independent
of live-role foreign keys; snapshot the role ID/name and grants relevant to a new audited decision.

Retain original actor/authorizer IDs and recorded policy on old attendance, adjustment, sale,
payment and print records. A renamed/deleted role must not relabel an old approval or re-evaluate
it with today's grants (`packages/adjustments/src/policy.ts:191` already snapshots reason policy).
No retroactive history rewriting, compatibility conversion or hand-edited shipped migrations.
Recommend pre-live reset delivery; list incoming keys before any generated table rebuild.
Actual schema, migration dependency changes and reset declaration belong to the later approved plan.

## 5. Mutation rules that prevent indirect grants

Proposed ordinary role operations require the actor's current `person.admin`; that privilege alone
admits role administration and the minimum staff identity lookup needed for it. Do not also require
`person.manage` or count a holder who cannot reach these operations as the last administrator.
Ordinary employment edits still require `person.manage`. Sign-in changes to someone else require
`person.admin`, independently of their role label; self-service security flows keep their own checks.

Inside the mutation's ONE `withTransaction`, resolve the actor again, load current grants and
revisions, validate the entire result, write it, and check the final active-human authority count
before returning. `withTransaction` uses `withWriteLock` (`packages/db/src/tenancy.ts:30`);
the proposed invariant depends on every mutation path taking that serialization boundary.
Queries on this transaction run in turn. The count must still hold at commit; it is not a UI check.

| Operation                         | Proposed authority and result checks                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/copy a role                | Every copied/selected grant is held by the actor. Copy grants only, with a new literal name; no holders, admission or reason-policy membership copied.                                                                                   |
| Edit grants on a role             | Each added privilege is held by the actor. Removals may narrow power the actor lacks; check every holder and the last-authority rule. Renaming grants nothing.                                                                           |
| Assign, invite or reactivate      | Require `person.admin`; the WHOLE destination grant set is a subset of the actor's current grants, including empty/custom roles. No self-promotion exception.                                                                            |
| Change another person's sign-in   | Require `person.admin` AND the target's whole current grant set to be within the actor's, preventing takeover of a more powerful account. Includes email, PIN/password reset, invitation, MFA/passkey/Google removal and status changes. |
| Delete/reassign                   | Require `person.admin`; explicitly selected destination roles must be wholly within the actor's grants, with contextual impacts reviewed below.                                                                                          |
| Edit admission or reason policies | Require the relevant domain configuration permission; adding effective apply/approval access also requires the corresponding action privilege. No policy edit grants a missing privilege.                                                |

Example: Marta has `person.admin` but no backup/system privilege. She cannot assign Admin's broader
grant set to herself, copy it intact, reset the sign-in of its holder, or delete Service lead and
move its holders into that broader role. She can remove a privilege from a role, provided someone
active still holds `person.admin`. Administrative authority does not mean ownership of every action.

**Last authority:** after every person/role/catalog/import or authentication-method mutation, at
least one ACTIVE HUMAN has `person.admin` through a live role AND remains eligible to sign in to
the dashboard with an enrolled, supported method and reach role administration. A till PIN alone
does not establish that dashboard eligibility. Pending invitations, suspended people, mirror
principals and people without a usable dashboard method never count. Apply this same final-state
check to bulk role edits, assignment, `setRole`, both suspension functions, authentication-method
removal, login reset that changes active to pending, deletion/reassignment, catalog retirement and
configuration import. Granting the privilege to an active PIN-only person cannot make it valid to
remove the previous holder. An authenticated replacement of the sole holder's own sign-in method
must leave a usable method. Recovery cannot silently create privileges; it resets an explicitly
selected human who already holds `person.admin`.

Optimistic revisions detect another editor's changes; stale saves return a localized conflict and
keep the local draft for explicit reload/review. Authority comes from current rows even when the
revision matches. A transaction already committed before narrowing stays a recorded fact; an
operation waiting to write must authorize again after acquiring its transaction, not use a prior read.

Invitation issuance records its issuer and target membership/grant revision. Role reassignment or
grant changes invalidate unused invitation/recovery/email-change actions for affected people;
resend creates a fresh proof. Redemption checks current target role, active issuer `person.admin`,
and target grants within that issuer's current grants. A revoked issuer cannot leave a latent grant.
Pending people gain no session authority; invitation completion uses current rows atomically.
Existing proof machinery is in `packages/identity/src/account-action.ts:62` and `:296`.

## 6. Deleting a role in use

Recommend **delete with explicit reassignment in one transaction**, for presets too. Present every
active, pending and suspended holder and require a destination for each (a bulk destination is a
convenience, never preselected). Show privileges gained/lost and device/reason access changes.
Do not silently choose Manager, transfer the deleted role's grants, or drop holders to a default.

Every live reference is in the preview: person membership, explicit device-profile admission,
reason apply/approver sets and bill-limit approvers. The owner chooses removal or replacement
for each policy reference, requiring its domain editor privileges. Require nonempty valid approval
sets where the domain requires them. Refuse unresolved references. Recompute impacts and revisions
inside the transaction; apply memberships and policy choices, retain historical facts, remove the
role/grants, invalidate pending proofs and check last authority. Any refusal rolls back everything.

Worked example: Evening lead has Ana active and Luis pending. You choose Supervisor for Ana,
Staff for Luis, remove Evening lead from a till's admission set, and replace its complaint-approver
reference with a selected eligible role. The preview names any gained approval or device access
from each destination. An unreviewed gain requires confirmation. The transaction either applies
all choices or none. Luis's old invite stops working; reissue against Staff. If Evening lead was
the only active `person.admin` role and neither destination preserves an active holder, refuse.
Choose a destination that already holds the privilege or establish another active holder first.

The destination's existing contextual policy applies to reassigned holders, but deleting a role
does not automatically insert that destination into other admission/approval sets. An empty
explicit device-admission set must mean nobody, never fall back to everybody after its final row
is removed. Explicit “All roles, including future roles” is a different mode requiring a visible
choice; recommend selected roles as the default. These are owner-review proposals.

## 7. Replacement audit: follow each consumer to its meaning

This table records the source trace, not an assertion that runtime behavior was tested. Runtime
uses permission grants plus contextual limits; preset keys exist only in seeds and translations.

| Consumer and current source                                                                                                                                                                                                                         | Proposed replacement / fact to retain                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder/catalog, `packages/identity/src/permissions.ts:43`, `:104`; module contract `packages/module/src/module.ts:104`; composition `packages/composition/src/role-parity.ts:5`                                                                     | Role IDs and DB grants; explicit preset seed sets and compile-time contract tie (§3). No runtime seniority or wildcard Admin.                                                                                                                                                                                                                                                                               |
| Staff target-role checks, `packages/identity/src/staff.ts:210`, `:259`, `:502`, `:507`                                                                                                                                                              | Compare actual target/result grants and membership revisions. Changing who holds privileges always needs `person.admin`; invalidate proofs on every relevant change, not only an Admin transition.                                                                                                                                                                                                          |
| Last Admin queries, `packages/identity/src/staff.ts:193`, `:271`, `:315`; alternate mutators `:497`, `:567`, `:579`                                                                                                                                 | One final-state active-human `person.admin` invariant shared by every mutation path; no helper bypass.                                                                                                                                                                                                                                                                                                      |
| Sign-in takeover boundary, `packages/identity/src/staff.ts:131`, `:233`, `:395`; server routes `apps/server/src/management-api.ts:1125`, `:1209`                                                                                                    | Keep A998/A1000's other-person privilege boundary; add target dominance checks. `person.manage` alone cannot invite, change sign-in, reset or reactivate anyone else.                                                                                                                                                                                                                                       |
| Dashboard sessions, `packages/identity/src/management-session.ts:60`; manager authorization `packages/identity/src/manager-login.ts:162`                                                                                                            | Join active human, live role and DB grants on every request; return a request-local authority snapshot, never a role-name lookup.                                                                                                                                                                                                                                                                           |
| Till/session and PIN authorization, `packages/identity/src/authorize.ts:43`, `:74`; `apps/server/src/till-session.ts:99`; `packages/identity/src/credential.ts:43`                                                                                  | Check live human status, role existence, grants and device admission in the action's transaction, also on routes without a permission option. A valid old PIN proof conveys no old privilege.                                                                                                                                                                                                               |
| Early PIN preparation, `apps/server/src/pin-check-ahead.ts:55`; refund confirmation `apps/server/src/bill-refunds.ts:696`, `apps/server/src/tender-refund-authorization.ts:144`                                                                     | Early reads only decide costly credential work; final action resolves current grants again. Preserve hashing outside the write transaction, throttles and generic login refusals.                                                                                                                                                                                                                           |
| Approver lists, `packages/identity/src/staff.ts:613`, `:621`; query parser `apps/server/src/adjustments-api.ts:88`                                                                                                                                  | Filter current active eligible people by required privilege AND current policy. Never trust client-supplied role IDs as authorization. Re-evaluate policy/PIN submit after picker loads.                                                                                                                                                                                                                    |
| Attendance views, `apps/server/src/management-attendance-api.ts:206`, `apps/server/src/till-attendance-api.ts:226`                                                                                                                                  | `canSelfApprove` requires `workforce.correct` plus proposed `workforce.self_approve`, not `person.admin`. Same decision in picker and write.                                                                                                                                                                                                                                                                |
| Attendance domain, `packages/workforce/src/corrections.ts:35`, `:42`, `:252`, `:360`; `packages/workforce/src/attendance-response-commands.ts:119`                                                                                                  | `workforce.correct` replaces MANAGER_ROLES for others' proposals/decisions and author-kind selection. Self exception additionally needs `workforce.self_approve`; preserve own subject/requester, direction and approve-only conditions. Stored author-kind is a historical fact, not a live role.                                                                                                          |
| Mirror ambient viewer, `apps/server/src/mirror-session.ts:28`, `:46`, `:90`                                                                                                                                                                         | Distinct system principal with explicit DB-backed grants scoped to a reviewed read-operation allowlist. No human Admin membership, last-authority count or PIN eligibility; recheck mirror mode each request and end it at promotion. Sensitive sign-in/secret/data exports are excluded by default; owner reviews changed mirror visibility. Keep hashed token custody and the independent read-only gate. |
| Adjustment decisions, `packages/adjustments/src/policy.ts:142`, `:171`, `:185`; `apps/server/src/adjustments-apply.ts:558`, `:770`                                                                                                                  | Require `adjustment.apply` / `adjustment.approve` plus explicit reason/bill policy limits; cancellation retains refund/correction privilege and stage rules. Role-ID sets restrict a context; inclusion alone never grants an action. No implicit “higher” role.                                                                                                                                            |
| Adjustment policy/storage/seeds, `packages/adjustments/src/schema/reasons.ts:42`, `packages/adjustments/src/schema/settings.ts:6`, `packages/adjustments/src/provisioning.ts:6`                                                                     | Resolve seed preset keys once to role IDs. Preserve Complaint S, On the house M, Staff meal T with 50% limit and M approval, Discount M; custom roles enter no policy implicitly. New policy role lists are explicit restrictions, proposed for owner approval.                                                                                                                                             |
| Adjustment client seniority, `packages/adjustments/src/dashboard/reasons-screen.ts:43`, `:94`, `:1251`; client union `packages/adjustments/src/dashboard/client.ts:9`; till text `apps/till/src/widgets/adjustment-dialog.ts:112`                   | The inspected “seniority” helper orders/filters lists; the policy above tests membership. Replace hardcoded lists everywhere with catalog IDs, value-set equality and localized label sorting. “Everyone” cannot mean “the four presets selected”.                                                                                                                                                          |
| PIN prompt wording, `apps/till/src/widgets/supervisor-override-dialog.ts:76`, `:115`                                                                                                                                                                | Replace role-keyed translation interpolation and the default “supervisor” claim with the required privilege/policy and actual eligible people. A literal custom role name is never a translation key.                                                                                                                                                                                                       |
| Device admission, `packages/identity/src/profile-admission.ts:15`, `:50`, `:181`; schema `packages/identity/src/schema/profile-admission.ts:9`                                                                                                      | Distinguish all/selected/none explicitly; role-ID restrictions and person exceptions bound admission, never action privileges. New custom roles gain no selected-profile admission. Preserve profile actions/zones beside current person grants; deletion cannot empty a set into the old “every” sentinel.                                                                                                 |
| Dashboard forms/filter/labels, `apps/dashboard/src/widgets/person-form.ts:291`, `widgets/person-edit.ts:332`, `screens/staff-screen.ts:376`, `i18n/domain.ts:147`; unions `apps/dashboard/src/api/client.ts:336`, `apps/till/src/api/client.ts:904` | Fetch roles with IDs/display metadata. Sort by displayed label in the chosen locale; filter by ID. Custom/renamed names never pass through built-in translation tables. No hardcoded Staff default assignment.                                                                                                                                                                                              |
| Shell and permission projections, `apps/dashboard/src/dashboard-app.ts:1178`, `apps/server/src/me-api.ts:331`, `apps/server/src/till-api.ts:1426`, `apps/server/src/alerts-api.ts:46`                                                               | Refresh permission/catalog revision passively, including after a refusal; navigation is presentation, never the authorization gate. Open tabs/tills cannot retain server authority from an old response.                                                                                                                                                                                                    |
| Scheduling/workforce/reporting, `apps/server/src/workforce-api.ts:35`, `packages/staffing/src/routes.ts:194`, `apps/server/src/attendance-export-api.ts:45`, `apps/server/src/orders-api.ts:145`                                                    | Apply approved catalog merges and DB checks. Preserve own-person exports and Orders' existing non-report scope; do not infer a wider view from a role label. Staffing's job roles (`packages/staffing/src/staff-roles.ts:115`) are different domain objects, not authority roles.                                                                                                                           |
| Other direct lookups, `packages/venue-service/src/routes.ts:703`, `apps/server/src/email-settings-api.ts:50`, `apps/server/src/email-inbox-api.ts:39`                                                                                               | Replace `roleHasPermission` with transaction-local grants, retaining defaults/sign-in-mail restrictions and approved catalog names.                                                                                                                                                                                                                                                                         |
| Provisioning/recovery, `packages/provisioning/src/venue-apply.ts:196`, `packages/provisioning/src/recover-provisioned-venue.ts:46`; CLI `apps/server/src/break-glass-command.ts:94`                                                                 | Seed rows before the initial human; resume identifies the recorded human and current `person.admin`, not a name. Recovery selects an existing privilege holder explicitly; keep credential reset/revocation semantics without granting a role.                                                                                                                                                              |
| Transfers, `packages/identity/src/configuration-transfer.ts:1`, `packages/adjustments/src/configuration-transfer.ts:34`, `packages/provisioning/src/configuration-transfer.ts:700`, `:724`, `:737`                                                  | Export role definitions/grants and explicit live references, never login secrets/sessions. Remap all IDs. Preserve the target bootstrap administrator by recorded ID/grants, not `role <> 'admin'`; do not merge imported grants into its role. Imported staff remain suspended. Validate catalog, references and final authority.                                                                          |
| Automatic work, `apps/server/src/certificate-reminder-worker.ts:62`; authenticated operations `apps/server/src/operation-authentication.ts:87`                                                                                                      | Select recipients and check actor-bound pending operations from current DB grants each execution. System duties use explicit service authority/current mode, not a synthetic human role. Committed fiscal/outbox facts continue under their existing duty, not a former employee's session.                                                                                                                 |
| Fixtures and constraints, `packages/identity/test/fixtures.ts:57`, `apps/server/scripts/demo-seed/staff.ts:18`, `packages/identity/src/schema/persons.ts:6`, `:76`                                                                                  | Seed real roles/grants before people; use opaque custom IDs and changed preset grants in tests. Replace role enum/checks and API enums; preserve status checks and behavioral assertions. Scan migrations, snapshots, guides and seeds again in the plan.                                                                                                                                                   |

For configuration import, preserve the target setup operator AND their role/grants by recorded IDs;
replace only other seed definitions. Resolve a source role-name collision with the retained target
role by an explicit import rename, never a permission union or a name-based identity match. Refuse
unknown permission IDs or unresolved references before import. Imported suspended people cannot
become an alternate authority path: later invitation/reactivation still checks the entire role set.

## 8. Dashboard flow, without executable mockups

Propose People → Roles, beside Staff, reachable at `/manage/roles`. Its link and write controls need
`person.admin`; staff editors with only `person.manage` can read the role labels required by their
existing Staff view. Full grant editing remains on Roles. A direct URL gets the same server checks.
Keep Roles distinct from staffing's job roles; show “Access roles” if both labels appear together.

```text
Roles                                  [Add role]
[Search roles]
Name              People   Privileges       ⋮
Service lead          3    9 selected       Edit / Copy / Delete

Edit Service lead
Name * [Service lead]
Privileges [Search]
Service:  [x] Take payments  [x] Correct sales  [ ] Open drawer
People:   [ ] Manage staff   [ ] Manage sign-in and privileges
Attendance: [x] Correct attendance  [ ] Approve own corrections
Each row has a short plain-language effect; unavailable grants explain why.
Used by Ana, Luis, Sam. Removing Correct sales affects their next request.
[localized form message, on its own line]
[Cancel] [Delete]                              [Save]

Delete Evening lead
Ana   [Choose replacement *]   Gains … / loses …
Luis (invitation pending) [Choose replacement *]
Device and adjustment-policy references [explicit choices *]
No historical approval will change. Pending invitations must be reissued.
[localized form message]
[Cancel]                            [Delete and reassign]
```

Use existing `wt-data-table` (actions pinned at end), `wt-row-actions`, `wt-input`, `wt-combobox`,
`wt-switch`, `wt-dialog` and `wt-form-actions`; no screen-owned native fields. Edit/Copy/Add and
delete choices hold `draftScopeFor` scopes with unsaved navigation/Cancel/Escape protection.
Use `saveActionState`, an unchanged-handler early return and shared value-set comparison.
Save opens quiet/disabled; invalid attempted submission marks each field plus one localized footer
message. A server refusal alone does not disable retry. Save closes after the write, then refreshes;
a failed refresh reports a load failure. Busy dialogs prevent dismissal through the primitive.

On permission loss, retain the local draft, explain that it cannot be saved and offer explicit
discard/reload; never quietly submit or discard it. Passive role updates refresh labels, counts and
authority, never overwrite dirty forms. The server remains decisive if that update is delayed.
Copy starts with a new name required; it previews rather than silently strips ungrantable privileges.

All interface labels/messages/help are EN/ES strings; literal custom names stay unchanged across
language switches. Example messages to translate and review: “You cannot grant a privilege you do
not hold”, “Keep at least one active person who can manage sign-in and privileges”, and “This role
changed while you were editing. Review the saved version before trying again.” Mark the affected
privilege/member field and place the form message above actions. Help links use dashboard/till
`help-guide.ts`; update English and existing Spanish twins with shared heading IDs.

At phone width, use one column, wrapping names and effects, with vertically stacked reassignment
rows and reachable footer buttons. Do not require horizontal scrolling to understand gains/losses.
Use declared `--wt-*` tokens, semantic names and keyboard/focus behavior from the design system.
**Text wireframes are not visual approval:** require visual review in light/dark, EN/ES and phone/
desktop before UI build approval. The owner approves the complete design before plan/build.

## 9. Boundaries and later slices, not an implementation plan

Order: owner catalog/default-policy decision; reconcile A980 O5 with Lane B; separately authorize
any fiscal merge; complete catalog changes; then role storage/provisioning and live authority;
then transactional mutation/reference handling; then reviewed UI and guides. Domain consumers,
imports, mirrors, workers and fixtures are part of the same authority transition, not deferred leaks.
Do not release editable grants with one remaining role-name bypass. The builder may group delivery
into reviewable slices, but no partially wired authorization model is enabled for venues.

Actual schema and tests wait for approval. Retire misleading current prose while implementing,
including the permanent permission-name claim in `packages/identity/src/permissions.ts:1`;
inspect the whole changed prose path set. Coordinate the shared catalog with Lane B before build.

## 10. Acceptance evidence the later build must produce, test first

- Real database cases start red for role grants instead of names. Rename Admin without changing
  powers; remove its `person.admin`; grant that privilege to a custom role; demonstrate each next
  request's expected permission or refusal. Changing any preset has no cascading effect on others.
- Exercise dashboard, till, old open sessions, both PIN authorizers, approver pickers followed by a
  revocation, early PIN checks followed by narrowing, and automatic recipient selection. Reject
  suspended/pending humans even on till routes without a separate permission option.
- For every mutator in §5, assert the domain error AND unchanged memberships, grants, proof state
  and references on refusal. Attempt assignment/copy/delete/credential-reset laundering from an
  actor who holds `person.admin` but lacks the target privilege. Include stale full-body staff edits.
- Compete two transactions removing the two remaining active holders through different paths;
  exactly one commits. Repeat with role narrowing versus suspension/login reset and with an
  invitation pending. Grant `person.admin` to an active PIN-only person, then attempt to remove
  the previous dashboard-capable holder; refuse the latter and retain that holder. Cover removal
  of the last usable method and assignment of a role containing only `person.admin` to a person
  who does have dashboard authentication; that person can reach role administration without
  `person.manage`. Read final rows after commit; a preview count or an in-transaction assertion
  alone does not establish the invariant. Negative control: remove the shared check and see failure.
- Delete a populated role across active/pending/suspended holders, profile admission and adjustment
  policies; compare all final references and retained history. Force a final refusal and assert
  complete rollback. Explicit-empty admission denies everyone; it never becomes “all”.
- Test attendance permission without `person.admin`, and `person.admin` without workforce rights.
  Self-approval requires both workforce privileges and all existing identity/direction restrictions;
  declining your own request remains refused. Exercise the domain commands as well as HTTP.
- Test a custom adjustment role selected in policy but lacking the action privilege, and the
  converse; both fail. Retain numerical limits, fired/served cancellation gates, authorizer facts
  and snapshots. No sale issuance or fiscal assertion change without its separate owner authority.
- Test first provisioning, repeat boot after edited/deleted presets, a new permission ungranted,
  refused self-adoption, module disable/re-enable, transfer ID remapping and hostile bundles.
  Imported people stay suspended; the target's active authority survives. A mirror principal can
  read only its declared operations and never mutate, approve, count as last human or survive promotion.
- Browser cases cover sorting custom labels in both locales, required fields/refusals, current
  authority changes during dirty edits, all leave paths, duplicate saves, late refreshes, keyboard
  focus and accessible messages. LOOK at long names and deletion impacts at phone width in both
  themes; run appropriate accessibility checks. Compile-time negative cases reject wrong preset keys.

## 11. Owner choices to resolve, in order

**Ask first:** accept reset-and-reprovision for a genuinely new permission that nobody yet holds,
while pre-live? **Recommend yes, as §3 describes.** Example: a future release introduces a new
Bookings export privilege; Marta cannot give it to herself merely because she has `person.admin`.
The current venue keeps trading with that feature unavailable until its owner chooses a reset.
Enabling an already cataloged module uses saved grants and requires no reset. Alternative: park
new-permission activation until a separate bootstrap design is approved; do not weaken the settled
rule that a role editor cannot grant privileges they lack.

Record the remaining choices for the full-design review, each with a recommended default:

- **Catalog:** approve §2's non-fiscal merges and default sets; retain the three sale identifiers
  until separately authorizing their proposed merge. Example: a hardware manager also administers
  reader settings and print retries; a catalogue editor manages images but cannot invite people.
- **Attendance:** use `workforce.self_approve`, seeded to Admin, plus `workforce.correct`.
  Example: a payroll lead may approve their own correction if both are assigned, without permission
  to reset accounts. Do not substitute broad `person.admin`; do not widen every Supervisor's rights.
- **Context policies:** keep explicit role-ID lists as restrictions in device admission and
  adjustments, always intersected with action privileges. Example: a copied Service lead has
  adjustment privileges but enters no reason's approval set merely by being copied. Alternative
  global privileges alone would change reason-by-reason limits and needs a different design.
- **Deletion:** approve §6's explicit reassignment/reference choices, including visible confirmed
  contextual gains. Example: move Ana to Supervisor while moving pending Luis to Staff; never
  elevate both to Manager as a fallback. Empty selected admission means nobody.
- **Names and membership:** one role/person; literal renamed preset names, translated untouched
  presets. Example: renaming Supervisor to “Evening lead” keeps that text in Spanish too.
- **Mirrors:** use a scoped system reader, excluding sign-in secrets and personal-data exports by
  default. Example: promotion kills its viewer token; no editable Admin row can make it an operator.

Assumptions to check before planning: the venue remains pre-live and reset delivery is available;
the approved catalog may change before build; Lane B has not finalized a conflicting O5 identifier.
