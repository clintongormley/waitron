# Handover state files implementation plan

**Cleared by the watcher 2026-11-14 09:44, with the five corrections below.** Lane J's HANDOVER-STATE-FILES assignment,
2026-11-14 08:47, is recorded in `/Users/clintongormley/waitron-campaign-j/queue.md`.
It asks for complete state-file treatments and the summaries/checks' follow-ups
in `docs/backlog/replication-cloud.md:496` and `:712`. Claude reviews this plan;
the watcher clears it. Neither is owner approval. Implement inline afterwards.
RUNNER records: "A1308 HOLD LIFTED by the watcher 2026-11-07 ~09:58: A760
part 3 landed (#2539)." No schema changes here.

**Usable result:** every declared state entry has an explicit handover decision;
CI detects missing decisions and stale manifest names; read-only fiscal summaries
reject incomplete query answers; payment summaries exclude manual tender refunds.
Reuse the manifest, `STATE_LAYOUT`, module classifications, schema metadata and
existing copy/test helpers. No new copying, runtime admission rule, protocol,
record, migration, fiscal write, hash, allocation or wire enum. Owner lands.

## Build

- [x] **Manifest, 50 minutes.** Modify `packages/handover/src/manifest.ts` and
  its `manifest.test.ts`; extend `scripts/handover-manifest-complete.test.ts`.
  Read `packages/store/src/state-layout.ts:71` without editing it. Use exact file
  names, `name/` for folders and `name*` for prefixes. Each new row explains why
  its source bytes do not travel and what the destination retains, discards or
  rebuilds. Existing transferred children keep their specific treatments.
  Group flows, Cloud and records by folder; add children only for differing
  treatment. Backup-room notes are not transferred; placement deletes the
  destination's note (`apps/server/src/handover-place-copy.ts:286`).
  Give each other recovery/setup/reset/adoption state entry a not-carried
  source-only or destination-owned row and its reason; presence adds no refusal. This is a transfer decision,
  not proof of runtime admission safety. Entry runs staged reset before start
  (`apps/server/src/node-entry.ts:698,717`); if tracing another state identifies
  a needed new refusal, stop for watcher direction before building it.
  Forward/reverse checks read layout, recovery/optional lists and module backup
  sources. Settings rows are checked only for staleness against declared keys
  (main fl10 stores module selection there). Reverse table checks use the discovered local set, including
  `tenant_credentials` (`packages/db/src/classification.ts:460`). Accept
  legitimate folder/prefix/template rows, including fl9 module-records prepared
  and retained children; refuse stale names. A file inside a declared folder is
  checked only to that folder, and a prefix-matched name only to that prefix;
  table names are checked exactly. Preserve existing
  class assertions without duplicating every added row. Disposable deletion and
  stale-name controls must fail; document that this checks declarations only.
  Update the manifest's guard-limit comment; accept the existing
  `isManifestStateFile` validator's widened vocabulary, correcting its comment
  in `apps/server/src/handover-manifest.ts:112` rather than adding another list.

- [x] **Fiscal summaries/checks, 65 minutes.** Modify
  `packages/fiscal-verifactu/src/handover-summary{,.test}.ts`:
  schema-derived ack identifiers, escaped before SQL interpolation, preserve
  digest tuple order/nulls; reject undefined required values and absent heads.
  Use `BackupQuery` doubles only for those incomplete answers, which a normal
  frozen copy cannot produce; assert that `summariseChains` itself rejects; the module wrapper already
  owns its `handover.summary_failed` behavior test. Real-copy tests retain digest/read-only assertions and compare
  the migrated envio CHECK's values with `ENVIO_STATES` in both directions.
  In `backup-verification-chain.ts`, share table discovery as
  `fiscalChainTables(query: BackupQuery): Promise<readonly string[]>` with
  `handover-chain-check.ts`. Preserve the walk's verdicts and unexpected query
  errors; avoid a new walker mode. The handover checker alone reports a missing
  `nodes` table as `broken`, using the same table lookup; prove it with a real copy.
  `handover-chain-check.test.ts` owns that failing case; individual fiscal-table
  drops add coverage and already pass. Preserve generic zero-table acceptance
  in `backup-verification-chain.test.ts`; leave rehashing unchanged.

- [x] **Payments, 20 minutes.** In
  `packages/payments/src/handover-summary{,.test}.ts`, observe manual pending
  refunds wrongly included, then exclude them using `manual = false`.
  Preserve connected/provider and bill-refund assertions. This mirrors
  `apps/server/src/tender-refund-recovery.ts:20`, since packages cannot import
  server code; record that invariant at the filter. Existing shared payment
  states and `packages/module/src/handover.test.ts` need validation only.
  Different-release summaries can refuse with `summary_mismatch`; no
  compatibility mechanism is added.

## Verification and bounds

Run changed test files with `pnpm [--filter @waitron/<package>] exec vitest run
<file>`. Also run fiscal `backup-verification-chain.test.ts`,
`clock-behind.restart.test.ts`, unedited `write-path.e2e.test.ts` and
`inmutabilidad.test.ts`; handover `indicator{,-parse}.test.ts`; module
`handover.test.ts`; server `handover-manifest`, `handover-compare`,
`handover-source-start-api` and `handover-place-copy` suites. New corrections
start red; already correct choices are coverage, not fabricated failures.
Allow 35 minutes for validation and deleting both detailed backlog entries,
their bundle and both index links. Add a dated historical-plan pointer only.
Estimate added/removed lines: production 160/70; tests 220/70; support 0/0;
docs 80/40, including this plan. One PR, 170 build minutes; outside opinion
above 960 changed lines. Normal pre-push lint/types, two run-it reviews and
current-head CI complete the gate. RUNNER §4 quotes owner 2026-11-08 16:28:
"never run a whole package suite locally" unless "chasing a specific failure".
