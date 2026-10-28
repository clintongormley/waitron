# A1002: roles you can define, privileges you can trust

**Status: PROPOSED. Awaiting the owner's approval of the complete revised design.**
Design only, 2026-10-22; **revision 2026-10-28** incorporates the owner's separate answers.
Resolve §11's sole-role deletion question first, then seek full-design approval separately.
This draft authorizes no plan or build.

The historical source audit stays pinned to `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`.
Those references are reading-only receipts, not runtime verification. Bounded additional readings
at `e0f3e261c3811333d91db376fcab900eab216151` are labelled separately in §7.
Future behavior is proposed unless explicitly listed as an accepted owner decision.
Storage, mutation mechanics and the multi-role interpretation remain driver proposals.
No schema is specified as executable SQL here.

## 1. The problem, through one shift

You want a “Service lead” who can refund a payment and correct attendance without changing people's
sign-in details. At the historical audit, you choose among four fixed roles, and the Admin label
also controls attendance self-approval. Privileges must decide what the person can do.

Proposed example: copy Supervisor into Service lead, retain `sale.refund` and `workforce.correct`,
and leave `person.admin` off. Ana can approve Luis's attendance correction without changing his
email. You may assign Ana both Staff and Service lead. Under the driver's proposed union rule,
removing refunds from Service lead stops her next refund only if none of her other roles grants
it. Her previous refunds keep their recorded authorizer.

### Accepted owner decisions

- Customer-defined roles, with four built-ins originally described as editable defaults:
  2026-09-12/09-28, `docs/backlog/dashboard.md`, “Roles are something an admin can add and edit”.
  The 2026-10-28 names decision qualifies “editable”: Staff, Supervisor and Manager keep editable
  privileges, but all four built-ins keep fixed translated names and cannot be deleted.
  Privileges, never a built-in role name, determine action authority: owner 2026-10-22.
- **Built-in Admin always holds EVERY declared privilege, including future additions.** Owner
  2026-10-22 ~08:40, Lane G question 1. Custom roles hold exactly their selected grants; nobody
  grants a privilege they lack. No reset or separate first-grant step is needed for a new privilege.
- **ONE `person.admin` privilege** covers other people's sign-in details and deciding who holds
  privileges, including when assigned to a custom role: owner 2026-10-22 ~06:35. Do not split it.
- Review every permission AND its default assignments before building editable roles:
  owner 2026-09-26/10-02, `docs/backlog/dashboard.md`, “Review every permission”.
- A980 O5, owner ~03:45 on 2026-10-22: “staff should be able to download their own data, otherwise
  admins”. Own-person download uses authenticated identity; other people's and customers' requests
  use `personal_data.export`, already declared by A980 S2c. It is the single inventory entry in §2.
- **Admin protection accepted 2026-10-22 ~12:05:** immutable preset identity, no deletion,
  conversion or grant narrowing, and at least one active human holder with usable dashboard sign-in.
  The answer also allowed rename. **That rename allowance is superseded on 2026-10-28 ~11:05**:
  none of the four built-ins may ever be renamed or deleted. The other protection decisions stand.
- **2026-10-28 catalog:** §2's non-fiscal merges and ordinary default sets are accepted.
  `sale.void`, `sale.refund` and `sale.rectify` remain three separate privilege IDs.
  No fiscal issuer, hash, numbering, filing or correction behavior changes are authorized.
- **2026-10-28 attendance:** new `workforce.self_approve`, Admin by default, is required together
  with `workforce.correct`. It has no tie to `person.admin` and gives Supervisors no new grant.
- **2026-10-28 context policies:** explicit role-ID lists remain restrictions intersected with action
  privileges. New and copied roles join no device or reason list automatically.
- **2026-10-28 membership and deletion:** a person may hold several roles. Delete a custom role
  by removing it from everyone and every device/reason/bill-limit list, with one impact confirmation,
  no replacement choices. What happens to a sole-role holder remains open in §11.
- **A1113 supersedes the mirror dashboard proposal:** owner 2026-10-26, restated 2026-10-28.
  Mirrors are to serve no dashboard; retire the built-in viewer through A1113. Its removal is
  blocked, not claimed built here. A1002 proposes no mirror reader role or viewer-session design.

§11 records the answer sources. These accepted sub-decisions do not approve the complete design.
The union and any-role matching interpretation below is the driver's inference, not the owner's words.

## 2. One permission review, before role storage

“Privilege” is the product wording; “permission” remains the code's word for its stable identifier.
This is the single inventory. `personal_data.export` already exists; retain it rather than creating
a second privacy/export permission. Own staff download is an authenticated own-person route, not
a grant to download other people's data. This design makes no legal findings.

Historical grants: **T** = Staff, Supervisor, Manager, Admin; **S** = Supervisor, Manager, Admin;
**M** = Manager, Admin; **A** = Admin. These abbreviate seed sets, never a hierarchy.
The owner approved the non-fiscal target names and ordinary default sets on 2026-10-28.
Each ordinary role has explicit grants; changing Supervisor changes no other role.
Protected Admin holds the entire declared catalog under §3.

Historical inventory sources: **C** = `packages/identity/src/permissions.ts:5` (catalog), `:45`
(Staff), `:46` (Supervisor), `:57` (Manager), `:78` (Admin); module sources appear in their rows.
“Keep” retains identifier and default set. The `personal_data.export` row uses the separately
dated current reading in §7. Admin receives every retained or new declared entry.

