# A646: configure optional modules without stopping service

**DESIGN PROPOSED, 2026-10-16. Awaiting owner agreement.** This is the design author's
proposal, not an owner-approved decision or an implementation plan. Nothing here is built or
behaviorally verified. Build waits for owner agreement and **A739 and A764 to land**. The retained
append-only protection repair below must be the first independent build PR, before any UI state controls.

You should be able to set up Google login or a card provider in one place, without restarting
Waitron or stopping someone paying. A row must describe what Waitron actually applied. It must
never hide an unfinished charge, remove the means to refund an earlier payment, or close your only
way back into administration.

The requested destination is **Settings > Modules**. Google becomes an optional module, with a
sealed client ID and secret managed there. SumUp and Stripe setup moves there. Card payments links
to Modules filtered to card providers. Profile > Security shows its Google row only while Google
is enabled. Static documentation mockups are available in
[the mockup index](../../backlog/mockups/a646-modules-page/README.md). They illustrate the proposal,
not the running application.

## Owner revision source, 16 October 2026

The prior design is **not approved**. The owner selected “More modules on the page” and “Layout
or wording”. In the answer relayed by the supervising watcher at about 22:40, the owner wrote:

> on layout, we should show the enabled modules, with each row can't be disabled having a greyed out toggle and the reason displayed in red inside the row. then we need an "add a module" which will (eventually) need a search bar. maybe for the moment it is one list initially filtered on "enabled"
> maybe instead of the toggle we have a kebab menu with configure/disable
> configure should open a modal
> modules can have reasons why they can't be disabled, eg "you don't have a password / passkey set" so would be prevented from logging back in. could be extended to all admins.

This revision takes the row-menu option: no on/off toggles. It proposes one catalogue, separate
configuration and activation, and a modal editor. Extending Google lockout checks to every active
administrator remains the **one unresolved owner decision**, described below. Neither that extension
nor the rest of this revised design is treated as approved.

## What the source says today

Every observation in this section is **read-only and unverified at runtime**, at checkout
`2aa3e92506aa483c97a77ad8516f96068a5ede46`. Exact locations are reading receipts, not test results.
Recheck them against the eventual implementation base, especially the payment and setup work.

| Area                                | Reading receipt and implication for this proposal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition and dependency graph    | `packages/composition/src/modules.ts:106` is the complete module list; tiers and dependencies are descriptor data. `packages/module/src/module.ts:1287` defines the descriptor; `:1362` orders migrations and refuses missing dependencies. Identity, credentials, scheduler and payments are currently labelled toggleable (`packages/composition/src/modules.ts:153`, `:198`, `:213`, `:225`). Those labels alone are insufficient evidence that their host services can stop.                                                                                                                                                                           |
| File resolution and boot            | `apps/server/src/module-config.ts:12` reads `modules.json`; `packages/module/src/config.ts:25` validates a sparse map, defaults absent overrides to enabled, and refuses mandatory=false. `apps/server/src/boot.ts:831` selects all modules in setup and enabled modules in trading; `:838` derives protected tables from that same selection.                                                                                                                                                                                                                                                                                                             |
| Runtime boundaries                  | `apps/server/src/boot.ts:1424` installs change sources and captures the live resource catalogue; `:1504` constructs the card provider and shared pool; `:1728` passes boot-time Google configuration; `:1811` mounts enabled contributed routes. `:1993` supplies enabled alert sources. The descriptor's duties seat is still `unknown` (`packages/module/src/module.ts:1316`), not a general start/stop protocol.                                                                                                                                                                                                                                        |
| Background work                     | `apps/server/src/boot.ts:2298` prepares fiscal reset/drain, `:2324` composes pending-payment sweeps and `:2370` settles pending bill payments/refunds. `apps/server/src/bill-payments-loop.ts:147` reads pending bills. Visibility and ongoing debt cannot share one enabled flag.                                                                                                                                                                                                                                                                                                                                                                         |
| Retained protection defect          | `packages/migrations/src/apply.ts:65` removes the change feed and `:69` migrates and installs triggers only for supplied sets. `apps/server/src/append-only-watch.ts:16` checks supplied names; `:83` watches that list. Boot supplies the selected list at `apps/server/src/boot.ts:2261`. `packages/store/src/append-only.ts:58` installs missing triggers with IF NOT EXISTS; `:101` compares stored definitions. This does not establish that retained disabled-module tables are checked.                                                                                                                                                             |
| Known append-only declarations      | `packages/workforce/src/classification.ts:12` declares time entries and pay-period closures; `packages/payments/src/classification.ts:14` declares payment resolutions; `packages/fiscal-verifactu/src/classification.ts:6` declares records, filing cases/events and fiscal allocations/reservations. Use the full composed classifications, not this illustrative list.                                                                                                                                                                                                                                                                                  |
| Providers and panels                | `packages/composition/src/card-providers.ts:12` lists server provider contributions; `packages/dashboard-modules/src/card-providers.ts:10` lists their browser panels. `packages/payments/src/card-provider.ts:38` defines connect/build/reader operations. `apps/server/src/payments-api.ts:597` authorizes, verifies through the seat, seals and evicts the pool; `:630` disconnects after checking active readers. That check alone is not a complete unresolved-payment/refund guard.                                                                                                                                                                  |
| Credential reads and caches         | `apps/server/src/card-provider-pool.ts:31` caches by provider ID. `packages/payments-stripe/src/card-provider.ts:109` caches a deferred client; `packages/payments-sumup/src/card-provider.ts:95` caches its deferred client. Reading a helper that loads a credential does not establish that a cached instance sees rotation.                                                                                                                                                                                                                                                                                                                            |
| Vault and key scope                 | `packages/credentials/src/store.ts:96` seals before upsert, `:42` distinguishes missing from undecryptable, and `:131` exposes a ciphertext revision. `packages/credentials/src/cipher.ts:27` authenticates the purpose, `:31` seals with AES-256-GCM. `packages/credentials/src/keyring.ts:29` loads current/previous versioned master keys. The current authenticated context is the purpose, not a node or environment binding.                                                                                                                                                                                                                         |
| Recovery versus transfer            | `apps/server/src/state-secrets.ts:15` includes secrets.env in recovery material. `apps/server/src/restore-command.ts:247` requires all modules for restore, and `apps/server/src/restore.ts:690` iterates restore hooks. `apps/server/src/node-entry.ts:362` checks all manifest sets for ahead-of-image history. `packages/composition/src/modules.ts:236` excludes credentials from configuration transfer; `packages/identity/src/configuration-transfer.ts:6` omits password, TOTP and Google linkage. `apps/server/src/mirror-bundle.ts:136` independently rereads the module file. These consumers need consistent resolution, not just a page save. |
| Google and sessions                 | `apps/server/src/config.ts:493` reads the ID/secret from environment; `:544` derives the callback from management origin. `apps/server/src/management-api.ts:780` exposes venue-wide configured status; `:784`, `:798`, `:821` implement login, linking and callback. The callback claims state, calls the provider outside the transaction and issues a session. `packages/identity/src/google-oidc.ts:49` stores ten-minute flows, `:89` consumes one, `:131` checks active linked identity and rejects Google login with TOTP. `apps/server/src/google-oidc.ts:13` exchanges/verifies the token.                                                        |
| Passwordless limits                 | `packages/identity/src/profile.ts:86` requires a password and any configured TOTP for sensitive profile changes, including Google unlink at `:187` and passkey removal at `:352`; `:227` reports enrolled factors. `packages/identity/src/passkey.ts:223` begins discoverable authentication. A passkey enrollment is not proof you possess it now, and current sensitive-change code is not a general passwordless reauthentication mechanism. `packages/identity/src/management-session.ts:47` checks token, person status and idle expiry independently of Google enablement.                                                                           |
| Permissions/navigation/live updates | `packages/identity/src/permissions.ts:56` gives managers payments.manage and system.manage, so system.manage is not admin-only. `apps/server/src/payments-api.ts:245` checks payments.manage. `apps/dashboard/src/dashboard-app.ts:255` defines Settings; `:1345` rebuilds contributions from enabled names on session activation. `packages/dashboard-modules/src/index.ts:13` is the legitimate browser module twin. `apps/server/src/live-api.ts:61` rejects unknown subscription types and `:94` captures allowed types.                                                                                                                               |

