# Outbox → native logical replication: the swap

**Date:** 2026-09-05. **Status:** design, awaiting owner review; Track A item 4.
**Inputs:** the prototype that gates this —
[2026-09-05-native-replication-post-rls-prototype-findings.md](2026-09-05-native-replication-post-rls-prototype-findings.md)
— and a brainstorm with the owner the same day. Supersedes the mechanism half of
`2026-08-02-app-level-sync-design.md` (which stays the record of what is built today) and, once the
slices land, the schema-version gate of `2026-09-05-module-sp2b-schema-version-gate-design.md`.

## 0. Decisions taken with the owner (2026-09-05)

1. **Full replacement.** The application outbox and everything built on it goes; Postgres logical
   replication carries every row between nodes. No hybrid, no side-by-side period.
2. **No third-party overlay account.** Tailscale-style services are out. The standby reaches the box
   over a direct encrypted link to the box's own cloud instance (one instance per tenant, so no
   shared relay is in the replication path). Track B's relay decision the same day extends the same
   link to remote access and retires the relay altogether.
3. **A returned box ships its ledger back, never its settings.** After the cloud has taken over, the
   returned box's unsent sales, payments and fiscal records drain to the new primary; its unsent
   settings edits are discarded. Structural (two publications), not a review step.

Two things the brainstorm did not reach were decided on review the same day: **(4)** live service
rows the box wrote in its final seconds (open tabs, kitchen progress, print jobs) are treated like
settings — copied to a standby, never drained back — because by the time the box returns the new
primary's live state is the real one (§4.3, owner: "correct"); and **(5)** the working-time record's
chain, keyed per location today, is rekeyed **per node** like the fiscal chain, so each server keeps
its own clock-in chain (§4.4, owner: "I'm ok with that").

## 1. What changes, in one paragraph

Today a trigger copies every enrolled write into `sync_log`; a peer fetches it over HTTPS, applies
it as the app role, tracks a cursor, reports it back so the log can be pruned, and parks rows whose
schema version it cannot apply. After the swap, each node publishes its tables and a standby
subscribes to them over a WireGuard link; Postgres captures, ships, applies, orders, retains and
resumes. What Waitron still owns is small: which tables a module publishes and which stay local, the
creation and inspection of publications and subscriptions through the owner login, the promotion and
return procedures rewritten against Postgres's own progress numbers, and a version check.

## 2. The shape

### 2.1 Four classes of table, two publications

Every table is copied unless its module marks it **local** with a stated reason — the inverse of
today's opt-in enrolment (28 of 82 tables enrolled; a standby that must take over needs all of them).
The classes:

| Class | Meaning | Copied to a standby | Drained back from a returned box |
| --- | --- | --- | --- |
| `ledger` | what happened: sales, payments, fiscal records, closes, clock-ins | yes | **yes** |
| `state` | what a manager configures, and live service in flight | yes | no |
| `local` | this node's own record of what it is | no | no |

`ledger` and `state` map onto two publications per node, named for the environment:
`waitron_<production|preproduction>_ledger` and `…_state`. A node holds exactly these two; a
subscription names one or both.

Classification by owning module, from the 80 live tables (`order_prep` and `till_layouts` are dropped):

