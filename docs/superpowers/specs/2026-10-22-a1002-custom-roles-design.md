# A1002: roles you can define, privileges you can trust

**Status: design OWNER APPROVED, 2026-11-07 22:51, with the corrections below and the
activity-log/email addition at 22:53. Incorporated 2026-11-08.**
Design only, 2026-10-22; **revision 2026-10-28** incorporates the owner's separate answers;
**revision 2026-11-04** applies the owner's decisions from A1308's review;
**revision 2026-11-07** incorporated the no-role outcome and promotion default.
**Correction 2026-11-08:** the full approval removes authority counters, link cancellation on role
changes, stored Admin grants, approval-role snapshots and special import hardening. It confirms
`node.promote` merges into `node.manage`. §11 preserves the exact approval and addition.
No further design approval is requested. The required Claude read still precedes any plan/build;
this revision contains neither and authorizes neither to start in this firing.

The historical source audit stays pinned to `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`.
Those references are reading-only receipts, not runtime verification. Bounded additional readings
at `e0f3e261c3811333d91db376fcab900eab216151` and `e0da0ad18a` remain labelled in §7.
The 2026-11-08 **SOURCE READ ONLY** additions use
`e0e4f5b8fda194814a6280340f1b93bb7569307a`. Target behavior follows the approved policy;
§7 labels integration defaults awaiting watcher confirmation. None of this claims working
implementation. No executable schema or implementation plan is supplied.

## 1. The problem, through one shift

You want a “Service lead” who can refund a payment and correct attendance without changing people's
sign-in details. At the historical audit, you choose among four fixed roles, and the Admin label
also controls attendance self-approval. Privileges must decide what the person can do.

Example: copy Supervisor into Service lead, retain `sale.refund` and `workforce.correct`,
and leave `person.admin` off. Ana can approve Luis's attendance correction without changing his
email. You may assign Ana both Staff and Service lead. Under the approved union rule,
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
  no replacement choices. The owner answered on 2026-10-28 ~11:40: a sole-role holder is left
  **with no role**. §6 preserves identity, status and credentials, including pending/suspended status,
  and defines the permitted own-person self-service and refused operational access.
- **2026-10-29 ~09:25, promotion (A1188), historical answer:** `node.promote` is administrators-only
  by default and assignable. **Correction 2026-11-08:** the full approval at 2026-11-07 22:51
  confirms the 28 October merge into `node.manage`; that merged privilege is Admin-only by default
  and assignable. Keep the recovery operation and all other promotion conditions. No fiscal,
  mirror, promotion implementation or host policy change follows.
- **A1113 supersedes the mirror dashboard proposal:** owner 2026-10-26, restated 2026-10-28.
  Mirrors are to serve no dashboard; retire the built-in viewer through A1113. Its removal is
  blocked, not claimed built here. A1002 proposes no mirror reader role or viewer-session design.

- **2026-11-04, one role list (A1308):** access and the rota share one list of roles. Staffing's
  `staff_roles` and `person_staff_roles` fold into this design's roles and memberships, with colour,
  position and an on-rota flag on the role. A role can grant privileges, appear on the rota, or both.
  This ends the earlier line that kept access roles apart from job roles: it was a design line, not
  an owner decision, and §5's rule stops an accidental grant.
- **2026-11-04, no per-person exceptions:** `device_profile_admission_persons` is deleted. To change who
  may sign in on a device, change their roles. Several roles per person is what makes that work.
- **2026-11-04, retiring:** a role a shift has used is retired, not deleted (§6).
- **2026-11-04, Manager default:** Manager holds `person.admin` by default, so managers assign roles.
- **2026-11-04, lists as JSON:** device admission, reason and bill-limit role lists hold role IDs as JSON
  on the row that owns them (§4).
- **2026-11-04, recipes removed:** `recipe.manage` is retired (§2).

- **2026-11-07 22:51, full design approved with simplifications:** two role tables, JSON permissions,
  Admin authority in code, ordinary field/set comparisons for stale edits, live authority reads when
  links are used, identity-only approval records and ordinary transfer mapping (§3–§7).
- **2026-11-07 22:53, activity and email:** log each membership/permission change and role lifecycle
  action in the venue's activity log; email each person given or losing a role, if they have email,
  in their language. Permission changes do not email all holders (§7).
- **Names stay Staff, Supervisor, Manager, Admin.** Cloud's single account owner (D608) is separate
  from the venue's Admin role; neither confers the other's authority.

§11 quotes the 7 November full approval and addition, including union and any-held-role matching.
Earlier decision receipts remain in this document's pre-correction version at
`e0e4f5b8fda194814a6280340f1b93bb7569307a`; the historical code audit remains pinned separately
to `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`.

## 2. One permission review, before role storage

“Privilege” is the product wording; “permission” remains the code's word for its stable identifier.
This is the single inventory. `personal_data.export` already exists; retain it rather than creating
a second privacy/export permission. Own staff download is an authenticated own-person route, not
a grant to download other people's data. This design makes no legal findings.

