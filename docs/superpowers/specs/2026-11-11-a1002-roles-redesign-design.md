# A1002, redesigned: access roles and job roles

**Status: OWNER APPROVED, 2026-11-11** ("approved", in the main-checkout brainstorm session, with the
help-bubble addition in §10). The owner also reviewed the "my call" defaults listed to them
before approving.
It replaces the [7 November design](2026-10-22-a1002-custom-roles-design.md) wherever the two
differ. Where this document is silent, that design's decision stands only if §9 lists it as kept.
The [cut 2 scope forecast](../plans/2026-11-10-a1002-cut2-scope-refresh.md) (branch
`docs/a1002-cut2-scope-refresh`, never merged) sized the old design and is superseded with it.
It also replaces the "One list of roles for access and for the rota" entry in A1308's
[tables-people.md](2026-11-02-rationalisation/tables-people.md) (owner 2026-11-04). The owner
reconsidered that in this brainstorm and chose two lists (§2). A1308's people slice therefore no
longer folds `staff_roles` into access roles. This work updates that drawing when it plans the
schema.

Decisions marked **owner** were the owner's words or explicit choices in the brainstorm. Ones
marked **my call** are the brainstorm's defaults, open to the owner, which a builder may also rely
on.

## 1. Why

A venue needs two things today's four fixed levels (Staff, Supervisor, Manager, Admin) cannot give:

1. **Job roles** — Restaurant waiter, Sous-chef, Chef, Barista — used to build the rota AND to
   decide who can sign in on which device. A person can fill several jobs.
2. **Permissions you choose** — give Manager something only Admin has today, or add an Accountant
   who can see reports and tax-filing status and change nothing — without the fixed ladder where
   every level holds everything below it.

The owner judged the previous design's 30–60 hour forecast too big. The brainstorm kept both needs and
cut what served neither (§9).

## 2. Two lists, each with one job (owner)

