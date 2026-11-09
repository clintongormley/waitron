# A1418 part 1: the stop mark, the start-up bucket check and the alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** A box records a clean stop, knows at its next start how it last stopped, asks the backup bucket whether it has been replaced, waits at most 60 seconds for that answer after a stop without a mark (showing why, on its page and on the tills), stays stopped once told it was replaced (unless an administrator carries on), and emails the managers about each of these. A restored box always takes a term above everything its bucket holds.

**Architecture:** Two small files in the state folder. `stop-mark.json` is written by the shutdown handler only while the box is trading, and taken (read and removed) at the top of `bootServer`. `replaced.json` is written the moment a box learns it was replaced and cleared only by carrying on. A pure check in `@waitron/stream` reads the bucket's pointer and the claims of the next term and verifies each signature; `apps/server` wraps it with the box's settings, term and trust set. `bootServer` uses the answer on a box whose chart lists no other box it counts; the two-box path is unchanged. Every wait — for the bucket, for a restore's bucket, after being replaced, and today's wait for another box — is the existing waiting start with a reason, which `/api/node` passes to the tills so they can say why the box is not selling. A background watch keeps asking while the box sells.

**Tech Stack:** TypeScript, Node 26, Hono, Lit (the till), Vitest 4, `@waitron/stream`'s `ObjectStore`, `@waitron/membership`'s `signBytes`/`verifyBytes`.

**Spec:** `docs/superpowers/specs/2026-11-07-a1418-box-stop-intent-design.md` (approved 2026-11-07). Part 1 is design §10 item 1: §2 (the `restart` mark only), §3 without Cloud (part 3), three of §6's four alerts (the fourth, "shutdown paused", is part 2) and §9's `CLAUDE.md` amendments. Two additions the owner asked for on 2026-11-07 after reading the first draft: a restore takes a term above everything in the bucket (Task 6), and the wait shows a page that the tills explain (Tasks 7 and 8). A separate design covers giving each restored box its own identity.

## Global Constraints

