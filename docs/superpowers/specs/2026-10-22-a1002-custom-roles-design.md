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

- Customer-defined roles, with the four built-ins originally described as editable defaults:
  2026-09-12/09-28, `docs/backlog/dashboard.md`, “Roles are something an admin can add and edit”.
  The later Admin answer below qualifies that earlier decision. Privileges, never a built-in
  role name, determine each action's authority: owner 2026-10-22 in the watcher session.
- **Built-in Admin always holds EVERY declared privilege, including future additions.** Owner
  2026-10-22 ~08:40, `waitron-campaign-g/questions.md`, the OWNER ANSWER for A1002 question 1.
  The answer says “the built-in Admin role automatically holds every privilege”. Custom roles
  hold exactly their selected grants; nobody grants a privilege they lack. This answers the
  reset/new-privilege question. The protection mechanism in §3 remains a recommendation.
- **ONE `person.admin` privilege** covers other people's sign-in details and deciding who holds
  privileges, including when assigned to a custom role: owner 2026-10-22 ~06:35 in the watcher session.
  This decision is settled; do not ask whether to split it again.
- Review every permission AND its default assignments before building editable roles:
  owner 2026-09-26/10-02, `docs/backlog/dashboard.md:375`, `docs/backlog.md:4661`.
- A980 O5, owner ~03:45 on 2026-10-22: staff download their own personal data themselves; another
  person's or any customer's personal-data request needs a new privilege seeded only to Admin.
  Owner's words in the watcher session: “staff should be able to download their own data, otherwise admins”.

The owner has not approved this document's Admin protection policy, other roles' default grants,
merges, deletion policy, attendance self-approval replacement, or interface. Those are
recommendations, not decisions already made. The complete design remains PROPOSED.

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
Proposed: each ordinary role keeps its own explicit grants; changing Supervisor changes no other
role. Protected Admin holds the entire declared catalog, maintained as explicit grants under §3.

Inventory sources: **C** = `packages/identity/src/permissions.ts:5` (catalog), `:45` (Staff),
`:46` (Supervisor), `:57` (Manager), `:78` (Admin); module sources are given in their rows.
“Keep” means recommend keeping both name and current default set for ordinary roles. Admin receives
every retained or new declared entry regardless of seed suggestions. Every proposed grant is explicit.

