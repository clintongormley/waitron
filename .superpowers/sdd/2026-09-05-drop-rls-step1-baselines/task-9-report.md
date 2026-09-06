# Task 9 report

Nineteen test files now use one managed PGlite database per file. Eight dual-target files collapse to PGlite; eleven real-Postgres-only files move. The reviewed set contains 185 files: 19 moved, 166 retained, zero splits. No production behavior changes. The requested Task 7b and Task 8e carries are included in the first implementation commit.

## Candidate decisions

`dual` means PGlite plus real PostgreSQL. The prescribed search found 176 candidates at this task's starting commit, `c35e555f`. A supplementary search for `cloneTemplate` and PostgreSQL factory imports found nine more files, marked “outside grep”. The rows below record the final choice; retained mixed suites keep all their cases together.

| file | before target | after target | reason |
| --- | --- | --- | --- |
| `apps/server/scripts/demo-seed/seed-catalogue.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed-floor.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed-media.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed-options.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed-sales.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed-staff.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed.integration.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/demo-seed/seed.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/scripts/dev-onboard.test.ts` | real PG | real PG | Exercises onboarding through a PostgreSQL URL that opens its own connections. |
| `apps/server/scripts/dev-setup.test.ts` | real PG | real PG | Exercises setup through PostgreSQL URLs and a reader denied inspection privileges. |
| `apps/server/src/adopt-e2e.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/adopt.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/aeat-credential.test.ts` | real PG (outside grep) | PGlite | Owner-side venue setup and credential sealing; no role or contention assertion. |
| `apps/server/src/backup-manifest.test.ts` | real PG | PGlite | Reads applied migration journals; PGlite runs the same migration sets. |
| `apps/server/src/backup-probe.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/backup-sweep.test.ts` | real PG | real PG | Runs pg_dump against the migrated database and checks the custom-format artifact. |
| `apps/server/src/booking-api.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/bookings-cas.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/boot.fence.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/boot.mirror.test.ts` | real PG | real PG | Exercises production PostgreSQL URL connections and boot-time role checks. |
| `apps/server/src/boot.promote.test.ts` | real PG | real PG | Exercises production PostgreSQL URL connections and boot-time role checks. |
| `apps/server/src/boot.singleton.test.ts` | real PG | real PG | Exercises production PostgreSQL URL connections and boot-time role checks. |
| `apps/server/src/boot.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/box-retire.route.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/box-status.disposal.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/box-status.replication.tailer.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/box-status.replication.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/box-status.route.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/break-glass-command.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/catalogue-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/chain-height.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/clear-table-status.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/device-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/device-session.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/device.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/diagnostics-api.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/fiscal-apply.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/fiscal-capture.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/fiscal-fk-defer.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/fiscal-park-env.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/fiscal-upsert.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/kitchen-print.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/management-api-passkey.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/management-api.canvases.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/management-api.device-profiles.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/management-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/management-api.status.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/management-api.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/me-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/membership-gossip.e2e.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/mirror-bundle-api.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/mirror-bundle.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/mirror-e2e.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/mirror-session.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/mirror-token.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/move-merge.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/pass.pg.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/pg-restore.test.ts` | real PG | real PG | Runs pg_dump/pg_restore and checks the restored fiscal ledger and triggers. |
| `apps/server/src/print-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/provision.test.ts` | real PG (outside grep) | PGlite | Owner-side provisioning and singleton-stamp behavior; no role or contention assertion. |
| `apps/server/src/purchasing-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/receipt-print.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/recipe-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/recovery-bundle-api.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/rejoin-e2e.test.ts` | real PG (outside grep) | real PG | Runs database recreation and PostgreSQL dump/restore through the rejoin command. |
| `apps/server/src/report-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/restore-fiscal-e2e.test.ts` | real PG (outside grep) | real PG | Runs PostgreSQL dump/restore, then fiscal restore hooks and trigger checks. |
| `apps/server/src/sale-till-source.receipt.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/schedule-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/served-at-huella.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/service-statuses.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/split-bill.fiscal.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/split-bill.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/sync-api.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/sync-e2e.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/sync-enrolment-triggers.test.ts` | real PG | PGlite | Reads trigger metadata; no trigger is exercised as a database role. |
| `apps/server/src/sync-origin.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/tables.location-scope.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/tabs.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/till-api.pg.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/till-api.receipt.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/till-sale-integrated.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/till-sale.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/transfer-lines.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `apps/server/src/tunnel-e2e.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/webhook.pg.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `apps/server/src/workforce-api.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `apps/server/src/working-order.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/core/src/settle-sale.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/credentials/src/credentials.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/db/src/allocate-number.test.ts` | dual | dual | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/db/src/allocate-order-number.test.ts` | dual | dual | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/db/src/append-order-amendment.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/db/src/client.test.ts` | real PG | real PG | Exercises the node-postgres driver, including connection and close behavior. |
| `packages/db/src/deployment.test.ts` | dual | dual | Checks app_user SELECT and withheld write privileges on deployment. |
| `packages/db/src/immutability.test.ts` | dual | PGlite | The superuser-created probe checks generic trigger refusals, not a role privilege boundary. |
| `packages/db/src/migrate.test.ts` | real PG | real PG | Exercises migrations through the node-postgres driver. |
| `packages/db/src/node-membership.test.ts` | real PG | real PG | Checks JSONB decoding through the node-postgres driver alongside PGlite logic tests. |
| `packages/db/src/schema/bookings.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/catalogue.test.ts` | dual | PGlite | Schema columns, defaults and CHECK constraints; no role or contention assertion. |
| `packages/db/src/schema/daily-closes.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/device-profiles.fk.test.ts` | real PG | PGlite | Composite foreign keys and RESTRICT are checked through the owner connection. |
| `packages/db/src/schema/devices.fk.test.ts` | real PG | PGlite | Composite foreign keys, NULL bindings and RESTRICT; no role assertion. |
| `packages/db/src/schema/devices.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/dining-tables.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/drawer-opens.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/floor-zones.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/kitchen-courses.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/kitchen-stations.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/location-catalogues.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/locations-default-catalogue.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/nodes.test.ts` | dual | PGlite | Schema mapping, uniqueness and foreign keys; no role or contention assertion. |
| `packages/db/src/schema/orders.test.ts` | dual | PGlite | Order constraints and trigger behavior; no role switch or competing backend. |
| `packages/db/src/schema/orders.transition.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/park-retrieve.test.ts` | real PG | PGlite | Sale uniqueness, product foreign keys and constraint introspection. |
| `packages/db/src/schema/printing.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/routing-station.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/sale-settlements.test.ts` | dual | dual | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/sale-substitutions.test.ts` | dual | PGlite | Substitution uniqueness, foreign keys and generic immutability triggers; no role switch. |
| `packages/db/src/schema/sales.test.ts` | dual | dual | Checks node-postgres monetary decoding alongside the PGlite driver. |
| `packages/db/src/schema/series.test.ts` | dual | PGlite | Series schema, uniqueness and foreign keys; no allocation race. |
| `packages/db/src/schema/station-printers.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/tab-link.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/table-service-statuses.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/schema/ticket-items.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/db/src/tenancy.test.ts` | dual | PGlite | Locale constraints and transaction-local settings; no role or competing backend. |
| `packages/db/src/testing/harness.test.ts` | dual | dual | Tests both target factories, including creation of a real PostgreSQL database. |
| `packages/db/src/testing/lifecycle.test.ts` | real PG | real PG | Tests real database lifecycle helpers and authentication as a probe role. |
| `packages/db/src/testing/postgres.test.ts` | real PG | real PG | Tests distinct backend processes, probe-role authentication and container lifecycle. |
| `packages/db/src/testing/seed.test.ts` | dual | PGlite | Fixture inserts and returned values; no role or contention assertion. |
| `packages/fiscal-verifactu/src/canje-path.e2e.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/fiscal-verifactu/src/chain.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/fiscal-verifactu/src/chain.node-rekey.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/fiscal-verifactu/src/correction-path.e2e.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/fiscal-verifactu/src/drain.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/fiscal-verifactu/src/privileges.test.ts` | real PG | real PG | Checks app_user table and column privileges against the captured matrix. |
| `packages/fiscal-verifactu/src/reserved-sif.test.ts` | real PG | PGlite | Sequential counter increments and uniqueness; no competing writers. |
| `packages/fiscal-verifactu/src/restore.pg.test.ts` | real PG | PGlite | Fresh SIF, clock floor, empty chain and retained ledger; no role or race assertion. |
| `packages/fiscal-verifactu/src/substitution-path.e2e.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/identity/src/passkey.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/identity/src/persons.email.test.ts` | real PG | real PG | Exercises queries through an app_user member LOGIN; retains that role check despite the old candidate header. |
| `packages/identity/src/staff.email.test.ts` | real PG | PGlite | Unique-index errors translated to person.email_taken on the owner connection. |
| `packages/identity/src/staff.pg.test.ts` | real PG | real PG | Exercises queries through an app_user member LOGIN; retains that role check despite the old candidate header. |
| `packages/layouts/src/canvas-store.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/layouts/src/device-profile-store.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/layouts/src/receipt-store.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/layouts/src/theme-store.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/migrations/src/apply.concurrency.test.ts` | real PG (outside grep) | real PG | Exercises two migration hosts contending on an advisory lock. |
| `packages/migrations/src/schema-version.test.ts` | real PG (outside grep) | real PG | Checks real node-postgres error propagation after closing its pool. |
| `packages/payments-stripe/src/device.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/payments-stripe/src/hosted.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/payments-stripe/src/stripe.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/payments/src/async-settle.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/payments/src/forward.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/payments/src/incident-dedup.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/payments/src/reconcile.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/payments/src/reversal.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/payments/src/store.pg.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/printing/src/agent.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/printing/src/runtime.active.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/printing/src/runtime.race.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/printing/src/runtime.reclaim.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/provisioning/src/instance-apply.pg.test.ts` | real PG (outside grep) | real PG | Checks role membership, grant options, failed grants and least-privileged provisioning. |
| `packages/provisioning/src/instance-state.test.ts` | real PG (outside grep) | real PG | Inspects database existence and PostgreSQL role attributes. |
| `packages/provisioning/src/venue-apply.pg.test.ts` | real PG (outside grep) | real PG | Provisions a sellable venue as a verified non-superuser owner. |
| `packages/reporting/src/record-daily-close.pg.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/reporting/src/verify-daily-close-chain.pg.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/scheduler/src/store.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/sync/src/apply.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/capture-identity.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/capture.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/config-conflict.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/config-conflict.grants.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/disposal.test.ts` | real PG | PGlite | Owner-side drain arithmetic over sync_log and sync_cursor. |
| `packages/sync/src/origin.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/peers.grants.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/peers.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/pull.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/redelivery.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/retention.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/sync/src/source.gate.test.ts` | real PG | real PG | Exercises the database path through a non-superuser LOGIN and its grants. |
| `packages/workforce/src/chain.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/workforce/src/clocking.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |
| `packages/workforce/src/immutability.test.ts` | real PG | real PG | Exercises reads/writes or triggers after SET ROLE app_user. |
| `packages/workforce/src/scheduling.concurrency.test.ts` | real PG | real PG | Exercises competing PostgreSQL backends and their locking or commit visibility. |

## Rulings I applied

- The running case wins over a stale candidate header. A query after `SET ROLE app_user`, or through a LOGIN inheriting `app_user`, retains its real-Postgres target. A successful read/write is still an observation of that role's grants. This applies to the layout stores, printing claim/reclaim suites, and the two identity probe-login suites. I initially moved the identity probes, then restored their target and probe role during self-review to apply this rule consistently. Their test bodies remain unchanged.
- PGlite still executes CHECK constraints, unique indexes, foreign keys and ordinary trigger bodies. The moved immutability, order and substitution suites contain no role switch. They retain their original SQLSTATE and trigger-message assertions. `schema/sales.test.ts` retains both drivers because its monetary-value test explicitly checks driver decoding (`typeof ... === "string"`). Sequential installation reservations are not a contention test; the separate fiscal concurrency suites stay on PostgreSQL.
- PostgreSQL-specific tooling and driver contracts also stay: migration pools, closed-pool errors, `pg_dump`/`pg_restore`, database creation and role inspection. These cannot be exercised by merely replacing a URL-based connection with the embedded PGlite harness.
- Mutable case rows are cleared between cases. Shared FK seed rows remain where they are reused. Append-only sales, substitution links and their FK parents remain until the managed file database closes; cases that append new families use fresh tenant/node/series identities. Park/retrieve removes draft rows while retaining the order referenced by its immutable sale. No ledger trigger is disabled or ledger row deleted.
- Cleanup of terminal orders and untraded provision fixtures uses transaction-local `app.sync_apply`, restored by commit before another case. The original behavior assertions run outside that cleanup transaction. The new server cleanup helper owns no database and is used by both moved provisioning suites.
- The prescribed grep is a reproducible file-count metric, not an exhaustive container census. Seventeen matching files moved; the other two moves, server `provision.test.ts` and `aeat-credential.test.ts`, used `cloneTemplate` directly and were absent from the search. The count at the task's starting commit was 176, while the earlier recorded Task 6 checkpoint was 175.
- Kept filenames such as fiscal `restore.pg.test.ts`; the harness, header and table record their actual target. No filename-driven Vitest selection is changed.
- The migration-pointer carry removes or re-points the requested obsolete references. The constraint-trigger parser title now describes its fixture, and the boot title names the read-privilege probe. The supplied broad sweep also finds historical references outside the carry list and synthetic migration names in parser fixtures; this task does not claim that sweep is empty. A few stale references in files already touched were also corrected. No SQL migration, assertion or parser fixture was changed for these carries.
- The restored `readNodeEndorsement` docblock accounts for both a missing row and a null endorsement. The return body uses `row?.endorsement ?? null`; the promotion consumer reads that endorsement into the signed membership document. No stronger privilege claim was restored.

## Verification

All coverage commands run sequentially, with `TESTCONTAINERS_RYUK_DISABLED=true`. Each command is `pnpm --filter @waitron/<package> test:coverage`; output is captured in `/tmp/task9-<package>.log`. All 18 touched packages exited 0. The excerpts below preserve the test totals and complete aggregate coverage row (statements, branches, functions, lines). The excerpts are grouped by package path, not execution order. Full package runs include all suites and enforce the configured thresholds.

### @waitron/server

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
 Test Files  202 passed (202)
      Tests  2524 passed (2524)
All files          |   99.12 |    98.36 |   99.18 |   99.12 |
```

