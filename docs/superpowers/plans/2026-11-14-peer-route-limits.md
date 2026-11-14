# Peer-route limits implementation plan

**Outcome and authority.** Bound request buffering before authentication or database work, require a UUID in peer queries, and correct peer-status authentication responses. Request: `~/waitron-campaign-j/queue.md`, PEER-ROUTE-LIMITS; watcher assignment: 2026-11-14 14:22. Driver checks and commits this draft; Claude reviews it, then watcher clearance is required before building. No owner design approval is claimed. Source orientation below is reading, not runtime evidence; base `dc4d41ec89`.

**Route inventory and budgets.** All sizes count incoming bytes, including signed envelopes. POST unless stated otherwise; abbreviated suffixes inherit the preceding route prefix.

| Routes | Classification and budget |
| --- | --- |
| `/api/node/peer-status`; `/api/node/handover/:operationId/indicator`, `/final-copy`, `/acceptance` | Signed peer controls: 64 KiB each; final-copy's response remains streamed. |
| `/api/node/handover/offer` | Signed peer offer: 1 MiB for variable `ringVersions`. |
| `/api/node/membership` | Signed chart: 256 KiB; allow eight nodes/endorsements and 256 revoked IDs (`packages/membership/src/verify.ts:24`). |
| `/api/node/return-records` | Signed returns: 512 KiB; sender wraps a 256 KiB/100-row payload (`return-records.ts:64`, `packages/fiscal-verifactu/src/handover-return.ts:640`), leaving envelope headroom. |
| `/api/node/backup-settings` | Signed peer settings: retain existing 64 KiB/413. |
| `/api/node/handover/:operationId/preparation`, `/activate`; `/api/node/handover/emergency/preview`, `/declare`; `/management-api/handover`, `/promote/preparation`, `/promote`, `/mirror-bundle` | Browser/credential operation controls, including mirror's server caller: 1 MiB each for module input/proposals. |
| `/api/node/handover/emergency/backup` | Upload: preserve `readUpload`, 256 MiB artifact plus 256 KiB multipart allowance; no small JSON middleware. |
| `/management-api/return-clashes/:clashId/accept` | Related browser decision: 64 KiB. |
| GET `/api/node`, `/api/node/handover/:operationId`, `/management-api/return-clashes` | Consume no body; no artificial read. |
| `/api/node/enrol-self` | Outside peer/handover scope: loopback print-agent enrolment (`node-enrol-api.ts:36`), not a browser or peer handover route. |

**Implementation files.** Under `apps/server/src/`, add `peer-route-limits.ts`: a small Hono `bodyLimit` wrapper returning 413 `handover.request_invalid`, field `body`. Attach it before handlers in `peer-status-api.ts`, `handover-source-api.ts`, `handover-destination-api.ts`, `node-membership-api.ts`, `return-records-api.ts`, `handover-preparation.ts`, `handover-activation.ts`, `handover-emergency-api.ts`, `handover-source-start-api.ts`, `promote-api.ts`, `mirror-bundle-api.ts`, `return-clash-acceptance.ts`. Reuse Hono's declared-length/chunked handling; do not replace HTTP parsing. Validate representative sender-built arrays/proposals against these budgets; do not claim every syntactically valid unbounded string fits.

In `peer-status-api.ts`, reuse `@waitron/handover`’s `isOperationId` (lowercase UUID v4, `binding.ts:35`) without rewriting signed spelling, matching source-start/emergency parsers. Map that endpoint's `peer_unknown` authentication refusals, including unknown/evicted signers, to 401. Preserve source/offer permission semantics and their 403 mappings. Trace `verifiedPeerQuery`, `askPeerStatus`, source-start and destination-duty consumers; do not introduce a signature-specific error or change trust decisions.

**Tests and build order.** Add `apps/server/src/peer-route-limits.test.ts`: mount actual APIs with inert dependencies; compare registered methods/paths with the classified inventory. Named cases: “oversize stops before dependencies”, “small body reaches handler”, “chunked overflow is refused”, “boundary bytes pass”, and “sender envelopes fit”. Exercise declared length and streamed bytes, including existing settings/upload exceptions. Reuse upload fixtures with a reduced injected budget.

Extend `peer-status-api.test.ts` with “bad signature returns 401”, unknown/evicted refusal controls, “non-UUID operation rejected”, and signed lowercase-v4 acceptance; reject mixed-case/non-v4 IDs consistently with existing operation parsers. Existing `handover-source-api.test.ts` and `handover-destination-api.test.ts` retain successful/authenticated and permission-refusal coverage. Add `scripts/peer-route-inventory.test.ts` to catch literal `/api/node/*`, handover, promote, mirror-bundle and return-clash registrations in unmounted/new files: the mounted inventory cannot discover those. This source guard proves classification, not middleware execution; computed paths/new namespaces remain outside its detection.

Observe each behavioral test fail for its intended reason, implement minimally, then rerun. In a disposable candidate, remove one limit and add one unclassified route; require the corresponding guards to fail. Run focused server suites with `pnpm --filter @waitron/server exec vitest run` and named files; run the root inventory guard separately. Preserve existing behavioral assertions. Finish through the normal hook and current-head CI; no whole-workspace local rerun. Require two Claude run-it reviews for authentication boundaries, then a fresh Claude read of fixes.

**Cleanup and bounds.** Update only the completed size/auth/UUID bullets in `docs/backlog/replication-cloud.md`; delete its size/attempt bundle and matching `docs/backlog.md` index entry, including the obsolete attempt-limit entry. Preserve unrelated minor test follow-ups. No ledger/framework, domain record, migration, fiscal writer, fiscal-package edit, protocol or new throttling work. Estimate: 100–140 code lines, 240–310 test lines, roughly 30 documentation lines; 2–2.75 hours, assuming available review seats/CI.