**Access roles** describe who someone is in the company. Each is a plain list of ticked
permissions with no order between roles. A person holds any number of them, and what they may do
is everything their access roles grant, combined at each request. A person with no access role can
still sign in to the dashboard (if they have a dashboard sign-in method) for their own account
pages only. Everything else they see there depends on the permissions they hold (owner: "it
depends like everything else on the granted permissions").

**Job roles** describe what someone does on a shift. They carry a colour and a rota position,
appear on the rota, and decide which devices list the person on their sign-in screen. They grant
**no permissions**. A person holds any number of them. The owner's reason for keeping two lists:
access is "who the person is in the company, not the role(s) they currently fill", and two people
in the same job may need different access.

Example: Marta holds Manager + Accountant (access) and Restaurant waiter (job). Luis holds Staff
(access) and Sous-chef + Chef (jobs).

**Job roles move into the core** (owner: "let's leave it in core for the moment. we can revisit
the modular aspect later"). Today they live in the staffing module (`staff_roles`,
`person_staff_roles`, in workforce's migration set). The core's device sign-in now depends on them, so
the list and its person memberships move to core. Staffing keeps its rota, shifts and painters and
reads the core list. **Staffing can no longer be switched off** (owner: "we said that Staffing
would now be in core so could not be switched off"). Its tier in `packages/composition/src/modules.ts`
changes from toggleable, so device sign-in can always rely on job roles. Staffing requires the
workforce module (attendance and the working-time record), so **workforce becomes permanent too**
(owner, 2026-11-11, asked after planning: "yes"). Making it switchable again
is a later question.

## 3. Access roles and permissions

**Built-ins (kept from the 7 November design):** Staff, Supervisor, Manager and Admin exist on every
venue. They have fixed, translated names and cannot be renamed or deleted. Staff, Supervisor and
Manager have editable permissions. **Admin always holds every permission, including ones added in
later versions. Nobody can edit its list** (owner, this brainstorm, confirming 22 October).

**Custom access roles:** typed names, trimmed, nonempty and unique under the existing Unicode
folding. Not translated. Can be copied from any role, built-in or custom. The copy takes the
current permissions only and no people. A copy of Admin is an ordinary role with today's
permissions and nothing automatic.

**No ladder.** `ModulePermission.grantedFrom` and identity's `ROLE_LADDER` go. Each permission
declares which of Staff, Supervisor and Manager hold it on a new venue. Admin needs no declaration.
The default sets are today's grants (`packages/identity/src/permissions.ts`), with these changes, all
already approved before this brainstorm:

| Change | Default holders | Source |
| --- | --- | --- |
| `person.admin` ("Manage people's roles and sign-in") on Manager | Manager, Admin | owner 2026-11-04 |
| New `adjustment.apply` — apply comps up to each reason's limit | Staff, Supervisor, Manager, Admin | 7 Nov design §2 |
| New `adjustment.approve` — approve comps beyond a limit | Supervisor, Manager, Admin | 7 Nov design §2 |
| New `workforce.self_approve`, needed with `workforce.correct` to approve your own attendance correction | Admin | owner 2026-10-28 |
| New privilege "Box administration": email-server settings and setting or confirming the box's clock, taken out of `person.admin` | Admin | owner 2026-11-10 16:37 ("Admins keep them"); label and the clock-setting half, owner 2026-11-11 |
| Restarting the box moves from `person.admin` to `system.manage`, which already covers retiring the box | Manager, Admin | owner 2026-11-11 |
| `fiscal.remedy` assignable like any other | Admin | owner 2026-11-09 13:36 |
| `sale.discount` retired (no call site) | — | 7 Nov design §2 |
| New "Change other people's email addresses" — change an EXISTING person's email; setting the email when adding someone stays with `person.admin` | Admin | owner 2026-11-11, after the Fable read (option C) |

**After go-live, a permission added by a later version reaches only Admin on an existing venue.**
Defaults apply when a venue is set up. A release that adds or splits a permission says in its
notes who needs it. Granting it to existing roles on upgrade is not built here, because the
product is not live (**my call**).

The remaining merges in the 7 November §2 table that cut 1 (#2578) did not land — for example
`mirror.create` + `node.promote` into `node.manage` — are still approved. The builder checks each
row against current source and finishes it in this work. The identifier of "Box administration" is the builder's (**my call:** in the `system.*` family).
The demo-only test inbox keeps whatever gate it has today: it is expected to be replaced by
Waitron's own email servers, so its permission is not redesigned (owner: "let's not worry about
these permissions").

## 4. Who may change what (owner)

Two rules replace the 7 November design's whole-person comparisons for role changes:

**Rule 1 — roles.** You may create, edit, copy, delete, give or take away an access role only if
you hold every permission that role carries. When creating or editing, you may tick only
permissions you hold. In practice:

- A Manager cannot take Admin away from anyone, or give it, because Admin carries permissions a
  Manager lacks. **My call:** only someone holding Admin gives or removes Admin. A custom role
  holding every current permission does not count, because Admin also covers future permissions.
- Luis holds Accountant, which grants something the Manager lacks. The Manager may still add Waiter
  or Service lead to Luis, provided each of those is within the Manager's own permissions. The
  check is on the role being added or removed, not on Luis's total. The Manager cannot remove
  Accountant from him (owner: "unless those permissions come from the role that Luis already
  holds").
- Doing any of this requires `person.admin`.

**Rule 2 — other people's sign-in.** You may change another person's email, clear their PIN,
suspend or reactivate them, remove a sign-in method, or send them a password reset or invitation
only if you hold every permission they hold. The reason is that a Manager who could change an
Admin's email could then send the password reset to themselves. A Manager can do all of this for a
waiter, and none of it for an Admin. Requires `person.admin`.

**Changing an existing person's email also needs its own permission**, "Change other people's
email addresses", Admin-only by default (owner, 2026-11-11, option C). The reason: whoever can
point someone's email at an address they read can reset that person's password, then collect any
role the person is later given, or act as an equal. Rule 2 still applies on top (**my call**).
Managers keep setting the email when they add someone new. Every email change made by someone
other than the person is logged with who made it, and a notice goes to the old address.
Accepted gap: a Manager adding a new starter could type an address they read. The real starter
then never receives the invitation, and would notice.

**PINs and email (owner, 2026-11-11, option A):** no one sets another person's PIN. An
administrator can clear it and the person chooses their own on their profile, as today. Adding a
person needs an email address, as today. (This corrects an earlier line here that said Managers
set PINs directly.) Self-service flows (your own email, password or passkeys) are
unchanged.

**Kept: the venue always has a usable Admin** (approved 2026-10-22; today's code counts active
admins only, so the "usable dashboard sign-in" half is new code). At least one active person holding Admin with a
usable dashboard sign-in method must remain after every change. That covers removing a role,
suspending someone, resetting an account to pending, removing a sign-in method, deleting a role,
and import. A change that would leave none is refused. PIN-only, pending and suspended people do
not count.

**Any change to a person's access roles expires their outstanding invitation and password-reset
links** (owner, 2026-11-11, after the Fable read). Today's code does this when someone gains or
loses Admin (`invalidatePersonAccountActions` in `packages/identity/src/staff.ts`); it now applies to
every access-role change. Cancelling on an email or status change (`revokePersonAccess`) stays.
**There is no check of who sent a link** (owner, option B): it was planned, but anyone can request a
fresh senderless invitation from the public "forgot password" page, so it protected nothing. No
`issued_by` column. This replaces the 7 November design's "links are not cancelled by a role
change". When a link is used, current status and roles decide, as today.

**Kept: "changed while you were editing."** A save compares the role set or permission set it read
with what is stored and refuses a difference, keeping the draft. No version counters or hashes.

**Job roles** are created, edited, deleted and given to people by holders of `schedule.manage`, as
staffing's job roles are today (**my call**). They grant nothing, so Rules 1 and 2 do not apply to
them.

## 5. Devices (owner)

A device profile's **"Who can sign in" list ticks job roles only.** The device's sign-in screen
lists everyone holding any ticked job role. This is the list
`listStaffAdmittedTo` (`packages/identity/src/profile-admission.ts`) builds today from the four levels.
An admin who works the restaurant floor is given a job role such as Restaurant manager. Admin
as such puts nobody on any device (owner: "if we want admins to sign in then we add them to
restaurant waiters group"). Someone with no job role appears on no device.

**Per-person allow/deny on devices is removed** (`device_profile_admission_persons` and its UI).
The owner: "i never asked for that".

Once signed in, what a person may do is unchanged in shape: their combined access permissions AND
what the device profile allows. A Restaurant manager holding Manager can refund on the restaurant
handheld if that device allows refunds. A waiter holding only Staff cannot.

**A new venue (owner):** setup creates one starter job role, **"Team"**, translated like other
starter content. It is ticked on every device profile setup creates, and the first admin holds it,
so the till can be tried straight away. It is an ordinary job role: rename it, delete it or add
others later. (The owner first chose "Staff", then "Team", to avoid clashing with the access role
Staff.)

**My call:** a device profile created later starts with every current job role ticked, matching
today's default of admitting everyone. A new job role is ticked on no existing device.

## 6. Comps and refunds: permissions and limits only (owner)

The owner's need: "waiters [have] a certain amount of leeway with comps and refunds, but there may be
limits to it, which requires getting a manager or admin involved."

- **Remove the role lists** from comps: each adjustment reason's `apply_roles` and `approver_roles`,
  and the bill-level `billApproverRoles`.
- Holding `adjustment.apply` lets you apply any active reason, up to that reason's limits (its
  amount `maxAmount` and percentage `maxPercent`) and within the bill's comp limit (`maxBillComp`).
- Beyond a limit, someone holding `adjustment.approve` enters their PIN, the same pattern as a
  refund's PIN override (`apps/server/src/tender-refund-authorization.ts`).
- A reason that must always be approved has a limit of zero. Today the database refuses a zero
  limit (`adjustment_reasons_max_amount_ck` in `packages/db/src/schema/adjustments/reasons.ts`, and
  the percentage and bill limits likewise), so those checks are relaxed to allow zero, meaning
  "always needs approval".
- Each adjustment's `policy_snapshot` stops copying role lists. It records the limits that applied
  and who approved. Example: Staff meal limit €15, Complaint
  limit €0. A waiter comps a €12 staff meal alone. Any complaint comp needs an approver's PIN.
- Accepted loss: you can no longer say "only Managers, never Supervisors, approve complaints". Every
  reason has the same approvers.
- Accepted with the starters in view (owner, 2026-11-11, option A): Supervisors hold
  `adjustment.approve` by default, so a Supervisor alone may now give "On the house", "Discount", a
  Staff meal over 50% and anything over the bill limit, which need a Manager today.

As a result, device sign-in lists are the only place a role is named outside people's memberships.
The settings-export work to translate role references inside comp settings (the scope forecast's
`referencePaths`) is not needed.

## 7. Deleting a role (owner)

- **Access role:** deleting it removes it from everyone, then deletes it. Nothing historical
  points at an access role, because approvals record who approved, not their role. Built-ins cannot
  be deleted.
- **Job role:** shifts point at their job role (`shift_assignments.staff_role_id`, and published
  shifts are never deleted). A job role no shift has used is deleted outright. One a shift has used
  is **hidden**:
  - it is removed from everyone and from every device list;
  - its planned staffing blocks are deleted, as today's delete does;
  - nobody can pick it again, and its name can be used again;
  - existing shifts, past or future, keep it and still show its name. The rota's existing warning
    about a person outside a role flags any future ones (**my call**).

  This replaces today's refusal (`staff_role.in_use`, `packages/staffing/src/staff-roles.ts`).
- **No preview of who loses what** (owner). **My call:** one confirmation saying how many people
  hold the role.
- Anyone left with no roles keeps their account, status and sign-in methods (§2).

## 8. Activity log and email (owner)

- **Activity log** (through `recordActivity`, kinds declared in `packages/db/src/activity-kinds.ts`):
  creating, copying, renaming and deleting a role of either kind; each permission added to or
  removed from an access role; each person given or losing a role of either kind. People are named
  by id only. Setup and import log the starting memberships too.
- **Email:** each person given or losing an **access** role (including by deletion) is emailed,
  if they have an email address, in their language. This uses the shared outgoing-mail queue
  (`enqueueMail`, kind `role_membership_changed`), queued in the same transaction as the change and
  keyed by the activity entry, with no new sender or retry machinery. Changing a role's permissions
  does not email its holders. **Job-role changes are not emailed for now** (owner: "maybe just in
  the activity log for now"). Setup and import send nothing.

## 9. What changes from the 7 November design

**Dropped:**

- One combined list where a role could both grant permissions and appear on the rota. There are now
  two lists (§2).
- Whole-person "combined permissions before and after" comparisons for every membership change.
  Rule 1 checks the role. Rule 2 keeps a whole-person check only for sign-in changes (§4).
- The deletion impact preview, and retirement for access roles (§7).
- Per-reason and bill-limit role lists on comps, and the settings-export remapping they needed (§6).
- Email for job-role changes (§8).
- Checking who sent a link when it is used, and the 7 November rule that role changes never cancel
  links (§4, owner after the Fable read).

**Kept as approved:** several roles per person, combined; no ladder; fixed built-in names; Admin
always holds everything; one `person.admin` covering roles and other people's sign-in; Manager
holding it by default (except changing an existing person's email, §4); custom names unique and
untranslated; copying; the usable-Admin rule; ordinary "changed while editing" refusals; activity
entries; access-role email through the shared queue; no per-person device exceptions; approval
records naming people, not their roles; pre-live reset instead of data migration; no tenant
column; no fiscal behaviour change.

## 10. Screens

Wireframes were shown in the brainstorm; they are not committed. Text description:

- **Access roles page, under People (owner chose the recommendation).** It lists the roles, and each
  role's page shows permissions as ticks grouped by area (Sales; Reports and tax; People and rota;
  Venue and system), each with a short plain label and **a help bubble saying what it covers**
  (owner, at approval). The bubble names the screens and actions the permission opens, written from
  the code that checks it, never from memory, following the help-bubble rule in `CLAUDE.md` (a
  `wt-help-tooltip` with `mode="help-mode"`). A permission the viewer does not hold is shown
  but cannot be ticked. Admin's page shows every box ticked and locked: "Admin always has every
  permission." There are Copy and Delete actions.
- **Job roles page stays under Rota**, where staffing's roles page is today, with its colours and
  order. Each of the two pages links to the other, with one line explaining the difference (**my
  call**).
- **Staff editor:** two rows of tags, "Access roles — what they may do" and "Job roles — puts them
  on the rota and on the devices that take that job". A role the viewer cannot hand out (Rule 1)
  shows without its remove control and is not offered under Add.
- **Device profile, "Who can sign in":** job-role ticks only, with no per-person rows.
- Wording in English and Spanish, with the guides updated, as for any screen change.

## 11. Storage — the builder's, within these limits

- Core gains `roles` (access roles: id, built-in key or null, name, `permissions` as a JSON list
  of permission IDs) and `person_roles` (unique on person and role), both classified `state`.
  Admin's row stores no permissions, because code supplies them. Unknown permission IDs never
  authorize, and saved lists refuse undeclared ones.
- Job roles and their person memberships move from the workforce set to core. They gain a "hidden"
  time for §7. `shift_assignments` and `staffing_blocks` keep pointing at them.
- `persons.role` is removed. The device admission table names job role IDs instead of the four-level
  enum. `device_profile_admission_persons` is removed. The comp role-list columns and
  `billApproverRoles` are removed.
- One starting migration per affected set is rebuilt (`migration-baseline rebuild --set <name>`),
  with the pre-live venue reset disclosed in the PR.
- Configuration export and import carry both role lists and device sign-in lists, mapping built-ins
  by their fixed key.

## 12. Code that checks a role by name today, and what replaces it

Found with `git grep -nE '"admin"' -- 'packages/*.ts' 'apps/*.ts'` on 2026-11-11, tests excluded.
This is a reading, not a complete audit. The builder greps for `persons.role`, `PersonRoleValue` and
`sessionRole` too.

| Site | Today | Becomes |
| --- | --- | --- |
| `apps/server/src/management-attendance-api.ts:177`, `apps/server/src/till-attendance-api.ts:224` | self-approval when role is admin | holds `workforce.self_approve` and `workforce.correct` |
| `apps/server/src/break-glass-command.ts:98`, `:129` | recovery picks a person whose role is admin | a person holding Admin |
| `apps/dashboard/src/dashboard-app.ts:2325` | menu item for manager/admin role | the permission the item's screen needs |
| `apps/server/src/management-api.ts:1195` | role field on the staff body | separate membership saves (§4) |
| `packages/identity/src/staff.ts` (last-admin counting, target-is-admin checks) | `role = 'admin'` | the usable-Admin rule, Rules 1 and 2 |
| `packages/identity/src/profile-admission.ts` | four-level admission and person exceptions | job-role admission (§5) |
| `packages/adjustments/src/policy.ts`, `settings.ts`, `provisioning.ts`, `dashboard/reasons-screen.ts`, `packages/country-es/src/demo/reasons.ts` | role lists | permissions and limits (§6) |
| `packages/provisioning/src/venue-apply.ts:236`, `:560` | setup finds the admin, and admits device profiles, by level | the Admin membership; job-role admission (§5) |
| `apps/till/src/widgets/box-time-dialog.ts:176` via `apps/server/src/adjustments-api.ts:332` | lists admins through the comp-approver endpoint | holders of Box administration |

## 13. Left to the builder

The new privilege's identifier; table and column names; how staffing reads the moved job roles;
how the plan is cut into pull requests; the exact permission labels and help text; the activity
kind names. The plan states its own size. The owner suspected the earlier forecast was exaggerated,
so the plan sizes this design from current source and says what it counted.
