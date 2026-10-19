# A760 migration inventory appendix

Pinned tree: `13bb9ec1aa4d49eac4903c22b90b39c560085c93`, 16 October 2026. Read this with the [operator procedure](2026-10-16-a760-migration-squash.md). Refresh it at the execution freeze; it does not cover later merges.

## What was run

Raw receipts are local at `/Users/clintongormley/waitron-campaign-g/receipts/a760/`. These are inventory probes, not the later equality helper or a squash rehearsal. No generator ran. All database files were made with `mkdtemp` outside the repository. Connections were closed.

- `node .../inspect-current.mjs`: applied all journal-listed SQL in manifest order with `node:sqlite`, Node v26.11.1, foreign keys ON, one transaction per set. `current-sql.json` records every statement, its source, every surviving table/index/trigger, columns, foreign keys, index detail and rows. There are 302 journal entries across 15 sets, 210 tables (209 product tables plus SQLite’s `sqlite_sequence`), 252 explicit indexes and 40 SQL-defined triggers. Every table had zero rows; `integrity_check` returned `ok`; `foreign_key_check` returned no rows. This raw path does not install append-only or change-feed triggers.
- `apps/server/node_modules/.bin/tsx .../inspect-runtime.mjs`: called the real `applyMigrations`, `orderedMigrationSets`, `migrationOptionsFor`, `openVenueDatabase` and `installChangeFeed`, once for each fiscal composition. Each selected 14 sets and 187 change sources. Veri*Factu had 96 triggers after migration and 657 after the feed; fiscal-none had 86 and 647. Each reported `foreign_keys=1`, `recursive_triggers=1`, `integrity_check=ok`, and no foreign-key violations. `runtime.json` retains exact source descriptors and trigger SQL, including creation row ids. No provisioning or server boot ran.
- `node .../omission-probe.mjs`: a scratch transaction dropped `working_orders_enforce_transition`, printed `MISSING trigger working_orders_enforce_transition, count=0`, then rolled back and read count 1. Quoting the incident expression as a column printed `no such column: case when "device_id" is null then '' else "device_id" end`; rollback restored two `cid=-2` expression entries. These controls distinguish presence from omission and a valid expression from the broken quoted form; they do not prove trigger behavior.
- A read-only Python pass compared every built CHECK name, index name and foreign-key count with the latest snapshots: 410 CHECK names and 252 explicit index names were represented, and all per-table FK counts agreed. No manual-only CHECK/index name or FK-count delta was found. This is name/count evidence, not equality of predicates, actions or expression bodies. The later comparison checks those.

Expected failures of the inventory application are a nonzero exit naming the set and SQL error, a non-`ok` integrity result, nonempty FK result, or missing runtime objects. An early draft probe assumed every set had a head entry and failed on fiscal-none; the retained probe handles its empty journal. The first `pnpm --filter ... exec` attempt changed working directory and failed; the direct installed `tsx` invocation above is the completed run.

The completed authoring commands, from this plan worktree, were:

```bash
node /Users/clintongormley/waitron-campaign-g/receipts/a760/inspect-current.mjs
apps/server/node_modules/.bin/tsx /Users/clintongormley/waitron-campaign-g/receipts/a760/inspect-runtime.mjs
node /Users/clintongormley/waitron-campaign-g/receipts/a760/omission-probe.mjs
python3 /Users/clintongormley/waitron-campaign-g/receipts/a760/snapshot-audit.py
python3 /Users/clintongormley/waitron-campaign-g/receipts/a760/key-index-audit.py
```

These local probe files are receipts, not a maintained tool interface. The two audit commands
reported `CHECK bodies: 410 deltas: 0` and `FK table definitions: 209 index definitions: 252 deltas: 0`.
The source SQL paths in their reports are tied to the pinned head. Re-run inventory at execution;
do not treat a local receipt path as a CI dependency.

## Set inventory

Manifest order and names come from `packages/migrations/migrations.manifest.json:1`. Keep every set name, journal-table name, descriptor and dependency. Keep the zero-entry fiscal-none journal unchanged: it has no SQL to squash.

| Set / folder | Entries | Last tag | Maximum `when` | Built tables / indexes / CHECKs |
| --- | ---: | --- | ---: | --- |
| `core` / `packages/db/drizzle` | 160 | `0159_furry_beyonder` | 1792097805142 | 89 / 109 / 162 |
| `catalogue` / `packages/catalogue/drizzle` | 33 | `0032_content_suggestions` | 1792033764941 | 22 / 28 / 29 |
| `venue-service` / `packages/venue-service/drizzle` | 55 | `0054_kitchen_note_changes` | 1792106418853 | 38 / 32 / 62 |
| `media` / `packages/media/drizzle` | 10 | `0009_include_folder_image_references` | 1791385312943 | 2 / 2 / 2 |
| `identity` / `packages/identity/drizzle` | 8 | `0007_profile_admission` | 1791292222285 | 11 / 14 / 24 |
| `workforce` / `packages/workforce/drizzle` | 10 | `0009_real_lockheed` | 1792088445089 | 17 / 28 / 64 |
| `workforce-es` / `packages/workforce-es/drizzle` | 1 | `0000_baseline` | 1789995581631 | 1 / 1 / 2 |
| `payments` / `packages/payments/drizzle` | 8 | `0007_card_reader_delete` | 1791655198883 | 8 / 12 / 13 |
| `scheduler` / `packages/scheduler/drizzle` | 1 | `0000_baseline` | 1789995448043 | 1 / 1 / 4 |
| `credentials` / `packages/credentials/drizzle` | 1 | `0000_baseline` | 1789995446571 | 1 / 0 / 4 |
| `fiscal-verifactu` / `packages/fiscal-verifactu/drizzle` | 7 | `0006_numerous_roughhouse` | 1791982563250 | 10 / 15 / 18 |
| `fiscal-none` / `packages/fiscal-none/drizzle` | 0 | `(none)` | (none) | 0 / 0 / 0 |
| `bookings` / `packages/bookings/drizzle` | 2 | `0001_yummy_rage` | 1791602357010 | 1 / 2 / 2 |
| `adjustments` / `packages/adjustments/drizzle` | 4 | `0003_comped_extras` | 1790805988482 | 3 / 2 / 16 |
| `staffing` / `packages/staffing/drizzle` | 2 | `0001_staffing_days_blocks_assignments` | 1791954041439 | 5 / 6 / 8 |

## Exported descriptors and dependencies