| Current identifier                      | Current grants/source                            | Recommended identifier and default grants    | Reason / boundary                                                                                           |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `sale.take_payment`                     | T, C                                             | `payment.take`, T                            | Shorter domain/action name; keep payment ability on all four defaults.                                      |
| `sale.void`                             | S, C                                             | `sale.correct`, S, **fiscal gate**           | Merge privileged sale corrections only after the separate authorization below.                              |
| `sale.refund`                           | S, C                                             | `sale.correct`, S, **fiscal gate**           | Same proposed group; retain refund, device and payment-state conditions.                                    |
| `sale.discount`                         | S, C; comment says no call site                  | Retire; explicit adjustment privileges below | Do not turn an unused grant into new power without approval.                                                |
| `sale.rectify`                          | S, C                                             | `sale.correct`, S, **fiscal gate**           | Same proposed group; never merge issuance rules or rewrite past records.                                    |
| `person.manage`                         | M, C                                             | Keep                                         | Employment and ordinary staff details, not another person's sign-in or privileges.                          |
| `catalogue.manage`                      | M, C                                             | Keep                                         | Includes the proposed image-management merge.                                                               |
| `person.admin`                          | A, C                                             | Keep, A                                      | Accepted single privilege; a custom holder gains no other privilege. Admin holds the full catalog under §3. |
| `layout.configure`                      | M, C                                             | `venue.configure`, M                         | Combine configuration of themes, receipts and device profiles with venue settings.                          |
| `venue.view`                            | S, C                                             | Keep                                         | Read-only venue access remains separable from configuration.                                                |
| `venue.configure`                       | M, C                                             | Keep                                         | Includes layout and venue-service configuration.                                                            |
| `system.manage`                         | M, C                                             | Keep                                         | Includes diagnostics; backups, recovery and Cloud controls stay sensitive.                                  |
| `schedule.manage`                       | M, C                                             | Keep                                         | One scheduling privilege for rota, swaps, absences and staffing configuration.                              |
| `swap.approve`                          | M, C                                             | `schedule.manage`, M                         | Same default holders; combine related scheduling decisions.                                                 |
| `absence.decide`                        | M, C                                             | `schedule.manage`, M                         | Same group; retain subject and state restrictions.                                                          |
| `purchase.manage`                       | M, C                                             | Keep                                         | Buying and receiving are distinct from catalogue editing.                                                   |
| `recipe.manage`                         | M, C                                             | Keep                                         | Costed recipes need not confer buying or catalogue authority.                                               |
| `report.export`                         | M, C                                             | Keep                                         | Report exports, including current attendance exports; not A980 personal-data requests.                      |
| `report.view`                           | S, C                                             | Keep                                         | Wider Orders/report visibility; preserve the narrower ordinary staff view.                                  |
| `device.manage`                         | M, C                                             | `hardware.manage`, M                         | Group device, printer and connected payment equipment administration.                                       |
| `printer.manage`                        | M, C                                             | `hardware.manage`, M                         | Same equipment group.                                                                                       |
| `payments.manage`                       | M, C                                             | `hardware.manage`, M                         | Includes payment provider/reader configuration; explain that breadth in the label's help.                   |
| `print.resend`                          | M, C                                             | `hardware.manage`, M                         | Retry administration; retain all resend eligibility restrictions.                                           |
| `cash.drawer`                           | S, C                                             | Keep                                         | Opening a drawer remains separate from printing and taking payment.                                         |
| `mirror.create`                         | A, C                                             | `node.manage`, A                             | Owner prefers `node.*`; combine membership actions.                                                         |
| `node.promote`                          | A, C                                             | `node.manage`, A                             | Promotion still needs its recovery operation and other existing conditions.                                 |
| `diagnostics.view`                      | M, C                                             | `system.manage`, M                           | Operational diagnostics join system administration.                                                         |
| `fiscal.view`                           | M, C                                             | Keep                                         | Read fiscal status independently from sales or system changes.                                              |
| `venue_service.manage`                  | M, `packages/venue-service/src/permissions.ts:3` | `venue.configure`, M                         | Remove the duplicate module grant; use the core permission at its consumers.                                |
| `workforce.correct`                     | S, `packages/workforce/src/permissions.ts:1`     | Keep                                         | Attendance decisions about others; not account administration.                                              |
| `staffing.manage`                       | M, `packages/staffing/src/permissions.ts:3`      | `schedule.manage`, M                         | Retire module identifier; staffing's job roles remain domain data.                                          |
| `booking.manage`                        | M, `packages/bookings/src/permissions.ts:4`      | Keep                                         | Reservations remain an independent domain.                                                                  |
| `adjustment.manage`                     | M, `packages/adjustments/src/permissions.ts:3`   | Keep                                         | Configure reasons and limits, separately from using or approving one.                                       |
| `image.manage`                          | M, `packages/media/src/module.ts:26`             | `catalogue.manage`, M                        | Shared catalogue images follow catalogue editing.                                                           |
| A980 O5, not in this checkout's catalog | Owner: A for others                              | New `personal_data.export`, A                | One name coordinated with Lane B; own staff download needs no such grant.                                   |
| Attendance's named Admin exception      | `packages/workforce/src/corrections.ts:361`      | New `workforce.self_approve`, A              | Require this AND `workforce.correct`; keep the exception confined to attendance.                            |
| Adjustment application role lists       | `packages/adjustments/src/policy.ts:142`         | New `adjustment.apply`, T                    | Necessary for direct comps/discounts, additionally restricted by each reason.                               |
| Adjustment approval role lists          | `packages/adjustments/src/policy.ts:185`         | New `adjustment.approve`, S                  | Necessary for reason/bill-limit approval, additionally restricted by that policy.                           |

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

Recommended: you assign one role per human person. Several roles would add unions, confusing removal
and assignment checks, without a requirement here. No person-specific privilege overrides. A role
has a stable opaque ID, a name, revision and an explicit set of permission IDs. Each action checks
effective grants, never a display name or the ID's spelling. An ordinary role may have no grants.