| Current identifier                      | Current grants/source                            | Accepted identifier and default grants    | Reason / boundary                                                                                           |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `sale.take_payment`                     | T, C                                             | `payment.take`, T                            | Shorter domain/action name; keep payment ability on all four defaults.                                      |
| `sale.void`                             | S, C                                             | Keep, S | Keep cancellation authority separate; retain action and state conditions. |
| `sale.refund`                           | S, C                                             | Keep, S | Keep refund authority separate, including device and payment-state conditions. |
| `sale.discount`                         | S, C; comment says no call site                  | Retire; explicit adjustment privileges below | Separate application and approval privileges carry adjustment authority.                                   |
| `sale.rectify`                          | S, C                                             | Keep, S | Keep rectification authority separate; fiscal issuance rules stay unchanged. |
| `person.manage`                         | M, C                                             | Keep                                         | Employment and ordinary staff details, not another person's sign-in or privileges.                          |
| `catalogue.manage`                      | M, C                                             | Keep                                         | Includes the accepted image-management merge.                                                               |
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
| `personal_data.export` | A, current reading receipt below | Keep, A | Already declared by A980 S2c; own staff download needs no such grant. |
| Attendance's named Admin exception      | `packages/workforce/src/corrections.ts:361`      | New `workforce.self_approve`, A              | Require this AND `workforce.correct`; keep the exception confined to attendance.                            |
| Adjustment application role lists       | `packages/adjustments/src/policy.ts:142`         | New `adjustment.apply`, T                    | Necessary for direct comps/discounts, additionally restricted by each reason.                               |
| Adjustment approval role lists          | `packages/adjustments/src/policy.ts:185`         | New `adjustment.approve`, S                  | Necessary for reason/bill-limit approval, additionally restricted by that policy.                           |

These merges keep identity, personnel, reporting and sales distinct. Do not merge `person.admin`
into `person.manage`, or privacy exports into `report.export`. The historical retry gate is
`apps/server/src/print-api.ts:1505`; Orders receipt copies enter through
`apps/server/src/orders-api.ts:281`. Trace both final paths before changing either.

The three sale privileges remain separate. There is no queued fiscal merge or fiscal-merge gate.
Finish the accepted catalog consistently across consumers before enabling editable roles; no runtime
alias or compatibility layer is proposed. Fiscal behavior and protected fiscal evidence remain
outside this documentation revision.

## 3. Explicit roles and several memberships, without a ladder

**Owner decision:** you may assign several roles to one person. **Driver's proposed interpretation:**
effective privileges are the union of the explicit grants on every held role. There is no primary
role, inherited ordering, deny grant or person-specific privilege override. Duplicate grants count
once; role order changes nothing. An ordinary role may have no grants.

Policy membership and privileges are independent gates. For an explicit role list, any held role
may match; the required privilege may come from another held role. A matching role without the
privilege fails, and a privilege without a policy match fails. Existing person exceptions and
eligibility still apply to device admission; profile action and zone restrictions still apply to
till actions. An explicit person exception never grants an action privilege. Preserve explicit
person-denial precedence for eligible role holders. §6 defines the no-role candidate separately.

Example: Ana's Service lead grants `adjustment.approve`; her Evening team role is on a complaint
approver list. Together they satisfy both gates. Removing Evening team stops that contextual
approval even if her privilege union is unchanged. Creating or copying a role inserts it into no
list. Selecting all roles known today stores those IDs only. This proposal adds no “all future
roles” mode or default bypass. When replacing the old empty-list “every” representation, seed the
intended existing preset IDs explicitly; an empty selected list means nobody, subject only to
existing explicit person exceptions, never an automatic all-roles fallback.

Each role has an opaque stable ID, revision and explicit permission-ID set. All four built-ins
also have immutable preset keys and translated names. Staff, Supervisor and Manager have editable
grants but cannot be renamed, deleted or converted to custom roles. Admin additionally cannot have
its grants narrowed. Its immutable identity supports catalog maintenance and integrity checks,
never an action-authorization shortcut.

Only custom names are typed, trimmed, nonempty and unique under the existing Unicode folding
convention (historical `packages/identity/src/staff.ts:236`). A custom label never confers built-in
identity or authority. Copying any preset creates an ordinary custom role with a new
literal name and current grants only: no preset key, future automatic grants, people or context
list entries. Boot preserves edits to ordinary built-in grants and custom roles; seed completion
is stored separately.

Replace `ModulePermission.grantedFrom` (historical `packages/module/src/module.ts:110`) with a
declaration plus explicit default preset keys. Workforce correction names Supervisor, Manager and
Admin individually. The contract owns that finite key vocabulary; runtime `RoleId` is a distinct
type. Replace `packages/composition/src/role-parity.ts:5` with two-way type assertions for the seed
and declaration contracts identity accepts. Keep existing dependency direction. Reject duplicate
ownership, unknown default keys and undeclared grants. No `indexOf` or implied ordering remains.
Historical boot ladder readings: `apps/server/src/boot.ts:885`, `packages/identity/src/permissions.ts:104`,
`apps/server/src/modules.ts:32`.

Propose atomic provisioning of the catalog, built-ins and first active human with usable dashboard
authentication whose membership set contains canonical Admin. Setup establishes initial authority;
authenticated mutations cannot bypass the rule against granting unheld privileges.

Propose that the authorized primary materializes every declared Admin grant in one transaction
before accepting ordinary requests, leaving other grants unchanged. Validate catalog ownership
and built-in integrity; incomplete installation refuses ordinary role-dependent access.
Recovery and status surfaces remain available to explain a refused start.
Checks read current database grants and reject undeclared permission IDs, including for Admin.
Disabled-module privileges remain visible and granted, labelled unavailable; enabling changes
availability, not saved grants. A later declared privilege reaches Admin alone automatically.

Synchronization, fenced-node write refusal, catalog compatibility and promotion ordering belong
to A1113 and the node work. A1002 requires replicated membership/grant revisions to stay coherent,
no reconciliation writes without primary authority, and a compatible complete catalog before a
promoted primary accepts ordinary role-dependent requests. This is a proposed integration constraint,
not a claim about current mirror behavior or permission to implement node work.

