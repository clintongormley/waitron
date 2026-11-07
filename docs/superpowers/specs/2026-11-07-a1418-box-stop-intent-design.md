# A1418: how a box stops, and what it does when it starts again

**Status: proposed, 2026-11-07; nothing is built.** Decisions marked **(owner)** quote the owner from
the conversation of 7 November 2026. Decisions marked **(default)** are this design's, open to
correction. Everything else is a fact, with a pointer, and says whether it was read or run.

## Why this exists

Reviewing the move to Litestream 0.5.18 (#2529), the owner asked what happens to sales when a stop
cuts off a slow upload to the backup bucket. The measurements below answer that for a restart. They
also show the real gap: Waitron treats every stop alike, so it has no way to take a full backup before
a box leaves service, and no way for a box switched on later to know it was deliberately shut down.

## What the owner decided

- **The mark.** "we can distinguish a shutdown from a restart from a powercut - in the first two cases
  we should write a mark indicating the intention. in the third case, the mark should be missing."
- **After a power cut or a dead server.** "i think it can start up, do the usual checks, wait for a
  while (a minute or so?) and start selling and filing if it doesn't know that it has been replaced."
  The owner's example: the box dies, the venue starts a new server in the cloud from a backup, the new
  main box knows nothing of the old one, and all tills point at the new one. "the old one comes back
  but nothing talks to it, so we're ok."
- **After a restart.** "on a restart with no secondary configured, we shouldn't wait for the admin".
- **After a shutdown.** A box shut down, replaced from a backup and started again later "could start
  selling on its own again. so maybe this one needs to ask an admin after shutdown."
- **Taking a box out of service.** "You want a full backup then the ability to restore". It may also
  be a move: "Maybe if they want to move the box which means unplugging it".
- **A box with another machine configured.** It "would either try to reach the other box ... or it
  would wait for the admin to say 'you're the primary'. if it does reach the other box, that box
  should tell it whether it is primary or secondary".
- **A box with a Cloud account.** "the box should be able to check with cloud before choosing primary
  or secondary role".

## Goals, non-goals, anti-goals

**Goals.** One deliberate action takes a box out of service with a full backup checked and restorable.
Every start knows how the last stop ended. A box that learns it has been replaced stops.

**Non-goals.**

- No change to how long the final stop of the server may take. `SHUTDOWN_DEADLINE_MS` (8 seconds) and
  `KILL_GRACE_MS` (5 seconds) stay. In "Shut down this box" (§4) the backup, the catch-up and the check
  all run while the server is up, so no stop limit applies to them. The limits apply only to the stop
  that follows, when Litestream has nothing left to send.
- No second bucket, and no switching bucket during a stop. Litestream streams a database to one place
  only (A947 §3), and a new bucket needs a full copy, far more than a backlog.
- No change to controlled or forced handover. A controlled handover sends the final state directly
  to the new box, and "an older bucket copy cannot substitute" (A1018 §2). In a forced handover the
  old box is down and nothing can wait for it (A1018 §4).

**Anti-goals: this has failed, even if it works, if:**

- a bucket, Cloud or the internet can keep a venue from selling after a restart or a power cut beyond
  the bounded wait in §3;
- a box told it was replaced goes on selling or filing;
- an admin at a venue with one box has to answer anything after a power cut.

## 1. Measurements behind this design

Run on 7 November 2026 on a Mac with the real Litestream 0.5.18 and versitygw (a local S3 server)
behind a speed limit, one run per row, with throwaway scripts that were not kept. Sales were 5 KB,
taken from the bench's 58 MB for 12,000 sales. The speed limits are chosen values, not measured
venues.

| Situation | Stop | In the bucket at stop | After restarting Litestream |
| --- | --- | --- | --- |
| Normal selling, 16 KB/s | 0.6 seconds, exit 0 | 17 of 17 | all |
| 500 KB backlog, 64 KB/s, left alone | 8.8 seconds, exit 0 | 105 of 105 | all |
| The same, killed at 5 seconds | killed | 55 of 105 | all |
| 2 MB backlog, 64 KB/s, left alone | 30 seconds, exit 1 | 335 of 405 | all |
| The same, killed at 5 seconds | killed | 55 of 405 | all |

Ten forced kills while rows were being written left the local database complete and intact each
time. A restore straight after each kill was 6,800 to 19,350 rows short, and after restarting
Litestream every row restored. So a stop loses nothing unless the box never starts again. The same
gap exists at any moment before a power cut, which no stop can help.

## 2. The mark

A mark is saved on the box's own disk and read at the next start.

| Value | Written by | Meaning |
| --- | --- | --- |
| `restart` | The server's own stop path, as its first step | A clean stop that was not a shutdown |
| `shutdown` | The action in §4, once its backup has been checked | An admin took this box out of service |
| none | Nothing | The box stopped without warning: a power cut, a crash, or Docker's forced kill |

- **(default)** Any clean stop from outside counts as `restart`: `docker compose stop`, an update, or
  a machine powered off from its command line. All arrive as the same signal
  (`installShutdownHandlers`, `apps/server/src/run-server.ts`, read), so the server cannot tell them
  apart. That is safe because every start still asks whether the box was replaced (§3).
- The mark is written before anything else in the stop, so it does not depend on the 8 seconds.
  Measured on 7 November 2026, one run each, with a `node:26` container started as Waitron's is
  (`node` as process 1, `deploy/Dockerfile`): `docker stop` let a stop handler write its file and the
  container exited 0 in 0.35 seconds; `docker kill`, the control, left no file (exit 137). A machine
  powered off from its command line, which stops Docker's containers through the host's service
  manager, was not tested.
- A mark that cannot be written, on a full disk for example, is logged and the stop carries on. The
  next start then treats it as an unplanned stop, which only costs the wait in §3.
- `restart` is removed at the next start. `shutdown` stays until an admin answers (§5).
- **(default)** It is a file in the box's state folder, beside `spare-space.released`, never a row in
  `venue.db` or `node.db`. It belongs to this one box and must not travel: `node.db` is copied whole
  into every archive as `node.dump` (`apps/server/src/backup-sweep.ts:73`, read) and put back by a
  restore (`apps/server/src/restore.ts`), so a restored box would inherit `shutdown` and wait for an
  admin for no reason. Written to a temporary name, flushed to disk, then renamed.

## 3. Every start

The box asks everything configured that could know it was replaced:

- **The other box**, if its chart lists one that finished joining. Built (`boot-peer-check.ts`, read;
  rule in `CLAUDE.md` §5). That box says which role this one has.
- **Not a Cloud mirror.** The owner: "normally the cloud mirror won't be running. we only start it
  when we need it to become the primary." The built start-up chart fetch, `reconcileMembershipOnBoot`
  (`apps/server/src/boot.ts:1932-1956`, read), does not cover that: it runs only on a box holding a
  mirror link, which `adopt.ts` writes on the MIRROR, naming the box it was adopted from
  (`packages/node-db/src/mirror-link.ts`, read). It also carries on when the other side does not
  answer, and refuses a chart signed by a key it does not trust (`packages/membership/src/accept.ts`),
  as a Cloud copy's would be (A1188 §6). Asking Cloud's own service, below, is what covers it.
- **The bucket.** A restored box takes a term above its own copy's chart and above the bucket's
  pointer (`apps/server/src/rebuild-first-start.ts:124-137`, read), but not necessarily above the old
  box's own term: a rebuild reuses the dead box's node id. An older box starting with the bucket
  reachable refuses on `pointer_newer_term` (`packages/stream/src/supervisor.ts:428-430`, read, not run
  end to end). Today that stops only the bucket stream and raises `backup.stream_refused`; scheduled
  archives carry on, and nothing found stops selling. `readPointer` does not check the pointer's
  signature (`packages/stream/src/pointer.ts`).
  - **(default)** "Replaced" means a pointer this box can verify that names a newer term than its own,
    or a different box's generation at an equal term. A pointer it cannot verify is no answer.
  - A restored box skips this check on its own first start, while its restore marker
    (`REBUILD_MARKER`) is still present, or it would find itself replaced.
  - The pointer moves only after the new box's first full copy lands
    (`packages/stream/src/supervisor.ts:444-465`), so that a restore never meets a generation with no
    full copy. But a box writes a claim for its generation at the start, before the copy
    (`claimGeneration`, `packages/stream/src/generations.ts:31-49`, read), naming its term and node.
    The claim is not signed today. **(default)** The box signs its claim as it signs its pointer, and
    a verified claim with a newer term counts as "replaced". The old box then learns within moments
    of the new box's start, not after its full copy.
- **Cloud**, for a box with a Cloud account: A1188 §6 and answer 15, approved 2026-10-29, not built.
  The box asks Cloud's service with its own installation credential, so it gets an answer whether or
  not a copy is running.

What the box does with the answers:

| Last stop | Another box in its chart | One box |
| --- | --- | --- |
| `restart` | The existing check, unchanged | Sells at once; asks alongside |
| none | The existing check, unchanged | Waits for the answers, at most 60 seconds; then sells and files, and keeps asking |
| `shutdown` | The existing check; **(default)** the other box's answer stands in for the admin's, since it knows whether a handover happened | Waits for the admin (§5) |

- **Replaced means stopped, on every row.** Sells nothing, files nothing, and says why. Trusting the
  answer is safe in the sense that it can only stop a box. The cost is in §8, question 1.
- **Carrying on after "replaced".** An admin may choose to carry on selling on this box, but must first
  confirm the other box has been shut down **(owner)**: "they need to confirm that the other box has
  been shut down first". **(default)** The box then claims the bucket at a higher term, as a restore
  does, so the other box learns that it has been replaced.
- **(default)** "A minute or so" **(owner)** is 60 seconds. The wait ends as soon as everything
  configured has answered, so a box whose internet is up starts in seconds.
- **(default)** A box with no bucket and no Cloud account has nobody to ask, so it does not wait.
- **(default)** The bucket and Cloud are still asked later if they gave no answer in time, and a late
  "replaced" stops a running box the same way.
- A crash and Docker's forced kill also leave no mark, so a server that crashes mid-service waits too,
  though no longer than the 60 seconds and usually far less.

## 4. "Shut down this box"

An action on the dashboard's box status screen, for someone holding the permission a handover needs
(`node.promote`), signing in afresh over HTTPS.

1. **(default)** The screen says what will happen, and what is needed to restore: the backup and the
   recovery key. It offers the recovery pack for download there and then: the box holds the key while
   it runs, and the pack is made by the existing `POST /api/backup/recovery-pack`
   (`apps/server/src/backup-recovery-pack-api.ts`, read: `system.manage`, over HTTPS).
   On a two-box venue it is offered on both boxes **(owner)**: "either on the primary or the mirror".
   Backups and the stream run only on the main box (`apps/server/src/boot.ts`, around 2905, read),
   and the spare hosts the store the main box streams to (A947 §3):
   - **On the main box, two choices (owner):** "hand over to the secondary, or shut down". Handing
     over is A1018's controlled handover, then this box stops. Shutting down stops only this box:
     "the mirror doesn't need to shut down as well, but selling will stop until the primary is
     rebooted". Steps 2 to 6 run here; step 4 waits for the stream into the spare's store.
   - **On the spare (default):** the main box first moves its stream straight to the bucket, as it
     already does when the spare stops answering (A947 §6.2, "the spare is not answering"). The spare
     then finishes copying its store up to the bucket, and says it is safe to unplug. The main box
     keeps selling throughout. Steps 2, 3 and 5 do not apply.
   - **When the spare comes back (default, the owner agreed 2026-11-07):** once it answers again, the
     main box moves its stream back to the spare by itself, with no admin. The move opens a new
     generation, so the spare's stale copy is replaced by a full copy sent over the venue's network.
     The main box keeps selling, and the "one copy" warning stays until the spare is current. The
     topology design says the same for a replacement spare ("until a replacement box B is enrolled,
     then retargets to the LAN again", topology §4.4, read); neither switch is built (none found).
2. Work stops, and this stop must be one that can be lifted. Handover's stop cannot: `stepDown`
   answers only three requests and stops background work, including backups and the stream, and its
   record is never cleared (`apps/server/src/handover-stepdown.ts:20-27`,
   `apps/server/src/background-duties.ts`, read). The one gate found that can be lifted is
   `TradingAdmission` (`apps/server/src/trading-admission.ts`, read), used today only for the time-zone
   check. **(default)** Everything A1018 §2 lists stops, filing and staff clocking included, so the
   backup is the final state. Before this step the screen lists anyone still clocked in, so they can
   clock out first. Work already admitted finishes as A1018 §2 sets out.
3. It takes one full backup to the venue's saved destinations, using `runOnce`
   (`apps/server/src/backup-sweep.ts`, read: today only the schedule calls it, and no "back up now"
   route was found). **(default)** With no destination set up, the admin downloads it as a file.
4. If a bucket stream is on, it waits for the stream to catch up. The box is running, so no stop limit
   applies. The screen shows progress, using the lag the box status already shows.
5. It checks the backup opens, with `verifyBackupArtifact`
   (`apps/server/src/backup-verification.ts`, read: exported for Cloud recovery; not yet traced whether
   a box can run it on its own backup, which the builder must establish first). It refuses a check
   that runs past 30 seconds or needs more than 256 MiB of scratch space
   (`apps/server/src/backup-verification.ts:64, 158`, read). The owner: "30s may not be enough".
   **(default)** For this check the time limit is set by progress, not a fixed number: it stops only
   when the check has made no progress for a while, and the scratch space is sized to the backup.
6. It writes `shutdown`, then powers the machine off **(owner)**: "a shutdown usually does". The box's
   host service (`deploy/box/waitron-box.sh`, read) answers only `clock.status` and `clock.set` today;
   it gains one request to power off. Where there is no host service (development, or a hosted copy),
   the screen says it is safe to unplug instead.

If step 3, 4 or 5 cannot finish, or stops making progress, the shutdown pauses and the admin is told,
on the screen and by email (§6): it never carries on by itself **(owner)**. The screen says what
happened and offers: keep waiting, shut down anyway, or cancel and go back to selling. Cancel lifts the
stop, and writes no mark.

## 5. Starting after a shutdown

The box sells nothing and files nothing until an admin signs in over HTTPS and chooses:

- **Carry on selling on this box**, for a move. The mark clears and work resumes.
- **Keep it stopped**, for a box that has been replaced. The screen explains that using both boxes
  would leave sales, cash and fiscal records disagreeing. **(default)** The `shutdown` mark stays, so
  this page shows at every start until someone chooses to carry on, or the box is wiped.

The waiting page (`apps/server/src/waiting-start.ts`, `carry-on.ts`, read) already does this for a box
waiting on another box, and is the place to start. The owner accepted the cost: a moved box needs one
admin sign-in before staff can sell.

## 6. Email alerts

**(owner)** "any unexpected shutdowns or starting selling again without having confirmation that we're
the right box should trigger an email alert to the admin". Each is an alert, and is emailed to the
venue's managers through the existing box alert email (`apps/server/src/box-alert-email.ts`, read):

- a start with no mark: the box stopped without warning, with the time it was last running;
- a box that starts selling and filing after the wait in §3 without an answer from anything it asked;
- a box told it was replaced, which stays stopped;
- a shutdown paused because a step stopped making progress (§4).

Each is a recorded incident code with an area and English and Spanish wording (`CLAUDE.md` §3).

## 7. Scenarios

| What happened | What the box does when it next starts |
| --- | --- |
| Staff restart, update, or Waitron restarts itself | Sells at once |
| Power cut, internet fine, not replaced | Answers come in seconds; it sells |
| Power cut, router down, not replaced | Sells after 60 seconds, and keeps asking |
| Power cut, box replaced from the bucket or through Cloud, then it returns online | Told it was replaced; stays stopped |
| The owner's example: replaced, nothing configured to tell it, tills moved away | Starts and sells, but nothing talks to it; accepted **(owner)** |
| Moved with "Shut down this box" | Waits for an admin, who chooses to carry on |
| Retired one-box venue, restored elsewhere, old box later switched on | Told it was replaced if it can ask; otherwise waits for an admin |

**Filing by an old box.** One that does not know it was replaced may file records the new box also
holds. AEAT refuses a duplicate with error 3000, which `packages/fiscal-verifactu/src/drain.ts`
already handles (read, not run for this case).

## 8. Questions for the builder and for review

1. **A running box stopping on the bucket's word.** A restore of the live venue onto another machine,
   done by mistake, would now stop the real box mid-service. Restore already refuses a generation
   changed in the last few minutes unless someone confirms the old box is gone
   (`apps/server/src/restore-stream.ts`, read). The builder confirms that is enough, and whether the
   old box can verify the newer pointer's signature, or is taking the bucket's word for it.
2. **A box already selling stops** when the bucket says it was replaced **(owner)**: asked about a
   mistaken restore of the live venue, "the admin should never do this", then "a selling box
   stopping mid-service is acceptable". So a late "replaced" stops a running box (§3).
3. **Replaced while selling.** What happens to orders in progress follows A1018 §2 and A1342 (a selling
   box told of a newer main box must stop).

## 9. Earlier designs and rules this changes

Each needs a dated note when this is approved. None is rewritten.

- **`CLAUDE.md` §5, "The bucket stream never waits on the bucket to sell", and "Nothing EXTERNAL may
  block a sale".** After an unplanned stop, a box with one box waits up to 60 seconds for the bucket
  and Cloud before it sells, and an answer from either can stop it. The owner chose the wait (see
  "What the owner decided"); both rule lines are amended with this design.

- **A1188 §6 and answer 15:** "With no internet and no till or peer to ask, it waits for a person."
  Narrowed: for a box with no other machine in its chart, that wait is the 60 seconds of §3, unless
  the last stop was a `shutdown`.
- **A1018 §4 point 1:** "No reachable peer or till means wait for an authorised human, not assume
  primary." Narrowed the same way. A box with another machine in its chart still waits.

## 10. Order of work and what it waits for

Touches fiscal filing, start-up and concurrency, so it takes the full review path.

1. The mark, and the start table with the bucket check: no dependency.
2. "Shut down this box", and §5. Needs the question in §4 step 5 settled.
3. The Cloud question: needs Cloud's answer to "was a declaration made?" (A1188 §9 item 10).

Left to the builder: where the mark lives, the screens' words (English and Spanish, with guide
updates), and how progress is drawn. #2529 does not depend on any of this.
