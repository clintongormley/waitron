# Retirement of the old table-grants record

You cannot use the old database's grants to decide what today's storage refuses. The A805 audit
removed that record after checking each table it restricted. Use the module's `appendOnly()`
declarations and the write-path guard for their stated protections. The remaining restrictions
below need individual decisions; this audit does not authorise adding or removing protection.

## What was checked

On 2026-10-19, at base `3351ca5073a81bf11596faef8aa744ab2c33ffc3`, the audit applied every set
from `orderedMigrationSets(ALL_MODULES)` through `migrationOptionsFor` and `applyMigrations` to a
new temporary venue on Node v26.11.1. It queried `sqlite_master` for tables and triggers and joined
the result to the modules' classification declarations and `scripts/write-path-tables.json`.
The database had 236 tables, including bookkeeping tables. All 64 names missing any of `SELECT`,
`INSERT`, `UPDATE` or `DELETE` in the old record are accounted for below.

The old letters were historical input, not a measurement of the old database. In particular,
table grants did not describe column grants: an absent `UPDATE` letter did not exclude an
`UPDATE(next_number)` grant on `invoice_series`. No current protection was inferred from a
`ledger`, `state` or `local` classification alone.

The unchanged checks ran as follows:

- `pnpm exec vitest run scripts/write-path-tables.test.ts scripts/append-only-triggers.test.ts scripts/classification-complete.test.ts`: 88 passed before retirement. The append-only suite tries an update and a delete against seeded rows in every declared table, with `payments` as its writable control.
- `pnpm --filter @waitron/server exec vitest run src/course-delete.test.ts src/table-removal.test.ts`: 39 passed.
- `pnpm --filter @waitron/identity exec vitest run src/account-action.test.ts`: 37 passed.
- `pnpm --filter @waitron/venue-service exec vitest run src/service-delete-settings.test.ts`: 12 passed.

## Append-only declarations

Each table below is declared `appendOnly()` and was included in the unchanged append-only suite.
That suite isolates the trigger pair by disabling foreign keys and check constraints and removing
other triggers in its own database. Its receipt concerns that pair, not every way to rewrite a row
or every enabled-module combination. The disabled-module protection issue remains open.

| Table                   | Declaration                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `daily_closes`          | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `order_amendments`      | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `registros_facturacion` | [packages/fiscal-verifactu/src/classification.ts](../../packages/fiscal-verifactu/src/classification.ts) |
| `sale_lines`            | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `sale_settlements`      | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `sale_substitutions`    | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `sale_voids`            | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `sales`                 | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `tenders`               | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `time_entries`          | [packages/workforce/src/classification.ts](../../packages/workforce/src/classification.ts)               |

## Writes confined to named files

The guard checks source text against the allowed files. It does not make the database refuse a
write and does not follow a request through its call chain. The exact table-set check retains
`node_roles` alongside these four historical names; it no longer imports the retired record.