## 4. Storage and references, with schema deferred

Propose IDENTITY-owned `state` tables for roles, catalog, grants, seed completion, person-role
memberships and authority revisions, with classification and change sources. Replace the required
single `persons.role` enum with a membership relation unique on person ID and role ID. A person
can have several membership rows; the empty-set constraint depends on §11. Keep one person identity,
status and authentication record, not one per role. No tenant column.

Use declared TypeScript keys/constraints and generated migrations. Prefer relational policy role
references to JSON lists so deletion and transfer can enumerate every reference. Live membership
and policy keys restrict deletion until the command removes those references. Never cascade-delete
people, credentials, sessions or historical decisions through a role. Keep tokens hashed and
cryptographic custody unchanged (historical `packages/identity/src/classification.ts:13`).

Store a membership revision per person. Every membership addition/removal advances it, including
a change between roles with identical grants: context admission may differ. Grant/catalog changes
also advance affected effective-authority revisions, and policy changes advance their own revisions.
Authorization uses current rows and policy; equal privilege unions do not establish equal authority.

Snapshot the complete membership IDs/labels and relevant grants/policy on new audited decisions,
not a chosen representative role. Preserve original actor/authorizer IDs and old snapshots on
attendance, adjustments, sales, payments and print records. Custom rename/deletion never relabels
old approvals; `packages/adjustments/src/policy.ts:191` is the historical policy-snapshot receipt.
No history rewriting or shipped migration edits.

Recommend pre-live reset delivery for the initial storage replacement, separately from later catalog
additions that need no reset. Before a generated rebuild, enumerate incoming keys and declare the
reset in the later approved plan. No executable schema or compatibility conversion is authorized here.

## 5. Mutation rules that prevent indirect grants

Propose that current `person.admin` admits role administration and the minimum person lookup it
needs, without `person.manage`. Ordinary employment edits retain `person.manage`. A stale full-body
staff edit must not overwrite membership; use a separate membership mutation with its own revision.
Other-person sign-in changes need `person.admin` plus the whole-target checks below. Self-service
security flows keep their identity/proof checks.

For each mutation, use ONE `withTransaction`. Re-resolve actor status, complete membership union,
target/result sets and revisions inside it. Validate, write, invalidate affected proofs, then check
the final protected Admin invariant before commit. Queries run in turn. The serialization proposal
uses `withTransaction`/`withWriteLock` (historical `packages/db/src/tenancy.ts:30`).

| Operation | Proposed authority and final-result checks |
| --- | --- |
| Create/copy role | Actor holds `person.admin` and every selected/copied privilege. No preset metadata, people or context memberships copied. |
| Edit role grants | Actor holds each added privilege. Removals may narrow grants the actor lacks. Recompute every holder's union and authority revision; preserve all built-in keys/names and Admin's complete grants. |
| Assign/edit membership, invite or reactivate | Require `person.admin`. The WHOLE resulting person's union, including retained memberships, must be within the actor's current whole-person union. Check context gains separately even when unions are equal. No self-promotion or representative-role comparison. |
| Change another person's sign-in/status | Require `person.admin` and dominance over the target's whole current union, preventing takeover through another role. Covers email, PIN/password reset, invitation, suspension/reactivation and MFA/passkey/Google removal. |
| Delete custom role | Require `person.admin` and domain configuration authority for referenced policies. Remove references under §6; no reassignment. Pure removal does not require holding grants being removed. If §11 chooses Staff fallback, check the entire resulting union and contextual gains before any addition. |
| Edit device/reason/bill-limit policy | Require its configuration privilege; enabling apply/approval access also requires the corresponding action privilege. Check gains for complete person memberships; policy selection cannot grant a missing privilege. |

Example: Marta holds `person.admin` but lacks `system.manage`. She cannot add a narrow role to a
person whose retained role grants system administration, then reset that person's login using only
the narrow role as her comparison. She cannot copy Admin intact or assign it to herself. She may
remove a custom role without acquiring its grants, subject to domain-policy authority and §6.

**Accepted last-human anchor; proposed shared enforcement:** count DISTINCT active usable human
persons whose membership set CONTAINS canonical Admin. Count a person once, however many roles or
authentication methods they hold. They need an enrolled supported usable dashboard method and
access to role administration. PIN-only, pending, suspended or unusable people do not count.
A custom holder with every current grant cannot replace this future-grant anchor.

Apply the serialized final-state check to all person, role, catalog, import, status and authentication
mutations: bulk assignment, the replacement for `setRole`, both suspension functions, account reset
to pending, method removal and recovery. A transaction may remove the last person's Admin membership
only if another usable active human contains Admin in the final state. Role counts or join-row
counts do not prove this. Replacing the last holder's sign-in method must leave one usable method.
Recovery selects an existing `person.admin` holder explicitly and changes no memberships/grants.

Optimistic revisions refuse stale writes while retaining the draft. Reordering an unchanged set
is a no-op; any actual membership change advances revision even when effective grants are equal.
A committed action stays history; one waiting for the write turn authorizes again after acquiring it.
Role/policy previews compare complete before/after memberships, effective unions and context access.

Administrator-issued invitations, recovery and email-change actions bind issuer and target membership/
effective-authority revisions. Every membership change and affected grant/catalog change invalidates
unused proofs. Redemption checks current target memberships, active issuer `person.admin`, target's
whole union within issuer's union, current policy/status and last usable Admin. Reissue produces a
fresh proof. Policy revisions are rechecked for context-dependent operations. No old Admin snapshot
or invitation role field carries authority.

