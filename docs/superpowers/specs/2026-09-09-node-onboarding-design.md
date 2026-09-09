# Node onboarding: demo, preparation, live trading and recovery

Date: 2026-09-09. Status: implementation design following the owner's onboarding discussion.
The four choices and separate production database are agreed. Defaults below make the remaining
implementation choices explicit; the fiscal readiness requirement is a product policy, not a
verified legal obligation. [Implementation plan](../plans/2026-09-09-node-onboarding.md).

## Your first choice

You should be able to explore Waitron, build your restaurant and practise before accepting real
payments. When you go live, you should keep the configuration you tested without bringing practice
sales into production.

| Choice | Starting content | Fiscal submissions | Payments |
| --- | --- | --- | --- |
| Demo | Example restaurant, staff, layouts and historical sales | None | Test only |
| Prepare your restaurant | No sample content; you enter real restaurant configuration | None by default | Test only |
| Go live | Copy prepared configuration (recommended), or start empty | Live for the selected fiscal regime | Live |
| Join or recover an existing restaurant | Add a mirror, or restore a backup | Inherit the existing environment and node duties | Inherit the existing environment and node duties |

Prepare still creates the essential administrator and structural records needed to use Waitron.
Its transactions are simulated; it is not a way to conduct actual business without filing.
Show a persistent mode indicator across dashboard, till and setup completion. Mark simulated receipts
as such. Follow the shared form contract in `docs/developers/design-system.md`, including localized
field errors, required markers, semantic input names and keyboard submission.

Public Demo does not enable developer-only identity overrides. Keep three concepts separate:
deployment environment (`preproduction` or `production`), onboarding intent (demo or preparation),
and developer conveniences. Trace all existing `devMode`, demo/live and environment consumers
before adding persistent intent. An uploaded certificate must not silently enable preparation's
ordinary fiscal submission worker.

## Payments and email while practising

Default to a local payment simulator so Demo and Prepare work without a payment-provider account.
Expose success and decline scenarios. Offer an explicit provider-test connection when you want to
exercise an actual integration; never fall back to live credentials. A live system refuses the
simulator and test credentials. Cash remains a supported production choice without a card provider.

Stripe entered-card testing supports `4242…`; Terminal testing uses a simulated reader or physical
test card, depending on the selected path [P3]. Explain the active path beside the payment controls.

In Demo and Prepare, use configured SMTP if supplied, otherwise provision Mailpit and show
**Open test inbox**. Display whether messages are captured locally or delivered through SMTP.
Resolve the inbox URL for the browser visiting the box, not to that browser's localhost. Serve it
through an authenticated box route so account-recovery messages do not become a public LAN inbox.
Package the capture service for installed nodes as well as development; the application need not
receive the Docker socket. Production requires a deliberate email setup and never silently captures
mail. Missing SMTP must be explained in account setup/recovery, not discovered as a raw send error.

## Carry your preparation into production

Use a versioned, configuration-only export file from the prepared dashboard, uploaded to the new
node. This supports a disconnected transfer and gives you a fixed snapshot to review. No continual
sync or later merge into production is included. An owner-authorized export requires authentication;
imports use the setup authorization boundary. Encrypt the file with an export passphrase because
staff profiles and business configuration are private. Do not include credentials or action tokens.

| Copy, with references remapped | Leave behind or establish afresh |
| --- | --- |
| Tenant/location configuration, products, modifiers, menus, pricing and tax settings | Sales, tenders, refunds, invoices, fiscal submissions and chains |
| Floor plans, table definitions, screen layouts and media | Open orders, bookings, stock movements/balances and working-time records |
| Staff profiles, role assignments and applicable staff configuration | Password/PIN hashes, passkeys, MFA secrets, sessions, invitations and recovery proofs |
| Printer definitions, routing, device profiles and intended hardware assignments | Device enrolments, node identity, membership, replication slots and subscriptions |
| Relevant module settings and payment policy | Invoice counters/series, provider resource IDs, API keys, fiscal certificates and SMTP secrets |

Default account policy: configure the first production administrator during setup. The administrator
who authorizes the preparation export is omitted from the import because setup creates that account
afresh; every other administrator and staff profile is copied in a suspended state and activated
through the normal account setup process. Device and payment connections need a guided
reconnect/check. You do not re-enter menus, layouts or staff profiles. The prepared installation
remains separate for practice.

Each owning module declares its configuration export, validation and import through a module
contract contribution, assembled only by composition. The existing replication classification is
not a transfer policy: identity classifies account-action tokens as `state`
(`packages/identity/src/classification.ts:20`). Enumerate transferable fields and excluded data;
require every installed module to declare support or explicitly declare no transferable configuration.
Reject unsupported modules, incompatible versions, unknown fields and broken references before any
production identity is minted. Media entries need bounds, content checks and safe path handling.

Build a preview with counts and all reconnect/activation tasks. Allocate fresh target IDs with an
explicit reference map; keep the source unchanged. Create the target venue and import its database
configuration in one transaction. Stage non-database material separately and publish it only after
validation. A persistent setup operation records committed steps so a restart resumes publication
and secret installation without re-running fiscal provisioning. Do not expose live sale routes until
activation completes. An interrupted operation remains visibly pending and is recoverable.

