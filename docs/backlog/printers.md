# Printers, the print agent and receipts — detail

The open entries are listed in [the backlog](../backlog.md), under "Printers, the print agent and receipts". This file holds
their full text.

## A1175: an Android app for venues run from Waitron Cloud

Owner, 2026-10-28: "We also need to start thinking about building an android app to provide a
local print server when Waitron is running in cloud. And to think about what else the android app
would provide." The owner moved it up with the Cloud-reached features (online booking, the
table's QR code, online ordering) and asked to brainstorm it later.

Why it is needed: the print agent is the one piece that must stay on the venue's premises when
the primary is in the cloud (cloud-compatibility rule 5 in [the backlog](../backlog.md)). A venue
with no box needs something else on its premises to run it.

Owner, 2026-10-29: the app is the device agent — "it is the android app really, which runs
locally and hosts the print agent (et al)". It is the Waitron-owned outbound agent the hosted
design asks for (printers, cash drawers and card readers stay local), so it is what lets a venue
started in the cloud after its box dies (A1188) print, open the drawer and take card payments.

**Brainstorm started 2026-10-29; paused until the owner is back on 3 November**, when the device
test below runs.

The owner's answers (2026-10-29):

- The app is needed for the print agent, "but not for card readers (over the internet) not for
  cash drawers (connected to printers)". "The server speaks to the card reader over the internet.
  This means that if we use an on prem server and the internet goes down then we can't talk to the
  card readers and instead have to use standalone card readers or payment apps installed on the
  mobile phone." The [A1188 design](../superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md)
  was corrected the same day to match.
- When a cloud-run venue's internet fails: "We should keep selling using mobile internet to talk to
  the cloud server." No local server holds sales while the line is down.
- The owner's concern with that: "If the mobile is using mobile internet, then it isn't connected to
  the LAN. If it is connected to the LAN then it won't be able to reach the internet."
- Who owns the devices, and what that means for an outage: "the devices are likely to belong to the
  venue, not the waiter, and they're likely to not have a SIM card. Either the handheld device or
  the router needs a SIM device to keep functioning. The router would be the simpler solution."

What follows from that answer: a device with no SIM has no mobile internet of its own, so during an
outage every device, handhelds included, reaches Cloud only through the venue's Wi-Fi. The way a
cloud-run venue keeps selling is therefore a router with a mobile-data backup (its own SIM): every
device stays on Wi-Fi, the router switches to mobile data when the line fails, and the owner's
concern above does not arise, because the Wi-Fi still reaches the internet. It needs no app work;
its cost is equipment the venue buys and sets up.

Proposed in the brainstorm, not agreed:

- The print agent needs only the venue's Wi-Fi: it reaches the printers and, through the backup
  router, Cloud. Handhelds never talk to printers directly; every print goes through the server to
  the print agent (cloud-compatibility rule 5).
- Holding Wi-Fi and mobile data at once on one device now matters only to a venue with no backup
  router whose print-agent tablet has its own SIM, and even then its SIM-less handhelds stop
  selling. As read from Android's documentation and developer write-ups, NOT run: an installed app
  can ask for the Wi-Fi network without requiring internet from it, ask for mobile data as well,
  and tie each connection to one of them (`ConnectivityManager.requestNetwork`,
  `Network.bindSocket`/`openConnection`). A web page has no such choice. The test below would
  settle it.
- The print agent runs on a device that stays in the venue (the counter tablet), never a waiter's
  phone, which leaves at the end of a shift.
- The same app shows Waitron's screens. On fixed tablets it locks the tablet to Waitron (kiosk
  mode), perhaps replacing the planned Fully Kiosk resale. Android's lock that staff cannot escape
  needs the tablet set up from a factory reset; screen pinning needs none but can be undone.
- On phones it runs the handheld, adding what a browser cannot: taking cards on the phone itself
  (Tap to Pay, offered by Stripe and SumUp to native apps only, as understood, not checked) and
  alerts while the phone is in a pocket.
- A venue with a box already has its print agent there; for it the app is optional.

Owner, 2026-10-29, on the questions the router answer raised:

- The device test: "it would be interesting to try regardless". It stays queued.
- Whether Waitron recommends or resells a backup router: "Quite possibly".
- Whether staff are told when the venue is on the router's mobile data: "How would we know?" Ways
  proposed, not agreed and none tried: read the router's own status, which works only for routers
  Waitron knows (so it pairs with recommending one); or notice that the venue's public address, as
  Cloud sees it, has changed to one belonging to a mobile network, a hint rather than proof, since
  an operator may serve fibre and mobile from the same address blocks. Owner, 2026-10-29, after
  hearing both: "It'd be a nice to have." Proposed with it, not agreed: the notice may matter more
  to a manager (turn off guest Wi-Fi, streaming) than to staff, since Waitron's own data use is
  thought small but not measured.

Still to ask: whether kiosk mode
replaces the Fully Kiosk resale; whether a second device takes over
printing automatically when the print-agent tablet is off; which printer connections it must reach
(network, USB, Bluetooth); and how it compares with printers that fetch jobs from the cloud
themselves ([Star CloudPRNT](../superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md),
[Epson Server Direct Print](../superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md)).

**The device test, queued for 3 November (owner, 2026-10-29: "Perhaps queue it instead").** A
throwaway Android app, then a run at the owner's home:

- An Android tablet or phone with a SIM and mobile data, on a Wi-Fi in `192.168.10.x` whose internet
  is cut (block the device's internet in UniFi, or unplug the gateway's fibre).
- The app shows whether Android believes that Wi-Fi has internet. If it says yes, the run proves
  nothing and the cut has to be fixed first.
- It prints to the Epson TM-T88III at `192.168.10.81:9100` over Wi-Fi a ticket carrying the public
  address it fetched over mobile data at the same moment. That ticket is the proof.