The proposal follows `docs/developers/conventions-data.md` (composition, migration ownership,
append-only markers, keys and restore), `conventions-ui.md` (forms, passive reads, live catalogues
and public login methods), `design-system.md` (Forms, unsaved edits, sidebar and profile cards),
`writing-claims.md` and `workflow-guide.md`. It makes no external provider-policy or legal claim.

## What you see and who can change it

**Revised proposal:** every optional module appears in **one catalogue** in Settings > Modules.
Its state filter opens at **Enabled**, with **Disabled** and **All** also available. **Add a module**
changes that same catalogue to Disabled; it is a discovery shortcut, not a second list or a state
mutation. It preserves the category filter and shows that filter visibly. You can clear Category
to browse every optional entry. Search is explicitly deferred to a later design.

Category is independent of state: **All categories / Card providers**. Card payments' direct link
sets **Category = Card providers, State = All**, overriding a remembered Enabled filter. It shows
configured and disabled providers together. Configuration does not filter that view: a disabled
provider needing setup is visible too. A manager's permission-limited provider view still uses
the same catalogue; authorized filtering must happen at the server.

Each row shows its name, **applied state**, **configuration/readiness** and a **wt-row-actions**
kebab. State and configuration are separate: Google can be Disabled and Configured; Stripe can
be Enabled and Needs attention. Configuration presence alone never means healthy. The enabled
row's menu contains **Configure / Disable**; the disabled row's menu contains **Configure / Enable**.
There is no on/off toggle on the page or in a dialog. Use wt-data-table, with its actions column
keyed `actions` and pinned at the end; wrap row text on phones and keep all rows reachable by
scrolling. The requested Enabled/Disabled state wording here is specific to this module-setting
proposal. EN actions are Enable/Disable; ES actions Habilitar/Deshabilitar.

When Disable is forbidden, keep it grey and disabled in the menu. Keep a **specific red reason
inside the row**, visible with the menu closed, plus the recovery action. Do not replace it with
a tooltip or a generic “unavailable”. Distinguish these cases:

| Row condition, returned by the server                                                           | Persistent reason and recovery                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applying admin has no supported password/passkey                                                | “You have no password or passkey, so you could not sign back in.” Link to Account security to enroll, then return and prove that method.                                                                                   |
| Applying admin has a method but no current proof                                                | “Confirm another sign-in method before disabling Google.” Offer the fresh-proof action; a recorded factor alone is insufficient for this actor.                                                                            |
| Another admin lacks enrollment, **only if Every active administrator is selected by the owner** | “Pablo has no non-Google sign-in method.” Identify Pablo only to an authorized administrator; offer account management so Pablo can enroll through the authorized path. Do not imply enrolling a factor on Pablo's behalf. |
| An enabled dependent or essential service needs the module                                      | Name the dependent, for example “Staffing needs Workforce.” Open that dependency's settings; do not cascade-disable.                                                                                                       |
| Schema/runtime adapter is not ready                                                             | “Runtime changes are not prepared for this module.” Offer preparation status, with an explicit read-only explanation if no self-service action exists.                                                                     |
| Stripe has an unknown live charge                                                               | “Table 4: €28 payment outcome is unknown.” Open Card payments' existing check/resolution tools. Do not cancel or retry the charge.                                                                                         |