Historical grants: **T** = Staff, Supervisor, Manager, Admin; **S** = Supervisor, Manager, Admin;
**M** = Manager, Admin; **A** = Admin. These abbreviate seed sets, never a hierarchy.
The owner approved the non-fiscal target names and ordinary default sets on 2026-10-28.
Each ordinary role has explicit grants; changing Supervisor changes no other role.
Protected Admin receives every declared permission through the code rule in §3.

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
| `catalogue.manage`                      | M, C                                             | Keep; A1308 renames it `menu.manage`         | Includes the accepted image-management merge.                                                               |
| `person.admin`                          | A, C                                             | Keep, M                                      | Accepted single privilege, on Manager by default (owner, 2026-11-04); a custom holder gains no other privilege. Admin holds the full catalog under §3. |
| `layout.configure`                      | M, C                                             | `venue.configure`, M                         | Combine configuration of themes, receipts and device profiles with venue settings.                          |
| `venue.view`                            | S, C                                             | Keep                                         | Read-only venue access remains separable from configuration.                                                |
| `venue.configure`                       | M, C                                             | Keep                                         | Includes layout and venue-service configuration.                                                            |
| `system.manage`                         | M, C                                             | Keep                                         | Includes diagnostics; backups, recovery and Cloud controls stay sensitive.                                  |
| `schedule.manage`                       | M, C                                             | Keep                                         | One scheduling privilege for rota, swaps, absences and staffing configuration.                              |
| `swap.approve`                          | M, C                                             | `schedule.manage`, M                         | Same default holders; combine related scheduling decisions.                                                 |
| `absence.decide`                        | M, C                                             | `schedule.manage`, M                         | Same group; retain subject and state restrictions.                                                          |
| `purchase.manage`                       | M, C                                             | Keep                                         | Buying and receiving are distinct from catalogue editing.                                                   |
| `recipe.manage`                         | M, C                                             | Retire                                       | Recipes are removed (owner, 2026-11-04, A1308); its one gate, `apps/server/src/recipe-api.ts:31`, goes with them. |
| `report.export`                         | M, C                                             | Keep                                         | Report exports, including current attendance exports; not A980 personal-data requests.                      |
| `report.view`                           | S, C                                             | Keep                                         | Wider Orders/report visibility; preserve the narrower ordinary staff view.                                  |
| `device.manage`                         | M, C                                             | `hardware.manage`, M                         | Group device, printer and connected payment equipment administration.                                       |
| `printer.manage`                        | M, C                                             | `hardware.manage`, M                         | Same equipment group.                                                                                       |
| `payments.manage`                       | M, C                                             | `hardware.manage`, M                         | Includes payment provider/reader configuration; explain that breadth in the label's help.                   |
| `print.resend`                          | M, C                                             | `hardware.manage`, M                         | Retry administration; retain all resend eligibility restrictions.                                           |
| `cash.drawer`                           | S, C                                             | Keep                                         | Opening a drawer remains separate from printing and taking payment.                                         |
| `mirror.create`                         | A, C                                             | `node.manage`, A                             | Owner prefers `node.*`; combine membership actions.                                                         |
| `node.promote`                          | A, C                                             | `node.manage`, A                             | Merge accepted 28 October and confirmed 7 November 22:51. Admin-only by default, assignable; retain recovery operation and all other promotion conditions. |
| `diagnostics.view`                      | M, C                                             | `system.manage`, M                           | Operational diagnostics join system administration.                                                         |
| `fiscal.view`                           | M, C                                             | Keep                                         | Read fiscal status independently from sales or system changes.                                              |
| `venue_service.manage`                  | M, `packages/venue-service/src/permissions.ts:3` | `venue.configure`, M                         | Remove the duplicate module grant; use the core permission at its consumers.                                |
| `workforce.correct`                     | S, `packages/workforce/src/permissions.ts:1`     | Keep                                         | Attendance decisions about others; not account administration.                                              |
| `staffing.manage`                       | M, `packages/staffing/src/permissions.ts:3`      | `schedule.manage`, M                         | Retire module identifier. Staffing's job roles join the one role list (§3).                                  |
| `booking.manage`                        | M, `packages/bookings/src/permissions.ts:4`      | Keep                                         | Reservations remain an independent domain.                                                                  |
| `adjustment.manage`                     | M, `packages/adjustments/src/permissions.ts:3`   | Keep                                         | Configure reasons and limits, separately from using or approving one.                                       |
| `image.manage`                          | M, `packages/media/src/module.ts:26`             | `catalogue.manage`, M                        | Shared catalogue images follow catalogue editing.                                                           |
| `personal_data.export` | A, current reading receipt below | Keep, A | Already declared by A980 S2c; own staff download needs no such grant. |
| Attendance's named Admin exception      | `packages/workforce/src/corrections.ts:361`      | New `workforce.self_approve`, A              | Require this AND `workforce.correct`; keep the exception confined to attendance.                            |
| Adjustment application role lists       | `packages/adjustments/src/policy.ts:142`         | New `adjustment.apply`, T                    | Necessary for direct comps/discounts, additionally restricted by each reason.                               |
| Adjustment approval role lists          | `packages/adjustments/src/policy.ts:185`         | New `adjustment.approve`, S                  | Necessary for reason/bill-limit approval, additionally restricted by that policy.                           |

`node.manage` covers node membership and promotion. There is no separate target `node.promote`
permission. Its Admin-only default does not restrict assignment to Admin: another role may receive
`node.manage` through the ordinary permission editor and §5's checks. Promotion still needs its
recovery operation and all other conditions. No fiscal, mirror, promotion implementation or host
policy change is authorized.

These merges keep identity, personnel, reporting and sales distinct. Do not merge `person.admin`
into `person.manage`, or privacy exports into `report.export`. The historical retry gate is
`apps/server/src/print-api.ts:1505`; Orders receipt copies enter through
`apps/server/src/orders-api.ts:281`. Trace both final paths before changing either.

The three sale privileges remain separate. There is no queued fiscal merge or fiscal-merge gate.
Finish the accepted catalog consistently across consumers before enabling editable roles; no runtime
alias or compatibility layer is proposed. Fiscal behavior and protected fiscal evidence remain
outside this documentation revision.

## 3. Explicit roles and several memberships, without a ladder

**Owner approved:** you may assign several roles to one person. Effective privileges are the union
of every held role's permissions, including Admin's code-defined authority. There is no primary
role, inherited ordering, deny grant or person-specific privilege override. Duplicate grants count
once; role order changes nothing. An ordinary role may have no grants.

Policy membership and privileges are independent gates. For an explicit role list, any held role
may match; the required privilege may come from another held role. A matching role without the
privilege fails, and a privilege without a policy match fails. Eligibility still applies to device
admission; profile action and zone restrictions still apply to till actions. There are no per-person
exceptions (owner, 2026-11-04). §6 defines the accepted no-role outcome separately.