**Proposed Admin protection, awaiting approval:** identify exactly one built-in Admin by a stable,
immutable preset key. You may rename it, but cannot delete it, convert it to a custom role, change
its key or narrow its complete grants. The key is used only for catalog maintenance and the
protected-role integrity rules, not as an action-authorization shortcut. Staff, Supervisor and
Manager remain ordinary editable/deletable defaults. This recommendation qualifies the earlier
four-editable-default proposal; the owner has settled Admin's full grants, not this protection policy.

Keep preset identity separate from display-name behavior. An untouched preset displays its translated
name; renaming stores a literal customer name without removing Admin's immutable key or protection.
Custom and copied names are literal in every language. Names are trimmed, nonempty and unique
using identity's existing Unicode folding convention (`packages/identity/src/staff.ts:236`).
Renaming a custom role to “Admin” gives it no additional privilege. Copying protected Admin creates
an ordinary custom role with only its current explicit grants, never its key or future automatic
grants. Ordinary preset edits/deletions are not undone by boot; store seed completion separately.

Replace `ModulePermission.grantedFrom` (`packages/module/src/module.ts:110`) with a permission
declaration plus **explicit default preset keys**, e.g. workforce correction names Supervisor,
Manager and Admin individually. The contract owns the finite preset-key vocabulary; identity
uses default suggestions when creating ordinary defaults and maintains protected Admin's complete
grants independently of those suggestions. Runtime `RoleId` is a different type, never that union.
Replace composition's two-way role-union tie (`packages/composition/src/role-parity.ts:5`) with
two-way type assertions for the preset seed contract and permission-declaration input that identity
actually accepts. Keep module-to-identity dependencies in the existing direction. Reject duplicate
permission ownership, unknown default keys and undeclared grants; no `indexOf` or implied ordering.

Source reading at the named audit commit: boot spreads module permissions over the ladder
(`apps/server/src/boot.ts:885`, `packages/identity/src/permissions.ts:104`), using all module
contributions (`apps/server/src/modules.ts:32`). That is not runtime verification of this proposal.

Proposed: provision the approved catalog, default roles and first active human with usable dashboard
authentication assigned to protected Admin atomically. Initial setup establishes the first authority;
no authenticated endpoint bypasses the rule against granting privileges you lack.

Before the primary accepts ordinary requests, reconcile the complete release catalog and materialize
every declared grant on protected Admin in one transaction. Provisioning and the authorized primary
own these writes. A mirror or fenced node validates the replicated catalog and grants without
writing them; an incomplete or incompatible catalog prevents ordinary role-dependent requests.
Promotion must establish write authority before reconciliation and finish it before ordinary
requests resume. Recovery and status surfaces remain available to explain a refused start.
Keep every custom role and other ordinary preset
unchanged. Validate ownership, declarations and protected-role integrity before committing, and
fail closed if catalog installation is incomplete: do not serve routes with a partial catalog or
partial Admin grants. Permission checks read current effective grants from the database, never a
process-global role map or a catch-all string that authorizes an unknown, undeclared permission.

Show all release-known privileges in the catalog, including those for disabled modules. Mark their
current availability separately from their grants. Enabling a module changes availability, not
grants; disabling it keeps saved grants while exposing no actions. Example: enabling Bookings gives
Service lead nothing new. Protected Admin already holds `booking.manage` and can grant it explicitly.

When a later release declares Bookings export, reconciliation adds it to protected Admin only.
Its usable human holder can then grant it to selected custom roles under the ordinary checks.
A copy of Admin made before that release gains nothing automatically. No reset or separate
first-grant step is needed for a new privilege. This follows the owner's 2026-10-22 answer;
transactional materialization and protected identity are proposed implementation choices.

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
Recommend pre-live reset delivery for the initial role-storage replacement; this is separate from
new catalog additions, which need no reset. List incoming keys before any generated table rebuild.
Actual schema, migration dependency changes and initial reset declaration belong to the later approved plan.

## 5. Mutation rules that prevent indirect grants