### @waitron/catalogue

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/catalogue test:coverage
 Test Files  8 passed (8)
      Tests  177 passed (177)
All files          |     100 |    98.86 |     100 |     100 |
```

### @waitron/core

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/core test:coverage
 Test Files  7 passed (7)
      Tests  148 passed (148)
All files          |     100 |     99.4 |     100 |     100 |
```

### @waitron/credentials

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/credentials test:coverage
 Test Files  10 passed (10)
      Tests  123 passed (123)
All files          |     100 |      100 |     100 |     100 |
```

### @waitron/db

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/db test:coverage
 Test Files  50 passed (50)
      Tests  505 passed | 1 skipped (506)
All files          |   99.69 |    98.24 |     100 |   99.69 |
```

### @waitron/fiscal-verifactu

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/fiscal-verifactu test:coverage
 Test Files  36 passed (36)
      Tests  304 passed (304)
All files          |   99.68 |    97.08 |     100 |   99.68 |
```

### @waitron/identity

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage
 Test Files  20 passed (20)
      Tests  156 passed (156)
All files          |     100 |      100 |     100 |     100 |
```

### @waitron/layouts

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/layouts test:coverage
 Test Files  16 passed (16)
      Tests  150 passed (150)
All files          |     100 |      100 |     100 |     100 |
```

### @waitron/migrations

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/migrations test:coverage
 Test Files  3 passed (3)
      Tests  16 passed (16)
All files          |     100 |      100 |     100 |     100 |
```