Example: Ana's Service lead grants `adjustment.approve`; her Evening team role is on a complaint
approver list. Together they satisfy both gates. Removing Evening team stops that contextual
approval even if her privilege union is unchanged. Creating or copying a role inserts it into no
list. Selecting all roles known today stores those IDs only. This proposal adds no “all future
roles” mode or default bypass. When replacing the old empty-list “every” representation, seed the
intended existing preset IDs explicitly; an empty selected list means nobody, never an automatic
all-roles fallback.

Each role has an opaque stable ID, a JSON list of permission IDs, colour, position and on-rota
flag. The permission IDs are code constants, not rows in a permission catalog. The last three
fields come from `staff_roles`. A role with the flag on appears on the rota and staffing painter; one with it off does not, and a role may be on the rota and grant nothing, such as
"Cook". The rota keeps warning about a person outside a role and does not refuse them, as it does today
(`packages/staffing/src/dashboard/rota-cards.ts:112`, `:171`, read at `e0da0ad18a`). All four built-ins
also have immutable preset keys and translated names. Staff, Supervisor and Manager have editable
grants but cannot be renamed, deleted or converted to custom roles. Admin additionally cannot have
its effective authority narrowed. Its protected built-in identity selects the code rule: an eligible
person holding Admin has every declared permission, including future additions. That rule does not
bypass status, device/list restrictions, required recovery operations or other action conditions.

Only custom names are typed, trimmed, nonempty and unique under the existing Unicode folding
convention (historical `packages/identity/src/staff.ts:236`). A custom label never confers built-in
identity or authority. Copying any preset creates an ordinary custom role with a new
literal name and a JSON list of current permissions only. Copying Admin reads the current declared
constants; the copy has no protected identity or future automatic authority. No copy includes people
or context-list entries. Initial setup creates the built-ins; later starts preserve saved ordinary
permissions and custom roles. There is no seed-completion record or start-up grant-filling pass.

Replace `ModulePermission.grantedFrom` (historical `packages/module/src/module.ts:110`) with a
declaration plus explicit ordinary default preset keys. Workforce correction names Supervisor and
Manager; Admin receives every declaration through code. The contract owns that finite key vocabulary; runtime `RoleId` is a distinct
type. Replace `packages/composition/src/role-parity.ts:5` with two-way type assertions for the seed
and declaration contracts identity accepts. Keep existing dependency direction. Reject duplicate
ownership, unknown default keys and undeclared grants. No `indexOf` or implied ordering remains.
Historical boot ladder readings: `apps/server/src/boot.ts:885`, `packages/identity/src/permissions.ts:104`,
`apps/server/src/modules.ts:32`.

Initial setup creates the built-ins and first active human with usable dashboard sign-in whose
memberships contain protected Admin, in one transaction. Setup establishes initial authority;
authenticated mutations still cannot grant privileges the actor lacks. Admin's JSON list carries
no stored grants; its effective permissions come solely from the declared constants in code.
Unknown permission strings never authorize. Ordinary saved lists reject undeclared IDs.
Disabled-module privileges remain visible, labelled unavailable; enabling changes availability,
not ordinary saved permissions. A new declared privilege needs no Admin row update.

Synchronization, fenced-node write refusal and promotion ordering belong to A1113 and node work.
A1002 uses their existing primary-write and compatible-code boundaries for roles, memberships and
JSON lists; it adds no authority revision or catalog reconciliation machinery and no node work.

## 4. Storage and references, with schema deferred

There are exactly two role tables, both `state`: `roles` and `person_roles`, in core. Each role's
permissions are a short JSON list on its row, under the owner's 4 November rule. Person-role
memberships are unique on person ID and role ID. Replace the single `persons.role` enum with these
memberships; a person can hold several roles or none (§6). Keep one identity, status and
authentication record per person. No permission-catalog, grants, authority-counter or seed table.
No tenant column. A1308's `tables-people.md` draws the shared access/rota role fields, but its
`roles` drawing's `revision` column and catalogue/grants/seed-completion placeholders are superseded by this
approval: remove them and add the role's `permissions` JSON column. Its claim that storage is
still open is superseded too. Update that drawing when the role schema is planned.

Policy references are role IDs in JSON on their owning row: device admission, a reason's
`apply_roles` and `approver_roles`, and `billApproverRoles`. No foreign key sees those IDs, so
deletion, retirement and transfer enumerate them in code; later acceptance checks must cover that
list. Membership keys restrict deletion until the command removes those rows. Never cascade-delete
people, credentials, sessions or historical decisions through a role. Keep token hashing and
cryptographic custody unchanged (historical `packages/identity/src/classification.ts:13`).

Authorization reads current memberships, permissions and policy. Equal privilege unions do not mean
equal contextual access. Use the existing field/draft comparison for changed-while-editing refusals
(§5), without counters on people, roles or lists, new hashes or stored authority proofs.

New approval records identify the actor and authorizer, without copying their roles, labels or
permission sets. Keep original immutable actor/authorizer identities and existing business facts
on attendance, adjustments, sales, payments and printing. Do not rewrite old snapshots or history.
An adjustment's existing policy facts remain evidence of that adjustment, not future authority
(historical `packages/adjustments/src/policy.ts:191`). No shipped migration edits, compatibility
conversion or data-migration scheme is part of this revision; delivery remains pre-live reset.

## 5. Mutation rules that prevent indirect grants

Require currently held `person.admin` for role administration and the minimum person lookup it
needs, without `person.manage`. Ordinary employment edits retain `person.manage`. A stale full-body
staff edit must not overwrite membership; change memberships separately, comparing the expected
membership set with the stored set.
Other-person sign-in changes need `person.admin` plus the whole-target checks below. Self-service
security flows keep their identity/proof checks.