Proposed ordinary role operations require the actor's current `person.admin`; that privilege alone
admits role administration and the minimum staff identity lookup needed for it. Do not also require
`person.manage`; a custom holder can use these operations without becoming the protected Admin anchor.
Ordinary employment edits still require `person.manage`. Sign-in changes to someone else require
`person.admin`, independently of their role label; self-service security flows keep their own checks.

Inside the mutation's ONE `withTransaction`, resolve the actor again, load current grants and
revisions, validate the entire result, write it, and check the final usable-human protected Admin count
before returning. `withTransaction` uses `withWriteLock` (`packages/db/src/tenancy.ts:30`);
the proposed invariant depends on every mutation path taking that serialization boundary.
Queries on this transaction run in turn. The count must still hold at commit; it is not a UI check.

| Operation                         | Proposed authority and result checks                                                                                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create/copy a role                | Every copied/selected grant is held by the actor. Copy current explicit grants only, with a new literal name; no protected key, automatic future grants, holders, admission or reason-policy membership copied.                          |
| Edit grants on a role             | Each added privilege is held by the actor. Ordinary-role removals may narrow power the actor lacks; check every holder and last authority. Refuse protected Admin narrowing/conversion. Rename retains its key and complete grants.      |
| Assign, invite or reactivate      | Require `person.admin`; the WHOLE destination grant set is a subset of the actor's current grants, including empty/custom roles. No self-promotion exception.                                                                            |
| Change another person's sign-in   | Require `person.admin` AND the target's whole current grant set to be within the actor's, preventing takeover of a more powerful account. Includes email, PIN/password reset, invitation, MFA/passkey/Google removal and status changes. |
| Delete/reassign                   | Require `person.admin`; refuse protected Admin deletion. For ordinary roles, explicitly selected destination roles must be wholly within the actor's grants, with contextual impacts and the protected Admin holder invariant checked.   |
| Edit admission or reason policies | Require the relevant domain configuration permission; adding effective apply/approval access also requires the corresponding action privilege. No policy edit grants a missing privilege.                                                |

Example: Marta has `person.admin` but no backup/system privilege. She cannot assign Admin's broader
grant set to herself, copy it intact, reset the sign-in of its holder, or delete Service lead and
move its holders into that broader role. She can remove a privilege from an ordinary role, while
preserving the protected Admin anchor. Administrative authority does not mean ownership of every action.

**Proposed last authority:** after every person/role/catalog/import or authentication-method mutation,
keep at least one ACTIVE HUMAN assigned to protected Admin who can sign in to the dashboard with
an enrolled, supported, usable method and reach role administration. A till PIN alone does not
establish that eligibility. Pending invitations, suspended people, mirror principals and people
without a usable dashboard method never count. A custom `person.admin` holder, even with every
current grant and usable dashboard authentication, cannot replace this anchor: a later privilege
is automatically granted only to protected Admin, so otherwise no human could grant it onward.

This is a data-integrity invariant that keeps future grants reachable, not an ordinary action gate.
Use the stable key in shared catalog maintenance and protected-role invariant handling only.
Domain actions still ask for privileges and their contextual limits; do not scatter role-name
authorization checks. Custom `person.admin` holders continue to manage roles within their grants.

Apply the same serialized final-state check to bulk role edits, assignment, `setRole`, both suspension
functions, authentication-method removal, login reset that changes active to pending, deletion/
reassignment, catalog retirement and configuration import. You may move the old Admin holder in the
same transaction as a valid replacement, only if a new active human assigned to protected Admin
with usable dashboard authentication remains in the final committed state. Granting `person.admin`
to a PIN-only person or a dashboard-capable custom holder is insufficient. Replacing the sole
holder's own sign-in method must leave a usable method. Recovery cannot silently create privileges;
it resets an explicitly selected human who already holds `person.admin` and preserves this invariant.

Optimistic revisions detect another editor's changes; stale saves return a localized conflict and
keep the local draft for explicit reload/review. Authority comes from current rows even when the
revision matches. A transaction already committed before narrowing stays a recorded fact; an
operation waiting to write must authorize again after acquiring its transaction, not use a prior read.

