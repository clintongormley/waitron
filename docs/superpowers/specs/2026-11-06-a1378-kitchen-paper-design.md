# A1378: kitchen paper identifies the work and the party

The watcher relayed the owner's approval of all six recommendations on 6 November 2026 at about
13:30. This records that approved scope alongside the three independent paper fixes. Everything
lands in one pull request. New English and Spanish fixed words need the watcher's approval before
landing; that wording question is in Lane F's questions file, not this repository.

## Approved behavior

1. Kitchen paper uses the saved venue zone. Send and reprint instants convert separately. Whole
   quantities lose their zero fractional suffix, including measured extras; fractions keep their
   supplied precision. A divider ends a late-send run before the next unmarked dish unless a new
   group or station heading already separates it. Corrections and MOVED carry no late-send marks.
2. A mixed shared-printer ticket marks FIRE only in each station section whose HOLD paper was
   recorded. A single-station ticket retains its existing banner. HOLD tickets retain their existing
   whole-ticket banner. A station receiving its first paper must not look like it is being fired
   again from a previously printed HOLD ticket.
3. A reprint keeps its earliest original send time and its separate reprint time. This is the
   existing rule, retained and tested, rather than a new choice of clock.
4. A party's kitchen-note change produces one slip per affected printer and one displayed notice
   per affected station, listing the affected bill numbers. Independent counter orders and other
   parties stay separate, even when their names, notes and event times match. Measured/sold-as-recorded
   portions and group identities retain their meaning. Acknowledging the one notice covers all its
   underlying rows.
5. Correction slips add the party name beside the order number, using the current surviving
   party's name after a merge. An unnamed order retains its existing number-only header.
6. Naming, renaming or clearing a party name after its food was sent prints one name-change slip
   at each affected printer. It names the old and new names and the affected orders. No outstanding
   kitchen work means no slip; saving the same normalized name means no slip. Fired work and HOLD
   paper actually recorded at its station count, including a settled bill's unserved food. Served,
   collected, abandoned and made-here-only work does not receive a new kitchen instruction.
7. MOVED combines identical whole portions under the station's existing combined setting.
   Separate retains one entry per whole unit. Group boundaries, measured portions and items marked
   printed-as-sold stay separate. This is layout only: links, quantities and kitchen state do not
   change.

## Implementation calls

Keep the pure renderers in `apps/server/src/kitchen-ticket.ts`. Resolve language, time zone,
party names and printer routing inside the existing transaction in `kitchen-print.ts`, outside
printer/item rendering loops. Keep the existing routing and active-printer selection. Existing
queued bytes are immutable; a new reprint resolves current presentation as it does today.

Extend note-change JSON with optional `partyId` grouping context, not a new column. Counter
changes have no party context. Record the original bill/dish rows and share one timestamp and
combined bill label across a party change. The notice folding/acknowledgment key distinguishes
party context from order context, then includes the change time and before/after values. This
keeps the data's bill attribution while presenting one party notice. Do not attach another bill's
lines to an anchor bill or delete notice rows to simulate grouping.

Change `setPartyName` to accept the existing trading context; update its route and direct callers.
Read the old name, save the new normalized name, and enqueue name-change paper in that same
transaction. Reuse the existing pending-work and party-family rules, checking whether each station
actually received held paper. A disabled or deleted printer gets no new job. Name slips contain
identity and old/new names, not a new cooking command.

Build a party-wide note slip from all affected bills at once, resolving their ticket items once.
Only bills represented at a particular output appear on its paper. A name change also lists only
orders with outstanding work at that printer. Group by party identity, not its name. Follow merged
party identity through the existing survivor reader; two counter orders never share an identity.

The proposed new fixed words are `Orders` / `Pedidos`, `NAME CHANGED` / `NOMBRE CAMBIADO`,
`Now` / `Ahora`, and `(unnamed)` / `(sin nombre)`. Reuse existing `Was` / `Antes` and all FIRE,
HOLD, note-change and singular-order words. Proposal approval remains a landing condition.

## Constraints and evidence

No schema file, migration, table, column, index or trigger changes. No fiscal writer or golden
fixture changes. Work stays venue-wide, with no new location parameter or concept. All new jobs
use the existing print outbox and the same transaction as the change they describe. No network
printer call enters a request's write transaction.

Each new behavior starts with an observed failing test. Preserve old checks except exact paper
expectations the approved behavior changes, and register each such change in the PR. Exercise
contrasting host time zones. Run one-time mutation controls in an owned disposable candidate,
never as permanent self-mutating tests. Inspect actual EN/ES raster previews at both paper widths;
software previews do not prove a physical printer's output.