- Controls: the same fetch tied to the Wi-Fi must fail, and a printer connection tied to no network
  may fail (the owner's concern, shown).
- It keeps both connections for some minutes, since Android may drop a Wi-Fi that has no internet.

Nothing is built or installed for it yet. Installing Java 21 (`openjdk@21`) and Google's
command-line Android tools (`android-commandlinetools`) through Homebrew on 2026-10-29 hung for
about 30 minutes, every Homebrew process idle at its sandboxed unpacking step, and was stopped;
the cause was not found.

## What the AppArmor profile (A129, #862; A134, #887) left open

- **`trust` is still refused.** A property write (`trust`) and `Disconnect` were measured still
  refused against the stand-in BlueZ; BlueZ's `Agent1.Release` is not allowed either; the stand-in
  never sends it, and whether a real BlueZ does is still open.
- **Box check owed:** after `sudo bash waitron.sh install`, switch off the kernel's rate limit on
  its log first (`sudo sysctl -w kernel.printk_ratelimit=0`), which can drop refusal lines —
  image-smoke switches it off for that reason. Then `scan on` / `scan off` and a pairing from
  `docker compose exec -it print-agent bluetoothctl`, then
  `sudo journalctl -k --since '-5 min' | grep 'apparmor="DENIED"'` should print nothing for
  `waitron-print-agent`.
- **A bus policy that refused BlueZ's own calls would read as `no_controller`**: measured
  2026-09-29 on a CI runner against the stand-in BlueZ, with a profile that allowed the bus
  daemon's own messages but no message to BlueZ: `bluetoothctl --timeout 3 devices Paired` printed
  "No default controller available" and exited 0.

## Measure one-job print pulls on the box

A517 uses one job per pull to eliminate unsent leased tails. Every job now repeats the agent's
inventory cycle. Measure a burst on the box before choosing inventory caching or another
lease design; the controlled Hono/transport probe is not a hardware throughput measurement.

A1372 checks the claim against delivered history using the existing printer/status index.
Its local synthetic database measurement excludes authentication, discovery and physical output.
Measure those costs on the box, and measure large retained queues separately. The status ranges
still include failed jobs with no attempts left and drawer claims awaiting a result, as well as
live document leases. The review measured higher claim cost with both queued work and exhausted
failures present; it did not isolate which part of the statement caused that increase.

## Waitron carries two QR encoders; consolidate on `qrcode-generator`

When consolidating, check the receipt's `qrRaster` path separately from `EscBuilder.qr`, and
retain the error-correction choice documented in `apps/server/src/qr-matrix.ts`. These are the
two QR audit pointers carried forward from the old aged-batch detail; A517 changes neither.

**Waitron carries two QR encoders; consolidate on `qrcode-generator` — Small.** `apps/server` imports
`qrcode` (in `qr-matrix.ts`, `print-job-preview.ts`, `discovery-api.ts`) while `apps/till` uses
`qrcode-generator` (`qr.ts`). The server's three call sites use only `.create()` (the module matrix)
and `.toString({ type: "svg" })` — no PNG — so `qrcode`'s `pngjs` is never exercised and its `yargs`
(pulled only because `qrcode` ships a CLI bin) is dead weight. `qrcode-generator` is isomorphic,
**zero-dependency**, and covers both the matrix (`getModuleCount()`/`isDark()`) and the SVG case.
Switch the three server sites over and drop `qrcode`; hoist the receipt's hand-ported
money/date/label formatters into `packages/shared` too (the paper receipt already drifts from the
screen by an NBSP normalisation). **The gate before landing:** `print-job-preview.ts` reconstructs a
QR from stored raw `latin1` bytes through `qrcode`'s byte-mode segment API; `qrcode-generator` has a
`'Byte'` mode, but this path must produce a byte-identical, still-scannable QR — these are fiscal
receipt QRs AEAT's own app must verify — so it needs a render→decode check and a real scan, not
just a green typecheck.

## Photographs and timings of pictures on paper

The owner's photographs of a receipt, a kitchen
ticket, the ruler page, a sample receipt and the test page on both printers are owed, and
so are the box's timings (what to time: `docs/developers/testing-guide.md`, "How long a job of
pictures takes to print on the box is not measured"). Anything the timings or photographs show
wrong becomes a new item.

## Repeat the 58mm receipt in the wider Epson after the print-area fix

The owner's wider printer clipped
the right edge of a 58mm receipt whose payload centred without an explicit print area; whether the
printer's own width setting also contributed was not tested. The corrected output on a 58 mm roll
in that printer has not yet been printed; the 58 mm Bluetooth printer's test page printed whole on
2026-11-20. Since C107 the print area is the image's width — 360 or 384 dots on 58 mm paper,
512 or 576 on 80 mm.

## The HP has not been added by typing its address

The owner's home is
the case that motivated it: the box sits on 192.168.10.x and the HP LaserJet on 192.168.20.x,
which the port-9100 sweep cannot reach. On 2026-11-20 the Epson at `192.168.10.81` was added this
way and printed. Still to try: type the HP's `192.168.20.56:9100`, which should come back as an
office printer.

## The setup-page link is unproven on the box

The print agent builds it from
`WAITRON_PRINT_AGENT_SETUP_URL` (passed through by `deploy/compose.yml`), or from the first of `WAITRON_BOX_ADDRESSES` (`apps/print-agent/src/config.ts`);
no review seat ran the deployed compose and nobody has yet followed the link from a dashboard on
the real box.

## Bluetooth at the box

Check that **Delete**, which unpairs since #3913, clears the real printer's pairing under the
shipped AppArmor profile with bluetoothd's `autopair` plugin off. The owner paired a real printer
through the dashboard on 20 November; the first attempt was refused by the printer
(`AuthenticationFailed`) and the second worked. `waitron.sh install` switches
`autopair` off with a systemd drop-in where it can (`deploy/README.md` says when it leaves
Bluetooth alone), and the operator then types the PIN, 0000 for a 0000 printer; that drop-in was
tried on a GitHub runner, where the Bluetooth service itself never ran, and has not run on the
owner's box. Also owed: whether a real Bluetooth service sends `Agent1.Release`, which the
profile does not allow and the CI stand-in never sends; what the box's real adapter reports as
paired; time a pairing through the dashboard (whether scanning while pairing slows a real pairing
is not measured — the agent keeps scanning through a pairing because skipping the scan would drop
every unpaired device from the list).

## Printing over RFCOMM from INSIDE the print-agent container (A140)

A real RFCOMM connection
and print from inside the container under the shipped profile — CI's runners cannot load
Bluetooth at all — and whether the printer gets every byte before the connection closes. The
owner printed on channel 1 from the host only. Automatic channel discovery has not run on a real
printer. image-smoke runs the helper directly with its own
arguments, not through `RfcommTransport`, and only as far as creating the socket; and
`scripts/deploy-image-env.test.ts` reads the Dockerfile and `package.json` as text, so it does not
prove the bundle's default helper path resolves inside the image. The helper's 20 + 20 second
connect and send timeouts and the agent's 5-second grace (`apps/print-agent/src/rfcomm.ts`) were
not measured on the box.

## The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the box is not confirmed

It needs the fixed image on the box first: run
`docker compose exec print-agent bluetoothctl --timeout 6 scan on`, then
`docker compose exec print-agent bluetoothctl devices`, and record how many devices are listed
and where the printer falls among them. Choose **Delete** in Waitron and confirm that the box
has unpaired the printer. Restart the print agent (`docker compose restart print-agent`) and wait a minute, so neither
the agent nor the server holds an earlier reading of the printer; open Add a printer repeatedly, record on which scan it is first listed
without Show all devices, and look for `bluetooth info failed` lines in
`docker compose logs print-agent`.

A404 (2026-11-05) found that each plain report from the agent dropped the printer mark an earlier
scan had set, which hid a paired printer between scans; that may also explain this entry (not
checked on the box).

## The virtual PDF printer

- **The virtual PDF printer.** The virtual PDF output remains to be built. Print-payload retention is handled by the daily housekeeping job.

**Print payload measurement (A1308 dv11 M1, 2026-11-18).** Santet contained zero print jobs.
The 366-day synthetic venue held 452,520 jobs with 9,179,818,278 payload bytes before
housekeeping, averaging 20,286 bytes per job. Its 422,874 document jobs held 9,179,670,048
bytes (21,708 bytes each on average) and its 29,646 drawer jobs held 148,230 bytes (5 bytes
each). The [A1544 bench](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-a1544-memory-measurement.md) built this
venue at commit `30c1c1c564` with 250 bills a day and seed 1.

## Reprint kitchen tickets and other printouts laid out again for any printer

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678).** Receipts and full invoices are laid out again from the sale. For other printouts,
  Reprint copies the stored bytes while they remain available: kitchen tickets and refund receipts to an
  active receipt printer at least as wide, centred; everything else to its own printer only.
  Laying them out again needs each job to keep the printer-independent document it was built from,
  with a version number, in a new `print_jobs` column, and each builder (`formatKitchenTicket`,
  `formatCorrectionSlip`, `formatPaymentSlip`, `formatCategorySalesPage`,
  `formatTenderRefundAcknowledgment`) to draw from it; a job whose version the running code cannot
  read falls back to today's rule. Also open: whether kitchen tickets, payment slips and reports
  need an A4 page, or A4 printers stay out for them.

