# Customer menu public access

Proposal for Lane K, Lane G and the watcher. Customers can open, share or embed a published menu at
one venue HTTPS address that follows the serving box. Cloud checks Connected or Hosted eligibility,
including trials. The work starts on test installations. Waitron’s tunnel configuration and staff
listener currently exclude production. [Product design](2026-11-24-customer-menu-design.md#delivery), [box configuration](../../../apps/server/src/cloud-tunnel.ts), [listener startup](../../../apps/server/src/boot.ts)

The first delivery works when a phone on mobile data opens a published test menu, then gets a 404
within one minute of the manager switching the menu off.

**Joint design update, 25 November 2026 at 17:20.** In the test delivery, Cloud forwards the box’s
cache headers without keeping a gateway cache. Pages and data stay fresh for at most one minute in
total. Cloud checks the venue block on every request it receives. During takeover, a connection can
briefly be refused while the route is withdrawn. When the route exists and the box is unavailable,
customers still see “Try again shortly”. Remove withdraws the route, and the separate venue block
stays until lifted. Before production, Cloud adds HTTP caching for pages, data and photos to reduce
load on the box. The owner asked for “simple http caching” on 24 November at 18:43.

| Decision | Proposed contract and who settles it |
| --- | --- |
| Serving box | **G + K.** After a spare takes over, the venue owner revokes the old box and connects the promoted box to the same Cloud venue. Remote access moves the venue’s placement to the promoted box’s peer once Cloud records it as the old box’s successor. The signed gateway route picks the box, which refuses customer reads unless it is serving. Before route withdrawal, a cut-off old box that still considers itself serving can show its stale menu through an old signed route for up to ten minutes. [Placement](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/placement.ts#L102-L119), [manifest lifetime](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/manifest.ts#L24-L26) |
| HTTPS and tunnel | **K + G.** Reach the customer socket on fixed port 8443 of the box’s tunnel address. The serving box uses its staff certificate on that socket. Cloud checks it with the staff hostname as TLS server name and upstream Host. Cloud terminates public TLS on the assigned or custom host, which the box reads from the authenticated service configuration for links. Match the requested hostname to the TLS name and signed route. A box without the customer port gives “Try again shortly”. Cap its connections with socat’s `max-children` option. Keep the staff forwarder running if the customer forwarder stops. [Box tunnel](../../../deploy/tunnel/peer.sh) |
| Reads and preview | **K + G.** Pin exact GET and HEAD paths and query rules from piece 3. The box independently checks serving state and admits only the published view’s pages, data, exact photo renditions and listed fonts and app files. Prepare the view per language and refresh it on publication or relevant settings changes. Photo reads stay off the venue write lock and away from the till’s rendition queue. Preview and its assets stay on the signed-in staff listener. |
| Online status | **K + G.** Make the existing tunnel switch’s effect visible on the Online tab and warn before turning it off. Use the service view to distinguish ineligible, disconnected and ready for customers. The manager gets the reason and a next step when the tab withholds the link and QR code. |
| Cache, framing and block | **G + K.** Read the current entitlement and venue block from the Cloud service that checks them for the hosted reader. Both the existing test `guest-menu` switch and the venue owner’s portal action use that block. A blocked venue returns 404. If the authority read fails, serve “Try again shortly”. An off or missing menu returns 404. Use one-year content-named assets and verify that a fresh page’s assets remain available across upgrade and takeover. A visitor’s cache can still hold previously public assets after removal. Allow framing on menu pages at both ends. Before serving a production cache hit, check the current entitlement, venue block and signed route. Key cached replies by venue, signed route and request URL. Forward cache age and store only successful replies. [Venue block](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/guest-menu.ts#L17-L64), [test switch](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/docs/test-cloud-service-controls.md) |
| Limits and privacy | **G + K.** Reuse the gate’s bounded forwarding, refusal handling and counters. Its current availability policy requires a browser cookie and has limits of 120 requests per source bucket per minute, 64 concurrent forwards, five seconds of upstream socket inactivity and 64 KiB per upstream response. Agree menu-specific bounds that carry photos and keep ordinary opens, embeds and link previews cookie-free. Keep short-lived source counters in memory and IP addresses out of logs. Count customer traffic separately from staff traffic and trial-extension usage. Use rate refusals under load. K caps total box work. [Current gate](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/public-gate.ts#L48-L129) |
| Hosted retirement | **G, then K.** Waitron stopped sending in #4266. After the live gate honours the venue block and Connected or Hosted eligibility, including trials, G removes `/m/<venue>`, stored pages and the copy-specific portal and plan controls. Keep the block and owner check. G updates `guest-menu.md` to record the owner’s 24 November choice of serving from the box with “simple http caching”, which replaces the saved offline copy. Both lanes then remove the three signed copy actions. Managers switch off individual live menus in Waitron. [Owner’s product design](2026-11-24-customer-menu-design.md), [portal owner check](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/account-http/src/guest-menu.ts#L12-L28) |

## Delivery

Each part aims to reach a pull request in under three hours. Its own plan chooses the exact limits.

| Part | Files or existing entry points | Estimated code and test lines |
| --- | --- | --- |
| K listener and reads | `apps/server/src/boot.ts` and the customer read routes using the published view from piece 3 | 130 code, 100 tests |
| K second tunnel port | `deploy/tunnel/peer.sh`, `apps/server/src/cloud-tunnel.ts`, `scripts/tunnel-container.test.mjs` | 60 code, 75 tests |
| G gate and limits | Cloud `packages/remote-access/src/public-gate.ts` and venue authority read in `guest-menu.ts` | 170 code, 140 tests |
| K Online status | `apps/server/src/cloud-api.ts` and the menu editor’s Online tab from piece 3 | 80 code, 85 tests |
| G retirement | Cloud `packages/remote-access/src/guest-menu.ts`, `packages/account-http/src/guest-menu.ts` and `docs/backlog/guest-menu.md`. Remove the signed actions here and in Waitron’s `packages/contract/src/signing/installation-proof.ts` once neither side needs them. | 80 code, 70 tests |

The box tests the allowlist, serving state and photo admission. The test gate checks routing, limits,
forwarded cache headers and the venue block. The paired test over real HTTPS covers publish, disable,
takeover, the venue block and an outage. Flood the customer path while timing sales and loading till
images. Before production, check that a venue block or a withdrawn route also stops replies from a
warm gateway cache, including cached photos. Production enablement follows the existing remote-access
gates.

[Gateway authority lifetime](../../developers/cloud-connection.md#local-remote-access-integration) · [Retired sender](https://github.com/clintongormley/waitron/pull/4266) · [Cloud hosted-copy backlog](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/docs/backlog/guest-menu.md)
