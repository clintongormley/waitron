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
The owner has made this a go-live requirement independently of later ordering.

The page is a simple list with section jump links. Show customer-facing names, descriptions,
published prices and size/unit labels. Sizes, options and separately priced extras can be read
without selecting anything; their declarations stay with their own rows. Keep the published
section order. Start with one menu link; separate lunch and drinks links can follow. A basket,
ordering, payments, waiter calls, bill access and allergen/diet filters are outside this scope.
This first page reads published content; it does not add live stock display.

You set the venue display name, logo, background/text/accent colours and a curated typeface pair,
with readable contrast. Guest styling is independent of dashboard appearance. Recommend leaving
dish photographs out initially so a useful menu does not depend on a photo layout editor.

Offer the venue’s enabled content languages, initially matching the browser where possible and
otherwise using the venue default. Keep the guest’s explicit choice. Reuse `resolveMenuText`
for missing dish text; do not invent translations. Translate controls, keys and explanations too.
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

**Recommend a Cloud public guest address serving the selected menu from the box.** Cloud would
provide publicly trusted HTTPS; the box would answer a limited public menu read. Expose only
guest content and its chosen assets, not the management catalogue response. When the box or
connection is unavailable, propose an unavailable page asking guests to use the restaurant’s
paper menu or staff. Do not present a stored old copy as current. Hosted snapshots and offline
browsing are outside this recommendation.

The guest entrance is still work to agree and qualify with Cloud: public host/certificate,
correct venue routing, forwarding the limited read and assets, and the disconnected-box response.
No hostname or delivery date is established here. The current staff entrance is not evidence that
an ordinary guest can already reach a menu.

The [A951 status](../../backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)
records the original tunnel as dropped in favour of A951-S, using the Cloud gateway and outbound
WireGuard; it also leaves customer pages for later. This study proposes bringing the read-only
page forward, not reviving A951 or bringing ordering forward.

Restaurant Wi-Fi alone would not satisfy the mobile-data result above. If Cloud cannot meet
go-live, static export to your public website is an **optional fallback requiring owner choice**,
not additional work included here. It would need a separate export/upload workflow and another
upload after every content change.

## Evidence and future acceptance checks

**Source inspection only**, at checkout head `4558ba7fe72cd1e4d61dca24fd0388f020324f41`
(code base `9e6c7fbe7899d1c8dec2a25a6605245e80abd750`).
No runtime or guest-access verification was performed.

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
content, staff fields, unrelated assets and write actions are unavailable through the guest
entrance. Disconnect the box and inspect the unavailable page.

**Open decisions:** choose the Cloud guest entrance for this go-live page and settle the
dietary-mark presentation. If Cloud cannot deliver in time, choose
explicitly whether to commission static export instead.