### @waitron/payments

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments test:coverage
 Test Files  26 passed (26)
      Tests  381 passed (381)
All files          |    99.9 |    98.98 |     100 |    99.9 |
```

### @waitron/payments-stripe

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/payments-stripe test:coverage
 Test Files  17 passed (17)
      Tests  97 passed (97)
All files          |    99.4 |    97.91 |     100 |    99.4 |
```

### @waitron/printing

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/printing test:coverage
 Test Files  10 passed (10)
      Tests  86 passed (86)
All files     |     100 |      100 |     100 |     100 |
```

### @waitron/provisioning

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/provisioning test:coverage
 Test Files  16 passed (16)
      Tests  206 passed (206)
All files          |   99.67 |    98.97 |     100 |   99.67 |
```

### @waitron/purchasing

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/purchasing test:coverage
 Test Files  1 passed (1)
      Tests  15 passed (15)
All files      |     100 |      100 |     100 |     100 |
```

### @waitron/recipes

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/recipes test:coverage
 Test Files  2 passed (2)
      Tests  24 passed (24)
All files       |     100 |      100 |     100 |     100 |
```

### @waitron/scheduler

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/scheduler test:coverage
 Test Files  8 passed (8)
      Tests  83 passed (83)
All files          |   99.53 |    97.11 |     100 |   99.53 |
```

### @waitron/sync

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/sync test:coverage
 Test Files  19 passed (19)
      Tests  128 passed (128)
All files         |     100 |      100 |     100 |     100 |
```