For each mutation, use ONE `withTransaction`. Re-read actor status, complete membership union and
target/result sets inside it. Compare the fields/sets the draft read, validate current authority,
write the change and its activity entries (§7), then check the final protected Admin invariant
before commit. Queries run in turn. The write turn uses `withTransaction`/`withWriteLock`
(historical `packages/db/src/tenancy.ts:30`). Sending email stays outside this transaction.

| Operation | Authority and final-result checks |
| --- | --- |
| Create/copy role | Actor holds `person.admin` and every selected/copied privilege. No preset metadata, people or context memberships copied. |
| Edit role grants | Actor holds each added privilege. Removals may narrow grants the actor lacks. Recompute each holder's union; preserve built-in keys/names and Admin's code rule. |
| Rename a custom role | Require `person.admin`; retain unique folded names and fixed built-in names. Renaming changes no authority. |
| Assign/edit membership, invite or reactivate | Require `person.admin`. The WHOLE resulting person's union, including retained memberships, must be within the actor's current whole-person union. Check context gains separately even when unions are equal. No self-promotion or representative-role comparison. |
| Change another person's sign-in/status | Require `person.admin` and dominance over the target's whole current union, preventing takeover through another role. Covers email, PIN/password reset, invitation, suspension/reactivation and MFA/passkey/Google removal. |
| Delete or retire custom role | Require `person.admin` and domain configuration authority for referenced policies. Remove references under §6; no reassignment. Pure removal does not require holding grants being removed. A sole-role holder is left with no role; multi-role holders retain their other roles. |
| Edit a role's colour, position or on-rota flag | `schedule.manage` alone, as `staffing.manage` gates them today (`packages/staffing/src/routes.ts:161-162`). They change no authority, so no whole-result check. |
| Edit device/reason/bill-limit policy | Require its configuration privilege; enabling apply/approval access also requires the corresponding action privilege. Check gains for complete person memberships; policy selection cannot grant a missing privilege. |

Manager holds `person.admin` by default, and one privilege covers role assignment and other people's
sign-in details (§1). So a default Manager also changes the sign-in details of anyone whose whole union
sits within theirs, which Admin alone may do today. The whole-result rule above still stops them giving
more than they hold. Admin holds privileges Manager does not by default, such as `node.manage`, so a
default Manager can neither assign Admin nor change an Admin's sign-in.

Example: Marta holds `person.admin` but lacks `system.manage`. She cannot add a narrow role to a
person whose retained role grants system administration, then reset that person's login using only
the narrow role as her comparison. She cannot copy Admin intact or assign it to herself. She may
remove a custom role without acquiring its grants, subject to domain-policy authority and §6.

**Accepted last-human anchor and shared enforcement:** count DISTINCT active usable human
persons whose membership set CONTAINS canonical Admin. Count a person once, however many roles or
authentication methods they hold. They need an enrolled supported usable dashboard method and
access to role administration. PIN-only, pending, suspended or unusable people do not count.
A custom holder with every current grant cannot replace this future-grant anchor.

Apply the serialized final-state check to all person, role, import, status and authentication
mutations: bulk assignment, the replacement for `setRole`, both suspension functions, account reset
to pending, method removal and recovery. A transaction may remove the last person's Admin membership
only if another usable active human contains Admin in the final state. Role counts or join-row
counts do not prove this. Replacing the last holder's sign-in method must leave one usable method.
Recovery selects an existing `person.admin` holder explicitly and changes no memberships/grants.

Keep ordinary “this changed while you were editing” protection through expected field values
and set equality. A membership save compares the held role IDs it read; a role edit compares its
edited fields and permission set; a policy edit compares the role-ID list it read. A deletion
compares the displayed affected memberships, list values and losses with the fresh impact. Refuse
a difference and retain the draft for reload. Reordering an unchanged set is a no-op. Recompute
current authority and complete before/after contextual access even when privilege unions are equal.
Do not introduce version counters, hashes or a generic conflict protocol.

Role or permission changes do not cancel outstanding invitations, password-reset or email-change
links. At redemption, read current target memberships, status and authority; an old link never
restores a removed role. For administrator-issued actions, check the issuer's current active status,
`person.admin`, the target's whole current union within the issuer's and the last usable Admin
invariant. Record `issued_by` on the existing account-action row: the issuer's person ID for
administrator-issued links, null for self-service. Store identity only, not their roles.
Normal expiry, single use and
credential/proof checks remain. A link may be refused by current authority without being cancelled
because a role changed. Reissuing keeps the existing same-purpose replacement behavior.

Self-service recovery and email changes need no administrative issuer and cannot change roles or
permissions. They read current status and preserve the Admin anchor. Invitation completion is
atomic against current rows; pending people have no session beforehand. A person whose last role
was removed may complete an otherwise valid invitation with identity-only access under §6.
Historical link machinery: `packages/identity/src/account-action.ts:62` and `:296`; §7 distinguishes
the current source reading from this target. A committed action stays history; an action waiting
for the write turn authorizes again after acquiring it.

## 6. Deleting a role in use

**Accepted:** delete only custom roles, remove their memberships and all live role-list references,
show the full impact and confirm once. Every built-in is undeletable regardless of holder count.
There is no replacement selector, policy substitution or grant transfer.

The preview enumerates active, pending and suspended people, their retained roles, privilege losses,
remaining context access, affected device admission, reason apply/approval and bill-limit lists.
Show sole-role holders separately as “No role”, with identity-only self-service if otherwise eligible
to authenticate; pending people stay pending and gain no session. Show lists becoming empty as
“Nobody through roles” or “Approval blocked”.
An empty list never becomes all roles. If an approval path requires a nonempty eligible set, keep
the policy present but blocked: requests needing that approval remain refused until a separate
authorized policy edit supplies eligible approvers. No automatic substitute or deletion-time
replacement workflow is proposed.

Recompute impact inside one transaction and compare it with the confirmed field/set values.
Remove memberships and every live reference, remove the role, record each removal and the role's
lifecycle action (§7), and check the final Admin invariant. Refuse a changed preview or unauthorized
result; any refusal rolls the operation back. Retain historical authorizers and existing snapshots.
Outstanding links remain subject to the current-row checks in §5.