| Table           | Allowed writers                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment`    | [packages/db/src/deployment.ts](../../packages/db/src/deployment.ts)                                                                                                                                                                                       |
| `mirror_config` | [packages/db/src/mirror-config.ts](../../packages/db/src/mirror-config.ts)                                                                                                                                                                                 |
| `nodes`         | [packages/db/src/node-identity.ts](../../packages/db/src/node-identity.ts), [packages/db/src/reserved-identity.ts](../../packages/db/src/reserved-identity.ts), [packages/provisioning/src/venue-apply.ts](../../packages/provisioning/src/venue-apply.ts) |
| `tenants`       | [packages/provisioning/src/taxpayer-name.ts](../../packages/provisioning/src/taxpayer-name.ts), [packages/provisioning/src/venue-apply.ts](../../packages/provisioning/src/venue-apply.ts)                                                                 |

## Tables absent from the migrated database

`contadores_instalacion` and `menu_sections` were absent from `sqlite_master` after all sets ran.
No restriction on those removed names needs transferring to a current table by assumption.

## Deliberate deletion paths

These four tables previously lacked `DELETE` in the record. Their current code contains a
purposeful deletion path. The checks above ran unchanged; the paths remain subject to their
existing reference, permission and retention checks.

| Table                        | Current path                                                                                                                                                                 | Check                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `dining_tables`              | Unused tables are physically removed after their references are released. [apps/server/src/table-removal.ts](../../apps/server/src/table-removal.ts)                         | [apps/server/src/table-removal.test.ts](../../apps/server/src/table-removal.test.ts)                                           |
| `kitchen_courses`            | Unreferenced courses are deleted; retained courses are disabled. [apps/server/src/course-delete.ts](../../apps/server/src/course-delete.ts)                                  | [apps/server/src/course-delete.test.ts](../../apps/server/src/course-delete.test.ts)                                           |
| `management_account_actions` | Issuing an account action prunes used or expired proofs of that purpose. [packages/identity/src/account-action.ts](../../packages/identity/src/account-action.ts)            | [packages/identity/src/account-action.test.ts](../../packages/identity/src/account-action.test.ts)                             |
| `zone_service_policies`      | Deleting a zone removes its owned policy configuration. [packages/venue-service/src/service-delete-settings.ts](../../packages/venue-service/src/service-delete-settings.ts) | [packages/venue-service/src/service-delete-settings.test.ts](../../packages/venue-service/src/service-delete-settings.test.ts) |

## Unresolved restrictions

Each table below has its own follow-up in [the backlog](../backlog.md). None is declared
`appendOnly()` or included in the write-path list. The trigger inventory contained no `DELETE`
trigger on any of these tables. Some have other restrictions, foreign keys or request checks;
this observation does not establish that a populated row can be removed through a product route.
Nor does it establish that the old restriction is still desirable. Decide that per table before
changing enforcement, keeping each legitimate mutation path.

| Table                    | Operations to review | Current declaration                                                                                      |
| ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `bookings`               | `DELETE`             | [packages/bookings/src/classification.ts](../../packages/bookings/src/classification.ts)                 |
| `cadenas`                | `DELETE`             | [packages/fiscal-verifactu/src/classification.ts](../../packages/fiscal-verifactu/src/classification.ts) |
| `card_readers`           | `DELETE`             | [packages/payments/src/classification.ts](../../packages/payments/src/classification.ts)                 |
| `catalogues`             | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `change_log`             | `UPDATE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `content_languages`      | `DELETE`             | [packages/catalogue/src/classification.ts](../../packages/catalogue/src/classification.ts)               |
| `convenio_config`        | `DELETE`             | [packages/workforce-es/src/classification.ts](../../packages/workforce-es/src/classification.ts)         |
| `daily_close_chain`      | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `departments`            | `DELETE`             | [packages/venue-service/src/classification.ts](../../packages/venue-service/src/classification.ts)       |
| `devices`                | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `drawer_opens`           | `UPDATE`, `DELETE`   | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `employments`            | `DELETE`             | [packages/workforce/src/classification.ts](../../packages/workforce/src/classification.ts)               |
| `envio_flujo`            | `DELETE`             | [packages/fiscal-verifactu/src/classification.ts](../../packages/fiscal-verifactu/src/classification.ts) |
| `envios`                 | `DELETE`             | [packages/fiscal-verifactu/src/classification.ts](../../packages/fiscal-verifactu/src/classification.ts) |
| `floor_zones`            | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `incidents`              | `UPDATE`, `DELETE`   | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `ingredients`            | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `invoice_series`         | `UPDATE`, `DELETE`   | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `join_requests`          | `UPDATE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `kitchen_stations`       | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `location_catalogues`    | `UPDATE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `locations`              | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `management_sessions`    | `DELETE`             | [packages/identity/src/classification.ts](../../packages/identity/src/classification.ts)                 |
| `menu_items`             | `DELETE`             | [packages/catalogue/src/classification.ts](../../packages/catalogue/src/classification.ts)               |
| `media_image_data`       | `UPDATE`, `DELETE`   | [packages/media/src/module.ts](../../packages/media/src/module.ts)                                       |
| `node_membership`        | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `payment_policy`         | `DELETE`             | [packages/payments/src/classification.ts](../../packages/payments/src/classification.ts)                 |
| `payment_refunds`        | `DELETE`             | [packages/payments/src/classification.ts](../../packages/payments/src/classification.ts)                 |
| `payments`               | `DELETE`             | [packages/payments/src/classification.ts](../../packages/payments/src/classification.ts)                 |
| `persons`                | `DELETE`             | [packages/identity/src/classification.ts](../../packages/identity/src/classification.ts)                 |
| `print_agents`           | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `print_jobs`             | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `printers`               | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `products`               | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `registro_sif`           | `DELETE`             | [packages/fiscal-verifactu/src/classification.ts](../../packages/fiscal-verifactu/src/classification.ts) |
| `scheduled_runs`         | `DELETE`             | [packages/scheduler/src/classification.ts](../../packages/scheduler/src/classification.ts)               |
| `sessions`               | `DELETE`             | [packages/identity/src/classification.ts](../../packages/identity/src/classification.ts)                 |
| `station_printers`       | `UPDATE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `table_service_statuses` | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `tenant_receipts`        | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `tenant_themes`          | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `ticket_items`           | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |
| `workforce_chains`       | `DELETE`             | [packages/workforce/src/classification.ts](../../packages/workforce/src/classification.ts)               |
| `working_order_counters` | `DELETE`             | [packages/db/src/classification.ts](../../packages/db/src/classification.ts)                             |

**2026-10-19:** `table_service_statuses` was dropped by A757 slice 2; its row needs no decision.

For `invoice_series`, inspect column-scoped updates and allocation separately; do not infer that
number allocation should stop updating its counter. For `media_image_data`, deletion through the
image's cascading foreign key is intentional (`packages/media/src/schema/images.ts`); the old
no-`UPDATE` restriction still needs a decision. For `incidents`, acknowledge/resolve updates are
real writes (`packages/core/src/incidents.ts`); the record cannot specify which columns may change.
Fiscal and working-time chain entries here are follow-ups only, with no authority to change their
invariants in this maintenance item.

Historical specs and plans retain their dated references to the removed record. For current
protections, use the declarations and the write-path guard rather than those references.