Self-service recovery and email changes have no administrative issuer requirement. They cannot
change membership or grants, still check current status/revisions and preserve the Admin anchor.
A stale proof cannot restore a removed role; refresh/restart the identity flow against current rows.
Pending people gain no session authority; invitation completion is atomic against current rows.
Historical proof machinery: `packages/identity/src/account-action.ts:62` and `:296`.

## 6. Deleting a role in use

**Accepted:** delete only custom roles, remove their memberships and all live role-list references,
show the full impact and confirm once. Every built-in is undeletable regardless of holder count.
There is no replacement selector, policy substitution or grant transfer.

The preview enumerates active, pending and suspended people, their retained roles, privilege losses,
remaining context access, affected device admission, reason apply/approval and bill-limit lists.
Show sole-role holders separately as pending §11's choice. Show lists becoming empty as
“Nobody through roles” or “Approval blocked”; retained device person exceptions are listed explicitly.
An empty list never becomes all roles. If an approval path requires a nonempty eligible set, keep
the policy present but blocked: requests needing that approval remain refused until a separate
authorized policy edit supplies eligible approvers. No automatic substitute or deletion-time
replacement workflow is proposed.

Recompute impact and revisions inside one transaction. Remove memberships and every live reference,
remove the role/grants, advance affected membership/authority/policy revisions, invalidate unused
proofs and check the final Admin invariant. Refuse a changed preview or unauthorized result; any
refusal rolls the entire operation back. Retain historical authorizers and snapshots.

Example: Ana holds Staff and Evening lead; Luis's pending invitation names only Evening lead.
Deleting Evening lead leaves Ana's Staff membership and removes the role from each policy.
Luis's resulting state waits for §11; his old invitation cannot restore Evening lead.
If the complaint approver list becomes empty, complaints needing approval remain blocked.

**Open sole-role outcome, not decided by this draft:**

- **Recommend no role:** keep the person's identity/status and credentials. An otherwise eligible
  person can authenticate only for own identity/security/data self-service. They have no role grants,
  action authority, device/reason/list authority, approver eligibility or administrator-recipient
  authority. A person exception cannot turn this state into staff admission. Show “No role” and let
  a separate authorized membership edit restore work access.
- **Alternative Staff:** add canonical Staff membership, subject to §5's whole-result and context
  checks. Its actual saved grants may differ from the default; its device/reason memberships may
  grant context access even where the privilege union is unchanged. Preview those gains and refuse
  if unauthorized. Never assume Staff is empty or harmless.

Both choices require revised proofs and fresh authority reads. Deletion removes exactly the selected
role from multi-role holders; it never adds Staff to people who retain another role. Neither option
is treated as owner-approved until §11 is answered.

## 7. Replacement audit: follow each consumer to its meaning

This table preserves the historical source trace at `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`,
reading only. Proposed replacements are revised 2026-10-28 for complete membership sets.
The superseded mirror-principal row is removed; A1113 owns its retirement, as stated in §9.

