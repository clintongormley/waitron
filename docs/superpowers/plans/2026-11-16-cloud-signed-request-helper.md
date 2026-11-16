# Cloud signed request helper — implementation plan

Codex proposal for Lane J. Watcher queue instruction, 2026-11-16 02:06,
`/Users/clintongormley/waitron-campaign-j/queue.md`, CLOUD-SIGNED-REQUEST-HELPER:
“put the repeated signing and size-capped reading of requests to Cloud into one shared helper,
and make the readers refuse a one-item list where they want text”. Separate Sol/high writer;
Claude initial/corrections reads complete; watcher clearance pending. No owner plan
approval is claimed. **No build before Claude review and watcher clearance.**

**Smallest usable result:** existing Cloud operations share signing and capped HTTP response
reading, and refuse lists masquerading as state text. Deliver one PR and remove the completed
backlog bundle. Reuse Node crypto, existing contract payload builders, and current fixtures.
No separate spec is needed; the queued ask and this plan define the scope.

**Boundary:** add `apps/server/src/cloud-signed-request.ts` with two functions:
`signCloudPayload(bytes: Uint8Array, privateKey: string): string` returns the base64url Ed25519
signature using the existing base64url PKCS8 key;
`readCloudResponseBytes(response: Response, maxBytes: number): Promise<Buffer>` collects actual
stream bytes, throws plain `Error` for missing body/overflow, and exits iteration on failure;
stream/abort errors propagate unchanged. Remove duplicated body checks. It neither
fetches nor parses JSON. Callers retain payload construction, envelope keys/order, HTTP status
handling, decoding, deadlines, redirects, abort signals and error mapping.

- [ ] **1. Pin the named defects, then fix them.** All paths below are under
  `apps/server/src/`. Add failing cases to the existing corresponding test files, observe the
  expected failure, then require a string before enum membership. Keep existing behavioral
  assertions and valid-string controls; wrap array inputs in object test rows.

  | Production reader and field | Regression owner and assertion |
  | --- | --- |
  | `cloud-client.ts` pairing/saved `view.state` | `cloud-client.test.ts`: `["awaiting_local"]` with valid organisation fields refused as `cloud.unavailable` on reply, `cloud.state_invalid` on reload; saved bytes retained on reply refusal. |
  | `cloud-recovery.ts` reply `result.state` | `cloud-recovery.test.ts`: `["approved"]` with `operationId: null` refused with the existing recovery-unavailable message before accepting approval. |
  | `cloud-replacement.ts` reply/saved `view.state` | `cloud-replacement.test.ts`: `["complete"]` with `registration: null` refused as `cloud.unavailable`/`cloud.replacement_state_invalid`, respectively. |
  | `cloud-recovery-v2.ts` saved optional `phase` | `cloud-recovery-v2.test.ts`: valid v1/v2 files with `["staged"]` refused; v2 includes matching point/verification; absent phase remains valid. |
  | `cloud-staff-certificate.ts` reply `state` | `cloud-staff-certificate.test.ts`: submit replies `["pending"]`/`["ready"]` reject as `cloud.unavailable`, rather than resolving false. |

- [ ] **2. Extract and adopt the helper.** First add
  `apps/server/src/cloud-signed-request.test.ts`: signature verifies over unchanged bytes;
  capped reading accepts exactly the limit across chunks, rejects one byte more,
  cancels overflow, rejects missing body and propagates stream failures. Observe red,
  implement minimally, then green. Replace duplication in `apps/server/src/` files
  `cloud-client.ts`, `cloud-recovery.ts`, `cloud-replacement.ts`, `cloud-billing.ts`,
  `cloud-backup.ts`, `cloud-installation.ts`, `cloud-translation.ts`.
  Retain 16,384-byte client/replacement/recovery-v1 caps, 65,536-byte recovery-v2/backup/installation
  caps, billing’s 16,384 and translation’s per-action limits. Preserve replacement’s two signatures,
  recovery’s redirect default and 30-second deadline, and the recovery-v2 branch’s
  `parseBackupVerificationJson` in `cloud-recovery.ts`; keep each caller’s tolerant or fatal UTF-8 decoding.

- [ ] **3. Verify contracts and finish.** Client suites own wire bytes/envelopes, parsers,
  limits/deadlines, cancellation and distinct HTTP/error mappings. Add valid JSON padded to the
  exact cap and cap+1 in client/replacement/installation tests, following billing’s existing
  case; extend only `apps/server/test/cloud-fixture.ts` for valid padded replies. Reuse
  `cloud-installation-fixture.ts`, `translation-cloud-fixture.ts` and file-local fixtures. Run
  `pnpm --filter @waitron/server exec vitest run` with all five regression test paths above,
  `src/cloud-signed-request.test.ts`, `src/cloud-billing.test.ts`, `src/cloud-backup.test.ts`,
  `src/cloud-installation.test.ts`, `src/cloud-translation.test.ts`,
  `src/cloud-translation.exchange.test.ts`, `src/cloud-emergency.test.ts`,
  `src/cloud-tunnel-provision.test.ts`, `src/cloud-guest-menu.test.ts`,
  `src/cloud-client.billing.test.ts`, `src/cloud-client.emergency.test.ts`; inspect counts. Keep transport assertions at
  their existing owners; add only missing caller-specific checks. Delete the bundle/index and
  standalone strict-reader detail from `docs/backlog.md` and `docs/backlog/replication-cloud.md`.
  Run `finish-branch`, normal push hooks, open one PR, and require current-head CI before readiness.

**Exclusions:** S3 archive download/upload, CSR signing, inbound proxy limits, protocols/security
policy, retries, universal transport, unrelated defects and new test infrastructure.

**Size/time:** estimated production +60/−115, tests +280/−0, support +10/−0, docs +75/−20
lines (560 changed total). Above 840 (1.5×), stop for watcher outside opinion, explaining growth
and real events covered. **THREE ACTIVE HOURS from item start (2026-11-16 02:08 CET) THROUGH OPEN PR**, including planning,
verification and branch review; external waits excluded and recorded. At the limit, stop cleanly
and report what works, remains, and the smallest cut to the watcher.
