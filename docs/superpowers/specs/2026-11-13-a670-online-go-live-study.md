# A670: an online menu from day one

**Design study, 13 November 2026. Proposal for the owner to see, not an approved design or a
build plan.** The owner’s request, quoted in Lane D `questions.md`, WATCHER 12 November 20:45:
“The online menu could be simpler, but it needs to be available pretty much from go live anyway”.
The watcher’s 13 November 19:31 request separates this read-only study from printed templates.
The dated pointer in the [earlier proposal](2026-11-12-a670-guest-menu-design.md) records the
change of direction; that proposal remains historical.

## Proposed smallest usable result

You select one published menu and give guests one public link, also usable as a QR code or a link
from your website. A guest opens it on mobile data without signing in, installing a certificate
or joining restaurant Wi-Fi. It identifies the restaurant and menu, with no table or tab attached.
The watcher’s 20:45 instruction treats this as a go-live item, independently of later ordering.

The page is a simple list with section jump links. Show customer-facing names, descriptions,
published prices and size/unit labels. Sizes, options and separately priced extras can be read
without selecting anything; their declarations stay with their own rows. Keep the published
section order. Start with one menu link; separate lunch and drinks links can follow. A basket,
ordering, payments, waiter calls, bill access and allergen/diet filters are outside this scope.
This first page reads published content; it does not add live stock display.

You set the venue display name, logo, background/text/accent colours with readable contrast; a curated typeface pair is optional. Guest styling is independent of dashboard appearance. Recommend leaving
dish photographs out initially so a useful menu does not depend on a photo layout editor.

Offer the venue’s enabled content languages, initially matching the browser where possible and
otherwise using the venue default. Keep the guest’s explicit choice. Reuse `resolveMenuText`
for missing dish text, including its staff-name fallback when no customer translation exists.
That fallback name is public; staff-only metadata remains excluded. Do not invent translations. Translate controls, keys and explanations too.
The earlier proposal’s shared guest wording and CA/GL drafts are design inputs, not an existing
language bundle. For missing standard wording, propose a whole bundle fallback to the venue
default, then English, visibly naming the fallback language.

Put declared allergen and dietary icons beside names, with specific cereal/nut kinds written
beside the affected dish, size or extra. Labelled buttons open explanations on tap, Enter or
Space; focus alone opens nothing. Keep unreviewed and reviewed-empty data distinct, and never
turn either into an “allergen-free” claim. Include a written key and a short request to tell staff
about allergies. Recommend the earlier proposal’s most-specific dietary marks, subject to the
owner’s choice. These are presentation proposals, not a legal compliance assessment.

## Guest access is part of day one

Both routes need a permanent public HTTPS menu link, agreed with Cloud before you print QR
cards. A phone must not need the staff hostname, local certificates or restaurant Wi-Fi.

| Delivery option | Freshness and outages | Exposure, failover and work |
| --- | --- | --- |
| Cloud forwards each guest read to the box | Reads the selected published menu from the box. Stops when that box or the venue connection is unavailable. | Reuses the tunnel infrastructure, but anonymous reads reach the sales box. Needs a restricted guest route, assets and a choice of serving box after a takeover. |
| **Cloud serves a published copy**, recommended for this read-only page | Updated when the restaurant publishes. Remains readable while the box is offline; an undelivered new publication leaves the previous delivered version showing. No live stock promise. | Guest traffic and assets stay off the sales box. Needs publication/asset delivery and hosting in Cloud, including showing the manager whether their new publication reached the public page. Guest URL stays put when a box changes. |

**Recommend the hosted published copy, for the owner’s choice.** A read-only menu does not need
a live sales connection, and this avoids making restaurant connectivity a requirement for every
view. The box remains the source of menu content. Delivering a publication must not make a sale
wait on Cloud. The old copy is a deliberately published menu, not live stock; the public page
should show its publication date, and the manager must be able to see if an update has not arrived.
No delivery protocol, retry machinery or hosting design is approved here. If that integration is
too large for go-live, forwarding the box read is the smaller infrastructure-reuse alternative,
with its outage and exposure costs explicitly accepted. Both still need joint qualification.

