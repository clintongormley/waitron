# A1639 customer menu sharing implementation plan

From Menus, open the live address. From Customer menu → Online, copy that address. If sharing is unavailable, see why and what to do next. Confirm before changing or switching off an address already in use.
[Customer-menu design §§1–2 and Delivery 6](../specs/2026-11-24-customer-menu-design.md) ·
[Joint access proposal](../specs/2026-11-25-customer-menu-public-access.md)

1. In `apps/server/src/cloud-api.ts` and a new `cloud-customer-menu.ts`, expose a passive, `no-store`
   `GET /management-api/cloud/customer-menu` read. Extend the route's permission helper to accept
   `menu.manage` for this read. Reuse the serving role, test environment, saved remote-access switch,
   `remoteAccessPlanRequired`, active installation and ready `remote_access` service. Return a
   reason for disconnected, switch off, plan required, waiting or unavailable on this box. Return
   the HTTPS origin only for a ready box with a `publicHostname` from that service's authenticated
   configuration, checked by `validStaffHostname` in `cloud-tunnel.ts`. The link can still appear
   if Cloud blocks a venue or its public gate is disabled. The gateway decides whether each public
   request can pass. `cloud-client.test.ts` checks ready, withheld and invalid host cases.
   `cloud-api.test.ts` checks the exact response, menu permission and unavailable-box response.
2. Add the saved enabled address for regular menus to `listDashboardMenus` in
   `packages/menu/src/set-menus.ts` with one batched read. In `apps/dashboard/src/api/cloud-api.ts`
   and `live-queries.ts`, add the passive status read. In `screens/menus-screen.ts`, add the Online
   column and stack its link under the name on narrow screens. In `widgets/menu-online-save.ts`,
   show the reason and next step. Keep “Customers cannot open this page yet” for installations
   without sharing. A failed read says the status could not be checked and offers a retry. Show the
   public host before the address field when ready. Both surfaces use the same
   dashboard function to build `https://<Cloud-public-host>/<saved-address>` for published, enabled
   menus. Test the function once and check the display on each surface. A failed status read
   withholds links and leaves local settings editable. `menu-api.test.ts` checks the list fields.
   `menus-screen.test.ts` checks the visible link’s external address and target and that off,
   unpublished and set menus show no link.
3. In `menu-online-save.ts`, add confirmation on Save when the saved menu was Online and the draft
   turns it off or changes its address. Stop returns to the draft without writing. Use the warning
   “Existing links and printed QR codes will stop working.” / “Los enlaces y los códigos QR impresos
   dejarán de funcionar.” Use the existing `wt-modal` and clipboard pattern. Keep sharing tied to the saved URL, including
   after a refused Save. Withhold the Copy action if the link becomes unavailable. Add one line to the existing `cloud.remote_help` text explaining
   that public menus go offline. Update `i18n/strings.ts` and the EN/ES Products and Servers guides.
4. Start with failing focused tests and check them after each fix. Make the Cloud status fixtures
   explicit in `menus-screen.customer-preview.test.ts` and `menus-screen.customer-online.unsaved.test.ts`.
   Cover rename/off, Stop, a refused write, a reason with its next step and a failed status read with
   retry in the latter. Check Copy with the same fixture and make sure sharing goes away when unavailable. Extend
   `cloud-services-screen.tunnel.test.ts` for the remote-access warning on the local page. Run the touched
   suites and guide checks. Compare the bilingual light/dark captures at 1440, 1280 and 390 px with
   mock 19's Online card. Give Lane P and the owner captures of the Online card and confirmation.

Estimate 240–320 product and 145–205 test lines in one PR. Build against the agreed A1637 address.
Before landing, qualify the candidate's copied link with the A1637 listener
and D643's enabled test gateway. Give G the canonical URL for pairing without waiting for this PR.
Update the customer-menu backlog for the controls delivered. Dish links, Print, uploaded fonts,
hosted-copy retirement and production follow separately.

Claude reviewed the plan. The watcher cleared it with these changes on 28 November 2026 at 05:15.

On 28 November at 13:08 the watcher recorded the owner’s “approve the design” for the revised
sharing card. PR 1 keeps Style and Photos together, shows the QR code beside Copy link, Download
and Print, and opens Embed code inside the card. The link, QR code and embed snippet use the
saved address while a draft is open. The visual review and live gateway qualification still apply.

At 15:02 the watcher moved live gateway qualification to D643's Test Cloud rehearsal. The owner
approved the dashboard pictures at 15:01. Landing awaits green CI on the current head.
