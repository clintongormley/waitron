# The cloud storage model: a sync root, not a shared system of record

**Date:** 2026-07-31
**Status:** approved design, not yet implemented
**Decides:** how many databases the cloud has, what they hold, and what a venue gets back after a
disaster.

---

## 1. Why this spec exists

`2026-07-18-pos-architecture-design.md` §5 establishes a sync tree — tills are leaves, a local
server is an interior node, "the cloud, when present, is the root" — and §4 records that the cloud
database is Postgres "with RLS as tenant backstop". What it does not settle is whether the cloud is a
**system of record** or a **sync target**, and the two answers produce very different systems.

The question surfaced from an unrelated direction. `fix/provisioning-migrate-gate` made
`waitron-provision instance` apply migrations on every run, which raised: when may a column ever be
dropped? For a shared multi-tenant database serving customers on different software versions, the
answer is "once every customer has upgraded" — which is unanswerable today, because **nothing records
what version any deployment runs** (`deployment` carries `environment` and `stamped_at` and nothing
else; there is no `app_version`/`schema_version` anywhere in `packages` or `apps`). That made the
tenancy model a blocker for an unrelated piece of work, which is why it is being settled now.

**Scope.** This spec decides the storage and tenancy model only. The sync protocol, the analytics
projection, the remote-admin surface and the local restore flow each depend on its answers and each
get their own spec (§9).

## 2. The cloud is a sync root and never a primary store

**Every venue runs a local server as its system of record.** The cloud holds copies.

**This supersedes one row of `2026-07-18-pos-architecture-design.md` §5's topology table.** That table
lists "Cloud SaaS, no local hardware | till → cloud" as a supported deployment; under this design it
is not, because it would make the cloud a primary transactional store for those tenants and
reintroduce every problem §2 exists to remove — a shared schema serving multiple software versions,
with no version telemetry to reason about it. The architecture design carries a dated pointer to
this spec; its table is left as written, per `CLAUDE.md` §6. Reinstating that topology is not a
tweak to this design — it is a different one, and would need this spec revisited whole.

This is the decision everything else follows from, and it dissolves the problem that prompted the
spec:

| Store | Writers | Versions in play | Skew? |
| --- | --- | --- | --- |
| A venue's local database | that venue's server | one — code and schema deploy together | none |
| The cloud database | the cloud deployment | one | none |
| Between them | the sync protocol | many | **all of it, here** |

No schema is ever shared between two software versions. Version skew moves entirely into the sync
protocol, which is a place designed to have it and where versioning is a solved problem. The
corollary matters for the work that raised this: **the additive-only migration constraint applies to
the protocol, not to any database schema**, and `instance` provisioning a single-tenant database
becomes the ordinary case rather than a special one.

## 3. The cloud is never in a critical path

Stated as invariants, because each is a thing the design must not quietly acquire later:

- **Never in the sale path.** Nothing about taking a sale consults it.
- **Never in the payment path.** Card-present outcomes return through the till's own call
  (`packages/payments-stripe/src/device-provider.ts`); card-not-present is backstopped by the
  reconciler, which is built around "the processor's settlement report for a window"
  (`packages/payments/src/reconcile.ts`) — a pull, not a callback. Webhooks are therefore a **latency
  optimisation, not a correctness requirement**, and a provider callback must never need to reach
  Waitron's cloud for a payment to be eventually correct.
- **Never holds the key ring.** See §6.
- **May be down indefinitely.** No venue notices except that sync lags.

A venue with no internet loses asynchronous card confirmation — the provider cannot reach anyone —
and nothing else. That degradation is the provider's connectivity, not Waitron's availability.

## 4. What the cloud stores: three shapes, all append-only

| Shape | Contents | Why append-only |
| --- | --- | --- |
| **Fiscal archive** | `registros_facturacion`, submission/`envios` state | The source is append-only by trigger and by law; a mutable copy could silently diverge from the venue's own. |
| **History** | Sales, invoices, payments, incidents | Immutable once closed at the source. |
| **Configuration** | Tenant identity (incl. `tenant_id`), catalogue, locations, till registry, `invoice_series` including `next_number`, staff, sealed credentials, hardware settings | **Versioned snapshots**, not current-state. |