The row is a server snapshot, never authority from browser storage. Confirmation performs fresh
server checks, including races after the row loaded. A newly discovered refusal refreshes the
row's reason while leaving the applied state unchanged. Loading or failed readiness reads do
not masquerade as permission to mutate; show the failed read and Retry.

**Configure opens a centred wt-dialog modal over a dimmed page**, bounded on desktop and with
phone margins. It never becomes a side panel or an expanded row. It contains contributed settings
and **Save / Cancel**, with no activation field. Saving only stores validated settings; a disabled
entry stays disabled. After saving, you choose the row's **Enable** action separately. An enabled
entry's credential change still uses the runtime safety checks below. A module with no settings
opens a truthful “No settings for this module” dialog with Close and no pretend Save form.

**Enable / Disable opens a separate explicit confirmation**, showing the named entry, requested
state and consequences. Confirm uses that state verb, never Save; Cancel does nothing. Enabling
requires saved, readable configuration where required, prepared schema/runtime support and current
dependencies. Missing settings lead you to Configure, never automatic enable-on-save. Disabling
retains settings and historical data. A refused change must be explicitly retried after recovery.

Required and provision-only entries are readable separately, outside the optional catalogue, with
their tier and reason rather than mutation controls. The selected fiscal regime says **Chosen
during setup**; there is no regime selector or activation of an alternative regime.

Required configuration fields have visible marks. Google shows
Client ID and Client secret with **Replace** controls when already set, and a copyable derived
callback URL. Neither stored value is returned to the browser. Keeping an existing value is an
explicit request operation, not a submitted mask or an empty string. Clearing credentials is a
separate guarded action, not the meaning of switching Off.

Configuration Save is quiet and disabled until the draft changes, using draftScopeFor/saveActionState and an
early handler return. Cancel, Escape, browser Back, language change and navigation use the shared
unsaved-edits controller. Invalid fields explain themselves beside each field; the one localized
form error sits below the inputs above the buttons. A server refusal keeps Save retryable unless
the draft itself is invalid. A successful Save closes the editor before the separate refresh.
Live notices never overwrite a dirty draft; another revision requires reloading/reviewing it.

**My permission proposal:** introduce core `modules.manage`, granted only to admins. It permits
the complete list, module changes and Google configuration. Keep `payments.manage` for provider
configuration and reader work. A manager with that permission can open only the Card providers
view and its provider dialogs, including a direct bookmarked URL. That manager may select All
states within Card providers, but cannot widen Category to All categories or alter Payments itself.
An admin with modules.manage still needs payments.manage for provider changes.
Each API enforces the same rule before any secret read or provider call and again before commit.
Staff, expired sessions and non-primary/mirror writes are refused. No generic endpoint accepts a
permission name or a credential purpose supplied by the browser.

Card payments keeps readers, assignment, operational status and unfinished-payment/refund tools.
Its provider setup area becomes **Configure card providers**, linking to
`/manage/modules/view/card-providers/state/all`. Existing provider setup addresses redirect there,
also explicitly selecting State = All. Reader
pairing stays on Card payments; shared provider-owned components are reused rather than copied.
Navigation and filters contain category names, never a list of SumUp/Stripe/module IDs.

## Which things are modules

### Full catalogue inventory and source limits

The following inventory was read at snapshot `2e33ca8907863d3f8125eb15378a57cd4aaf1eb5`.
`git diff 2aa3e92506aa483c97a77ad8516f96068a5ede46 HEAD -- packages/composition/src/modules.ts
packages/media/src/module.ts packages/composition/src/card-providers.ts
packages/dashboard-modules/src/card-providers.ts` printed no differences for those files. This
preserves the earlier source-reading snapshot above; it is **not runtime verification**. Labels,
example enabled/disabled choices and readiness reasons in the boards are illustrative proposals,
not reports of an installation's current settings.

| Optional entry in the same catalogue       | Descriptor receipt at that snapshot                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity (`identity`)                      | `packages/composition/src/modules.ts:153`, toggleable at `:155`                                                                                                                                                                                            |
| Workforce (`workforce`)                    | Same file `:167`, toggleable at `:169`; requires identity                                                                                                                                                                                                  |
| Workforce Spain (`workforce-es`)           | Same file `:182`, toggleable at `:184`                                                                                                                                                                                                                     |
| Payments (`payments`)                      | Same file `:198`, toggleable at `:200`                                                                                                                                                                                                                     |
| Scheduler (`scheduler`)                    | Same file `:213`, toggleable at `:215`                                                                                                                                                                                                                     |
| Credentials (`credentials`)                | Same file `:226`, toggleable at `:228`                                                                                                                                                                                                                     |
| Bookings (`bookings`)                      | Same file `:275`, toggleable at `:277`                                                                                                                                                                                                                     |
| Staffing (`staffing`)                      | Same file `:310`, toggleable at `:312`; requires identity, venue-service and workforce                                                                                                                                                                     |
| Google login (`identity-google`, proposed) | No current descriptor; proposed here, depending on identity and credentials                                                                                                                                                                                |
| Stripe and SumUp (provider contributions)  | `packages/composition/src/card-providers.ts:12`; owning descriptors at `packages/payments-stripe/src/card-provider.ts:133` and `packages/payments-sumup/src/card-provider.ts:123`; browser panels at `packages/dashboard-modules/src/card-providers.ts:10` |

