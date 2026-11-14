# Handover state files implementation plan

**PLAN FOR APPROVAL.** Lane J, HANDOVER-STATE-FILES, watcher assignment
2026-11-14 08:47 in `/Users/clintongormley/waitron-campaign-j/queue.md`.
The ask is complete state-file treatments (Slice 4 R5) and the summaries/checks’
minor follow-ups in `docs/backlog/replication-cloud.md`. Driver obtains Claude’s
read and watcher clearance before code; neither constitutes owner approval.
Implement inline after clearance. Fiscal changes are owner-landed.

**Smallest result:** every declared state entry has a reasoned handover treatment;
stale manifest names fail a source-based guard; malformed fiscal copies fail
read-only checks; the payment summary lists recoverable connected tender refunds.
Reuse existing manifest classes, `STATE_LAYOUT`, `ALL_MODULES`, schema metadata,
`ENVIO_STATES`, `IN_PROGRESS_PAYMENT_STATES`, `useVenueDb`, `archiveTo` and
`openBackupQuery`. Start the build from current main; consume
`packages/store/src/state-layout.ts` without editing it.

## Build and focused verification

For each correction below, write its failing assertion, observe the intended
failure, implement minimally, then observe green. Existing correct cases are
validation, not invented failing tests.

- [ ] **Manifest (50 minutes).** In `packages/handover/src/manifest.ts`, explicitly
  assign treatments to every `STATE_LAYOUT` file/folder/prefix. Keep transferred
  rows unchanged; group structural directories, with specific child rows taking
  precedence. Explain source-only recovery/setup/reset/adoption operations,
  `handover` operations, Cloud state and records; destination-owned TLS and local
  capacity files; rebuildable scratch, backup notes, stream/pair working copies,
  address caches and logs. Check these reasons against their writers/readers;
  never derive handover treatment from reset fate. Cover declared nested paths,
  including restore records and Cloud replacement state. In
  `packages/handover/src/manifest.test.ts`, retain behavioural class assertions.
  Extend `scripts/handover-manifest-complete.test.ts` to read layout paths,
  recovery/optional lists and module backup sources in both directions. Reverse
  venue-table checks use **all** `ALL_MODULES` classifications, preserving
  nonlocal `tenant_credentials`. Reject stale names; accept legitimate module
  template expansions. Disposable controls remove a treatment and inject a stale
  table/file; each must fail for its named omission. This checks declarations,
  not actual copying or arbitrary disk contents.

- [ ] **Fiscal summaries/checks (65 minutes).** In
  `packages/fiscal-verifactu/src/handover-summary.ts`, derive ack SQL column names
  from `schema/acks.ts`; preserve the five-value digest tuple’s order and nulls.
  Reject missing required values and absent heads instead of stringifying them.
  Its `handover-summary.test.ts` uses malformed disposable copies and asserts
  `collectHandoverSummaries` reports `handover.summary_failed`; retain digest and
  read-only assertions. Tie admitted envio-state counting to the real schema;
  retain the existing shared constant, without schema/migration changes.
  Consolidate discovery in `backup-verification-chain.ts`, using its existing
  table list and schema-derived `nodes` name. Let `handover-chain-check.ts`
  require fiscal tables; preserve generic backups’ zero-table acceptance.
  `handover-chain-check.test.ts` drops each fiscal table and `nodes` separately:
  expect `broken`, including empty fiscal tables without `nodes`.
  `backup-verification-chain.test.ts` preserves generic zero/partial-table and
  unexpected-query-error behaviour. Leave rehashing unchanged.

- [ ] **Payments and existing coverage (20 minutes).** In
  `packages/payments/src/handover-summary.test.ts`, change the explicit pending
  manual-refund expectation to exclusion, retaining connected/provider and
  bill-refund assertions. Then add `manual = false` in `handover-summary.ts`,
  matching `apps/server/src/tender-refund-recovery.ts` and
  `tender-refund-sends.ts`. Keep the existing shared payment-state source.
  Validate `packages/module/src/handover.test.ts` unchanged: ordering, skips,
  Error/non-Error refusals and sequential short-circuit already have assertions.

## Completion and bounds

Run `pnpm exec vitest run scripts/handover-manifest-complete.test.ts`;
`pnpm --filter @waitron/handover test manifest.test.ts indicator.test.ts`;
`pnpm --filter @waitron/fiscal-verifactu test handover-summary.test.ts handover-chain-check.test.ts backup-verification-chain.test.ts`;
`pnpm --filter @waitron/payments test handover-summary.test.ts`;
`pnpm --filter @waitron/module test handover.test.ts`.
Run `pnpm --filter @waitron/server test handover-manifest.test.ts handover-compare.test.ts handover-source-start-api.test.ts handover-place-copy.test.ts`:
signed items, comparison, public file parameter validation and revision merging
consume the manifest in those `apps/server/src/` suites.

Allow 35 minutes for validation and deleting both detailed backlog entries,
their bundle and both `docs/backlog.md` links. Add a dated pointer to
`docs/superpowers/plans/2026-11-02-a1018-handover-build.md` only where needed. Estimated lines added/removed:
production 160/70; tests (including root guard) 220/70; support 0/0; docs 80/40.
One PR, 170 build minutes. If this exceeds three hours, propose independent
manifest and read-only-summary slices to the watcher before expanding.
Exclude protocols, migrations, records, frameworks, copying changes, fiscal
writes/hashes/invoice allocation, `registerSif` and `restoreFiscal`.