| Consumer and current source                                                                                                                                                                                                                         | Proposed replacement / fact to retain                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder/catalog, `packages/identity/src/permissions.ts:43`, `:104`; module contract `packages/module/src/module.ts:104`; composition `packages/composition/src/role-parity.ts:5` | Role IDs, membership sets and database grants; explicit preset seeds and contract tie (§3). Primary reconciliation fills canonical Admin only; no seniority or undeclared-permission shortcut. |
| Staff target-role checks, `packages/identity/src/staff.ts:210`, `:259`, `:502`, `:507` | Compare the actor and target/result WHOLE privilege unions across all memberships. Membership edits require person.admin and advance revision even for equal grants; invalidate affected proofs. |
| Last Admin queries, `packages/identity/src/staff.ts:193`, `:271`, `:315`; alternate mutators `:497`, `:567`, `:579` | Shared serialized final-state check counts distinct usable active humans whose membership set contains canonical Admin. Additional role rows never inflate the count; no helper bypass. |
| Sign-in takeover boundary, `packages/identity/src/staff.ts:131`, `:233`, `:395`; server routes `apps/server/src/management-api.ts:1125`, `:1209` | Retain A998/A1000 and compare the target whole union, including every retained role. person.manage alone never invites, changes sign-in, resets or reactivates another person. |
| Dashboard sessions, `packages/identity/src/management-session.ts:60`; manager authorization `packages/identity/src/manager-login.ts:162` | Resolve active human, all memberships and current grants per request. Return request-local role IDs, union and revisions; no selected-role authorization. |
| Till/session and PIN authorization, `packages/identity/src/authorize.ts:43`, `:74`; `apps/server/src/till-session.ts:99`; `packages/identity/src/credential.ts:43` | Resolve live status, all memberships, union and profile admission in the action transaction, including routes without a permission option. Old PIN results confer no old authority; apply §6 if membership is empty. |
| Early PIN preparation, `apps/server/src/pin-check-ahead.ts:55`; refund confirmation `apps/server/src/bill-refunds.ts:696`, `apps/server/src/tender-refund-authorization.ts:144` | Early reads use the whole union only to prepare costly credential work. Final actions re-read membership, policy and grants. Retain outside-transaction hashing, throttles and generic refusals. |
| Approver lists, `packages/identity/src/staff.ts:613`, `:621`; query parser `apps/server/src/adjustments-api.ts:88` | Return each active eligible person once, testing union privilege AND any-role policy match. Never accept client role IDs as authority. Recheck on PIN submit after list or membership/policy changes. |
| Attendance views, `apps/server/src/management-attendance-api.ts:206`, `apps/server/src/till-attendance-api.ts:226` | Compute canSelfApprove from the whole union containing BOTH workforce.correct and workforce.self_approve, even across two roles. person.admin alone does not suffice; picker and write agree. |
| Attendance domain, `packages/workforce/src/corrections.ts:35`, `:42`, `:252`, `:360`; `packages/workforce/src/attendance-response-commands.ts:119` | Replace MANAGER_ROLES and named Admin exceptions with whole-person privilege checks. Preserve own subject/requester, direction and approve-only limits, including refusal to decline your own request. Stored author-kind remains historical. |
| Adjustment decisions, `packages/adjustments/src/policy.ts:142`, `:171`, `:185`; `apps/server/src/adjustments-apply.ts:558`, `:770` | Use whole union for adjustment.apply/adjustment.approve and any held role for the applicable reason/bill list, as independent gates. Preserve sale.refund cancellation checks, stages, amounts and policy limits. |
| Adjustment policy/storage/seeds, `packages/adjustments/src/schema/reasons.ts:42`, `packages/adjustments/src/schema/settings.ts:6`, `packages/adjustments/src/provisioning.ts:6` | Resolve preset seed keys to IDs. Keep Complaint S, On the house M, Staff meal T with 50% limit and M approval, Discount M. No new/copied role joins lists. Delete references explicitly; empty approval is blocked. |
| Adjustment client seniority, `packages/adjustments/src/dashboard/reasons-screen.ts:43`, `:94`, `:1251`; client union `packages/adjustments/src/dashboard/client.ts:9`; till text `apps/till/src/widgets/adjustment-dialog.ts:112` | Replace hardcoded role lists/order with catalog IDs, localized label sorting and set equality. Edit role-list restrictions and preview complete person unions; selected current IDs never mean future roles. |
| PIN prompt wording, `apps/till/src/widgets/supervisor-override-dialog.ts:76`, `:115` | Describe required action/policy and actual eligible people, each once. Remove the default supervisor authority claim; custom role names are literal, never translation keys. |
| Device admission, `packages/identity/src/profile-admission.ts:15`, `:50`, `:181`; schema `packages/identity/src/schema/profile-admission.ts:9` | Any held role may match the explicit set, with existing person exceptions and status/eligibility checks. Profile actions/zones AND union privileges still bound actions. Replace empty/every sentinel; deletion cannot open admission. No-role candidate follows §6. |
| Dashboard forms/filter/labels, `apps/dashboard/src/widgets/person-form.ts:291`, `widgets/person-edit.ts:332`, `screens/staff-screen.ts:376`, `i18n/domain.ts:147`; unions `apps/dashboard/src/api/client.ts:336`, `apps/till/src/api/client.ts:904` | Multi-select roleIds, display every membership, sort translated built-ins/literal customs by locale and filter by held ID (any selected match). Include an explicit No role filter if approved. No hardcoded Staff fallback. |
| Shell and permission projections, `apps/dashboard/src/dashboard-app.ts:1178`, `apps/server/src/me-api.ts:331`, `apps/server/src/till-api.ts:1426`, `apps/server/src/alerts-api.ts:46` | Return roleIds, whole-person privilege union and membership/catalog revisions. Refresh passively on changes/refusals; navigation is presentation. Delayed updates cannot retain server authority. |
| Scheduling/workforce/reporting, `apps/server/src/workforce-api.ts:35`, `packages/staffing/src/routes.ts:194`, `apps/server/src/attendance-export-api.ts:45`, `apps/server/src/orders-api.ts:145` | Use accepted catalog names and whole unions. Preserve own-person exports and Orders non-report scope. Staffing job roles remain separate domain objects. |
| Other direct lookups, `packages/venue-service/src/routes.ts:703`, `apps/server/src/email-settings-api.ts:50`, `apps/server/src/email-inbox-api.ts:39` | Replace roleHasPermission with current whole-person grants, retaining default-setting and sign-in-mail conditions under accepted catalog names. |
| Provisioning/recovery, `packages/provisioning/src/venue-apply.ts:196`, `packages/provisioning/src/recover-provisioned-venue.ts:46`; CLI `apps/server/src/break-glass-command.ts:94` | Seed canonical built-ins/catalog and a usable active human containing Admin. Resume checks recorded identity/current whole union and protected integrity. Recovery chooses an existing person.admin holder, changes no role, and keeps the anchor. |
| Transfers, `packages/identity/src/configuration-transfer.ts:1`, `packages/adjustments/src/configuration-transfer.ts:34`, `packages/provisioning/src/configuration-transfer.ts:700`, `:724`, `:737` | Export definitions, grants, every membership and live policy reference; never login secrets/sessions. Remap all role IDs, including canonical references, before union/impact checks. Imported people stay suspended; reactivate against whole current target unions. |
| Automatic work, `apps/server/src/certificate-reminder-worker.ts:62`; authenticated operations `apps/server/src/operation-authentication.ts:87` | Select eligible recipients once per person from live whole unions; recheck actor-bound pending operations on execution. Service duties use explicit authority/current mode, never synthetic human roles. Committed fiscal/outbox duties retain existing authority. |
| Fixtures and constraints, `packages/identity/test/fixtures.ts:57`, `apps/server/scripts/demo-seed/staff.ts:18`, `packages/identity/src/schema/persons.ts:6`, `:76` | Seed roles/grants before membership rows. Include two-role and no-role candidates, fixed built-in names, changed ordinary preset grants, custom IDs and shared grants. Replace singular enums/API fields; preserve status and behavioral assertions. |

### Bounded current-source additions, reading only, 2026-10-28

These readings use `e0f3e261c3811333d91db376fcab900eab216151`, independently of the historical table.
They do not establish runtime behavior or complete the later implementation audit.

