# A1018 — controlled and emergency handover between two boxes — Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`. An implementer that passes about 150 tool calls with its task
> unfinished stops at a passing (or cleanly failing) point, commits, and hands over.

**Goal:** Let a venue move from its old box (called M1) to a selected replacement (M2) in two
ways — a *controlled handover*, when M1 still answers, and an *emergency handover*, when it does
not — so that M2 runs the venue under its own identity and a fresh invoice series, M2 alone talks
to the Spanish tax agency (AEAT) afterwards, and a returning M1 hands back only its tax records and
AEAT's answers.

**Architecture:** One new generic package, `@waitron/handover`, owns the signed message formats,
digests and the order of steps. Each box keeps its handover progress in its own `node.db` (the
per-box database file that the venue copy never overwrites). The server gains routes on both
boxes; the tax module contributes what only it understands (a summary of each invoice chain, and
building and applying the returned tax records) through new optional module seats, so generic code
never learns the tax regime. Everything is built and tested local-to-local first; the Cloud
placements reuse the same steps once the Cloud half is jointly specified.

**Tech Stack:** TypeScript, Hono routes, Lit screens, Drizzle on SQLite (`@waitron/store`),
Ed25519 signatures (`@waitron/membership`'s `signBytes`/`verifyBytes`), Vitest (Node and real
Chromium), the `bench/sqlite-failover` rig.

**Spec:** [A1018 design](../specs/2026-10-23-a1018-simple-handover-design.md), owner-approved
2026-10-24 as published at `2c13c7f55d` (both Harbour Kitchen handovers, §§8–9, and the retained
defaults in §§3, 5 and 7). Read beside it: [A947 design](../specs/2026-10-21-a947-two-box-failover-design.md)
§§6.3, 6.4, 7, 7.1, 7.2, 11, and the [A947 slice 3a plan](2026-10-31-a947-3a-node-db.md) (what
`node.db` holds). Build authority: the owner, 2026-11-01, "Yes, build it" (campaign queue, A1018).

---

## Words used in this plan

- **M1, M2**: the old box and the selected replacement, as in the design.
- **Stepdown**: M1 writes, on its own disk, that it has handed over, then restarts into a
  *restricted start*: it sells nothing, files nothing, contacts AEAT in no way, and serves only
  its status page and the handover routes.
- **Final copy**: a complete, consistent copy of M1's `venue.db` taken after stepdown.
- **Indicator**: the signed summary M1 sends with the final copy, which M2 checks the copy against
  (design §3).
- **Relinquishment**: M1's signed record that it gives up filing to this M2 (design §§2, 6).
- **Declaration**: the emergency statement a person makes on M2 — M1 is switched off, nobody else
  is recovering the venue, and the missing last minutes are accepted (design §4).
- **Return batch**: what a returning M1 sends M2 after an emergency — its tax records M2 lacks,
  the filing state of all its tax records, every AEAT answer it received, and any send whose answer
  is still unknown (design §§5–6).
- **Chain**: one box's sequence of tax records, each linked to the one before by its fingerprint
  (the *huella*). A new box always starts a new chain.
- **Filing**: sending tax records to AEAT. **Drain**: the code that does it
  (`packages/fiscal-verifactu/src/drain.ts`).
- **Mirror**: a box in `mode = mirror`, serving read-only (`packages/node-db/src/schema/node-mode.ts:11`).
- **Simulation**: two servers started in one test process on two folders. It is a test, never
  physical qualification.

---

## Before you build: what this plan depends on, and what it can build now

