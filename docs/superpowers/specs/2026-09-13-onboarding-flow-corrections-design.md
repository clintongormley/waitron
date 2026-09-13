# Onboarding flow corrections

Findings from walking the box setup on a real machine (backlog B1). The wizard works, but it sprawls
across the full width of the browser, asks for a display name without asking who you are, hides a
tooltip off the edge of the screen, puts a derived answer fifteen fields above the question that
derives it, and hands you a dashboard in a language you never chose. Setup also leaves the venue
with a single product language when the deli needs three.

Translating the wizard itself is out of scope and has its own backlog entry. The wizard stays in
English; what changes is that it stops imposing English-or-Spanish-by-geography on the account it
creates.

## Decisions

### Shape

- The wizard shell wraps every screen in `wt-modal` — the component the staff editor already uses —
  so setup is a centred box of the same width rather than a full-browser-width page. The certificate
  screens are included.
- Each screen drops the plain `wt-card` it wraps itself in, since the modal now supplies that
  surface and padding, and keeps its `h1`. The `wt-card raised` elements *inside* `mode`,
  `role`, `live-source` and `configuration-preview` are choice tiles, not screen chrome, and stay.
  `provisioning` has a plain card on each of its two branches; `live-source` has none.
  *Correction, 2026-09-13, found in review before landing:* this was wrong about
  `configuration-preview`, whose raised card wrapped the whole screen including its Back and Continue
  buttons. It was chrome, and it was removed like the others.
- The modal needs an accessible name and the screens keep their own `h1`, so the shell passes
  `aria-label` rather than `heading` — setting `heading` would paint a second title above the first.
- `wt-dialog` gains a `dismissible` property, defaulting to true so every existing caller is
  unchanged. The wizard sets it false: a setup wizard that Escape can dismiss would leave the
  operator on an empty page with no way back. It cancels the dialog's own close request rather than
  reopening after the fact, so focus never leaves the wizard.
- Back and Next stay inside the scrolling body, where they are today. Moving them into the modal's
  fixed footer would mean every screen handing its actions up to the shell; that is a separate
  change and is not made here.

### Your account

- "The first operator" becomes "Your account".
- The account screen collects First name(s) and Last name(s) above Display name. Both are required,
  matching what the dashboard already requires when a manager adds anyone else.
- Display name fills itself in as "First Last" while you type, and stops following the moment you
  edit it by hand. The dashboard's own person form does this today from the first names alone;
  it changes to the same "First Last" rule, so the two places behave identically.
- `persons` already carries `first_names` and `last_names`. The wizard's provision request, the
  venue plan's `seed-admin` action and its insert carry them through. No migration.

### The language your account gets

The dashboard opens in Spanish after setup because nothing ever wrote a language onto the account it
created, and an account with no language falls back to the venue default, which geography derives as
Spanish for a Spanish venue. Two separate fixes:

- **At provisioning:** the server resolves the operator's UI language from the `Accept-Language`
  header on the provision request — that request comes from the operator's own browser — and writes
  it to the admin's `persons.locale`. It reuses `resolveLoginLocale`, with the venue's own
  geography-derived locale as the fallback when the browser asks for a language Waitron does not
  ship. So an English browser setting up a Barcelona venue gets an English account; a French browser
  gets the venue's Spanish.
- **For everyone else:** `GET /management-api/session/me` gains a field carrying the same
  `Accept-Language` match, and the dashboard prefers it over the venue default when the signed-in
  person has no saved language of their own. An explicit choice still wins over both. The response
  gains `Vary: Accept-Language`, as `/management-api/locales` already has.
- The till is deliberately left alone. A till is a shared device, so its browser's language
  preference describes the device, not whoever is standing at it.

### The passkey offer

- The offer screen already exists in the login screen but is only reachable after a password reset
  or an invitation. It gains an ordinary-sign-in path.
- `persons` gains a nullable `passkey_offered_at`. The offer appears when the person holds no
  passkeys and has never been offered one; it is stamped when they resolve it, by adding a passkey
  or by skipping. So it asks exactly once and never nags, and a browser that dies mid-offer gets
  asked again.