`MEDIA_MODULE` is imported at `packages/composition/src/modules.ts:1` and inserted at `:151`.
Its owning descriptor says **mandatory**, `packages/media/src/module.ts:26–30`; do not silently
count it as optional. Core, catalogue, venue-service and adjustments are also mandatory in the
composition. Fiscal-verifactu and fiscal-none are provision-only alternatives. These belong in the
separate readable tier section, with the selected regime identified and no regime mutation.

This table is a dated documentation receipt. The product must derive the catalogue from composed
descriptors and provider contributions, including optional entries without settings or a working
runtime adapter. Do not turn this inventory into a list of names in a host or filter. Ineligible
entries remain visible with truthful reasons. An authorized All state view contains every optional
entry; Enabled and Disabled are filters over that same set.

**My proposal:** Google is a separate optional module, provisionally `identity-google`, depending
on identity and credentials. Identity retains people, subject linkage and sessions. Google owns
the login-provider configuration and contributes its login routes and settings panel through
contracts. Give it explicit default-off metadata; do not let the current missing-override=on rule
silently enable a newly introduced authentication integration. Reuse an empty migration set if it
has no owned tables; do not move existing identity tables merely to make the package look complete.

SumUp and Stripe **remain provider contributions under Payments**, not independent migration
modules. They share payment records and reader infrastructure. The Modules page can list a typed
provider contribution alongside module entries without pretending it owns another schema.
Each provider has its own admission setting, meaning permission to start new collections, and
independent sealed configuration. Off retains its continuation services for prior transactions.

Add display/category/configuration/runtime capability seats to the module/provider contracts.
Only `@waitron/composition` assembles all server modules and their contributions. Derive its
provider registry from that assembly instead of adding another all-module list. Keep
`@waitron/dashboard-modules` as the browser-safe twin for panels, labels and renderer factories.
The server returns authorized entry metadata; hosts iterate descriptors and never switch on
Google, SumUp, Stripe or a list of module names. Browser code imports no server vault or client.

Mandatory and provision-only tiers have no runtime mutation API. Also declare effective runtime
requirements: a module depended on by an enabled module, by the host's essential authentication,
vault or scheduler services, or by retained work cannot stop. Declare these requirements at their
owning boundary and compose them, including currently implicit host consumers. Reject the change
and name the dependent service/module; do not silently cascade-disable it. Tier=toggleable only
makes a module eligible to supply a safe runtime adapter. Until it does, show **Cannot change while
running** and refuse the state confirmation. Configuration Save is separate and must not claim to
start or stop the module. This is deliberately more conservative than trusting today's tiers.

## Applying a change while requests continue

**My proposal:** add a host runtime coordinator, which holds an immutable applied snapshot.
A revision is a numbered complete choice of module state, provider admission and credential
references. Separate that from the desired candidate you asked to apply. Keep both durable in the
venue database, with an operation ID, expected prior revision, actor, phase and bounded refusal
code. The core-owned control tables are infrastructure; their commit must state that ownership
reason. Credential candidates stay sealed in credentials-owned staging rows, never in control
table JSON. Neither table set enters ordinary configuration transfer.

Keep settings writes and state changes distinct throughout this lifecycle. A settings operation
preserves the applied enabled/disabled state, including when saved credentials become usable.
Only an explicitly confirmed Enable/Disable operation may change that state. Both kinds use the
same revision, preparation and publication safety boundary where they affect running services.
For Google, access checks use the owner's eventual lockout scope below, not an assumed all-admin
rule. Neither a configuration form nor its Save is a delayed activation request.

Start with one pending change at a time. A request repeats its operation ID safely; a stale
expected revision answers conflict rather than overwriting another administrator. Store only
allowlisted error details, never a submitted value or a raw provider exception.

1. **Check before reserving.** Authorize, validate dependency closure, pinned fiscal selection,
   known schema version and protections, credential availability, runtime support and lockout.
   Refuse unsupported changes immediately. Do no provider network work under a write transaction.
2. **Prepare a candidate.** Validate provider credentials through the real owning client/seat,
   seal staged fields, and build an isolated service generation without publishing it. Recheck
   authorization, expected revision and relevant account/credential facts after network work.
   Preparation must have explicit cleanup and must not start sale, filing or refund operations.
3. **Stop admitting affected new work briefly.** Every affected route, background pass and other
   entry point takes a lease, a counted hold on one service generation. Acquire the hold before
   reading settings and retain it across network calls and final writes. Requests admitted before
   the barrier finish with their existing generation. New affected requests receive a localized
   retryable refusal. Unrelated sales, cash payments and kitchen sends continue.
4. **Drain or refuse.** Proposed drain deadline: five seconds. Do not cancel an admitted payment,
   refund, send or callback to meet it. If a lease remains, or durable work cannot continue safely,
   release the barrier and mark this candidate Refused, keeping the old revision applied. Nothing
   silently switches off later. You retry the relevant settings save or state confirmation
   explicitly after the work finishes.
5. **Publish once.** With no affected leases and after a final transactional recheck of dependencies,
   debt and admin access, promote staged credentials and commit the applied revision atomically.
   Publish the prepared in-memory snapshot before releasing the barrier. No await may admit work
   between the commit and pointer replacement. Retire old instances only after their holds end.
   Report Applied only after publication; emit one revision notification after commit.

This needs real boundary changes. A fixed outer router must dispatch through a revision-owned
child router, rather than adding/removing Hono handlers on the live app. Contributed navigation,
permissions, settings, floor hooks, translation checks and alerts must read the same snapshot.
Keep all permission declarations registered for historical records; enabled state still gates
execution. Replace boot-captured provider/configuration closures with generation accessors.
Provider pool keys include the applied credential revision. Freeze the actual client/credential
for the full operation, not just the pool entry, so a late lazy read cannot change its identity.
Every start/stop adapter supplies prepare, admission, debt/readiness, cleanup and restart behavior.
An unimplemented adapter refuses; an unknown duties field is not accepted as one.