**A947 slices 3b onwards are not built** (campaign queue, A947 heading: "NEXT for A947: slices 3b
onwards"; `git log --oneline origin/main | grep -i a947` on 2026-11-02 shows only 3a, #2371, and 4a,
#1990). Four facts follow, each traced on `61bfdfe405`:

1. **A joined spare never finishes joining today.** `adoptFromPrimary` writes a pending-adoption
   latch (`apps/server/src/adopt.ts:195-202`); finishing refuses `mirror.venue_not_copied` while
   the spare's `venue.db` holds no venue row (`apps/server/src/reserved-identity.ts:68-69`), and
   nothing copies one (`apps/server/src/finish-adoption.ts:29-33`). While latched, a spare serves
   only `/health` and its box status (`apps/server/src/boot.ts:1540-1579`).
2. **Both boxes put the same address in the membership chart** (A947 §2; `apps/server/src/adopt.ts:109` sends the
   advertised origin, `https://waitron.local` by default), so neither can address the other by the
   chart. A947 slice 3b gives each box its own name.
3. **Nothing follows the main box's stream into a live copy** (A947 slice 3c).
4. **The spare's own `nodes` row is not in the main box's database** until A947 3b writes it, and
   promotion refuses `node.not_found` without it (`apps/server/src/promote.ts:250-254`).

So this plan is cut in two:

- **Buildable now, and useful alone** (Slices 0–4, 9): formats, durable progress, the restricted
  start, the boot check, capture of the final copy, the prototype re-run.
- **Buildable now against a simulated mirror, reachable on real boxes only after A947 3b** (Slices
  5–8, 10–14): every step where M2 runs. Their tests start M2 as a mirror whose `venue.db` was
  seeded from M1's, the pattern `apps/server/src/till-reroute-e2e.test.ts:315-392` already uses
  (both servers up together, M2 promoted and restarted). A mirror that has finished joining already
  mounts the full application behind the read-only gate (`boot.ts:1699-1724`). On a real venue,
  M2's routes refuse with `handover.destination_unaddressable` while M2's chart address equals
  M1's (Task 5.2), so nothing here is reachable before A947 3b by accident. The emergency's
  continuous last copy arrives with A947 3c; until then Slice 14's selected-backup copy is the
  only copy source a real spare has.

A947 slices 4b, 4c, 4d, 4e, 5a, 5b, 5c and 5d overlap this plan. Slice 0 writes the amendment that
says which A1018 slice replaces or narrows each.

---

## Questions for the owner

**One question; the build proceeds on its recommended default, and only Slice 11 depends on it.**

### Q1 — When the old box comes back after an emergency, may an invoice the new box never saw come back as a tax record only, kept apart from the new box's sales?

**What forces the question.** The design says only fiscal records return, never M1's business
rows (§5). But today a tax record cannot be stored without its sale: `registros_facturacion.sale_id`
is required and points at `sales` (`packages/fiscal-verifactu/src/schema/registros.ts:52-55`), the
sale row points at the order it was rung from (`sales.working_order_id`, foreign key
`sales_working_order_fk`, `packages/db/src/schema/sales.ts:119,141`), and an order may be closed only
once (`sales_working_order_id_key`, `:144`). The design did not settle this; nothing in it chooses
between the two ways round it below.

**A worked example (the design's §9).** Harbour Kitchen's M1 issued invoice `A-0CNNW/218` at 21:40
for table 4 (€100.00 taxable, €10.00 VAT, €110.00 in cash). M2's copy is from 21:39, when table 4
was still open. After the switch a waiter, seeing table 4 open on M2, closes it again on M2. At
23:30 M1 comes back and returns invoice 218.

- **(a) Recommended: invoice 218 comes back as a tax record only, kept in a separate store on M2,
  and M2 files it from there.** M2's sales, VAT, cash-up and payment reports do not count it; the
  reconciliation list shows it — 23 October, €100.00 taxable, €10.00 VAT, €110.00 gross, "issued on
  the old box, no sale on this box" — and the VAT report shows a line "invoices returned from the
  old box" with those totals beside its own. Table 4's second close on M2 stays as it is, and the
  list shows both, for a manager to settle with a new correction if needed. **Cost:** a second
  store for returned records, and a second filing path that reuses the drain's sending and
  duplicate handling (Slice 11): fiscal code the owner lands, with a fresh-context review of its
  own. M2's own VAT report needs the extra line to be complete.
- **(b) Invoice 218 comes back whole: its tax record, its sale and lines, and — because the
  database requires it — the order row it was rung from, read-only.** M2's VAT report then counts
  it by itself; cash-up and payments still do not. **Cost:** order rows (and, for a full invoice,
  the customer row the order names) come back after all, which the design rules out; and in this
  example it cannot work at all — table 4 is already closed on M2, so the import would be refused
  by `sales_working_order_id_key` (read from the constraint, not run), and invoice 218 could then
  never be filed. Option (b) would still
  need (a)'s separate store for that case.

**Default built:** (a). Slices 0–10 and 12–14 are the same under either answer.

**No other owner question.** The design's retained defaults decide everything else; the choices
this plan makes as a builder are listed under "Decisions this plan makes" with their reasons.

---

## Decisions this plan makes (builder's choices, open to the owner)

1. **Stepdown is a restart, not a live switch.** M1 writes its restriction to `node.db`, stops
   starting new work, lets work already started finish to its own deadline, and restarts into the
   restricted start (Slice 2). Why: no live way to close every writer exists — the read-only gate
   is mounted only at boot (`boot.ts:1699-1718`), and `TradingAdmission.requireRestart`
   (`apps/server/src/trading-admission.ts:19-21`) covers only "economic" writes
   (`:26-33`) — while the restricted start can refuse to start each writer, which a test can list.
   The restart already exists for promotion (`boot.ts:3079-3092`; Docker restarts the box,
   `deploy/compose.yml:12`).
2. **A stepdown waits for requests already admitted, not only for background passes.** The
   background loops already finish a pass in flight when stopped: the abort is checked after the
   pass (`apps/server/src/loop.ts:77-80`), and both the drain and the card loop run on `runLoop`
   (`boot.ts:3200`, `apps/server/src/pending-card-recovery.ts:19`). Requests are different: the
   listener drops connections after a 500 ms grace (`apps/server/src/close-listener.ts:28,44`)
   and the store closes after that (`boot.ts:836-844`), so a till request still waiting on a card
   reader would lose its last write. The stepdown therefore counts requests in flight and waits for
   that count to reach zero, at most `HANDOVER_ADMITTED_WORK_LIMIT_MS = 180_000`, before it
   restarts; a request still running at the limit is logged by route and left to the existing
   crash-safety (a card payment is written `attempting` before its network call,
   `packages/payments/src/schema/payments.ts:23-26`, and its outcome stays unknown, design §2).
   The 180 seconds is a starting value, to be measured in the owner's rehearsal.
3. **Peers ask each other with a signed request, not a person's password.** The chart is kept off
   arbitrary readers today (`apps/server/src/management-api.ts:1040-1044`, which asks for a
   manager's password); a box asks a peer by signing a short query with its own node key, which
   the peer checks against the keys its own chart vouches for (Slice 3).
4. **The person drives an activation from a page M2 serves.** M2 names its new series from its
   own minute after another machine's clock agrees (CLAUDE.md §5), and the second clock it accepts
   is a browser's, read by challenge, never one on the same machine
   (`packages/fiscal-verifactu/src/hour-setup-clock.ts:106-127`). So in a controlled handover the
   person starts on M1's dashboard (where a fresh passkey or password sign-in works today,
   `confirmFreshSignIn`, `apps/server/src/fresh-sign-in.ts:45`), and the dashboard then opens M2's
   own handover page for the clock reading and the activation; in an emergency the person is on
   M2's page throughout.
5. **The minute-name wait.** Controlled: a switch's rule — the next free minute — because the
   final copy holds every name M1 ever used. Emergency: the setup and restore wait of 90 to 150
   seconds, because the last copy may lack a name M1 took after it (the same reason a restore
   waits, A947 §6.7). A1188 §12 left this to this build.
6. **The returned records reach M2 as a full-state batch for every chain M1 holds**: every
   filing-state row and every AEAT answer M1 holds (A947 §7.1's rule, "not only the rows the
   receiver lacks"), and the tax records after the head M2 reports for each chain. A retry with the
   same reported heads returns the same bytes (Slice 10).
7. **The emergency declaration page offers password plus authenticator code, not a passkey, until
   A947 4b/4d.** A passkey sign-in writes its one-time challenge to the venue database
   (`packages/identity/src/passkey.ts:232-235`), and a passkey registered for `waitron.local`
   needs the venue's or the box's own name (A947 §6.6), which A947 3b and 4d provide. The page says
   so in one line. Controlled handovers start on M1's dashboard, where passkeys work.

---

## Formats this plan settles

Every signed object is an **envelope**:

```ts
interface SignedHandoverEnvelope<B> {
  readonly purpose: `waitron.handover.${HandoverKind}.v1`;
  readonly signerNodeId: string;
  readonly body: B;
  readonly signature: string; // base64 Ed25519 over canonicalize({ purpose, signerNodeId, body })
}
type HandoverKind =
  | "query" | "status" | "stepdown" | "final-state" | "acceptance"
  | "relinquishment" | "declaration" | "return-batch" | "return-receipt" | "health";
```

`canonicalize` is `@waitron/membership`'s sorted-key JSON (`packages/membership/src/canonicalize.ts:15-24`);
the signature uses `signBytes`/`verifyBytes` (`packages/membership/src/crypto.ts:14-41`), as the
stream pointer does with its own purpose string (`packages/stream/src/pointer.ts:23,31-33`). The
purpose and signer are inside the signed bytes, so an acceptance can never be replayed as a
relinquishment, and a body signed by one box never verifies as another's. A digest is the
lower-case hex SHA-256 of the UTF-8 bytes of `canonicalize(envelope)`.

**The binding** — what one operation is about, fixed when it starts:

```ts
interface HandoverBinding {
  readonly operationId: string;                    // UUID v4
  readonly scenario: "controlled" | "emergency";
  readonly venue: { readonly country: string; readonly taxId: string;
                    readonly environment: "production" | "preproduction" };
  readonly sourceNodeId: string;                   // M1
  readonly destinationNodeId: string;              // M2
  readonly membership: { readonly term: number; readonly digest: string };
}
```

`venue` is the one `tenants` row (`packages/db/src/schema/tenants.ts:38-55`) and the deployment
stamp (`packages/db/src/schema/deployment.ts:10-24`); there is no location in it (owner,
2026-11-01). `membership.digest` is the digest of the held signed chart. The **binding
fingerprint** is the digest of `canonicalize(binding)`. The same operation id with the same
fingerprint returns the stored result; with a different fingerprint it is refused
`handover.operation_conflict` (design §7).

**The progress states**, one row per box per operation in `node.db`, each step recorded once:

| Role | Controlled | Emergency |
| --- | --- | --- |
| source (M1) | `prepared` → `source_stepped_down` → `filing_relinquished` | (learns at return) `source_superseded` → `return_pending` → `return_complete` |
| destination (M2) | `prepared` → `copy_accepted` → `filing_assumed` → `activated` | `prepared` → `emergency_declared` → `activated` → `return_pending` → `return_complete` |

A box waiting at a step records a `waiting_reason` (a code from the errors registry) beside its
state, never a new state.

**Stepdown record** (`node_handover_restriction`, M1's `node.db`): `node_id`, `operation_id`,
`kind` (`handed-over` | `superseded`), `successor_node_id`, `membership_term`, `recorded_at`. Written
before the stepdown is acknowledged; read at every start before any worker (Slice 2). `superseded`
is what a returning emergency M1 writes when it learns of M2's newer chart (Slice 3).

**Final-state indicator body** (`kind: "final-state"`, signed by M1):

```ts
interface FinalStateIndicator {
  readonly binding: HandoverBinding;
  readonly snapshot: {
    readonly sha256: string; readonly bytes: number;            // of the VACUUM INTO file
    readonly schema: readonly { set: string; version: number; journalSha256: string }[];
    readonly modules: readonly { name: string; version: string }[];
  };
  readonly nodeLocal: readonly NodeLocalItem[];                   // the manifest, below
  readonly modulesSummary: Readonly<Record<string, CanonicalValue>>; // per module seat (Slice 4)
  readonly capturedAtMs: number;                                  // M1's clock; informational
}
```

The Veri*Factu module's summary is, per chain it holds (`registro_sif` row): `sifId`, `nodeId`,
`idSistemaInformatico`, `numeroInstalacion`, record count, head record id and head huella (by
`secuencia`), `envios` counts per state, the SHA-256 of its `acks` rows in key order, and the ids
of rows in `enviando`. The payments module's summary is every payment in `attempting`
(`packages/payments/src/schema/payments.ts:28-40`) with its provider and the provider reference
that anchors its retry (`:62`). The snapshot is `StoreHandle.archiveTo`'s `VACUUM INTO` copy
(`packages/store/src/archive.ts:24-34`); a copy taken with every writer stopped is the "consistent
snapshot" of design §3, committed journal changes included.

**Acceptance** (`kind: "acceptance"`, signed by M2): `{ binding, indicatorDigest, acceptedAtMs }`.
M2 records `copy_accepted` in its `node.db` before answering.

**Relinquishment** (`kind: "relinquishment"`, signed by M1): `{ binding, indicatorDigest,
acceptanceDigest, filingAssignedTo: destinationNodeId, authorisedBy: personId }`. M1 records
`filing_relinquished` before answering. `authorisedBy` is the person whose fresh sign-in started
the operation on M1; M2 re-checks, in the accepted copy, that this person holds `node.promote`.

**Emergency declaration** (`kind: "declaration"`, signed by M2):

```ts
interface EmergencyDeclaration {
  readonly binding: HandoverBinding;                         // scenario "emergency"
  readonly wordingVersion: "a1018-emergency-v1";
  readonly locale: "en" | "es";
  readonly statements: { readonly sourceSwitchedOff: true; readonly noParallelRecovery: true;
                         readonly missingTailAccepted: true };
  readonly reason: string;                                   // 1–500 characters, required
  readonly lastCopy: { readonly source: "mirror-copy" | "selected-backup";
                       readonly identifier: string; readonly lastChangeAtMs: number | null };
  readonly provider: null;                                   // Cloud resource id: see "Waiting for the joint specification"
  readonly actor: { readonly personId: string; readonly method: "password" | "password+totp" };
  readonly declaredAtMs: number;
  readonly replaces: string | null;                          // a controlled operation id (design §7)
}
```

`reason` may name people, so it is stored and shown, never logged (CLAUDE.md §3, personal-data
log rule). `personId` is an id, not a name.

**Return batch** (`kind: "return-batch"`, signed by M1): `{ binding, sequence, requestDigest,
frozenAtMs, fiscal: <regime body> }`. `requestDigest` is the digest of M2's request, which carries
M2's head (`secuencia`) for each of M1's chains. The Veri*Factu body: for each chain M1 holds,
every `registros_facturacion` row after M2's reported head, in `secuencia` order, byte-for-byte as
stored; every `envios`, `acks`, `filing_cases` and `filing_case_events` row M1 holds for any record
of those chains; the ids of rows left `enviando`. M1 stores the bytes of each batch beside its
operation and answers a retry with the same request with the same bytes (design §6).

**Return receipt** (`kind: "return-receipt"`, signed by M2): per record, its id and huella as M2
holds it (in its own copy or the returned-records store); per filing row, M2's state; per chain,
count and head huella. M1 checks it against its own (Slice 13).

### The node-local manifest

What a box keeps in `node.db` and its state folder, and what M2 does with each (design §3 asks the
builder to enumerate it). `node.db` tables are from `packages/node-db/src/classification.ts:6-12`;
state files from `apps/server/src/state-secrets.ts:16-23` and
`apps/server/src/backup-optional-state.ts:10-16`.

| Item | Class | M2's treatment |
| --- | --- | --- |
| `node_mode`, `node_mirror_link`, `node_primary_key` | destination-owned | M2 keeps its own; M1's never travel |
| `node_recovery_key` | destination-owned | M2 keeps its own recovery-key check |
| `node_signing_key` | source-only | M1's private key never leaves M1 (design §2) |
| `node_handover_operations`, `_steps`, `_restriction` (Slice 1) | destination-owned | each box keeps its own |
| `secrets.env` (key ring) | transferred, earlier | reached M2 at joining (A947 3a Task 14a); the indicator lists the ring's key versions and M2 refuses `handover.key_ring_mismatch` when it lacks one (backlog A1273) |
| `trading.env` | destination-owned | M2 keeps its own node id; promotion rewrites it (`boot.ts:3067-3075`) |
| `tls/ca.*`, `tls/server.*`, `tls/venue-ca.*` | destination-owned | M2 keeps its own; the venue authority reached it at joining |
| `backup.env` | transferred, compared | the indicator carries its digest; a difference waits `handover.backup_settings_differ` |
| `modules.json` | transferred, compared | as `backup.env`; M2 refuses a module set that differs |
| `module-preparation-state.json` | rebuildable | each box's own (`packages/provisioning/src/module-preparation-state.ts:9-16`) |
| Litestream's `.venue.db-litestream/` | rebuildable | never copied; the new primary opens a new generation |

---

## Fiscal boundary, slice by slice

**Protected, untouched by every slice:** `computeHuella` (in `@waitron/verifactu`, outside this
repository), the chain and `Encadenamiento`, invoice-number allocation, `registros_facturacion`'s
schema and its append-only triggers, the alta builders `recordSale` / `recordCorrection` /
`recordSubstitution` (`packages/fiscal-verifactu/src/backend.ts:287,474,579`), `registerSif`
(`packages/fiscal-verifactu/src/registro-sif.ts:111-158`) and `restoreFiscal`
(`packages/fiscal-verifactu/src/restore.ts:3`). Every slice's final task runs
`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
and `git diff origin/main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`
(which must print nothing).

| Slice | Fiscal? | What touches fiscal behaviour |
| --- | --- | --- |
| 0 Docs | no | — |
| 1 Records and formats | no | — |
| 2 Restricted start | **FISCAL** | stops a filing box's drain and every other AEAT contact |
| 3 Boot check | **FISCAL** | decides, before the first filing pass, whether a box may file (A947 5a's place) |
| 4 Final copy | **FISCAL** | new read-only code in `packages/fiscal-verifactu` (chain summary seat) |
| 5 Controlled, server | **FISCAL** | activates a fresh fiscal identity on M2; M2 then files M1's copied records |
| 6 Controlled, screens | no, unless Task 6.2 must change `packages/fiscal-verifactu/src/setup/` (then FISCAL) | screens and guides; lands after 5 |
| 7 Emergency, server | **FISCAL** | as 5, under a declaration; the emergency minute wait (decision 5) |
| 8 Emergency, page | no | page and guides only; lands after 7 |
| 9 Prototype re-run | no | a rig that imports no `@waitron/*` package |
| 10 Return batch: evidence | **FISCAL** | writes `envios`, `acks` and filing cases on M2; a new outside input to the drain's per-chain block |
| 11 Return batch: originals | **FISCAL — LOUD** | a new store of returned tax records and a second filing path (Q1). It stores originals byte-for-byte and never recomputes a huella; it does not write `registros_facturacion` |
| 12 Reconciliation list | no | reads fiscal facts through a seat; writes only its own tables |
| 13 Archive and wipe | **FISCAL** | gates the wipe of a box that holds tax records |
| 14 Copy from a backup | **FISCAL** | places a copy that a fiscal activation then uses |

Every slice is on the **full review path** (risk triggers: fiscal, concurrency, cross-package
contract). A FISCAL slice is landed by the owner.

**The drain already files every chain it holds** — `claimBatch` has no node or SIF filter
(`packages/fiscal-verifactu/src/drain.ts:600-743`, the `pendiente` read at `:629`) — and each
record is sent with the identity stored on it when it was written
(`fromRegistroRow`, `packages/fiscal-verifactu/src/registro-row.ts:369`; built from the writing
box's SIF at `backend.ts:757-768`). So after activation M2 files M1's copied records in M1's
generating identity with no change to the drain (asesor Q2). That is read from the code, not run;
Task 5.6's simulation runs it against a stand-in AEAT, and Slice 5 changes no drain code.

---

## Global Constraints

- **Pre-live: no backwards-compatibility or data-migration code** (CLAUDE.md §3, last bullet).
  Development and demo boxes are reset (`wa-wt reset demo <name>`); a PR whose migration a box
  cannot take says so in its first line.
- **Nothing per location** (owner, 2026-11-01): no `location_id` column, no `locationId`
  parameter. Where existing code still reads `nodes.location_id` (`apps/server/src/promote.ts:250-255`),
  new code does not add a reader; A1301's slices remove it.
- **`node.db` rules** (CLAUDE.md §3): every new `node.db` table is `local`, keyed by `node_id`
  that every read and write names; no foreign key into or out of `node.db`; take `node.db`'s write
  lock outside `venue.db`'s; where one change spans both files, save `venue.db` first and `node.db`
  after, and say so in a one-line comment at the site; write `node.db` only through
  `withNodeTransaction` (`packages/db/src/tenancy.ts:48-53`). Each new `node.db` table's writer
  file is listed in `scripts/write-path-tables.json`.
- **Migration numbers are indicative**; `drizzle-kit generate` assigns them. A collision on rebase
  is fixed by regeneration (CLAUDE.md §3).
- **New error codes** are declared in their package's `errors.ts` and imported by the throwing
  file (`scripts/errors-reachable.test.ts`), use the `handover.` prefix, and have English and
  Spanish text in `apps/dashboard/src/i18n/codes.ts` and, where a page shows them, the page's own
  strings. A recorded incident code also gets an area claim and alert wording
  (`scripts/alert-codes.test.ts`).
- **Refusals** name what happened and what each choice does, offer an administrator sign-in in
  place where one would let the person carry on, and a safe Stop for destructive choices; never
  send the person to someone else (CLAUDE.md §3; `docs/developers/conventions-ui.md` → "Refusals
  name a self-service next step").
- **Forms** follow `docs/developers/design-system.md` → Forms (`:2589`): required fields marked,
  inline errors, one bottom message, the action disabled only by the form's own checks.
- **Every screen change updates its guide in English and Spanish** under
  `apps/server/src/guide/<language>/`, with shared `{#id}` headings; a new page is added to
  `GUIDE_PAGES` (`apps/server/src/guide-catalogue.ts:6-21`).
- **A sign-in refusal never reveals whether an account exists**: `password.invalid` for every
  credential failure (CLAUDE.md §3).
- **A cold restore is untouched**, with its own source, key, operation and sole-recovery checks,
  and no new demand for proof that the old box stopped. A failed controlled handover never turns
  into an emergency or a restore by itself: only a person's new declaration does, under Task 7.3's
  rule (design §§7, 10).
- **The handover never charges, refunds or settles a payment again.** Payments in `attempting`
  keep their provider reference and go through the existing recovery
  (design §4; A764, `docs/backlog/payments.md:472-480`).
- **Plain English** in comments, commit messages and PR text. Every commit `git commit -s`. A
  Vitest run counts only when its `Tests` line is read; run under `env -u AI_AGENT -u CLAUDECODE`
  to see a passing test's output.
- **Coverage 98/98/98/95** for the new package from its first commit; mutation floor 90
  (`scripts/mutation-break-thresholds.test.mjs`).

---

## Review Focus

1. **A stepped-down box that loses power mid-capture** comes back restricted, sells nothing and
   contacts AEAT in no way — including the clock reading from AEAT's host
   (`apps/server/src/clock-watch.ts:281-284`) and the certificate checks
   (`apps/server/src/fiscal-certificate-api.ts:90,150`). Test: Task 2.4.
2. **A lost reply at each checkpoint** (acceptance, relinquishment, activation) followed by a
   retry or a reboot of either box leaves exactly one filing box and never a second activation.
   Tests: Tasks 5.5 and 7.5.
3. **A copy that differs by one late row** is refused before acceptance, and M1 stays stepped down.
   Test: Task 5.3, with the control.
4. **A returned record that M2 already holds, with different bytes**, opens a case and keeps both
   facts rather than letting the last arrival win. Tests: Tasks 10.4 and 11.3.
5. **A returning M1 whose `node.db` was lost** (backlog A1274: it reads as a sole primary) still
   waits at start, because its chart lists another routable box. Test: Task 3.3.

---

## What exists today (traced on `61bfdfe405`; read, not run, unless a line says so)

| Piece | Where | What it does today |
| --- | --- | --- |
| Promotion | `apps/server/src/promote.ts:227-311` | operator attestation (`:64-68`), module activation in one venue transaction (`:268-287`), chart term n+1 with the old primary `sell-only` (`:258-266`; `packages/membership/src/standings.ts:9-22`), role written to `node.db` after (`:300-303`) |
| Promotion preparation | `packages/fiscal-verifactu/src/hour-recovery-preparation.ts:108-118` | refuses unless the old machine is confirmed offline and not absent, and no parallel recovery runs |
| Restart after promotion | `apps/server/src/boot.ts:3079-3092` | SIGTERM to itself; Docker restarts it |
| Fresh sign-in on the dashboard | `apps/server/src/fresh-sign-in.ts:45-90` | password or the person's own passkey, plus authenticator or recovery code when enrolled |
| One-action sign-in by id | `apps/server/src/operation-authentication.ts:91-131` | password and optional code, `node.promote` or `mirror.create`, session ended in the same step |
| `node.promote` | `packages/identity/src/permissions.ts:38,78-85` | administrators only |
| Boot peer check | `apps/server/src/boot.ts:1600-1622`, `membership-reconcile.ts:28-53` | runs only on a non-mirror with a `node_mirror_link` row; an unreachable peer means "proceed" (`:33-34`); the fetch sends no credential (`:60-63`), so `GET /management-api/membership` answers `password.invalid` (`management-api.ts:1044-1083`) — inferred, not run |
| Fence at boot | `boot.ts:1627-1637` | a held chart that fences this box demotes its singleton role and mounts the read-only gate (`:1699-1718`) |
| Duties by role | `boot.ts:1690-1691` (`filesRecords`), `:3200-3210` (drain via `singletonPass`), `:505-512` (card sweep, **every role**), `:3305` (tender refunds), `:2541-2556` (stream), `:2481` (backups), `:2651` (clock watch) | see Slice 2's list |
| Shutdown | `boot.ts:3400-3437` | aborts the drain's and card loop's controllers, then awaits each loop |
| Consistent copy | `packages/store/src/archive.ts:24-34` | `VACUUM INTO` a `.partial` file, then rename |
| Restore placement | `apps/server/src/restore.ts:579-703` | moves the old files aside, puts `node.db` before `venue.db`; `skipSecrets` keeps the box's own identity and `node.db` (`:403-404,417-419`) |
| Drain | `packages/fiscal-verifactu/src/drain.ts` | files every chain (`:600-743`); per-pass, memory-only chain block (`:252-255`, "open design decision" `:577-579`); restart resets every `enviando` row (`:513-521`); duplicate handling compares the record's own stored identity (`:1727-1803`, `:1830-1903`) |
| Filing cases | `packages/fiscal-verifactu/src/filing-cases.ts:51-70` | one case per record (`filing_cases_registro_uq`) |
| Chain head | `packages/fiscal-verifactu/src/schema/cadenas.ts` | one row per node |
| Activation | `packages/fiscal-verifactu/src/allocation.ts:437-458` | revokes, resets and retires only the activating node's SIF, chain and series |
| Two servers in one test | `apps/server/src/till-reroute-e2e.test.ts:315-392` | primary and seeded mirror up together; mirror promoted and restarted |
| Reports | `packages/reporting/src/daily-close.ts:15-35`, `cash-up.ts:18-40` | daily close and cash-up |
| Servers screen | `apps/dashboard/src/screens/servers-screen.ts:23-36` | Remove and Clear only |
| Prototype S2 | `bench/sqlite-failover/src/scenarios/s2_no_double_submit.ts` | recorded FAIL (`docs/research/2026-09-16-sqlite-failover-prototype.md:37`) |

---

## File structure

- **Create `packages/handover/`** (`@waitron/handover`): `package.json` (scripts `test`,
  `test:coverage`, `typecheck`, `lint`, `mutation`, `db:generate`), `tsconfig.json`,
  `vitest.config.ts` (98/98/98/95, `coverage.include: ["src/**"]`), `stryker.config.json`
  (`break: 90`), `drizzle.config.ts` (`migrations.table: "__drizzle_migrations_handover"`),
  `src/envelope.ts`, `src/binding.ts`, `src/states.ts`, `src/indicator.ts`, `src/manifest.ts`,
  `src/declaration.ts`, `src/return-batch.ts`, `src/errors.ts`, `src/index.ts`; from Slice 7,
  `src/schema/*.ts`, `src/classification.ts`, `src/migrations.ts`, `drizzle/`. Wiring as A947 3a's
  Task 4 did for `@waitron/node-db`: `scripts/changed-scope.mjs` (`LIGHT_B_PACKAGES`),
  `.github/workflows/ci.yml` (the light-A filter), `.github/workflows/mutation.yml` (a
  `mutation-handover` job), the root guards' package lists, `pnpm-lock.yaml`.
- **`packages/node-db`**: `src/schema/node-handover.ts`, `src/handover.ts`, a second migration.
- **`packages/module`**: the `handover` seat on `WaitronModule` (`src/module.ts:1686` area).
- **`packages/fiscal`**: the `handover` seat on `FiscalContribution` (`src/contribution.ts:166`).
- **`packages/fiscal-verifactu`**: `src/handover-summary.ts` (Slice 4), `src/handover-return.ts`
  (Slice 10), `src/returned-records.ts`, `src/schema/returned-records.ts`, `src/relay-drain.ts`
  (Slice 11).
- **`packages/payments`**: `src/handover-summary.ts` (Slice 4).
- **`packages/reporting`**: the gap lines (Slice 12).
- **`apps/server/src`**: `handover-*.ts` files named per task.
- **`apps/dashboard`**, **`apps/till`**: named per task.
- **Guides**: new `apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md`
  (which also answers backlog A1283).

---
## Slices

Each slice is one pull request, landing `main` green and working on its own, in this order. "Waits
for" names anything outside this plan. Every slice ends with the same final checks (its last task):
the focused suites named in its tasks, `pnpm format:check`, the typecheck of every package it
touched, the fiscal golden and immutability suites unedited (Fiscal boundary), then
`/finish-branch` on the full path.

| # | Slice | Fiscal | Migration | Tasks | Waits for |
| --- | --- | --- | --- | --- | --- |
| 0 | Docs: the A947 amendment, the Cloud pin, the backlog | no | no | 3 | — |
| 1 | The handover records and their formats | no | yes (`node.db`) | 5 | 0 |
| 2 | A box that has stepped down stays down | **yes** | no | 6 | 1 |
| 3 | A returning box asks before it sells or files | **yes** | no | 7 | 2 |
| 4 | The final copy and its indicator | **yes** | no | 6 | 2 |
| 5 | Controlled handover, server | **yes** | no | 7 | 3, 4 (real boxes: A947 3b) |
| 6 | Controlled handover, screens and guide | no | no | 4 | 5 |
| 7 | Emergency handover, server | **yes** | yes (`venue.db`, `handover` set) | 6 | 5 (real boxes: A947 3b; continuous copy: 3c) |
| 8 | Emergency declaration page and guide | no | no | 4 | 7 |
| 9 | The S2 prototype re-run, fiscal-only | no | no | 3 | 0 |
| 10 | Return batch: evidence for records M2 holds | **yes** | no | 6 | 7, 9 |
| 11 | Return batch: originals M2 never saw | **yes, loud** | yes (fiscal set) | 6 | 10, Q1 |
| 12 | The reconciliation list and the report gaps | no | no | 5 | 11 |
| 13 | Archive, the wipe gates, and becoming the spare | **yes** | no | 5 | 12 |
| 14 | A last copy from a selected backup | **yes** | no | 4 | 7 |

---

### Slice 0 — Docs: the A947 amendment, the Cloud pin, the backlog

Docs-only, so it takes CLAUDE.md §6's docs path: branch, `git commit -s`, fast-forward `main`,
push direct. It must land before Slice 1, so that no build slice contradicts an approved design
that still says otherwise.

#### Task 0.1: A dated A1018 amendment to the A947 design

**Files:** Modify `docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`: a new
block at the top, "A1018, <date>: what the simple handover changes here", and a one-line pointer
under each heading it amends (§6.3, §6.4, §7, §7.1, §7.2, §11). History is not rewritten.

- [ ] **Step 1: Write the block.** It says, each in one or two sentences, with a link to this plan
  and to the [A1018 design](../specs/2026-10-23-a1018-simple-handover-design.md):
  - **§6.3 (what the spare does):** step 1 keeps "stop following, apply, verify, then check the
    person"; step 2's promotion now runs only after the A1018 emergency declaration is recorded in
    the spare's `node.db` (A1018 Slice 7), and the declaration's audit fields are this plan's
    "Emergency declaration"; step 3's "starts filing … the old main box's records that reached it"
    is unchanged and now explicitly sole: the old box never files again.
  - **§6.4 (the hand-over):** replaced by A1018's controlled handover — a durable stepdown that
    survives a reboot, a final copy compared against a signed indicator, M2's durable acceptance,
    M1's relinquishment, then activation (A1018 Slices 2, 4, 5). "Waits until its copy holds
    exactly that change" is replaced by the indicator's snapshot digest; a lost answer never lets
    M1 resume.
  - **§7 item 1:** the boot check asks every other box the chart lists, by a signed query, and a
    till hands over a newer chart (A1018 Slice 3); «Seguir sin el equipo de reserva» must name the
    other box, confirm it is switched off and no other recovery runs, and is refused when this
    box's `node.db` holds a handover (A1018 design §4, point 1).
  - **§7.1 (the tail):** fiscal-only. The batch carries tax records, their chain and filing rows,
    every AEAT answer and every unanswered send — never sales, orders, payments, cash, stock or
    printing rows, which stay in the returning box's archive; the "ledger tables only" tail of the
    topology design no longer applies to A947. Kept: full-state batch, frozen sender, identical
    retries, the per-chain pause while a batch applies, a filing case where two finished states
    disagree, the receiver files and the sender files nothing. The S2 re-run (5b) is amended to
    the fiscal-only batch, with a third control: a batch cut back to missing records only
    (A1018 Slice 9). Records M2 never saw are kept in a separate store and filed from there
    (A1018 Q1, default (a); Slice 11).
  - **§7.2 (becoming the spare):** check 1 is A1018's return receipt; check 3's archive keeps every
    non-fiscal row; the archive is **not** deleted after 90 days while any reconciliation item or
    filing case naming one of its records is open, and retention otherwise follows A664's policy
    (A1018 design §5). The manager override still reaches check 2 only.
  - **§11:** 4e → A1018 Slices 2, 4, 5 and 6; 5a → A1018 Slice 3; 5b → A1018 Slice 9; 5c →
    A1018 Slices 10 and 11; 5d → A1018 Slice 13. 4b keeps "stop following" and the in-memory
    passkey challenge, and calls A1018 Slice 7's declaration and activation. 3b, 3c, 4c, 4d and 5e
    are unchanged.
- [ ] **Step 2: Check** `pnpm exec prettier --file-info docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md`
  prints `"ignored": true` (docs are not format-checked), and open each relative link path in
  the block with `ls` (no guard reads links in specs).
- [ ] **Step 3: Commit** `git commit -s -m "docs(a947): A1018's simple handover amends the hand-over, the boot check, the tail and the return"`.

#### Task 0.2: Pin the Cloud agreement and record the formats

**Files:** Modify `docs/superpowers/specs/2026-10-23-a1018-simple-handover-design.md` (a dated
block at the top) and `docs/backlog/replication-cloud.md` → "A1018".

- [ ] **Step 1: Write the pin.** The block quotes the receipt: the signed contract at Cloud
  `08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec` hashes to
  `157556c31753ccf64cc9f8f0a7144f20683325231d212cd344e259b644366d02` (re-run
  `gh api 'repos/waitron-io/waitron-cloud/contents/docs/waitron-integration-contract.md?ref=08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec' --jq .content | base64 -d | shasum -a 256`
  and paste the output); the A1018 section's lines on Cloud `main` are unchanged (run the same
  fetch without `ref`, cut both at `## Handover between local and hosted machines: A1018` up to
  the next `## ` heading, and `diff` them; on 2026-11-02 at Cloud `1aae8f14c0` the first 194
  lines matched and `main` added only a `### A951 routing revision 2 response, 2026-10-23 (D136)`
  subsection after them, about A951). Then: "Formats settled in the
  [build plan](../plans/2026-11-02-a1018-handover-build.md#formats-this-plan-settles); the
  authentication bridge, the provider-resource field and a hosted copy's identity wait for joint
  specification with Cloud."
- [ ] **Step 2: Commit** `git commit -s -m "docs(a1018): pin the Cloud agreement and point at the settled formats"`.

#### Task 0.3: The backlog

**Files:** Modify `docs/backlog.md` (the A1018 entry) and `docs/backlog/replication-cloud.md`
(A1018 and A947 sections).

- [ ] **Step 1:** Replace "Exact formats, compatible A947 amendments, separate build authority and
  physical runtime qualification remain open" with: formats and the A947 amendment settled (links),
  build authority given 2026-11-01, Q1 open with its default, physical qualification the owner's
  (this plan's last section). Add one line to the A947 section pointing at the amendment.
- [ ] **Step 2: Commit** `git commit -s -m "docs(backlog): A1018's formats and A947 amendment are settled; the build is planned"`.

---

### Slice 1 — The handover records and their formats

Not fiscal. Adds `@waitron/handover` and `node.db`'s second migration. Nothing calls it yet.

#### Task 1.1: The `@waitron/handover` package and its signed envelope

**Files:** Create the package (File structure), wired as A947 3a's Task 4 wired
`@waitron/node-db` (its "Repository wiring" list). `src/envelope.ts`, `src/errors.ts`,
`src/index.ts`. Test `packages/handover/src/envelope.test.ts`.

**Interfaces — Produces:**
`signEnvelope<B extends CanonicalValue>(kind: HandoverKind, body: B, signer: { nodeId: string; privateKey: string }): SignedHandoverEnvelope<B>`;
`verifyEnvelope<B>(raw: unknown, kind: HandoverKind, publicKeyOf: (nodeId: string) => string | undefined): { valid: true; body: B; signerNodeId: string } | { valid: false; reason: "malformed" | "wrong_purpose" | "unknown_signer" | "bad_signature" }`;
`envelopeDigest(envelope: SignedHandoverEnvelope<unknown>): string`; `sha256Hex(data: string | Uint8Array): string`.

- [ ] **Step 1: Write the failing tests.** "a signed envelope verifies with the signer's key";
  "an acceptance never verifies as a relinquishment" (`wrong_purpose`); "a body changed after
  signing is refused" (`bad_signature`); "the signer id is signed: the same body re-labelled with
  another node id is refused"; "an unknown signer is refused" (`unknown_signer`); "a non-object, a
  missing field or an extra top-level field is `malformed`"; "the digest is stable under key
  order" (two objects built in different key orders give one digest).
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/envelope.test.ts` — FAIL.
- [ ] **Step 3: Implement** on `canonicalize`, `signBytes`, `verifyBytes` from `@waitron/membership`.
- [ ] **Step 4: Run** it — PASS; then from the root `pnpm exec vitest run scripts/workspace-cycles.test.ts scripts/coverage-thresholds.test.ts scripts/mutation-break-thresholds.test.mjs scripts/ci-workflow.test.mjs scripts/english-only.test.ts`
  and `pnpm --filter @waitron/handover mutation` (score 90 or more).
- [ ] **Step 5: Commit** `git commit -s -m "handover: a signed envelope whose purpose and signer are inside the signed bytes"`.

#### Task 1.2: The binding and its fingerprint

**Files:** Create `packages/handover/src/binding.ts`. Test `src/binding.test.ts`.

**Interfaces — Produces:** `HandoverBinding` (Formats); `parseBinding(raw: unknown): HandoverBinding`
(throws `handover.request_invalid` with `{ field }`); `bindingFingerprint(b: HandoverBinding): string`.

- [ ] **Step 1: Write the failing tests.** "a binding round-trips through parse"; "refuses an
  operation id that is not a UUID", "a source equal to the destination", "a term below 1", "a
  scenario outside the two", "an extra field" (each `handover.request_invalid` naming the
  field); "two bindings differing only in the membership digest have different fingerprints".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/binding.test.ts` — FAIL.
- [ ] **Step 3: Implement.** No location field exists to add.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the binding that fixes what one operation is about"`.

#### Task 1.3: The order of steps

**Files:** Create `packages/handover/src/states.ts`. Test `src/states.test.ts`.

**Interfaces — Produces:** `HandoverRole = "source" | "destination"`; `HandoverState` (the union of
every state in the Formats table); `nextState(role, scenario, from: HandoverState | null, to: HandoverState): HandoverState`
(throws `handover.step_out_of_order` with `{ from, to }`); `isOpen(state): boolean` (false only for
`return_complete`, and for a controlled destination's `activated`).

- [ ] **Step 1: Write the failing tests.** One `it.each` over every allowed transition in the
  Formats table (passes); one over a set of forbidden ones, including "a controlled destination
  cannot reach `filing_assumed` before `copy_accepted`", "a source cannot relinquish before it
  stepped down", "an emergency destination cannot activate before `emergency_declared`", "no state
  goes back".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/states.test.ts` — FAIL.
- [ ] **Step 3: Implement** as a table.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the order of steps for each box and scenario"`.

#### Task 1.4: `node.db`'s handover tables

**Files:** Create `packages/node-db/src/schema/node-handover.ts`, `packages/node-db/src/handover.ts`;
modify `packages/node-db/src/schema/index.ts`, `src/classification.ts`, `src/index.ts`,
`scripts/write-path-tables.json` (the three tables → `packages/node-db/src/handover.ts`),
`scripts/schema-constraints.test.ts` (the new check names). Run `pnpm exec drizzle-kit generate`
in `packages/node-db` once. Test `packages/node-db/src/handover.test.ts`.

Tables, using only `packages/db/src/schema/columns.ts` builders:
- `node_handover_operations`: `node_id`, `operation_id` (primary key together), `role`,
  `scenario`, `source_node_id`, `destination_node_id`, `binding` (json), `fingerprint`, `state`,
  `waiting_reason` (nullable), `created_at`, `updated_at`; checks on the three enumerations; a
  unique partial index `node_handover_one_open_uq` on `node_id` where `state not in ('return_complete')`
  and not (`role = 'destination'` and `scenario = 'controlled'` and `state = 'activated'`).
- `node_handover_events`: `node_id`, `operation_id` (nullable: a "carry on" decision has none),
  `kind`, `detail` (json), `envelope` (nullable text), `recorded_at`; primary key a new id.
  Insert-only by code: the writer file has no update or delete (no trigger reaches `node.db`,
  A947 3a's Task 2 kept append-only triggers venue-only).
- `node_handover_restriction`: `node_id` (primary key), `operation_id` (nullable for a chart-only
  supersession), `kind` (`handed-over` | `superseded`), `successor_node_id`, `membership_term`,
  `recorded_at`.
- Classification: all three `local`, reason "this box's own handover record, in node.db, keyed by
  this box's node id". No foreign key anywhere; `source_node_id`, `destination_node_id` and
  `successor_node_id` name venue rows, and the column comment says nothing establishes them in this
  file.

**Interfaces — Produces:** `beginHandoverOperationTx(tx: NodeTransaction, row): Promise<"created" | "replayed">`
(refuses `handover.operation_conflict` on the same id with another fingerprint, and
`handover.operation_in_progress` with `{ operationId }` when another open operation exists);
`advanceHandoverOperationTx(tx, nodeId, operationId, to: string, waitingReason: string | null): Promise<void>`;
`readHandoverOperation(node, nodeId, operationId)`, `readOpenHandoverOperation(node, nodeId)`;
`appendHandoverEventTx(tx, row): Promise<void>`; `recordHandoverRestrictionTx(tx, row): Promise<void>`
(a second write with the same values is a no-op; different values refuse
`handover.restriction_conflict`); `readHandoverRestriction(node, nodeId)`. The state order is
checked by the caller with `nextState` (Task 1.3), not here: this package does not depend on
`@waitron/handover`.

- [ ] **Step 1: Write the failing tests** with `useVenueDb` and the node set: "creates the three
  tables in node.db and none in venue.db"; "a second operation while one is open is refused";
  "the same operation id with another fingerprint is refused"; "a replay with the same fingerprint
  answers `replayed` and writes nothing"; "a restriction rewritten with other values is refused";
  "an event is never updated" (the module exports no update).
- [ ] **Step 2: Run** `pnpm --filter @waitron/node-db exec vitest run src/handover.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Run** it — PASS. From the root: `pnpm exec vitest run scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts scripts/write-path-tables.test.ts scripts/id-columns-are-references.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`;
  `pnpm --filter @waitron/node-db mutation`.
- [ ] **Step 5: Commit** `git commit -s -m "node-db: each box records its handover progress, decisions and restriction in its own node.db"`.

#### Task 1.5: The server's handover store and signer

**Files:** Create `apps/server/src/handover-store.ts`, `apps/server/src/handover-signing.ts`.
Tests `apps/server/src/handover-store.test.ts`, `handover-signing.test.ts`.

**Interfaces — Produces:**
`beginHandover(deps: { node: NodeDatabase; nodeId: string }, binding: HandoverBinding, role: HandoverRole): Promise<"created" | "replayed">`;
`advanceHandover(deps, operationId, to: HandoverState, detail: CanonicalValue, envelope?: SignedHandoverEnvelope<unknown>): Promise<void>`
(reads the row, checks `nextState`, records the event and the new state in one node transaction;
the same `to` twice is a no-op that returns); `waitHandover(deps, operationId, reason: ErrorCode)`;
`signAsThisBox(deps: { node: NodeDatabase; ring: KeyRing; nodeId: string }, kind, body)` (uses
`readNodeIdentityKey`, `apps/server/src/node-identity.ts:25-43`);
`peerKeyOf(deps: { db: Database; node: NodeDatabase; nodeId: string }): Promise<(nodeId: string) => string | undefined>`
— a key this box trusts (`readStoredTrustSet`, `apps/server/src/membership-trust.ts:35-43`) or one
the held chart's verified endorsements vouch for (`packages/membership/src/endorsement.ts`);
`currentBinding(deps, scenario, sourceNodeId, destinationNodeId, operationId): Promise<HandoverBinding>`
(reads `tenants`, the stamp and the held chart).

- [ ] **Step 1: Write the failing tests.** "an operation advanced out of order is refused and
  records nothing"; "advancing to the same state twice records one event"; "a box signs with its
  own node key and a peer verifies it with the key the chart's endorsement carries"; "a key the
  chart does not vouch for is unknown"; "the binding names the taxpayer and environment, and the
  held chart's term and digest" (and has no location field).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-store.test.ts src/handover-signing.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment at `advanceHandover`: node.db only, never venue.db.
- [ ] **Step 4: Run** them — PASS; then the final checks for the slice.
- [ ] **Step 5: Commit** `git commit -s -m "server: record handover steps in node.db and sign them with the box's own key"`.

---

### Slice 2 — A box that has stepped down stays down

**FISCAL** (it stops a filing box). The owner lands it. No migration.

#### Task 2.1: The restricted start

**Files:** Modify `apps/server/src/boot.ts` (read `readHandoverRestriction` right after
`finishPromotedRole`, `:1590`, and before any worker; when a row exists, return a restricted
server the way the pending-adoption mode returns early, `:1540-1579`); create
`apps/server/src/restricted-start.ts` (its routes). Test `apps/server/src/boot.restricted.test.ts`.

**Interfaces — Produces:** `startRestricted(deps: RestrictedStartDeps): StartedServer`, serving
only `/health`, `GET /api/node` (always `acceptingSales: false`), the status page (Task 2.5), and
the routes later slices register through `RestrictedStartDeps.routes: ((app: Hono) => void)[]`.

- [ ] **Step 1: Write the failing tests** (a real `startServer` on a seeded folder with a
  `node_handover_restriction` row): "answers `acceptingSales: false`"; "refuses a till sign-in"
  (status 403 or 404, never 200); "mounts no dashboard, till, print or device route" (each
  representative path answers 404); "starts no fiscal pass": a stand-in AEAT server records zero
  requests over two `minTickMs` intervals; control: the same folder without the row starts the
  drain, and the stand-in records a request (the failing case prints a non-zero count).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.restricted.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The early return comes before `runFirstStart`, the stream host, the
  backup supervisor and every loop.
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/boot.promote.test.ts src/boot.reconcile.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box with a handover restriction starts with nothing that sells, files or writes"`.

#### Task 2.2: The restricted start touches nothing outside and nothing in venue.db

**Files:** Modify `apps/server/src/boot.ts` and `restricted-start.ts` as the test needs. Test
`apps/server/src/boot.restricted-quiet.test.ts`.

- [ ] **Step 1: Write the failing tests.** Start restricted for 5 seconds of fake time with every
  seam the full start uses: "writes nothing to venue.db" (the file's SHA-256 before and after are
  equal; control: a normal start changes it within the same time, through the sealed-state refresh
  `boot.ts:2532`); "asks AEAT's host for no clock reading" (the clock watch's `readAuthorityTime`
  stand-in is never called; `apps/server/src/clock-watch.ts:281-284`); "runs no card-provider
  sweep" (the sweep stand-in is never called; today it runs in every role, `boot.ts:505-512`);
  "starts no Litestream child" (the stream seam's `spawn` is never called).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.restricted-quiet.test.ts` — FAIL only if Task 2.1 left a worker running; if it PASSES at once, delete the early return locally and confirm each case fails for the reason named, then restore it.
- [ ] **Step 3: Implement** whatever the failing case names.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: prove a restricted box writes nothing and contacts no outside service"`.

#### Task 2.3: The stepdown, in order

**Files:** Create `apps/server/src/handover-stepdown.ts`; modify `boot.ts` (an in-flight request
counter middleware on the trading app, and `stepDown` wired with the trading admission and the
restart used after promotion, `:3079-3092`). Test `apps/server/src/handover-stepdown.test.ts`.

**Interfaces — Consumes:** `beginHandover`, `advanceHandover` (Task 1.5),
`recordHandoverRestrictionTx` (Task 1.4). **Produces:**
`stepDown(deps: StepDownDeps, binding: HandoverBinding): Promise<{ restarting: true }>`:
1. in ONE node transaction: the operation row at `source_stepped_down` and the restriction
   (`kind: "handed-over"`, successor = destination) — before anything is acknowledged;
2. `tradingAdmission.requireRestart()` (`apps/server/src/trading-admission.ts:19-21`), so economic
   writes refuse at once;
3. wait until the in-flight request count is zero, at most `HANDOVER_ADMITTED_WORK_LIMIT_MS`
   (decision 2), logging `handover.admitted_work_cut` with each remaining route;
4. the existing graceful close, then SIGTERM, as promotion does.
`HANDOVER_ADMITTED_WORK_LIMIT_MS = 180_000`.

- [ ] **Step 1: Write the failing tests.** "the restriction is on disk before the call returns or
  restarts" (read it from a second store handle inside the restart seam); "a sale request admitted
  before the stepdown finishes and commits" (a stand-in handler that waits 2 s); "a sale request
  arriving after step 2 is refused" with the trading admission's code; "a request still running
  at the limit is cut and logged by route, and the stepdown proceeds" (fake timers); "a second
  call for the same binding answers `replayed` and does not restart twice".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-stepdown.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment at step 1: the restriction is written before the
  answer, so a lost answer leaves the box stepped down (design §2).
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepdown records itself first, lets admitted work finish, then restarts restricted"`.

#### Task 2.4: Power lost at any point of a stepdown

**Files:** Test `apps/server/src/handover-stepdown.crash.test.ts` (Review Focus 1).

- [ ] **Step 1: Write the tests.** For each crash point — after the node transaction, during the
  admitted-work wait, during close — stop the process's store without the graceful close, then
  `startServer` on the same folder: "comes back restricted, `acceptingSales: false`, no AEAT
  request" (stand-in counts zero); "the operation reads `source_stepped_down`". Control: a crash
  before the node transaction comes back as a normal primary (the failing case prints
  `acceptingSales: true` for the first three).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-stepdown.crash.test.ts` — PASS (it pins Tasks 2.1–2.3); if a case passes for the wrong reason, the control shows it.
- [ ] **Step 3: Commit** `git commit -s -m "server: a stepdown interrupted at any point comes back restricted"`.

#### Task 2.5: The restricted box's own page, and its guide

**Files:** Create `apps/server/src/restricted-page.ts` (server-rendered, English and Spanish, in
the recovery page's style, `apps/server/src/recovery-surface.ts:123-133`); create
`apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md` with section
`{#handed-over}`; add `"servers"` to `GUIDE_PAGES` (`apps/server/src/guide-catalogue.ts:6-21`).
Test `apps/server/src/restricted-page.test.ts`.

Words (English; Spanish in the same file): title "This box has handed over", body "It takes no
sales and sends nothing to the tax agency. The venue now runs on {successor}." plus the operation's
progress, one line per recorded step, and a line "If this box comes back after an emergency, it
sends its invoices to {successor} by itself." No action button: nothing here needs a person
(a state this box is meant to be in; CLAUDE.md §3).

- [ ] **Step 1: Write the failing tests.** "shows the successor and each recorded step, in English
  and in Spanish"; "escapes the successor's name"; "carries no form". Then
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the root,
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/restricted-page.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Write the rendered page to a file and open it in the workspace's
  Playwright Chromium in both themes and at 390 px (CLAUDE.md §4: a page asserted as a string has
  nothing checking that it renders).
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepped-down box says what it is and where the venue went, in English and Spanish"`.

#### Task 2.6: Final checks for Slice 2

- [ ] Run the slice's focused suites, `pnpm format:check`, `pnpm --filter @waitron/server typecheck`,
  `pnpm --filter @waitron/node-db typecheck`, the fiscal golden and immutability suites with the
  unedited-diff check (Fiscal boundary), and from the root `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/personal-log-params.test.ts`.
  Then `/finish-branch` (full). The PR says FISCAL in its first line.

---

### Slice 3 — A returning box asks before it sells or files

**FISCAL** (A947 5a's place: it decides, before the first filing pass, whether this box may
file). The owner lands it. It changes A947's Ruling C7 for any box whose chart lists another
routable box: an unreachable peer means wait, not proceed (design §4, point 1).

#### Task 3.1: The signed peer query

**Files:** Create `apps/server/src/peer-status-api.ts`; mount it in the full start, the restricted
start, the pending-adoption start (`boot.ts:1540-1579`) and the waiting start (Task 3.4). Test
`apps/server/src/peer-status-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/peer-status`, body a `query` envelope
`{ nonce: string (16–64 chars), atMs: number }` signed by the asking box; answer a `status` envelope
signed by this box: `{ heldMembership: SignedMembershipDocument | null, restriction: { kind, successorNodeId, operationId } | null, openOperation: { operationId, role, scenario, state } | null, nonce }`.
Refusals: `handover.peer_unknown` (403) when the signer is not a key `peerKeyOf` knows or is
`evicted` in the held chart; `handover.request_invalid` (400).

- [ ] **Step 1: Write the failing tests.** "a box the chart lists gets a signed status echoing its
  nonce"; "a stranger's key is refused 403 `handover.peer_unknown`"; "an evicted box is refused";
  "the answer verifies with this box's key and fails with any other"; "the restricted and the
  pending-adoption starts answer it too".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/peer-status-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.** The chart is not served to unsigned callers (decision 3).
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: boxes ask each other for the current chart with a signed query"`.

#### Task 3.2: A newer chart handed to a box

**Files:** Create `apps/server/src/node-membership-api.ts` (`POST /api/node/membership`, body
`{ document }`); mounted in all four starts. Test `apps/server/src/node-membership-api.test.ts`.

**Interfaces — Produces:** the route verifies with `acceptMembershipDocument` against the stored
trust set and the held chart (as boot does, `boot.ts:1616-1619`), persists it when strictly newer
(`persistNodeMembershipIfNewer`), and — when it fences this box (`isFencedStanding`,
`packages/membership/src/fence.ts:20-24`) and this box is not already restricted — writes
`node_handover_restriction` `{ kind: "superseded", successorNodeId: servingPrimaryNodeId(doc) }`
and restarts. Answers `{ accepted: boolean }`; a refused chart is 200 `{ accepted: false }` (the
caller learns nothing it did not send).

- [ ] **Step 1: Write the failing tests.** "a newer chart that fences this box restricts it and
  restarts" (restart seam called once; restriction row present); "a newer chart that does not
  fence it is held, and the box keeps selling"; "an older or equal chart changes nothing"; "a chart
  signed by an unknown key changes nothing"; "a restricted box stays restricted when handed an
  older chart".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/node-membership-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box handed a newer chart that fences it stops before it sells again"`.

#### Task 3.3: The check at start

**Files:** Create `apps/server/src/boot-peer-check.ts`; modify `boot.ts` (call it after
`finishPromotedRole` and the restriction read, before the held-membership read at `:1627`; the
existing `reconcileMembershipOnBoot` call stays for a box with a `node_mirror_link` and no other
peer). Test `apps/server/src/boot-peer-check.test.ts`.

**Interfaces — Produces:**
`checkPeersAtStart(deps: { held: SignedMembershipDocument | null; nodeId: string; ownOrigin: string; ask: (peer: RoutableServer) => Promise<PeerStatus | null>; accept: (doc) => Promise<AcceptResult>; restricted: boolean; openOperation: boolean; timeoutMs: number }): Promise<"proceed" | "superseded" | "wait">`:
- no other box with a routable standing in the held chart → `proceed`;
- a peer's answer carries a newer chart that fences this box, or a restriction or operation naming
  this box as source → `superseded` (the caller writes the restriction and starts restricted);
- at least one peer answers with nothing newer → `proceed`;
- no peer answers within `timeoutMs` (default 5 s each), or every listed peer's address equals
  `ownOrigin` or is empty (unaddressable, A947 §2) → `wait`.
`restricted` or `openOperation` true never returns `proceed`.

- [ ] **Step 1: Write the failing tests** (pure, stand-in `ask`): one per rule above; "a peer that
  answers with a chart signed by an unknown key counts as no answer"; "a stale chart from a till
  does not clear a wait" (only a peer answer or a person does, design §4); "a box with no `node.db`
  row but a chart that lists a spare waits" (Review Focus 5; backlog A1274).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot-peer-check.test.ts` — FAIL.
- [ ] **Step 3: Implement**, and wire it in `boot.ts`; `superseded` writes the restriction and
  takes the restricted start (Task 2.1); `wait` takes the waiting start (Task 3.4).
- [ ] **Step 4: Run** it — PASS; then the boot suites in Task 3.6's list.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box whose chart lists another box asks it before selling or filing"`.

#### Task 3.4: The waiting start and "Carry on as the main box"

**Files:** Create `apps/server/src/waiting-start.ts`, `apps/server/src/waiting-page.ts`
(server-rendered, English and Spanish); modify `boot.ts`. Test `apps/server/src/waiting-start.test.ts`.

The waiting start serves `/health`, `GET /api/node` (`acceptingSales: false`), the peer routes
(Tasks 3.1–3.2), and its page; it asks the peers again every 15 seconds and restarts when the
answer is `proceed` or `superseded`.

The page: title "This box is waiting for {other box}", body "It will not take sales or send
anything to the tax agency until it knows whether {other box} has taken over. It checks again
every 15 seconds." and one form, **Carry on as the main box**: email, password, authenticator code
(asked after `totp.required`, as the dashboard does), the other box named in the statement
"{other box} is switched off", and "No other recovery of this venue is in progress"; both
required. Pressing it signs the person in by email (`password.invalid` for every credential
failure), requires `node.promote`, records a `node_handover_events` row
`{ kind: "carried_on_without_peer", detail: { personId, peerNodeIds, chartTerm } }`, and restarts
into a normal start **for this start only** (the decision is not consulted again). Refusal when
this box holds a restriction or an open operation: `handover.known_handover` — "This box has
already handed over to {successor}. It cannot carry on as the main box." with no choice but the
status page link (design §4: it cannot undo a known handover).

- [ ] **Step 1: Write the failing tests.** "waits, answering `acceptingSales: false`"; "restarts
  when a peer answers"; "carry on with a correct sign-in and both statements restarts normally
  and records the decision"; "a person without `node.promote` is refused with the role sentence";
  "a wrong password answers `password.invalid`"; "either statement unticked keeps the action
  disabled"; "a box with a restriction refuses `handover.known_handover`"; "the next start asks
  the peers again".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/waiting-start.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Render the page to a file and open it in Chromium, both themes, 390 px.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a box that cannot reach its peer waits, and a person may carry on only by naming it"`.

#### Task 3.5: A till hands its newer chart to a box it reaches

**Files:** Modify `apps/server/src/till-api.ts` (`GET /api/till`, `:1525`, adds `membership`: the
held signed chart); `apps/till/src/api/server-router.ts` (keep the newest chart it has been given;
when a probe of a server answers a `term` lower than the held chart's, POST the chart to that
server's `/api/node/membership` once per server and term). Tests
`apps/till/src/api/server-router.test.ts`, `apps/server/src/till-api.test.ts`.

- [ ] **Step 1: Write the failing tests.** Router: "posts the held chart to a server answering a
  lower term, once"; "posts nothing to a server at the same or a higher term"; "keeps the newest of
  two charts it was given". Server: "the start read carries the held chart". Control for the
  router: with the POST removed, the first case fails with zero calls.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts` and `pnpm --filter @waitron/server exec vitest run src/till-api.test.ts -t "membership"` — FAIL.
- [ ] **Step 3: Implement.** The till never changes its own routing because of this post.
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "till: hand a newer chart to a box that still holds an older one"`.

#### Task 3.6: Suites that start a box with peers, and the guide

**Files:** The suites printed by `git grep -ln 'serving-secondary\|mirrorEnv' apps/server/src/*.test.ts`
(18 files on `61bfdfe405`) that start a non-mirror box whose chart lists another routable box:
each either starts the peer first, or passes the test seam `peerCheck: () => "proceed"` the task
adds to `StartServerSeams` (`boot.ts:851`) with a comment naming why. Guide: section
`{#waiting-for-the-other-box}` in both `servers.md` files.

- [ ] **Step 1:** Run `pnpm --filter @waitron/server test:coverage` once to list the suites that now
  wait (they time out); fix each as above, never by loosening the check. Record each in the PR's
  "Changed test checks" table: file, test, what changed, why.
- [ ] **Step 2:** Run the listed suites — PASS; then `src/guide-content.test.ts` and, from the root,
  `scripts/guide-links.test.ts`.
- [ ] **Step 3: Commit** `git commit -s -m "server: suites with two boxes start the peer or say why they skip the start check"`.

#### Task 3.7: Final checks for Slice 3

- [ ] As Task 2.6, plus `pnpm --filter @waitron/till typecheck` and
  `pnpm --filter @waitron/till exec vitest run src/api`. PR first line: FISCAL, and "changes
  Ruling C7 for a box with a peer".

---

### Slice 4 — The final copy and its indicator

**FISCAL** (new read-only code in `packages/fiscal-verifactu`). The owner lands it. Everything
here runs only in the restricted start.

#### Task 4.1: The module seat for handover summaries

**Files:** Modify `packages/module/src/module.ts` (`WaitronModule.handover?: ModuleHandoverContribution`,
beside `fiscal`, `:1686`); create `packages/module/src/handover.ts`. Test
`packages/module/src/handover.test.ts`.

**Interfaces — Produces:**
`interface ModuleHandoverContribution { summarise(tx: Transaction): Promise<CanonicalValue> }`;
`collectHandoverSummaries(modules: readonly WaitronModule[], tx: Transaction): Promise<Record<string, CanonicalValue>>`
(keyed by module name, enabled modules only, in name order).

- [ ] **Step 1: Write the failing tests.** "collects each enabled module's summary under its
  name"; "skips a module without the seat"; "a module that throws fails the whole collection with
  `handover.summary_failed` naming it".
- [ ] **Step 2: Run** `pnpm --filter @waitron/module exec vitest run src/handover.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts` and, from the root, `scripts/module-seams.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "module: a seat for what each module must vouch for in a handover"`.

#### Task 4.2: The Veri*Factu chain summary

**Files:** Create `packages/fiscal-verifactu/src/handover-summary.ts`; register it on the
module's descriptor. Test `packages/fiscal-verifactu/src/handover-summary.test.ts`.

**Interfaces — Produces:** `summariseChains(tx: Transaction): Promise<ChainSummary[]>`, one entry
per (`node_id`, `sif_id`) pair that has a record, ordered by those two:
`{ nodeId, sifId, idSistemaInformatico, numeroInstalacion, count, headRegistroId, headHuella, envios: Record<EnvioState, number>, acksSha256, enviandoIds: string[] }`.
Read-only: `select` statements only; no `readChainHead` (it inserts, `chain.ts:112-130`).

- [ ] **Step 1: Write the failing tests** with `useVenueDb` and the package's record fixtures:
  "two chains on two nodes are summarised apart, head by `secuencia` not invoice number"; "a
  chain whose SIF was revoked and replaced is two entries"; "counts every envio state"; "adding one
  record changes count, head and huella" (control); "writes nothing" (the file digest before and
  after are equal).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-summary.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then `src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: summarise each chain for a handover, reading only"`.

#### Task 4.3: The payments summary

**Files:** Create `packages/payments/src/handover-summary.ts`; register it on the payments
module's descriptor (`packages/composition/src/modules.ts:262`). Test
`packages/payments/src/handover-summary.test.ts`.

**Interfaces — Produces:** `summariseUncertainPayments(tx): Promise<{ paymentId: string; provider: string; reference: string | null; state: "attempting" }[]>`, ordered by id.

- [ ] **Step 1: Write the failing tests.** "lists every payment in `attempting` with its provider
  reference"; "lists no other state"; "writes nothing".
- [ ] **Step 2: Run** `pnpm --filter @waitron/payments exec vitest run src/handover-summary.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "payments: list the payments whose outcome is still unknown, for a handover"`.

#### Task 4.4: The node-local manifest

**Files:** Create `packages/handover/src/manifest.ts` (the table under "The node-local manifest"
as data) and `apps/server/src/handover-manifest.ts` (fills in the digests). Tests
`packages/handover/src/manifest.test.ts`, `apps/server/src/handover-manifest.test.ts`.

**Interfaces — Produces:** `NODE_LOCAL_MANIFEST: readonly { item: string; class: "transferred" | "source-only" | "destination-owned" | "rebuildable"; treatment: string }[]`;
`buildNodeLocalManifest(stateDir: string, ring: KeyRing): Promise<NodeLocalItem[]>`, where
`NodeLocalItem` adds `sha256` for `backup.env` and `modules.json` (absent file: `null`) and
`ringVersions: number[]` for `secrets.env`; never a secret's bytes.

- [ ] **Step 1: Write the failing tests.** "every `node.db` table in `NODE_CLASSIFICATION` appears
  in the manifest" (so a new table cannot be forgotten); "every name in `RECOVERY_FILES` and
  `OPTIONAL_BACKUP_STATE` appears"; "the manifest carries no secret": no value equals the ring's
  key bytes; "a missing `backup.env` reads `sha256: null`".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/manifest.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-manifest.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "handover: name every piece of a box's own state and what the new box does with it"`.

#### Task 4.5: Capture the final copy and sign the indicator

**Files:** Create `packages/handover/src/indicator.ts` (the type and `assembleIndicator`) and
`apps/server/src/handover-capture.ts`. Tests `packages/handover/src/indicator.test.ts`,
`apps/server/src/handover-capture.test.ts`.

**Interfaces — Produces:**
`captureFinalCopy(deps: { store; stateDir; ring; node; nodeId; modules }, binding): Promise<SignedHandoverEnvelope<FinalStateIndicator>>`:
refuses `handover.not_stepped_down` unless this box holds the restriction for this operation;
`archiveTo` into `<state>/handover/<operationId>/venue.db`; SHA-256 and size of that file; schema
versions and journal hashes per set; the module summaries read **from the captured file**, opened
read-only, so they describe the same bytes; the manifest; signed; stored as a
`node_handover_events` row `{ kind: "final_state" }`. A second call returns the stored indicator
without capturing again.

- [ ] **Step 1: Write the failing tests.** "the indicator's digest is the SHA-256 of the file it
  names"; "the summaries are read from the captured file" (a row written to the live file after
  capture — through a test-only handle — does not appear); "a second call returns the same
  envelope byte for byte"; "refused on a box that has not stepped down"; "verifies with this box's
  key".
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/indicator.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-capture.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a stepped-down box captures its final copy once and signs what it holds"`.

#### Task 4.6: Serve the final copy to the selected box only, and final checks

**Files:** Create `apps/server/src/handover-source-api.ts`, registered in the restricted start.
Test `apps/server/src/handover-source-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/:operationId/indicator` and
`POST /api/node/handover/:operationId/final-copy` (streams the file), each authorised by a `query`
envelope signed by the binding's destination; any other signer is refused
`handover.peer_unknown` (403); an unknown operation `handover.operation_unknown` (404).

- [ ] **Step 1: Write the failing tests.** "the destination gets the indicator and the copy, and
  the copy's digest matches"; "another listed box is refused"; "an unknown operation is 404".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-source-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then the final checks as Task 2.6, plus the typechecks of
  `@waitron/module`, `@waitron/fiscal-verifactu`, `@waitron/payments`, `@waitron/handover`. PR first
  line: FISCAL (read-only code in the fiscal package).
- [ ] **Step 5: Commit** `git commit -s -m "server: only the selected box may fetch the final copy and its indicator"`.

---
### Slice 5 — Controlled handover, server

**FISCAL** (it activates a fresh fiscal identity on M2, which then files M1's copied records). The
owner lands it. Tested as a simulation; reachable on real boxes after A947 3b.

The order, end to end (design §2): the person starts on M1's dashboard (Task 5.2) → M1 offers to
M2 (M2 records `prepared`) → M1 steps down and restarts restricted (Slice 2) and captures (Slice
4) → M2 fetches and compares, records `copy_accepted`, sends its acceptance (Task 5.3) → M1
records `filing_relinquished` and answers with its relinquishment (Task 5.4) → M2 records
`filing_assumed`, restarts to place the accepted copy, and waits for a person on its own page to
compare clocks and press Activate (Task 5.5) → M2 activates under its own identity and restarts
as the main box; the tills follow the chart.

#### Task 5.1: M2 receives an offer

**Files:** Create `apps/server/src/handover-destination-api.ts`, mounted in a mirror's start.
Test `apps/server/src/handover-destination-api.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/offer`, body a `stepdown` envelope signed by
M1 whose body is `{ binding, authorisedBy: personId }`. M2 refuses `handover.not_a_spare` unless it
is a mirror, `handover.peer_unknown` unless the signer is the binding's source and a key it trusts,
`handover.membership_mismatch` (409) when the binding's chart term or digest differs from M2's held
chart, and `handover.operation_in_progress` when another operation is open. Otherwise it records
`prepared` and answers a `status` envelope. `GET /api/node/handover/:operationId` answers M2's
signed status for the page and for retries.

- [ ] **Step 1: Write the failing tests.** One per refusal; "a valid offer records `prepared` and
  a replay returns the same status"; "an offer naming another destination is refused".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-destination-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare accepts a handover offer only from the main box its chart names"`.

#### Task 5.2: M1 starts a controlled handover

**Files:** Create `apps/server/src/handover-source-start-api.ts` (`POST /management-api/handover`),
mounted in the full start. Test `apps/server/src/handover-source-start-api.test.ts`.

**Interfaces — Consumes:** `confirmFreshSignIn` (`apps/server/src/fresh-sign-in.ts:45`), `stepDown`
(Task 2.3), `currentBinding`, `signAsThisBox` (Task 1.5). **Produces:** body
`{ operationId, destinationNodeId, signIn }`; the session's person must hold `node.promote`. Checks,
each refusing before anything is recorded: the destination is `serving-secondary` in the held
chart (`handover.destination_not_spare`); its `contactUrl` is non-empty and differs from this
box's advertised origin (`handover.destination_unaddressable`, the case every real venue is in
until A947 3b); it answers a signed peer query within 5 s (`handover.destination_unreachable`).
Then it begins its own operation (role source, `prepared`), posts the offer, and calls `stepDown`.
Answers `{ handoverPage: "<M2 contactUrl>/handover/<operationId>" }` before the restart. The same
operation id and inputs return the stored answer; changed inputs refuse `handover.operation_conflict`.

- [ ] **Step 1: Write the failing tests.** One per refusal (each also asserts no node.db row and
  no restart); "a person without `node.promote` is refused"; "a valid start records `prepared`,
  offers, steps down and answers the page address"; "a retry after the restart is answered by the
  restricted start from the stored operation" (Task 2.1's `routes` gains this read).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-source-start-api.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a person holding node.promote starts a controlled handover from the main box"`.

#### Task 5.3: M2 fetches, compares and accepts the final copy

**Files:** Create `apps/server/src/handover-compare.ts`; extend `handover-destination-api.ts`
with a background duty that runs while M2 holds `prepared` for a controlled operation. Test
`apps/server/src/handover-compare.test.ts` (Review Focus 3).

**Interfaces — Produces:**
`compareFinalCopy(deps, operation, indicator: SignedHandoverEnvelope<FinalStateIndicator>, copyPath: string): Promise<{ ok: true } | { ok: false; reason: ErrorCode; detail: CanonicalValue }>`.
In this order, each failure recording `waitHandover(reason)` and leaving M1 stepped down:
indicator signed by the binding's source (`handover.indicator_untrusted`); its binding equals the
operation's (`handover.indicator_mismatch`); the received file's SHA-256 and size equal the
indicator's (`handover.copy_mismatch`); `PRAGMA integrity_check` is `ok`
(`handover.copy_damaged`); no set's version is ahead of M2's image
(`provisioning.database_ahead`, as `assertNotAhead`); the module set and versions equal M2's
(`handover.modules_differ`); `backup.env` and `modules.json` digests equal M2's
(`handover.backup_settings_differ`); every ring version listed is in M2's ring
(`handover.key_ring_mismatch`); each module's summary, **recomputed from the received file**,
equals the indicator's (`handover.summary_mismatch`, naming the module). On success: the file is
kept at `<state>/handover/<operationId>/accepted.db`, `copy_accepted` is recorded with the
acceptance envelope, and only then is the acceptance posted to M1.

- [ ] **Step 1: Write the failing tests.** One per check, built from a real capture (Task 4.5) and
  then altered: "one row written after capture" (`handover.copy_mismatch`); "a copy whose bytes
  match but whose indicator lists one fewer record in a chain" (`handover.summary_mismatch`); and
  so on. "Nothing is posted to M1 before `copy_accepted` is on disk" (the post seam reads node.db).
  Control: the unaltered copy is accepted.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-compare.test.ts` — FAIL.
- [ ] **Step 3: Implement.** One-line comment: the summaries are recomputed from the received
  bytes because a matching digest proves only that M2 holds what M1 sent, not that M1 sent what it
  summarised.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare accepts the final copy only when every check of the indicator passes"`.

#### Task 5.4: M1 relinquishes filing to this M2, once

**Files:** Extend `apps/server/src/handover-source-api.ts` (restricted start) with
`POST /api/node/handover/:operationId/acceptance`. Test
`apps/server/src/handover-relinquish.test.ts`.

**Interfaces — Produces:** verifies the acceptance (signed by the binding's destination, naming
this operation's indicator digest); in one node transaction records `filing_relinquished` with the
signed relinquishment envelope; answers it. A repeat answers the stored relinquishment. An
acceptance for another indicator refuses `handover.indicator_mismatch`.

- [ ] **Step 1: Write the failing tests.** "records and answers a relinquishment bound to the
  indicator and the acceptance"; "a repeated acceptance answers the same bytes"; "M1 is restricted
  before, during and after" (no state lifts the restriction).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-relinquish.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the old box gives up filing to the spare that accepted its copy, and only once"`.

#### Task 5.5: M2 places the copy and activates

**Files:** Create `apps/server/src/handover-activation.ts`, `apps/server/src/handover-place-copy.ts`;
modify `boot.ts` (before the store opens, as `runStagedRestore` does, `apps/server/src/restore-request.ts:344-642`,
place `accepted.db` as `venue.db` when the operation is at `filing_assumed` and not yet placed;
`node.db` is never touched). Test `apps/server/src/handover-activation.test.ts` (Review Focus 2).

**Interfaces — Produces:** on receiving the relinquishment M2 records `filing_assumed` and
restarts; at start it places the copy (moving its old `venue.db` aside, as `restoreDatabase`
does, `apps/server/src/restore.ts:661-694`) and records `copy_placed` as an event.
`POST /api/node/handover/:operationId/activate` with `{ signIn: { email, password, totp? }, comparisonId }`:
the person signs in against the placed copy (`password.invalid` for every credential failure) and
must hold `node.promote` there; the clock comparison is the existing preparation's
(`hour-setup-clock.ts`); the facts given to `createHourPromotionPreparation`
(`packages/fiscal-verifactu/src/hour-recovery-preparation.ts:108-118`) are
`{ oldMachineAbsent: false, oldMachineOffline: true, noParallelRecovery: true }`, justified by the
recorded relinquishment; the controlled scenario takes the next free minute (decision 5). It calls
`promoteMirrorToPrimary(deps, { oldNodeNeutralised: true })` with the operator's id as authority;
then records `activated` (venue first, node after; a re-run finds the committed chart and only
records the state); then restarts as the promotion route does.

- [ ] **Step 1: Write the failing tests.** "activates under a new SIF and series, with M1's SIF
  untouched" (`registro_sif` rows for M1 unchanged); "the new chart marks M1 `sell-only`"; "a lost
  activation answer, then a retry with the same operation, answers `activated` and takes no second
  name" (`fiscal_allocations` count unchanged); "a reboot of M2 between `filing_assumed` and
  placement places once"; "a reboot of M1 between relinquishment and M2's assumption leaves M1
  restricted, and M2's retry of the acceptance gets the same relinquishment"; "activate before
  `filing_assumed` is refused `handover.step_out_of_order`"; "a person without `node.promote` in
  the placed copy is refused".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-activation.test.ts` — FAIL.
- [ ] **Step 3: Implement.** If the preparation cannot take these facts without a change to
  `packages/fiscal-verifactu`, stop and report: that change needs its own review.
- [ ] **Step 4: Run** it — PASS; then `pnpm --filter @waitron/server exec vitest run src/promote.test.ts src/promoted-role.test.ts src/boot.promote.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare places the accepted copy and activates its own identity after a fresh sign-in"`.

#### Task 5.6: The controlled handover, end to end (simulation)

**Files:** Create `apps/server/src/handover-controlled.e2e.test.ts`, on the pattern of
`till-reroute-e2e.test.ts:315-392`, with a stand-in AEAT that records each request's
`IdSistemaInformatico` and `NumeroInstalacion`. The file's first comment says: a simulation of two
boxes in one process, not physical qualification.

- [ ] **Step 1: Write the test.** M1 primary with one filed and one `pendiente` record and one
  open table; M2 a mirror seeded from M1; the handover from Task 5.2 through activation with a
  browser clock sample from the test. Assert: M2 `acceptingSales: true` with a new series; M1
  answers `acceptingSales: false` and makes **no** AEAT request after its stepdown; M2 files M1's
  `pendiente` record with **M1's** identity and its own first sale with **its own**; the open
  table is on M2; a till router pointed at both moves to M2.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-controlled.e2e.test.ts` — PASS (it pins Tasks 5.1–5.5). Control: comment out the restricted start's early return and the "no AEAT request from M1" assertion fails.
- [ ] **Step 3: Commit** `git commit -s -m "server: a controlled handover between two simulated boxes, end to end"`.

#### Task 5.7: Final checks for Slice 5

- [ ] As Task 2.6. PR first line: FISCAL; "reachable on real boxes after A947 3b".

---

### Slice 6 — Controlled handover, screens and guide

Not fiscal, unless Task 6.2 must give the fiscal module's clock element a promotion mode (then the
PR says FISCAL and the owner lands it). Lands after Slice 5.

#### Task 6.1: "Hand over to this box" on the Servers screen

**Files:** Modify `apps/dashboard/src/screens/servers-screen.ts` (a row action on a
`serving-secondary` row, shown to people holding `node.promote`), `apps/dashboard/src/api/client.ts`
(`startHandover`), `apps/dashboard/src/i18n/strings.ts` and `codes.ts`. Tests
`servers-screen.test.ts`, `servers-screen.a11y.test.ts`, a new `servers-screen.handover.test.ts`.

The dialog: title "Hand over to {box}"; text "This box stops taking sales and sends its final copy
to {box}. {box} then runs the venue with a new invoice series. Tills move by themselves; staff sign
in again. A card payment already in progress is not charged again." The fresh sign-in (passkey, or
password then code), as the recovery-pack screen asks it (`apps/server/src/backup-recovery-pack-api.ts:389`).
**Hand over** sends the request with an operation id kept for retries; success opens the address it
answers. Refusals per code, each saying what happened and what to do (CLAUDE.md §3): unreachable —
"{box} did not answer. Check it is switched on and connected, then try again."; unaddressable —
"{box} shares this box's address, so it cannot be handed over yet."

- [ ] **Step 1: Write the failing tests** (real Chromium): the action shows only on a spare row
  and only for `node.promote`; the dialog follows the Forms contract (`design-system.md:2589`); each
  refusal's sentence; English and Spanish; axe in both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/screens/servers-screen.handover.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and the two existing suites — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "dashboard: hand the venue over to a spare from the Servers screen"`.

#### Task 6.2: M2's handover page

**Files:** Create `apps/setup/src/screens/handover-screen.ts` (the setup app already hosts the
fiscal module's clock comparison with its explained waits, `vf-recovery-hour`, A947 4a) and
`apps/server/src/handover-page-mount.ts` (serves it at `/handover/:operationId` on a mirror and
on a box between placement and activation, the way `boot.ts:923` serves the setup app). Tests
`apps/setup/src/screens/handover-screen.test.ts`, `.a11y.test.ts`.

The page shows the operation's progress from `GET /api/node/handover/:operationId` (Task 5.1), one
line per step, refreshing every 2 seconds; once the status reports the copy placed (the
`copy_placed` event, Task 5.5) it asks for a sign-in (email, password, then code) and shows the clock comparison with its explained wait and countdown; then
**Start the venue on this box**. Refusals in place; a lost answer re-reads the status, never
re-sends a different request.

- [ ] **Step 1: Write the failing tests.** Progress lines per state; the sign-in appears only once
  the copy is placed; the button stays disabled until the clock comparison passes; a lost answer
  followed by a status of `activated` shows success without a second press; English and Spanish;
  axe both themes, 390 px.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.test.ts` — FAIL.
- [ ] **Step 3: Implement.** If `vf-recovery-hour` cannot drive a promotion binding as it stands,
  give it a promotion mode in `packages/fiscal-verifactu/src/setup/` with its own tests and mark the
  PR FISCAL.
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the spare's own page carries a handover through to activation"`.

#### Task 6.3: The guide

**Files:** `apps/server/src/guide/en/servers.md`, `apps/server/src/guide/es/servers.md`: sections
`{#hand-over}` (when to use it, what each box shows, what staff do) and `{#after-hand-over}`;
`apps/dashboard/src/help-guide.ts` links the dialog to `{#hand-over}`.

- [ ] Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and, from the
  root, `pnpm exec vitest run scripts/guide-links.test.ts` — PASS.
  `git commit -s -m "guide: handing the venue over to a spare, in English and Spanish"`.

#### Task 6.4: Final checks for Slice 6

- [ ] As Task 2.6, with the dashboard and setup typechecks and their browser suites run with
  measured headroom (`memory_pressure | grep free`, CLAUDE.md §2).

---

### Slice 7 — Emergency handover, server

**FISCAL**. The owner lands it. Adds the `handover` module's `venue.db` migration set.

#### Task 7.1: The `handover` module and its venue tables

**Files:** `packages/handover/src/schema/*.ts`, `src/classification.ts`, `src/migrations.ts`,
`drizzle/` (generated); register the module in `packages/composition/src/modules.ts` (mandatory,
after `node`) and `packages/migrations/migrations.manifest.json` (with its append-only tables).
The commit message states the reason it is a set of its own and not core's (CLAUDE.md §3): the
handover is one seat's records, kept out of the core set.

- `handover_declarations` — ledger, append-only: `operation_id` (primary key), `envelope` (json:
  the signed declaration), `person_id` (plain id; `persons` is identity's set), `declared_at`.
- `handover_gap_items` — state: `id`, `operation_id`, `kind` (`unknown_interval` |
  `returned_invoice`), `source_node_id`, `installation`, `series_number`, `original_ids` (json),
  `issue_date`, `taxable_cents`, `tax_cents`, `gross_cents` (null for an unknown interval),
  `interval_from`, `interval_to`, `status` (`open` | `acknowledged` | `resolved`), `updated_at`.
  Money in whole cents (CLAUDE.md §3).
- `handover_gap_events` — ledger, append-only: `id`, `gap_item_id` (foreign key), `kind`
  (`opened` | `acknowledged` | `resolved` | `interval_closed`), `person_id`, `note`,
  `correction_reference`, `recorded_at`.

- [ ] **Step 1: Write the failing tests** (`packages/handover/src/schema.test.ts`): "creates the
  three tables in venue.db"; "a declaration row cannot be updated or deleted" (the append-only
  trigger's error); "a gap item's amounts are whole cents" (a fraction refused by its check).
- [ ] **Step 2: Run** `pnpm --filter @waitron/handover exec vitest run src/schema.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Run** it — PASS; then from the root every guard in Task 1.4's Step 4 plus
  `scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/module-seams.test.ts`,
  and `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "handover: the venue keeps each emergency declaration and the gaps it leaves"`.

#### Task 7.2: What the spare shows before a declaration

**Files:** Create `apps/server/src/handover-emergency-api.ts` (mirror start). Test
`apps/server/src/handover-emergency-preview.test.ts`.

**Interfaces — Produces:** `GET /api/node/handover/emergency/preview` answers
`{ source: { nodeId, name }, copy: { kind: "mirror-copy", lastChangeAtMs, integrity: "ok" | "damaged" }, chains: ChainSummary[], sourceAnswering: boolean }`.
`lastChangeAtMs` is the newest `issued_at` in `sales` and `updated_at` in `working_orders` of the
copy, labelled on the page as "the latest activity this copy holds" (A947 3c's follower position
replaces it). `sourceAnswering` is a signed peer query to the source (5 s). Reads only.

- [ ] **Step 1: Write the failing tests.** "names the last activity and every chain"; "reports a
  damaged copy" (a corrupted page); "says the old box still answers when it does"; "writes nothing
  to the copy" (digest before and after).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-preview.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a spare shows what its copy holds before anyone declares"`.

#### Task 7.3: The declaration

**Files:** Extend `handover-emergency-api.ts` with `POST /api/node/handover/emergency/declare`.
Test `apps/server/src/handover-emergency-declare.test.ts`.

**Interfaces — Produces:** body `{ operationId, signIn: { email, password, totp? }, statements, reason, locale }`.
Refusals, each before anything is recorded: a credential failure `password.invalid`; no
`node.promote` → `authorization.not_permitted` (what `authorizeManager` throws,
`packages/identity/src/manager-login.ts:172`); a statement not `true` → `handover.request_invalid` naming it; `reason` empty or
over 500 characters; the source still answers a signed query → `handover.source_still_answering`
(409; the page offers the controlled handover); a damaged copy → `handover.copy_damaged`. Then, in
one node transaction, the operation (`emergency`, role destination) at `emergency_declared` and the
signed declaration as an event. **Crash replacement (design §7):** if this box holds an open
controlled operation for the same source with only `prepared` recorded — no `copy_accepted`, no
`filing_assumed`, no `activated` — that operation is closed with an event naming the new one and
the declaration's `replaces` names it; with anything later recorded, the declaration is refused
`handover.controlled_unresolved` (409).

- [ ] **Step 1: Write the failing tests.** One per refusal (each asserting no node.db row); "a
  valid declaration records it before answering"; "the same operation and inputs answer the stored
  declaration"; "replacement allowed from `prepared` only, refused from `copy_accepted`"; "the
  reason is never in a log line" (capture the logger).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-declare.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS; then from the root `pnpm exec vitest run scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "server: an emergency declaration is recorded on the spare before anything changes"`.

#### Task 7.4: Emergency activation

**Files:** Extend `apps/server/src/handover-activation.ts` (Task 5.5) for the emergency scenario.
Test `apps/server/src/handover-emergency-activation.test.ts`.

**Interfaces — Produces:** `POST /api/node/handover/:operationId/activate` accepts an emergency
operation at `emergency_declared`, with the same sign-in and clock comparison; facts as Task 5.5,
justified by the recorded declaration; the minute name takes the setup and restore wait of 90 to
150 seconds (decision 5). After the activation commits: in one venue transaction, the
`handover_declarations` row and a `handover_gap_items` row `{ kind: "unknown_interval",
interval_from: lastChangeAtMs, interval_to: null }`; then `activated` in node.db. A start that
finds `activated` without the venue rows writes them (both are keyed by operation id, so a re-run
writes nothing twice).

- [ ] **Step 1: Write the failing tests.** "waits 90–150 seconds before taking its name" (fake
  clock; a controlled activation in the same harness takes the next free minute); "writes the
  declaration and the unknown interval with the activation"; "a crash after the activation commit
  and before the venue rows: the next start writes them once"; "a lost answer and a retry take no
  second name". If the preparation offers no way to take the restore wait for a promotion, stop
  and report (the change would be in `hour-selection.ts`, fiscal).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency-activation.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: the spare activates after a declaration, waits as a restore does, and records the gap"`.

#### Task 7.5: Retries and crashes across both boxes

**Files:** Test `apps/server/src/handover-emergency.crash.test.ts` (Review Focus 2).

- [ ] **Step 1: Write the tests.** "a reboot between declaration and activation resumes at
  `emergency_declared` and activates once"; "a second declaration naming another source while one
  is open is refused `handover.operation_in_progress`"; "a declaration for a different destination
  after possible activation is refused" (design §7); "M1 comes back while M2 is at
  `emergency_declared`: M1's start check (Slice 3) finds M2's open operation naming it and starts
  restricted".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency.crash.test.ts` — PASS, each with its control named in the test.
- [ ] **Step 3: Commit** `git commit -s -m "server: emergency retries and reboots keep one filing box"`.

#### Task 7.6: The emergency, end to end (simulation), and final checks

**Files:** `apps/server/src/handover-emergency.e2e.test.ts` (first comment: a simulation, not
qualification).

- [ ] **Step 1: Write the test** on Harbour Kitchen §9: M2 seeded from M1 "at 21:39"; M1 then
  issues invoice `A-0CNNW/218` (€110.00) and is closed without a stepdown; M2's declaration and
  activation; M2 files M1's copied `pendiente` record in M1's identity; M1 started again finds M2
  (Slice 3), writes `superseded`, starts restricted, makes no AEAT request; the gap list holds one
  unknown interval from 21:39 and **no** amounts.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-emergency.e2e.test.ts` — PASS.
- [ ] **Step 3:** The slice's final checks as Task 2.6. PR first line: FISCAL; "reachable on real
  boxes after A947 3b; continuous copy after 3c".
- [ ] **Step 4: Commit** `git commit -s -m "server: an emergency handover between two simulated boxes, end to end"`.

---

### Slice 8 — Emergency declaration page and guide

Not fiscal. Lands after Slice 7.

#### Task 8.1: The emergency mode of M2's page

**Files:** Modify `apps/setup/src/screens/handover-screen.ts` (Task 6.2) with an emergency mode at
`/handover/emergency`; strings in `apps/setup/src/i18n/`. Tests `handover-screen.emergency.test.ts`,
`.a11y.test.ts`.

The page, top to bottom: what the copy holds ("The latest activity this copy holds is from
{time}. Anything after that is missing."); the design's warning (§4), in English and Spanish:
"Switch off {M1} before continuing. A broken connection can look like a failed machine. If {M1} is
still running, both machines may take sales and payments, and your bills, cash and stock will
disagree. {M2} may be missing {M1}'s latest records. Only tax records will return later; the
business difference will need reconciliation."; the three statements (required checkboxes);
the reason (required, up to 500 characters); the sign-in (email, password, then code), with one
line "Passkeys are not offered here yet."; the clock comparison with its explained wait and
countdown; **Start the venue on this box**, disabled until every required field and the clock
pass. Refusals in place: still answering — "{M1} still answers, so it was not switched off. Hand
over from {M1} instead, or switch it off and check again." with **Check again** and **Hand over
instead**; a role refusal offers **Sign in as someone else** (an administrator in place).

- [ ] **Step 1: Write the failing tests.** The warning and statements in both languages; the
  button disabled until all required pass; each refusal's sentence and choices; the reason over
  500 characters marked inline; axe both themes, 390 px.
- [ ] **Step 2: Run** `pnpm --filter @waitron/setup exec vitest run src/screens/handover-screen.emergency.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "setup: the spare's emergency page warns, asks for three statements and a reason, then starts the venue"`.

#### Task 8.2: Reaching the page

**Files:** `apps/server/src/handover-page-mount.ts` (serve `/handover/emergency` on a mirror at its
own address); the Servers screen, opened on the spare's own dashboard, links to it. Tests in
`handover-page-mount.test.ts`.

- [ ] Failing test "a mirror serves the emergency page; a primary does not"; implement; PASS;
  `git commit -s -m "server: a spare serves its emergency page at its own address"`. The till strip
  and the QR label remain A947 4c and 4d.

#### Task 8.3: The guide

- [ ] Sections `{#emergency}` and `{#old-box-returns}` in both `servers.md` files: when to use it,
  the warning in plain words, what comes back later and what does not. Guide suites as Task 6.3.
  `git commit -s -m "guide: the emergency switch and what happens when the old box returns"`.

#### Task 8.4: Final checks for Slice 8

- [ ] As Task 6.4.

---

### Slice 9 — The S2 prototype re-run, fiscal-only

Not fiscal (a rig that imports no `@waitron/*` package, `bench/sqlite-failover/README.md:1-21`).
It is the gate for Slices 10 and 11 (A947 §7.1: "If S2 does not pass, the tail shipper is not
built").

#### Task 9.1: Model the fiscal-only return batch

**Files:** Modify `bench/sqlite-failover/src/scenarios/s2_no_double_submit.ts` and
`bench/sqlite-failover/src/model.ts`.

- [ ] **Step 1:** Add a part "fiscal-only full-state batch from a fenced sender": the sender is
  fenced before the batch; the batch carries records after the receiver's head, every filing row
  and every acknowledgement it holds, and returns `enviando` rows as `pendiente`; the receiver
  pauses filing for the sender's chains while applying; business rows are never carried. Add the
  replay variant as a part of its own.
- [ ] **Step 2: Run** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/bench-sqlite-failover scenarios` and read S2's row — expect PASS for these parts.
- [ ] **Step 3: Commit** `git commit -s -m "bench: S2 models A1018's fiscal-only return batch from a fenced sender"`.

#### Task 9.2: The three controls

- [ ] **Step 1:** Add controls that must FAIL: the fence removed; the batch cut back to missing
  records only; the batch built without the `enviando` → `pendiente` return. Run as Task 9.1 Step 2
  and read each control's line: each reports a second filing. Before running, write in the
  scenario's comment what the failing line prints.
- [ ] **Step 2: Commit** `git commit -s -m "bench: S2's controls show each part of the return batch is needed"`.

#### Task 9.3: Record the result

- [ ] Add the run's table, date and commit to `docs/research/2026-09-16-sqlite-failover-prototype.md`
  as a dated section, and the command to `bench/sqlite-failover/README.md`.
  `pnpm --filter @waitron/bench-sqlite-failover typecheck`.
  `git commit -s -m "docs: S2 passes with A1018's return batch; its controls fail as they should"`.
  **If S2 does not pass, Slices 10 and 11 are not built**; stop and report.

---
### Slice 10 — Return batch: evidence for records M2 already holds

**FISCAL**. The owner lands it. Waits for Slice 9's PASS. A fresh-context review of this slice's
tasks, against A947 §7.1 as amended, runs before its first implementer (topology §5.2, risk 2).

#### Task 10.1: The fiscal seat for the return batch

**Files:** Modify `packages/fiscal/src/contribution.ts` (`FiscalContribution.handover?`, beside
`drain`, `:183`). Test `packages/fiscal/src/contribution.handover.test.ts` (types and a
contract-shaped stand-in).

**Interfaces — Produces:**
```ts
interface FiscalHandoverSeat {
  buildReturn(tx: Transaction, request: { heads: readonly { nodeId: string; sifId: string; secuencia: number }[] }): Promise<CanonicalValue>;
  applyReturn(tx: Transaction, body: CanonicalValue, ctx: { operationId: string; sourceNodeId: string }): Promise<ReturnApplyResult>;
  receipt(tx: Transaction, body: CanonicalValue): Promise<CanonicalValue>;
  chainsOf(body: CanonicalValue): readonly string[]; // sif ids the batch touches, for the pause
}
interface ReturnApplyResult {
  readonly outcomesApplied: number; readonly conflicts: readonly { recordId: string; ours: string; theirs: string }[];
  readonly missingRecords: readonly string[]; // ids M2 lacks; Slice 11 stores them
}
```
- [ ] Failing test, implement, PASS (`pnpm --filter @waitron/fiscal exec vitest run src/contribution.handover.test.ts`).
  `git commit -s -m "fiscal: a seat for building and applying a handover's return batch"`.

#### Task 10.2: Veri*Factu builds the batch

**Files:** Create `packages/fiscal-verifactu/src/handover-return.ts` (`buildReturn`, `chainsOf`).
Test `packages/fiscal-verifactu/src/handover-return.build.test.ts`.

**Interfaces — Produces:** the body in Formats → "Return batch": per chain M1 holds, records after
the requested head in `secuencia` order, byte-for-byte; every `envios`, `acks`, `filing_cases`
and `filing_case_events` row for any record of those chains; `enviando` rows carried as
`pendiente` with their original state named (A947 §7.1). Read-only.

- [ ] **Step 1: Write the failing tests.** "carries records after the head, all filing rows and all
  answers"; "an `enviando` row is carried as `pendiente` with its original state named"; "carries
  no `sales`, `sale_lines`, `working_orders`, `payments` or `tenders` row" (the body's keys);
  "built twice from the same database and request, the canonical bytes are equal"; "writes
  nothing" (file digest).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-return.build.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS, then the golden and immutability suites.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: build a returning box's tax records, filing state and AEAT answers, and nothing else"`.

#### Task 10.3: M1 freezes and serves its batch; M2 asks for it

**Files:** Create `apps/server/src/handover-return-source.ts` (restricted start:
`POST /api/node/handover/:operationId/return`, a request signed by the operation's destination
carrying its heads) and `apps/server/src/handover-return-watch.ts` (on M2 after an emergency
activation: every minute, a signed peer query to the source; when it answers restricted and
`superseded`, request the batch). On M1 a returning box that wrote `superseded` (Task 3.2/3.3)
records the operation as source at `source_superseded` from M2's status. Test
`apps/server/src/handover-return-source.test.ts`.

**Interfaces — Produces:** the batch envelope stored at `<state>/handover/<operationId>/return-<sequence>.json`
keyed by the request digest; the same request answers the same bytes; a request with other heads
is a new sequence. M1 records `return_pending`.

- [ ] **Step 1: Write the failing tests.** "the same request twice answers identical bytes";
  "another destination is refused"; "a box that is not restricted refuses
  `handover.not_stepped_down`"; "M2's watch asks every minute and stops once the batch is applied".
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/handover-return-source.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — PASS.
- [ ] **Step 5: Commit** `git commit -s -m "server: a returning box freezes its tax records into a batch that every retry repeats"`.

#### Task 10.4: M2 pauses those chains, applies known answers, keeps conflicts

**Files:** Modify `packages/fiscal-verifactu/src/drain.ts` (an outside input
`pausedSifIds?: () => ReadonlySet<string>` read at the start of each pass and joined with
`blockedSifIds`, `:252-255`; the comment at `:577-579` updated to say the per-pass block now has
this outside input); implement `applyReturn` in `handover-return.ts`; create
`apps/server/src/handover-return-apply.ts` (adds the chains to the paused set, waits for the pass
in flight to end, applies in one venue transaction, lifts the pause). Tests
`packages/fiscal-verifactu/src/handover-return.apply.test.ts`, `src/drain.paused.test.ts`,
`apps/server/src/handover-return-apply.test.ts` (Review Focus 4).

Rules for a record M2 holds, using the filing order of A947 §7.2 check 1 (not yet filed —
`pendiente`, `enviando` — before finished — `aceptado`, `aceptado_con_errores`, `rechazado`,
`detenido`, `retenido`; `pendiente` with `reconciled_resubmit_at` counts as further along):
M1's state further along → M2 takes M1's `envios` state and `acks` row; equal → nothing; M2's
further along → nothing; two different finished states → keep M2's row, record M1's in
`fiscal_conflict_evidence` and open a filing case on M2 (`openFilingCase`,
`packages/fiscal-verifactu/src/filing-cases.ts:51-70`) — never last-arrival-wins. A record M2 lacks
goes to `missingRecords`. A record whose stored bytes differ from M2's copy of the same id is a
conflict, never an overwrite.

- [ ] **Step 1: Write the failing tests.** Drain: "a paused chain is not claimed; another chain is";
  control "without the pause both are claimed". Apply: one per rule; "applying the same batch twice
  changes nothing"; "a pass in flight on a paused chain finishes before the batch applies"
  (server).
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/handover-return.apply.test.ts src/drain.paused.test.ts` and `pnpm --filter @waitron/server exec vitest run src/handover-return-apply.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; then `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/drain.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal: apply a returning box's AEAT answers to records the new box holds, keeping both facts when they disagree"`.

#### Task 10.5: The receipt

**Files:** `receipt` in `handover-return.ts`; `apps/server/src/handover-return-apply.ts` answers
it to M1 as a `return-receipt` envelope and records it. Test
`packages/fiscal-verifactu/src/handover-return.receipt.test.ts`.

- [ ] Failing tests "per record, the id and huella M2 holds; per filing row, M2's state; per chain,
  count and head"; "a record M2 lacks is listed as missing, not as held". Implement; PASS.
  `git commit -s -m "fiscal-verifactu: the new box's receipt for a return batch"`.

#### Task 10.6: Final checks for Slice 10

- [ ] As Task 2.6, plus `pnpm --filter @waitron/fiscal exec vitest run`. PR first line: FISCAL;
  "the drain gains an outside per-chain pause".

---

### Slice 11 — Return batch: originals M2 never saw

**FISCAL — LOUD.** The owner lands it, and decides Q1 before it is built; this is default (a). It
adds a store of returned tax records and a second filing path. It **does not** write
`registros_facturacion`, never recomputes a huella and never builds a record; it stores M1's
records byte-for-byte and sends them unchanged in their generating identity. A fresh-context
review of the slice before its first implementer, as Slice 10.

#### Task 11.1: The returned-records store

**Files:** `packages/fiscal-verifactu/src/schema/returned-records.ts`, `src/classification.ts`,
the package's migration (generated), `src/returned-records.ts`. Test
`packages/fiscal-verifactu/src/returned-records.test.ts`.

- `registros_devueltos` — ledger, append-only: every column `registros_facturacion` stores, with
  the same text representations for huella inputs, plus `operation_id`, `source_node_id`,
  `received_at`; primary key the original id; no foreign key to `sales`, `devices`, `nodes` or
  `registro_sif` (the column comments say so, and that the source box's archive holds those rows);
  a unique index equal to `registros_identidad_uq`'s columns.
- `envios_devueltos` — ledger, mutable as `envios` is: `registro_id` (foreign key to
  `registros_devueltos`), the `envios` states, `intentos`, `proximo_intento_en`, the AEAT reply,
  `conflict` (json, nullable: both facts when finished states disagree).

- [ ] **Step 1: Write the failing tests.** "stores a returned record byte-for-byte" (every column
  equals the batch's); "a record already in `registros_facturacion` is never stored here"; "a
  returned row cannot be updated or deleted"; "the same id twice with other bytes is refused".
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/returned-records.test.ts` — FAIL.
- [ ] **Step 3: Implement**; generate.
- [ ] **Step 4: Run** it — PASS; then from the root every guard in Task 7.1's Step 4 and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: a separate store for tax records a returning box sends back"`.

#### Task 11.2: Apply stores the missing originals, checking their chain

**Files:** `applyReturn` (Task 10.4) stores `missingRecords` through `returned-records.ts`. Test
`packages/fiscal-verifactu/src/handover-return.originals.test.ts`.

- [ ] Failing tests: "the first returned record's predecessor huella equals the head M2 holds for
  that chain, and each next record's equals the one before"; "a break in that link stores the
  records and raises `handover.returned_chain_broken` as a recorded incident" (with its area claim
  and English and Spanish alert wording, `scripts/alert-codes.test.ts`); "an `enviando` original is
  stored `pendiente`". Implement; PASS.
  `git commit -s -m "fiscal-verifactu: returned originals are stored only after their chain link is checked"`.

#### Task 11.3: Filing the returned originals

**Files:** Create `packages/fiscal-verifactu/src/relay-drain.ts`; modify `drain.ts` only to export
the pieces the relay reuses — the transport call, the reply parsing and `handleDuplicate` /
`routeB` (`:1727-1903`) — behind a storage interface, with the drain's own behaviour unchanged
(`src/drain.test.ts` passes unedited). Wire the relay pass into the same `singletonPass` as the
drain (`apps/server/src/boot.ts:3205-3210`), so it runs only on the box holding the singleton role.
Test `packages/fiscal-verifactu/src/relay-drain.test.ts`.

- [ ] **Step 1: Write the failing tests** with a stand-in AEAT: "sends a returned record with its
  stored `SistemaInformatico`" (M1's `IdSistemaInformatico` and `NumeroInstalacion`); "in chain
  order per source chain"; "a 3000 duplicate is settled by consulta when the fingerprint and
  installation match, and kept waiting when the answer is missing"; "two different finished facts
  are kept in `conflict` and the record is not refiled"; "honours the paused set"; "never runs on
  a box without the singleton role".
- [ ] **Step 2: Run** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/relay-drain.test.ts src/drain.test.ts` — FAIL (the first).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them — PASS; the golden and immutability suites unedited.
- [ ] **Step 5: Commit** `git commit -s -m "fiscal-verifactu: the new box files returned originals in their own identity, with the drain's duplicate handling"`.

#### Task 11.4: Box status shows the returned records

**Files:** `apps/server/src/box-status.ts` and `apps/dashboard/src/screens/box-status-rows.ts` (a
row "Invoices returned from {old box}: {n} waiting, {m} filed, {k} need checking"); strings and
guide (`box-status.md` `{#returned-invoices}`, both languages). Tests in their suites.

- [ ] Failing tests for the row in both languages; implement; PASS; guide suites.
  `git commit -s -m "box status: show the invoices returned from the old box and their filing"`.

#### Task 11.5: Harbour Kitchen's invoice 218 (simulation)

**Files:** Extend `apps/server/src/handover-emergency.e2e.test.ts` (Task 7.6).

- [ ] After M2's activation, M1 starts again restricted; M2's watch fetches the batch; assert:
  invoice 218 is in `registros_devueltos`, filed by M2 with **M1's** identity; M1 made **no** AEAT
  request; a record M1 had already sent before failing (stand-in AEAT answers 3000, then consulta
  matches) ends `aceptado` with one submission counted; no `sales` row for 218 exists on M2.
  `git commit -s -m "server: invoice 218 returns, is filed in the old box's identity, and no sale is replayed"`.

#### Task 11.6: Final checks for Slice 11

- [ ] As Task 2.6. PR first line: "FISCAL — a returned-records store and a second filing path;
  `registros_facturacion` untouched".

---

### Slice 12 — The reconciliation list and the report gaps

Not fiscal (it reads fiscal facts through the seat and writes only the `handover` set's tables).

#### Task 12.1: Gap items from a return

**Files:** `apps/server/src/handover-return-apply.ts` writes, in the apply transaction, one
`handover_gap_items` row `{ kind: "returned_invoice" }` per stored original, with installation,
series and number, original ids, issue date and amounts taken from the record (gross
`importe_total`, tax `cuota_total`, taxable their difference, converted with `decimalToCents`);
when the receipt shows every chain matched, the operation's unknown interval gets an
`interval_closed` event. Test `apps/server/src/handover-gap-items.test.ts`.

- [ ] Failing tests: "invoice 218 gives one item: 23 October, 10000, 1000, 11000 cents"; "applying
  the batch again adds nothing"; "an interval stays open while any chain is unmatched".
  Implement; PASS. `git commit -s -m "server: each returned invoice becomes a reconciliation item with its known amounts"`.

#### Task 12.2: The management API

**Files:** `apps/server/src/handover-gap-api.ts`: `GET /management-api/handover/gaps`
(`report.view`), `POST .../:id/acknowledge` and `POST .../:id/resolve`
`{ note, correctionReference? }` (both `node.promote`: the people who may switch the venue's
server; a builder's choice, open to the owner). An acknowledgement is not a resolution; a
correction reference names an M2-owned record and never changes the item's amounts. Test
`apps/server/src/handover-gap-api.test.ts`.

- [ ] Failing tests per route and permission; "resolve without a note is refused naming `note`";
  implement; PASS. `git commit -s -m "server: list, acknowledge and resolve handover gaps"`.

#### Task 12.3: The dashboard screen

**Files:** `apps/dashboard/src/screens/handover-gaps-screen.ts` (under Reports), its strings,
`navigation.ts`, tests (`*.test.ts`, `*.a11y.test.ts`, `*.unsaved.test.ts` for the resolve form,
CLAUDE.md §3). Columns: date, old box, series and number, taxable, tax, gross ("unknown" for an
interval), status, responsible person. Guide: `servers.md` `{#reconciliation}` both languages.

- [ ] Failing tests (Forms contract; English and Spanish; axe both themes); implement; PASS.
  `git commit -s -m "dashboard: the handover reconciliation list"`.

#### Task 12.4: The gap in the reports

**Files:** `packages/reporting/src/daily-close.ts` and `vat-summary.ts` gain a section "Invoices
returned from the old box" for the day (counts and taxable, tax and gross, from
`handover_gap_items`), and "Unknown: the old box's records from {from} are missing" for a day an
open interval covers; `cash-up.ts` gains the same lines beside, not inside, its totals. Tests in
their suites.

- [ ] Failing tests: "the day of invoice 218 shows €100.00 / €10.00 / €110.00 returned and the
  cash-up's own totals unchanged"; "a day inside an open interval says unknown". Implement; PASS.
  `git commit -s -m "reporting: show returned invoices and unknown intervals beside the day's own totals"`.

#### Task 12.5: Final checks for Slice 12

- [ ] As Task 6.4, plus `pnpm --filter @waitron/reporting exec vitest run`.

---

### Slice 13 — Archive, the wipe gates, and becoming the spare

**FISCAL** (it gates the wipe of a box that holds tax records). The owner lands it.

#### Task 13.1: The returning box archives itself

**Files:** `apps/server/src/handover-archive.ts`: `archiveTo` into
`<state>/handover-archive/<operationId>/venue.db`, outside the venue folder a wipe empties; read
back; `PRAGMA integrity_check`; record counts per chain equal the live file's; recorded as an event.
Never streamed, never in a backup, never shipped (A947 §7.2). Test `handover-archive.test.ts`.

- [ ] Failing tests including "a damaged archive is not counted as verified"; implement; PASS.
  `git commit -s -m "server: a returning box keeps a verified archive of everything it held"`.

#### Task 13.2: The new box's signed health

**Files:** `POST /api/node/handover/health` on the main box (signed `health` envelope: accepting
sales, the term that fenced the source, last filing pass time, open filing cases, AEAT answered in
the last 15 minutes or nothing waiting, backup alerts per `apps/server/src/alert-sources.ts`), a
signed query from a box its chart lists. Test `handover-health-api.test.ts`.

- [ ] Failing tests per field; implement; PASS.
  `git commit -s -m "server: the main box vouches for its own health to a returning box"`.

#### Task 13.3: The gates

**Files:** `apps/server/src/handover-wipe-gates.ts`:
`judgeWipe(...)` → `{ pass: true } | { pass: false; failed: GateName[] }` over: every record's
receipt matches (huella exact; filing rows not behind); per-chain counts and heads equal; every
record has a filing row on M2; per chain, the sums of `importe_total` and `cuota_total` of the
transferred records equal; M2's health passes (five-minute and fifteen-minute bounds, starting
values); the archive is verified. Shown on M1's restricted page and M2's Servers screen; retried
every minute. A manager may override the health gate only, after a fresh sign-in on M1's page.
Test `handover-wipe-gates.test.ts`.

- [ ] Failing tests: one per gate (each gate removed in turn lets a planted fault through — the
  proof by deletion, CLAUDE.md §4); "the override reaches the health gate and no other".
  Implement; PASS.
  `git commit -s -m "server: a returning box wipes nothing until every gate passes"`.

#### Task 13.4: Wipe and rejoin

**Files:** `apps/server/src/rejoin.ts` (`rejoinAsSecondary`, `:39-62`) requires `judgeWipe` to pass
when this box's `node.db` holds a handover operation; the wipe keeps `<state>/handover-archive/`.
No archive is deleted by any code here: deletion waits for A664's retention policy, and while a
reconciliation item or filing case names one of its records it must not happen (design §5).
Tests in `rejoin.test.ts`.

- [ ] Failing tests: "refused while a gate fails"; "after a pass, the box wipes and keeps its
  archive"; "no code path deletes an archive" (a text guard over `apps/server/src`, weaker than its
  name: it reads text). Implement; PASS. Guide: `servers.md` `{#old-box-becomes-spare}`.
  `git commit -s -m "server: a returning box becomes a spare only after the gates, and keeps its archive"`.

#### Task 13.5: Final checks for Slice 13

- [ ] As Task 2.6. PR first line: FISCAL.

---

### Slice 14 — A last copy from a selected backup

**FISCAL** (it places a copy a fiscal activation then uses). The owner lands it. For a spare
before A947 3c, and the groundwork A1188's part 0 needs.

#### Task 14.1: Place a backup as the spare's own copy

**Files:** `apps/server/src/handover-copy-from-backup.ts`, using the restore readers with the
spare's own identity kept (`skipSecrets`, `apps/server/src/restore.ts:403-404,417-419`) and its
`node.db` untouched. Refusals: `handover.copy_predates_destination` when the backup's chart does
not list this box (a box missing from the chart could not be checked by a returning M1); the
backup key missing → `handover.backup_key_missing`. Test `handover-copy-from-backup.test.ts`.

- [ ] Failing tests including "the box keeps its own node id and signing key after placement";
  implement; PASS. `git commit -s -m "server: a spare can take a selected backup as its last copy, as itself"`.

#### Task 14.2: Choose the copy on the emergency page

**Files:** the preview (Task 7.2) lists both sources; the declaration's `lastCopy.source` is
`selected-backup` with the source id (`apps/server/src/recovery-source.ts:5-25`); the page (Task
8.1) offers the choice. Tests in their suites.

- [ ] Failing tests; implement; PASS.
  `git commit -s -m "setup: the emergency page offers a selected backup when the spare has no copy"`.

#### Task 14.3: Simulation

- [ ] Extend `handover-emergency.e2e.test.ts` with a spare that has no copy and takes M1's latest
  archive. `git commit -s -m "server: an emergency handover from a selected backup, end to end"`.

#### Task 14.4: Final checks for Slice 14

- [ ] As Task 2.6.

---

## What A1188 part 1 needs, and which slice delivers it

A1188 part 1 is "the box learns §1's facts; the Cloud services card" ([A1188 §11](../specs/2026-10-29-a1188-cloud-emergency-start-design.md#11-how-it-would-be-built)):
whether the emergency start is open, the emergency address and the hosted daily price, and a card
showing the code on request. **It needs no code from this plan.** What held it was A1018's build
approval, given 2026-11-01, and Cloud's half: the contract's billing section says "Emergency
hosting facts need a separate agreed read or a later version" (Cloud `main` at `1aae8f14c0`,
`docs/waitron-integration-contract.md:1928`, read 2026-11-02). So A1188 part 1 can start once
Cloud agrees that read, without waiting for any slice here; the "who can start it" line on its
card is A1188's own rule (password and authenticator code), not this plan's.

The later A1188 parts do use this plan:

| A1188 part | Needs from A1018 | Delivered by |
| --- | --- | --- |
| 0 (a copy under its own identity) | placing a copy without taking the old box's identity | Slice 14 (local); a Cloud copy's identity waits for the contract amendment A1188 §9 item 4 names |
| 3 (the locked start) | a start that serves nothing that sells | Slice 2's restricted start is the pattern; the locked start is A1188's own |
| 4 (declaration and activation) | the declaration format, its recording before activation, the activation | Slices 7 and 8 (the declaration's `provider` field stays null until the joint specification) |
| 6 (the returning box) | the start check and the supersession | Slice 3; asking Cloud is A1188's own addition |

Tell the watcher in the campaign's questions file when Slices 3, 7 and 14 land (the queue asks).

---

## Waiting for the joint specification with Cloud

Not built by this plan, and not invented here (contract, "Map the person and the retry",
`08a2a0d4` lines 1470–1484):

- **The authentication bridge**: binding a Cloud account, venue and operation to the venue's
  `node.promote` holder, with its format, expiry, revocation and replay refusal.
- **The provider-resource stop**: the declaration's `provider` field is `null` for every local
  declaration; its content for a hosted M1 is the joint format.
- **A hosted M2 that is not in M1's chart**: a returning M1 cannot verify a chart signed by a key
  it never trusted (A1188 §12; backlog A1275). Slice 14 refuses such a copy locally.
- **Cloud's resource journal bound to the same operation** (contract, same section).

One docs task, after Slice 7 lands: write these four as questions to Cloud's lane G in the shared
contract's proposal process, citing this plan's Formats.

---

## Owner task: physical qualification on real boxes

**For the owner, after A947 3b and 3c and Slices 0–13 have landed. Not done by any implementer;
no simulation above counts as it.** On two real boxes on one switch, with the internet unplugged
throughout and every clock read at the start and the end:

1. Controlled: hand over mid-service from the Servers screen; switch on the spare's page; pull M1's
   power during the capture once, and during the activation once.
2. Emergency: pull M1's plug mid-sale after a cash sale the spare has not copied; declare on the
   spare from a phone; sell; power M1 back; watch it restrict itself, return its invoice, pass the
   gates and rejoin.
3. The split: unplug M1's network cable instead of its power, declare, and watch M1 stop when a
   till brings it the newer chart.
4. Measure: the 180-second admitted-work limit, the five- and fifteen-minute health bounds, the
   copy's size and transfer time.

The other six placements (local-to-Cloud, Cloud-to-Cloud, Cloud-to-local, each both ways) wait for
the joint specification and Cloud's half.

---

## Still unsettled

- **Q1** (above), before Slice 11.
- **Passkeys on the spare's page** wait for A947 4b/4d (decision 7).
- **The last-activity time** of a mirror's copy is a proxy until A947 3c's follower reports its
  position (Task 7.2).
- **Whether `vf-recovery-hour` can drive a promotion** is found in Task 6.2; if not, that task
  touches fiscal UI code.
- **Whether the promotion preparation can take the restore wait** is found in Task 7.4; if not,
  that is a change to `hour-selection.ts`, stopped and reported.
- **Archive deletion** waits for A664's retention policy; nothing here deletes one.