### @waitron/workforce-es

```text
$ TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/workforce-es test:coverage
 Test Files  6 passed (6)
      Tests  22 passed (22)
All files          |     100 |      100 |     100 |     100 |
```

### Final root and static checks

All four commands exited 0 on the final source tree.

The root config has no named project and includes only `scripts/**/*.test.{ts,mjs}`. `pnpm vitest run` therefore runs the root guards, including guarded-teardowns and coverage-thresholds, without running browser packages.

```text
$ pnpm vitest run
   ✓ the test shards > cover every package declaring test:coverage exactly once, on a global scope  2180ms
   ✓ the test shards > give each of those packages a shard that selects it and nothing else  1516ms

 Test Files  13 passed (13)
      Tests  977 passed (977)
   Start at  19:31:51
   Duration  4.80s (transform 862ms, setup 0ms, collect 5.21s, tests 9.43s, environment 1ms, prepare 730ms)
```

```text
$ pnpm typecheck
packages/sync typecheck: Done
packages/composition typecheck$ tsc --noEmit
packages/composition typecheck: Done
packages/provisioning typecheck$ tsc --noEmit
packages/provisioning typecheck: Done
apps/server typecheck$ tsc --noEmit
apps/server typecheck: Done
```

```text
$ pnpm lint
> waitron@ lint /Users/clintongormley/workspace/worktrees/waitron-feat-drop-rls-step1
> eslint .
```