**No incidental migration while trading.** Applying an enabled state requires that module and its
dependencies already have the recognized schema needed by this image. A never-migrated or stale
dormant module answers **This module needs preparation before it can be enabled**. The first
release does not run applyMigrations against the serving store, remove live change-feed triggers,
or restart the process from a settings save or state confirmation. A later explicitly reviewed maintenance preparation can add that
ability. Successful supported state changes apply without restart; unsupported ones remain visibly
unchanged. The page does not promise every shipped module is immediately switchable.

### Payments and other work that outlives a request

Stopping new collections is separate from retiring provider services. Refuse provider Off while
an active reader/assignment or pairing operation needs it, a collection is in progress, an attempt
is attempting/unknown, a bill payment or refund is pending, or a manual resolution is underway.
Use owner-provided payment queries and existing states after A739/A764; never invent a timeout
that means “not charged.” Recheck inside the final serialized admission/write boundary so a
collection or refund cannot start between a preflight and commit. Cover dashboard, till, webhooks,
sweeps, retries and manual checks, not only the Configure route.

After Off, retain credentials, lookup/webhook handling, settlement reconciliation and refund access
for earlier payments. The historical transaction chooses its provider, even when that provider
is no longer offered for a new payment. Do not gate these continuation services by navigation,
module visibility or the new-collection flag. Show **Off for new payments; earlier payments can
still be checked or refunded**. Payments itself cannot stop while those retained consumers need
it. No clearing debt to make Disable succeed, and no suppression of its incidents.

Credential replacement also waits for affected operations. Verify that the replacement serves
the same provider account and environment before changing a credential used by earlier payments.
If the current provider boundary cannot establish that, refuse replacement while retained payment
history needs it. Changing merchant accounts and deleting credentials with retained history are
outside this first release. This conservative limit avoids designing a new refund/account policy.

Workforce must account for open shifts, attendance operations and scheduled duties through its
own adapter; bookings must account for its retained work likewise. There is no generic
“zero HTTP requests means safe” shortcut. Unsupported stop/readiness stays a bounded refusal.
Fiscal drain, submission debt and append-only checks remain essential services, unaffected by
optional-module state changes. There is no fiscal regime switch.

### Durable restart and one configuration authority

If the process crashes before publication commit, boot keeps the previous applied revision,
discards the uncommitted prepared generation and records the candidate Interrupted. It does not
retry an old admin intention automatically. If it crashes after commit, boot reconstructs that
applied generation, checks keys, schema and protections before serving, and does not fall back
silently to another module set. An impossible essential generation enters the existing curated
recovery refusal; an unavailable optional integration is reported explicitly and admits no new
work. Financial unknown states remain unknown and their existing continuation runs after restart.

At provisioning handoff, write the validated module selection as revision zero before serving,
preserving the stamped fiscal choice. Thereafter the database is authoritative. Existing development
venues reset and explicitly configure the new control state; there is no automatic adoption or
backwards-compatibility path carrying their data or secrets forward. Route
all readers/writers, setup handoff, mirror bundle creation, session capability responses, export
and boot through that resolver; the independent file read at mirror-bundle.ts:136 must go through
it too. A conflicting file is diagnosed, not silently reapplied at boot. No parallel file watcher
or environment override changes applied settings. This is a new control boundary, not a general
backwards-compatibility layer. A new venue still uses provisioning's module choice until handoff.

Use the existing primary/membership authority for mutations; mirrors display status without
applying changes. A generation number is local service state, not a new election or replication
protocol. Restored pending intentions never execute automatically. Rebuild from the selected
backup's applied state and fail explicitly if the image cannot understand it.

## Google, keys and keeping access

**My proposal:** add a vault purpose for the Google ID+secret and reuse the existing master-key
ring, rotation and recovery material. Seal both values. Return only configured/readable status,
revision and callback URL. A saved ID will still be sent by the login protocol when it starts;
sealing does not make a client ID private everywhere. Persist no Google access/refresh token.
Remove environment credential precedence when this configuration path replaces it; do not build
an automatic secret import or a second writable source. Deployment docs must explain explicit
re-entry before enabling Google on an existing development installation.

The key scope remains the installation's versioned vault ring. Do not derive a new key from node
ID, process ID, module state or environment. Purpose authentication is not cross-venue isolation;
preserve deployment/venue checks at the host. A database-only copy lacks the key. A full authorized
restore with the matching recovered secrets can reopen the credential. Wrong/missing key versions
must report unreadable, never “not configured” or a fresh replacement key. Configuration transfer
to a fresh venue excludes Google credentials, linkage and pending flows and requires re-entry;
it must not auto-enable Google from imported metadata. Recovery retains applied settings, but
invalidates pending login/link flows and prepared configuration intentions. Origin changes require
reviewing the derived callback before new Google starts. Do not modify restoreFiscal to do this.

Profile > Security includes Google only when the **applied** module is enabled. Enabled but
unreadable configuration shows a repair message there; disabled removes the entire row, including
the old “becomes available” sentence. Keep stored subject links on Off so re-enabling restores the
same choice without relinking everyone. Public login offers Google only when applied and usable,
from venue-wide capabilities, never from an email/account-enrollment lookup. Existing local
Remember preferences selecting an unavailable method return to the email/method choice without
opening a passkey prompt or clearing unrelated preferences.

### One unresolved decision: whose access must Google disable protect?