| Reading receipt | Proposed consequence |
| --- | --- |
| `packages/identity/src/permissions.ts:18`, `:78`, `:84` declare `personal_data.export` and include it in Admin's full catalog set. | Keep the one existing §2 entry. No unlanded O5 placeholder or second export permission. |
| `packages/identity/src/personal-data.ts:29`, `:42` selects a singular role into profile output. | Export the complete membership set with role IDs/labels, including empty if approved. This is personal-data output, not configuration transfer or a live authority snapshot. |
| `apps/server/src/personal-data-export-api.ts:117`, `:123` and `:136`, `:145` separate own identity from another person's privileged export; `apps/server/src/invoice-customer-data-api.ts:57` requires the same privilege. | Resolve whole-person authority for privileged exports; preserve own-person identity access and customer-route scope. No new privilege or broader search authority. |
| `apps/server/src/manager-email-recipients.ts:13`, `:22`, `:33` filters active people with email by singular-role `system.manage`; called by `certificate-reminder-worker.ts:60` and `box-alert-email.ts:153` under `apps/server/src/`. | Select on the whole union at execution, retain active/email/language checks and return each human once. No role means no privileged recipient eligibility. |
| `packages/identity/src/profile-admission.ts:28`, `:54`, `:111` reads empty as every and gives explicit person exceptions precedence. | Replace that sentinel explicitly; retain exception precedence for eligible role holders. Lists and unions remain independent gates; §6's no-role candidate cannot acquire staff authority through an exception. |
| `packages/provisioning/src/venue-apply.ts:99`, `:371`, `:374`, `:500`, `:548` queries singular Admin membership for setup ordering, the initial module operator and profile seeding. | Use the recorded initial human ID and complete membership set for setup integrity. Resume checks current whole-person grants; domain actions use privileges, never a label or an arbitrary first matching role holder. |

### Imports and complete API/client shapes

For configuration transfer, export roles/grants, every person-role membership and device/reason/
bill-limit reference. Remap each membership and list reference, including IDs inside any retained
JSON, before checking authority. Do not trust a generic whole-value remapper to rewrite JSON lists.

Keep exactly one target canonical role for each built-in, including Admin, using immutable keys,
never display names. Preserve target names/keys, Admin's full target catalog and a usable human
anchor. Do not replace that human with imported people. Source ordinary built-in grants may replace
their target grants only through an explicit preview of all retained holders and §5's checks;
never union source/target role definitions or assign preset identity to a custom role. Resolve
custom-name collisions by explicit import naming. Source built-in names are not rename inputs.

Validate the supported bundle schema, canonical metadata, declared grants and all references;
refuse ambiguous markers or unresolved IDs. Structural validation proves no authorship or provenance.
Even a well-formed edited bundle grants nothing without current actor authority. Require
`person.admin`, each imported ordinary role's whole grants within the actor's union, and the whole
resulting unions for affected retained people. Preview contextual gains even for equal unions and
include domain configuration/action checks. Recheck revisions, proof invalidation and distinct
usable Admin count in the one import transaction; any refusal rolls back all changes.

All imported people, including every member whose set contains mapped Admin, stay suspended and
do not count as the anchor. Invitation/reactivation compares their whole CURRENT target union with
the actor's current union, including privileges added since export/preview. No source credential,
single selected role or stale proof provides an alternate grant path.

Propose singular-role replacement throughout HTTP DTOs, validators, domain inputs, clients, sessions,
login/credential results, Staff lists, approver responses and personal-data output:
`roleIds: RoleId[]` plus catalog display metadata. Request-local authority also carries the union
and membership/effective-authority revisions. An assignment sends the complete intended set with
its revision; reject duplicates, unknown IDs and explicit null. Compare sets without ordering.
There is no authoritative `role`, first element, most senior role or optional-field Staff default.
An absent membership field on an ordinary employment edit means leave membership alone.
No-role response shape is `roleIds: []` if §11 approves it; reject operational authority from it.

## 8. Dashboard flow, text wireframes only

Propose People / Roles beside Staff at `/manage/roles`, reachable with `person.admin` alone.
Staff editors with only `person.manage` may read the role labels needed for Staff; full editing
belongs on Roles. The direct URL has the same server gate. Keep access roles distinct from staffing
job roles. Show distinct person counts per role, not summed membership counts.

```text
Roles                                             [Add role]
[Search roles]
Name            People   Privileges                 Actions
Admin               1    All, including future      View / Copy
Supervisor          4    Selected                   Edit privileges / Copy
Service lead        3    Selected                   Edit / Copy / Delete
Built-in names are fixed and translated. Built-ins cannot be deleted.

Admin
Name: Admin (fixed)
Every current and future declared privilege. Grants are read-only.
Keep one active human holder with usable dashboard sign-in.
[Close] [Copy]

Edit Service lead
Name * [Service lead]
Privileges [Search]
Service: [x] Take payments [x] Void [x] Refund [x] Rectify [ ] Open drawer
People: [ ] Manage staff  [ ] Manage sign-in and privileges
Attendance: [x] Correct attendance [ ] Approve own corrections
Used by Ana, Luis, Sam. Preview each person's other roles and final access.
[localized form message above actions]
[Cancel] [Delete]                                      [Save]

Ana / Access roles
Roles [Staff] [Service lead] [Choose roles]
Result: combined privileges, plus device/reason restrictions.
Removing Service lead loses refunds only if no retained role grants them.
[before/after memberships, privileges and context access]
[Cancel]                                              [Save]

Delete Evening lead
Ana: retains Staff; listed privilege and context losses.
Luis (pending, sole-role holder): outcome awaits the owner's §11 answer.
Remove from: Front till admission, Complaint approvers, Bill-limit approvers.
Complaint approvers becomes empty: approvals blocked.
Past authorizers and snapshots stay unchanged. Old invitations invalidated.
[localized form message above actions]
[Stop]                                          [Delete role]
```

