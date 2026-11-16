# Cloud signed request helper — implementation plan

Codex proposal for Lane J, CLOUD-SIGNED-REQUEST-HELPER (watcher, 2026-11-16 02:06;
`/Users/clintongormley/waitron-campaign-j/queue.md`). No owner plan approval is claimed;
Claude has not read this proposal and watcher clearance is pending. The driver commits the
plan later, obtains Claude’s read through `claude-seat.sh review-branch`, addresses findings,
then obtains watcher clearance. **No build before both.**

**Smallest usable result:** existing Cloud operations share signing and capped HTTP response
reading, and refuse lists masquerading as state text. Deliver one PR and remove the completed
backlog bundle. Reuse Node crypto, existing contract payload builders, and current fixtures.
No separate spec is needed; the queued ask and this plan define the scope.

**Boundary:** add `apps/server/src/cloud-signed-request.ts` with two functions:
`signCloudPayload(bytes: Uint8Array, privateKey: string): string` returns the base64url Ed25519
signature using the existing base64url PKCS8 key;
`readCloudResponseBytes(response: Response, maxBytes: number): Promise<Buffer>` collects actual
stream bytes, rejects a missing body or overflow, and exits iteration on failure. It neither
fetches nor parses JSON. Callers retain payload construction, envelope keys/order, HTTP status
handling, decoding, deadlines, redirects, abort signals and error mapping.

- [ ] **1. Pin the named defects, then fix them.** All paths below are under
  `apps/server/src/`. Add failing cases to the existing corresponding test files, observe the
  expected failure, then require a string before enum membership. Keep existing behavioral
  assertions and valid-string controls; wrap array inputs in object test rows.

  | Production reader and field | Regression owner and assertion |
  | --- | --- |
  | `cloud-client.ts` pairing/saved `view.state` | `cloud-client.test.ts`: list refused as `cloud.unavailable` on reply, `cloud.state_invalid` on reload; saved bytes retained on reply refusal. |
  | `cloud-recovery.ts` reply `result.state` | `cloud-recovery.test.ts`: list refused with the existing recovery-unavailable message, before accepting approval. |
  | `cloud-replacement.ts` reply/saved `view.state` | `cloud-replacement.test.ts`: list refused as `cloud.unavailable`/`cloud.replacement_state_invalid`, respectively. |
  | `cloud-recovery-v2.ts` saved optional `phase` | `cloud-recovery-v2.test.ts`: otherwise valid v1/v2 files with `["staged"]` refused; absent phase remains valid. |
  | `cloud-staff-certificate.ts` reply `state` | `cloud-staff-certificate.test.ts`: `["pending"]` and `["ready"]` reject as `cloud.unavailable`, rather than resolving false. |

- [ ] **2. Extract and adopt the helper.** First add
  `apps/server/src/cloud-signed-request.test.ts`: signature verifies over unchanged bytes;
  capped reading accepts exactly the limit across chunks, rejects one byte more regardless of
  Content-Length, cancels overflow, and propagates missing-body/stream failures. Observe red,
  implement minimally, then green. Replace duplication in `apps/server/src/` files
  `cloud-client.ts`, `cloud-recovery.ts`, `cloud-replacement.ts`, `cloud-billing.ts`,
  `cloud-backup.ts`, `cloud-installation.ts`, `cloud-translation.ts`.
  Retain 16,384-byte client/replacement/recovery-v1 caps, 65,536-byte recovery-v2/backup/installation
  caps, billing’s 16,384 and translation’s per-action limits. Preserve replacement’s two signatures,
  recovery’s redirect default and 30-second deadline, and recovery-v2’s
  `parseBackupVerificationJson`; keep each caller’s tolerant or fatal UTF-8 decoding.

- [ ] **3. Verify contracts and finish.** Existing client suites own wire bytes/envelopes,
  parser choices, limits/deadlines, caller cancellation and distinct HTTP/error mappings.
  Reuse `apps/server/test/cloud-fixture.ts`, `cloud-installation-fixture.ts`,
  `translation-cloud-fixture.ts` and file-local fixtures without new support. Run
  `pnpm --filter @waitron/server exec vitest run` with all five regression test paths above,
  `src/cloud-signed-request.test.ts`, `src/cloud-billing.test.ts`, `src/cloud-backup.test.ts`,
  `src/cloud-installation.test.ts`, `src/cloud-translation.test.ts`,
  `src/cloud-translation.exchange.test.ts`; inspect test counts. Keep transport assertions at
  their existing owners; add only missing caller-specific checks. Delete the bundle/index and
  standalone strict-reader detail from `docs/backlog.md` and `docs/backlog/replication-cloud.md`.
  Run `finish-branch`, normal push hooks, open one PR, and require current-head CI before readiness.

**Exclusions:** S3 archive download/upload, CSR signing, inbound proxy limits, protocols/security
policy, retries, universal transport, unrelated defects and new test infrastructure.

**Size/time:** estimated production +100/−180, tests +220/−0, support +0/−0, docs +70/−20
lines (590 changed total). Above 885 (1.5×), stop for watcher outside opinion, explaining growth
and real events covered. **THREE ACTIVE HOURS from implementation start THROUGH OPEN PR**, including
verification and branch review; external waits excluded and recorded. At the limit, stop cleanly
and report what works, remains, and the smallest cut to the watcher.