Administrator-issued actions record their issuer and target membership/effective-grant revision. Role
reassignment or effective-grant changes, including catalog additions to protected Admin, advance
revisions and invalidate unused invitation/recovery/email-change actions for affected people;
resend creates a fresh proof. Redemption of an administrator-issued action checks current target
role, active issuer `person.admin`, and the target's whole current effective grants within that
issuer's current grants. Never rely on an old Admin snapshot. A revoked issuer cannot leave a
latent grant. Self-service recovery and email changes keep their own identity/proof checks and
do not require an administrative issuer or `person.admin`. They cannot change membership or grants;
they still check current status, effective-grant revisions and the last usable Admin invariant.
Pending people gain no session authority; invitation completion uses current rows atomically.
Existing proof machinery is in `packages/identity/src/account-action.ts:62` and `:296`.

## 6. Deleting a role in use

Recommend **delete with explicit reassignment in one transaction** for custom roles and the three
ordinary presets. Protected Admin's Delete is disabled with an explanation, and the server refuses
deletion regardless of holders. You can rename it while retaining its key and complete grants;
you cannot narrow it or convert it to a custom role. For an ordinary role, present every
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
all choices or none. Luis's old invite stops working; reissue against Staff. This ordinary-role
deletion cannot substitute a custom `person.admin` holder for the final usable protected Admin
holder. If a combined change would remove that last holder, refuse unless a valid replacement
assigned to protected Admin remains under §5's final-state check.

The destination's existing contextual policy applies to reassigned holders, but deleting a role
does not automatically insert that destination into other admission/approval sets. An empty
explicit device-admission set must mean nobody, never fall back to everybody after its final row
is removed. Explicit “All roles, including future roles” is a different mode requiring a visible
choice; recommend selected roles as the default. These are owner-review proposals.

## 7. Replacement audit: follow each consumer to its meaning

This table retains the source trace at `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`, not an assertion
that runtime behavior was tested. Replacement proposals were revised on 2026-10-22 after the Admin
answer. Proposed actions use effective grants plus contextual limits; preset keys also support
catalog maintenance and the shared protected-role invariant, never role-name authorization.

| Consumer and current source                                                                                                                                                                                                                         | Proposed replacement / fact to retain                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder/catalog, `packages/identity/src/permissions.ts:43`, `:104`; module contract `packages/module/src/module.ts:104`; composition `packages/composition/src/role-parity.ts:5`                                                                     | Role IDs and DB grants; explicit ordinary preset seed sets and compile-time contract tie (§3). Reconcile all declared grants onto protected Admin before requests; custom roles unchanged. No runtime seniority or catch-all authorization of undeclared permissions.                                                                                                                                       |
| Staff target-role checks, `packages/identity/src/staff.ts:210`, `:259`, `:502`, `:507`                                                                                                                                                              | Compare actual target/result grants and membership revisions. Changing who holds privileges always needs `person.admin`; invalidate proofs on every relevant change, not only an Admin transition.                                                                                                                                                                                                          |
| Last Admin queries, `packages/identity/src/staff.ts:193`, `:271`, `:315`; alternate mutators `:497`, `:567`, `:579`                                                                                                                                 | One shared final-state invariant retains an active human with usable dashboard authentication assigned to protected Admin, not merely a custom `person.admin` holder. Keep serialization and commit checks; no helper bypass.                                                                                                                                                                               |
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
| Provisioning/recovery, `packages/provisioning/src/venue-apply.ts:196`, `packages/provisioning/src/recover-provisioned-venue.ts:46`; CLI `apps/server/src/break-glass-command.ts:94`                                                                 | Seed protected Admin and complete catalog grants before the initial usable human. Resume uses recorded identity/current grants and checks protected-role integrity. Recovery selects an existing privilege holder explicitly; retain credential reset/revocation and the protected Admin anchor without granting a role.                                                                                    |
| Transfers, `packages/identity/src/configuration-transfer.ts:1`, `packages/adjustments/src/configuration-transfer.ts:34`, `packages/provisioning/src/configuration-transfer.ts:700`, `:724`, `:737`                                                  | Export role definitions/grants and explicit live references, never login secrets/sessions. Remap all IDs; preview canonical Admin references mapped to the single target canonical key. Preserve its complete grants and usable human holder; no grant union or custom-marker promotion. Imported holders stay suspended; reactivation checks whole current target grants.                                  |
| Automatic work, `apps/server/src/certificate-reminder-worker.ts:62`; authenticated operations `apps/server/src/operation-authentication.ts:87`                                                                                                      | Select recipients and check actor-bound pending operations from current DB grants each execution. System duties use explicit service authority/current mode, not a synthetic human role. Committed fiscal/outbox facts continue under their existing duty, not a former employee's session.                                                                                                                 |
| Fixtures and constraints, `packages/identity/test/fixtures.ts:57`, `apps/server/scripts/demo-seed/staff.ts:18`, `packages/identity/src/schema/persons.ts:6`, `:76`                                                                                  | Seed real roles/grants before people; use opaque custom IDs, changed ordinary preset grants and renamed protected Admin in tests. Replace role enum/checks and API enums; preserve status checks and behavioral assertions. Scan migrations, snapshots, guides and seeds again in the plan.                                                                                                                 |

