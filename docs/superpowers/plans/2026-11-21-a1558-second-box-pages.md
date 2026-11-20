# A1558 Adding, recovering and switching to a second box: plan

> Lane B, 21 November 2026. Written from the owner's notes during the two-box rehearsal of 20 November; lane B's queue, A1558, quotes them word for word. A fresh Claude read this plan on 21 November, and this revision answers its findings. The watcher cleared it on 21 November at 00:11 (lane B's `questions.md`). Code facts were read on main at 260e14bbb4, not run, unless a line says otherwise.

**What a person can do when this is done.** A manager adding a spare box, or recovering a failed one, is taken to the right box, is not asked to install a certificate the box is about to replace, and sees short ticked steps with links instead of paragraphs. During an emergency switch, the spare's pages say what is happening and what to press, and they show the venue's own time zone. Afterwards the till says nothing about boxes while all is well, and the Servers page lists the main box first, with clickable addresses and a true label for a replaced box.

**Pull requests.** There are eight. Each one is usable on its own; one part of PR 6 waits for lane L's work, as its **Depends on** line says. Every PR updates the matching guide in English and Spanish (`apps/server/src/guide/{en,es}/servers.md`, plus `till-notices.md` for PR 5). Every screen a PR changes is looked at in English and Spanish, in light and dark, at phone width.

**Size, estimated.** About 50 to 70 files and 2,000 to 3,000 lines in total, counting tests, both languages' strings and the guides. Each PR's production code is under about 150 lines, except PR 7 at roughly 200. Nothing is generated: no table and no migration.

## PR 1: the switch shows the venue's time zone (fiscal-adjacent: the owner lands it)

- **The defect.** `apps/setup/src/screens/handover-screen.ts:392` passes the browser's time zone. `packages/fiscal-verifactu/src/setup/recovery-hour.ts:482-483,577,602` shows it under "Check this venue" and formats the clock rows with it. On 20 November the page showed Europe/Rome for a Madrid venue. The zone is never sent to the server (`apps/setup/src/api/client.ts:435-447`), so the venue's saved zone did not change.
- **The fix.** The emergency preview and the controlled handover's status gain a `timeZone` field. It is read from the box's own copy with `readVenue(...).timeZone`, falling back to UTC as `apps/server/src/restricted-page.ts:58-63` does. The screen passes that field, and shows "UTC" as UTC when it falls back.
- **Wording.** `handover.zone` ("Times are shown in your device's time zone", `apps/setup/src/i18n/strings/handover.ts:32,199`) becomes "Times are in the venue's time zone".
- **Test first.** A screen test where the browser's zone differs from the venue's, and a route test for the new field.
- **As built (21 November).** Only the status read (`GET /api/node/handover/:operationId`) carries `timeZone`, through `venueTimeZoneIn`, which `restricted-page.ts` now calls too; the emergency preview and the offer's answer carry none. The note above the clock step reads "Times below are in the venue's time zone"; the emergency page's other dates stay in this device's zone, as before.
- **Fiscal checks.** `packages/fiscal-verifactu` probably does not change. Whatever the PR touches, the golden huella test and `inmutabilidad` pass unedited.

## PR 2: the new invoice series are named and the page waits (fiscal-adjacent: the owner lands it)

- **What happens now.** The list emits its change (`recovery-hour.ts:279`) and the screen moves on at once (`handover-screen.ts:1096-1098`). Each row shows only its code (`recovery-hour.ts:614`). The server already knows each series' purpose (`emergency-preparation.ts:221-224`), and labels already exist: Standard / Full invoice / Correction, and Simplificada / Factura completa / Rectificativa in Spanish (`packages/fiscal-verifactu/src/setup/strings.ts:15-17,69-71`).
- **The change.**
  - Carry `purpose` in the client's `Selected` type (`recovery-hour.ts:72-76,424-426`).
  - Show each series with its label, for example "A-0CSQW — Standard".
  - Add a **Continue** button; the page moves on only when it is pressed.
  - Cut `seriesLine` (`recovery-hour.ts:96,126`) to one sentence: "Waitron will start new invoice series for this box."
- **Restore too.** The restore flow uses the same element, so the Continue button applies there as well, and the restore screens' tests run.

## PR 3: the emergency switch page shows the steps, not the paperwork

The work is in `apps/setup/src/screens/handover-screen.ts` and its strings, `apps/setup/src/i18n/strings/handover.ts`.

- **After a copy is checked.**
  - Fold the sign-in fields (always drawn today, `:986`) and the backup-file drop (`:988`) behind a "Use a different copy" link.
  - Later steps still send the sign-in (`:316-336`). So when a refusal asks for it, the code or sign-in fields open again by themselves. That covers an expired authenticator code (`:491-492`, `handover.emergency.code_expired`).
- **The copy's name.** Drop the 64-character copy fingerprint from the page (`:862`). Name the copy by when it last changed and when the spare joined; the preview already carries both (`lastChangeAtMs`, `joinedAtMs`). The declaration still records the fingerprint.
- **The warnings.**
  - Turn the three warning paragraphs (`handover.emergency.one_way`, `split`, `returned`) into the three tick boxes that already sit below them, one short sentence each.
  - Example: "The old main box is switched off. Its records come back later; orders, stock and drawer openings do not."
- **The leave link.** "Stop" (`:1068`) gets two labels.
  - Before Declare: "Don't switch, go back".
  - After Declare: "Leave this page (the switch is saved)", because leaving never cancels it (`strings/handover.ts:47`).
- **After Declare.** Show the next step and one line saying the switch is saved. The reason the person typed and the time move into a small "Details" fold.

## PR 4: a box that does not run the venue answers with a proper page

- **The spare's page.**
  - `renderSparePage` (`apps/server/src/spare-read-gate.ts:17-39`) is unstyled. Render it through the guides' styled shell (`renderBoxPage`, `apps/server/src/guide-pages.ts:81-97`), with the logo the trust page uses (`trust-page-logo.ts`).
  - New wording: "This is the venue's spare box. It keeps a copy and takes over if the main box fails."
  - Link to the main box at its `contactUrl`, which `GET /api/node/main` already returns (`node-api.ts:73-87`). Link only an `https://` address. While the main box is silent, the switch link stays first.
- **A replaced box.**
  - This is the session's addition, not the owner's request. The owner met a bare "404 Not Found" from the stood-down box on a till address.
  - A box that has handed over starts restricted, and every route except `/` gives a bare 404 (`restricted-start.ts:38-47`). That was a recorded decision of the handover-refusal-words plan: "no new unknown-route case".
  - This PR overrules it for GET `/till`, `/till/*` and the dashboard's pages only. A person who opens those meets a dead end, while the API stays as it is.
  - Those pages serve the restricted page, with a link to the box that runs the venue. The address is taken from the restriction's successor id (`restricted-page.ts:73`), never from the box's own server list, which can still name itself as main (lane L's `6653033aac`).
- **Overlap.** Lane L's A1561 changes `restricted-page.ts` and its wording. Build on main; whoever lands second rebases.

## PR 5: the till says nothing about boxes while all is well

- **What happens now.**
  - `till-lock-screen.ts:494-519` draws the box line, with "Check again", in every venue that has two or more boxes.
  - The line cannot tell a following spare from a replaced box. Both report `acceptingSales:false`, and `standing` stops in the router (`apps/till/src/api/server-router.ts:8-13,193-200`).
- **The change.**
  - Pass `standing` through to `statuses()`.
  - Show the line only while the till cannot reach the main box. The main-box-silent strip is drawn separately and stays.
  - Never show a replaced (`sell-only`) box, and never show "spare unreachable" to staff: that is a manager's concern, and Box status already reports a spare that is behind.
- **Wording.** It follows the refusal rule: say what happens, and never send the person to someone else. `till-notices.md#not-main-server` follows.

## PR 6: the Servers page lists the main box first and tells the truth about a replaced box

The work is in `apps/dashboard/src/screens/servers-screen.ts`.

- **Order.** The main box, then spares, then replaced boxes, then removed ones. Today the rows keep the stored order (`membership-removal.ts:156`).
- **Addresses.** Each box's address becomes a link (`:486-489`).
- **The replaced box's label.** `servers.standing.sell_only` says "Former primary, now only sells", but such a box sells nothing (`boot.ts:2413,2441`). It becomes "Replaced; not selling".
- **What its row says.** The owner asked "isn't it set up as a backup automatically? do i need reinstall it?" The answer is the owner's question below, so for now the row shows only the current fact: "Keep it switched on until its records are back", linking to `servers.md#old-box-returns`.
- **Depends on:** lane L's A1561 landing, for a row-menu action on a replaced box only. A1561 closes the switch so that the box can be removed. The rest of PR 6 does not wait.

## PR 7: a box joining or recovering is offered the right box and no certificate step

- **The plain-HTTP page.**
  - The page the owner saw is `apps/server/src/landing-app.ts:64-73`, whose continue address is fixed when the page is made; `discovery-api.ts:132-147` is the same page served over HTTPS.
  - `watchVenueNameInSetup` (`apps/server/src/mdns.ts:170-210`) already learns whether another box answers `waitron.local`, but only the mDNS responder reads it.
  - Expose four states: another box answers, none answers, not asked yet, and the check failed. Its `names()` treats a failed check like another box answering (`:186-188`).
  - Only when another box answers do the button and the first link use this box's own address (`box-reach.ts:104-112`) instead of `waitron.local`. In that case the page leads with: "Adding a spare? You don't need this box's certificate: open this address and accept your browser's warning once."
- **Setup's first screen.**
  - The connection screen (`apps/setup/src/screens/connection-screen.ts`) always offers **Join or recover**, which opens the role screen and skips the certificate step. New setup keeps the certificate step.
  - "Always" covers recovery: a recovering box's main box is dead, so it hears no other box.
- **Why skipping is safe.** This was established by reading the code, plus the measurement below.
  - Installing the certificate is trust-on-first-use either way, because the file is downloaded over plain HTTP.
  - After joining, the box uses a certificate from the venue's own authority (`adopt.ts:242-248`, `box-tls-install.ts:106-118`).
  - This PR measures, for an archive restore, a bucket restore and a Cloud restore, whether the restored box serves the venue's certificate. A path that does not keeps its certificate step.
  - Until the approval below lands, the person still types the main box's password into a box they reached by accepting a warning. That is the same exposure as today's file-over-HTTP certificate, and the PR says so.
- **Connect to the main box.** Replace "open System, then Servers" with a link to `<main box address>/servers` (`apps/dashboard/src/navigation.ts:6`, `dashboard-app.ts:202`).
- **Measured on the owner's boxes** once the watcher frees them: Chrome and Safari let a person accept the warning for the IP address and finish a join.

## PR 8: the joining page shows progress and a short task list

- **What happens now.** `done-screen.ts:638-642` shows three paragraphs and "This page will not change", and it never polls (`:226-227`). After adopting, the box restarts as a spare, and `/api/node` still answers there (`spare-read-gate.ts:67-74`).
- **The change.** Poll `/api/node` until the box reports itself a following spare, then tick each step:
  - ✓ **Joined the venue.**
  - **Save the server key.** Show it the way fresh setup does, through the composition hook `formatServerKey` (`setup-api.ts:1074-1081`, `packages/composition/src/modules.ts:321`). That format re-encodes the key with check characters, so it is more than spacing. First confirm that every place the key is typed decodes that form (`serverKeyAsTyped`, `restore-request.ts:177`), including the emergency switch. Keep the `.txt` download. A PDF waits for lane D's A1556 slice for spares.
  - **Print the switch label.** Link to the main box's `/servers`, where the button is (`servers-screen.ts:541`).
- **Not alerts.** The owner allowed alerts here, but these steps are done once, on this page, by the person who is joining, so a task list is the simpler choice.

## For the owner first: approve a joining box on the main box instead of typing its password

- **What happens now.**
  - The person types the main box's administrator email, password and code into the joining box.
  - The joining box forwards them to the main box (`mirror-bundle-fetch.ts:697-722` to `mirror-bundle-api.ts:133`) and keeps a hash of the password (`setup-api.ts:1157-1162`).
  - What comes back includes the venue's certificate authority key (`adopt.ts:244`): whoever holds it can pose as any of the venue's boxes.
- **The proposal.** It follows the same-tab round trip the owner chose for Cloud sign-in (watcher log, 20 November, 14:16).
  1. The joining box sends the person's browser to the main box's approval page. The link carries the joining box's id, its public key (the request already sends `standbyPublicKey`, `mirror-bundle-fetch.ts:716-722`) and a short code that the joining box also shows.
  2. On the main box, in the person's existing session (a passkey works), the page shows that code. The person approves only when the code matches.
  3. The main box redirects back with a one-time code.
  4. To exchange it for the bundle, the joining box must prove it holds the private key for that public key.
- **Why this works.**
  - The person's browser already trusts the main box, so nobody can stand in the middle of the approval itself.
  - The key proof means only the box the person approved can collect the bundle.
  - Together these replace the fingerprint comparison the person does today.
- **Cost.** A new route pair on the main box and a change to how a box joins. It takes the full review path, with two Codex angles. Not started until the owner answers.

## Questions for the owner (through the watcher)

1. **The approval round trip above.** Recommended: yes, as PR 9, built after PR 7.
2. **"isn't it set up as a backup automatically? do i need reinstall it?"** Today a replaced box must be reset and joined again. Making it a spare by itself, once its records are back, is a new feature that would follow A1561. Recommended: keep the reset for now, put it as one button in the row menu once A1561 lands, and file the automatic version as its own backlog entry only if the owner wants it.

## Order and who lands

Lane B builds them in the order **1, 3, 2, 4, 5, 6, 7, 8**.

- **The owner lands** 1 and 2.
- **Lane B lands** the rest.
- **The full review path** is for PR 7, which touches certificates and sign-in, and for the approval proposal. The rest take the light path.

`docs/backlog.md` has no A1558 entry. Anything still open when PR 8 lands gets a short entry in the replication area.
