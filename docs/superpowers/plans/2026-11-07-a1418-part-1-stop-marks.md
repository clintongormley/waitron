# A1418 part 1: the stop mark, the start-up bucket check and the alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** A box records a clean stop, knows at its next start how it last stopped, asks the backup bucket whether it has been replaced, waits at most 60 seconds for that answer after a stop without a mark, stays stopped once told it was replaced (unless an administrator carries on), and emails the managers about each of these.

**Architecture:** Two small files in the state folder. `stop-mark.json` is written by the shutdown handler only while the box is trading, and taken (read and removed) at the top of `bootServer`. `replaced.json` is written the moment a box learns it was replaced and is cleared only by carrying on, so the knowledge survives every restart. A pure check in `@waitron/stream` reads the bucket's pointer and the claims of the next term and verifies each signature; `apps/server` wraps it with the box's settings, term and trust set. `bootServer` uses the answer on a box whose chart lists no other joined box; the two-box path is unchanged. A replaced box serves the existing waiting start in a new "replaced" variant, whose carry-on raises the box's term above the replacement's. A background watch keeps asking while the box sells.

**Tech Stack:** TypeScript, Node 26, Hono, Vitest 4, `@waitron/stream`'s `ObjectStore`, `@waitron/membership`'s `signBytes`/`verifyBytes`.

**Spec:** `docs/superpowers/specs/2026-11-07-a1418-box-stop-intent-design.md` (approved 2026-11-07). Part 1 is design §10 item 1: §2 (the `restart` mark only), §3 without Cloud (part 3), three of §6's four alerts (the fourth, "shutdown paused", is part 2) and §9's `CLAUDE.md` amendments.

## Global Constraints

