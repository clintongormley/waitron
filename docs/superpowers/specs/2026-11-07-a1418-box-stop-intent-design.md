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

- No change to how long a stop may take. `SHUTDOWN_DEADLINE_MS` (8 seconds) and `KILL_GRACE_MS` (5
  seconds) stay.
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
- A mark that cannot be written, on a full disk for example, is logged and the stop carries on. The
  next start then treats it as an unplanned stop, which only costs the wait in §3.
- `restart` is removed at the next start. `shutdown` stays until an admin answers (§5).
- **Left to the builder:** where it lives. It belongs to this one box, so it must not travel in a
  backup or a handover copy: a restored box inheriting `shutdown` would wait for an admin for no
  reason. `node.db` holds `node_handover_restriction` for the same kind of fact.

## 3. Every start

The box asks everything configured that could know it was replaced:

- **The other box**, if its chart lists one that finished joining. Built (`boot-peer-check.ts`, read;
  rule in `CLAUDE.md` §5). That box says which role this one has.
- **The bucket.** A restored box takes a term one higher (`rebuild-first-start.ts`,
  `packages/membership/src/build.ts`, read). An older box that starts with the bucket reachable reads
  the higher term and refuses with `pointer_newer_term` (`packages/stream/src/supervisor.ts`, read,
  not run end to end). Today that stops backups and raises `backup.stream_refused`; nothing found
  stops selling.
- **Cloud**, for a box with a Cloud account: A1188 §6 and answer 15, approved 2026-10-29, not built.

What the box does with the answers:

| Last stop | Another box in its chart | One box |
| --- | --- | --- |
| `restart` | The existing check, unchanged | Sells at once; asks alongside |
| none | The existing check, unchanged | Waits for the answers, at most 60 seconds; then sells and files, and keeps asking |
| `shutdown` | The existing check, then the admin's answer (§5) | Waits for the admin (§5) |

- **Replaced means stopped, on every row.** Sells nothing, files nothing, and says why. Trusting the
  answer is safe in the sense that it can only stop a box. The cost is in §7, question 1.
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
   recovery key. If the venue has two boxes and this is the main one, the action is not offered and
   the screen points to handover.
2. New sales stop, by the same route a handover uses (`readHandoverRestriction`, `boot.ts`, read).
   Work already admitted finishes as A1018 §2 sets out.
3. It takes one full backup to the venue's saved destinations, using `runOnce`
   (`apps/server/src/backup-sweep.ts`, read: today only the schedule calls it, and no "back up now"
   route was found). **(default)** With no destination set up, the admin downloads it as a file.
4. If a bucket stream is on, it waits for the stream to catch up. The box is running, so no stop limit
   applies. The screen shows progress, using the lag the box status already shows.
5. It checks the backup opens, with `verifyBackupArtifact`
   (`apps/server/src/backup-verification.ts`, read: exported for Cloud recovery; not yet traced whether
   a box can run it on its own backup, which the builder must establish first).
6. It writes `shutdown` and says it is safe to unplug. It does not power the machine off.

If step 3, 4 or 5 cannot finish, the screen says what happened and offers: keep waiting, shut down
anyway, or cancel and go back to selling. Cancel lifts the stop, and writes no mark.

## 5. Starting after a shutdown

The box sells nothing and files nothing until an admin signs in over HTTPS and chooses:

- **Carry on selling on this box**, for a move. The mark clears and work resumes.
- **Keep it stopped**, for a box that has been replaced. The screen explains that using both boxes
  would leave sales, cash and fiscal records disagreeing.

The waiting page (`apps/server/src/waiting-start.ts`, `carry-on.ts`, read) already does this for a box
waiting on another box, and is the place to start. The owner accepted the cost: a moved box needs one
admin sign-in before staff can sell.

## 6. Scenarios

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

## 7. Questions for the builder and for review

1. **A running box stopping on the bucket's word.** A restore of the live venue onto another machine,
   done by mistake, would now stop the real box mid-service. Restore already refuses a generation
   changed in the last few minutes unless someone confirms the old box is gone
   (`apps/server/src/restore-stream.ts`, read). The builder confirms that is enough, and whether the
   old box can verify the newer pointer's signature, or is taking the bucket's word for it.
2. **Replaced while selling.** What happens to orders in progress follows A1018 §2 and A1342 (a selling
   box told of a newer main box must stop).

## 8. Earlier designs this changes

Both need a dated note when this is approved. Neither is rewritten.

- **A1188 §6 and answer 15:** "With no internet and no till or peer to ask, it waits for a person."
  Narrowed: for a box with no other machine in its chart, that wait is the 60 seconds of §3, unless
  the last stop was a `shutdown`.
- **A1018 §4 point 1:** "No reachable peer or till means wait for an authorised human, not assume
  primary." Narrowed the same way. A box with another machine in its chart still waits.

## 9. Order of work and what it waits for

Touches fiscal filing, start-up and concurrency, so it takes the full review path.

1. The mark, and the start table with the bucket check: no dependency.
2. "Shut down this box", and §5. Needs the question in §4 step 5 settled.
3. The Cloud question: needs Cloud's answer to "was a declaration made?" (A1188 §9 item 10).

Left to the builder: where the mark lives, the screens' words (English and Spanish, with guide
updates), and how progress is drawn. #2529 does not depend on any of this.
