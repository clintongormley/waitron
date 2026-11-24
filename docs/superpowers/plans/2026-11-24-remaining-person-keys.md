# Finish the remaining person ID foreign keys

After a fresh setup, the database should refuse to record a drawer open, invoice correction, PDF download, receipt reprint or handover against a person absent from the venue. Add only the eight marked keys below, under [design U11](../specs/2026-11-02-rationalisation/README.md#5-decisions-made-across-the-areas). Lane H lands under [slice rule 6](2026-11-08-a1308-slice-rules.md#6-who-lands). PR first line follows rule 2: “Every venue is reset: core; backups and exports from before this cannot be restored or imported.”

| Schema file under `packages/db/src/schema/` | Columns that gain a key |
| --- | --- |
| `drawer-opens.ts` | `person_id`, `authorized_by` |
| `handover/activations.ts` | `person_id` |
| `invoice-corrections.ts` | `requested_by`, `authorized_by`, `ended_by` |
| `invoice-pdf-downloads.ts` | `person_id` |
| `receipt-reprints.ts` | `person_id` |

At `eed41cc3c0^`, drawer opens and handover say `persons` is in identity's separate or optional set. PDFs and receipt reprints say “Persons belong to identity's migration set; a removed person must not erase this audit row.” Restricting deletion preserves the row, subject to the watcher's reading of the ask. At `de6a10330c` the correction comments say “Plain ids, as on bill refunds: no key yet.” Those refunds follow bill payments, whose old comment names identity's migration set. The core baseline at `bc261063ad` has no person keys on these five tables and already has three restrictive person keys on `refunds`. The unmarked `document_page_reprints` key and the separately justified fiscal certificate exception are outside the queue wording. Edits to the fiscal package are limited to affected test fixtures.

1. Extend the five existing schema suites (`drawer-opens.test.ts`, `handover/migrations.test.ts`, `invoice-corrections.test.ts`, `invoice-pdf-downloads.test.ts`, `receipt-reprints.test.ts`). Seed real people in their default fixtures so existing missing-sale, node, device and printer tests still isolate those keys. For each new missing-person test, keep every other value valid and assert SQLite's foreign-key refusal. Exercise `ended_by` through a permitted transition. Retain success cases, including automatic filing and an unassisted drawer open with null actors in their optional fields. Observe the new refusals fail first.
2. Declare eight named `onDelete("restrict")` keys to `persons.id` as in `refunds.ts`. Keep nullability, triggers and application writers. Add the eight expected child/parent entries in `scripts/schema-constraints.test.ts`. Prove delete refusal in an existing schema suite and verify all eight actions with the protection list. Rebuild via `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Remove the finished bullet in `docs/backlog/architecture.md`, update its index in `docs/backlog.md` and remove the old drawer example in `packages/bookings/src/bookings.test.ts`.
3. Run the five suites and the schema constraints, append-only, behavioural-trigger and starting-migration guards. Run the Madrid baseline test. Run the affected direct writers and fixtures listed in the Claude review. Start with Server's `orders-invoice-pdf`, `invoice-print-api`, `invoice-corrections`, `handover-controlled.e2e`, `handover-activation-repair` and `return-records{,.real}` suites, Core's `record-correction.approval`, Handover's `activations` and `backup-verification`, and the fiscal `backup-verification-secrets` and shared `test/takeover-fixture.ts` consumers. The shared fixture reuses a seeded actor or uses distinct names for distinct actors. Exercise the production drawer and reprint paths and run Server's `till-api.sell-published`, Till's `till-app-menu-refresh` and the unchanged fiscal `write-path.e2e` and `inmutabilidad` suites. Expect about 50 handwritten schema lines and 150–250 test and fixture lines, plus the generated core files.

## Assertions that change, by design

The handover migration test adds the actor key to its exact declaration expectation. `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` adds the new keys for drawer opens, PDF downloads and receipt reprints to its post-move projection via `personKey`, in the order a real run shows. Keep the frozen captures and existing behaviour assertions.

## Expected protection-list difference

Run the base and candidate lists per slice rule 3. These are the only additions under each of the six venue headers, from U11. Each key reports a restrictive delete action.

```text
extra table drawer_opens.foreignKeys[authorized_by->persons(id)]
extra table drawer_opens.foreignKeys[person_id->persons(id)]
extra table handover_activations.foreignKeys[person_id->persons(id)]
extra table invoice_corrections.foreignKeys[authorized_by->persons(id)]
extra table invoice_corrections.foreignKeys[ended_by->persons(id)]
extra table invoice_corrections.foreignKeys[requested_by->persons(id)]
extra table invoice_pdf_downloads.foreignKeys[person_id->persons(id)]
extra table receipt_reprints.foreignKeys[person_id->persons(id)]
```