Configuration is the one that had to change shape. A current-state, last-write-wins snapshot
faithfully replicates mistakes: someone deletes half the menu, it syncs up, and the backup has
destroyed the recovery point. **Whole-config snapshots, content-addressed and deduplicated, retained
indefinitely** — an unchanged config records "still in effect at T" rather than storing a copy.

Whole-config rather than per-entity versioning, because restore then means "give me the configuration
as of T" rather than assembling a consistent view from independently-versioned entities — fewer
failure modes at the moment they are least affordable. Configuration is kilobytes; retaining every
distinct version is free.

A useful side effect is an audit trail: every configuration a venue has ever had, with the window
each was in effect. Capturing the actor alongside it is worth doing where the local server knows it,
but is not a requirement of this design.

This does not affect fiscal correctness in either direction: §6 of the architecture design already
establishes that invoices snapshot their values rather than referencing them, so a historical price
lives on the invoice and is never derived from configuration history.

## 5. The restore promise

**What a venue is owed after losing its server: its records, its history, and its configuration.
Not its in-flight trading state.**

Given a replacement box and the key ring the operator was told to keep:

1. `waitron-provision instance` — a blank local database.
2. Configuration is pulled from the cloud: catalogue, locations, staff, series, sealed credentials.
3. The operator supplies the key ring; credentials unseal. **`tenant_id` must be restored, never
   regenerated** — see §6.
4. Each till is re-registered. Each mints a fresh installation number and starts a new chain, which
   is the existing invariant for reimaged hardware, applied deliberately rather than worked around.
5. **Series numbering resumes from the restored `next_number`.** This is what reconciles "trading
   restarts fresh" with "invoice numbers are never reused": the chain restarts, the numbering
   continues, and the never-reuse invariant survives because the cloud remembered the counter.
6. The fiscal archive and history are **not** replayed into the new local database.

Point 6 is a decision, not an omission. Replaying historical records into tables whose purpose is
append-only immutability, under a hash chain the replacement till is not part of, is the operation
most likely to produce something unverifiable — and unverifiable is the one outcome Veri*Factu exists
to make detectable. The venue keeps access to its history through §7 instead.

## 6. Credentials survive a disaster without the cloud ever holding a secret

`tenant_credentials` stores AES-GCM sealed blobs — `ciphertext`, `iv`, `auth_tag`, `key_version` —
with the AAD bound to `(tenant_id, purpose)` (`packages/credentials/src/cipher.ts`). The rows are
useless without the key ring, and **the cloud never holds the key ring**. So the sealed blobs can be
synced and restored, which is what makes "get installed again after a disaster" reach the fiscal
certificate and the payment credentials rather than stopping short of them.

Two consequences the implementation must respect:

- **`tenant_id` is restored, not regenerated.** The AAD binds to it; a fresh UUID makes every sealed
  blob permanently unopenable.
- **The key ring remains the operator's to keep.** This design does not weaken that, and must not
  drift into "the cloud can recover it for you" — it cannot, by construction, and that is the point.

## 7. Reporting: one projection, two hosts

Reports run **from the cloud for subscribers** and **locally for self-hosted deployments**. The same
projection — one schema, one transform — deployed in either place, following §5's "one sync
implementation, tested once" rather than inventing a cloud-only concept.

This turns §5's point 6 from a limitation into the product: a subscriber's reports live where their
data lives, and a venue that never subscribes runs the identical reporting locally over its own data.

**Export on demand is a requirement, not a courtesy.** A customer ending their subscription takes
their data with them. This is also regulatory — see §8.

## 8. Regulatory position

Per `CLAUDE.md` §1, external claims carry their source's own words rather than a paraphrase.