## Find a bill's pay offers no guests field

- **Find a bill's pay offers no guests field (left open by A663 Part 3b).** A bill collected from
  Find a bill (`apps/till/src/widgets/find-bill-dialog.ts`) sends no guests count. A bill with no
  invoice yet is recorded then, and stores the count that would print by default at that moment;
  one already invoiced by an unpaid departure keeps the count stored at the departure
  (`issueUnpaidInvoice`, `apps/server/src/working-order.ts`), because collecting it records no new
  sale (`runCollectOrder`, `apps/server/src/till-sale.ts`). Either way the waiter cannot choose
  another number, or leave the line out, there. The owner's decision
  of 2026-10-16 put the «Comensales» field on the payment screen only; this records the gap
  without deciding whether Find a bill should ask too.

## A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN

A268 discards a waiting device's request when the last Add dialog closes. An agent told
`not_approved` stops and needs resetting on its own setup page (`packages/print-agent/src/agent.ts`,
the `not_approved` branch), so its request outlives a shut window instead. **Next action:** find a
path, for example an agent that asks again on its own after a refusal, so agents follow the
device rule. Spec: [A268 §4](../superpowers/specs/2026-10-04-add-a-device-design.md#4-pairing-on-the-server).

## One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still open

- The paper-width dropdown names widths only, not printers, so two printers of one width at
  different resolutions cannot be told apart (owner's call).

## Share printed logo dots per library photo (A1308 dv16 M3)

- Keep the cached dots when printing. On the Intel Core i5-6400T test box, drawing both paper sizes
  from a synthetic 1,600 × 1,600 library photo took a median of 1,065 ms (95th percentile 1,091 ms).
  Reading one paper's cached dots took a median of 0.65 ms (95th percentile 1.41 ms), over 50 runs
  per path. Move the printed dots to the photo library so themes using the same image share a copy.

## Loose ends left by #367

- Follow-up (ruling C): the preview no longer shows the QR link as text for a raster receipt. A
  possible fix is to carry the link alongside the print job so the preview can still show it as
  text.
- Deferred (ruling H): decide whether to warn when no legal QR dot size exists. Re-check the
  valid-link range with `apps/server/src/qr-link-range.test.ts` before changing the fallback.

## Loose ends left by A663 Part 3b (#1827)

- Leaving the payment screen after changing the count asks nothing, while a typed tip or cash
  amount does ask. The plan chose this; the owner has not said whether leaving should ask.
- `#onConfirmPayment` and `#onPayTab` (`apps/till/src/till-app.ts`) pick one of several call
  shapes only so older tests that pin the exact argument count keep passing; one call per path
  sends the same request.

## Loose ends left by A661 (#1745)

- The print queue's Reprint, on its own printer or another (A405, #2678), does not follow the
  till's rule for a full invoice's printer. A till refuses to resend an original a print request
  sent, when that printer is not the till's invoice printer (`receiptPrinterWithdrawn`,
  `apps/server/src/invoice-delivery-status.ts`). The dashboard's
  `POST /management-api/print-jobs/:id/resend` (`apps/server/src/print-api.ts`) does not apply that
  rule, and since A405 it can send a full invoice's original that never printed (out of delivery
  attempts, or still waiting on a disabled or unseen printer) to any other active receipt printer.
  Decide whether a manager's reprint should.