- `POST /management-api/session` returns whether to offer, computed inside the login transaction.
  A new `POST /management-api/session/me/passkey-offer` records a skip; who it stamps comes from the
  session, never from the request body. Someone who signs in with a passkey holds one by definition,
  so that path needs no special case. The Google sign-in does — see Out of scope.
- Adding a passkey from the profile screen stays available regardless.

### Languages for receipts and for products

Two different lists that setup currently gets wrong in the same direction — too few languages.

- **Receipts.** A province with a regional language pre-ticks Spanish *and* that language, Spanish
  first, instead of the regional language alone. Barcelona offers Spanish and Catalan. This is a
  default; the operator can still untick either. Generalising here rather than hard-coding Catalonia
  also makes Galicia and the Basque Country right, at no extra cost.
- **Products.** The catalogue seed hard-codes Spanish as the default with Catalan and English
  alongside, replacing today's single geography-derived language. This is hard-coded on purpose and
  is wrong for a venue outside Catalonia; it is the deli's shape, taken now because the right answer
  needs the venue's region and its chosen languages to drive it. The code carries a one-line pointer
  to the backlog entry, which this change adds.

### Tooltips

- `wt-help-tooltip` is absolutely positioned, centred on its own button, with nothing stopping it
  running past the edge of the window. It moves to a native popover positioned and clamped to the
  viewport, following `wt-row-actions`, which already solves this. Every app that uses the tooltip
  gets the fix.

### The fiscal territory line

- "Fiscal territory: …" moves from under Location name to directly beneath the Province selector,
  beside "Time zone: …". Both are things the province decides, and neither can answer before it is
  chosen.

## Validation

Failing behavioural tests first, in each case naming the behaviour rather than the markup.

- The wizard renders inside a modal, Escape does not dismiss it, and every existing caller of
  `wt-dialog` still closes on Escape. Prove the `dismissible` default by deletion. The wizard's
  accessibility tests run against the modal, in both themes, and the choice tiles still render.
- Blank first or last names do not advance; the display name follows "First Last" while untouched
  and stops once edited; both names reach `persons` through a real provision.
- A provision carrying an English `Accept-Language` writes an English locale onto the admin; a
  Spanish one writes Spanish; an unsupported one writes the venue's geography-derived locale. A
  signed-in person with no saved language gets their browser's; one with a saved language keeps it
  whatever the browser asks for.
- A first sign-in with no passkeys offers; a second does not; skipping stamps; a person who already
  holds a passkey is never offered. Assert the domain error code on any rejected write, not just
  that something threw.
- A Barcelona location pre-ticks Spanish and Catalan; unticking still works; a Madrid location is
  unchanged. A provisioned Spanish venue seeds Spanish, Catalan and English as product languages
  with Spanish default.
- A tooltip opened against the right edge of the viewport stays within it. The primitive keeps its
  token-painting and accessibility tests, extended to the popover's states in both themes.

The four browser packages run in real headless Chromium; check free memory and what else is testing
on the machine before scaling concurrency. Run the focused suites for what changed while
implementing, let the pre-push hook run the local gate once, and read CI's scope and result on the
current head before calling the branch green.

## Out of scope

- Translating the wizard and giving it a language chooser. Backlog entry added; the wizard stays in
  English.
- Moving Back and Next into the modal's fixed footer.
- Driving product languages from the venue's region and chosen languages. Backlog entry added.
- Offering a passkey after a Google sign-in. The offer rides on the password sign-in's response, and
  the Google callback finishes with a redirect to the dashboard that the sign-in screen never reads a
  body from. Google can only be linked from the profile screen while already signed in
  (`POST /management-api/session/me/google` requires a management session, and `completeGoogleLink`
  is the only code that ever writes a NON-NULL `persons.google_subject` — every other writer of that
  column sets it to null), so a genuinely first sign-in is a password one and anyone else can add a
  passkey from their profile.
