# Printers

## Add a printer {#add-printer}

In **Printers**, open the **Printers** tab and choose **Add a printer**. Waitron searches for
network, USB and Bluetooth printers. Choose **Add** beside a printer, change the name if you like,
and choose **Add** again. When asked, tick the device profiles that should use it and choose
**Save profiles**, or choose **Leave unassigned**. A new receipt printer opens calibration next.

If you add an A4 printer through the main box and want to move it to another agent, close and
reopen **Add a printer**. Choose **Use this agent** beside the agent that can reach it.

A Bluetooth printer must be in pairing mode first. Choose **Pair and add** beside it, enter its
PIN and choose **Pair and add** again. For a new printer, the name dialog opens: choose **Add**.

If your Debian box does not detect a TP-Link UB500 USB Bluetooth adapter, run `sudo apt update`
and `sudo apt install firmware-realtek` on the box. The package comes from Debian's
`non-free-firmware` source. Unplug the adapter, plug it back in and try **Add a printer** again.

If a network printer is not found, open **Check a known address**, type its IP address and choose
**Connect**. When Waitron finds it, choose **Add** if offered or **Close** to leave the search.

To remove a receipt or station printer, choose **Delete** in its row menu or details. The
confirmation shows where the printer will be removed and any pending print jobs that will stop.
To use it again, choose **Add a printer**, then **Add** beside it. A recognised printer keeps its name and calibration, so you
do not need to name or calibrate it again. Choose its profiles and assign its devices and prep stations again.

**Delete** also asks each box that reports the Bluetooth printer paired to unpair it. Put the
printer in pairing mode and choose **Pair and add** to bring it back. If Waitron says a box
may still be paired, make sure the box is on and wait for any Bluetooth request to finish. Then add the printer and choose **Delete** again.

To print station tickets, choose the printer on each station in **Prep stations**. A printer
chosen on every station prints the whole send, for the pass. To add a printer to all stations at
once, choose **Put on every station** in its row menu. **Add a station** starts with the printers
every station already uses ticked: keep the pass printer, and untick any the new station should
not use.

## Calibrate a receipt printer {#calibrate}

Calibration has three steps. It opens after you add a new receipt printer, and **Calibrate printer**
on the printer's details runs it again.

- Choose **Print width test**. On the paper, choose the last number on the ruler you can see in
  full, and measure the QR code's black square without its white border. Waitron shows the paper
  width and print resolution these give. If it says they disagree, measure again.
- Choose **Print sample receipt** and check that every letter prints with its accents and the
  receipt is as wide as the paper.
- Say whether a cash drawer is attached, and test it. Switch on **Portable printer** for a printer
  one person carries, such as a belt printer. Choose **Save**.

## Printer details {#printer-details}

Choose a printer's name in the **Printers** tab or the **Print Queue** to open its details.
For a receipt printer, choose **Edit** to change its name, paper width, print resolution,
cash drawer or portability. For a network printer, you can also change the address and port.
Turn on **Portable printer** to choose what it prints **When picked up**.
Choose **Calibrate printer** if you need to measure the paper or test the drawer. In a receipt
printer's row menu, **Print test page** prints a sample receipt with the venue's header but a
made-up business name and tax number, in the venue's receipt language, marked as a test and not
an invoice. For an A4 printer, use **Edit** to rename it or **Print test page** to check it.
To remove it, choose **Delete** in its row menu. Check where the printer will be removed and
whether any pending A4 invoice jobs will stop. To use it again, choose **Add a printer**, then **Add** beside it and **Add** again. It keeps its saved
name and settings. Assign its devices and device profiles again.

After importing a configuration, find its A4 printers with **Add a printer** and add them again.

In **Devices**, choose **Edit** from the device's row menu.
Choose **Inherit** to follow the profile's equipment, or choose a named item to set it on this
device. Where a device uses that kind of equipment, a blank cell in **Devices** follows the profile.

Waitron alerts you when a device's battery is low; if its battery reading in **Devices** is grey or says **Not reported**, check its charge on the device itself.

In **Devices**, check **Invoice printer** to see the choice set on a device. **· A4** after
the printer's name identifies an A4 printer.

If a Bluetooth printer still appears in Waitron but lost its pairing, put it in pairing mode.
Open **Add a printer** and choose **Pair** beside it, or use **Pair again** if its details offer it.

