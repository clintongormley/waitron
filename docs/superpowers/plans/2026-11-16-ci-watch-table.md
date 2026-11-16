# CI watch table plan

**Source:** Lane I's `CI-WATCH-TABLE` ask in
`/Users/clintongormley/waitron-campaign-i/queue.md:61–64`; inspected 16 November 2026.
**Status:** Draft by Codex, awaiting Claude plan review and watcher clearance before consolidation.

**Smallest usable result:** You can find each watched incident, its last recorded sighting,
what to retain next time and its evidence location in one table. Reuse existing prose, links,
diagnostic instructions and developer-guide receipts. No diagnosis or investigation closes here.

## One documentation change

- [ ] In `docs/backlog/ci.md`, replace the bundle at current lines 337–392 with
  `## CI incidents to watch` (`#ci-incidents-to-watch`). Use four columns: **What was seen**,
  **Last recorded sighting (run/job)**, **Retain next time**, **Retained logs**. Give each named
  entry its own row: A1022, A891, A999, the two older pnpm stalls, A544, A1230, A1305, A1027,
  #1557, A419, frozen-bucket control, the three-incident group, fiscal shard 2's first-hour PDF,
  dashboard heading order and PR #414. Split the two pnpm stalls into separate rows. The current
  bundle has 16 bullets despite its “14” label; preserve its membership rather than that count.
  Preserve the group's later additions, including November 15. Keep A1027 until its blocked work lands.
- [ ] Fold short detail into the corresponding rows: #1557 (line 13), frozen-bucket control
  (30), PR #414 (198), A544 (875), A419 (892), A891 (1001), A999 (1022), A1027 (1078)
  and A1230 (1096). To keep cells readable, retain and link the long
  [incident group](../../backlog/ci.md#three-unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying) (115),
  [pnpm stalls](../../backlog/ci.md#explain-the-two-older-silent-pnpm-setup-stalls) (839),
  [held-thread observation](../../backlog/ci.md#the-step-watch-guard-received-an-undefined-held-thread-result) (858; from A544's row)
  and [A1305](../../backlog/ci.md#a1305-the-dashboard-page-blocked-during-a-click-and-what-blocked-it-is-unknown) (1118).
  Preserve their evidence and qualifications. The fiscal row carries both recorded runs,
  especially November 14's `43604245865/job/132475525462` and lane E's
  `receipts/a1308-5h/ci-rebased-fiscal.log`. Remove the superseded bundle heading and bullets.
- [ ] Replace `docs/backlog.md:1753` with one index line linking to the table. Repoint
  `docs/developers/ci-and-gates.md:1340,1348` to explicit table-row anchors
  `ci-watch-a1027` and `ci-watch-a1230`. Find every other moved-section consumer with
  `git grep -n 'ci.md#'` and same-file fragment searches; update affected links only.

## Checks before landing

Compare the base and candidate text for every source section above. Account for every run/job URL,
bare run/job ID, retained-log path, artifact name and diagnostic link in a row or retained detail.
Use only recorded IDs to form missing run/job links; write “not recorded” for absent dates,
job IDs or log locations. A1022 has no incident run; preserve that fact. Do not search for newer
sightings. Preserve every “unknown”, “unverified”, “likely”, missing-log and reproduction limit;
passing retries remain observations. Keep the heading-order cause unexplained and PR #414's
unanswered-call cause open despite its retired exit-1 path.

Repeat `git grep -n 'ci.md#'` and check same-file fragments against final headings/row IDs;
every affected inbound link must resolve. Read the table for usable cell lengths and escaped pipes.
Run `git diff --check`, inspect `git diff --name-only` and `git diff --numstat`, and review the full
documentation diff. No tests, CI experiments, new scanner, registry or check infrastructure;
no production, test, configuration, workflow or root `CLAUDE.md` edits.

**Expected size:** consolidation adds 90–130 documentation lines and removes 220–290;
this plan adds about 60 lines separately. Production +0/−0; tests +0/−0; test support +0/−0.

**Driver handoff:** Arrange Claude's plan review with `claude-seat.sh review-branch`, quote the
queue ask verbatim in its brief, resolve findings and obtain watcher clearance before building.
Name the reviewer and watcher; do not claim owner design approval. Use the registered
branch, `git commit -s` and normal hooks. Take Lane I's shared main lock only for the refreshed
fast-forward and direct push, release only your own lock, and follow the normal main-update and
cleanup steps. No PR or forced CI run. This authoring task stops at the saved draft.
