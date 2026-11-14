# A1527: Find a setting inside its window

Design draft, 14 November 2026. Proposed behaviour only; no owner design approval is claimed.

You remember **“Remind to fire the next course after”**, but not which window contains it.
Type that label, or “remind”, into **Search pages**. Alongside existing page results, you see
one setting result bearing that exact label and its location: **Departments and zones / Service**.
Page matches keep their existing priority; setting-label matches precede matches found only in
the location. Search uses the existing `destinationMatches` matching rules against labels in your
current dashboard language, including the owning page, tab and menu section. In Spanish, the same
setting is found as **“Avisar para marchar el siguiente curso tras”**. Switching language refreshes
results without clearing what you typed. This adds no synonyms or cross-language search.

Select the result by click or Enter. With several active departments, a **Which department?**
chooser lists their current names and explains that the choice opens this setting for that
department. It offers Cancel and makes no choice for you, even if a department is already open.
With one active department, go straight there. With none, show **“There are no active departments.
Add a department to configure this setting.”** Offer **Open Departments and zones** and Cancel;
search itself creates nothing. Loading and failed reads are explained, with Retry for a failed
read, rather than treated as an empty list.

Choosing Restaurant opens its existing department window at
`/manage/venue-operations/department/<id>/view/service`. After the window and tab render, scroll
the reminder into view and focus its native control through the field component. Reveal a
containing collapsed section where necessary. Search changes no value and never saves. Back,
Forward and reload retain the existing department/tab route behaviour; field focus is a
one-time navigation aid.

The smallest extension keeps `DashboardContribution.searchDestinations` and
`DashboardSearchDestination` in `packages/dashboard-kit/src/contract.ts`. Add optional target
metadata (field identity and tab label key) and an optional module-owned resolver returning
labelled candidate paths. Static destinations retain their current path. The dashboard handles
zero/one/many candidates; venue-service supplies active departments through `VenueServiceApi`,
with existing permission checks. `collectSearchDestinations` validates resolved paths within
the declared screen, as it does static paths. After `#openSearchDestination` completes guarded
navigation, an optional reveal method on `DashboardScreenHandle` delegates through
`venue-departments-shell` to `department-settings`. The dashboard shell never learns department rules.

Keep each form’s searchable field identity, existing translation key, tab and route builder in
a small definition beside that form. Both rendered labels and contributed destinations consume
it; department settings reuse their existing `fieldTab` mapping. There is no second translation
list. Existing form fixtures provide the completeness check: rendered setting controls across
offered tabs must correspond to declared targets, whose localized labels and resolved routes
must reach those controls. New settings join this same definition and check. This is explicit
form ownership, without a form framework or runtime crawler.

Only enabled modules and readable pages contribute results; child permissions apply too.
Read-only access stays read-only. Conditional fields use the form’s availability rules to filter
department choices, explaining when none qualify. Recheck availability and permissions before
opening; a removed department or disappearing target gets an explanation, never a fallback
editable field. Final navigation uses `navigationGuardFor(window).write` and existing
`navigationScopes`: Keep editing retains draft, query and drawer; Discard proceeds. Switching
offered tabs within the same department retains its draft.

A1529’s **Hardware** contains Device profiles, Devices, Printers and Card payments; **System**
contains the remaining former Settings pages. Derive result locations from `#permittedNav`,
never a duplicated hierarchy. Acceptance includes both reminder languages, zero/one/several
departments, Keep/Discard, conditional and denied targets, and moved Hardware/System results.
Scope excludes searching saved values, a server index, database, ledger, history or permission
bypass. This design awaits owner review.