| Claim | Source | Verbatim |
| --- | --- | --- |
| One system may serve several taxpayers | RRSIF (RD 1007/2023) art. 7.a) | *"Podrá utilizarse un mismo sistema informático … por parte de diversos obligados tributarios … siempre que los registros de facturación de cada obligado tributario se encuentren diferenciados y se cumplan los requisitos exigidos en este Reglamento por separado para cada uno de los obligados tributarios"* |
| "Diferenciados" means independent chaining | AEAT FAQ, SIF for multiple obligados | *"debe gestionar separadamente los registros de facturación … con encadenamiento independiente para dichos registros de cada OEF"* |
| Export to external storage is required | RRSIF art. 8.2.c) | *"El sistema informático deberá contar con un procedimiento de descarga, volcado y archivo seguro de los registros de facturación generados por él, que deberán poder ser exportados a un almacenamiento externo en formato electrónico legible."* |

Sources: [BOE RD 1007/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840) ·
[AEAT FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/caracteristicas-requisitos-sistemas-informaticos-facturacion-multiple.html)

**What the sources establish:** the operative requirement for a multi-taxpayer system is
*differentiation with independent chaining*. Neither the article nor AEAT's gloss mentions physical
separation, separate databases or separate instances. Waitron already satisfies the named requirement
structurally: a SIF is identified by NIF + IdSIF + NºInstalación
(`packages/fiscal-verifactu/src/registro-sif.test.ts:62`), so chaining is independent per taxpayer by
construction rather than by policy.

**What they do not establish, stated plainly:** the cloud archive is not itself a SIF — it issues no
invoices — and no provision was found that expressly addresses a third party conserving registros on
a taxpayer's behalf. Absence of text is weak evidence, and "diferenciados" is a qualifier whose
sufficiency threshold is an advisor's judgement.

**Ruling taken 2026-07-31 (user's, on the evidence above):** records need not be stored separately per
taxpayer; they must be **exportable** separately. The export path must therefore be able to produce
one taxpayer's registros in isolation in legible electronic format — which art. 8.2.c) requires
independently of this design.

This is a sourced reading, not legal advice, and remains open to the fiscal advisor's confirmation on
the narrow question of whether the archive is in scope at all.

## 9. Isolation

**One shared cloud database**, tenant-scoped by RLS — the model already built and exercised for
exactly this shape. Two additions beyond reusing it:

**Reproduce the local immutability guarantees at the grant level.** Locally, `registros_facturacion`
carries `REVOKE ALL`, an append-only trigger and a TRUNCATE-blocking trigger. The cloud archive
carries the same, and the sync-ingest role holds `INSERT` and nothing else on it. A cloud that can
`UPDATE` a fiscal record it received is a cloud that can silently disagree with the venue's own copy,
and the archive's entire value is that it agrees.

**Separate roles by job**, following the least-privilege pattern the provisioning tool establishes: an
ingest role, a read role for remote admin, an analytics role. None a superuser, none holding
`BYPASSRLS` — `planInstance`'s `assertUsable` already refuses those for a reason that transfers
directly: a role that ignores tenant isolation produces a deployment that looks provisioned and
isolates nothing.

## 10. Out of scope

Each of these depends on this spec's answers and gets its own:

- **The sync protocol** — the version boundary §2 puts all the skew into. The largest of these.
- **The analytics/reporting projection** and its transform (§7).
- **The remote-admin read surface.**
- **The local restore flow** — the client half of §5.
- **Data export** — the mechanism art. 8.2.c) requires and §7 promises.

**Deliberately not built:** a control-plane database (needed only for per-tenant cloud databases, which
this design rejects); fleet migration tooling (the cloud is one deployment at one version); a webhook
endpoint as a correctness mechanism (§3 demotes it to an optimisation).

**Open, and owned by nobody yet:** whether the fiscal advisor's answer on §8's narrow question changes
anything; and whether version telemetry is worth adding for its own sake, now that it is no longer
load-bearing for schema evolution.
