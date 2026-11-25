# Customer menu public access

Draft for Lane K, Lane G and the watcher. The finish line is that a customer can open, share or
embed a venue’s published menu at its public HTTPS address. The address also follows the serving
box through a takeover. Cloud checks the venue’s Connected or Hosted entitlement, including an
active trial. The root lists online menus or opens the only one. An off, deleted or unpublished
menu returns 404. A temporarily unreachable box gives a plain “Try again shortly” page. The
manager’s Online tab explains when the link and QR code are unavailable. [Customer menu design](2026-11-24-customer-menu-design.md#2-online)

**From Cloud to the box.** Cloud terminates public TLS. Use the existing gateway route authority
for the venue’s current confirmed primary, and a dedicated Waitron listener over verified HTTPS
through the scoped tunnel or private hosted path. Today the gate forwards availability to staff
HTTPS, and the box’s tunnel forwards port 443 to `staff.sock`. Give the customer listener its own
forwarding destination. Only a serving primary answers it. On takeover, Cloud withdraws the old
target, then serves the new confirmed primary under the same public host. The box checks its
serving state independently. [Public gate](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/public-gate.ts#L72-L110), [gateway wiring](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/packages/remote-access/src/gateway-cli.ts#L89-L95), [box tunnel](../../../deploy/tunnel/peer.sh)

**What a customer can read.** Pin the exact paths and query rules against piece 3 before building.
Both sides allow GET and specified HEAD requests for published pages, their data, referenced media
and required app files. The signed-in dashboard serves preview and its assets, including over
remote staff access. The box keeps a prepared view per language and updates it when publication,
address, availability, languages or style changes. The public photo read checks that an online
publication references the photo and reads it without taking the venue write lock. [Serving design](2026-11-24-customer-menu-design.md#6-serving-it-and-protecting-the-till)

**Freshness and load.** Cloud follows the box’s cache headers. Budget about one minute total
freshness for page and menu data across caches, including after an address change or switch-off.
Scope cached replies by venue host and the request’s language and content keys. Keep content-named
assets cacheable for a year, with published asset admission enforced at the box. Once the gateway
learns of a route or entitlement withdrawal, stop using that route’s cached responses. Cloud limits
visitors and bounds upstream work, time and bytes, with room for photos. The box caps overall
requests and concurrent work. Normal opens, embeds and link previews work without a browser
challenge. Measure customer traffic separately and exclude it from trial-extension usage. Lane G
and the watcher settle limits and any challenge under attack. [Cloud design](2026-11-24-customer-menu-design.md#7-cloud-in-waitron-cloud-its-own-plan)

**Retire the hosted copy.** Waitron #4266 removed the sender. Lane G retires Cloud’s signed copy
writes and reader, removes stored publications and retires the portal’s hosted-copy controls.
Check that old links and late sends cannot bring old content back. Managers turn each live menu
off in Waitron. Lane G and the watcher will settle whether the portal needs to block the venue’s
live public menu independently and which existing route control can do it. [Removal](https://github.com/clintongormley/waitron/pull/4266), [Cloud’s hosted-copy backlog](https://github.com/waitron-io/waitron-cloud/blob/a11928c75b101bbca7b7b7eaa4b7da06c75388a1/docs/backlog/guest-menu.md)

**Prove it together.** Waitron tests listener isolation, private media, signed-in preview and
serving-state transitions. Cloud tests entitlement, routing, caching, embed and HEAD, limits,
accounting and retirement. Qualify both over HTTPS with warm caches through publish, switch-off,
republish, takeover and lost connectivity. Compare sale times on a busy till with and without a
public request flood. Production enablement follows the existing remote-access gates. [Delivery](2026-11-24-customer-menu-design.md#delivery)