There is one deletion confirmation and no replacement input. Final sole-role wording and previews
depend on §11; the pending wording above is a design placeholder, not a shipped user flow.
Membership filters match any selected held ID and list each person once. Show all roles on Staff,
profiles and approver displays. A role edit/deletion preview computes each person's final union and
context access, including grant retention through another role and equal-union membership changes.

Use existing `wt-data-table` with end-pinned actions, `wt-row-actions`, `wt-input`,
`wt-combobox` multi-selection, `wt-switch`, `wt-dialog` and `wt-form-actions`. No screen-owned
native fields. Add/Edit/Copy and membership drafts use `draftScopeFor`, `saveActionState`,
unchanged-handler return and set comparison. Preserve unsaved navigation/Cancel/Escape protection.
Saves start quiet/disabled; invalid input marks fields and gives one localized footer message.
A server refusal alone leaves retry available. Close after a successful write, then refresh
separately; a failed refresh is a load failure. Busy dialogs prevent dismissal.

Passive authority updates refresh labels/counts and membership/catalog revisions without overwriting
dirty input. On authority loss retain the draft, explain why save is refused and offer discard/reload.
The server uses current authority even if passive updates are late. Copy requires a new custom name,
previews any ungrantable privilege and explains that no future grants or context lists are inherited.
Built-in editors show fixed names; Admin shows read-only grants. Server checks also refuse rename,
deletion, conversion/key changes and Admin narrowing.

Translate interface/help/messages EN/ES; custom names stay literal and built-ins always translate.
Explain refusals in plain language: “You cannot grant a privilege you do not hold”, “Keep at least
one active Admin holder who can sign in to the dashboard”, “Built-in roles cannot be renamed or
deleted”, and “This role changed while you were editing”. Mark affected fields, put the message
above actions and offer an eligible administrator sign-in when needed.
Update English and existing Spanish guides with shared heading IDs and app `help-guide.ts` links.

At phone width, wrap names and effects with reachable footer buttons; require no horizontal scroll
to understand deletion impact. Use declared `--wt-*` tokens, semantic field names and shared
keyboard/focus behavior. This wireframe is text only. No visual review or UI approval is claimed;
later implementation must be inspected in light/dark, EN/ES, phone/desktop.

## 9. Boundaries before any plan or build

Resolve §11's sole-role question, incorporate the answer, then obtain separate approval of the
complete revised design. No plan/build authority follows from this revision or a settled sub-decision.
Catalog defaults are settled; union semantics, schema, transactions, proof mechanics, import behavior
and interface remain proposed for that full review.

A later approved plan must cover the whole authority transition: catalog consumers, membership
storage/provisioning, live checks and proofs, deletion/references, transfer, clients/UI/guides and
service-duty recipients. Do not enable editable authority with a remaining single-role or name
bypass. Retire misleading current prose during implementation, including the permanent permission-name
claim at historical `packages/identity/src/permissions.ts:1`; audit the complete changed prose path set.

The original needed service-duty treatment stays: explicit service authority and current node mode,
without synthetic human roles or reauthorizing already committed fiscal/outbox facts as a former
employee. A1113 owns mirror dashboard/viewer removal; other node work owns synchronization and
promotion. A1002 defines only the compatibility constraints in §3. It adds no mirror role, UI,
scoped-reader grants or tokens, and does not claim that retirement has landed.
The root backlog still carries an A1111 proposal; the owner's later A1113 decision supersedes it
for this design. That unrelated backlog row is outside this revision's permitted edit scope.

## 10. Acceptance evidence the later build must produce, test first

These are future acceptance requirements, not results from this documentation revision.

- Use real database cases with two independent roles, overlapping grants, zero-grant roles and
  role order changes. Prove union authorization and separate any-role policy matching, including
  a privilege from one role and a policy match from another. Neither gate alone suffices.
  Removing a role with equal grants still changes membership revision and contextual access.
  Never choose the first/most senior role or add per-person privilege overrides.
- Refuse rename/deletion/conversion/key changes for all built-ins and narrowing of Admin.
  Ordinary built-in grant edits change no other role. Copy every preset as a custom role without
  preset identity, future grants or list memberships. A later privilege reaches Admin alone.
  Custom labels convey no authority, and disabled-module availability does not alter saved grants.
- Exercise dashboard/till sessions, both PIN authorizers, early credential preparation followed
  by revocation, approver lists followed by membership/policy changes, and routes with no explicit
  permission option. Recheck live status, full membership union, admission and action/profile limits.
  Reject pending/suspended humans and duplicate approver/recipient entries.
- For every §5 mutator, assert the domain refusal and unchanged roles, memberships, grants, references
  and proofs. Prevent adding a narrow role to conceal a stronger retained role during assignment,
  invitation/reactivation or other-person login takeover. Include self-membership changes, stale
  full-body employment writes, and context gains with identical privilege unions.
- Compete two transactions removing Admin membership or suspending/resetting the last two usable
  active humans. Exactly one may commit. Count distinct humans, not memberships/methods.
  A PIN-only Admin, pending person or custom all-current-grants holder cannot replace the anchor.
  Exercise method removal, recovery and import through the same check, with same-transaction
  replacement allowed only when another usable active human containing canonical Admin remains.
  Read committed rows; deletion of the shared check must fail the retained behavioral assertions.
- Delete a populated custom role across active/pending/suspended people and every device/reason/
  bill-limit reference. Assert only that membership is removed from multi-role holders, history
  stays, empty lists do not become all, blocked approvals are refused and proofs are invalidated.
  Force a final refusal and read back complete rollback. Test the sole-role outcome ONLY after
  §11 chooses it: no-role means identity-only self-service with no operational/list/exception
  authority; Staff fallback must pass whole-result grants and contextual-gain checks.
