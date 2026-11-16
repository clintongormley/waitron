# CI watch table plan

**Source:** Lane I's `CI-WATCH-TABLE` ask in
`/Users/clintongormley/waitron-campaign-i/queue.md:61–64`; inspected 16 November 2026.
**Status:** Drafted by GPT-6.1 Sol/high, checked by the Codex driver and corrected after
Claude’s plan read on 16 November 2026. See the dated execution note below for clearance.

**Smallest usable result:** You can find each watched incident, its last recorded sighting,
what to retain next time and its evidence location in one table. Reuse existing prose, links,
diagnostic instructions and developer-guide receipts. No diagnosis or investigation closes here.

## One documentation change

- [ ] In `docs/backlog/ci.md`, replace the bundle at current lines 337–392 with
  `## CI incidents to watch` (`#ci-incidents-to-watch`). Use four columns: **What was seen**,
  **Last recorded sighting (run/job)**, **Retain next time**, **Retained logs**. Give the fifteen
  bundle entries their own rows, splitting the two older pnpm stalls into separate rows.
  Add two rows for the ask’s line-177 section: server shard 2, PR #2664, run `42690313010`
  (job ID not recorded), and shard 19, PR #3342, run `43721700167`, job `132835178034`
  (log lost with `BlobNotFound`). The result has eighteen rows, including A1027 until that
  separate blocked item lands. Preserve membership rather than the old “14” label.
- [ ] Fold only short detail into rows: frozen-bucket control (line 30), PR #414 (198),
  A419 (892), A891 (1001) and A999 (1022). Keep #1557 (13), the expanded incident group (115),
  server shards 2/19 (177), older pnpm stalls (839), held-thread observation (858), A544 (875),
  A1027 (1078), A1230 (1096) and A1305 (1118) as linked detail with their existing headings.
  This preserves the long diagnostic instructions and existing guide links without HTML anchors.
  A544’s row also links the held-thread observation. The fiscal row carries both recorded runs,
  especially November 14’s `43604245865/job/132475525462` and lane E’s
  `receipts/a1308-5h/ci-rebased-fiscal.log`. Remove the superseded bundle heading and bullets.
- [ ] The incident-group row names all seven subjects: suite loading, bookings freeze,
  detached frame, refund search, diagnosis child, restore timer ticks and action-menu guard.
  Point its last-sighting cell at `43766044951/job/132972347897` and retain the distinct
  timer sighting `43689826000/job/132738101327` in detail. The retention cell says to retain
  logs before retrying; the evidence cell links to the section containing every existing path.
  Preserve diagnosis run `43717151594`’s missing job ID and the group’s existing heading anchor.
- [ ] Replace `docs/backlog.md:1753` with one index line linking to the table, keeping its
  searchable IDs A891, A999, A1230, A1305, A1027 and A419. Find every moved-section consumer
  with `git grep -n 'ci.md#'` and same-file fragment searches; update affected links only.
  `docs/developers/ci-and-gates.md:1340,1348` remain unchanged because A1027/A1230 stay in place.
  Keep unrelated backlog entries and developer-guide procedures intact.

## Checks before landing

Compare the base and candidate text for every source section above. Account for every run/job URL,
bare run/job ID, retained-log path, artifact name and diagnostic link in a row or retained detail.
Use only recorded IDs to form missing run/job links; write “not recorded” for absent dates,
job IDs or log locations. For A1022 say “no CI run created”; for A544 say “local pre-push,
no CI run”, preserving the actual absence rather than implying a missing record. Do not search for newer
sightings. Preserve every “unknown”, “unverified”, “likely”, missing-log and reproduction limit;
passing retries remain observations. Keep the heading-order cause unexplained and PR #414's
unanswered-call cause open despite its retired exit-1 path.

Repeat `git grep -n 'ci.md#'` and check same-file fragments against final headings/row IDs;
every affected inbound link must resolve. Read the table for usable cell lengths and escaped pipes.
Run `git diff --check`, inspect `git diff --name-only` and `git diff --numstat`, and review the full
documentation diff. No tests, CI experiments, new scanner, registry or check infrastructure;
no production, test, configuration, workflow or root `CLAUDE.md` edits.

**Expected size:** consolidation adds about 35–55 documentation lines and removes 90–130;
this plan adds about 65 lines separately. Production +0/−0; tests +0/−0; test support +0/−0.

**Driver handoff:** Arrange Claude's plan review with `claude-seat.sh review-branch`, quote the
queue ask verbatim in its brief, resolve findings and obtain watcher clearance before building.
Name the reviewer and watcher; do not claim owner design approval. Use the registered
branch, `git commit -s` and normal hooks. Take Lane I's shared main lock only for the refreshed
fast-forward and direct push, release only your own lock, and follow the normal main-update and
cleanup steps. No PR or forced CI run. This authoring task stops at the saved draft.

**16 November execution note.** The watcher cleared the corrected plan at 05:23 after Claude’s
sole plan read (166 seconds), with all six findings accepted. No separate owner design approval
is claimed. The fiscal paragraph keeps its original timing and trace limits as linked detail so
the table remains readable. The eighteen rows preserve the recorded sightings; this work does
not search for later recurrences or close any investigation.