- Risk triggers: fiscal filing, start-up and concurrency. Full review path: per-task reviews, and the full `/finish-branch` wave with the Codex run-it seat run twice.
- Unchanged: `SHUTDOWN_DEADLINE_MS` = 8000 (`apps/server/src/run-server.ts:31`) and the 5-second Litestream kill grace.
- Both files live in the state folder, beside `spare-space.released`, never in `venue.db` or `node.db`. Each is written to a temporary name, flushed to disk (`fsync`), then renamed.
- Part 1 writes one mark value, `restart`. `shutdown` and its start row are part 2; part 1's reader treats any other content as no mark.
- The wait after a start with no mark is at most `START_ANSWER_WAIT_MS = 60_000` from its first ask, ends as soon as the bucket answers, and no single ask runs past it.
- A box with no bucket settings (`readStreamSettings` returns `null`) has nobody to ask and does not wait.
- "Replaced" (Decision 1) = a pointer or a claim that verifies against the signer's key in this box's trust set and names a term higher than this box's held chart term. One that does not verify is no answer.
- **9 November 2026, before building Tasks 4–5:** A1342 (#2654) landed after this plan with its own pointer check, `readNewerBucketMain` in `apps/server/src/stream-host.ts`, which trusts only a key this box itself vouched for. This plan's Task 5 trusts any key in the trust set. Settle one rule and use it in both places; do not ship two readers with different trust.
- A restored box skips the replaced check while `REBUILD_MARKER` (`rebuild-first-start.json`) is in its state folder, and takes a term above the highest term any pointer or generation in its bucket names (Task 6).
- Claim signatures use the purpose string `"waitron.stream.claim.v1"`, as the pointer uses `"waitron.stream.pointer.v1"`.
- Three incident codes, each with an area claim, English and Spanish dashboard words and email words: `start.unplanned_stop`, `start.selling_unconfirmed`, `start.replaced`. Recorded only on a box that is not a mirror and not fenced (a mirror's `venue.db` is a copy).
- Four waiting reasons, the same names on the box and the till: `peers`, `bucket`, `restore`, `replaced`.
- Saving a raised chart when carrying on follows `CLAUDE.md` §3: `node.db`'s lock outside, `venue.db` saved first, `node.db` after.
- General code is English only. Page, till and email words in English and Spanish. A screen change updates its guide in both.
- Coverage 98/98/98/95 in every package touched. Every commit `git commit -s`. Work in a worktree made with `python3 ~/workspace/tools/worktree.py new waitron feat/a1418-stop-marks --headless`.
- No backwards compatibility: an unsigned claim already in a bucket is no answer (`CLAUDE.md` §3, pre-live rule).

## Decisions this plan makes

1. **Equal term is not "replaced", and a restore makes it unreachable.** At an equal term the old box cannot tell a restored copy's generation from one of its own: a restore keeps the box's node id and key, and a box opens a new generation at its own term at every start (`packages/stream/src/supervisor.ts:432`, read). Today a restore can end at or below the old box's term: when its bucket read fails it sells without raising its term (`runFirstStart`, `rebuild-first-start.ts:170-180`, read), and with no pointer it takes the backup's term plus one, which can be below a term the old box reached after that backup. Task 6 closes both on a venue with a bucket, while the bucket can be read and the rest of the restore succeeds: the restore takes a term above every pointer and generation name in the bucket, and does not sell while the bucket cannot be read. Left open: (a) an old box that changed its term while its bucket was unreachable and died before reaching it leaves no trace of that term; (b) a restore that fails for another reason (certificate reissue, signing, saving: `rebuild-first-start.ts:170-178`) still sells at the old term without streaming, as today; (c) an archive whose bucket settings are older than the bucket the venue now streams to reads the wrong bucket. A venue with no bucket has nothing that could tell the old box, as the design accepts. The separate design for giving every restored box its own identity removes the equal-term case at its root.
2. **The restored box can be verified by the old one.** The node signing key is sealed in `node.db` under the node id (`packages/credentials/src/node-signing-key.ts:25,35-56`, read); an archive restore puts `node.dump` and `secrets/*` back unless `skipSecrets` is set (`restore.ts:409`, read); a stream restore unseals it with the recovery key (`restore-stream.ts:327-334`, read); `completeRebuild` makes no new key. A stream restore's key is already asserted equal in `apps/server/src/testing/stream-loop-scenario.ts:589-592`; Task 5 adds the archive case. A `skipSecrets` restore keeps the target's own identity, so it is not "the same box".
3. **Only claims at the next term are listed by the replaced check.** `ObjectStore.list(prefix)` has no delimiter (`packages/stream/src/object-store.ts:34`), so listing every generation lists every file. The check lists `gen-<term+1>-`; a higher term is caught by the pointer once that box's first full copy lands. A restore, which runs once, lists everything (Task 6).
4. **Being replaced is saved, in `replaced.json`.** Written before the replaced page is served and before a selling box restarts; read at every start before the bucket is asked; cleared only by carrying on. It names the venue and the replacement's term, and is removed once the box's held chart term is above that term or the venue differs. It is ignored while `REBUILD_MARKER` exists, and deleted by every restore (`writeValidated`, `restore.ts`) and by `waitron.sh reset`, as `backup-room-note.json` is (`CLAUDE.md` §3), so a box restored from the newer copy is never held by it.
5. **The mark is written only by a trading box.** Armed at the end of `bootServer` on a box that is not a mirror and not fenced, disarmed on a failed start. A clean stop while waiting, replaced or in repair writes nothing.
6. **"Stopped without warning" is told by the venue holder file, not by a missing mark.** The holder file beside `venue.lock` is removed by a clean close and left behind by a power cut, a crash or a forced kill (`packages/store/src/venue-holder.ts:7,106`). The alert is raised when the previous holder file was found at the top of `runEntry`, and never for a restored box's first start. Every restart the box makes for itself while not trading (setup finishing `setup-api.ts:976,1082,1160`, a time-zone repair `boot.ts:2178`, first-setup launch `first-setup-launch.ts:90`) closes cleanly, so it raises nothing; it still asks the bucket, usually for seconds. A stop that reaches the 8-second deadline exits before the store closes and leaves the file (read, `venue-liveness.ts:319-323`), so it is reported as unplanned.
7. **The wait shows a page, and the tills say why** (owner, 2026-11-07: "it would be good to have a page which explains what we're waiting for visible on the tills"). The box first asks once, bounded at `START_FIRST_ASK_MS = 5_000`, as today's peer check is bounded at 5 seconds before any page (`start-peer-check.ts:37`); with no answer it serves the waiting start with reason `bucket` until an answer or the 60 seconds. `/api/node` answers `waitingFor` with the reason while the box takes no sales; today it answers only `acceptingSales: false` (`node-api.ts:41-48`), and the till shows "unreachable" or "standby, not promoted" (`apps/till/src/i18n/strings.ts:1832-1842`).
8. **The watch asks every 10 minutes** (`REPLACED_WATCH_MS = 600_000`), at once when the box sells and then on the interval: one GET and one LIST each time, about 4,320 of each a month. The plan review judged the cost trivial; it was not checked against PR #2524's figures.
9. **A late "replaced" saves `replaced.json` and restarts the process**, and the restart serves the replaced start from the file, whatever the bucket says then.
10. **The bucket check and the watch run only on a box whose chart lists no other box it counts** (the `counted` peers of `checkPeersAtStart`, `boot-peer-check.ts:135-137`). The design's two-box column is "the existing check, unchanged", and there the main box streams to the spare's store (design §4, A947 §3).
11. **A second unplanned stop while the first alert is still open records nothing new**: `recordIncidentOnce` skips an open duplicate (`packages/core/src/incidents.ts:118-150`).
12. **A restore's highest term is read without checking signatures.** Going higher is the safe direction: a forged generation name in the bucket can only push the restored box's term up. A term at or above `Number.MAX_SAFE_INTEGER - 1` fails the start with `restore.bucket_term_invalid`, as `restore.membership_invalid` does (`rebuild-first-start.ts:175`), so repeated failures reach the recovery page; it is not a wait an administrator can carry on through.

## Review Focus

1. **A replaced box restarted with its bucket out of reach** stays stopped — Task 10b pins it.
2. **A restored box whose bucket cannot be read** sells nothing until it can, or until an administrator confirms the old box is off — Task 6 pins it.
3. **A newer pointer signed by a key this box does not hold** is no answer, never "clear" and never "replaced" — Task 4 pins it.
4. **A bucket that hangs** keeps each ask within the time left of the 60 seconds, and a stop of the watch inside the shutdown deadline — Tasks 5, 9c and 11 pin it.
5. **A till that reaches a box which takes no sales** names the reason, and an older box answering no reason still reads as today — Task 8 pins it.

---

### Task 1: The two state-folder files

**Files:**

- Create: `apps/server/src/stop-mark.ts`
- Test: `apps/server/src/stop-mark.test.ts`

**Interfaces:**

- Produces:
  - `export const STOP_MARK_FILE = "stop-mark.json"`, `export const REPLACED_FILE = "replaced.json"`
  - `export type StopMark = "restart"`
  - `export async function writeStopMark(stateDir: string, mark: StopMark, at: Date): Promise<void>` — `{"version":1,"mark":"restart","at":"<iso>"}`.
  - `export async function takeStopMark(stateDir: string, log: Logger): Promise<StopMark | null>` — reads and removes. Missing: `null`. Unreadable, wrong version or another `mark`: logs `warn` `server.stop_mark_unreadable` (no params), removes the file, `null`.
  - `export interface ReplacedRecord { venueId: string; term: number; nodeId: string; via: "pointer" | "claim"; at: string }`
  - `export async function writeReplaced(stateDir: string, record: ReplacedRecord): Promise<void>`
  - `export async function readReplaced(stateDir: string, venueId: string, ownTerm: number, log: Logger): Promise<ReplacedRecord | null>` — `null` when missing, and `null` (file kept) while `REBUILD_MARKER` exists; when the venue differs or `ownTerm > record.term`, removes the file, logs `info` `start.replaced_cleared`, `null`. Unreadable: logs `warn` `server.replaced_unreadable` and returns a record with `term: Number.MAX_SAFE_INTEGER` (an unreadable record stops the box; only carrying on clears it).
  - `export async function clearReplaced(stateDir: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** on a `mkdtemp` folder:
  - `"a written restart mark is taken once, then gone"`; `"no file is no mark"` (logs nothing); `"an unreadable mark counts as none and is removed"` for `"{"`, `'{"version":2,"mark":"restart"}'` and `'{"version":1,"mark":"shutdown"}'`; `"the write leaves no temporary file behind"` (`readdirSync(dir)` equals `[STOP_MARK_FILE]`).
  - `"a replaced record holds while the box's term is not above it"` (record term 6, own 6 → the record); `"a replaced record clears once the box's term is above it"` (own 7 → `null`, file gone); `"a record for another venue clears"`; `"a record is ignored while a restore is finishing"` (marker present → `null`, file kept); `"an unreadable record stops the box"` (`term` is `Number.MAX_SAFE_INTEGER`, file kept).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/stop-mark.test.ts` — expected FAIL: module not found.
- [ ] **Step 3: Implement**; declare `server.stop_mark_unreadable`, `server.replaced_unreadable` and `start.replaced_cleared` in `apps/server/src/errors.ts` beside their siblings.
- [ ] **Step 4: Run** it — expected PASS.
- [ ] **Step 5: Commit** with message "A box can save how it stopped, and that it was replaced, in its state folder".

### Task 2: A trading box writes `restart` as the first step of a clean stop

**Files:**

- Modify: `apps/server/src/stop-mark.ts` (arming), `apps/server/src/run-server.ts` (`ShutdownDeps`, `DEFAULT_DEPS`, `installShutdownHandlers`)
- Test: `apps/server/src/run-server.test.ts`, `apps/server/src/stop-mark.test.ts`

**Interfaces:**

- Consumes: `writeStopMark` (Task 1).
- Produces:
  - `export function armRestartMark(stateDir: string): void`, `export function disarmRestartMark(): void` — one process-wide armed state, unarmed at load.
  - `export async function writeArmedStopMark(log: Logger, now: () => Date): Promise<void>` — when armed, `writeStopMark(stateDir, "restart", now())`; a throw is logged `warn` `server.stop_mark_failed` with `{ errorCode: codeOf(error) }` and swallowed. Unarmed: nothing.
  - `ShutdownDeps.markStop?: () => Promise<void>`; `DEFAULT_DEPS.markStop` = `writeArmedStopMark` with the default logger and clock.
  - `export const MARK_STOP_BOUND_MS = 1000` in `run-server.ts`: the longest the handler waits for `markStop` before it calls `close()`.

- [ ] **Step 1: Write the failing tests.**
  - `run-server.test.ts`: `"the stop mark is written before close begins"` (`markStop` and `close` push to one array; `expect(order).toEqual(["mark", "close"])`); `"a mark that fails still closes"`; `"a second signal writes no second mark"` (SIGTERM then SIGINT, `markStop` once); `"a mark that never settles holds close back no longer than the bound"` (fake timers: `close` called at `MARK_STOP_BOUND_MS`, and the deadline still exits 0 at `SHUTDOWN_DEADLINE_MS`).
  - `stop-mark.test.ts`: `"only an armed process writes, and disarming stops it"`; `"a failed write is logged, not thrown"` (state folder path is a regular file).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/run-server.test.ts src/stop-mark.test.ts` — expected FAIL on the new cases.
- [ ] **Step 3: Implement.** In the signal handler, after the latch and the deadline timer, race `deps.markStop?.()` against `MARK_STOP_BOUND_MS`, then call `server.close()`. Declare `server.stop_mark_failed`.
- [ ] **Step 4: Run** it, plus `src/run-server.signals.test.ts` — expected PASS.
- [ ] **Step 5: Commit** with message "A trading box saves a restart mark as the first step of a clean stop".

### Task 3: Signed generation claims

**Files:**

- Modify: `packages/stream/src/generations.ts`, `packages/stream/src/supervisor.ts:435` (the one caller outside tests), `packages/stream/src/index.ts`
- Test: `packages/stream/src/generations.test.ts`, `packages/stream/src/supervisor.test.ts`

**Interfaces:**

- Produces:
  - `export interface GenerationClaim { generation: string; venueId: string; term: number; nodeId: string; nonce: string }`, `export interface SignedClaim { body: GenerationClaim; signature: string }`
  - `export function claimMessage(body: GenerationClaim): string` — `canonicalize({ purpose: "waitron.stream.claim.v1", claim: body })`.
  - `export async function claimGeneration(store: ObjectStore, venueId: string, generation: string, sign: (message: string) => Promise<string>, call?: StoreCall): Promise<void>` — writes `SignedClaim` JSON at the same key (`markerKey`), still `ifNoneMatch: "*"`.
  - `export async function readClaim(store: ObjectStore, venueId: string, generation: string, call?: StoreCall): Promise<SignedClaim | null>` — `null` when absent or malformed (shape, `venueId` mismatch, or `term`/`nodeId` differing from `parseGenerationName(generation)`).
  - `export function verifyClaim(claim: SignedClaim, publicKeySpki: string): boolean`.

- [ ] **Step 1: Write the failing tests** (the in-memory store `generations.test.ts` already uses; a key pair made as `pointer.test.ts` makes its own):
  - `"a claim is signed and verifies against its signer's key"` (another key: `false`); `"a claim whose body was changed does not verify"`; `"a claim naming another venue or another term than its generation reads as null"` (two cases); `"an old unsigned claim reads as null"`.
  - `supervisor.test.ts`: the existing claim case also asserts that the stored claim verifies against the test signer's public key.
- [ ] **Step 2: Run** `pnpm --filter @waitron/stream exec vitest run src/generations.test.ts src/supervisor.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; the supervisor passes `this.#deps.sign`. Confirm with `grep -rn "opened.json\|markerKey" packages apps` that nothing else reads the claim's body (the plan review found only key-name uses: `pruneGenerations`, `#measureSkew`).
- [ ] **Step 4: Run** it and `pnpm --filter @waitron/stream test:coverage` — expected PASS, thresholds held.
- [ ] **Step 5: Commit** with message "A box signs the claim it writes when it opens a backup generation".

### Task 4: Reading the bucket's terms

**Files:**

- Create: `packages/stream/src/replacement.ts`
- Modify: `packages/stream/src/index.ts`
- Test: `packages/stream/src/replacement.test.ts`

**Interfaces:**

- Consumes: `readPointer`, `verifyPointer` (`pointer.ts`), `readClaim`, `verifyClaim` (Task 3), `venuePrefix`, `parseGenerationName` (`names.ts`).
- Produces:
  - `export type ReplacementAnswer = { kind: "replaced"; term: number; nodeId: string; generation: string; via: "pointer" | "claim" } | { kind: "clear" } | { kind: "unverified"; term: number }`
  - `export async function findReplacement(store: ObjectStore, venueId: string, ownTerm: number, publicKeyOf: (nodeId: string) => string | undefined, call?: StoreCall): Promise<ReplacementAnswer>` — passes `call` (and its abort signal) to every store call; throws whatever the store throws. Order: the pointer (one GET); then one `list(`${venuePrefix(venueId)}gen-${ownTerm + 1}-`)`, the distinct generation names in its keys, and `readClaim` for each. The first that verifies with a term above `ownTerm` is `replaced`. Anything above `ownTerm` that does not verify, or whose signer has no key, makes the answer `unverified` unless another verifies. Otherwise `clear`.
  - `export async function highestBucketTerm(store: ObjectStore, venueId: string, call?: StoreCall): Promise<number | null>` — the highest term named by the pointer or by any generation name under `venuePrefix(venueId)` (one full listing, every page), signatures not checked (Decision 12); `null` when the bucket holds neither; throws `AppError("restore.bucket_term_invalid", {})` for a term at or above `Number.MAX_SAFE_INTEGER - 1`.

- [ ] **Step 1: Write the failing tests** (in-memory store; key pairs `old` and `stranger`): `"no pointer and no claims is clear"`; `"a pointer at this box's own term is clear"`; `"a verified pointer at a higher term is replaced, via the pointer"` (`toEqual({ kind: "replaced", term: 6, nodeId: "node-a", generation, via: "pointer" })`); `"a higher pointer signed by a key this box does not hold is unverified"` (`toEqual({ kind: "unverified", term: 6 })`); `"a higher pointer whose signature is wrong is unverified"`; `"a verified claim at the next term is replaced before any full copy lands"` (`via: "claim"`); `"a claim two terms up is not listed"` (`clear`, exactly one `list` call, prefix ending `gen-6-` for own term 5); `"an aborted call stops the check"`; `"a store that throws makes the check throw"`; `"the highest term is the largest of the pointer and every generation"` (pointer 5, generations 5, 7 and 6 → 7); `"a bucket with nothing is no term"`; `"an absurd term is refused"`. (Paging happens inside `s3-store.ts:178-216`, already tested there; `ObjectStore.list` returns one array.)
- [ ] **Step 2: Run** `pnpm --filter @waitron/stream exec vitest run src/replacement.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** both; declare `restore.bucket_term_invalid` where `@waitron/stream` declares its codes.
- [ ] **Step 4: Run** it and `pnpm --filter @waitron/stream test:coverage` — expected PASS.
- [ ] **Step 5: Commit** with message "The bucket can tell a box whether a newer copy of it has taken over, and a restore the highest term it holds".

### Task 5: The box's own bucket check

**Files:**

- Create: `apps/server/src/bucket-replaced-check.ts`
- Modify: `apps/server/src/start-peer-check.ts` (add `chartListsCountedPeer`)
- Test: `apps/server/src/bucket-replaced-check.test.ts`, `apps/server/src/start-peer-check.test.ts`

**Interfaces:**

- Consumes: `findReplacement` (Task 4), `readStreamSettings` (`stream-host.ts:59`), `createS3ObjectStore`, `readNodeMembership`, `readMembershipTrustSet`, `REBUILD_MARKER`.
- Produces:
  - `export type BucketAnswer = { kind: "nobody_to_ask" } | { kind: "restoring" } | { kind: "clear" } | { kind: "replaced"; venueId: string; term: number; nodeId: string; via: "pointer" | "claim" } | { kind: "no_answer"; errorCode: string }`
  - `export const BUCKET_CHECK_TIMEOUT_MS = 15_000`
  - `export async function checkBucketReplaced(deps: { db: Database; ring: KeyRing; stateDir: string; openStore?: (bucket: BucketConfig) => ObjectStore; timeoutMs?: number; signal?: AbortSignal }): Promise<BucketAnswer>` — `restoring` when `REBUILD_MARKER` exists; `nobody_to_ask` without stream settings; `unverified` maps to `no_answer` with `errorCode: "start.bucket_unverified"`; a throw maps to `no_answer` with `codeOf(error)`; the bound or `signal` aborts the read and maps to `restore.pointer_unreadable`, as `readBucketPointerTerm` does. Never throws. Own term: the held chart's `body.term`, `0` when none. Declare `start.bucket_unverified`.
  - `export async function chartListsCountedPeer(db: Database, node: NodeDatabase, nodeId: string): Promise<boolean>` — true when the held chart lists another node that `checkPeersAtStart` would count (routable standing, joined, not in `readActivatedFrom`, not a box this box demoted by its own promotion).

- [ ] **Step 1: Write the failing tests** (`useVenueDb`, in-memory `openStore`):
  - one case per `BucketAnswer` kind, each asserting the exact object;
  - `"a hanging bucket answers no_answer within the bound"` (`get` never settles, `timeoutMs: 50`); `"an aborted signal ends the read at once"`;
  - `"a box restored from an archive signs pointers the original box verifies"`: restore an archive of this venue into a second state folder with `restoreFromArtifact` (`apps/server/src/restore.ts:534`; `attendance-restore.test.ts` shows the setup), sign a pointer at term + 1 with the restored copy's `readNodeIdentityKey`, and the ORIGINAL box's `checkBucketReplaced` answers `replaced`. The receipt for Decision 2; if it fails, stop and report;
  - `start-peer-check.test.ts`: `chartListsCountedPeer` is false for a one-box chart, for a listed but unjoined box and for a box in `readActivatedFrom`; true for a joined `serving-secondary`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bucket-replaced-check.test.ts src/start-peer-check.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — expected PASS.
- [ ] **Step 5: Answer design §8 question 1** in the branch's PR notes (keep a draft in the ledger): read `apps/server/src/restore-stream.ts`'s refusal of a generation changed in the last few minutes and say, with `file:line`, whether it stops a mistaken restore of the live venue, and that the old box now verifies the pointer (this task's test).
- [ ] **Step 6: Commit** with message "A box can ask its bucket whether it has been replaced".

### Task 6: A restore takes a term above everything in its bucket

**Files:**

- Modify: `apps/server/src/rebuild-first-start.ts` (`RebuildDeps.pointerTerm` becomes `bucketTerm`; `readBucketPointerTerm` becomes `readBucketTerm`; `FirstStart`; `runFirstStart`; the bucket read moves to the top of `completeRebuild`, before the certificate reissue), `apps/server/src/boot.ts:1990-2005` (the caller), `apps/server/src/restore.ts` (`writeValidated` deletes `replaced.json`), `deploy/waitron.sh` (`reset` deletes it)
- Test: `apps/server/src/rebuild-first-start.test.ts`, `apps/server/src/restore.test.ts` (or the suite that covers `writeValidated`), `scripts/waitron-sh.test.mjs`

**Interfaces:**

- Consumes: `highestBucketTerm` (Task 4).
- Produces:
  - `export async function readBucketTerm(db: Database, ring: KeyRing, options?: { openStore?: (bucket: BucketConfig) => ObjectStore; timeoutMs?: number }): Promise<number | null>` — as `readBucketPointerTerm` today (`rebuild-first-start.ts:211-244`: `null` without settings, throws `restore.pointer_unreadable` on the bound or an uncoded failure), but through `highestBucketTerm`. `minTerm` stays `term + 1`.
  - `FirstStart` gains `bucketUnreadable: boolean` — true when the `bucketTerm` read threw. `runFirstStart` then logs `restore.first_start_waiting_bucket` and returns `{ mayStream: false, failedSince, bucketUnreadable: true }`; every other failure keeps today's behaviour (sells, does not stream).
  - `RebuildDeps.bucketTerm` may be handed a value already read: `completeRebuild(deps, known?: { bucketTerm: number | null })` skips the read when `known` is given. The restore wait (Task 9c) re-asks only `readBucketTerm`, and finishes once with the answer, so the certificate is reissued once, not at every re-ask. Carrying on at that wait finishes with `known: { bucketTerm: null }`.
  - A `restore.bucket_term_invalid` throw is rethrown by `runFirstStart`, failing the start (Decision 12).

- [ ] **Step 1: Write the failing tests** in `rebuild-first-start.test.ts`: `"a restore takes a term above a generation newer than the pointer"` (pointer 5, a generation at 7 → saved chart term 8); `"a restore whose bucket cannot be read does not finish and says so"` (`openStore` throws → `{ mayStream: false, bucketUnreadable: true }`, marker kept, chart term unchanged, and the certificate files untouched); `"an absurd bucket term fails the start"`; `"a restore given the bucket's term does not read it again"`; `"every restore deletes replaced.json"` (in the `writeValidated` suite); `"reset deletes replaced.json"` (in `scripts/waitron-sh.test.mjs`); `"a restore with no bucket settings finishes as today"`; `"finishing with a known empty bucket term raises the term by one and removes the marker"`; the existing cases keep passing with the renamed dependency.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/rebuild-first-start.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; declare `restore.first_start_waiting_bucket`. Grep `readBucketPointerTerm\|pointerTerm` across `apps` and `packages` and move every caller.
- [ ] **Step 4: Run** it — expected PASS. Boot's use of `bucketUnreadable` (the waiting start with reason `restore`) is Task 9c; until then boot treats it as today's failure, so this task changes no running behaviour beyond the higher term.
- [ ] **Step 5: Commit** with message "A restore takes a term above every term its bucket holds, and stops when it cannot read the bucket".

### Task 7: Every wait has a reason, on the box's page and in `/api/node`

**Files:**

- Modify: `apps/server/src/waiting-start.ts`, `apps/server/src/carry-on.ts`, `apps/server/src/waiting-page.ts`, `apps/server/src/i18n/waiting-page.ts`, `apps/server/src/node-api.ts`, `apps/server/src/boot.ts` (today's peer wait passes `reason: { kind: "peers" }` and maps its outcome), `apps/server/src/guide/en/servers.md` and `apps/server/src/guide/es/servers.md` (the `#waiting` section)
- Test: `apps/server/src/waiting-start.reasons.test.ts`, `apps/server/src/node-api.test.ts`, `apps/server/src/waiting-start.test.ts`

**Interfaces:**

- Produces:
  - `export type WaitingReason = { kind: "peers" } | { kind: "bucket" } | { kind: "restore" } | { kind: "replaced"; term: number }`
  - `startWaiting<T>(deps: WaitingStartDeps<T>)`: `reason: WaitingReason` (required); `recheck?: (signal: AbortSignal) => Promise<{ wait: true; waitingOn?: readonly string[] } | { wait: false; answer: T }>` (absent: never re-asks; `waitingOn` keeps today's update of the boxes waited on, `waiting-start.ts:212`); `endsAt?: number` (milliseconds on `deps.now`; reaching it aborts the recheck in flight and ends the wait as `{ kind: "timed-out" }`); `WaitEnd<T>` gains `{ kind: "timed-out" }` and its `checked` variant carries `T`.
  - `CarryOnTurn<T>` is generic the same way, and `CarryOnDeps<T>` gains `knownSuccessor: (answer: T) => string | null` (today's `.result === "superseded"` read at `carry-on.ts:308`, moved to the peer wait's mapper in boot).
  - `CarryOnDeps.onClaimed?: (tx: NodeTransaction) => Promise<void>` — called inside the node transaction that records the carry-on, after `claim()` succeeds and before `appendHandoverEventTx`; a throw rolls the transaction back and the wait goes on. Tasks 9c and 10a pass it.
  - `CarryOnDeps.words?: { switchedOff: CarryOnWords["switchedOff"] }` per reason — `restore`: "The box this one replaced is switched off"; `replaced`: "The newer copy of this venue has been switched off"; absent keeps today's peer wording (`waiting-page.ts:37-43`). The recorded event keeps the kind `carried_on_without_peer` with `reason` added to its detail (`carry-on.ts:329-336`).
  - `NodeApiDeps.waitingFor?: () => WaitingReason["kind"] | null`; `/api/node` adds `waitingFor` to its body whenever it answers `acceptingSales: false` and the value is not `null`.
  - The page's words per reason (English; Spanish written to match):
    - `peers`: today's words, unchanged.
    - `bucket`: "Checking with the backup storage that no newer copy of this venue has taken over. Selling starts by itself within a minute."
    - `restore`: "This box was restored from a backup and cannot reach the backup storage to finish. It starts selling once it can. If the box it replaced is switched off, an administrator can carry on now."
    - `replaced`: the `start.replaced` words of Task 9a.

- [ ] **Step 1: Write the failing tests.** `waiting-start.reasons.test.ts`: one case per reason that the page shows its words in English and Spanish; `"a wait with an end time ends as timed-out, and aborts the recheck in flight"`; `"a wait with no recheck never re-asks"` (fake timers past `3 × WAIT_RECHECK_MS`); `"a carry-on hook that throws leaves the wait going"`; `"a carry-on records its reason"`; `node-api.test.ts`: `"a box waiting on the bucket says so"` (`toEqual({ acceptingSales: false, waitingFor: "bucket" })` plus the existing fields), `"a selling box names no wait"`. The existing `waiting-start.test.ts` cases pass with `reason: { kind: "peers" }` added.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/waiting-start.reasons.test.ts src/node-api.test.ts src/waiting-start.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Render each reason's page to a file and open it in the workspace's Playwright Chromium in both themes and at phone width (`CLAUDE.md` §4); keep the screenshots in the scratchpad, never committed.
- [ ] **Step 4: Update the box guide's `#waiting` section** in English and Spanish: one short paragraph per reason, saying what it means and what carrying on does on `restore` and `replaced`. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 5: Run** the Step 2 command and `pnpm format:check` — expected PASS.
- [ ] **Step 6: Commit** with message "A waiting box says what it is waiting for, on its page and to the tills".

### Task 8: The till says why the box is not selling

**Files:**

- Modify: `apps/till/src/api/server-router.ts` (read `waitingFor`), `apps/till/src/screens/till-lock-screen.ts:391-413`, `apps/till/src/till-app.ts:20811-20815` (the banner, and passing the reason to the lock screen), `apps/till/src/i18n/strings.ts` (English and Spanish), the till guide in English and Spanish where the sign-in status line is explained (find it with `grep -rln "Check again" apps/server/src/guide`)
- Test: `apps/till/src/api/server-router.test.ts`, `apps/till/src/screens/till-lock-screen.test.ts`

**Interfaces:**

- Consumes: `/api/node`'s `waitingFor` (Task 7).
- Produces:
  - `ServerRouter` keeps each server's `waitingFor: "peers" | "bucket" | "restore" | "replaced" | null` beside its `state` (parsed loosely, as `server-router.ts:184-189` parses today, so an unknown value or none reads as `null` and older boxes read as today), includes it in `statuses()` (`:91`) so the state signature (`:149-158`) changes when only the reason changes, and exposes `waitingReason(): ... | null` for the current server.
  - The lock screen gains a property `waitingReason`, which `till-app.ts` passes in; a server's row whose `waitingFor` is set shows the reason's short form instead of "standby, not promoted" (`till-lock-screen.ts:398-399`).
  - Strings `server.waiting.peers`, `server.waiting.bucket`, `server.waiting.restore`, `server.waiting.replaced`, shown on the sign-in status line and in the banner instead of `server.waiting_promotion` when the router names a reason. English:
    - `peers`: "The box is waiting to hear from the other box before it sells."
    - `bucket`: "The box is checking with the backup storage before it sells. Selling starts within a minute."
    - `restore`: "The box was restored from a backup and is waiting to reach the backup storage."
    - `replaced`: "The box has stopped: a newer copy of this venue is running elsewhere. An administrator can carry on from the box's page."

- [ ] **Step 1: Write the failing tests**: `server-router.test.ts` — `"a box waiting on the bucket is a standby with that reason"`, `"a box answering no reason, or one the till does not know, has none"`, `"a change of reason alone notifies the screen"`; `till-lock-screen.test.ts` — one case per reason in English and Spanish (restore the screen language after each, `CLAUDE.md` §4), and `"with no reason the status line reads as today"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/api/server-router.test.ts src/screens/till-lock-screen.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; screenshot the sign-in screen and the banner for one reason in both themes at phone width (scratchpad only).
- [ ] **Step 4: Update the till guide** in English and Spanish (one short paragraph: the line says why selling has not started, and what to do — wait, or ask an administrator for `replaced` and `restore`); run `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 5: Run** the Step 2 command and `pnpm format:check` — expected PASS.
- [ ] **Step 6: Commit** with message "A till says why the box is not selling yet".

### Task 9a: The start decision and the alerts

**Files:**

- Create: `apps/server/src/start-decision.ts`, `apps/server/src/start-alerts.ts`
- Modify: `apps/server/src/errors.ts`, `packages/db/src/alerts.ts` (`CORE_ALERTS`), `apps/dashboard/src/i18n/alert-messages.ts`, `apps/server/src/box-alert-email.ts` (`INCIDENT_EMAIL_CODES`, `wordsFor`, `TIME_PLACEHOLDERS`), `apps/server/src/i18n/box-emails.ts`, `scripts/alert-codes.test.ts` (`INCIDENT_CODE_SOURCES`)
- Test: `apps/server/src/start-decision.test.ts`, `apps/server/src/start-alerts.test.ts`, `apps/server/src/box-alert-email.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`

**Interfaces:**

- Consumes: `BucketAnswer` (Task 5), `StopMark` (Task 1).
- Produces:
  - `export const START_ANSWER_WAIT_MS = 60_000`, `export const START_FIRST_ASK_MS = 5_000`, `export const START_ANSWER_RETRY_MS = 5_000`
  - `export type BucketVerdict = { kind: "sell" } | { kind: "replaced"; venueId: string; term: number; nodeId: string; via: "pointer" | "claim" } | { kind: "ask_again" }`
  - `export function bucketVerdict(answer: BucketAnswer): BucketVerdict` — `no_answer` → `ask_again`; `replaced` → `replaced`; the rest → `sell`.
  - `export function askBound(startedAt: number, now: number): number` — `min(BUCKET_CHECK_TIMEOUT_MS, START_ANSWER_WAIT_MS - (now - startedAt))`, never below 0.
  - In `start-alerts.ts`, each one `withTransaction` and one `recordIncidentOnce`, with `origin` as `backup-deletion-alert.ts:40` builds it:
    - `recordUnplannedStop(db: Database, lastRunningAt: Date | null, offsetMinutes: number, now: Date): Promise<void>` — `start.unplanned_stop`, severity `warning`, params `{ lastRunningAt: iso | null, lastRunningOffsetMinutes }`; the offset is the venue zone's offset at `lastRunningAt`, worked out as `packages/fiscal-verifactu/src/clock-behind.ts:159-164` does for `lastRecordOffsetMinutes`.
    - `recordSellingUnconfirmed(db: Database, now: Date): Promise<void>` — `start.selling_unconfirmed`, `warning`, no params.
    - `recordReplaced(db: Database, record: { term: number; via: "pointer" | "claim" }, now: Date): Promise<void>` — `start.replaced`, `error`, params `{ term, via }`.
  - `CORE_ALERTS.events` gains `{ prefix: "start.", area: "box", permission: "system.manage" }`; `INCIDENT_EMAIL_CODES` gains the three codes; `TIME_PLACEHOLDERS` gains `lastRunningAt: "lastRunningOffsetMinutes"`.

  Words (English; Spanish written to match in the same files):
  - `start.unplanned_stop`: "The box stopped without warning; it was last running at {lastRunningAt}. A power cut, a crash or a forced stop does this." With no time: "The box stopped without warning. A power cut, a crash or a forced stop does this."
  - `start.selling_unconfirmed`: "The box started selling after waiting a minute without hearing from the backup storage. It keeps asking, and stops selling if it learns a newer copy of this venue has taken over."
  - `start.replaced`: "The box has stopped selling and filing: the backup storage shows a newer copy of this venue (term {term}) running elsewhere. If that copy has been switched off, an administrator can carry on here from the box's own page."

- [ ] **Step 1: Write the failing tests.** `start-decision.test.ts`: `bucketVerdict` for each `BucketAnswer` kind; `askBound` at 0 s (15,000), 50 s (10,000), 55 s (5,000) and 61 s (0). `start-alerts.test.ts`: per recorder, code, severity and params read back from `incidents`; a second call writes no second open row. `box-alert-email.test.ts`: `boxEmailMessage` for each code in `en` and `es`, the unplanned one with and without a time, the replaced one containing the term.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/start-decision.test.ts src/start-alerts.test.ts src/box-alert-email.test.ts` and `pnpm exec vitest run scripts/alert-codes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; add `apps/server/src/start-alerts.ts` to `INCIDENT_CODE_SOURCES`.
- [ ] **Step 4: Run** them plus `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` — expected PASS.
- [ ] **Step 5: Commit** with message "The start-up verdict for a one-box venue, and three start-up alerts in English and Spanish".

### Task 9b: Wiring the start: the mark, the replaced record, the alerts and arming

**Files:**

- Modify: `apps/server/src/node-entry.ts` (`runEntry`, `EntryDeps.startServer`, `bootThisProcess`), `apps/server/src/boot.ts` (`StartServerSeams`, `bootServer`), `CLAUDE.md` §5, `docs/developers/conventions-data.md`
- Test: `apps/server/src/boot.stop-mark.test.ts`, `apps/server/src/node-entry.test.ts`, `apps/server/src/run-server.stop-mark.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 5 and 9a.
- Produces:
  - `EntryDeps.startServer: (env, base, previousHolder: VenueHolder | null) => Promise<StartedEntryServer>`; `runEntry` reads `(deps.readVenueHolder ?? readVenueHolder)(deps.venueDir)` as its FIRST statement (before `freeSpaceAtStart`, `deleteOldBackupsAtStart` or first-setup admission can take and release the lock and remove the file), and passes it through.
  - `StartServerSeams.previousHolder?: VenueHolder | null`; `bootThisProcess` passes it as `startServer(env, base, { previousHolder })`. Unset (the `bin.ts` path) means `null`.
  - `StartServerSeams.bucketStart?: (deps) => Promise<BucketVerdict | "timed-out">` — the bucket decision Task 9c fills; until then it answers `{ kind: "sell" }`, so this task changes no wait.

  In `bootServer`, in this order:
  1. At the top, before the setup and adoption branches: `const mark = await takeStopMark(config.stateDir, log)`. Every path consumes it.
  2. On a box that is not a mirror and not fenced, after `const fenced = …` and before `runFirstStart`: `readReplaced(stateDir, venueId, ownTerm, log)`; a record serves the replaced start (Task 10b) without asking anything — until Task 10b lands, throw `AppError("start.replaced", …)`, covered by one case. Otherwise, when `chartListsCountedPeer` is false and the mark is not `restart`, `bucketStart`. A `restart` mark sells at once (design §3; Task 11's watch asks).
  3. A `replaced` verdict: `writeReplaced` first, then as step 2's record.
  4. Once the start sells, on a box that is not a mirror and not fenced: record `start.unplanned_stop` when `previousHolder` is not `null` and `REBUILD_MARKER` was absent at the start; record `start.selling_unconfirmed` after `timed-out`.
  5. At the end of `bootServer`, once the trading listener is up, on a box that is not a mirror and not fenced: `armRestartMark(config.stateDir)`, with `disarmRestartMark` pushed onto `undoOnFailure`.

  Paths and what each records: restricted (`boot.ts:1820`) and superseded (`boot.ts:1921`): consume the mark, record nothing. Mirror: consumes, records nothing, never armed. Zone repair (`boot.ts:2100`): records as step 4 says, never armed. Peer wait that carries on or is answered: records as step 4, armed at the end.

- [ ] **Step 1: Write the failing tests.**
  - `node-entry.test.ts`: `"the previous holder is read before anything can take the lock"` (a `readVenueHolder` spy is called before `freeSpaceAtStart`'s statfs and before `lockVenue`; `startServer` receives the holder).
  - `boot.stop-mark.test.ts` (the boot suites' helpers; a `bucketStart` seam): `"a box whose last stop was clean sells at once and asks nothing before it sells"` (`bucketStart` not called); `"a power cut records an unplanned stop with the last heartbeat time"`; `"a clean restart the box made itself while not trading records nothing"`; `"a two-box chart takes the existing peer check and no bucket decision"`; `"a restored box's first start records no unplanned stop"`; `"a replaced record stops the box without asking"`; `"a replaced verdict saves the record first"`; `"a mirror consumes the mark and records nothing"`; `"a start that fails after arming leaves the box unarmed"`.
  - `run-server.stop-mark.test.ts`, in a child process as `run-server.signals.test.ts` does (never `process.exit` in the worker): `"a clean stop of a trading box leaves restart; of a waiting box leaves nothing"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.stop-mark.test.ts src/node-entry.test.ts src/run-server.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Amend `CLAUDE.md` §5.** Under "Nothing EXTERNAL may block a sale", add: "The exceptions (A1418, owner 2026-11-07): after a start with no stop mark, a box whose chart counts no other box waits up to 60 seconds for its bucket; a verified answer that it was replaced stops it until an administrator carries on; and a restored box that cannot read its bucket waits until it can or an administrator carries on." Under "The bucket stream never waits on the bucket to sell", add: "A1418's start-up check is not the stream; it waits at most 60 seconds." Put the receipt (design §1 and §3, this plan's Decisions 1 and 4–7) in `docs/developers/conventions-data.md` under a heading the new pointer names.
- [ ] **Step 5: Run** the Step 2 command, `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm format:check` — expected PASS.
- [ ] **Step 6: Commit** with message "A box takes its stop mark at every start, records an unplanned stop, and arms the mark only while trading".

### Task 9c: The bucket wait and the restore wait

**Files:**

- Create: `apps/server/src/bucket-start.ts`
- Modify: `apps/server/src/boot.ts` (fill `bucketStart`; serve the restore wait after `runFirstStart`)
- Test: `apps/server/src/bucket-start.test.ts`, `apps/server/src/boot.stop-mark.test.ts`

**Interfaces:**

- Consumes: Task 5's `checkBucketReplaced`, Task 6's `readBucketTerm` and `completeRebuild(deps, known)`, Task 7's `startWaiting<T>` (reasons `bucket` and `restore`, `endsAt`, `onClaimed`, `words`), Task 9a's `bucketVerdict`, `askBound` and constants.
- Produces:
  - `export async function runBucketStart(deps: { ask: (timeoutMs: number, signal: AbortSignal) => Promise<BucketAnswer>; serveWait: (recheck, endsAt: number) => Promise<WaitEnd<BucketVerdict>>; now: () => number }): Promise<BucketVerdict | "timed-out">` — one ask bounded at `START_FIRST_ASK_MS`; on `ask_again`, the waiting start with reason `bucket`, `recheck` = one ask bounded by `askBound`, every `START_ANSWER_RETRY_MS`, `endsAt` = first ask + `START_ANSWER_WAIT_MS`.
  - In boot, `runFirstStart` answering `bucketUnreadable`: the waiting start with reason `restore`, `recheck` = `readBucketTerm` only, every `WAIT_RECHECK_MS`; an answer finishes with `completeRebuild(deps, { bucketTerm })` once. The carry-on (`words` for `restore`) passes `onClaimed` = `completeRebuild(deps, { bucketTerm: null })` inside the node transaction (venue.db saved first, `CLAUDE.md` §3). Either way the start then goes on.

- [ ] **Step 1: Write the failing tests.** `bucket-start.test.ts` (fake clock): `"an answer to the first ask decides without a page"` (`serveWait` not called); `"silence serves the bucket wait and ends it at a minute"`; `"an answer during the wait ends it at once"`; `"no ask runs past the minute"`. `boot.stop-mark.test.ts`: `"a silent bucket serves the bucket wait, which tills read from /api/node, and sells unconfirmed at a minute"`; `"a restored box whose bucket cannot be read waits with reason restore, sells nothing, and reissues its certificate once"`; `"the restore wait finishes by itself once the bucket answers, at a term above the bucket's"`; `"carrying on at the restore wait finishes the restore and sells"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bucket-start.test.ts src/boot.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it and `pnpm format:check` — expected PASS.
- [ ] **Step 5: Commit** with message "After a stop without a mark, a one-box venue asks its bucket for up to a minute, showing why; a restore that cannot read its bucket waits".

### Task 10a: Carrying on after being replaced

**Files:**

- Modify: `apps/server/src/waiting-page.ts`, `apps/server/src/i18n/waiting-page.ts`, `apps/server/src/carry-on.ts`
- Test: `apps/server/src/waiting-start.replaced.test.ts`, `apps/server/src/waiting-start.test.ts` (where the carry-on cases live)

**Interfaces:**

- Consumes: `WaitingReason`, `onClaimed` and `words` (Task 7), `clearReplaced` (Task 1), `mintNextMembershipDocument` (`apps/server/src/membership-mint.ts:46`), `persistNodeMembershipIfNewer`, `markIncidentHandled` (`packages/core/src/incidents.ts:315`).
- Produces:
  - With reason `replaced`, the page offers the carry-on form with its two existing confirmations, the first worded "The newer copy of this venue has been switched off".
  - The `onClaimed` hook (Task 7) for `replaced` mints a chart with `minTerm: term + 1`, signed by this box, as `completeRebuild` does (`rebuild-first-start.ts:127-140`), saves it to `venue.db` with `persistNodeMembershipIfNewer`, then marks the open `start.replaced` incident handled (system, `personId: null`); after the node transaction commits, `clearReplaced`. A throw rolls the node transaction back and the wait goes on.

- [ ] **Step 1: Write the failing tests.**
  - `waiting-start.replaced.test.ts`: `"a replaced box sells nothing and files nothing"` (the probes `waiting-start.test.ts` uses: `/health` takes no sales, no till sale route, no filing duty); `"its page names the newer copy's term and offers carry-on"`.
  - `waiting-start.test.ts`: `"carrying on after replaced raises the box's term above the newer copy's"` (held term 5, replacement 6 → saved chart term ≥ 7, signed by this node; `start.replaced` handled; `replaced.json` gone); `"a carry-on whose term raise fails does not end the wait"` (`onClaimed` throws → failure shown, wait goes on, no chart saved, `replaced.json` kept); `"a stop during a carry-on leaves the raised chart saved and the box not carried on"` (shutdown begins after `claim()`; `finish()` returns `false`; the chart is saved); the existing carry-on cases pass unchanged.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/waiting-start.replaced.test.ts src/waiting-start.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; screenshot the replaced page in both themes at phone width (scratchpad only).
- [ ] **Step 4: Run** it and `pnpm format:check` — expected PASS.
- [ ] **Step 5: Commit** with message "Carrying on after being replaced raises the box's term above the newer copy's".

### Task 10b: Serving the replaced start and its email

**Files:**

- Modify: `apps/server/src/boot.ts` (replace Task 9b's throw)
- Test: `apps/server/src/boot.stop-mark.test.ts`

**Interfaces:**

- Consumes: Task 7's reason `replaced`, Task 10a's carry-on, `recordReplaced` (Task 9a), `startBoxEmailDuty` (`box-alert-email.ts:257`).
- Produces: boot serves the waiting start with reason `replaced` and no `recheck`, after `recordReplaced`, and runs `startBoxEmailDuty` beside it with `isPrimary: () => true`, the disk and space states boot already holds, `moduleNotices` answering none and `backupStopped` answering `undefined`; the duty is stopped when the wait ends. After carrying on, boot goes on as after a carried-on peer wait.

- [ ] **Step 1: Write the failing tests** in `boot.stop-mark.test.ts`: `"a box told it was replaced serves the replaced page, records start.replaced and not start.unplanned_stop, and emails it once"` (the email seam gets one `start.replaced` message within one `BOX_EMAIL_CHECK_MS`); `"tills read waitingFor replaced from /api/node"`; `"a replaced box restarted with its bucket out of reach stays stopped"`; `"after carrying on, the box sells and its stream opens a generation at the raised term"`; `"after carrying on, the full start emails nothing more about the replacement"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the Step 2 command and `pnpm format:check` — expected PASS; check that the guide's `#waiting` paragraph for `replaced` (Task 7) still matches what the page does.
- [ ] **Step 5: Commit** with message "A box told it was replaced stays stopped and emails the managers".

### Task 11: The watch while selling

**Files:**

- Create: `apps/server/src/replaced-watch.ts`
- Modify: `apps/server/src/background-duties.ts` (a closer `replacedWatch`, `atStepdown: true`), `apps/server/src/boot.ts` (start it on the full trading path of a box whose chart counts no other box and that has stream settings)
- Test: `apps/server/src/replaced-watch.test.ts`, `apps/server/src/handover-stepdown.test.ts` (its closer table), `apps/server/src/boot.stop-mark.test.ts`

**Interfaces:**

- Consumes: `checkBucketReplaced` (Task 5), `writeReplaced`, `disarmRestartMark` (Tasks 1–2), `recordReplaced` (Task 9a), `restartProcess` (`run-server.ts`).
- Produces:
  - `export const REPLACED_WATCH_MS = 600_000`
  - `export function startReplacedWatch(deps: { ask: (signal: AbortSignal) => Promise<BucketAnswer>; onReplaced: (answer: Extract<BucketAnswer, { kind: "replaced" }>) => Promise<void>; intervalMs: number; log: Logger; timer?: (ms: number, fn: () => void) => Timer }): { stop: () => Promise<void> }` — asks at once, then every `intervalMs`; never two asks at once; on `replaced` awaits `onReplaced` once and asks no more. `stop` cancels the next ask and aborts the one in flight, settling within 100 ms of the abort. Boot's `onReplaced`: `writeReplaced`, `recordReplaced`, `disarmRestartMark()`, then `restartProcess()`.

- [ ] **Step 1: Write the failing tests**: `"it asks at once and then every interval"`; `"a slow ask is not overlapped by the next"`; `"replaced saves the record before the restart, once, and stops asking"` (call order `["write", "record", "disarm", "restart"]`); `"no_answer and clear keep it asking"`; `"stop aborts an ask that hangs"`; `handover-stepdown.test.ts`'s closer table includes `replacedWatch` with `atStepdown: true`; in `boot.stop-mark.test.ts`, `"a selling box that learns it was replaced writes no mark and restarts into the replaced start"` (the bucket flips to a verified newer pointer; the restart seam is called; `stop-mark.json` absent; `replaced.json` present).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/replaced-watch.test.ts src/handover-stepdown.test.ts src/boot.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** and wire it.
- [ ] **Step 4: Run** it — expected PASS.
- [ ] **Step 5: Commit** with message "A selling box keeps asking its bucket, and stops when a newer copy has taken over".

---

## After the last task

- Update `docs/backlog.md`'s A1418 entry (part 1 built; parts 2 and 3 left) and the ledger `docs/handoffs/2026-11-07-a1418-box-stop-intent.md`.
- `/finish-branch` on the worktree, with the note: "A1418 part 1, plan `docs/superpowers/plans/2026-11-07-a1418-part-1-stop-marks.md`; risk triggers fiscal filing, start-up, concurrency; Task 5's answer to design §8 question 1 goes in the PR body".
