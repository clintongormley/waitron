# Find an operating procedure

Use these permanent instructions when you operate a venue or support its box. They do not
depend on keeping the planning directory. The [source audit](planning-procedure-audit.md)
records which procedures were retained or already had a permanent home on 22 October 2026.

| What you need to do                                                                                  | Procedure                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set up a first Live identity or resume its interruption                                              | [First Live setup](first-live-fiscal-setup.md) and [provisioning command reference](../../packages/provisioning/README.md)                                                                                                 |
| Replace a lost recovery pack or recovery PDF                                                         | [Make a new recovery pack](recovery-document.md)                                                                                                                                                                           |
| Restore an archive, bucket or managed copy                                                           | [Recovery sheet and hour selection](hour-recovery.md), [restore reference](../developers/offline-fiscal-restore.md) and [operator command forms](../../deploy/README.md#the-operator-clis--two-different-invocation-forms) |
| Inspect what a cold restore still needs outside the app                                              | [Cold-restore surfaces](../developers/cold-restore-surfaces.md)                                                                                                                                                            |
| Restore a replacement or promote an admitted spare                                            | [Fiscal recovery paths](hour-recovery.md#a-working-box-keeps-its-fiscal-identity)                                                                                                                        |
| Rejoin a returned box                                                                                | [Server reference](../../apps/server/README.md#rejoining-a-returned-box); read its data-loss limits before running the command                                                                                             |
| Repair the secure connection or replace the AEAT certificate                                         | [Server reference](../../apps/server/README.md) and [certificate guide](../../apps/server/src/guide/en/aeat-certificate.md)                                                                                                |
| Configure archive destinations and keep their keys                                                   | [Backups and support](backups-and-support.md#keep-the-recovery-pack)                                                                                                                                                       |
| Run an authorised Amazon S3 rehearsal or clean up its interrupted run                                | [S3 rehearsal](../developers/aws-backup-rehearsal.md)                                                                                                                                                                      |
| Qualify a verifier build and its Cloud recovery handoff                                              | [Verifier release](backup-verifier-release.md) and [authorised disposable fixture](../developers/authorised-cloud-restore-fixture.md)                                                                                      |
| Investigate logs, reconnect a print agent or pair a Bluetooth printer                                | [Backups and support](backups-and-support.md)                                                                                                                                                                              |
| Install, update or try a branch on a box                                                             | [Deployment instructions](../../deploy/README.md)                                                                                                                                                                          |
| Clock in, correct working time or download its record                                                | [Working time](working-time.md)                                                                                                                                                                                            |
| Take part payments or resolve an unanswered card payment                                             | [Payments](payments.md)                                                                                                                                                                                                    |
| Manage staff accounts, products, modifiers, translations, themes, purchases or table/kitchen service | [The permanent user guides](../../apps/server/src/guide/en/)                                                                                                                                                               |
| Publish a menu later, set opening hours, paint staffing or publish a rota                            | [Calendar, menu and rota contracts](../developers/design-system.md) and [public holidays](../developers/public-holidays.md)                                                                                                |
| Update shipped holiday data for another year                                                         | [Yearly data update](../developers/public-holidays.md#the-yearly-data-update)                                                                                                                                              |
| Repeat an authorised AEAT TEST probe                                                                 | [Successor probe](../compliance/aeat-successor-probe-handoff.md) or [four-behaviour probe](../compliance/aeat-four-behaviours-probe-handoff.md); keep their approval gates                                                 |

On a special date's staffing painter, **Clear** means nobody is needed. **Follow the season**
restores the season's staffing. The [grid](../../packages/staffing/src/dashboard/staffing-grid.ts)
and [writer](../../packages/staffing/src/paint.ts) keep an explicit empty day separate from
removing that day's override.

## The approved one-time migration squash

A760 is a future maintenance job with a separately recorded freeze and named reset roster.
Its [retained procedure](a760-migration-squash.md) and
[inventory](a760-migration-squash-inventory.md) preserve the approved 16 October instructions.
Refresh their dated facts at execution. Publishing these copies starts no freeze, reset,
migration or deployment.

## Before deleting planning files at go-live

Repeat the source sweep for additions since the recorded audit. Move any newly delivered
procedure here or into the guides before removing its only copy. Keep unfinished designs and
their build authority separate: proposed release commands, USB installation, automatic failover,
hosted stop proof and future fiscal remedies are not current procedures.

The deletion and change to production migration policy remain go-live-day actions. This
directory does not authorise either action now.