- Administrator-issued proofs recheck issuer/target whole unions and revisions. Membership changes
  with equal grants invalidate unused proofs. Self-service recovery/email changes need no admin
  issuer, grant no memberships and cannot revive deleted roles or remove the last usable Admin.
- Attendance self-approval requires both workforce privileges, even when held through separate
  roles; neither `person.admin` nor either workforce privilege alone suffices. Preserve subject,
  requester, direction and approve-only limits, including own-decline refusal, in HTTP and commands.
  Preserve adjustment thresholds, fired/served cancellation `sale.refund` checks and snapshots.
  Keep `sale.void`, `sale.refund` and `sale.rectify` separately effective; no fiscal behavior change.
- Provision and boot with fixed built-in names, ordinary built-in grant edits and custom deletions.
  Reconciliation installs complete Admin grants before ordinary access, advances affected revisions
  and rolls back incomplete installs. Unknown strings never authorize. Validate compatible
  replicated membership/catalog state and primary-only writes at the integration boundary owned
  by node work; do not build a mirror dashboard or viewer test suite for A1002.
- Transfer every membership/reference with target ID remapping. Keep one canonical target per
  built-in and its fixed identity, Admin's full target grants and usable active human.
  Imported people stay suspended. Refuse hostile markers, unresolved JSON/reference IDs, unknown
  grants, source/target grant unions, unauthorized retained-holder gains and stale activations/proofs.
  Reactivation uses all current target memberships. Verify personal-data output lists all held roles,
  and automatic email recipients are distinct eligible humans selected by current union.
- Browser/API checks cover role arrays, duplicate/unknown/null refusals, complete member labels,
  any-selected filtering, locale sorting, one deletion confirmation, built-in fixed-name controls,
  draft retention, leave protection, duplicate saves, late refreshes, keyboard focus and messages.
  Inspect long names and removal impacts at phone width in both themes; run relevant accessibility
  checks. Preserve existing behavioral assertions and compile-time rejection of invalid preset keys.

## 11. Accepted decisions and the remaining approval sequence

The receipts below record owner decisions, not approval of the driver's complete design.
**G archive** = `~/waitron-campaign-g/archive/questions-to-2026-10-23.md`.
**F answers** = `~/waitron-campaign-f/questions.md`, the named OWNER ANSWER sections near the end.
The earlier permission-review and custom-role decisions remain recorded in the dated discussion at
`docs/backlog/dashboard.md`. No settled choice is queued again.

| Owner decision | Receipt and effect on this revision |
| --- | --- |
| One `person.admin`; privileges determine actions; nobody grants an unheld privilege | 2026-10-22 ~06:35 decision retained in G archive's A1002 07:07 entry; ~08:40 OWNER ANSWER retains the grant rule. Applies to custom holders and whole-person unions. |
| Admin has every current/future declared grant | G archive, OWNER ANSWER question 1, 2026-10-22 ~08:40. No reset/first-grant question remains. |
| Immutable Admin key, no deletion/conversion/narrowing, usable active human anchor | G archive, OWNER ANSWER Admin protection, 2026-10-22 ~12:05. Its “can be renamed” allowance is historical and superseded by F Names on 2026-10-28. Other protection stays accepted. |
| Non-fiscal catalog/defaults accepted; retain the three sale IDs | F Catalog, 2026-10-28 ~10:50. No sale-merge alternative or queued fiscal gate remains. |
| `workforce.self_approve` plus `workforce.correct`, Admin default | F Attendance, 2026-10-28 ~10:52. No `person.admin` tie or extra Supervisor grant. |
| Lists restrict actions; new/copied roles join none | F Context policies, 2026-10-28 ~10:54. No inherited context memberships or future-role bypass. |
| Several roles per person; removal-only deletion | F Deletion and membership, 2026-10-28 ~11:00: “Just delete the role, no need to replace things” and “Users can have more than one role.” Union/any-role matching is the driver's inference; sole-role outcome is unanswered. |
| All four built-ins never renamed/deleted; other built-in grants editable | F Names, 2026-10-28 ~11:05: “Built in roles should not be renamed or deleted.” Supersedes the earlier rename allowance; built-in labels always translate. |
| No mirror dashboard; built-in viewer retirement belongs to A1113 | F OWNER DECISION A1111 withdrawn, 2026-10-26 ~04:25; restated under F Names, 2026-10-28. Retirement remains blocked; no new mirror role is proposed. |
| Own staff download; separate privilege for other people's/customer data | Owner A980 O5 ~03:45, 2026-10-22, retained in §1. Existing `personal_data.export` is reconciled by §7's current reading, not a new owner question. |

### First, publish only the sole-role deletion question

**When you delete someone's only role, should they be left with no role or assigned Staff?**
Recommend **no role**, because deletion should not grant unchosen rights. They retain authenticated
own-identity self-service, with no work/action/list authority. **Staff** is the alternative; its
saved grants and context memberships can add access, so the preview and authority checks apply.

This is the only open sub-decision. The driver publishes this question, records the answer and
updates §4/§6/§8/§10 accordingly. This authoring turn does not ask or answer it.

### Then, seek approval of the complete revised design separately

**Full-design approval remains pending the answer above.** After incorporating it, the driver asks
whether the complete revised design is approved, explicitly including the proposed privilege union,
any-held-role list matching, transactional mechanics, proof revisions, imports and interface.
Do not publish that approval request alongside the deletion question or treat accepted sub-decisions
as full approval. Planning and building remain unauthorized.

Before a later plan, recheck the pre-live/reset assumption, current catalog and all consumer paths;
the historical and bounded current receipts here are reading only. Exact schema and slice boundaries
remain implementation design work after full-design approval, not additional owner policy questions.