```text
$ pnpm format:check
> waitron@ format:check /Users/clintongormley/workspace/worktrees/waitron-feat-drop-rls-step1
> prettier --check .

Checking formatting...
All matched files use Prettier code style!
```

### Failure and preservation receipts

- The first shared-database provisioning run failed three assertions: later cases saw extra fiscal identities and the earlier deployment stamp. Adding cleanup exposed `23503` on `kitchen_stations_location_fk`; ordering that child before its location fixed the cleanup. The final targeted command `pnpm --filter @waitron/server test provision.test.ts aeat-credential.test.ts` passed 11 tests. The full server coverage run then passed 2,524 tests.
- During the substitution fixture conversion, an overbroad fixture replacement changed a recipient tax ID. The retained counterparty assertion failed. The recipient literals were restored, including the distinct second-recipient fixture found during diff review; the final db package run includes those unchanged assertions.
- A TypeScript AST comparison against `c35e555f` checked every moved file: 223 `expect` expressions and all plain `it` titles match, allowing only the harness accessor change `.admin` to `.db` and whitespace. The checks inside parameterized cases are included in that expression comparison. Command: `node /tmp/task9-assertions.mjs`. No expectation was removed or weakened to make PGlite pass.
- `git diff --check` passes. The requested SQL sweep for `CREATE CONSTRAINT TRIGGER` returns no matches in the module baselines; the renamed parser test retains the synthetic fixture and assertion.

