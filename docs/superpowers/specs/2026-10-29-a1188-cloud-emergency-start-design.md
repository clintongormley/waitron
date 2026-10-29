# A1188: starting the venue in the cloud when the box has died

**Approved by the owner, 2026-10-29, with its defaults; nothing is built yet.** Building waits for
A1018's build approval, A947's strip and Cloud's half (§11). Revised the same day after a fresh
review (one critical finding, ten important, thirteen minor), and again after a narrow check of its
claims (five important, thirteen minor). **Revised again on 2026-10-29 for the owner's answers:**
§13 item 1 is now "administrators by default, and a venue may give the permission to other roles"
(the owner, about 09:25), and the device agent that lifts the first evening's limit is A1175's
Android app (the owner, about 09:30). Decisions marked **(owner)** quote the owner. Decisions marked
**(default)** are this design's, open to the owner's correction. Everything else is a fact about the
current code or documents, with a pointer, and says whether it was read or run.

## What the owner asked for

The backlog entry (`docs/backlog.md`, A1188, owner 2026-10-29):

> The tills learn the venue's cloud address and show the emergency link to an administrator when
> the box disappears. The locked copy Cloud restores after a valid emergency code offers only an
> administrator sign-in; a manager holding `node.promote`, signing in with password and
> authenticator code, makes A1018's declaration that the box is off, and only if the Cloud owner
> agreed in advance.

It is Waitron's half of the Cloud billing design's §7, "Emergency hosting when the owner cannot be
reached" ([Cloud billing design](https://github.com/waitron-io/waitron-cloud/blob/4064f3044f4826235e399070e564a94e4dd7bdd0/docs/superpowers/specs/2026-10-29-cloud-billing-design.md#7-emergency-hosting-when-the-owner-cannot-be-reached),
Cloud main `4064f3044`, merged as Cloud #705). The scenario there, in the owner's framing: the box
dies, the owner is away with no internet, and an administrator at the venue has to bring the venue
up in the cloud without being able to sign in to the owner's Cloud account.

The entry says "administrator" in two places and "a manager holding `node.promote`" in a third.
Today only administrators hold that permission, and no venue can give it to anyone else (see "What
exists today"). **(owner)** "Allow the permission to be assigned to other roles too, so it's just
admins by default" (2026-10-29, §13 item 1). So in this design the person who starts the venue is
**someone holding `node.promote`**: an administrator at every venue, and anyone else whose role the
venue has given it to once that is possible (§13 item 1 says when).

Cloud's half (the owner's advance permission, the emergency code, the page that asks for it, the
restore and the charging) is Cloud's to build (Cloud billing design §10). This design covers what
Waitron builds, and names what it needs Cloud to agree (§9).

## Words used here

- **The box**: the venue's server at the venue. The design calls it the box even where A1018 says M1.
- **Level 2**: Cloud's paid per-venue level, called "Connected": remote access, off-box backups with
  the live stream, and "the possibility of failing over to the cloud" (Cloud billing design §2,
  `:75`).
- **The staff address**: the Cloud name that remote access already uses to reach the box from
  outside the venue (`docs/developers/cloud-connection.md:190-192`).
- **The emergency address**: **(default)** a Cloud name of its own for this one purpose, separate
  from the staff address (§4 says why). It leads to Cloud's code page, and later to the copy below.
  It never leads to the box. This departs from the Cloud billing design, which makes it "the venue's
  own remote-access address" (§7, item 4); §9 asks Cloud to agree the change.
- **The emergency code**: a code Cloud makes for the venue when the owner switches the emergency
  start on (Cloud billing design §7, item 2). It starts the copy; it signs nobody in.
- **The locked copy**: a Waitron server Cloud starts from the venue's live backup stream after a valid
  code. It sells nothing, prints nothing, takes no payments and files nothing with the tax agency
  (AEAT). Its only pages are a sign-in, then the declaration.
