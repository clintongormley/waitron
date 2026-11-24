# Printers

## Add a printer {#add-printer}

In **Printers**, open the **Printers** tab and choose **Add a printer**. Waitron searches for
network, USB and Bluetooth printers. Choose **Add** beside a receipt printer, change the name if
you like, and choose **Add** again; calibration opens next. An office printer shows **Add as A4
printer** instead.

A Bluetooth printer must be in pairing mode first. Choose **Pair and add** beside it, enter its
PIN and choose **Pair and add** again. For a new printer, the name dialog opens: choose **Add**.

If a network printer is not found, open **Check a known address**, type its IP address and choose
**Connect**.

To remove a receipt or station printer, choose **Delete** in its row menu or details. The
confirmation lists the assignments removed and work ended. To use it again, choose **Add a
printer**, then **Add** beside it. A recognised printer keeps its name and calibration, so you
do not need to name or calibrate it again. Assign its devices and prep stations again.

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
**Edit** changes its name and, for a network
receipt printer, its address. **Calibrate printer** runs calibration again. In a receipt
printer's row menu, **Print test page** prints a sample receipt with the venue's header but a
made-up business name and tax number, in the venue's receipt language, marked as a test and not
an invoice. An A4 printer's
details have no calibration; **Print test page** checks one. To remove it, choose **Delete** in
its row menu. The confirmation lists the assignments removed and work ended. To use it again,
choose **Add a printer**, then **Add as A4 printer** beside it and **Add**. It keeps its saved
name and settings. Assign its devices and device profiles again.

After importing a configuration, find its A4 printers with **Add a printer** and add them again.

In **Devices**, choose **Edit** from the device's row menu.
Grey italic equipment names inherit the profile's default. Choose a named item to set it on this
device; choose the grey entry again to inherit. The Devices table uses the same style.

Waitron alerts you when a device's battery is low; if its battery reading in **Devices** is grey or says **Not reported**, check its charge on the device itself.

In **Devices**, check **Invoice printer** to see where a device prints invoices. **· A4** after
the printer's name identifies an A4 printer.

If a Bluetooth printer still appears in Waitron but lost its pairing, put it in pairing mode.
Open **Add a printer** and choose **Pair** beside it, or use **Pair again** if its details offer it.

If **Delete** warns that the drawer has a balance or a pending count, follow the instructions under
**Close first**. On the named till, choose **Close drawer** and leave zero cash. If no till is listed,
assign the drawer in **Devices** first. If the drawer setting is off, turn it on in calibration.
**Delete anyway** keeps the balance and any pending count if you later add a printer at the same
address and Waitron restores its registration.

## Print Queue {#print-queue}

Open **Print Queue** to see why a job is waiting. To add or remove a computer that prints, see [Print agents](printers.md#print-agents). If no print agent sees a USB or Bluetooth
printer, check the printer connection and its print agent. A connection message can appear
alongside the last reported printing error.

If an A4 job says the printer is out of paper, add paper and let the job finish. If the queue says
**May have printed**, check the printer before sending the invoice again. Open **Orders** to
request another A4 print.

Drawer commands cannot be resent. If the till shows **Drawer didn’t open**, check the printer’s
power and connection, then use **Open drawer** if you still need it open. If no result was
reported, check whether the drawer opened before opening it again.

If you moved cash by hand, [record it on the till](table-service.md#drawer-cash-entry).

Choose **Reprint** to send a receipt or invoice to any receipt printer. If the original
already printed, you get a marked copy. Use **Orders** for an A4 copy. You can also reprint a
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

To add a reader, open **Card payments** in Hardware and choose **Add reader** above the table.
Choose the provider if asked, then add a reader from its list or pair a new one.
If no provider is connected, choose **Configure card providers** to set one up first.

Before paying, open **Hardware → Devices**, select your device and choose **Edit** to set its card reader. If a card reader’s battery percentage is missing, check its charge on the reader itself.

In **Card payments**, find the reader under **Card readers** and choose **Delete** in its menu. The confirmation names the assignments removed. If a payment is in progress, let it finish first.

When you add a deleted reader again, a recognised registration shows its saved name and print settings: choose **Add**, then assign it to devices and profiles again. Otherwise, pair it using the provider's normal steps.

Choose **Unpair from …** to remove only its provider registration while keeping it listed in Waitron. You will need to add or pair it again before using it.