- Risk triggers: fiscal filing, start-up and concurrency. Full review path: per-task reviews, and the full `/finish-branch` wave with the Codex run-it seat run twice.
- Unchanged: `SHUTDOWN_DEADLINE_MS` = 8000 (`apps/server/src/run-server.ts:31`) and the 5-second Litestream kill grace.
- Both files live in the state folder, beside `spare-space.released`, never in `venue.db` or `node.db`. Each is written to a temporary name, flushed to disk (`fsync`), then renamed.
- Part 1 writes one mark value, `restart`. `shutdown` and its start row are part 2; part 1's reader treats any other content as no mark.
- The wait after a start with no mark is at most `START_ANSWER_WAIT_MS = 60_000`, ends as soon as the bucket answers, and no single ask runs past it.
- A box with no bucket settings (`readStreamSettings` returns `null`) has nobody to ask and does not wait.
- "Replaced" (Decision 1) = a pointer or a claim that verifies against the signer's key in this box's trust set and names a term higher than this box's held chart term. One that does not verify is no answer.
- A restored box skips the bucket check while `REBUILD_MARKER` (`rebuild-first-start.json`) is in its state folder.
- Claim signatures use the purpose string `"waitron.stream.claim.v1"`, as the pointer uses `"waitron.stream.pointer.v1"`.
- Three incident codes, each with an area claim, English and Spanish dashboard words and email words: `start.unplanned_stop`, `start.selling_unconfirmed`, `start.replaced`. Recorded only on a box that is not a mirror and not fenced (a mirror's `venue.db` is a copy).
- Saving the raised chart when carrying on follows `CLAUDE.md` §3: `node.db`'s lock outside, `venue.db` saved first, `node.db` after.
- General code is English only. Page and email words in English and Spanish. A screen change updates its guide in both.
- Coverage 98/98/98/95 in every package touched. Every commit `git commit -s`. Work in a worktree made with `python3 ~/workspace/tools/worktree.py new waitron feat/a1418-stop-marks --headless`.
- No backwards compatibility: an unsigned claim already in a bucket is no answer (`CLAUDE.md` §3, pre-live rule).

## Decisions this plan makes (for the owner)

1. **Equal term is not "replaced".** The design's default also counted "a different box's generation at an equal term". A restore reuses the dead box's node id (design §3), and a box opens a new generation at its own term at every start (`packages/stream/src/supervisor.ts:432`, read), so the old box cannot tell another box's generation at its term from one of its own. A restore takes a term above the pointer it read (`rebuild-first-start.ts:127-137`, read), so the case needs a restore that read no pointer.
2. **The restored box can be verified by the old one.** The node signing key is sealed in `node.db` under the node id (`packages/credentials/src/node-signing-key.ts:25,35-56`, read); an archive restore puts `node.dump` and `secrets/*` back unless `skipSecrets` is set (`restore.ts:409`, read); a stream restore unseals it with the recovery key (`restore-stream.ts:327-334`, read); `completeRebuild` makes no new key. A stream restore's key is already asserted equal in `apps/server/src/testing/stream-loop-scenario.ts:589-592`; Task 5 adds the archive case. A `skipSecrets` restore keeps the target's own identity, so it is not "the same box".
3. **Only claims at the next term are listed.** `ObjectStore.list(prefix)` has no delimiter (`packages/stream/src/object-store.ts:34`), so listing every generation lists every file. The check lists `gen-<term+1>-`; a higher term is caught by the pointer once that box's first full copy lands.
4. **Being replaced is saved, in `replaced.json`.** Written before the replaced page is served and before a selling box restarts; read at every start before the bucket is asked; cleared only by carrying on. It names the venue and the replacement's term, and is ignored (and removed) once the box's held chart term is above that term or the venue differs, so a restore from the newer copy or a reset never trips on it. Without it, a replaced box restarted with its bucket out of reach would sell after 60 seconds.
5. **The mark is written only by a trading box.** Armed at the end of `bootServer` on a box that is not a mirror and not fenced, disarmed on a failed start. A clean stop while waiting, replaced, in repair or during the 60 seconds writes nothing.
6. **"Stopped without warning" is told by the venue holder file, not by a missing mark.** The holder file beside `venue.lock` is removed by a clean close and left behind by a power cut, a crash or a forced kill (`packages/store/src/venue-holder.ts:7,106`). The alert is raised when the previous holder file was found at the top of `runEntry`, and never for a restored box's first start. Every restart the box makes for itself while not trading (setup finishing `setup-api.ts:976,1082,1160,1220,1235`, a time-zone repair `boot.ts:2178`, first-setup launch `first-setup-launch.ts:90`) closes cleanly, so it raises nothing; it still waits for the bucket, usually seconds. A stop that reaches the 8-second deadline exits before the store closes and leaves the file (read, `venue-liveness.ts:319-323`), so it is reported as unplanned.
7. **No page during the 60-second wait.** The box does not listen until the wait ends, as during today's 5-second peer check. Tills see it as unreachable for up to a minute after a power cut with the bucket out of reach. The health check's start period is 60 seconds (`deploy/compose.yml:69`), and nothing that sells, files or streams starts before the decision point (plan review, every start between `boot.ts:1212` and `boot.ts:1990` listed, read).
8. **The watch asks every 10 minutes** (`REPLACED_WATCH_MS = 600_000`), at once when the box sells and then on the interval: one GET and one LIST each time, about 4,320 of each a month. The plan review judged the cost trivial; it was not checked against PR #2524's figures.
9. **A late "replaced" saves `replaced.json` and restarts the process**, and the restart serves the replaced start from the file, whatever the bucket says then.
10. **The bucket check and the watch run only on a box whose chart lists no other joined box that it counts** (the `counted` peers of `checkPeersAtStart`, `boot-peer-check.ts:135-137`). The design's two-box column is "the existing check, unchanged", and there the main box streams to the spare's store (design §4, A947 §3).
11. **A second unplanned stop while the first alert is still open records nothing new**: `recordIncidentOnce` skips an open duplicate (`packages/core/src/incidents.ts:118-150`). The open alert already says it happened.

## Review Focus

1. **A replaced box restarted with its bucket out of reach** stays stopped — Task 6b pins it.
2. **A newer pointer signed by a key this box does not hold** is no answer, never "clear" and never "replaced" — Task 4 pins it.
3. **A bucket that hangs** keeps each ask within the time left of the 60 seconds, and a stop of the watch inside the shutdown deadline — Tasks 5, 6a and 8 pin it.
4. **The restored box's own first start** does not find itself replaced and raises no unplanned-stop alert — Tasks 5 and 6b pin it.
5. **A stop during a carry-on** leaves the raised chart saved and the box not carried on — Task 7a pins it.

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
  - `export async function readReplaced(stateDir: string, venueId: string, ownTerm: number, log: Logger): Promise<ReplacedRecord | null>` — `null` when missing; when the venue differs or `ownTerm > record.term`, removes the file, logs `info` `start.replaced_cleared`, `null`. Unreadable: logs `warn` `server.replaced_unreadable` and returns a record with `term: Number.MAX_SAFE_INTEGER` (an unreadable record stops the box; only carrying on clears it).
  - `export async function clearReplaced(stateDir: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** on a `mkdtemp` folder:
  - `"a written restart mark is taken once, then gone"`; `"no file is no mark"` (logs nothing); `"an unreadable mark counts as none and is removed"` for `"{"`, `'{"version":2,"mark":"restart"}'` and `'{"version":1,"mark":"shutdown"}'`; `"the write leaves no temporary file behind"` (`readdirSync(dir)` equals `[STOP_MARK_FILE]`).
  - `"a replaced record holds while the box's term is not above it"` (record term 6, own 6 → the record); `"a replaced record clears once the box's term is above it"` (own 7 → `null`, file gone); `"a record for another venue clears"`; `"an unreadable record stops the box"` (`term` is `Number.MAX_SAFE_INTEGER`, file kept).
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

### Task 4: Finding a newer term in the bucket

**Files:**

- Create: `packages/stream/src/replacement.ts`
- Modify: `packages/stream/src/index.ts`
- Test: `packages/stream/src/replacement.test.ts`

**Interfaces:**

- Consumes: `readPointer`, `verifyPointer` (`pointer.ts`), `readClaim`, `verifyClaim` (Task 3), `venuePrefix`, `parseGenerationName` (`names.ts`).
- Produces:
  - `export type ReplacementAnswer = { kind: "replaced"; term: number; nodeId: string; generation: string; via: "pointer" | "claim" } | { kind: "clear" } | { kind: "unverified"; term: number }`
  - `export async function findReplacement(store: ObjectStore, venueId: string, ownTerm: number, publicKeyOf: (nodeId: string) => string | undefined, call?: StoreCall): Promise<ReplacementAnswer>` — passes `call` (and its abort signal) to every store call; throws whatever the store throws.

  Order: the pointer (one GET); then one `list(`${venuePrefix(venueId)}gen-${ownTerm + 1}-`)`, the distinct generation names in its keys, and `readClaim` for each. The first that verifies with a term above `ownTerm` is `replaced`. Anything above `ownTerm` that does not verify, or whose signer has no key, makes the answer `unverified` unless another verifies. Otherwise `clear`.

- [ ] **Step 1: Write the failing tests** (in-memory store; key pairs `old` and `stranger`): `"no pointer and no claims is clear"`; `"a pointer at this box's own term is clear"`; `"a verified pointer at a higher term is replaced, via the pointer"` (`toEqual({ kind: "replaced", term: 6, nodeId: "node-a", generation, via: "pointer" })`); `"a higher pointer signed by a key this box does not hold is unverified"` (`toEqual({ kind: "unverified", term: 6 })`); `"a higher pointer whose signature is wrong is unverified"`; `"a verified claim at the next term is replaced before any full copy lands"` (`via: "claim"`); `"a claim two terms up is not listed"` (`clear`, and exactly one `list` call, prefix ending `gen-6-` for own term 5); `"an aborted call stops the check"` (the signal reaches the store; the check rejects); `"a store that throws makes the check throw"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/stream exec vitest run src/replacement.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** `findReplacement`.
- [ ] **Step 4: Run** it and `pnpm --filter @waitron/stream test:coverage` — expected PASS.
- [ ] **Step 5: Commit** with message "The bucket can tell a box whether a newer copy of it has taken over".

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
  - `"a hanging bucket answers no_answer within the bound"` (`get` never settles, `timeoutMs: 50`);
  - `"an aborted signal ends the read at once"`;
  - `"a box restored from an archive signs pointers the original box verifies"`: restore an archive of this venue into a second state folder with `restoreFromArtifact` (`apps/server/src/restore.ts:534`; `attendance-restore.test.ts` shows the setup), sign a pointer at term + 1 with the restored copy's `readNodeIdentityKey`, and the ORIGINAL box's `checkBucketReplaced` answers `replaced`. The receipt for Decision 2; if it fails, stop and report;
  - `start-peer-check.test.ts`: `chartListsCountedPeer` is false for a one-box chart, for a listed but unjoined box and for a box in `readActivatedFrom`; true for a joined `serving-secondary`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/bucket-replaced-check.test.ts src/start-peer-check.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it — expected PASS.
- [ ] **Step 5: Answer design §8 question 1** in the branch's PR notes (keep a draft in the ledger): read `apps/server/src/restore-stream.ts`'s refusal of a generation changed in the last few minutes and say, with `file:line`, whether it stops a mistaken restore of the live venue, and that the old box now verifies the pointer (this task's test).
- [ ] **Step 6: Commit** with message "A box can ask its bucket whether it has been replaced".

### Task 6a: The start decision and the alerts

**Files:**

- Create: `apps/server/src/start-decision.ts`, `apps/server/src/start-alerts.ts`
- Modify: `apps/server/src/errors.ts`, `packages/db/src/alerts.ts` (`CORE_ALERTS`), `apps/dashboard/src/i18n/alert-messages.ts`, `apps/server/src/box-alert-email.ts` (`INCIDENT_EMAIL_CODES`, `wordsFor`, `TIME_PLACEHOLDERS`), `apps/server/src/i18n/box-emails.ts`, `scripts/alert-codes.test.ts` (`INCIDENT_CODE_SOURCES`)
- Test: `apps/server/src/start-decision.test.ts`, `apps/server/src/start-alerts.test.ts`, `apps/server/src/box-alert-email.test.ts`, `apps/dashboard/src/i18n/alerts.test.ts`

**Interfaces:**

- Consumes: `BucketAnswer` (Task 5), `StopMark` (Task 1).
- Produces:
  - `export const START_ANSWER_WAIT_MS = 60_000`, `export const START_ANSWER_RETRY_MS = 5_000`
  - `export type StartDecision = { kind: "sell"; confirmed: boolean } | { kind: "replaced"; venueId: string; term: number; nodeId: string; via: "pointer" | "claim" }`
  - `export async function decideOneBoxStart(deps: { mark: StopMark | null; ask: (timeoutMs: number) => Promise<BucketAnswer>; now: () => number; sleep: (ms: number) => Promise<void> }): Promise<StartDecision>` — `restart`: sells at once, `confirmed: true`, no ask (design §3: "Sells at once; asks alongside"; Task 8's watch asks). No mark: asks with `timeoutMs = min(BUCKET_CHECK_TIMEOUT_MS, time left)` until an answer other than `no_answer`, sleeping `min(START_ANSWER_RETRY_MS, time left)` between asks; at `START_ANSWER_WAIT_MS` it sells with `confirmed: false`. `nobody_to_ask`, `restoring` and `clear` sell `confirmed: true`.
  - In `start-alerts.ts`, each one `withTransaction` and one `recordIncidentOnce`, with `origin` as `backup-deletion-alert.ts:40` builds it:
    - `recordUnplannedStop(db: Database, lastRunningAt: Date | null, offsetMinutes: number, now: Date): Promise<void>` — `start.unplanned_stop`, severity `warning`, params `{ lastRunningAt: iso | null, lastRunningOffsetMinutes }`. The offset is the venue zone's offset at `lastRunningAt`, worked out as `packages/fiscal-verifactu/src/clock-behind.ts:159-164` does for `lastRecordOffsetMinutes`.
    - `recordSellingUnconfirmed(db: Database, now: Date): Promise<void>` — `start.selling_unconfirmed`, `warning`, no params.
    - `recordReplaced(db: Database, record: { term: number; via: "pointer" | "claim" }, now: Date): Promise<void>` — `start.replaced`, `error`, params `{ term, via }`.
  - `CORE_ALERTS.events` gains `{ prefix: "start.", area: "box", permission: "system.manage" }`; `INCIDENT_EMAIL_CODES` gains the three codes; `TIME_PLACEHOLDERS` gains `lastRunningAt: "lastRunningOffsetMinutes"`.

  Words (English; Spanish written to match in the same files):
  - `start.unplanned_stop`: "The box stopped without warning; it was last running at {lastRunningAt}. A power cut, a crash or a forced stop does this." With no time: "The box stopped without warning. A power cut, a crash or a forced stop does this."
  - `start.selling_unconfirmed`: "The box started selling after waiting a minute without hearing from the backup storage. It keeps asking, and stops selling if it learns a newer copy of this venue has taken over."
  - `start.replaced`: "The box has stopped selling and filing: the backup storage shows a newer copy of this venue (term {term}) running elsewhere. If that copy has been switched off, an administrator can carry on here from the box's own page."

- [ ] **Step 1: Write the failing tests.**
  - `start-decision.test.ts` (fake clock and `sleep`): `"restart sells at once without asking"` (`ask` not called); `"no mark and a clear answer sells confirmed after one ask"`; `"no mark and silence sells unconfirmed at 60 seconds, not before"` (no decision at 59 s; `confirmed: false` at 60 s); `"no ask runs past the minute"` (an ask that starts at 55 s gets `timeoutMs` 5,000); `"no mark and replaced at 20 seconds stops"`; `"nobody to ask does not wait"` (no `sleep`).
  - `start-alerts.test.ts`: per recorder, code, severity and params read back from `incidents`; a second call writes no second open row.
  - `box-alert-email.test.ts`: `boxEmailMessage` for each code in `en` and `es`, the unplanned one with and without a time, the replaced one containing the term.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/start-decision.test.ts src/start-alerts.test.ts src/box-alert-email.test.ts` and `pnpm exec vitest run scripts/alert-codes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement**; add `apps/server/src/start-alerts.ts` to `INCIDENT_CODE_SOURCES`.
- [ ] **Step 4: Run** them plus `pnpm --filter @waitron/dashboard exec vitest run src/i18n/alerts.test.ts` — expected PASS.
- [ ] **Step 5: Commit** with message "The start-up decision for a one-box venue, and three start-up alerts in English and Spanish".

### Task 6b: Wiring the decision into the start

**Files:**

- Modify: `apps/server/src/node-entry.ts` (`runEntry`, `EntryDeps.startServer`, `bootThisProcess`), `apps/server/src/boot.ts` (`StartServerSeams`, `bootServer`), `CLAUDE.md` §5, `docs/developers/conventions-data.md`
- Test: `apps/server/src/boot.stop-mark.test.ts`, `apps/server/src/node-entry.test.ts`, `apps/server/src/run-server.stop-mark.test.ts`

**Interfaces:**

- Consumes: Tasks 1, 2, 5 and 6a.
- Produces:
  - `EntryDeps.startServer: (env, base, previousHolder: VenueHolder | null) => Promise<StartedEntryServer>`; `runEntry` reads `(deps.readVenueHolder ?? readVenueHolder)(deps.venueDir)` as its FIRST statement (before `freeSpaceAtStart`, `deleteOldBackupsAtStart` or first-setup admission can take and release the lock and remove the file), and passes it through.
  - `StartServerSeams.previousHolder?: VenueHolder | null`; `bootThisProcess` passes it as `startServer(env, base, { previousHolder })`. Unset (the `bin.ts` path) means `null`.

  In `bootServer`, in this order:
  1. At the top, before the setup and adoption branches: `const mark = await takeStopMark(config.stateDir, log)`. Every path consumes it.
  2. On a box that is not a mirror and not fenced, after `const fenced = …` and before `runFirstStart`: `readReplaced(stateDir, venueId, ownTerm, log)`; a record serves the replaced start (Task 7b) without asking anything. Otherwise, when `chartListsCountedPeer` is false, `decideOneBoxStart` with `ask = (t) => checkBucketReplaced({ …, timeoutMs: t })`.
  3. A `replaced` decision: `writeReplaced` first, then the replaced start. Until Task 7b lands, throw `AppError("start.replaced", …)` after writing, covered by one case.
  4. A `sell` decision, or the two-box path, on a box that is not a mirror and not fenced: record `start.unplanned_stop` when `previousHolder` is not `null` and the bucket answer was not `restoring` (on the two-box path, when `REBUILD_MARKER` is absent); record `start.selling_unconfirmed` when `confirmed` is `false`.
  5. At the end of `bootServer`, once the trading listener is up, on a box that is not a mirror and not fenced: `armRestartMark(config.stateDir)`, with `disarmRestartMark` pushed onto `undoOnFailure`.

  Paths and what each records: restricted (`boot.ts:1820`) and superseded (`boot.ts:1921`): consume the mark, record nothing. Mirror: consumes, records nothing, never armed. Zone repair (`boot.ts:2100`): records as step 4 says, never armed. Waiting start that carries on or is answered: records as step 4, armed at the end.

- [ ] **Step 1: Write the failing tests.**
  - `node-entry.test.ts`: `"the previous holder is read before anything can take the lock"` (a `readVenueHolder` spy is called before `freeSpaceAtStart`'s statfs and before `lockVenue`; `startServer` receives the holder).
  - `boot.stop-mark.test.ts` (the boot suites' helpers; in-memory bucket seam): `"a box whose last stop was clean sells at once and records nothing"`; `"a power cut records an unplanned stop with the last heartbeat time"` (a `previousHolder` given); `"a clean restart the box made itself while not trading records nothing"` (no mark, no holder, bucket clear → sells, no incident); `"a two-box chart takes the existing peer check and no bucket wait"`; `"the restored box's first start skips the bucket and records no unplanned stop"`; `"a replaced record stops the box without asking the bucket"` (bucket seam's `get` spy not called, unreachable bucket); `"a mirror consumes the mark and records nothing"`; `"a start that fails after arming leaves the box unarmed"`.
  - `run-server.stop-mark.test.ts`, in a child process as `run-server.signals.test.ts` does (never `process.exit` in the worker): `"a clean stop of a trading box leaves restart; of a waiting box leaves nothing"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.stop-mark.test.ts src/node-entry.test.ts src/run-server.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Amend `CLAUDE.md` §5.** Under "Nothing EXTERNAL may block a sale", add: "The exception: after a start with no stop mark, a box whose chart counts no other box waits up to 60 seconds for its bucket, and a verified answer that it was replaced stops it until an administrator carries on (A1418, owner 2026-11-07)." Under "The bucket stream never waits on the bucket to sell", add: "A1418's start-up check is not the stream; it waits at most 60 seconds." Put the receipt (design §1 and §3, this plan's Decisions 4–6) in `docs/developers/conventions-data.md` under a heading the new pointer names.
- [ ] **Step 5: Run** the Step 2 command, `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm format:check` — expected PASS.
- [ ] **Step 6: Commit** with message "After a stop without a mark, a one-box venue asks its bucket for up to a minute before it sells".

### Task 7a: The replaced variant of the waiting start, and carrying on

**Files:**

- Modify: `apps/server/src/waiting-start.ts` (a `reason`), `apps/server/src/waiting-page.ts`, `apps/server/src/i18n/waiting-page.ts`, `apps/server/src/carry-on.ts`
- Test: `apps/server/src/waiting-start.replaced.test.ts`, `apps/server/src/waiting-start.test.ts` (where the carry-on cases live)

**Interfaces:**

- Consumes: `clearReplaced` (Task 1), `mintNextMembershipDocument` (`apps/server/src/membership-mint.ts:46`), `persistNodeMembershipIfNewer`, `markIncidentHandled` (`packages/core/src/incidents.ts:315`).
- Produces:
  - `WaitingStartDeps.reason?: { kind: "peers" } | { kind: "replaced"; term: number }` — absent means `peers`, today's behaviour. With `replaced`, `recheck` is never called, the page says why the box stopped (the `start.replaced` words of Task 6a), and offers the carry-on form with its two existing confirmations, the first worded "The newer copy of this venue has been switched off".
  - `CarryOnDeps.onCarriedOn?: (tx: NodeTransaction) => Promise<void>` — called inside the node transaction that records the carry-on, after `claim()` succeeds and before `appendHandoverEventTx`. For `replaced` it mints a chart with `minTerm: term + 1`, signed by this box, as `completeRebuild` does (`rebuild-first-start.ts:127-140`), saves it to `venue.db` with `persistNodeMembershipIfNewer`, then marks the open `start.replaced` incident handled (system, `personId: null`); after the node transaction commits, `clearReplaced`. A throw rolls the node transaction back and the wait goes on.

- [ ] **Step 1: Write the failing tests.**
  - `waiting-start.replaced.test.ts`: `"a replaced box sells nothing and files nothing"` (the probes `waiting-start.test.ts` uses: `/health` takes no sales, no till sale route, no filing duty); `"its page names the newer copy's term and offers carry-on"`; `"it never re-asks"` (fake timers past `3 × WAIT_RECHECK_MS`; `recheck` not called).
  - `waiting-start.test.ts`: `"carrying on after replaced raises the box's term above the newer copy's"` (held term 5, replacement 6 → saved chart term ≥ 7, signed by this node; `start.replaced` handled; `replaced.json` gone); `"a carry-on whose term raise fails does not end the wait"` (`onCarriedOn` throws → failure shown, wait goes on, no chart saved, `replaced.json` kept); `"a stop during a carry-on leaves the raised chart saved and the box not carried on"` (shutdown begins after `claim()`; `finish()` returns `false`; the chart is saved); the existing carry-on cases pass unchanged.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/waiting-start.replaced.test.ts src/waiting-start.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Render the page string to a file and open it in the workspace's Playwright Chromium in both themes and at phone width (`CLAUDE.md` §4); keep the screenshots in the scratchpad, never committed.
- [ ] **Step 4: Run** it and `pnpm format:check` — expected PASS.
- [ ] **Step 5: Commit** with message "A replaced box's page explains why it stopped, and carrying on raises its term".

### Task 7b: Serving the replaced start, its email, and the guide

**Files:**

- Modify: `apps/server/src/boot.ts` (replace Task 6b's throw), the box guide in English and Spanish where the waiting page is explained (find it with `grep -rln "Carry on as the main box" apps docs`)
- Test: `apps/server/src/boot.stop-mark.test.ts`

**Interfaces:**

- Consumes: Task 7a's `reason: { kind: "replaced" }`, `recordReplaced` (Task 6a), `startBoxEmailDuty` (`box-alert-email.ts:257`).
- Produces: boot serves the replaced start as it serves the waiting start (`boot.ts:1844`), after `recordReplaced`, and runs `startBoxEmailDuty` beside it with `isPrimary: () => true`, the disk and space states boot already holds, `moduleNotices` answering none and `backupStopped` answering `undefined`; the duty is stopped when the replaced start ends. After carrying on, boot goes on as after a carried-on wait.

- [ ] **Step 1: Write the failing tests** in `boot.stop-mark.test.ts`: `"a box told it was replaced serves the replaced page, records start.replaced and not start.unplanned_stop, and emails it once"` (the email seam gets one `start.replaced` message within one `BOX_EMAIL_CHECK_MS`); `"a replaced box restarted with its bucket out of reach stays stopped"`; `"after carrying on, the box sells and its stream opens a generation at the raised term"`; `"after carrying on, the full start emails nothing more about the replacement"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/boot.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update the guide** in English and Spanish: one short section on the replaced page — what it means and what carrying on does. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] **Step 5: Run** the Step 2 command and `pnpm format:check` — expected PASS.
- [ ] **Step 6: Commit** with message "A box told it was replaced stays stopped and emails the managers".

### Task 8: The watch while selling

**Files:**

- Create: `apps/server/src/replaced-watch.ts`
- Modify: `apps/server/src/background-duties.ts` (a closer `replacedWatch`, `atStepdown: true`), `apps/server/src/boot.ts` (start it on the full trading path of a box whose chart counts no other box and that has stream settings)
- Test: `apps/server/src/replaced-watch.test.ts`, `apps/server/src/handover-stepdown.test.ts` (its closer table), `apps/server/src/boot.stop-mark.test.ts`

**Interfaces:**

- Consumes: `checkBucketReplaced` (Task 5), `writeReplaced`, `disarmRestartMark` (Tasks 1–2), `restartProcess` (`run-server.ts`).
- Produces:
  - `export const REPLACED_WATCH_MS = 600_000`
  - `export function startReplacedWatch(deps: { ask: (signal: AbortSignal) => Promise<BucketAnswer>; onReplaced: (answer: Extract<BucketAnswer, { kind: "replaced" }>) => Promise<void>; intervalMs: number; log: Logger; timer?: (ms: number, fn: () => void) => Timer }): { stop: () => Promise<void> }` — asks at once, then every `intervalMs`; never two asks at once; on `replaced` awaits `onReplaced` once and asks no more. `stop` cancels the next ask and aborts the one in flight, settling within 100 ms of the abort. Boot's `onReplaced`: `writeReplaced`, `recordReplaced`, `disarmRestartMark()`, then `restartProcess()`.

- [ ] **Step 1: Write the failing tests**: `"it asks at once and then every interval"`; `"a slow ask is not overlapped by the next"`; `"replaced saves the record before the restart, once, and stops asking"` (call order `["write", "record", "disarm", "restart"]`); `"no_answer and clear keep it asking"`; `"stop aborts an ask that hangs"` (the ask never settles unless aborted; `stop` settles); `handover-stepdown.test.ts`'s closer table includes `replacedWatch` with `atStepdown: true`; in `boot.stop-mark.test.ts`, `"a selling box that learns it was replaced writes no mark and restarts into the replaced start"` (the bucket flips to a verified newer pointer; the restart seam is called; `stop-mark.json` absent; `replaced.json` present).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/replaced-watch.test.ts src/handover-stepdown.test.ts src/boot.stop-mark.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** and wire it.
- [ ] **Step 4: Run** it — expected PASS.
- [ ] **Step 5: Commit** with message "A selling box keeps asking its bucket, and stops when a newer copy has taken over".

---

## After the last task

- Update `docs/backlog.md`'s A1418 entry (part 1 built; parts 2 and 3 left) and the ledger `docs/handoffs/2026-11-07-a1418-box-stop-intent.md`.
- `/finish-branch` on the worktree, with the note: "A1418 part 1, plan `docs/superpowers/plans/2026-11-07-a1418-part-1-stop-marks.md`; risk triggers fiscal filing, start-up, concurrency; Task 5's answer to design §8 question 1 goes in the PR body".