Example: Ana holds Staff and Evening lead; Luis, who has a pending invitation, holds only Evening lead.
Deleting Evening lead leaves Ana's Staff membership and removes the role from each policy.
Luis is left with no role and stays pending, with no session; his old invitation cannot restore
Evening lead.
If the complaint approver list becomes empty, complaints needing approval remain blocked.

**Accepted 2026-11-04: a role a shift has used is retired, not deleted.** Today a delete is refused
for as long as any shift names the role (`staff_role.in_use`, `packages/staffing/src/staff-roles.ts:221-275`,
read at `e0da0ad18a`), and shifts are never deleted once published, so such a role could never go. Here
the same action, with the same one confirmation and the same preview, removes the role from everyone
and every list, removes its painted staffing blocks, and clears its permission JSON. The role row
stays with a retirement time, so past shifts keep showing its name. Nobody can hold, list or choose a retired role,
and its name can be used again. A role no shift has used is deleted outright. Built-ins are neither.

Example: Luis filled Barista on 40 past shifts and the venue stops using the role. Choosing Delete
removes it from the two people who hold it and from every list. The 40 shifts still read Barista.

**Accepted sole-role outcome, owner 2026-10-28 ~11:40:** leave the person **with no role**.
Keep their identity, status and credentials. An otherwise eligible person can authenticate for
own-identity/security/data self-service only. They have no role grants, operational or list rights,
device/reason access, approver eligibility or administrator-recipient authority. Pending people
remain pending and gain no session; suspended people remain suspended. Show “No role”; a separate
authorized membership edit can restore work access.

Deletion removes exactly the selected role from multi-role holders and retains their other roles.
It adds no membership. Apply fresh authority reads above to every holder, without cancelling links.

## 7. Replacement audit: follow each consumer to its meaning

This table preserves the historical source trace at `2e63a28a87f3f43e2f665f6fb8649fe2766aee84`,
reading only. Its source columns remain historical. The target replacement columns were revised
2026-10-28 for complete membership sets and corrected 2026-11-08 for the full approval in §11.
A1113 owns mirror-principal retirement, as stated in §9.

| Consumer and current source                                                                                                                                                                                                                         | Proposed replacement / fact to retain                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder/catalog, `packages/identity/src/permissions.ts:43`, `:104`; module contract `packages/module/src/module.ts:104`; composition `packages/composition/src/role-parity.ts:5` | Role IDs, permission JSON and explicit defaults (§3); Admin authority comes from code. |
| Staff target-role checks, `packages/identity/src/staff.ts:210`, `:259`, `:502`, `:507` | Whole-target union and expected-set checks (§5); link redemption reads current authority. |
| Last Admin queries, `packages/identity/src/staff.ts:193`, `:271`, `:315`; alternate mutators `:497`, `:567`, `:579` | Count distinct usable active humans holding protected Admin, in the final transaction state (§5). |
| Sign-in takeover boundary, `packages/identity/src/staff.ts:131`, `:233`, `:395`; server routes `apps/server/src/management-api.ts:1125`, `:1209` | Retain A998/A1000; require person.admin and whole-target authority (§5). |
| Dashboard sessions, `packages/identity/src/management-session.ts:60`; manager authorization `packages/identity/src/manager-login.ts:162` | Resolve live status and complete memberships/union per request. |
| Till/session and PIN authorization, `packages/identity/src/authorize.ts:43`, `:74`; `apps/server/src/till-session.ts:99`; `packages/identity/src/credential.ts:43` | Read live status, union and profile admission in the action transaction, including routes with no permission option (§3, §6). |
| Early PIN preparation, `apps/server/src/pin-check-ahead.ts:55`; refund confirmation `apps/server/src/bill-refunds.ts:696`, `apps/server/src/tender-refund-authorization.ts:144` | Keep hashing outside the transaction, throttles and generic refusals; re-read authority for the action. |
| Approver lists, `packages/identity/src/staff.ts:613`, `:621`; query parser `apps/server/src/adjustments-api.ts:88` | One entry per eligible person; privilege AND policy match; recheck on PIN submission. |
| Attendance views, `apps/server/src/management-attendance-api.ts:206`, `apps/server/src/till-attendance-api.ts:226` | Self-approval needs both workforce privileges across the union, independently of person.admin. |
| Attendance domain, `packages/workforce/src/corrections.ts:35`, `:42`, `:252`, `:360`; `packages/workforce/src/attendance-response-commands.ts:119` | Use privileges; keep subject/requester, direction and approve-only limits, own-decline refusal and historical author-kind. |
| Adjustment decisions, `packages/adjustments/src/policy.ts:142`, `:171`, `:185`; `apps/server/src/adjustments-apply.ts:558`, `:770` | Independent action/policy gates; retain sale.refund cancellation checks, stages, amounts and limits. |
| Adjustment policy/storage/seeds, `packages/adjustments/src/schema/reasons.ts:42`, `packages/adjustments/src/schema/settings.ts:6`, `packages/adjustments/src/provisioning.ts:6` | JSON role IDs; retain Complaint S, On the house M, Staff meal T with 50% limit/M approval, Discount M. Empty approval stays blocked. |
| Adjustment client seniority, `packages/adjustments/src/dashboard/reasons-screen.ts:43`, `:94`, `:1251`; client union `packages/adjustments/src/dashboard/client.ts:9`; till text `apps/till/src/widgets/adjustment-dialog.ts:112` | Role IDs, localized sorting and set equality; current selections never include future roles. |
| PIN prompt wording, `apps/till/src/widgets/supervisor-override-dialog.ts:76`, `:115` | Name the action/policy and eligible people; custom names stay literal. |
| Device admission, `packages/identity/src/profile-admission.ts:15`, `:50`, `:181`; schema `packages/identity/src/schema/profile-admission.ts:9` | Explicit role lists, no person exceptions; retain eligibility and profile action/zone limits (§3, §6). |
| Dashboard forms/filter/labels, `apps/dashboard/src/widgets/person-form.ts:291`, `widgets/person-edit.ts:332`, `screens/staff-screen.ts:376`, `i18n/domain.ts:147`; unions `apps/dashboard/src/api/client.ts:336`, `apps/till/src/api/client.ts:904` | roleIds multi-selection, complete labels, any-selected filtering and No role; no Staff fallback (§8). |
| Shell and permission projections, `apps/dashboard/src/dashboard-app.ts:1178`, `apps/server/src/me-api.ts:331`, `apps/server/src/till-api.ts:1426`, `apps/server/src/alerts-api.ts:46` | Project current roleIds/union; passive refresh is presentation, never retained server authority. |
| Scheduling/workforce/reporting, `apps/server/src/workforce-api.ts:35`, `packages/staffing/src/routes.ts:194`, `apps/server/src/attendance-export-api.ts:45`, `apps/server/src/orders-api.ts:145` | Accepted names/whole unions; keep own-person exports and Orders non-report scope; one access/rota role list. |
| Other direct lookups, `packages/venue-service/src/routes.ts:703`, `apps/server/src/email-settings-api.ts:50`, `apps/server/src/email-inbox-api.ts:39` | Current whole-person authority; retain default-setting and sign-in-mail conditions. |
| Provisioning/recovery, `packages/provisioning/src/venue-apply.ts:196`, `packages/provisioning/src/recover-provisioned-venue.ts:46`; CLI `apps/server/src/break-glass-command.ts:94` | Create built-ins/initial human; preserve recorded setup identity, live authority and the Admin anchor. Recovery changes no roles. |
| Transfers, `packages/identity/src/configuration-transfer.ts:1`, `packages/adjustments/src/configuration-transfer.ts:34`, `packages/provisioning/src/configuration-transfer.ts:700`, `:724`, `:737` | Ordinary transfer mapping, including JSON references; imported people stay suspended. Reactivation follows §5. |
| Automatic work, `apps/server/src/certificate-reminder-worker.ts:62`; authenticated operations `apps/server/src/operation-authentication.ts:87` | Distinct live eligible recipients; recheck actor-bound work. Keep service authority/current mode and committed fiscal/outbox authority. |
| Fixtures and constraints, `packages/identity/test/fixtures.ts:57`, `apps/server/scripts/demo-seed/staff.ts:18`, `packages/identity/src/schema/persons.ts:6`, `:76` | Replace singular role fields with memberships; retain behavioral assertions and status cases. |