For configuration import, preserve exactly one target protected Admin, its complete current target
catalog grants and a usable active human holder by recorded IDs and the immutable canonical key.
Do not replace that role or holder with imported definitions. In the preview, explicitly map validated
canonical source Admin references to the target canonical key and role ID, including people and
policy references. Source grants cannot narrow or extend the target Admin catalog. Do not create
a second protected Admin, union grants, match by display name or trust an arbitrary custom source
marker as canonical identity. Validate the supported bundle schema, exactly one source canonical
role, allowed preset metadata and all reference targets; refuse inconsistent or ambiguous markers.
This is structural validation, not proof of the source's authorship. No signature or provenance
guarantee is proposed. Even a well-formed edited bundle conveys no authority: the importing actor's
current grants, the impact preview and later activation checks govern every resulting assignment.

An import needs the actor's current `person.admin`, and every imported ordinary role's entire grant
set must be within that actor's current grants. Apply §5's mutation checks in the import transaction,
including existing target holders of any role being replaced, all effective policy-access changes,
domain editor/action privileges and the final usable Admin count. Preview those existing holders
and their gains/losses; suspending imported people alone does not check changes to retained people.
Refuse an unreviewed or unauthorized change and roll back the whole import.
Replace only other seed definitions. Resolve ordinary source name collisions with an explicit
import rename. Refuse unknown permission IDs or unresolved references before import. Show imported
Admin holders' whole current target grants in the preview, even where those exceed the source set.
All imported people, including mapped Admin holders, remain suspended and cannot count as the anchor.
Later invitation/reactivation requires `person.admin` and the whole current destination grant set
within the actor's current grants, including target privileges added since export or preview.
Recheck revisions, proofs and the protected Admin invariant in the transaction; never reuse the
source's authority or credentials to activate a holder. Export/import provides no alternate grant path.

## 8. Dashboard flow, without executable mockups

Propose People → Roles, beside Staff, reachable at `/manage/roles`. Its link and write controls need
`person.admin`; staff editors with only `person.manage` can read the role labels required by their
existing Staff view. Full grant editing remains on Roles. A direct URL gets the same server checks.
Keep Roles distinct from staffing's job roles; show “Access roles” if both labels appear together.

