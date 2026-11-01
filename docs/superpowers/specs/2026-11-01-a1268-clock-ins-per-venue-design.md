# A1268 — Clock-ins are per venue: one working-time chain per box

Status: design, 2026-11-01, lane B. Owner decision it builds: "Clock ins should not be per location,
but per venue" (2026-11-01 ~00:10, lane B `questions.md`). Backlog: `docs/backlog.md` → A1268, detail
in `docs/backlog/box.md`.

## 1. What changes, in one paragraph

A person is clocked in or out at the venue — the box — not at a location. Today the working-time
record keeps one hash chain per (node, location), the till refuses a clock-out or break at a location
other than the one the open shift's last entry was made at, and every reading that pairs a clock-in
with its clock-out pairs only entries made at the same location. After this item there is one chain
per node, a person's clock state is one state for the whole venue, and a work session is a person's
clock-in followed by their next clock-out wherever each was made. Each entry still records the
location it was made at; a per-location view (the art. 34.9 export, the end-of-day pass, the hours
screen) counts a session at the location of its clock-in.

## 2. Why the old shape existed, and why it can go

The workforce spec chose one chain per location because a location was read as the legal workplace
(centro de trabajo), and on 2026-09-07 added the node so that a promoted cloud and a returned box
keep separate chains (`docs/superpowers/specs/2026-07-22-workforce-and-time-record-design.md`, §5
and its 2026-09-07 note). The owner's decision replaces the first reason. The second is kept: the
chain stays per node.

What the per-location chain bought that the per-node chain loses: a location's entries could be
verified as a chain on their own. The export carries no entry hash (its one hash is the pay-period
closure's, whose chain D6 leaves alone; `grep -n -i 'hash' packages/workforce-es/src/record-export.ts`
prints only `closureHash` lines), and the time chain is verified whole, by node, by backup
verification. The export does show each entry's node and its position in
the chain (`packages/workforce-es/src/record-export.ts`, "Chain position"), so after this item a
location's export can skip position numbers where the box recorded entries for another location;
the plan decides how the export says so.

How often the difference shows today: a box serves one location (`nodes.location_id`,
`apps/server/src/node-config.ts`), and the till admits only devices bound to it
(`apps/server/src/till-clock-api.ts`, `admit`). Entries at a second location on one box come from a
dashboard correction that names another location (`packages/workforce/src/corrections.ts`) and from
tests. So on a one-location box this item changes no clock result; it removes the cross-location
cases, the backward-step residual slice 9b pinned, and the per-location assumptions a second
location would have exposed.

## 3. Decisions

**D1. One chain per node.** `workforce_chains` is keyed by `node_id` alone and loses its
`location_id` column. `time_entries_chain_position_uq` becomes (node_id, sequence_no) and
`time_entries_person_chain_idx` becomes (person_id, node_id, sequence_no). `ChainKey` becomes
`{ nodeId }`; the entry's location moves onto the append input (`TimeEntryAppend.locationId`). The
entry hash is unchanged: it already hashes the entry's own `location_id` and `sequence_no`
(`chain-hash.ts`), so only the numbering scope changes. The `recorded_at` clamp becomes per node,
which is stronger, not weaker: it was already monotonic within each (node, location).

**D2. The migration re-keys outright, with no carry-forward** (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production"). A venue whose
node already wrote entries at two locations has two runs of sequence numbers on that node, which the
new unique index refuses; such a database fails the migration and is reset. A venue whose entries were
all made at one location migrates in place, because its (node, location) chain is already its
node's only chain; the build checks the demo seed and the upgrade test's rows against this. The PR's first line says which venues need
a reset. `time_entries` keeps its append-only triggers; only its two indexes are dropped and
recreated, so no trigger set changes (to be confirmed against `scripts/append-only-triggers.test.ts`
in the build; if the generation rebuilds `time_entries`, the PR discloses it as §3 requires).

**D3. Clock state is per person, across the venue.** `readLatestLiveEntry` already reads a person
across every chain; it stops matching the location inside a chain. The till stops refusing a
clock-out or break because the open shift's entry was made at another location
(`till-clock-api.ts`, `writeClock`, `attendance.not_permitted`), and the till's "Your open shift
belongs to another location" message and its disabled clock buttons go, in English and Spanish.
Device admission (`admit`, a device bound to another location) is unchanged: that is about which
devices this box serves, not about clock state.

**D4. A work session pairs a person's entries regardless of location, and belongs to the location
of its clock-in.** Every pairing that today keys on (person, location) keys on the person: the
hours projection, the period record's sessions (`record-period.ts`), the end-of-day intervals
(`end-of-day.ts`), the hours screen's open-shift read (`hours-reads.ts`), and the correction
sequence check (`corrections.ts`). Where a reading is per location, a session is counted at the
location its clock-in was made at; its later entries may carry other locations. The end-of-day
pass's automatic clock-out closes a session whose clock-in was at the day's location, whatever
location the person's latest entry was made at, and the automatic entry is written at the clock-in's
location.

**D5. Rules that tie an answer to the entry it answers stay per location.** The foreign key
`time_entries_response_subject_fk` (an answer shares person and location with the entry it answers)
and the correction-to-target subject check keep the location: a correction or confirmation is
written at the location of the entry it corrects or confirms. They are about one entry and its
answer, not about clock state, and every writer already stamps the target's location.

**D6. Pay-period closures keep their own per-(node, location) chain.** A pay period is closed per
location (`pay_period_closures_period_uq` is on location and period). This item does not change it.
Backup verification groups time entries by node and closures by (node, location).

**D7. "First clock-in today" and attendance discovery read the person across locations, by the box
location's business day.** `till-clock-state.ts`'s `firstClockIn` stops filtering by location; the
day it uses stays the box location's business day. `attendance-discovery.ts` stops returning early
when the person's open session began at another location; its per-(location, day) reconciliation is
unchanged, with a session counted at its clock-in's location.

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

- **PR 1 — one chain per node (D1, D2, D6's backup-verification split, D3's read).** Schema,
  migration, chain API, every `appendToChain` caller, `readLatestLiveEntry`'s subqueries, backup
  verification, the tests that pin the old key, and the workforce spec's dated pointer. Slice 9b's
  cross-location residual test flips here: with one chain per node, `readLatestLiveEntry` already
  takes the last-written entry across locations. On a one-location box nothing visible changes.
- **PR 2 — clock state and sessions per venue (D3's till change, D4, D5, D7).** The pairing
  functions already pair per person; what splits sessions by location is callers that filter a
  person's entries by location before pairing, the period record's grouping and one rule in the
  correction check. PR 2 removes those, decides what a location's view of the record holds (the
  plan's rule), removes the till refusal and message, and updates end-of-day, automatic entries,
  corrections and hours reads, and any guide sentence that says per location (the survey found none).
- **PR 3 — part 2 (§4)**, with its own plan.

Each PR leaves `main` working on its own. Fiscal gates: none of this touches the fiscal core; the
golden huella test and `inmutabilidad` pass unedited.

## 6. Not in scope

- A cross-node write order (two nodes writing one venue database after a promotion still merge by
  time, §4).
- Any change to which devices a box admits, or to multi-location boxes as a product feature.
- The pay-period closure chain (D6).
