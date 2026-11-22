# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Four groups, and none comes before the others (owner, 2026-11-22):

- **Floor staff on the till.** Waiters and bar staff during service, on a tablet, a phone or a
  fixed till screen, logging in with a PIN between tables. They touch the screen under time
  pressure without looking carefully, and after logging in they want the table layout or the
  orders at once, with nothing offered on the way.
- **The venue owner or manager on the dashboard.** Setting up menus, products, staff, devices,
  printers and the venue's look, and reading sales and reports. Often working alone, at close or
  before opening, with no technical help.
- **Cooks and prep staff.** Reading the prep-station screen and printed station tickets in a hot,
  busy kitchen, often from a distance.
- **Whoever installs the box.** The owner or someone acting for them, on the setup page, bringing a
  new box up, restoring one, or joining a spare box to it.

Diners also read what Waitron prints: receipts, invoices and the published guest menu, in their own
language where the venue offers it.

## Product Purpose

Waitron runs a restaurant: point of sale, table and order handling, bookings, kitchen tickets and
displays, card payments, staff hours, and Spain's Veri\*Factu tax filing. A venue runs it on a small
machine, the **box**, in the restaurant itself (self-hosted), or as a hosted instance of its own.
Success is a service where staff never wait on the system, and a venue owner who can run and repair
it alone.

## Positioning

What future design leads with (owner, 2026-11-22):

- **Nothing outside the venue stops a sale.** The box in the venue is in charge. The tax agency or
  the card network going down does not block a sale: tax records queue and are sent later, and a
  card payment falls back to another route or cash. Losing the internet does not block one either,
  except while the box's time is unconfirmed: a box that files records and whose internet time
  service is not synchronised waits, after a start or a clock jump of over a minute, for its time to
  be confirmed. Such a box also goes back to waiting, once, when the tax agency refuses as dated in
  the future a record written since its time was last confirmed (`CLAUDE.md` §5).
  The box can also pause sales for reasons inside the venue, such as a full disk or a till that
  cannot reach the main box.
- **The venue owns its till.** The source is available, a venue may run it on its own hardware at
  any scale, and if the licensor publicly announces that Waitron is discontinued, or publishes no
  release for twelve consecutive months, the most recently published version also becomes available
  under the Apache License 2.0 (`LICENSE-GRANTS.md`, Grant 2). The till does not die with the
  vendor.
- **The person in front of the screen fixes it.** There is no paid support. The rule for a refusal
  is that it says plainly what happened and what each choice does, offers an administrator or owner
  sign-in right there when more rights are needed, and lets the person choose, with a safe way to
  stop before anything destructive, never sending them to "your administrator", "support" or
  "whoever installed this". The owner's few exceptions are in `docs/developers/conventions-ui.md`
  ("Refusals name a self-service next step"). When a boot fails, the box's own recovery page shows
  why and what to do.

Veri\*Factu filing is built in but is not what the design leads with: it should work without the
venue having to think about it.

## Operating Context

- **During service:** tills and handhelds on the floor, prep-station screens in the kitchen,
  receipt and kitchen printers, a cash drawer, card readers. What a device may do is set by its
  device profile and, where someone signs in, by that person's permissions as well; nobody signs in
  on a prep station display (`packages/layouts/src/device-profile.ts`).
- **Before and after service:** the dashboard, usually on a laptop or desktop browser, sometimes a
  phone.
- **Installing and recovering:** the setup page and the box's recovery page, reached from a browser
  on the venue's network. The operator has no terminal access to the box; the web pages are their
  only window onto it.
- **Documents people handle:** receipts and invoices (one for every sale), kitchen station tickets
  on narrow thermal paper, A4 invoices, equipment labels and a printed recovery sheet.
- **Help:** short help bubbles on screen, switched on with help mode, link to a full guide in
  English and Spanish (`apps/server/src/guide/`).

## Capabilities and Constraints

- **Three browser apps** share one set of components and tokens (`packages/ui`, `packages/ui-core`):
  the till (`apps/till`), the dashboard (`apps/dashboard`) and setup (`apps/setup`). The server
  (`apps/server`) also renders a few pages of its own, such as the recovery page and the guide.
- **Languages:** English and Spanish throughout. The screen follows the browser's language until a
  person saves one. Receipts print in the venue's receipt language. Product text is English in code
  and translated.
- **Terminology:** the machine is the **box** in English and **servidor** in Spanish. The till says
  **Log in** / **Log out**. A product's options are **variants**, never sizes. Create buttons say
  **Add …**, never **New …**. A product has three names: a staff name, a customer-facing name and a
  prep-station name, each shown on its own surface (`docs/developers/products.md`).
- **Text is short.** Labels, messages, alerts and printed lines say the least that still makes
  sense. Help orients in a few sentences and links to the guide; the guide says what to do, not how
  the code decides.
- **Venue look:** light and dark themes, following the device unless a person chooses. A venue can
  set its own logo, brand colour, background, corners and text size from the dashboard's
  Appearance page.
- **Browsers:** features that are widely available may be used freely; newer ones only with a
  fallback, so an older iPad still works.
- **Hard constraints that design must not work around:** tax records are permanent and invoice
  numbers are never reused, so no screen may offer to edit or delete a filed record.

## Brand Commitments

- The name **Waitron** and the Waitron logo are reserved by the licensor and are not licensed with
  the software, and neither the licence nor its grants give permission to brand your own
  distribution Waitron. Venues brand their own screens and printouts through Appearance, so
  Waitron's own identity should stay out of the way of the venue's.
- Voice: plain, direct, brief. Never blames the person.

## Evidence on Hand

- **Pre-release.** Waitron is not yet running in production anywhere. There are no customers,
  testimonials, case studies, usage figures or press, and future work must not invent any.
- Real material: the user guide (`apps/server/src/guide/en/` and its Spanish twin), the design
  system contract (`docs/developers/design-system.md`), the licence summary in `README.md`, and a
  demo venue the dev stack seeds.

## Product Principles

1. **Service does not wait on the outside world.** Nothing outside the venue stands between a staff
   member and a sale, apart from the time check above, and nothing optional stands between logging
   in and working.
2. **The person at the screen can act.** Explain, offer the sign-in that unlocks the next step, and
   let them choose. Never strand them.
3. **Say less.** The more a screen says, the less people read. Help orients; the guide documents.
4. **Fix it once, in the shared part.** A complaint about a shared component is fixed in that
   component, for every screen that uses it.
5. **The venue's identity comes first.** Waitron provides the structure; the venue's logo, colours
   and language fill it.

## Accessibility & Inclusion

- Touch targets are at least 44 by 44 CSS pixels on both axes, because till screens are tapped in a
  hurry. The design system contract lists the exceptions under `--wt-tap-min`
  (`docs/developers/design-system.md`).
- Each shared `wt-*` component has automated accessibility tests in both themes. How components stay
  visible under Windows' high-contrast (forced colours) themes is in the contract's "Forced colours"
  section.
- Text size can be raised venue-wide from Appearance.