The [A951 status](../../backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)
records the original tunnel as dropped in favour of A951-S, using the Cloud gateway and outbound
WireGuard. Its “customer pages stay later” status predates this read-only go-live request; ordering
still stays later. A951-S staff access does not deliver either proposed guest route.

### What is still needed

- **Box:** the guest-content projection; read-only page and standard wording; selected-menu and
  guest-styling settings with their screen; public publication/asset delivery for the recommended
  route, and visible delivery status. A QR image for the agreed link also needs producing.
- **Cloud, in the separate `waitron-cloud` repository:** permanent public guest address, HTTPS,
  venue routing, hosted menu/assets and update handling for the recommended route. Its readiness
  has not been established by this study; this lane has not inspected or qualified that service.
- **Owner and Cloud choices:** agree the delivery route and stable address before printing QR
  cards. Confirm that a published copy, with explicit update status and no live stock, meets day one.

Restaurant Wi-Fi alone would not meet the mobile-data result. Manual static export to your public
website is another fallback requiring owner choice and a separate upload after every change;
it is not automatic publication delivery and is not added to the proposed scope.

## Evidence and future acceptance checks

**Source inspection only**, at checkout head `4558ba7fe72cd1e4d61dca24fd0388f020324f41`
(code base `9e6c7fbe7899d1c8dec2a25a6605245e80abd750`).
No product runtime or guest-access verification was performed. Local mock-up checks are separate.

| Reusable piece | Receipt and boundary |
| --- | --- |
| Published menu read | `packages/catalogue/src/menu-publication.ts:720`, `readLiveMenu`. The current live HTTP read, `apps/server/src/catalogue-api.ts:1111`, calls `requireManagementSession`. Keep that route protected. |
| Text and prices | `packages/shared/src/menu-document/customer-menu-presentation.ts:31` and `:60` define `resolveMenuText` and `menuPriceRange`; neither supplies a guest page. |
| Content and marks | `packages/shared/src/menu-document/menu-document-types.ts:35` and `:94`, plus `menu-types.ts:22`, `:55` and `:154`, carry dish, variant and extra content. `packages/ui/src/nutrition-icons.ts` supplies symbols, not guest explanations. |
| Images | `packages/media/src/routes.ts:244` onwards defines presentation, rendition and byte reads. Restricting guests to selected assets still needs building; do not forward the whole media surface by assumption. |
| Remote entrance | `apps/server/src/cloud-remote.ts:109`, `createStaffApp`, uses the staff allowlist at `:133`. It does not define a guest-menu path. Cloud readiness was not established by this box-source inspection. |

**Future build acceptance, not checks run for this study:** open a real venue link on a phone
using mobile data, with no staff session or local certificate installed. Reload after a publication
change and confirm guest names, prices, sizes/extras and declarations. Exercise missing text,
explicit language choice, keyboard explanations and narrow-screen reading. Check that unpublished
content, staff-only metadata, unrelated assets and write actions are unavailable through the guest
entrance. For hosted delivery, publish while disconnected: the old delivered page stays readable,
the manager sees the pending update, and reconnecting delivers it. Qualify the alternative route’s
unavailable page instead if forwarding is chosen.

**Open decisions:** hosted publication or box forwarding for day one? Recommend hosted publication,
subject to Cloud sizing and readiness. Settle the dietary-mark presentation. If neither route can
deliver in time, choose explicitly whether to commission manual static export.

**Local study checks:** EN/ES/CA read-only mock-ups are in Lane D’s uncommitted
`receipts/a670-studies-2026-11-13/`. Chromium checks cover 25 demo dishes, no ordering controls,
no page-wide horizontal overflow and keyboard-opened/closed allergen explanations at 390/1280
in light/dark; the paper studies share the 28-case run. These checks establish no public URL,
hosted-publication delivery or Cloud readiness.
