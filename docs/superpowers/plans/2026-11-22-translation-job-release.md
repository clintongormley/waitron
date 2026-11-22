# Record what Cloud needs to abandon translation work

The watcher assigned TRANSLATION-JOB-RELEASE in Lane H's queue on 22 November at 03:25.
This plan proposes a documentation change for [Translate all followups](../../backlog/menu.md#bundle-translate-all-followups),
with the Cloud change to be routed by the watcher. Claude reviewed the first draft and identified
the contract restriction below. The revised scope awaits watcher clearance.

## What this delivers

The backlog records why a new Translate all request can be refused after the box ends an earlier
job, and what Cloud needs to support before the box can clear that work. Cloud's contract says
“Release tells Cloud the box has durably stored every page.” The box can also release a job Cloud
reports as failed, which has no pages. A queued or running Cloud job returns 409 to release and
blocks the next submit. Repeating submit by operation id can recover an accepted job, but can also
create a job if that operation never reached Cloud while submissions are allowed. These statements
are from Waitron Cloud at `2af67c8495aa03c2c1f3134b6c102ddf49977fe4`,
`docs/waitron-integration-contract.md:1439–1445` and
`packages/translation/src/{machine.ts:71–101,job-store.ts:29–30,64–71}`.

## Build and check

- [ ] Narrow the entry and bundle line in `docs/backlog/menu.md`. Keep the existing entry link.
  Record the two cases for Cloud: an active job still blocks the next submit, and a lost submit
  reply leaves the box without Cloud's job id. Cloud needs a way to abandon an existing job by
  operation id, including active work, with zero jobs created on a miss. Ask the watcher to route
  that request to Lane G. Box integration follows the Cloud contract.
- [ ] Check the backlog link and the diff, and run the existing runner cases for local expiry,
  incomplete collection and lost submit replies. Sign off and use the docs-only landing path
  after watcher clearance.

Expect 10–15 lines of backlog text and zero production or test lines. Translation is switched off.