```text
Roles                                  [Add role]
[Search roles]
Name              People   Privileges       ⋮
Admin                 1    All, including future   Rename / Copy / Delete (disabled)
Service lead          3    9 selected       Edit / Copy / Delete

Rename Admin
Name * [Admin]
Protected built-in: all declared privileges, including future additions.
Privilege choices are read-only. You cannot delete or convert this role.
Keep one active holder who can sign in to the dashboard.
Copy creates a custom role with current grants only.
[localized form message, on its own line]
[Cancel] [Delete (disabled)]                   [Save]

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
Admin's copy preview states that future privileges will not be added to the copy. Show disabled-module
privileges with availability labels. Protected Admin's read-only grants and disabled Delete explain
the protection; a direct narrowing, conversion or deletion request is refused by the server too.

All interface labels/messages/help are EN/ES strings; literal custom names stay unchanged across
language switches. Example messages to translate and review: “You cannot grant a privilege you do
not hold”, “Keep at least one active holder of the protected Admin role who can sign in to the
dashboard”, “You cannot delete this role because it must receive every current and future
privilege”, and “This role changed while you were editing. Review the saved version before trying
again.” Mark the affected
privilege/member field and place the form message above actions. Help links use dashboard/till
`help-guide.ts`; update English and existing Spanish twins with shared heading IDs.

At phone width, use one column, wrapping names and effects, with vertically stacked reassignment
rows and reachable footer buttons. Do not require horizontal scrolling to understand gains/losses.
Use declared `--wt-*` tokens, semantic names and keyboard/focus behavior from the design system.
**Text wireframes are not visual approval:** require visual review in light/dark, EN/ES and phone/
desktop before UI build approval. The owner approves the complete design before plan/build.

## 9. Boundaries and later slices, not an implementation plan

Order: owner full-design review, starting with Admin protection, then catalog/default-policy choices;
reconcile A980 O5 with Lane B; separately authorize any fiscal merge; complete catalog changes;
then role storage/provisioning and live authority;
then transactional mutation/reference handling; then reviewed UI and guides. Domain consumers,
imports, mirrors, workers and fixtures are part of the same authority transition, not deferred leaks.
Do not release editable grants with one remaining role-name bypass. The builder may group delivery
into reviewable slices, but no partially wired authorization model is enabled for venues.

Actual schema and tests wait for approval. Retire misleading current prose while implementing,
including the permanent permission-name claim in `packages/identity/src/permissions.ts:1`;
inspect the whole changed prose path set. Coordinate the shared catalog with Lane B before build.

## 10. Acceptance evidence the later build must produce, test first

- Real database cases start red for effective grants instead of names. Rename protected Admin
  without changing its key, protection or powers. Refuse its deletion, conversion, key change and
  grant narrowing, including removal of `person.admin`. Rename a custom role to “Admin” and show
  no added powers; grant `person.admin` to a custom role and check each action by its grants.
  Editing an ordinary preset changes no other role. Copy Admin without its marker; a later new
  catalog privilege reaches protected Admin only, never the copy or another custom role.
- Exercise dashboard, till, old open sessions, both PIN authorizers, approver pickers followed by a
  revocation, early PIN checks followed by narrowing, and automatic recipient selection. Reject
  suspended/pending humans even on till routes without a separate permission option.
- For every mutator in §5, assert the domain error AND unchanged memberships, grants, proof state
  and references on refusal. Attempt assignment/copy/delete/credential-reset laundering from an
  actor who holds `person.admin` but lacks the target privilege. Include stale full-body staff edits.
- Compete two transactions moving or suspending the two remaining usable active protected Admin
  holders through different paths; exactly one commits. Repeat reassignment versus suspension/
  login reset or authentication-method removal, and with an invitation pending. Compete refused
  protected Admin grant narrowing with those mutations too; narrowing must never commit. An active PIN-only
  Admin or a usable custom `person.admin` holder, even with all current grants, cannot replace the
  final usable protected Admin holder. Refuse removal of that holder or their last usable method.
  Accept a same-transaction replacement only when a new usable active human assigned to protected
  Admin remains. Separately show that a dashboard-capable custom holder of only `person.admin`
  reaches role administration without `person.manage`, within their grants. Read final rows after
  commit; a preview count or an in-transaction assertion alone does not establish the invariant.
  Negative control: remove the shared check and see failure. Keep refused mutations unchanged.
- Delete a populated role across active/pending/suspended holders, profile admission and adjustment
  policies; compare all final references and retained history. Force a final refusal and assert
  complete rollback. Explicit-empty admission denies everyone; it never becomes “all”.
- Test attendance permission without `person.admin`, and `person.admin` without workforce rights.
  Self-approval requires both workforce privileges and all existing identity/direction restrictions;
  declining your own request remains refused. Exercise the domain commands as well as HTTP.
- Test a custom adjustment role selected in policy but lacking the action privilege, and the
  converse; both fail. Retain numerical limits, fired/served cancellation gates, authorizer facts
  and snapshots. No sale issuance or fiscal assertion change without its separate owner authority.
- Test first provisioning with a usable human protected Admin, repeat boot after ordinary preset
  edits/deletions and Admin rename, and transactional catalog reconciliation. A new declared
  privilege reaches protected Admin before routes accept requests; all custom grants stay unchanged.
  Show that mirrors and fenced nodes never perform reconciliation writes: they validate replicated
  grants, refuse incompatible catalogs, and reconcile only after authorized primary promotion.
  Force incomplete installation and assert rollback and refused request acceptance; unknown,
  undeclared permission strings never authorize, including for Admin. Known disabled-module grants
  stay visible; disable/re-enable changes availability only. Reconciliation advances effective-grant
  revisions, invalidates affected unused proofs and makes redemption check current whole grants.
- Test transfer ID remapping and hostile bundles: exactly one target canonical Admin and its usable
  active human survive. Preview canonical references and target-only grants; imported Admin holders
  stay suspended. Refuse grant unions, inconsistent custom markers, unresolved references and attempts to
  reactivate through old source grants or stale previews/proofs. Reactivation checks the whole
  current target set. A restricted `person.admin` importer cannot add an unheld grant through an
  ordinary role or expand an existing active target holder's access without §5's checks. Compare
  unchanged rows and references after refusal. A well-formed edited source marker still gives no
  active authority without the actor's full checks. Cover administrator-issued invitation revocation
  and self-service recovery/email changes for ordinary staff without an administrative issuer.
  A mirror principal reads only declared operations and never mutates, approves,
  counts as last human or survives promotion.
- Browser cases cover sorting custom labels in both locales, required fields/refusals, current
  authority changes during dirty edits, all leave paths, duplicate saves, late refreshes, keyboard
  focus and accessible messages. LOOK at long names and deletion impacts at phone width in both
  themes; run appropriate accessibility checks. Compile-time negative cases reject wrong preset keys.

## 11. Owner choices to resolve, in order

**Answered 2026-10-22 ~08:40:** retire the reset/new-privilege question. Built-in Admin always holds
every privilege, including future additions; custom roles keep exactly their selected grants.
Nobody grants privileges they lack. Every action checks privileges, never a role name. The single
`person.admin` privilege is also settled and is not a question for this review.

**Publish this first question only:** do you approve the proposed protected Admin policy? Recommend
allowing rename while retaining its immutable preset key, all current and future declared grants,
and protection against deletion, conversion or grant narrowing. Keep at least one active human
holder with usable dashboard authentication. Example: you rename Admin to “Owners”; it still
receives a later Bookings export privilege. Copying it to “Service lead” gives that custom role
only today's grants. You can move the last Owners holder only if a usable active protected Admin
replacement remains in the same transaction. A custom `person.admin` holder cannot replace that
future-grant anchor. These protection choices are recommendations, not part of the settled answer.

Approving this first policy alone does not approve the entire design or authorize a plan/build.
Stage the full-design review one choice at a time, with the examples below. Queue the following
questions for later publication; do not publish them alongside the first protection question:

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
- **Deletion:** approve §6's explicit reassignment/reference choices for custom roles and the
  three ordinary presets, including visible confirmed contextual gains. Example: move Ana to
  Supervisor while moving pending Luis to Staff; never
  elevate both to Manager as a fallback. Empty selected admission means nobody. Protected Admin
  remains undeletable under the first proposed policy.
- **Names and membership:** one role/person; literal renamed preset names, translated untouched
  presets. Example: renaming Supervisor to “Evening lead” keeps that text in Spanish too.
- **Mirrors:** use a scoped system reader, excluding sign-in secrets and personal-data exports by
  default. Example: promotion kills its viewer token; changing a human role cannot make it an operator.

After resolving these choices, request approval of the complete revised design. Until then it
remains PROPOSED, even if the first protection policy has been approved.

Assumptions to check before planning: the venue remains pre-live and reset delivery is available;
the approved catalog may change before build; Lane B has not finalized a conflicting O5 identifier.