Each package descriptor still resolves `../drizzle` from its own module URL; the bundle must use `migrationOptionsFor`, not those collapsed source URLs. Keep the following descriptor constants, tracking-table names and requires declarations. All descriptor locations below are source readings. `packages/composition/src/modules.ts:106` supplies the composition declarations except media, whose home is `packages/media/src/module.ts:26`.

| Set | Export and declaration | Tracking table | Required sets |
| --- | --- | --- | --- |
| `core` | `CORE_MIGRATIONS` at `packages/db/src/migrations.ts:16` | `__drizzle_migrations_db` | (none) |
| `catalogue` | `CATALOGUE_MIGRATIONS` at `packages/catalogue/src/migrations.ts:9` | `__drizzle_migrations_catalogue` | core |
| `venue-service` | `VENUE_SERVICE_MIGRATIONS` at `packages/venue-service/src/migrations.ts:5` | `__drizzle_migrations_venue_service` | core, catalogue |
| `media` | `MEDIA_MIGRATIONS` at `packages/media/src/migrations.ts:3` | `__drizzle_migrations_media` | core, catalogue, venue-service |
| `identity` | `IDENTITY_MIGRATIONS` at `packages/identity/src/migrations.ts:6` | `__drizzle_migrations_identity` | core |
| `workforce` | `WORKFORCE_MIGRATIONS` at `packages/workforce/src/migrations.ts:9` | `__drizzle_migrations_workforce` | core, identity |
| `workforce-es` | `WORKFORCE_ES_MIGRATIONS` at `packages/workforce-es/src/migrations.ts:7` | `__drizzle_migrations_workforce_es` | core |
| `payments` | `PAYMENTS_MIGRATIONS` at `packages/payments/src/migrations.ts:5` | `__drizzle_migrations_payments` | core |
| `scheduler` | `SCHEDULER_MIGRATIONS` at `packages/scheduler/src/migrations.ts:3` | `__drizzle_migrations_scheduler` | core |
| `credentials` | `CREDENTIALS_MIGRATIONS` at `packages/credentials/src/migrations.ts:8` | `__drizzle_migrations_credentials` | core |
| `fiscal-verifactu` | `FISCAL_MIGRATIONS` at `packages/fiscal-verifactu/src/migrations.ts:9` | `__drizzle_migrations_fiscal` | core |
| `fiscal-none` | `FISCAL_NONE_MIGRATIONS` at `packages/fiscal-none/src/migrations.ts:8` | `__drizzle_migrations_fiscal_none` | core |
| `bookings` | `BOOKINGS_MIGRATIONS` at `packages/bookings/src/migrations.ts:3` | `__drizzle_migrations_bookings` | core |
| `adjustments` | `ADJUSTMENTS_MIGRATIONS` at `packages/adjustments/src/migrations.ts:5` | `__drizzle_migrations_adjustments` | core |
| `staffing` | `STAFFING_MIGRATIONS` at `packages/staffing/src/migrations.ts:5` | `__drizzle_migrations_staffing` | core, identity, venue-service, workforce |

## Surviving SQL that generation does not model

The raw final database carries 25 core and 15 media manual triggers; no other set contributes a SQL-defined trigger. Carry only the final definitions below. For each row, take the complete stored `CREATE TRIGGER` from the old fresh database, including every `WHEN`, statement, message, column list and table reference. Put it in its owning set’s **same** `0000_baseline.sql`, after generated schema objects. Preserve relative creation order from `sqlite_schema.rowid` for triggers on the same table. Do not replay the whole source file: it may contain old definitions, drop/rebuild wrappers or unrelated historical changes. Source locations below identify the creation statement; later `ALTER TABLE` operations can rewrite its stored text, so the captured final text is the equality reference.

