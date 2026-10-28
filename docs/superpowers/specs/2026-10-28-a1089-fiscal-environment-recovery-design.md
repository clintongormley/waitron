# A1089: inspect fiscal environment refusals before choosing recovery

**PROPOSAL, 2026-10-28. Awaiting owner scope approval. No implementation authority.**
This design does not complete A1089. It proposes a first evidence slice and leaves persistent repair OPEN.
This document authorises no setup or backup mutation.

## Why changing one setting is not an answer

When a fiscal record is refused, you need to distinguish a wrong host setting from unknown immutable
metadata before choosing what to do. A record, its database, the running process and saved setup intent
can tell different stories. One incident cannot decide which story has authority.
The requirement comes from [A1089](../../backlog.md) and its [fiscal-environment audit](../../backlog/self-service-refusals.md#fiscal-environment).
Missing metadata does not establish a Waitron bug, and you cannot edit it into a known environment.

Recommend planning a **running-dashboard, read-only inspection** first. It gives you current, limited
facts without claiming to repair configuration or recover a failed start. Both remain OPEN.
Changing `WAITRON_ENV` alone is not a qualified remedy for an arbitrary stamped mismatch: it may
conflict with the database stamp, saved identity/intent or retained history and refuse the next boot.

## Actual boundaries and evidence limits

These are source-inspection receipts at `dda0bbff5`, with repository-relative paths and line numbers.
Source search is not runtime reachability proof. Executed fixture results are listed separately below.

| Boundary | What the source establishes |
| --- | --- |
| Record refusal | `packages/fiscal-verifactu/src/drain.ts:569` defines `claimBatch`; `:661` distinguishes null `entorno` (`fiscal.environment_unknown`) from disagreement (`fiscal.environment_mismatch`). Parameters identify the record and host, plus record environment for mismatch. `:677` blocks its chain and records an incident; only retained sendable rows get attempt/state stamps at `:688`. |
| Successors and another chain | The pass owns `blockedSifIds` (`packages/fiscal-verifactu/src/drain.ts:239`), passes it through claims (`:259`), excludes previously blocked chains (`:599`) and skips successors (`:659`). This is a pass-local block, not a demonstrated persistent repair or venue-wide sales stop. |
| Exercised guard cases | `packages/fiscal-verifactu/src/drain.test.ts:1592` checks mismatch stays pending and exact incident parameters; `:1629` checks null separately; `:1660` checks matching environments submit. `:1680` asserts all three chain rows stay pending with zero attempts and no matching fake-AEAT record; `:1736` asserts one healthy later chain is accepted beyond a full refused window. |
| Fiscal ownership | `packages/fiscal/src/contribution.ts:135` supplies the history probe contract; `packages/fiscal-verifactu/src/slot.ts:53` implements it, treating null or non-production history as non-production evidence. Its drain constructs transport inside the fiscal module (`:75`). Generic server code must not learn fiscal table names. |
| Database guard | `apps/server/src/deployment-guard.ts:13` reads the database stamp. A missing stamp on production invokes fiscal contributions and can refuse with `databaseEnvironment: "nonproduction"` (`:18`); that classification is not a stored stamp. A known disagreeing stamp refuses at `:28`. |
| Startup order | `apps/server/src/boot.ts:967` opens the stamp probe and `:973` checks the effective environment against it, before migrations (`:994`), alerts API (`:2412`), dashboard mount (`:2787`) and trading listener (`:2815`). Startup pins the process environment against the database stamp; this check does not write a new stamp. |
| Stamp reader/writer | `packages/db/src/deployment.ts:56` returns null for an absent table or empty singleton. `:72` stamps an unstamped database, accepts the same value and refuses replacement. `packages/provisioning/src/first-setup-command-deployment.ts:320` calls the writer before applying the venue. Inspection must never call it. |
| Effective process configuration | `apps/server/src/config.ts:338` delegates environment parsing to `packages/db/src/deployment.ts:22`: unset/empty/dev map to preproduction; production must match exactly; invalid values refuse. `config.ts:354` distinguishes dev mode, and `:359` checks onboarding intent against environment. |
| Input precedence | `apps/server/src/box-env.ts:7` orders secrets, trading and backup files; `:28` overlays non-empty process values last. Empty process values do not mask saved values. `apps/server/src/node-entry.ts:659` loads these inputs and passes both merged and original process environments to startup (`:663`). |
| Saved configuration | `apps/server/src/trading-config.ts:31` writes node/location, environment/dev and optional onboarding intent/account key atomically at mode 0600. The file is not safe to display whole. `deploy/README.md:652` deliberately omits `WAITRON_ENV` from operator `.env` because the wizard persists intent in state. |
| Restore gate | `apps/server/src/restore-gate.ts:20` refuses a backup/target environment mismatch before its schema checks. This pure check does not qualify restoring or safely replaying refused records. |
| Incident visibility | `packages/fiscal-verifactu/src/alerts.ts:10` exports `FISCAL_ALERTS`; its `fiscal.` claim requires `fiscal.view` and names no screen. `apps/server/src/alerts.ts:115` filters recorded incidents by that permission, independently of the fiscal submission pass. |
| Existing alert routes | `apps/server/src/alerts-api.ts:96` resolves the session for list reads; GETs are mounted at `:126`. POST Mark handled checks the claim's permission (`:137`) and calls acknowledgement (`:144`); `packages/core/src/incidents.ts:307` writes acknowledgement fields only. It is not repair or resubmission. |
| Dashboard actions | `apps/dashboard/src/widgets/alert-format.ts:38` offers a target only when a screen is supplied and permitted. `:44` acknowledges and invalidates incident data. There is no fiscal-environment target in the cited claim; do not invent “Go to” an existing repair screen. |
| Failed-start surface | `apps/server/src/node-entry.ts:676` catches startup failure. `apps/server/src/recovery-surface.ts:351` has deployment-mismatch wording referring to the installer. Its public page precedes normal authentication (`:50`); this is a separate recovery boundary, not an available dashboard sign-in journey. |

The following unchanged baselines ran on 28 October 2026 in an isolated worktree at that revision.

| Command recorded in `baseline-results.json` | Actual log result, each exit 0 |
| --- | --- |
| `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts -t 'deployment-environment guard'` | `drain-environment.log`: 1 file passed; 5 tests passed, 47 skipped. |
| `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts src/restore-gate.test.ts src/alerts.test.ts src/alerts-api.test.ts` | `server-boundaries.log`: 4 files, 73 tests passed. |
| `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` | `protected.log`: 2 files, 20 tests passed, including the write-path golden assertions. |
| `pnpm --filter @waitron/server exec vitest run src/box-env.test.ts` | `box-env.log`: 1 file, 7 tests passed, including non-empty process precedence and empty-value fallback. |

These are local fixtures, including fake AEAT. They qualify neither live AEAT nor the proposed inspection,
failed-start authentication, supervisor correction, restart/rollback or an evidence-preserving fiscal recovery.

## Proposed running-dashboard experience

Add **Inspect environment / Examinar entorno** beside these two fiscal incident codes, through a new
module-contributed inspection action. Opening an old incident starts a fresh authorised read; its saved
parameters remain labelled “When detected”, never presented as current configuration or repair authority.
Show loading, observed-at time, unavailable/stale states and these separately permissioned facts:

| Fact | Proposed authority and presentation |
| --- | --- |
| Incident code and record id | `fiscal.view`; resolve the incident server-side and validate its code and record association. Never accept caller-supplied incident parameters as evidence. |
| Record environment | `fiscal.view`; fiscal contribution reads that immutable record. Show production, preproduction or unknown explicitly. Missing record/unreadable evidence is unavailable, not a guessed environment. |
| Database environment | `fiscal.view`; use the exported stamp reader. Null means unknown; do not infer production from a successful start or translate the history-probe classification into a stamp. |
| Effective host environment and source | Also require `system.manage`; show the boot-captured value/dev flag and allowlisted source label: process override, named state file or default. Unknown provenance stays unknown. |
| Saved intent | Also require `system.manage`; show only saved environment/dev and optional demo/prepare/live intent, distinguishing absent, unreadable and invalid inputs. Present current saved values separately from the inputs used at boot. |

Example, proposed EN: “Record: preproduction. Database: production. Running box: production.
These facts disagree. Inspection cannot choose a repair. Nothing was changed.”
ES: “Registro: preproducción. Base de datos: producción. Equipo en ejecución: producción.
Estos datos no coinciden. La inspección no puede elegir una reparación. No se ha cambiado nada.”
For null metadata say “Record environment unknown; preserved unchanged” /
“Entorno del registro desconocido; se conserva sin cambios”. Do not label it a confirmed product fault.

Offer **Read again / Volver a leer**, **Sign in for host details / Iniciar sesión para ver datos del equipo**
when needed, and **Stop / Cerrar inspección**. Explain that Stop closes inspection without changing filing
or stopping all sales. Refused chain facts do not establish that the whole venue has stopped selling.
“Persistent repair is not available in this inspection” must remain explicit; no referral replaces it.
Existing **Mark handled / Marcar como atendida** remains a separate acknowledgement, never automatic.

## Proposed contracts, permissions and freshness

Extend the optional fiscal contribution with an environment-evidence seat, a read-only callback, and its
browser contribution with the inspection action. The module owns record lookup, association and fiscal
meaning; the host adds database/process/saved facts through generic contracts. No direct regime import,
fiscal SQL in the server, or larger module-boundary allowlist is proposed. Disabled/absent seats return
unavailable. This is module/server/UI work, even when its first scope excludes failed startup.

Propose an incident-bound GET under `/management-api/fiscal-environment/incidents/:id` with `no-store`.
Authorise `fiscal.view` before record access and `system.manage` separately before host-source access.
Fiscal history viewing grants no authority to change host configuration, even when both read permissions
are held. Denied host details are omitted/redacted, not fetched into a hidden browser field.
Recheck session status/permissions before returning evidence; expire and clear the panel at session expiry.
Offer sign-in at the inspection surface, with existing second factors, throttling and account-existence
protections. A shell continuation for that action must be designed and exercised; do not assume one exists.
Account changes discard evidence and require an explicit fresh read; passkey prompts require a gesture.

GET has no side effects: no last-seen touch, change-log drain, incident acknowledgement or file/database
write. Existing list-read behaviour is not sufficient: use no-touch session resolution
(`packages/identity/src/management-session.ts:87`) and an explicit read-only/no-drain host turn.
Capture provenance at the real loader/boot boundary rather than infer it from today's files alone.
Read known state inputs only; return allowlisted enums/ids/timestamps, never credentials, account keys,
full `trading.env`, raw SQL, log tails, exception strings or unrestricted file contents.
Accept only the incident identifier, not arbitrary file paths, SQL, environments or uploaded evidence as
authority. Contradictory, changed or unreadable inputs yield partial/unavailable evidence, never a remedy.
Label separate observations honestly; do not claim an atomic snapshot across database, process and files.
Use a five-second diagnostic read deadline and a request generation. Close/reopen, newer reads and expiry
invalidate older answers; delayed results cannot repaint or release a newer read's busy state.
Keep results in memory only; no automatic export, persistent diagnostic history or automatic polling.

## Failed start and persistent repair remain OPEN

The recommended slice cannot serve a failed boot. Before extending it there, design startup-safe
authentication and evidence access without normal dashboard routes, migrations or trading duties.
The owner must scope trusted identity/verifier availability, HTTPS, abuse limits, expiry, revocation,
read-only venue ownership and public/private evidence separation. Missing identity or unreadable history
must refuse privileged access. A dashboard login link on the failed-start page does not supply these.

A later automatic host-source repair needs independent authority from durable matching saved identity
and history, including database/record evidence; neither a single incident nor a selected environment
is enough. Re-authorise explicitly at the action and re-read all evidence. Contradictions or nulls MUST
refuse automatic repair. Limit any correction to removal of a proved process override that masks the
matching saved identity; do not rewrite saved intent or choose a new database environment.
Before such an action can be offered, establish platform/supervisor ownership of that override, exact
mutation rights, concurrent-change protection, restart outcome, loss of connection and rollback handling.
An application cannot promise removal of an environment supplied by an unowned supervisor.
This is a future design obligation, not an executable correction specified or authorised here.

Unknown record metadata needs an evidence-preserving fiscal decision. Preserve originals and identify
which authority can decide continuity; do not guess, edit records or claim a backup safely replays them.
Lane A owns the setup/backup recovery redesign. This proposal neither designs nor authorises its mutations.
This document authorises no filing/AEAT requests, retries, reset, restore, certificate/network changes,
environment switching, record writes, invoice-number resets, new series or promotion of test data.

## Prospective behavioural and deletion checks

These checks are required for an approved build, not completed verification of this proposal.

1. Through the real route and module seat, inspect mismatch/null/matching records and absent stamps;
   assert exact distinct facts, record association, unknown versus unavailable and no inferred repair.
   Delete the module read: the expected record evidence must fail; an absent module must still answer unavailable.
2. Exercise process-over-file, empty-process fallback, state-file ordering, dev, absent/invalid saved intent
   and a file changed since boot. Assert boot value/source separately from fresh saved intent. Remove source
   tracking: provenance assertions must fail; a genuinely unknown source must remain an allowed result.
3. Missing/expired/revoked sessions and missing `fiscal.view` return no record facts; fiscal-only viewers
   receive no host details. Remove each permission check separately and watch its disclosure assertion fail.
   Revoke `system.manage` during a delayed read; assert no host evidence returns. Exercise sign-in and expiry.
4. In isolated real database/state fixtures, compare records, chains, counters, outbox, stamp, incidents,
   session last-seen and state-file bytes before/after successful, refused and cancelled GETs. Trap submission,
   restore/reset, stamp/config writes and acknowledgement: zero calls. Repeat reads must remain read-only.
5. Delay reads across close/reopen, account switch and expiry; assert no stale evidence or busy-state release.
   Seed secret markers into files/errors; assert absence from HTTP, UI and logs. Reject injected paths/SQL
   and forged record associations. Exceed the deadline and confirm bounded failure and a usable next read.
6. Preserve the five drain cases and deployment/restore/alert baselines, plus golden/inmutabilidad assertions
   and fixtures unchanged. Under an outer deadline, deleting successor exclusion must fail the zero-attempt case; deleting blocked-chain
   window exclusion must fail the healthy-other-chain case. Neither check establishes a venue-wide sales stop.
7. Qualify EN/ES loading, mismatch, unknown, unavailable, restricted, expired and stale states through the
   actual dashboard shell: keyboard/focus and accessibility checks, visual inspection in both themes at desktop
   and phone width. Assert Stop closes only inspection and Mark handled only acknowledges. Update both guides
   with shared heading ids. A later failed-start build additionally needs real failed-boot/authentication tests.

## One owner decision before planning

**A, recommended:** plan the running-dashboard read-only evidence slice above, explicitly leaving failed-start
access and persistent repair OPEN. It reduces uncertainty without depending on Lane A's mutation design.
**B:** design full failed-start access plus authorised configuration correction before any build. This addresses
the broader recovery gap first, but requires startup identity and platform restart/rollback decisions now.
The owner has not chosen either alternative. Approval of this proposal's scope is required before a plan or build.