## Check fiscal readiness before activating

For Veri*Factu, propose one successful, explicit functional test as the normal initial activation
requirement. The empty-production route uses the same check. A no-filing fiscal regime marks this
step not applicable through its contribution; generic setup does not import the Spanish regime.

You supply the intended fiscal identity and certificate, then choose **Run fiscal test**. Explain
that a small sample goes to AEAT's test service and not to production [P2]. Use a separate test
database and installation identity, exercising the actual record-generation and submission path.
Do not flush historical practice records when enabling this check. Retain the test records and
responses, with bounded retries and a visible pending state for an uncertain result.

An accepted record is the success criterion; a network response, successful handshake or parsed
query response is insufficient. Store server-controlled evidence bound to the fiscal identity,
certificate fingerprint, relevant fiscal configuration, application version and test endpoint.
Changing those inputs invalidates the result. Neither an imported file's assertion of success nor
a browser-supplied boolean authorizes activation. The target runs its own check. Keep secrets
encrypted and out of browser persistence, logs and result summaries.

The test does not prove production-service authorization. Separately check certificate validity,
the intended production endpoint and applicable authorization using a non-filing operation where
supported; name precisely what was checked. Never invent a production sale as a connection probe.
An unavailable test service leaves first activation pending with an actionable retry. This gate does
not run on ordinary boots, sales, mirror adoption or disaster recovery of an existing production
system. It cannot turn an external outage into a block on existing trade.

Before activation, review imported configuration, administrator access, hardware connections,
production payment settings, applicable fiscal checks, email and backup setup/recovery-key custody.
The final **Go live** action starts the fresh production system. It does not change a preparation
database's environment. Preparation may run on the same hardware only by creating a distinct
database and preserving the source; a same-host convenience workflow is outside the first UI slice.

## Join and recovery

**Add a mirror** authenticates to the existing primary and reuses adoption/membership provisioning.
The mirror inherits the primary's environment and starts with mirror duties; it does not accept
sales merely because its setup finished. Show and acknowledge recovery material before restart.

**Restore from backup** collects the artifact and recovery key, validates compatibility and
environment, and invokes the existing cold-restore orchestration against a fresh target. Reuse
module restore hooks, identity-last publication and existing fiscal resets. A backup restore keeps
history; it is never a preparation-to-production transfer. Include the existing failed-primary
isolation procedure before restored production trading to avoid two nodes selling independently.

Both paths need progress, actionable failures and restart recovery in the UI. A link to a CLI
runbook alone does not complete this onboarding choice. Large backup uploads need bounded staging
and cleanup rather than buffering the whole artifact in an HTTP request.

## Development targets

Keep two explicit targets behind the managed `wa-wt` launcher:

- **Dev demo:** migrated, seeded and ready to use, with developer conveniences, simulated payments
  and Mailpit. Reuse the demo content path used by installed Demo.
- **Dev onboarding:** fresh, unprovisioned database and onboarding state; open the shipping wizard.
  Selecting Go live exercises test doubles for external services locally, under an unmistakable
  developer indicator. A normal development launcher must never silently enable live payments or
  production fiscal submission. Real integration tests remain separately configured.

Preserve a locally generated development CA and its key across both targets and database resets;
trust it once per client. Reissue server certificates as names/addresses require. Do not preserve
old trading IDs, module selections or enrolment tokens to achieve certificate persistence. Keep a
separate explicit certificate reset. Never ship this shared development identity in an appliance.
Switches and resets use the one managed dev database service and target-aware environment files;
do not copy a sibling's trading `.env` into the onboarding target.

## Evidence and remaining boundary

These are source readings, not newly executed product or integration tests.

| Ref | Source, accessed 2026-09-09 | Source wording and consequence |
| --- | --- | --- |
| P1 | [AEAT developer FAQ v1.3, §6 pp.16–17 and §11 pp.21–23](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf#page=22); owner's local copy `/Users/clintongormley/Downloads/FAQs-Desarrolladores.pdf` | “en real”: training invoices issued in an operational live system receive real invoice treatment, including cancellation and retained history; numbers are not reused. |
| P2 | [AEAT external test portal](https://preportal.aeat.es/PRE-Exteriores/Inicio/Inicio.html) | “sin que en ningún caso tengan trascendencia tributaria”; “pruebas puntuales”: submissions stay in the test environment without tax consequences; use occasional functional tests, not mass tests or validations integrated into production submission. |
| P3 | [Stripe testing](https://docs.stripe.com/testing) and [Terminal testing](https://docs.stripe.com/terminal/references/testing) | “test card number”; “simulated card reader”; “physical test card”: choose the test method appropriate to the payment interface. |

P1 discusses operational invoicing. It does not by itself establish the compliance of distributing
Prepare as proposed. Record that precise question in the compliance track before release. No
source above establishes a per-restaurant legal duty to pass a sandbox test. Live training with
automatic issue/cancel is a separate feature, not part of this plan.

Other exclusions: third-party POS/CSV migration, continuous configuration promotion, additional
payment providers, appliance OS installation and a new failover protocol. Existing backlog items
retain those scopes.