### Bounded current-source additions, reading only, 2026-10-28

These readings use `e0f3e261c3811333d91db376fcab900eab216151`, independently of the historical table.
They do not establish runtime behavior or complete the later implementation audit.

| Reading receipt | Proposed consequence |
| --- | --- |
| `packages/identity/src/permissions.ts:18`, `:78`, `:84` declare `personal_data.export` and include it in Admin's full catalog set. | Keep the single §2 entry. |
| `packages/identity/src/personal-data.ts:29`, `:42` selects a singular role into profile output. | Export all role IDs/labels, including an empty set; this output grants no authority. |
| `apps/server/src/personal-data-export-api.ts:117`, `:123` and `:136`, `:145` separate own identity from another person's privileged export; `apps/server/src/invoice-customer-data-api.ts:57` requires the same privilege. | Keep own-person identity access and privileged/customer scope. |
| `apps/server/src/manager-email-recipients.ts:13`, `:22`, `:33` filters active people with email by singular-role `system.manage`; called by `certificate-reminder-worker.ts:60` and `box-alert-email.ts:153` under `apps/server/src/`. | Distinct live eligible recipients using whole unions; no privileged recipients without roles. |
| `packages/identity/src/profile-admission.ts:28`, `:54`, `:111` reads empty as every and gives explicit person exceptions precedence. | Explicit lists, no person exceptions (§3). |
| `packages/provisioning/src/venue-apply.ts:99`, `:371`, `:374`, `:500`, `:548` queries singular Admin membership for setup ordering, the initial module operator and profile seeding. | Use the recorded initial human and current union for setup/resume; no arbitrary matching role holder. |

### Additions from A1308, reading only, 2026-11-04

These readings use `e0da0ad18a` (`docs/superpowers/specs/2026-11-02-rationalisation/tables-people.md`
draws the tables). They do not establish runtime behavior.

| Reading receipt | Proposed consequence |
| --- | --- |
| `packages/staffing/src/staff-roles.ts:124` lists every staff role, and `packages/staffing/src/rota.ts:53` reads that list; `packages/staffing/src/dashboard/rota-cards.ts:158` finds a shift's role in it. | Include on-rota roles and every role named by that week’s shifts, including retired/off-rota roles. |
| `packages/staffing/src/routes.ts:161-162`, `:337-345` gate holders with `staffing.manage`. | Membership changes use §5; staffing routes/screen join Roles or call it. |
| `packages/staffing/src/configuration-transfer.ts:3-11` exports `staff_roles` and `person_staff_roles`. | Move both to identity transfer; retired roles do not travel because shifts do not. |
| `packages/adjustments/src/schema/settings.ts:30` CHECKs that `billApproverRoles` is not empty. | A1308’s settings validator accepts the emptied list as blocked (§6). |
| `packages/staffing/src/staff-roles.ts:57-66` compares a name exactly after trimming. | Use §3’s Unicode folding for job-role names too. |

### Imports and complete API/client shapes

Carry role definitions/permission JSON, memberships and device/reason/bill-limit references through
existing transfer mapping, including IDs inside JSON. Preserve normal input/reference checks,
entry-path authority, fixed built-in identities and the last usable Admin. Imported people stay
suspended; later invitation/reactivation follows §5. No login secrets/sessions travel. No special
canonical-marker, provenance, context-gain or privilege-hardening scheme, compatibility or migration.