If **Delete** warns that the drawer has a balance or a pending count, follow the instructions under
**Close first**. On the named till, choose **Close drawer** and leave zero cash. If no till is listed,
assign the drawer in **Devices** first. If **Cash drawer attached** is off, turn it on in **Edit**.
**Delete anyway** keeps the balance and any pending count if you later add a printer at the same
address and Waitron restores its registration.

If **Portable printer** is on, choose **QR label…** in the printer's row menu and stick the label on
it. Staff scan it to pick the printer up. In Chrome on an Android phone, **NFC sticker…** writes a
sticker they tap instead.

## Print Queue {#print-queue}

Open **Print Queue** to see why a job is waiting. To add or remove a computer that prints, see [Print agents](printers.md#print-agents). If no print agent sees a USB or Bluetooth
printer, check the printer connection and its print agent. A connection message can appear
alongside the last reported printing error.

If prints take several seconds to start over Bluetooth, switch the printer off and on again.

Choose **View printout** to see the job and its status. Use the arrows at the bottom or the Left
and Right keys to move through the printouts on that queue page. On a small screen, scroll sideways
across a wide printout. Choose **Reprint** from the preview or the queue when it is offered.

If the queue shows an A4 invoice printed, **Reprint** sends a marked copy to any active receipt
or A4 printer. If printing failed or the queue says **May have printed**, check the printer and use
**Orders** to send the invoice again.

If an A4 job says **Held** because the printer is out of paper, add paper and let the job finish.
Check **Pending jobs** and **Last print time** in the **Printers** tab to see what is waiting and
when the printer last finished a job.

Drawer commands cannot be resent. If the till shows **Drawer didn’t open**, check the printer’s
power and connection, then use **Open drawer** if you still need it open. If no result was
reported, check whether the drawer opened before opening it again.

If you moved cash by hand, [record it on the till](table-service.md#drawer-cash-entry).

Choose **Reprint** to send a receipt-printer job to a receipt printer. If the original already
printed, you get a marked copy. For an A4 copy of an invoice sent to a receipt printer,
use **Orders**. You can also reprint a
station ticket or refund receipt on a printer at least as wide. A printout waiting on a
printer that is disabled, or on a USB or Bluetooth printer no print agent sees, can be moved the
same way, and is cancelled there. Other
printouts reprint only on their own printer. For a payment slip, reprint it from here while
its saved data is available. You can reprint a refund acknowledgment for seven days.
Choose **Older print jobs** to find a job past the latest 100.

If Print Queue says a printout’s saved data has expired, open **Orders** to print a receipt
or invoice from the sale. Station tickets, refund receipts, payment slips and reports cannot
be reprinted from that job once its saved data is removed.

## Print agents {#print-agents}

In **Printers**, open **Print Agents** and choose **Delete** in the agent's menu. Printers reached only through this agent cannot print until you add it again; they stay listed.

To use an agent you still trust, choose **Add an agent** and **Add** beside its saved name, including the agent on this box. Jobs still queued for it may print when it returns.

An agent marked **On another box** belongs to another of the venue's boxes, such as the spare. It prints through the main box, so keep it while that box is in use.

To add a different agent, follow the setup steps in **Add an agent** and match its number. If you close the dialog before approving the agent, open it again and wait for the agent to ask for a new number. After pairing, find and add its A4 printers again.

If you deny a request, the agent can appear again under the other requests as **Previously denied**. Choose **Let in** and match its current number if you want to approve it.

## Card readers {#card-readers}

To add a reader, open **Card readers** in **Hardware** and choose **Add reader** above the table.
Choose the provider if asked, then add a reader from its list or pair a new one.
If no provider is connected, choose **Configure card providers** to set one up first.
Keep the ticks for profiles that should use a new reader and choose **Save profiles**, or choose
**Leave unassigned**.

Before paying, open **Hardware → Devices**, select your device and choose **Edit** to set its card reader. If a card reader’s battery percentage is missing, check its charge on the reader itself.

To let staff pick a reader up by scanning it, choose **QR label…** in its menu and stick the label
on it. In Chrome on an Android phone, **NFC sticker…** writes a sticker they tap instead.

Open **Card readers** in **Hardware**, find the reader and choose **Delete** in its menu. The confirmation names the assignments removed. If a payment is in progress, let it finish first.

When you add a deleted reader again, a recognised registration shows its saved name and print settings: choose **Add**. Tick the profiles that should use it and choose **Save profiles**. Otherwise, pair it using the provider's normal steps.

Choose **Unpair from …** to remove only its provider registration while keeping it listed in Waitron. You will need to add or pair it again before using it.
