# A1268 — Working time is per venue

Status: design, 2026-11-01, lane B, revision 2. Owner decisions it builds: "Clock ins should not be
per location, but per venue" (2026-11-01 ~00:10); "These checkins should not be recorded per
location" and, on pay-period closures, "What is a location? This should all be per venue" (~14:40);
the two hash answers (~15:30) and the export answer (~15:55). All are in lane B's
`questions.md`, 2026-11-01. Backlog: `docs/backlog.md` → A1268, detail in `docs/backlog/box.md`.

> **Revision 2 (2026-11-01, owner's per-venue decisions).** Revision 1 kept a location on every
> clock entry, counted a work session at its clock-in's location, kept answers per location (D5)
> and kept pay-period closures per location (D6). The owner overrode all of that. What changed:
> - Clock entries carry no location: no column, nothing on the append input, nothing in the entry
>   hash (D1, D2).
> - A work session is the person's, at the venue. There is no per-location view of working time,
>   so "counted at its clock-in's location" is gone (D4).
> - D5 is removed: a correction or confirmation is tied to its entry by person and entry only (D4).
> - D6 is reversed: one pay-period closure per period for the box, chained per node, with no
>   location in the closure hash.
> - The legal working-time export is per venue and names the venue once; it gains no note about
>   chain positions (D8, new).
> - The end-of-day pass and attendance work per venue, on the venue's business day (D7).
> - One pull request instead of two (§5). The old PR 2's per-location view is not built.

## 1. What changes, in one paragraph

A person clocks in and out at the venue — the box — and nowhere in the working-time record is
there a location. Today each clock entry stores the location it was made at
(`time_entries.location_id`, `packages/workforce/src/schema/time-entries.ts:52` on main), hashes it
(`["LocationId", input.locationId]`, `packages/workforce/src/chain-hash.ts:67`), keeps one hash
chain per node and location, keeps one pay-period closure per location and period
(`pay_period_closures_period_uq`, `schema/pay-period-closures.ts:29`), and every reading that pairs
a clock-in with its clock-out or ties an answer to its entry compares locations
(`sameSubject`, `packages/workforce/src/effective-entries.ts:17-19`). After this item the entry has
no location, the chain is one per node, a pay period is closed once for the venue, and every
reading is per person at the venue.

## 2. Why the old shape existed, and why it goes

The workforce spec chose one chain per location because a location was read as the legal workplace
(centro de trabajo), and on 2026-09-07 added the node so that a promoted cloud and a returned box
keep separate chains (`docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md`, §5
and its 2026-09-07 note). The owner's decisions replace the first reason: the workplace is the
venue. The second is kept: the chain stays per node.

The export carries chain fields: "Node reference" and "Chain position"
(`packages/workforce-es/src/record-export.ts:66-67` on main), filled for each entry. Revision 1 said
it carried none; that was wrong. With the location filter gone, a one-person export still lists
only that person's entries, so its positions can skip numbers, as they could before A1268. The
owner's per-venue decision, as the watcher relayed it (~14:40), drops the note revision 1 planned
about skipped positions; the export carries none.

How often the difference shows today: a box serves one location (`nodes.location_id`), and the
till admits only devices bound to it (`apps/server/src/till-clock-api.ts`, `admit`). Entries at a
second location on one box come from a correction that names another location
(`packages/workforce/src/corrections.ts`, the missing-entry input) and from tests. So on a
one-location box this item should change no hours anyone sees (read, not run); what it changes is
what is stored and hashed.

## 3. Decisions

**D1. One chain per node, and no location on an entry.** `workforce_chains` is keyed by `node_id`
alone. `time_entries` loses `location_id` and its foreign key. Its chain-position key becomes
(node_id, sequence_no), the person's chain index (person_id, node_id, sequence_no), and the two
keys that tie an answer to its entry become (entry, person): `time_entries_response_subject_fk`
and the three `attendance_questions` keys to an entry
(`packages/workforce/src/schema/attendance.ts:168-182` on main). `ChainKey` is `{ nodeId }` and the
append input (`TimeEntryAppend`) has no location. The `recorded_at` clamp becomes per node.

**D1h. The entry hash leaves the location out** (owner, ~15:30, question 1, answer (a)). The hashed
string has no `LocationId` field at all, not an empty one: it runs
`SequenceNo=1&PersonId=…&NodeId=…&EntryKind=in&EventAtMs=…&…&PrevEntryHash=`, where today a
`LocationId=…` field sits between `PersonId` and `NodeId`. Every other field, its order and its
encoding stay as they are (`canonicalString`, `chain-hash.ts:63-96` on main).

**D2. No carry-forward; venues with working-time history are reset** (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production"). Both hashes
change, so a stored chain or closure written before this item no longer verifies. The migration
does not try to rewrite them. A rehearsal on `node:sqlite` (plan, "What the rehearsal found")
showed that the migration `drizzle-kit` writes refuses, and changes nothing on, a venue whose chain
head points at an entry — every venue that ever recorded a clock entry through the app — and a
venue holding an attendance question with a reminder email. An empty or fresh venue migrates.
The PR's first line names the venues that need a reset. A backup taken before this item holds the
same rows, so restoring it into the new image is expected to meet the same refusal (not run).

**D3. Clock state is per person, across the venue.** `readLatestLiveEntry` already reads a person
across every node's chain. The till's refusal of a clock-out or break on a shift whose last entry
was made at another location goes (`apps/server/src/till-clock-api.ts:152-157` on main), with the
`activeLocationId` field it compares (`apps/server/src/till-clock-state.ts:14,63`), the till's
"Your open shift belongs to another location" message (`clock.other_location`,
`apps/till/src/i18n/strings.ts`) and the disabled clock buttons that go with it
(`apps/till/src/widgets/till-shell.ts:1103-1121`). "First clock-in today" counts the person's
clock-ins at the venue. Which devices a box admits (`admit`) is unchanged.

**D4. A work session, a correction and a confirmation are the person's, at the venue.** A session
is a person's clock-in followed by their next clock-out, whichever device or node wrote each. There
is no per-location view of working time: nothing filters or groups entries, sessions or correction
items by location. A correction or confirmation is tied to the entry it answers by the entry and
the person only. This takes in what revision 1 kept as D5. Where the attendance tables still need
a place for a correction item, no location is passed in (watcher, 2026-11-01 ~17:05): a manager's
proposal shown to the worker takes the venue's name and time zone from A1301 S1's `readVenue`, and
an attendance command's `location_id` stops being required, holding a value only when the command
answers a question (plan, open question 1).

**D5.** Removed in revision 2 (see D4).

**D6. A pay period is closed once for the venue** (owner, ~15:30, question 2, answer (a)).
`pay_period_closures` loses `location_id`. A period is unique by (period_start, period_end); the
closures form one chain per node, unique by (node_id, sequence_no). `computeClosureHash`
(`packages/workforce/src/pay-period-chain.ts:119-139` on main) drops `row.locationId` (:123), and the
snapshot it hashes no longer carries a location on its sessions or entries (:17, :57, :83). The
zone and day start stay in the hash with the same values. Backup verification groups closures by
node.

**D7. The end-of-day pass and attendance are per venue, on the venue's business day.** The pass
reads every entry of the venue inside the day's window and pairs it per person. The business day
still comes from the box's one location's time zone and day start, read through the existing
`readLocationClock` with the location the server is configured with (the owner, ~14:40; lane A's
A1301 moves this to the venue). The attendance tables' own `location_id` columns — the day being
processed, the scan bookmarks, the activity facts, the questions and the answer commands — stay
until A1301 removes them; they no longer compare with any entry's location, because the entry has
none.

**D8. The legal working-time export is per venue** (owner, ~15:55). It reads the venue's whole
record, filtered by person when one is chosen. The opening table names the venue once
(`Workplace | From | Before (excluded) | …`); the "Workplace reference" column goes from it, and
the entries and closures tables carry no workplace column. The workplace name is read as it is
today, from the export input's location (`record-export.ts:181-185` on main); A1301's slice S14
moves it to the venue. No note about chain positions is added.

## 4. Part 2 — readings that order entries by time after a backward clock step

Slice 9b made the deciding entry the last one written within a chain (`readLatestLiveEntry`, Task
15a). Three readings still order a person's entries by event time (`compareEvents` in
`effective-entries.ts`): the hours projection, the end-of-day intervals and the correction sequence
check. After a backward step a clock-out can carry an earlier time than the clock-in it closes, so
these readings see an unmatched clock-out, and every other correction for that person is refused
`correction.invalid` `unmatched_out` until a manager retimes one of the two. That was found by
reading, not by running (backlog entry).

With one chain per node (D1), a person's direct entries on a node have a complete write order. The
rule for part 2: **pair by write order, show the time as written.** Direct entries (and retimes of
them, which take their base entry's place) are ordered by chain position; an approved missing-entry
correction, whose time the requester chose, is placed by its time among them; entries from different
nodes are merged by time, as today. A session whose clock-out time is before its clock-in time is
then paired, not refused, counts no hours, and is shown as needing a retime. Part 2 gets its own plan
after part 1 lands, since it changes what the hours and correction screens show.

## 5. Delivery

- **One pull request for part 1: #2375, revised** (`feat/a1268-clock-ins-per-venue`). It carries
  D1–D4 and D6–D8 together. Dropping `time_entries.location_id` forces every reader of it to change
  in the same pull request, and the owner asked for both hash changes in the pull request that
  removes the column, so there is nothing left to split off: the readers that pair, correct,
  close, export and reconcile all read the entry's location today. What #2375 already built
  (one chain per node, backup verification's split) stands; its location on the append input, its
  location index and its export note are taken out. The plan says commit by commit.
- **Revision 1's PR 2 is not built.** Its per-location view of a record (`recordAtLocation`) has
  nothing to separate once entries carry no location; its other parts are in the one pull request.
- **Part 2 (§4)** follows with its own plan.

The pull request leaves `main` working on its own. Fiscal gates: none of this touches the fiscal
core; `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
`… vitest run src/write-path.e2e.test.ts` pass unedited.

## 6. Not in scope

Each is left for lane A's A1301 (its design §6, "How A1301 meets A1268"), which starts its
working-time slices after this item lands:

- Which devices a box admits (`admit`), and the business day's source moving from the box's
  location to the venue (A1301 S12, S13).
- Rosters, shifts and shift templates, and the convenio settings (A1301 S13, S20, S22).
- The `location_id` columns of `attendance_day_work`, `attendance_source_state`,
  `attendance_operation_facts`, `attendance_questions` and `attendance_response_commands` (A1301
  S22), and the `locationId` that the hours, attendance and export routes still take to choose the
  business-day clock and the questions shown (A1301 S13, S15).
- Where the export reads the workplace name (A1301 S14).
- A cross-node write order (two nodes writing one venue database after a promotion still merge by
  time, §4).