Replace singular-role request/response, domain, session, credential, Staff/approver and personal-data
shapes with `roleIds: RoleId[]` and display metadata; request-local authority includes the current
union. Assignment sends intended and expected membership sets. Reject duplicates, unknown IDs and
null; compare sets without ordering. An absent field on an employment edit leaves membership alone.
There is no primary/first/senior role or Staff default; `roleIds: []` has no operational/list authority.

### Activity and role-change email, owner addition 2026-11-07 22:53

Record each membership/permission edit and role lifecycle action in the venue activity log:
actor identity, subject, change and time. Bulk membership removals each get an entry; no-op saves
get none. Create/copy/retire/delete has one lifecycle entry carrying its initial/removed permission
list, without separate permission entries. Store the role label at the time, including on deletion;
keep old/new labels for rename. These are target facts, never the approver's role set. The two
membership codes below replace A1308's proposed `person.roles_changed`, not add a second event.

| Proposed code | English activity text | Spanish activity text |
| --- | --- | --- |
| `role.member_added` | {actor} added {person} to {role}. | {actor} añadió a {person} al rol {role}. |
| `role.member_removed` | {actor} removed {person} from {role}. | {actor} quitó a {person} del rol {role}. |
| `role.permission_added` | {actor} added {permission} to {role}. | {actor} añadió {permission} al rol {role}. |
| `role.permission_removed` | {actor} removed {permission} from {role}. | {actor} quitó {permission} del rol {role}. |
| `role.created` | {actor} created {role}. | {actor} creó el rol {role}. |
| `role.renamed` | {actor} renamed {oldRole} to {role}. | {actor} cambió el nombre del rol {oldRole} a {role}. |
| `role.retired` | {actor} retired {role}. | {actor} retiró el rol {role}. |
| `role.deleted` | {actor} deleted {role}. | {actor} eliminó el rol {role}. |