- **The declaration**: A1018's emergency declaration — the box is switched off, nobody else is
  starting the venue elsewhere, and the missing last minutes are accepted
  ([A1018 §4](2026-10-23-a1018-simple-handover-design.md#4-emergency-handover-and-the-first-two-owner-points)).
- **`node.promote`**: the permission to switch which machine runs the venue. A1018 §7 and A947 §6.2
  already make it the permission for the emergency declaration. The pages call its holders "someone
  allowed to switch the venue's server". A1002's permission list, which the owner accepted on
  2026-10-28, renames it `node.manage`, together with the permission to add a mirror (A1002 §2);
  this design means whichever name it has when built.
- **Authenticator app and recovery codes**: the phone app that shows a new six-digit code every
  half-minute, which a person can set up for their Waitron sign-in; and the single-use codes a
  person is given when they set it up, for when the phone is lost.
- **Node identity**: a machine's own id and signing key, which it uses to sign the venue's list of
  machines. It is not the fiscal installation name that appears on invoices.
- **Operation id**: one id for the whole start, sent with every message about it, so that a message
  sent twice is recognised as the same start and never counted as a second one.

## The evening this is for

Harbour Kitchen, a Saturday. The owner, Lucía, is hiking with no signal. At 21:41 the box's power
supply fails. The bar's internet still works.

1. The tills show the red strip A947 §6.1 designs: the box does not answer. Because the owner left
   the emergency start switched on, the strip on every till also offers **Start the venue in the
   cloud** (mock-up 1). Nora, the administrator on shift, holds `node.promote`, as every
   administrator does (§13 item 1).
2. That opens a dialog with the emergency address as text and as a QR code, what is needed and what
   will happen (mock-up 2). Nora opens it on a phone, from the QR code; the dialog says the till's own
   browser can open it too.
3. Cloud's page asks for the emergency code. Nora takes it from the venue's recovery pack (A1187) in
   the office. Cloud checks it, starts the locked copy from the live stream (it is running at 22:01),
   and sends Nora on to the copy's address.
4. The copy shows one page: a sign-in (mock-up 3). Nora signs in with her email, her own Waitron
   password and the code from her authenticator app.
5. The copy shows the declaration (mock-up 4): the copy's last change is from 21:39, and Cloud last
   heard from the box at 21:41; anything after 21:39 is missing. Nora unplugs the box, ticks the
   three statements and presses **Start the venue here**. The page shows the daily price. Cloud
   confirms, starts charging and emails Lucía at once with Nora's name and the time.
6. The copy becomes the venue's server, with a new installation name and a new invoice series, as
   every restore and switch does (CLAUDE.md §5). Nora moves each till to it and approves each one
   (§7), and the bar trades again, with cash or a standalone card terminal.

If Nora's code is wrong, nothing starts. If Nora signs in but does not hold `node.promote`, the copy
says why and offers the owner's Cloud sign-in in its place (§5). If she has no authenticator app set
up, the sign-in fails with the same sentence as a wrong password, and a line under the form says an
authenticator had to be set up before the box failed (§5). If nobody makes the declaration within 30
minutes, Cloud shuts the copy down and charges nothing (§5).

## Who decides what

The integration contract already splits the two powers: "Cloud owns permission to use its services.
Waitron owns permission to become the active primary. A Cloud login, restore grant or fresh machine
credential alone must not activate trading or change fiscal identity"
([contract, Identity and authority](https://github.com/waitron-io/waitron-cloud/blob/4064f3044f4826235e399070e564a94e4dd7bdd0/docs/waitron-integration-contract.md#identity-and-authority),
`:95-97`). This design keeps that split exactly:

| Step | Who checks it | What it proves |
| --- | --- | --- |
| The owner switched the emergency start on | Cloud | The owner agreed in advance to pay for hosting started this way |
| The emergency code is valid | Cloud | Whoever typed it was given the venue's code; it starts a locked copy, nothing more |
| Password plus authenticator code | A new sign-in inside the locked copy (Waitron), against the venue's own staff records | Who the person is |
| The person holds `node.promote` | The locked copy (Waitron) | The venue's role list lets this person switch its server |
| The declaration | The locked copy (Waitron), recorded before anything changes | The box is off, nobody else is starting the venue, the missing minutes are accepted |
| Charging starts | Cloud, told by the copy at the declaration | — |

So the Cloud-account-to-venue mapping that A1018 §7 leaves open ("Cloud-account authority must map
to this venue permission") is not needed on this path: the person signs in
to Waitron itself, inside the copy, and Waitron checks its own permission. The contract's own words
on that mapping still hold for the owner's Cloud-account path, which this design does not change.

**What the owner is trusting Cloud with.** Two things, both plain:

- **Cloud's machines can open the venue's secrets, at all times.** Cloud keeps the venue's backup
  keys, and "its machines may use them to restore" (Cloud billing design §7, `:352-354`), whether or
  not an emergency copy is running. The restored state carries the venue's vault key (contract "Data
  and secrets", `:678`; `apps/server/src/state-secrets.ts:11-18`), which opens the AEAT certificate
  and the card provider's keys (A947 §4, item 1), and the key that opens every person's
  authenticator secret is derived from the same restored state (`apps/server/src/account-key.ts:9-13`,
  `apps/server/src/boot.ts:1503-1507`; read, not run). The copy needs that last key to check Nora's
  code at all. What this design adds is a copy that puts those secrets to use on Cloud's machines.
  §4's promise that a password never passes through a page Cloud can read is about Cloud's front
  door only; the copy itself runs on Cloud's machines.
- **A Cloud copy can file with AEAT for the venue** once a person holding `node.promote` signs in
  and makes the declaration. Waitron's sign-in stops a stranger who reaches the copy's pages. It
  cannot stop someone who controls Cloud's machines: those machines hold every key the step needs
  and run the program that checks the sign-in. What stops a Cloud operator is Cloud's own controls,
  and the owner's trust in them, not Waitron.

## What exists today

Read at `main` `b39e13526`, not run, unless a line says otherwise.

| Piece | Today |
| --- | --- |
| `node.promote` | Declared at `packages/identity/src/permissions.ts:38`. **Only the administrator role holds it** (`admin: ALL`, `:84`); the manager role's list (`:58-77`) does not. Each role's permissions are a fixed list in the code (`ROLE_PERMISSIONS`, `:80-85`), and `roleHasPermission` reads only that list and the permissions modules register at start (`:125-133`). No table stores permissions per venue (none of the tables in `packages/identity/src/schema/` does; the one that names roles, `device_profile_admission_roles`, only narrows which roles a device admits; a search of `packages` and `apps` for `role_permissions`, `rolePermissions` or `grantPermission`, tests left out, finds nothing), so **no venue can give its managers `node.promote`**; only a change to the code, for every venue, can. Run: loading `roleHasPermission` with `node --experimental-strip-types` printed `staff false`, `supervisor false`, `manager false`, `admin true` for `node.promote`. |
| A fresh sign-in for one action | `withAuthenticatedOperation` (`apps/server/src/operation-authentication.ts:84-124`) takes a person id (not an email), a password and an optional authenticator code (`:95-102`), opens a dashboard session, checks one permission, and **ends the session in the same step** (`:107-120`, `endManagementSession` at `:119`), before the action runs. Opening a session inserts a row in the venue database and ending it updates that row, stamping when it ended (`packages/identity/src/management-session.ts:34-36` and `:110-114`; the `management_sessions` table, `packages/identity/src/classification.ts:35-39`). It accepts only `node.promote` and `mirror.create` (`:88`). |
| Authenticator codes | Checked by `verifyTotp` (`packages/identity/src/totp.ts:17`); the secret is `persons.totp_secret`, stored encrypted (`packages/identity/src/schema/persons.ts:42-43`) in the venue database, so it is in every backup and every copy restored from one. The code is asked only of a person who has one set up (`packages/identity/src/manager-login.ts:105-107`). The dashboard's email sign-in answers `totp.required` when such a person leaves it out (`:142-143`); the by-id sign-in the promote route uses answers `password.invalid` instead (`:146-160`). Every other refusal is `password.invalid`, with the cause kept in a log-only `reason` (`:71-73`). |
| Recovery codes | Accepted in place of the authenticator code (`manager-login.ts:112-115`); the dashboard sends one when asked (`apps/dashboard/src/screens/login-screen.ts:655`). Using one marks it used in the venue database (`packages/identity/src/mfa.ts:82-98`). |
| Passkeys | Belong to the name set in `WAITRON_MANAGEMENT_RP_ID` (`deploy/README.md:653-660`). Remote-access setup sets that to the staff address's name (`docs/developers/cloud-connection.md:190-192`). Asking for a passkey writes a one-time challenge row to the venue database (`packages/identity/src/passkey.ts:232-235`). |
| Wrong-password limits | The dashboard's sign-in counts wrong tries per email, in the server's memory (`apps/server/src/management-api.ts:908`, `packages/provisioning/src/password-throttle.ts:57-64`). The promote route has no such limit (`grep -i throttle` over `apps/server/src/promote-api.ts` and `operation-authentication.ts` finds nothing). |
| The emergency declarations | The recovery entry takes `oldBoxGone` and `soleRecovery` (`apps/server/src/recovery-entry.ts:16-17`) and maps them to `oldMachineOffline` and `noParallelRecovery` (`:69-74`), which reach the fiscal recovery approval (`packages/fiscal-verifactu/src/allocation-envelope.ts:42-53`). Today's restore takes both statements **before** the copy is placed (`apps/server/src/recovery-preparation.ts:335-338`; `apps/server/src/restore-request.ts:212-217`). |
| Which machine a restore becomes | **The box itself.** A restore reads the box's node id from the backup's `trading.env` (`apps/server/src/restore.ts:717-733`) and the recovery path restores as that node (`recovery-preparation.ts:310-315`). The contract says so: "The current stream and archive consumers both recover the source local node identity … This supersedes the older design split that expected a stream restore to claim a new local node" (contract `:687-690`). |
| What authorises a restore today | The node recovery key: an emergency ("break-glass") secret, checked against a stored check value in the restored database (`withRecoveryKeyAuthority`, `operation-authentication.ts:39-62`; used at `recovery-preparation.ts:318-323`). It is only compared with that value (`:60-61`) and opens no secret; it is the authority to start a new fiscal identity. |
| A restore check that activates nothing | Built: Waitron A850 (#1939), a data restore check that "must not activate a primary, contact fiscal or payment services, or send customer notifications" (contract "Recovery, verification and failure handling", `:740-748`). |
| A server that does not sell | A mirror (a server following another's copy) or a fenced node (one told to stop selling) runs behind `readOnlyGate`: every write is refused with `node.read_only` except the promote routes and retire (`apps/server/src/boot.ts:1662-1680`, `apps/server/src/read-only-gate.ts:28-39`); print and device routes are not mounted (`boot.ts:1933-1936`); it does not accept sales (`boot.ts:1844`). A mirror becomes primary through `promoteMirrorToPrimary` (`apps/server/src/promote.ts:169`), with a restart. **No mode serves only a sign-in.** |
| How a till finds its server | `ServerRouter` (`apps/till/src/api/server-router.ts:44`) lists the page's own address plus the addresses the box sends in the till's start read (`GET /api/till`, the first thing a till asks when it starts; `apps/till/src/till-app.ts:4259`, from `routableServers` in `packages/membership/src/fence.ts:54-60`), cached in the device's storage under `waitron.servers` (`server-router.ts:20`, replaced by `setServers` at `:86-90`). Every 5 seconds it asks each one `GET /api/node` and **moves by itself** to the one accepting sales with the highest term (`:64`, `:121-130`, `#move` at `:144-149`). A term is the count, in the venue's signed list of machines, of how many times the venue's server has changed. With none accepting sales, it waits and keeps asking (`:124`). `GET /api/node` answers with the server's node id and whether it accepts sales (`apps/server/src/node-api.ts:41-48`). |
| What a till does when its router moves | Signs the person out, drops the drafts and starts again against the new address (`till-app.ts:2169-2185`). |
| What a till shows when no server answers | A status line with **Check again** on the sign-in screen (`apps/till/src/screens/till-lock-screen.ts:391-413`) and a banner mid-shift (`till-app.ts:19255-19258`), worded by `server.unreachable` and its neighbours (`apps/till/src/i18n/strings.ts:1769-1776`). A947 §6.1's red strip is designed, not built (A947's slices 3a onwards are open, `docs/backlog.md`). |
| Signing in at a till | A PIN sign-in is a request to the server (`apps/till/src/api/client.ts:2695-2696`), so with the box dead nobody new can sign in at a till. |
| A till that reloads | Has nothing to load: the till registers no offline copy of its page (`apps/till/src/trust-check.ts:43-45` registers a probe script no box serves). |
| A till's identity | An `httpOnly`, `SameSite=Strict` cookie scoped to the venue's own domain (`apps/server/src/device-session.ts:53-67`). A browser does not send it to a different site, so a till reaching a Cloud address arrives there as a device the copy does not know (§7). |
| The venue's Cloud address | **Not stored anywhere in the code.** The staff address exists only as `WAITRON_MANAGEMENT_ORIGIN` and an argument to the certificate request (`apps/server/src/cloud-remote.ts:24-25`; `docs/developers/cloud-connection.md:190-192`). Nothing sends it to tills. The setup doc tells operators they may also point the staff address at the box on the venue's own network (`cloud-connection.md:200-202`), as the contract allows (`:140-141`). |
| The billing values from Cloud | Not built. They are A1185 (`docs/backlog.md`, open), which waits for Cloud's billing section of the contract. |
| The emergency code | Not in the code ("emergency" there means the fiscal emergency identity, `allocation-envelope.ts:62`). |

## 1. What the box learns from Cloud, and what it keeps

**(default)** The box learns three facts from Cloud alongside the billing values that A1185 will
fetch for display (Cloud billing design §5, "What the box learns"; A1185 is open and not built, so
part 1 below shares its groundwork):

- whether the emergency start is open: the owner's setting is on, level 2 is active and a payment
  method is on file (Cloud billing design §7, last paragraph);
- the emergency address;
- the hosted daily price, to show beside the start (mock-ups 4 and 5).

It **never stores the emergency code**. The dashboard fetches it from Cloud when a person asks to see
or print it (§2), so the code is not in the venue database, its backups or the locked copy itself.
Like the billing values, none of this switches anything on the box (Cloud billing design §5: "The box
never uses these values to switch anything on or off").

The box also keeps its own Cloud installation credential, as today. If it ever comes back after the
venue has started in the cloud, that is how it asks Cloud what happened (§6, "When the box comes
back").

## 2. The dashboard: see, save and print the code (mock-up 5)

The Cloud services screen gains one card, **Emergency start in the cloud**, shown when the venue is
connected to Cloud:

- what it is, in two sentences, with the daily price;
- the emergency address, and the code hidden behind **Show code** (fetched from Cloud on press),
  with **the date the current code was issued**. The owner can replace the code from the Cloud
  account (Cloud billing design §7, `:389-390`), which makes every printed pack out of date; the date
  lets a person check a printed pack against the card;
- **who can start it**: the people who hold `node.promote` **and** have an authenticator app set up,
  by name; and, in one muted line, anyone who holds `node.promote` but has no authenticator — they
  could not sign in to the copy (§5). This is the one place a venue finds out before the evening that
  nobody on shift can do it;
- **Print recovery pack**, which prints A1187's single pack with the address, the code and its date in
  it. Until A1187 lands, it prints a one-page card with the three.

**(default) Who sees the card's code:** people holding `node.promote`. Cloud's design says
"Admins can save or print it" (§7, item 2), and `node.promote` is what an administrator has (and
anyone whose role the venue gives it to, §13 item 1).
When the setting is off, the card says so and that the owner switches it on in the Cloud account
— that is where the owner already manages billing (Cloud billing design §5).

## 3. The till: the link when the box disappears (mock-ups 1 and 2)

The till shows the link only inside A947 §6.1's strip, the one that appears when the box has not
answered for 20 seconds — A1188 adds to that strip; it does not build a second one. So this part
waits for A947's strip.

- **Who sees it (default): everyone at the till**, as **Start the venue in the cloud**, with no
  role in the button's words: which roles may use it differs by venue once a venue can give the
  permission to other roles (§13 item 1), so the dialog says who. The owner's entry says "show the
  emergency link to an administrator"; this departs from it, for one reason. Signing in at a till needs the box (see "What exists
  today"), so once the box is dead, nobody can sign in. A link shown only to a signed-in holder of
  `node.promote` would appear only on a till where such a person happened to be signed in when the
  box died; on most evenings nobody would see it. Showing the address hides nothing worth hiding:
  the address alone starts nothing without the code (§8, first row). §13 question 4 offers the
  owner's literal version instead.
- **Where a venue has a spare box**, the spare's switch (A947 §6.1, shown to people holding
  `node.promote`) comes first and the cloud start second, because a spare box keeps the venue's
  tills, printers and card readers on the venue's own network.
- **What it does:** opens a dialog with the emergency address as text and as a QR code, the three
  things the person will need (the emergency code, their password, their authenticator app or a
  recovery code), who can do it, and what happens next in two lines. **(default)** "Who can do it"
  names the roles that hold `node.promote` at this venue: "Only an administrator can start it." at
  a venue that has given the permission to nobody else, which is every venue until roles can be
  edited (§13 item 1); "Only an administrator or a manager can start it." at a venue that has
  given it to its managers. It names roles, never people.
  **Open here** sends this till's browser to the address; **Close** goes back. A phone scanning the
  code is usually quicker: the till is then free for §7.
- **What the till keeps:** the emergency address, "open" and the names of the roles holding
  `node.promote` (venue settings, not personal data) from the start read, refreshed when the
  box's setup changes like the till's other start-read values (the box sends `setupRevision`, a
  fingerprint of its setup, and a till that sees a new one reads its setup again,
  `till-app.ts:9978-9979`; CLAUDE.md §3). **(default)** These values are fields of the till's
  setup, so a change in §1's facts counts as a setup change: `setupRevisionOf` fingerprints every
  field of the setup (`apps/server/src/till-setup.ts:145-146`), and the start read sends that
  fingerprint (`apps/server/src/till-api.ts:1512`). An owner switching the start off or on in the
  Cloud account, or a venue giving the permission to another role, then reaches the tills the way
  their other setup changes do, without a reload. A
  till that reloads while the box is dead loads nothing at all (see "What exists today"), so the
  recovery pack (A1187) is the way in for a venue whose tills were all reloaded.
- **Before the dialog opens**, the till checks the box once more, as A947 §6.2 does for the spare:
  it asks `GET /api/node` at the box's own addresses, with a check of its own that never changes the
  router's list. If the box's node id answers at any of those, the box is alive and the dialog is not
  offered.
- **A venue that points the staff address at the box on its own network** (allowed by the contract,
  `:140-141`, and described in `cloud-connection.md:200-202`) is why the emergency address is a
  separate name (§4). Were it the staff address, a phone or till on the venue's Wi-Fi would be sent
  to the dead box; the dialog would then have to say "use mobile data".

## 4. Cloud's code page, the emergency address, and the rules Waitron needs

The code page is Cloud's (Cloud billing design §7, item 5): it asks for the code first, says nothing
about the box until a valid code is entered, and rate-limits wrong codes. Waitron needs two things
from how it is placed.

**The person's Waitron password and authenticator code travel only to the locked copy, never
through a page Cloud can read.** The Cloud design says "Cloud never checks staff passwords itself"
(§7, item 7). The hosted design already gives staff traffic that property: "Cloud passes staff TLS
through to Waitron, which retains its private key and staff permission checks"
([hosted design, Reach Cloud and the devices in your venue](https://github.com/waitron-io/waitron-cloud/blob/4064f3044f4826235e399070e564a94e4dd7bdd0/docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md#reach-cloud-and-the-devices-in-your-venue),
`:268-270`). So the code page, which Cloud itself answers, and the copy's sign-in, which Waitron
answers, cannot both be the same page at the same address while Cloud holds the code page's
encryption. **(default)** The emergency address serves the copy (passed through to Waitron); Cloud's
code page lives on a Cloud address of its own, and the emergency address answers with a plain page
linking to it while no copy is running. This promise covers Cloud's front door only; the copy itself
runs on Cloud's machines with the venue's keys ("What the owner is trusting Cloud with", above).

**The emergency address is never the staff address. (default)** A venue may point the staff
address at the box on its own network ("What exists today"). On such a venue the staff address,
typed on the venue's Wi-Fi, reaches the dead box, and after the start, tills on the Wi-Fi could not
reach the copy there. A Cloud name used only for emergencies, which no venue points anywhere
locally, avoids both. The cost: one more name for Cloud to run and certify, and a departure from the
Cloud billing design's item 4. How Cloud arranges it is Cloud's; the rules go in the shared contract
(§9).

## 5. The locked copy

**(default) Which path this is.** The hosted design names two ways back from "one local box fails":
a cold restore, or "an explicitly selected A1018 emergency", each with its own checks (hosted design
`:178`). This is the **A1018 emergency handover, from the box to Cloud**, and it keeps A1018's
checks: the explicit declaration that the box is shut down, the box's restricted role, and the copy's
sole responsibility for AEAT, all recorded before activation (A1018 §4). It does not use a cold
restore's checks.

**(default) How it starts.** A new way for a Waitron server to start: **locked**. Cloud starts it with
the venue's live backup stream and the backup key Cloud already holds (Cloud billing design §7,
`:352-354`; contract `:678`). It asks the person for no key: the owner said "we don't ask for the
recovery key, we wouldn't if the user were starting failover on cloud" (A947 §6.2, `:628-629`), and
the Cloud design says "Restoring needs no key from the person: Cloud holds it" (§7, item 6). The
node recovery key ("What exists today") is not needed, because the authority to activate comes from
the `node.promote` sign-in and the declaration, as on the promote route; the copy is placed with no
fiscal authority at all, in the same shape as A850's restore check that activates nothing ("What
exists today").

**It must start as a machine of its own, and today's restore cannot do that.** A1018 §2 says "Do not
copy M1's private node identity", and the contract's A1018 section says the replacement "retains its
own node key" (contract `:1455-1456`). Today's restore does the opposite: it becomes the box ("What exists
today"). So this design depends on three pieces of work that are not built (§11, part 0):

- a stream restore that takes a new node identity instead of the box's (a change to `restore.ts`'s
  identity step, `:717-733`, and the recovery path that uses it);
- a contract amendment, since the contract's current text says a stream restore recovers the box's
  identity (`:687-690`);
- A947's separation of each machine's own signing key from the venue database (A947 §4, item 2;
  the contract says the same must be qualified before build, `:1459-1460`).

**Taking the statements after placement is new.** Today's restore takes the box-is-gone and
nobody-else-is-recovering statements before the copy is placed ("What exists today"). Here the copy
is placed first and the statements come at the declaration (§6).

Once placed, the copy serves only:

- the sign-in page (mock-up 3) and, after a sign-in, the declaration page (mock-up 4);
- the health and node-status answers Cloud and tills read (`GET /api/node` says it is not accepting
  sales and gives the copy's own node id, `node-api.ts:41-48`).

Everything else is off, the same way a mirror's is (`readOnlyGate`, `boot.ts:1662-1680`) and more:
no till, dashboard, device or print routes; no filing pass, so nothing is sent to AEAT; no card
provider calls; no outgoing email; and **no backup stream of its own into the venue's bucket**, so a
copy that is never started cannot overwrite the box's live stream. After it is placed, it adds
nothing to its database until the declaration: the sign-in below is held in memory.

**The sign-in. (default)** New code, not `withAuthenticatedOperation`: that function cannot hold a
sign-in across two pages, because it ends its session in the same step that opens it
(`operation-authentication.ts:107-120`); it takes a person id rather than an email (`:95-102`); and
opening and ending its session write rows to the venue database ("What exists today"). The new
sign-in:

- asks for email, password and the authenticator code, all three required, and reuses the same
  password and code checks the dashboard uses, but not the database session they end in;
- **requires an authenticator** (owner's words for this item: "signing in with password and
  authenticator code"). Today's checks ask for a code only from a person who has one set up
  (`manager-login.ts:105-107`), so refusing a person without one is a new check;
- **accepts a recovery code in place of the authenticator code**, as the dashboard does ("What
  exists today"), so a person whose phone is lost can still start the venue. Using one normally
  marks it used in the database (`mfa.ts:82-98`); the copy instead marks it used in memory and
  writes that with the declaration (§6, step 4). If the copy is never started, the code stays unused
  in the venue's records;
- is **held only in the copy's memory**, writes nothing, and lasts **10 minutes**, or until
  activation or the copy stops, whichever comes first;
- **offers no passkey**, for two reasons: the owner asked for "password and authenticator code", and
  asking for a passkey writes a one-time challenge row to the venue database ("What exists today"),
  while the copy writes nothing before the declaration. (Which name a venue's passkeys belong to
  varies: a venue set up for remote access registers them for the staff address's name,
  `cloud-connection.md:190-192`. This design does not rely on either.) The page says, in one line,
  that passkeys are not offered here;
- **limits wrong tries per email, counted in the copy's memory.** This is new: the promote route has
  no limit, and the dashboard's is per email in its own server's memory ("What exists today"). A
  count in memory starts again with every new copy, so the real limit on guessing is Cloud's limit
  on how often valid codes start copies (§9, item 9).

**The refusals** (CLAUDE.md §3: a refusal explains what happened and what each choice does, and
offers any needed owner sign-in there; a sign-in refusal never reveals whether an account exists):

| Case | The page says | Choices |
| --- | --- | --- |
| Wrong email, password or code, **or a person with no authenticator set up** | The sign-in failed (the dashboard's one sentence; it never says which). Under the form, always: "You need an authenticator app, set up in Waitron before the box failed. You cannot set one up here." | **Try again**; **Sign in to the owner's Cloud account** (the owner can start hosting there, Cloud billing design §7) |
| Signed in, no `node.promote` | "Your role does not allow you to start the venue on another machine." (Both factors had matched, so this reveals nothing to a stranger.) | **Sign in as someone else**; **Sign in to the owner's Cloud account** (the owner can start hosting there, Cloud billing design §7) |
| The sign-in is more than 10 minutes old | "Your sign-in has expired. Nothing was started." | **Sign in again** |
| The owner's setting is off, or level 2 lapsed (§6 step 2) | "The owner has not allowed emergency starts for this venue." or "The venue's Cloud services have lapsed." | **Sign in to the owner's Cloud account** |
| Cloud heard from the box in the last two minutes (§6 step 2, §8) | "The box was still in touch with Waitron Cloud at 22:04. Check it before starting here. Nothing was recorded." | **Check again** |
| The copy's clock and the person's device disagree (§6 step 3) | "This machine's clock and your device's clock disagree, so the venue cannot start here yet. Check that your device sets its time automatically. Nothing was recorded." | **Check again** |
| Cloud did not answer (§6 step 2, before the declaration) | "Waitron Cloud did not answer, so the venue cannot start here yet. Nothing was recorded." | **Check again** |
| Cloud did not answer (§6 step 5, after the declaration) | "Your statement is recorded, but Waitron Cloud has not confirmed it. The venue starts here once it does." | **Check again** |
| Activation fails after Cloud's confirmation (§6 step 6) | "Waitron Cloud has confirmed your statement and charging has started, but the venue could not start here yet." Then what failed. | **Check again** (repeats step 6 under the same operation id) |

Giving a person with no authenticator the same sentence as a wrong password matters because the page
is on the internet: a distinct answer would tell a stranger holding the code that a guessed
password is right. The dashboard card (§2) warns the venue ahead of time instead.

**The time limit.** The page shows when the copy shuts down (mock-up 3), 30 minutes after Cloud
starts it. Cloud stops it; nothing is charged; the next valid code starts a new copy from the stream
as it then is. Cloud's confirmation of the declaration (§6, step 5) cancels the stop. **This departs
from Cloud billing design §7 item 6**, which ends the stop at a sign-in ("If nobody signs in within
30 minutes, the copy shuts down", `:378-379`). Here the sign-in is held in the copy's memory, so
Cloud cannot see it, and this design keeps the copy alive until Cloud confirms the declaration
instead. §9 asks Cloud to agree the change.

## 6. The declaration, and what happens after it

The copy shows A1018's emergency screen (A1018 §4, "Proposed screen warning"), worded for this
case (mock-up 4). Its top line names the person signed in and says they are allowed to switch the
venue's server, whatever role gave them that (§13 item 1). It asks for nothing A1018 does not:

1. **The box is switched off.** Unplug it. The page says why in one sentence: a box that only lost
   its internet can still be selling.
2. **Nobody else is starting the venue elsewhere** — no spare box (A947), not the owner from the
   Cloud account. This is the existing `noParallelRecovery` statement on the promote route
   (A947 §6.2 names it; promotion requires it, `apps/server/src/node-operation-preparation.ts:139`).
3. **The missing minutes are accepted.** The page shows the copy's last change and the last time
   Cloud heard from the box, and says what A1018 §5 says comes back later: only the invoices, if the
   box's disk returns.

Then the page shows the daily price and says the owner is emailed at once (Cloud billing design §7,
item 8), and **Start the venue here** stays disabled until all three are ticked.

**The clocks.** The new installation name is chosen from **the copy's** UTC minute, after another
machine's clock agrees within 30 seconds (CLAUDE.md §5). In the copy the other clock is the person's
own browser — the device that sends the declaration — exactly as the till's browser is the second
clock on an A947 switch (A947 §6.2, item 2). The copy has the internet, so AEAT can be a third clock,
as A947 §6.2 item 2 designs for a switch with the internet up. **(default)** The page compares the
clocks when it opens and says so in one line when they agree, as the mock-up shows; the comparison
that counts is made again when the person presses, at step 3 below, **before Cloud is told and
before charging starts**. A disagreement there stops the start with **Check again**, with nothing
recorded and nothing charged, and no confirmation gets past it (A947 §6.5's rule). Which wait the
copy then takes — a restore's 90 to 150 seconds (CLAUDE.md §5) or a switch's wait for the next
minute (A947 §6.2) — is left to A1018's build. Either happens at step 6, after Cloud has cancelled
the 30-minute stop, so neither can run into it.

**What pressing it does, in order (default):**

1. The copy re-checks, in one step, that the sign-in is less than 10 minutes old, that the person
   still holds `node.promote`, and that the copy is still locked.
2. It asks Cloud whether the owner's emergency setting is still on, the venue's level 2 still
   active (Cloud billing design §7: "open only while the venue's level 2 is active and a payment
   method is on file"), and when Cloud last heard from the box. A "no", or a box heard from within
   the last two minutes (§8), stops here, with the refusal of §5. **No answer from Cloud stops here
   too**, with **Check again**: the copy cannot start charging, and without the owner's consent it
   does not trade. Nothing has been recorded or charged yet.
3. It compares its clock with the person's browser, and with AEAT's when AEAT answers (above). A
   disagreement stops here with **Check again**. Nothing has been recorded or charged yet.
4. It records the declaration, as A1018 §7 lists it: the statements, the accepted last copy, the
   reason, the venue, the person, both machines, the time, the operation id — before anything
   else changes. A recovery code used to sign in is marked used in the same step.
5. It tells Cloud the declaration is made, under the operation id, and **waits for Cloud's
   confirmation**. Cloud's confirmation cancels the 30-minute stop, starts charging, emails the owner
   (§7, item 8), and withdraws the box's Cloud services: its remote access, and its backup stream
   into the venue's bucket, which Cloud refuses from then on. If Cloud does not answer, the page says
   so (§5) and asks again under the same operation id, so a repeated message never charges twice.
   If the 30-minute stop comes first, Cloud stops the copy: nothing was activated and nothing is
   charged, and the declaration recorded in that copy goes with it.
6. Only after Cloud's confirmation, it activates under A1018's emergency path: its own new node
   identity, a new installation name, a new chain and invoice series, and sole responsibility for
   AEAT, including filing the box's copied originals in the box's own fiscal identity (A1018 §§4, 6).
   It then opens a backup stream of its own, as a new generation (a separately named run of
   backups) in the venue's bucket, never continuing the box's (hosted design `:190`: "Preserve
   generation ownership and never move a copied pointer backward"). **(default)** This step takes
   the name from the copy's clock as step 3 checked it, and compares no clock again. If it fails
   for any other reason, charging has already started: the page says so, with **Check again**, which
   repeats this step under the same operation id.

Steps 4 to 6 are A1018's operation and its retry rules (A1018 §7: "Same id and same inputs return
the stored result"). That retry rule is Cloud's to honour too (§9).

**When the box comes back.** This is new work on both sides, not something A1018 already gives, and
one part of it is not designed:

- **The box cannot find the copy by itself.** Its signed list of the venue's machines names no copy,
  because the copy did not exist when the box died. The tills that moved have left the box's address
  (§7), so no till asks the box anything either. A1018 §4 point 1 ("before trading or any AEAT
  communication on boot, it asks M2 or a till for the current signed membership") therefore finds no
  one to ask; and that rule is itself not built yet (A1018 awaits separate build authority,
  `docs/backlog.md`, A1018 entry).
- **(default) With the internet, it asks Cloud.** A returning box asks Cloud, with its own Cloud
  installation credential (§1), whether a declaration was made. Cloud has withdrawn the box's other
  services (step 5) but still answers this one question. Told yes, the box stays restricted: it sells
  nothing and files nothing. Trusting Cloud's word here is safe because the word can only make the
  box stop.
- **With no internet and no till or peer to ask, it waits for a person**, as A1018 §4 point 1 and
  the contract say ("An emergency M1 unable to reach M2 or a till on boot waits for an authorised
  human", contract `:1434-1435`). This is the honest worst case.
- **Not designed: the box checking the copy's own word.** On an A947 switch, the newer list of
  machines is "signed and checked against the stored main-box key" (A947 §6.3, item 2). The copy has
  a new key the box has never stored, and must not hold the box's (A1018 §2). How the box would verify
  a list signed by the copy, and how its invoices then return to the copy (A1018 §5), is left open
  (§12).

## 7. The tills follow

A till's router would find the started copy by itself if the copy's address were on its list: it asks
every listed address every 5 seconds and moves to the one accepting sales with the highest term
(`server-router.ts:64`, `:121-130`). That is exactly what must **not** happen here. A router move signs
the person out, drops the drafts and starts the till again against the new address (`till-app.ts:2169-2185`),
and there the till arrives as an unknown device, because its identity is a cookie the browser keeps
for the venue's own domain (`device-session.ts:53-67`).

**(default) The tills move by joining the copy, as new devices, one press each:**

1. While the box is silent, a till that knows the emergency address (§3) asks it `GET /api/node`
   with a check of its own, **separate from the router**: the emergency address never goes into the
   router's list (`setServers`, `server-router.ts:86-90`), so the router never moves by itself. When
   the answer accepts sales **and names a node id other than the box's**, the strip changes for
   **everyone** at that till: "The venue now runs in the cloud." with **Move this till** (mock-up 6).
   The node-id check needs the copy to have its own node identity (§5, part 0). A till mid-payment
   finishes or abandons that payment first, as A1018 §4 says ("Tills keep one selected machine and
   never send the same uncertain payment to a second one").
2. **Move this till** sends the till's browser to the emergency address. There, it is a device the
   copy does not know, so it asks to join, through today's join flow. Because the emergency address
   is a Cloud name no venue points at the box (§4), a till on the venue's Wi-Fi reaches the copy over
   the internet even where the staff address is pointed at the box locally.
3. After the start, the copy's page asks the person who started it to sign in to the copy's
   dashboard (the start's own sign-in has ended, §5) and opens the join list there: each till asking
   to join, with **Approve**. That is one more sign-in, then one press per till.
4. Handhelds and kitchen screens follow the same way.

**What does not follow on the first evening.** Printers, cash drawers and card readers stay at the
venue; reaching them from a hosted server needs the outbound device agent the hosted design asks
for ("Printers, drawers and payment terminals stay local. Use a Waitron-owned authenticated outbound
agent contract", [hosted design](https://github.com/waitron-io/waitron-cloud/blob/4064f3044f4826235e399070e564a94e4dd7bdd0/docs/superpowers/specs/2026-10-21-cloud-hosted-venue-design.md#reach-cloud-and-the-devices-in-your-venue),
`:317`). **(owner)** That agent is A1175's Android app: "It is the android app really, which runs
locally and hosts the print agent (et al)" (2026-10-29; [A1175](../../backlog/printers.md#a1175-an-android-app-for-venues-run-from-waitron-cloud)).
A1175 is still to be brainstormed and is not designed here. Until it exists, a venue started in the
cloud takes cash, or cards on a standalone terminal, and prints nothing; the declaration page says
so before the start. **This is the largest limit of the design**, and the
reason a spare box (A947) comes first where a venue has one.

## 8. What each piece alone can do, and the false alarms

| Someone has only… | What they can do |
| --- | --- |
| The emergency address (shown on every till's strip while the box is silent, §3) | Reach Cloud's code page. Nothing starts without the code. |
| The emergency code | Start a locked copy, which sells nothing and shuts down after 30 minutes. Cloud pays for those minutes; nobody is charged. Repeated starts are Cloud's to limit (§9). |
| The code and a staff member's password, but no authenticator code or recovery code | Nothing: the copy refuses with the same sentence as a wrong password (§5). |
| Everything, but no `node.promote` | Sign in and read the refusal; nothing else. |
| Everything, with `node.promote`, while the owner's setting is off | Nothing: §6 step 2 stops. |

**False alarm 1: the box is fine but its internet is down.** Then the tills at the venue still reach
the box, so the strip never shows, and the venue's internet is usually the same line — Cloud is
unreachable too. **False alarm 2: one till lost its network.** A947 §6.2 already handles it for a
spare box: before the dialog opens, the till checks the box; this design keeps that (§3), so a till
that can still reach the box offers no cloud start. **False alarm 3: the box lost its venue network
but kept its internet, and someone starts the copy.** The person needs the code, a `node.promote`
sign-in and the declaration that the box is unplugged — a false statement is the one defence A1018 §4,
point 2 already names, and §6's step 2 adds that Cloud says whether it heard from the box.
**(default)** The copy shows "Box last heard" (mock-up 4) and, if Cloud heard from the box in the last
two minutes, refuses the start with **Check again**, before anything is recorded or charged (§6,
step 2). On the evening above, had Cloud still been hearing from the box, a press at 22:05 would have
been refused with "The box was still in touch with Waitron Cloud at 22:04. Check it before starting
here. Nothing was recorded." Two minutes is a default, not a measurement. This is
the cloud equivalent of A947's "the main box is still answering" refusal; it is no proof the box is
off, and the page does not say it is.

## 9. What Waitron needs Cloud to agree

Each goes into the shared contract (`docs/waitron-integration-contract.md` in waitron-cloud), and is
put to Cloud's builders as a question:

1. **Facts for the box** (§1): whether the emergency start is open, the emergency address, the hosted
   daily price — in the billing section Cloud billing design §5 already adds (the section A1185 also
   waits for).
2. **The code on request** (§2): an answer to the box, authenticated as the installation, holding the
   current code **and the date it was issued**. The box shows it and does not keep it.
3. **Where the code page lives, and the emergency address** (§4): the person's Waitron password never
   passes through a page Cloud can read; the emergency address is a Cloud name of its own, separate
   from the staff address, which no venue points at the box locally. This departs from Cloud billing
   design §7 item 4 ("the venue's own remote-access address"). The contract names no emergency
   hostname, so adding one that reaches a locked copy is an amendment. (Its nearest rule, for the
   staff name, allows it only "when it reaches an actually active server", `:137-139`.)
4. **Starting the copy** (§5): Cloud starts a Waitron server in the locked mode from the live stream,
   with the backup key that opens the backup's locked secrets (Cloud billing design §7, `:352-354`;
   contract `:678`). No node recovery key is asked of anyone. The copy takes **a new node identity**,
   which amends the contract's statement that a stream restore recovers the box's identity
   (`:687-690`).
5. **The copy's own Cloud identity and certificate**: the copy gets the fresh Cloud installation
   credentials of Cloud-managed recovery (contract `:679`; Cloud "still registers the replacement as a
   new installation", `:690-691`), not the normal linking, which needs a local administrator's
   approval (`:84-87`). Its certificate for the emergency address comes through the staff certificate
   exchange, which today "refuses production-environment installations" and needs a current control
   lease (`:802-806`); version 1 must be opened to production installations for this, and to issue
   for the emergency name, which is not the installation's configured staff hostname (the exchange
   takes "hostname and revision from the current installation configuration", `:825`).
6. **"Is it still open?"** (§6 step 2), asked by the copy, authenticated as the copy's installation,
   answered from the owner's setting and the venue's level.
7. **"Box last heard"**: the last time Cloud heard from the box, for the page and §8's refusal,
   answered with "Is it still open?" at §6 step 2.
8. **"The declaration is made"** (§6 step 5), sent under the operation id; the same id and inputs
   return the stored result, so a repeated message never charges twice. Cloud's confirmation cancels
   the 30-minute stop, starts charging, emails the owner, withdraws the box's remote access and
   refuses its backup stream; the copy then opens a new backup generation (hosted design `:190`).
9. **The 30-minute stop**, and a limit on how often valid codes start copies. Since the copy's
   wrong-password count starts again with each copy (§5), this limit is the real bound on guessing.
   The stop ends at Cloud's confirmation of the declaration, not at a sign-in (§5). This departs from
   Cloud billing design §7 item 6 ("If nobody signs in within 30 minutes, the copy shuts down",
   `:378-379`), because the sign-in is held in the copy's memory, where Cloud cannot see it.
10. **"Was a declaration made?"**, asked by a returning box with its own installation credential, and
    answered even after its other services are withdrawn (§6, "When the box comes back").

## 10. Fiscal facts

- The copy starts a new chain under a new installation name, chosen from the copy's UTC minute after
  another clock agrees within 30 seconds (CLAUDE.md §5); the other clock is the declaring person's
  browser, with AEAT as a third (§6).
- Until the declaration the copy writes no fiscal record and sends nothing to AEAT (§5). It is placed
  with no fiscal authority; the authority comes from the `node.promote` sign-in and the declaration,
  and no node recovery key is used (§5).
- After it, A1018's emergency rules apply unchanged: the copy alone talks to AEAT, files the box's
  copied originals in the box's own fiscal identity, and its own sales in its own (A1018 §§4, 6).
- No part of this design changes `computeHuella`, the chain, invoice numbering,
  `registros_facturacion` or the record builders. The emergency activation is A1018's build, which
  still needs its own build authority (A1018's opening note).
- **Files in `packages/fiscal-verifactu`:** this design's own parts change none. Taking the
  statements after the copy is placed (§5) may change how the fiscal recovery approval
  (`RecoveryApproval`, `packages/fiscal-verifactu/src/allocation-envelope.ts:42-53`) is filled in;
  that change, if needed, belongs to A1018's build and its build authority.

## 11. How it would be built

Each part is a separate pull request:

| Part | What | Waits for |
| --- | --- | --- |
| 0 | A stream restore that takes a new node identity instead of the box's (§5) | The contract amendment (§9, item 4) and A947's separation of each machine's own signing key (A947 §4, item 2; slice 3a) |
| 1 | The box learns §1's facts; the Cloud services card (§2) | Cloud's billing section of the contract (§9, items 1–2); shares groundwork with A1185 |
| 2 | The till's link, dialog and separate check of the emergency address (§3) | A947's strip (slice 3 onwards) and part 1 |
| 3 | The locked start mode, its in-memory sign-in and its refusals (§5) | Part 0; §9 items 3–7 agreed; can be built against a local stand-in for Cloud |
| 4 | The declaration and activation (§6) | Part 3; §9 item 8 agreed; A1018's emergency build, with its build authority |
| 5 | The tills move (§7) | Parts 2 and 4 |
| 6 | The returning box asks Cloud and stays restricted (§6, "When the box comes back") | §9 item 10; A1018's returning-box rule |

A1187 (one recovery pack) prints the address, the code and its date; it reads them the way part 1's
card does. Giving `node.promote` to another role is not a part here: it comes with A1002's build
(§13 item 1).

## 12. Left open

- The contract's exact fields and messages (§9).
- How a returning box verifies a list of machines signed by the copy, whose key it never stored, and
  how its invoices then reach the copy (§6).
- Which clock wait the copy takes before activating: a restore's 90 to 150 seconds or a switch's next
  minute (§6); left to A1018's build.
- The device agent for printers, drawers and card readers from a hosted server: A1175's Android app,
  still to be brainstormed (§7).
- Whether a till that joins the copy can be matched to its old device record, keeping its profile,
  or always starts as a new device (§7).
- Spanish wording of every new line; the mock-ups are in English.

## 13. The owner's answers

**Approved by the owner on 2026-10-29 with the defaults below**, item 1 as the owner refined it the
same morning. Each item gives the decision, the alternative (or says none was proposed), and what
each costs.

1. **Who can start it (owner): administrators by default, and a venue may give the permission to
   other roles.** "Allow the permission to be assigned to other roles too, so it's just admins by
   default" (2026-10-29, about 09:25; it replaces the owner's two earlier answers that morning,
   first managers too, then administrators only). Today roles are fixed in the code
   (`packages/identity/src/permissions.ts:80-85`, "What exists today"), so **until A1002 is built
   only administrators can start it at any venue**; this design adds no permission to any role.
   Giving it to another role arrives with **A1002** (custom roles and several roles per person,
   [A1002 design](2026-10-22-a1002-custom-roles-design.md)): its §2 makes `node.promote` part of
   `node.manage`, held by Admin by default, and its §3 makes the grants of the built-in Manager,
   Supervisor and Staff roles, and of custom roles, editable. The owner has accepted both of those
   (A1002 §11), but not yet the whole design. Under its §5, which is not yet approved, role
   administration needs `person.admin`, and a role gains a permission only from someone who holds
   it, so by default only an administrator can give it; if A1002 changes, this item follows it.
   Cost: until A1002 is built, on an evening with no
   administrator at the venue, nobody there can start it; an administrator elsewhere with the code
   still can, and so can you from your Cloud account. Cost once a venue gives it to a role: everyone
   in that role can also switch the venue to a spare box (A947) and, under A1002's merge into
   `node.manage`, add a mirror. The other gates stay (your advance consent, password plus
   authenticator, the declaration). The pages never name a role in their buttons; the till's dialog
   names the roles that hold it (§3), and the copy's pages say "someone allowed to switch the
   venue's server".
2. **Password plus authenticator code, always; no passkeys at the copy** (§5). Cost: a person with
   no authenticator set up cannot start it. Alternative: also accept passkeys; its cost: the copy
   would write to the venue's database before the declaration.
3. **A recovery code works in place of the authenticator code**, as on the dashboard (§5). Cost: a
   person who uses one has one fewer left. Alternative: refuse recovery codes; its cost: a person
   whose phone is lost cannot start it.
4. **The strip shows the emergency link to everyone at the till, with no role in its words** (§3),
   because nobody can sign in at a till once the box is dead, and the address starts nothing without
   the code. Cost: anyone at a till can see the address. Alternative: your entry's literal version,
   shown only to a signed-in holder of the permission; its cost: on most evenings nobody would see
   it, and the
   recovery pack is the only way in.
5. **The emergency address is a Cloud name of its own, not the staff address** (§4). Cost: one more
   name for Cloud to run. Alternative: the staff address, as the Cloud billing design has it; its
   cost: on a venue that points the staff address at the box locally, phones and tills on the Wi-Fi
   reach the dead box and must use mobile data.
6. **Cloud's code page sits on a separate Cloud address** (§4), so at Cloud's front door your
   staff's passwords never pass through a page Cloud can read; the copy itself runs on Cloud's
   machines (item 16). Cost: two addresses instead of one. Alternative: one address for both; its cost:
   Cloud's page would see the password.
7. **The box learns three facts from Cloud (whether the start is open, the emergency address and the
   daily price) and never stores the code**; the card fetches the code when asked and shows the date
   it was issued (§1, §2). Cost: the card shows the code only while Cloud answers, so the pack is
   printed while all is well. Alternative: the box keeps the code; its cost: the code would be in
   every backup and every copy restored from one.
8. **The copy's sign-in lasts 10 minutes, in memory only, and wrong tries are counted per email in
   the copy's memory** (§5). Cost: a slow declaration means signing in again, and the count of wrong
   tries starts again with each new copy, so Cloud's limit on how often codes start copies is the
   real limit on guessing (§9, item 9). Alternative: a longer sign-in; its cost: a stolen sign-in
   stays usable longer.
9. **"Box last heard" within two minutes refuses the start**, before anything is recorded or charged
   (§6 step 2, §8). Cost: a box that only just died means waiting up to two minutes; two is a guess,
   not a measurement. Alternative: no check; its cost: the copy could be started beside a box that is
   still running and only cut off from the venue's own network, with only the person's statement
   that it is unplugged to stop that.
10. **No answer from Cloud means no start.** Before the declaration, nothing is recorded; after it,
    the copy waits for Cloud's confirmation and asks again, and if the 30-minute stop comes first,
    nothing is activated or charged. The clocks and "box last heard" are checked before Cloud is
    told, so neither can stop a start that is already being charged; if the start fails for another
    reason after Cloud confirms, charging has started and **Check again** repeats it (§6). Cost: if
    Cloud is down, nobody can start the venue in the cloud, even with every other step done. No
    alternative proposed.
11. **The tills join the copy again, one press each to approve; printers, cash drawers and card
    readers do not follow** until A1175's Android app exists (owner, 2026-10-29: it is the device
    agent; still to be brainstormed; §7). Cost: the venue takes cash or uses a standalone card
    terminal that evening, and prints nothing (§7). Alternative: wait for that app before offering
    this at all; its cost: nothing in this design is offered until it exists.
12. **Only people who may start it can see the code on the dashboard** (people holding
    `node.promote`, §2). By default that is the administrators, as the Cloud billing design words
    it ("Admins can save or print it"). Cost: once a venue gives the permission to another role,
    everyone in that role can see the code too, and the code starts a locked copy (§8).
    Alternative: only administrators see the code, even where the venue gives the permission to
    another role; its cost: a person the venue allowed to start it cannot check a printed pack
    against the card.
13. **This is A1018's emergency switch from the box to Cloud, not a fresh restore** (§5). The copy
    becomes a machine of its own, with its own identity. Cost: that needs restore work and a contract
    change first (§11, part 0). Alternative: a cold restore, which the hosted design also allows
    (`:178`); its cost: today's restore becomes the box itself and asks for the node recovery key
    ("What exists today"), which you said not to ask for (A947 §6.2, `:628-629`).
14. **When Cloud confirms the declaration, the box loses its remote access and its backups to
    Cloud** (§6 step 5). Cost: if the box was in fact still running, staff cannot reach it from
    outside the venue and its backups to Cloud stop. No alternative proposed.
15. **A box that comes back asks Cloud, and stays stopped if Cloud says the venue moved** (§6, "When
    the box comes back"). It cannot yet check the copy itself, so Cloud's word stands in for
    A1018's "verified newer role" (A1018 §4, `:209`). Cost: you rely on Cloud's word, which can only
    make the box stop, never sell. Alternative: A1018's rule alone (ask a till, else wait for a
    person); its cost: a till that never moved knows nothing of the copy, so it cannot tell the box
    the venue moved.
16. **Not a choice, for you to know: what you are trusting Cloud with.** Cloud keeps the venue's
    backup keys at all times, and its machines may use them to restore the venue; a running copy
    puts the AEAT certificate, the card provider's keys and every authenticator secret to use on
    Cloud's machines, and can file with AEAT for the venue once a person holding `node.promote`
    signs in and makes the declaration. Waitron's sign-in cannot stop someone who controls Cloud's
    machines; only Cloud's own controls, and your trust in them, do ("Who decides what").

## Mock-ups

In [`docs/backlog/mockups/a1188-cloud-emergency-start/`](../../backlog/mockups/a1188-cloud-emergency-start/),
light and dark, 1280 and 390 wide. The venue, people, address, times and price in them are invented:

1. `01-till-strip` — the till's strip, shown to everyone, with **Start the venue in the cloud**
   (§3).
2. `02-till-dialog` — the dialog with the emergency address, the QR code, what is needed (the code,
   a password, an authenticator code or recovery code) and who can do it, at a venue that has given
   the permission to nobody but its administrators (§3).
3. `03-copy-sign-in` — the locked copy's sign-in: email, password, authenticator or recovery code, a
   line saying passkeys are not offered, and the line under the form about setting up an
   authenticator before the box failed (§5).
4. `04-declaration` — the declaration (§6).
5. `05-dashboard-emergency-card` — the Cloud services card, with the date the code was issued (§2).
6. `06-till-move` — the strip once the venue runs in the cloud; the person who started it approves
   each till (§7).