**Both options require the applying administrator's fresh non-Google proof**, short-lived and
bound to this operation and configuration revision, before Google Disable, removal or client-identity
change. An expired, replayed or differently scoped proof refuses. Saving first-time configuration
while Google is disabled does not activate it or require a pretend disable proof.

| Proposed scope                                                          | Additional acceptance condition                                                                                                                                          | Worked example                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Only the administrator making the change** (“Only me”)                | Check that actor's supported enrollment and fresh proof. Do not claim to preserve other admins' new logins. Warn explicitly about the consequence.                       | Elena has a password and completes its fresh proof. Pablo is Google-only. With other safety checks clear, Elena may confirm Disable. Pablo **will lose new login access** until he enrolls another supported method; his existing session follows normal expiry/status rules.                                               |
| **Every active administrator** (**recommended proposal, not approval**) | In addition to Elena's fresh proof, every other active admin must have supported recorded non-Google enrollment. Do **not** demand fresh possession proof from everyone. | Elena has a password and completes its fresh proof. Pablo is Google-only. Refuse Disable and keep Google enabled, naming Pablo only to the authorized admin. After Pablo enrolls a supported alternative through the authorized path, a new confirmation can pass. Pablo need not furnish fresh proof to Elena's operation. |

I recommend **Every active administrator** because it avoids deliberately removing Pablo's new
login route. It establishes supported enrollment for others, not their present possession. The
owner's “could be extended to all admins” leaves this choice open; do not implement either scope
as an approved decision. If Elena is the sole admin, both options require her enrollment and proof.

A supported recorded method is a set password with its required email and second-factor
configuration, or a passkey for the current origin/relying party (the site identity to which the
passkey belongs). Enrollment does not establish that the person still knows the password or
possesses the passkey. Browser capability flags and cached enrollment are never sufficient.

The applying admin's proof verifies the password with any configured second factor, or a passkey
with user verification for this origin/RP. A PIN, an existing session, an invitation, an email reset
promise or a bare recovery code does not count. If a selected-scope check fails, refuse with the
specific row reason and recovery action described above. Recheck the applying admin's proof,
status, enrollment and the selected scope's other facts in the publication transaction.

Concurrent admin suspension, role/factor removal, reset and admin admission paths must serialize
with publication and enforce the **selected scope's** recorded-method invariant, while retaining
at least one active administrator. Under Only me, protect the applying actor's supported alternative
against a racing removal; do not reject Pablo's Google-only status by silently imposing all-admin
protection. If the protected actor later ceases to be active/admin, the change must preserve an
active administrator with a supported alternative. Under Every active administrator, preserve
supported recorded alternatives for every active admin, including newly admitted ones while
Google is disabled. Both options need their race cases qualified after the scope is agreed;
Only me cannot promise that every administrator can log in. No option proves other people's
present possession.

Do not claim existing profile methods supply passwordless reauthentication. Add a bounded identity
contract for proving an existing password or passkey for this operation. If a passwordless admin
has only Google, refuse the change and use the separately authorized account-recovery/setup path;
do not invent a bypass from Modules. Retain current sessions under their normal expiry/status
rules and keep all stored factors; turning off a login provider is not logout or deletion.

For the initial release, refuse Google disable/rotation while a nonexpired login/link state or
callback lease exists. Keep the applied ID/secret, callback route and cookie semantics until it
completes or expires. This bounds waiting to the existing flow lifetime without breaking a code
already issued. After a refusal, new flows may continue on the old revision; a confirmation or settings Save is never a
hidden delayed shutdown. Bind future flows to their applied configuration revision and invalidate
them on restore. Validate state/cookie/nonce/PKCE and use the real token-exchange boundary in tests.

## Retained append-only protection comes first