Email each person given or losing a role if they have an address, including pending/suspended
people and those losing their last role. Without an address, the log entry still stands. Permission
edits do not email holders; deletion/retirement emails only for membership removals. One proposed
template, `role_membership_changed`, uses EN/ES wording (`ROLE_MEMBERSHIP_EMAIL_WORDS`, following the
attendance sender's word-object convention). Custom names stay literal; built-in labels translate.

| Action | English subject and text | Spanish subject and text |
| --- | --- | --- |
| Added | **Role added: {role}**. {actor} added you to {role} on {when}. | **Rol añadido: {role}**. {actor} te añadió al rol {role} el {when}. |
| Removed | **Role removed: {role}**. {actor} removed you from {role} on {when}. | **Rol quitado: {role}**. {actor} te quitó del rol {role} el {when}. |

Format `{when}` in the recipient's language and venue time zone. Use the shared mail path's delivery
policy; SMTP never holds the role-change transaction. No new log, queue, notification service,
transactional-delivery guarantee or retry scheme.

**Proposed integration defaults, for watcher confirmation:** write the activity entry and queue
row in the role-change transaction. Queue kind/template `role_membership_changed` uses
`dedupe_key = role-membership:<activity-entry-id>`, `subject_id` for that entry, `person_id` for
the recipient and `requested_by` for the actor. Keep role label, actor display name and change time
in `params` so deletion cannot erase the wording; use `editorName` for the actor's name, already a
personal-data key. Take the recipient address at claim as the queue requires. Inherit `box_alert`'s
24-hour `not_after` policy. Log setup/import baseline memberships, but email only subsequent role
changes, including deletion/retirement removals, to avoid emailing an imported staff list.

**Unbuilt dependency:** no shared activity writer or general queued-mail API was located at the
source pin below. A1308's people design also records no person-change audit today; its shared log
and history display remain dependencies. Direct SMTP exists today; waiting for `outgoing_mail`
follows A1308's approved U4 one-queue decision. Reuse those paths when built, without adapting
domain-specific queues or adding infrastructure.

### Current-source receipts for this correction, 2026-11-08

**SOURCE READ ONLY**, at `e0e4f5b8fda194814a6280340f1b93bb7569307a`; no runtime verification.

- `apps/server/src/logger.ts:15-23` writes to a line sink; `account-email.ts:111-120` in the same
  directory sends SMTP directly. `attendance-email-worker.ts:75-143` and
  `invoice-email-worker.ts:50-105` consume domain-specific queues, not a general role-mail API.
  A1308's proposed shared seams are in `docs/superpowers/specs/2026-11-02-rationalisation/README.md:107-114`
  and `jobs.md:284-339` there; these are design text, not source implementation.
- `apps/server/src/email-delivery.ts:16-40`, `attendance-email.ts:15-29`,
  `i18n/attendance-email.ts:1-18` and `account-email.ts:48-76` there supply delivery selection,
  EN/ES word objects and venue-zone date formatting.
- `packages/identity/src/account-action.ts:281-342` and `management-session.ts:58-85` there read
  current status/session role, not the target issuer/whole-union checks. Transfer mapping and
  suspension are in `packages/provisioning/src/configuration-transfer.ts:622-755`; setup callers
  are `apps/server/src/boot.ts:1570-1606` and
  `packages/provisioning/src/first-setup-command-deployment.ts:299-310`.

## 8. Dashboard flow, text wireframes only

Put People / Roles beside Staff at `/manage/roles`, reachable with `person.admin` alone.
Staff editors with only `person.manage` may read the role labels needed for Staff; full editing
belongs on Roles. The direct URL has the same server gate. One page holds access and rota settings,
because there is one list of roles. Show distinct person counts per role, not summed membership counts.

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
Every current and future declared privilege, supplied by code. Authority is read-only.
Keep one active human holder with usable dashboard sign-in.
[Close] [Copy]

Edit Service lead
Name * [Service lead]
Colour [Blue]   Position [3]   [x] On the rota
Privileges [Search]
Service: [x] Take payments [x] Void [x] Refund [x] Rectify [ ] Open drawer
People: [ ] Manage staff  [ ] Manage sign-in and privileges
Attendance: [x] Correct attendance [ ] Approve own corrections
Nodes: [ ] Manage nodes, including promotion (Admin only by default; assignable)
Promotion still requires its recovery operation and all other conditions.
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
Luis (pending, sole-role holder): No role; stays pending, no session.
Remove from: Front till admission, Complaint approvers, Bill-limit approvers.
Complaint approvers becomes empty: approvals blocked.
Past authorizers and existing snapshots stay unchanged. Links read current roles when used.
Each removed membership is logged; each person with email receives a role-removal notice.
[localized form message above actions]
[Stop]                                          [Delete role]

Delete Barista
Luis, Sam: retain their other roles; listed privilege and context losses.
40 past shifts name this role. They keep the name; nobody can choose it again.
Painted staffing needs for this role are removed.
[Stop]                                          [Delete role]
```

There is one deletion confirmation and no replacement input. A sole-role holder is shown as
“No role”; preserve identity, status and credentials, with own-identity/security/data self-service
only if otherwise eligible to authenticate. They gain no operational or list rights.
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

Passive authority updates refresh labels, counts and current permissions without overwriting
dirty input. On authority loss retain the draft, explain why save is refused and offer discard/reload.
The server uses current authority even if passive updates are late. Copy requires a new custom name,
previews any ungrantable privilege and explains that no future grants or context lists are inherited.
Built-in editors show fixed names; Admin shows its read-only code-defined permissions. Server
checks also refuse rename, deletion, conversion/key changes and Admin narrowing.

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

The design is OWNER APPROVED (§11). Complete the required Claude read before plan/build; this
firing starts neither. The A760 hold has lifted (historical RUNNER: `eed41cc3c0`, #2539).
Resolve §7's unbuilt shared activity/mail dependency against the then-current source.

The later transition must cover every consumer, membership storage, live checks/link redemption,
references, transfer, clients/UI/guides and automatic recipients. Leave no singular-role/name bypass
or stale prose, including the historical permanent-permission-name claim in
`packages/identity/src/permissions.ts:1`. No fiscal or money behavior changes.

Service duties retain explicit authority and current node mode, without synthetic human roles or
reauthorizing committed fiscal/outbox facts. A1113 owns mirror dashboard/viewer removal; node work
owns synchronization and promotion. A1002 adds neither mirror UI nor node infrastructure.

## 10. Acceptance evidence

Future acceptance, not results of this documentation revision. The later plan holds detailed cases.

- Demonstrate whole-person union authorization and independent any-role policy matching, including
  empty lists, no roles and membership changes that preserve the privilege union.
- Preserve fixed built-in identities/names, ordinary editable permissions, code-defined Admin
  authority and the last usable active human Admin. Copying Admin creates only an ordinary custom
  with current constants. Role storage uses exactly the two tables in §4.
- Enforce §5's whole-target checks, live status/authority at actions and link redemption, and field/set
  stale-edit protection. Role changes retain outstanding links; no counters or role snapshots return.
- Delete/retire through §6's single impact confirmation, with complete reference removal and rollback;
  preserve no-role identity/status/credentials, other memberships, past shifts and immutable history.
- Keep the accepted permission inventory and `node.manage` merge, Admin-only by default and assignable,
  with promotion conditions, attendance limits, adjustment policies and money/fiscal invariants unchanged.
- Transfer definitions, memberships and JSON references normally; imported people stay suspended and
  later reactivation checks current whole-target authority. Privileged recipients remain distinct.
- Record §7's eight activity kinds and send its single localized membership template through the
  shared seams, including no-address logging and no permission-edit mail to holders.
- Verify complete role arrays/labels, filtering, locale sorting, drafts, leave protection, refusal
  wording, accessibility and phone layouts in both themes and languages; retain behavioral assertions.

## 11. Approval provenance and the required Claude read

**Location:** `/Users/clintongormley/waitron-campaign-k/questions.md`,
**WATCHER2026-11-07 22:51**, OWNER APPROVED the full design with changes ('y').
Recorded authority:

> 1. No change counters ('revisions') on persons, roles or lists, and no cancelling of outstanding invitation/reset/email-change links when roles change: a link already re-checks the person's current roles when used. Keep ordinary 'this changed while you were editing' protection.
> 2. Admin can do everything is a rule in the code, not stored permission rows filled in at start-up; no seed-completion record.
> 3. No copies of the approver's roles on records: recording who approved is enough.
> 4. Import carries roles across without the extra hardening; imported people stay suspended as designed.
> 5. node.promote stays merged with node.manage, as accepted on 28 October; do not split them again. Admin-only by default, assignable.
> 6. Two tables only: roles (with each role's permissions as a JSON list on its row, under the owner's 4 November short-list rule) and person-role memberships. No permission catalog table (permission ids are code constants), no grants table.
> 7. Names stay as they are: Staff, Supervisor, Manager, Admin. The single Cloud account owner (Cloud's D608) is separate from the Admin role.
> Settled as written: a person can do anything any of their roles allows; an empty role list on a device, reason or bill limit means nobody; to assign roles or change sign-in you must hold everything the person would end up with (so Managers, who hold person.admin by default, can do it for people below them).
> Then the plan (Claude read; past one page it comes to me), then the build.

**Same location, WATCHER2026-11-07 22:53, OWNER addition, verbatim:**

> The owner: 'when people are added to or removed from groups, or permissions changed we should log that in the activity log. also email people to let them know they've been added to or removed from a group.'
> 1. Activity log: every role given to or taken from a person, every permission added to or removed from a role, and creating, renaming, retiring or deleting a role is one entry in the venue's existing activity log: who did it, to whom or to which role, what changed, when. Use the existing activity log, no new log.
> 2. Email: when a person is given or loses a role, email that person (in their language) saying which role, who changed it and when. Only people with an email address on file; someone without one gets no message and the log entry still stands. Permission changes to a role do not email everyone who holds it. Use the existing email path.
> Name the log entry codes and the email template in the design; English and Spanish wording.