- **core (`packages/db`)** — ledger: `sales`, `sale_lines`, `tenders`, `sale_settlements`,
  `sale_voids`, `sale_substitutions`, `ticket_items`, `drawer_opens`, `daily_closes`,
  `daily_close_chain`, `purchase_invoices`, `purchase_invoice_vat`.
  state: `working_order_counters` (a per-node counter that is updated, not appended — the standby
  needs it, a returned box's stale value must not travel), `tenants`, `locations`, `nodes`, `tills`, `devices`, `device_profiles`, `invoice_series`,
  `catalogues`, `location_catalogues`, `categories`, `products`, `option_groups`,
  `option_group_items`, `product_option_groups`, `ingredients`, `recipe_lines`, `floor_zones`,
  `dining_tables`, `table_service_statuses`, `kitchen_stations`, `kitchen_courses`,
  `station_printers`, `printers`, `print_agents`, `layout_profiles`, `tenant_themes`,
  `tenant_receipts`, `bookings`, `incidents`, `working_orders`, `working_order_lines`,
  `order_amendments`, `print_jobs`. local: `deployment` (this node's environment stamp),
  `mirror_config`, `node_membership` (the membership document is per node by construction),
  `device_pairing_codes`, `print_agent_pairing_codes` (minutes-lived, minted per node).
- **fiscal-verifactu** — ledger: `registros_facturacion`, `cadenas`, `registro_sif`, `envios`,
  `envio_flujo`, `acks` — every one keyed by `node_id` since the server-as-SIF rekey, so a standby's
  copy of the box's chain is a copy, never a continuation, and a returned box's tail can only name
  its own rows. state: `contadores_instalacion` — one shared row per (NIF, system) with no node key,
  updated at every SIF registration; a returned box's stale copy of that counter must never travel
  back over the new primary's.
- **payments** — ledger: `payments`, `payment_refunds`. state: `payment_policy`.
- **identity** — state: `persons`, `webauthn_credentials`. local: `sessions`,
  `management_sessions`, `webauthn_challenges` (per-node, short-lived; a promoted standby starts
  with no sessions, which is what happens today).
- **workforce / workforce-es** — ledger: `time_entries`, `workforce_chains`. state: `employments`,
  `shifts`, `shift_templates`, `shift_swaps`, `absences`, `availability`, `roster_versions`,
  `convenio_config`.
- **credentials** — state: `tenant_credentials`. (Whether the sealed blobs are usable on the other
  node depends on the vault-key design, which is Track B item 2's question, not this spec's; the row
  travels regardless.)
- **scheduler** — local: `scheduled_runs` (a node's own run ledger; a promoted node starts its own).
- **sync** — the four outbox tables are deleted (§7), so there is nothing to classify.

Two checks make the classification honest: a root guard asserts every table in every module's
`drizzle/` is classified exactly once (a new table with no class fails the guard, never silently
copies or silently stays local), and the two-node test suite (§11) inserts one row into every
`ledger`/`state` table and reads it on the standby.

### 2.2 Subscriptions and the enable rule

A node keeps at most two subscriptions, one per peer direction, both created at adoption with
`origin = none` (the echo defence; the prototype's control shows what `origin = any` does) and both
owned by the migrator login. The rule for which is enabled:

- **The standby's subscription to the primary is always enabled** and names both publications.
- **The primary's subscription to the standby is disabled**, so a standby's writes — there should be
  none; the read-only gate is the app-level guarantee — can never reach the primary. It is enabled
  only for the drain window in §4.2, narrowed to the `ledger` publication, and disabled again after.

Created in that order on adoption: the standby's first (`copy_data = true` — the initial copy of 78
tables took 3 s in the prototype; a deli database over a WAN is minutes), the primary's second
(`copy_data = false`, then `DISABLE`). Postgres warns when a `copy_data = true` subscription is
created against a publisher that itself subscribes; creating the standby's first avoids the case the
warning is about.

### 2.3 The link

The box opens a **WireGuard** tunnel to its own cloud instance. Keys are minted by the adopting side
and exchanged in the adoption bundle (which today carries identity and a sync token; the token goes,
the key comes); each side's private key is stored where the box secret is stored. Postgres on each
node listens on the WireGuard interface in addition to localhost, and `pg_hba.conf` admits the
replication login only from the peer's WireGuard address. Traffic inside the tunnel is already
encrypted and authenticated, so the Postgres connection uses password auth and no TLS. WireGuard is
connectionless: a box that loses internet and gets it back needs no reconnect logic, and it works in
both directions, which is what the drain window and a promoted cloud need.

Fallback where a shop's router blocks UDP: an SSH reverse tunnel from the box to the cloud instance
(`ssh -R` under a supervisor), which forwards a cloud-local port to the box's Postgres. Same
subscription SQL, different `host=`. Supported, not default.

The same link carries remote access — the owner's relay decision the same day
([2026-09-05-relay-decision.md](2026-09-05-relay-decision.md)): no relay, ours or off-the-shelf; the
cloud instance passes TLS for the box's name straight down the link, and `@waitron/tunnel` is retired
with Track B item 2's build. This spec adds nothing to that; it only rides the link.

### 2.4 Environment isolation

A production node cannot subscribe to a preproduction one, and vice versa, for two independent
reasons: the publication name carries the environment (subscribing to `waitron_production_ledger`
on a preproduction publisher fails with "publication does not exist"), and the adoption code reads
`deployment.environment` on both ends before creating anything and refuses a mismatch. The
`/sync-api/hello` environment handshake it replaces was one reason; this is two.

## 3. Roles and privileges — the provisioning delta

Measured in the prototype under `waitron_migrator` with `rolsuper = f`:

- The migrator login owns the database and every table, so it can `CREATE PUBLICATION … FOR TABLE
  <list>` (an explicit list; `FOR ALL TABLES` is superuser-only), `CREATE SUBSCRIPTION`, `ALTER
  SUBSCRIPTION … ENABLE/DISABLE/SET PUBLICATION/SKIP`, and set the trigger enable mode. The apply
  worker runs as the table owner, which it is, so the old `cannot SET ROLE` gate never arises.
- The **superuser step**, one more beside the ones `waitron-provision instance` already has: create
  `waitron_repl` (`LOGIN REPLICATION`, password minted by the provisioner — a `CREATEROLE`
  non-superuser cannot: `permission denied to create role`), and `GRANT pg_create_subscription TO
  waitron_migrator`. The migrator then grants `waitron_repl` `SELECT` on every table and sets
  `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO waitron_repl` so a future migration's table
  is covered.
- `waitron_app` is unchanged. It still holds only `SELECT, INSERT` on `registros_facturacion`, which
  is what stopped its UPDATE in the prototype (`permission denied`), and it cannot set
  `session_replication_role`.
- `sync_tailer` and `sync_retention` and their grants are deleted with the outbox (§7).
- Every trigger that calls `reject_mutation()` — today the immutability/truncate pairs on
  `registros_facturacion`, `sales`, `sale_lines`, `tenders`, `sale_voids`, `sale_settlements`,
  `sale_substitutions`, `time_entries`, `daily_closes` and `order_amendments` (`grep -B3
  'EXECUTE FUNCTION reject_mutation' packages/*/drizzle/*.sql`, 2026-09-05) — is set
  `ENABLE ALWAYS`. Without it the
  apply worker (which runs in replica mode) skips them and copies a corrupted publisher's UPDATE
  silently; with it the copy is refused and the subscription stalls, which is right for a fiscal
  record. The list is derived, not hand-written: the root guard in §2.1 also asserts that every
  trigger calling `reject_mutation()` is `ENABLE ALWAYS` on every node.
- `track_commit_timestamp = on` on every node. It is what lets Postgres 18 detect and count a
  clashing update (`update_origin_differs`); the prototype measured detection + apply + log with it
  on. It costs a little WAL per commit and buys the monitoring in §6.

## 4. Promotion, fencing and return (the R3 rewrite)

### 4.1 Drained, measured by Postgres

"Drained" today is our cursor arithmetic (`readDrainProgress`, per lane). It becomes one comparison
on the publisher: for the standby's slot, `pg_replication_slots.confirmed_flush_lsn` equals
`pg_current_wal_lsn()`. On the subscriber the same fact is `pg_stat_subscription.latest_end_lsn`.
Fencing is unchanged: the box's app goes read-only, nothing about the database changes, and because
nothing new is written the comparison converges.

### 4.2 The sequence

1. **Fence** the box (read-only gate, membership document, as R3). The standby's subscription keeps
   draining whatever is still in flight.
2. **Confirm drained** (§4.1), or accept the loss if the box is dead — the same choice R3 records.
3. **Promote** the cloud: point of no return, reserved SIF series, `mode=primary`, as R3. Two
   replication steps join it: the cloud narrows its (still enabled) subscription to the box to the
   `ledger` publication — `ALTER SUBSCRIPTION … SET PUBLICATION waitron_<env>_ledger` — so that if
   the box ever returns, only its ledger tail can arrive; and the cloud's own `state`/`ledger`
   publications are already there, nothing to create.
4. **Return.** The box boots fenced. Its ledger tail drains into the cloud automatically (the
   subscription from step 3 is enabled and narrowed). The tail cannot collide with anything the
   cloud has written since promotion because ledger rows are keyed by the node that wrote them
   (`sales`, `payments`, `cadenas`, `registro_sif`, `registros_facturacion` carry `node_id`; their
   children hang off `sale_id` / `registro_id`; everything else is uuid-keyed) — not because they
   are immutable: `payments`, `sales`, `cadenas`, `envios` and the close chain ARE updated by the
   app, always by the node that owns the row. Two shapes can still clash, both natural-key
   uniqueness (`multiple_unique_conflicts`, which stalls the drain until `SKIP`): a
   `time_entries` chain position (§4.4) and a supplier invoice number entered on both nodes. That
   `SKIP`-after-a-look is the one review step this design keeps, and §4.4 removes the first shape.
   When the box's slot on the cloud side reports drained, the cloud **disables** that subscription.
5. **Rejoin** the box as a standby the way rejoin works today — **wipe and re-adopt**: drop its
   database contents, take a fresh initial copy of both of the cloud's publications, create the
   cloud's (disabled) subscription back to it. Wiping is what makes the settings decision clean: the
   box's unsent settings edits never travel (its `state` publication was never subscribed during the
   drain) and never linger (the wipe removes them), so primary and standby cannot diverge on a
   settings row.

The disposal guard ("is my own tail fully on the carrier?") becomes step 4's slot comparison, read on
the cloud and reported to the box over the management API, or read by the box through its own
subscription's `pg_stat_subscription`. Retire (a box leaving for good) is the same steps without 5.

### 4.3 Live-service rows (owner decision 2026-09-05)

Live-service rows (`working_orders`, `working_order_lines`, `order_amendments`, `dining_tables`,
`print_jobs`) are classed `state`, so a box's last seconds of open-tab edits do not travel back. The
alternative — draining them and letting Postgres 18's `update_origin_differs` detection apply the
box's stale version over the cloud's live one, logged — is what the prototype measured for settings
and what the owner rejected for settings. Same reasoning, same answer; confirmed by the owner.

### 4.4 The working-time chain gets the fiscal chain's per-node rekey (owner decision 2026-09-05)

`workforce_chains` has primary key (`tenant_id`, `location_id`) and `time_entries` is unique on
(`tenant_id`, `location_id`, `sequence_no`) — one hash chain of clock-ins per location, whichever
node writes it. After a promotion the cloud continues that chain from its copy, and the returned
box's unsent tail holds links with the same sequence numbers: a fork, and a unique-index clash on
every one of them. The fiscal chain had the same shape and was rekeyed per node (server-as-SIF, #54).
The working-time record is a launch-day legal duty (`docs/backlog.md`, workforce), so this is not a
row to lose or to fork. **Decision:** each node keeps its own working-time chain — `workforce_chains`
and `time_entries` are rekeyed per node, the way the fiscal rekey did — so a returned box's clock-ins
are links in its own chain and slot in beside the cloud's. **Prerequisite for S3/S4**, its own
brainstorm and PR. What remains for the labour advisor is presentation only: whether the exported
registro de jornada for a location may be shown as two chains. Until the rekey lands, `time_entries`
is the drain-stall shape named in §4.2.

## 5. Schema upgrades

Postgres replicates rows, never DDL, so a schema change is a rolling event. Measured: a column added
on the publisher before the subscriber stalls the subscription with `missing replicated column`, holds
the rows in WAL, and resumes by itself once the subscriber has the column; a column the subscriber
has and the publisher does not is harmless (NULL). So:

- **The standby migrates first, then the primary.** The primary's migration step (`applyMigrations`
  under the provisioner) asks the standby its version over the existing management API and refuses
  to start while the standby is behind or unreachable, with a `--standby-upgraded` override for the
  case where the operator knows better. Forced ahead anyway, the failure is loud and self-healing;
  the disk bound in §6 is the clock.
- **Additive only, on copied tables.** A rename or a drop is two releases: add the new column and
  migrate data, then drop the old one after every node is on the new version. The root guard in
  §2.1 refuses a migration that drops or renames a column of a `ledger`/`state` table unless the
  migration file carries a stated `-- contract:` marker, so the two-step rule is enforced rather
  than remembered.
- **`__drizzle_migrations_*` is never published.** Each node migrates itself; copying the bookkeeping
  would mark migrations applied that never ran.
- The SP-2b park gate (schema version in `/sync-api/hello`, parked rows) is deleted; its concern is
  now the stall above. The version endpoint itself survives as the standby-first check.

## 6. Disk bound, monitoring, a standby that stays away

The primary retains every change the standby has not confirmed. Unbounded, a dead standby fills the
primary's disk — the one failure that would stop a sale, which CLAUDE.md §5 forbids. So:

- `max_slot_wal_keep_size = 4GB` on every node. Measured cost: 5000 registros ≈ 16 MB of WAL, so
  4 GB is on the order of a million fiscal records, weeks of a deli's trade. Past it Postgres
  invalidates the slot (`wal_status = lost`) and the primary keeps selling.
- An invalidated slot means the standby re-adopts (§4.2 step 5) when it returns: a fresh initial
  copy, minutes. The status page says so in words.
- The box status page and the cloud instance both show: standby lag (bytes and seconds, from
  `pg_stat_replication` / `pg_stat_subscription`), retained WAL against the bound, `wal_status`,
  and the `pg_stat_subscription_stats` counters (`apply_error_count`, the conflict columns). Warn at
  half the bound; alarm when the subscription has been stalled (`apply_error_count` rising with no
  progress) for longer than the migration window.
- The operator procedure for a stalled subscription is `ALTER SUBSCRIPTION … SKIP (lsn = …)` as the
  migrator login, with the LSN from the subscriber's log — measured; it leaves the nodes divergent on
  the refused row, by design, and the runbook says which cases (a refused fiscal UPDATE) mean the
  publisher was corrupted.

## 7. What is deleted, what stays, what moves

**Deleted** (with their tests): in `packages/sync` — `source.ts`, `apply.ts`, `apply-sql.ts`,
`pull.ts`, `wire.ts`, `cursor-report.ts`, `retention.ts`, `peers.ts`, `disposal.ts` and their gate
suites; in `packages/sync/drizzle` — `sync_log`, `sync_cursor`, `sync_peers`,
`sync_config_conflicts`, the `sync_tailer` / `sync_retention` roles, the capture triggers on every
enrolled table (`0014_fiscal_sync_capture.sql` and its siblings), and the `app.sync_apply`-gated
trigger variants of `0037`; in `apps/server` — `sync-api.ts`, `sync-http.ts`, `sync-evict.ts`,
`sync-peer-command.ts`, the sync-token half of `mirror-bundle.ts`, the pull/retention workers in
`boot.ts`, the lane wiring; in `packages/sync-enrolment` — modes, lanes, `configClass`, the
`enrol()` column derivation; the schema-version park gate (SP-2b) and the settings-conflict gate
(Slice 7). The `sync.*` error codes are deprecated, never renamed (CLAUDE.md §3); the registry keeps
them with a deprecation note.

**Stays, rewritten:** `packages/sync` becomes the thin native layer — `publications.ts` (derive the
two table lists from the module classification and create/alter them), `subscriptions.ts`
(create, enable, disable, narrow, skip, drop; all as the migrator login), `status.ts` (the numbers
in §6), `drain.ts` (§4.1). `packages/sync-enrolment` becomes the classification contract: a module
exports `classify(table, "ledger" | "state" | "local", reason)` for each of its tables. `apps/server`
keeps `box-status.ts`, `rejoin.ts`, `retire.ts`, `box-retire.ts` and the R3 promotion, rewritten
against §4. The mirror bundle carries the WireGuard key and the environment.

**New:** the WireGuard link (key minting in provisioning, interface configuration on the box image,
`pg_hba` rules), the standby-first migration check, the two root guards of §2.1/§3.

**Package name.** `@waitron/sync` keeps its name; the word is still right.

## 8. Modules: the contract change

The module contract's "sync" concern (sync inversion, SP-2a) becomes: every table the module's
migrations create is classified, the classification is data the composition root assembles, and the
publications are derived from it. A module never writes replication SQL. Modules that need a trigger
to fire on a standby (today: the append-only guards) declare it, and the guard checks it is
`ENABLE ALWAYS`. The fiscal module's enrolment (SP-3a) is the first conversion and the H2 sign-off
seat (§12).

## 9. Backups and restore

A node restored from a backup has no slots and no subscriptions: it re-adopts (§4.2 step 5) and takes
a fresh copy. The outbox resume marker planned as BR-4 is not needed, and `backup-probe.ts`'s reads
of `sync_log` go. What a backup is for narrows to the cold-recovery case CLAUDE.md §5 already
describes: a venue with no standby, restoring to trade again on a fresh chain.

## 10. Cloud-only mode

MVP option (a), one node on a managed HA Postgres, has no peer, so nothing here applies except the
absence of subscriptions. Option (b), a second cloud node, is this spec with no WireGuard (both
nodes are reachable; Postgres over TLS with certificate auth, which the same code path supports as a
connection-string difference). If a managed host is ever a standby it must allow a `REPLICATION`
login and `wal_level = logical` on the primary side — listed so it is checked before a host is chosen.

## 11. Testing

Track A owns the harness. It gains a **two-node fixture**: two containers on one network,
`wal_level = logical`, migrated by the real migrator role, adopted by the real adoption code, seeded
from the prototype's scripts. Suites, each proven by deletion:

- every `ledger`/`state` table copies one row; every `local` table does not (delete a class → fail);
- a fiscal record copies byte-identical (`md5(r::text)` both sides, as measured);
- a replicated UPDATE on a fiscal table is refused (drop `ENABLE ALWAYS` → it applies → fail);
- a preproduction subscriber cannot attach to a production publisher (rename → fail);
- the full §4.2 sequence: fence, drain, promote, return, drain the tail, wipe, rejoin — the ledger
  tail arrives, the settings edit does not;
- a publisher-ahead column add stalls, then resumes when the subscriber migrates;
- a WAL overflow invalidates the slot and re-adoption succeeds (bound set to a few MB for the test);
- the standby-first migration check refuses and overrides.

PGlite cannot do any of this, so these suites are real-Postgres only, and the sync package's
coverage bar (98/98/98/95) is met with them. Mutation: the ENABLE ALWAYS guard and the classification
guard are the two whose deletion must fail the suite.

## 12. Fiscal safety and owner review

`registros_facturacion` and the chain tables replicate verbatim; the standby's copy is a copy of the
box's chain, never continued (server-as-SIF gives the promoted node its own chain and series, R3).
The prototype's byte-identity receipt covers the row; the `ENABLE ALWAYS` guard covers the
subscriber. Nothing here writes a fiscal row the app did not; nothing here changes `computeHuella`.
Under CLAUDE.md §5 and the H2 rule, the slice that converts the fiscal module (§14, S3) lands only
with the owner's sign-off, and its PR carries the two-node suite's output.

## 13. Before the plan: verifications still owed

1. WireGuard on the box image (kernel module present on the chosen OS; key storage) and the SSH
   fallback — a one-day spike with two VMs, not containers.
2. Initial copy over a WAN-shaped link for a seeded deli database (size and minutes).
3. `ALTER DEFAULT PRIVILEGES` actually covering a table a later migration creates, as the migrator.
4. That `ALTER SUBSCRIPTION … SET PUBLICATION` narrowing takes effect for changes already in the
   publisher's WAL (the drain-window case in §4.2 step 3), measured, not assumed.
5. The `update_origin_differs` counter with `track_commit_timestamp` **off** — the prototype's
   second run was botched by a leftover slot; the spec requires it on regardless.
6. The per-node rekey of the working-time chain (§4.4): its own brainstorm and PR before S3; the
   labour advisor's answer on presenting a location's record as per-node chains, in parallel.

## 14. Slices (each its own plan; order matters)

> **2026-09-05, later the same day:** the owner chose to do item 3 and this swap *all at once*, so
> these slices are now steps 2–5 of item 3's chain and their order is fixed there —
> [2026-09-05-drop-rls-squash-and-outbox-deletion-design.md](2026-09-05-drop-rls-squash-and-outbox-deletion-design.md)
> §3. S0 is item 3's step 1; S1 = step 2; S2 = step 3; S4 + S5 = step 4 (the one owner signature);
> S6 + S7 = step 5; S3 has no separate seat — the fiscal module is classified in step 2 and its rows
> first flow natively in step 4.

- **S0 — schema, inside Track A item 3's baseline:** no `sync_*` tables or roles, no capture
  triggers, `ENABLE ALWAYS` on every append-only trigger, `track_commit_timestamp` and
  `max_slot_wal_keep_size` in the instance settings. Item 3 is regenerating every baseline anyway.
- **S1 — the contract and the guards:** `classify()` replaces `enrol()`; the two root guards; the
  publication lists derived; the two-node fixture. No behaviour yet.
- **S2 — provisioning:** the superuser step, publications and subscriptions created on adopt, the
  mirror bundle carries the key, environment refusal. The cloud standby end-to-end (Track B item 2)
  proves it on real machines.
- **S3 — the fiscal module converted [owner sign-off].**
- **S4 — promotion and return on LSNs:** §4; rejoin/retire/box-status rewritten; disposal deleted.
- **S5 — delete the outbox:** everything in §7's first paragraph, in one PR so no half-state ships.
- **S6 — the standby-first migration check, status page numbers, alarms.**
- **S7 — the WireGuard link on the box image and the SSH fallback** (with Track B item 2).

## 15. Interactions

- **Track A item 3** carries S0. This spec is why item 3 no longer needs `sync_log` fencing,
  `sync_tailer` or `sync_retention`.
- **Track B** item 2 (cloud standby end to end) is where S2 and S7 are proven on real hardware; item
  3 (promotion runbook slice 2) is S4's home; item 6 (node-role collapse) shrinks further once the
  pull and retention workers are gone from `boot.ts`.
- **Track C** item 5 (the relay) is answered by the relay decision — no relay; the module contract
  change (§8) is the "sync" owned-concern of the module system, and SP-2b's gate is retired by §5.
- **Backup & restore** BR-4 is not needed (§9).

## Provenance

| Claim | Where |
| --- | --- |
| Every measured number and error text in §2–§6 | the prototype findings doc (linked at top), each probe with its stated failing case |
| `update_origin_differs` detected + applied + logged with `track_commit_timestamp = on` | two-container run 2026-09-05: B row = `box-old-edit`, `confl_update_origin_differs = 1`, log `conflict=update_origin_differs`; containers torn down |
| Postgres warning on `copy_data = true` against a subscribing publisher | the same run, verbatim `WARNING: subscription … requested copy_data with origin = NONE but might copy data that had a different origin` |
| Table inventory (80 live tables by module) | `grep 'CREATE TABLE' packages/*/drizzle/*.sql` minus the two `DROP TABLE`s, 2026-09-05 |
| 28 enrolled tables today | `grep 'enrol(' packages/*/src/enrolment.ts` |
| Which tables carry `node_id`, which ledger tables the app updates, the `reject_mutation` trigger list, the workforce chain's keys | greps over `packages/*/drizzle/*.sql` and `packages/*/src`, `apps/server/src` on 2026-09-05, pasted into the sections that cite them |
| Owner decisions in §0 | brainstorm transcript 2026-09-05 |