## A960. On an 80 mm roll in Basque, a full invoice with more than one VAT rate prints a full comp's «Deskontua 100%» with «100%» on its own line under the figures (left open by A758-4).

The receipt table (`apps/server/src/receipt-table.ts`) wraps item text longer than the item
column — 14 characters on that bill, narrowed by the VAT-rate column, less a 2-character indent
for a row under a dish — just as a 100% percentage discount or a long dish name already wraps
there. Decide whether a short label should be kept whole. The wrapped text is pinned in
`apps/server/src/receipt-ticket.test.ts`, in the case "prints F1 reductions before VAT, at their
rate, on '80mm' in 'eu-ES'".

## A961. On a full invoice, a dish's discount row that no single comp names prints «Descuento 100%» whenever every line at its rate was filed at zero (left open by A758-4).

`named` is null
when no one adjustment names the row, for instance a dish with two or more comps of its own
(`GroupDiscount`, `apps/server/src/receipt-figures.ts`), and the row then falls back to the
zero-base flag. A finish-branch probe on 2026-10-21 rendered two €6.00 amounts that took a €12.00
dish to zero as one «Descuento 100%» row, where the ticket prints them as two steps, «Descuento
50%» and «Descuento 100%» (A803 slice 1's decision, [till.md](till.md#decisions-and-deliberate-limits)).
And a dish taken to zero by two comps of its own plus a bill comp prints «Descuento 100%» beside
only its own part (the A758-4 plan's owner point 3). Owner to confirm.

## Bundle: One session at the real box: printers, paper, tax QR, the drawer

Hardware and inbox checks to complete in the owner session.

- **What the 20 November session raised, by lane** (session notes:
  `~/waitron-campaign-shared/real-box-session-20261120.md`, on the owner's Mac):
  - C: drawer button only with a drawer (#3899), invoice email offered only when the bill can be emailed (#3905), Full invoice keeps its details on reopen (#3914, #3921), return to Card readers and no email in search boxes (#3927).
  - D: profile printer switches (#3903), Email in System on every box (#3909), City on address forms (#3923).
  - F: profile default reader at Pay (#3901), receipt card details, slip venue time and receipt copy (#3904), slip button after payment (#3920), default invoice printer (#3911); open: CARD-FIELDS-MISSING, CANCEL-WAITING-CARD-PAYMENT.
  - H: A4 paper-out wording, Print Queue rows and the retired agent's alert (#3908), Delete unpairs a Bluetooth printer (#3913).
  - L: open: FULL-INVOICE-ISSUER-ADDRESS (the issuer's postcode and town on a full invoice; fiscal, owner lands).
  - B: open: PRINTER-TEST-PAGE-REAL-RECEIPT.

- **A739 physical payment and delivery qualification.** On the real till, printer and reader,
  check the post-payment slip button for each method, including a part payment, the slip's venue
  time and the marked receipt copy from Print Queue: all three changed after the 20 November
  session (lane F's #3920 and #3904) and have not been seen on paper. An emailed full
  invoice was handed to the box's mail server and appears in the sender's Sent folder; arrival in a
  separate recipient's inbox has not been seen. The session confirmed the receipt from the till,
  a marked copy from Orders, and a Solo receipt and slip carrying the card and authorisation
  details. One Solo payment recorded no card details (lane F's CARD-FIELDS-MISSING).
- **A773 physical-till trial: dragging.** Try long-press movement of New order lines and held
  headings on a physical till. Keep drag only if it works reliably; Move to… and the held heading's
  Move earlier/later actions remain available. Browser gesture checks do not settle this choice.
  [Spec §11](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)
- **A773 physical-till trial: serving part of a line.** Try marking part of a line served through
  the dish window during service. Decide whether it is practical before changing that workflow.
  [Spec §11](../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)
- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** [Detail](printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)
- **Loose ends left by C107 (#974).**
  [Detail](printers.md#loose-ends-left-by-c107-974)
- **Loose ends left by #367.**
  [Detail](printers.md#loose-ends-left-by-367)
- **Shared office-printer queues need physical qualification after A576.** From the shipped
  print-agent container, discover two queues on one computer, add both and print distinguishable
  pages to each. [Detail](printers.md#shared-office-printer-queues)
- **Office-printer detection is proven on one office printer only.** The owner's HP Color LaserJet
  MFP M181fw's real reply is a test fixture, and the live query marked it from a Mac on the owner's
  network. It has not run from the box's container, and no receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.
- **A552. Invoices on the owner's office printer: a multi-page invoice and power loss.** On
  20 November a one-page full invoice printed on the HP with its QR at 35 mm, and after paper ran
  out it printed by itself once paper was back. Still owed: a multi-page invoice (A553), what
  Waitron reports when the printer loses power mid-job, and the paper-out wording and Print Queue
  rows lane H's #3908 changed, once that build reaches the box.
  [Detail](printers.md#a552-invoices-on-the-owners-office-printer-a-multi-page-invoice-and-power-loss)
- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. Not tried from
  the box's container, where the lookup may fail outright; either way the printer stays addable.
- **Photographs and timings of pictures on paper.**
  [Detail](printers.md#photographs-and-timings-of-pictures-on-paper)
- **Left unchecked since #327:** whether a device knock reaches the box while the Add agent dialog
  is open, the five-line feed before the cut, and the receipt preview against printed paper. On
  20 November discovery (the HP, and the Bluetooth printer seen on the spare box), receipts, slips,
  a marked copy and the drawer pulse were all seen at the box.
- **The TM-T88III's built-in QR command is untried** (spec "Verification on paper"): whether it
  prints anything at all. On 20 November the drawn QR's dark squares measured 40 mm on the Epson's
  80 mm paper, the top of the 30–40 mm band, and it scanned to AEAT's pre-production check page;
  whether that band is meant to count the code's blank border is still undecided.
- **Repeat the 58mm receipt in the wider Epson after the print-area fix.** The 58 mm Bluetooth
  printer's test page printed whole on 20 November; a 58 mm roll in the wider printer, the case that
  clipped, has not been printed since the fix.
  [Detail](printers.md#repeat-the-58mm-receipt-in-the-wider-epson-after-the-print-area-fix)
- **The HP has not been added by typing its address.** On 20 November the Epson was re-added
  through Check a known address at `192.168.10.81` and came back with its saved calibration; the
  HP's `192.168.20.56:9100`, on the network the sweep cannot reach, should come back as an office
  printer.
  [Detail](printers.md#the-hp-has-not-been-added-by-typing-its-address)
- **The setup-page link is unproven on the box.**
  [Detail](printers.md#the-setup-page-link-is-unproven-on-the-box)
- **Bluetooth at the box.** On 20 November the owner unpaired, paired again (the first try was
  refused by the printer, the second worked) and printed a test page. Delete now unpairs too (lane
  H's #3913); that is not yet tried at the box.
  [Detail](printers.md#bluetooth-at-the-box)
- **Printing over RFCOMM from INSIDE the print-agent container (A140).**
  [Detail](printers.md#printing-over-rfcomm-from-inside-the-print-agent-container-a140)
- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first.
  [Detail](printers.md#the-owners-bluetooth-printer-was-listed-only-under-show-all-devices-a137--the-cause-on-the-box-is-not-confirmed)
- **timesyncd's clock file after a backward set has not been watched across a reboot.**
  [Detail](box.md#timesyncds-clock-file-after-a-backward-set-has-not-been-watched-across-a-reboot)
- **The clock watch's suspend-aware clock has not been run across a real suspend on Linux.** It
  reads `/proc/uptime` so that a box waking from sleep is not taken for a clock jumping forward.
  Slice 9b's measurement M3 set the wall clock on a Linux runner and `/proc/uptime` did not move
  with it; nobody has suspended a Linux box and watched it (`docs/developers/conventions-data.md`,
  "A clock jump"). Left open by A798-B slice 9 (#2025).

## Bundle: Receipt layout pass

3 entries, size M.

- **A960. On an 80 mm roll in Basque, a full invoice with more than one VAT rate prints a full
  comp's «Deskontua 100%» with «100%» on its own line under the figures (left open by A758-4).**
  [Detail](printers.md#a960-on-an-80-mm-roll-in-basque-a-full-invoice-with-more-than-one-vat-rate-prints-a-full-comps-deskontua-100-with-100-on-its-own-line-under-the-figures-left-open-by-a758-4)
- **A961. On a full invoice, a dish's discount row that no single comp names prints «Descuento
  100%» whenever every line at its rate was filed at zero (left open by A758-4).**
  [Detail](printers.md#a961-on-a-full-invoice-a-dishs-discount-row-that-no-single-comp-names-prints-descuento-100-whenever-every-line-at-its-rate-was-filed-at-zero-left-open-by-a758-4)
- **A1201. Owner question: a receipt's extra prints no count beside a grouped dish (seen in A803
  slice 1's LOOK).** Two Pollo asado with Padrón peppers print "2 Pollo asado con patatas 19.00"
  then "Pimientos de Padrón 4.00", at 58 and 80 mm. What a line of two printed before slice 1 was not
  checked. Decide whether the extra's row shows its count.

## Bundle: A print agent somewhere other than the box

4 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1203: install a box as a till, with its own print agent (owner, 2026-10-29).** A venue
  that needs a till with a USB or Bluetooth printer or a cash drawer beyond the main box and the
  spare uses a small Linux box; the print agent already runs on Linux and only dials out, and the
  2026-08-26 printing decision puts agents "on local servers and tills". What is missing is a way
  to install a box as a till only (believed not offered by the USB installer, B3; check first). A
  till whose printer is on the network needs no agent of its own: the main box's agent reaches it.
- **A1204: tills on Windows, macOS and iOS (owner, 2026-10-29).** "Later we may need also to use a
  windows or osx or iOS machine as a till." The till runs in a browser, so the till itself is
  expected to work; a printer or drawer attached to such a machine needs a print agent for that
  platform (a packaged agent, or an app as A1175 is for Android). Not started; network printers
  need none.
- **A1175: an Android app that runs the local print server when the venue runs from Waitron
  Cloud**, and possibly more (owner, 2026-10-28). Brainstorm started 2026-10-29; it waits for a
  device test on 3 November: can one Android device reach the printers over the venue's Wi-Fi and
  Cloud over mobile data at once? [Detail](printers.md#a1175-an-android-app-for-venues-run-from-waitron-cloud)
- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  [Detail](printers.md#a-print-agent-cannot-be-discarded-when-the-join-window-shuts-a269-owner-2026-10-04--open)

## Bundle: Guest count

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Find a bill's pay offers no guests field** (left open by A663 Part 3b). Not decided.
  [Detail](printers.md#find-a-bills-pay-offers-no-guests-field)
- **Loose ends left by A663 Part 3b (#1827).**
  [Detail](printers.md#loose-ends-left-by-a663-part-3b-1827)

## Decisions and deliberate limits

- **The print agent's setup page has no TLS certificate, on purpose (owner, 2026-09-27).** It asks
  for no password, its matching number is useful only to the manager typing it into the dashboard,
  and once joined the page answers only its own machine. Revisit only if the page ever asks for a
  password.
- **Bluetooth command limits (watcher, 2026-11-16 03:02).** One pending operation per agent;
  exact retries keep their ID and deadline. Channel discovery caches a successful lookup, including
  an inconclusive answer's channel-1 fallback; a failed send drops it for the next job. The server
  remembers only the last eight expired unpair command IDs across all agents, until accepted or
  evicted. A late result can clear the discovery pairing report while that command is remembered.
  **Delete** ends waiting jobs immediately. If a printer was unpaired outside Waitron, delete
  it to end its waiting jobs.
  [Plan](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-16-bluetooth-pairing-commands.md).

- **Print jobs keep their rows; finished or abandoned jobs release their bytes after one week**
  (owner, 2026-11-14 17:02, “a week is fine”; watcher cleared all printouts at 17:37 and the
  plan at 17:49; [A1532 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1532-print-payload-retention.md)).
  The owner’s 2026-10-14 distinction stays: the print queue is for something just lost or failed;
  Reprint makes a marked copy of a finished thermal original while its queue job still has data.
  Orders rebuilds sale receipts and invoices at any age. Expired queue reprints refuse consistently,
  including another printer. Kitchen tickets, refund receipts, payment slips and reports lose their
  queue reprint. Keeping rows preserves receipt-copy audits, invoice delivery and kitchen/resend links;
  failed documents still waiting for a decision keep their bytes. This replaces the one-month period.

- **Document/printer routing scope (A790).** The owner dropped G4/A947, the recovery-origin
  file, browser journal, prepare/accept and duplicate-print protection on 9 November 2026 at
  20:34. Landed foundations grant no cleanup authority. Keep the Printers tab’s A4-printers
  wording; F2 replacement and A661’s print-queue Resend policy remain separate work. See the
  [closeout and implementation receipts](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-13-a790-payment-invoice-printer.md).

- **Add a printer lists a Bluetooth device its agent reports paired unless the agent says it is
  not a printer; one whose kind it cannot tell is listed (A404, 2026-11-05).** The owner asked that
  a paired printer stay listed and that a paired non-printer, such as headphones on another
  computer's agent, not be. The paired listing (`bluetoothctl devices Paired`) carries only an
  address and a name, so the agent asks `bluetoothctl info` of each paired device it holds no
  reading for and reads it as a scan does (`parseBluetoothctlInfo` in
  `apps/print-agent/src/bluetooth.ts`: printer icon, imaging class with the printer bit, or the
  Serial Port profile). A device whose `info` failed, did not answer within the paired report's
  deadline, or answered with no icon, class or profile to judge by, or whose agent is older than
  this change, is listed: a hidden paired printer is the fault the owner reported, while a listed
  non-printer only adds a row. Show all devices still lists every device.

- **The guest count is `guestCount` (A988, 2026-10-27).** Till requests use `guestCount` and Split a
  table uses `guestCounts.staying` and `guestCounts.leaving`. An issued sale stores its receipt count
  in `sales.receipt_guest_count`. The route `PUT /api/parties/:id/guests` and the printed document
  field `ReceiptDocument.guests` keep their names.

- **Sample wording (owner, 2026-10-28, A965).** The table and product names follow the sample receipt language. English uses “Outside 6” and “Coffee and toast”; Spanish uses “Terraza 6” and “Café y tostada”. The table name does not repeat the table caption. The synthetic number remains.

- **A receipt's header rows (owner, 2026-10-19, A754).** The first row is the table on the left and
  «Pedido N» on the right (the order alone on the right when there is no table); a printed
  document with no table and order number 0 has no such row (A790). Then:
  - **A simplified receipt** puts its number on the left and the date and time on the right, with
    no captions: the date in words on 80 mm paper and on an A4 page (`18 ago 2026, 11:21`), in
    numbers on 58 mm paper (`18/08/2026 11:21`).
  - **A full invoice**, on every paper, prints «FACTURA» and its number on one row and «Fecha» and
    the date in words on the next, never merged.
  - **A long invoice number on 58 mm paper (owner, 2026-10-19, left as built).** A number longer
    than 12 characters (a restored series such as `T-S123456/123`) puts the date on its own line
    under the number; an emergency-length number (31 characters) wraps inside itself with the date
    beside its last digits. The owner was shown that this wrap can read as two numbers and kept it.
  - **Every printed receipt date has a two-digit hour** (`00:34`, never `0:34`), in every receipt
    language, in words and in numbers.
  - When the right-hand value does not fit beside the end of the left-hand text, it drops to a
    right-aligned line of its own, as before (`labelAmountLines`, `packages/printing/src/layout.ts`).
    The printer's sample receipt (`apps/server/src/sample-receipt.ts`) keeps its Spanish «Mesa 6»
    and «Café y tostada» on a receipt in another language: they are internal sample values (owner).
    **2026-10-28:** the owner superseded this sample-name ruling with A965’s translated names above.

  The law asks for the date and sets no format (checked 2026-10-19): a full invoice and a simplified
  one each need «La fecha de su expedición», and Orden HAC/1177/2024 sets no format for a printed
  invoice's date. Neither RD 1619/2012 art. 6 nor art. 7 asks for the time of day (the one «hora» in
  them is a vehicle's hours of navigation or flight). Downloaded 2026-10-19; every «» quote was found
  word for word, by script, in the downloaded text, and two control phrases («formato de la fecha de
  expedición», «la fecha se expresará en formato») were not:

  | Source | Says |
  | --- | --- |
  | RD 1619/2012 art. 6.1.b (full invoice), [BOE-A-2012-14696](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696), last update 31/03/2026 | «b) La fecha de su expedición.» |
  | RD 1619/2012 art. 7.1.b (simplified invoice), same page | «b) La fecha de su expedición.» |
  | Orden HAC/1177/2024, [BOE-A-2024-22138](https://www.boe.es/buscar/act.php?id=BOE-A-2024-22138), last update 28/10/2024 | Every «fecha» in it was read: they concern the records, their generation time, the chain, the QR's contents and the system's declaration. The one date format it states, «La fecha ha de ser completa, es decir, deberá indicar día, mes y año, en ese orden», is art. 15.1.l, the date the producer signs the declaración responsable, not an invoice's. Art. 21 leaves the QR's date encoding to AEAT's technical document («la codificación y formato de la información requerida se especificarán en el correspondiente documento técnico»); that date sits inside the QR, not in the printed text. |

- **A card taken on a connected card machine never opens the drawer, even when the machine prints a
  paper merchant slip (owner, 2026-10-17).** B30's drawer covers only a machine Waitron does not
  talk to; the rare signed slip goes in the drawer through the manual open.

- **A department without a tax-agency description takes the fiscal module's default when the
  description is read, never by writing one at creation (A662 plan, 2026-10-16).** Existing
  departments get it with no data migration. A stored description `parseReceipt`
  (`packages/venue-service/src/department-receipts.ts`) cannot use — blank, over 500 characters,
  or holding a character below U+0020 other than a tab, carriage return or line feed — counts as
  none, so a sale files the default rather than being refused; the dialog, the Departments warning and the printed receipt already read it as absent.

- **TOTAL is printed double size with no asesor question (owner, 2026-10-14).** Orden HAC/1177/2024
  art. 20.1.b asks for the VERI\*FACTU phrase in «un tipo de letra y tamaño bien visibles, similares
  a los del resto de datos de la factura» (quoted from the BOE in
  `docs/compliance/regional-language-rules.md`); with only the TOTAL enlarged, the rest of the data
  keeps the caption's size. The same call as the till screen's larger TOTAL on 2026-10-01 (C115,
  `docs/compliance/verifactu-findings.md`). The VERI\*FACTU line may be printed in bold for margin.

- **A ruled line between TOTAL and the tax table on every simplified receipt (owner, 2026-11-05,
  A404).** It reverses A663's "TOTAL, then the rates, nothing between them" for that one line; the
  sample receipt matches (`buildReceiptDocument`, `apps/server/src/receipt-document.ts`).

- **Receipts carry no drink and food subtotals (owner, 2026-10-15).** The owner dropped them from
  A663.

- **After a dish's own discount and a whole-bill discount, a part moved by a split that is not an
  adjustment's prints its own discount in the end row (A663 Part 2c).** A full invoice finds a dish's
  family through the link an adjustment's split leaves; any other split leaves none, so the moved
  part's own discount is counted with the whole-bill one in the end row at its rate. The table still
  comes to the filed bases.

- **The guests line is read when the receipt is built, not when the sale is recorded (A663 Part
  3a), except on a simplified receipt since Part 3b.** Since Part 3b the count a simplified receipt
  prints is fixed when the sale is recorded: the number chosen on the payment screen, or the
  default at that moment, stored once per sale (`sales.receipt_guest_count`, read by `readPrintedGuests`,
  `apps/server/src/receipt-guests.ts`). Every later copy of that receipt prints the same number;
  the owner, 2026-10-16: «it should remain the same otherwise it isn't a true duplicate». The rule
  below now holds only for a full invoice and for a sale recorded before Part 3b. There, a later
  copy reads the party as it is then: a count changed after payment, or a new bill
  the party opens after paying, changes or removes the line on that copy, while the order label
  stays as recorded. While a party, with any party joined into it, holds more than one bill that is
  not abandoned (the bills of joined tables, or a split by item), none of those bills
  prints the line, and nor does a bill of a party joined into another (`readReceiptGuests`,
  `apps/server/src/receipt-guests.ts`).

- **Optional receipt formatting (A366 slice 7).** The `receipt-print.test.ts` case that throws
  from `formatReceipt` retains one sale, tender, header and drawer, then replays without another
  fiscal record or drawer. Explicit copy failure remains a refusal. This retires the earlier
  proposal to contain automatic QR-formatting failures; no native-QR fallback was added.

- **Emailed invoices have no consent step (owner, 2026-10-09).** "We don't need customer consent
  to send them an email; just giving us the email address is sufficient." A231q's tasks C1a and
  C1b removed consent from the staged choice, the delivery rows and their retries
  ([plan](../superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)). This is a product
  decision, not a legal conclusion: A448 stays open.

- **A calibration drawer opening records who asked and when, not that the drawer opened.** There is
  no drawer sensor; the audit row is the request.

- **Printer details follow the dashboard's own language, not the venue's** (ruling I) — a
  recorded departure from the spec, which asked for the venue language.

- **A raw device can become addable after its office-printer query fails.** The server keeps each
  agent's latest report; another agent's fresh office mark at the same raw address keeps the raw
  row classified. Capability reports are lent only between agents reporting the same known IPP
  queue. IPP-only rows remain office rows when their query is unanswered. This fail-open cost for
  an unknown raw device is accepted.

- **Two review suggestions on #335 were deliberately not taken** and would be relitigated otherwise:
  renaming the error code `printer.probe_busy` (kept under the domain-naming rule, per #335's
  commit message), and deduplicating targets in the agent host (the issuing server already
  normalises and deduplicates its bounded list of eight).

- The dashboard's "Test open drawer" calibration
  (`POST /management-api/printers/:id/test-drawer`) opens any active printer's drawer for a
  manager holding both `hardware.manage` and `cash.drawer`, with no per-till check — left as it
  is (owner, 2026-10-02).

- **A receipt prints in one language; the venue's is the default, and staff may choose another
  at the till (C113, owner 2026-09-30, #1014; amended by A497, owner 2026-10-11).** The venue's
  receipt language is the first entry of its saved list (`settings.venue.invoiceLocales`); **in
  Catalonia it is fixed to Catalan**
  ([regional-language-rules.md](../compliance/regional-language-rules.md), Catalonia). A choice
  made at the till is saved on the order (`working_orders.receipt_locale`) and read by every path
  that files the order's sale (`saleLanguageFor`, `apps/server/src/venue-locale.ts`). The chosen
  language sets the receipt's fixed words, its dates and amounts, and the department's subtitle and
  footer. **Dish names, variant names, units and option answers are stored once, in the venue's
  default content language, when a line is added, and print in it whatever receipt language is
  chosen** (`packages/menu/src/default-language-text.ts`); no translated dish names (owner,
  2026-10-11). Until A497, no choice was offered when the original printed.

- **A copy can be printed in another receipt language (C114, #1022; narrowed by A497, owner
  2026-10-11).** The till's choice and a copy are both offered in the venue's receipt language,
  then in each of the pack's receipt languages (Spanish, Catalan, Galician and Basque today) that is
  one of the venue's content languages (`readOfferedReceiptLanguages`,
  `apps/server/src/venue-locale.ts`); a copy is also offered in the sale's own language. No English
  receipts (owner, 2026-10-11). Spanish stays offered in Catalonia, where it is a required content
  language (`packages/country-es/src/spain.ts`), as the customer's right there on request (Spain's
  Constitutional Court, ruling 88/2017;
  [regional-language-rules.md](../compliance/regional-language-rules.md), Catalonia). Until A497 a
  copy was offered in every receipt language the pack has.

- **A Valencian venue is not offered Catalan receipts (owner, 2026-10-11).** Content and receipt
  languages match by exact code, so a `ca-ES-valencia` content language does not offer `ca-ES`
  (`offeredReceiptLanguages`, `apps/server/src/venue-locale.ts`).
- **Stored print data is not compressed (watcher, 2026-11-15 23:01, database growth work).** The one-off saving measured, 156,401,664 bytes, did not justify about 430 lines of code and making every later reader unpack it.
- **Staff are not shown a message for a chosen invoice copy (email or office printer) that was never queued (watcher agreed, 2026-11-18 07:09; not the owner's).** Tracing found no venue event that leaves one unqueued: a removed contact, printer or invoice-printer listing each leaves a delivery row the till already shows. The plan's words: "The recommendation (DEFAULT 1) is not to build it. The tracing below found no event at a venue that leaves a chosen copy unqueued".

## Shared office-printer queues

Receipt and office printers share the `printers` table ([A1308 dv4](https://github.com/clintongormley/waitron/blob/0a049fa0ff84a09bb0eb863af66338c63ebeb087/docs/superpowers/plans/2026-11-08-a1308-dv4-a4-printers.md)).

After A576, check two IPP queues on one real print server from the shipped print-agent container.
Add Kitchen A4 and Reception A4 separately and print distinguishable pages to both. Record the
announced server name, each queue path and where the paper emerges. Repeat with one queue
unavailable and an already saved single-queue printer. These physical checks remain open.

The discovery caption uses the announced server hostname, with the local suffix removed, when
available. It falls back to the routing address when no server name was announced; it does not
construct a friendly computer name from a printer label. See the
[identity map and plan](../superpowers/plans/2026-10-14-a576-ipp-queue-identity.md).

## Loose ends left by C107 (#974)

- **Whether a job of pictures still needs the print area (`GS L`/`GS W`) that receipts, category
  pages and the test page send is not measured.** The calibration ruler page sends a print area of
  576 dots whatever the printer. Left open by C107 (#974).

- **At 203 dpi a line could hold 32 columns on 58 mm paper (384 ÷ 12) and 48 on 80 mm (576 ÷ 12); it
  keeps 30 and 42.** Left open by C107 (#974).

- **The 28-dot line cuts letters: by the generator's own report, 67 of its characters lose at least
  one dot that was half inside the letter, most of them accented capitals losing the top of the
  accent.** Measured 2026-10-01 with a copy of the generator: a 30-dot line with the baseline 24
  dots down leaves 3 (ď, ĥ, ŉ), and 31 or 32 dots still leave those 3. Left open by C107 (#974).

- **The preview reads at most 4 MiB of a job and shows at most 2,048 blocks (one per printed line,
  feed, cut or QR code, among others), so a job of more than about 2,040 lines is cut short at any
  width.** The deep-tree case in `apps/server/src/category-sales-page.test.ts` printed about 14,500
  lines on 58mm paper once rows carried their whole path (W73). Left open by C107 (#974).

- **What a printer narrower than 576 dots does with the part of the ruler beyond its head is not
  measured.** The preview shrinks a picture wider than the job's line instead of cutting it, so on
  the ruler page, whose captions are 360 dots wide, the 576-dot ruler is shrunk on every printer.
  Left open by C107 (#974).

## A552. Invoices on the owner's office printer: a multi-page invoice and power loss

Owed on
the HP Color LaserJet MFP M181fw: a multi-page full invoice through the product; the same invoice
as Apple Raster at 600 dpi; a test page from the Printers tab; and what Waitron reports when the
printer is switched off mid-job. On 2026-11-20 a one-page full invoice printed with its QR at
35 mm; the Lenovo saved a paper-out hold, then recorded one successful attempt after paper
returned. The till wording and the A4 rows in Print Queue, which lane H's #3908 changed, still
need checking on that printer with the updated build.

How long the box takes to draw a page (A553, measured 2026-11-20 on the Lenovo M710q, i7-7700T):
the server's `renderInvoicePage` from main `58508d7fe8`, bundled as the server is and run on the
Node and sharp of the box's image `eca67e9dcd`, in a separate container with no network and
nothing sent to a printer. The one-page sample invoice drew as PWG raster in 520–538 ms the first
time and 334–350 ms after, at 300 dpi, and in 1,417–1,422 ms then 1,178–1,229 ms at 600 dpi; Apple
Raster took the same within 30 ms. The process's peak memory rose from about 117 MiB before drawing
to about 211 MiB after one page at 300 dpi and 279 MiB at 600 dpi, and to 251 MiB and 357 MiB
after three pages in a row. A multi-page invoice was not drawn.