## Measurements

The Step 1 grep at this task's final source tree prints **159**. The recorded base value is **212**. These are file counts, not elapsed-time measurements.

```sh
grep -rlE "useRealPostgres|describeEachTarget|startMigratedPostgres|useTemplateDb|REQUIRE_DOCKER|startPostgresContainer" packages apps --include='*.test.ts' | grep -v node_modules | wc -l
# 159
```

The controller owns the full-workspace wall clocks. No whole-workspace coverage timing was run from this seat. Leave `full suite <before> → <after>` for the controller to complete in the PR body; the existing measurements file records the controller's 352-second before run. Task 10 owns the backlog/PR timing integration.

## Files changed

- `apps/server/scripts/allergens-demo.ts`
- `apps/server/scripts/dev-onboard.test.ts`
- `apps/server/scripts/dev-setup.test.ts`
- `apps/server/scripts/modelo-303-demo.ts`
- `apps/server/src/aeat-credential.test.ts`
- `apps/server/src/backup-manifest.test.ts`
- `apps/server/src/backup-sweep.test.ts`
- `apps/server/src/boot.fence.test.ts`
- `apps/server/src/boot.test.ts`
- `apps/server/src/box-retire.route.test.ts`
- `apps/server/src/box-status.disposal.test.ts`
- `apps/server/src/box-status.replication.tailer.test.ts`
- `apps/server/src/box-status.replication.test.ts`
- `apps/server/src/catalogue-api.ts`
- `apps/server/src/chain-height.test.ts`
- `apps/server/src/device.pg.test.ts`
- `apps/server/src/diagnostics-api.test.ts`
- `apps/server/src/errors.ts`
- `apps/server/src/fiscal-fk-defer.test.ts`
- `apps/server/src/management-api.status.test.ts`
- `apps/server/src/management-api.test.ts`
- `apps/server/src/pass.pg.test.ts`
- `apps/server/src/pg-restore.test.ts`
- `apps/server/src/promote.test.ts`
- `apps/server/src/promote.ts`
- `apps/server/src/provision-till.test.ts`
- `apps/server/src/provision.test.ts`
- `apps/server/src/recovery-bundle-api.test.ts`
- `apps/server/src/rejoin-command.ts`
- `apps/server/src/report-api.pg.test.ts`
- `apps/server/src/reserved-identity.test.ts`
- `apps/server/src/retire.ts`
- `apps/server/src/sale-till-source.receipt.test.ts`
- `apps/server/src/sync-enrolment-triggers.test.ts`
- `packages/catalogue/vitest.config.ts`
- `packages/core/src/errors.ts`
- `packages/credentials/src/credentials.test.ts`
- `packages/db/src/allocate-number.test.ts`
- `packages/db/src/allocate-order-number.test.ts`
- `packages/db/src/client.test.ts`
- `packages/db/src/deployment.test.ts`
- `packages/db/src/immutability.test.ts`
- `packages/db/src/migrate.test.ts`
- `packages/db/src/node-membership.test.ts`
- `packages/db/src/reserved-identity.ts`
- `packages/db/src/schema/bookings.test.ts`
- `packages/db/src/schema/catalogue.test.ts`
- `packages/db/src/schema/device-profiles.fk.test.ts`
- `packages/db/src/schema/devices.fk.test.ts`
- `packages/db/src/schema/devices.test.ts`
- `packages/db/src/schema/drawer-opens.test.ts`
- `packages/db/src/schema/floor-zones.test.ts`
- `packages/db/src/schema/kitchen-courses.test.ts`
- `packages/db/src/schema/kitchen-stations.test.ts`
- `packages/db/src/schema/location-catalogues.test.ts`
- `packages/db/src/schema/locations-default-catalogue.test.ts`
- `packages/db/src/schema/nodes.test.ts`
- `packages/db/src/schema/orders.test.ts`
- `packages/db/src/schema/park-retrieve.test.ts`
- `packages/db/src/schema/printing.test.ts`
- `packages/db/src/schema/routing-station.test.ts`
- `packages/db/src/schema/sale-settlements.test.ts`
- `packages/db/src/schema/sale-substitutions.test.ts`
- `packages/db/src/schema/sales.test.ts`
- `packages/db/src/schema/series.test.ts`
- `packages/db/src/schema/station-printers.test.ts`
- `packages/db/src/schema/tab-link.test.ts`
- `packages/db/src/schema/table-service-statuses.test.ts`
- `packages/db/src/tenancy.test.ts`
- `packages/db/src/testing/harness.test.ts`
- `packages/db/src/testing/lifecycle.test.ts`
- `packages/db/src/testing/postgres.test.ts`
- `packages/db/src/testing/seed.test.ts`
- `packages/fiscal-verifactu/src/privileges.test.ts`
- `packages/fiscal-verifactu/src/rectificativa-columns.test.ts`
- `packages/fiscal-verifactu/src/reserved-sif.test.ts`
- `packages/fiscal-verifactu/src/restore.pg.test.ts`
- `packages/identity/src/persons.email.test.ts`
- `packages/identity/src/staff.email.test.ts`
- `packages/identity/src/staff.pg.test.ts`
- `packages/identity/src/testing/global-setup.ts`
- `packages/identity/vitest.config.ts`
- `packages/layouts/src/canvas-store.pg.test.ts`
- `packages/layouts/src/device-profile-store.pg.test.ts`
- `packages/layouts/src/receipt-store.test.ts`
- `packages/layouts/src/theme-store.test.ts`
- `packages/migrations/src/apply.concurrency.test.ts`
- `packages/migrations/src/schema-version.test.ts`
- `packages/payments-stripe/src/device.test.ts`
- `packages/payments-stripe/src/hosted.test.ts`
- `packages/payments/src/forward.concurrency.test.ts`
- `packages/payments/src/incident-dedup.concurrency.test.ts`
- `packages/payments/src/reversal.concurrency.test.ts`
- `packages/printing/src/runtime.active.test.ts`
- `packages/printing/src/runtime.reclaim.test.ts`
- `packages/provisioning/src/instance-apply.pg.test.ts`
- `packages/provisioning/src/instance-state.test.ts`
- `packages/provisioning/src/venue-apply.pg.test.ts`
- `packages/purchasing/vitest.config.ts`
- `packages/recipes/vitest.config.ts`
- `packages/scheduler/src/store.concurrency.test.ts`
- `packages/sync/src/apply.gate.test.ts`
- `packages/sync/src/disposal.test.ts`
- `packages/sync/src/peers.test.ts`
- `packages/workforce-es/vitest.config.ts`
- `scripts/module-graph-honesty.test.ts`
- `apps/server/src/testing/clear-provision-fixture.ts`
- `.superpowers/sdd/2026-09-05-drop-rls-step1-baselines/task-9-report.md`
- `.superpowers/sdd/2026-09-05-drop-rls-step1-baselines/measurements.md`

## Self-review and concerns

Reviewed harness construction, case cleanup, fixture values, role switching, driver-specific checks, and the requested comment/title carries. The AST comparison checks assertions; the package runs check execution. The root guards and static commands are separate evidence. No subagents, reviewers, browser tests, push or workspace timing were used.

Some packages still boot their existing shared container in global setup even when their selected files use only PGlite. The workforce-es, catalogue, purchasing and recipes config comments now describe properties instead of stale file counts; their setup behavior is unchanged. Therefore the file-count reduction does not by itself establish a wall-clock improvement. The controller's isolated run is still needed.

The db coverage run skips the PGlite leg of its concurrent invoice-number case (`packages/db/src/allocate-number.test.ts:218`, `it.runIf(target.name === "postgres")`). `git show c35e555f:packages/db/src/allocate-number.test.ts` contains the same gate; only its file header changed. The real-Postgres leg passes. Browser package execution and CI remain the controller's responsibility. The requested measurements and this report are explicitly staged despite `.superpowers/` being ignored, so their receipts survive the implementation commit and squash.