| Owning set | Trigger / target table | Final creation source | Carry |
| --- | --- | --- | --- |
| `core` | `bill_payment_refunds_guard_update` / `bill_payment_refunds` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:1` | Final stored body, verbatim |
| `core` | `bill_payment_refunds_no_delete` / `bill_payment_refunds` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:38` | Final stored body, verbatim |
| `core` | `bill_payments_guard_update` / `bill_payments` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:45` | Final stored body, verbatim |
| `core` | `bill_payments_no_delete` / `bill_payments` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:81` | Final stored body, verbatim |
| `core` | `device_profile_form_factor_locked` / `device_profiles` | `packages/db/drizzle/0124_devices_recreate_form_factor_trigger.sql:2` | Final stored body, verbatim |
| `media` | `menu_version_images_media_image_fk_insert` / `menu_version_images` | `packages/media/drizzle/0005_photo_name_only.sql:130` | Final stored body, verbatim |
| `media` | `menu_version_images_media_image_fk_parent_delete` / `media_images` | `packages/media/drizzle/0008_queued_edition_image_references.sql:4` | Final stored body, verbatim |
| `media` | `menu_version_images_media_image_fk_parent_rename` / `media_images` | `packages/media/drizzle/0008_queued_edition_image_references.sql:23` | Final stored body, verbatim |
| `core` | `parties_clear_table_status` / `parties` | `packages/db/drizzle/0139_floor_retire_recreate_table_triggers.sql:2` | Final stored body, verbatim |
| `core` | `products_id_fixed_update` / `products` | `packages/db/drizzle/0061_recreate_product_triggers.sql:23` | Final stored body, verbatim |
| `media` | `products_media_image_fk_insert` / `products` | `packages/media/drizzle/0007_recreate_product_image_triggers.sql:4` | Final stored body, verbatim |
| `media` | `products_media_image_fk_parent_delete` / `media_images` | `packages/media/drizzle/0007_recreate_product_image_triggers.sql:26` | Final stored body, verbatim |
| `media` | `products_media_image_fk_parent_rename` / `media_images` | `packages/media/drizzle/0007_recreate_product_image_triggers.sql:36` | Final stored body, verbatim |
| `media` | `products_media_image_fk_update` / `products` | `packages/media/drizzle/0007_recreate_product_image_triggers.sql:15` | Final stored body, verbatim |
| `core` | `products_ordering_check_insert` / `products` | `packages/db/drizzle/0061_recreate_product_triggers.sql:31` | Final stored body, verbatim |
| `core` | `products_ordering_check_update` / `products` | `packages/db/drizzle/0061_recreate_product_triggers.sql:39` | Final stored body, verbatim |
| `core` | `products_variant_one_level_insert` / `products` | `packages/db/drizzle/0061_recreate_product_triggers.sql:2` | Final stored body, verbatim |
| `core` | `products_variant_parent_fixed_update` / `products` | `packages/db/drizzle/0061_recreate_product_triggers.sql:15` | Final stored body, verbatim |
| `core` | `sale_settlements_check_coverage` / `sale_settlements` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:88` | Final stored body, verbatim |
| `media` | `section_members_media_image_fk_insert` / `section_members` | `packages/media/drizzle/0009_include_folder_image_references.sql:4` | Final stored body, verbatim |
| `media` | `section_members_media_image_fk_parent_delete` / `media_images` | `packages/media/drizzle/0009_include_folder_image_references.sql:26` | Final stored body, verbatim |
| `media` | `section_members_media_image_fk_parent_rename` / `media_images` | `packages/media/drizzle/0009_include_folder_image_references.sql:36` | Final stored body, verbatim |
| `media` | `section_members_media_image_fk_update` / `section_members` | `packages/media/drizzle/0009_include_folder_image_references.sql:15` | Final stored body, verbatim |
| `media` | `sections_media_image_fk_insert` / `sections` | `packages/media/drizzle/0005_photo_name_only.sql:95` | Final stored body, verbatim |
| `media` | `sections_media_image_fk_parent_delete` / `media_images` | `packages/media/drizzle/0005_photo_name_only.sql:113` | Final stored body, verbatim |
| `media` | `sections_media_image_fk_parent_rename` / `media_images` | `packages/media/drizzle/0005_photo_name_only.sql:121` | Final stored body, verbatim |
| `media` | `sections_media_image_fk_update` / `sections` | `packages/media/drizzle/0005_photo_name_only.sql:104` | Final stored body, verbatim |
| `core` | `tenders_reject_post_settlement` / `tenders` | `packages/db/drizzle/0001_behavioural_triggers.sql:63` | Final stored body, verbatim |
| `core` | `working_order_lines_check_locales_insert` / `working_order_lines` | `packages/db/drizzle/0110_printing_retirement_restore_readers.sql:1` | Final stored body, verbatim |
| `core` | `working_order_lines_check_locales_update` / `working_order_lines` | `packages/db/drizzle/0110_printing_retirement_restore_readers.sql:29` | Final stored body, verbatim |
| `core` | `working_order_lines_check_variant_locales_insert` / `working_order_lines` | `packages/db/drizzle/0110_printing_retirement_restore_readers.sql:58` | Final stored body, verbatim |
| `core` | `working_order_lines_check_variant_locales_update` / `working_order_lines` | `packages/db/drizzle/0110_printing_retirement_restore_readers.sql:91` | Final stored body, verbatim |
| `core` | `working_order_lines_require_open_parent_delete` / `working_order_lines` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:224` | Final stored body, verbatim |
| `core` | `working_order_lines_require_open_parent_insert` / `working_order_lines` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:234` | Final stored body, verbatim |
| `core` | `working_order_lines_require_open_parent_update` / `working_order_lines` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:244` | Final stored body, verbatim |
| `core` | `working_orders_enforce_transition` / `working_orders` | `packages/db/drizzle/0143_working_order_receipt_locale_transition.sql:3` | Final stored body, verbatim |
| `core` | `working_orders_invoice_type_insert` / `working_orders` | `packages/db/drizzle/0104_bill_invoice_choice_transition.sql:79` | Final stored body, verbatim |
| `core` | `working_orders_invoice_type_update` / `working_orders` | `packages/db/drizzle/0104_bill_invoice_choice_transition.sql:87` | Final stored body, verbatim |
| `core` | `working_orders_release_main_bill` / `working_orders` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:414` | Final stored body, verbatim |
| `core` | `working_orders_release_main_bill_on_move` / `working_orders` | `packages/db/drizzle/0097_operator_script_restore_triggers.sql:422` | Final stored body, verbatim |

**2026-10-19 (A757 slice 2):** `parties_clear_table_status` was dropped by core 0180; a squash leaves it out.

### Expression indexes

These five expressions survive. All five are represented in head snapshots, so they are not manual-only additions. They still need explicit attention: preserve the complete expression, collation/order and partial `WHERE`, and compare `pragma_index_xinfo` plus stored SQL. Generate fresh rather than rebuilding a table; if the generator changes the spelling or column order, the preservation pass aligns its SQL with the old fresh object without editing snapshots. Do not add a second migration for an expression.

| Index | Current creation source | Exact stored definition |
| --- | --- | --- |
| `incidents_open_dedup` | `packages/db/drizzle/0096_operator_script_restore_incident_index.sql:1` | ``CREATE UNIQUE INDEX `incidents_open_dedup` ON `incidents` (`source`,case when "device_id" is null then '' else "device_id" end,`code`,case when "sale_id" is null then '' else "sale_id" end) WHERE "incidents"."acknowledged_at" is null`` |
| `persons_tenant_pending_email_uq` | `packages/identity/drizzle/0001_person_case_fold.sql:9` | ``CREATE UNIQUE INDEX `persons_tenant_pending_email_uq` ON `persons` (case when "pending_email_folded" is null then lower("pending_email") else "pending_email_folded" end) WHERE "persons"."pending_email" is not null`` |
| `persons_tenant_live_display_name_uq` | `packages/identity/drizzle/0001_person_case_fold.sql:8` | ``CREATE UNIQUE INDEX `persons_tenant_live_display_name_uq` ON `persons` (case when "display_name_folded" is null then lower(trim("display_name")) else "display_name_folded" end) WHERE "persons"."status" <> 'suspended'`` |
| `persons_tenant_email_uq` | `packages/identity/drizzle/0001_person_case_fold.sql:7` | ``CREATE UNIQUE INDEX `persons_tenant_email_uq` ON `persons` (case when "email_folded" is null then lower("email") else "email_folded" end) WHERE "persons"."email" is not null`` |
| `section_members_folder_image_idx` | `packages/catalogue/drizzle/0030_include_folder_image_index.sql:1` | ``CREATE INDEX `section_members_folder_image_idx` ON `section_members` ("folder_overrides" ->> '$.image') WHERE "section_members"."folder_overrides" ->> '$.image' is not null`` |

### CHECKs, foreign keys, seeded rows and other SQL

The per-set counts above account for all 410 named CHECKs in the raw database. Their bodies are retained in `current-sql.json` under `objects` and in the corresponding head snapshot’s `tables[*].checkConstraints`. The later `snapshot-audit.py` probe extracted all 410 final CHECK bodies and compared them with snapshot predicates while ignoring only whitespace between tokens: zero deltas (`snapshot-audit.json`, `.log`). No surviving manual-only CHECK body was identified in this measured tree. Generate them from unchanged schema declarations, then compare exact tokenized predicates and offending/accepting writes where existing suites provide them. A matching name alone is insufficient. A second `key-index-audit.py` probe compared all 209 product tables’ FK tuples (parent, ordered columns, update/delete actions) and all 252 explicit indexes’ columns/expressions, uniqueness and partial predicates with head snapshots: zero deltas (`key-index-audit.json`, `.log`). It does not compare collation/order flags, defaults, PKs or generated columns; the later full equality contract covers those too.

The raw SQL application left no rows in any of the 210 tables. The statement scan found no top-level INSERT/UPDATE without a SELECT; rebuild copies and catalogue/media save-and-restore copies produced no fresh seeds. There are no views in that raw result. Preserve this empty state; do not copy test/demo records, rebuild staging tables or data-conversion operations into the baseline. Provisioning seeds are a separate layer: `packages/catalogue/src/provisioning.ts:51` seeds settings, languages, unit seed state, five units and the menu shell; `packages/venue-service/src/provisioning.ts:16` seeds departments/zones/policies/settings; `packages/adjustments/src/provisioning.ts:9` seeds its settings; `packages/fiscal-verifactu/src/provisioning.ts:8` delegates fiscal allocation seeding. Leave these source files unchanged and compare their resulting rows in the later controlled provisioning checks. No provisioning-seed experiment ran during authoring.

The deliberately omitted media foreign keys remain omitted. `scripts/schema-constraints.test.ts:25` names `products.image` and `sections.image`; `packages/media/drizzle/0001_image_references.sql:1` explains the dependency loop. Products, sections, published/queued menu version image references and folder JSON image references are enforced by the fifteen media triggers in the table above, not by newly added SQL FKs. Department-logo usage is a separate application query (`packages/media/src/images.ts:239`), not one of these SQL trigger bodies. Keep media’s venue-service descriptor dependency for that reader (`packages/media/src/module.ts:30`). Adding a native FK during squash would change the schema and package dependency graph. Preserve that omission and the trigger bodies together.

## Runtime append-only triggers

Each row below means both `<table>_append_only_update` and `<table>_append_only_delete`. Keep `appendOnly()` declarations and manifest arrays unchanged. The installer, `packages/store/src/append-only.ts:58` and `:68`, creates their exact definitions after each migrated set (`packages/migrations/src/apply.ts:74`). Do **not** paste these runtime triggers into SQL. Compare their installed bodies on both compositions, including `recursive_triggers=1`.

| Set | Table | Declaration source |
| --- | --- | --- |
| `core` | `sales` | `packages/db/src/classification.ts:17` |
| `core` | `sale_lines` | `packages/db/src/classification.ts:18` |
| `core` | `tenders` | `packages/db/src/classification.ts:19` |
| `core` | `sale_settlements` | `packages/db/src/classification.ts:20` |
| `core` | `sale_voids` | `packages/db/src/classification.ts:21` |
| `core` | `sale_substitutions` | `packages/db/src/classification.ts:22` |
| `core` | `receipt_reprints` | `packages/db/src/classification.ts:24` |
| `core` | `invoice_pdf_downloads` | `packages/db/src/classification.ts:29` |
| `core` | `daily_closes` | `packages/db/src/classification.ts:35` |
| `core` | `membership_removals` | `packages/db/src/classification.ts:44` |
| `core` | `membership_clearances` | `packages/db/src/classification.ts:49` |
| `core` | `bill_payment_lines` | `packages/db/src/classification.ts:59` |
| `core` | `unpaid_departures` | `packages/db/src/classification.ts:69` |
| `core` | `order_amendments` | `packages/db/src/classification.ts:145` |
| `core` | `order_group_events` | `packages/db/src/classification.ts:182` |
| `core` | `order_draft_events` | `packages/db/src/classification.ts:197` |
| `catalogue` | `menu_versions` | `packages/catalogue/src/classification.ts:26` |
| `catalogue` | `menu_version_images` | `packages/catalogue/src/classification.ts:31` |
| `venue-service` | `sale_receipt_headers` | `packages/venue-service/src/classification.ts:17` |
| `workforce` | `time_entries` | `packages/workforce/src/classification.ts:12` |
| `workforce` | `pay_period_closures` | `packages/workforce/src/classification.ts:13` |
| `payments` | `payment_resolutions` | `packages/payments/src/classification.ts:14` |
| `fiscal-verifactu` | `registros_facturacion` | `packages/fiscal-verifactu/src/classification.ts:6` |
| `fiscal-verifactu` | `filing_cases` | `packages/fiscal-verifactu/src/classification.ts:7` |
| `fiscal-verifactu` | `filing_case_events` | `packages/fiscal-verifactu/src/classification.ts:8` |
| `fiscal-verifactu` | `fiscal_allocations` | `packages/fiscal-verifactu/src/classification.ts:9` |
| `fiscal-verifactu` | `fiscal_reservations` | `packages/fiscal-verifactu/src/classification.ts:10` |
| `adjustments` | `adjustments` | `packages/adjustments/src/classification.ts:11` |

## Runtime change-feed bodies

These 187 source rows were obtained by importing today’s descriptors, not inferred from migration SQL. Each row expands to exactly three `waitron_change_<table>_{insert,update,delete}` triggers through `packages/db/src/change-feed.ts:103`. The update body emits old then new resources only when a column changes; retain resource types, related identities and the complete live column list. Installation is at `apps/server/src/boot.ts:1425`; migration removes the feed first (`packages/migrations/src/apply.ts:65`). No feed trigger belongs in baseline SQL. Sources are identical between the two measured fiscal compositions. Empty lists for fiscal-verifactu, fiscal-none, scheduler and credentials mean no feed triggers from those sets.

| Table | Resource type / related column:type | Source |
| --- | --- | --- |
| `sales` | `sales` | `packages/db/src/classification.ts:17` |
| `sale_lines` | `sale_lines` | `packages/db/src/classification.ts:18` |
| `tenders` | `tenders` | `packages/db/src/classification.ts:19` |
| `sale_settlements` | `sale_settlements` | `packages/db/src/classification.ts:20` |
| `sale_voids` | `sale_voids` | `packages/db/src/classification.ts:21` |
| `sale_substitutions` | `sale_substitutions` | `packages/db/src/classification.ts:22` |
| `receipt_reprints` | `receipt_reprints` | `packages/db/src/classification.ts:24` |
| `invoice_pdf_downloads` | `invoice_pdf_downloads` | `packages/db/src/classification.ts:29` |
| `ticket_items` | `ticket_items` | `packages/db/src/classification.ts:33` |
| `drawer_opens` | `drawer_opens` | `packages/db/src/classification.ts:34` |
| `daily_closes` | `daily_closes` | `packages/db/src/classification.ts:35` |
| `daily_close_chain` | `daily_close_chain` | `packages/db/src/classification.ts:37` |
| `purchase_invoices` | `purchase_invoices` | `packages/db/src/classification.ts:41` |
| `purchase_invoice_vat` | `purchase_invoice_vat` | `packages/db/src/classification.ts:42` |
| `membership_removals` | `membership_removals` | `packages/db/src/classification.ts:44` |
| `membership_clearances` | `membership_clearances` | `packages/db/src/classification.ts:49` |
| `bill_payments` | `bill_payments` | `packages/db/src/classification.ts:54` |
| `bill_payment_lines` | `bill_payment_lines` | `packages/db/src/classification.ts:59` |
| `bill_payment_refunds` | `bill_payment_refunds` | `packages/db/src/classification.ts:64` |
| `unpaid_departures` | `unpaid_departures` | `packages/db/src/classification.ts:69` |
| `working_order_counters` | `working_order_counters` | `packages/db/src/classification.ts:76` |
| `tenants` | `tenants` | `packages/db/src/classification.ts:80` |
| `locations` | `locations` | `packages/db/src/classification.ts:81` |
| `location_business_day_settings` | `location_business_day_settings` | `packages/db/src/classification.ts:82` |
| `location_day_cutover_changes` | `location_day_cutover_changes` | `packages/db/src/classification.ts:83` |
| `nodes` | `nodes` | `packages/db/src/classification.ts:84` |
| `devices` | `devices` | `packages/db/src/classification.ts:85` |
| `device_made_here_stations` | `device_made_here_stations` | `packages/db/src/classification.ts:86` |
| `device_approved_profiles` | `device_approved_profiles` | `packages/db/src/classification.ts:87` |
| `device_profiles` | `device_profiles` | `packages/db/src/classification.ts:88` |
| `device_profile_printers` | `device_profile_printers` | `packages/db/src/classification.ts:89` |
| `printer_holders` | `printer_holders` | `packages/db/src/classification.ts:90` |
| `invoice_series` | `invoice_series` | `packages/db/src/classification.ts:91` |
| `catalogues` | `catalogues` | `packages/db/src/classification.ts:92` |
| `location_catalogues` | `location_catalogues` | `packages/db/src/classification.ts:93` |
| `categories` | `categories` | `packages/db/src/classification.ts:94` |
| `products` | `products` | `packages/db/src/classification.ts:95` |
| `ingredients` | `ingredients` | `packages/db/src/classification.ts:96` |
| `recipe_lines` | `recipe_lines` | `packages/db/src/classification.ts:97` |
| `floor_zones` | `floor_zones` | `packages/db/src/classification.ts:98` |
| `dining_tables` | `dining_tables` | `packages/db/src/classification.ts:99` |
| `floor_plans` | `floor_plans` | `packages/db/src/classification.ts:100` |
| `floor_plan_tables` | `floor_plan_tables` | `packages/db/src/classification.ts:101` |
| `floor_plan_table_parts` | `floor_plan_table_parts` | `packages/db/src/classification.ts:102` |
| `floor_plan_table_sizes` | `floor_plan_table_sizes` | `packages/db/src/classification.ts:103` |
| `floor_reset_tables` | `floor_reset_tables` | `packages/db/src/classification.ts:104` |
| `floor_reset_table_parts` | `floor_reset_table_parts` | `packages/db/src/classification.ts:105` |
| `floor_today_zones` | `floor_today_zones` | `packages/db/src/classification.ts:106` |
| `floor_today_tables` | `floor_today_tables` | `packages/db/src/classification.ts:107` |
| `floor_today_joins` | `floor_today_joins` | `packages/db/src/classification.ts:108` |
| `floor_today_join_tables` | `floor_today_join_tables` | `packages/db/src/classification.ts:109` |
| `floor_today_split_parts` | `floor_today_split_parts` | `packages/db/src/classification.ts:110` |
| `table_service_statuses` | `table_service_statuses` | `packages/db/src/classification.ts:112` |
| `kitchen_stations` | `kitchen_stations` | `packages/db/src/classification.ts:116` |
| `kitchen_timing_defaults` | `kitchen_timing_defaults` | `packages/db/src/classification.ts:117` |
| `kitchen_station_timing` | `kitchen_station_timing` | `packages/db/src/classification.ts:118` |
| `kitchen_courses` | `kitchen_courses` | `packages/db/src/classification.ts:119` |
| `station_printers` | `station_printers` | `packages/db/src/classification.ts:120` |
| `pass_item_marks` | `pass_item_marks` | `packages/db/src/classification.ts:122` |
| `ticket_item_moves` | `ticket_item_moves` | `packages/db/src/classification.ts:127` |
| `printers` | `printers` | `packages/db/src/classification.ts:131` |
| `page_printers` | `page_printers` | `packages/db/src/classification.ts:132` |
| `print_agents` | `print_agents` | `packages/db/src/classification.ts:133` |
| `canvases` | `canvases` | `packages/db/src/classification.ts:134` |
| `tenant_themes` | `tenant_themes` | `packages/db/src/classification.ts:135` |
| `tenant_receipts` | `tenant_receipts` | `packages/db/src/classification.ts:136` |
| `incidents` | `incidents` | `packages/db/src/classification.ts:137` |
| `working_orders` | `working_orders` | `packages/db/src/classification.ts:138` |
| `working_order_lines` | `working_order_lines` | `packages/db/src/classification.ts:140` |
| `order_amendments` | `order_amendments` | `packages/db/src/classification.ts:145` |
| `print_jobs` | `print_jobs` / `printer_id:printers` | `packages/db/src/classification.ts:149` |
| `invoice_deliveries` | `invoice_deliveries` | `packages/db/src/classification.ts:151` |
| `kitchen_print_job_lines` | `kitchen_print_job_lines` | `packages/db/src/classification.ts:156` |
| `kitchen_print_jobs` | `kitchen_print_jobs` | `packages/db/src/classification.ts:161` |
| `parties` | `parties` | `packages/db/src/classification.ts:165` |
| `party_tables` | `party_tables` | `packages/db/src/classification.ts:167` |
| `service_commands` | `service_commands` | `packages/db/src/classification.ts:172` |
| `order_groups` | `order_groups` | `packages/db/src/classification.ts:177` |
| `order_group_events` | `order_group_events` | `packages/db/src/classification.ts:182` |
| `order_drafts` | `order_drafts` | `packages/db/src/classification.ts:187` |
| `order_draft_lines` | `order_draft_lines` | `packages/db/src/classification.ts:192` |
| `order_draft_events` | `order_draft_events` | `packages/db/src/classification.ts:197` |
| `deployment` | `deployment` | `packages/db/src/classification.ts:204` |
| `node_membership` | `node_membership` | `packages/db/src/classification.ts:209` |
| `node_roles` | `node_roles` | `packages/db/src/classification.ts:215` |
| `mirror_config` | `mirror_config` | `packages/db/src/classification.ts:217` |
| `join_requests` | `join_requests` | `packages/db/src/classification.ts:222` |
| `category_details` | `category_details` | `packages/catalogue/src/classification.ts:9` |
| `catalogue_settings` | `catalogue_settings` | `packages/catalogue/src/classification.ts:10` |
| `content_languages` | `content_languages` | `packages/catalogue/src/classification.ts:11` |
| `unit_seed_states` | `unit_seed_states` | `packages/catalogue/src/classification.ts:12` |
| `units` | `units` | `packages/catalogue/src/classification.ts:13` |
| `product_units` | `product_units` | `packages/catalogue/src/classification.ts:14` |
| `menu_items` | `menu_items` | `packages/catalogue/src/classification.ts:15` |
| `menu_item_variant_overrides` | `menu_item_variant_overrides` | `packages/catalogue/src/classification.ts:16` |
| `option_lists` | `option_lists` | `packages/catalogue/src/classification.ts:17` |
| `option_labels` | `option_labels` | `packages/catalogue/src/classification.ts:18` |
| `extra_lists` | `extra_lists` | `packages/catalogue/src/classification.ts:19` |
| `extra_list_items` | `extra_list_items` | `packages/catalogue/src/classification.ts:20` |
| `product_modifiers` | `product_modifiers` | `packages/catalogue/src/classification.ts:21` |
| `sections` | `sections` | `packages/catalogue/src/classification.ts:22` |
| `section_members` | `section_members` | `packages/catalogue/src/classification.ts:23` |
| `menu_details` | `menu_details` | `packages/catalogue/src/classification.ts:24` |
| `menu_versions` | `menu_versions` | `packages/catalogue/src/classification.ts:26` |
| `menu_version_images` | `menu_version_images` | `packages/catalogue/src/classification.ts:31` |
| `menu_publications` | `menu_publications` | `packages/catalogue/src/classification.ts:35` |
| `menu_scheduled_publications` | `menu_scheduled_publications` | `packages/catalogue/src/classification.ts:36` |
| `content_suggestion_jobs` | `content_suggestion_jobs` | `packages/catalogue/src/classification.ts:37` |
| `content_suggestions` | `content_suggestions` | `packages/catalogue/src/classification.ts:38` |
| `departments` | `departments` | `packages/venue-service/src/classification.ts:8` |
| `department_receipts` | `department_receipts` | `packages/venue-service/src/classification.ts:9` |
| `department_transfer_desks` | `department_transfer_desks` | `packages/venue-service/src/classification.ts:10` |
| `department_transfer_destinations` | `department_transfer_destinations` | `packages/venue-service/src/classification.ts:11` |
| `department_transfer_requests` | `department_transfer_requests` | `packages/venue-service/src/classification.ts:12` |
| `department_sale_policies` | `department_sale_policies` | `packages/venue-service/src/classification.ts:13` |
| `zone_service_policies` | `zone_service_policies` | `packages/venue-service/src/classification.ts:14` |
| `zone_extensions` | `zone_extensions` | `packages/venue-service/src/classification.ts:15` |
| `zone_sale_policies` | `zone_sale_policies` | `packages/venue-service/src/classification.ts:16` |
| `sale_receipt_headers` | `sale_receipt_headers` | `packages/venue-service/src/classification.ts:17` |
| `menu_periods` | `menu_periods` | `packages/venue-service/src/classification.ts:18` |
| `menu_period_staff_menus` | `menu_period_staff_menus` | `packages/venue-service/src/classification.ts:19` |
| `device_profile_service_access` | `device_profile_service_access` | `packages/venue-service/src/classification.ts:20` |
| `device_profile_zones` | `device_profile_zones` | `packages/venue-service/src/classification.ts:21` |
| `device_profile_kitchen_screens` | `device_profile_kitchen_screens` | `packages/venue-service/src/classification.ts:22` |
| `device_profile_kitchen_screen_stations` | `device_profile_kitchen_screen_stations` | `packages/venue-service/src/classification.ts:23` |
| `device_profile_kitchen_screen_zones` | `device_profile_kitchen_screen_zones` | `packages/venue-service/src/classification.ts:24` |
| `device_kitchen_screens` | `device_kitchen_screens` | `packages/venue-service/src/classification.ts:25` |
| `device_kitchen_screen_stations` | `device_kitchen_screen_stations` | `packages/venue-service/src/classification.ts:26` |
| `device_kitchen_screen_zones` | `device_kitchen_screen_zones` | `packages/venue-service/src/classification.ts:27` |
| `device_kitchen_screen_removals` | `device_kitchen_screen_removals` | `packages/venue-service/src/classification.ts:28` |
| `station_day_states` | `station_day_states` | `packages/venue-service/src/classification.ts:29` |
| `period_extensions` | `period_extensions` | `packages/venue-service/src/classification.ts:30` |
| `routing_cells` | `routing_cells` | `packages/venue-service/src/classification.ts:31` |
| `routing_cell_periods` | `routing_cell_periods` | `packages/venue-service/src/classification.ts:32` |
| `order_service_contexts` | `order_service_contexts` | `packages/venue-service/src/classification.ts:33` |
| `working_line_contexts` | `working_line_contexts` | `packages/venue-service/src/classification.ts:34` |
| `service_settings` | `service_settings` | `packages/venue-service/src/classification.ts:35` |
| `kitchen_notices` | `kitchen_notices` | `packages/venue-service/src/classification.ts:36` |
| `order_kitchen_notes` | `order_kitchen_notes` | `packages/venue-service/src/classification.ts:37` |
| `holiday_geographies` | `holiday_geographies` | `packages/venue-service/src/classification.ts:38` |
| `seasons` | `seasons` | `packages/venue-service/src/classification.ts:39` |
| `special_days` | `special_days` | `packages/venue-service/src/classification.ts:40` |
| `special_day_dates` | `special_day_dates` | `packages/venue-service/src/classification.ts:41` |
| `department_days` | `department_days` | `packages/venue-service/src/classification.ts:42` |
| `department_day_ranges` | `department_day_ranges` | `packages/venue-service/src/classification.ts:43` |
| `zone_days` | `zone_days` | `packages/venue-service/src/classification.ts:44` |
| `zone_day_ranges` | `zone_day_ranges` | `packages/venue-service/src/classification.ts:45` |
| `media_images` | `media_images` | `packages/media/src/module.ts:9` |
| `persons` | `persons` | `packages/identity/src/classification.ts:14` |
| `webauthn_credentials` | `webauthn_credentials` / `person_id:persons` | `packages/identity/src/classification.ts:21` |
| `device_profile_admission_roles` | `device_profile_admission_roles` | `packages/identity/src/classification.ts:51` |
| `device_profile_admission_persons` | `device_profile_admission_persons` | `packages/identity/src/classification.ts:56` |
| `time_entries` | `time_entries` | `packages/workforce/src/classification.ts:12` |
| `pay_period_closures` | `pay_period_closures` | `packages/workforce/src/classification.ts:13` |
| `pay_period_settings` | `pay_period_settings` | `packages/workforce/src/classification.ts:14` |
| `workforce_chains` | `workforce_chains` | `packages/workforce/src/classification.ts:16` |
| `employments` | `employments` | `packages/workforce/src/classification.ts:21` |
| `shifts` | `shifts` | `packages/workforce/src/classification.ts:22` |
| `shift_templates` | `shift_templates` | `packages/workforce/src/classification.ts:23` |
| `shift_swaps` | `shift_swaps` | `packages/workforce/src/classification.ts:24` |
| `absences` | `absences` | `packages/workforce/src/classification.ts:25` |
| `availability` | `availability` | `packages/workforce/src/classification.ts:26` |
| `roster_versions` | `roster_versions` | `packages/workforce/src/classification.ts:27` |
| `attendance_day_work` | `attendance_day_work` | `packages/workforce/src/classification.ts:29` |
| `attendance_source_state` | `attendance_source_state` | `packages/workforce/src/classification.ts:30` |
| `attendance_operation_facts` | `attendance_operation_facts` | `packages/workforce/src/classification.ts:31` |
| `attendance_questions` | `attendance_questions` | `packages/workforce/src/classification.ts:32` |
| `attendance_mail` | `attendance_mail` | `packages/workforce/src/classification.ts:33` |
| `attendance_response_commands` | `attendance_response_commands` | `packages/workforce/src/classification.ts:34` |
| `convenio_config` | `work_time_rules` | `packages/workforce-es/src/classification.ts:7` |
| `payments` | `payments` | `packages/payments/src/classification.ts:12` |
| `payment_refunds` | `payment_refunds` | `packages/payments/src/classification.ts:13` |
| `payment_resolutions` | `payment_resolutions` | `packages/payments/src/classification.ts:14` |
| `payment_policy` | `payment_policy` | `packages/payments/src/classification.ts:16` |
| `card_readers` | `card_readers` | `packages/payments/src/classification.ts:17` |
| `device_card_readers` | `device_card_readers` | `packages/payments/src/classification.ts:18` |
| `device_profile_card_readers` | `device_profile_card_readers` | `packages/payments/src/classification.ts:19` |
| `card_reader_holders` | `card_reader_holders` | `packages/payments/src/classification.ts:20` |
| `bookings` | `bookings` / `table_id:dining_tables` | `packages/bookings/src/classification.ts:10` |
| `adjustment_reasons` | `adjustment_reasons` | `packages/adjustments/src/classification.ts:6` |
| `adjustments` | `adjustments` | `packages/adjustments/src/classification.ts:11` |
| `adjustment_settings` | `adjustment_settings` | `packages/adjustments/src/classification.ts:16` |
| `staff_roles` | `staff_roles` | `packages/staffing/src/classification.ts:5` |
| `person_staff_roles` | `person_staff_roles` | `packages/staffing/src/classification.ts:6` |
| `staffing_days` | `staffing_days` | `packages/staffing/src/classification.ts:7` |
| `staffing_blocks` | `staffing_blocks` | `packages/staffing/src/classification.ts:8` |
| `shift_assignments` | `shift_assignments` | `packages/staffing/src/classification.ts:9` |

**2026-10-19 (A757 slice 2):** `table_service_statuses` was dropped by core 0181; a squash leaves it out.

## Removed and superseded material

The applied SQL, rather than a union of historical CREATE statements, determines survival. The following trigger names occurred in CREATE/DROP history and were absent at the end: `category_details_media_image_fk_insert`, `category_details_media_image_fk_update`, `category_details_media_image_fk_parent_delete`, `category_details_media_image_fk_parent_rename`, `device_binding_rule_insert`, `device_binding_rule_update`, `visits_clear_table_status`, `working_orders_clear_table_status`. Do not revive them. Category-image triggers are removed in catalogue `0013` / media `0004`; device binding is removed by core `0119`; party status supersedes the visit/tab forms in core `0020` / `0036`.

Likewise, omit all intermediate `__new_*` / `__keep_*` tables, ALTER/DROP/copy operations, save/restore wrappers around table rebuilds, old served/sent/handover transition bodies, retired printing/device-binding columns, old CHECK variants and old indexes dropped later. Keep the **final** bodies listed above, including the receipt-locale transition from core `0143`, not an earlier version carrying the same name. Media `0005` has manual byte-preservation wrappers around its generated rebuild; no such rebuild occurs in a fresh baseline, so keep its surviving trigger definitions but not the save/drop/copy history. `current-sql.json.statements` retains that history for audit.

## Migration history consumers and required treatment

The [procedure](2026-10-16-a760-migration-squash.md#adapt-the-history-consumers-before-generation) defines the changes. The searched inventory is in `history-consumers.txt` and `upgrade-consumers.txt`. Repeat the whole-tree search after freeze, including prose and SQL filenames. These source searches are not execution receipts.

| Consumer | Receipt / dependency | Treatment in the one squash PR |
| --- | --- | --- |
| Journal order and snapshots | `scripts/journal-monotonic.test.ts:7`, `packages/sync-enrolment/src/testing/migration-sets.ts:39` | Generator owns new journal/snapshot; retain synthetic non-monotonic and missing-snapshot controls. |
| SQL/schema drift guard | `scripts/migrations-match-schema.test.ts:14` | Keep snapshot comparison plus its missing-table/import/prompt controls; add applied-schema equality separately. |
| Main upgrade walk | `scripts/migration-upgrade.test.ts:63`, `:217`, `:344` | Replace retired floor and reset keys with explicit baseline epoch; future first entries run at their own date. Preserve row loss/refusal/acceptance controls. |
| Catalogue section ownership | `scripts/menu-sections-upgrade.test.ts:51`, `:133` | Preserve pre/post rows, published-menu bytes and rollback/negative controls using a test-only frozen predecessor/migration fixture. |
| Fiscal allocation upgrade | `scripts/fiscal-allocation-migration.test.ts:25` | Stop treating latest journal entry as the allocation change. Freeze its predecessor/target as test-only fixture; keep every fiscal row/journal/orphan assertion. Requires explicit guard/fiscal approval. |
| Kitchen timing | `packages/db/src/schema/kitchen-timing-upgrade.test.ts:26` | Freeze predecessor/target fixture; retain populated stations, mappings, FK and trigger equality assertions. |
| Append-only order-group rebuild | `packages/migrations/src/order-group-events-rebuild.test.ts:31` | Freeze predecessor/target fixture; keep event row equality and update/delete refusals, plus baseline-path checks. |
| Media photo name-only | `packages/media/src/schema/name-only-upgrade.test.ts:74` | Freeze predecessor/target fixture; keep bytes, metadata, references, rollback and omission controls. |
| Workforce record constraints | `packages/workforce/src/record-migration.test.ts:29` | Replace journal slice(0,4) with frozen predecessor/target fixture, preserving all refusal assertions. |
| Workforce attendance response | `packages/workforce/src/attendance-response-migration.test.ts:154` | Replace slice(0,8) with frozen predecessor/target fixture; preserve values, idempotence and unrelated-row assertions. |
| Retired role columns | `packages/staffing/src/role-retirement-upgrade.test.ts:77` | Read frozen test-only workforce `0009` target, not removed shipped file; retain both swap legs/assignments/template equality. |
| Department receipts | `packages/venue-service/src/department-receipts.upgrade.test.ts:26` | Freeze receipt predecessor/target fixture, retain populated-parent behavior. |
| Kitchen order notes | `packages/venue-service/src/order-kitchen-notes.upgrade.test.ts:28` | Freeze note predecessor/target fixture, retain rows and settings. |
| Printer pickup | `apps/server/src/printer-pickup-upgrade.test.ts:19` | Freeze old `0149` predecessor/target fixture, retain populated printing behavior. |
| Printing retirement snapshots | `apps/server/src/printing-retirement-upgrade.test.ts:34` | Existing `.db.gz` fixtures carry old hashes. Keep old migration-operation regression with frozen target, and separately assert current ahead check refuses them without mutation. |
| fiscal-none empty-count pin | `packages/fiscal-none/src/migrations.test.ts:15`, `packages/fiscal-none/src/migrations.ts:4`, `packages/fiscal-none/drizzle.config.ts:5` | Keep unchanged: zero journal rows, zero owned tables, existing empty-set assertions and prose. |
| Descriptor, manifest and options | `packages/composition/src/modules.ts:106`, `packages/media/src/module.ts:26`, `packages/module/src/module.ts:1362`, `packages/migrations/src/manifest.ts:114` | Retain names, requires, table names and append-only arrays; equality-check descriptor and manifest paths. |
| Schema versions / hashes / ahead check | `packages/migrations/src/schema-version.ts:28`, `packages/migrations/src/journal-hashes.ts:22`, `packages/provisioning/src/schema-ahead.ts:34` | Expected count becomes one per selected populated set and stays zero for fiscal-none. Preserve hash rejection and incomplete checks; never rewrite live journals. |
| Bundles/images | `apps/server/scripts/copy-migrations.mjs:17`, `deploy/Dockerfile:205`, `:258`, `.github/workflows/ci.yml:450` | Rebuild clean dist and image from candidate; enumerate/hash all 15 copies, not only core. |
| Backup/configuration module versions | `apps/server/src/backup-manifest.ts:19`, `apps/server/src/restore.ts:222`, `apps/server/src/restore-gate.ts:28`, `apps/server/src/configuration-transfer.ts:599`, `apps/server/src/cloud-snapshot-archive.ts:39` | Reprovision new epoch, preserve version-ahead/refusal semantics; old archives/buckets only for paired old-image rollback. |

Cloud was searched read-only at `da156a31c1dad5c0c33494798f734e612e6aba4f`. The exact-name/manifest search found historical Waitron SQL pointers in `docs/reference/2026-07-31-cloud-storage-model-design.md:111`, `:392`, `:399`. Its live `migrationNames` is declared in `packages/registration/src/migrate.ts:6` and reads Cloud’s `../migrations/` PostgreSQL files, not Waitron’s manifest. `deploy/local-stack/runtime.mjs:12` and `scripts/database-recovery-migrations.mjs:1` consume that Cloud list.

The dynamic consumers also matter. `packages/backups/src/waitron-verifier.ts:18` loads from a supplied checkout, then `packages/backups/src/waitron-verify-child.mjs:22` loads Waitron restore and modules; `:27` passes `migrationsRoot:null` to `validateArtifact`, and `:37` calls `writeValidated`. Waitron `apps/server/src/restore.ts:221` reads expected schema versions from those folders and `:281` applies them. Cloud `scripts/test-local-backups.mjs:257` also invokes Waitron's restore CLI with `WAITRON_MIGRATIONS_DIR` at `:287`.

Record each verifier checkout SHA and rehearsal migration root. Keep old archives paired with the old checkout/root; new-epoch qualification uses new fixtures and new roots. Hold this activity stopped when pairing is unknown. This dependency inspection is not a Cloud rehearsal result. No Cloud edit/reset is part of A760. Recheck active branches at freeze.