**My proposal for the independent repair PR:** separate _which schema to migrate_ from _which
existing records to protect_. Leave dormant modules dormant. Derive the protection catalogue from
all composed classifications and known schema history, including dependencies, regardless of
enabled flags. The historical [A483 defect receipt](../../backlog/architecture.md#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked)
remains OPEN until this PR actually qualifies the repair. This document fixes nothing.

Preflight and repair order, before trading or starting duties:

1. Under the existing exclusive venue ownership, validate deployment/environment and inspect all
   known migration journals, including disabled and dependent sets, against shipped hashes. Run
   the existing all-manifest ahead-of-image check before any repair write on every applicable
   entry path; do not narrow it to selected sets.
   Refuse unknown hashes, holes or out-of-order history, unrecognized journal owners and a
   control/protection format newer than this image. An older recognized prefix is allowed for a
   dormant set; it is not an instruction to migrate it. A row count alone cannot establish a version.
2. Build an expected table inventory for each recognized applied schema from shipped SQL/snapshot
   history, with table ownership and introduced/retired versions. Compare it with sqlite_master.
   Never enable a dependency or run its pending migrations merely to inspect it. A dependent set
   whose recorded schema needs a missing dependency/table is a recovery refusal.
3. A never-installed set with no tables has nothing to repair. A table introduced after a dormant
   set's recognized version may be absent. A table required by its recorded version but missing
   is corruption and refuses trading; do not filter it away as “not installed.” An existing
   declared append-only table still gets protection even if its module is disabled or a newer
   release has only now added the append-only marker. A table with no trustworthy ownership/history
   is not guessed to be harmless, migrated or dropped; refuse for operator investigation.
4. Distinguish engine/system tables explicitly (SQLite internals, recognized Drizzle journals and
   Litestream's `_litestream_seq`/`_litestream_lock`). Other unknown tables or an unknown future
   append-only declaration prevent asserting complete protection and refuse trading. Preserve
   all unknown objects. A removed module/table or the A760 squash needs a reviewed retained-schema
   catalogue/reset decision; this proposal does not authorize discarding its history.
5. Inspect expected trigger definitions on existing known tables before migrations. Refuse altered
   same-name definitions without overwriting them. Install **missing** standard trigger pairs on
   retained tables without executing module migrations; record the existing restored warning.
   An existing table newly marked append-only is repaired this way, not stranded awaiting that
   dormant module's next migration. The release description explains the warning.
6. Run only the ordinary selected migration sets in dependency order. Preserve per-set installation
   even if a later set fails. Re-inventory afterwards; protect newly created selected tables, check
   all expected retained tables and definitions, then install the appropriate change feed. Verify
   recursive_triggers on the serving connection as well as trigger definitions. No sale/duty starts
   before this completes. A failed later migration must leave earlier/retained protection present.
7. The running watch retains expected table identities even if a table subsequently disappears;
   it must not repeatedly intersect expectations with whatever happens to exist. Check table
   presence and definitions across disabled sets, and recursive_triggers on the serving handle.
   A runtime fault uses the existing trading refusal/recovery path, not automatic live repair.
   Successful runtime enablement can enlarge this watch set; disabling never shrinks it.

Qualify populated time entries/pay-period closures, payment resolutions and all present fiscal
append-only declarations from the current catalogue, as well as an ordinary mutable ledger table
control. The earlier receipt names fewer tables because it records an earlier read; keep it intact.
Do not create absent fiscal tables, migrate fiscal-none alternatives, change fiscal writers/hashes,
or edit fiscal SQL to implement this infrastructure repair. If its actual implementation requires
an H2-protected file, assertion or behavior change, stop that slice for explicit owner review.
Agreement to this design is not that permission.

## Live updates and worked examples

**My proposal:** always retain a stable module-capabilities revision resource. Notify session
capabilities, Modules, Profile and provider readers after publication. Public Google capabilities
are refreshed through the existing passive public configuration read on return/focus and before
starting login; do not expose authenticated events or enrollment. Keep the live resource-name
catalogue stable for shipped contributions, even while one is Off; do not install feed triggers on
absent tables. Remove disabled screen interests and dispose its renderer safely after drafts have
been accounted for. A disabled-resource refusal must not close unrelated subscriptions. Permission
checks still apply to each data read. Reconnect/reset fetches the applied revision so a lost event
cannot leave a stale navigation choice. Reads are passive session activity.

These are proposed outcomes, not requests run against today's server:

| You do this                                                                                 | Proposed response and visible result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google is disabled; Elena saves a new ID+secret at expected revision 16                     | Revision 17 stores sealed configuration; the GET returns configured=true and no credential values. Google remains disabled and absent from login/Profile. Cancel would submit nothing. Elena must separately choose Enable and confirm before state and capabilities change.                     |
| A manager opens Card payments > Configure card providers                                    | The same catalogue opens at Category = Card providers, State = All, showing configured Stripe and disabled SumUp even if Enabled was remembered. Their panels use owning seats. Widening Category to all modules or posting Google settings is forbidden before any provider call or vault read. |
| Elena submits Stripe Off while table 4 has a €28 unknown attempt                            | Conflict with the unresolved-work reason. Desired operation is Refused; applied remains On. A764's check continues; no cancellation, second charge, sale rewrite or unlocked order is invented by Modules.                                                                                       |
| Stripe has no active readers or unfinished attempts, then Off applies                       | Stripe disappears from new-payment choices. A refund of an earlier €28 payment still resolves through Stripe with retained credentials and existing refund rules. Its late webhook/reconciliation still runs.                                                                                    |
| Elena is the only admin, has Google and no supported password/passkey, and requests Disable | Under either scope, Refused. Google stays enabled; the row shows its red reason and Account security recovery link, with Disable grey. A session does not satisfy the check. Enrollment plus fresh proof and no pending flow permit a new confirmation, keeping the session.                     |
| Elena has password + fresh proof; Pablo is Google-only                                      | Only me permits Disable with the explicit Pablo consequence; Every active administrator refuses naming Pablo until enrollment. These are the two outcomes of the unresolved scope decision, not two policies an operator can choose to bypass a refusal.                                         |
| A kitchen send remains active when another optional service is changed                      | The send completes under its captured revision. It is never cancelled to make a state confirmation or settings save succeed. A busy affected service exceeds five seconds: Refused, old revision retained, retry explicitly later.                                                               |
| The box crashes with desired revision 18 prepared but applied 17                            | Boot serves 17 after preflight and marks 18 Interrupted. Crash after publication commit reconstructs 18; a lost HTTP response can be resolved by operation ID.                                                                                                                                   |
| Workforce is Off, its time_entries table exists, and one standard trigger is missing        | The first repair slice reinstalls the missing trigger before trading and watches the retained table. It does not run workforce's pending migrations. A missing table required by recorded history refuses instead.                                                                               |
| Google is enabled in a restored backup but its vault key cannot open the credential         | Google is explicitly unreadable and accepts no login starts. Do not generate a new key, erase linkage or claim Google is configured successfully. Essential access failure follows curated recovery.                                                                                             |

## Proposed PR boundaries and qualification

These are design boundaries for later planning, **not an implementation plan or build authority**.
Each row is one independent, implementer-sized PR. Split further if a boundary does not fit; do
not combine them into one host rewrite. All wait for owner design agreement plus A739/A764.

| Order | Independently reviewable outcome                                                                 | Focused failing-first checks                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Retained protection and preflight/watch repair, no settings UI or runtime controls               | Real populated database across disabled and dependent sets: missing trigger restored; altered trigger refused; missing required versus never-installed/new table; new marker on retained old schema; unknown/ahead history; failed later migration; absent dormant journal stays unchanged; serving pragma/table disappearance. Demonstrate actual refused mutations and a permitted mutable control.                                                |
| 2     | Descriptor-owned catalogue and effective runtime eligibility, no write controls                  | Full optional inventory/browser parity; independent state/category filters, default Enabled, Add a module selects Disabled, direct provider link selects All states; readable mandatory/provision-only tiers; dependency closure; reject incomplete adapters; no host name lists or browser server imports.                                                                                                                                          |
| 3     | Durable applied/desired operation store and one resolver, no admission change                    | Stale expected revision, idempotent retry, permission boundaries, transactional commit, crash before/after publication and restore interruption; inventory every file/env/session/mirror/export consumer.                                                                                                                                                                                                                                            |
| 4     | Coordinator/router generation dispatch, stable capability/live resource and safe-refusal adapter | Hold a real request across a settings save and a state confirmation, unrelated request continues; timeout leaves old revision; no admission gap; restart reconstructs; unrelated live subscriptions survive disable/reconnect. No product module becomes switchable in this PR.                                                                                                                                                                      |
| 5     | Google module and sealed settings boundary, still no page state controls                         | Real vault round-trip/rotation/wrong key and recovery material; no GET/log/transfer leak; settings saves preserve disabled state; real token-exchange implementation with HTTP/token-signing fixture at its external boundary, not a mocked identity module; callback lease/state lifetime and replay; public method privacy.                                                                                                                        |
| 6     | Google access guard and runtime adapter, after owner selects scope                               | Fresh password/browser passkey proof, expiry/purpose/replay; passwordless/sole-admin refusal; selected-scope Elena/Pablo outcome and concurrent role/status/factor removal/reset/admin-admission cases, including the permitted control; active callback refusal; sessions retained; unavailable Remember method. Do not hardwire all-admin protection while scope is pending.                                                                       |
| 7     | Provider admission/configuration boundary, reuse A739/A764 and A737 behavior                     | Real sealed payload through provider seat and actual HTTP/SDK client boundary with controlled transport; 401/403/409, environment/account mismatch, cached client rotation, collect/refund/unknown/manual-check races, restart debt, historical refund with provider Off, legacy endpoint bypass refusals. No new financial state transitions.                                                                                                       |
| 8     | Modules page, Google Profile visibility and Card payments link/setup move                        | One permission-filtered catalogue; all state/category combinations and direct URLs; wt-row-actions and persistent specific red reasons; centred wt-dialog; no toggles; Configure saves settings only, unchanged Save quiet/disabled, separate state confirmation and server recheck; no-settings dialog; stale/dirty/live races, refused draft retention, successful-save/failed-refresh separation, reused panels and keyboard/Enter/Back behavior. |

For each production PR, observe the focused behavioral failure before implementation and preserve
existing assertions. Use useVenueDb for database work. Qualify critical guards by omitting each in
a disposable checkout, with a negative control that fails for the intended reason and a legitimate
allowed-case control. Include unauthorized/refusal cases at the real route and provider/credential
boundary, not just helper fakes. Run the normal hook once and wait for required **current-head
coverage** jobs at the unchanged repository thresholds; no ceremonial whole-workspace local run.
Each meaningful code branch follows the authorised finish-branch review and landing workflow.

Keep the new write surface unavailable until its prerequisites land. Intermediate Google PRs add
and qualify inert contracts; the final page PR performs the explicit configuration-source cutover
only after sealed re-entry and the access guard are available. It must refuse an unsafe cutover
rather than silently drop an existing Google login. Do not remove a working path in an earlier PR
that depends on a later PR to make administration accessible again.

For every changed visible state, open and inspect the rendered page in **EN/ES, 390px/1280px,
light/dark**, including required entries, configured/unconfigured/unreadable fields, Save/Cancel,
provider unknown-attempt refusal and Google lockout refusal. Use shared primitives/tokens and
focus/axe checks. Static documentation mockups are design aids, not proof that the implementation renders.

## Other lanes and remaining limits

Read-only cross-lane observations, also unverified: A679 checkout `813e0253a` configures module
operation seats at `packages/module/src/operation-preparation.ts:40` and freezes module choices at
`apps/server/src/module-operation-host.ts:128`; A737 checkout `ee78de3b0` retains historical provider
selection in `apps/server/src/bill-refunds.ts:78`; A764 checkout `b1e9e3c38` adds unknown-attempt
expectations in `packages/payments-stripe/src/provider-unknown.test.ts:48`. Those expectations
are not a passing implementation claim. A773 checkout `7d3bd79ff` retains the send entry at
`apps/server/src/working-order.ts:6324`; its proposed course/group rules live in
[the A773 design](2026-10-16-a773-courses-and-groups-design.md).

Preserve A679's selected regime/setup attempt, A773's sends, A737's refund/resume rules and
A764's unknown-resolution ownership. No writer, computeHuella, invoice-number, registerSif or
restoreFiscal changes are authorized. Do not route those operations through a new optional state control
or replace their business rules. If later runtime boundary work reaches campaign H2, mark that PR
**needs-owner-review** before implementation with the exact protected changes; this design supplies
no implied permission. Recheck migration collisions and A760's freeze before any migration PR.

Material uncertainties for planning: which existing optional modules can implement a complete stop
adapter; whether each provider boundary can prove same-account credential replacement; the exact
tables/states A739/A764 finally expose; and how the retained-schema inventory is carried across
A760's squash. They have explicit refusal behavior here, not permission to guess. An adapter or
history format that cannot meet this contract remains read-only until separately qualified.

**One owner question:** Should disabling Google protect **only the administrator making the
change**, or **every active administrator** (recommended: your fresh alternative-login proof,
plus supported enrollment for the others)?
